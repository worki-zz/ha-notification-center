import { LitElement, css, html, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";

import {
  DOMAIN,
  type CardAction,
  type CardState,
  type ConfigMessage,
  type NotificationCenterConfig,
  type StateMessage,
} from "../shared/config";
import type { HomeAssistant, PanelInfo } from "../shared/types";
import { VERSION } from "../shared/version";

// The sidebar panel.
//
// A temporary developer page: the stored configuration in simple lists, the
// live state of every notification with Done, Snooze and Dismiss, and YAML
// import and export for administrators. The Overview replaces it in phase 3,
// the Settings pages in phases 4 and 5.
@customElement("notification-center-panel")
export class NotificationCenterPanel extends LitElement {
  @property({ attribute: false }) public hass?: HomeAssistant;

  @property({ type: Boolean, reflect: true }) public narrow = false;

  @property({ attribute: false }) public panel?: PanelInfo;

  @state() private _config?: NotificationCenterConfig;

  @state() private _hasData = false;

  @state() private _error?: string;

  @state() private _notice?: string;

  // An import waiting for confirmation, because it would replace data.
  @state() private _pendingImport?: { name: string; text: string };

  @state() private _busy = false;

  @state() private _live?: StateMessage;

  private _unsubscribe?: Promise<() => Promise<void>>;

  private _unsubscribeState?: Promise<() => Promise<void>>;

  public override connectedCallback(): void {
    super.connectedCallback();
    if (this.hass) {
      this._subscribe();
    }
  }

  public override disconnectedCallback(): void {
    super.disconnectedCallback();
    void this._unsubscribe?.then((unsubscribe) => unsubscribe());
    this._unsubscribe = undefined;
    void this._unsubscribeState?.then((unsubscribe) => unsubscribe());
    this._unsubscribeState = undefined;
  }

  protected override updated(changed: Map<string, unknown>): void {
    if (changed.has("hass") && this.hass && !this._unsubscribe) {
      this._subscribe();
    }
  }

  private _subscribe(): void {
    if (!this.hass) return;
    this._unsubscribe = this.hass.connection.subscribeMessage<ConfigMessage>(
      (message) => {
        this._config = message.config;
        this._hasData = message.has_data;
      },
      { type: `${DOMAIN}/config/subscribe` },
    );
    this._unsubscribe.catch((err: unknown) => {
      this._error = errorMessage(err);
    });
    this._unsubscribeState =
      this.hass.connection.subscribeMessage<StateMessage>(
        (message) => {
          this._live = message;
        },
        { type: `${DOMAIN}/state/subscribe` },
      );
    this._unsubscribeState.catch((err: unknown) => {
      this._error = errorMessage(err);
    });
  }

  private get _isAdmin(): boolean {
    return this.hass?.user?.is_admin ?? false;
  }

  protected override render() {
    const title = this.panel?.title ?? "Notification Center";
    return html`
      <div class="toolbar">
        <ha-menu-button
          .hass=${this.hass}
          .narrow=${this.narrow}
        ></ha-menu-button>
        <div class="main-title">${title}</div>
      </div>
      <div class="content">
        <p class="intro">
          Development view: the live state of the notifications and the stored
          configuration. The Overview and the Settings pages replace it in later
          versions.
        </p>
        ${this._error
          ? html`<ha-alert alert-type="error">${this._error}</ha-alert>`
          : nothing}
        ${this._notice
          ? html`<ha-alert alert-type="success">${this._notice}</ha-alert>`
          : nothing}
        ${this._isAdmin ? this._renderImportExport() : nothing}
        ${this._config ? this._renderConfig(this._config) : nothing}
        <p class="version">Notification Center ${VERSION}</p>
      </div>
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
                  configuration (${this._config?.notifications.length ?? 0}
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
              const live = this._live?.notifications[item.id];
              const stepNumbers = new Map(
                item.steps.map((step, index) => [step.id, index + 1]),
              );
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
                        ? ` · last done ${formatTime(live.last_done)}`
                        : ""}
                    </div>
                  </div>
                  ${live
                    ? html`<span class="badge ${live.state}"
                        >${live.state}</span
                      >`
                    : nothing}
                </div>
                ${(live?.cards ?? []).map((card) =>
                  this._renderCard(card, stepNumbers.get(card.step_id)),
                )}
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

  private _renderCard(card: CardState, step: number | undefined) {
    const open = ["active", "hidden", "snoozed"].includes(card.status);
    const detail = [
      `Step ${step ?? "?"}`,
      card.entity_id,
      card.status,
      card.status === "snoozed" && card.snoozed_until
        ? `until ${formatTime(card.snoozed_until)}`
        : `since ${formatTime(card.state_since)}`,
    ].filter(Boolean);
    return html`
      <div class="live-card ${card.status}">
        <div class="text">
          <div>${card.message}</div>
          ${card.info
            ? html`<div class="secondary">${card.info}</div>`
            : nothing}
          <div class="secondary">${detail.join(" · ")}</div>
        </div>
        ${open
          ? html`
              <div class="buttons">
                <ha-button size="small" @click=${() => this._act(card, "done")}>
                  Done
                </ha-button>
                <ha-button
                  size="small"
                  appearance="plain"
                  @click=${() => this._act(card, "snooze", 1)}
                >
                  1 h
                </ha-button>
                <ha-button
                  size="small"
                  appearance="plain"
                  @click=${() => this._act(card, "snooze", 3)}
                >
                  3 h
                </ha-button>
                <ha-button
                  size="small"
                  appearance="plain"
                  @click=${() => this._act(card, "snooze")}
                >
                  Tomorrow
                </ha-button>
                <ha-button
                  size="small"
                  appearance="plain"
                  @click=${() => this._act(card, "dismiss")}
                >
                  Dismiss
                </ha-button>
              </div>
            `
          : nothing}
      </div>
    `;
  }

  private async _act(
    card: CardState,
    action: CardAction,
    hours?: number,
  ): Promise<void> {
    await this._run(async () => {
      await this.hass?.callWS({
        type: `${DOMAIN}/card/action`,
        notification_id: card.notification_id,
        step_id: card.step_id,
        entity_id: card.entity_id,
        action,
        ...(hours
          ? { until: new Date(Date.now() + hours * 3600 * 1000).toISOString() }
          : {}),
      });
    });
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
    if (this._hasData) {
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
      this._error = errorMessage(err);
    } finally {
      this._busy = false;
    }
  }

  static override styles = css`
    :host {
      display: block;
      min-height: 100%;
      background-color: var(--primary-background-color);
      color: var(--primary-text-color);
    }
    .toolbar {
      display: flex;
      align-items: center;
      height: var(--header-height, 56px);
      padding: 0 12px;
      box-sizing: border-box;
      font-size: 20px;
      background-color: var(--app-header-background-color);
      color: var(--app-header-text-color, var(--primary-text-color));
      border-bottom: var(--app-header-border-bottom, none);
    }
    .main-title {
      margin-inline-start: 12px;
      flex: 1;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .content {
      max-width: 800px;
      margin: 0 auto;
      padding: 16px;
      display: flex;
      flex-direction: column;
      gap: 16px;
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
    .empty {
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
    .live-card {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 8px 16px;
      margin: 0 16px 8px 56px;
      padding: 8px 12px;
      border-radius: 8px;
      border: 1px solid var(--divider-color);
    }
    .live-card.hidden,
    .live-card.snoozed {
      opacity: 0.6;
    }
    .live-card .text {
      flex: 1 1 200px;
    }
    .version {
      margin: 8px 0 0;
      text-align: center;
      font-size: 12px;
      color: var(--disabled-text-color);
    }
  `;
}

function formatTime(value: string): string {
  return new Date(value).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function errorMessage(err: unknown): string {
  if (err && typeof err === "object" && "message" in err) {
    return String((err as { message: unknown }).message);
  }
  return String(err);
}

declare global {
  interface HTMLElementTagNameMap {
    "notification-center-panel": NotificationCenterPanel;
  }
}
