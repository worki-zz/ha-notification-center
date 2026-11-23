// Helpers of the Audience and Channels tables: names, counts and summaries.


import { AUDIENCE_STATES, PUSH_PRIORITY_DEFAULT, type PushPriority, type AudienceEntry, type AudienceState, type ChannelSettings, type Duration, type Mode } from "../shared/config";
import type { HomeAssistant } from "../shared/types";
import { type ChannelInfo } from "./devices";

export type { ChannelInfo } from "./devices";
export { channelsOf } from "./devices";

export const STATE_NAMES: Record<AudienceState, string> = {
  home: "Home",
  sleep: "Sleep",
  away: "Away",
};


export interface PersonInfo {
  id: string;
  name: string;
  picture?: string;
}

/** Every person of Home Assistant, by name. */
export function haPeople(hass: HomeAssistant | undefined): PersonInfo[] {
  return Object.values(hass?.states ?? {})
    .filter((state) => state.entity_id.startsWith("person."))
    .map((state) => ({
      id: state.entity_id,
      name: String(state.attributes.friendly_name ?? state.entity_id.slice(7)),
      picture:
        (state.attributes.entity_picture as string | undefined) ?? undefined,
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** The modes as columns: the unconditional Home first, then the list's order. */
export function modeColumns(modes: Mode[] | undefined): Mode[] {
  const list = modes ?? [];
  const home = list.find((mode) => mode.id === "home" && !mode.condition);
  return home ? [home, ...list.filter((mode) => mode !== home)] : list;
}

const EVERY: AudienceEntry = { home: true, sleep: true, away: true };

/**
 * The states each person gets a notification in, as the backend works it
 * out: a person the category leaves out gets what the listed people have in
 * common (nobody listed: every state); the step's own entry wins.
 */
export function effectiveAudience(
  category: Record<string, AudienceEntry> | undefined,
  own: Record<string, AudienceEntry> | undefined,
  people: string[],
): Record<string, AudienceEntry> {
  const base = category ?? {};
  const listed = Object.values(base);
  const common: AudienceEntry = listed.length
    ? {
        home: listed.every((entry) => entry.home),
        sleep: listed.every((entry) => entry.sleep),
        away: listed.every((entry) => entry.away),
      }
    : EVERY;
  return Object.fromEntries(
    people.map((person) => [
      person,
      { ...(own?.[person] ?? base[person] ?? common) },
    ]),
  );
}

/** The states shown as columns: Sleep only when someone can be asleep. */
export function visibleStates(sleepers: string[]): AudienceState[] {
  return sleepers.length ? AUDIENCE_STATES : ["home", "away"];
}

/** The states a person can be in: asleep only with a sleep condition. */
export function personStates(person: string, sleepers: string[]): AudienceState[] {
  return sleepers.includes(person) ? AUDIENCE_STATES : ["home", "away"];
}

/** The people of the configuration with a sleep condition. */
export function sleepersOf(
  people: { person: string; sleep?: unknown }[] | undefined,
): string[] {
  return (people ?? [])
    .filter((person) => person.sleep)
    .map((person) => person.person);
}

/** "2/3": the people in at least one state they can be in, of everyone. */
export function audienceCount(
  hass: HomeAssistant | undefined,
  category: Record<string, AudienceEntry> | undefined,
  own: Record<string, AudienceEntry> | undefined,
  sleepers: string[] = [],
): number | undefined {
  const people = haPeople(hass).map((person) => person.id);
  if (!people.length) return undefined;
  const effective = effectiveAudience(category, own, people);
  const on = people.filter((person) =>
    personStates(person, sleepers).some((state) => effective[person][state]),
  ).length;
  return on;
}

/** How many channels send in at least one mode: the category's, then the step's. */
export function channelCount(
  channels: ChannelInfo[],
  base: Record<string, ChannelSettings> | undefined,
  own: Record<string, ChannelSettings> | undefined,
): number {
  return channels.filter((channel) => (effectiveChannel(base?.[channel.key], own?.[channel.key]).modes ?? []).length)
    .length;
}

/** A channel's settings: the category's, then what the step changes. */
export function effectiveChannel(
  base: ChannelSettings | undefined,
  own: ChannelSettings | undefined,
): ChannelSettings {
  return { modes: [], delay: null, ...(base ?? {}), ...(own ?? {}) };
}

/** "5 minutes", "1 hour 30 minutes". */
export function durationText(delay: Duration | null | undefined): string {
  if (!delay) return "";
  const parts: string[] = [];
  const add = (amount: number | undefined, unit: string) => {
    if (amount) parts.push(`${amount} ${unit}${amount === 1 ? "" : "s"}`);
  };
  add(delay.days, "day");
  add(delay.hours, "hour");
  add(delay.minutes, "minute");
  add(delay.seconds, "second");
  return parts.join(" ");
}

export function hasDelay(delay: Duration | null | undefined): boolean {
  return !!delay && Object.values(delay).some((amount) => Number(amount) > 0);
}

/** "Home, Away · After 5 minutes", or "Off". */
export function channelSummary(
  settings: ChannelSettings,
  modes: Mode[],
): string {
  const ticked = modes.filter((mode) => settings.modes?.includes(mode.id));
  if (!ticked.length) return "Off";
  return `${ticked.map((mode) => mode.name).join(", ")} · ${whenText(settings)}`;
}

/** The names of the push priorities and what each does, in one line. */
export const PUSH_PRIORITY_INFO: Record<PushPriority, { name: string; help: string }> = {
  silent: { name: "Silent", help: "No sound: it waits in the list on the phone." },
  normal: { name: "Normal", help: "Sound and banner, as the phone's settings allow." },
  time_sensitive: {
    name: "Time-sensitive",
    help: "Comes through Focus and Do Not Disturb, at once.",
  },
  critical: {
    name: "Critical",
    help: "Sounds even when the phone is muted. Stays until it ends.",
  },
};

/** When a channel sends, and a push's priority unless Normal. */
export function whenText(settings: ChannelSettings): string {
  const when = hasDelay(settings.delay)
    ? `After ${durationText(settings.delay)}`
    : "Immediately";
  const priority = settings.priority as PushPriority | undefined;
  return priority && priority !== PUSH_PRIORITY_DEFAULT
    ? `${when} · ${PUSH_PRIORITY_INFO[priority].name}`
    : when;
}
