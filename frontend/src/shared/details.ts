// The Notification details of one card (a notification, its step and its
// entity): which card an address names, what it shows, and opening it.
//
// The dialog opens where it is asked: over a dashboard, the Overview or
// the editor, through Home Assistant's own dialog manager. A push opens the
// Overview with the address in the query (see `detailsPath`).

import { colorCss, type CardState, type Notification } from "./config";
import { cssColor, formatTime, formatWhen } from "./format";
import { categoryOf, stepOf, type LiveCard } from "./live";
import type { StoreData } from "./store";
import { isTemplate, replacePlaceholders } from "./text";
import type { HomeAssistant } from "./types";

export const DETAILS_DIALOG = "nc-details-dialog";

/** What a link or a button names: the notification, maybe its step and entity. */
export interface DetailsAddress {
  // A notification id, or its sensor.
  notification: string;
  step?: string | null;
  entity?: string | null;
}

export type DetailsView = "details" | "status";

export interface DetailsParams extends DetailsAddress {
  view?: DetailsView;
}

/** One card of a notification: the Details shows one. */
export interface DetailsTarget {
  notificationId: string;
  stepId: string;
  entityId: string | null;
}

const OPEN: CardState["status"][] = ["active", "hidden", "snoozed"];

/** The Overview with the Notification details of a card open. */
export function detailsPath(address: DetailsAddress): string {
  const query = new URLSearchParams({ details: address.notification });
  if (address.step) query.set("step", address.step);
  if (address.entity) query.set("entity", address.entity);
  return `/notification-center?${query.toString()}`;
}

/** Open the Notification details (or the Status) over the page of an element. */
export function openDetails(element: HTMLElement, params: DetailsParams): void {
  element.dispatchEvent(
    new CustomEvent("show-dialog", {
      detail: {
        dialogTag: DETAILS_DIALOG,
        dialogImport: () => Promise.resolve(),
        dialogParams: params,
      },
      bubbles: true,
      composed: true,
    }),
  );
}

/** A notification by its id or by its sensor. */
export function findNotification(store: StoreData, id: string): Notification | undefined {
  const { config, state } = store;
  if (!config) return undefined;
  const own = config.notifications.find((item) => item.id === id);
  if (own) return own;
  const found = Object.entries(state?.notifications ?? {}).find(([, item]) => item.entity_id === id);
  return found ? config.notifications.find((item) => item.id === found[0]) : undefined;
}

function latest(cards: CardState[]): CardState | undefined {
  return [...cards].sort((a, b) => (b.closed_at ?? b.since).localeCompare(a.closed_at ?? a.since))[0];
}

/**
 * The cards an address names. With step and entity: exactly that card.
 * Otherwise the open cards that match (several: the dialog lets the user
 * pick one); with none open, the one closed today, else the next scheduled
 * step, else the first step.
 */
export function resolveAddress(store: StoreData, address: DetailsAddress): DetailsTarget[] {
  const notification = findNotification(store, address.notification);
  if (!notification?.steps.length) return [];
  const id = notification.id;
  const target = (stepId: string, entityId: string | null): DetailsTarget => ({
    notificationId: id,
    stepId,
    entityId,
  });
  const step = address.step && stepOf(notification, address.step) ? address.step : undefined;
  const entity = address.entity || null;
  if (step && entity) return [target(step, entity)];
  const entry = store.state?.notifications[id];
  const cards = (entry?.cards ?? []).filter(
    (card) => (!step || card.step_id === step) && (!entity || card.entity_id === entity),
  );
  const open = cards.filter((card) => OPEN.includes(card.status));
  if (open.length) return open.map((card) => target(card.step_id, card.entity_id));
  const closed = latest(cards);
  if (closed) return [target(closed.step_id, closed.entity_id)];
  if (step) return [target(step, entity)];
  const due = [...(entry?.upcoming ?? [])].sort((a, b) => a.due.localeCompare(b.due))[0];
  if (due && stepOf(notification, due.step_id) && !entity) return [target(due.step_id, null)];
  return [target(notification.steps[0].id, entity)];
}

/** The status of a card, as the badge and the Status say it. */
export type DetailsStatus =
  | "active"
  | "hidden"
  | "snoozed"
  | "done"
  | "dismissed"
  | "upcoming"
  | "idle"
  | "disabled";

/** Everything the Details and the Status show of one card. */
export interface DetailsData {
  target: DetailsTarget;
  notification: Notification;
  live: LiveCard;
  // The card itself; none when the step has no card now (upcoming, idle).
  card?: CardState;
  status: DetailsStatus;
  // When a scheduled step is next due.
  due?: Date;
  // The message: the card's, or the step's while it has no card.
  message: string;
  // The colour of the status: active the notification's, snoozed orange,
  // done green, the rest grey.
  statusColor: string;
  // The step's number from 1, and the number of steps.
  stepNumber: number;
  steps: number;
}

const GREY = "var(--state-inactive-color, var(--disabled-color))";

/** The step's own message while it has no card (a template shows none). */
export function stepMessage(message: string | undefined): string {
  if (!message || isTemplate(message)) return "";
  return replacePlaceholders(message, {});
}

/** What a card shows, or undefined when the notification or step is gone. */
export function detailsOf(store: StoreData, target: DetailsTarget): DetailsData | undefined {
  const { config, state } = store;
  if (!config || !state) return undefined;
  const notification = config.notifications.find((item) => item.id === target.notificationId);
  const step = notification ? stepOf(notification, target.stepId) : undefined;
  if (!notification || !step) return undefined;
  const category = categoryOf(config, notification);
  const entry = state.notifications[notification.id];
  const card = entry?.cards.find(
    (item) => item.step_id === step.id && (item.entity_id ?? null) === target.entityId,
  );
  const upcoming = entry?.upcoming?.find((item) => item.step_id === step.id);
  const color = colorCss(config, notification.color ?? category?.color);
  const live: LiveCard = {
    // A step without a card: an empty one, so the card helpers work.
    card: card ?? {
      notification_id: notification.id,
      step_id: step.id,
      entity_id: target.entityId,
      status: "dismissed",
      since: new Date(0).toISOString(),
      state_since: new Date(0).toISOString(),
      snoozed_until: null,
      message: null,
      info: null,
    },
    notification,
    category,
    step,
    color,
    entityId: entry?.entity_id ?? undefined,
    lastDone: entry?.last_done,
  };
  let status: DetailsStatus;
  if (!notification.enabled) status = "disabled";
  else if (card) status = card.status;
  else if (upcoming) status = "upcoming";
  else status = "idle";
  const statusColor =
    status === "active"
      ? cssColor(color)
      : status === "snoozed"
        ? "var(--orange-color, #ff9800)"
        : status === "done"
          ? "var(--green-color, #4caf50)"
          : GREY;
  return {
    target,
    notification,
    live,
    card,
    status,
    due: upcoming ? new Date(upcoming.due) : undefined,
    message: card?.message ?? stepMessage(step.message),
    statusColor,
    stepNumber: notification.steps.indexOf(step) + 1,
    steps: notification.steps.length,
  };
}

/** The status in a few words, as the lists write it: "Snoozed until 13:00". */
export function statusLabel(hass: HomeAssistant, data: DetailsData, now: number): string {
  const card = data.card;
  const time = (iso: string | null | undefined) =>
    iso ? formatTime(hass, new Date(iso), "time", now) : "";
  switch (data.status) {
    case "active":
      return "Active";
    case "hidden":
      return "Hidden";
    case "snoozed":
      return card?.snoozed_until
        ? `Snoozed until ${formatWhen(hass, new Date(card.snoozed_until), now)}`
        : "Snoozed";
    case "done":
      return `Done ${time(card?.closed_at)}`.trim();
    case "dismissed":
      return `Dismissed ${time(card?.closed_at)}`.trim();
    case "upcoming":
      return data.due ? `Shows ${formatWhen(hass, data.due, now)}` : "Upcoming";
    case "disabled":
      return "Disabled";
    default:
      return "Idle";
  }
}

/**
 * Whether Undo can bring a closed card back: done or dismissed today, once
 * active, its Expiration not passed, and no newer card of the step.
 */
export function canUndo(store: StoreData, data: DetailsData, now: number): boolean {
  const card = data.card;
  if (!card || (card.status !== "done" && card.status !== "dismissed")) return false;
  if (!card.active_since || !card.closed_at) return false;
  if (card.expires_at && new Date(card.expires_at).getTime() <= now) return false;
  const closed = card.closed_at;
  const others = store.state?.notifications[card.notification_id]?.cards ?? [];
  return !others.some(
    (other) => other !== card && other.step_id === card.step_id && other.since > closed,
  );
}
