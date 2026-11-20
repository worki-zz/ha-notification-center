// The configuration as the backend sends it. Only the fields the frontend
// uses so far are typed; the backend schema (model.py) is the reference.

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
  push_tap?: boolean;
}

export interface ChannelSettings {
  modes?: string[];
  when?: { type: string; [key: string]: unknown };
  [key: string]: unknown;
}

export interface Category {
  id: string;
  name: string;
  icon?: string | null;
  card_color?: string | null;
  light_color?: number[] | null;
  chime?: string | null;
  // The built-in buttons (always there) and the category's custom ones.
  buttons: CategoryButton[];
  channels: Record<string, ChannelSettings>;
}

export type ButtonType = "tap" | "done" | "snooze" | "dismiss" | "custom";

export type ButtonAction =
  | { type: "nothing" }
  | { type: "ha_action"; actions: unknown[] }
  | { type: "entity_action" }
  | { type: "more_info"; entity_id?: string | null }
  | { type: "navigate"; path: string }
  | { type: "show_attachment" };

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
  action: ButtonAction;
  // The Snooze button's times (keys of SNOOZE_CHOICES): one snoozes at
  // once, more are offered on the card.
  snooze?: string[] | null;
  // Shown in the push notification (takes effect with the push channel).
  show_in_push?: boolean;
  /** Tap behavior: also when the push notification is tapped (default on). */
  push_tap?: boolean;
  confirm?: boolean;
}

/** A button as it works: the step's settings over the category's. */
export interface EffectiveButton extends Button {
  enabled: boolean;
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
  // Person entities who see the card; empty means everyone.
  audience?: string[];
}

export interface Notification {
  id: string;
  name: string;
  category: string;
  enabled: boolean;
  icon?: string | null;
  card_color?: string | null;
  steps: Step[];
}

export interface Person {
  person: string;
  name: string;
  picture?: string | null;
  notify?: string | null;
  device_type: "ios" | "android" | "other";
}

export interface GeneralSettings {
  snooze_tomorrow_at: string;
  [key: string]: unknown;
}

export interface NotificationCenterConfig {
  general: GeneralSettings;
  modes: Mode[];
  categories: Category[];
  notifications: Notification[];
  people: Person[];
  lights: { id: string; entity_id: string; name?: string }[];
  speakers: { id: string; entity_id: string; name?: string }[];
  chimes: { id: string; name: string }[];
}

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
  status: "active" | "hidden" | "snoozed" | "done" | "dismissed" | "expired";
  silenced?: boolean;
  since: string;
  state_since: string;
  snoozed_until: string | null;
  closed_at?: string | null;
  message: string | null;
  info: string | null;
  // The step's custom data text, rendered.
  data_text?: string | null;
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
}

export interface StateMessage {
  // The current mode; null when no mode applies (every channel sends).
  mode: string | null;
  notifications: Record<string, NotificationState>;
}

// "silence" keeps the card open but stops its channels (Keep it silently).
export type CardAction = "done" | "dismiss" | "snooze" | "silence";
