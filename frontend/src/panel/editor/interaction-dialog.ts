// The dialog of an interaction (a button of the card, or the tap on it):
// whether it is in the push notification, the Snooze button's times, the
// action, and for an own button its label and icon (the built-in buttons
// have only an icon here; their label is set in YAML).
//
// What a button does to the card is fixed: Done marks it done, Dismiss
// dismisses it, Snooze snoozes it; the Tap and the own buttons leave it as
// it is and only run their action.

import { LitElement, css, html, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";

import type { Button, ButtonAction } from "../../shared/config";
import { DEFAULT_SNOOZE, SNOOZE_CHOICES, snoozeChoices } from "../../shared/live";
import type { HomeAssistant } from "../../shared/types";
import { field } from "../fields";

/** The default label and icon of an interaction. */
export const INTERACTION_DEFAULTS: Record<
  Button["type"],
  { label: string; icon: string }
> = {
  tap: { label: "Tap behavior", icon: "mdi:gesture-tap" },
  done: { label: "Done", icon: "mdi:check" },
  dismiss: { label: "Dismiss", icon: "mdi:close" },
  snooze: { label: "Snooze", icon: "mdi:alarm-snooze" },
  custom: { label: "Button", icon: "mdi:gesture-tap-button" },
};

// The order of the Action choice.
const ACTIONS: { value: ButtonAction["type"]; label: string }[] = [
  { value: "nothing", label: "Nothing" },
  { value: "entity_action", label: "Entity action" },
  { value: "more_info", label: "More info" },
  { value: "ha_action", label: "Action" },
  { value: "navigate", label: "Navigate" },
];

/** What an interaction does, in a few words (the row's second line). */
export function actionText(
  hass: HomeAssistant | undefined,
  action: ButtonAction | undefined,
): string {
  switch (action?.type) {
    case "entity_action":
      return "Entity action";
    case "more_info": {
      const entityId = action.entity_id;
      if (!entityId) return "More info";
      const name = hass?.states[entityId]?.attributes.friendly_name;
      return `More info: ${typeof name === "string" ? name : entityId}`;
    }
    case "ha_action": {
      const first = action.actions[0] as
        | { action?: string; service?: string }
        | undefined;
      const name = first?.action ?? first?.service;
      const more =
        action.actions.length > 1 ? ` +${action.actions.length - 1}` : "";
      return name ? `Action: ${name}${more}` : "Action";
    }
    case "navigate":
      return action.path ? `Navigate: ${action.path}` : "Navigate";
    default:
      return "Nothing";
  }
}

@customElement("nc-interaction-dialog")
export class NcInteractionDialog extends LitElement {
  @property({ attribute: false }) public hass?: HomeAssistant;

  @property({ attribute: false }) public button?: Button;

  @property({ type: Boolean }) public narrow = false;

  @property({ type: Boolean }) public isNew = false;

  // Some entity (or entity category) has an action for this button.
  @property({ type: Boolean, attribute: false }) public entityActionSet = false;

  // How many other buttons are shown in the push notification.
  @property({ type: Number, attribute: false }) public otherPushButtons = 0;

  @state() private _button?: Button;

  @state() private _open = true;

  private _result?: Button | "delete";

  protected override willUpdate(): void {
    if (!this._button && this.button)
      this._button = structuredClone(this.button);
  }

  private _set(changes: Partial<Button>): void {
    this._button = { ...this._button!, ...changes };
  }

  private _setAction(type: ButtonAction["type"]): void {
    const current = this._button!.action;
    if (current?.type === type) return;
    const action: ButtonAction =
      type === "ha_action"
        ? { type, actions: [] }
        : type === "navigate"
          ? { type, path: "" }
          : type === "more_info"
            ? { type, entity_id: null }
            : ({ type } as ButtonAction);
    this._set({ action });
  }

  protected override render() {
    const button = this._button;
    const hass = this.hass;
    if (!button || !hass) return nothing;
    const defaults = INTERACTION_DEFAULTS[button.type];
    const action = button.action ?? { type: "nothing" };
    // The built-in buttons' labels are set in YAML only.
    const title =
      button.type === "tap" ? defaults.label : button.label || defaults.label;
    return html`<ha-dialog
      .open=${this._open}
      width="medium"
      header-title=${this.isNew ? "Add button" : title}
      @closed=${this._closed}
    >
      ${button.type === "custom" && !this.isNew
        ? html`<ha-icon-button
            slot="headerActionItems"
            .label=${"Delete"}
            @click=${() => this._close("delete")}
          >
            <ha-icon icon="mdi:delete"></ha-icon>
          </ha-icon-button>`
        : nothing}
      <div class="form">
        ${button.type === "custom"
          ? html`<div class="row">
              ${field(
                hass,
                { text: {} },
                button.label ?? "",
                "Label",
                (value) => this._set({ label: (value as string) || null }),
              )}
              ${this._iconField(button)}
            </div>`
          : button.type === "tap"
            ? nothing
            : this._iconField(button)}
        ${this._renderPush(button)}
        ${button.type === "snooze" ? this._renderSnooze(button) : nothing}
        <div class="divider"></div>
        ${field(
          hass,
          {
            select: {
              mode: "dropdown",
              options: ACTIONS.filter((choice) => choice.value !== "nothing"),
            },
          },
          action.type === "nothing" ? "" : action.type,
          "Action",
          (value) =>
            this._setAction((value as ButtonAction["type"]) || "nothing"),
          { clearable: true },
        )}
        ${this._renderAction(action)}
      </div>
      <ha-dialog-footer slot="footer">
        <ha-button
          slot="secondaryAction"
          appearance="plain"
          @click=${() => this._close()}
        >
          Cancel
        </ha-button>
        <ha-button
          slot="primaryAction"
          @click=${() => this._close(this._button)}
        >
          ${this.isNew ? "Add" : "Update"}
        </ha-button>
      </ha-dialog-footer>
    </ha-dialog>`;
  }

  private _iconField(button: Button) {
    const defaults = INTERACTION_DEFAULTS[button.type];
    return field(
      this.hass,
      { icon: { placeholder: defaults.icon } },
      button.icon ?? "",
      "Icon",
      (value) => this._set({ icon: (value as string) || null }),
    );
  }

  private _renderSnooze(button: Button) {
    const chosen = button.snooze?.length ? button.snooze : DEFAULT_SNOOZE;
    const toggle = (key: string, on: boolean) => {
      const keys = on ? [...chosen, key] : chosen.filter((k) => k !== key);
      // At least one time.
      if (keys.length)
        this._set({
          snooze: SNOOZE_CHOICES.map((c) => c.key).filter((k) =>
            keys.includes(k),
          ),
        });
    };
    return html`<div class="snooze">
      <div class="title">Times</div>
      <div class="times">
        ${SNOOZE_CHOICES.map(
          (choice) =>
            html`<ha-formfield .label=${choice.label}>
              <ha-checkbox
                .checked=${chosen.includes(choice.key)}
                .disabled=${chosen.length === 1 && chosen.includes(choice.key)}
                @change=${(ev: Event) =>
                  toggle(choice.key, (ev.target as HTMLInputElement).checked)}
              ></ha-checkbox>
            </ha-formfield>`,
        )}
      </div>
    </div>`;
  }

  private _renderAction(action: ButtonAction) {
    const hass = this.hass!;
    switch (action.type) {
      case "entity_action":
        return this.entityActionSet
          ? nothing
          : html`<ha-alert alert-type="info"
              >Set the action for each entity in the Entities block.</ha-alert
            >`;
      case "more_info":
        // As the Data's entity: empty is the card's own entity.
        return html`<ha-entity-picker
          .hass=${hass}
          .value=${action.entity_id ?? ""}
          .placeholder=${"Active entity"}
          @value-changed=${(ev: CustomEvent<{ value?: string }>) => {
            ev.stopPropagation();
            this._set({
              action: { type: "more_info", entity_id: ev.detail.value || null },
            });
          }}
        ></ha-entity-picker>`;
      case "navigate":
        return field(hass, { navigation: {} }, action.path, "Path", (value) =>
          this._set({
            action: { type: "navigate", path: (value as string) ?? "" },
          }),
        );
      case "ha_action":
        return html`<ha-automation-action
          .hass=${hass}
          .narrow=${this.narrow}
          .actions=${action.actions}
          @value-changed=${(ev: CustomEvent<{ value: unknown[] }>) => {
            ev.stopPropagation();
            this._set({
              action: { type: "ha_action", actions: ev.detail.value },
            });
          }}
        ></ha-automation-action>`;
      default:
        return nothing;
    }
  }

  private _renderPush(button: Button) {
    const tap = button.type === "tap";
    const on = tap
      ? (button.push_tap ?? true)
      : (button.show_in_push ?? button.type !== "custom");
    const total = this.otherPushButtons + (on ? 1 : 0);
    const times = button.type === "snooze" ? snoozeChoices(button) : [];
    return html`<ha-settings-row>
        <span slot="heading">
          ${tap
            ? "Also when the push notification is tapped"
            : "Show button in the push notification"}
        </span>
        ${on && times.length > 1
          ? html`<span slot="description">
              The push snoozes for ${times[0].label.toLowerCase()}.
            </span>`
          : nothing}
        <ha-switch
          .checked=${on}
          @change=${(ev: Event) => {
            const checked = (ev.target as HTMLInputElement).checked;
            this._set(tap ? { push_tap: checked } : { show_in_push: checked });
          }}
        ></ha-switch>
      </ha-settings-row>
      ${!tap && on && total > 3
        ? html`<ha-alert alert-type="warning">
            ${total} buttons are shown in the push: Android shows only the first
            3, in the order of this list.
          </ha-alert>`
        : nothing}`;
  }

  private _close(result?: Button | "delete"): void {
    this._result = result;
    this._open = false;
  }

  private _closed(ev: Event): void {
    if (ev.target !== ev.currentTarget) return;
    ev.stopPropagation();
    this.dispatchEvent(
      new CustomEvent("interaction-closed", {
        detail: { result: this._result },
      }),
    );
  }

  static override styles = css`
    .form {
      display: flex;
      flex-direction: column;
      gap: 16px;
    }
    .row {
      display: flex;
      flex-wrap: wrap;
      gap: 12px;
    }
    .row > * {
      flex: 1 1 200px;
    }
    .title {
      font-weight: var(--ha-font-weight-medium, 500);
    }
    /* Not as tall as in a settings page. */
    ha-settings-row {
      padding: 0;
      margin: -8px 0;
      min-height: 0;
    }
    .times {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(140px, 1fr));
      margin: 0 -8px;
    }
    .divider {
      height: 1px;
      background-color: var(--divider-color);
      margin: 0 -24px;
    }
  `;
}

declare global {
  interface HTMLElementTagNameMap {
    "nc-interaction-dialog": NcInteractionDialog;
  }
}
