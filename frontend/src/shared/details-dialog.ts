// The Notification details dialog: one card of a notification, laid out
// like Home Assistant's more info dialog (a big tile icon, the card's top
// row, the message, the status and the controls), and its Status behind
// the header button. Everyone can open both.
//
// Shown through Home Assistant's dialog manager (see `openDetails`), so it
// opens over the page it was asked on and Back closes it.

import { LitElement, css, html, nothing, type PropertyValues } from "lit";
import { property, state } from "lit/decorators.js";

import { DOMAIN } from "./config";
import { defineElement } from "./define";
import {
  DETAILS_DIALOG,
  canUndo,
  detailsOf,
  resolveAddress,
  statusLabel,
  type DetailsData,
  type DetailsParams,
  type DetailsTarget,
  type DetailsView,
} from "./details";
import { cssColor } from "./format";
import {
  closeEarly,
  effectiveButtons,
  errorText,
  liveButtons,
  pressButton,
  snoozeChoices,
  type EarlyButton,
  type LiveButton,
} from "./live";
import { liveView } from "./live-card";
import "./notification-view";
import { renderStatus } from "./status-view";
import { subscribeStore, type StoreData } from "./store";
import { TemplateTexts } from "./text";
import type { HomeAssistant } from "./types";

// How often relative times are written again.
const TICK = 30_000;

const OPEN_STATUSES = ["active", "hidden", "snoozed"];

export class NcDetailsDialog extends LitElement {
  @property({ attribute: false }) public hass?: HomeAssistant;

  @state() private _params?: DetailsParams;

  @state() private _open = false;

  @state() private _view: DetailsView = "details";

  // The card shown; unset while the address names several (the picker).
  @state() private _target?: DetailsTarget;

  @state() private _store: StoreData = {};

  @state() private _now = Date.now();

  @state() private _error?: string;

  private _unsubscribe?: () => void;

  private _timer?: number;

  // The steps' own texts while they have no card: templates rendered.
  private _texts = new TemplateTexts(() => this.requestUpdate());

  public showDialog(params: DetailsParams): void {
    this._params = params;
    this._view = params.view ?? "details";
    this._target = undefined;
    this._error = undefined;
    this._open = true;
    this._follow();
  }

  public closeDialog(): boolean {
    this._open = false;
    return true;
  }

  override connectedCallback(): void {
    super.connectedCallback();
    this._timer = window.setInterval(() => (this._now = Date.now()), TICK);
    this._follow();
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    window.clearInterval(this._timer);
    this._texts.clear();
    this._unsubscribe?.();
    this._unsubscribe = undefined;
  }

  protected override willUpdate(changed: PropertyValues): void {
    if (changed.has("hass")) this._follow();
    // The card is chosen once the data is there: one goes straight to it.
    if (this._params && !this._target && this._store.state) {
      const targets = resolveAddress(this._store, this._params);
      if (targets.length === 1) this._target = targets[0];
    }
  }

  private _follow(): void {
    if (!this._unsubscribe && this.hass && this.isConnected) {
      this._unsubscribe = subscribeStore(this.hass.connection, (data) => {
        this._store = data;
      });
    }
  }

  private _closed(ev: Event): void {
    if (ev.target !== ev.currentTarget) return;
    this._open = false;
    this._params = undefined;
    this._target = undefined;
    this.dispatchEvent(
      new CustomEvent("dialog-closed", {
        detail: { dialog: this.localName },
        bubbles: true,
        composed: true,
      }),
    );
  }

  private async _run(task: () => Promise<void>): Promise<void> {
    this._error = undefined;
    try {
      await task();
    } catch (err) {
      this._error = errorText(err);
    }
  }

  private _moreInfo(entityId: string): void {
    this.dispatchEvent(
      new CustomEvent("hass-more-info", { detail: { entityId }, bubbles: true, composed: true }),
    );
  }

  // -- Render --------------------------------------------------------------

  protected override render() {
    const params = this._params;
    if (!params || !this.hass) return nothing;
    const found = this._target ? detailsOf(this._store, this._target) : undefined;
    const data = found ? this._withTexts(found) : undefined;
    const targets = !this._target && this._store.state ? resolveAddress(this._store, params) : [];
    const name =
      data?.notification.name ??
      this._store.config?.notifications.find((item) => item.id === targets[0]?.notificationId)?.name ??
      "Notification details";
    const status = this._view === "status" && data;
    const subtitle = status
      ? data.steps > 1
        ? `Status · Step ${data.stepNumber} of ${data.steps}`
        : "Status"
      : "Notification details";
    return html`<ha-dialog
      .open=${this._open}
      width="medium"
      header-title=${name}
      header-subtitle=${subtitle}
      @closed=${this._closed}
    >
      ${data
        ? html`<ha-icon-button
            slot="headerActionItems"
            .label=${status ? "Notification details" : "Status"}
            @click=${() => (this._view = status ? "details" : "status")}
          >
            <ha-icon .icon=${status ? "mdi:text-box-outline" : "mdi:list-status"}></ha-icon>
          </ha-icon-button>`
        : nothing}
      ${this._error ? html`<ha-alert alert-type="error">${this._error}</ha-alert>` : nothing}
      ${data
        ? status
          ? this._renderStatus(data)
          : this._renderDetails(data)
        : targets.length > 1
          ? this._renderPicker(targets)
          : html`<div class="empty">
              ${this._store.error ?? (this._store.state ? "This notification is not there anymore." : "Loading…")}
            </div>`}
    </ha-dialog>`;
  }

  // Without a card the step's own message: rendered, no placeholders.
  private _withTexts(data: DetailsData): DetailsData {
    this._texts.update(
      this.hass!,
      data.notification.steps.map((step) => step.message),
      data.target.entityId ?? undefined,
    );
    if (data.card) return data;
    return { ...data, message: this._text(data.live.step?.message) };
  }

  private _text(text: string | undefined): string {
    return this._texts.get(this.hass!, text, true);
  }

  // Several open cards match the address: one row each, as on the Overview.
  private _renderPicker(targets: DetailsTarget[]) {
    const hass = this.hass!;
    return html`<div class="picker">
      ${targets.map((target) => {
        const data = detailsOf(this._store, target);
        if (!data) return nothing;
        const muted = data.status !== "active";
        return html`<notification-center-view
          .hass=${hass}
          .view=${{
            ...liveView(hass, data.live, this._now),
            when: muted ? statusLabel(hass, data, this._now) : undefined,
            highlight: muted ? "none" : undefined,
            muted,
            clickable: true,
          }}
          @nc-tap=${() => (this._target = target)}
        ></notification-center-view>`;
      })}
    </div>`;
  }

  private _icon(data: DetailsData, big: boolean) {
    const hass = this.hass!;
    const view = liveView(hass, data.live, this._now);
    return html`<ha-tile-icon class=${big ? "big" : "small"} style="--tile-icon-color: ${view.color}">
      <ha-state-icon
        slot="icon"
        .hass=${hass}
        .icon=${view.icon || (view.stateObj ? undefined : "mdi:message-bulleted")}
        .stateObj=${view.stateObj}
      ></ha-state-icon>
    </ha-tile-icon>`;
  }

  /** The card's top row: label · data, in the card's colour. */
  private _top(data: DetailsData) {
    const hass = this.hass!;
    const open = !!data.card && OPEN_STATUSES.includes(data.card.status);
    const value = open ? liveView(hass, data.live, this._now).data : "";
    return html`<div class="top" style="color: ${cssColor(data.live.color)}">
      <span class="label">${data.notification.name}</span>
      ${value ? html`<span>·</span><span class="data">${value}</span>` : nothing}
    </div>`;
  }

  private _renderDetails(data: DetailsData) {
    const hass = this.hass!;
    const card = data.card;
    const open = !!card && OPEN_STATUSES.includes(card.status);
    const undo = canUndo(this._store, data, this._now);
    return html`<div class="hero">
        ${this._icon(data, true)} ${this._top(data)}
        ${data.message ? html`<div class="message">${data.message}</div>` : nothing}
        ${open && card.info ? html`<div class="info">${card.info}</div>` : nothing}
        <span class="badge" style="--badge-color: ${data.statusColor}">${statusLabel(hass, data, this._now)}</span>
        ${undo
          ? html`<ha-button appearance="plain" class="undo" @click=${() => this._undo(data)}>
              <ha-icon slot="start" icon="mdi:undo-variant"></ha-icon>
              Undo
            </ha-button>`
          : nothing}
      </div>
      ${open ? this._renderControls(data) : data.status === "upcoming" ? this._renderEarly(data) : nothing}`;
  }

  // The card's buttons in the order of the editor (as on the push), then Snooze.
  private _renderControls(data: DetailsData) {
    const live = data.live;
    const shown = liveButtons(live);
    const order = effectiveButtons(live.category, live.step).map((button) => button.id);
    const buttons = shown
      .filter((button) => button.button.type !== "snooze")
      .sort((a, b) => order.indexOf(a.key) - order.indexOf(b.key));
    const snooze = shown.find((button) => button.button.type === "snooze");
    if (!buttons.length && !snooze) return nothing;
    return html`<div class="controls">
      ${buttons.length
        ? html`<div class="buttons">
            ${buttons.map(
              (button) => html`<ha-control-button
                .label=${button.label}
                title=${button.label}
                @click=${() => this._press(data, button)}
              >
                <ha-icon .icon=${button.icon}></ha-icon>
              </ha-control-button>`,
            )}
          </div>`
        : nothing}
      ${snooze ? this._renderSnooze(data, snooze) : nothing}
    </div>`;
  }

  // Snooze: a menu that shows only its icon and "Snooze" while closed; one
  // time only, a button of the same place and look.
  private _renderSnooze(data: DetailsData, snooze: LiveButton) {
    const choices = snoozeChoices(snooze.button);
    if (!snooze.ask) {
      return html`<ha-control-button class="snooze" .label=${snooze.label} @click=${() => this._press(data, snooze)}>
        <div class="snooze-content">
          <ha-icon .icon=${snooze.icon}></ha-icon>
          <span>${snooze.label}</span>
        </div>
      </ha-control-button>`;
    }
    return html`<ha-control-select-menu
      class="snooze"
      .label=${snooze.label}
      .options=${choices.map((choice) => ({
        value: choice.key,
        label: choice.label,
        icon: /\d+[mh]$/.test(choice.key) ? "mdi:timer-outline" : "mdi:calendar-today",
      }))}
      @wa-select=${(ev: CustomEvent<{ item?: { value?: string } }>) => {
        const choice = ev.detail.item?.value;
        if (choice) this._press(data, snooze, choice);
      }}
    >
      <ha-icon slot="icon" .icon=${snooze.icon}></ha-icon>
    </ha-control-select-menu>`;
  }

  // A scheduled step not due yet: Done and Dismiss (early), as on Upcoming.
  private _renderEarly(data: DetailsData) {
    const early: { key: EarlyButton; label: string; icon: string }[] = [
      { key: "done_early", label: "Done", icon: "mdi:check" },
      { key: "dismiss_early", label: "Dismiss", icon: "mdi:close" },
    ];
    return html`<div class="controls">
      <div class="buttons">
        ${early.map(
          (button) => html`<ha-control-button
            .label=${button.label}
            title=${button.label}
            @click=${() =>
              void this._run(() =>
                closeEarly(this.hass!, data.notification.id, data.target.stepId, button.key),
              )}
          >
            <ha-icon .icon=${button.icon}></ha-icon>
          </ha-control-button>`,
        )}
      </div>
    </div>`;
  }

  private _press(data: DetailsData, button: LiveButton, choice?: string): void {
    void this._run(() => pressButton(this.hass!, this, data.live, button.button, choice));
  }

  private _undo(data: DetailsData): void {
    const card = data.card;
    if (!card) return;
    void this._run(async () => {
      await this.hass!.callWS({
        type: `${DOMAIN}/card/undo`,
        notification_id: card.notification_id,
        step_id: card.step_id,
        entity_id: card.entity_id,
      });
    });
  }

  private _renderStatus(data: DetailsData) {
    return html`<div class="summary">
        ${this._icon(data, false)}
        <div class="summary-text">
          ${this._top(data)}
          ${data.message ? html`<div class="summary-message">${data.message}</div>` : nothing}
        </div>
      </div>
      <div class="blocks">
        ${renderStatus({
          hass: this.hass!,
          store: this._store,
          data,
          now: this._now,
          select: (target) => (this._target = target),
          moreInfo: (entityId) => this._moreInfo(entityId),
          text: (text) => this._text(text),
        })}
      </div>`;
  }

  static override styles = css`
    ha-dialog {
      --dialog-content-padding: 0 24px 24px;
    }
    .empty {
      padding: 32px 0;
      text-align: center;
      color: var(--secondary-text-color);
    }
    ha-alert {
      display: block;
      margin-bottom: 16px;
    }
    /* Details: the big icon, the top row, the message and the status. */
    .hero {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 12px;
      padding-top: 24px;
      text-align: center;
    }
    /* The tile icon's tinted circle (Home Assistant draws it only for an
       interactive icon). */
    ha-tile-icon {
      border-radius: var(--ha-border-radius-pill, 9999px);
      background-color: color-mix(in srgb, var(--tile-icon-color) 20%, transparent);
    }
    ha-tile-icon.big {
      --tile-icon-size: 80px;
      --mdc-icon-size: 40px;
    }
    ha-tile-icon.small {
      --tile-icon-size: 48px;
      --mdc-icon-size: 26px;
      flex: none;
    }
    .top {
      display: flex;
      gap: 6px;
      min-width: 0;
      max-width: 100%;
      font-size: var(--ha-font-size-s, 12px);
      font-weight: var(--ha-font-weight-bold, 700);
      letter-spacing: 1px;
      line-height: var(--ha-line-height-condensed, 1.2);
    }
    .hero .top {
      justify-content: center;
      font-size: 13px;
    }
    .label {
      text-transform: uppercase;
      overflow: hidden;
      white-space: nowrap;
      text-overflow: ellipsis;
      min-width: 0;
    }
    .data {
      white-space: nowrap;
      letter-spacing: 0.4px;
    }
    .message {
      font-size: var(--ha-font-size-2xl, 24px);
      line-height: var(--ha-line-height-condensed, 1.25);
      font-weight: var(--ha-font-weight-normal, 400);
      overflow-wrap: anywhere;
    }
    .info {
      color: var(--secondary-text-color);
      font-size: var(--ha-font-size-m, 14px);
      overflow-wrap: anywhere;
    }
    .badge {
      display: inline-flex;
      align-items: center;
      height: 32px;
      margin-top: 12px;
      padding: 0 14px;
      box-sizing: border-box;
      border-radius: var(--ha-badge-border-radius, 9999px);
      border: 1px solid var(--badge-color);
      color: var(--badge-color);
      font-size: var(--ha-font-size-m, 14px);
      font-weight: var(--ha-font-weight-medium, 500);
      white-space: nowrap;
    }
    .undo {
      margin-top: -4px;
    }
    /* The controls, well below the status, as in the more info dialog. */
    .controls {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 16px;
      padding-top: 48px;
    }
    .buttons {
      display: flex;
      justify-content: center;
      flex-wrap: wrap;
      gap: 12px;
    }
    .buttons ha-control-button {
      width: 72px;
      height: 64px;
      --control-button-border-radius: 18px;
      --mdc-icon-size: 24px;
    }
    .snooze {
      width: 100%;
      max-width: 320px;
      --control-select-menu-border-radius: 16px;
      --control-button-border-radius: 16px;
    }
    /* One time only: a button of the menu's size and look. */
    ha-control-button.snooze {
      height: var(--control-select-menu-height, 48px);
    }
    .snooze-content {
      display: flex;
      align-items: center;
      gap: 12px;
      width: 100%;
      padding: 0 4px;
      box-sizing: border-box;
      font-size: var(--ha-font-size-m, 14px);
      font-weight: var(--ha-font-weight-normal, 400);
    }
    /* Several cards: the rows of the Overview. */
    .picker {
      display: flex;
      flex-direction: column;
      gap: 8px;
      padding-top: 8px;
    }
    /* Status: the summary row, then the blocks. */
    .summary {
      display: flex;
      align-items: center;
      gap: 16px;
      padding: 8px 0 16px;
    }
    .summary-text {
      flex: 1;
      min-width: 0;
      display: flex;
      flex-direction: column;
      gap: 4px;
    }
    .summary-message {
      font-size: var(--ha-font-size-l, 16px);
      line-height: var(--ha-line-height-condensed, 1.25);
      overflow-wrap: anywhere;
    }
    .blocks {
      display: flex;
      flex-direction: column;
      gap: 16px;
    }
    ha-card.block {
      overflow: hidden;
    }
    .block-title {
      padding: 12px 16px 0;
      color: var(--secondary-text-color);
      font-size: var(--ha-font-size-m, 14px);
      font-weight: var(--ha-font-weight-medium, 500);
    }
    ha-list-item-base.current {
      background-color: var(--ha-color-fill-neutral-quiet-resting, var(--secondary-background-color));
    }
    .row-icon,
    .channel-icon,
    .chevron {
      color: var(--secondary-text-color);
    }
    .row-icon.sends {
      color: var(--ha-color-fill-success-loud-resting, var(--success-color, #4caf50));
    }
    .row-icon.waits {
      color: var(--ha-color-fill-warning-loud-resting, var(--warning-color, #ff9800));
    }
    /* The person's picture or initials, as in the Audience table. */
    .person-avatar .avatar {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 32px;
      height: 32px;
      border-radius: 50%;
      object-fit: cover;
      overflow: hidden;
      background-color: var(--light-primary-color);
      color: var(--text-light-primary-color, var(--primary-text-color));
      font-size: var(--ha-font-size-s, 12px);
      --ha-person-badge-size: 32px;
    }
  `;
}

defineElement(DETAILS_DIALOG, NcDetailsDialog);

declare global {
  interface HTMLElementTagNameMap {
    "nc-details-dialog": NcDetailsDialog;
  }
}
