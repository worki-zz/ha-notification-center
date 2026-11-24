// The editor of the Notification badge: Home Assistant's entity badge
// editor (Entity, then Content and Interactions, with its own elements),
// and for a notification's sensor its own state content and the
// Notification options (Show when the notification is, Ignore audience).

import { LitElement, css, html, nothing } from "lit";
import { property, state } from "lit/decorators.js";

import type { HomeAssistant } from "../shared/types";
import { loadEditorElements } from "./elements";
import { NC_OPTION_HELPERS, NC_OPTION_LABELS, ncOptionsData, ncOptionsSchema, storeNcOptions } from "./nc-options";
import { NC_STATE_CONTENT, type NcStateContent, type NotificationBadgeConfig } from "./notification-center-badge";
import { isNotificationEntity } from "./notification-center-card";

const EDITOR_TYPE = "notification-center-badge-editor";

const NC_CONTENT_LABELS: Record<NcStateContent, string> = {
  message: "Message",
  info: "Info line",
  status: "Status",
  name: "Name",
};

// The elements Home Assistant's own badge editor offers.
const DISPLAYED = ["name", "state", "icon"] as const;

const LABELS: Record<string, string> = {
  displayed_elements: "Displayed elements",
  state_content: "State content",
};

const HELPERS: Record<string, string> = {
  icon: "Empty: the notification's icon.",
  color: "Empty: the notification's colour while active; snoozed orange, done green, else grey.",
};

type FormData = Record<string, unknown>;

class NotificationCenterBadgeEditor extends LitElement {
  @property({ attribute: false }) public hass?: HomeAssistant;

  @state() private _config?: NotificationBadgeConfig;

  @state() private _ready = false;

  public setConfig(config: NotificationBadgeConfig): void {
    this._config = config;
  }

  public override connectedCallback(): void {
    super.connectedCallback();
    void loadEditorElements().then(() => {
      this._ready = true;
    });
  }

  private _nc(): boolean {
    return !!this.hass && isNotificationEntity(this.hass, this._config?.entity);
  }

  private _formData(config: NotificationBadgeConfig): FormData {
    const { show_name: name = false, show_state: shown = true, show_icon: icon = true, ...rest } = config;
    const data: FormData = {
      ...rest,
      displayed_elements: [
        ...(name ? ["name"] : []),
        ...(shown ? ["state"] : []),
        ...(icon ? ["icon"] : []),
      ],
    };
    if (this._nc()) {
      const raw = config.state_content;
      const list = (Array.isArray(raw) ? raw : raw ? [raw] : []).filter((item) =>
        NC_STATE_CONTENT.includes(item as NcStateContent),
      );
      data.state_content = list.length ? list : ["message"];
      Object.assign(data, ncOptionsData(config));
    }
    return data;
  }

  private _schema() {
    const nc = this._nc();
    const displayed = {
      name: "displayed_elements",
      selector: {
        select: {
          mode: "list",
          multiple: true,
          options: DISPLAYED.map((value) => ({
            value,
            label:
              this.hass!.localize?.(`ui.panel.lovelace.editor.badge.entity.displayed_elements_options.${value}`) ||
              value[0].toUpperCase() + value.slice(1),
          })),
        },
      },
    };
    const stateContent = nc
      ? {
          name: "state_content",
          selector: {
            select: {
              mode: "dropdown",
              multiple: true,
              reorder: true,
              options: NC_STATE_CONTENT.map((value) => ({ value, label: NC_CONTENT_LABELS[value] })),
            },
          },
        }
      : {
          name: "state_content",
          selector: { ui_state_content: { allow_name: true } },
          context: { filter_entity: "entity" },
        };
    return [
      { name: "entity", selector: { entity: {} } },
      {
        name: "content",
        type: "expandable",
        flatten: true,
        iconPath: "M4,9H20V11H4V9M4,13H14V15H4V13Z",
        schema: [
          nc
            ? { name: "name", selector: { text: {} } }
            : { name: "name", selector: { entity_name: {} }, context: { entity: "entity" } },
          {
            name: "",
            type: "grid",
            schema: [
              { name: "color", selector: { ui_color: { default_color: "state", include_state: true } } },
              { name: "icon", selector: { icon: {} }, context: { icon_entity: "entity" } },
              ...(nc ? [] : [{ name: "show_entity_picture", selector: { boolean: {} } }]),
            ],
          },
          displayed,
          stateContent,
        ],
      },
      ...(nc
        ? [
            {
              name: "notification",
              type: "expandable",
              flatten: true,
              title: "Notification",
              iconPath:
                "M21,19V20H3V19L5,17V11C5,7.9 7.03,5.17 10,4.29C10,4.19 10,4.1 10,4A2,2 0 0,1 12,2A2,2 0 0,1 14,4C14,4.1 14,4.19 14,4.29C16.97,5.17 19,7.9 19,11V17L21,19M14,21A2,2 0 0,1 12,23A2,2 0 0,1 10,21",
              schema: ncOptionsSchema(),
            },
          ]
        : []),
      {
        name: "interactions",
        type: "expandable",
        flatten: true,
        iconPath:
          "M10,9A1,1 0 0,1 11,8A1,1 0 0,1 12,9V13.47L13.21,13.6L18.15,15.79C18.68,16.03 19,16.56 19,17.14V21.5C18.97,22.32 18.32,22.97 17.5,23H11C10.62,23 10.26,22.85 10,22.57L5.1,18.37L5.84,17.6C6.03,17.39 6.3,17.28 6.58,17.28H6.8L10,19V9M11,5A4,4 0 0,1 15,9C15,10.5 14.2,11.77 13,12.46V11.24C13.61,10.69 14,9.89 14,9A3,3 0 0,0 11,6A3,3 0 0,0 8,9C8,9.89 8.39,10.69 9,11.24V12.46C7.8,11.77 7,10.5 7,9A4,4 0 0,1 11,5Z",
        schema: [
          { name: "tap_action", selector: { ui_action: { default_action: "more-info" } } },
          {
            name: "",
            type: "optional_actions",
            flatten: true,
            schema: ["hold_action", "double_tap_action"].map((name) => ({
              name,
              selector: { ui_action: { default_action: "none" } },
            })),
          },
        ],
      },
    ];
  }

  protected override render() {
    if (!this.hass || !this._config) return nothing;
    if (!this._ready) return html`<div class="loading">Loading…</div>`;
    return html`
      <ha-form
        .hass=${this.hass}
        .data=${this._formData(this._config)}
        .schema=${this._schema()}
        .computeLabel=${this._label}
        .computeHelper=${this._helper}
        @value-changed=${this._valueChanged}
      ></ha-form>
      ${this._nc()
        ? html`<div class="note">
            A tap runs the notification's Tap behavior, unless a tap action is set here.
          </div>`
        : nothing}
    `;
  }

  private _label = (schema: { name: string; title?: string }): string => {
    const own = LABELS[schema.name] ?? NC_OPTION_LABELS[schema.name];
    if (schema.name === "state_content" && this._nc()) return "State content";
    if (schema.title) return schema.title;
    const localize = this.hass?.localize;
    const key = ["color", "state_content", "show_entity_picture", "displayed_elements"].includes(schema.name)
      ? `ui.panel.lovelace.editor.badge.entity.${schema.name}`
      : `ui.panel.lovelace.editor.card.generic.${schema.name}`;
    return localize?.(key) || own || schema.name.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase());
  };

  private _helper = (schema: { name: string }): string | undefined => {
    if (this._nc()) return HELPERS[schema.name] ?? NC_OPTION_HELPERS[schema.name];
    if (schema.name === "color") {
      return this.hass?.localize?.("ui.panel.lovelace.editor.badge.entity.color_helper") || undefined;
    }
    return undefined;
  };

  private _valueChanged(ev: CustomEvent<{ value: FormData }>): void {
    ev.stopPropagation();
    if (!this._config) return;
    const { displayed_elements: displayed, ...rest } = ev.detail.value;
    const config: Record<string, unknown> = { ...rest, type: this._config.type };
    if (Array.isArray(displayed)) {
      config.show_name = displayed.includes("name");
      config.show_state = displayed.includes("state");
      config.show_icon = displayed.includes("icon");
    }
    const entity = config.entity as string | undefined;
    if (this.hass && isNotificationEntity(this.hass, entity)) {
      const content = config.state_content as string[] | undefined;
      if (!content?.length || (content.length === 1 && content[0] === "message")) {
        delete config.state_content;
      }
      storeNcOptions(config);
    } else {
      // Another entity: Home Assistant's own options only.
      delete config.show_when;
      delete config.ignore_audience;
      const content = config.state_content;
      if (
        !content ||
        (Array.isArray(content) &&
          (!content.length || content.every((item) => NC_STATE_CONTENT.includes(item as NcStateContent))))
      ) {
        delete config.state_content;
      }
    }
    for (const [key, item] of Object.entries(config)) {
      if (item === undefined || item === "") delete config[key];
    }
    this._config = config as unknown as NotificationBadgeConfig;
    this.dispatchEvent(
      new CustomEvent("config-changed", { detail: { config }, bubbles: true, composed: true }),
    );
  }

  static override styles = css`
    :host {
      display: flex;
      flex-direction: column;
      gap: 16px;
    }
    .loading,
    .note {
      color: var(--secondary-text-color);
    }
    .note {
      font-size: var(--ha-font-size-s, 12px);
    }
  `;
}

if (!customElements.get(EDITOR_TYPE)) {
  customElements.define(EDITOR_TYPE, NotificationCenterBadgeEditor);
}
