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
// In a notification, a button has a list of Actions in a fixed order: the
// Entity action (a switch), the notification state (fixed on Done, Dismiss
// and Snooze, which shows its times there; one can be added to the Tap and
// the own buttons), Silence, any number of Home Assistant actions (Home
// Assistant's own rows, in their own order), and the Navigation last.

import { LitElement, css, html, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";

import type {
  Button,
  ButtonActions,
  ButtonNavigation,
  ButtonState,
  CategoryButton,
} from "../../shared/config";
import { DEFAULT_SNOOZE, SNOOZE_CHOICES, snoozeChoices } from "../../shared/live";
import type { HomeAssistant } from "../../shared/types";
import { actionAddAvailable } from "../ha-elements";
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

// The notification states, in the order of their choice.
const STATES: { value: ButtonState["type"]; label: string; text: string }[] = [
  { value: "done", label: "Done", text: "Marks the card done." },
  { value: "dismiss", label: "Dismiss", text: "Dismisses the card." },
  { value: "snooze", label: "Snooze", text: "Snoozes the card." },
];

// A built-in button's own notification state.
const OWN_STATE: Partial<Record<Button["type"], ButtonState["type"]>> = {
  done: "done",
  dismiss: "dismiss",
  snooze: "snooze",
};

// The snooze time a newly added Snooze notification state starts with.
const DEFAULT_STATE_SNOOZE = "1h";

function haActionName(action: unknown): string | undefined {
  const item = action as { action?: string; service?: string } | undefined;
  return item?.action ?? item?.service;
}

/** What an interaction does, in a few words (the row's second line). */
export function actionsText(
  hass: HomeAssistant | undefined,
  actions: ButtonActions | undefined,
): string[] {
  const parts: string[] = [];
  if (!actions) return parts;
  if (actions.entity_action) parts.push("Entity action");
  const state = actions.notification_state;
  if (state) {
    const label = STATES.find((item) => item.value === state.type)?.label ?? state.type;
    const time = state.type === "snooze"
      ? SNOOZE_CHOICES.find((choice) => choice.key === state.snooze)?.text
      : undefined;
    parts.push(time ? `${label} ${time}` : label);
  }
  if (actions.silence) parts.push("Silence");
  const list = actions.ha_actions ?? [];
  if (list.length) {
    const name = haActionName(list[0]);
    const more = list.length > 1 ? ` +${list.length - 1}` : "";
    parts.push(name ? `Action: ${name}${more}` : `Action${more}`);
  }
  const navigation = actions.navigation;
  if (navigation?.type === "more_info") {
    const entityId = navigation.entity_id;
    const name = entityId ? hass?.states[entityId]?.attributes.friendly_name : undefined;
    parts.push(
      entityId ? `More info: ${typeof name === "string" ? name : entityId}` : "More info",
    );
  } else if (navigation?.type === "navigate") {
    parts.push(navigation.path ? `Navigate: ${navigation.path}` : "Navigate");
  }
  return parts;
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

  // The rows of the Actions list that are opened.
  @state() private _opened = new Set<string>();

  private _result?: Button | "delete";

  protected override willUpdate(): void {
    if (!this._button && this.button)
      this._button = structuredClone(this.button);
  }

  private _set(changes: Partial<Button>): void {
    this._button = { ...this._button!, ...changes };
  }

  // Change the button's actions; a left out (undefined) action goes.
  private _setActions(changes: Partial<ButtonActions>): void {
    const actions: ButtonActions = { ...(this._button!.actions ?? {}), ...changes };
    for (const key of Object.keys(actions) as (keyof ButtonActions)[]) {
      if (actions[key] === undefined) delete actions[key];
    }
    this._set({ actions });
  }

  protected override render() {
    const button = this._button;
    const hass = this.hass;
    if (!button || !hass) return nothing;
    const defaults = INTERACTION_DEFAULTS[button.type];
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
        ${button.type === "tap" ? this._renderOpenOnTap(button) : nothing}
        ${category && button.type === "snooze"
          ? html`<div class="divider"></div>
              ${this._renderSnooze(button)}`
          : nothing}
        ${category ? nothing : this._renderActions(button)}
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

  // The Actions list, in its fixed order, and the buttons that add to it.
  private _renderActions(button: Button) {
    const actions = button.actions ?? {};
    const own = OWN_STATE[button.type];
    const list = actions.ha_actions ?? [];
    // Home Assistant's own Add action button is used where ours cannot open
    // its dialog.
    const addAction = actionAddAvailable();
    return html`<div class="divider"></div>
      <div class="title">Actions</div>
      <div class="actions">
        ${this._entityActionRow(actions)}
        ${own || actions.notification_state ? this._stateRow(button, actions) : nothing}
        ${actions.silence
          ? this._row(
              "silence",
              "mdi:volume-off",
              "Silence",
              html`<div class="secondary">
                Stops the lights, the speakers and the sirens of the notification. The card stays.
              </div>`,
              () => this._setActions({ silence: undefined }),
            )
          : nothing}
        <ha-automation-action
          class="ha-actions"
          ?hidden=${addAction && !list.length}
          ?nc-hide-add=${addAction}
          .hass=${this.hass}
          .narrow=${this.narrow}
          .actions=${list}
          @value-changed=${(ev: CustomEvent<{ value: unknown[] }>) => {
            ev.stopPropagation();
            this._setActions({
              ha_actions: ev.detail.value.length ? ev.detail.value : undefined,
            });
          }}
        ></ha-automation-action>
        ${actions.navigation ? this._navigationRow(actions.navigation) : nothing}
      </div>
      <div class="add">
        ${addAction
          ? this._addButton("Add action", () => this._addHaAction())
          : nothing}
        ${own || actions.notification_state
          ? nothing
          : this._addButton("Add notification state", () =>
              this._setActions({ notification_state: { type: "done" } }),
            )}
        ${actions.silence
          ? nothing
          : this._addButton("Add silence", () => this._setActions({ silence: true }))}
        ${actions.navigation
          ? nothing
          : this._addButton("Add navigation", () =>
              this._setActions({ navigation: { type: "navigate", path: "" } }),
            )}
      </div>`;
  }

  private _addButton(label: string, add: () => void) {
    return html`<ha-button appearance="filled" size="s" @click=${add}>
      <ha-icon slot="start" icon="mdi:plus"></ha-icon>
      ${label}
    </ha-button>`;
  }

  // Home Assistant's Add action dialog of the action list.
  private _addHaAction(): void {
    const list = this.renderRoot.querySelector("ha-automation-action.ha-actions") as
      | (HTMLElement & { _addActionDialog?: () => void })
      | null;
    list?._addActionDialog?.();
  }

  // A fixed row of the list, as the built-in rows of the step editor: in a
  // card like Home Assistant's rows, with an amber icon, opened and closed
  // like them. A row that can go has a delete button.
  private _row(
    key: string,
    icon: string,
    title: string,
    content: unknown,
    remove?: () => void,
    headerItem?: unknown,
  ) {
    return html`<ha-card outlined class="pinned-card"
      ><ha-expansion-panel
        class="pinned"
        .expanded=${this._opened.has(key)}
        @expanded-changed=${(ev: CustomEvent<{ expanded: boolean }>) => {
          ev.stopPropagation();
          if (ev.target !== ev.currentTarget) return;
          const opened = new Set(this._opened);
          if (ev.detail.expanded) opened.add(key);
          else opened.delete(key);
          this._opened = opened;
        }}
        @expanded-will-change=${(ev: Event) => ev.stopPropagation()}
      >
        <ha-icon slot="leading-icon" class="builtin" .icon=${icon}></ha-icon>
        <div slot="header" class="pinned-title">${title}</div>
        ${headerItem || remove
          ? html`<div
              slot="icons"
              class="row-icons"
              @click=${(ev: Event) => ev.stopPropagation()}
              @keydown=${(ev: Event) => ev.stopPropagation()}
            >
              ${headerItem ?? nothing}
              ${remove
                ? html`<ha-icon-button .label=${"Delete"} @click=${remove}>
                    <ha-icon icon="mdi:delete"></ha-icon>
                  </ha-icon-button>`
                : nothing}
            </div>`
          : nothing}
        <div class="row-content">${content}</div>
      </ha-expansion-panel></ha-card
    >`;
  }

  // Always at the top: switched on, the entity's own action for this
  // button runs first.
  private _entityActionRow(actions: ButtonActions) {
    const on = !!actions.entity_action;
    return this._row(
      "entity",
      "mdi:format-list-checks",
      "Entity action",
      html`<div class="secondary">
        Runs the action set for the card's entity (or its entity group) for this button.
        ${on && !this.entityActionSet
          ? html`<ha-alert alert-type="info"
              >Set the action for each entity in the Entities block.</ha-alert
            >`
          : nothing}
      </div>`,
      undefined,
      html`<ha-switch
        .checked=${on}
        @change=${(ev: Event) =>
          this._setActions({
            entity_action: (ev.target as HTMLInputElement).checked || undefined,
          })}
      ></ha-switch>`,
    );
  }

  // A built-in button's own state cannot be removed or changed (Snooze
  // chooses its times here); an added one is one of Done, Dismiss and
  // Snooze, with how long a Snooze lasts.
  private _stateRow(button: Button, actions: ButtonActions) {
    const own = OWN_STATE[button.type];
    const hass = this.hass!;
    if (own) {
      const state = STATES.find((item) => item.value === own)!;
      return this._row(
        "state",
        "mdi:list-status",
        `Notification state: ${state.label}`,
        own === "snooze"
          ? this._renderSnooze(button)
          : html`<div class="secondary">${state.text}</div>`,
      );
    }
    const state = actions.notification_state ?? { type: "done" };
    const label = STATES.find((item) => item.value === state.type)?.label ?? "";
    return this._row(
      "state",
      "mdi:list-status",
      `Notification state: ${label}`,
      html`<div class="fields">
        ${field(
          hass,
          {
            select: {
              mode: "dropdown",
              options: STATES.map(({ value, label: text }) => ({ value, label: text })),
            },
          },
          state.type,
          "State",
          (value) => {
            const type = (value as ButtonState["type"]) || "done";
            this._setActions({
              notification_state:
                type === "snooze"
                  ? { type, snooze: state.snooze ?? DEFAULT_STATE_SNOOZE }
                  : { type },
            });
          },
        )}
        ${state.type === "snooze"
          ? field(
              hass,
              {
                select: {
                  mode: "dropdown",
                  options: SNOOZE_CHOICES.map((choice) => ({
                    value: choice.key,
                    label: choice.label,
                  })),
                },
              },
              state.snooze ?? DEFAULT_STATE_SNOOZE,
              "Snooze for",
              (value) =>
                this._setActions({
                  notification_state: {
                    type: "snooze",
                    snooze: (value as string) || DEFAULT_STATE_SNOOZE,
                  },
                }),
            )
          : nothing}
      </div>`,
      () => this._setActions({ notification_state: undefined }),
    );
  }

  // Always last: More info or Navigate, where the button was pressed.
  private _navigationRow(navigation: ButtonNavigation) {
    const hass = this.hass!;
    const tab = navigation.type;
    const choose = (type: ButtonNavigation["type"]) => {
      if (type === tab) return;
      this._setActions({
        navigation:
          type === "navigate" ? { type, path: "" } : { type: "more_info", entity_id: null },
      });
    };
    return this._row(
      "navigation",
      "mdi:open-in-app",
      tab === "more_info" ? "Navigation: More info" : "Navigation: Navigate",
      html`<ha-tab-group
          @wa-tab-show=${(ev: CustomEvent<{ name: string }>) => {
            ev.stopPropagation();
            choose(ev.detail.name === "more_info" ? "more_info" : "navigate");
          }}
        >
          <ha-tab-group-tab slot="nav" panel="navigate" .active=${tab === "navigate"}>
            Navigate
          </ha-tab-group-tab>
          <ha-tab-group-tab slot="nav" panel="more_info" .active=${tab === "more_info"}>
            More info
          </ha-tab-group-tab>
        </ha-tab-group>
        ${navigation.type === "more_info"
          ? // As the Data's entity: empty is the card's own entity.
            html`<ha-entity-picker
              .hass=${hass}
              .value=${navigation.entity_id ?? ""}
              .placeholder=${"Active entity"}
              @value-changed=${(ev: CustomEvent<{ value?: string }>) => {
                ev.stopPropagation();
                this._setActions({
                  navigation: { type: "more_info", entity_id: ev.detail.value || null },
                });
              }}
            ></ha-entity-picker>`
          : field(hass, { navigation: {} }, navigation.path, "Path", (value) =>
              this._setActions({
                navigation: { type: "navigate", path: (value as string) ?? "" },
              }),
            )}`,
      () => this._setActions({ navigation: undefined }),
    );
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
    return html`<div class="snooze">
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

  // Tap: a tap on the push always opens the app and runs the Tap.
  private _renderTapPush() {
    return html`<div class="secondary">
      Tapping the push notification always opens the app and does the same.
    </div>`;
  }

  private _renderPush(button: Button) {
    const tap = button.type === "tap";
    if (tap) return this._renderTapPush();
    const on = button.show_in_push ?? true;
    const total = this.otherPushButtons + (on ? 1 : 0);
    const times = button.type === "snooze" ? snoozeChoices(button) : [];
    return html`<label class="switch-row">
        <ha-switch
          .checked=${on}
          @change=${(ev: Event) => {
            const checked = (ev.target as HTMLInputElement).checked;
            this._set({ show_in_push: checked });
          }}
        ></ha-switch>
        <span>
          Show button in the push notification
          ${times.length
            ? html`<div class="secondary">
                The push snoozes for ${times[0].label.toLowerCase()}.
              </div>`
            : nothing}
        </span>
      </label>
      ${on && total > 3
        ? html`<ha-alert alert-type="warning">
            ${total} buttons are shown in the push: Android shows only the first
            3, in the order of this list.
          </ha-alert>`
        : nothing}`;
  }

  // Tap: the page the app opens when the push is tapped. A Navigate action
  // opens its own path.
  private _renderOpenOnTap(button: Button) {
    if (this.mode === "step" && button.actions?.navigation?.type === "navigate") return nothing;
    const base = this.inherited?.open_on_tap;
    return field(
      this.hass,
      { navigation: {} },
      button.open_on_tap ?? "",
      "Open on tap",
      (value) => {
        const copy = { ...this._button! };
        if (value) copy.open_on_tap = String(value);
        else delete copy.open_on_tap;
        this._button = copy;
      },
      {
        helper: base
          ? `The page the push opens. Empty: ${base} (category).`
          : "The page the push opens. Empty: the default under General, Push.",
      },
    );
  }

  // A category's button in a notification: Push follows the category unless
  // chosen here.
  private _renderPushChoice(button: Button, inherited: CategoryButton) {
    if (button.type === "tap") return this._renderTapPush();
    const own = button.show_in_push;
    const base = inherited.show_in_push ?? true;
    const on = own ?? base;
    const total = this.otherPushButtons + (on ? 1 : 0);
    const times = button.type === "snooze" ? snoozeChoices(button) : [];
    const options = [
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
          if (chosen === undefined) delete copy.show_in_push;
          else copy.show_in_push = chosen;
          this._button = copy;
        },
        { clearable: true },
      )}
      ${times.length
        ? html`<div class="secondary">The push snoozes for ${times[0].label.toLowerCase()}.</div>`
        : nothing}
      ${on && total > 3
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
    .switch-row .secondary,
    .form > .secondary {
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
    /* The Actions list: fixed rows like the step editor's built-in ones,
       and Home Assistant's own action rows. */
    .actions {
      display: flex;
      flex-direction: column;
      gap: 8px;
    }
    .actions > [hidden] {
      display: none;
    }
    ha-card.pinned-card {
      overflow: hidden;
    }
    ha-expansion-panel.pinned {
      display: block;
      --expansion-panel-summary-padding: 0 8px 0 16px;
      --expansion-panel-content-padding: 0;
    }
    ha-expansion-panel.pinned > ha-icon[slot="leading-icon"] {
      margin-inline-end: 12px;
    }
    .pinned-title {
      flex: 1;
    }
    ha-icon.builtin {
      color: var(--amber-color, #ffc107);
    }
    .row-icons {
      display: flex;
      align-items: center;
      color: var(--secondary-text-color);
    }
    .row-content {
      display: flex;
      flex-direction: column;
      gap: 16px;
      padding: 16px;
    }
    .row-content .secondary {
      color: var(--secondary-text-color);
    }
    .row-content ha-alert {
      display: block;
      margin-top: 8px;
    }
    .row-content ha-tab-group {
      display: block;
      margin: -16px -16px 0;
    }
    .fields {
      display: flex;
      flex-direction: column;
      gap: 16px;
    }
    .add {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
    }
  `;
}

declare global {
  interface HTMLElementTagNameMap {
    "nc-interaction-dialog": NcInteractionDialog;
  }
}
