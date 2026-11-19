// The General tab of the settings: what is set up so far, and YAML import
// and export at the bottom.

import { LitElement, css, html, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";

import { DOMAIN, type NotificationCenterConfig } from "../shared/config";
import { errorText } from "../shared/live";
import type { HomeAssistant } from "../shared/types";
import { VERSION } from "../shared/version";

@customElement("nc-settings-general")
export class NcSettingsGeneral extends LitElement {
  @property({ attribute: false }) public hass?: HomeAssistant;

  @property({ attribute: false }) public config?: NotificationCenterConfig;

  @property({ type: Boolean }) public hasData = false;

  @state() private _error?: string;

  @state() private _notice?: string;

  // An import waiting for confirmation, because it would replace data.
  @state() private _pendingImport?: { name: string; text: string };

  @state() private _busy = false;

  protected override render() {
    const config = this.config;
    if (!config) return nothing;
    return html`
      ${this._error ? html`<ha-alert alert-type="error">${this._error}</ha-alert>` : nothing}
      ${this._notice ? html`<ha-alert alert-type="success">${this._notice}</ha-alert>` : nothing}
      <ha-card outlined header="Categories (${config.categories.length})">
        ${config.categories.map(
          (item) => html`
            <div class="row">
              <ha-icon .icon=${item.icon ?? "mdi:shape"}></ha-icon>
              <div class="text">
                <div>${item.name}</div>
                <div class="secondary">${item.card_color ?? "No colour"}</div>
              </div>
            </div>
          `,
        )}
      </ha-card>
      <ha-card outlined header="Modes (${config.modes.length})">
        ${config.modes.map(
          (item) => html`
            <div class="row">
              <ha-icon .icon=${item.icon ?? "mdi:home-variant"}></ha-icon>
              <div class="text">
                <div>${item.name}</div>
                <div class="secondary">
                  ${item.condition ? item.condition.type : "When no other mode applies"}
                </div>
              </div>
            </div>
          `,
        )}
      </ha-card>
      <ha-card outlined header="People (${config.people.length})">
        ${config.people.length === 0
          ? html`<div class="card-content secondary">No people in Home Assistant.</div>`
          : config.people.map(
              (item) => html`
                <div class="row">
                  <ha-icon icon="mdi:account"></ha-icon>
                  <div class="text">
                    <div>${item.name}</div>
                    <div class="secondary">
                      ${item.notify ?? "No push"} · ${item.device_type}
                    </div>
                  </div>
                </div>
              `,
            )}
      </ha-card>
      <ha-card outlined header="Devices">
        <div class="card-content secondary">
          ${config.lights.length} lights · ${config.speakers.length} speakers ·
          ${config.chimes.length} chimes
        </div>
      </ha-card>
      ${this._renderImportExport()}
      <p class="version">Notification Center ${VERSION}</p>
    `;
  }

  private _renderImportExport() {
    const pending = this._pendingImport;
    return html`
      <ha-card outlined header="Import and export">
        <div class="card-content">
          ${pending
            ? html`
                <p>
                  Importing <b>${pending.name}</b> replaces the whole configuration
                  (${this.config?.notifications.length ?? 0} notifications now). The
                  current one is downloaded first.
                </p>
                <div class="buttons">
                  <ha-button variant="danger" .disabled=${this._busy} @click=${this._confirmImport}>
                    Replace
                  </ha-button>
                  <ha-button appearance="plain" @click=${this._cancelImport}>Cancel</ha-button>
                </div>
              `
            : html`
                <p>Export downloads the whole configuration as YAML; import replaces it.</p>
                <div class="buttons">
                  <ha-button appearance="plain" .disabled=${this._busy} @click=${this._export}>
                    <ha-icon slot="start" icon="mdi:download"></ha-icon>
                    Export
                  </ha-button>
                  <ha-button appearance="plain" .disabled=${this._busy} @click=${this._pickFile}>
                    <ha-icon slot="start" icon="mdi:upload"></ha-icon>
                    Import
                  </ha-button>
                  <input
                    type="file"
                    accept=".yaml,.yml,text/yaml"
                    hidden
                    @change=${this._fileChosen}
                  />
                </div>
              `}
        </div>
      </ha-card>
    `;
  }

  private async _export(): Promise<void> {
    await this._run(() => this._download());
  }

  private async _download(): Promise<void> {
    if (!this.hass) return;
    const { yaml } = await this.hass.callWS<{ yaml: string }>({
      type: `${DOMAIN}/config/export`,
    });
    const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
    const link = document.createElement("a");
    link.href = URL.createObjectURL(new Blob([yaml], { type: "text/yaml" }));
    link.download = `notification_center_${stamp}.yaml`;
    link.click();
    URL.revokeObjectURL(link.href);
  }

  private _pickFile(): void {
    this.renderRoot.querySelector<HTMLInputElement>("input[type=file]")?.click();
  }

  private async _fileChosen(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = "";
    if (!file) return;
    const text = await file.text();
    if (this.hasData) {
      this._pendingImport = { name: file.name, text };
      return;
    }
    await this._import(text, false);
  }

  private async _confirmImport(): Promise<void> {
    const pending = this._pendingImport;
    if (!pending) return;
    await this._import(pending.text, true);
    this._pendingImport = undefined;
  }

  private _cancelImport(): void {
    this._pendingImport = undefined;
  }

  private async _import(text: string, backup: boolean): Promise<void> {
    await this._run(async () => {
      if (backup) await this._download();
      await this.hass?.callWS({ type: `${DOMAIN}/config/import`, yaml: text });
      this._notice = "Imported.";
    });
  }

  private async _run(task: () => Promise<void>): Promise<void> {
    this._busy = true;
    this._error = undefined;
    this._notice = undefined;
    try {
      await task();
    } catch (err) {
      this._error = errorText(err);
    } finally {
      this._busy = false;
    }
  }

  static override styles = css`
    :host {
      display: flex;
      flex-direction: column;
      gap: 16px;
    }
    .row {
      display: flex;
      align-items: center;
      gap: 16px;
      padding: 8px 16px;
      min-height: 48px;
    }
    .row:last-child {
      padding-bottom: 16px;
    }
    .row ha-icon {
      color: var(--state-icon-color, var(--secondary-text-color));
      flex: none;
    }
    .text {
      min-width: 0;
    }
    .secondary {
      color: var(--secondary-text-color);
      font-size: var(--ha-font-size-m, 14px);
    }
    .card-content p {
      margin-top: 0;
    }
    .buttons {
      display: flex;
      gap: 8px;
      flex-wrap: wrap;
    }
    .version {
      margin: 0;
      text-align: center;
      font-size: var(--ha-font-size-s, 12px);
      color: var(--disabled-text-color);
    }
  `;
}

declare global {
  interface HTMLElementTagNameMap {
    "nc-settings-general": NcSettingsGeneral;
  }
}
