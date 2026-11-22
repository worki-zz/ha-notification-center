// The Audience and Channels tables of a category and of a step.
//
// A category holds every setting. A step stores only what it changes: a
// person whose states differ, a channel whose modes or delay differ. Such
// a row shows a reset icon (the marker of an override) that takes the
// row back to the category's settings.
//
// Audience: one row per person with the states they get the notification
// in: Home (at home and awake), Sleep (at home and asleep) and Away.
// Channels: one row per channel with a tick per mode and a pencil that
// opens the channel's dialog (Modes and Settings, each with its own reset).
// On a narrow screen a channel row shows a summary; the dialog does the rest.

import { LitElement, css, html, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";

import {
  AUDIENCE_STATES,
  BUILTIN_CHIMES,
  type AudienceEntry,
  type AudienceState,
  type ChannelSettings,
  type Duration,
  type Mode,
  type NotificationCenterConfig,
} from "../shared/config";
import { errorText } from "../shared/live";
import type { HomeAssistant } from "../shared/types";
import { confirmDialog } from "./confirm";
import { type ChannelInfo, channelIcon, testButton, testChannel } from "./devices";
import { field } from "./fields";

export type { ChannelInfo } from "./devices";
export { channelsOf } from "./devices";

export const STATE_NAMES: Record<AudienceState, string> = {
  home: "Home",
  sleep: "Sleep",
  away: "Away",
};

const STATE_HELP: Record<AudienceState, string> = {
  home: "At home and awake",
  sleep: "At home and asleep",
  away: "Not at home",
};

export interface PersonInfo {
  id: string;
  name: string;
  picture?: string;
}

/** Every person of Home Assistant, by name. */
export function haPeople(hass: HomeAssistant | undefined): PersonInfo[] {
  return Object.values(hass?.states ?? {})
    .filter((state) => state.entity_id.startsWith("person."))
    .map((state) => ({
      id: state.entity_id,
      name: String(state.attributes.friendly_name ?? state.entity_id.slice(7)),
      picture:
        (state.attributes.entity_picture as string | undefined) ?? undefined,
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** The modes as columns: the unconditional Home first, then the list's order. */
export function modeColumns(modes: Mode[] | undefined): Mode[] {
  const list = modes ?? [];
  const home = list.find((mode) => mode.id === "home" && !mode.condition);
  return home ? [home, ...list.filter((mode) => mode !== home)] : list;
}

const EVERY: AudienceEntry = { home: true, sleep: true, away: true };

/**
 * The states each person gets a notification in, as the backend works it
 * out: a person the category leaves out gets what the listed people have in
 * common (nobody listed: every state); the step's own entry wins.
 */
export function effectiveAudience(
  category: Record<string, AudienceEntry> | undefined,
  own: Record<string, AudienceEntry> | undefined,
  people: string[],
): Record<string, AudienceEntry> {
  const base = category ?? {};
  const listed = Object.values(base);
  const common: AudienceEntry = listed.length
    ? {
        home: listed.every((entry) => entry.home),
        sleep: listed.every((entry) => entry.sleep),
        away: listed.every((entry) => entry.away),
      }
    : EVERY;
  return Object.fromEntries(
    people.map((person) => [
      person,
      { ...(own?.[person] ?? base[person] ?? common) },
    ]),
  );
}

/** The states shown as columns: Sleep only when someone can be asleep. */
export function visibleStates(sleepers: string[]): AudienceState[] {
  return sleepers.length ? AUDIENCE_STATES : ["home", "away"];
}

/** The states a person can be in: asleep only with a sleep condition. */
function personStates(person: string, sleepers: string[]): AudienceState[] {
  return sleepers.includes(person) ? AUDIENCE_STATES : ["home", "away"];
}

/** The people of the configuration with a sleep condition. */
export function sleepersOf(
  people: { person: string; sleep?: unknown }[] | undefined,
): string[] {
  return (people ?? [])
    .filter((person) => person.sleep)
    .map((person) => person.person);
}

/** "2/3": the people in at least one state they can be in, of everyone. */
export function audienceCount(
  hass: HomeAssistant | undefined,
  category: Record<string, AudienceEntry> | undefined,
  own: Record<string, AudienceEntry> | undefined,
  sleepers: string[] = [],
): string | undefined {
  const people = haPeople(hass).map((person) => person.id);
  if (!people.length) return undefined;
  const effective = effectiveAudience(category, own, people);
  const on = people.filter((person) =>
    personStates(person, sleepers).some((state) => effective[person][state]),
  ).length;
  return `${on}/${people.length}`;
}

/** A channel's settings: the category's, then what the step changes. */
export function effectiveChannel(
  base: ChannelSettings | undefined,
  own: ChannelSettings | undefined,
): ChannelSettings {
  return { modes: [], delay: null, ...(base ?? {}), ...(own ?? {}) };
}

/** "5 minutes", "1 hour 30 minutes". */
export function durationText(delay: Duration | null | undefined): string {
  if (!delay) return "";
  const parts: string[] = [];
  const add = (amount: number | undefined, unit: string) => {
    if (amount) parts.push(`${amount} ${unit}${amount === 1 ? "" : "s"}`);
  };
  add(delay.days, "day");
  add(delay.hours, "hour");
  add(delay.minutes, "minute");
  add(delay.seconds, "second");
  return parts.join(" ");
}

/** The chimes a speaker can play: the built-in ones, then the Chimes list. */
export function chimeOptions(config: NotificationCenterConfig | undefined): { value: string; label: string }[] {
  return [
    ...BUILTIN_CHIMES.map((chime) => ({ value: chime.id, label: chime.name })),
    ...(config?.chimes ?? []).map((chime) => ({ value: chime.id, label: chime.name })),
  ];
}

function hasDelay(delay: Duration | null | undefined): boolean {
  return !!delay && Object.values(delay).some((amount) => Number(amount) > 0);
}

/** "Home, Away · After 5 minutes", or "Off". */
export function channelSummary(
  settings: ChannelSettings,
  modes: Mode[],
): string {
  const ticked = modes.filter((mode) => settings.modes?.includes(mode.id));
  if (!ticked.length) return "Off";
  const when = hasDelay(settings.delay)
    ? `After ${durationText(settings.delay)}`
    : "Immediately";
  return `${ticked.map((mode) => mode.name).join(", ")} · ${when}`;
}

/** "As Home Assistant draws a person": the picture, or the initials. */
function avatar(person: PersonInfo) {
  if (customElements.get("ha-person-badge")) {
    return html`<ha-person-badge
      class="avatar"
      .person=${{ id: person.id, name: person.name, picture: person.picture }}
    ></ha-person-badge>`;
  }
  if (person.picture)
    return html`<img class="avatar" src=${person.picture} alt="" />`;
  const initials = person.name
    .trim()
    .split(/\s+/)
    .slice(0, 3)
    .map((part) => part.charAt(0))
    .join("")
    .toUpperCase();
  return html`<span class="avatar">${initials}</span>`;
}

const TABLE_STYLES = css`
  :host {
    display: flex;
    flex-direction: column;
    gap: 12px;
  }
  ha-card {
    overflow: hidden;
  }
  .table {
    display: grid;
    align-items: center;
  }
  .table > .row {
    display: contents;
  }
  .cell {
    display: flex;
    align-items: center;
    min-height: 56px;
    box-sizing: border-box;
    border-top: 1px solid var(--divider-color);
  }
  .head .cell {
    min-height: 40px;
    border-top: none;
    color: var(--secondary-text-color);
    font-size: var(--ha-font-size-s, 12px);
    font-weight: var(--ha-font-weight-medium, 500);
  }
  .cell.name {
    gap: 16px;
    padding-left: 16px;
    min-width: 0;
  }
  .cell.tick {
    justify-content: center;
    padding: 0 4px;
    text-align: center;
  }
  .cell.end {
    justify-content: flex-end;
    padding-right: 4px;
  }
  .name-text {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .name ha-icon,
  .channel-icon {
    flex: none;
    color: var(--secondary-text-color);
  }
  .secondary {
    color: var(--secondary-text-color);
    font-size: var(--ha-font-size-s, 12px);
  }
  .avatar {
    flex: none;
    width: 40px;
    height: 40px;
    border-radius: var(--ha-border-radius-circle, 50%);
    object-fit: cover;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    background-color: var(--light-primary-color);
    color: var(--text-light-primary-color, var(--primary-text-color));
    font-size: var(--ha-font-size-m, 14px);
    overflow: hidden;
  }
  .reset {
    color: var(--secondary-text-color);
  }
  .hint {
    margin: 0;
    color: var(--secondary-text-color);
  }
`;

// -- Audience ------------------------------------------------------------------

@customElement("nc-audience-table")
export class NcAudienceTable extends LitElement {
  @property({ attribute: false }) public hass?: HomeAssistant;

  // The category's audience (a step's table only): the step changes it.
  @property({ attribute: false }) public base?: Record<string, AudienceEntry>;

  // The audience being edited: the category's, or the step's own entries.
  @property({ attribute: false }) public value: Record<string, AudienceEntry> =
    {};

  // The people with a sleep condition: only they can be asleep, so only they
  // have a Sleep tick (no column at all when nobody has one).
  @property({ attribute: false }) public sleepers: string[] = [];

  private get _isStep(): boolean {
    return this.base !== undefined;
  }

  private _emit(value: Record<string, AudienceEntry>): void {
    this.dispatchEvent(new CustomEvent("value-changed", { detail: { value } }));
  }

  private _effective(people: PersonInfo[]): Record<string, AudienceEntry> {
    const ids = people.map((person) => person.id);
    return this._isStep
      ? effectiveAudience(this.base, this.value, ids)
      : effectiveAudience(this.value, undefined, ids);
  }

  private _set(
    people: PersonInfo[],
    person: string,
    state: AudienceState,
    on: boolean,
  ): void {
    const effective = this._effective(people);
    const entry = { ...effective[person], [state]: on };
    if (this._isStep) {
      this._emit({ ...this.value, [person]: entry });
      return;
    }
    // A category lists everyone, so a person added later gets what they all
    // have in common, not what the first changes left.
    this._emit({ ...effective, [person]: entry });
  }

  private _reset(person: string): void {
    const value = { ...this.value };
    delete value[person];
    this._emit(value);
  }

  protected override render() {
    const people = haPeople(this.hass);
    if (!people.length) {
      return html`<p class="hint">
        No people in Home Assistant: the notifications go to everyone.
      </p>`;
    }
    const effective = this._effective(people);
    const states = visibleStates(this.sleepers);
    const nobody = people.every(
      (person) =>
        !personStates(person.id, this.sleepers).some(
          (state) => effective[person.id][state],
        ),
    );
    return html`
      <ha-card outlined>
        <div
          class="table"
          style="grid-template-columns: minmax(0, 1fr) repeat(${states.length}, minmax(56px, auto)) ${this
            ._isStep
            ? "48px"
            : ""}"
        >
          <div class="row head">
            <div class="cell name">Person</div>
            ${states.map(
              (state) =>
                html`<div class="cell tick" title=${STATE_HELP[state]}>
                  ${STATE_NAMES[state]}
                </div>`,
            )}
            ${this._isStep ? html`<div class="cell end"></div>` : nothing}
          </div>
          ${people.map((person) => {
            const entry = effective[person.id];
            const own = this._isStep && !!this.value[person.id];
            return html`<div class="row">
              <div class="cell name">
                ${avatar(person)}<span class="name-text">${person.name}</span>
              </div>
              ${states.map((state) =>
                state === "sleep" && !this.sleepers.includes(person.id)
                  ? html`<div class="cell tick"></div>`
                  : html`<div class="cell tick">
                      <ha-checkbox
                        .checked=${entry[state]}
                        .label=${`${person.name}: ${STATE_NAMES[state]}`}
                        @change=${(ev: Event) =>
                          this._set(
                            people,
                            person.id,
                            state,
                            (ev.target as HTMLInputElement).checked,
                          )}
                      ></ha-checkbox>
                    </div>`,
              )}
              ${this._isStep
                ? html`<div class="cell end">
                    ${own
                      ? html`<ha-icon-button
                          class="reset"
                          .label=${"Reset to the category's settings"}
                          @click=${() => this._reset(person.id)}
                        >
                          <ha-icon icon="mdi:restore"></ha-icon>
                        </ha-icon-button>`
                      : nothing}
                  </div>`
                : nothing}
            </div>`;
          })}
        </div>
      </ha-card>
      <p class="hint secondary">The columns are the person's state.</p>
      ${nobody
        ? html`<ha-alert alert-type="warning"
            >No condition ticked: nothing is sent.</ha-alert
          >`
        : nothing}
    `;
  }

  static override styles = TABLE_STYLES;
}

// -- Channels ------------------------------------------------------------------

@customElement("nc-channel-table")
export class NcChannelTable extends LitElement {
  @property({ attribute: false }) public hass?: HomeAssistant;

  @property({ type: Boolean }) public narrow = false;

  @property({ attribute: false }) public modes: Mode[] = [];

  @property({ attribute: false }) public channels: ChannelInfo[] = [];

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
        title: `Reset the modes of ${channel.name}?`,
        text: "The modes go back to the category's settings.",
        confirm: "Reset",
      }))
    ) {
      return;
    }
    this._resetPart(channel.key, "modes");
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
      <p class="hint secondary">
        The columns are the house's mode.
      </p>
      ${silent
        ? html`<ha-alert alert-type="warning"
            >No mode ticked: nothing is sent.</ha-alert
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
        ${modes.map((mode) => html`<div class="cell tick">${mode.name}</div>`)}
        <div class="cell end"></div>
      </div>
      ${this.channels.map((channel) => {
        const settings = this._effective(channel.key);
        const own = this._isStep && this._own(channel.key).modes !== undefined;
        const delay = hasDelay(settings.delay)
          ? `After ${durationText(settings.delay)}`
          : "Immediately";
        return html`<div class="row">
          <div class="cell name">
            ${channelIcon(this.hass, channel)}
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
                  .label=${"Reset the modes to the category's settings"}
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
          ${channelIcon(this.hass, channel)}
          <div class="name-text">
            <div>${channel.name}</div>
            <div class="secondary">${channelSummary(settings, modes)}</div>
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
      ${device ? testButton("Test", () => void this._test(key, settings)) : nothing}
      ${this._testError ? html`<ha-alert alert-type="error">${this._testError}</ha-alert>` : nothing}
      ${section("Modes", ownModes, "modes")}
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
            </label>`,
        )}
      </ha-card>
      ${section("Settings", ownSettings, "settings")}
      <div class="fields">
        ${field(
          this.hass,
          {
            select: {
              mode: "dropdown",
              options: [
                { value: "now", label: "Immediately" },
                { value: "after", label: "After a delay" },
              ],
            },
          },
          after ? "after" : "now",
          "When",
          (value) =>
            this._store(key, {
              ...this._own(key),
              delay: value === "after" ? { minutes: 5 } : null,
            }),
          { helper: "Delay after the notification becomes active." },
        )}
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
        ${channel.kind === "speaker" ? this._renderSpeaker(key, settings) : nothing}
      </div>
      <ha-dialog-footer slot="footer">
        <ha-button slot="primaryAction" @click=${() => (this._open = undefined)}
          >Done</ha-button
        >
      </ha-dialog-footer>
    </ha-dialog>`;
  }

  private async _test(key: string, settings: ChannelSettings): Promise<void> {
    this._testError = undefined;
    try {
      await testChannel(this.hass, key, { ...this.testContext, settings });
    } catch (err) {
      this._testError = errorText(err);
    }
  }

  // A speaker: the chime (the category's unless changed), its repeat, and
  // whether the message is read out (with the name and the Info line).
  private _renderSpeaker(key: string, settings: ChannelSettings) {
    const set = (changes: ChannelSettings) => this._store(key, { ...this._own(key), ...changes });
    const chime = "chime" in settings ? (settings.chime === null ? "none" : String(settings.chime)) : "category";
    const categoryChime = this._chimeName(this.testContext.category as { chime?: string | null } | undefined);
    const options = [
      { value: "category", label: `Same as the category${categoryChime ? ` (${categoryChime})` : ""}` },
      { value: "none", label: "None" },
      ...chimeOptions(this.config),
    ];
    const repeat = (settings.repeat as { type: string; every?: Duration } | undefined) ?? { type: "once" };
    const reading = !!settings.read_the_message;
    const check = (label: string, name: "read_name" | "read_info") =>
      html`<label class="check">
        <ha-checkbox
          .checked=${!!settings[name]}
          .disabled=${!reading}
          @change=${(ev: Event) => set({ [name]: (ev.target as HTMLInputElement).checked })}
        ></ha-checkbox>
        ${label}
      </label>`;
    return html`
      ${field(this.hass, { select: { mode: "dropdown", options } }, chime, "Chime", (value) => {
        const own = { ...this._own(key) };
        if (value === "category") delete own.chime;
        else own.chime = value === "none" ? null : value;
        this._store(key, own);
      })}
      ${field(
        this.hass,
        {
          select: {
            mode: "dropdown",
            options: [
              { value: "once", label: "Once" },
              { value: "until_muted", label: "Again and again" },
            ],
          },
        },
        repeat.type,
        "Repeat",
        (value) => set({ repeat: value === "until_muted" ? { type: "until_muted", every: { minutes: 1 } } : { type: "once" } }),
        { helper: "Again and again: until the notification is done or silenced." },
      )}
      ${repeat.type === "until_muted"
        ? field(this.hass, { duration: {} }, repeat.every ?? { minutes: 1 }, "Every", (value) =>
            set({ repeat: { type: "until_muted", every: (value as Duration | undefined) ?? { minutes: 1 } } }),
          )
        : nothing}
      <div class="switch-row">
        <div>
          <div>Read the message</div>
          <div class="secondary">After the chime, with the text-to-speech of the Sound settings.</div>
        </div>
        <ha-switch
          .checked=${reading}
          @change=${(ev: Event) => set({ read_the_message: (ev.target as HTMLInputElement).checked })}
        ></ha-switch>
      </div>
      <div class="checks">
        ${check("Name", "read_name")}
        <label class="check"><ha-checkbox checked disabled></ha-checkbox>Message</label>
        ${check("Info", "read_info")}
      </div>
    `;
  }

  private _chimeName(category: { chime?: string | null } | undefined): string | undefined {
    const id = category?.chime;
    if (!id) return category ? "None" : undefined;
    return chimeOptions(this.config).find((option) => option.value === id)?.label ?? id;
  }

  static override styles = [
    TABLE_STYLES,
    css`
      .list-row {
        display: flex;
        align-items: center;
        gap: 16px;
        padding: 8px 16px;
        min-height: 56px;
        box-sizing: border-box;
        cursor: pointer;
      }
      .list-row + .list-row {
        border-top: 1px solid var(--divider-color);
      }
      .list .list-row:hover,
      .list .list-row:focus-visible {
        background-color: var(--secondary-background-color);
        outline: none;
      }
      .list-row > ha-icon {
        flex: none;
        color: var(--secondary-text-color);
      }
      .list-row .name-text {
        flex: 1;
      }
      .section-head {
        display: flex;
        align-items: center;
        justify-content: space-between;
        min-height: 40px;
        margin-top: 8px;
        font-weight: var(--ha-font-weight-medium, 500);
      }
      .section-head:first-child {
        margin-top: 0;
      }
      ha-dialog .hint {
        margin: 0 0 12px;
      }
      .fields {
        display: flex;
        flex-direction: column;
        gap: 16px;
      }
      .switch-row {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 16px;
      }
      .checks {
        display: flex;
        flex-wrap: wrap;
        gap: 8px 24px;
        margin-top: -8px;
      }
      .check {
        display: flex;
        align-items: center;
        gap: 4px;
        cursor: pointer;
      }
    `,
  ];
}

declare global {
  interface HTMLElementTagNameMap {
    "nc-audience-table": NcAudienceTable;
    "nc-channel-table": NcChannelTable;
  }
}
