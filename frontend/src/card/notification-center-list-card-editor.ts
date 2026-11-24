import { LitElement, css, html, nothing } from "lit";
import { property, state } from "lit/decorators.js";

import { subscribeStore, type StoreData } from "../shared/store";
import type { HomeAssistant } from "../shared/types";
import { loadEditorElements } from "./elements";
import { upgradeListConfig, type NotificationCenterCardConfig } from "./notification-center-list-card";

const EDITOR_TYPE = "notification-center-editor";

const LABELS: Record<string, string> = {
  categories: "Categories",
  max_cards: "Maximum notifications",
  ignore_audience: "Ignore audience",
  show: "Show",
};

const HELPERS: Record<string, string> = {
  categories: "Leave empty for every category.",
  max_cards: "Leave empty to show every notification. The rest opens the Notification Center.",
  ignore_audience: "Also show the notifications meant for other people.",
  show: "Upcoming as on the Overview. Empty state: All done instead of hiding the card.",
};

interface SchemaItem {
  name: string;
  selector: Record<string, unknown>;
}

class NotificationCenterListCardEditor extends LitElement {
  @property({ attribute: false }) public hass?: HomeAssistant;

  @state() private _config?: NotificationCenterCardConfig;

  @state() private _ready = false;

  @state() private _store: StoreData = {};

  private _unsubscribe?: () => void;

  public setConfig(config: NotificationCenterCardConfig): void {
    this._config = upgradeListConfig(config);
  }

  public override connectedCallback(): void {
    super.connectedCallback();
    void loadEditorElements().then(() => {
      this._ready = true;
    });
    this._follow();
  }

  public override disconnectedCallback(): void {
    super.disconnectedCallback();
    this._unsubscribe?.();
    this._unsubscribe = undefined;
  }

  protected override willUpdate(): void {
    this._follow();
  }

  private _follow(): void {
    if (!this._unsubscribe && this.hass && this.isConnected) {
      this._unsubscribe = subscribeStore(this.hass.connection, (data) => {
        this._store = data;
      });
    }
  }

  private _schema(): SchemaItem[] {
    const categories = this._store.config?.categories ?? [];
    return [
      {
        name: "categories",
        selector: {
          select: {
            multiple: true,
            mode: "dropdown",
            options: categories.map((item) => ({ value: item.id, label: item.name })),
          },
        },
      },
      { name: "max_cards", selector: { number: { min: 1, mode: "box" } } },
      { name: "ignore_audience", selector: { boolean: {} } },
      {
        name: "show",
        selector: {
          select: {
            multiple: true,
            mode: "list",
            options: [
              { value: "active", label: "Active" },
              { value: "upcoming", label: "Upcoming" },
              { value: "empty", label: "Empty state" },
            ],
          },
        },
      },
    ];
  }

  protected override render() {
    if (!this.hass || !this._config) return nothing;
    if (!this._ready) return html`<div class="loading">Loading…</div>`;
    return html`
      <ha-form
        .hass=${this.hass}
        .data=${{ show: ["active"], ...this._config }}
        .schema=${this._schema()}
        .computeLabel=${(item: SchemaItem) => LABELS[item.name] ?? item.name}
        .computeHelper=${(item: SchemaItem) => HELPERS[item.name]}
        @value-changed=${this._valueChanged}
      ></ha-form>
    `;
  }

  private _valueChanged(ev: CustomEvent<{ value: Record<string, unknown> }>): void {
    ev.stopPropagation();
    const config: Record<string, unknown> = { ...ev.detail.value };
    for (const [key, item] of Object.entries(config)) {
      if (
        item === undefined ||
        item === null ||
        item === "" ||
        item === false ||
        (Array.isArray(item) && item.length === 0)
      ) {
        delete config[key];
      }
    }
    // Active only is the default.
    const show = config.show as string[] | undefined;
    if (show?.length === 1 && show[0] === "active") delete config.show;
    this._config = config as unknown as NotificationCenterCardConfig;
    this.dispatchEvent(
      new CustomEvent("config-changed", {
        detail: { config },
        bubbles: true,
        composed: true,
      }),
    );
  }

  static override styles = css`
    .loading {
      color: var(--secondary-text-color);
    }
  `;
}

if (!customElements.get(EDITOR_TYPE)) {
  customElements.define(EDITOR_TYPE, NotificationCenterListCardEditor);
}
