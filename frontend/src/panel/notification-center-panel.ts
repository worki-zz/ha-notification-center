import { LitElement, css, html } from "lit";
import { customElement, property } from "lit/decorators.js";

import type { HomeAssistant, PanelInfo } from "../shared/types";
import { VERSION } from "../shared/version";

// The sidebar panel. Phase 0 only shows the page frame and an empty state;
// the Overview, Later and Settings views arrive in later phases.
@customElement("notification-center-panel")
export class NotificationCenterPanel extends LitElement {
  @property({ attribute: false }) public hass?: HomeAssistant;

  @property({ type: Boolean, reflect: true }) public narrow = false;

  @property({ attribute: false }) public panel?: PanelInfo;

  protected override render() {
    const title = this.panel?.title ?? "Notification Center";
    return html`
      <div class="toolbar">
        <ha-menu-button .hass=${this.hass} .narrow=${this.narrow}></ha-menu-button>
        <div class="main-title">${title}</div>
      </div>
      <div class="content">
        <div class="empty">
          <ha-icon icon="mdi:message-bulleted"></ha-icon>
          <h2>Nothing here yet</h2>
          <p>Notifications will show up here once they are set up.</p>
          <p class="version">Notification Center ${VERSION}</p>
        </div>
      </div>
    `;
  }

  static override styles = css`
    :host {
      display: block;
      min-height: 100%;
      background-color: var(--primary-background-color);
      color: var(--primary-text-color);
    }
    .toolbar {
      display: flex;
      align-items: center;
      height: var(--header-height, 56px);
      padding: 0 12px;
      box-sizing: border-box;
      font-size: 20px;
      background-color: var(--app-header-background-color);
      color: var(--app-header-text-color, var(--primary-text-color));
      border-bottom: var(--app-header-border-bottom, none);
    }
    .main-title {
      margin-inline-start: 12px;
      flex: 1;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .content {
      max-width: 1040px;
      margin: 0 auto;
      padding: 16px;
    }
    .empty {
      display: flex;
      flex-direction: column;
      align-items: center;
      text-align: center;
      padding: 64px 16px;
      color: var(--secondary-text-color);
    }
    .empty ha-icon {
      --mdc-icon-size: 64px;
      color: var(--disabled-text-color);
    }
    .empty h2 {
      margin: 16px 0 4px;
      font-size: 20px;
      font-weight: 500;
      color: var(--primary-text-color);
    }
    .empty p {
      margin: 4px 0;
    }
    .version {
      margin-top: 24px !important;
      font-size: 12px;
      color: var(--disabled-text-color);
    }
  `;
}

declare global {
  interface HTMLElementTagNameMap {
    "notification-center-panel": NotificationCenterPanel;
  }
}
