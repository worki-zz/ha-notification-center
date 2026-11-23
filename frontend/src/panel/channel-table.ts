// The Channels table of a category and of a step.

import { LitElement, html, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";

import { PUSH_PRIORITIES, PUSH_PRIORITY_DEFAULT, type PushPriority, type ChannelSettings, type Duration, type Mode, type NotificationCenterConfig } from "../shared/config";
import { errorText } from "../shared/live";
import type { HomeAssistant } from "../shared/types";
import { confirmDialog } from "./confirm";
import { type ChannelInfo, channelIcon, testButton, testChannel } from "./devices";
import { field } from "./fields";

import { CHANNEL_PAGE_STYLES, TABLE_STYLES } from "./table-styles";
import { type LiveTone, PUSH_PRIORITY_INFO, channelSummary, effectiveChannel, hasDelay, liveBadge, modeColumns, whenText } from "./channel-helpers";

// -- Channels ------------------------------------------------------------------

@customElement("nc-channel-table")
export class NcChannelTable extends LitElement {
  @property({ attribute: false }) public hass?: HomeAssistant;

  @property({ type: Boolean }) public narrow = false;

  @property({ attribute: false }) public modes: Mode[] = [];

  @property({ attribute: false }) public channels: ChannelInfo[] = [];

  // The home mode now (a notification's editor only): its column is marked,
  // its ticks are green and a delay that applies now is orange.
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

  private _store(key: string, settings: ChannelSettings): void {
    const value = { ...this.value };
    if (Object.keys(settings).length) value[key] = settings;
    else delete value[key];
    this.dispatchEvent(new CustomEvent("value-changed", { detail: { value } }));
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

  private _resetPart(key: string, part: "modes" | "settings"): void {
    const own = { ...this._own(key) };
    if (part === "modes") delete own.modes;
    else
      for (const name of Object.keys(own))
        if (name !== "modes") delete own[name];
    this._store(key, own);
  }

  private async _resetRow(channel: ChannelInfo): Promise<void> {
    if (
      !(await confirmDialog(this, {
        title: `Reset the home modes of ${channel.name}?`,
        text: "The home modes go back to the category's settings.",
        confirm: "Reset",
      }))
    ) {
      return;
    }
    this._resetPart(channel.key, "modes");
  }

  /** The channel's icon, with a live mark when the home mode is known. */
  private _icon(channel: ChannelInfo, settings: ChannelSettings) {
    const icon = channelIcon(this.hass, channel);
    if (!this.currentMode) return icon;
    const ticked = settings.modes ?? [];
    let tone: LiveTone | undefined;
    let title = "";
    if (this._sendsNow(settings)) {
      const late = hasDelay(settings.delay);
      tone = late ? "waits" : "sends";
      title = late ? "Sends after the delay in the home mode now" : "Sends in the home mode now";
    } else if (ticked.length) {
      tone = "no";
      title = "Does not send in the home mode now";
    }
    return html`<span class="avatar-wrap">${icon}${liveBadge(tone, title)}</span>`;
  }

  /** Whether a channel is ticked in the home mode now. */
  private _sendsNow(settings: ChannelSettings): boolean {
    return !!this.currentMode && (settings.modes ?? []).includes(this.currentMode);
  }

  private _hasOwnSettings(key: string): boolean {
    return Object.keys(this._own(key)).some((name) => name !== "modes");
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
        const own = this._isStep && this._own(channel.key).modes !== undefined;
        const delay = whenText(settings);
        const late = this._sendsNow(settings) && hasDelay(settings.delay);
        return html`<div class="row">
          <div class="cell name">
            ${this._icon(channel, settings)}
            <div class="name-text">
              <div>${channel.name}</div>
              <div class="secondary ${late ? "late" : ""}">
                ${(settings.modes ?? []).length ? delay : "Off"}
              </div>
            </div>
          </div>
          ${modes.map(
            (mode) =>
              html`<div class="cell tick">
                <ha-checkbox
                  class=${mode.id === this.currentMode ? "now" : ""}
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
              ? html`<ha-icon-button
                  class="reset"
                  .label=${"Reset the home modes to the category's settings"}
                  @click=${() => void this._resetRow(channel)}
                >
                  <ha-icon icon="mdi:restore"></ha-icon>
                </ha-icon-button>`
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
        const own =
          this._isStep && Object.keys(this._own(channel.key)).length > 0;
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
            <div class="secondary ${this._sendsNow(settings) && hasDelay(settings.delay) ? "late" : ""}">
              ${channelSummary(settings, modes)}
            </div>
          </div>
          ${own
            ? html`<ha-icon
                class="reset"
                icon="mdi:restore"
                title="Changed in this step"
              ></ha-icon>`
            : nothing}
          <ha-icon class="chevron" icon="mdi:chevron-right"></ha-icon>
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
    const ownSettings = this._isStep && this._hasOwnSettings(key);
    const after = hasDelay(settings.delay);
    const section = (title: string, own: boolean, part: "modes" | "settings") =>
      html`<div class="section-head">
        <span>${title}</span>
        ${own
          ? html`<ha-button
              appearance="plain"
              size="s"
              @click=${() => this._resetPart(key, part)}
            >
              <ha-icon slot="start" icon="mdi:restore"></ha-icon>
              Reset
            </ha-button>`
          : nothing}
      </div>`;
    const device = channel.kind && channel.kind !== "dashboard";
    return html`<ha-dialog
      open
      width="medium"
      header-title=${channel.name}
      @closed=${(ev: Event) => {
        if (ev.target !== ev.currentTarget) return;
        ev.stopPropagation();
        this._open = undefined;
        this._testError = undefined;
      }}
    >
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
      ${section("Home modes", ownModes, "modes")}
      <p class="hint secondary">
        The modes the channel sends in. With no tick the channel is off.
      </p>
      <ha-card outlined>
        ${modes.map(
          (mode) =>
            html`<label class="list-row">
              <ha-checkbox
                class=${mode.id === this.currentMode ? "now" : ""}
                .checked=${(settings.modes ?? []).includes(mode.id)}
                @change=${(ev: Event) =>
                  this._tick(
                    key,
                    mode.id,
                    (ev.target as HTMLInputElement).checked,
                  )}
              ></ha-checkbox>
              <ha-icon .icon=${mode.icon || "mdi:home-outline"}></ha-icon>
              <div class="name-text">
                ${mode.name}${mode.id === this.currentMode
                  ? html`<ha-icon class="now-dot" icon="mdi:circle-medium" title="The home mode now"></ha-icon>`
                  : nothing}
              </div>
            </label>`,
        )}
      </ha-card>
      <div class="separator"></div>
      ${section("Settings", ownSettings, "settings")}
      <div class="fields">
        <div class="columns">
          <div class="column">
            ${field(
              this.hass,
              {
                select: {
                  mode: "dropdown",
                  options: [
                    { value: "now", label: "Immediately" },
                    { value: "after", label: "Delayed" },
                  ],
                },
              },
              after ? "after" : "now",
              "When",
              (value) =>
                this._store(key, {
                  ...this._own(key),
                  delay: value === "after" ? { hours: 1 } : null,
                }),
              { helper: "After the notification becomes active." },
            )}
          </div>
          ${after || channel.kind === "speaker"
            ? html`<div class="column">
            ${after
              ? field(
                  this.hass,
                  { duration: {} },
                  settings.delay,
                  "Delay",
                  (value) =>
                    this._store(key, {
                      ...this._own(key),
                      delay: (value as Duration | undefined) ?? null,
                    }),
                )
              : nothing}
            ${channel.kind === "speaker" ? this._renderRepeat(key, settings) : nothing}
              </div>`
            : nothing}
        </div>
        ${channel.kind === "speaker" ? this._renderSpeaker(key, settings) : nothing}
        ${channel.kind === "push" ? this._renderPriority(key, settings) : nothing}
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
    return field(
      this.hass,
      {
        select: {
          mode: "dropdown",
          options: PUSH_PRIORITIES.map((value) => ({
            value,
            label: PUSH_PRIORITY_INFO[value].name,
          })),
        },
      },
      priority,
      "Priority",
      (value) =>
        this._store(key, { ...this._own(key), priority: (value as PushPriority | undefined) ?? PUSH_PRIORITY_DEFAULT }),
      { helper: PUSH_PRIORITY_INFO[priority].help },
    );
  }

  // A speaker: its volume, whether the chime plays and whether the message
  // is read out (with the name and the Info line). The chime is the
  // notification's or its category's.
  private _renderSpeaker(key: string, settings: ChannelSettings) {
    const set = (changes: ChannelSettings) => this._store(key, { ...this._own(key), ...changes });
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
      ${this._renderVolume(key, settings)}
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

  // A speaker's volume for these notifications, with an X that empties it:
  // the category's (in a notification) or the speaker's own.
  private _renderVolume(key: string, settings: ChannelSettings) {
    const volume = settings.volume as number | null | undefined;
    const own = this._own(key).volume;
    const clear = () => {
      const copy = { ...this._own(key) };
      delete copy.volume;
      this._store(key, copy);
    };
    return html`<div class="clearable">
      ${field(
        this.hass,
        { number: { min: 0, max: 100, step: 1, mode: "box", unit_of_measurement: "%" } },
        volume === undefined || volume === null ? undefined : Math.round(volume * 100),
        "Volume",
        (value) => {
          if (value === undefined || value === null || value === "") clear();
          else this._store(key, { ...this._own(key), volume: Number(value) / 100 });
        },
        { helper: "Empty: the speaker's own volume." },
      )}
      ${own !== undefined && own !== null
        ? html`<ha-icon-button class="clear" .label=${"Clear"} @click=${clear}>
            <ha-icon icon="mdi:close"></ha-icon>
          </ha-icon-button>`
        : nothing}
    </div>`;
  }

  // A speaker's repeat until done or silenced: Once; Loop, again and again
  // without a pause; or Recurring, every so often.
  private _renderRepeat(key: string, settings: ChannelSettings) {
    const set = (changes: ChannelSettings) => this._store(key, { ...this._own(key), ...changes });
    const repeat = (settings.repeat as { type: string; every?: Duration } | undefined) ?? { type: "once" };
    const every = repeat.every ?? { hours: 1 };
    return html`${field(
        this.hass,
        {
          select: {
            mode: "dropdown",
            options: [
              { value: "once", label: "Once" },
              { value: "loop", label: "Loop" },
              { value: "recurring", label: "Recurring" },
            ],
          },
        },
        repeat.type,
        "Repeat",
        (value) =>
          set({
            repeat:
              value === "recurring"
                ? { type: "recurring", every: { hours: 1 } }
                : { type: value === "loop" ? "loop" : "once" },
          }),
        { helper: repeat.type === "once" ? "" : "Until done or silenced." },
      )}
      ${repeat.type === "recurring"
        ? field(this.hass, { duration: {} }, every, "Every", (value) =>
            set({ repeat: { type: "recurring", every: (value as Duration | undefined) ?? { hours: 1 } } }),
          )
        : nothing}`;
  }

  static override styles = [TABLE_STYLES, CHANNEL_PAGE_STYLES];
}

declare global {
  interface HTMLElementTagNameMap {
    "nc-channel-table": NcChannelTable;
  }
}
