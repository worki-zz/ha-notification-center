import { LitElement, css, html, nothing, type PropertyValues } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { repeat } from "lit/directives/repeat.js";

import { loadDashboardElements } from "../card/elements";
import { DOMAIN, type NotificationCenterConfig } from "../shared/config";
import { cssColor, formatTime, formatWhen } from "../shared/format";
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
import { VERSION } from "../shared/version";

type Page = "overview" | "later" | "done" | "settings";

const TITLES: Record<Page, string> = {
  overview: "Notification Center",
  later: "Later",
  done: "Done today",
  settings: "Settings",
};

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
// today, Later and Done today behind their buttons, and the settings for
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

  // An import waiting for confirmation, because it would replace data.
  @state() private _pendingImport?: { name: string; text: string };

  @state() private _busy = false;

  // The page under the header is scrolled: the header casts a shadow.
  @state() private _scrolled = false;

  private _unsubscribe?: () => void;

  private _timer?: number;

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
  }

  protected override willUpdate(changed: PropertyValues): void {
    if (changed.has("hass")) this._follow();
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

  private get _page(): Page {
    const page = (this.route?.path ?? "").replace(/^\/+/, "").split("/")[0];
    if (page === "later" || page === "done") return page;
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
    const title = page === "overview" ? (this.panel?.title ?? TITLES.overview) : TITLES[page];
    return html`
      <div class="toolbar ${this._scrolled ? "scrolled" : ""}">
        ${page === "overview"
          ? html`<ha-menu-button .hass=${this.hass} .narrow=${this.narrow}></ha-menu-button>`
          : html`<ha-icon-button .label=${"Back"} @click=${() => this._go("overview")}>
              <ha-icon icon="mdi:arrow-left"></ha-icon>
            </ha-icon-button>`}
        <div class="main-title">${title}</div>
        ${page === "overview" && this._isAdmin
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
          : page === "later"
            ? this._renderLater()
            : page === "done"
              ? this._renderDone()
              : page === "settings"
                ? this._renderSettings()
                : this._renderOverview()}
      </div></div>
    `;
  }

  private _renderLive(cards: LiveCard[], data?: (live: LiveCard) => string, interactive = true) {
    return repeat(
      cards,
      (live) => cardKey(live.card),
      (live) => html`
        <notification-center-live-card
          .hass=${this.hass}
          .live=${live}
          .now=${this._now}
          .data=${data?.(live)}
          .interactive=${interactive}
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
    return html`
      ${active.length
        ? this._renderLive(active)
        : html`<div class="all-clear">
            <ha-icon icon="mdi:message-bulleted"></ha-icon>
            <div>No active notifications</div>
          </div>`}
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
      <div class="pages">
        <ha-button @click=${() => this._go("later")}>
          <ha-icon slot="start" icon="mdi:clock-outline"></ha-icon>
          Later
        </ha-button>
        <ha-button @click=${() => this._go("done")}>
          <ha-icon slot="start" icon="mdi:check-all"></ha-icon>
          Done today${done ? ` · ${done}` : ""}
        </ha-button>
      </div>
    `;
  }

  // The scheduled steps due after today, by their next time.
  private _renderLater() {
    const end = this._endOfToday();
    const later = this._upcoming().filter((item) => item.due.getTime() >= end);
    if (!later.length) {
      return html`<div class="empty">Nothing later.</div>`;
    }
    return this._renderUpcoming(later);
  }

  private _renderDone() {
    const done = this._cards(["done"]);
    if (!done.length) {
      return html`<div class="empty">Nothing done today yet.</div>`;
    }
    const hass = this.hass!;
    return this._renderLive(
      done,
      (live) =>
        live.card.closed_at
          ? `Done ${formatTime(hass, new Date(live.card.closed_at), "time", this._now)}`
          : "Done",
      false,
    );
  }

  private _renderSettings() {
    return html`
      <p class="intro">
        The settings pages come in later versions. Until then: YAML import and
        export, and the stored configuration.
      </p>
      ${this._renderImportExport()}
      ${this._store.config ? this._renderConfig(this._store.config) : nothing}
      <p class="version">Notification Center ${VERSION}</p>
    `;
  }

  private _renderImportExport() {
    const pending = this._pendingImport;
    return html`
      <ha-card header="YAML">
        <div class="card-content">
          ${pending
            ? html`
                <p>
                  Importing <b>${pending.name}</b> replaces the whole
                  configuration (${this._store.config?.notifications.length ?? 0}
                  notifications now). The current one is downloaded first.
                </p>
                <div class="buttons">
                  <ha-button
                    .disabled=${this._busy}
                    @click=${this._confirmImport}
                  >
                    Replace
                  </ha-button>
                  <ha-button appearance="plain" @click=${this._cancelImport}>
                    Cancel
                  </ha-button>
                </div>
              `
            : html`
                <p>Export downloads the configuration; import replaces it.</p>
                <div class="buttons">
                  <ha-button .disabled=${this._busy} @click=${this._export}>
                    Export
                  </ha-button>
                  <ha-button .disabled=${this._busy} @click=${this._pickFile}>
                    Import
                  </ha-button>
                  <input
                    type="file"
                    accept=".yaml,.yml,text/yaml"
                    hidden
                    @change=${this._fileChosen}
                  />
                </div>
              `}
        </div>
      </ha-card>
    `;
  }

  private _renderConfig(config: NotificationCenterConfig) {
    const categories = new Map(
      config.categories.map((item) => [item.id, item]),
    );
    return html`
      <ha-card header="Notifications (${config.notifications.length})">
        ${config.notifications.length === 0
          ? html`<div class="card-content empty">No notifications yet.</div>`
          : config.notifications.map((item) => {
              const category = categories.get(item.category);
              const icon = item.icon ?? category?.icon ?? "mdi:bell";
              const steps = item.steps.length;
              const live = this._store.state?.notifications[item.id];
              return html`
                <div class="row ${item.enabled ? "" : "disabled"}">
                  <ha-icon .icon=${icon}></ha-icon>
                  <div class="text">
                    <div>${item.name}</div>
                    <div class="secondary">
                      ${category?.name ?? item.category} · ${steps}
                      ${steps === 1 ? "step" : "steps"} ·
                      ${item.steps.map((step) => step.start.type).join(", ")}
                      ${item.enabled ? "" : " · disabled"}
                      ${live?.last_done
                        ? ` · last done ${formatShort(live.last_done)}`
                        : ""}
                      ${live?.next_due
                        ? ` · next ${formatShort(live.next_due)}`
                        : ""}
                    </div>
                  </div>
                  ${live
                    ? html`<span class="badge ${live.state}"
                        >${live.state}</span
                      >`
                    : nothing}
                </div>
              `;
            })}
      </ha-card>
      <ha-card header="Categories (${config.categories.length})">
        ${config.categories.map(
          (item) => html`
            <div class="row">
              <ha-icon .icon=${item.icon ?? "mdi:shape"}></ha-icon>
              <div class="text">
                <div>${item.name}</div>
                <div class="secondary">${item.card_color ?? "no colour"}</div>
              </div>
            </div>
          `,
        )}
      </ha-card>
      <ha-card header="Modes (${config.modes.length})">
        ${config.modes.map(
          (item) => html`
            <div class="row">
              <ha-icon .icon=${item.icon ?? "mdi:home-variant"}></ha-icon>
              <div class="text">
                <div>${item.name}</div>
                <div class="secondary">
                  ${item.condition
                    ? item.condition.type
                    : "when no other mode applies"}
                </div>
              </div>
            </div>
          `,
        )}
      </ha-card>
      <ha-card header="People (${config.people.length})">
        ${config.people.length === 0
          ? html`<div class="card-content empty">
              No people in Home Assistant.
            </div>`
          : config.people.map(
              (item) => html`
                <div class="row">
                  <ha-icon icon="mdi:account"></ha-icon>
                  <div class="text">
                    <div>${item.name}</div>
                    <div class="secondary">
                      ${item.person} · ${item.notify ?? "no push"} ·
                      ${item.device_type}
                    </div>
                  </div>
                </div>
              `,
            )}
      </ha-card>
      <ha-card header="Devices">
        <div class="card-content secondary">
          ${config.lights.length} lights · ${config.speakers.length} speakers ·
          ${config.chimes.length} chimes
        </div>
      </ha-card>
    `;
  }

  private async _export(): Promise<void> {
    await this._run(async () => {
      await this._download();
    });
  }

  private async _download(): Promise<void> {
    if (!this.hass) return;
    const { yaml } = await this.hass.callWS<{ yaml: string }>({
      type: `${DOMAIN}/config/export`,
    });
    const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
    const link = document.createElement("a");
    link.href = URL.createObjectURL(new Blob([yaml], { type: "text/yaml" }));
    link.download = `notification_center_${stamp}.yaml`;
    link.click();
    URL.revokeObjectURL(link.href);
  }

  private _pickFile(): void {
    this.renderRoot
      .querySelector<HTMLInputElement>("input[type=file]")
      ?.click();
  }

  private async _fileChosen(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = "";
    if (!file) return;
    const text = await file.text();
    if (this._store.hasData) {
      this._pendingImport = { name: file.name, text };
      return;
    }
    await this._import(text, false);
  }

  private async _confirmImport(): Promise<void> {
    const pending = this._pendingImport;
    if (!pending) return;
    await this._import(pending.text, true);
    this._pendingImport = undefined;
  }

  private _cancelImport(): void {
    this._pendingImport = undefined;
  }

  private async _import(text: string, backup: boolean): Promise<void> {
    await this._run(async () => {
      if (backup) {
        await this._download();
      }
      await this.hass?.callWS({ type: `${DOMAIN}/config/import`, yaml: text });
      this._notice = "Imported.";
    });
  }

  private async _run(task: () => Promise<void>): Promise<void> {
    this._busy = true;
    this._error = undefined;
    this._notice = undefined;
    try {
      await task();
    } catch (err) {
      this._error = errorText(err);
    } finally {
      this._busy = false;
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
      padding: 24px 16px;
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
    .all-clear {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 8px;
      padding: 32px 16px;
      color: var(--secondary-text-color);
    }
    .all-clear ha-icon {
      --mdc-icon-size: 48px;
      color: var(--disabled-text-color);
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

function formatShort(value: string): string {
  return new Date(value).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

declare global {
  interface HTMLElementTagNameMap {
    "notification-center-panel": NotificationCenterPanel;
  }
}
