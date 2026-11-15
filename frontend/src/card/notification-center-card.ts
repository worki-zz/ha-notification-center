import { LitElement, css, html } from "lit";
import { customElement, property, state } from "lit/decorators.js";

import type { CardConfig, HomeAssistant } from "../shared/types";

const CARD_TYPE = "notification-center-card";

// The dashboard card. Phase 0 only shows the "All clear" state; active
// notifications and their buttons arrive in phase 3.
@customElement(CARD_TYPE)
export class NotificationCenterCard extends LitElement {
  @property({ attribute: false }) public hass?: HomeAssistant;

  @state() private _config?: CardConfig;

  public setConfig(config: CardConfig): void {
    if (!config) {
      throw new Error("Invalid configuration");
    }
    this._config = config;
  }

  public static getStubConfig(): Omit<CardConfig, "type"> {
    return {};
  }

  public getCardSize(): number {
    return 2;
  }

  public getGridOptions() {
    return { columns: 12, rows: 2, min_columns: 6, min_rows: 2 };
  }

  protected override render() {
    if (!this._config) {
      return html``;
    }
    return html`
      <ha-card>
        <div class="all-clear">
          <ha-icon icon="mdi:check-circle-outline"></ha-icon>
          <span>All clear</span>
        </div>
      </ha-card>
    `;
  }

  static override styles = css`
    ha-card {
      height: 100%;
      box-sizing: border-box;
    }
    .all-clear {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 10px;
      height: 100%;
      min-height: 56px;
      padding: 10px;
      box-sizing: border-box;
      color: var(--secondary-text-color);
      font-size: var(--ha-font-size-l, 16px);
      font-weight: var(--ha-font-weight-medium, 500);
    }
    .all-clear ha-icon {
      --mdc-icon-size: 24px;
      color: var(--state-icon-color, var(--secondary-text-color));
    }
  `;
}

window.customCards = window.customCards ?? [];
if (!window.customCards.some((card) => card.type === CARD_TYPE)) {
  window.customCards.push({
    type: CARD_TYPE,
    name: "Notification Center",
    description: "Active notifications with their buttons",
    preview: true,
    documentationURL: "https://github.com/worki-zz/ha-notification-center",
  });
}

declare global {
  interface HTMLElementTagNameMap {
    "notification-center-card": NotificationCenterCard;
  }
}
