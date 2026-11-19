// The notification as the editor holds it, and the conversions between
// its stored form and the form Home Assistant's own editors use.

import type { Button, Duration, NotificationState } from "../../shared/config";
import type { HomeAssistant } from "../../shared/types";

export type Obj = Record<string, unknown>;

export type Unit = "days" | "weeks" | "months" | "years";

export type ExpiresOnDay = { day: number; at: string };

export interface Schedule {
  type: "calendar" | "after_last_done";
  every: number | string;
  unit: Unit;
  weekdays?: string[];
  day_of_month?: number | "last";
  month?: number;
  at?: string | null;
  starting?: string;
  expires?: Duration | ExpiresOnDay | null;
}

export type DataType =
  | "none"
  | "active_since"
  | "due"
  | "last_done"
  | "state"
  | "attribute"
  | "last_changed"
  | "custom";

export interface StepData {
  type: DataType;
  entity_id?: string | null;
  attribute?: string | null;
  text?: string | null;
  format?: "relative" | "duration" | "time" | "date" | "datetime" | null;
}

export interface Start {
  type: "triggers" | "schedule";
  triggers?: Obj[];
  schedule?: Schedule;
  conditions: Obj[];
}

export interface EditorStep {
  id?: string;
  enabled: boolean;
  message: string;
  info?: string | null;
  data?: StepData | null;
  start: Start;
  hide_while: Obj[];
  done_when: { triggers: Obj[]; start_no_longer_true: boolean };
  buttons: Button[];
  audience?: string[];
  [key: string]: unknown;
}

export interface EntityItem {
  entity_id: string;
  enabled: boolean;
  actions?: Obj;
}

export interface EntityGroup {
  id?: string;
  domain: string;
  device_class?: string | null;
  areas: string[];
  floors: string[];
  labels: string[];
  add_new: boolean;
  members?: string[] | null;
  enabled: boolean;
  excluded: string[];
  actions?: Obj;
}

export interface EditorNotification {
  id?: string;
  name: string;
  category: string;
  enabled: boolean;
  icon?: string | null;
  card_color?: string | null;
  light_color?: number[] | null;
  entities: EntityItem[];
  entity_groups: EntityGroup[];
  steps: EditorStep[];
  [key: string]: unknown;
}

export const DOMAIN_PREFIX = "notification_center.";
export const NOTIFICATION_STATE = "notification_center.notification_state";
export const LISTED_ENTITIES = "notification_center.listed_entities";

/** A new notification: one step that only the trigger action starts. */
export function newNotification(): EditorNotification {
  return {
    name: "",
    category: "general",
    enabled: true,
    entities: [],
    entity_groups: [],
    steps: [newStep()],
  };
}

/** A new step: Done on, Snooze off (the decisions of phase 4). */
export function newStep(): EditorStep {
  return {
    enabled: true,
    message: "",
    start: { type: "triggers", triggers: [], conditions: [] },
    hide_while: [],
    done_when: { triggers: [], start_no_longer_true: false },
    buttons: [
      builtin("tap", false, "keep", { type: "more_info" }),
      builtin("done", true, "done"),
      builtin("dismiss", false, "dismiss"),
      builtin("snooze", false, "snooze"),
    ],
    audience: [],
  };
}

function builtin(
  type: Button["type"],
  enabled: boolean,
  card: Button["card"],
  action: Button["action"] = { type: "nothing" },
): Button {
  return { id: "", type, enabled, card, action, confirm: false } as Button;
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

// -- Own triggers ------------------------------------------------------------

/** The notification ids and their sensors, from the live state. */
export type SensorMap = Record<string, NotificationState>;

function sensorOf(state: SensorMap | undefined, id: unknown): string | undefined {
  if (typeof id !== "string") return undefined;
  return state?.[id]?.entity_id ?? undefined;
}

// Stored, flat with ids -> the automation form Home Assistant's editor uses.
function toEditorItem(
  item: Obj,
  key: "trigger" | "condition",
  selfId: string | undefined,
  numbers: Map<string, number>,
  state: SensorMap | undefined,
): Obj {
  const kind = String(item[key] ?? "");
  if (kind !== NOTIFICATION_STATE && kind !== LISTED_ENTITIES) return item;
  if (item.options && typeof item.options === "object") return item;
  const { [key]: _kind, target, ...options } = item;
  void _kind;
  if (kind === NOTIFICATION_STATE) {
    const ref = options.notification;
    if (ref === selfId || !ref) {
      delete options.notification;
    } else {
      const sensor = sensorOf(state, ref);
      if (sensor) options.notification = sensor;
    }
    if (typeof options.step === "string") {
      const number = numbers.get(`${String(ref)}|${options.step}`);
      if (number !== undefined) options.step = number;
    }
  } else {
    delete options.notification;
  }
  const result: Obj = { [key]: kind, options };
  if (target) result.target = target;
  return result;
}

/**
 * The notification in the editor's form: its own triggers and conditions
 * in the automation form, with the step numbers and sensors.
 */
export function toEditor(
  stored: EditorNotification,
  all: EditorNotification[],
  state: SensorMap | undefined,
): EditorNotification {
  const draft = clone(stored);
  const numbers = new Map<string, number>();
  for (const notification of all) {
    notification.steps.forEach((step, index) => {
      numbers.set(`${notification.id}|${step.id}`, index + 1);
    });
  }
  const triggers = (items: Obj[] | undefined) =>
    (items ?? []).map((item) => toEditorItem(item, "trigger", draft.id, numbers, state));
  const conditions = (items: Obj[] | undefined) =>
    (items ?? []).map((item) => toEditorItem(item, "condition", draft.id, numbers, state));
  for (const step of draft.steps) {
    step.start.conditions = conditions(step.start.conditions);
    if (step.start.type === "triggers") step.start.triggers = triggers(step.start.triggers);
    step.hide_while = conditions(step.hide_while);
    step.done_when = {
      triggers: triggers(step.done_when?.triggers),
      start_no_longer_true: step.done_when?.start_no_longer_true ?? false,
    };
    // Buttons and channels stay as they are (phase 4.2 and 6).
  }
  for (const group of draft.entity_groups) {
    group.areas ??= [];
    group.floors ??= [];
    group.labels ??= [];
    group.excluded ??= [];
  }
  return draft;
}

/** What is sent to Home Assistant: only the chosen start's fields. */
export function toSaved(draft: EditorNotification): EditorNotification {
  const saved = clone(draft);
  delete saved.id;
  for (const step of saved.steps) {
    const start = step.start;
    step.start =
      start.type === "schedule"
        ? { type: "schedule", schedule: start.schedule!, conditions: start.conditions }
        : { type: "triggers", triggers: start.triggers ?? [], conditions: start.conditions };
    if (step.data && step.data.type === "none") step.data = null;
    if (!step.info) delete step.info;
    // A new step's buttons get their ids from Home Assistant.
    step.buttons = step.buttons.map((button) => {
      const copy: Obj = { ...button };
      if (!copy.id) delete copy.id;
      return copy as unknown as Button;
    });
  }
  for (const key of ["icon", "card_color", "light_color"] as const) {
    if (saved[key] === undefined || saved[key] === "") delete saved[key];
  }
  return saved;
}

// -- Listed entities -----------------------------------------------------------

interface EntityEntry {
  entity_id: string;
  device_id?: string | null;
  area_id?: string | null;
  labels?: string[];
  hidden?: boolean;
  entity_category?: string | null;
}

interface DeviceEntry {
  area_id?: string | null;
  labels?: string[];
}

/** The entities a group matches now, before its own switches. */
export function groupMatches(hass: HomeAssistant, group: EntityGroup): string[] {
  const entities = (hass.entities ?? {}) as unknown as Record<string, EntityEntry>;
  const devices = (hass.devices ?? {}) as unknown as Record<string, DeviceEntry>;
  const areas = hass.areas ?? {};
  const result: string[] = [];
  const ids = new Set([
    ...Object.keys(hass.states).filter((id) => id.startsWith(`${group.domain}.`)),
  ]);
  for (const entityId of [...ids].sort()) {
    const state = hass.states[entityId];
    const entry = entities[entityId];
    const device = entry?.device_id ? devices[entry.device_id] : undefined;
    if (group.device_class && state?.attributes.device_class !== group.device_class) continue;
    if (group.areas.length || group.floors.length) {
      const areaId = entry?.area_id || device?.area_id;
      if (!areaId) continue;
      const area = areas[areaId];
      const inArea = group.areas.includes(areaId);
      const inFloor = !!area?.floor_id && group.floors.includes(area.floor_id);
      if (!inArea && !inFloor) continue;
    }
    if (group.labels.length) {
      const labels = new Set([...(entry?.labels ?? []), ...(device?.labels ?? [])]);
      if (!group.labels.some((label) => labels.has(label))) continue;
    }
    if (!group.add_new && group.members && !group.members.includes(entityId)) continue;
    result.push(entityId);
  }
  return result;
}

/** The entities of the list that are switched on, in order. */
export function listedEntities(hass: HomeAssistant, draft: EditorNotification): string[] {
  const result = draft.entities.filter((item) => item.enabled).map((item) => item.entity_id);
  for (const group of draft.entity_groups) {
    if (!group.enabled) continue;
    for (const entityId of groupMatches(hass, group)) {
      if (!group.excluded.includes(entityId) && !result.includes(entityId)) {
        result.push(entityId);
      }
    }
  }
  return result;
}

/** True when a step starts with a Listed entities trigger. */
export function startsWithListed(step: EditorStep): boolean {
  return (
    step.start.type === "triggers" &&
    (step.start.triggers ?? []).some((item) => item.trigger === LISTED_ENTITIES)
  );
}

/**
 * An entity's name as Home Assistant's pickers show it: the entity's own
 * name (or its device's), and below it the area and the device.
 */
export function entityDisplay(
  hass: HomeAssistant,
  entityId: string,
): { primary: string; secondary: string } {
  const state = hass.states[entityId];
  const entry = hass.entities?.[entityId];
  const device = entry?.device_id ? hass.devices?.[entry.device_id] : undefined;
  const deviceName = device ? device.name_by_user || device.name || "" : "";
  const friendly = (state?.attributes.friendly_name as string | undefined) ?? "";
  let name = entry ? (entry.name ?? "") : friendly;
  if (entry && !entry.name && !deviceName) name = friendly;
  // An entity named after its device plus a word: show only the word.
  if (deviceName && name.startsWith(`${deviceName} `)) name = name.slice(deviceName.length + 1);
  if (name === deviceName) name = "";
  const areaId = entry?.area_id || device?.area_id;
  const area = areaId ? hass.areas?.[areaId]?.name : undefined;
  const primary = name || deviceName || friendly || entityId;
  const secondary = [area, name ? deviceName : ""].filter(Boolean).join(" ▸ ");
  return { primary, secondary };
}
