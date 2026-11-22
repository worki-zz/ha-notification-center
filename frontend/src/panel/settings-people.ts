// The People page of the General tab: every person of Home Assistant, listed
// by itself. A row shows when the person is asleep, written like a mode's
// condition; the pencil opens the person's dialog. In 6.0 the dialog holds
// the Sleep condition only (None, State or Template); push settings join it
// later. Asleep counts only at home: a person away is Away.

import { LitElement, css, html, nothing, unsafeCSS } from "lit";
import { customElement, property, state } from "lit/decorators.js";

import {
  DOMAIN,
  type AudienceState,
  type NotificationCenterConfig,
  type Person,
  type StateMessage,
} from "../shared/config";
import { errorText } from "../shared/live";
import type { HomeAssistant } from "../shared/types";
import { STATE_NAMES } from "./channel-tables";
import { field } from "./fields";
import { conditionWords } from "./settings-modes";
import { STATUS_STYLES, type Status, renderStatus } from "./status";

// The colours of a person's state, as the Active chip of a home mode.
const STATE_TONES: Record<AudienceState, Status["tone"]> = { home: "green", sleep: "purple", away: "grey" };

type ConditionType = "none" | "state" | "template";

interface SleepDraft {
  person: Person;
  type: ConditionType;
  entity_id: string;
  state: string;
  value_template: string;
}

@customElement("nc-settings-people")
export class NcSettingsPeople extends LitElement {
  @property({ attribute: false }) public hass?: HomeAssistant;

  @property({ attribute: false }) public config?: NotificationCenterConfig;

  @property({ attribute: false }) public state?: StateMessage;

  @state() private _edit?: SleepDraft;

  @state() private _error?: string;

  @state() private _busy = false;

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
          ${person.sleep
            ? `Sleep when ${conditionWords(this.hass, person.sleep)}`
            : "No sleep condition"}
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
    };
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
          When the person is asleep. It counts only while they are at home: the
          Audience's Sleep column, instead of Home. With None the person is
          never asleep.
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
          notify: person.notify ?? null,
          device_type: person.device_type,
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
  `;
}

declare global {
  interface HTMLElementTagNameMap {
    "nc-settings-people": NcSettingsPeople;
  }
}
