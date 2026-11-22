// The General tab of the settings: a list of pages like Home Assistant's
// System settings (Modes, People, Snooze, and Import and export in its own block),
// and the version. Each page opens on its own (nc-general-page).

import { LitElement, css, html, nothing } from "lit";
import { customElement, property } from "lit/decorators.js";

import type { NotificationCenterConfig } from "../shared/config";
import { navigate } from "../shared/live";
import type { HomeAssistant } from "../shared/types";
import { VERSION } from "../shared/version";

interface GeneralPage {
  key: string;
  name: string;
  description: string;
  icon: string;
  color: string;
}

// The colours of Home Assistant's System settings icons.
@customElement("nc-settings-general")
export class NcSettingsGeneral extends LitElement {
  @property({ attribute: false }) public hass?: HomeAssistant;

  @property({ attribute: false }) public config?: NotificationCenterConfig;

  @property({ type: Boolean }) public narrow = false;

  @property() public base = "/notification-center";

  protected override render() {
    const config = this.config;
    if (!config) return nothing;
    const tomorrow = config.general?.snooze_tomorrow_at ?? "08:00";
    // Short, as on Home Assistant's System settings; the pages explain.
    const settings: GeneralPage[] = [
      {
        key: "modes",
        name: "Modes",
        description: `${config.modes.length} ${config.modes.length === 1 ? "mode" : "modes"}`,
        icon: "mdi:home-switch-outline",
        color: "#5C6BC0",
      },
      {
        key: "people",
        name: "People",
        description: `${config.people.length} ${config.people.length === 1 ? "person" : "people"}`,
        icon: "mdi:account-multiple",
        color: "#E68D0D",
      },
      {
        key: "snooze",
        name: "Snooze",
        description: `Tomorrow at ${tomorrow.slice(0, 5)}`,
        icon: "mdi:alarm-snooze",
        color: "#26A69A",
      },
    ];
    const data: GeneralPage[] = [
      {
        key: "import",
        name: "Import and export",
        description: "The configuration as YAML",
        icon: "mdi:swap-vertical",
        color: "#607D8B",
      },
    ];
    return html`
      ${this._card(settings)} ${this._card(data)}
      <p class="version">Notification Center ${VERSION}</p>
    `;
  }

  // As Home Assistant's navigation list of the System settings.
  private _card(pages: GeneralPage[]) {
    return html`<ha-card outlined>
      <ha-list-base>
        ${pages.map(
          (page) => html`<ha-list-item-button @click=${() => navigate(`${this.base}/settings/general/${page.key}`)}>
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
