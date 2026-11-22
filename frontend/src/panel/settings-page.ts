// The settings of the Notification Center: the Notifications list and the
// General tab, in Home Assistant's own subpage layout.

import { mdiBellOutline, mdiCogOutline, mdiShapeOutline } from "@mdi/js";
import { LitElement, css, html, nothing, unsafeCSS } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { repeat } from "lit/directives/repeat.js";

import {
  DOMAIN,
  type Category,
  type Notification,
  type NotificationCenterConfig,
  type StateMessage,
} from "../shared/config";
import { cssColor } from "../shared/format";
import { errorText, navigate } from "../shared/live";
import type { HomeAssistant } from "../shared/types";
import { confirmDialog } from "./confirm";
import "./settings-general";
import { STATUS_STYLES, renderStatus, statusOf } from "./status";

export type SettingsTab = "notifications" | "categories" | "general";

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
    const base = `${this.base}/settings`;
    const tabs = [
      { path: `${base}/notifications`, name: "Notifications", iconPath: mdiBellOutline },
      { path: `${base}/categories`, name: "Categories", iconPath: mdiShapeOutline },
      { path: `${base}/general`, name: "General", iconPath: mdiCogOutline },
    ];
    const route = { prefix: "", path: `${base}/${this.tab}` };
    return html`
      <hass-tabs-subpage
        .hass=${this.hass}
        .narrow=${this.narrow}
        .tabs=${tabs}
        .route=${route}
        back-path=${this.base}
        ?has-fab=${this.tab !== "general"}
      >
        <span slot="header">Notification Center settings</span>
        <div class="content">
          ${this._error ? html`<ha-alert alert-type="error">${this._error}</ha-alert>` : nothing}
          ${this.tab === "general"
            ? html`<nc-settings-general
                .hass=${this.hass}
                .config=${this.config}
                .narrow=${this.narrow}
                .base=${this.base}
              ></nc-settings-general>`
            : this.tab === "categories"
              ? this._renderCategories()
              : this._renderList()}
        </div>
        ${this.tab === "notifications"
          ? html`<ha-button slot="fab" size="l" @click=${this._add}>
              <ha-icon slot="start" icon="mdi:plus"></ha-icon>
              Add notification
            </ha-button>`
          : this.tab === "categories"
            ? html`<ha-button
                slot="fab"
                size="l"
                @click=${() => navigate(`${this.base}/settings/categories/new`)}
              >
                <ha-icon slot="start" icon="mdi:plus"></ha-icon>
                Add category
              </ha-button>`
            : nothing}
      </hass-tabs-subpage>
    `;
  }

  // The categories by name, each with its number of notifications.
  private _renderCategories() {
    const config = this.config;
    if (!config) return nothing;
    const categories = [...config.categories].sort((a, b) =>
      a.name.localeCompare(b.name, undefined, { sensitivity: "base" }),
    );
    return html`<ha-card outlined>
      <ha-list-base class="rows">
        ${categories.map((item) => {
          const count = config.notifications.filter((n) => n.category === item.id).length;
          return html`<ha-list-item-button
            href=${`${this.base}/settings/categories/${item.id}`}
            @click=${this._link}
          >
            <div slot="start" class="icon" style=${`--icon-color: ${cssColor(item.card_color)}`}>
              <ha-icon .icon=${item.icon || "mdi:bell"}></ha-icon>
            </div>
            <span slot="headline">${item.name}</span>
            <span slot="supporting-text">${count === 1 ? "1 notification" : `${count} notifications`}</span>
            ${this.narrow ? nothing : html`<ha-icon-next slot="end"></ha-icon-next>`}
          </ha-list-item-button>`;
        })}
      </ha-list-base>
    </ha-card>`;
  }

  private _renderList() {
    const config = this.config;
    if (!config) return nothing;
    const visible = this._visible();
    const filtering = !!this._search.trim() || !!this._category;
    const categories = new Map(config.categories.map((item) => [item.id, item]));
    const selected = categories.get(this._category);
    return html`
      <div class="filters">
        <ha-input-search
          appearance="outlined"
          .placeholder=${`Search ${config.notifications.length} notifications`}
          .value=${this._search}
          @input=${(ev: Event) => {
            this._search = (ev.target as HTMLInputElement).value ?? "";
          }}
        ></ha-input-search>
        <ha-dropdown
          @wa-select=${(ev: CustomEvent<{ item: { value: string } }>) =>
            this._categoryChanged(ev.detail.item.value)}
        >
          <ha-assist-chip
            slot="trigger"
            .label=${`Category: ${selected?.name ?? "All"}`}
            ?active=${!!selected}
          >
            <ha-icon slot="icon" .icon=${selected?.icon || "mdi:shape-outline"}></ha-icon>
            <ha-icon slot="trailing-icon" icon="mdi:menu-down"></ha-icon>
          </ha-assist-chip>
          <ha-dropdown-item value="all" class=${selected ? "" : "selected"}>
            All
          </ha-dropdown-item>
          ${config.categories.map(
            (item) => html`<ha-dropdown-item
              .value=${item.id}
              class=${item.id === this._category ? "selected" : ""}
            >
              <ha-icon slot="icon" .icon=${item.icon || "mdi:shape-outline"}></ha-icon>
              ${item.name}
            </ha-dropdown-item>`,
          )}
        </ha-dropdown>
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
              <ha-list-base class="rows">
                ${repeat(
                  visible,
                  (item) => item.id,
                  (item) => this._renderRow(item, categories.get(item.category), filtering),
                )}
              </ha-list-base>
            </ha-sortable>`}
      </ha-card>
    `;
  }

  private _renderRow(item: Notification, category: Category | undefined, filtering: boolean) {
    const steps = item.steps.length;
    const status = statusOf(item, this.state?.notifications[item.id]);
    const color = cssColor(item.card_color ?? category?.card_color);
    // The menu and the handle are inside the row's link: they must not open it.
    const stop = (ev: Event) => {
      ev.preventDefault();
      ev.stopPropagation();
    };
    return html`
      <ha-list-item-button
        class=${item.enabled ? "" : "disabled"}
        href=${`${this.base}/settings/notifications/${item.id}`}
        @click=${this._link}
      >
        ${filtering
          ? nothing
          : html`<div slot="start" class="handle" title="Drag to reorder" @click=${stop}>
              <ha-icon icon="mdi:drag-horizontal-variant"></ha-icon>
            </div>`}
        <div slot="start" class="icon" style=${`--icon-color: ${color}`}>
          <ha-icon .icon=${item.icon || category?.icon || "mdi:bell"}></ha-icon>
        </div>
        <span slot="headline">${item.name}</span>
        <span slot="supporting-text">
          ${category?.name ?? item.category}${steps > 1 ? ` · ${steps} steps` : ""}
        </span>
        <div slot="end" class="end">
          ${renderStatus(status)}
          <ha-dropdown
            @click=${stop}
            @wa-select=${(ev: CustomEvent<{ item: { value: string } }>) => this._menu(ev, item)}
          >
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
              <ha-icon
                slot="icon"
                .icon=${item.enabled ? "mdi:stop-circle-outline" : "mdi:play-circle-outline"}
              ></ha-icon>
              ${item.enabled ? "Disable" : "Enable"}
            </ha-dropdown-item>
            <wa-divider></wa-divider>
            <ha-dropdown-item value="delete" variant="danger">
              <ha-icon slot="icon" icon="mdi:delete"></ha-icon>
              Delete
            </ha-dropdown-item>
          </ha-dropdown>
        </div>
      </ha-list-item-button>
    `;
  }

  private _link(ev: MouseEvent): void {
    if (ev.defaultPrevented || ev.ctrlKey || ev.metaKey || ev.shiftKey || ev.button !== 0) return;
    ev.preventDefault();
    navigate((ev.currentTarget as HTMLElement).getAttribute("href")!);
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
      /* 24px under the header, as on the Overview. */
      padding: 24px 16px 16px;
      display: flex;
      flex-direction: column;
      gap: 16px;
      box-sizing: border-box;
    }
    .filters {
      display: flex;
      gap: 12px;
      align-items: center;
    }
    ha-input-search {
      flex: 1;
      min-width: 0;
      --ha-input-search-height: 32px;
      --ha-input-search-border-radius: 10px;
    }
    ha-dropdown-item.selected {
      font-weight: var(--ha-font-weight-medium, 500);
      color: var(--primary-color);
    }
    ha-card {
      overflow: hidden;
    }
    /* The list's own room at the sides, as the General list. */
    ha-list-item-button {
      border-top: 1px solid var(--divider-color);
    }
    ha-list-item-button:first-child {
      border-top: none;
    }
    /* As much room after the handle as after the icon. */
    .handle {
      cursor: grab;
      display: flex;
      color: var(--secondary-text-color);
      padding: 4px 0;
      margin-inline-end: 12px;
    }
    /* As the tile card's icon. */
    .icon {
      --icon-color: var(--primary-color);
      width: 36px;
      height: 36px;
      border-radius: var(--ha-tile-icon-border-radius, var(--ha-border-radius-pill, 9999px));
      display: flex;
      align-items: center;
      justify-content: center;
      color: var(--icon-color);
      background-color: color-mix(in srgb, var(--icon-color) 20%, transparent);
      --mdc-icon-size: 24px;
    }
    ha-list-item-button.disabled .icon,
    ha-list-item-button.disabled [slot="headline"] {
      opacity: 0.5;
    }
    .end {
      display: flex;
      align-items: center;
      gap: 4px;
    }
    .count {
      color: var(--secondary-text-color);
      gap: 8px;
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
