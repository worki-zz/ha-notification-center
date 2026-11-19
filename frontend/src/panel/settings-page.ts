// The settings of the Notification Center: the Notifications list and the
// General tab, in Home Assistant's own subpage layout.

import { LitElement, css, html, nothing, unsafeCSS } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { repeat } from "lit/directives/repeat.js";

import {
  DOMAIN,
  type Notification,
  type NotificationCenterConfig,
  type StateMessage,
} from "../shared/config";
import { errorText, navigate } from "../shared/live";
import type { HomeAssistant } from "../shared/types";
import { confirmDialog } from "./confirm";
import { field } from "./fields";
import "./settings-general";
import { STATUS_STYLES, renderStatus, statusOf } from "./status";

export type SettingsTab = "notifications" | "general";

@customElement("nc-settings")
export class NcSettings extends LitElement {
  @property({ attribute: false }) public hass?: HomeAssistant;

  @property({ type: Boolean }) public narrow = false;

  @property({ attribute: false }) public config?: NotificationCenterConfig;

  @property({ attribute: false }) public state?: StateMessage;

  @property({ type: Boolean }) public hasData = false;

  @property() public tab: SettingsTab = "notifications";

  // The panel's own path, such as /notification-center.
  @property() public base = "/notification-center";

  @state() private _search = "";

  @state() private _category = "";

  @state() private _error?: string;

  public override connectedCallback(): void {
    super.connectedCallback();
    this._category = new URLSearchParams(window.location.search).get("category") ?? "";
  }

  private _visible(): Notification[] {
    const notifications = this.config?.notifications ?? [];
    const search = this._search.trim().toLocaleLowerCase();
    return notifications.filter(
      (item) =>
        (!this._category || item.category === this._category) &&
        (!search || item.name.toLocaleLowerCase().includes(search)),
    );
  }

  protected override render() {
    return html`
      <hass-subpage
        .hass=${this.hass}
        .narrow=${this.narrow}
        .header=${"Notification Center settings"}
        back-path=${this.base}
      >
        <div class="content">
          <ha-tab-group @wa-tab-show=${this._tabChanged}>
            <ha-tab-group-tab slot="nav" panel="notifications" .active=${this.tab === "notifications"}>
              Notifications
            </ha-tab-group-tab>
            <ha-tab-group-tab slot="nav" panel="general" .active=${this.tab === "general"}>
              General
            </ha-tab-group-tab>
          </ha-tab-group>
          ${this._error ? html`<ha-alert alert-type="error">${this._error}</ha-alert>` : nothing}
          ${this.tab === "general"
            ? html`<nc-settings-general
                .hass=${this.hass}
                .config=${this.config}
                .hasData=${this.hasData}
              ></nc-settings-general>`
            : this._renderList()}
        </div>
        ${this.tab === "notifications"
          ? html`<ha-button slot="fab" size="l" class="fab" @click=${this._add}>
              <ha-icon slot="start" icon="mdi:plus"></ha-icon>
              Add notification
            </ha-button>`
          : nothing}
      </hass-subpage>
    `;
  }

  private _renderList() {
    const config = this.config;
    if (!config) return nothing;
    const visible = this._visible();
    const filtering = !!this._search.trim() || !!this._category;
    const categories = new Map(config.categories.map((item) => [item.id, item]));
    return html`
      <div class="filters">
        <ha-input-search
          appearance="outlined"
          .value=${this._search}
          @input=${(ev: Event) => {
            this._search = (ev.target as HTMLInputElement).value ?? "";
          }}
        ></ha-input-search>
        ${field(
          this.hass,
          {
            select: {
              mode: "dropdown",
              options: [
                { value: "all", label: "All categories" },
                ...config.categories.map((item) => ({ value: item.id, label: item.name })),
              ],
            },
          },
          this._category || "all",
          "Category",
          (value) => this._categoryChanged(value as string),
          { className: "category" },
        )}
      </div>
      <ha-card outlined>
        ${visible.length === 0
          ? html`<div class="empty">
              ${config.notifications.length
                ? "No notifications match."
                : "No notifications yet. Add the first one with the button below."}
            </div>`
          : html`<ha-sortable
              handle-selector=".handle"
              .disabled=${filtering}
              @item-moved=${this._moved}
            >
              <div class="rows">
                ${repeat(
                  visible,
                  (item) => item.id,
                  (item) => this._renderRow(item, categories.get(item.category)?.name, categories.get(item.category)?.icon),
                )}
              </div>
            </ha-sortable>`}
      </ha-card>
    `;
  }

  private _renderRow(item: Notification, category?: string, categoryIcon?: string | null) {
    const steps = item.steps.length;
    const status = statusOf(item, this.state?.notifications[item.id]);
    return html`
      <div class="row ${item.enabled ? "" : "disabled"}">
        <a class="main" href=${`${this.base}/settings/notifications/${item.id}`} @click=${this._link}>
          <ha-icon .icon=${item.icon || categoryIcon || "mdi:bell"}></ha-icon>
          <div class="text">
            <div class="name">${item.name}</div>
            <div class="secondary">
              ${category ?? item.category}${steps > 1 ? ` · ${steps} steps` : ""}
            </div>
          </div>
          ${renderStatus(status)}
        </a>
        <ha-dropdown @wa-select=${(ev: CustomEvent<{ item: { value: string } }>) => this._menu(ev, item)}>
          <ha-icon-button slot="trigger" .label=${"Menu"}>
            <ha-icon icon="mdi:dots-vertical"></ha-icon>
          </ha-icon-button>
          <ha-dropdown-item value="run" .disabled=${!item.enabled}>
            <ha-icon slot="icon" icon="mdi:play"></ha-icon>
            Run now
          </ha-dropdown-item>
          <ha-dropdown-item value="duplicate">
            <ha-icon slot="icon" icon="mdi:content-duplicate"></ha-icon>
            Duplicate
          </ha-dropdown-item>
          <ha-dropdown-item value="toggle">
            <ha-icon slot="icon" .icon=${item.enabled ? "mdi:stop-circle-outline" : "mdi:play-circle-outline"}></ha-icon>
            ${item.enabled ? "Disable" : "Enable"}
          </ha-dropdown-item>
          <wa-divider></wa-divider>
          <ha-dropdown-item value="delete" variant="danger">
            <ha-icon slot="icon" icon="mdi:delete"></ha-icon>
            Delete
          </ha-dropdown-item>
        </ha-dropdown>
        ${this._search.trim() || this._category
          ? nothing
          : html`<div class="handle" title="Drag to reorder">
              <ha-icon icon="mdi:drag"></ha-icon>
            </div>`}
      </div>
    `;
  }

  private _link(ev: MouseEvent): void {
    if (ev.ctrlKey || ev.metaKey || ev.shiftKey || ev.button !== 0) return;
    ev.preventDefault();
    navigate((ev.currentTarget as HTMLAnchorElement).getAttribute("href")!);
  }

  private _tabChanged(ev: CustomEvent<{ name: string }>): void {
    const tab = ev.detail.name as SettingsTab;
    if (tab === this.tab) return;
    navigate(tab === "general" ? `${this.base}/settings/general` : `${this.base}/settings`);
  }

  private _categoryChanged(value: string): void {
    this._category = value === "all" ? "" : value;
    const url = new URL(window.location.href);
    if (this._category) url.searchParams.set("category", this._category);
    else url.searchParams.delete("category");
    history.replaceState(history.state, "", url);
  }

  private _add(): void {
    navigate(`${this.base}/settings/notifications/new`);
  }

  private async _moved(ev: CustomEvent<{ oldIndex: number; newIndex: number }>): Promise<void> {
    ev.stopPropagation();
    const ids = (this.config?.notifications ?? []).map((item) => item.id);
    const [moved] = ids.splice(ev.detail.oldIndex, 1);
    ids.splice(ev.detail.newIndex, 0, moved);
    await this._run(() =>
      this.hass!.callWS({ type: `${DOMAIN}/item/reorder`, section: "notifications", item_ids: ids }),
    );
  }

  private async _menu(ev: CustomEvent<{ item: { value: string } }>, item: Notification): Promise<void> {
    const hass = this.hass!;
    switch (ev.detail.item.value) {
      case "run": {
        const entityId = this.state?.notifications[item.id]?.entity_id;
        if (!entityId) return;
        await this._run(() => hass.callService!(DOMAIN, "trigger", { entity_id: entityId }));
        return;
      }
      case "duplicate":
        await this._run(async () => {
          const copy = await hass.callWS<Notification>({
            type: `${DOMAIN}/notification/duplicate`,
            notification_id: item.id,
          });
          await hass.callWS({
            type: `${DOMAIN}/notification/set_enabled`,
            notification_id: copy.id,
            enabled: false,
          });
          navigate(`${this.base}/settings/notifications/${copy.id}`);
        });
        return;
      case "toggle":
        await this._run(() =>
          hass.callWS({
            type: `${DOMAIN}/notification/set_enabled`,
            notification_id: item.id,
            enabled: !item.enabled,
          }),
        );
        return;
      case "delete":
        if (
          await confirmDialog(this, {
            title: `Delete ${item.name}?`,
            text: "The notification, its cards and its sensor are deleted.",
            confirm: "Delete",
            destructive: true,
          })
        ) {
          await this._run(() =>
            hass.callWS({ type: `${DOMAIN}/item/delete`, section: "notifications", item_id: item.id }),
          );
        }
        return;
    }
  }

  private async _run(task: () => Promise<unknown>): Promise<void> {
    this._error = undefined;
    try {
      await task();
    } catch (err) {
      this._error = errorText(err);
    }
  }

  static override styles = css`
    :host {
      display: block;
      height: 100%;
    }
    .content {
      max-width: 1040px;
      margin: 0 auto;
      padding: 16px 16px 96px;
      display: flex;
      flex-direction: column;
      gap: 16px;
      box-sizing: border-box;
    }
    .filters {
      display: flex;
      gap: 12px;
      flex-wrap: wrap;
      align-items: center;
    }
    ha-input-search {
      flex: 1 1 240px;
    }
    .category {
      flex: 0 1 240px;
      min-width: 180px;
    }
    .rows {
      display: flex;
      flex-direction: column;
    }
    .row {
      display: flex;
      align-items: center;
      gap: 4px;
      padding-inline-end: 8px;
      border-bottom: 1px solid var(--divider-color);
      background-color: var(--card-background-color);
    }
    .row:last-child {
      border-bottom: none;
    }
    .main {
      flex: 1;
      min-width: 0;
      display: flex;
      align-items: center;
      gap: 16px;
      padding: 12px 8px 12px 16px;
      color: inherit;
      text-decoration: none;
      min-height: 48px;
    }
    .main:hover {
      background-color: rgb(from var(--primary-text-color) r g b / 0.04);
    }
    .main ha-icon {
      color: var(--state-icon-color, var(--secondary-text-color));
      flex: none;
    }
    .row.disabled .main ha-icon,
    .row.disabled .name {
      opacity: 0.6;
    }
    .text {
      flex: 1;
      min-width: 0;
    }
    .name {
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .secondary {
      color: var(--secondary-text-color);
      font-size: var(--ha-font-size-m, 14px);
    }
    .handle {
      cursor: grab;
      padding: 8px;
      color: var(--secondary-text-color);
    }
    .fab {
      position: fixed;
      right: calc(16px + var(--safe-area-inset-right, 0px));
      bottom: calc(16px + var(--safe-area-inset-bottom, 0px));
      --ha-button-box-shadow: var(--ha-box-shadow-l);
    }
    .empty {
      padding: 32px 16px;
      text-align: center;
      color: var(--secondary-text-color);
    }
    ${unsafeCSS(STATUS_STYLES)}
  `;
}

declare global {
  interface HTMLElementTagNameMap {
    "nc-settings": NcSettings;
  }
}
