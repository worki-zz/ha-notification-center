// What a live card of the Notification Center shows and does: its buttons,
// its tap, who sees it, and pressing a button.
//
// Shared by the Notification card (a notification's sensor), the
// Notification Center card and the panel, so a card works the same
// everywhere.

import {
  DOMAIN,
  type Button,
  type CardState,
  type Category,
  type Duration,
  type Notification,
  type NotificationCenterConfig,
  type Snooze,
  type StateMessage,
  type Step,
} from "./config";
import { entityAttribute, entityState, formatTime } from "./format";
import type { HomeAssistant } from "./types";

export const SNOOZE_CHOICES: { key: string; text: string; label: string; hours?: number }[] = [
  { key: "1h", text: "1 h", label: "Snooze for 1 hour", hours: 1 },
  { key: "3h", text: "3 h", label: "Snooze for 3 hours", hours: 3 },
  { key: "tomorrow", text: "Tomorrow", label: "Snooze until tomorrow" },
];

/** A button of a live card, as it is shown. */
export interface LiveButton {
  button: Button;
  key: string;
  label: string;
  icon: string;
  // Snooze is the quiet one: a background only on hover.
  plain: boolean;
  // Snooze that asks for the time.
  ask: boolean;
}

/** One live card with what it needs to be drawn. */
export interface LiveCard {
  card: CardState;
  notification: Notification;
  category?: Category;
  step?: Step;
  // The notification's sensor.
  entityId?: string;
  // When the notification was last done.
  lastDone?: string | null;
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

export function snoozeOf(
  button: Button,
  notification: Notification,
  category: Category | undefined,
): Snooze {
  if (button.snooze === "ask") return { type: "ask" };
  if (button.snooze && typeof button.snooze === "object") {
    return { type: "fixed", duration: button.snooze as Duration };
  }
  return notification.snooze ?? category?.snooze ?? { type: "ask" };
}

const DEFAULTS: Record<string, { label: string; icon: string }> = {
  done: { label: "Done", icon: "mdi:check" },
  snooze: { label: "Snooze", icon: "mdi:alarm-snooze" },
  dismiss: { label: "Dismiss", icon: "mdi:close" },
  keep_silent: { label: "Mute", icon: "mdi:volume-off" },
  custom: { label: "", icon: "mdi:gesture-tap-button" },
};

// Always in this order: Snooze, the own buttons, Done, Dismiss.
const ORDER = ["snooze", "custom", "done", "dismiss"];

/** The buttons a card shows, in their fixed order. */
export function liveButtons(live: LiveCard): LiveButton[] {
  const { card, notification, category, step } = live;
  const result: LiveButton[] = [];
  for (const button of step?.buttons ?? []) {
    if (!button.enabled || button.type === "tap") continue;
    // Mute is gone once the card is silent.
    if (button.card === "keep_silent" && card.silenced) continue;
    let ask = false;
    if (button.card === "snooze") {
      const snooze = snoozeOf(button, notification, category);
      if (snooze.type === "not_allowed") continue;
      ask = snooze.type === "ask";
    }
    const defaults =
      (button.type === "dismiss" && button.card === "keep_silent"
        ? DEFAULTS.keep_silent
        : DEFAULTS[button.type]) ?? DEFAULTS.custom;
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
  const tap = live.step?.buttons.find((button) => button.type === "tap" && button.enabled);
  if (!tap) return undefined;
  if (tap.card === "keep" && tap.action.type === "nothing") return undefined;
  return tap;
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

/** True when the logged in user is in a step's audience. */
export function inAudience(step: Step | undefined, person: string | undefined): boolean {
  const audience = step?.audience ?? [];
  return audience.length === 0 || (!!person && audience.includes(person));
}

export interface LiveFilter {
  statuses: CardState["status"][];
  categories?: string[];
  // The logged in user's person; undefined with ignoreAudience.
  person?: string;
  ignoreAudience?: boolean;
}

/** The cards of every notification, in list and step order. */
export function liveCards(
  config: NotificationCenterConfig,
  state: StateMessage,
  filter: LiveFilter,
): LiveCard[] {
  const result: LiveCard[] = [];
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
      if (!filter.ignoreAudience && !inAudience(step, filter.person)) continue;
      result.push({
        card,
        notification,
        category,
        step,
        entityId: entry.entity_id ?? undefined,
        lastDone: entry.last_done,
      });
    }
  }
  return result;
}

/**
 * Press a button of a card.
 *
 * The card changes and the Home Assistant and entity actions run in Home
 * Assistant; More info and Navigate happen here, from the given element.
 */
export async function pressButton(
  hass: HomeAssistant,
  element: HTMLElement,
  live: LiveCard,
  button: Button,
  until?: Date,
): Promise<void> {
  const { card } = live;
  const action = button.action ?? { type: "nothing" };
  const backend =
    button.card !== "keep" || action.type === "ha_action" || action.type === "entity_action";
  if (backend) {
    await hass.callWS({
      type: `${DOMAIN}/card/press`,
      notification_id: card.notification_id,
      step_id: card.step_id,
      entity_id: card.entity_id,
      button_id: button.id,
      ...(until ? { until: until.toISOString() } : {}),
    });
  }
  if (action.type === "more_info") {
    const entityId = action.entity_id || card.entity_id || live.entityId;
    if (entityId) {
      element.dispatchEvent(
        new CustomEvent("hass-more-info", {
          detail: { entityId },
          bubbles: true,
          composed: true,
        }),
      );
    }
  } else if (action.type === "navigate" && action.path) {
    navigate(action.path);
  }
}

/** Go to a page of Home Assistant, as its own links do. */
export function navigate(path: string): void {
  if (/^https?:\/\//.test(path)) {
    window.open(path, "_blank", "noopener");
    return;
  }
  history.pushState(null, "", path);
  window.dispatchEvent(new CustomEvent("location-changed", { detail: { replace: false } }));
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
    case "due":
      return formatTime(hass, new Date(live.card.since), format, now);
    case "last_done":
      return live.lastDone ? formatTime(hass, new Date(live.lastDone), format, now) : "";
    case "last_changed":
      return stateObj ? formatTime(hass, new Date(stateObj.last_changed), format, now) : "";
    case "state":
      return stateObj ? entityState(hass, stateObj) : "";
    case "attribute":
      return stateObj && data.attribute ? entityAttribute(hass, stateObj, data.attribute) : "";
    case "custom":
      return live.card.data_text ?? "";
  }
  return "";
}
