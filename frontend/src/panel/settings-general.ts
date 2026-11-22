// The General tab of the settings: a list of pages like Home Assistant's
// System settings (Home modes, People, Light, Sound; Snooze, Colors and Import and export in a second block),
// and the version. Each page opens on its own (nc-general-page).

import { LitElement, css, html, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";

import { DOMAIN, type NotificationCenterConfig } from "../shared/config";
import { errorText, navigate } from "../shared/live";
import type { HomeAssistant } from "../shared/types";
import { VERSION } from "../shared/version";
import { field } from "./fields";

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

  // The Snooze dialog's time while it is open.
  @state() private _snooze?: string;

  @state() private _error?: string;

  @state() private _busy = false;

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
        key: "snooze",
        name: "Snooze",
        description: `At ${tomorrow.slice(0, 5)}`,
        icon: "mdi:alarm-snooze",
        color: "#26A69A",
      },
      {
        key: "colors",
        name: "Colors",
        description: config.colors?.length ? count(config.colors.length, "own color", "own colors") : "System colors",
        icon: "mdi:palette-outline",
        color: "#EC407A",
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
    `;
  }

  private _openPage(key: string): void {
    if (key === "snooze") {
      this._error = undefined;
      this._snooze = this.config?.general?.snooze_tomorrow_at ?? "08:00";
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
