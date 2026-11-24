// The Notification badge: the small twin of the Notification card, for one
// entity, at the top of a sections view.
//
// With another entity it is Home Assistant's own entity badge (the same
// options; its Visibility conditions decide when it shows). With a
// notification's sensor of the Notification Center, everything comes from
// the notification: icon, colour (by status, as the sensor's icon_color),
// message and highlight. The channels do not count; Show when hides it in
// the statuses left out; Ignore audience (default on) shows it to everyone.
// A tap runs the notification's Tap behavior, unless the badge sets its own
// tap action.

import { LitElement, css, html, nothing, type PropertyValues } from "lit";
import { property, state } from "lit/decorators.js";

import { defineElement } from "../shared/define";
import {
  entityStatusOf,
  showsFor,
  statusMessage,
  statusText,
  type EntityStatus,
  type ShowStatus,
} from "../shared/entity-status";
import { errorText, pressButton, tapButton } from "../shared/live";
import { subscribeStore, type StoreData } from "../shared/store";
import type { ActionConfig, HomeAssistant } from "../shared/types";
import { isNotificationEntity } from "./notification-center-card";

export const BADGE_TYPE = "notification-center-badge";
const EDITOR_TYPE = "notification-center-badge-editor";

/** What the state part of a badge with a notification's sensor shows. */
export type NcStateContent = "message" | "info" | "status" | "name";

export const NC_STATE_CONTENT: NcStateContent[] = ["message", "info", "status", "name"];

export interface NotificationBadgeConfig {
  type: string;
  entity?: string;
  name?: string;
  icon?: string;
  color?: string;
  show_name?: boolean;
  show_state?: boolean;
  show_icon?: boolean;
  show_entity_picture?: boolean;
  // Another entity: Home Assistant's state content; a notification's
  // sensor: NcStateContent values (default: message).
  state_content?: string | string[];
  time_format?: string;
  tap_action?: ActionConfig;
  hold_action?: ActionConfig;
  double_tap_action?: ActionConfig;
  show_when?: ShowStatus[];
  ignore_audience?: boolean;
}

// The keys only this badge knows; Home Assistant's entity badge gets the rest.
const OWN_KEYS = ["show_when", "ignore_audience"];

const HOLD_MS = 500;
const DOUBLE_TAP_MS = 250;
const TICK = 30_000;

async function createEntityBadge(config: Record<string, unknown>): Promise<HTMLElement | undefined> {
  const helpers = await window.loadCardHelpers?.();
  return helpers?.createBadgeElement?.(config);
}

let badgeElements: Promise<void> | undefined;

// ha-badge comes with Home Assistant's entity badge: create one to load it.
function loadBadgeElements(): Promise<void> {
  badgeElements ??= createEntityBadge({ type: "entity", entity: "sun.sun" })
    .then(() => customElements.whenDefined("ha-badge"))
    .then(() => undefined)
    .catch(() => undefined);
  return badgeElements;
}

export class NotificationCenterBadge extends LitElement {
  @property({ attribute: false }) public hass?: HomeAssistant;

  // Set by the dashboard in edit mode and in the badge picker.
  @property({ type: Boolean }) public preview = false;

  @state() private _config?: NotificationBadgeConfig;

  @state() private _store: StoreData = {};

  @state() private _now = Date.now();

  @state() private _entityBadge?: HTMLElement & { hass?: HomeAssistant };

  @state() private _error?: string;

  private _unsubscribeStore?: () => void;

  private _timer?: number;

  private _holdTimer?: number;

  private _held = false;

  private _tapTimer?: number;

  public static async getConfigElement(): Promise<HTMLElement> {
    await import("./notification-center-badge-editor");
    return document.createElement(EDITOR_TYPE);
  }

  public static getStubConfig(hass: HomeAssistant): Omit<NotificationBadgeConfig, "type"> {
    const entity =
      Object.keys(hass.states).find((id) => isNotificationEntity(hass, id)) ??
      Object.keys(hass.states).find((id) => id.startsWith("sensor."));
    return entity ? { entity } : {};
  }

  public setConfig(config: NotificationBadgeConfig): void {
    if (!config) throw new Error("Invalid configuration");
    if (config.show_when !== undefined && !Array.isArray(config.show_when)) {
      throw new Error("show_when must be a list");
    }
    this._config = { show_name: false, show_state: true, show_icon: true, ...config };
    this._entityBadge = undefined;
  }

  public override connectedCallback(): void {
    super.connectedCallback();
    void loadBadgeElements().then(() => this.requestUpdate());
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
  }

  protected override willUpdate(changed: PropertyValues): void {
    if (changed.has("hass") || changed.has("_config")) {
      this._follow();
      if (this.hass && this._config && !this._isNcMode()) {
        if (!this._entityBadge) void this._createEntityBadge();
        else this._entityBadge.hass = this.hass;
      }
    }
  }

  protected override updated(changed: PropertyValues): void {
    super.updated(changed);
    // Hidden in a status left out (in the editor it shows faded).
    const hidden = this._shouldHide();
    this.style.display = hidden ? "none" : "";
  }

  private _isNcMode(): boolean {
    return !!this.hass && isNotificationEntity(this.hass, this._config?.entity);
  }

  private async _createEntityBadge(): Promise<void> {
    const config: Record<string, unknown> = { ...this._config, type: "entity" };
    for (const key of OWN_KEYS) delete config[key];
    const element = (await createEntityBadge(config)) as
      | (HTMLElement & { hass?: HomeAssistant })
      | undefined;
    if (!element || this._isNcMode()) return;
    element.hass = this.hass;
    this._entityBadge = element;
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
    const status = this._status();
    if (!status) return !this._store.config;
    return !showsFor(this._config?.show_when, status.status);
  }

  // -- Text -------------------------------------------------------------------

  private _name(status: EntityStatus): string {
    return this._config?.name || status.notification.name;
  }

  private _stateText(status: EntityStatus): string {
    const hass = this.hass!;
    const raw = this._config?.state_content;
    const contents = (Array.isArray(raw) ? raw : raw ? [raw] : ["message"]) as NcStateContent[];
    const parts = contents
      .map((content) => {
        switch (content) {
          case "message":
            return statusMessage(status);
          case "info":
            return status.cards[0]?.card.info ?? "";
          case "status":
            return statusText(hass, status, this._now);
          case "name":
            return this._name(status);
          default:
            return "";
        }
      })
      .filter((part) => part);
    // Nothing to say: the status.
    return parts.length ? parts.join(" · ") : statusText(hass, status, this._now);
  }

  // -- Actions ----------------------------------------------------------------

  private _hasAction(action?: ActionConfig): boolean {
    return !!action && action.action !== "none";
  }

  private _fire(action: "tap" | "hold" | "double_tap"): void {
    const config = this._config;
    if (!config) return;
    if (action === "tap" && !config.tap_action && this._runTap()) return;
    this.dispatchEvent(
      new CustomEvent("hass-action", {
        bubbles: true,
        composed: true,
        detail: { config: { ...config, entity: config.entity }, action },
      }),
    );
  }

  // The notification's own Tap behavior, on its first active card.
  private _runTap(): boolean {
    const hass = this.hass;
    const status = this._status();
    const live = status?.status === "active" ? status.cards[0] : undefined;
    const tap = live ? tapButton(live) : undefined;
    if (!hass || !live || !tap) return false;
    this._error = undefined;
    pressButton(hass, this, live, tap).catch((err: unknown) => {
      this._error = errorText(err);
    });
    return true;
  }

  private _pointerDown(): void {
    this._held = false;
    if (!this._hasAction(this._config?.hold_action)) return;
    window.clearTimeout(this._holdTimer);
    this._holdTimer = window.setTimeout(() => {
      this._held = true;
      this._fire("hold");
    }, HOLD_MS);
  }

  private _pointerUp(): void {
    window.clearTimeout(this._holdTimer);
  }

  private _click(): void {
    if (this._held) {
      this._held = false;
      return;
    }
    if (!this._hasAction(this._config?.double_tap_action)) {
      this._fire("tap");
      return;
    }
    if (this._tapTimer !== undefined) {
      window.clearTimeout(this._tapTimer);
      this._tapTimer = undefined;
      this._fire("double_tap");
      return;
    }
    this._tapTimer = window.setTimeout(() => {
      this._tapTimer = undefined;
      this._fire("tap");
    }, DOUBLE_TAP_MS);
  }

  // -- Render -----------------------------------------------------------------

  protected override render() {
    const config = this._config;
    const hass = this.hass;
    if (!config || !hass) return nothing;
    if (!this._isNcMode()) return this._entityBadge ?? nothing;
    if (this._store.error) {
      return html`<ha-badge class="error" .label=${config.entity}>
        <ha-icon slot="icon" icon="mdi:alert-circle"></ha-icon>
        ${this._store.error}
      </ha-badge>`;
    }
    const status = this._status();
    if (!status) {
      return html`<ha-badge .label=${config.entity}>
        <ha-icon slot="icon" icon="mdi:bell"></ha-icon>
        ${this._store.config ? "Notification not found" : "Loading…"}
      </ha-badge>`;
    }
    const { notification, category } = status;
    const shown = showsFor(config.show_when, status.status);
    const name = this._name(status);
    const showState = config.show_state !== false;
    const showName = !!config.show_name;
    const content = showState ? this._stateText(status) : showName ? name : undefined;
    const label = showState && showName ? name : undefined;
    const icon = config.icon || notification.icon || category?.icon || "mdi:bell";
    // An own colour (not "state") replaces the notification's while active.
    const own = config.color && config.color !== "state" ? config.color : undefined;
    const color =
      own && status.status === "active"
        ? own.startsWith("#")
          ? own
          : `var(--${own}-color)`
        : status.color;
    const highlight =
      status.status === "active" &&
      (notification.highlight ?? category?.highlight ?? "none") !== "none";
    return html`<ha-badge
      class=${`${shown ? "" : "faded"} ${highlight ? "highlight" : ""}`}
      type="button"
      .label=${label}
      .accessibleLabel=${name}
      .iconOnly=${!content}
      style=${`--badge-color: ${color}`}
      title=${this._error ?? ""}
      @pointerdown=${this._pointerDown}
      @pointerup=${this._pointerUp}
      @pointercancel=${this._pointerUp}
      @pointerleave=${this._pointerUp}
      @click=${this._click}
      @contextmenu=${(ev: Event) => {
        if (this._hasAction(config.hold_action)) ev.preventDefault();
      }}
    >
      ${config.show_icon !== false
        ? html`<ha-icon slot="icon" class="icon" .icon=${icon}></ha-icon>`
        : nothing}
      ${content ?? nothing}
    </ha-badge>`;
  }

  static override styles = css`
    :host {
      display: inline-block;
    }
    ha-badge {
      --badge-color: var(--state-inactive-color);
    }
    ha-badge.error {
      --badge-color: var(--red-color);
    }
    ha-badge.highlight {
      --ha-card-border-color: var(--badge-color);
    }
    ha-badge.highlight .icon {
      animation: nc-badge-pulse 1.5s ease-in-out infinite alternate;
    }
    ha-badge.faded {
      opacity: 0.5;
    }
    @keyframes nc-badge-pulse {
      from {
        opacity: 1;
      }
      to {
        opacity: 0.35;
      }
    }
    @media (prefers-reduced-motion: reduce) {
      ha-badge.highlight .icon {
        animation: none;
      }
    }
  `;
}

defineElement(BADGE_TYPE, NotificationCenterBadge);

window.customBadges = window.customBadges ?? [];
if (!window.customBadges.some((badge) => badge.type === BADGE_TYPE)) {
  window.customBadges.push({
    type: BADGE_TYPE,
    name: "Notification",
    description:
      "One entity as a badge. With a Notification Center notification's sensor it shows that notification: its icon, colour and message.",
    preview: true,
    documentationURL: "https://github.com/worki-zz/ha-notification-center",
  });
}

declare global {
  interface HTMLElementTagNameMap {
    "notification-center-badge": NotificationCenterBadge;
  }
}
