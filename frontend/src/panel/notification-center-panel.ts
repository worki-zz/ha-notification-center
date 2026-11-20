import { LitElement, css, html, nothing, type PropertyValues } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { repeat } from "lit/directives/repeat.js";

import "./dialog-back";
import { loadDashboardElements } from "../card/elements";
import {
  cssColor,
  firstWeekday,
  formatDay,
  formatTime,
  formatWhen,
  monthName,
  weekday,
} from "../shared/format";
import {
  cardKey,
  categoryOf,
  doneEarly,
  errorText,
  inAudience,
  liveCards,
  navigate,
  personOf,
  stepOf,
  type LiveCard,
} from "../shared/live";
import "../shared/live-card";
import { type NotificationViewData } from "../shared/notification-view";
import "../shared/notification-view";
import { subscribeStore, type StoreData } from "../shared/store";
import { isTemplate, replacePlaceholders } from "../shared/text";
import type { HomeAssistant, PanelInfo } from "../shared/types";
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
const WEEK = "Week";

// How often relative times are written again.
const TICK = 30_000;

interface Upcoming {
  key: string;
  notificationId: string;
  stepId: string;
  due: Date;
  view: NotificationViewData;
}

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


  // Home Assistant's settings elements are loaded (for the settings pages).
  @state() private _haReady = false;

  // The page under the header is scrolled: the header casts a shadow.
  @state() private _scrolled = false;

  private _unsubscribe?: () => void;

  private _timer?: number;

  public override connectedCallback(): void {
    super.connectedCallback();
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
    window.clearInterval(this._timer);
    this._timer = undefined;
    this._unsubscribe?.();
    this._unsubscribe = undefined;
  }

  protected override willUpdate(changed: PropertyValues): void {
    if (changed.has("hass")) this._follow();
    if (!this._haReady && this._page === "settings") {
      void loadSettingsElements().then((ready) => {
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
      });
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

  private _endOfToday(): number {
    const end = new Date(this._now);
    end.setHours(24, 0, 0, 0);
    return end.getTime();
  }

  private _when(when: Date): string {
    return formatWhen(this.hass!, when, this._now);
  }

  // The scheduled steps still to come, soonest first.
  private _upcoming(): Upcoming[] {
    const { config, state } = this._store;
    const hass = this.hass;
    if (!config || !state || !hass) return [];
    const person = personOf(hass);
    const result: Upcoming[] = [];
    for (const notification of config.notifications) {
      if (!notification.enabled) continue;
      const entry = state.notifications[notification.id];
      const category = categoryOf(config, notification);
      for (const item of entry?.upcoming ?? []) {
        const step = stepOf(notification, item.step_id);
        if (!step || !inAudience(step, person)) continue;
        // A step with an open card shows that card instead.
        if (entry.cards.some((card) => card.step_id === step.id && card.status !== "done")) {
          continue;
        }
        const due = new Date(item.due);
        const message = isTemplate(step.message) ? "" : replacePlaceholders(step.message, {});
        result.push({
          key: `${notification.id}|${step.id}`,
          notificationId: notification.id,
          stepId: step.id,
          due,
          view: {
            label: notification.name,
            message,
            when: this._when(due),
            icon: notification.icon || category?.icon || "mdi:calendar-clock",
            color: cssColor(notification.card_color ?? category?.card_color),
            muted: true,
            buttons: [{ key: "done_early", label: "Done", icon: "mdi:check" }],
          },
        });
      }
    }
    return result.sort((a, b) => a.due.getTime() - b.due.getTime());
  }

  private async _doneEarly(item: Upcoming): Promise<void> {
    await this._run(() => doneEarly(this.hass!, item.notificationId, item.stepId));
  }

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
    `;
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

  // A snoozed card among the upcoming ones: neutral, with its snooze end.
  private _renderSnoozed(live: LiveCard) {
    const until = live.card.snoozed_until;
    return html`
      <notification-center-live-card
        class="upcoming"
        .hass=${this.hass}
        .live=${live}
        .now=${this._now}
        .data=${""}
        .when=${until ? `Snoozed until ${this._when(new Date(until))}` : "Snoozed"}
        .muted=${true}
      ></notification-center-live-card>
    `;
  }

  private _renderUpcoming(items: Upcoming[]) {
    return repeat(
      items,
      (item) => item.key,
      (item) => html`
        <notification-center-view
          class="upcoming"
          .hass=${this.hass}
          .view=${item.view}
          @nc-button=${() => this._doneEarly(item)}
        ></notification-center-view>
      `,
    );
  }

  // The active cards, then Upcoming: what is due today and the snoozed
  // cards, by their time.
  private _renderOverview() {
    const active = this._cards(["active"]);
    const end = this._endOfToday();
    const timed: { at: number; key: string; live?: LiveCard; item?: Upcoming }[] = [
      ...this._cards(["snoozed"]).map((live) => ({
        at: live.card.snoozed_until ? new Date(live.card.snoozed_until).getTime() : 0,
        key: cardKey(live.card),
        live,
      })),
      ...this._upcoming()
        .filter((item) => item.due.getTime() < end)
        .map((item) => ({ at: item.due.getTime(), key: item.key, item })),
    ].sort((a, b) => a.at - b.at);
    const done = this._cards(["done"]).length;
    const later = this._upcoming().some((item) => item.due.getTime() >= end);
    return html`
      ${active.length ? this._renderLive(active) : this._renderEmpty("All done")}
      ${timed.length
        ? html`<h2>Upcoming</h2>
            ${repeat(
              timed,
              (entry) => entry.key,
              (entry) =>
                entry.live
                  ? this._renderSnoozed(entry.live)
                  : this._renderUpcoming([entry.item!]),
            )}`
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

  // The scheduled steps due after today, by their next day, under the
  // week, this month, this year, next year (and later years by number).
  private _renderSchedule() {
    const hass = this.hass!;
    const end = this._endOfToday();
    const items = this._upcoming().filter((item) => item.due.getTime() >= end);
    if (!items.length) return this._renderEmpty("Nothing scheduled");
    const today = new Date(this._now);
    today.setHours(0, 0, 0, 0);
    const week = new Date(today);
    week.setDate(today.getDate() + (((firstWeekday(hass) - today.getDay() + 6) % 7) + 1));
    const month = new Date(today.getFullYear(), today.getMonth() + 1, 1);
    const year = new Date(today.getFullYear() + 1, 0, 1);
    const nextYear = new Date(today.getFullYear() + 2, 0, 1);
    const title = (due: Date): string => {
      if (due < week) return WEEK;
      if (due < month) return monthName(hass, today);
      if (due < year) return "Year";
      if (due < nextYear) return "Next year";
      return String(due.getFullYear());
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
            view: {
              ...item.view,
              when:
                section.title === WEEK
                  ? weekday(hass, item.due)
                  : formatDay(hass, item.due, this._now),
            },
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
    if (!this._haReady) {
      return html`<div class="empty">Loading…</div>`;
    }
    const { config, state, hasData } = this._store;
    const base = `/${this.panel?.url_path ?? "notification-center"}`;
    const parts = this._parts();
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
      .tab=${parts[1] === "general" ? "general" : "notifications"}
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
      padding: 32px 16px;
      display: flex;
      flex-direction: column;
      gap: 16px;
    }
    h2 {
      margin: 8px 4px -8px;
      font-size: var(--ha-font-size-m, 14px);
      font-weight: var(--ha-font-weight-medium, 500);
      color: var(--secondary-text-color);
    }
    /* Room above every section title but the first. */
    h2.section:not(:first-child) {
      margin-top: 24px;
    }
    /* Done and Schedule side by side in the middle. */
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
    ha-card {
      margin-top: 8px;
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
