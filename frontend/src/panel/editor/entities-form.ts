// The form of a Notification entities trigger or condition: Home
// Assistant's own State and Numeric state trigger forms, without the entity
// field, since the entities are the ones a notification lists. Empty fields
// are left out, as in Home Assistant's forms.

import { LitElement, css, html, nothing } from "lit";
import { customElement, property } from "lit/decorators.js";

import type { HomeAssistant } from "../../shared/types";
import type { Obj } from "./model";

export type EntitiesKind = "state" | "numeric";

const BASE = "ui.panel.config.automation.editor.triggers.type";

// Attributes worth nothing in a test, as Home Assistant's forms hide them.
const HIDE_ATTRIBUTES = [
  "access_token",
  "available_modes",
  "code_arm_required",
  "code_format",
  "device_class",
  "editable",
  "effect_list",
  "entity_id",
  "entity_picture",
  "event_types",
  "fan_modes",
  "fan_speed_list",
  "friendly_name",
  "frontend_stream_type",
  "has_date",
  "has_time",
  "hvac_modes",
  "icon",
  "id",
  "max_color_temp_kelvin",
  "max_mireds",
  "max_temp",
  "max",
  "min_color_temp_kelvin",
  "min_mireds",
  "min_temp",
  "min",
  "mode",
  "operation_list",
  "options",
  "percentage_step",
  "preset_modes",
  "sound_mode_list",
  "source_list",
  "state_class",
  "step",
  "supported_color_modes",
  "supported_features",
  "swing_modes",
  "target_temp_step",
  "token",
  "unit_of_measurement",
];

const FOR = {
  name: "for",
  selector: {
    choose: {
      translation_key: `${BASE}.state.for_type`,
      choices: {
        duration: { selector: { duration: {} } },
        template: { selector: { template: {} } },
      },
    },
  },
};

function attributeField(entities: string[]) {
  return {
    name: "attribute",
    selector: { attribute: { entity_id: entities, hide_attributes: HIDE_ATTRIBUTES } },
  };
}

// Labels Home Assistant's translations lack in this version.
const OWN_LABELS: Record<string, string> = {
  "nc.match_type.choices.is": "Is",
  "nc.match_type.choices.is_not": "Is not",
};

const NOTIFICATION = {
  name: "notification",
  required: true,
  selector: { entity: { filter: { integration: "notification_center", domain: "sensor" } } },
};

function threshold(name: "above" | "below") {
  return {
    name,
    selector: {
      choose: {
        translation_key: `${BASE}.numeric_state.threshold_type`,
        choices: {
          value: { selector: { number: { mode: "box", step: "any" } } },
          input: { selector: { entity: { domain: ["input_number", "number", "sensor"] } } },
        },
      },
    },
  };
}

function stateSchema(entities: string[], attribute: string | undefined) {
  const states = { state: { multiple: true, entity_id: entities, attribute } };
  return [
    attributeField(entities),
    {
      name: "state",
      selector: {
        choose: {
          translation_key: "nc.match_type",
          choices: { is: { selector: states }, is_not: { selector: states } },
        },
      },
    },
    FOR,
  ];
}

function numericSchema(entities: string[]) {
  return [
    attributeField(entities),
    threshold("above"),
    threshold("below"),
    { name: "value_template", selector: { template: {} } },
    FOR,
  ];
}

const asList = (value: unknown): string[] =>
  value === undefined || value === null ? [] : Array.isArray(value) ? value.map(String) : [String(value)];

/** Whether the test is set: a state, a limit or a template. */
export function entitiesFilled(kind: EntitiesKind, options: Obj): boolean {
  return kind === "state"
    ? asList(options.to).length > 0 || asList(options.not_to).length > 0
    : ["above", "below", "value_template"].some(
        (key) => options[key] !== undefined && options[key] !== "",
      );
}

// Finds the entities a notification lists from its sensor; the editor sets
// it, since only it knows every notification.
let resolver: (sensor: string) => string[] = () => [];

export function setEntitiesResolver(find: (sensor: string) => string[]): void {
  resolver = find;
}

@customElement("nc-entities-form")
export class NcEntitiesForm extends LitElement {
  @property({ attribute: false }) public hass?: HomeAssistant;

  @property() public kind: EntitiesKind = "state";

  // The flat options: attribute, to / not_to, above, below, value_template,
  // for, and notification when it is shown.
  @property({ attribute: false }) public value: Obj = {};

  // The entities the test is about, for the attribute and state choices.
  @property({ attribute: false }) public entities: string[] = [];

  // Ask for the notification whose entities are watched.
  @property({ type: Boolean, attribute: "with-notification" }) public withNotification = false;

  @property({ type: Boolean }) public disabled = false;

  protected override render() {
    if (!this.hass) return nothing;
    const options = this.value;
    const notification = typeof options.notification === "string" ? options.notification : "";
    // The attribute and state choices come from the entities: the listed
    // ones, or those of the chosen notification.
    const entities = this.withNotification ? this._entitiesOf(notification) : this.entities;
    const data: Obj = { ...options };
    if (this.kind === "state") {
      delete data.to;
      delete data.not_to;
      const notTo = asList(options.not_to);
      const to = asList(options.to);
      if (options.not_to !== undefined) data.state = { active_choice: "is_not", is_not: notTo };
      else if (options.to !== undefined) data.state = { active_choice: "is", is: to };
    }
    const base =
      this.kind === "state"
        ? stateSchema(entities, options.attribute as string | undefined)
        : numericSchema(entities);
    const schema = this.withNotification ? [NOTIFICATION, ...base] : base;
    return html`<ha-form
      .hass=${this.hass}
      .data=${data}
      .schema=${schema}
      .disabled=${this.disabled}
      .localizeValue=${this._localizeValue}
      .computeLabel=${this._label}
      @value-changed=${this._changed}
    ></ha-form>`;
  }

  // The entities another notification lists.
  private _entitiesOf(sensor: string): string[] {
    return sensor ? resolver(sensor) : [];
  }

  private _localizeValue = (key: string): string =>
    OWN_LABELS[key] ?? this.hass?.localize?.(key) ?? key;

  private _label = (schema: { name: string }): string => {
    const localize = (key: string): string => this.hass?.localize?.(key) ?? "";
    switch (schema.name) {
      case "notification":
        return "Notification";
      case "attribute":
        return localize("ui.components.entity.entity-attribute-picker.attribute") || "Attribute";
      case "state":
        return localize("ui.components.entity.entity-state-picker.state") || "State";
      case "for":
        return localize(`${BASE}.state.for`) || "For";
      default:
        return localize(`${BASE}.numeric_state.${schema.name}`) || schema.name;
    }
  };

  private _changed(ev: CustomEvent<{ value: Obj }>): void {
    ev.stopPropagation();
    const value: Obj = { ...ev.detail.value };
    value.for = unwrap(value.for);
    if (this.kind === "state") {
      const match = value.state as { active_choice?: string; is?: unknown; is_not?: unknown } | undefined;
      delete value.state;
      delete value.to;
      delete value.not_to;
      if (match?.active_choice === "is_not") {
        // Switching keeps the states chosen.
        value.not_to = asList(match.is_not ?? match.is);
      } else if (match?.active_choice === "is") {
        value.to = asList(match.is ?? match.is_not);
      }
    } else {
      value.above = unwrap(value.above);
      value.below = unwrap(value.below);
    }
    for (const key of Object.keys(value)) {
      if (value[key] === undefined || value[key] === "" || value[key] === null) delete value[key];
    }
    this.dispatchEvent(new CustomEvent("value-changed", { detail: { value } }));
  }

  static override styles = css`
    :host {
      display: block;
    }
    /* Inside Home Assistant's trigger and condition rows. */
    :host([with-notification]) {
      padding: 0 16px 16px;
    }
  `;
}

// A choose selector's value: the value of the chosen kind.
function unwrap(value: unknown): unknown {
  if (!value || typeof value !== "object" || !("active_choice" in value)) return value;
  const choice = (value as Obj).active_choice as string;
  return (value as Obj)[choice];
}

declare global {
  interface HTMLElementTagNameMap {
    "nc-entities-form": NcEntitiesForm;
  }
}
