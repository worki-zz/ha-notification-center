// Texts of a card: plain text, a Home Assistant template, and the
// placeholders {Floor}, {Area}, {Device}, {Device class}, {Entity} and {State}.
//
// The same rules as the backend (render.py): the template is rendered
// first, then the placeholders are replaced in its result, so they never
// clash with Jinja. The template gets the card's entity as `entity`.

import { entityState } from "./format";
import type { HomeAssistant } from "./types";

export const PLACEHOLDERS = ["Floor", "Area", "Device", "Device class", "Entity", "State"] as const;

/** The name Home Assistant shows for a device class ("Moisture"). */
export function deviceClassName(hass: HomeAssistant | undefined, domain: string, deviceClass: string): string {
  const name =
    hass?.localize?.(`ui.dialogs.entity_registry.editor.device_classes.${domain}.${deviceClass}`) ||
    hass?.localize?.(`component.${domain}.entity_component.${deviceClass}.name`);
  return name || deviceClass.replace(/_/g, " ").replace(/^./, (first) => first.toUpperCase());
}

/** True when a text holds a template, as Home Assistant decides it. */
export function isTemplate(text: string | undefined | null): boolean {
  return !!text && (text.includes("{{") || text.includes("{%") || text.includes("{#"));
}

/** The placeholder values of an entity; a missing one falls back as in render.py. */
export function placeholderValues(
  hass: HomeAssistant,
  entityId: string | undefined,
): Record<string, string> {
  if (!entityId) return {};
  const stateObj = hass.states[entityId];
  const entry = hass.entities?.[entityId];
  const entityName =
    (stateObj?.attributes.friendly_name as string | undefined) ?? entry?.name ?? entityId;
  const values: Record<string, string> = {
    Entity: entityName,
    State: stateObj ? entityState(hass, stateObj) : "",
    "Device class":
      typeof stateObj?.attributes.device_class === "string"
        ? deviceClassName(hass, entityId.split(".")[0], stateObj.attributes.device_class)
        : "",
    Device: entityName,
    Area: "",
    Floor: "",
  };
  const device = entry?.device_id ? hass.devices?.[entry.device_id] : undefined;
  if (device) {
    values.Device = device.name_by_user || device.name || entityName;
  }
  const areaId = entry?.area_id || device?.area_id;
  const area = areaId ? hass.areas?.[areaId] : undefined;
  if (area) {
    values.Area = area.name;
    const floor = area.floor_id ? hass.floors?.[area.floor_id] : undefined;
    if (floor) values.Floor = floor.name;
  }
  return values;
}

/** The placeholders as plain words: {Area} reads Area. */
export function plainPlaceholders(text: string): string {
  return text.replace(/\{(\w+(?: \w+)?)\}/g, (token: string, name: string) =>
    (PLACEHOLDERS as readonly string[]).includes(name) ? name : token,
  );
}

export function replacePlaceholders(text: string, values: Record<string, string>): string {
  let result = text;
  for (const name of PLACEHOLDERS) {
    const token = `{${name}}`;
    if (result.includes(token)) {
      result = result.split(token).join(values[name] ?? "");
    }
  }
  return result;
}

interface RenderResult {
  result?: unknown;
  error?: string;
}

/**
 * Keeps the templates of a card rendered and up to date.
 *
 * `update` gets the texts the card shows now; templates no longer used are
 * unsubscribed. `get` returns a text ready to show: the rendered template
 * with its placeholders replaced; empty while it renders or when it fails
 * (the error goes to the browser console).
 */
export class TemplateTexts {
  private readonly _subs = new Map<
    string,
    { unsubscribe: Promise<() => Promise<void>>; value?: string }
  >();

  private _entityId?: string;

  constructor(private readonly _onChange: () => void) {}

  public update(hass: HomeAssistant, texts: (string | null | undefined)[], entityId?: string): void {
    if (entityId !== this._entityId) {
      this.clear();
      this._entityId = entityId;
    }
    const wanted = new Set(texts.filter((text): text is string => isTemplate(text)));
    for (const [text, sub] of this._subs) {
      if (!wanted.has(text)) {
        this._unsubscribe(sub.unsubscribe);
        this._subs.delete(text);
      }
    }
    for (const text of wanted) {
      if (this._subs.has(text)) continue;
      const entry: { unsubscribe: Promise<() => Promise<void>>; value?: string } = {
        unsubscribe: Promise.resolve(async () => undefined),
      };
      entry.unsubscribe = hass.connection.subscribeMessage<RenderResult>(
        (message) => {
          if (message.error !== undefined) {
            console.warn("Notification card template error:", message.error);
            return;
          }
          entry.value = message.result === undefined ? "" : String(message.result);
          this._onChange();
        },
        {
          type: "render_template",
          template: text,
          variables: { entity: entityId ?? null },
          report_errors: true,
        },
      );
      entry.unsubscribe.catch((err: unknown) => {
        console.warn("Notification card template error:", err);
      });
      this._subs.set(text, entry);
    }
  }

  public get(hass: HomeAssistant, text: string | null | undefined): string {
    if (!text) return "";
    const rendered = isTemplate(text) ? (this._subs.get(text)?.value ?? "") : text;
    return replacePlaceholders(rendered, placeholderValues(hass, this._entityId));
  }

  public clear(): void {
    for (const sub of this._subs.values()) {
      this._unsubscribe(sub.unsubscribe);
    }
    this._subs.clear();
  }

  private _unsubscribe(unsubscribe: Promise<() => Promise<void>>): void {
    void unsubscribe.then((stop) => stop()).catch(() => undefined);
  }
}
