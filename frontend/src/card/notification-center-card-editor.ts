import { LitElement, css, html, nothing } from "lit";
import { property, state } from "lit/decorators.js";

import { isTimestamp } from "../shared/format";
import type { HomeAssistant } from "../shared/types";
import { loadEditorElements } from "./elements";
import {
  isNotificationEntity,
  type DataType,
  type NotificationCardConfig,
} from "./notification-center-card";

const EDITOR_TYPE = "notification-center-card-editor";

// The form works on a flat copy of the options: the data options are
// `data_type`, `data_attribute`, `data_custom` and `data_time_format`, so
// every field sits next to `entity` (the attribute picker needs it).
type FormData = Record<string, unknown>;

interface SchemaItem {
  name: string;
  type?: string;
  title?: string;
  flatten?: boolean;
  expanded?: boolean;
  icon?: string;
  selector?: Record<string, unknown>;
  context?: Record<string, string>;
  schema?: SchemaItem[];
}

const LABELS: Record<string, string> = {
  entity: "Entity",
  label: "Label",
  message: "Message",
  info: "Info",
  icon: "Icon",
  color: "Color",
  highlight: "Highlight",
  data_type: "Data",
  data_attribute: "Attribute",
  data_custom: "Custom",
  data_time_format: "Time format",
  tap_action: "Tap action",
  buttons: "Buttons",
};

const HELPERS: Record<string, string> = {
  label: "Leave empty for the device or entity name.",
  message: "Text, a template, or {Floor}, {Area}, {Device}, {Device class}, {Entity}, {State}.",
  info: "Second line, optional. Text, a template, or placeholders.",
  data_custom: "Text, a template, or placeholders.",
};

const TIME_TYPES: DataType[] = ["last_changed", "last_updated"];

function option(value: string, label: string) {
  return { value, label };
}

class NotificationCenterCardEditor extends LitElement {
  @property({ attribute: false }) public hass?: HomeAssistant;

  @state() private _config?: NotificationCardConfig;

  @state() private _ready = false;

  public setConfig(config: NotificationCardConfig): void {
    this._config = config;
  }

  public override connectedCallback(): void {
    super.connectedCallback();
    void loadEditorElements().then(() => {
      this._ready = true;
    });
  }

  private _formData(config: NotificationCardConfig): FormData {
    const { data, ...rest } = config;
    return {
      ...rest,
      highlight: rest.highlight ?? "none",
      data_type: data?.type ?? "none",
      data_attribute: data?.attribute,
      data_custom: data?.custom,
      data_time_format: data?.time_format ?? "relative",
    };
  }

  private _schema(data: FormData): SchemaItem[] {
    const hass = this.hass!;
    const entityId = data.entity as string | undefined;
    const stateObj = entityId ? hass.states[entityId] : undefined;
    const type = data.data_type as DataType;
    const dataFields: SchemaItem[] = [
      {
        name: "data_type",
        selector: {
          select: {
            mode: "dropdown",
            options: [
              option("none", "None"),
              option("state", "State"),
              option("attribute", "Attribute"),
              option("last_changed", "Last changed"),
              option("last_updated", "Last updated"),
              option("custom", "Custom"),
            ],
          },
        },
      },
    ];
    if (type === "attribute") {
      dataFields.push({
        name: "data_attribute",
        selector: { attribute: {} },
        context: { filter_entity: "entity" },
      });
    }
    if (type === "custom") {
      dataFields.push({ name: "data_custom", selector: { text: {} } });
    }
    if (
      TIME_TYPES.includes(type) ||
      (type === "state" && stateObj !== undefined && isTimestamp(stateObj))
    ) {
      dataFields.push({
        name: "data_time_format",
        selector: {
          select: {
            mode: "dropdown",
            options: [
              option("relative", "Relative"),
              option("duration", "Duration"),
              option("time", "Time"),
              option("date", "Date"),
              option("datetime", "Date and time"),
            ],
          },
        },
      });
    }
    return [
      {
        name: "content",
        type: "expandable",
        title: "Content",
        icon: "mdi:text-short",
        flatten: true,
        expanded: true,
        // In the order of the card: the label, its data, the message, Info.
        schema: [
          { name: "label", selector: { text: {} } },
          ...dataFields,
          { name: "message", selector: { text: {} } },
          { name: "info", selector: { text: {} } },
        ],
      },
      {
        name: "appearance",
        type: "expandable",
        title: "Appearance",
        icon: "mdi:palette",
        flatten: true,
        schema: [
          { name: "icon", selector: { icon: {} }, context: { icon_entity: "entity" } },
          { name: "color", selector: { ui_color: { default_color: "primary" } } },
          {
            name: "highlight",
            selector: {
              select: {
                mode: "dropdown",
                options: [
                  option("none", "None"),
                  option("pulse", "Pulse"),
                  option("glow", "Glow"),
                  option("alert", "Alert"),
                ],
              },
            },
          },
        ],
      },
      {
        name: "buttons_section",
        type: "expandable",
        title: "Buttons",
        icon: "mdi:gesture-tap-button",
        flatten: true,
        schema: [
          {
            name: "buttons",
            selector: {
              object: {
                multiple: true,
                label_field: "label",
                fields: {
                  icon: { label: "Icon", selector: { icon: {} }, required: true },
                  label: { label: "Label", selector: { text: {} } },
                  tap_action: {
                    label: "Action",
                    selector: { ui_action: { default_action: "none" } },
                  },
                },
              },
            },
          },
        ],
      },
      {
        name: "interactions",
        type: "expandable",
        title: "Interactions",
        icon: "mdi:gesture-tap",
        flatten: true,
        schema: [{ name: "tap_action", selector: { ui_action: { default_action: "none" } } }],
      },
    ];
  }

  protected override render() {
    if (!this.hass || !this._config) return nothing;
    if (!this._ready) {
      return html`<div class="loading">Loading…</div>`;
    }
    const data = this._formData(this._config);
    const fromCenter = isNotificationEntity(this.hass, this._config.entity);
    return html`
      <ha-form
        .hass=${this.hass}
        .data=${data}
        .schema=${[{ name: "entity", selector: { entity: {} } }]}
        .computeLabel=${this._label}
        @value-changed=${this._valueChanged}
      ></ha-form>
      ${fromCenter
        ? html`<ha-alert alert-type="info">Settings from the Notification Center</ha-alert>`
        : html`<ha-form
            .hass=${this.hass}
            .data=${data}
            .schema=${this._schema(data)}
            .computeLabel=${this._label}
            .computeHelper=${this._helper}
            @value-changed=${this._valueChanged}
          ></ha-form>`}
    `;
  }

  private _label = (schema: SchemaItem): string => LABELS[schema.name] ?? schema.title ?? "";

  private _helper = (schema: SchemaItem): string | undefined => HELPERS[schema.name];

  private _valueChanged(ev: CustomEvent<{ value: FormData }>): void {
    ev.stopPropagation();
    if (!this._config) return;
    const value = { ...this._formData(this._config), ...ev.detail.value };
    const {
      data_type: dataType,
      data_attribute: attribute,
      data_custom: custom,
      data_time_format: timeFormat,
      ...rest
    } = value;
    const config: Record<string, unknown> = { ...rest };
    const type = (dataType as DataType | undefined) ?? "none";
    if (type !== "none") {
      config.data = {
        type,
        ...(type === "attribute" && attribute ? { attribute } : {}),
        ...(type === "custom" && custom ? { custom } : {}),
        ...(type !== "attribute" && type !== "custom" && timeFormat && timeFormat !== "relative"
          ? { time_format: timeFormat }
          : {}),
      };
    } else {
      delete config.data;
    }
    for (const [key, item] of Object.entries(config)) {
      if (
        item === undefined ||
        item === "" ||
        (key === "highlight" && item === "none") ||
        (Array.isArray(item) && item.length === 0)
      ) {
        delete config[key];
      }
    }
    this._config = config as unknown as NotificationCardConfig;
    this.dispatchEvent(
      new CustomEvent("config-changed", {
        detail: { config },
        bubbles: true,
        composed: true,
      }),
    );
  }

  static override styles = css`
    :host {
      display: flex;
      flex-direction: column;
      gap: 24px;
    }
    .loading {
      color: var(--secondary-text-color);
    }
  `;
}

if (!customElements.get(EDITOR_TYPE)) {
  customElements.define(EDITOR_TYPE, NotificationCenterCardEditor);
}
