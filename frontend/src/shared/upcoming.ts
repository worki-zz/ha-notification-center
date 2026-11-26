// What comes on the Overview's Upcoming (and on the Notification Center
// card with Upcoming): the active cards the Dashboard holds back, the
// snoozed cards and the scheduled steps, with the line that says when each
// shows.

import { html } from "lit";
import { repeat } from "lit/directives/repeat.js";

import { effectiveChannel, modeColumns, sleepersOf } from "./channels";
import { CHANNEL_DASHBOARD, colorCss, type AudienceEntry, type AudienceState } from "./config";
import { cssColor, formatWhen } from "./format";
import {
  audienceOf,
  cardKey,
  categoryOf,
  closeEarly,
  type EarlyButton,
  inAudience,
  liveCards,
  onDashboard,
  personOf,
  stepOf,
  type LiveCard,
} from "./live";
import "./live-card";
import { type NotificationViewData } from "./notification-view";
import "./notification-view";
import type { StoreData } from "./store";
import { isTemplate, replacePlaceholders } from "./text";
import type { HomeAssistant } from "./types";

/** A scheduled step still to come. */
export interface Upcoming {
  key: string;
  notificationId: string;
  stepId: string;
  due: Date;
  view: NotificationViewData;
}

/** Which notifications: the categories (empty: all), and everyone's. */
export interface UpcomingFilter {
  categories?: string[];
  ignoreAudience?: boolean;
  // A card or badge placed for one notification: the channels do not count.
  ignoreChannels?: boolean;
}

/** One line of Upcoming: a held or snoozed card, or a scheduled step. */
export interface UpcomingEntry {
  at: number;
  key: string;
  live?: LiveCard;
  item?: Upcoming;
}

/** The end of the day of ``now``, in ms. */
export function endOfToday(now: number): number {
  const end = new Date(now);
  end.setHours(24, 0, 0, 0);
  return end.getTime();
}

/** The scheduled steps still to come, soonest first. */
export function scheduledSteps(
  hass: HomeAssistant,
  store: StoreData,
  now: number,
  filter: UpcomingFilter = {},
): Upcoming[] {
  const { config, state } = store;
  if (!config || !state) return [];
  const person = personOf(hass);
  const people = Object.keys(state.people ?? {});
  const result: Upcoming[] = [];
  for (const notification of config.notifications) {
    if (!notification.enabled) continue;
    if (filter.categories?.length && !filter.categories.includes(notification.category)) continue;
    const entry = state.notifications[notification.id];
    const category = categoryOf(config, notification);
    for (const item of entry?.upcoming ?? []) {
      const step = stepOf(notification, item.step_id);
      if (!step) continue;
      // Shown when the Dashboard gets it in some home mode and the viewer
      // in some state (the home mode and person state now do not count).
      if (!filter.ignoreChannels && !onDashboard(category, step)) continue;
      if (!filter.ignoreAudience && !inAudience(category, step, person, people)) continue;
      // A step with an open card shows that card instead.
      if (entry.cards.some((card) => card.step_id === step.id && card.status !== "done")) {
        continue;
      }
      const due = new Date(item.due);
      const message = isTemplate(step.message) ? "" : replacePlaceholders(step.message, {});
      result.push({
        key: `${notification.id}|${step.id}`,
        notificationId: notification.id,
        stepId: step.id,
        due,
        view: {
          label: notification.name,
          message,
          when: formatWhen(hass, due, now),
          icon: notification.icon || category?.icon || "mdi:calendar-clock",
          color: cssColor(colorCss(config, notification.color ?? category?.color)),
          muted: true,
          buttons: [
            { key: "done_early", label: "Done", icon: "mdi:check" },
            { key: "dismiss_early", label: "Dismiss", icon: "mdi:close" },
          ],
        },
      });
    }
  }
  return result.sort((a, b) => a.due.getTime() - b.due.getTime());
}

/**
 * Upcoming today: the active cards the Dashboard holds back for the viewer,
 * the snoozed cards and the scheduled steps due today, by their time.
 */
export function upcomingToday(
  hass: HomeAssistant,
  store: StoreData,
  now: number,
  filter: UpcomingFilter = {},
): UpcomingEntry[] {
  const { config, state } = store;
  if (!config || !state) return [];
  const common = {
    person: personOf(hass),
    categories: filter.categories,
    ignoreAudience: filter.ignoreAudience,
  };
  const held = liveCards(config, state, { ...common, statuses: ["active"], withHeld: true }).filter(
    (live) => live.held,
  );
  const snoozed = liveCards(config, state, { ...common, statuses: ["snoozed"] }).filter((live) =>
    onDashboard(live.category, live.step),
  );
  const end = endOfToday(now);
  return [
    ...held.map((live) => ({
      at: live.held?.until ? new Date(live.held.until).getTime() : now,
      key: cardKey(live.card),
      live,
    })),
    ...snoozed.map((live) => ({
      at: live.card.snoozed_until ? new Date(live.card.snoozed_until).getTime() : 0,
      key: cardKey(live.card),
      live,
    })),
    ...scheduledSteps(hass, store, now, filter)
      .filter((item) => item.due.getTime() < end)
      .map((item) => ({ at: item.due.getTime(), key: item.key, item })),
  ].sort((a, b) => a.at - b.at);
}

/** Close a scheduled step before it is due (its Done or Dismiss button). */
export function closeEarlyOf(hass: HomeAssistant, item: Upcoming, key: EarlyButton): Promise<void> {
  return closeEarly(hass, item.notificationId, item.stepId, key);
}

/** Render scheduled steps, each with its Done and Dismiss buttons. */
export function renderScheduled(
  hass: HomeAssistant,
  items: Upcoming[],
  onButton: (item: Upcoming, key: EarlyButton) => void,
) {
  return repeat(
    items,
    (item) => item.key,
    (item) => html`
      <notification-center-view
        class="upcoming"
        .hass=${hass}
        .view=${item.view}
        @nc-button=${(ev: CustomEvent<{ key: EarlyButton }>) => onButton(item, ev.detail.key)}
      ></notification-center-view>
    `,
  );
}

/** Render the lines of Upcoming today. */
export function renderUpcoming(
  hass: HomeAssistant,
  store: StoreData,
  entries: UpcomingEntry[],
  now: number,
  onButton: (item: Upcoming, key: EarlyButton) => void,
) {
  return repeat(
    entries,
    (entry) => entry.key,
    (entry) => {
      if (!entry.live) return renderScheduled(hass, [entry.item!], onButton);
      const live = entry.live;
      const until = live.card.snoozed_until;
      const when = live.held
        ? heldText(hass, store, live, now)
        : until
          ? `Snoozed until ${formatWhen(hass, new Date(until), now)}`
          : "Snoozed";
      return html`
        <notification-center-live-card
          class="upcoming"
          .hass=${hass}
          .live=${live}
          .now=${now}
          .data=${""}
          .when=${when}
          .muted=${true}
        ></notification-center-live-card>
      `;
    },
  );
}

/** Why a card is held back, as the line under it says. */
export function heldText(hass: HomeAssistant, store: StoreData, live: LiveCard, now: number): string {
  const held = live.held!;
  if (held.reason === "delay" && held.until) {
    return `Shows ${formatWhen(hass, new Date(held.until), now)}`;
  }
  const config = store.config;
  if (held.reason === "mode") {
    // The modes the Dashboard sends this card in, in the table's order.
    const settings = effectiveChannel(
      live.category?.channels?.[CHANNEL_DASHBOARD],
      live.step?.channels?.[CHANNEL_DASHBOARD],
    );
    const names = modeColumns(config?.modes)
      .filter((mode) => settings.modes?.includes(mode.id))
      .map((mode) => mode.name);
    return names.length ? `Shows in ${orList(names)} home mode` : "Shows when the home mode changes";
  }
  // The audience: what would make the card show (arrive, wake up, ...),
  // with the names of the people who would have to do it.
  const states = store.state?.people ?? {};
  const sleepers = sleepersOf(config?.people);
  const viewer = personOf(hass);
  const people = viewer && viewer in states ? [viewer] : Object.keys(states);
  const audience = audienceOf(live.category, live.step, people);
  const byChange = new Map<StateChange, string[]>();
  for (const person of people) {
    for (const change of stateChanges(states[person], audience[person], sleepers.includes(person))) {
      byChange.set(change, [...(byChange.get(change) ?? []), person]);
    }
  }
  const list = CHANGE_ORDER.filter((change) => byChange.has(change));
  if (!list.length) return "Shows when the audience can get it";
  if (viewer && people.length === 1) return `Shows when you ${orList(list)}`;
  const involved = new Set([...byChange.values()].flat());
  if (involved.size > MAX_NAMES) {
    return `Shows when someone ${orList(list.map((change) => THIRD_PERSON[change]))}`;
  }
  const name = (person: string) =>
    String(hass.states[person]?.attributes.friendly_name ?? person.replace(/^person\./, ""));
  return `Shows when ${orList(
    list.map((change) => `${orList(byChange.get(change)!.map(name))} ${THIRD_PERSON[change]}`),
  )}`;
}

/** "a", "a or b", "a, b or c". */
function orList(items: string[]): string {
  return items.length < 2 ? (items[0] ?? "") : `${items.slice(0, -1).join(", ")} or ${items[items.length - 1]}`;
}

type StateChange = "arrive home" | "wake up" | "go to sleep" | "arrive home and go to sleep" | "leave home";

// The order the changes are listed in, and how they read after a name.
const CHANGE_ORDER: StateChange[] = ["arrive home", "wake up", "go to sleep", "arrive home and go to sleep", "leave home"];
const THIRD_PERSON: Record<StateChange, string> = {
  "arrive home": "arrives home",
  "wake up": "wakes up",
  "go to sleep": "goes to sleep",
  "arrive home and go to sleep": "arrives home and goes to sleep",
  "leave home": "leaves home",
};

// With more people than this the Upcoming line says "someone".
const MAX_NAMES = 3;

/**
 * What a person has to do for a card to show to them: from their state now
 * to a state ticked for them (asleep only with a sleep condition).
 */
function stateChanges(now: AudienceState | undefined, entry: AudienceEntry | undefined, canSleep: boolean): StateChange[] {
  if (!now || !entry) return [];
  const changes: StateChange[] = [];
  if (entry.home && now !== "home") changes.push(now === "away" ? "arrive home" : "wake up");
  if (entry.sleep && canSleep && now !== "sleep") {
    changes.push(now === "away" ? "arrive home and go to sleep" : "go to sleep");
  }
  if (entry.away && now !== "away") changes.push("leave home");
  return changes;
}
