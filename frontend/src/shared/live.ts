// What a live card of the Notification Center shows and does: its buttons,
// its tap, who sees it, and pressing a button.
//
// Shared by the Notification card (a notification's sensor), the
// Notification Center card and the panel, so a card works the same
// everywhere.

import {
  AUDIENCE_STATES,
  DOMAIN,
  type AudienceEntry,
  type Button,
  type ButtonActions,
  type CategoryButton,
  type EffectiveButton,
  type CardState,
  type Category,
  type ChannelReason,
  type Notification,
  type NotificationCenterConfig,
  type StateMessage,
  type Step,
  colorCss,
} from "./config";
import { entityAttribute, entityState, formatTime } from "./format";
import type { HomeAssistant } from "./types";

/**
 * The times a Snooze button can offer, in this order: written out in the
 * editor, short on the card. Home Assistant works out when each ends; the
 * days come back at the morning time (or when a scheduled step came).
 */
export const SNOOZE_CHOICES: { key: string; text: string; label: string }[] = [
  { key: "15m", text: "15 min", label: "15 minutes" },
  { key: "30m", text: "30 min", label: "30 minutes" },
  { key: "1h", text: "1 h", label: "1 hour" },
  { key: "2h", text: "2 h", label: "2 hours" },
  { key: "3h", text: "3 h", label: "3 hours" },
  { key: "6h", text: "6 h", label: "6 hours" },
  { key: "12h", text: "12 h", label: "12 hours" },
  { key: "tomorrow", text: "Tomorrow", label: "Tomorrow" },
  { key: "2d", text: "2 d", label: "2 days" },
  { key: "3d", text: "3 d", label: "3 days" },
  { key: "1w", text: "1 w", label: "1 week" },
  { key: "2w", text: "2 w", label: "2 weeks" },
  { key: "1mo", text: "1 mo", label: "1 month" },
];

export const DEFAULT_SNOOZE = ["1h", "3h", "tomorrow"];

/** The Snooze button's times, in the fixed order. */
export function snoozeChoices(button: {
  snooze?: string[] | null;
}): typeof SNOOZE_CHOICES {
  const chosen = button.snooze?.length ? button.snooze : DEFAULT_SNOOZE;
  return SNOOZE_CHOICES.filter((choice) => chosen.includes(choice.key));
}

/** A button of a live card, as it is shown. */
export interface LiveButton {
  button: Button;
  key: string;
  label: string;
  icon: string;
  // Snooze is the quiet one: a background only on hover.
  plain: boolean;
  // Snooze that offers its times.
  ask: boolean;
}

/** One live card with what it needs to be drawn. */
export interface LiveCard {
  card: CardState;
  notification: Notification;
  category?: Category;
  step?: Step;
  // The CSS colour of the card: the notification's or its category's.
  color?: string;
  // The notification's sensor.
  entityId?: string;
  // When the notification was last done.
  lastDone?: string | null;
  // Active, but held back from the Dashboard for the viewer now.
  held?: Held;
}

export function cardKey(card: CardState): string {
  return `${card.notification_id}|${card.step_id}|${card.entity_id ?? ""}`;
}

export function categoryOf(
  config: NotificationCenterConfig,
  notification: Notification,
): Category | undefined {
  return (
    config.categories.find((item) => item.id === notification.category) ??
    config.categories.find((item) => item.id === "general")
  );
}

export function stepOf(notification: Notification, stepId: string): Step | undefined {
  return notification.steps.find((item) => item.id === stepId);
}

const DEFAULTS: Record<string, { label: string; icon: string }> = {
  done: { label: "Done", icon: "mdi:check" },
  snooze: { label: "Snooze", icon: "mdi:alarm-snooze" },
  dismiss: { label: "Dismiss", icon: "mdi:close" },
  custom: { label: "", icon: "mdi:gesture-tap-button" },
};

// Always in this order: Snooze, the own buttons, Done, Dismiss.
const ORDER = ["snooze", "custom", "done", "dismiss"];

// The built-in buttons of a category, in the order of the editor.
export const BUILTIN_ORDER: Button["type"][] = ["tap", "done", "dismiss", "snooze"];
const CATEGORY_ENABLED: Record<string, boolean> = {
  tap: false,
  done: true,
  dismiss: false,
  snooze: false,
};

/** A category's buttons with every setting filled in. */
export function categoryButtons(category: Category | undefined): CategoryButton[] {
  const given = category?.buttons ?? [];
  const builtins = BUILTIN_ORDER.map(
    (type) =>
      given.find((button) => button.type === type) ?? {
        id: type,
        type,
        enabled: CATEGORY_ENABLED[type],
      },
  );
  return [...builtins, ...given.filter((button) => button.type === "custom")].map(
    (button) => ({
      ...button,
      enabled: button.enabled ?? CATEGORY_ENABLED[button.type] ?? true,
      snooze:
        button.type === "snooze"
          ? button.snooze?.length
            ? button.snooze
            : DEFAULT_SNOOZE
          : undefined,
      show_in_push:
        button.type === "tap" ? undefined : (button.show_in_push ?? true),
    }),
  );
}

/**
 * A step's buttons as they work: the category's buttons (the built-in ones
 * and its custom ones) with what the step changes, then the step's own
 * custom buttons. The same as `effective_buttons` in Home Assistant.
 */
export function effectiveButtons(
  category: Category | undefined,
  step: Pick<Step, "buttons"> | undefined,
): EffectiveButton[] {
  const own = step?.buttons ?? [];
  const bases = categoryButtons(category);
  const linked = new Set(bases.filter((base) => base.type === "custom").map((base) => base.id));
  const result: EffectiveButton[] = bases.map((base) => {
    const entry: Partial<Button> =
      own.find((button) =>
        base.type === "custom"
          ? button.type === "custom" && button.id === base.id
          : button.type === base.type,
      ) ?? {};
    const merged: EffectiveButton = {
      id: entry.id || base.id,
      type: base.type,
      enabled: entry.enabled ?? base.enabled,
      label: entry.label || base.label,
      icon: entry.icon || base.icon,
      // Not stored: the built-in button's default (the Tap shows more info).
      actions: entry.actions ?? (base.type === "tap" ? { navigation: { type: "more_info" } } : {}),
      confirm: entry.confirm ?? false,
      category: true,
    };
    if (base.type === "snooze") merged.snooze = entry.snooze?.length ? entry.snooze : base.snooze;
    if (base.type === "tap") {
      merged.open_on_tap = entry.open_on_tap || base.open_on_tap;
      merged.run_button = (entry.run_button !== undefined ? entry.run_button : base.run_button) || null;
    }
    else merged.show_in_push = entry.show_in_push ?? base.show_in_push;
    return merged;
  });
  for (const entry of own) {
    if (entry.type !== "custom" || linked.has(entry.id)) continue;
    result.push({
      ...entry,
      enabled: entry.enabled ?? true,
      show_in_push: entry.show_in_push ?? true,
      category: false,
    });
  }
  return result;
}

/** The buttons a card shows, in their fixed order. */
export function liveButtons(live: LiveCard): LiveButton[] {
  const result: LiveButton[] = [];
  for (const button of effectiveButtons(live.category, live.step)) {
    if (!button.enabled || button.type === "tap") continue;
    const ask = button.type === "snooze" && snoozeChoices(button).length > 1;
    const defaults = DEFAULTS[button.type] ?? DEFAULTS.custom;
    result.push({
      button,
      key: button.id,
      label: button.label || defaults.label,
      icon: button.icon || defaults.icon,
      plain: button.type === "snooze",
      ask,
    });
  }
  return result.sort((a, b) => ORDER.indexOf(a.button.type) - ORDER.indexOf(b.button.type));
}

/** The tap of the card, when it is switched on and does something. */
export function tapButton(live: LiveCard): Button | undefined {
  const buttons = effectiveButtons(live.category, live.step);
  const tap = buttons.find((button) => button.type === "tap" && button.enabled);
  if (!tap) return undefined;
  const target = runButtonOf(buttons, tap);
  if (target) return tap;
  if (!hasActions(tap.actions)) return undefined;
  return tap;
}

/** The key a Tap names a button by: a built-in one's type, a custom one's id. */
export function buttonRef(button: Pick<Button, "id" | "type">): string {
  return button.type === "custom" ? button.id : button.type;
}

/**
 * The switched on button a Tap runs instead of its own actions, as
 * `run_button_of` in Home Assistant. None: the Tap's own actions.
 */
export function runButtonOf(
  buttons: EffectiveButton[],
  tap: Button,
): EffectiveButton | undefined {
  const ref = tap.type === "tap" ? tap.run_button : undefined;
  if (!ref) return undefined;
  return buttons.find(
    (button) => button.type !== "tap" && button.enabled && buttonRef(button) === ref,
  );
}

/** The person entity of the logged in user. */
export function personOf(hass: HomeAssistant): string | undefined {
  const userId = hass.user?.id;
  if (!userId) return undefined;
  return Object.values(hass.states).find(
    (state) =>
      state.entity_id.startsWith("person.") && state.attributes.user_id === userId,
  )?.entity_id;
}

/** The states each person gets a step in: the step's, then the category's. */
export function audienceOf(
  category: Category | undefined,
  step: Pick<Step, "audience"> | undefined,
  people: string[],
): Record<string, AudienceEntry> {
  const base = category?.audience ?? {};
  const own = step?.audience ?? {};
  const entries = Object.values(base);
  const common = Object.fromEntries(
    AUDIENCE_STATES.map((state) => [
      state,
      entries.length ? entries.every((entry) => entry[state]) : true,
    ]),
  ) as AudienceEntry;
  return Object.fromEntries(
    people.map((person) => [person, { ...(own[person] ?? base[person] ?? common) }]),
  );
}

/** True when a person gets a step in any state (with no person: always). */
export function inAudience(
  category: Category | undefined,
  step: Step | undefined,
  person: string | undefined,
  people: string[],
): boolean {
  if (!person || !people.length) return true;
  const entry = audienceOf(category, step, [person])[person];
  return AUDIENCE_STATES.some((state) => entry[state]);
}

/** Why a card is held back from the Dashboard for the viewer. */
export interface Held {
  reason: Exclude<ChannelReason, "off">;
  until?: string | null;
}

export interface LiveFilter {
  statuses: CardState["status"][];
  categories?: string[];
  // The logged in user's person; undefined with ignoreAudience.
  person?: string;
  // Show what the house sees: the cards on the Dashboard for anyone.
  ignoreAudience?: boolean;
  // Also return the active cards the Dashboard holds back now (``held``).
  withHeld?: boolean;
}

/**
 * Whether the Dashboard shows an active card to the viewer: shown, held
 * back (and why), or not for them at all (null).
 */
function dashboardOf(
  card: CardState,
  person: string | undefined,
  people: string[],
): { show: boolean; held?: Held } | null {
  const view = card.dashboard;
  if (!view) return { show: true };
  if (view.reason === "off") return null;
  const house = !person || !people.length;
  if (!house && !view.audience.includes(person)) return null;
  if (view.reason === "mode" || view.reason === "delay") {
    return { show: false, held: { reason: view.reason, until: view.until } };
  }
  if (house ? view.reason === null : view.people.includes(person)) return { show: true };
  return { show: false, held: { reason: "audience" } };
}

/** The cards of every notification, in list and step order. */
export function liveCards(
  config: NotificationCenterConfig,
  state: StateMessage,
  filter: LiveFilter,
): LiveCard[] {
  const result: LiveCard[] = [];
  const people = Object.keys(state.people ?? {});
  const person = filter.ignoreAudience ? undefined : filter.person;
  for (const notification of config.notifications) {
    if (!notification.enabled) continue;
    if (filter.categories?.length && !filter.categories.includes(notification.category)) {
      continue;
    }
    const entry = state.notifications[notification.id];
    if (!entry) continue;
    const category = categoryOf(config, notification);
    for (const card of entry.cards) {
      if (!filter.statuses.includes(card.status)) continue;
      const step = stepOf(notification, card.step_id);
      let held: Held | undefined;
      if (card.status === "active") {
        const dashboard = dashboardOf(card, person, people);
        if (!dashboard) continue;
        if (!dashboard.show) {
          if (!filter.withHeld) continue;
          held = dashboard.held;
        }
      } else if (!inAudience(category, step, person, people)) {
        continue;
      }
      result.push({
        card,
        notification,
        category,
        step,
        color: colorCss(config, notification.color ?? category?.color),
        entityId: entry.entity_id ?? undefined,
        lastDone: entry.last_done,
        held,
      });
    }
  }
  return result;
}

/** Whether a button's actions do anything. */
export function hasActions(actions: ButtonActions | undefined): boolean {
  return (
    !!actions &&
    (!!actions.entity_action ||
      !!actions.notification_state ||
      !!actions.silence ||
      !!actions.ha_actions?.length ||
      !!actions.navigation)
  );
}

/**
 * Press a button of a card.
 *
 * Its actions run in their fixed order: Silence, the entity action, the
 * notification state and the Home Assistant actions in Home Assistant, then the
 * navigation (More info or Navigate) here, from the given element. One that
 * cannot run is skipped; the navigation still happens.
 */
export async function pressButton(
  hass: HomeAssistant,
  element: HTMLElement,
  live: LiveCard,
  button: Button,
  choice?: string,
): Promise<void> {
  const { card } = live;
  // A Tap that runs another button does what that button does.
  if (button.type === "tap") {
    button = runButtonOf(effectiveButtons(live.category, live.step), button) ?? button;
  }
  const actions = button.actions ?? {};
  // Done, Dismiss and Snooze change the card in Home Assistant, where the
  // other actions but the navigation run too.
  const backend =
    ["done", "dismiss", "snooze"].includes(button.type) ||
    hasActions({ ...actions, navigation: undefined });
  let failed: unknown;
  if (backend) {
    try {
      await hass.callWS({
        type: `${DOMAIN}/card/press`,
        notification_id: card.notification_id,
        step_id: card.step_id,
        entity_id: card.entity_id,
        button_id: button.id,
        ...(choice ? { choice } : {}),
      });
    } catch (err) {
      failed = err;
    }
  }
  const navigation = actions.navigation;
  if (navigation?.type === "more_info") {
    const entityId = navigation.entity_id || card.entity_id || live.entityId;
    if (entityId) {
      element.dispatchEvent(
        new CustomEvent("hass-more-info", {
          detail: { entityId },
          bubbles: true,
          composed: true,
        }),
      );
    }
  } else if (navigation?.type === "navigate" && navigation.path) {
    navigate(navigation.path);
  }
  if (failed) throw failed;
}

/** Go to a page of Home Assistant, as its own links do. */
export function navigate(path: string, replace = false): void {
  if (/^https?:\/\//.test(path)) {
    window.open(path, "_blank", "noopener");
    return;
  }
  if (replace) history.replaceState(null, "", path);
  else history.pushState(null, "", path);
  window.dispatchEvent(new CustomEvent("location-changed", { detail: { replace } }));
}

/** Mark a scheduled step done before it is due. */
export async function doneEarly(
  hass: HomeAssistant,
  notificationId: string,
  stepId: string,
): Promise<void> {
  await hass.callWS({
    type: `${DOMAIN}/step/done_early`,
    notification_id: notificationId,
    step_id: stepId,
  });
}

export function errorText(err: unknown): string {
  if (err && typeof err === "object" && "message" in err) {
    return String((err as { message: unknown }).message);
  }
  return String(err);
}

/** The text after the label of a card, as its step's Data says. */
export function cardData(hass: HomeAssistant, live: LiveCard, now = Date.now()): string {
  const data = live.step?.data;
  if (!data || data.type === "none") return "";
  const format = data.format ?? "relative";
  const target = data.entity_id || live.card.entity_id || undefined;
  const stateObj = target ? hass.states[target] : undefined;
  switch (data.type) {
    case "active_since":
      return formatTime(hass, new Date(live.card.since), format, now);
    case "last_done":
      return live.lastDone ? formatTime(hass, new Date(live.lastDone), format, now) : "";
    case "last_changed":
      return stateObj ? formatTime(hass, new Date(stateObj.last_changed), format, now) : "";
    case "last_updated":
      return stateObj ? formatTime(hass, new Date(stateObj.last_updated), format, now) : "";
    case "state":
      return stateObj ? entityState(hass, stateObj) : "";
    case "attribute":
      return stateObj && data.attribute ? entityAttribute(hass, stateObj, data.attribute) : "";
    case "custom":
      return live.card.data_text ?? "";
  }
  return "";
}
