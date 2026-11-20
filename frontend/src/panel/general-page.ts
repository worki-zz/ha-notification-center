// A page of the General settings on its own, with Home Assistant's subpage
// header and what it does at the top: Modes, Snooze, Import and export.

import { LitElement, css, html, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";

import { DOMAIN, type NotificationCenterConfig, type StateMessage } from "../shared/config";
import { errorText, navigate } from "../shared/live";
import type { HomeAssistant } from "../shared/types";
import { field } from "./fields";
import "./settings-modes";

const PAGES: Record<string, { title: string; intro: string[] }> = {
  modes: {
    title: "Modes",
    intro: [
      "A mode decides which channels of a category send a notification. One mode is active at a time: the first in the list whose condition is true. Drag the rows to change the order.",
      "Home without a condition is always true: it is shown on top, but checked last, so it applies when no other mode does. With a condition, Home is ordered like the others. When no mode is active, every channel sends.",
    ],
  },
  snooze: {
    title: "Snooze",
    intro: [
      "Snoozing for minutes or hours counts from the press. Tomorrow and the longer times bring the card back on that day at the time below; a scheduled step comes back at its own time instead.",
    ],
  },
  import: {
    title: "Import and export",
    intro: [
      "Export downloads the whole configuration as YAML: notifications, categories, modes and settings. Import replaces the whole configuration; the current one is downloaded first.",
    ],
  },
};

@customElement("nc-general-page")
export class NcGeneralPage extends LitElement {
  @property({ attribute: false }) public hass?: HomeAssistant;

  @property({ type: Boolean }) public narrow = false;

  @property({ attribute: false }) public config?: NotificationCenterConfig;

  @property({ attribute: false }) public state?: StateMessage;

  @property({ type: Boolean }) public hasData = false;

  @property() public page = "";

  @property() public base = "/notification-center";

  @state() private _error?: string;

  @state() private _notice?: string;

  // An import waiting for confirmation, because it would replace data.
  @state() private _pendingImport?: { name: string; text: string };

  @state() private _busy = false;

  // The Snooze time being edited; undefined while unchanged.
  @state() private _snooze?: string;

  protected override render() {
    const page = PAGES[this.page];
    return html`<hass-subpage
      .hass=${this.hass}
      .narrow=${this.narrow}
      .header=${page?.title ?? "General"}
      .backCallback=${() => navigate(`${this.base}/settings/general`)}
    >
      <div class="content">
        ${page ? page.intro.map((text) => html`<p class="intro">${text}</p>`) : nothing}
        ${this._error ? html`<ha-alert alert-type="error">${this._error}</ha-alert>` : nothing}
        ${this._notice ? html`<ha-alert alert-type="success">${this._notice}</ha-alert>` : nothing}
        ${this.page === "modes"
          ? html`<nc-settings-modes .hass=${this.hass} .config=${this.config} .state=${this.state}></nc-settings-modes>`
          : this.page === "snooze"
            ? this._renderSnooze()
            : this.page === "import"
              ? this._renderImportExport()
              : nothing}
      </div>
    </hass-subpage>`;
  }

  private _renderSnooze() {
    const saved = this.config?.general?.snooze_tomorrow_at ?? "08:00";
    const value = this._snooze ?? saved;
    return html`<ha-card outlined>
      <div class="card-content">
        ${field(this.hass, { time: { no_second: true } }, value, "Tomorrow at", (time) => {
          this._snooze = (time as string) || "08:00";
        })}
      </div>
      <div class="card-actions">
        <ha-button .disabled=${this._busy || this._snooze === undefined || this._snooze === saved} @click=${this._saveSnooze}>
          Save
        </ha-button>
      </div>
    </ha-card>`;
  }

  private async _saveSnooze(): Promise<void> {
    const time = this._snooze;
    if (!time) return;
    await this._run(async () => {
      await this.hass?.callWS({
        type: `${DOMAIN}/general/update`,
        data: { ...(this.config?.general ?? {}), snooze_tomorrow_at: time },
      });
      this._snooze = undefined;
    });
  }

  private _renderImportExport() {
    const pending = this._pendingImport;
    return html`
      <ha-card outlined>
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
      display: block;
      height: 100%;
    }
    .content {
      max-width: 1040px;
      margin: 0 auto;
      padding: 16px;
      display: flex;
      flex-direction: column;
      gap: 16px;
      box-sizing: border-box;
    }
    .intro {
      margin: 0;
      color: var(--secondary-text-color);
    }
    ha-card {
      overflow: hidden;
    }
    .card-content p {
      margin-top: 0;
    }
    .card-actions {
      display: flex;
      justify-content: flex-end;
      padding: 8px;
      border-top: 1px solid var(--divider-color);
    }
    .buttons {
      display: flex;
      gap: 8px;
      flex-wrap: wrap;
    }
  `;
}

declare global {
  interface HTMLElementTagNameMap {
    "nc-general-page": NcGeneralPage;
  }
}
