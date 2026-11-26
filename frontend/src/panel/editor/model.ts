// The notification as the editor holds it, and the conversions between
// its stored form and the form Home Assistant's own editors use.

import type {
  AudienceEntry,
  Button,
  CardHighlight,
  Category,
  ChannelSettings,
  Duration,
  NotificationState,
} from "../../shared/config";
import { BUILTIN_ORDER, categoryButtons, effectiveButtons } from "../../shared/live";
import type { HomeAssistant } from "../../shared/types";
import { type EntitiesKind, entitiesFilled } from "./entities-form";

export type Obj = Record<string, unknown>;

export type Unit = "days" | "weeks" | "months" | "years";

export type ExpiresOnDay = { day: number; at: string };

/** The Expires row of Done when and Dismiss when. */
export type Expires = Duration | ExpiresOnDay;

export interface Schedule {
  type: "calendar" | "after_last_done";
  every: number | string;
  unit: Unit;
  weekdays?: string[];
  day_of_month?: number | "last";
  month?: number;
  at?: string | null;
  starting?: string;
}

export type DataType =
  | "none"
  | "active_since"
  | "last_done"
  | "state"
  | "attribute"
  | "last_changed"
  | "last_updated"
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
}

/** Conditions: used at the activation and to hide an active card. */
export interface StepConditions {
  activate_only_while_met: boolean;
  hide_while_not_met: boolean;
  conditions: Obj[];
}

export interface EditorStep {
  id?: string;
  enabled: boolean;
  message: string;
  info?: string | null;
  data?: StepData | null;
  activation: Start;
  conditions: StepConditions;
  done_when: {
    triggers: Obj[];
    activation_conditions_no_longer_true: boolean;
    expires?: Expires | null;
  };
  dismiss_when: { triggers: Obj[]; expires?: Expires | null };
  buttons: Button[];
  // The people whose states differ from the category's audience.
  audience?: Record<string, AudienceEntry>;
  // What differs from the category's channels.
  channels?: Record<string, ChannelSettings>;
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
  /** Custom actions of single members, per button: they replace the group's. */
  member_actions?: Record<string, Obj>;
}

export interface EditorNotification {
  id?: string;
  name: string;
  category: string;
  enabled: boolean;
  icon?: string | null;
  color?: string | null;
  highlight?: CardHighlight | null;
  chime?: string | null;
  entities: EntityItem[];
  entity_groups: EntityGroup[];
  steps: EditorStep[];
  [key: string]: unknown;
}

export const DOMAIN_PREFIX = "notification_center.";
export const NOTIFICATION_STATE = "notification_center.notification_state";
export const ENTITIES_STATE = "notification_center.entities_state";
export const ENTITIES_NUMERIC = "notification_center.entities_numeric_state";
export const ENTITIES_KINDS = [ENTITIES_STATE, ENTITIES_NUMERIC];

const OWN_KINDS = [NOTIFICATION_STATE, ...ENTITIES_KINDS];

/**
 * A Notification state or Notification entities trigger (or condition) just
 * added to a list starts with this notification's sensor. Only when the
 * list grew, so a cleared field stays cleared.
 */
export function withOwnSensor(before: Obj[], after: Obj[], sensor: string | undefined): Obj[] {
  if (!sensor || after.length <= before.length) return after;
  return after.map((item) => {
    if (before.includes(item)) return item;
    const kind = (item.trigger ?? item.condition) as string | undefined;
    if (!kind || !OWN_KINDS.includes(kind)) return item;
    const options = (item.options as Obj | undefined) ?? {};
    if (options.notification) return item;
    return { ...item, options: { ...options, notification: sensor } };
  });
}

/** A step by its message, shortened; "Step N" while it has none. */
export function stepLabel(step: { message?: string | null }, index: number): string {
  // Placeholders and template variables read as plain words: {Area} and
  // {{ states('sensor.x') }} lose their braces.
  const text = (step.message ?? "")
    .replace(/\{\{-?\s*(.*?)\s*-?\}\}/g, "$1")
    .replace(/\{%-?.*?-?%\}/g, "")
    .replace(/\{(\w+(?: \w+)?)\}/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
  if (!text) return `Step ${index + 1}`;
  return text.length > 28 ? `${text.slice(0, 27)}…` : text;
}

/** A new notification: one step that only the trigger action starts. */
export function newNotification(category?: Category): EditorNotification {
  return {
    name: "",
    category: category?.id ?? "general",
    enabled: true,
    entities: [],
    entity_groups: [],
    steps: [newStep()],
  };
}

/**
 * A new step: every built-in button is listed (so an entity action can
 * point to it) and follows the category: nothing of it is stored.
 */
export function newStep(): EditorStep {
  return {
    enabled: true,
    message: "",
    activation: { type: "triggers", triggers: [] },
    conditions: { activate_only_while_met: true, hide_while_not_met: true, conditions: [] },
    done_when: { triggers: [], activation_conditions_no_longer_true: false },
    dismiss_when: { triggers: [] },
    buttons: BUILTIN_ORDER.map((type) => ({ id: newId(), type }) as Button),
    audience: {},
    channels: {},
  };
}

/**
 * A step's entry of a category's button, with empty values left out (they
 * follow the category). A value chosen equal to the category's stays: it
 * no longer follows the category. The entry itself stays, so an entity
 * action can keep pointing to its id.
 */
export function inheritedEntry(entry: Button): Button {
  const copy: Partial<Button> = { ...entry };
  if (copy.enabled === undefined || copy.enabled === null) delete copy.enabled;
  if (!copy.label) delete copy.label;
  if (!copy.icon) delete copy.icon;
  if (copy.show_in_push === undefined || copy.show_in_push === null) delete copy.show_in_push;
  if (!copy.snooze?.length) delete copy.snooze;
  if (!copy.open_on_tap) delete copy.open_on_tap;
  return copy as Button;
}

/** Whether a step's entry of a category's button has anything of its own. */
export function entryHasOwn(entry: Button | undefined): boolean {
  return !!entry && Object.keys(entry).some((key) => key !== "id" && key !== "type");
}

/**
 * When a notification moves to another category, the custom buttons of the
 * old category it used become its own ones, with the label and icon they
 * showed. As Home Assistant does on save.
 */
export function detachCategoryButtons(
  draft: EditorNotification,
  previous: Category | undefined,
  next: Category | undefined,
): void {
  const keep = new Set(categoryButtons(next).filter((b) => b.type === "custom").map((b) => b.id));
  const sources = categoryButtons(previous).filter((b) => b.type === "custom" && !keep.has(b.id));
  for (const step of draft.steps) {
    for (const source of sources) {
      let entry = step.buttons.find((b) => b.type === "custom" && b.id === source.id);
      if (!entry) {
        if (!source.enabled) continue;
        entry = { id: source.id, type: "custom", actions: {} } as Button;
        step.buttons.push(entry);
      }
      entry.enabled ??= source.enabled;
      entry.label ||= source.label || "Button";
      entry.icon ||= source.icon ?? undefined;
      entry.show_in_push ??= source.show_in_push ?? true;
    }
  }
}

/**
 * A new id for an item, so an entity action can point to a new button.
 * Not crypto.randomUUID: browsers offer it only on HTTPS (or localhost),
 * and Home Assistant is often opened over plain HTTP.
 */
export function newId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

/** A place for an entity action: a switched on button that runs one. */
export interface ActionSlot {
  id: string;
  label: string;
}

const BUTTON_NAMES: Record<string, string> = {
  tap: "Tap behavior",
  done: "Done",
  dismiss: "Dismiss",
  snooze: "Snooze",
  mute: "Mute",
  custom: "Button",
};

/**
 * The buttons whose action is Entity action, in every step ("Step 1 ·
 * Mute"; without the step when there is only one).
 */
export function entityActionSlots(draft: EditorNotification, category?: Category): ActionSlot[] {
  const many = draft.steps.length > 1;
  return draft.steps.flatMap((step, index) =>
    effectiveButtons(category, step)
      .filter((button) => button.enabled && !!button.actions?.entity_action && button.id)
      .map((button) => {
        const name = button.type === "tap" ? BUTTON_NAMES.tap : button.label || BUTTON_NAMES[button.type];
        return { id: button.id, label: many ? `Step ${index + 1} · ${name}` : name };
      }),
  );
}

/** The buttons some entity or entity group has an action for. */
export function buttonsWithEntityActions(draft: EditorNotification): Set<string> {
  const ids = new Set<string>();
  for (const item of [...draft.entities, ...draft.entity_groups]) {
    for (const [id, actions] of Object.entries(item.actions ?? {})) {
      if (Array.isArray(actions) && actions.length) ids.add(id);
    }
  }
  return ids;
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
  if (kind !== NOTIFICATION_STATE && !ENTITIES_KINDS.includes(kind)) return item;
  if (item.options && typeof item.options === "object") return item;
  const { [key]: _kind, target, ...options } = item;
  void _kind;
  if (kind === NOTIFICATION_STATE) {
    // This notification's sensor too (empty only until it has one); the
    // built-in row drops it again (markState).
    const ref = options.notification;
    const sensor = sensorOf(state, ref || selfId);
    if (sensor) options.notification = sensor;
    else if (!ref || ref === selfId) delete options.notification;
    if (typeof options.step === "string") {
      const number = numbers.get(`${String(ref || selfId)}|${options.step}`);
      if (number !== undefined) options.step = number;
    }
  } else {
    // Notification entities: the notification is always shown, this one's
    // sensor too; empty (this one) only until it has a sensor.
    const ref = options.notification;
    const sensor = sensorOf(state, ref || selfId);
    if (sensor) options.notification = sensor;
    else if (!ref || ref === selfId) delete options.notification;
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
  const selfSensor = sensorOf(state, draft.id);
  draft.steps.forEach((step, index) => {
    if (step.activation.type === "triggers") {
      step.activation.triggers = triggers(step.activation.triggers);
      // The first trigger on this notification's own entities is the one
      // at the top of Start, which has no notification field.
      const first = step.activation.triggers[0];
      const options = first?.options as Obj | undefined;
      if (
        first &&
        options &&
        ENTITIES_KINDS.includes(String(first.trigger)) &&
        (!options.notification || options.notification === selfSensor)
      ) {
        delete options.notification;
        first[PINNED] = true;
      }
      // Steps 2 and later: a Notification state trigger on this
      // notification, first after the one above, is the row at the top.
      if (index > 0) {
        markState(step.activation.triggers, first?.[PINNED] ? 1 : 0, "trigger", selfSensor);
      }
    }
    step.conditions = {
      activate_only_while_met: step.conditions?.activate_only_while_met ?? true,
      hide_while_not_met: step.conditions?.hide_while_not_met ?? true,
      conditions: conditions(step.conditions?.conditions),
    };
    if (index > 0) markState(step.conditions.conditions, 0, "condition", selfSensor);
    step.done_when = {
      triggers: triggers(step.done_when?.triggers),
      activation_conditions_no_longer_true: step.done_when?.activation_conditions_no_longer_true ?? false,
      expires: step.done_when?.expires ?? null,
    };
    step.dismiss_when = {
      triggers: triggers(step.dismiss_when?.triggers),
      expires: step.dismiss_when?.expires ?? null,
    };
    // Every button has an id, so an entity action can point to it.
    for (const button of step.buttons) button.id ||= newId();
  });
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
    const start = step.activation;
    // The trigger at the top of Start is saved only when it tests something.
    const pinned = pinnedEntities(step);
    const triggers = savedState(start.triggers ?? [])
      .filter((item) => item !== pinned?.item || entitiesFilled(pinned.kind, pinned.options))
      .map((item) => {
        const { [PINNED]: _pinned, ...rest } = item;
        void _pinned;
        if (item !== pinned?.item) return rest;
        // Only the fields of the chosen kind: both are kept while editing.
        const drop = pinned.kind === "state" ? NUMERIC_ONLY : STATE_ONLY;
        const options = Object.fromEntries(
          Object.entries(pinned.options).filter(([key]) => !drop.includes(key)),
        );
        return { ...rest, options };
      });
    step.conditions = { ...step.conditions, conditions: savedState(step.conditions.conditions) };
    if (!step.done_when.expires) delete step.done_when.expires;
    if (!step.dismiss_when.expires) delete step.dismiss_when.expires;
    step.activation =
      start.type === "schedule"
        ? { type: "schedule", schedule: start.schedule! }
        : { type: "triggers", triggers };
    if (step.data && step.data.type === "none") step.data = null;
    if (!step.info) delete step.info;
    // A new step's buttons get their ids from Home Assistant.
    step.buttons = step.buttons.map((button) => {
      const copy: Obj = { ...button };
      if (!copy.id) delete copy.id;
      return copy as unknown as Button;
    });
  }
  for (const key of ["icon", "color", "chime"] as const) {
    if (saved[key] === undefined || saved[key] === null || saved[key] === "") delete saved[key];
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

const STATE_ONLY = ["to", "not_to"];
const NUMERIC_ONLY = ["above", "below", "value_template"];

// Marks the trigger at the top of Start while it is edited; not saved.
export const PINNED = "_nc_pinned";

export interface PinnedEntities {
  item: Obj;
  kind: EntitiesKind;
  options: Obj;
}

/**
 * The trigger at the top of Start: the first trigger, when it tests this
 * notification's own entities (it has no notification field).
 */
export function pinnedEntities(step: EditorStep): PinnedEntities | undefined {
  if (step.activation.type !== "triggers") return undefined;
  const item = step.activation.triggers?.[0];
  if (!item?.[PINNED]) return undefined;
  const options = (item.options as Obj | undefined) ?? {};
  return { item, kind: item.trigger === ENTITIES_NUMERIC ? "numeric" : "state", options };
}

/** The Step of the built-in Notification state row set to any step (left out when saved). */
export const ANY_STEP = "any";

// Marks the Notification state row (steps 2 and later) while it is edited.
export const PINNED_STATE = "_nc_pinned_state";

function markState(
  items: Obj[],
  at: number,
  key: "trigger" | "condition",
  selfSensor: string | undefined,
): void {
  const item = items[at];
  const options = item?.options as Obj | undefined;
  if (
    item &&
    options &&
    item[key] === NOTIFICATION_STATE &&
    (!options.notification || options.notification === selfSensor)
  ) {
    delete options.notification;
    // Saved without a step: any step.
    if (options.step === undefined) options.step = ANY_STEP;
    item[PINNED_STATE] = true;
  }
}

/** The Notification state row of a list of triggers or conditions. */
export function pinnedState(items: Obj[] | undefined): Obj | undefined {
  return (items ?? []).find((item) => item[PINNED_STATE]);
}

/** The items without the Notification state row's mark; the row only when it is set. */
function savedState(items: Obj[]): Obj[] {
  return items
    .filter((item) => !item[PINNED_STATE] || !!(item.options as Obj | undefined)?.state)
    .map((item) => {
      if (!item[PINNED_STATE]) return item;
      const { [PINNED_STATE]: _mark, ...rest } = item;
      void _mark;
      const options = { ...((rest.options as Obj | undefined) ?? {}) };
      if (options.step === ANY_STEP) delete options.step;
      return { ...rest, options };
    });
}

/** True when the trigger at the top of Start tests something. */
export function pinnedFilled(step: EditorStep): boolean {
  const pinned = pinnedEntities(step);
  return !!pinned && entitiesFilled(pinned.kind, pinned.options);
}

// Domains whose entities are on or off.
const ON_OFF_DOMAINS = ["binary_sensor", "input_boolean", "switch", "light", "fan"];

/**
 * A new notification whose listed entities are all on or off: its first
 * step starts when one of them turns on, unless it has a start already.
 */
export function prefillPinned(hass: HomeAssistant, draft: EditorNotification): EditorNotification {
  const listed = listedEntities(hass, draft);
  const step = draft.steps[0];
  if (
    !listed.length ||
    !step ||
    step.activation.type !== "triggers" ||
    (step.activation.triggers ?? []).length ||
    !listed.every((entityId) => ON_OFF_DOMAINS.includes(entityId.split(".")[0]))
  ) {
    return draft;
  }
  const first: EditorStep = {
    ...step,
    activation: {
      ...step.activation,
      triggers: [{ trigger: ENTITIES_STATE, options: { to: ["on"] }, [PINNED]: true }],
    },
  };
  return { ...draft, steps: [first, ...draft.steps.slice(1)] };
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
  // Area ▸ device. The device a device connects through (a Zigbee2MQTT
  // bridge, a hub) is left out: it says nothing about the entity.
  const secondary = [area, name ? deviceName : ""].filter(Boolean).join(" ▸ ");
  return { primary, secondary };
}
