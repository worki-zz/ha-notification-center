// A page of the General settings on its own, with Home Assistant's subpage
// header and what it does at the top: Home modes, People, Light, Sound, Chimes,
// Import and export.

import { LitElement, css, html, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";

import {
  DOMAIN,
  type NotificationCenterConfig,
  type StateMessage,
} from "../shared/config";
import { errorText, navigate } from "../shared/live";
import type { HomeAssistant } from "../shared/types";
import "./settings-modes";
import "./settings-lights";
import "./settings-people";
import "./settings-sound";

const PAGES: Record<string, { title: string; intro: string[] }> = {
  modes: {
    title: "Home modes",
    intro: [
      "A home mode decides which channels of a category send a notification. One home mode is active at a time: the first in the list whose condition is true. Drag the rows to change the order.",
      "Home without a condition is always true: it is shown on top, but checked last, so it applies when no other home mode does. With a condition, Home is ordered like the others. When no home mode is active, the channels ticked in at least one home mode send.",
    ],
  },
  people: {
    title: "People",
    intro: [
      "Every person of Home Assistant is listed here. A person is Home (at home and awake), Sleep (at home and asleep) or Away; the Audience of a category or step ticks the states each person gets its notifications in.",
      "Sleep is set like a home mode's condition: an entity's state or a template. It counts only while the person is at home.",
    ],
  },
  light: {
    title: "Light",
    intro: [
      "A light shows the color of the first active notification, and goes back to how it was when no notification is active.",
    ],
  },
  sound: {
    title: "Sound",
    intro: [
      "The speakers and sirens of the Sound channels. A speaker plays the chime of a notification once when it starts to send, can read the message, and can repeat; a siren (such as a smoke alarm's) sounds while the notification sends. Silence (a button action) stops them.",
    ],
  },
  chimes: {
    title: "Chimes",
    intro: [
      "The chimes a speaker can play: the built-in ones and your own sound files. Drag the rows to change their order in the lists.",
    ],
  },
  import: {
    title: "Import and export",
    intro: [
      "Export downloads the whole configuration as YAML: notifications, categories, home modes and settings. Import replaces the whole configuration; the current one is downloaded first.",
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

  protected override render() {
    const page = PAGES[this.page];
    return html`<hass-subpage
      .hass=${this.hass}
      .narrow=${this.narrow}
      .header=${page?.title ?? "General"}
      .backCallback=${() => navigate(`${this.base}/settings/general${this.page === "chimes" ? "/sound" : ""}`)}
    >
      <div class="content">
        ${page
          ? page.intro.map((text) => html`<p class="intro">${text}</p>`)
          : nothing}
        ${this._error
          ? html`<ha-alert alert-type="error">${this._error}</ha-alert>`
          : nothing}
        ${this._notice
          ? html`<ha-alert alert-type="success">${this._notice}</ha-alert>`
          : nothing}
        ${this.page === "modes"
          ? html`<nc-settings-modes
              .hass=${this.hass}
              .config=${this.config}
              .state=${this.state}
            ></nc-settings-modes>`
          : this.page === "people"
            ? html`<nc-settings-people
                .hass=${this.hass}
                .config=${this.config}
                .state=${this.state}
              ></nc-settings-people>`
            : this.page === "light"
              ? html`<nc-settings-lights .hass=${this.hass} .config=${this.config}></nc-settings-lights>`
              : this.page === "sound"
                ? html`<nc-settings-sound .hass=${this.hass} .config=${this.config} .base=${this.base}></nc-settings-sound>`
                : this.page === "chimes"
                  ? html`<nc-settings-sound
                      view="chimes"
                      .hass=${this.hass}
                      .config=${this.config}
                      .base=${this.base}
                    ></nc-settings-sound>`
            : this.page === "import"
                ? this._renderImportExport()
                : nothing}
      </div>
    </hass-subpage>`;
  }

  private _renderImportExport() {
    const pending = this._pendingImport;
    return html`
      <ha-card outlined>
        <div class="card-content">
          ${pending
            ? html`
                <p>
                  Importing <b>${pending.name}</b> replaces the whole
                  configuration (${this.config?.notifications.length ?? 0}
                  notifications now). The current one is downloaded first.
                </p>
                <div class="buttons">
                  <ha-button
                    variant="danger"
                    .disabled=${this._busy}
                    @click=${this._confirmImport}
                  >
                    Replace
                  </ha-button>
                  <ha-button appearance="plain" @click=${this._cancelImport}
                    >Cancel</ha-button
                  >
                </div>
              `
            : html`
                <div class="buttons">
                  <ha-button
                    appearance="plain"
                    .disabled=${this._busy}
                    @click=${this._export}
                  >
                    <ha-icon slot="start" icon="mdi:download"></ha-icon>
                    Export
                  </ha-button>
                  <ha-button
                    appearance="plain"
                    .disabled=${this._busy}
                    @click=${this._pickFile}
                  >
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
    this.renderRoot
      .querySelector<HTMLInputElement>("input[type=file]")
      ?.click();
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
      /* 24px under the header, as on the Overview. */
      padding: 24px 16px 16px;
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
