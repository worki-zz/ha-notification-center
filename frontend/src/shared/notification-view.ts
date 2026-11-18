// The look of one notification, shared by the dashboard cards and the panel.
//
// Built from the tile and alert cards: a tile icon, a label with its data
// on the first line, the message and the info below, and control buttons
// on the right. The card colour tints the background and the border.

import { LitElement, css, html, nothing } from "lit";
import { property } from "lit/decorators.js";

import { defineElement } from "./define";
import type { HassEntity, HomeAssistant } from "./types";

export type Highlight = "none" | "pulse" | "glow" | "alert";

export const HIGHLIGHTS: Highlight[] = ["none", "pulse", "glow", "alert"];

export interface ViewButton {
  key: string;
  label: string;
  icon?: string;
  // A short text instead of an icon (the snooze choices).
  text?: string;
  // No background, only on hover (a secondary button such as Back).
  plain?: boolean;
}

export interface NotificationViewData {
  label?: string;
  data?: string;
  message?: string;
  info?: string;
  icon?: string;
  // Gives the icon when there is no own icon.
  stateObj?: HassEntity;
  // A CSS colour.
  color: string;
  highlight?: Highlight;
  clickable?: boolean;
  // Only the icon and the buttons: the texts give their room to a choice.
  compact?: boolean;
  buttons?: ViewButton[];
}

export const VIEW_ELEMENT = "notification-center-view";

/**
 * Events: `nc-tap` when the card is clicked, `nc-button` with
 * `detail.key` when a button is pressed.
 */
export class NotificationCenterView extends LitElement {
  @property({ attribute: false }) public hass?: HomeAssistant;

  @property({ attribute: false }) public view?: NotificationViewData;

  protected override render() {
    const view = this.view;
    if (!view) return nothing;
    const highlight = view.highlight ?? "none";
    const buttons = view.buttons ?? [];
    return html`
      <ha-card
        class="highlight-${highlight}"
        style="--nc-color: ${view.color}"
      >
        <div
          class="main ${view.clickable ? "clickable" : ""} ${view.compact ? "compact" : ""}"
          role=${view.clickable ? "button" : "group"}
          tabindex=${view.clickable ? "0" : "-1"}
          @click=${this._tap}
          @keydown=${this._keydown}
        >
          ${view.clickable ? html`<ha-ripple></ha-ripple>` : nothing}
          <ha-tile-icon>
            <ha-state-icon
              slot="icon"
              .hass=${this.hass}
              .icon=${view.icon}
              .stateObj=${view.stateObj}
            ></ha-state-icon>
          </ha-tile-icon>
          <div class="text" ?hidden=${view.compact}>
            ${view.label || view.data
              ? html`<div class="header">
                  ${view.label ? html`<span class="label">${view.label}</span>` : nothing}
                  ${view.label && view.data ? html`<span class="dot">·</span>` : nothing}
                  ${view.data ? html`<span class="data">${view.data}</span>` : nothing}
                </div>`
              : nothing}
            ${view.message ? html`<div class="message">${view.message}</div>` : nothing}
            ${view.info ? html`<div class="info">${view.info}</div>` : nothing}
          </div>
        </div>
        ${buttons.length
          ? html`<div class="buttons">
              ${buttons.map(
                (button) => html`
                  <ha-control-button
                    class="${button.text ? "text" : ""} ${button.plain ? "plain" : ""}"
                    .label=${button.label}
                    @click=${(ev: Event) => this._press(ev, button.key)}
                  >
                    ${button.text
                      ? html`<span>${button.text}</span>`
                      : html`<ha-icon .icon=${button.icon}></ha-icon>`}
                  </ha-control-button>
                `,
              )}
            </div>`
          : nothing}
      </ha-card>
    `;
  }

  private _tap(): void {
    if (!this.view?.clickable) return;
    this.dispatchEvent(new CustomEvent("nc-tap", { bubbles: true, composed: true }));
  }

  private _keydown(ev: KeyboardEvent): void {
    if (ev.key === "Enter" || ev.key === " ") {
      ev.preventDefault();
      this._tap();
    }
  }

  private _press(ev: Event, key: string): void {
    ev.stopPropagation();
    this.dispatchEvent(
      new CustomEvent("nc-button", { detail: { key }, bubbles: true, composed: true }),
    );
  }

  static override styles = css`
    :host {
      display: block;
      height: 100%;
      --nc-tint-opacity: 0.12;
      --nc-alert-opacity: 0.3;
    }
    @keyframes nc-alert {
      from {
        opacity: 0;
      }
      to {
        opacity: var(--nc-alert-opacity);
      }
    }
    @keyframes nc-glow {
      from {
        opacity: 0;
      }
      to {
        opacity: 1;
      }
    }
    @keyframes nc-pulse {
      from {
        border-color: color-mix(in srgb, var(--nc-color) 50%, transparent);
        box-shadow: inset 0 0 8px color-mix(in srgb, var(--nc-color) 30%, transparent);
      }
      to {
        border-color: var(--nc-color);
        box-shadow: inset 0 0 15px color-mix(in srgb, var(--nc-color) 45%, transparent);
      }
    }
    ha-card {
      position: relative;
      overflow: hidden;
      height: 100%;
      box-sizing: border-box;
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      column-gap: 10px;
      padding-right: 10px;
      border-style: solid;
      border-width: max(var(--ha-card-border-width, 1px), 1px);
      border-color: var(--nc-color);
      --tile-color: var(--nc-color);
      --ha-ripple-color: var(--nc-color);
      --ha-ripple-hover-opacity: 0.04;
      --ha-ripple-pressed-opacity: 0.12;
    }
    /* The tint: the alert card's background layer. */
    ha-card::before {
      content: "";
      position: absolute;
      inset: 0;
      background-color: var(--nc-color);
      opacity: var(--nc-tint-opacity);
      pointer-events: none;
    }
    /* The glow: light from both sides. */
    ha-card::after {
      content: "";
      position: absolute;
      inset: 0;
      background:
        radial-gradient(
          ellipse at 0% 50%,
          color-mix(in srgb, var(--nc-color) 25%, transparent),
          transparent 60%
        ),
        radial-gradient(
          ellipse at 100% 50%,
          color-mix(in srgb, var(--nc-color) 25%, transparent),
          transparent 60%
        );
      opacity: 0;
      pointer-events: none;
    }
    ha-card.highlight-alert::before {
      animation: nc-alert 1s ease-in-out infinite alternate;
    }
    ha-card.highlight-glow::after {
      animation: nc-glow 1s ease-in-out infinite alternate;
    }
    ha-card.highlight-pulse {
      animation: nc-pulse 1.5s ease-in-out infinite alternate;
    }
    @media (prefers-reduced-motion: reduce) {
      ha-card.highlight-alert::before {
        animation: none;
        opacity: var(--nc-alert-opacity);
      }
      ha-card.highlight-glow::after {
        animation: none;
        opacity: 1;
      }
      ha-card.highlight-pulse {
        animation: none;
        box-shadow: inset 0 0 12px color-mix(in srgb, var(--nc-color) 40%, transparent);
      }
    }
    /* The buttons go below the text when the text would get too narrow. */
    .main {
      position: relative;
      flex: 1 1 220px;
      min-width: 0;
      align-self: stretch;
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 10px 0 10px 10px;
      min-height: var(--row-height, 56px);
      box-sizing: border-box;
      outline: none;
    }
    .main.clickable {
      cursor: pointer;
    }
    .main.clickable:focus-visible {
      box-shadow: inset 0 0 0 2px var(--nc-color);
      border-radius: inherit;
    }
    ha-tile-icon {
      --tile-icon-color: var(--nc-color);
      flex: none;
      align-self: flex-start;
    }
    .text {
      flex: 1;
      min-width: 0;
      display: flex;
      flex-direction: column;
      gap: 2px;
    }
    .header {
      display: flex;
      align-items: baseline;
      gap: 6px;
      min-width: 0;
      color: var(--nc-color);
      font-size: var(--ha-font-size-xs, 11px);
      font-weight: var(--ha-font-weight-bold, 700);
      line-height: var(--ha-line-height-condensed, 1.2);
      letter-spacing: 1px;
    }
    .label {
      text-transform: uppercase;
      overflow: hidden;
      white-space: nowrap;
      text-overflow: ellipsis;
      flex: 0 1 auto;
      min-width: 0;
    }
    .dot,
    .data {
      flex: none;
      white-space: nowrap;
    }
    .data {
      letter-spacing: 0.4px;
    }
    .message {
      color: var(--primary-text-color);
      font-size: var(--ha-font-size-l, 16px);
      font-weight: var(--ha-font-weight-medium, 500);
      line-height: var(--ha-line-height-normal, 1.5);
      letter-spacing: 0.1px;
      overflow-wrap: anywhere;
    }
    .info {
      color: var(--primary-text-color);
      font-size: var(--ha-font-size-s, 12px);
      font-weight: var(--ha-font-weight-normal, 400);
      line-height: var(--ha-line-height-condensed, 1.2);
      letter-spacing: 0.4px;
      overflow-wrap: anywhere;
    }
    .buttons {
      position: relative;
      flex: none;
      display: flex;
      align-items: center;
      gap: 8px;
      margin-left: auto;
      padding: 6px 0 10px;
    }
    ha-control-button {
      width: 36px;
      height: 36px;
      --control-button-background-color: var(--nc-color);
      --control-button-icon-color: var(--nc-color);
      --control-button-focus-color: var(--nc-color);
      --control-button-border-radius: var(--ha-border-radius-lg, 12px);
      --ha-ripple-color: var(--nc-color);
    }
    ha-control-button.plain {
      --control-button-background-opacity: 0;
    }
    ha-control-button.plain:hover {
      --control-button-background-opacity: 0.2;
    }
    .main.compact {
      flex: 0 0 auto;
    }
    .text[hidden] {
      display: none;
    }
    ha-control-button.text {
      width: auto;
      min-width: 52px;
      --control-button-padding: 0 12px;
      font-size: var(--ha-font-size-s, 12px);
    }
  `;
}

defineElement(VIEW_ELEMENT, NotificationCenterView);

declare global {
  interface HTMLElementTagNameMap {
    "notification-center-view": NotificationCenterView;
  }
}
