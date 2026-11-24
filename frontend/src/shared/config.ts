// The configuration as the backend sends it. Only the fields the frontend
// uses so far are typed; the backend schema (model.py) is the reference.

/** How a card stands out: Normal (none) or one of the card's highlights. */
export type CardHighlight = "none" | "pulse" | "glow" | "alert";

export interface Mode {
  id: string;
  name: string;
  icon?: string | null;
  condition?: { type: string; [key: string]: unknown } | null;
}

export interface Duration {
  days?: number;
  hours?: number;
  minutes?: number;
  seconds?: number;
}

/** A button of a category: what its notifications inherit (no action). */
export interface CategoryButton {
  id: string;
  type: ButtonType;
  enabled: boolean;
  label?: string | null;
  icon?: string | null;
  snooze?: string[] | null;
  show_in_push?: boolean;
  open_on_tap?: string | null;
  // Tap: the actions of its notifications' Tap (left out: more info).
  actions?: ButtonActions;
  // Tap: the button its notifications' Tap runs (a built-in one by its
  // type, a custom one by its id; empty: their own actions).
  run_button?: string | null;
}

/**
 * A channel's settings. A category has them all; a step stores only what it
 * changes (``delay: null`` there: at once, over the category's delay).
 */
export interface ChannelSettings {
  modes?: string[];
  delay?: Duration | null;
  [key: string]: unknown;
}

/** The states of a person a notification is for. */
export type AudienceState = "home" | "sleep" | "away";
export type AudienceEntry = Record<AudienceState, boolean>;
export const AUDIENCE_STATES: AudienceState[] = ["home", "sleep", "away"];

/** The Dashboard channel: the panel and the dashboard cards. */
export const CHANNEL_DASHBOARD = "dashboard";
/** The Push channel: the phones of the people (their notify actions). */
export const CHANNEL_PUSH = "push";

/** How a push arrives: silent, normal, time-sensitive or critical. */
export type PushPriority = "silent" | "normal" | "time_sensitive" | "critical";
export const PUSH_PRIORITIES: PushPriority[] = [
  "silent",
  "normal",
  "time_sensitive",
  "critical",
];
export const PUSH_PRIORITY_DEFAULT: PushPriority = "normal";

export interface Category {
  id: string;
  name: string;
  icon?: string | null;
  // A system colour by name, or an own colour (the Colors list) by its id.
  color?: string | null;
  // How its cards stand out (none: Normal); any highlight also makes the
  // lights pulse (or show their effect).
  highlight?: CardHighlight;
  // What the speakers play.
  chime?: string | null;
  // The built-in buttons (always there) and the category's custom ones.
  buttons: CategoryButton[];
  // The states each person gets the category's notifications in; a person
  // left out gets what the listed ones have in common.
  audience?: Record<string, AudienceEntry>;
  channels: Record<string, ChannelSettings>;
}

/** The categories by name (A to Z), the order they show in everywhere. */
export function sortedCategories<T extends { name: string }>(categories: readonly T[]): T[] {
  return [...categories].sort((a, b) =>
    a.name.localeCompare(b.name, undefined, { sensitivity: "base" }),
  );
}

export type ButtonType = "tap" | "done" | "snooze" | "dismiss" | "mute" | "custom";

/** Where a button takes the user, on the device it was pressed on. */
export type ButtonNavigation =
  | { type: "more_info"; entity_id?: string | null }
  | { type: "navigate"; path: string }
  // The notification's Status dialog, on the Overview.
  | { type: "notification_info" };

/** The notification state an own button or the Tap sets. */
export interface ButtonState {
  type: "done" | "dismiss" | "snooze";
  // Snooze: how long (a key of SNOOZE_CHOICES).
  snooze?: string;
}

/**
 * The actions of a button. They run in this fixed order: the entity
 * action, Mute, the notification state, the Home Assistant actions, then
 * the navigation. Left out: not used.
 */
export interface ButtonActions {
  entity_action?: boolean;
  // Not on the built-in Done, Dismiss and Snooze: they have their own.
  notification_state?: ButtonState;
  // Stop the lights, speakers and sirens; the card stays.
  mute?: boolean;
  ha_actions?: unknown[];
  navigation?: ButtonNavigation;
}

/**
 * A button of a step. Left out fields come from the category's button of
 * the same type (a custom button: the same id); see `effectiveButtons`.
 */
export interface Button {
  id: string;
  type: ButtonType;
  enabled?: boolean;
  label?: string | null;
  icon?: string | null;
  // Left out on a step's Tap: the category's Tap behavior.
  actions?: ButtonActions;
  // The Snooze button's times (keys of SNOOZE_CHOICES): one snoozes at
  // once, more are offered on the card.
  snooze?: string[] | null;
  // Shown in the push notification (takes effect with the push channel).
  show_in_push?: boolean;
  /** Tap behavior: the page a tap on the push opens (empty: the default). */
  open_on_tap?: string | null;
  /**
   * Tap behavior: run this button instead of its own actions (left out:
   * the category's; empty: its own actions). See `runButtonOf`.
   */
  run_button?: string | null;
}

/** A button as it works: the step's settings over the category's. */
export interface EffectiveButton extends Button {
  enabled: boolean;
  actions: ButtonActions;
  // Inherited from the category (built-in buttons and its custom ones).
  category: boolean;
}

// The text after the label of a card.
export interface StepData {
  type:
    | "none"
    | "active_since"
    | "last_done"
    | "state"
    | "attribute"
    | "last_changed"
    | "last_updated"
    | "custom";
  entity_id?: string | null;
  attribute?: string | null;
  text?: string | null;
  format?: "relative" | "duration" | "time" | "date" | "datetime" | null;
}

export interface Step {
  id: string;
  enabled: boolean;
  message: string;
  info?: string | null;
  data?: StepData | null;
  activation: { type: "triggers" | "schedule" };
  buttons: Button[];
  // The people whose states differ from the category's audience.
  audience?: Record<string, AudienceEntry>;
  // What differs from the category's channels.
  channels?: Record<string, ChannelSettings>;
}

export interface Notification {
  id: string;
  name: string;
  category: string;
  enabled: boolean;
  icon?: string | null;
  // Left out: the category's. A chime of "none" plays nothing.
  color?: string | null;
  highlight?: CardHighlight | null;
  chime?: string | null;
  steps: Step[];
}

export interface Person {
  person: string;
  name: string;
  picture?: string | null;
  notify?: string | null;
  device_type: "ios" | "android" | "other";
  // When the person is asleep (counted only at home), like a mode's condition.
  sleep?: Mode["condition"];
}

export interface GeneralSettings {
  snooze_tomorrow_at: string;
  // Read the message: the text-to-speech entity and its language.
  read_the_message?: { tts_service?: string | null; language?: string | null };
  // The order of the chimes (ids); the others follow by name.
  chime_order?: string[];
  // The page a tap on a push opens (empty: the panel's Overview).
  open_on_tap?: string | null;
  [key: string]: unknown;
}

export interface NotificationCenterConfig {
  general: GeneralSettings;
  modes: Mode[];
  categories: Category[];
  notifications: Notification[];
  people: Person[];
  lights: Light[];
  speakers: Speaker[];
  sirens: Siren[];
  chimes: Chime[];
  colors: OwnColor[];
}

/** An own colour of the Colors list. */
export interface OwnColor {
  id: string;
  name: string;
  rgb: number[];
}

/** A notification's chime that plays nothing, even when its category has one. */
export const CHIME_NONE = "none";
/** What a category without a chime of its own plays. */
export const CHIME_DEFAULT = "nc_chime";

/**
 * The CSS colour of a category's or notification's colour: a system colour
 * by name, or an own colour by its id.
 */
export function colorCss(config: { colors?: OwnColor[] } | undefined, color: string | null | undefined): string | undefined {
  if (!color) return undefined;
  const own = config?.colors?.find((item) => item.id === color);
  return own ? `rgb(${own.rgb.join(", ")})` : color;
}

/** The RGB of a colour: a system colour's or an own colour's. */
export function colorRgb(config: { colors?: OwnColor[] } | undefined, color: string | null | undefined): number[] {
  const own = config?.colors?.find((item) => item.id === color);
  return own?.rgb ?? SYSTEM_COLORS[color ?? "primary"] ?? SYSTEM_COLORS.primary;
}

/** A light (or a switch) of the Light channel. */
export interface Light {
  id: string;
  entity_id: string;
  brightness?: number | null;
  color_temp_kelvin?: number | null;
  illuminance_sensor?: string | null;
  dim_below?: number | null;
  dim_brightness?: number | null;
  dim_continuously?: boolean;
  // "notification_pulse" (own) or one of the light's effects.
  effect?: string;
  // The light's own RGB of the system and own colours (only what differs).
  colors?: Record<string, number[]>;
}

export interface Speaker {
  id: string;
  entity_id: string;
  volume?: number | null;
}

/** A siren, a switch, or a select (an option sounds, another stops it). */
export interface Siren {
  id: string;
  entity_id: string;
  tone?: string | null;
  volume?: number | null;
  duration?: number | null;
  option?: string | null;
  stop_option?: string | null;
}

export interface Chime {
  id: string;
  name: string;
  media: { media_content_id: string; media_content_type: string; metadata?: unknown };
}

/** The sounds that come with the integration, by chime id. */
export const BUILTIN_CHIMES: { id: string; name: string; file: string }[] = [
  { id: "nc_chime", name: "Chime", file: "chime.mp3" },
  { id: "nc_attention", name: "Attention", file: "attention.mp3" },
  { id: "nc_doorbell", name: "Doorbell", file: "doorbell.mp3" },
  { id: "nc_alarm", name: "Alarm", file: "alarm.mp3" },
  { id: "nc_alarm_indoor", name: "Indoor alarm", file: "alarm-indoor.mp3" },
];

/** Where the integration serves its built-in sounds (SOUNDS_URL_BASE in const.py). */
export const SOUNDS_URL = "/notification_center_sounds";

/**
 * Every chime, built-in and own, in the order of the Chimes page: as the
 * user ordered them, then the others by name.
 */
export function orderedChimes(config: NotificationCenterConfig | undefined): { id: string; name: string; builtin: boolean }[] {
  const all = [
    ...BUILTIN_CHIMES.map((chime) => ({ ...chime, builtin: true })),
    ...(config?.chimes ?? []).map((chime) => ({ id: chime.id, name: chime.name, builtin: false })),
  ];
  const order = config?.general?.chime_order ?? [];
  const rank = (id: string) => {
    const index = order.indexOf(id);
    return index < 0 ? order.length : index;
  };
  return all.sort((a, b) => rank(a.id) - rank(b.id) || a.name.localeCompare(b.name));
}

/** The RGB of the system colours, as the lights show them by default. */
export const SYSTEM_COLORS: Record<string, [number, number, number]> = {
  primary: [3, 169, 244],
  accent: [255, 152, 0],
  red: [244, 67, 54],
  pink: [233, 30, 99],
  purple: [146, 107, 199],
  "deep-purple": [110, 65, 171],
  indigo: [63, 81, 181],
  blue: [33, 150, 243],
  "light-blue": [3, 169, 244],
  cyan: [0, 188, 212],
  teal: [0, 150, 136],
  green: [76, 175, 80],
  "light-green": [139, 195, 74],
  lime: [205, 220, 57],
  yellow: [255, 235, 59],
  amber: [255, 193, 7],
  orange: [255, 152, 0],
  "deep-orange": [255, 111, 34],
  brown: [121, 85, 72],
  "light-grey": [189, 189, 189],
  grey: [158, 158, 158],
  "dark-grey": [96, 96, 96],
  "blue-grey": [96, 125, 139],
  black: [0, 0, 0],
  white: [255, 255, 255],
};

/** The system colours as a light shows them by default: a lamp has no grey, so the greys are white. */
export const LIGHT_DEFAULTS: Record<string, [number, number, number]> = {
  ...SYSTEM_COLORS,
  "light-grey": [255, 255, 255],
  grey: [255, 255, 255],
  "dark-grey": [255, 255, 255],
};

/** "#rrggbb" of an RGB. */
export function rgbToHex(rgb: number[]): string {
  return `#${rgb.map((part) => Math.max(0, Math.min(255, Math.round(part))).toString(16).padStart(2, "0")).join("")}`;
}

/** The RGB of "#rrggbb" or "r, g, b"; undefined for anything else. */
export function parseRgb(value: unknown): [number, number, number] | undefined {
  if (Array.isArray(value) && value.length === 3) return [Number(value[0]), Number(value[1]), Number(value[2])];
  if (typeof value !== "string") return undefined;
  const text = value.trim();
  const hex = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(text);
  if (hex) return [parseInt(hex[1], 16), parseInt(hex[2], 16), parseInt(hex[3], 16)];
  const parts = text.split(",").map((part) => Number(part.trim()));
  return parts.length === 3 && parts.every((part) => Number.isInteger(part) && part >= 0 && part <= 255)
    ? (parts as [number, number, number])
    : undefined;
}

/** Device sections and the prefix of their channel keys. */
export const DEVICE_PREFIXES = {
  lights: "light:",
  speakers: "speaker:",
  sirens: "siren:",
} as const;

export interface ConfigMessage {
  config: NotificationCenterConfig;
  has_data: boolean;
}

export const DOMAIN = "notification_center";

// The live state of the cards, from `notification_center/state/subscribe`.
export interface CardState {
  notification_id: string;
  step_id: string;
  entity_id: string | null;
  status: "active" | "hidden" | "snoozed" | "done" | "dismissed";
  muted?: boolean;
  since: string;
  state_since: string;
  // When it last became active (an active card).
  active_since?: string | null;
  snoozed_until: string | null;
  closed_at?: string | null;
  message: string | null;
  info: string | null;
  // The step's custom data text, rendered.
  data_text?: string | null;
  // Whether the Dashboard channel shows the card now, and to whom.
  dashboard?: ChannelView;
  // An active card: what every channel does now, by channel key.
  channels?: Record<string, ChannelView>;
}

/** Why a channel does not send a card now. */
export type ChannelReason = "off" | "mode" | "delay" | "audience";

export interface ChannelView {
  // The people it goes to now.
  people: string[];
  // The people of the audience (in at least one state).
  audience: string[];
  reason: ChannelReason | null;
  // The end of the delay.
  until: string | null;
  // Push: the people it goes to who have no phone set.
  no_phone?: string[];
}

export interface NotificationState {
  state: string;
  // The notification's sensor, when it is registered.
  entity_id?: string | null;
  cards: CardState[];
  last_done: string | null;
  next_due: string | null;
  // When each scheduled step is next due.
  upcoming?: { step_id: string; due: string }[];
  // When each step last reached each state (active, done, ...), by step id.
  history?: Record<string, Record<string, string>>;
}

export interface StateMessage {
  // The current mode; null when no mode applies (the channels with a tick
  // in any mode send).
  mode: string | null;
  // Each person: at home (awake), asleep or away.
  people?: Record<string, AudienceState>;
  notifications: Record<string, NotificationState>;
}

// "mute" keeps the card open but stops its channels (Mute).
export type CardAction = "done" | "dismiss" | "snooze" | "mute";
