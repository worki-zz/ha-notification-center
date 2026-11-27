// The Notification Center card: every active card of the Notification
// Center on a dashboard, in list order, and what Show adds (Upcoming as on
// the Overview, the empty state); hidden while it has nothing to show.

import { LitElement, css, html, nothing, type PropertyValues } from "lit";
import { property, state } from "lit/decorators.js";
import { repeat } from "lit/directives/repeat.js";

import { defineElement } from "../shared/define";
import { cardKey, liveCards, navigate, personOf, type LiveCard } from "../shared/live";
import "../shared/live-card";
import "../shared/notification-view";
import { subscribeStore, type StoreData } from "../shared/store";
import { closeEarlyOf, renderUpcoming, upcomingToday, type UpcomingEntry } from "../shared/upcoming";
import type { HomeAssistant } from "../shared/types";
import { loadDashboardElements } from "./elements";

export const LIST_CARD_TYPE = "notification-center";
const LIST_EDITOR_TYPE = "notification-center-editor";
export const PANEL_PATH = "/notification-center";
export const PANEL_ICON = "mdi:message-bulleted";

export interface NotificationCenterCardConfig {
  type: string;
  // Category ids; empty shows every category.
  categories?: string[];
  // At most this many cards; the rest are behind "+N more".
  max_cards?: number;
  // Also the cards meant for other people.
  ignore_audience?: boolean;
  // What the card shows: the active notifications, Upcoming (as on the
  // Overview) and the empty state (All done instead of hiding). Default:
  // active only.
  show?: ShowPart[];
  // Before 0.7.4: the empty state on (now ``show: [active, empty]``).
  show_empty?: boolean;
}

export type ShowPart = "active" | "upcoming" | "empty";
export const SHOW_PARTS: ShowPart[] = ["active", "upcoming", "empty"];

/** The card's Show, with the older ``show_empty`` turned into it. */
export function upgradeListConfig(config: NotificationCenterCardConfig): NotificationCenterCardConfig {
  if (config.show_empty === undefined) return config;
  const { show_empty: empty, ...rest } = config;
  if (!empty) return rest;
  const show = rest.show ?? ["active"];
  return { ...rest, show: show.includes("empty") ? show : [...show, "empty"] };
}

// How often relative times are written again.
const TICK = 30_000;

export class NotificationCenterListCard extends LitElement {
  @property({ attribute: false }) public hass?: HomeAssistant;

  @property({ type: Boolean }) public preview = false;

  // Keeps following the Notification Center while hidden.
  public readonly connectedWhileHidden = true;

  @state() private _config?: NotificationCenterCardConfig;

  @state() private _store: StoreData = {};

  @state() private _now = Date.now();

  private _unsubscribe?: () => void;

  private _timer?: number;

  public static async getConfigElement(): Promise<HTMLElement> {
    await import("./notification-center-list-card-editor");
    return document.createElement(LIST_EDITOR_TYPE);
  }

  public static getStubConfig(): Omit<NotificationCenterCardConfig, "type"> {
    return {};
  }

  public setConfig(config: NotificationCenterCardConfig): void {
    if (!config) throw new Error("Invalid configuration");
    if (config.categories !== undefined && !Array.isArray(config.categories)) {
      throw new Error("categories must be a list");
    }
    if (
      config.max_cards !== undefined &&
      (!Number.isInteger(config.max_cards) || config.max_cards < 1)
    ) {
      throw new Error("max_cards must be a whole number, 1 or more");
    }
    if (config.show !== undefined && !Array.isArray(config.show)) {
      throw new Error("show must be a list");
    }
    this._config = upgradeListConfig(config);
  }

  private _show(part: ShowPart): boolean {
    return (this._config?.show ?? ["active"]).includes(part);
  }

  public getCardSize(): number {
    return Math.max(1, this._cards()?.length ?? 1) * 2;
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
    this._unsubscribe?.();
    this._unsubscribe = undefined;
    this._store = {};
  }

  protected override willUpdate(changed: PropertyValues): void {
    if (changed.has("hass")) this._follow();
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

  private _follow(): void {
    if (!this._unsubscribe && this.hass && this.isConnected) {
      this._unsubscribe = subscribeStore(this.hass.connection, (data) => {
        this._store = data;
      });
    }
  }

  private _cards(): LiveCard[] | undefined {
    const { config, state } = this._store;
    if (!config || !state || !this.hass || !this._config) return undefined;
    if (!this._show("active")) return [];
    return liveCards(config, state, {
      statuses: ["active"],
      categories: this._config.categories,
      person: personOf(this.hass),
      ignoreAudience: this._config.ignore_audience,
    });
  }

  private _upcoming(): UpcomingEntry[] {
    if (!this.hass || !this._config || !this._show("upcoming")) return [];
    return upcomingToday(this.hass, this._store, this._now, {
      categories: this._config.categories,
      ignoreAudience: this._config.ignore_audience,
    });
  }

  private _shouldHide(): boolean {
    if (this.preview || this._show("empty")) return false;
    const cards = this._cards();
    // Until the data is there, stay as it is.
    if (!cards) return this.hidden;
    return cards.length === 0 && this._upcoming().length === 0;
  }

  protected override render() {
    if (!this._config || !this.hass) return nothing;
    if (this._store.error) {
      return html`<ha-card class="warning">${this._store.error}</ha-card>`;
    }
    const cards = this._cards();
    const upcoming = cards ? this._upcoming() : [];
    if (!cards?.length && !upcoming.length) {
      if (!this.preview && !this._show("empty")) return nothing;
      return html`<notification-center-view
                .hass=${this.hass}
        .view=${{
          message: "Notification Center",
          info: cards ? "All done" : "Loading…",
          icon: PANEL_ICON,
          color: "var(--state-inactive-color)",
          muted: true,
          // Opens the Overview, as the rows after "more" do.
          clickable: !this.preview,
        }}
        @nc-tap=${this._openPanel}
      ></notification-center-view>`;
    }
    const list = cards ?? [];
    const max = this._config.max_cards;
    const shown = max ? list.slice(0, max) : list;
    const more = list.length - shown.length;
    return html`
      <div class="stack">
        ${repeat(
          shown,
          (live) => cardKey(live.card),
          (live) => html`
            <notification-center-live-card
              .hass=${this.hass}
              .live=${live}
              .now=${this._now}
            ></notification-center-live-card>
          `,
        )}
        ${more > 0
          ? html`<div class="more">
              <ha-button appearance="plain" @click=${this._openPanel}>
                ${more} more
              </ha-button>
            </div>`
          : nothing}
        ${upcoming.length
          ? html`<div class="title">Upcoming</div>
              ${renderUpcoming(this.hass, this._store, upcoming, this._now, (item, key) => {
                void closeEarlyOf(this.hass!, item, key).catch(() => undefined);
              })}`
          : nothing}
      </div>
    `;
  }

  private _openPanel(): void {
    navigate(PANEL_PATH);
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
    .warning {
      padding: 16px;
      color: var(--secondary-text-color);
    }
    .more {
      display: flex;
      justify-content: center;
    }
    .title {
      margin: 8px 4px 0;
      font-size: var(--ha-font-size-l, 16px);
      font-weight: var(--ha-font-weight-medium, 500);
      color: var(--primary-text-color);
    }
  `;
}

defineElement(LIST_CARD_TYPE, NotificationCenterListCard);

window.customCards = window.customCards ?? [];
if (!window.customCards.some((card) => card.type === LIST_CARD_TYPE)) {
  window.customCards.push({
    type: LIST_CARD_TYPE,
    name: "Notification Center",
    description:
      "Every active notification of the Notification Center, with its buttons, and Upcoming if asked. Hidden while it has nothing to show, unless Show has Empty state.",
    preview: true,
    documentationURL: "https://github.com/worki-zz/ha-notification-center",
  });
}

declare global {
  interface HTMLElementTagNameMap {
    "notification-center": NotificationCenterListCard;
  }
}
