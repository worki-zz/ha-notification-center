// The dialog of an interaction (a button of the card, or the tap on it):
// whether it is in the push notification, the Snooze button's times, the
// action, and for an own button its label and icon (the built-in buttons
// have only an icon here; their label is set in YAML).
//
// In a category it sets what the notifications inherit: the label of every
// button, its icon, push and times, and the Tap behavior, but no other
// action. In a notification, a
// category's button shows the category's settings: the icon and times are
// changed for this notification only, and Push is a choice that, left
// empty, follows the category.
//
// In a notification, a button has a list of Actions in a fixed order (the
// order they run in): the Entity action (a switch, always there), Mute
// (added and deleted), the notification state (fixed on Done, Dismiss and
// Snooze, which shows its times there; one can be added to the Tap and the
// own buttons), any number
// of Home Assistant actions (Home Assistant's own rows, in their own order),
// and the Navigation last. Reset beside Actions brings back the default (a
// category's button).
//
// The Tap behavior is one block: Action (the same Actions list, with the
// Navigation always in it) or Button action (runs another button). Set in
// the category; a notification follows it, or has its own (Reset brings the
// category's back).

import { LitElement, css, html, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";

import type {
  Button,
  ButtonActions,
  ButtonNavigation,
  ButtonState,
  CategoryButton,
} from "../../shared/config";
import {
  DEFAULT_SNOOZE,
  SNOOZE_CHOICES,
  buttonRef,
  snoozeChoices,
  tapBehaviorOwn,
} from "../../shared/live";
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
  mute: { label: "Mute", icon: "mdi:volume-off" },
  custom: { label: "Button", icon: "mdi:gesture-tap-button" },
};

// The notification states, in the order of their choice.
const STATES: { value: ButtonState["type"]; label: string }[] = [
  { value: "done", label: "Done" },
  { value: "dismiss", label: "Dismiss" },
  { value: "snooze", label: "Snooze" },
];

// The icon and the line of a built-in button's own notification state.
const OWN_STATE_ICONS: Record<ButtonState["type"], string> = {
  done: "mdi:check",
  dismiss: "mdi:close",
  snooze: "mdi:alarm-snooze",
};
const OWN_STATE_TEXTS: Record<ButtonState["type"], string> = {
  done: "Closes the notification as done.",
  dismiss: "Closes the notification without marking it done.",
  snooze: "",
};

// A built-in button's own notification state.
const OWN_STATE: Partial<Record<Button["type"], ButtonState["type"]>> = {
  done: "done",
  dismiss: "dismiss",
  snooze: "snooze",
};

// The Tap's actions when none are set: more info of the card's entity.
const TAP_DEFAULT: ButtonActions = { navigation: { type: "more_info" } };

// The snooze time a newly added Snooze notification state starts with.
const DEFAULT_STATE_SNOOZE = "1h";

function haActionName(action: unknown): string | undefined {
  const item = action as { action?: string; service?: string } | undefined;
  return item?.action ?? item?.service;
}

/** A button a Tap can run, with its navigation (what the push opens). */
export interface RunChoice {
  value: string;
  label: string;
  navigation?: ButtonNavigation;
}

/** The buttons a Tap can run (Button action): the switched on ones. */
export function runChoicesOf(
  buttons: Pick<CategoryButton, "id" | "type" | "enabled" | "label" | "actions">[],
): RunChoice[] {
  return buttons
    .filter((button) => button.type !== "tap" && button.enabled)
    .map((button) => ({
      value: buttonRef(button),
      label: button.label || INTERACTION_DEFAULTS[button.type].label,
      ...(button.actions?.navigation ? { navigation: button.actions.navigation } : {}),
    }));
}

/** A Tap's Button action, in a few words (empty: its own actions). */
export function runText(
  tap: Pick<Button, "type" | "run_button">,
  buttons: Pick<CategoryButton, "id" | "type" | "enabled" | "label">[],
): string {
  const ref = tap.type === "tap" ? tap.run_button : undefined;
  if (!ref) return "";
  const target = buttons.find((button) => button.type !== "tap" && buttonRef(button) === ref);
  const label = target ? target.label || INTERACTION_DEFAULTS[target.type].label : ref;
  return `Button action: ${label}`;
}

/** The Android push shows only the first three buttons. */
export function pushButtonsWarning(
  buttons: Pick<CategoryButton, "type" | "enabled" | "show_in_push">[],
) {
  const count = buttons.filter(
    (button) => button.type !== "tap" && button.enabled && (button.show_in_push ?? true),
  ).length;
  return count > 3
    ? html`<ha-alert alert-type="warning"
        >Only the first three active buttons show in the Android push notification.</ha-alert
      >`
    : nothing;
}

/** What an interaction does, in a few words (the row's second line). */
export function actionsText(
  hass: HomeAssistant | undefined,
  actions: ButtonActions | undefined,
): string[] {
  const parts: string[] = [];
  if (!actions) return parts;
  if (actions.entity_action) parts.push("Entity action");
  if (actions.mute) parts.push("Mute");
  const state = actions.notification_state;
  if (state) {
    const label = STATES.find((item) => item.value === state.type)?.label ?? state.type;
    const time = state.type === "snooze"
      ? SNOOZE_CHOICES.find((choice) => choice.key === state.snooze)?.text
      : undefined;
    parts.push(time ? `${label} ${time}` : label);
  }
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

  // The Tap: the buttons it can run (Button action), by their key.
  @property({ attribute: false }) public runChoices: RunChoice[] = [];

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

  // Change the button's actions; a left out (undefined) action goes. On the
  // Tap it makes the Tap behavior Action, the notification's own.
  private _setActions(changes: Partial<ButtonActions>): void {
    const actions: ButtonActions = { ...this._actionsOf(this._button!), ...changes };
    for (const key of Object.keys(actions) as (keyof ButtonActions)[]) {
      if (actions[key] === undefined) delete actions[key];
    }
    const copy = { ...this._button!, actions };
    if (copy.type === "tap") delete copy.run_button;
    this._button = copy;
  }

  // The actions the button has now: its own, else what it inherits. The
  // Tap's always have a Navigation.
  private _actionsOf(button: Button): ButtonActions {
    if (button.type !== "tap") return button.actions ?? {};
    const own = this.mode === "category" || tapBehaviorOwn(button);
    const actions = (own ? button.actions : this.inherited?.actions) ?? TAP_DEFAULT;
    return actions.navigation ? actions : { ...actions, ...TAP_DEFAULT };
  }

  // The button the Tap runs (empty: its actions).
  private _runOf(button: Button): string {
    const own = this.mode === "category" || tapBehaviorOwn(button);
    return (own ? button.run_button : this.inherited?.run_button) || "";
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
        ${button.type === "tap"
          ? nothing
          : inherited
            ? this._renderPushChoice(button, inherited)
            : this._renderPush(button)}
        ${category && button.type === "snooze"
          ? html`<div class="divider"></div>
              ${this._renderSnooze(button)}`
          : nothing}
        ${button.type === "tap"
          ? html`${this._tapBehavior(button)} ${this._renderTapPush(button)}`
          : category
            ? nothing
            : this._renderActions(button)}
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

  // Changed from the category's (or the built-in) default.
  // A Snooze's own times count too: they are in its Actions.
  private _actionsChanged(button: Button): boolean {
    if (!this.inherited) return false;
    if (button.snooze?.length) return true;
    return button.actions !== undefined && Object.keys(button.actions).length > 0;
  }

  private _resetActions(): void {
    const copy = { ...this._button! } as Partial<Button>;
    delete copy.actions;
    delete copy.run_button;
    // A Snooze's times are the category's again.
    if (this.inherited && copy.type === "snooze") copy.snooze = null;
    this._button = copy as Button;
  }

  private _resetButton() {
    return html`<ha-button appearance="plain" size="s" @click=${() => this._resetActions()}>
      <ha-icon slot="start" icon="mdi:restore"></ha-icon>
      Reset
    </ha-button>`;
  }

  // The Tap behavior, one block: Action (its actions) or Button action
  // (another button's). In a notification, left out follows the category;
  // any change makes the whole block the notification's own.
  private _tapBehavior(button: Button) {
    const hass = this.hass!;
    const run = this._runOf(button);
    const step = this.mode === "step";
    const own = step && tapBehaviorOwn(button);
    const choices = this.runChoices;
    const setRun = (value: string) => {
      const copy = { ...this._button! };
      if (value) {
        copy.run_button = value;
        delete copy.actions;
      } else {
        copy.actions = this._actionsOf(copy);
        delete copy.run_button;
      }
      this._button = copy;
    };
    return html`<div class="divider"></div>
      <div class="section-head">
        <span class="title">Tap behavior</span>
        ${own ? this._resetButton() : nothing}
      </div>
      <div class="row">
        ${field(
          hass,
          {
            select: {
              mode: "dropdown",
              // Button action only with a switched on button to run.
              options: [
                { value: "action", label: "Action" },
                ...(choices.length || run ? [{ value: "button", label: "Button action" }] : []),
              ],
            },
          },
          run ? "button" : "action",
          step && !own ? "Type (category)" : "Type",
          (value) => {
            if (value === "button") {
              if (!run) setRun(choices[0]?.value ?? "");
            } else if (value === "action" && run) setRun("");
          },
        )}
        ${run
          ? field(
              hass,
              {
                select: {
                  mode: "dropdown",
                  options: choices.some((choice) => choice.value === run)
                    ? choices
                    : [...choices, { value: run, label: `${run} (not switched on)` }],
                },
              },
              run,
              "Button",
              (value) => {
                if (value) setRun(value as string);
              },
            )
          : nothing}
      </div>
      ${run && !choices.some((choice) => choice.value === run)
        ? html`<ha-alert alert-type="warning">
            The button it runs is switched off, so a tap does not run it. Switch it on, or choose
            another button or Action.
          </ha-alert>`
        : nothing}
      ${run ? nothing : this._actionList(button)}`;
  }

  // A button's Actions, with Reset beside them.
  private _renderActions(button: Button) {
    return html`<div class="divider"></div>
      <div class="section-head">
        <span class="title">Actions</span>
        ${this._actionsChanged(button) ? this._resetButton() : nothing}
      </div>
      ${this._actionList(button)}`;
  }

  // The Actions list, in its run order (Entity action, Mute, notification
  // state, Home Assistant actions, navigation), and the buttons that add to it.
  private _actionList(button: Button) {
    const actions = this._actionsOf(button);
    const own = OWN_STATE[button.type];
    // The built-in Mute button has Mute as its own fixed row, and no
    // notification state.
    const muteButton = button.type === "mute";
    const list = actions.ha_actions ?? [];
    const tap = button.type === "tap";
    // Home Assistant's own Add action button is used where ours cannot open
    // its dialog.
    const addAction = actionAddAvailable();
    return html`<div class="actions">
        ${this._switchRow(
          "mdi:format-list-checks",
          "Entity action",
          "Set the action for each entity in the Entities block.",
          !!actions.entity_action,
          (on) => this._setActions({ entity_action: on || undefined }),
        )}
        ${muteButton
          ? html`<ha-card outlined class="own-row">
              <ha-icon class="builtin" icon="mdi:volume-off"></ha-icon>
              <div class="own-text">
                <div>Mute</div>
                <div class="secondary">Stops the notification lights, speakers and sirens.</div>
              </div>
              <ha-switch .checked=${true} disabled .label=${"Mute"}></ha-switch>
            </ha-card>`
          : actions.mute
          ? html`<ha-card outlined class="own-row">
              <ha-icon class="builtin" icon="mdi:volume-off"></ha-icon>
              <div class="own-text">
                <div>Mute</div>
                <div class="secondary">Stops the notification lights, speakers and sirens.</div>
              </div>
              <ha-icon-button
                class="end"
                .label=${"Delete"}
                @click=${() => this._setActions({ mute: undefined })}
              >
                <ha-icon icon="mdi:delete"></ha-icon>
              </ha-icon-button>
            </ha-card>`
          : nothing}
        ${own || actions.notification_state ? this._stateCard(button, actions) : nothing}
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
        ${actions.navigation
          ? this._navigationCard(actions.navigation, !tap)
          : nothing}
      </div>
      <div class="add">
        ${own || muteButton || actions.notification_state
          ? nothing
          : this._addButton("Add notification state", () =>
              this._setActions({ notification_state: { type: "done" } }),
            )}
        ${actions.mute || muteButton
          ? nothing
          : this._addButton("Add mute", () => this._setActions({ mute: true }))}
        ${addAction ? this._addButton("Add action", () => this._addHaAction()) : nothing}
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

  // A built-in row with a switch at its end, as the step editor's
  // Conditions and Done rows.
  private _switchRow(
    icon: string,
    title: string,
    text: string,
    on: boolean,
    changed: (on: boolean) => void,
  ) {
    return html`<ha-card outlined class="own-row">
      <ha-icon class="builtin" .icon=${icon}></ha-icon>
      <div class="own-text">
        <div>${title}</div>
        <div class="secondary">${text}</div>
      </div>
      <ha-switch
        .checked=${on}
        .label=${title}
        @change=${(ev: Event) => changed((ev.target as HTMLInputElement).checked)}
      ></ha-switch>
    </ha-card>`;
  }

  // A built-in card that is always open; one that can go has a delete
  // button in its title row.
  private _fixedCard(icon: string, title: string, content: unknown, remove?: () => void) {
    return html`<ha-card outlined class="fixed-card">
      <div class="fixed-head">
        <ha-icon class="builtin" .icon=${icon}></ha-icon>
        <div class="fixed-title">${title}</div>
        ${remove
          ? html`<ha-icon-button .label=${"Delete"} @click=${remove}>
              <ha-icon icon="mdi:delete"></ha-icon>
            </ha-icon-button>`
          : nothing}
      </div>
      <div class="fixed-content">${content}</div>
    </ha-card>`;
  }

  // A built-in button's own state cannot be removed or changed (Snooze
  // chooses its times here); an added one is one of Done, Dismiss and
  // Snooze, with how long a Snooze lasts.
  private _stateCard(button: Button, actions: ButtonActions) {
    const own = OWN_STATE[button.type];
    const hass = this.hass!;
    if (own) {
      // Titled by its type, with a switch that is always on, as the Entity
      // action row; Snooze has its times under the title.
      const state = STATES.find((item) => item.value === own)!;
      return html`<ha-card outlined class="own-row ${own === "snooze" ? "tall" : ""}">
        <ha-icon class="builtin" .icon=${OWN_STATE_ICONS[own]}></ha-icon>
        <div class="own-text">
          <div>${state.label}</div>
          ${own === "snooze"
            ? html`<div class="own-content">${this._renderSnooze(button)}</div>`
            : html`<div class="secondary">${OWN_STATE_TEXTS[own]}</div>`}
        </div>
        <ha-switch .checked=${true} disabled .label=${state.label}></ha-switch>
      </ha-card>`;
    }
    const state = actions.notification_state ?? { type: "done" };
    return this._fixedCard(
      "mdi:list-status",
      "Notification state",
      html`<div class="row">
        ${field(
          hass,
          {
            select: {
              mode: "dropdown",
              options: STATES.map(({ value, label }) => ({ value, label })),
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

  // Always last: Navigate or More info, where the button was pressed. The
  // Tap's is always there.
  private _navigationCard(navigation: ButtonNavigation, removable: boolean) {
    const hass = this.hass!;
    const type = navigation.type;
    return this._fixedCard(
      "mdi:open-in-app",
      "Navigation",
      html`<div class="row">
        ${field(
          hass,
          {
            select: {
              mode: "dropdown",
              options: [
                { value: "navigate", label: "Navigate" },
                { value: "more_info", label: "More info" },
              ],
            },
          },
          type,
          "Type",
          (value) => {
            if (!value || value === type) return;
            this._setActions({
              navigation:
                value === "navigate"
                  ? { type: "navigate", path: "" }
                  : { type: "more_info", entity_id: null },
            });
          },
        )}
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
            )}
      </div>`,
      removable ? () => this._setActions({ navigation: undefined }) : undefined,
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

  // Tap: the push part, at the bottom. A tap on the push always opens the
  // app and does the same; with a Navigate (its own, or the run button's)
  // the push opens that page, else the Open on tap page.
  private _renderTapPush(button: Button) {
    const navigation = this._tapNavigation(button);
    return html`<div class="divider"></div>
      <div class="section-head"><span class="title">Push notification</span></div>
      <div class="secondary">Tapping the push notification opens the app and does the same.</div>
      ${navigation?.type === "navigate"
        ? html`<div class="secondary">
            The push opens ${navigation.path || "the Navigate page"}
            (${this._tapNavigationSource(button)}).
          </div>`
        : this._renderOpenOnTap(button, navigation?.type === "more_info")}`;
  }

  // The navigation a Tap does: its own actions', or the run button's.
  private _tapNavigation(button: Button): ButtonNavigation | undefined {
    const run = this._runOf(button);
    if (run) return this.runChoices.find((choice) => choice.value === run)?.navigation;
    return this._actionsOf(button).navigation;
  }

  // Where the Tap's Navigate comes from: "Navigate of Done", "Navigate".
  private _tapNavigationSource(button: Button): string {
    const run = this._runOf(button);
    const label = run ? this.runChoices.find((choice) => choice.value === run)?.label : undefined;
    return label ? `Navigate of ${label}` : "Navigate";
  }

  private _renderPush(button: Button) {
    const on = button.show_in_push ?? true;
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
      </label>`;
  }

  // Tap: the page the app opens when the push is tapped (More info opens
  // on top of it).
  private _renderOpenOnTap(button: Button, moreInfo: boolean) {
    const base = this.inherited?.open_on_tap;
    const top = moreInfo ? " More info opens on top of it." : "";
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
          ? `The page the push opens. Empty: ${base} (category).${top}`
          : `The page the push opens. Empty: the default under General, Push.${top}`,
      },
    );
  }

  // A category's button in a notification: Push follows the category unless
  // chosen here.
  private _renderPushChoice(button: Button, inherited: CategoryButton) {
    const own = button.show_in_push;
    const base = inherited.show_in_push ?? true;
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
    ha-icon.builtin {
      flex: none;
      color: var(--amber-color, #ffc107);
    }
    /* As the step editor's built-in Conditions and Done rows. */
    .own-row {
      display: flex;
      align-items: center;
      gap: 16px;
      padding: 12px 16px;
    }
    .own-text {
      flex: 1;
      min-width: 0;
    }
    .own-row.tall {
      align-items: flex-start;
    }
    .own-content {
      margin-top: 12px;
    }
    /* A delete button at the end, as the switch of the other rows. */
    .own-row ha-icon-button.end {
      margin: -8px -8px -8px 0;
      color: var(--secondary-text-color);
    }
    .own-text .secondary,
    .fixed-content .secondary {
      color: var(--secondary-text-color);
      font-size: var(--ha-font-size-s, 12px);
    }
    .fixed-head {
      display: flex;
      align-items: center;
      gap: 16px;
      min-height: 48px;
      padding: 0 8px 0 16px;
    }
    .fixed-title {
      flex: 1;
      font-weight: var(--ha-font-weight-medium, 500);
    }
    .fixed-head ha-icon-button {
      color: var(--secondary-text-color);
    }
    .fixed-content {
      padding: 0 16px 16px;
    }
    .section-head {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
      min-height: 32px;
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
