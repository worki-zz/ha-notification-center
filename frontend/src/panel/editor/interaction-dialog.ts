// The dialog of an interaction (a button of the card, or the tap on it), in
// two tabs.
//
// Settings: how and where it shows. Enabled, Show in push, the Navigation
// (where it takes the user, on the device it was pressed on; the Tap's is
// also what a tap on the push opens), the Snooze button's Snooze options
// in the Dashboard, then the Label and Icon.
//
// Actions: what it does. One card with the notification state it sets
// (fixed on the built-in Done, Dismiss, Snooze and Mute buttons), Snooze
// for, and in a notification the Run … actions switch (the actions of the
// step's status block of that state). A custom button and the Tap also
// have their own actions: the Entity action and the Home Assistant actions.
// The Tap can instead run another button (Same as …).
//
// In a category it sets what the notifications inherit, key by key. In a
// notification, a category's button follows the category: a field on
// Default shows the category's value; the restore button beside a field
// brings back that one, the one in the header the whole button.

import { LitElement, css, html, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";

import type {
  Button,
  ButtonActions,
  ButtonNavigation,
  ButtonState,
  CategoryButton,
  EffectiveButton,
} from "../../shared/config";
import {
  DEFAULT_SNOOZE,
  DEFAULT_SNOOZE_FOR,
  SNOOZE_CHOICES,
  buttonRef,
  buttonState,
  categoryButtons,
  mergeButton,
} from "../../shared/live";
import type { HomeAssistant } from "../../shared/types";
import { field, inheritField, loadPageName, pageName, restoreButton } from "../fields";

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
  { value: "unchanged", label: "Unchanged" },
  { value: "done", label: "Done" },
  { value: "dismiss", label: "Dismiss" },
  { value: "snooze", label: "Snooze" },
  { value: "mute", label: "Mute" },
];

/** The status block of each state a button sets. */
export const STATE_BLOCKS: Record<
  Exclude<ButtonState["type"], "unchanged">,
  { key: "done_when" | "dismiss_when" | "snooze_when" | "mute_when"; name: string; run: string }
> = {
  done: { key: "done_when", name: "Done when", run: "Run Done actions" },
  dismiss: { key: "dismiss_when", name: "Dismiss when", run: "Run Dismiss actions" },
  snooze: { key: "snooze_when", name: "Snooze when", run: "Run Snooze actions" },
  mute: { key: "mute_when", name: "Mute when", run: "Run Mute actions" },
};

/** A status block of the step, as the Run … actions switch tells of it. */
export interface BlockInfo {
  // Snooze when and Mute when can be switched off.
  enabled: boolean;
  // Its actions: the entity action and the Home Assistant actions.
  actions: number;
}

/** The result of the dialog: the button, and a status block to switch on. */
export interface InteractionResult {
  result?: Button | "delete";
  enableBlock?: "snooze_when" | "mute_when";
  // Open this status block's Actions after saving.
  goTo?: "done_when" | "dismiss_when" | "snooze_when" | "mute_when";
}

// The icon and the line of a built-in button's own notification state.
const OWN_STATE_ICONS: Partial<Record<ButtonState["type"], string>> = {
  done: "mdi:check",
  dismiss: "mdi:close",
  snooze: "mdi:alarm-snooze",
  mute: "mdi:volume-off",
};
const OWN_STATE_TEXTS: Partial<Record<ButtonState["type"], string>> = {
  done: "Closes the notification as done.",
  dismiss: "Closes the notification without marking it done.",
  snooze: "Hides the notification for a while.",
  mute: "Stops the notification lights, speakers and sirens.",
};

// The sentinel of a Tap that runs its own actions (an empty run_button).
const OWN_ACTIONS = "__own__";

function haActionName(action: unknown): string | undefined {
  const item = action as { action?: string; service?: string } | undefined;
  return item?.action ?? item?.service;
}

function stateLabel(type: ButtonState["type"]): string {
  return STATES.find((item) => item.value === type)?.label ?? type;
}

function snoozeLabel(key: string | null | undefined): string {
  return SNOOZE_CHOICES.find((choice) => choice.key === key)?.label ?? key ?? "";
}

/** A button a Tap can run, with its navigation (what the push opens). */
export interface RunChoice {
  value: string;
  label: string;
  navigation?: ButtonNavigation;
}

/** The buttons a Tap can run (Same as …): the switched on ones. */
export function runChoicesOf(
  buttons: Pick<CategoryButton, "id" | "type" | "enabled" | "label" | "navigation">[],
): RunChoice[] {
  return buttons
    .filter((button) => button.type !== "tap" && button.enabled)
    .map((button) => ({
      value: buttonRef(button),
      label: button.label || INTERACTION_DEFAULTS[button.type].label,
      ...(button.navigation && button.navigation.type !== "none"
        ? { navigation: button.navigation }
        : {}),
    }));
}

/** A Tap's Same as …, in a few words (empty: its own actions). */
export function runText(
  tap: Pick<Button, "type" | "run_button">,
  buttons: Pick<CategoryButton, "id" | "type" | "enabled" | "label">[],
): string {
  const ref = tap.type === "tap" ? tap.run_button : undefined;
  if (!ref) return "";
  const target = buttons.find((button) => button.type !== "tap" && buttonRef(button) === ref);
  const label = target ? target.label || INTERACTION_DEFAULTS[target.type].label : ref;
  return `Same as ${label}`;
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

/**
 * What a button does, in a few words (the row's second line): the state a
 * custom button or the Tap sets, its own actions and its navigation.
 */
export function buttonText(hass: HomeAssistant | undefined, button: EffectiveButton): string[] {
  const parts: string[] = [];
  const actions = button.actions;
  if (button.type === "custom" || button.type === "tap") {
    const type = buttonState(button);
    if (type === "snooze") parts.push(`Snooze ${snoozeLabel(button.snooze_for).toLowerCase()}`);
    else if (type !== "unchanged") parts.push(stateLabel(type));
  }
  if (actions.entity_action) parts.push("Entity action");
  const list = actions.ha_actions ?? [];
  if (list.length) {
    const name = haActionName(list[0]);
    const more = list.length > 1 ? ` +${list.length - 1}` : "";
    parts.push(name ? `Action: ${name}${more}` : `Action${more}`);
  }
  parts.push(...navigationText(hass, button.navigation));
  return parts;
}

function navigationText(
  hass: HomeAssistant | undefined,
  navigation: ButtonNavigation | null | undefined,
): string[] {
  if (navigation?.type === "more_info") {
    const entityId = navigation.entity_id;
    const name = entityId ? hass?.states[entityId]?.attributes.friendly_name : undefined;
    return [entityId ? `More info: ${typeof name === "string" ? name : entityId}` : "More info"];
  }
  if (navigation?.type === "navigate") {
    return [navigation.path ? `Navigate: ${navigation.path}` : "Navigate"];
  }
  if (navigation?.type === "notification_info") return ["Notification info"];
  return [];
}

@customElement("nc-interaction-dialog")
export class NcInteractionDialog extends LitElement {
  @property({ attribute: false }) public hass?: HomeAssistant;

  @property({ attribute: false }) public button?: Button;

  @property({ type: Boolean }) public narrow = false;

  @property({ type: Boolean }) public isNew = false;

  // "category": a category's button (what its notifications inherit).
  @property() public mode: "step" | "category" = "step";

  // In a notification: the category's button this one inherits from.
  @property({ attribute: false }) public inherited?: CategoryButton;

  // Some entity (or entity group) has an action for this button.
  @property({ type: Boolean, attribute: false }) public entityActionSet = false;

  // The Tap: the buttons it can run (Same as …), by their key.
  @property({ attribute: false }) public runChoices: RunChoice[] = [];

  // In a notification: the step's status blocks, by the state they are of.
  @property({ attribute: false }) public blocks?: Partial<
    Record<Exclude<ButtonState["type"], "unchanged">, BlockInfo>
  >;

  // The page a tap on the push opens when the Tap does not navigate (set
  // under General, Push; empty: the Overview).
  @property({ attribute: false }) public generalOpenOnTap?: string | null;

  @state() private _button?: Button;

  @state() private _open = true;

  @state() private _tab: "settings" | "actions" = "settings";

  // The Run … actions switch was switched on while its block was off.
  @state() private _enableBlock?: "snooze_when" | "mute_when";

  private _result?: Button | "delete";

  private _goTo?: InteractionResult["goTo"];

  protected override willUpdate(): void {
    if (!this._button && this.button) this._button = structuredClone(this.button);
  }

  private _set(changes: Partial<Button>): void {
    const copy = { ...this._button!, ...changes } as Record<string, unknown>;
    for (const [key, value] of Object.entries(changes)) {
      if (value === undefined) delete copy[key];
    }
    this._button = copy as unknown as Button;
  }

  // Change one key of the button's own actions; undefined follows the
  // category again (in a category, or on a button of its own: off).
  private _setAction<K extends keyof ButtonActions>(key: K, value: ButtonActions[K] | undefined) {
    const actions: ButtonActions = { ...(this._button!.actions ?? {}) };
    if (value === undefined) delete actions[key];
    else actions[key] = value;
    this._set({ actions: Object.keys(actions).length ? actions : undefined });
  }

  // Whether a key follows something: in a notification the category's
  // button. In a category, or on a notification's own button, a key left
  // out is simply off.
  private get _inherits(): boolean {
    return this.mode === "step" && !!this.inherited;
  }

  // The button as it works now.
  private _effective(button: Button): EffectiveButton {
    if (this.mode === "category") {
      return mergeButton({ ...(button as CategoryButton), enabled: button.enabled ?? true }, {}, true);
    }
    const base: CategoryButton = this.inherited ?? {
      id: button.id,
      type: button.type,
      enabled: true,
      show_in_push: true,
    };
    return mergeButton(base, button, !!this.inherited);
  }

  // What the button follows: in a notification the category's button, in
  // a category a built-in button's defaults. Nothing for an own button.
  private get _base(): CategoryButton | undefined {
    if (this.mode === "step") return this.inherited;
    const type = this._button?.type;
    if (!type || type === "custom") return undefined;
    return categoryButtons(undefined).find((item) => item.type === type);
  }

  // Whether the header's restore button would bring anything back.
  private _hasOwn(button: Button): boolean {
    const base = this._base;
    if (!base) return false;
    if (this.mode === "step") {
      return Object.keys(button).some(
        (key) => key !== "id" && key !== "type" && (button as unknown as Record<string, unknown>)[key] !== undefined,
      );
    }
    if (button.enabled !== undefined && button.enabled !== base.enabled) return true;
    if (button.label || button.icon || button.snooze_for || button.navigation) return true;
    if (button.run_button !== undefined && button.run_button !== null) return true;
    if (button.actions && Object.keys(button.actions).length) return true;
    if (button.type === "snooze" && button.snooze?.length) {
      if (button.snooze.join() !== DEFAULT_SNOOZE.join()) return true;
    }
    return button.show_in_push === false;
  }

  // The header's restore button: the whole button as its base again.
  private _resetAll(): void {
    const button = this._button!;
    this._enableBlock = undefined;
    this._button = (
      this.mode === "step"
        ? { id: button.id, type: button.type }
        : { id: button.id, type: button.type, enabled: this._base?.enabled ?? true }
    ) as Button;
  }

  protected override render() {
    const button = this._button;
    const hass = this.hass;
    if (!button || !hass) return nothing;
    const defaults = INTERACTION_DEFAULTS[button.type];
    const category = this.mode === "category";
    const inherited = this.inherited;
    const title =
      button.type === "tap" ? defaults.label : button.label || inherited?.label || defaults.label;
    return html`<ha-dialog
      .open=${this._open}
      width="medium"
      header-title=${this.isNew ? "Add button" : title}
      @closed=${this._closed}
    >
      ${this._hasOwn(button)
        ? restoreButton(
            category ? "Restore the defaults" : "Restore the category's settings",
            () => this._resetAll(),
            "",
            "headerActionItems",
          )
        : nothing}
      ${button.type === "custom" && !this.isNew && !inherited
        ? html`<ha-icon-button
            slot="headerActionItems"
            .label=${"Delete"}
            @click=${() => this._close("delete")}
          >
            <ha-icon icon="mdi:delete"></ha-icon>
          </ha-icon-button>`
        : nothing}
      <ha-tab-group
        @wa-tab-show=${(ev: CustomEvent<{ name: string }>) => {
          ev.stopPropagation();
          this._tab = ev.detail.name === "actions" ? "actions" : "settings";
        }}
      >
        <ha-tab-group-tab slot="nav" panel="settings" .active=${this._tab === "settings"}>
          Settings
        </ha-tab-group-tab>
        <ha-tab-group-tab slot="nav" panel="actions" .active=${this._tab === "actions"}>
          Actions
        </ha-tab-group-tab>
      </ha-tab-group>
      <div class="form">
        ${this._tab === "settings" ? this._renderSettings(button) : this._renderActions(button)}
      </div>
      <ha-dialog-footer slot="footer">
        <ha-button slot="secondaryAction" appearance="plain" @click=${() => this._close()}>
          Cancel
        </ha-button>
        <ha-button
          slot="primaryAction"
          .disabled=${button.type === "custom" && !this.inherited && !button.label?.trim()}
          @click=${() => this._close(this._button)}
        >
          ${this.isNew ? "Add" : "Save"}
        </ha-button>
      </ha-dialog-footer>
    </ha-dialog>`;
  }

  // -- Settings -----------------------------------------------------------------

  private _renderSettings(button: Button) {
    const tap = button.type === "tap";
    return html`<ha-card outlined class="settings">
        ${this.isNew ? nothing : this._enabledRow(button)}
        ${tap ? nothing : this._pushRow(button)} ${this._navigationRow(button)}
      </ha-card>
      ${button.type === "snooze" ? this._snoozeOptions(button) : nothing}
      ${tap
        ? nothing
        : html`<div class="divider"></div>
            <div class="row">${this._labelField(button)} ${this._iconField(button)}</div>`}`;
  }

  // A row of a settings card: its title (and a line under it) at the
  // start, its control at the end.
  private _row(title: string, secondary: unknown, control: unknown, below?: unknown) {
    return html`<div class="setting">
      <div class="setting-head">
        <div class="setting-text">
          <div>${title}</div>
          ${secondary ? html`<div class="secondary">${secondary}</div>` : nothing}
        </div>
        ${control}
      </div>
      ${below ? html`<div class="setting-below">${below}</div>` : nothing}
    </div>`;
  }

  private _switch(label: string, on: boolean, changed: (on: boolean) => void, disabled = false) {
    return html`<ha-switch
      .checked=${on}
      .disabled=${disabled}
      .label=${label}
      @change=${(ev: Event) => changed((ev.target as HTMLInputElement).checked)}
    ></ha-switch>`;
  }

  // In a notification a value set here is its own, also when it equals the
  // category's; the header's restore button brings the category's back.
  private _enabledRow(button: Button) {
    const base = this.mode === "step" ? this.inherited : undefined;
    const on = button.enabled ?? base?.enabled ?? true;
    return this._row(
      "Enabled",
      "",
      this._switch("Enabled", on, (checked) => this._set({ enabled: checked })),
    );
  }

  private _pushRow(button: Button) {
    const inherited = this._inherits ? this.inherited : undefined;
    if (inherited) {
      const own = button.show_in_push;
      const base = inherited.show_in_push ?? true;
      return this._row(
        "Show in push",
        "",
        html`<div class="control">
          ${inheritField(
            this.hass,
            [
              { value: "on", label: "On" },
              { value: "off", label: "Off" },
            ],
            own === undefined || own === null ? undefined : own ? "on" : "off",
            base ? "On" : "Off",
            "Push",
            (value) => this._set({ show_in_push: value === undefined ? undefined : value === "on" }),
          )}
        </div>`,
      );
    }
    return this._row(
      "Show in push",
      "",
      this._switch("Show in push", button.show_in_push ?? true, (on) =>
        this._set({ show_in_push: on }),
      ),
    );
  }

  // On or off; on, where to: More info, Navigate or Notification info. In a
  // notification it follows the category until set here.
  private _navigationRow(button: Button) {
    const hass = this.hass!;
    const effective = this._effective(button);
    const navigation = effective.navigation;
    const inherits = this._inherits;
    const own = button.navigation !== undefined && button.navigation !== null;
    const baseNavigation = inherits ? this.inherited?.navigation : undefined;
    const baseOn = !!baseNavigation && baseNavigation.type !== "none";
    const tap = button.type === "tap";
    const about = tap
      ? "Opens on a tap, on the device where it was tapped, and when the push notification is tapped"
      : "Opens after the button, on the device where it was pressed";
    const secondary =
      inherits && !own
        ? `Default (${navigationText(hass, baseNavigation?.type === "none" ? null : baseNavigation)[0] ?? "Off"})`
        : about;
    const setOn = (on: boolean) => {
      if (on) this._set({ navigation: baseOn ? { ...baseNavigation! } : { type: "more_info" } });
      else this._set({ navigation: baseOn ? { type: "none" } : undefined });
    };
    const setNavigation = (value: ButtonNavigation) => this._set({ navigation: value });
    const control = html`<div class="end">
      ${inherits && own
        ? restoreButton("Restore the category's navigation", () => this._set({ navigation: undefined }))
        : nothing}
      ${this._switch("Navigation", !!navigation, setOn)}
    </div>`;
    const below = navigation
      ? html`${field(
            hass,
            {
              select: {
                mode: "dropdown",
                options: [
                  { value: "more_info", label: "More info" },
                  { value: "navigate", label: "Navigate" },
                  { value: "notification_info", label: "Notification info" },
                ],
              },
            },
            navigation.type,
            "Open",
            (value) => {
              if (!value || value === navigation.type) return;
              setNavigation(
                value === "navigate"
                  ? { type: "navigate", path: "" }
                  : value === "notification_info"
                    ? { type: "notification_info" }
                    : { type: "more_info", entity_id: null },
              );
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
                  setNavigation({ type: "more_info", entity_id: ev.detail.value || null });
                }}
              ></ha-entity-picker>`
            : navigation.type === "navigate"
              ? field(hass, { navigation: {} }, navigation.path, "Page", (value) =>
                  setNavigation({ type: "navigate", path: (value as string) ?? "" }),
                )
              : html`<div class="secondary">
                  Opens the notification's Status dialog on the Overview.
                </div>`}`
      : tap
        ? html`<div class="secondary">${this._pushPageText()}</div>`
        : nothing;
    return this._row("Navigation", secondary, control, below);
  }

  // Off, a tap on the push opens the page set under General, Push.
  private _pushPageText(): string {
    const path = this.generalOpenOnTap;
    // A dashboard view is named by its title once it is read.
    void loadPageName(this.hass, path).then((found) => {
      if (found) this.requestUpdate();
    });
    const page = path ? pageName(this.hass, path) : "the Overview";
    return `Off, a tap on the push notification opens ${page}.`;
  }

  // The built-in Snooze button: the times the dashboard offers besides
  // Snooze for, only the ticked ones. With none ticked the button snoozes
  // at once for its Snooze for, which a short line shows (it opens the
  // Actions tab, where Snooze for is set).
  private _snoozeOptions(button: Button) {
    const base =
      (this._inherits ? this.inherited?.snooze : undefined) ?? DEFAULT_SNOOZE;
    const chosen = new Set(button.snooze ?? base);
    const toggle = (key: string, on: boolean) => {
      if (on) chosen.add(key);
      else chosen.delete(key);
      const snooze = SNOOZE_CHOICES.map((choice) => choice.key).filter((key) => chosen.has(key));
      // In a category, the default times again are no own times; in a
      // notification, times ticked here are its own, also when they equal
      // the category's (the restore button brings the category's back).
      const same = this.mode === "category" && snooze.join() === DEFAULT_SNOOZE.join();
      this._set({ snooze: same ? undefined : snooze });
    };
    const own =
      !!button.snooze &&
      (this.mode === "step" ? this._inherits : button.snooze.join() !== DEFAULT_SNOOZE.join());
    return html`<ha-card outlined class="snooze">
      <div class="section-head">
        <span class="title">Snooze options in the Dashboard</span>
        ${own
          ? restoreButton("Restore the snooze options", () => this._set({ snooze: undefined }))
          : nothing}
      </div>
      <div class="times">
        ${SNOOZE_CHOICES.map(
          (choice) =>
            html`<label class="time">
              <ha-checkbox
                .checked=${chosen.has(choice.key)}
                @change=${(ev: Event) =>
                  toggle(choice.key, (ev.target as HTMLInputElement).checked)}
              ></ha-checkbox>
              <span>${choice.label}</span>
            </label>`,
        )}
      </div>
      ${chosen.size ? nothing : this._snoozeForLine(button)}
    </ha-card>`;
  }

  // Snooze for as its dropdown shows it ("Default (1 hour)"); a click opens
  // the Actions tab, where it is set.
  private _snoozeForLine(button: Button) {
    const base = (this._inherits ? this.inherited?.snooze_for : undefined) || DEFAULT_SNOOZE_FOR;
    const text = button.snooze_for ? snoozeLabel(button.snooze_for) : `Default (${snoozeLabel(base)})`;
    return html`<div>
      <ha-button appearance="plain" size="s" @click=${() => (this._tab = "actions")}>
        ${text}
      </ha-button>
    </div>`;
  }

  // Required for a custom button defined here (in the category, or a
  // notification's own); else empty means the default or the category's,
  // which the placeholder shows.
  private _labelField(button: Button) {
    const own = button.type === "custom" && !this.inherited;
    const fallback = this.inherited?.label || INTERACTION_DEFAULTS[button.type].label;
    return field(
      this.hass,
      { text: {} },
      button.label ?? "",
      "Label",
      (value) => this._set({ label: (value as string)?.trim() ? (value as string) : null }),
      own ? { required: true } : { placeholder: fallback },
    );
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

  // -- Actions ------------------------------------------------------------------

  private _renderActions(button: Button) {
    const tap = button.type === "tap";
    const run = tap ? this._effective(button).run_button : null;
    const own = button.type === "custom" || tap;
    return html`${tap ? this._tapRuns(button) : nothing}
      ${run
        ? nothing
        : html`${this._stateCard(button)} ${own ? this._ownActions(button) : nothing}`}`;
  }

  // The Tap: its own actions, or the same as a switched on button.
  private _tapRuns(button: Button) {
    const choices = this.runChoices;
    const own = button.run_button;
    const value = own === undefined || own === null ? undefined : own || OWN_ACTIONS;
    const base = this._inherits ? this.inherited?.run_button : undefined;
    const label = (ref: string | null | undefined) =>
      ref
        ? `Same as ${choices.find((choice) => choice.value === ref)?.label ?? `${ref} (not switched on)`}`
        : "Its own actions";
    const options = [
      { value: OWN_ACTIONS, label: "Its own actions" },
      ...choices.map((choice) => ({ value: choice.value, label: `Same as ${choice.label}` })),
    ];
    const current = this._effective(button).run_button;
    if (current && !choices.some((choice) => choice.value === current)) {
      options.push({ value: current, label: label(current) });
    }
    const set = (next: string | undefined) =>
      this._set({ run_button: next === undefined ? undefined : next === OWN_ACTIONS ? "" : next });
    return html`${this._inherits
        ? inheritField(this.hass, options, value, label(base), "Tap runs", set)
        : field(
            this.hass,
            { select: { mode: "dropdown", options } },
            current || OWN_ACTIONS,
            "Tap runs",
            (next) => set(next === OWN_ACTIONS ? undefined : String(next)),
          )}
      ${current && !choices.some((choice) => choice.value === current)
        ? html`<ha-alert alert-type="warning">
            The button it runs is switched off, so a tap does not run it. Switch it on, or choose
            another button or its own actions.
          </ha-alert>`
        : nothing}`;
  }

  // The notification state, Snooze for and Run … actions, in one card.
  private _stateCard(button: Button) {
    const hass = this.hass!;
    const effective = this._effective(button);
    const type = buttonState(effective);
    const builtin = button.type !== "custom" && button.type !== "tap";
    const ownState = button.actions?.notification_state?.type;
    const stateControl = this._inherits
        ? html`<div class="control">
            ${inheritField(
              hass,
              STATES.map(({ value, label }) => ({ value, label })),
              ownState,
              stateLabel(buttonState({ type: "custom", actions: this.inherited?.actions })),
              "State",
              (value) =>
                this._setAction(
                  "notification_state",
                  value ? { type: value as ButtonState["type"] } : undefined,
                ),
            )}
          </div>`
        : html`<div class="control">
            ${field(
              hass,
              { select: { mode: "dropdown", options: STATES } },
              type,
              "State",
              (value) =>
                this._setAction(
                  "notification_state",
                  !value || value === "unchanged" ? undefined : { type: value as ButtonState["type"] },
                ),
            )}
          </div>`;
    // A built-in button's own state, as before: titled by its type, with a
    // switch that is always on.
    const rows = [
      builtin
        ? html`<div class="setting">
            <div class="setting-head">
              <ha-icon class="builtin" .icon=${OWN_STATE_ICONS[type]}></ha-icon>
              <div class="setting-text">
                <div>${stateLabel(type)}</div>
                <div class="secondary">${OWN_STATE_TEXTS[type]}</div>
              </div>
              <ha-switch .checked=${true} disabled .label=${stateLabel(type)}></ha-switch>
            </div>
          </div>`
        : this._row("Notification state", "", stateControl),
    ];
    if (type === "snooze") rows.push(this._snoozeForRow(button));
    if (this.mode === "step" && type !== "unchanged") rows.push(this._runRow(button, type));
    return html`<ha-card outlined class="settings">${rows}</ha-card>`;
  }

  private _snoozeForRow(button: Button) {
    const base = (this._inherits ? this.inherited?.snooze_for : undefined) || DEFAULT_SNOOZE_FOR;
    return this._row(
      "Snooze for",
      "",
      html`<div class="control">
        ${inheritField(
          this.hass,
          SNOOZE_CHOICES.map((choice) => ({ value: choice.key, label: choice.label })),
          button.snooze_for || undefined,
          snoozeLabel(base),
          "Snooze for",
          (value) => this._set({ snooze_for: value }),
        )}
      </div>`,
    );
  }

  // Run the actions of the step's status block of the state. Snooze when
  // and Mute when can be off: then it shows off, and switching it on
  // switches the block on too.
  private _runRow(button: Button, type: Exclude<ButtonState["type"], "unchanged">) {
    const block = STATE_BLOCKS[type];
    const info = this.blocks?.[type];
    const optional = block.key === "snooze_when" || block.key === "mute_when";
    const blockOff = optional && !info?.enabled && this._enableBlock !== block.key;
    const on = !blockOff && button.run_state_actions !== false;
    return this._row(
      block.run,
      `Set in ${block.name}`,
      this._switch(block.run, on, (checked) => {
        if (checked && blockOff) this._enableBlock = block.key as "snooze_when" | "mute_when";
        else if (!checked && this._enableBlock === block.key) this._enableBlock = undefined;
        this._set({ run_state_actions: checked ? undefined : false });
      }),
      // As the Snooze for line of the Settings tab: it saves the button and
      // opens the block's Actions.
      on
        ? html`<div>
            <ha-button appearance="plain" size="s" @click=${() => this._close(this._button, block.key)}>
              Open ${block.name}
            </ha-button>
          </div>`
        : undefined,
    );
  }

  // A custom button's or the Tap's own actions: the Entity action and the
  // Home Assistant actions, each following the category until set here.
  private _ownActions(button: Button) {
    const effective = this._effective(button);
    const actions = effective.actions;
    const own = button.actions ?? {};
    const inherits = this._inherits;
    const title = button.type === "tap" ? "Tap actions" : "Button actions";
    const list = actions.ha_actions ?? [];
    return html`<div class="section-head">
        <span class="title">${title}</span>
        ${inherits && own.ha_actions !== undefined
          ? restoreButton("Restore the category's actions", () =>
              this._setAction("ha_actions", undefined),
            )
          : nothing}
      </div>
      <ha-card outlined class="settings">
        ${this._row(
          "Entity action",
          this.mode === "category"
            ? "Each notification sets the action of its entities in its Entities block."
            : this.entityActionSet
              ? "Set for the entities in the Entities block."
              : "Set the action for each entity in the Entities block.",
          html`<div class="end">
            ${inherits && own.entity_action !== undefined
              ? restoreButton("Restore the category's entity action", () =>
                  this._setAction("entity_action", undefined),
                )
              : nothing}
            ${this._switch("Entity action", !!actions.entity_action, (on) =>
              this._setAction("entity_action", on || inherits ? on : undefined),
            )}
          </div>`,
        )}
      </ha-card>
      <ha-automation-action
        .hass=${this.hass}
        .narrow=${this.narrow}
        .actions=${list}
        @value-changed=${(ev: CustomEvent<{ value: unknown[] }>) => {
          ev.stopPropagation();
          const value = ev.detail.value;
          this._setAction("ha_actions", value.length || inherits ? value : undefined);
        }}
      ></ha-automation-action>`;
  }

  private _close(result?: Button | "delete", goTo?: InteractionResult["goTo"]): void {
    this._result = result;
    this._goTo = goTo;
    this._open = false;
  }

  private _closed(ev: Event): void {
    if (ev.target !== ev.currentTarget) return;
    ev.stopPropagation();
    const detail: InteractionResult = { result: this._result };
    if (this._result && this._result !== "delete" && this._goTo) detail.goTo = this._goTo;
    if (this._result && this._result !== "delete" && this._enableBlock) {
      detail.enableBlock = this._enableBlock;
    }
    this.dispatchEvent(new CustomEvent("interaction-closed", { detail }));
  }

  static override styles = css`
    .form {
      display: flex;
      flex-direction: column;
      gap: 16px;
    }
    ha-tab-group {
      display: block;
      margin: -8px -24px 16px;
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
    .secondary {
      color: var(--secondary-text-color);
      font-size: var(--ha-font-size-s, 12px);
    }
    /* A card of settings rows, a full-width line between them. */
    ha-card.settings {
      display: flex;
      flex-direction: column;
    }
    .setting {
      padding: 12px 16px;
    }
    .setting + .setting {
      border-top: 1px solid var(--divider-color);
    }
    .setting-head {
      display: flex;
      align-items: center;
      gap: 16px;
      min-height: 40px;
    }
    .setting-text {
      flex: 1;
      min-width: 0;
    }
    .setting-below {
      display: flex;
      flex-direction: column;
      gap: 12px;
      margin-top: 12px;
    }
    .control {
      flex: 0 1 220px;
      min-width: 0;
    }
    .control > *,
    ha-select.control {
      display: block;
      width: 100%;
    }
    .end {
      display: flex;
      align-items: center;
      gap: 4px;
    }
    ha-icon.builtin {
      flex: none;
      color: var(--amber-color, #ffc107);
    }
    .end .restore {
      color: var(--secondary-text-color);
    }
    ha-card.snooze {
      padding: 12px 16px 16px;
    }
    .times {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(140px, 1fr));
      gap: 4px 16px;
      margin: 8px 0;
    }
    .time {
      display: flex;
      align-items: center;
      gap: 8px;
      min-height: 40px;
      cursor: pointer;
    }
    /* The restore button beside a title. */
    .section-head .restore {
      margin: -8px 0;
      color: var(--secondary-text-color);
    }
    .section-head {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
      min-height: 32px;
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
