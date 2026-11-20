// The General tab of the settings: a list of pages like Home Assistant's
// System settings (Modes, and the Snooze dialog), YAML import and export at
// the bottom.

import { LitElement, css, html, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";

import { DOMAIN, type NotificationCenterConfig, type StateMessage } from "../shared/config";
import { errorText, navigate } from "../shared/live";
import type { HomeAssistant } from "../shared/types";
import { VERSION } from "../shared/version";
import { field } from "./fields";
import "./settings-modes";

interface GeneralPage {
  key: string;
  name: string;
  description: string;
  icon: string;
  color: string;
}

// The colours of Home Assistant's System settings icons.
const PAGES: GeneralPage[] = [
  {
    key: "modes",
    name: "Modes",
    description: "House modes from entity states",
    icon: "mdi:home-switch-outline",
    color: "#5C6BC0",
  },
  {
    key: "snooze",
    name: "Snooze",
    description: "When a card snoozed until tomorrow comes back",
    icon: "mdi:alarm-snooze",
    color: "#26A69A",
  },
];

@customElement("nc-settings-general")
export class NcSettingsGeneral extends LitElement {
  @property({ attribute: false }) public hass?: HomeAssistant;

  @property({ attribute: false }) public config?: NotificationCenterConfig;

  @property({ attribute: false }) public state?: StateMessage;

  @property({ type: Boolean }) public hasData = false;

  // The page of the tab, such as "modes"; empty for the list.
  @property() public sub = "";

  @property() public base = "/notification-center";

  @state() private _error?: string;

  @state() private _notice?: string;

  // An import waiting for confirmation, because it would replace data.
  @state() private _pendingImport?: { name: string; text: string };

  @state() private _busy = false;

  // The Snooze dialog with its Tomorrow at time.
  @state() private _snooze?: string;

  protected override render() {
    const config = this.config;
    if (!config) return nothing;
    if (this.sub === "modes") {
      return html`<nc-settings-modes
        .hass=${this.hass}
        .config=${config}
        .state=${this.state}
        .base=${this.base}
      ></nc-settings-modes>`;
    }
    return html`
      ${this._error ? html`<ha-alert alert-type="error">${this._error}</ha-alert>` : nothing}
      ${this._notice ? html`<ha-alert alert-type="success">${this._notice}</ha-alert>` : nothing}
      <ha-card outlined>
        <ha-list-base class="pages">
          ${PAGES.map(
            (page) => html`<ha-list-item-button @click=${() => this._open(page.key)}>
              <div slot="start" class="page-icon" style=${`background-color: ${page.color}`}>
                <ha-icon .icon=${page.icon}></ha-icon>
              </div>
              <span slot="headline">${page.name}</span>
              <span slot="supporting-text">${page.description}</span>
              <ha-icon slot="end" class="chevron" icon="mdi:chevron-right"></ha-icon>
            </ha-list-item-button>`,
          )}
        </ha-list-base>
      </ha-card>
      ${this._renderImportExport()}
      <p class="version">Notification Center ${VERSION}</p>
      ${this._snooze !== undefined ? this._renderSnoozeDialog() : nothing}
    `;
  }

  private _open(key: string): void {
    if (key === "snooze") {
      this._snooze = this.config?.general?.snooze_tomorrow_at ?? "08:00";
      return;
    }
    navigate(`${this.base}/settings/general/${key}`);
  }

  private _renderSnoozeDialog() {
    return html`<ha-dialog
      open
      width="small"
      header-title="Snooze"
      @closed=${(ev: Event) => {
        if (ev.target !== ev.currentTarget) return;
        ev.stopPropagation();
        this._snooze = undefined;
      }}
    >
      ${field(this.hass, { time: {} }, this._snooze, "Tomorrow at", (value) => {
        this._snooze = (value as string) || "08:00";
      })}
      <ha-dialog-footer slot="footer">
        <ha-button slot="secondaryAction" appearance="plain" @click=${() => (this._snooze = undefined)}>
          Cancel
        </ha-button>
        <ha-button slot="primaryAction" @click=${this._saveSnooze}>Save</ha-button>
      </ha-dialog-footer>
    </ha-dialog>`;
  }

  private async _saveSnooze(): Promise<void> {
    const time = this._snooze;
    this._snooze = undefined;
    if (!time) return;
    await this._run(async () => {
      await this.hass?.callWS({
        type: `${DOMAIN}/general/update`,
        data: { ...(this.config?.general ?? {}), snooze_tomorrow_at: time },
      });
    });
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
    ha-card {
      overflow: hidden;
    }
    ha-list-item-button + ha-list-item-button {
      border-top: 1px solid var(--divider-color);
    }
    /* As the icons of Home Assistant's System settings. */
    .page-icon {
      width: 40px;
      height: 40px;
      border-radius: var(--ha-border-radius-md, 10px);
      display: flex;
      align-items: center;
      justify-content: center;
      color: #fff;
      --mdc-icon-size: 24px;
    }
    .chevron {
      color: var(--secondary-text-color);
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
