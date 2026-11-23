// One live card of the Notification Center, with working buttons.
//
// Draws the shared notification view and does what its buttons say: the
// card's own buttons, the tap, and the snooze choices when a Snooze asks.

import { LitElement, css, html, nothing, type PropertyValues } from "lit";
import { property, state } from "lit/decorators.js";

import { defineElement } from "./define";
import { cssColor } from "./format";
import {
  snoozeChoices,
  cardData,
  errorText,
  liveButtons,
  pressButton,
  tapButton,
  type LiveCard,
} from "./live";
import { type NotificationViewData, type ViewButton } from "./notification-view";
import "./notification-view";
import type { HomeAssistant } from "./types";

export const LIVE_CARD_ELEMENT = "notification-center-live-card";

export class NotificationCenterLiveCard extends LitElement {
  @property({ attribute: false }) public hass?: HomeAssistant;

  @property({ attribute: false }) public live?: LiveCard;

  // The time relative times are written from.
  @property({ attribute: false }) public now = Date.now();

  // The text after the label; the step's Data when unset.
  @property({ attribute: false }) public data?: string;

  // An extra line below the texts (when an upcoming card comes).
  @property({ attribute: false }) public when?: string;

  // False for a card that only shows (Done today).
  @property({ type: Boolean }) public interactive = true;

  // Not active yet: grey border and buttons.
  @property({ type: Boolean }) public muted = false;

  @state() private _asking = false;

  @state() private _error?: string;

  protected override willUpdate(changed: PropertyValues): void {
    if (changed.has("live")) {
      const old = changed.get("live") as LiveCard | undefined;
      if (old && old.card.status !== this.live?.card.status) {
        this._asking = false;
      }
    }
  }

  private _view(): NotificationViewData | undefined {
    const hass = this.hass;
    const live = this.live;
    if (!hass || !live) return undefined;
    const { card, notification, category } = live;
    const icon = notification.icon || category?.icon || undefined;
    const buttons: ViewButton[] = !this.interactive
      ? []
      : this._asking
        ? [
            ...this._choices(live).map((choice) => ({
              key: `choice:${choice.key}`,
              label: `Snooze: ${choice.label}`,
              text: choice.text,
            })),
            { key: "choice:cancel", label: "Back", icon: "mdi:arrow-u-left-top", plain: true },
          ]
        : liveButtons(live).map((button) => ({
            key: button.key,
            label: button.label,
            icon: button.icon,
            plain: button.plain,
          }));
    return {
      label: notification.name,
      data: this.data ?? cardData(hass, live, this.now),
      message: card.message ?? undefined,
      info: card.info ?? undefined,
      when: this.when,
      icon,
      stateObj: icon || !live.entityId ? undefined : hass.states[live.entityId],
      color: cssColor(live.color ?? notification.color ?? category?.color),
      // Only an active card stands out.
      highlight: this.muted ? "none" : (notification.highlight ?? category?.highlight ?? "none"),
      muted: this.muted,
      clickable: this.interactive && !!tapButton(live),
      compact: this._asking,
      buttons,
    };
  }

  private async _run(task: () => Promise<void>): Promise<void> {
    this._error = undefined;
    try {
      await task();
    } catch (err: unknown) {
      this._error = errorText(err);
    }
  }

  // The times of the card's Snooze button.
  private _choices(live: LiveCard) {
    const snooze = liveButtons(live).find((item) => item.ask);
    return snooze ? snoozeChoices(snooze.button) : [];
  }

  private _tap(): void {
    const hass = this.hass;
    const live = this.live;
    const tap = live ? tapButton(live) : undefined;
    if (!hass || !live || !tap) return;
    void this._run(() => pressButton(hass, this, live, tap));
  }

  private _button(key: string): void {
    const hass = this.hass;
    const live = this.live;
    if (!hass || !live) return;
    if (key.startsWith("choice:")) {
      this._asking = false;
      const choice = this._choices(live).find((item) => `choice:${item.key}` === key);
      const snooze = liveButtons(live).find((item) => item.ask);
      if (!choice || !snooze) return;
      // Home Assistant works out when it ends.
      void this._run(() => pressButton(hass, this, live, snooze.button, choice.key));
      return;
    }
    const button = liveButtons(live).find((item) => item.key === key);
    if (!button) return;
    if (button.ask) {
      this._asking = true;
      return;
    }
    void this._run(() => pressButton(hass, this, live, button.button));
  }

  protected override render() {
    const view = this._view();
    if (!view) return nothing;
    return html`
      <notification-center-view
        .hass=${this.hass}
        .view=${view}
        @nc-tap=${this._tap}
        @nc-button=${(ev: CustomEvent<{ key: string }>) => this._button(ev.detail.key)}
      ></notification-center-view>
      ${this._error ? html`<div class="error">${this._error}</div>` : nothing}
    `;
  }

  static override styles = css`
    :host {
      display: block;
    }
    .error {
      color: var(--error-color);
      font-size: var(--ha-font-size-s, 12px);
      padding: 4px 4px 0;
    }
  `;
}

defineElement(LIVE_CARD_ELEMENT, NotificationCenterLiveCard);

declare global {
  interface HTMLElementTagNameMap {
    "notification-center-live-card": NotificationCenterLiveCard;
  }
}
