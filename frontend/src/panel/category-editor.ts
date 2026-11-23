// The editor of one category, laid out like the notification editor: the
// name in the header with a link to the category's notifications and
// Delete; a preview of a card of the category; the blocks Settings and
// Interactions (the buttons its notifications inherit); Save when something
// changed.

import { LitElement, css, html, nothing, type PropertyValues } from "lit";
import { customElement, property, state } from "lit/decorators.js";

import {
  DOMAIN,
  type Button,
  type CardState,
  type Category,
  type CategoryButton,
  type Notification,
  type NotificationCenterConfig,
  colorCss,
} from "../shared/config";
import { cssColor } from "../shared/format";
import {
  categoryButtons,
  errorText,
  liveButtons,
  navigate,
  snoozeChoices,
} from "../shared/live";
import "../shared/notification-view";
import type { NotificationViewData } from "../shared/notification-view";
import { isTemplate, plainPlaceholders } from "../shared/text";
import type { HomeAssistant } from "../shared/types";
import "./channel-tables";
import { audienceCount, channelCount, channelsOf, sleepersOf } from "./channel-tables";
import { confirmDialog } from "./confirm";
import { chimeField, colorField, highlightField } from "./color-field";
import { field } from "./fields";
import { BLOCK_STYLES, block } from "./editor/block";
import { INTERACTION_DEFAULTS } from "./editor/interaction-dialog";
import "./editor/interaction-dialog";
import {
  type EditorNotification,
  listedEntities,
  newId,
  toEditor,
} from "./editor/model";

type Draft = Omit<Category, "id"> & { id?: string };

@customElement("nc-category-editor")
export class NcCategoryEditor extends LitElement {
  @property({ attribute: false }) public hass?: HomeAssistant;

  @property({ type: Boolean, reflect: true }) public narrow = false;

  @property({ attribute: false }) public config?: NotificationCenterConfig;

  // The category's id, or "new".
  @property() public categoryId = "new";

  @property() public base = "/notification-center";

  @state() private _draft?: Draft;

  @state() private _error?: string;

  // Delete was refused: the category still has notifications.
  @state() private _inUse = false;

  @state() private _saving = false;

  // The preview's message, rendered for a real entity of the example.
  @state() private _example?: { key: string; message: string };

  // The button whose dialog is open.
  @state() private _button?: { button: CategoryButton; isNew: boolean };

  private _original = "";

  private _stored = "";

  private _loadedFor?: string;

  private get _isNew(): boolean {
    return this.categoryId === "new";
  }

  private get _dirty(): boolean {
    return !!this._draft && JSON.stringify(this._draft) !== this._original;
  }

  private _storedItem(): Category | undefined {
    return this.config?.categories.find((item) => item.id === this.categoryId);
  }

  protected override willUpdate(changed: PropertyValues): void {
    if (changed.has("categoryId") && this._loadedFor !== this.categoryId)
      this._draft = undefined;
    if (!this.config) return;
    if (!this._draft) this._load();
    else if (!this._isNew && changed.has("config")) {
      const stored = this._storedItem();
      if (stored && JSON.stringify(stored) !== this._stored && !this._dirty)
        this._load();
    }
    if (changed.has("config") || changed.has("categoryId"))
      this._renderExample();
  }

  // The example of the preview: the category's first notification with an
  // entity, its message rendered for that entity (else the first one).
  private _exampleOf(): { notification?: Notification; entity?: string } {
    const hass = this.hass;
    const notifications = this._isNew ? [] : this._notifications();
    if (!hass) return { notification: notifications[0] };
    const all = (this.config?.notifications ??
      []) as unknown as EditorNotification[];
    for (const notification of notifications) {
      const entity = listedEntities(
        hass,
        toEditor(notification as unknown as EditorNotification, all, undefined),
      )[0];
      if (entity) return { notification, entity };
    }
    return { notification: notifications[0] };
  }

  private async _renderExample(): Promise<void> {
    const { notification, entity } = this._exampleOf();
    const message = notification?.steps[0]?.message;
    if (!this.hass || !notification || !entity || !message) return;
    const key = JSON.stringify([notification.id, entity, message]);
    if (this._example?.key === key) return;
    try {
      const [result] = await this.hass.callWS<{ text: string | null }[]>({
        type: `${DOMAIN}/text/preview`,
        texts: [message],
        entity_id: entity,
        notification_id: notification.id,
      });
      if (result?.text) this._example = { key, message: result.text };
    } catch {
      // The plain message stays.
    }
  }

  private _load(): void {
    this._loadedFor = this.categoryId;
    this._error = undefined;
    this._inUse = false;
    if (this._isNew) {
      // A new category starts with General's icon and colour.
      const general = this.config!.categories.find(
        (item) => item.id === "general",
      );
      this._draft = {
        name: "",
        icon: general?.icon ?? null,
        color: general?.color ?? null,
        highlight: general?.highlight ?? "none",
        chime: general?.chime ?? null,
        buttons: categoryButtons(undefined),
        // And General's channels and audience.
        channels: structuredClone(general?.channels ?? {}),
        audience: structuredClone(general?.audience ?? {}),
      };
      this._stored = "";
    } else {
      const stored = this._storedItem();
      if (!stored) {
        this._draft = undefined;
        this._error = "This category does not exist (any more).";
        return;
      }
      this._stored = JSON.stringify(stored);
      this._draft = {
        ...structuredClone(stored),
        buttons: categoryButtons(stored),
      };
    }
    this._original = JSON.stringify(this._draft);
  }

  private _change(changes: Partial<Draft>): void {
    this._draft = { ...this._draft!, ...changes };
  }

  private _notifications(): Notification[] {
    return (this.config?.notifications ?? []).filter(
      (item) => item.category === this.categoryId,
    );
  }

  // -- Preview ---------------------------------------------------------------

  private _previewView(draft: Draft): NotificationViewData | undefined {
    const hass = this.hass;
    if (!hass) return undefined;
    const { notification, entity } = this._exampleOf();
    const step = notification?.steps[0] ?? {
      id: "",
      enabled: true,
      message: "",
      activation: { type: "triggers" },
      buttons: [],
    };
    const category = { ...draft, id: draft.id ?? "" } as Category;
    const card = {
      notification_id: notification?.id ?? "",
      step_id: step.id,
      entity_id: entity ?? null,
      status: "active",
      since: new Date(Date.now() - 5 * 60_000).toISOString(),
      state_since: new Date().toISOString(),
      snoozed_until: null,
      message: null,
      info: null,
    } as CardState;
    const live = {
      card,
      notification: notification ?? ({} as Notification),
      category,
      step,
    };
    return {
      label: notification?.name ?? "Example",
      // Rendered for the example's entity; without one the placeholders
      // read as words, {Area} as Area.
      message:
        (this._example &&
        this._example.key ===
          JSON.stringify([notification?.id, entity, step.message])
          ? this._example.message
          : step.message && !isTemplate(step.message)
            ? plainPlaceholders(step.message)
            : "") || "Message",
      icon: notification?.icon || draft.icon || "mdi:bell",
      color: cssColor(colorCss(this.config, notification?.color ?? draft.color)),
      highlight: notification?.highlight ?? draft.highlight ?? "none",
      buttons: liveButtons(live).map((button) => ({
        key: button.key || button.button.type,
        label: button.label,
        icon: button.icon,
        plain: button.plain,
      })),
    };
  }

  // -- Render ----------------------------------------------------------------

  protected override render() {
    const draft = this._draft;
    const title = draft
      ? draft.name || (this._isNew ? "New category" : "")
      : "Category";
    return html`
      <hass-subpage
        .hass=${this.hass}
        .narrow=${this.narrow}
        .header=${title}
        .backCallback=${() => void this._back()}
      >
        ${draft ? this._renderToolbar() : nothing}
        <div class="content">
          ${this._error
            ? html`<ha-alert alert-type="error">${this._error}</ha-alert>`
            : nothing}
          ${this._inUse
            ? html`<ha-alert alert-type="warning">
                ${draft?.name || "This category"} has notifications, so it
                cannot be deleted.
                <ha-button
                  slot="action"
                  appearance="plain"
                  @click=${this._viewNotifications}
                >
                  View notifications
                </ha-button>
              </ha-alert>`
            : nothing}
          ${draft ? this._renderEditor(draft) : nothing}
        </div>
        ${draft
          ? html`<ha-button
              slot="fab"
              size="l"
              class="fab ${this._dirty ? "dirty" : ""}"
              .disabled=${this._saving}
              @click=${this._save}
            >
              <ha-icon slot="start" icon="mdi:content-save"></ha-icon>
              Save
            </ha-button>`
          : nothing}
      </hass-subpage>
      ${this._button ? this._renderButtonDialog() : nothing}
    `;
  }

  private _renderToolbar() {
    return html`<div slot="toolbar-icon" class="toolbar">
      ${this._isNew
        ? nothing
        : html`<ha-button appearance="plain" @click=${this._viewNotifications}>
            <ha-icon slot="start" icon="mdi:format-list-bulleted"></ha-icon>
            Notifications
          </ha-button>`}
      ${this._isNew || this.categoryId === "general"
        ? nothing
        : html`<ha-icon-button .label=${"Delete"} @click=${this._delete}>
            <ha-icon icon="mdi:delete"></ha-icon>
          </ha-icon-button>`}
    </div>`;
  }

  private _renderEditor(draft: Draft) {
    const view = this._previewView(draft);
    return html`
      ${view
        ? html`<notification-center-view
            class="preview"
            .hass=${this.hass}
            .view=${view}
          ></notification-center-view>`
        : nothing}
      ${this._panel("settings", "mdi:cog-outline", "Settings", undefined, () =>
        this._renderSettings(draft),
      )}
      ${this._panel(
        "interactions",
        "mdi:gesture-tap-button",
        "Interactions",
        draft.buttons.filter((button) => button.enabled).length,
        () => this._renderInteractions(draft),
      )}
      ${this._panel(
        "audience",
        "mdi:account-multiple",
        "Audience",
        this._audienceCount(draft),
        () =>
          html`<nc-audience-table
            .hass=${this.hass}
            .sleepers=${sleepersOf(this.config?.people)}
            .value=${draft.audience ?? {}}
            @value-changed=${(
              ev: CustomEvent<{ value: Category["audience"] }>,
            ) => {
              ev.stopPropagation();
              this._change({ audience: ev.detail.value });
            }}
          ></nc-audience-table>`,
      )}
      ${this._panel(
        "channels",
        "mdi:broadcast",
        "Channels",
        channelCount(channelsOf(this.hass, this.config), draft.channels, undefined),
        () =>
          html`<nc-channel-table
            .hass=${this.hass}
            .narrow=${this.narrow}
            .modes=${this.config?.modes ?? []}
            .channels=${channelsOf(this.hass, this.config)}
            .config=${this.config}
            .testContext=${{ category: draft }}
            .value=${draft.channels ?? {}}
            @value-changed=${(
              ev: CustomEvent<{ value: Category["channels"] }>,
            ) => {
              ev.stopPropagation();
              this._change({ channels: ev.detail.value });
            }}
          ></nc-channel-table>`,
      )}
    `;
  }

  private _audienceCount(draft: Draft): number | undefined {
    return audienceCount(
      this.hass,
      draft.audience,
      undefined,
      sleepersOf(this.config?.people),
    );
  }

  private _panel(
    _key: string,
    icon: string,
    header: string,
    count: number | string | undefined,
    content: () => unknown,
  ) {
    return block({
      icon,
      header,
      count,
      expanded: true,
      fixed: true,
      toggled: () => undefined,
      content: content(),
    });
  }

  // The name is required, but not marked so for Home Assistant: that keeps
  // room for its message under the field. Save asks for it instead.
  private _renderSettings(draft: Draft) {
    return html`<div class="block">
      <div class="row">
        ${field(
          this.hass,
          { text: {} },
          draft.name,
          "Category name*",
          (value) => this._change({ name: (value as string) ?? "" }),
        )}
        ${field(
          this.hass,
          { icon: { placeholder: "mdi:bell" } },
          draft.icon ?? "",
          "Icon",
          (value) => this._change({ icon: (value as string) || null }),
        )}
      </div>
      <div class="row three">
        ${colorField(this.hass, this.config, draft.color, (value) => this._change({ color: value }))}
        ${highlightField(draft.highlight ?? "none", undefined, (value) => this._change({ highlight: value ?? "none" }))}
        ${this.config?.speakers.length
          ? chimeField(this.config, draft.chime, undefined, (value) => this._change({ chime: value }))
          : nothing}
      </div>
    </div>`;
  }

  // -- Interactions ------------------------------------------------------------

  private _renderInteractions(draft: Draft) {
    const tap = draft.buttons.filter((button) => button.type === "tap");
    const builtin = draft.buttons.filter(
      (button) => button.type !== "tap" && button.type !== "custom",
    );
    const custom = draft.buttons.filter((button) => button.type === "custom");
    const card = (items: CategoryButton[]) =>
      html`<ha-card outlined class="interactions"
        >${items.map((button) => this._row(button))}</ha-card
      >`;
    return html`<div class="block">
      ${card(tap)}
      <div class="title">Buttons</div>
      ${card(builtin)} ${custom.length ? card(custom) : nothing}
      <div>
        <ha-button appearance="filled" size="s" @click=${this._addButton}>
          <ha-icon slot="start" icon="mdi:plus"></ha-icon>
          Add button
        </ha-button>
      </div>
    </div>`;
  }

  private _row(button: CategoryButton) {
    const defaults = INTERACTION_DEFAULTS[button.type];
    const label =
      button.type === "tap" ? defaults.label : button.label || defaults.label;
    const secondary =
      button.type === "snooze"
        ? snoozeChoices(button)
            .map((choice) => choice.text)
            .join(", ")
        : "";
    const open = () => (this._button = { button, isNew: false });
    return html`<div
      class="interaction ${button.enabled ? "" : "off"}"
      role="button"
      tabindex="0"
      @click=${open}
      @keydown=${(ev: KeyboardEvent) => {
        if (ev.key === "Enter") open();
      }}
    >
      <ha-switch
        .checked=${button.enabled}
        @click=${(ev: Event) => ev.stopPropagation()}
        @change=${(ev: Event) =>
          this._setButton({
            ...button,
            enabled: (ev.target as HTMLInputElement).checked,
          })}
      ></ha-switch>
      <ha-icon
        class=${button.type === "custom" ? "" : "builtin"}
        .icon=${button.type === "tap"
          ? defaults.icon
          : button.icon || defaults.icon}
      ></ha-icon>
      <div class="own-text">
        <div>${label}</div>
        ${secondary ? html`<div class="secondary">${secondary}</div>` : nothing}
      </div>
      <ha-icon-button .label=${"Edit"}>
        <ha-icon icon="mdi:pencil"></ha-icon>
      </ha-icon-button>
    </div>`;
  }

  private _setButton(button: CategoryButton): void {
    const buttons = [...this._draft!.buttons];
    const index = buttons.findIndex(
      (item) => item.id === button.id && item.type === button.type,
    );
    if (index < 0) buttons.push(button);
    else buttons[index] = button;
    this._change({ buttons });
  }

  private _addButton(): void {
    this._button = {
      isNew: true,
      button: {
        id: newId(),
        type: "custom",
        enabled: true,
        label: "",
        show_in_push: true,
      },
    };
  }

  private _renderButtonDialog() {
    const edit = this._button!;
    const otherPushButtons = this._draft!.buttons.filter(
      (button) =>
        button.id !== edit.button.id &&
        button.enabled &&
        button.type !== "tap" &&
        button.show_in_push,
    ).length;
    return html`<nc-interaction-dialog
      .hass=${this.hass}
      .narrow=${this.narrow}
      mode="category"
      .button=${{ ...edit.button, action: { type: "nothing" } } as Button}
      .isNew=${edit.isNew}
      .otherPushButtons=${otherPushButtons}
      @interaction-closed=${(
        ev: CustomEvent<{ result?: Button | "delete" }>,
      ) => {
        ev.stopPropagation();
        this._button = undefined;
        const result = ev.detail.result;
        if (!result) return;
        if (result === "delete") {
          this._change({
            buttons: this._draft!.buttons.filter(
              (button) => button.id !== edit.button.id,
            ),
          });
          return;
        }
        const { action: _action, confirm: _confirm, ...rest } = result;
        void _action;
        void _confirm;
        this._setButton({
          ...rest,
          enabled: rest.enabled ?? true,
        } as CategoryButton);
      }}
    ></nc-interaction-dialog>`;
  }

  // -- Actions -----------------------------------------------------------------

  private _viewNotifications(): void {
    navigate(
      `${this.base}/settings/notifications?category=${encodeURIComponent(this.categoryId)}`,
    );
  }

  private async _back(): Promise<void> {
    if (
      this._dirty &&
      !(await confirmDialog(this, {
        title: "Leave without saving?",
        text: "The changes of this category are lost.",
        confirm: "Leave",
        destructive: true,
      }))
    ) {
      return;
    }
    navigate(`${this.base}/settings/categories`);
  }

  private async _save(): Promise<void> {
    const draft = this._draft;
    if (!draft || !this.hass) return;
    if (!draft.name.trim()) {
      this._error = "The category needs a name.";
      return;
    }
    this._saving = true;
    this._error = undefined;
    const data: Record<string, unknown> = { ...draft, name: draft.name.trim() };
    delete data.id;
    try {
      if (this._isNew) {
        const created = await this.hass.callWS<Category>({
          type: `${DOMAIN}/item/create`,
          section: "categories",
          data,
        });
        this._original = JSON.stringify(this._draft);
        navigate(`${this.base}/settings/categories/${created.id}`, true);
      } else {
        await this.hass.callWS({
          type: `${DOMAIN}/item/update`,
          section: "categories",
          item_id: this.categoryId,
          data,
        });
        this._original = JSON.stringify(this._draft);
        this._draft = { ...this._draft! };
      }
    } catch (err) {
      this._error = errorText(err);
    } finally {
      this._saving = false;
    }
  }

  private async _delete(): Promise<void> {
    if (this._notifications().length) {
      this._inUse = true;
      return;
    }
    if (
      !(await confirmDialog(this, {
        title: `Delete ${this._draft?.name || "the category"}?`,
        confirm: "Delete",
        destructive: true,
      }))
    ) {
      return;
    }
    try {
      await this.hass!.callWS({
        type: `${DOMAIN}/item/delete`,
        section: "categories",
        item_id: this.categoryId,
      });
      this._original = JSON.stringify(this._draft);
      navigate(`${this.base}/settings/categories`, true);
    } catch (err) {
      this._error = errorText(err);
    }
  }

  static override styles = css`
    :host {
      display: block;
      height: 100%;
    }
    .toolbar {
      display: flex;
      align-items: center;
      gap: 4px;
    }
    .content {
      max-width: 1040px;
      margin: 0 auto;
      /* 24px under the header, as on the Overview. */
      padding: 24px 16px 96px;
      display: flex;
      flex-direction: column;
      gap: 16px;
      box-sizing: border-box;
    }
    .preview {
      max-width: 520px;
      width: 100%;
      margin: 0 auto 8px;
      pointer-events: none;
    }
    .block {
      display: flex;
      flex-direction: column;
      gap: 12px;
    }
    /* Two columns where they fit, without a gap at the end. */
    .fields {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(240px, 1fr));
      gap: 16px;
    }
    .block > .row {
      display: flex;
      gap: 16px;
      flex-wrap: wrap;
    }
    .block > .row > * {
      flex: 1 1 240px;
      min-width: 0;
    }
    /* Icon, Color and Highlight stay on one row down to a narrow screen. */
    .row.three > * {
      flex-basis: 160px;
    }
    .title {
      font-weight: var(--ha-font-weight-medium, 500);
      margin-top: 4px;
    }
    ha-icon.builtin {
      color: var(--amber-color, #ffc107);
    }
    ha-card.interactions {
      overflow: hidden;
    }
    .interaction {
      display: flex;
      align-items: center;
      gap: 16px;
      padding: 12px 16px;
      cursor: pointer;
    }
    .interaction + .interaction {
      border-top: 1px solid var(--divider-color);
    }
    .interaction:hover,
    .interaction:focus-visible {
      background-color: var(--secondary-background-color);
      outline: none;
    }
    .interaction.off .own-text,
    .interaction.off ha-icon {
      opacity: 0.6;
    }
    .interaction ha-icon {
      flex: none;
    }
    .own-text {
      flex: 1;
      min-width: 0;
    }
    .secondary {
      color: var(--secondary-text-color);
      font-size: var(--ha-font-size-s, 12px);
    }
    .switch-row {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 16px;
    }
    .fab {
      position: fixed;
      right: calc(16px + var(--safe-area-inset-right, 0px));
      bottom: calc(-80px - var(--safe-area-inset-bottom, 0px));
      transition: bottom 0.3s;
      --ha-button-box-shadow: var(--ha-box-shadow-l);
    }
    .fab.dirty {
      bottom: calc(16px + var(--safe-area-inset-bottom, 0px));
    }
    ${BLOCK_STYLES}
  `;
}

declare global {
  interface HTMLElementTagNameMap {
    "nc-category-editor": NcCategoryEditor;
  }
}
