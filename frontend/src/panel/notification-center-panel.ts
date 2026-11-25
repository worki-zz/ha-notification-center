import { LitElement, css, html, nothing, type PropertyValues } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { repeat } from "lit/directives/repeat.js";

import "./dialog-back";
import "./empty-state";
import { loadDashboardElements } from "../card/elements";
import {
  firstWeekday,
  formatDay,
  formatTime,
  weekday,
} from "../shared/format";
import {
  cardKey,
  effectiveButtons,
  errorText,
  liveCards,
  navigate,
  personOf,
  pressButton,
  type LiveCard,
} from "../shared/live";
import "../shared/live-card";
import "../shared/notification-view";
import { subscribeStore, type StoreData } from "../shared/store";
import {
  doneEarlyOf,
  endOfToday,
  renderScheduled,
  renderUpcoming,
  scheduledSteps,
  upcomingToday,
  type Upcoming,
} from "../shared/upcoming";
import type { HomeAssistant, PanelInfo } from "../shared/types";
import "./category-editor";
import "./general-page";
import "./editor/info-dialog";
import "./editor/notification-editor";
import { loadSettingsElements } from "./ha-elements";
import "./settings-page";

type Page = "overview" | "schedule" | "done" | "settings";

const TITLES: Record<Page, string> = {
  overview: "Notification Center",
  schedule: "Schedule",
  done: "Done today",
  settings: "Settings",
};

// The Schedule section of the days left this week.
const WEEK = "This week";
const NEXT_WEEK = "Next week";

// How often relative times are written again.
const TICK = 30_000;


// The sidebar panel: the Overview of the active cards with what comes
// today, Schedule and Done today behind their buttons, and the settings for
// administrators in the header.
@customElement("notification-center-panel")
export class NotificationCenterPanel extends LitElement {
  @property({ attribute: false }) public hass?: HomeAssistant;

  @property({ type: Boolean, reflect: true }) public narrow = false;

  @property({ attribute: false }) public panel?: PanelInfo;

  @property({ attribute: false }) public route?: { prefix: string; path: string };

  @state() private _store: StoreData = {};

  @state() private _now = Date.now();

  @state() private _error?: string;

  @state() private _notice?: string;

  // The notification whose Status dialog is open (Notification info).
  @state() private _info?: string;


  // Home Assistant's settings elements are loaded (for the settings pages).
  @state() private _haReady = false;

  // The page under the header is scrolled: the header casts a shadow.
  @state() private _scrolled = false;

  private _unsubscribe?: () => void;

  private _timer?: number;

  // A button's Notification info, or a push, opens ?info=<id>.
  private _locationChanged = (): void => {
    void this._pushTapped();
  };

  public override connectedCallback(): void {
    super.connectedCallback();
    window.addEventListener("location-changed", this._locationChanged);
    // Home Assistant's custom panel wrapper has no height of its own, so
    // the page would grow and scroll as a whole, header and all. With the
    // wrapper's height set, the header stays and the page under it scrolls.
    if (this.parentElement?.localName === "ha-panel-custom") {
      this.parentElement.style.height = "100%";
    }
    loadDashboardElements();
    this._timer = window.setInterval(() => {
      this._now = Date.now();
    }, TICK);
    this._follow();
  }

  public override disconnectedCallback(): void {
    super.disconnectedCallback();
    window.removeEventListener("location-changed", this._locationChanged);
    window.clearInterval(this._timer);
    this._timer = undefined;
    this._unsubscribe?.();
    this._unsubscribe = undefined;
  }

  protected override willUpdate(changed: PropertyValues): void {
    if (changed.has("hass")) this._follow();
    if (!this._haReady && this._page === "settings" && this.hass) {
      void loadSettingsElements(this.hass, this).then((ready) => {
        this._haReady = ready;
      });
      // The texts of the trigger and condition editors.
      void (this.hass as { loadFragmentTranslation?: (fragment: string) => Promise<unknown> })
        ?.loadFragmentTranslation?.("config");
    }
    if (changed.has("route")) {
      this._error = undefined;
      this._notice = undefined;
    }
  }

  private _follow(): void {
    if (!this._unsubscribe && this.hass && this.isConnected) {
      this._unsubscribe = subscribeStore(this.hass.connection, (data) => {
        this._store = data;
        void this._pushTapped();
      });
    }
  }

  // A push was tapped (or its button opens a page): the address names the
  // button to press ("nc_press") and maybe the page to open then ("nc_then").
  // Notification info opens the Status dialog of a notification ("info").
  private async _pushTapped(): Promise<void> {
    const query = new URLSearchParams(window.location.search);
    const press = query.get("nc_press");
    const { config, state } = this._store;
    const info = query.get("info");
    if (info && config && state && !press) {
      // A notification id, or its sensor.
      this._info =
        config.notifications.find((item) => item.id === info)?.id ??
        Object.entries(state.notifications).find(([, item]) => item.entity_id === info)?.[0];
      navigate(window.location.pathname, true);
      return;
    }
    if (!press || !config || !state || !this.hass) return;
    const then = query.get("nc_then");
    // Once: the address loses the query at once.
    navigate(then || window.location.pathname, true);
    const [prefix, notificationId, stepId, entityId, buttonId] = press.split("|");
    if (prefix !== "NC") return;
    const live = liveCards(config, state, {
      statuses: ["active"],
      ignoreAudience: true,
      withHeld: true,
    }).find(
      ({ card }) =>
        card.notification_id === notificationId &&
        card.step_id === stepId &&
        (card.entity_id ?? "") === (entityId ?? ""),
    );
    // Ended meanwhile: only the page opens.
    if (!live) return;
    const button = effectiveButtons(live.category, live.step).find((item) => item.id === buttonId);
    if (!button?.enabled) return;
    // The panel may be gone after the page changed: Home Assistant's root
    // opens the more-info dialog.
    const root = document.querySelector<HTMLElement>("home-assistant") ?? this;
    try {
      await pressButton(this.hass, root, live, button);
    } catch (err) {
      this._error = errorText(err);
    }
  }

  private get _isAdmin(): boolean {
    return this.hass?.user?.is_admin ?? false;
  }

  private _parts(): string[] {
    return (this.route?.path ?? "").replace(/^\/+/, "").split("/");
  }

  private get _page(): Page {
    const page = this._parts()[0];
    // "later" is the earlier name of the Schedule page.
    if (page === "schedule" || page === "later") return "schedule";
    if (page === "done") return page;
    if (page === "settings" && this._isAdmin) return "settings";
    return "overview";
  }

  private _go(page: Page): void {
    const base = `/${this.panel?.url_path ?? "notification-center"}`;
    navigate(page === "overview" ? base : `${base}/${page}`);
  }

  // -- Cards ---------------------------------------------------------------

  private _cards(statuses: LiveCard["card"]["status"][]): LiveCard[] {
    const { config, state } = this._store;
    if (!config || !state || !this.hass) return [];
    return liveCards(config, state, { statuses, person: personOf(this.hass) });
  }

  private _upcoming(): Upcoming[] {
    return this.hass ? scheduledSteps(this.hass, this._store, this._now) : [];
  }

  private _doneEarly = (item: Upcoming): void => {
    void this._run(() => doneEarlyOf(this.hass!, item));
  };

  // -- Render --------------------------------------------------------------

  protected override render() {
    const page = this._page;
    if (page === "settings") {
      return this._store.config && this._store.state
        ? this._renderSettingsPage()
        : html`<div class="empty">${this._store.error ?? "Loading…"}</div>`;
    }
    const title = page === "overview" ? (this.panel?.title ?? TITLES.overview) : TITLES[page];
    return html`
      <div class="toolbar ${this._scrolled ? "scrolled" : ""}">
        ${page === "overview"
          ? html`<ha-menu-button .hass=${this.hass} .narrow=${this.narrow}></ha-menu-button>`
          : html`<ha-icon-button .label=${"Back"} @click=${() => this._go("overview")}>
              <ha-icon icon="mdi:arrow-left"></ha-icon>
            </ha-icon-button>`}
        <div class="main-title">${title}</div>
        ${this._isAdmin
          ? html`<ha-icon-button .label=${"Settings"} @click=${() => this._go("settings")}>
              <ha-icon icon="mdi:cog"></ha-icon>
            </ha-icon-button>`
          : nothing}
      </div>
      <div
        class="scroller"
        @scroll=${(ev: Event) => {
          this._scrolled = (ev.target as HTMLElement).scrollTop > 0;
        }}
      ><div class="content">
        ${this._store.error
          ? html`<ha-alert alert-type="error">${this._store.error}</ha-alert>`
          : nothing}
        ${this._error ? html`<ha-alert alert-type="error">${this._error}</ha-alert>` : nothing}
        ${this._notice
          ? html`<ha-alert alert-type="success">${this._notice}</ha-alert>`
          : nothing}
        ${!this._store.config || !this._store.state
          ? this._store.error
            ? nothing
            : html`<div class="empty">Loading…</div>`
          : page === "schedule"
            ? this._renderSchedule()
            : page === "done"
              ? this._renderDone()
              : this._renderOverview()}
      </div></div>
      ${this._renderInfo()}
    `;
  }

  private _renderInfo() {
    const { config, state } = this._store;
    const notification = config?.notifications.find((item) => item.id === this._info);
    if (!notification) return nothing;
    return html`<nc-info-dialog
      .hass=${this.hass}
      .config=${config}
      .state=${state}
      .notification=${notification}
      @info-closed=${() => (this._info = undefined)}
    ></nc-info-dialog>`;
  }

  private _renderLive(
    cards: LiveCard[],
    data?: (live: LiveCard) => string,
    interactive = true,
    muted = false,
    when?: (live: LiveCard) => string,
  ) {
    return repeat(
      cards,
      (live) => cardKey(live.card),
      (live) => html`
        <notification-center-live-card
          .hass=${this.hass}
          .live=${live}
          .now=${this._now}
          .data=${data?.(live)}
          .when=${when?.(live)}
          .interactive=${interactive}
          .muted=${muted}
        ></notification-center-live-card>
      `,
    );
  }

  private _renderUpcoming(items: Upcoming[]) {
    return renderScheduled(this.hass!, items, this._doneEarly);
  }

  // The active cards, then Upcoming: what is due today and the snoozed
  // cards, by their time.
  private _renderOverview() {
    const active = this._cards(["active"]);
    const end = endOfToday(this._now);
    const timed = this.hass ? upcomingToday(this.hass, this._store, this._now) : [];
    const done = this._cards(["done"]).length;
    const later = this._upcoming().some((item) => item.due.getTime() >= end);
    if (!this._store.config?.notifications.length) {
      return html`<nc-empty-state
        text="No notifications yet"
        .action=${this._isAdmin ? "Add notification" : ""}
        @nc-action=${() => navigate(`/${this.panel?.url_path ?? "notification-center"}/settings/notifications/new`)}
      ></nc-empty-state>`;
    }
    return html`
      ${active.length
        ? this._renderLive(active)
        : html`<ha-card outlined class="all-done">
            <ha-icon icon="mdi:message-bulleted"></ha-icon>
            <div>${timed.length ? "No active notifications" : "All done"}</div>
          </ha-card>`}
      ${timed.length
        ? html`<h2>Upcoming</h2>
            ${renderUpcoming(this.hass!, this._store, timed, this._now, this._doneEarly)}`
        : nothing}
      ${later || done
        ? html`<div class="pages">
            ${done
              ? html`<ha-button appearance="plain" @click=${() => this._go("done")}>
                  <ha-icon slot="start" icon="mdi:check-all"></ha-icon>
                  Done · ${done}
                </ha-button>`
              : nothing}
            ${later
              ? html`<ha-button appearance="plain" @click=${() => this._go("schedule")}>
                  <ha-icon slot="start" icon="mdi:calendar"></ha-icon>
                  Schedule
                </ha-button>`
              : nothing}
          </div>`
        : nothing}
    `;
  }

  // A page with nothing on it: one neutral card with a short text.
  private _renderEmpty(text: string) {
    return html`<notification-center-view
      .hass=${this.hass}
      .view=${{
        message: text,
        icon: "mdi:message-bulleted",
        color: "var(--state-inactive-color)",
        muted: true,
      }}
    ></notification-center-view>`;
  }

  // The scheduled steps due after today, by their next day, under this week,
  // next week, this month, next month, this year, next year (and later years
  // by number); an empty section does not show. Tomorrow reads "Tomorrow" with
  // its time, the other days of the two weeks their weekday.
  private _renderSchedule() {
    const hass = this.hass!;
    const end = endOfToday(this._now);
    const items = this._upcoming().filter((item) => item.due.getTime() >= end);
    if (!items.length) return this._renderEmpty("Nothing scheduled");
    const today = new Date(this._now);
    today.setHours(0, 0, 0, 0);
    const tomorrowEnd = new Date(today);
    tomorrowEnd.setDate(today.getDate() + 2);
    const week = new Date(today);
    week.setDate(today.getDate() + (((firstWeekday(hass) - today.getDay() + 6) % 7) + 1));
    const nextWeek = new Date(week);
    nextWeek.setDate(week.getDate() + 7);
    const month = new Date(today.getFullYear(), today.getMonth() + 1, 1);
    const nextMonth = new Date(today.getFullYear(), today.getMonth() + 2, 1);
    const year = new Date(today.getFullYear() + 1, 0, 1);
    const nextYear = new Date(today.getFullYear() + 2, 0, 1);
    const title = (due: Date): string => {
      if (due < week) return WEEK;
      if (due < nextWeek) return NEXT_WEEK;
      if (due < month) return "This month";
      if (due < nextMonth) return "Next month";
      if (due < year) return "This year";
      if (due < nextYear) return "Next year";
      return String(due.getFullYear());
    };
    const when = (section: string, due: Date): string => {
      if (due < tomorrowEnd) return `Tomorrow, ${formatTime(hass, due, "time", this._now)}`;
      if (section === WEEK || section === NEXT_WEEK) return weekday(hass, due);
      return formatDay(hass, due, this._now);
    };
    const sections: { title: string; items: Upcoming[] }[] = [];
    for (const item of items) {
      const name = title(item.due);
      const last = sections[sections.length - 1];
      if (last?.title === name) last.items.push(item);
      else sections.push({ title: name, items: [item] });
    }
    return sections.map(
      (section) => html`
        <h2 class="section">${section.title}</h2>
        ${this._renderUpcoming(
          section.items.map((item) => ({
            ...item,
            view: { ...item.view, when: when(section.title, item.due) },
          })),
        )}
      `,
    );
  }

  private _renderDone() {
    const done = this._cards(["done"]);
    if (!done.length) return this._renderEmpty("Nothing done today yet");
    const hass = this.hass!;
    return this._renderLive(
      done,
      () => "",
      false,
      true,
      (live) =>
        live.card.closed_at
          ? `Done ${formatTime(hass, new Date(live.card.closed_at), "time", this._now)}`
          : "Done",
    );
  }

  // The settings: Home Assistant's own subpage layout, the list or the
  // editor of one notification.
  private _renderSettingsPage() {
    // HA's elements need hass for their texts: not before it is set.
    if (!this._haReady || !this.hass) {
      return html`<div class="empty">Loading…</div>`;
    }
    const { config, state, hasData } = this._store;
    const base = `/${this.panel?.url_path ?? "notification-center"}`;
    const parts = this._parts();
    if (parts[1] === "categories" && parts[2]) {
      return html`<nc-category-editor
        .hass=${this.hass}
        .narrow=${this.narrow}
        .config=${config}
        .categoryId=${parts[2]}
        .base=${base}
      ></nc-category-editor>`;
    }
    if (parts[1] === "general" && parts[2]) {
      return html`<nc-general-page
        .hass=${this.hass}
        .narrow=${this.narrow}
        .config=${config}
        .state=${state}
        .hasData=${hasData ?? false}
        .page=${parts[2]}
        .base=${base}
      ></nc-general-page>`;
    }
    if (parts[1] === "notifications" && parts[2]) {
      return html`<nc-notification-editor
        .hass=${this.hass}
        .narrow=${this.narrow}
        .config=${config}
        .state=${state}
        .notificationId=${parts[2]}
        .base=${base}
      ></nc-notification-editor>`;
    }
    return html`<nc-settings
      .hass=${this.hass}
      .narrow=${this.narrow}
      .config=${config}
      .state=${state}
      .hasData=${hasData ?? false}
      .tab=${parts[1] === "general" || parts[1] === "categories" ? parts[1] : "notifications"}
      .base=${base}
    ></nc-settings>`;
  }

  private async _run(task: () => Promise<void>): Promise<void> {
    this._error = undefined;
    this._notice = undefined;
    try {
      await task();
    } catch (err) {
      this._error = errorText(err);
    }
  }

  static override styles = css`
    :host {
      display: flex;
      flex-direction: column;
      height: 100%;
      background-color: var(--primary-background-color);
      color: var(--primary-text-color);
    }
    nc-settings,
    nc-general-page,
    nc-category-editor,
    nc-notification-editor {
      flex: 1;
      min-height: 0;
    }
    /* Fixed, with a dashboard header's look (the theme's app header). */
    .toolbar {
      flex: none;
      position: relative;
      z-index: 4;
      display: flex;
      align-items: center;
      height: var(--header-height, 56px);
      padding: 0 12px;
      box-sizing: border-box;
      font-size: var(--ha-font-size-xl, 20px);
      font-weight: var(--ha-font-weight-normal, 400);
      background-color: var(--app-header-background-color);
      color: var(--app-header-text-color, white);
      border-bottom: var(--app-header-border-bottom, none);
      backdrop-filter: var(--app-header-backdrop-filter, none);
    }
    .toolbar.scrolled {
      box-shadow: var(
        --bar-box-shadow,
        0px 2px 4px -1px #0003,
        0px 4px 5px 0px #00000024,
        0px 1px 10px 0px #0000001f
      );
    }
    :host([narrow]) .toolbar {
      padding: 0 4px;
    }
    .scroller {
      flex: 1;
      min-height: 0;
      overflow-y: auto;
    }
    .main-title {
      margin-inline-start: var(--ha-space-6, 24px);
      line-height: var(--ha-line-height-normal, 1.5);
      min-width: 0;
      flex: 1;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    :host([narrow]) .main-title {
      margin-inline-start: var(--ha-space-2, 8px);
    }
    /* Twice a dashboard's gap between the cards. */
    .content {
      max-width: 640px;
      margin: 0 auto;
      /* 24px under the header, as on every settings page. */
      padding: 24px 16px 16px;
      display: flex;
      flex-direction: column;
      gap: 16px;
    }
    h2 {
      margin: 8px 4px 0;
      font-size: var(--ha-font-size-m, 14px);
      font-weight: var(--ha-font-weight-medium, 500);
      color: var(--secondary-text-color);
    }
    /* Room above every section title but the first. */
    h2.section:not(:first-child) {
      margin-top: 24px;
    }
    /* Done and Schedule side by side in the middle. */
    /* The Overview with nothing active: a big icon over the text, centred. */
    .all-done {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 12px;
      padding: 40px 16px;
      color: var(--primary-text-color);
      font-size: var(--ha-font-size-l, 16px);
      font-weight: var(--ha-font-weight-medium, 500);
    }
    .all-done ha-icon {
      --mdc-icon-size: 48px;
      color: var(--primary-text-color);
    }
    .pages {
      display: flex;
      justify-content: center;
      flex-wrap: wrap;
      gap: 8px;
      margin-top: 8px;
    }
    .empty {
      padding: 32px 16px;
      text-align: center;
      color: var(--secondary-text-color);
    }
    .intro {
      margin: 0;
      color: var(--secondary-text-color);
    }
    .buttons {
      display: flex;
      gap: 8px;
      flex-wrap: wrap;
    }
    .card-content p {
      margin-top: 0;
    }
    .row {
      display: flex;
      align-items: center;
      gap: 16px;
      padding: 8px 16px;
      min-height: 48px;
    }
    .row:last-child {
      padding-bottom: 16px;
    }
    .row ha-icon {
      color: var(--state-icon-color, var(--secondary-text-color));
      flex: none;
    }
    .row.disabled {
      opacity: 0.5;
    }
    .text {
      min-width: 0;
    }
    .secondary,
    .card-content.empty {
      color: var(--secondary-text-color);
      font-size: 14px;
    }
    .badge {
      margin-inline-start: auto;
      padding: 2px 8px;
      border-radius: 12px;
      font-size: 12px;
      background-color: var(--secondary-background-color);
      color: var(--secondary-text-color);
    }
    .badge.active {
      background-color: var(--primary-color);
      color: var(--text-primary-color);
    }
    .version {
      margin: 8px 0 0;
      text-align: center;
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
