// Home Assistant's Test item of a condition row checks the condition through
// the websocket API. Inside a notification, a Notification state or
// Notification entities condition leaves out its notification: it means
// this one. The editor gives the condition editor a copy of hass whose Test
// (and the validation before it) fills in this notification's sensor.

import type { HassMessage, HomeAssistant } from "../../shared/types";
import { DOMAIN_PREFIX, ENTITIES_KINDS, NOTIFICATION_STATE } from "./model";

type Obj = Record<string, unknown>;

const OWN_KINDS = [NOTIFICATION_STATE, ...ENTITIES_KINDS];

const NOT_SAVED = "Save the notification first: the test checks the saved notification.";

/** Whether a condition (or one inside it) is ours without a notification. */
function needsNotification(condition: unknown): boolean {
  if (!condition || typeof condition !== "object") return false;
  if (Array.isArray(condition)) return condition.some(needsNotification);
  const item = condition as Obj;
  if (typeof item.condition === "string" && OWN_KINDS.includes(item.condition)) {
    const options = (item.options as Obj | undefined) ?? item;
    return !options.notification;
  }
  return needsNotification(item.conditions);
}

/** The condition with this notification's sensor filled in. */
export function withNotification(condition: unknown, sensor: string): unknown {
  if (!condition || typeof condition !== "object") return condition;
  if (Array.isArray(condition)) return condition.map((item) => withNotification(item, sensor));
  const item = condition as Obj;
  if (typeof item.condition === "string" && item.condition.startsWith(DOMAIN_PREFIX)) {
    if (!OWN_KINDS.includes(item.condition)) return item;
    if (item.options && typeof item.options === "object") {
      const options = item.options as Obj;
      return options.notification ? item : { ...item, options: { ...options, notification: sensor } };
    }
    return item.notification ? item : { ...item, notification: sensor };
  }
  if (item.conditions !== undefined) {
    return { ...item, conditions: withNotification(item.conditions, sensor) };
  }
  return item;
}

const cache = new WeakMap<HomeAssistant, Map<string, HomeAssistant>>();

/**
 * A copy of hass for the condition editor of a notification. ``sensor`` is
 * the notification's sensor; none: the notification is not saved yet, and
 * a test of an own condition says so.
 */
export function conditionTestHass(
  hass: HomeAssistant | undefined,
  sensor: string | undefined,
): HomeAssistant | undefined {
  if (!hass?.callWS) return hass;
  const key = sensor ?? "";
  let byHass = cache.get(hass);
  if (!byHass) {
    byHass = new Map();
    cache.set(hass, byHass);
  }
  const known = byHass.get(key);
  if (known) return known;
  const callWS = hass.callWS.bind(hass);
  const wrapped = {
    ...hass,
    callWS: (<T>(msg: HassMessage): Promise<T> => {
      if (msg.type === "validate_config" && needsNotification(msg.conditions)) {
        if (!sensor) {
          // Valid as far as can be told: the Test that follows says why not.
          return Promise.resolve({ conditions: { valid: true, error: null } } as T);
        }
        return callWS<T>({ ...msg, conditions: withNotification(msg.conditions, sensor) });
      }
      if (msg.type === "test_condition" && needsNotification(msg.condition)) {
        if (!sensor) return Promise.reject(new Error(NOT_SAVED));
        return callWS<T>({ ...msg, condition: withNotification(msg.condition, sensor) });
      }
      return callWS<T>(msg);
    }) as HomeAssistant["callWS"],
  } as HomeAssistant;
  byHass.set(key, wrapped);
  return wrapped;
}
