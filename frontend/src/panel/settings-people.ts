// The People page of the General tab: every person of Home Assistant, listed
// by itself. A row shows when the person is asleep, written like a mode's
// condition, and the phone the pushes go to; the pencil opens the person's
// dialog: the Sleep condition (None, State or Template) and the Push device
// with its type. Asleep counts only at home: a person not at home is Not home.

import { LitElement, css, html, nothing, unsafeCSS } from "lit";
import { customElement, property, state } from "lit/decorators.js";

import {
  DOMAIN,
  type AudienceState,
  type NotificationCenterConfig,
  type Person,
  type PushDevice,
  type StateMessage,
} from "../shared/config";
import { errorText } from "../shared/live";
import type { HomeAssistant } from "../shared/types";
import { STATE_NAMES } from "./channel-helpers";
import { field } from "./fields";
import { conditionWords } from "./settings-modes";
import { STATUS_STYLES, type Status, renderStatus } from "./status";

// The colours of a person's state, as the Active chip of a home mode.
const STATE_TONES: Record<AudienceState, Status["tone"]> = { home: "green", sleep: "purple", away: "red" };

type ConditionType = "none" | "state" | "template";
type DeviceType = PushDevice["device_type"];

interface SleepDraft {
  person: Person;
  type: ConditionType;
  entity_id: string;
  state: string;
  value_template: string;
  // The push device: a notify action, and how it shows a push.
  notify: string;
  device_type: DeviceType;
}

/** A notify action a push can go to (a phone of the Companion app first). */
interface PushService {
  service: string;
  name: string;
  // Known for a phone of the Companion app; null: the user picks it.
  device_type: DeviceType | null;
}

const NO_DEVICE = "none";

const DEVICE_TYPES: { value: DeviceType; label: string }[] = [
  { value: "ios", label: "iOS" },
  { value: "android", label: "Android" },
  { value: "other", label: "Other" },
];

@customElement("nc-settings-people")
export class NcSettingsPeople extends LitElement {
  @property({ attribute: false }) public hass?: HomeAssistant;

  @property({ attribute: false }) public config?: NotificationCenterConfig;

  @property({ attribute: false }) public state?: StateMessage;

  @state() private _edit?: SleepDraft;

  @state() private _error?: string;

  @state() private _busy = false;

  @state() private _services: PushService[] = [];

  @state() private _testError?: string;

  @state() private _tested = false;

  override connectedCallback(): void {
    super.connectedCallback();
    void this._loadServices();
  }

  private async _loadServices(): Promise<void> {
    if (!this.hass) return;
    try {
      const result = await this.hass.callWS<{ services: PushService[] }>({
        type: `${DOMAIN}/push/services`,
      });
      this._services = result.services;
    } catch {
      // Not an admin, or not loaded: the rows show the action's id.
    }
  }

  private _deviceName(service: string): string {
    return this._services.find((item) => item.service === service)?.name ?? service;
  }

  protected override render() {
    const people = this.config?.people ?? [];
    return html`
      ${this._error
        ? html`<ha-alert alert-type="error">${this._error}</ha-alert>`
        : nothing}
      ${people.length
        ? html`<ha-card outlined>
            <div class="rows">${people.map((person) => this._row(person))}</div>
          </ha-card>`
        : html`<ha-alert alert-type="info">
            There are no people in Home Assistant. Add them under Settings,
            People.
          </ha-alert>`}
      ${this._edit ? this._renderDialog(this._edit) : nothing}
    `;
  }

  private _row(person: Person) {
    const now = this.state?.people?.[person.person];
    return html`<div class="row">
      ${customElements.get("ha-person-badge")
        ? html`<ha-person-badge
            class="avatar"
            .person=${{
              id: person.person,
              name: person.name,
              picture: person.picture,
            }}
          ></ha-person-badge>`
        : person.picture
          ? html`<img class="avatar" src=${person.picture} alt="" />`
          : html`<ha-icon class="avatar-icon" icon="mdi:account"></ha-icon>`}
      <div class="text">
        <div>${person.name}</div>
        <div class="secondary">
          ${[
            person.sleep
              ? `Sleep when ${conditionWords(this.hass, person.sleep)}`
              : "No sleep condition",
            person.push_devices[0] ? this._deviceName(person.push_devices[0].notify) : "",
          ]
            .filter(Boolean)
            .join(" · ")}
        </div>
      </div>
      ${now ? renderStatus({ label: STATE_NAMES[now], tone: STATE_TONES[now] }) : nothing}
      <ha-icon-button .label=${"Edit"} @click=${() => this._open(person)}>
        <ha-icon icon="mdi:pencil"></ha-icon>
      </ha-icon-button>
    </div>`;
  }

  private _open(person: Person): void {
    const condition: Record<string, unknown> = person.sleep ?? {};
    const toggle = condition.type === "toggle";
    this._edit = {
      person,
      type: toggle
        ? "state"
        : ((person.sleep?.type as ConditionType | undefined) ?? "none"),
      entity_id: String(condition.entity_id ?? ""),
      state: toggle ? "on" : String(condition.state ?? ""),
      value_template: String(condition.value_template ?? ""),
      // The dialog edits the first push device only.
      notify: person.push_devices[0]?.notify ?? "",
      device_type: person.push_devices[0]?.device_type ?? "other",
    };
    this._testError = undefined;
    this._tested = false;
    if (!this._services.length) void this._loadServices();
  }

  private _set(changes: Partial<SleepDraft>): void {
    this._edit = { ...this._edit!, ...changes };
  }

  private _valid(edit: SleepDraft): boolean {
    switch (edit.type) {
      case "state":
        return !!edit.entity_id && edit.state !== "";
      case "template":
        return !!edit.value_template.trim();
      default:
        return true;
    }
  }

  private _renderDialog(edit: SleepDraft) {
    const types = [
      { label: "None", value: "none" },
      { label: "State", value: "state" },
      { label: "Template", value: "template" },
    ];
    return html`<ha-dialog
      open
      width="medium"
      header-title=${edit.person.name}
      @closed=${(ev: Event) => {
        if (ev.target !== ev.currentTarget) return;
        ev.stopPropagation();
        this._edit = undefined;
      }}
    >
      <div class="form">
        <div class="title">Sleep</div>
        <p class="hint">
          It counts only while the person is at home.
        </p>
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
      <div class="separator"></div>
      ${this._renderPush(edit)}
      <ha-dialog-footer slot="footer">
        <ha-button
          slot="secondaryAction"
          appearance="plain"
          @click=${() => (this._edit = undefined)}
        >
          Cancel
        </ha-button>
        <ha-button
          slot="primaryAction"
          .disabled=${this._busy || !this._valid(edit)}
          @click=${this._save}
        >
          Save
        </ha-button>
      </ha-dialog-footer>
    </ha-dialog>`;
  }

  // The phone the person's pushes go to, and how it shows them.
  private _renderPush(edit: SleepDraft) {
    const options = [
      { value: NO_DEVICE, label: "None" },
      ...this._services.map((item) => ({ value: item.service, label: item.name })),
    ];
    // An action that is gone is still shown, by its id.
    if (edit.notify && !this._services.some((item) => item.service === edit.notify)) {
      options.push({ value: edit.notify, label: edit.notify });
    }
    return html`<div class="form">
      <div class="title-row">
        <div class="title">Push</div>
        <ha-icon-button
          .label=${"Test"}
          title="Test"
          .disabled=${!edit.notify}
          @click=${() => void this._test(edit)}
        >
          <ha-icon icon="mdi:play"></ha-icon>
        </ha-icon-button>
      </div>
      <p class="hint">The phone the person's pushes go to.</p>
      ${this._testError
        ? html`<ha-alert alert-type="error">${this._testError}</ha-alert>`
        : this._tested
          ? html`<ha-alert alert-type="success">Test sent.</ha-alert>`
          : nothing}
      <div class="columns">
        ${field(
          this.hass,
          { select: { mode: "dropdown", options } },
          edit.notify || NO_DEVICE,
          "Device",
          (value) => {
            const notify = !value || value === NO_DEVICE ? "" : String(value);
            const known = this._services.find((item) => item.service === notify)?.device_type;
            this._set({ notify, ...(known ? { device_type: known } : {}) });
          },
        )}
        ${edit.notify
          ? field(
              this.hass,
              { select: { mode: "dropdown", options: DEVICE_TYPES } },
              edit.device_type,
              "Type",
              (value) => this._set({ device_type: (value as DeviceType | undefined) ?? "other" }),
              { helper: edit.device_type === "other" ? "Only the title and the message." : undefined },
            )
          : nothing}
      </div>
    </div>`;
  }

  /** The person's push devices with the first one as edited (none when cleared). */
  private _devicesOf(edit: SleepDraft): Partial<PushDevice>[] {
    const [first, ...others] = edit.person.push_devices;
    if (!edit.notify) return others;
    return [{ ...first, notify: edit.notify, device_type: edit.device_type }, ...others];
  }

  private async _test(edit: SleepDraft): Promise<void> {
    if (!this.hass) return;
    this._testError = undefined;
    this._tested = false;
    try {
      await this.hass.callWS({
        type: `${DOMAIN}/channel/test`,
        channel: "push",
        scope: "person",
        person: { person: edit.person.person, notify: edit.notify, device_type: edit.device_type },
      });
      this._tested = true;
    } catch (err) {
      this._testError = errorText(err);
    }
  }

  private _renderCondition(edit: SleepDraft) {
    switch (edit.type) {
      case "state":
        return html`${field(
          this.hass,
          { entity: {} },
          edit.entity_id || undefined,
          "Entity",
          (value) => this._set({ entity_id: (value as string) ?? "" }),
        )}
        ${field(
          this.hass,
          { state: { entity_id: edit.entity_id || undefined } },
          edit.state || undefined,
          "State",
          (value) =>
            this._set({
              state: value === undefined || value === null ? "" : String(value),
            }),
        )}`;
      case "template":
        return field(
          this.hass,
          { template: {} },
          edit.value_template,
          "Template",
          (value) => this._set({ value_template: (value as string) ?? "" }),
        );
      default:
        return nothing;
    }
  }

  private async _save(): Promise<void> {
    const edit = this._edit;
    if (!edit || !this.hass) return;
    const sleep =
      edit.type === "state"
        ? { type: "state", entity_id: edit.entity_id, state: edit.state }
        : edit.type === "template"
          ? { type: "template", value_template: edit.value_template }
          : null;
    const { person } = edit;
    this._busy = true;
    this._error = undefined;
    try {
      // The other settings of the person stay as they are.
      await this.hass.callWS({
        type: `${DOMAIN}/person/update`,
        data: {
          person: person.person,
          push_devices: this._devicesOf(edit),
          sleep,
        },
      });
      this._edit = undefined;
    } catch (err) {
      this._error = errorText(err);
    } finally {
      this._busy = false;
    }
  }

  static override styles = css`
    ${unsafeCSS(STATUS_STYLES)}
    :host {
      display: flex;
      flex-direction: column;
      gap: 16px;
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
    .rows > .row + .row {
      border-top: 1px solid var(--divider-color);
    }
    .avatar {
      flex: none;
      width: 40px;
      height: 40px;
      border-radius: var(--ha-border-radius-circle, 50%);
      object-fit: cover;
      overflow: hidden;
    }
    .avatar-icon {
      flex: none;
      color: var(--secondary-text-color);
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
    .title {
      font-weight: var(--ha-font-weight-medium, 500);
      margin-bottom: -8px;
    }
    .hint {
      margin: 0;
      color: var(--secondary-text-color);
    }
    ha-button-toggle-group {
      align-self: flex-start;
    }
    .separator {
      border-top: 1px solid var(--divider-color);
      /* Full width, as in the channel dialog. */
      margin: 24px -24px;
    }
    .title-row {
      display: flex;
      align-items: center;
      justify-content: space-between;
      margin: -12px 0 -16px;
    }
    .title-row .title {
      margin-bottom: 0;
    }
    .columns {
      display: flex;
      flex-wrap: wrap;
      gap: 16px;
      align-items: flex-start;
    }
    .columns > * {
      flex: 1 1 220px;
      min-width: 0;
    }
  `;
}

declare global {
  interface HTMLElementTagNameMap {
    "nc-settings-people": NcSettingsPeople;
  }
}
