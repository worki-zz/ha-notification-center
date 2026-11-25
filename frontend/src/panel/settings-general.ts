// The General tab of the settings: a list of pages like Home Assistant's
// System settings (Home modes, People, Light, Sound; Colors, Snooze, Push and Import and export in a second
// block),
// and the version. Each page opens on its own (nc-general-page).

import { LitElement, css, html, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";

import { DOMAIN, type NotificationCenterConfig } from "../shared/config";
import { errorText, navigate } from "../shared/live";
import type { HomeAssistant } from "../shared/types";
import { VERSION } from "../shared/version";
import { field, pageName } from "./fields";

interface GeneralPage {
  key: string;
  name: string;
  description: string;
  icon: string;
  color: string;
}

const count = (amount: number, one: string, more: string) => `${amount} ${amount === 1 ? one : more}`;

/** The speakers and the sirens, leaving out what there is none of. */
function soundSummary(config: NotificationCenterConfig): string {
  const parts = [
    [config.speakers?.length ?? 0, "speaker", "speakers"],
    [config.sirens?.length ?? 0, "siren", "sirens"],
  ] as const;
  const shown = parts.filter(([amount]) => amount > 0).map(([amount, one, more]) => count(amount, one, more));
  return shown.length ? shown.join(", ") : "No speakers or sirens";
}

// The colours of Home Assistant's System settings icons.
@customElement("nc-settings-general")
export class NcSettingsGeneral extends LitElement {
  @property({ attribute: false }) public hass?: HomeAssistant;

  @property({ attribute: false }) public config?: NotificationCenterConfig;

  @property({ type: Boolean }) public narrow = false;

  @property() public base = "/notification-center";

  // There is data an import would replace.
  @property({ type: Boolean }) public hasData = false;

  // The Snooze dialog's time while it is open.
  @state() private _snooze?: string;

  // The Push dialog's page while it is open ("" : the panel's Overview).
  @state() private _push?: string;

  @state() private _error?: string;

  @state() private _busy = false;

  // The Import and export dialog is open.
  @state() private _io = false;

  // An import waiting for confirmation, because it would replace data.
  @state() private _pendingImport?: { name: string; text: string };

  @state() private _notice?: string;

  protected override render() {
    const config = this.config;
    if (!config) return nothing;
    const tomorrow = config.general?.snooze_tomorrow_at ?? "08:00";
    // Short, as on Home Assistant's System settings; the pages explain.
    const settings: GeneralPage[] = [
      {
        key: "modes",
        name: "Home modes",
        description: count(config.modes.length, "mode", "modes"),
        icon: "mdi:home-switch-outline",
        color: "#43A047",
      },
      {
        key: "people",
        name: "People",
        description: `${config.people.length} ${config.people.length === 1 ? "person" : "people"}`,
        icon: "mdi:account-multiple",
        color: "#5A87FA",
      },
      {
        key: "light",
        name: "Light",
        description: count(config.lights?.length ?? 0, "light", "lights"),
        icon: "mdi:lightbulb-on-outline",
        color: "#FFB300",
      },
      {
        key: "sound",
        name: "Sound",
        description: soundSummary(config),
        icon: "mdi:volume-high",
        color: "#7E57C2",
      },
    ];
    const data: GeneralPage[] = [
      {
        key: "colors",
        name: "Colors",
        description: config.colors?.length ? `${config.colors.length} custom` : "System colors",
        icon: "mdi:palette-outline",
        color: "#EC407A",
      },
      {
        key: "push",
        name: "Push",
        description: pageName(this.hass, config.general?.open_on_tap),
        icon: "mdi:cellphone-message",
        color: "#29B6F6",
      },
      {
        key: "snooze",
        name: "Snooze",
        description: `At ${tomorrow.slice(0, 5)}`,
        icon: "mdi:alarm-snooze",
        color: "#26A69A",
      },
      {
        key: "import",
        name: "Import and export",
        description: "YAML configuration",
        icon: "mdi:swap-vertical",
        color: "#607D8B",
      },
    ];
    return html`
      ${this._card(settings)} ${this._card(data)}
      <p class="version">Notification Center ${VERSION}</p>
      ${this._snooze !== undefined ? this._renderSnooze(this._snooze) : nothing}
      ${this._push !== undefined ? this._renderPush(this._push) : nothing}
      ${this._io ? this._renderImportExport() : nothing}
    `;
  }

  private _openPage(key: string): void {
    if (key === "snooze") {
      this._error = undefined;
      this._snooze = this.config?.general?.snooze_tomorrow_at ?? "08:00";
      return;
    }
    if (key === "push") {
      this._error = undefined;
      this._push = this.config?.general?.open_on_tap ?? "";
      return;
    }
    if (key === "import") {
      this._error = undefined;
      this._notice = undefined;
      this._pendingImport = undefined;
      this._io = true;
      return;
    }
    navigate(`${this.base}/settings/general/${key}`);
  }

  // Snooze: the default time when a notification is snoozed to another day.
  private _renderSnooze(value: string) {
    return html`<ha-dialog
      open
      width="small"
      header-title="Snooze"
      @closed=${(ev: Event) => {
        if (ev.target !== ev.currentTarget) return;
        this._snooze = undefined;
      }}
    >
      <p class="hint">The default time when a notification is snoozed to another day.</p>
      ${this._error ? html`<ha-alert alert-type="error">${this._error}</ha-alert>` : nothing}
      ${field(this.hass, { time: { no_second: true } }, value, "Default time", (time) => {
        this._snooze = (time as string) || "08:00";
      })}
      <ha-dialog-footer slot="footer">
        <ha-button slot="secondaryAction" appearance="plain" @click=${() => (this._snooze = undefined)}>
          Cancel
        </ha-button>
        <ha-button slot="primaryAction" .disabled=${this._busy} @click=${this._saveSnooze}>Save</ha-button>
      </ha-dialog-footer>
    </ha-dialog>`;
  }

  private async _saveSnooze(): Promise<void> {
    const time = this._snooze;
    if (!time || !this.hass) return;
    this._busy = true;
    this._error = undefined;
    try {
      await this.hass.callWS({
        type: `${DOMAIN}/general/update`,
        data: { ...(this.config?.general ?? {}), snooze_tomorrow_at: time },
      });
      this._snooze = undefined;
    } catch (err) {
      this._error = errorText(err);
    } finally {
      this._busy = false;
    }
  }

  // Push: the page a tap on a push opens, unless a category or notification
  // sets its own.
  private _renderPush(value: string) {
    return html`<ha-dialog
      open
      width="small"
      header-title="Push"
      @closed=${(ev: Event) => {
        if (ev.target !== ev.currentTarget) return;
        this._push = undefined;
      }}
    >
      <p class="hint">
        The page a tap on a push opens, unless its category or notification sets one.
      </p>
      ${this._error ? html`<ha-alert alert-type="error">${this._error}</ha-alert>` : nothing}
      ${field(
        this.hass,
        { navigation: {} },
        value,
        "Open on tap",
        (path) => {
          this._push = (path as string | undefined) ?? "";
        },
        { helper: "Empty: Notification Center, Overview." },
      )}
      <ha-dialog-footer slot="footer">
        <ha-button slot="secondaryAction" appearance="plain" @click=${() => (this._push = undefined)}>
          Cancel
        </ha-button>
        <ha-button slot="primaryAction" .disabled=${this._busy} @click=${this._savePush}>Save</ha-button>
      </ha-dialog-footer>
    </ha-dialog>`;
  }

  private async _savePush(): Promise<void> {
    const path = this._push;
    if (path === undefined || !this.hass) return;
    this._busy = true;
    this._error = undefined;
    try {
      await this.hass.callWS({
        type: `${DOMAIN}/general/update`,
        data: { ...(this.config?.general ?? {}), open_on_tap: path || null },
      });
      this._push = undefined;
    } catch (err) {
      this._error = errorText(err);
    } finally {
      this._busy = false;
    }
  }

  // Import and export: download the configuration as YAML, or replace it.
  private _renderImportExport() {
    const pending = this._pendingImport;
    const close = () => {
      this._io = false;
      this._pendingImport = undefined;
    };
    return html`<ha-dialog
      open
      width="small"
      header-title="Import and export"
      @closed=${(ev: Event) => {
        if (ev.target !== ev.currentTarget) return;
        close();
      }}
    >
      <p class="hint">
        ${pending
          ? html`Importing <b>${pending.name}</b> replaces the whole configuration
              (${this.config?.notifications.length ?? 0} notifications now). The current one is
              downloaded first.`
          : "Export downloads the whole configuration as YAML: notifications, categories, home modes and settings. Import replaces the whole configuration; the current one is downloaded first."}
      </p>
      ${this._error ? html`<ha-alert alert-type="error">${this._error}</ha-alert>` : nothing}
      ${this._notice ? html`<ha-alert alert-type="success">${this._notice}</ha-alert>` : nothing}
      <input type="file" accept=".yaml,.yml,text/yaml" hidden @change=${this._fileChosen} />
      <ha-dialog-footer slot="footer">
        ${pending
          ? html`<ha-button slot="secondaryAction" appearance="plain" @click=${() => (this._pendingImport = undefined)}>
                Cancel
              </ha-button>
              <ha-button slot="primaryAction" variant="danger" .disabled=${this._busy} @click=${this._confirmImport}>
                Replace
              </ha-button>`
          : html`<ha-button slot="secondaryAction" appearance="plain" .disabled=${this._busy} @click=${this._pickFile}>
                <ha-icon slot="start" icon="mdi:upload"></ha-icon>
                Import
              </ha-button>
              <ha-button slot="primaryAction" .disabled=${this._busy} @click=${this._export}>
                <ha-icon slot="start" icon="mdi:download"></ha-icon>
                Export
              </ha-button>`}
      </ha-dialog-footer>
    </ha-dialog>`;
  }

  private async _export(): Promise<void> {
    await this._run(() => this._download());
  }

  private async _download(): Promise<void> {
    if (!this.hass) return;
    // From a signed address, as Home Assistant downloads its backups: the
    // Companion app downloads a file only from an address, not from memory.
    const { path } = await this.hass.callWS<{ path: string }>({
      type: "auth/sign_path",
      path: `/api/${DOMAIN}/export`,
    });
    const link = document.createElement("a");
    link.href = path;
    link.target = "_blank";
    link.download = "";
    link.style.display = "none";
    document.body.appendChild(link);
    link.dispatchEvent(new MouseEvent("click"));
    link.remove();
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

  // As Home Assistant's navigation list of the System settings.
  private _card(pages: GeneralPage[]) {
    return html`<ha-card outlined>
      <ha-list-base>
        ${pages.map(
          (page) => html`<ha-list-item-button @click=${() => this._openPage(page.key)}>
            <div slot="start" class="page-icon" style=${`background-color: ${page.color}`}>
              <ha-icon .icon=${page.icon}></ha-icon>
            </div>
            <span slot="headline">${page.name}</span>
            <span slot="supporting-text">${page.description}</span>
            ${this.narrow ? nothing : html`<ha-icon-next slot="end"></ha-icon-next>`}
          </ha-list-item-button>`,
        )}
      </ha-list-base>
    </ha-card>`;
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
    /* A line between the rows, as in the Notifications list. */
    ha-list-item-button + ha-list-item-button {
      border-top: 1px solid var(--divider-color);
    }
    /* As the icons of Home Assistant's System settings. */
    .page-icon {
      padding: 8px;
      border-radius: var(--ha-border-radius-circle, 50%);
      display: flex;
      color: #fff;
      --mdc-icon-size: 24px;
    }
    ha-icon-next {
      color: var(--secondary-text-color);
    }
    .hint {
      margin: 0 0 16px;
      color: var(--secondary-text-color);
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
