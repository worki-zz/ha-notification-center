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

export type Snooze =
  | { type: "not_allowed" }
  | { type: "fixed"; duration: Duration }
  | { type: "ask" };

export interface Category {
  id: string;
  name: string;
  icon?: string | null;
  card_color?: string | null;
  snooze?: Snooze;
}

export type ButtonType = "tap" | "done" | "snooze" | "dismiss" | "custom";

export type CardEffect = "done" | "snooze" | "dismiss" | "keep" | "keep_silent";

export type ButtonAction =
  | { type: "nothing" }
  | { type: "ha_action"; actions: unknown[] }
  | { type: "entity_action" }
  | { type: "more_info"; entity_id?: string | null }
  | { type: "navigate"; path: string }
  | { type: "show_attachment" };

export interface Button {
  id: string;
  type: ButtonType;
  enabled: boolean;
  label?: string | null;
  icon?: string | null;
  card: CardEffect;
  action: ButtonAction;
  // A button's own snooze: "ask" or a duration.
  snooze?: "ask" | Duration | null;
  confirm: boolean;
}

// The text after the label of a card.
export interface StepData {
  type:
    | "none"
    | "active_since"
    | "due"
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
  start: { type: "triggers" | "schedule" };
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
  snooze?: Snooze | null;
  steps: Step[];
}

export interface Person {
  person: string;
  name: string;
  picture?: string | null;
  notify?: string | null;
  device_type: "ios" | "android" | "other";
}

export interface NotificationCenterConfig {
  modes: Mode[];
  categories: Category[];
  notifications: Notification[];
  people: Person[];
  lights: { id: string; entity_id: string }[];
  speakers: { id: string; entity_id: string }[];
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
  mode: string;
  notifications: Record<string, NotificationState>;
}

// "silence" keeps the card open but stops its channels (Keep it silently).
export type CardAction = "done" | "dismiss" | "snooze" | "silence";
