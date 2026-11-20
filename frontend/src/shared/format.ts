// Colours and times, the way the Home Assistant dashboard shows them.

import type { HassEntity, HomeAssistant } from "./types";

// The colour names of the dashboard colour picker (tile, alert and others).
const THEME_COLORS = new Set([
  "primary",
  "accent",
  "red",
  "pink",
  "purple",
  "deep-purple",
  "indigo",
  "blue",
  "light-blue",
  "cyan",
  "teal",
  "green",
  "light-green",
  "lime",
  "yellow",
  "amber",
  "orange",
  "deep-orange",
  "brown",
  "light-grey",
  "grey",
  "dark-grey",
  "blue-grey",
  "black",
  "white",
  "disabled",
]);

export type ColorValue = string | number[] | null | undefined;

/** Return a CSS colour from a colour name, a hex or CSS colour, or RGB. */
export function cssColor(color: ColorValue, fallback = "var(--primary-color)"): string {
  if (Array.isArray(color)) {
    return color.length === 3 ? `rgb(${color.join(", ")})` : fallback;
  }
  const text = typeof color === "string" ? color.trim() : "";
  if (!text || text === "none" || text === "state") {
    return fallback;
  }
  const name = text.toLowerCase().replace(/_/g, "-");
  if (THEME_COLORS.has(name)) {
    return `var(--${name}-color)`;
  }
  if (/^\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3}$/.test(text)) {
    return `rgb(${text})`;
  }
  return text;
}

export type TimeFormat = "relative" | "duration" | "time" | "date" | "datetime";

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

function language(hass: HomeAssistant): string {
  return hass.locale?.language ?? hass.language ?? navigator.language;
}

function hour12(hass: HomeAssistant): boolean | undefined {
  const format = hass.locale?.time_format;
  if (format === "12") return true;
  if (format === "24") return false;
  return undefined;
}

// The largest whole unit of a time span, for the relative and duration forms.
function span(ms: number): { value: number; unit: "day" | "hour" | "minute" | "second" } {
  const abs = Math.abs(ms);
  if (abs >= DAY) return { value: Math.round(ms / DAY), unit: "day" };
  if (abs >= HOUR) return { value: Math.round(ms / HOUR), unit: "hour" };
  if (abs >= MINUTE) return { value: Math.round(ms / MINUTE), unit: "minute" };
  return { value: Math.round(ms / 1000), unit: "second" };
}

/** Format a point in time; "now" is passed in so a caller can tick. */
export function formatTime(
  hass: HomeAssistant,
  when: Date,
  format: TimeFormat,
  now = Date.now(),
): string {
  const lang = language(hass);
  try {
    if (format === "relative") {
      const { value, unit } = span(when.getTime() - now);
      if (unit === "second") {
        return new Intl.RelativeTimeFormat(lang, { numeric: "auto" }).format(0, "second");
      }
      return new Intl.RelativeTimeFormat(lang, { numeric: "auto" }).format(value, unit);
    }
    if (format === "duration") {
      const { value, unit } = span(Math.max(0, now - when.getTime()));
      return new Intl.NumberFormat(lang, {
        style: "unit",
        unit,
        unitDisplay: "long",
      }).format(value);
    }
    const options: Intl.DateTimeFormatOptions = {};
    if (format === "date" || format === "datetime") {
      options.year = "numeric";
      options.month = "short";
      options.day = "numeric";
    }
    if (format === "time" || format === "datetime") {
      options.hour = "numeric";
      options.minute = "2-digit";
      options.hour12 = hour12(hass);
    }
    return new Intl.DateTimeFormat(lang, options).format(when);
  } catch {
    return when.toISOString();
  }
}

/**
 * Return when Home Assistant last started, guessed from the entities.
 *
 * After a restart most entities share the same last changed time. A time
 * close to it says nothing about the entity, so the card leaves it out.
 * At least six entities must share the time, so a small setup is not
 * mistaken for a restart.
 */
export function startTime(hass: HomeAssistant): number | undefined {
  const counts = new Map<string, number>();
  for (const stateObj of Object.values(hass.states)) {
    const key = stateObj.last_changed;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  let best: string | undefined;
  let bestCount = 0;
  for (const [key, count] of counts) {
    if (count > bestCount) {
      best = key;
      bestCount = count;
    }
  }
  return best && bestCount > 5 ? new Date(best).getTime() : undefined;
}

const START_MARGIN = 5 * MINUTE;

/** True when a time is within five minutes of the last start. */
export function isStartTime(hass: HomeAssistant, when: Date, start?: number): boolean {
  const started = start ?? startTime(hass);
  return started !== undefined && Math.abs(when.getTime() - started) < START_MARGIN;
}

/** The state of an entity as the dashboard shows it. */
export function entityState(hass: HomeAssistant, stateObj: HassEntity): string {
  if (hass.formatEntityState) {
    return hass.formatEntityState(stateObj);
  }
  const unit = stateObj.attributes.unit_of_measurement;
  return unit ? `${stateObj.state} ${String(unit)}` : stateObj.state;
}

/** An attribute of an entity as the dashboard shows it. */
export function entityAttribute(
  hass: HomeAssistant,
  stateObj: HassEntity,
  attribute: string,
): string {
  if (!(attribute in stateObj.attributes)) {
    return "";
  }
  if (hass.formatEntityAttributeValue) {
    return hass.formatEntityAttributeValue(stateObj, attribute);
  }
  const value = stateObj.attributes[attribute];
  return typeof value === "object" ? JSON.stringify(value) : String(value);
}

/** True when a state is an ISO time (a timestamp sensor). */
export function isTimestamp(stateObj: HassEntity): boolean {
  return stateObj.attributes.device_class === "timestamp";
}

/** A time to come, short: the time today, the weekday this week, else the date. */
export function formatWhen(hass: HomeAssistant, when: Date, now = Date.now()): string {
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  const days = Math.floor((when.getTime() - start.getTime()) / 86_400_000);
  const options: Intl.DateTimeFormatOptions = {
    hour: "numeric",
    minute: "2-digit",
    hour12: hour12(hass),
  };
  if (days >= 1 && days < 7) {
    options.weekday = "short";
  } else if (days >= 7 || days < 0) {
    options.month = "short";
    options.day = "numeric";
  }
  try {
    return new Intl.DateTimeFormat(language(hass), options).format(when);
  } catch {
    return when.toISOString();
  }
}

/** A day to come, without its time, date first: "Nov 15, Wednesday". */
export function formatDay(hass: HomeAssistant, when: Date, now = Date.now()): string {
  const options: Intl.DateTimeFormatOptions = { month: "short", day: "numeric" };
  if (when.getFullYear() > new Date(now).getFullYear() + 1) options.year = "numeric";
  try {
    const date = new Intl.DateTimeFormat(language(hass), options).format(when);
    return `${date}, ${weekday(hass, when)}`;
  } catch {
    return when.toDateString();
  }
}

/** The full name of a day's weekday, such as "Saturday". */
export function weekday(hass: HomeAssistant, when: Date): string {
  try {
    return new Intl.DateTimeFormat(language(hass), { weekday: "long" }).format(when);
  } catch {
    return when.toDateString();
  }
}

const WEEKDAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];

/** The first day of the week (0 = Sunday), from the user's profile or language. */
export function firstWeekday(hass: HomeAssistant): number {
  const setting = hass.locale?.first_weekday;
  const index = setting ? WEEKDAYS.indexOf(setting) : -1;
  if (index >= 0) return index;
  try {
    const locale = new Intl.Locale(language(hass)) as Intl.Locale & {
      getWeekInfo?: () => { firstDay: number };
      weekInfo?: { firstDay: number };
    };
    const info = locale.getWeekInfo?.() ?? locale.weekInfo;
    // Intl counts Monday as 1 and Sunday as 7.
    if (info) return info.firstDay % 7;
  } catch {
    // Fall through to Monday.
  }
  return 1;
}
