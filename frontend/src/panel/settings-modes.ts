// The Modes page of the General tab. The first mode whose condition is true
// is the current one, so the list is ordered by dragging. Home without a
// condition is always true: it is shown on top, but works as the last one
// (when no other mode applies). With a condition, Home is ordered like the
// others, and when no mode is true the channels ticked in at least one mode send.
//
// A new mode is added in two steps: its name and condition (saved with
// Home's channels), then which channels of every category it switches on.

import { LitElement, css, html, nothing, unsafeCSS } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { repeat } from "lit/directives/repeat.js";

import { DOMAIN, type Mode, type NotificationCenterConfig, type StateMessage } from "../shared/config";
import { errorText } from "../shared/live";
import type { HomeAssistant } from "../shared/types";
import { confirmDialog } from "./confirm";
import { type ChannelInfo, channelIcon, channelsOf } from "./devices";
import { field } from "./fields";
import { STATUS_STYLES, renderStatus } from "./status";

const HOME = "home";

// A toggle condition (older data) is edited as State "on".
type ConditionType = "none" | "state" | "template";

interface ModeDraft {
  id?: string;
  name: string;
  icon: string | null;
  type: ConditionType;
  entity_id: string;
  state: string;
  value_template: string;
}

/** The mode's condition in a few words. */
function conditionText(hass: HomeAssistant | undefined, mode: Mode): string {
  return mode.condition ? conditionWords(hass, mode.condition) : "When no other mode applies";
}

/** A condition (of a mode, of a person's sleep) in a few words. */
export function conditionWords(hass: HomeAssistant | undefined, condition: NonNullable<Mode["condition"]>): string {
  const entityId = String(condition.entity_id ?? "");
  const name = hass?.states[entityId]?.attributes.friendly_name;
  const entity = typeof name === "string" ? name : entityId;
  switch (condition.type) {
    case "toggle":
      return `${entity} is on`;
    case "state":
      return `${entity} is ${String(condition.state ?? "")}`;
    default:
      return "Template";
  }
}

@customElement("nc-settings-modes")
export class NcSettingsModes extends LitElement {
  @property({ attribute: false }) public hass?: HomeAssistant;

  @property({ attribute: false }) public config?: NotificationCenterConfig;

  @property({ attribute: false }) public state?: StateMessage;

  @state() private _error?: string;

  @state() private _edit?: ModeDraft;

  // Step 2 of a new mode: the channels it switches on, by key.
  @state() private _channels?: { mode: Mode; on: Set<string> };

  @state() private _busy = false;

  protected override render() {
    const config = this.config;
    if (!config) return nothing;
    const modes = config.modes;
    const home = modes.find((mode) => mode.id === HOME);
    const fixedHome = home && !home.condition ? home : undefined;
    const ordered = modes.filter((mode) => mode !== fixedHome);
    const noMode = this.state && this.state.mode === null;
    return html`
      ${this._error ? html`<ha-alert alert-type="error">${this._error}</ha-alert>` : nothing}
      ${noMode
        ? html`<ha-alert alert-type="warning" title="No active mode">
            The channels ticked in at least one mode send.
          </ha-alert>`
        : nothing}
      ${fixedHome ? html`<ha-card outlined>${this._row(fixedHome, false)}</ha-card>` : nothing}
      ${ordered.length
        ? html`<ha-card outlined>
            <ha-sortable handle-selector=".handle" @item-moved=${this._moved}>
              <div class="rows">
                ${repeat(
                  ordered,
                  (mode) => mode.id,
                  (mode) => this._row(mode, true),
                )}
              </div>
            </ha-sortable>
          </ha-card>`
        : nothing}
      <div>
        <ha-button appearance="filled" size="s" @click=${this._add}>
          <ha-icon slot="start" icon="mdi:plus"></ha-icon>
          Add mode
        </ha-button>
      </div>
      ${this._edit ? this._renderDialog(this._edit) : nothing}
      ${this._channels ? this._renderChannels(this._channels) : nothing}
    `;
  }

  private _row(mode: Mode, sortable: boolean) {
    const active = this.state?.mode === mode.id;
    return html`<div class="row">
      ${sortable
        ? html`<div class="handle" title="Drag to reorder">
            <ha-icon icon="mdi:drag-horizontal-variant"></ha-icon>
          </div>`
        : nothing}
      <ha-icon class="mode-icon" .icon=${mode.icon || "mdi:home-variant"}></ha-icon>
      <div class="text">
        <div>${mode.name}</div>
        <div class="secondary">${conditionText(this.hass, mode)}</div>
      </div>
      ${active ? renderStatus({ label: "Active", tone: "green" }) : nothing}
      <ha-icon-button .label=${"Edit"} @click=${() => this._open(mode)}>
        <ha-icon icon="mdi:pencil"></ha-icon>
      </ha-icon-button>
    </div>`;
  }

  // -- The mode dialog -------------------------------------------------------

  private _open(mode: Mode): void {
    const condition: Record<string, unknown> = mode.condition ?? {};
    const toggle = condition.type === "toggle";
    this._edit = {
      id: mode.id,
      name: mode.name,
      icon: mode.icon ?? null,
      type: toggle ? "state" : ((mode.condition?.type as ConditionType | undefined) ?? "none"),
      entity_id: String(condition.entity_id ?? ""),
      state: toggle ? "on" : String(condition.state ?? ""),
      value_template: String(condition.value_template ?? ""),
    };
  }

  private _add(): void {
    this._edit = { name: "", icon: null, type: "state", entity_id: "", state: "", value_template: "" };
  }

  private _set(changes: Partial<ModeDraft>): void {
    this._edit = { ...this._edit!, ...changes };
  }

  private _valid(edit: ModeDraft): boolean {
    if (!edit.name.trim()) return false;
    switch (edit.type) {
      case "state":
        return !!edit.entity_id && edit.state !== "";
      case "template":
        return !!edit.value_template.trim();
      default:
        return edit.id === HOME;
    }
  }

  private _renderDialog(edit: ModeDraft) {
    const isHome = edit.id === HOME;
    const types = [
      ...(isHome ? [{ label: "None", value: "none" }] : []),
      { label: "State", value: "state" },
      { label: "Template", value: "template" },
    ];
    return html`<ha-dialog
      open
      width="medium"
      header-title=${edit.id ? "Edit mode" : "Add mode"}
      @closed=${(ev: Event) => {
        if (ev.target !== ev.currentTarget) return;
        ev.stopPropagation();
        this._edit = undefined;
      }}
    >
      ${edit.id && !isHome
        ? html`<ha-icon-button slot="headerActionItems" .label=${"Delete"} @click=${this._delete}>
            <ha-icon icon="mdi:delete"></ha-icon>
          </ha-icon-button>`
        : nothing}
      <div class="form">
        <div class="form-row">
          ${field(this.hass, { text: {} }, edit.name, "Name", (value) => this._set({ name: (value as string) ?? "" }), {
            required: true,
          })}
          ${field(this.hass, { icon: { placeholder: "mdi:home-variant" } }, edit.icon ?? "", "Icon", (value) =>
            this._set({ icon: (value as string) || null }),
          )}
        </div>
        <div class="title">Condition</div>
        <ha-button-toggle-group
          size="s"
          .buttons=${types}
          .active=${edit.type}
          @value-changed=${(ev: CustomEvent<{ value: ConditionType }>) => {
            ev.stopPropagation();
            this._set({ type: ev.detail.value });
          }}
        ></ha-button-toggle-group>
        ${this._renderCondition(edit)}
      </div>
      <ha-dialog-footer slot="footer">
        <ha-button slot="secondaryAction" appearance="plain" @click=${() => (this._edit = undefined)}>
          Cancel
        </ha-button>
        <ha-button slot="primaryAction" .disabled=${this._busy || !this._valid(edit)} @click=${this._save}>
          ${edit.id ? "Save" : "Next"}
        </ha-button>
      </ha-dialog-footer>
    </ha-dialog>`;
  }

  private _renderCondition(edit: ModeDraft) {
    switch (edit.type) {
      case "state":
        return html`${field(this.hass, { entity: {} }, edit.entity_id || undefined, "Entity", (value) =>
            this._set({ entity_id: (value as string) ?? "" }),
          )}
          ${field(
            this.hass,
            { state: { entity_id: edit.entity_id || undefined } },
            edit.state || undefined,
            "State",
            (value) => this._set({ state: value === undefined || value === null ? "" : String(value) }),
          )}`;
      case "template":
        return field(this.hass, { template: {} }, edit.value_template, "Template", (value) =>
          this._set({ value_template: (value as string) ?? "" }),
        );
      default:
        return nothing;
    }
  }

  private _data(edit: ModeDraft): Record<string, unknown> {
    const condition =
      edit.type === "state"
        ? { type: "state", entity_id: edit.entity_id, state: edit.state }
        : edit.type === "template"
          ? { type: "template", value_template: edit.value_template }
          : null;
    return { name: edit.name.trim(), icon: edit.icon, condition };
  }

  private async _save(): Promise<void> {
    const edit = this._edit;
    if (!edit || !this.hass) return;
    this._busy = true;
    this._error = undefined;
    try {
      if (edit.id) {
        await this.hass.callWS({ type: `${DOMAIN}/item/update`, section: "modes", item_id: edit.id, data: this._data(edit) });
        this._edit = undefined;
      } else {
        // Step 1: saved with Home's channels.
        const mode = await this.hass.callWS<Mode>({ type: `${DOMAIN}/item/create`, section: "modes", data: this._data(edit) });
        this._edit = undefined;
        this._channels = { mode, on: new Set(this._homeChannels()) };
      }
    } catch (err) {
      this._error = errorText(err);
      this._edit = undefined;
    } finally {
      this._busy = false;
    }
  }

  private async _delete(): Promise<void> {
    const edit = this._edit;
    if (!edit?.id || !this.hass) return;
    if (
      !(await confirmDialog(this, {
        title: `Delete ${edit.name}?`,
        text: "The mode is removed from every channel.",
        confirm: "Delete",
        destructive: true,
      }))
    ) {
      return;
    }
    this._edit = undefined;
    await this._run(() => this.hass!.callWS({ type: `${DOMAIN}/item/delete`, section: "modes", item_id: edit.id }));
  }

  private async _moved(ev: CustomEvent<{ oldIndex: number; newIndex: number }>): Promise<void> {
    ev.stopPropagation();
    const modes = this.config?.modes ?? [];
    const home = modes.find((mode) => mode.id === HOME && !mode.condition);
    const ids = modes.filter((mode) => mode !== home).map((mode) => mode.id);
    const [moved] = ids.splice(ev.detail.oldIndex, 1);
    ids.splice(ev.detail.newIndex, 0, moved);
    if (home) ids.push(home.id);
    await this._run(() => this.hass!.callWS({ type: `${DOMAIN}/item/reorder`, section: "modes", item_ids: ids }));
  }

  // -- Step 2: the channels of a new mode ------------------------------------------

  // Every channel, as in the editors.
  private _channelList(): ChannelInfo[] {
    return channelsOf(this.hass, this.config);
  }

  // The channels Home is on for, in any category.
  private _homeChannels(): string[] {
    const keys = new Set<string>();
    for (const category of this.config?.categories ?? []) {
      for (const [key, channel] of Object.entries(category.channels ?? {})) {
        if (channel.modes?.includes(HOME)) keys.add(key);
      }
    }
    return [...keys];
  }

  private _renderChannels(step: { mode: Mode; on: Set<string> }) {
    const toggle = (key: string, on: boolean) => {
      const next = new Set(step.on);
      if (on) next.add(key);
      else next.delete(key);
      this._channels = { ...step, on: next };
    };
    return html`<ha-dialog
      open
      width="medium"
      header-title=${`${step.mode.name}: channels`}
      prevent-scrim-close
      @closed=${(ev: Event) => {
        if (ev.target !== ev.currentTarget) return;
        ev.stopPropagation();
        // Closed without Save: the ticks shown are saved all the same.
        if (this._channels) void this._saveChannels();
      }}
    >
      <p class="hint">Which channels send in this mode, in every category.</p>
      <ha-card outlined class="channels">
        ${this._channelList().map(
          (channel) => html`<label class="row channel">
            <ha-switch
              .checked=${step.on.has(channel.key)}
              @change=${(ev: Event) => toggle(channel.key, (ev.target as HTMLInputElement).checked)}
            ></ha-switch>
            <span class="mode-icon">${channelIcon(this.hass, channel)}</span>
            <div class="text">${channel.name}</div>
          </label>`,
        )}
      </ha-card>
      <ha-dialog-footer slot="footer">
        <ha-button slot="primaryAction" @click=${this._saveChannels}>Save</ha-button>
      </ha-dialog-footer>
    </ha-dialog>`;
  }

  private async _saveChannels(): Promise<void> {
    const step = this._channels;
    if (!step || !this.hass) return;
    this._channels = undefined;
    await this._run(() =>
      this.hass!.callWS({ type: `${DOMAIN}/mode/set_channels`, mode_id: step.mode.id, channels: [...step.on] }),
    );
  }

  private async _run(task: () => Promise<unknown>): Promise<void> {
    this._error = undefined;
    try {
      await task();
    } catch (err) {
      this._error = errorText(err);
    }
  }

  static override styles = css`
    :host {
      display: flex;
      flex-direction: column;
      gap: 16px;
    }
    .hint {
      margin: 0 0 16px;
      color: var(--secondary-text-color);
    }
    ha-card {
      overflow: hidden;
    }
    .row {
      display: flex;
      align-items: center;
      gap: 16px;
      padding: 8px 8px 8px 16px;
      min-height: 56px;
      box-sizing: border-box;
    }
    .rows > .row + .row,
    .channel + .channel {
      border-top: 1px solid var(--divider-color);
    }
    .channel {
      cursor: pointer;
      padding-right: 16px;
    }
    .handle {
      cursor: grab;
      display: flex;
      color: var(--secondary-text-color);
      margin-inline-end: -4px;
    }
    .mode-icon {
      color: var(--state-icon-color, var(--secondary-text-color));
      flex: none;
    }
    .text {
      flex: 1;
      min-width: 0;
    }
    .secondary {
      color: var(--secondary-text-color);
      font-size: var(--ha-font-size-s, 12px);
    }
    .form {
      display: flex;
      flex-direction: column;
      gap: 16px;
    }
    .form-row {
      display: flex;
      flex-wrap: wrap;
      gap: 12px;
    }
    .form-row > * {
      flex: 1 1 200px;
    }
    .title {
      font-weight: var(--ha-font-weight-medium, 500);
      margin-bottom: -8px;
    }
    ha-button-toggle-group {
      align-self: flex-start;
    }
    ${unsafeCSS(STATUS_STYLES)}
  `;
}

declare global {
  interface HTMLElementTagNameMap {
    "nc-settings-modes": NcSettingsModes;
  }
}
