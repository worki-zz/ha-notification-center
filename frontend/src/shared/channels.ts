// Channel helpers shared by the Overview, the dashboard cards and the editors.

import type { ChannelSettings, Mode } from "./config";

/** The modes as columns: the unconditional Home first, then the list's order. */
export function modeColumns(modes: Mode[] | undefined): Mode[] {
  const list = modes ?? [];
  const home = list.find((mode) => mode.id === "home" && !mode.condition);
  return home ? [home, ...list.filter((mode) => mode !== home)] : list;
}

/** The people of the configuration with a sleep condition. */
export function sleepersOf(
  people: { person: string; sleep?: unknown }[] | undefined,
): string[] {
  return (people ?? [])
    .filter((person) => person.sleep)
    .map((person) => person.person);
}

/** A channel's settings: the category's, then what the step changes. */
export function effectiveChannel(
  base: ChannelSettings | undefined,
  own: ChannelSettings | undefined,
): ChannelSettings {
  return { modes: [], delay: null, ...(base ?? {}), ...(own ?? {}) };
}
