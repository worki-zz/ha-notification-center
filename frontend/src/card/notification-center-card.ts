import { LitElement, css, html, nothing, type PropertyValues } from "lit";
import { property, state } from "lit/decorators.js";

import type {
  Button,
  CardAction,
  CardState,
  Category,
  Duration,
  Notification,
  NotificationState,
  Snooze,
  StateMessage,
} from "../shared/config";
import { DOMAIN } from "../shared/config";
import { defineElement } from "../shared/define";
import {
  cssColor,
  entityAttribute,
  entityState,
  formatTime,
  isStartTime,
  isTimestamp,
  type ColorValue,
  type TimeFormat,
} from "../shared/format";
import {
  type Highlight,
  type NotificationViewData,
  type ViewButton,
} from "../shared/notification-view";
import "../shared/notification-view";
import { subscribeStore, type StoreData } from "../shared/store";
import { TemplateTexts } from "../shared/text";
import type { ActionConfig, HassEntity, HomeAssistant } from "../shared/types";
import { loadDashboardElements } from "./elements";

export const CARD_TYPE = "notification-center-card";
const EDITOR_TYPE = "notification-center-card-editor";

export type DataType =
  | "none"
  | "state"
  | "attribute"
  | "last_changed"
  | "last_updated"
  | "custom";

export interface CardButtonConfig {
  icon?: string;
  label?: string;
  tap_action?: ActionConfig;
}

export interface NotificationCardConfig {
  type: string;
  entity?: string;
  label?: string;
  message?: string;
  info?: string;
  icon?: string;
  color?: ColorValue;
  highlight?: Highlight;
  data?: {
    type?: DataType;
    attribute?: string;
    custom?: string;
    time_format?: TimeFormat;
  };
  tap_action?: ActionConfig;
  buttons?: CardButtonConfig[];
}

const DEFAULT_TIME_FORMAT: TimeFormat = "relative";
// How often relative times are written again.
const TICK = 30_000;

const SNOOZE_CHOICES: { key: string; text: string; label: string; hours?: number }[] = [
  { key: "1h", text: "1 h", label: "Snooze for 1 hour", hours: 1 },
  { key: "3h", text: "3 h", label: "Snooze for 3 hours", hours: 3 },
  { key: "tomorrow", text: "Tomorrow", label: "Snooze until tomorrow" },
];

/** True when an entity is one notification's sensor of the Notification Center. */
export function isNotificationEntity(hass: HomeAssistant, entityId?: string): boolean {
  return (
    !!entityId &&
    entityId !== "sensor.notification_center" &&
    hass.entities?.[entityId]?.platform === DOMAIN
  );
}

function durationMs(duration: Duration): number {
  return (
    ((duration.days ?? 0) * 86400 +
      (duration.hours ?? 0) * 3600 +
      (duration.minutes ?? 0) * 60 +
      (duration.seconds ?? 0)) *
    1000
  );
}

// A button of a Notification Center card, as the card shows it.
interface NcButton {
  key: string;
  label: string;
  icon: string;
  action: CardAction;
  // Snooze: a fixed time, or undefined to ask.
  snoozeMs?: number;
  ask?: boolean;
}

// The dashboard card for one notification.
//
// On its own it shows what its options say. When its entity is a
// notification's sensor of the Notification Center, everything comes from
// there: one card per open card of the notification, with working Done,
// Dismiss and Snooze buttons, hidden while nothing is active.
export class NotificationCenterCard extends LitElement {
  @property({ attribute: false }) public hass?: HomeAssistant;

  // Set by the dashboard in edit mode and in the card picker.
  @property({ type: Boolean }) public preview = false;

  // The dashboard keeps the card in the page while it hides itself, so it
  // keeps following the Notification Center and can show itself again.
  public readonly connectedWhileHidden = true;

  @state() private _config?: NotificationCardConfig;

  @state() private _store: StoreData = {};

  @state() private _now = Date.now();

  // The card (by key) whose snooze choices are open.
  @state() private _asking?: string;

  @state() private _error?: string;

  private _texts = new TemplateTexts(() => this.requestUpdate());

  private _unsubscribeStore?: () => void;

  private _timer?: number;

  public static async getConfigElement(): Promise<HTMLElement> {
    await import("./notification-center-card-editor");
    return document.createElement(EDITOR_TYPE);
  }

  public static getStubConfig(hass: HomeAssistant): Omit<NotificationCardConfig, "type"> {
    const entity = Object.keys(hass.states).find((id) => id.startsWith("binary_sensor."));
    return {
      ...(entity ? { entity } : {}),
      message: "Something needs your attention",
      color: "red",
      data: { type: "last_changed", time_format: "relative" },
    };
  }

  public setConfig(config: NotificationCardConfig): void {
    if (!config) {
      throw new Error("Invalid configuration");
    }
    if (config.buttons !== undefined && !Array.isArray(config.buttons)) {
      throw new Error("buttons must be a list");
    }
    this._config = config;
    this._asking = undefined;
  }

  public getCardSize(): number {
    return 2;
  }

  public getGridOptions() {
    return { columns: 12, min_columns: 6, rows: "auto" };
  }

  public override connectedCallback(): void {
    super.connectedCallback();
    loadDashboardElements();
    this._timer = window.setInterval(() => {
      this._now = Date.now();
    }, TICK);
    this._follow();
  }

  public override disconnectedCallback(): void {
    super.disconnectedCallback();
    window.clearInterval(this._timer);
    this._timer = undefined;
    this._unfollow();
    this._texts.clear();
  }

  protected override willUpdate(changed: PropertyValues): void {
    if (changed.has("hass") || changed.has("_config")) {
      this._follow();
      if (this.hass && this._config && !this._isNcMode()) {
        const data = this._config.data;
        this._texts.update(
          this.hass,
          [
            this._config.label,
            this._config.message,
            this._config.info,
            data?.type === "custom" ? data.custom : undefined,
          ],
          this._config.entity,
        );
      } else {
        this._texts.clear();
      }
    }
  }

  protected override updated(changed: PropertyValues): void {
    super.updated(changed);
    const hidden = this._shouldHide();
    if (hidden !== this.hidden) {
      this.hidden = hidden;
      this.dispatchEvent(
        new CustomEvent("card-visibility-changed", {
          detail: { value: !hidden },
          bubbles: true,
          composed: true,
        }),
      );
    }
  }

  // -- Notification Center ------------------------------------------------

  private _isNcMode(): boolean {
    return !!this.hass && isNotificationEntity(this.hass, this._config?.entity);
  }

  private _follow(): void {
    if (this._isNcMode() && this.isConnected) {
      if (!this._unsubscribeStore && this.hass) {
        this._unsubscribeStore = subscribeStore(this.hass.connection, (data) => {
          this._store = data;
        });
      }
    } else {
      this._unfollow();
    }
  }

  private _unfollow(): void {
    this._unsubscribeStore?.();
    this._unsubscribeStore = undefined;
    this._store = {};
  }

  private _ncEntry():
    | { notification: Notification; category?: Category; state: NotificationState }
    | undefined {
    const { config, state } = this._store;
    const entityId = this._config?.entity;
    if (!config || !state || !entityId) return undefined;
    const found = Object.entries((state as StateMessage).notifications).find(
      ([, item]) => item.entity_id === entityId,
    );
    if (!found) return undefined;
    const notification = config.notifications.find((item) => item.id === found[0]);
    if (!notification) return undefined;
    const category =
      config.categories.find((item) => item.id === notification.category) ??
      config.categories.find((item) => item.id === "general");
    return { notification, category, state: found[1] };
  }

  private _activeCards(): CardState[] {
    return this._ncEntry()?.state.cards.filter((card) => card.status === "active") ?? [];
  }

  private _shouldHide(): boolean {
    if (this.preview || !this._isNcMode()) return false;
    // Until the data is there, stay as it is: showing and hiding again
    // would make the dashboard lay out the card twice.
    if (!this._store.config || !this._store.state) return this.hidden;
    return this._activeCards().length === 0;
  }

  private _snoozeOf(
    button: Button,
    notification: Notification,
    category: Category | undefined,
  ): Snooze {
    if (button.snooze === "ask") return { type: "ask" };
    if (button.snooze && typeof button.snooze === "object") {
      return { type: "fixed", duration: button.snooze };
    }
    return notification.snooze ?? category?.snooze ?? { type: "ask" };
  }

  private _ncButtons(
    card: CardState,
    notification: Notification,
    category: Category | undefined,
  ): NcButton[] {
    const step = notification.steps.find((item) => item.id === card.step_id);
    const result: NcButton[] = [];
    for (const button of step?.buttons ?? []) {
      // Custom buttons, the card tap and the buttons' own actions come with
      // the Notification Center card.
      if (!button.enabled || button.type === "tap" || button.type === "custom") continue;
      if (button.type === "done" && button.card === "done") {
        result.push({
          key: button.id,
          label: button.label || "Done",
          icon: button.icon || "mdi:check",
          action: "done",
        });
      } else if (button.type === "dismiss" && button.card === "dismiss") {
        result.push({
          key: button.id,
          label: button.label || "Dismiss",
          icon: button.icon || "mdi:close",
          action: "dismiss",
        });
      } else if (button.type === "dismiss" && button.card === "keep_silent") {
        if (card.silenced) continue;
        result.push({
          key: button.id,
          label: button.label || "Mute",
          icon: button.icon || "mdi:volume-off",
          action: "silence",
        });
      } else if (button.type === "snooze" && button.card === "snooze") {
        const snooze = this._snoozeOf(button, notification, category);
        if (snooze.type === "not_allowed") continue;
        result.push({
          key: button.id,
          label: button.label || "Snooze",
          icon: button.icon || "mdi:alarm-snooze",
          action: "snooze",
          snoozeMs: snooze.type === "fixed" ? durationMs(snooze.duration) : undefined,
          ask: snooze.type === "ask",
        });
      }
    }
    // Always in this order, whatever the step's order: Snooze, Done, then
    // Dismiss (or Mute).
    const order: CardAction[] = ["snooze", "done", "dismiss", "silence"];
    return result.sort((a, b) => order.indexOf(a.action) - order.indexOf(b.action));
  }

  private _cardKey(card: CardState): string {
    return `${card.step_id}|${card.entity_id ?? ""}`;
  }

  private _ncViews(): { key: string; view: NotificationViewData; card?: CardState }[] {
    const hass = this.hass!;
    const entry = this._ncEntry();
    const config = this._store.config;
    if (!entry || !config) return [];
    const { notification, category } = entry;
    const color = cssColor(notification.card_color ?? category?.card_color);
    const icon = notification.icon || category?.icon || undefined;
    const cards = entry.state.cards.filter((card) => card.status === "active");
    if (!cards.length) {
      return [
        {
          key: "placeholder",
          view: {
            label: notification.name,
            message: "No active notification",
            info: "This card is hidden on the dashboard while nothing is active.",
            icon,
            stateObj: icon ? undefined : hass.states[this._config!.entity!],
            color,
          },
        },
      ];
    }
    return cards.map((card) => {
      const key = this._cardKey(card);
      const buttons = this._ncButtons(card, notification, category);
      const viewButtons: ViewButton[] =
        this._asking === key
          ? [
              ...SNOOZE_CHOICES.map((choice) => ({
                key: `choice:${choice.key}`,
                label: choice.label,
                text: choice.text,
              })),
              { key: "choice:cancel", label: "Back", icon: "mdi:arrow-u-left-top", plain: true },
            ]
          : buttons.map((button) => ({
              key: button.key,
              label: button.label,
              icon: button.icon,
              // Snooze is the quiet one: a background only on hover.
              plain: button.action === "snooze",
            }));
      return {
        key,
        card,
        view: {
          label: notification.name,
          data: formatTime(hass, new Date(card.since), "relative", this._now),
          message: card.message ?? undefined,
          info: card.info ?? undefined,
          icon,
          stateObj: icon ? undefined : hass.states[this._config!.entity!],
          color,
          compact: this._asking === key,
          buttons: viewButtons,
        },
      };
    });
  }

  private async _ncButton(card: CardState, key: string): Promise<void> {
    const hass = this.hass;
    const entry = this._ncEntry();
    if (!hass || !entry) return;
    const cardKey = this._cardKey(card);
    let action: CardAction | undefined;
    let until: Date | null = null;
    if (key.startsWith("choice:")) {
      const choice = SNOOZE_CHOICES.find((item) => `choice:${item.key}` === key);
      this._asking = undefined;
      if (!choice) return;
      action = "snooze";
      until = choice.hours ? new Date(Date.now() + choice.hours * 3600_000) : null;
    } else {
      const button = this._ncButtons(card, entry.notification, entry.category).find(
        (item) => item.key === key,
      );
      if (!button) return;
      if (button.ask) {
        this._asking = cardKey;
        return;
      }
      action = button.action;
      if (button.snoozeMs) {
        until = new Date(Date.now() + button.snoozeMs);
      }
    }
    this._error = undefined;
    try {
      await hass.callWS({
        type: `${DOMAIN}/card/action`,
        notification_id: entry.notification.id,
        step_id: card.step_id,
        entity_id: card.entity_id,
        action,
        ...(until ? { until: until.toISOString() } : {}),
      });
    } catch (err: unknown) {
      this._error = (err as { message?: string })?.message ?? String(err);
    }
  }

  // -- On its own ---------------------------------------------------------

  private _label(stateObj?: HassEntity): string {
    const hass = this.hass!;
    const config = this._config!;
    if (config.label) return this._texts.get(hass, config.label);
    const entityId = config.entity;
    if (!entityId) return "";
    const entry = hass.entities?.[entityId];
    const device = entry?.device_id ? hass.devices?.[entry.device_id] : undefined;
    return (
      device?.name_by_user ||
      device?.name ||
      (stateObj?.attributes.friendly_name as string | undefined) ||
      entityId
    );
  }

  private _time(value: string | undefined): string {
    const hass = this.hass!;
    if (!value) return "";
    const when = new Date(value);
    if (Number.isNaN(when.getTime()) || isStartTime(hass, when)) return "";
    return formatTime(
      hass,
      when,
      this._config!.data?.time_format ?? DEFAULT_TIME_FORMAT,
      this._now,
    );
  }

  private _data(stateObj?: HassEntity): string {
    const hass = this.hass!;
    const data = this._config!.data;
    switch (data?.type) {
      case "state":
        if (!stateObj) return "";
        return isTimestamp(stateObj) ? this._time(stateObj.state) : entityState(hass, stateObj);
      case "attribute":
        return stateObj && data.attribute ? entityAttribute(hass, stateObj, data.attribute) : "";
      case "last_changed":
        return this._time(stateObj?.last_changed);
      case "last_updated":
        return this._time(stateObj?.last_updated);
      case "custom":
        return this._texts.get(hass, data.custom);
      default:
        return "";
    }
  }

  private _ownView(): NotificationViewData {
    const hass = this.hass!;
    const config = this._config!;
    const stateObj = config.entity ? hass.states[config.entity] : undefined;
    const tap = config.tap_action;
    return {
      label: this._label(stateObj),
      data: this._data(stateObj),
      message: this._texts.get(hass, config.message),
      info: this._texts.get(hass, config.info),
      icon: config.icon,
      stateObj,
      color: cssColor(config.color),
      highlight: config.highlight ?? "none",
      clickable: !!tap && tap.action !== "none",
      buttons: (config.buttons ?? []).map((button, index) => ({
        key: String(index),
        label: button.label || "",
        icon: button.icon || "mdi:gesture-tap-button",
      })),
    };
  }

  private _fireAction(action?: ActionConfig): void {
    if (!action || action.action === "none") return;
    this.dispatchEvent(
      new CustomEvent("hass-action", {
        bubbles: true,
        composed: true,
        detail: {
          config: { entity: this._config?.entity, tap_action: action },
          action: "tap",
        },
      }),
    );
  }

  private _ownButton(key: string): void {
    const button = this._config?.buttons?.[Number(key)];
    this._fireAction(button?.tap_action);
  }

  // -- Render ---------------------------------------------------------------

  protected override render() {
    if (!this._config || !this.hass) return nothing;
    if (this._isNcMode()) {
      if (this._store.error) {
        return html`<ha-card class="warning">${this._store.error}</ha-card>`;
      }
      const views = this._ncViews();
      if (!views.length) {
        return this.preview
          ? html`<ha-card class="warning">
              ${this._store.config ? "Notification not found" : "Loading…"}
            </ha-card>`
          : nothing;
      }
      return html`
        <div class="stack">
          ${views.map(
            ({ key, view, card }) => html`
              <notification-center-view
                class=${card ? "" : "placeholder"}
                .hass=${this.hass}
                .view=${view}
                @nc-button=${(ev: CustomEvent<{ key: string }>) => {
                  if (card) void this._ncButton(card, ev.detail.key);
                }}
                data-key=${key}
              ></notification-center-view>
            `,
          )}
          ${this._error ? html`<div class="error">${this._error}</div>` : nothing}
        </div>
      `;
    }
    return html`
      <notification-center-view
        .hass=${this.hass}
        .view=${this._ownView()}
        @nc-tap=${() => this._fireAction(this._config?.tap_action)}
        @nc-button=${(ev: CustomEvent<{ key: string }>) => this._ownButton(ev.detail.key)}
      ></notification-center-view>
    `;
  }

  static override styles = css`
    :host {
      display: block;
      height: 100%;
    }
    .stack {
      display: flex;
      flex-direction: column;
      gap: var(--ha-section-grid-row-gap, 8px);
      height: 100%;
    }
    .placeholder {
      opacity: 0.6;
    }
    .warning {
      padding: 16px;
      color: var(--secondary-text-color);
    }
    .error {
      color: var(--error-color);
      font-size: var(--ha-font-size-s, 12px);
      padding: 0 4px;
    }
  `;
}

defineElement(CARD_TYPE, NotificationCenterCard);

window.customCards = window.customCards ?? [];
if (!window.customCards.some((card) => card.type === CARD_TYPE)) {
  window.customCards.push({
    type: CARD_TYPE,
    name: "Notification",
    description:
      "One notification, with its message, data and buttons. With a Notification Center notification's sensor it shows that notification.",
    preview: true,
    documentationURL: "https://github.com/worki-zz/ha-notification-center",
  });
}

declare global {
  interface HTMLElementTagNameMap {
    "notification-center-card": NotificationCenterCard;
  }
}
