// The Colors page of the General settings: Home Assistant's system colours
// (fixed), and the own colours, which can be added, renamed, changed and
// deleted. Every colour shows in the Color field of the categories and
// notifications, and on each light's Colors tab.

import { LitElement, css, html, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";

import { DOMAIN, type NotificationCenterConfig, type OwnColor, SYSTEM_COLORS, rgbToHex } from "../shared/config";
import { errorText } from "../shared/live";
import type { HomeAssistant } from "../shared/types";
import { confirmDialog } from "./confirm";
import { field } from "./fields";
import { DEVICE_PAGE_STYLES, colorName } from "./settings-lights";

type Draft = Partial<OwnColor> & { name: string; rgb: number[] };

@customElement("nc-settings-colors")
export class NcSettingsColors extends LitElement {
  @property({ attribute: false }) public hass?: HomeAssistant;

  @property({ attribute: false }) public config?: NotificationCenterConfig;

  @state() private _edit?: Draft;

  @state() private _error?: string;

  @state() private _busy = false;

  protected override render() {
    const own = this.config?.colors ?? [];
    return html`
      <ha-card outlined>
        <div class="group-header">System colors</div>
        <div class="rows">
          ${Object.entries(SYSTEM_COLORS).map(
            ([name, rgb]) => html`<div class="color-row">
              <span class="dot" style=${`background-color: var(--${name}-color, ${rgbToHex(rgb)})`}></span>
              <div class="text">
                <div>${colorName(name)}</div>
                <div class="secondary">${rgb.join(", ")}</div>
              </div>
            </div>`,
          )}
        </div>
        ${own.length
          ? html`<div class="group-header">Own colors</div>
              <div class="rows">
                ${own.map(
                  (color) => html`<div
                    class="row"
                    role="button"
                    tabindex="0"
                    @click=${() => this._open(structuredClone(color))}
                  >
                    <span class="dot" style=${`background-color: ${rgbToHex(color.rgb)}`}></span>
                    <div class="text">
                      <div>${color.name}</div>
                      <div class="secondary">${color.rgb.join(", ")}</div>
                    </div>
                    <ha-icon-next></ha-icon-next>
                  </div>`,
                )}
              </div>`
          : nothing}
      </ha-card>
      <div>
        <ha-button appearance="filled" size="s" @click=${() => this._open({ name: "", rgb: [255, 255, 255] })}>
          <ha-icon slot="start" icon="mdi:plus"></ha-icon>
          Add color
        </ha-button>
      </div>
      ${this._edit ? this._renderDialog(this._edit) : nothing}
    `;
  }

  private _open(draft: Draft): void {
    this._error = undefined;
    this._edit = draft;
  }

  private _renderDialog(edit: Draft) {
    return html`<ha-dialog
      open
      width="medium"
      header-title=${edit.id ? edit.name || "Color" : "Add color"}
      @closed=${(ev: Event) => {
        if (ev.target !== ev.currentTarget) return;
        ev.stopPropagation();
        this._edit = undefined;
      }}
    >
      ${edit.id
        ? html`<ha-icon-button slot="headerActionItems" .label=${"Delete"} @click=${() => void this._delete(edit)}>
            <ha-icon icon="mdi:delete"></ha-icon>
          </ha-icon-button>`
        : nothing}
      <div class="form">
        ${this._error ? html`<ha-alert alert-type="error">${this._error}</ha-alert>` : nothing}
        ${field(this.hass, { text: {} }, edit.name, "Name", (value) => {
          this._edit = { ...edit, name: (value as string) ?? "" };
        })}
        ${field(this.hass, { color_rgb: {} }, edit.rgb, "Color", (value) => {
          if (Array.isArray(value) && value.length === 3) this._edit = { ...edit, rgb: value as number[] };
        })}
      </div>
      <ha-dialog-footer slot="footer">
        <ha-button slot="secondaryAction" appearance="plain" @click=${() => (this._edit = undefined)}>
          Cancel
        </ha-button>
        <ha-button slot="primaryAction" .disabled=${this._busy || !edit.name.trim()} @click=${this._save}>
          Save
        </ha-button>
      </ha-dialog-footer>
    </ha-dialog>`;
  }

  private async _save(): Promise<void> {
    const edit = this._edit;
    if (!edit || !this.hass) return;
    const { id, ...data } = edit;
    data.name = data.name.trim();
    this._busy = true;
    this._error = undefined;
    try {
      if (id) {
        await this.hass.callWS({ type: `${DOMAIN}/item/update`, section: "colors", item_id: id, data });
      } else {
        await this.hass.callWS({ type: `${DOMAIN}/item/create`, section: "colors", data });
      }
      this._edit = undefined;
    } catch (err) {
      this._error = errorText(err);
    } finally {
      this._busy = false;
    }
  }

  private async _delete(edit: Draft): Promise<void> {
    if (!edit.id || !this.hass) return;
    if (
      !(await confirmDialog(this, {
        title: `Delete ${edit.name || "the color"}?`,
        text: "Categories that use it get the default color, and notifications their category's.",
        confirm: "Delete",
        destructive: true,
      }))
    ) {
      return;
    }
    try {
      await this.hass.callWS({ type: `${DOMAIN}/item/delete`, section: "colors", item_id: edit.id });
      this._edit = undefined;
    } catch (err) {
      this._error = errorText(err);
    }
  }

  static override styles = [
    DEVICE_PAGE_STYLES(),
    css`
      .dot {
        flex: none;
        width: 24px;
        height: 24px;
        border-radius: 50%;
        border: 1px solid var(--divider-color);
        box-sizing: border-box;
      }
      .rows + .group-header {
        border-top: 1px solid var(--divider-color);
      }
      .group-header + .rows {
        border-top: 1px solid var(--divider-color);
      }
    `,
  ];
}

declare global {
  interface HTMLElementTagNameMap {
    "nc-settings-colors": NcSettingsColors;
  }
}
