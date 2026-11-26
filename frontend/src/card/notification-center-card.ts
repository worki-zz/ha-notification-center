import { LitElement, css, html, nothing, type PropertyValues } from "lit";
import { property, state } from "lit/decorators.js";
import { repeat } from "lit/directives/repeat.js";

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
  SHOW_STATUS_LABELS,
  entityStatusOf,
  showsFor,
  statusText,
  type EntityStatus,
  type ShowStatus,
} from "../shared/entity-status";
import { cardKey, type LiveCard } from "../shared/live";
import "../shared/live-card";
import { type Highlight, type NotificationViewData } from "../shared/notification-view";
import "../shared/notification-view";
import { subscribeStore, type StoreData } from "../shared/store";
import { TemplateTexts } from "../shared/text";
import { closeEarlyOf, renderScheduled } from "../shared/upcoming";
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
  // A notification's sensor: the statuses it shows in (left out: always).
  show_when?: ShowStatus[];
  // A notification's sensor: everyone sees it (default); false: only its
  // Audience, in their state now.
  ignore_audience?: boolean;
}

const DEFAULT_TIME_FORMAT: TimeFormat = "relative";
// How often relative times are written again.
const TICK = 30_000;

/** True when an entity is one notification's sensor of the Notification Center. */
export function isNotificationEntity(hass: HomeAssistant, entityId?: string): boolean {
  return (
    !!entityId &&
    entityId !== "sensor.notification_center" &&
    hass.entities?.[entityId]?.platform === DOMAIN
  );
}

// The dashboard card for one notification.
//
// On its own it shows what its options say. When its entity is a
// notification's sensor of the Notification Center, everything comes from
// there: one card per open card of the notification, with working buttons;
// snoozed, upcoming, done today or idle as the Overview shows them. The
// channels do not count; Show when hides it in the statuses left out.
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
    if (config.show_when !== undefined && !Array.isArray(config.show_when)) {
      throw new Error("show_when must be a list");
    }
    this._config = config;
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

  // The notification's status for the viewer, with its cards.
  private _status(): EntityStatus | undefined {
    if (!this.hass) return undefined;
    return entityStatusOf(
      this.hass,
      this._store,
      this._config?.entity,
      this._config?.ignore_audience ?? true,
      this._now,
    );
  }

  private _shouldHide(): boolean {
    if (this.preview || !this._isNcMode()) return false;
    // Until the data is there, stay as it is: showing and hiding again
    // would make the dashboard lay out the card twice.
    const status = this._status();
    if (!status) return this._store.config ? false : this.hidden;
    return !showsFor(this._config?.show_when, status.status);
  }

  // Idle: the notification, greyed, with when it was last done.
  private _idleView(status: EntityStatus): NotificationViewData {
    const { notification, category } = status;
    const entityId = this._config!.entity!;
    const icon = notification.icon || category?.icon || undefined;
    const lastDone = this._store.state?.notifications[notification.id]?.last_done;
    return {
      label: notification.name,
      message: "No active notification",
      info: lastDone ? `Last done ${this._time(lastDone)}` : undefined,
      icon,
      stateObj: icon ? undefined : this.hass!.states[entityId],
      color: "var(--state-inactive-color)",
      muted: true,
    };
  }

  private _renderStatus(status: EntityStatus) {
    const hass = this.hass!;
    if (status.status === "idle") {
      return html`<notification-center-view
        .hass=${hass}
        .view=${this._idleView(status)}
      ></notification-center-view>`;
    }
    if (status.status === "upcoming") {
      return renderScheduled(hass, status.upcoming, (item, key) => void closeEarlyOf(hass, item, key));
    }
    const snoozed = status.status === "snoozed";
    const when = snoozed ? statusText(hass, status, this._now) : undefined;
    return repeat(
      status.cards,
      (live: LiveCard) => cardKey(live.card),
      (live: LiveCard) => html`
        <notification-center-live-card
          .hass=${hass}
          .live=${live}
          .now=${this._now}
          .when=${when}
          .muted=${snoozed}
          .interactive=${status.status !== "done"}
        ></notification-center-live-card>
      `,
    );
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
      const status = this._status();
      // While loading (Home Assistant starting) a dashboard shows nothing.
      if (!status && !this._store.config && !this.preview) return nothing;
      if (!status) {
        return html`<ha-card class="warning">
          ${this._store.config ? "Notification not found" : "Loading…"}
        </ha-card>`;
      }
      const shown = showsFor(this._config.show_when, status.status);
      if (!shown && !this.preview) return nothing;
      // In the editor a card hidden now shows faded, with why.
      return html`
        <div class="stack ${shown ? "" : "placeholder"}">${this._renderStatus(status)}</div>
        ${shown
          ? nothing
          : html`<div class="hidden-note">
              Hidden on the dashboard while ${SHOW_STATUS_LABELS[status.status].toLowerCase()}.
            </div>`}
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
    .hidden-note {
      color: var(--secondary-text-color);
      font-size: var(--ha-font-size-s, 12px);
      padding: 4px 4px 0;
    }
    .warning {
      padding: 16px;
      color: var(--secondary-text-color);
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
      "One notification, with its message, data and buttons. With a Notification Center notification's sensor it shows that notification in every status.",
    preview: true,
    documentationURL: "https://github.com/worki-zz/ha-notification-center",
  });
}

declare global {
  interface HTMLElementTagNameMap {
    "notification-center-card": NotificationCenterCard;
  }
}
