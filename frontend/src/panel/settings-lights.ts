// The Light page of the General settings: the lights (and switches) of the
// Light channel. Add light picks the entity at once, with the default
// settings, then asks for the home modes it sends in, in every category.
// A light's dialog has two tabs: Settings (brightness, the effect of a
// highlighted notification, dimming when dark) and, for a colour light,
// Colors (each system colour as this light shows it). The fields follow
// what the light can do; the entity stays.

import { LitElement, css, html, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";

import {
  DOMAIN,
  type Light,
  LIGHT_DEFAULTS,
  type NotificationCenterConfig,
  rgbToHex,
} from "../shared/config";
import { errorText } from "../shared/live";
import type { HassEntity, HomeAssistant } from "../shared/types";
import { confirmDialog } from "./confirm";
import "./devices";
import {
  addEntityButton,
  channelIcon,
  entityName,
  entityState,
  testButton,
  testChannel,
} from "./devices";
import { field } from "./fields";

const RGB_MODES = ["hs", "xy", "rgb", "rgbw", "rgbww"];
const DIM_MODES = [...RGB_MODES, "color_temp", "brightness", "white"];

export const BLINK = "blink";

interface Capabilities {
  dims: boolean;
  rgb: boolean;
  temperature: boolean;
  effects: string[];
  minKelvin?: number;
  maxKelvin?: number;
}

/** What a light can do, from its state (a switch: on and off only). */
export function capabilities(state: HassEntity | undefined): Capabilities {
  const modes = (state?.attributes.supported_color_modes as string[] | undefined) ?? [];
  return {
    dims: modes.some((mode) => DIM_MODES.includes(mode)),
    rgb: modes.some((mode) => RGB_MODES.includes(mode)),
    temperature: modes.includes("color_temp"),
    effects: (state?.attributes.effect_list as string[] | undefined) ?? [],
    minKelvin: state?.attributes.min_color_temp_kelvin as number | undefined,
    maxKelvin: state?.attributes.max_color_temp_kelvin as number | undefined,
  };
}

/** "dark-grey" → "Dark grey". */
export function colorName(name: string): string {
  const text = name.replace(/-/g, " ");
  return text.charAt(0).toUpperCase() + text.slice(1);
}

type Draft = Light;

const NEW_LIGHT: Omit<Light, "id" | "entity_id"> = {
  brightness: 70,
  illuminance_sensor: null,
  dim_below: 30,
  dim_brightness: 30,
  dim_continuously: true,
  effect: BLINK,
  colors: {},
};

@customElement("nc-settings-lights")
export class NcSettingsLights extends LitElement {
  @property({ attribute: false }) public hass?: HomeAssistant;

  @property({ attribute: false }) public config?: NotificationCenterConfig;

  @state() private _edit?: Draft;

  @state() private _tab: "settings" | "colors" = "settings";

  // A new light, saved: the modes it sends in.
  @state() private _modesFor?: { key: string; name: string };

  @state() private _error?: string;

  @state() private _dialogError?: string;

  @state() private _busy = false;

  protected override render() {
    const lights = this.config?.lights ?? [];
    return html`
      ${this._error ? html`<ha-alert alert-type="error">${this._error}</ha-alert>` : nothing}
      ${lights.length
        ? html`<ha-card outlined>
            <div class="rows">${lights.map((light) => this._row(light))}</div>
          </ha-card>`
        : html`<ha-alert alert-type="info">No lights yet.</ha-alert>`}
      <div class="buttons">
        ${addEntityButton({
          hass: this.hass,
          label: "Add light",
          domains: ["light", "switch"],
          exclude: lights.map((light) => light.entity_id),
          picked: (entityId) => void this._add(entityId),
        })}
      </div>
      ${this._edit ? this._renderDialog(this._edit) : nothing}
      ${this._modesFor
        ? html`<nc-device-modes-dialog
            .hass=${this.hass}
            .modes=${this.config?.modes ?? []}
            .channel=${this._modesFor.key}
            .name=${this._modesFor.name}
            @closed-dialog=${() => (this._modesFor = undefined)}
          ></nc-device-modes-dialog>`
        : nothing}
    `;
  }

  private _row(light: Light) {
    const name = entityName(this.hass, light.entity_id);
    const can = capabilities(entityState(this.hass, light.entity_id));
    const parts: string[] = [];
    if (can.dims && light.brightness) parts.push(`Brightness ${light.brightness}%`);
    if (can.dims && light.illuminance_sensor) parts.push(`Dim: ${light.dim_brightness ?? 30}%`);
    parts.push(`Highlight: ${light.effect && light.effect !== BLINK ? light.effect : "Blink"}`);
    return html`<div class="row static">
      ${channelIcon(this.hass, { key: `light:${light.id}`, name, icon: "mdi:lightbulb-outline", entity_id: light.entity_id })}
      <div class="text">
        <div>${name}</div>
        <div class="secondary">${parts.join(" · ")}</div>
      </div>
      <ha-icon-button .label=${"Edit"} @click=${() => this._open(light)}>
        <ha-icon icon="mdi:pencil"></ha-icon>
      </ha-icon-button>
    </div>`;
  }

  private _open(light: Light): void {
    this._tab = "settings";
    this._dialogError = undefined;
    this._edit = structuredClone(light);
  }

  // A new light with the default settings; a row opens them later.
  private async _add(entityId: string): Promise<void> {
    if (!this.hass) return;
    this._error = undefined;
    try {
      const data = this._data({ id: "", entity_id: entityId, ...structuredClone(NEW_LIGHT) });
      const item = await this.hass.callWS<Light>({ type: `${DOMAIN}/item/create`, section: "lights", data });
      this._modesFor = { key: `light:${item.id}`, name: entityName(this.hass, item.entity_id) };
    } catch (err) {
      this._error = errorText(err);
    }
  }

  private _set(changes: Partial<Draft>): void {
    this._edit = { ...this._edit!, ...changes };
  }

  private _key(edit: Draft): string {
    return `light:${edit.id}`;
  }

  private async _test(edit: Draft, color?: string): Promise<void> {
    this._dialogError = undefined;
    try {
      await testChannel(this.hass, this._key(edit), {
        device: this._data(edit),
        ...(color ? { color, highlight: false } : {}),
      });
    } catch (err) {
      this._dialogError = errorText(err);
    }
  }

  private _renderDialog(edit: Draft) {
    const state = entityState(this.hass, edit.entity_id);
    const can = capabilities(state);
    const tabs = [
      { label: "Settings", value: "settings" },
      { label: "Colors", value: "colors" },
    ];
    const title = entityName(this.hass, edit.entity_id);
    return html`<ha-dialog
      open
      width="medium"
      header-title=${title}
      @closed=${(ev: Event) => {
        if (ev.target !== ev.currentTarget) return;
        ev.stopPropagation();
        this._edit = undefined;
      }}
    >
      ${testButton("Test", () => void this._test(edit))}
      <ha-icon-button slot="headerActionItems" .label=${"Delete"} @click=${() => void this._delete(edit)}>
        <ha-icon icon="mdi:delete"></ha-icon>
      </ha-icon-button>
      ${can.rgb
        ? html`<ha-tab-group
            @wa-tab-show=${(ev: CustomEvent<{ name: string }>) => {
              ev.stopPropagation();
              this._tab = ev.detail.name === "colors" ? "colors" : "settings";
            }}
          >
            ${tabs.map(
              (tab) => html`<ha-tab-group-tab slot="nav" panel=${tab.value} .active=${this._tab === tab.value}>
                ${tab.label}
              </ha-tab-group-tab>`,
            )}
          </ha-tab-group>`
        : nothing}
      <div class="form">
        ${this._dialogError ? html`<ha-alert alert-type="error">${this._dialogError}</ha-alert>` : nothing}
        ${can.rgb && this._tab === "colors" ? this._renderColors(edit) : this._renderSettings(edit, can)}
      </div>
      <ha-dialog-footer slot="footer">
        <ha-button slot="secondaryAction" appearance="plain" @click=${() => (this._edit = undefined)}>
          Cancel
        </ha-button>
        <ha-button slot="primaryAction" .disabled=${this._busy} @click=${this._save}>
          Save
        </ha-button>
      </ha-dialog-footer>
    </ha-dialog>`;
  }

  private _renderSettings(edit: Draft, can: Capabilities) {
    const effects = [
      { value: BLINK, label: "Blink" },
      ...can.effects.map((effect) => ({ value: effect, label: effect })),
    ];
    return html`
      ${can.dims
        ? field(
            this.hass,
            { number: { min: 1, max: 100, mode: "slider", unit_of_measurement: "%" } },
            edit.brightness ?? 70,
            "Brightness",
            (value) => this._set({ brightness: Number(value) || 70 }),
          )
        : nothing}
      ${can.temperature && !can.rgb
        ? field(
            this.hass,
            {
              number: {
                min: can.minKelvin ?? 2000,
                max: can.maxKelvin ?? 6500,
                step: 100,
                mode: "box",
                unit_of_measurement: "K",
              },
            },
            edit.color_temp_kelvin ?? undefined,
            "Color temperature",
            (value) => this._set({ color_temp_kelvin: value === undefined || value === "" ? null : Number(value) }),
            { helper: "Empty: the light's own." },
          )
        : nothing}
      ${field(
        this.hass,
        { select: { mode: "dropdown", options: effects } },
        can.effects.includes(edit.effect ?? "") ? edit.effect : BLINK,
        "Highlight effect",
        (value) => this._set({ effect: (value as string) || BLINK }),
        { helper: "How a highlighted notification shows." },
      )}
      ${can.dims ? this._renderDim(edit) : nothing}
    `;
  }

  private _renderDim(edit: Draft) {
    const sensor = field(
      this.hass,
      { entity: { filter: [{ domain: "sensor", device_class: "illuminance" }] } },
      edit.illuminance_sensor ?? undefined,
      "",
      (value) => this._set({ illuminance_sensor: (value as string) || null }),
      { placeholder: "Illuminance sensor" },
    );
    if (!edit.illuminance_sensor) return html`<div class="separator"></div><div class="title">Dim when dark</div>${sensor}`;
    return html`<div class="separator"></div>
      <div class="title">Dim when dark</div>
      <div class="row-fields top">
        ${sensor}
        ${field(
          this.hass,
          { number: { min: 0, mode: "box", unit_of_measurement: "lx" } },
          edit.dim_below ?? 30,
          "Dim below",
          (value) => this._set({ dim_below: Number(value ?? 30) }),
        )}
      </div>
      ${field(
        this.hass,
        { number: { min: 1, max: 100, mode: "slider", unit_of_measurement: "%" } },
        edit.dim_brightness ?? 30,
        "Dim brightness",
        (value) => this._set({ dim_brightness: Number(value) || 30 }),
      )}
      <div class="switch-row">
        <div>
          <div>Measure illuminance continuously</div>
          <div class="secondary">Follow the illuminance sensor while the light is on.</div>
        </div>
        <ha-switch
          .checked=${edit.dim_continuously ?? true}
          @change=${(ev: Event) => this._set({ dim_continuously: (ev.target as HTMLInputElement).checked })}
        ></ha-switch>
      </div>`;
  }

  // Each system and own colour as this light shows it: changed ones have a
  // reset.
  private _renderColors(edit: Draft) {
    const own = edit.colors ?? {};
    const system = Object.entries(LIGHT_DEFAULTS).map(([name, rgb]): [string, string, number[]] => [
      name,
      colorName(name),
      rgb,
    ]);
    const custom = (this.config?.colors ?? []).map((color): [string, string, number[]] => [
      color.id,
      color.name,
      color.rgb,
    ]);
    const row = ([name, label, rgb]: [string, string, number[]]) => {
      const value = own[name] ?? rgb;
      const changed = !!own[name];
      return html`<div class="color-row">
        <label class="swatch" style=${`background-color: ${rgbToHex(value)}`} title="Choose a color">
          <input
            type="color"
            .value=${rgbToHex(value)}
            @change=${(ev: Event) => {
              const hex = (ev.target as HTMLInputElement).value;
              const next = [1, 3, 5].map((start) => parseInt(hex.slice(start, start + 2), 16));
              const colors = { ...own };
              if (next.every((part, index) => part === rgb[index])) delete colors[name];
              else colors[name] = next;
              this._set({ colors });
            }}
          />
        </label>
        <div class="text">
          <div>${label}</div>
          <div class="secondary">${value.join(", ")}${changed ? "" : " (default)"}</div>
        </div>
        ${changed
          ? html`<ha-icon-button
              .label=${"Reset to the default"}
              @click=${() => {
                const colors = { ...own };
                delete colors[name];
                this._set({ colors });
              }}
            >
              <ha-icon icon="mdi:restore"></ha-icon>
            </ha-icon-button>`
          : nothing}
        <ha-icon-button
          .label=${"Test"}
          @click=${() => void this._test(edit, name)}
        >
          <ha-icon icon="mdi:play"></ha-icon>
        </ha-icon-button>
      </div>`;
    };
    return html`<p class="hint">
        How this light shows each color. Lights show colors differently: set the ones that look wrong.
      </p>
      <ha-card outlined class="colors">
        <div class="group-header">System colors</div>
        <div class="rows">${system.map(row)}</div>
      </ha-card>
      ${custom.length
        ? html`<ha-card outlined class="colors">
            <div class="group-header">Custom colors</div>
            <div class="rows">${custom.map(row)}</div>
          </ha-card>`
        : nothing}`;
  }

  private _data(edit: Draft): Record<string, unknown> {
    const { id: _id, ...data } = edit;
    void _id;
    const can = capabilities(entityState(this.hass, edit.entity_id));
    if (!can.effects.includes(data.effect ?? "")) data.effect = BLINK;
    return data;
  }

  private async _save(): Promise<void> {
    const edit = this._edit;
    if (!edit || !this.hass) return;
    this._busy = true;
    this._dialogError = undefined;
    try {
      const data = this._data(edit);
      await this.hass.callWS({ type: `${DOMAIN}/item/update`, section: "lights", item_id: edit.id, data });
      this._edit = undefined;
    } catch (err) {
      this._dialogError = errorText(err);
    } finally {
      this._busy = false;
    }
  }

  private async _delete(edit: Draft): Promise<void> {
    if (!this.hass) return;
    const name = entityName(this.hass, edit.entity_id);
    if (
      !(await confirmDialog(this, {
        title: `Delete ${name}?`,
        text: "The light leaves the Light channel of every category and notification.",
        confirm: "Delete",
        destructive: true,
      }))
    ) {
      return;
    }
    try {
      await this.hass.callWS({ type: `${DOMAIN}/item/delete`, section: "lights", item_id: edit.id });
      this._edit = undefined;
    } catch (err) {
      this._dialogError = errorText(err);
    }
  }

  static override styles = DEVICE_PAGE_STYLES();
}

/** The styles of the device pages (Light and Sound). */
export function DEVICE_PAGE_STYLES() {
  return css`
    :host {
      display: flex;
      flex-direction: column;
      gap: 16px;
    }
    ha-card {
      overflow: hidden;
    }
    .row,
    .color-row {
      display: flex;
      align-items: center;
      gap: 16px;
      padding: 8px 8px 8px 16px;
      min-height: 56px;
      box-sizing: border-box;
    }
    .row {
      cursor: pointer;
    }
    .row:hover,
    .row:focus-visible {
      background-color: var(--secondary-background-color);
      outline: none;
    }
    .rows > .row + .row,
    .color-row + .color-row {
      border-top: 1px solid var(--divider-color);
    }
    .channel-icon,
    .row > ha-icon {
      flex: none;
      color: var(--secondary-text-color);
    }
    ha-icon-next {
      color: var(--secondary-text-color);
    }
    .text {
      flex: 1;
      min-width: 0;
    }
    .secondary {
      color: var(--secondary-text-color);
      font-size: var(--ha-font-size-s, 12px);
    }
    .form {
      display: flex;
      flex-direction: column;
      gap: 16px;
    }
    .title,
    .block-title {
      font-weight: var(--ha-font-weight-medium, 500);
      margin-bottom: -8px;
    }
    .block-title {
      margin: 8px 0 -4px;
      font-size: var(--ha-font-size-l, 16px);
    }
    .hint {
      margin: 0;
      color: var(--secondary-text-color);
    }
    .row-fields {
      display: flex;
      gap: 16px;
      flex-wrap: wrap;
    }
    .row-fields.top {
      align-items: flex-start;
    }
    .row-fields > * {
      flex: 1 1 200px;
      min-width: 0;
    }
    .switch-row {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 16px;
    }
    ha-button-toggle-group {
      align-self: flex-start;
    }
    /* Tabs as in the editor's entity group dialog. */
    ha-tab-group {
      display: block;
      margin: -8px -24px 16px;
    }
    /* Full width, as in the channel and button dialogs. */
    .separator {
      border-top: 1px solid var(--divider-color);
      margin: 0 -24px;
    }
    /* A group of a list, as Home Assistant's list subheaders. */
    .group-header {
      display: flex;
      align-items: center;
      gap: 4px;
      min-height: 48px;
      padding: 0 8px 0 16px;
      font-size: var(--ha-font-size-s, 14px);
      font-weight: var(--ha-font-weight-medium, 500);
      color: var(--secondary-text-color);
      border-bottom: 1px solid var(--divider-color);
    }
    .rows + .group-header {
      border-top: 1px solid var(--divider-color);
    }
    .buttons {
      display: flex;
      gap: 8px;
      flex-wrap: wrap;
      align-items: center;
    }
    .row.static {
      cursor: default;
    }
    .row.static:hover {
      background-color: transparent;
    }
    .swatch {
      flex: none;
      width: 32px;
      height: 32px;
      border-radius: var(--ha-border-radius-circle, 50%);
      border: 1px solid var(--divider-color);
      cursor: pointer;
      overflow: hidden;
      position: relative;
    }
    .swatch input {
      position: absolute;
      inset: 0;
      opacity: 0;
      cursor: pointer;
      width: 100%;
      height: 100%;
      border: none;
      padding: 0;
    }
  `;
}

declare global {
  interface HTMLElementTagNameMap {
    "nc-settings-lights": NcSettingsLights;
  }
}
