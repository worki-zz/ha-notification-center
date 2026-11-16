// The configuration as the backend sends it. Only the fields the frontend
// uses so far are typed; the backend schema (model.py) is the reference.

export interface Mode {
  id: string;
  name: string;
  icon?: string | null;
  condition?: { type: string; [key: string]: unknown } | null;
}

export interface Category {
  id: string;
  name: string;
  icon?: string | null;
  card_color?: string | null;
}

export interface Step {
  id: string;
  enabled: boolean;
  message: string;
  start: { type: "triggers" | "schedule" };
}

export interface Notification {
  id: string;
  name: string;
  category: string;
  enabled: boolean;
  icon?: string | null;
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
  since: string;
  state_since: string;
  snoozed_until: string | null;
  message: string | null;
  info: string | null;
}

export interface NotificationState {
  state: string;
  cards: CardState[];
  last_done: string | null;
}

export interface StateMessage {
  mode: string;
  notifications: Record<string, NotificationState>;
}

export type CardAction = "done" | "dismiss" | "snooze";
