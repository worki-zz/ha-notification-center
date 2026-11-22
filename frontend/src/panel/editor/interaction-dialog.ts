// The dialog of an interaction (a button of the card, or the tap on it):
// whether it is in the push notification, the Snooze button's times, the
// action, and for an own button its label and icon (the built-in buttons
// have only an icon here; their label is set in YAML).
//
// In a category it sets what the notifications inherit: the label of every
// button, its icon, push and times, but no action. In a notification, a
// category's button shows the category's settings: the icon and times are
// changed for this notification only, and Push is a choice that, left
// empty, follows the category.
//
// What a button does to the card is fixed: Done marks it done, Dismiss
// dismisses it, Snooze snoozes it; the Tap and the own buttons leave it as
// it is and only run their action.

import { LitElement, css, html, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";

import type { Button, ButtonAction, CategoryButton } from "../../shared/config";
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
  { value: "silence", label: "Silence" },
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
    case "silence":
      return "Silence";
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

  // "category": a category's button (no action, every label).
  @property() public mode: "step" | "category" = "step";

  // In a notification: the category's button this one inherits from.
  @property({ attribute: false }) public inherited?: CategoryButton;

  // Some entity (or entity group) has an action for this button.
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
    const category = this.mode === "category";
    const inherited = this.inherited;
    // In a notification, the built-in buttons' labels are set in YAML only.
    const title =
      button.type === "tap"
        ? defaults.label
        : button.label || inherited?.label || defaults.label;
    // The label: every button of a category (a built-in one can be changed
    // and cleared again with X), and a notification's own custom buttons.
    // A label from the category is changed in a notification in YAML only.
    const labelled =
      button.type !== "tap" && (category || (button.type === "custom" && !inherited));
    return html`<ha-dialog
      .open=${this._open}
      width="medium"
      header-title=${this.isNew ? "Add button" : title}
      @closed=${this._closed}
    >
      ${button.type === "custom" && !this.isNew && !inherited
        ? html`<ha-icon-button
            slot="headerActionItems"
            .label=${"Delete"}
            @click=${() => this._close("delete")}
          >
            <ha-icon icon="mdi:delete"></ha-icon>
          </ha-icon-button>`
        : nothing}
      <div class="form">
        ${labelled
          ? html`<div class="row">
              ${this._labelField(button)} ${this._iconField(button)}
            </div>`
          : button.type === "tap"
            ? nothing
            : this._iconField(button)}
        ${inherited ? this._renderPushChoice(button, inherited) : this._renderPush(button)}
        ${button.type === "snooze" ? this._renderSnooze(button) : nothing}
        ${category ? nothing : this._renderActionPart(action)}
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
          .disabled=${button.type === "custom" && !this.inherited && !button.label?.trim()}
          @click=${() => this._close(this._button)}
        >
          ${this.isNew ? "Add" : "Update"}
        </ha-button>
      </ha-dialog-footer>
    </ha-dialog>`;
  }

  private _renderActionPart(action: ButtonAction) {
    const hass = this.hass!;
    return html`<div class="divider"></div>
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
        ${this._renderAction(action)}`;
  }

  // Required for a custom button defined here (in the category, or a
  // notification's own); else empty means the default or the category's.
  private _labelField(button: Button) {
    const own = button.type === "custom" && !this.inherited;
    const fallback = this.inherited?.label || INTERACTION_DEFAULTS[button.type].label;
    const field_ = field(
      this.hass,
      { text: {} },
      button.label ?? "",
      "Label",
      (value) => this._set({ label: (value as string) || null }),
      own ? { required: true } : { placeholder: fallback },
    );
    if (own || !button.label) return field_;
    return html`<div class="clearable">
      ${field_}
      <ha-icon-button class="clear" .label=${"Clear"} @click=${() => this._set({ label: null })}>
        <ha-icon icon="mdi:close"></ha-icon>
      </ha-icon-button>
    </div>`;
  }

  private _iconField(button: Button) {
    const defaults = INTERACTION_DEFAULTS[button.type];
    return field(
      this.hass,
      { icon: { placeholder: this.inherited?.icon || defaults.icon } },
      button.icon ?? "",
      "Icon",
      (value) => this._set({ icon: (value as string) || null }),
    );
  }

  private _renderSnooze(button: Button) {
    const base = this.inherited?.snooze?.length
      ? this.inherited.snooze
      : DEFAULT_SNOOZE;
    const chosen = button.snooze?.length ? button.snooze : base;
    const toggle = (key: string, on: boolean) => {
      const keys = on ? [...chosen, key] : chosen.filter((k) => k !== key);
      // At least one time.
      if (!keys.length) return;
      const snooze = SNOOZE_CHOICES.map((c) => c.key).filter((k) =>
        keys.includes(k),
      );
      // The category's times again: inherited, not stored.
      const same =
        !!this.inherited && snooze.join() === [...base].join();
      this._set({ snooze: same ? null : snooze });
    };
    return html`<div class="divider"></div>
      <div class="snooze">
      <div class="title">Times</div>
      <div class="times">
        ${SNOOZE_CHOICES.map(
          (choice) =>
            html`<label class="time">
              <ha-checkbox
                .checked=${chosen.includes(choice.key)}
                .disabled=${chosen.length === 1 && chosen.includes(choice.key)}
                @change=${(ev: Event) =>
                  toggle(choice.key, (ev.target as HTMLInputElement).checked)}
              ></ha-checkbox>
              <span>${choice.label}</span>
            </label>`,
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
      case "silence":
        return html`<ha-alert alert-type="info"
          >Stops the lights, the speakers and the sirens of the notification. The card stays.</ha-alert
        >`;
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
      : (button.show_in_push ?? true);
    const total = this.otherPushButtons + (on ? 1 : 0);
    const times = button.type === "snooze" ? snoozeChoices(button) : [];
    return html`<label class="switch-row">
        <ha-switch
          .checked=${on}
          @change=${(ev: Event) => {
            const checked = (ev.target as HTMLInputElement).checked;
            this._set(tap ? { push_tap: checked } : { show_in_push: checked });
          }}
        ></ha-switch>
        <span>
          ${tap
            ? "Also when the push notification is tapped"
            : "Show button in the push notification"}
          ${on && times.length > 1
            ? html`<div class="secondary">
                The push snoozes for ${times[0].label.toLowerCase()}.
              </div>`
            : nothing}
        </span>
      </label>
      ${!tap && on && total > 3
        ? html`<ha-alert alert-type="warning">
            ${total} buttons are shown in the push: Android shows only the first
            3, in the order of this list.
          </ha-alert>`
        : nothing}`;
  }

  // A category's button in a notification: Push follows the category unless
  // chosen here.
  private _renderPushChoice(button: Button, inherited: CategoryButton) {
    const tap = button.type === "tap";
    const own = tap ? button.push_tap : button.show_in_push;
    const base = tap ? (inherited.push_tap ?? true) : (inherited.show_in_push ?? true);
    const on = own ?? base;
    const total = this.otherPushButtons + (on ? 1 : 0);
    const options = tap
      ? [
          { value: "on", label: "Also when the push is tapped" },
          { value: "off", label: "Not when the push is tapped" },
        ]
      : [
          { value: "on", label: "Shown in the push" },
          { value: "off", label: "Not in the push" },
        ];
    return html`${field(
        this.hass,
        { select: { mode: "dropdown", options } },
        own === undefined || own === null ? "" : own ? "on" : "off",
        `Push (category: ${base ? "on" : "off"})`,
        (value) => {
          const chosen = value === "on" ? true : value === "off" ? false : undefined;
          const copy = { ...this._button! };
          if (tap) {
            if (chosen === undefined) delete copy.push_tap;
            else copy.push_tap = chosen;
          } else if (chosen === undefined) delete copy.show_in_push;
          else copy.show_in_push = chosen;
          this._button = copy;
        },
        { clearable: true },
      )}
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
    /* A switch at the start of its row, as in the editor's lists. */
    .switch-row {
      display: flex;
      align-items: center;
      gap: 16px;
      cursor: pointer;
    }
    .switch-row .secondary {
      color: var(--secondary-text-color);
      font-size: var(--ha-font-size-s, 12px);
    }
    .times {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(140px, 1fr));
      gap: 4px 16px;
      margin-top: 8px;
    }
    .time {
      display: flex;
      align-items: center;
      gap: 8px;
      min-height: 40px;
      cursor: pointer;
    }
    .clearable {
      position: relative;
    }
    .clearable .clear {
      position: absolute;
      top: 50%;
      inset-inline-end: 4px;
      transform: translateY(-50%);
      color: var(--secondary-text-color);
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
