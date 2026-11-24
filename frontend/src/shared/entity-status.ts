// What a card or badge placed for one notification shows: the
// notification's status for the viewer and what goes with it.
//
// The channels do not count there (the card or badge was placed for it);
// the audience counts in the viewer's state now, unless Ignore audience is on
// (the default: everyone sees it).

import { colorCss, type Category, type Notification } from "./config";
import { cssColor, formatWhen } from "./format";
import { categoryOf, liveCards, personOf, type LiveCard } from "./live";
import type { StoreData } from "./store";
import type { HomeAssistant } from "./types";
import { endOfToday, scheduledSteps, type Upcoming } from "./upcoming";

/** The statuses "Show when the notification is" offers. */
export type ShowStatus = "active" | "snoozed" | "upcoming" | "done" | "idle";

export const SHOW_STATUSES: ShowStatus[] = ["active", "snoozed", "upcoming", "done", "idle"];

export const SHOW_STATUS_LABELS: Record<ShowStatus, string> = {
  active: "Active",
  snoozed: "Snoozed",
  upcoming: "Upcoming",
  done: "Done today",
  idle: "Idle",
};

export interface EntityStatus {
  status: ShowStatus;
  notification: Notification;
  category?: Category;
  // Active, snoozed or done today: its cards for the viewer.
  cards: LiveCard[];
  // Upcoming: the steps due later today.
  upcoming: Upcoming[];
  // The CSS colour of the status, as the sensor's icon_color: active the
  // notification's, snoozed orange, done green, the rest grey.
  color: string;
}

/** Whether a card or badge shows for a status (left out: always). */
export function showsFor(showWhen: ShowStatus[] | undefined, status: ShowStatus): boolean {
  return !showWhen?.length || showWhen.includes(status);
}

/** The status of a notification's sensor for the viewer (undefined: not loaded). */
export function entityStatusOf(
  hass: HomeAssistant,
  store: StoreData,
  entityId: string | undefined,
  ignoreAudience: boolean,
  now: number,
): EntityStatus | undefined {
  const { config, state } = store;
  if (!config || !state || !entityId) return undefined;
  const found = Object.entries(state.notifications).find(([, item]) => item.entity_id === entityId);
  const notification = found && config.notifications.find((item) => item.id === found[0]);
  if (!notification) return undefined;
  const category = categoryOf(config, notification);
  const filter = {
    person: ignoreAudience ? undefined : personOf(hass),
    ignoreAudience,
    ignoreChannels: true,
  };
  const own = (statuses: LiveCard["card"]["status"][]) =>
    liveCards(config, state, { ...filter, statuses }).filter((live) => live.entityId === entityId);
  const base = {
    notification,
    category,
    cards: [] as LiveCard[],
    upcoming: [] as Upcoming[],
  };
  const grey = "var(--state-inactive-color)";
  const active = own(["active"]);
  if (active.length) {
    return {
      ...base,
      status: "active",
      cards: active,
      color: cssColor(colorCss(config, notification.color ?? category?.color)) ?? grey,
    };
  }
  const snoozed = own(["snoozed"]);
  if (snoozed.length) {
    return { ...base, status: "snoozed", cards: snoozed, color: "var(--orange-color)" };
  }
  const end = endOfToday(now);
  const upcoming = scheduledSteps(hass, store, now, { ignoreAudience, ignoreChannels: true }).filter(
    (item) => item.notificationId === notification.id && item.due.getTime() < end,
  );
  if (upcoming.length) return { ...base, status: "upcoming", upcoming, color: grey };
  const done = own(["done"]);
  if (done.length) return { ...base, status: "done", cards: done, color: "var(--green-color)" };
  return { ...base, status: "idle", color: grey };
}

/** The status in a few words: "Active", "Snoozed until 18:00", "Shows at 19:00". */
export function statusText(hass: HomeAssistant, status: EntityStatus, now: number): string {
  switch (status.status) {
    case "snoozed": {
      const until = status.cards[0]?.card.snoozed_until;
      return until ? `Snoozed until ${formatWhen(hass, new Date(until), now)}` : "Snoozed";
    }
    case "upcoming":
      return status.upcoming[0] ? `Shows ${formatWhen(hass, status.upcoming[0].due, now)}` : "Upcoming";
    default:
      return SHOW_STATUS_LABELS[status.status];
  }
}

/** The message of the status: the first card's (or step's), "+N" for more. */
export function statusMessage(status: EntityStatus): string {
  if (status.status === "upcoming") return status.upcoming[0]?.view.message ?? "";
  const first = status.cards[0]?.card.message ?? "";
  const more = status.cards.length - 1;
  return first && more > 0 ? `${first} +${more}` : first;
}
