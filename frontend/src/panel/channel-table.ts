// The Channels table of a category and of a step.

import { LitElement, css, html, nothing, unsafeCSS } from "lit";
import { customElement, property, state } from "lit/decorators.js";

import { PUSH_PRIORITIES, PUSH_PRIORITY_DEFAULT, type PushPriority, type ChannelSettings, type Duration, type Mode, type NotificationCenterConfig } from "../shared/config";
import { errorText } from "../shared/live";
import type { HomeAssistant } from "../shared/types";
import { type ChannelInfo, channelIcon, testButton, testChannel } from "./devices";
import { entityDisplay } from "./editor/model";
import { field, inheritField, restoreButton } from "./fields";
import { STATUS_STYLES, renderStatus } from "./status";

import { CHANNEL_PAGE_STYLES, TABLE_STYLES } from "./table-styles";
import { type LiveTone, PUSH_PRIORITY_INFO, channelSummary, durationText, effectiveChannel, hasDelay, liveBadge, modeColumns, whenText } from "./channel-helpers";

type Repeat = { type: string; every?: Duration; times?: number };

const REPEAT_NAMES: Record<string, string> = {
  once: "Once",
  loop: "Loop",
  recurring: "Recurring",
};

// -- Channels ------------------------------------------------------------------

@customElement("nc-channel-table")
export class NcChannelTable extends LitElement {
  @property({ attribute: false }) public hass?: HomeAssistant;

  @property({ type: Boolean }) public narrow = false;

  @property({ attribute: false }) public modes: Mode[] = [];

  @property({ attribute: false }) public channels: ChannelInfo[] = [];

  // The home mode now (a notification's editor only): its column is marked,
  // its ticks are green (orange where not ticked) and the icons get a badge.
  @property({ attribute: false }) public currentMode?: string | null;

  // The configuration: the chimes a speaker can play.
  @property({ attribute: false }) public config?: NotificationCenterConfig;

  // What the Test button runs with: the category or the notification being
  // edited (its colour and highlight), and a step's texts.
  @property({ attribute: false }) public testContext: Record<string, unknown> = {};

  @state() private _testError?: string;

  // The category's channels (a step's table only): the step changes them.
  @property({ attribute: false }) public base?: Record<string, ChannelSettings>;

  // The channels being edited: the category's, or the step's own changes.
  @property({ attribute: false }) public value: Record<
    string,
    ChannelSettings
  > = {};

  // The channel whose dialog is open.
  @state() private _open?: string;

  private get _isStep(): boolean {
    return this.base !== undefined;
  }

  private _effective(key: string): ChannelSettings {
    return this._isStep
      ? effectiveChannel(this.base?.[key], this.value[key])
      : effectiveChannel(this.value[key], undefined);
  }

  private _own(key: string): ChannelSettings {
    return this.value[key] ?? {};
  }

  /**
   * What a channel follows: in a step the category's settings, in a
   * category the built-in ones; a speaker's volume falls back to the one
   * set for it under General, Sound.
   */
  private _inherited(key: string): ChannelSettings {
    const settings = this._isStep
      ? effectiveChannel(this.base?.[key], undefined)
      : effectiveChannel(undefined, undefined);
    if (settings.volume === undefined || settings.volume === null) {
      const speaker = this.config?.speakers.find((item) => `speaker:${item.id}` === key);
      if (speaker?.volume !== undefined && speaker.volume !== null) {
        return { ...settings, volume: speaker.volume };
      }
    }
    return settings;
  }

  private _store(key: string, settings: ChannelSettings): void {
    // A value set here is the channel's own, also when it equals the
    // inherited one; the restore icons bring the inherited ones back.
    const own = { ...settings };
    const value = { ...this.value };
    if (Object.keys(own).length) value[key] = own;
    else delete value[key];
    this.dispatchEvent(new CustomEvent("value-changed", { detail: { value } }));
  }

  private _set(key: string, changes: ChannelSettings): void {
    const own: ChannelSettings = { ...this._own(key), ...changes };
    for (const name of Object.keys(changes)) if (own[name] === undefined) delete own[name];
    this._store(key, own);
  }

  private _setModes(key: string, modes: string[]): void {
    this._store(key, { ...this._own(key), modes });
  }

  private _tick(key: string, modeId: string, on: boolean): void {
    const current = this._effective(key).modes ?? [];
    const modes = on
      ? [...current.filter((id) => id !== modeId), modeId]
      : current.filter((id) => id !== modeId);
    // In the modes' order, so the stored list reads as the table does.
    const order = modeColumns(this.modes).map((mode) => mode.id);
    this._setModes(
      key,
      order.filter((id) => modes.includes(id)),
    );
  }

  // Whether the channel has own settings the restore button brings back:
  // in a step anything, in a category anything but its home modes (they
  // have no default).
  private _hasOwn(key: string): boolean {
    return Object.keys(this._own(key)).some((name) => this._isStep || name !== "modes");
  }

  // The whole channel as it inherits again (a category keeps its modes).
  private _reset(key: string): void {
    const modes = this._own(key).modes;
    this._store(key, !this._isStep && modes ? { modes } : {});
  }

  /** A device's name as the Entities dialogs show it: name, then area ▸ device. */
  private _title(channel: ChannelInfo): { primary: string; secondary: string } {
    if (!channel.entity_id || !this.hass) return { primary: channel.name, secondary: "" };
    return entityDisplay(this.hass, channel.entity_id);
  }

  /** The channel's icon, with a live mark when the home mode is known. */
  private _icon(channel: ChannelInfo, settings: ChannelSettings) {
    const icon = channelIcon(this.hass, channel);
    if (!this.currentMode) return icon;
    const ticked = settings.modes ?? [];
    let tone: LiveTone | undefined;
    let title: string;
    if (this._sendsNow(settings)) {
      const late = hasDelay(settings.delay);
      tone = late ? "waits" : "sends";
      title = late ? "Sends after the delay in the home mode now" : "Sends in the home mode now";
    } else if (ticked.length) {
      tone = "no";
      title = "Does not send in the home mode now";
    } else {
      tone = "off";
      title = "Off in every home mode";
    }
    return html`<span class="avatar-wrap">${icon}${liveBadge(tone, title)}</span>`;
  }

  /**
   * The live colour of a tick in the home mode's column now: green when
   * ticked; an empty box keeps its colour.
   */
  private _liveClass(settings: ChannelSettings, modeId: string): string {
    if (modeId !== this.currentMode || !(settings.modes ?? []).length) return "";
    return settings.modes!.includes(modeId) ? "now" : "";
  }

  /** Whether a channel is ticked in the home mode now. */
  private _sendsNow(settings: ChannelSettings): boolean {
    return !!this.currentMode && (settings.modes ?? []).includes(this.currentMode);
  }

  protected override render() {
    const modes = modeColumns(this.modes);
    const silent = this.channels.every(
      (channel) => !(this._effective(channel.key).modes ?? []).length,
    );
    return html`
      <ha-card outlined
        >${this.narrow
          ? this._renderList(modes)
          : this._renderTable(modes)}</ha-card
      >
      ${silent
        ? html`<ha-alert alert-type="warning"
            >No home mode ticked: nothing is sent.</ha-alert
          >`
        : nothing}
      ${this._open ? this._renderDialog(modes) : nothing}
    `;
  }

  private _renderTable(modes: Mode[]) {
    return html`<div
      class="table"
      style="grid-template-columns: minmax(140px, 1fr) repeat(${modes.length}, minmax(64px, auto)) ${this
        ._isStep
        ? "96px"
        : "56px"}"
    >
      <div class="row head">
        <div class="cell name">Channel</div>
        ${modes.map(
          (mode) =>
            html`<div class="cell tick">
              ${mode.id === this.currentMode
                ? html`<span class="now" title="The home mode now"
                    ><ha-icon class="now-dot" icon="mdi:circle-medium"></ha-icon>${mode.name}</span
                  >`
                : mode.name}
            </div>`,
        )}
        <div class="cell end"></div>
      </div>
      ${this.channels.map((channel) => {
        const settings = this._effective(channel.key);
        const own = this._isStep && this._hasOwn(channel.key);
        const delay = whenText(settings);
        return html`<div class="row">
          <div class="cell name">
            ${this._icon(channel, settings)}
            <div class="name-text">
              <div>${channel.name}</div>
              <div class="secondary">
                ${(settings.modes ?? []).length ? delay : "Off"}
              </div>
            </div>
          </div>
          ${modes.map(
            (mode) =>
              html`<div class="cell tick">
                <ha-checkbox
                  class=${this._liveClass(settings, mode.id)}
                  .checked=${(settings.modes ?? []).includes(mode.id)}
                  .label=${`${channel.name}: ${mode.name}`}
                  @change=${(ev: Event) =>
                    this._tick(
                      channel.key,
                      mode.id,
                      (ev.target as HTMLInputElement).checked,
                    )}
                ></ha-checkbox>
              </div>`,
          )}
          <div class="cell end">
            ${own
              ? restoreButton("Restore the category's settings", () => this._reset(channel.key), "reset")
              : nothing}
            <ha-icon-button
              .label=${"Edit"}
              @click=${() => (this._open = channel.key)}
            >
              <ha-icon icon="mdi:pencil"></ha-icon>
            </ha-icon-button>
          </div>
        </div>`;
      })}
    </div>`;
  }

  private _renderList(modes: Mode[]) {
    return html`<div class="list">
      ${this.channels.map((channel) => {
        const settings = this._effective(channel.key);
        const own = this._isStep && this._hasOwn(channel.key);
        const open = () => (this._open = channel.key);
        return html`<div
          class="list-row"
          role="button"
          tabindex="0"
          @click=${open}
          @keydown=${(ev: KeyboardEvent) => {
            if (ev.key === "Enter") open();
          }}
        >
          ${this._icon(channel, settings)}
          <div class="name-text">
            <div>${channel.name}</div>
            <div class="secondary">
              ${channelSummary(settings, modes)}
            </div>
          </div>
          <div class="list-end">
            ${own
              ? restoreButton("Restore the category's settings", () => this._reset(channel.key), "reset")
              : nothing}
            <ha-icon-button .label=${"Edit"}>
              <ha-icon icon="mdi:pencil"></ha-icon>
            </ha-icon-button>
          </div>
        </div>`;
      })}
    </div>`;
  }

  private _renderDialog(modes: Mode[]) {
    const channel = this.channels.find((item) => item.key === this._open);
    if (!channel) return nothing;
    const key = channel.key;
    const settings = this._effective(key);
    const ownModes = this._isStep && this._own(key).modes !== undefined;
    const inherited = this._inherited(key);
    const ownDelay = this._own(key).delay;
    const when =
      ownDelay === undefined ? undefined : hasDelay(ownDelay) ? "after" : "now";
    const device = channel.kind && channel.kind !== "dashboard";
    return html`<ha-dialog
      open
      width="medium"
      header-title=${this._title(channel).primary}
      header-subtitle=${this._title(channel).secondary}
      @closed=${(ev: Event) => {
        if (ev.target !== ev.currentTarget) return;
        ev.stopPropagation();
        this._open = undefined;
        this._testError = undefined;
      }}
    >
      ${this._hasOwn(key)
        ? restoreButton(
            this._isStep ? "Restore the category's settings" : "Restore the defaults",
            () => this._reset(key),
            "",
            "headerActionItems",
          )
        : nothing}
      ${channel.kind === "push"
        ? html`${testButton("Test on my phone", () => void this._test(key, settings, "me"))}
          ${testButton(
            "Test on every phone it can go to",
            () => void this._test(key, settings, "all"),
            false,
            "mdi:play-box-multiple-outline",
          )}`
        : device
          ? testButton("Test", () => void this._test(key, settings))
          : nothing}
      ${this._testError ? html`<ha-alert alert-type="error">${this._testError}</ha-alert>` : nothing}
      <div class="section-head">
        <span>Home modes</span>
        ${ownModes
          ? restoreButton("Restore the category's home modes", () =>
              this._set(key, { modes: undefined }),
            )
          : nothing}
      </div>
      <p class="hint secondary">
        The modes the channel sends in. With no tick the channel is off.
      </p>
      <ha-card outlined>
        ${modes.map(
          (mode) =>
            html`<label class="list-row">
              <ha-checkbox
                .checked=${(settings.modes ?? []).includes(mode.id)}
                @change=${(ev: Event) =>
                  this._tick(
                    key,
                    mode.id,
                    (ev.target as HTMLInputElement).checked,
                  )}
              ></ha-checkbox>
              <ha-icon .icon=${mode.icon || "mdi:home-outline"}></ha-icon>
              <div class="name-text">${mode.name}</div>
              ${mode.id === this.currentMode
                ? renderStatus({ label: "Active", tone: "green" })
                : nothing}
            </label>`,
        )}
      </ha-card>
      <div class="separator"></div>
      <div class="section-head"><span>Settings</span></div>
      <div class="fields">
        <div class="columns">
          <div class="column">
            ${inheritField(
              this.hass,
              [
                { value: "now", label: "Immediately" },
                { value: "after", label: "Delayed" },
              ],
              when,
              hasDelay(inherited.delay)
                ? `Delayed, ${durationText(inherited.delay)}`
                : "Immediately",
              "When",
              (value) =>
                this._set(key, {
                  delay:
                    value === undefined
                      ? undefined
                      : value === "after"
                        ? hasDelay(inherited.delay)
                          ? inherited.delay
                          : { hours: 1 }
                        : null,
                }),
              "After the notification becomes active.",
            )}
          </div>
          ${when === "after"
            ? html`<div class="column">
                ${field(
                  this.hass,
                  { duration: {} },
                  settings.delay,
                  "Delay",
                  (value) =>
                    this._set(key, {
                      delay: hasDelay(value as Duration | undefined) ? (value as Duration) : { hours: 1 },
                    }),
                )}
              </div>`
            : nothing}
        </div>
        ${channel.kind === "speaker" ? this._renderRepeat(key) : nothing}
        ${channel.kind === "speaker" ? this._renderSpeaker(key, settings) : nothing}
        ${channel.kind === "push" ? this._renderPriority(key, settings) : nothing}
        ${channel.kind === "push" ? this._renderKeep(key) : nothing}
      </div>
      <ha-dialog-footer slot="footer">
        <ha-button slot="primaryAction" @click=${() => (this._open = undefined)}
          >Done</ha-button
        >
      </ha-dialog-footer>
    </ha-dialog>`;
  }

  private async _test(
    key: string,
    settings: ChannelSettings,
    scope?: "me" | "all",
  ): Promise<void> {
    this._testError = undefined;
    try {
      await testChannel(this.hass, key, {
        ...this.testContext,
        settings,
        ...(scope ? { scope } : {}),
      });
    } catch (err) {
      this._testError = errorText(err);
    }
  }

  // A push: how it arrives on the phone.
  private _renderPriority(key: string, settings: ChannelSettings) {
    const priority = (settings.priority as PushPriority | undefined) ?? PUSH_PRIORITY_DEFAULT;
    const inherited =
      (this._inherited(key).priority as PushPriority | undefined) ?? PUSH_PRIORITY_DEFAULT;
    return inheritField(
      this.hass,
      PUSH_PRIORITIES.map((value) => ({ value, label: PUSH_PRIORITY_INFO[value].name })),
      this._own(key).priority as string | undefined,
      PUSH_PRIORITY_INFO[inherited].name,
      "Priority",
      (value) => this._set(key, { priority: value }),
      PUSH_PRIORITY_INFO[priority].help,
    );
  }

  // A push: whether it stays on the phone when the notification closes.
  private _renderKeep(key: string) {
    const own = this._own(key).keep_when_closed as boolean | undefined;
    const inherited = !!this._inherited(key).keep_when_closed;
    return inheritField(
      this.hass,
      [
        { value: "on", label: "On" },
        { value: "off", label: "Off" },
      ],
      own === undefined ? undefined : own ? "on" : "off",
      inherited ? "On" : "Off",
      "Keep push when closed",
      (value) =>
        this._set(key, { keep_when_closed: value === undefined ? undefined : value === "on" }),
      "When the notification is done, dismissed or ends, the push stays on the phone, silently replaced by one without buttons that says how it closed.",
    );
  }

  // A speaker: its volume, whether the chime plays and whether the message
  // is read out (with the name and the Info line). The chime is the
  // notification's or its category's.
  private _renderSpeaker(key: string, settings: ChannelSettings) {
    const set = (changes: ChannelSettings) => this._set(key, changes);
    const reading = !!settings.read_the_message;
    const check = (label: string, name: "read_name" | "read_info") =>
      html`<label class="check">
        <ha-checkbox
          .checked=${!!settings[name]}
          @change=${(ev: Event) => set({ [name]: (ev.target as HTMLInputElement).checked })}
        ></ha-checkbox>
        ${label}
      </label>`;
    return html`
      ${this._renderVolume(key)}
      <div class="switch-row">
        <div>Play chime</div>
        <ha-switch
          .checked=${settings.play_chime !== false}
          @change=${(ev: Event) => set({ play_chime: (ev.target as HTMLInputElement).checked })}
        ></ha-switch>
      </div>
      <div class="switch-row">
        <div>Read the message</div>
        <ha-switch
          .checked=${reading}
          @change=${(ev: Event) => set({ read_the_message: (ev.target as HTMLInputElement).checked })}
        ></ha-switch>
      </div>
      ${reading
        ? html`<div class="checks-block">
            <div class="checks-label">Read</div>
            <div class="checks">
              ${check("Name", "read_name")}
              <label class="check"><ha-checkbox checked disabled></ha-checkbox>Message</label>
              ${check("Info", "read_info")}
            </div>
          </div>`
        : nothing}
    `;
  }

  // A speaker's volume for these notifications; empty: the inherited one,
  // which the placeholder shows (the category's, or the one under General,
  // Sound; "Default" when the speaker keeps its own).
  private _renderVolume(key: string) {
    const own = this._own(key).volume as number | null | undefined;
    const inherited = this._inherited(key).volume as number | null | undefined;
    return field(
      this.hass,
      { number: { min: 0, max: 100, step: 1, mode: "box", unit_of_measurement: "%" } },
      own === undefined || own === null ? undefined : Math.round(own * 100),
      "Volume",
      (value) =>
        this._set(key, {
          volume: value === undefined || value === null || value === "" ? undefined : Number(value) / 100,
        }),
      {
        placeholder:
          inherited === undefined || inherited === null ? "Default" : String(Math.round(inherited * 100)),
      },
    );
  }

  // A speaker's repeat until done or muted: Once; Loop, again and again
  // without a pause; or Recurring, every so often. Times limits how many
  // times it plays in all. Repeat, Every and Times share a row.
  private _renderRepeat(key: string) {
    const own = this._own(key).repeat as Repeat | undefined;
    const inherited = (this._inherited(key).repeat as Repeat | undefined) ?? { type: "once" };
    const every = own?.every ?? { hours: 1 };
    const times = own?.times;
    const keep = times ? { times } : {};
    const setRepeat = (changes: Record<string, unknown>) => {
      const next: Record<string, unknown> = { ...own, ...changes };
      if (next.times === undefined) delete next.times;
      this._set(key, { repeat: next });
    };
    const inheritedText =
      inherited.type === "recurring" && inherited.every
        ? `Recurring, every ${durationText(inherited.every)}`
        : (REPEAT_NAMES[inherited.type] ?? inherited.type);
    return html`<div>
      <div class="repeat-row">
        ${inheritField(
          this.hass,
          Object.entries(REPEAT_NAMES).map(([value, label]) => ({ value, label })),
          own?.type,
          inheritedText,
          "Repeat",
          (value) =>
            this._set(key, {
              repeat:
                value === undefined
                  ? undefined
                  : value === "recurring"
                    ? { type: "recurring", every: { hours: 1 }, ...keep }
                    : value === "loop"
                      ? { type: "loop", ...keep }
                      : { type: "once" },
            }),
        )}
        ${own?.type === "recurring"
          ? field(this.hass, { duration: {} }, every, "Every", (value) =>
              setRepeat({ every: (value as Duration | undefined) ?? { hours: 1 } }),
            )
          : nothing}
        ${own && own.type !== "once"
          ? field(
              this.hass,
              { number: { min: 1, max: 1000, step: 1, mode: "box" } },
              times,
              "Times",
              (value) =>
                setRepeat({
                  times: value === undefined || value === null || value === "" ? undefined : Number(value),
                }),
            )
          : nothing}
      </div>
      ${(own?.type ?? inherited.type) === "once"
        ? nothing
        : html`<div class="repeat-helper">Until done or muted.</div>`}
    </div>`;
  }

  static override styles = [
    TABLE_STYLES,
    CHANNEL_PAGE_STYLES,
    unsafeCSS(STATUS_STYLES),
    css`
      .repeat-row {
        display: flex;
        flex-wrap: wrap;
        gap: 16px;
        align-items: flex-start;
      }
      .repeat-row > * {
        flex: 1 1 140px;
        min-width: 0;
      }
      .list-end {
        display: flex;
        align-items: center;
        margin-inline-end: -8px;
      }
      .list-end .reset {
        margin-inline-end: -8px;
      }
      .section-head .restore {
        color: var(--secondary-text-color);
      }
      .repeat-helper {
        margin: 4px 16px 0;
        color: var(--secondary-text-color);
        font-size: var(--ha-font-size-s, 12px);
      }
    `,
  ];
}

declare global {
  interface HTMLElementTagNameMap {
    "nc-channel-table": NcChannelTable;
  }
}
