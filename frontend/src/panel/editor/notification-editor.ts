// The editor of one notification, laid out like Home Assistant's automation
// editor: the name and status in the header with undo, redo, the Enabled
// switch and the menu; a preview of the selected step's card; the blocks
// Settings, Entities and the steps; Save when something changed.

import { LitElement, css, html, nothing, unsafeCSS, type PropertyValues } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { keyed } from "lit/directives/keyed.js";

import {
  DOMAIN,
  type CardState,
  type Notification,
  type NotificationCenterConfig,
  type StateMessage,
} from "../../shared/config";
import { cssColor } from "../../shared/format";
import { cardData, categoryOf, errorText, liveButtons, navigate } from "../../shared/live";
import "../../shared/notification-view";
import type { NotificationViewData } from "../../shared/notification-view";
import { isTemplate, plainPlaceholders } from "../../shared/text";
import type { HomeAssistant } from "../../shared/types";
import { confirmDialog } from "../confirm";
import { type FieldOptions, field, iconSelect } from "../fields";
import { STATUS_STYLES, renderStatus, statusOf } from "../status";
import { domainName, groupName, newGroup } from "./group-dialog";
import { BLOCK_STYLES, block } from "./block";
import "./group-dialog";
import { ACTION_SLOT_STYLES, renderActionSlots, renderMemberSlots } from "./action-slots";
import {
  type EditorNotification,
  type EditorStep,
  type EntityGroup,
  type Obj,
  applyCategoryDefaults,
  buttonsWithEntityActions,
  detachCategoryButtons,
  entityActionSlots,
  entityDisplay,
  newId,
  groupMatches,
  listedEntities,
  newNotification,
  newStep,
  prefillPinned,
  toEditor,
  toSaved,
} from "./model";
import "./step-editor";
import { setEntitiesResolver } from "./entities-form";

const MAX_UNDO = 50;

interface PreviewText {
  text: string | null;
  error: string | null;
}

@customElement("nc-notification-editor")
export class NcNotificationEditor extends LitElement {
  @property({ attribute: false }) public hass?: HomeAssistant;

  @property({ type: Boolean, reflect: true }) public narrow = false;

  @property({ attribute: false }) public config?: NotificationCenterConfig;

  @property({ attribute: false }) public state?: StateMessage;

  // The notification's id, or "new".
  @property() public notificationId = "new";

  @property() public base = "/notification-center";

  @state() private _draft?: EditorNotification;

  @state() private _step = 0;

  // The whole notification in Home Assistant's YAML editor; the value it
  // starts from (set again on undo and redo), and its last parse error.
  @state() private _yaml?: { value: unknown; error?: string };

  @state() private _expanded = new Set<string>();

  @state() private _error?: string;

  @state() private _saving = false;

  @state() private _undo: string[] = [];

  @state() private _redo: string[] = [];

  @state() private _preview: PreviewText[] = [];

  @state() private _group?: { index: number; group: EntityGroup };

  // Add entity shows the picker in place of the button, open.
  @state() private _addingEntity = false;

  @state() private _entity?: { index: number; entityId: string; actions: Obj };

  // A member of an entity group whose custom actions are being edited.
  @state() private _member?: { groupIndex: number; entityId: string; custom: Obj };

  // The draft as it was loaded or saved, to tell whether it changed.
  private _original = "";

  // The stored notification the draft was made from.
  private _stored = "";

  private _loadedFor?: string;

  private _previewTimer?: number;

  private _previewKey = "";

  public override connectedCallback(): void {
    super.connectedCallback();
    window.addEventListener("keydown", this._keydown);
    window.addEventListener("beforeunload", this._beforeUnload);
  }

  public override disconnectedCallback(): void {
    super.disconnectedCallback();
    window.removeEventListener("keydown", this._keydown);
    window.removeEventListener("beforeunload", this._beforeUnload);
    window.clearTimeout(this._previewTimer);
  }

  private get _isNew(): boolean {
    return this.notificationId === "new";
  }

  private get _dirty(): boolean {
    return !!this._draft && JSON.stringify(this._draft) !== this._original;
  }

  private _storedItem(): Notification | undefined {
    return this.config?.notifications.find((item) => item.id === this.notificationId);
  }

  protected override willUpdate(changed: PropertyValues): void {
    setEntitiesResolver(this._entitiesOfSensor);
    if (changed.has("notificationId") && this._loadedFor !== this.notificationId) {
      this._draft = undefined;
      this._yaml = undefined;
    }
    if (!this.config || !this.state) return;
    if (!this._draft) {
      this._load();
    } else if (!this._isNew && (changed.has("config") || changed.has("state"))) {
      // Changed somewhere else (the list, another browser): follow it when
      // nothing was changed here.
      const stored = this._storedItem();
      if (stored && JSON.stringify(stored) !== this._stored && !this._dirty) this._load();
    }
    if (this._draft) this._schedulePreview();
  }

  private _load(): void {
    this._loadedFor = this.notificationId;
    this._undo = [];
    this._redo = [];
    this._error = undefined;
    if (this._isNew) {
      const general = this.config!.categories.find((item) => item.id === "general");
      this._draft = newNotification(general);
      this._stored = "";
      this._original = JSON.stringify(this._draft);
      this._expanded = new Set(["settings"]);
      this._step = 0;
      return;
    }
    const stored = this._storedItem();
    if (!stored) {
      this._draft = undefined;
      this._error = "This notification does not exist (any more).";
      return;
    }
    this._stored = JSON.stringify(stored);
    this._draft = toEditor(
      stored as unknown as EditorNotification,
      this.config!.notifications as unknown as EditorNotification[],
      this.state!.notifications,
    );
    this._original = JSON.stringify(this._draft);
    this._step = Math.min(this._step, this._draft.steps.length - 1);
    if (this._yaml) this._yaml = { value: this._yamlValue(this._draft) };
  }

  // -- Changes, undo and redo ---------------------------------------------

  private _set(draft: EditorNotification): void {
    if (this._draft) {
      this._undo = [...this._undo, JSON.stringify(this._draft)].slice(-MAX_UNDO);
      this._redo = [];
    }
    this._draft = draft;
  }

  private _change(changes: Partial<EditorNotification>): void {
    let draft = { ...this._draft!, ...changes };
    // Before the first save, on-off entities fill in the start.
    if (this._isNew && this.hass && ("entities" in changes || "entity_groups" in changes)) {
      draft = prefillPinned(this.hass, draft);
    }
    this._set(draft);
  }

  // The entities a notification lists, for the Notification entities forms.
  private _entitiesOfSensor = (sensor: string): string[] => {
    const hass = this.hass;
    const draft = this._draft;
    if (!hass || !this.config || !this.state) return [];
    const id = Object.entries(this.state.notifications).find(
      ([, item]) => item.entity_id === sensor,
    )?.[0];
    if (!id) return [];
    if (draft && id === draft.id) return listedEntities(hass, draft);
    const stored = this.config.notifications.find((item) => item.id === id);
    if (!stored) return [];
    const all = this.config.notifications as unknown as EditorNotification[];
    return listedEntities(hass, toEditor(stored as unknown as EditorNotification, all, this.state.notifications));
  };

  private _changeStep(index: number, step: EditorStep): void {
    const steps = [...this._draft!.steps];
    steps[index] = step;
    this._change({ steps });
  }

  private _undoChange(): void {
    const previous = this._undo.at(-1);
    if (!previous || !this._draft) return;
    this._redo = [...this._redo, JSON.stringify(this._draft)];
    this._undo = this._undo.slice(0, -1);
    this._draft = JSON.parse(previous) as EditorNotification;
    this._step = Math.min(this._step, this._draft.steps.length - 1);
    if (this._yaml) this._yaml = { value: this._yamlValue(this._draft) };
  }

  private _redoChange(): void {
    const next = this._redo.at(-1);
    if (!next || !this._draft) return;
    this._undo = [...this._undo, JSON.stringify(this._draft)];
    this._redo = this._redo.slice(0, -1);
    this._draft = JSON.parse(next) as EditorNotification;
    this._step = Math.min(this._step, this._draft.steps.length - 1);
    if (this._yaml) this._yaml = { value: this._yamlValue(this._draft) };
  }

  private _keydown = (ev: KeyboardEvent): void => {
    if (!(ev.ctrlKey || ev.metaKey) || ev.altKey) return;
    const key = ev.key.toLowerCase();
    if (key !== "z" && key !== "y") return;
    // Text fields keep their own undo.
    const inField = ev
      .composedPath()
      .some(
        (node) =>
          node instanceof HTMLElement &&
          (node.tagName === "INPUT" || node.tagName === "TEXTAREA" || node.isContentEditable),
      );
    if (inField) return;
    ev.preventDefault();
    if (key === "y" || ev.shiftKey) this._redoChange();
    else this._undoChange();
  };

  private _beforeUnload = (ev: BeforeUnloadEvent): void => {
    if (this._dirty) ev.preventDefault();
  };

  // -- Preview ---------------------------------------------------------------

  private _schedulePreview(): void {
    const draft = this._draft!;
    const step = draft.steps[this._step];
    if (!step || !this.hass) return;
    const entity = listedEntities(this.hass, draft)[0] ?? null;
    // Without an entity the placeholders read as words: {Area} as Area.
    const plain = (text: string | null) => (text && !entity ? plainPlaceholders(text) : text);
    const texts = [
      plain(step.message),
      plain(step.info ?? null),
      plain(step.data?.type === "custom" ? (step.data.text ?? null) : null),
    ];
    const key = JSON.stringify([texts, entity, draft.id]);
    if (key === this._previewKey) return;
    this._previewKey = key;
    window.clearTimeout(this._previewTimer);
    this._previewTimer = window.setTimeout(async () => {
      try {
        this._preview = await this.hass!.callWS<PreviewText[]>({
          type: `${DOMAIN}/text/preview`,
          texts,
          entity_id: entity,
          notification_id: draft.id ?? null,
        });
      } catch {
        this._preview = [];
      }
    }, 300);
  }

  private _previewView(): NotificationViewData | undefined {
    const draft = this._draft;
    const config = this.config;
    const hass = this.hass;
    if (!draft || !config || !hass) return undefined;
    const step = draft.steps[this._step];
    if (!step) return undefined;
    const category = categoryOf(config, draft as unknown as Notification);
    const entity = listedEntities(hass, draft)[0];
    const card = {
      notification_id: draft.id ?? "",
      step_id: step.id ?? "",
      entity_id: entity ?? null,
      status: "active",
      since: new Date(Date.now() - 5 * 60_000).toISOString(),
      state_since: new Date().toISOString(),
      snoozed_until: null,
      message: null,
      info: null,
      data_text: this._preview[2]?.text ?? null,
    } as CardState;
    const live = {
      card,
      notification: draft as unknown as Notification,
      category,
      step: step as unknown as Notification["steps"][number],
      lastDone: this.state?.notifications[draft.id ?? ""]?.last_done,
    };
    const buttons = liveButtons(live).map((button) => ({
      key: button.key || button.button.type,
      label: button.label,
      icon: button.icon,
      plain: button.plain,
    }));
    const [message, info] = this._preview;
    const icon = draft.icon || category?.icon || undefined;
    return {
      label: draft.name || "New notification",
      data: cardData(hass, live),
      message: (message?.text ?? (isTemplate(step.message) ? "" : plainPlaceholders(step.message))) || "Message",
      info: info?.text ?? step.info ?? undefined,
      icon,
      stateObj: icon || !entity ? undefined : hass.states[entity],
      color: cssColor(draft.card_color ?? category?.card_color),
      buttons,
    };
  }

  // -- Render ----------------------------------------------------------------

  protected override render() {
    const draft = this._draft;
    const title = draft ? draft.name || (this._isNew ? "New notification" : "") : "Notification";
    return html`
      <hass-subpage
        .hass=${this.hass}
        .narrow=${this.narrow}
        .header=${title}
        .backCallback=${() => void this._back()}
      >
        ${draft ? this._renderToolbar(draft) : nothing}
        <div class="content">
          ${this._error ? html`<ha-alert alert-type="error">${this._error}</ha-alert>` : nothing}
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
      ${this._group
        ? html`<nc-group-dialog
            .hass=${this.hass}
            .group=${this._group.group}
            .isNew=${this._group.index < 0}
            .narrow=${this.narrow}
            .slots=${entityActionSlots(this._draft!, this._category())}
            @group-closed=${this._groupClosed}
          ></nc-group-dialog>`
        : nothing}
      ${this._entity ? this._renderEntityDialog() : nothing}
      ${this._member ? this._renderMemberDialog() : nothing}
    `;
  }

  private _renderToolbar(draft: EditorNotification) {
    const status = statusOf(draft, this._isNew ? undefined : this.state?.notifications[draft.id ?? ""]);
    return html`
      <div slot="toolbar-icon" class="toolbar">
        ${renderStatus(status)}
        ${this.narrow
          ? nothing
          : html`<ha-icon-button
                id="undo"
                .label=${"Undo"}
                .disabled=${!this._undo.length}
                @click=${this._undoChange}
              >
                <ha-icon icon="mdi:undo"></ha-icon>
              </ha-icon-button>
              <ha-tooltip for="undo" placement="bottom">Undo (Ctrl+Z)</ha-tooltip>
              <ha-icon-button
                id="redo"
                .label=${"Redo"}
                .disabled=${!this._redo.length}
                @click=${this._redoChange}
              >
                <ha-icon icon="mdi:redo"></ha-icon>
              </ha-icon-button>
              <ha-tooltip for="redo" placement="bottom">Redo (Ctrl+Y)</ha-tooltip>`}
        <ha-switch
          id="enabled"
          .checked=${draft.enabled}
          @change=${(ev: Event) => this._setEnabled((ev.target as HTMLInputElement).checked)}
        ></ha-switch>
        <ha-tooltip for="enabled" placement="bottom">${draft.enabled ? "Enabled" : "Disabled"}</ha-tooltip>
        ${this._renderMenu(draft)}
      </div>
    `;
  }

  private _renderMenu(draft: EditorNotification) {
    const saved = !this._isNew;
    const runnable = saved && !this._dirty && draft.enabled;
    return html`<ha-dropdown @wa-select=${this._menu}>
      <ha-icon-button slot="trigger" .label=${"Menu"}>
        <ha-icon icon="mdi:dots-vertical"></ha-icon>
      </ha-icon-button>
      ${this.narrow
        ? html`<ha-dropdown-item value="undo" .disabled=${!this._undo.length}>
              <ha-icon slot="icon" icon="mdi:undo"></ha-icon>
              Undo
            </ha-dropdown-item>
            <ha-dropdown-item value="redo" .disabled=${!this._redo.length}>
              <ha-icon slot="icon" icon="mdi:redo"></ha-icon>
              Redo
            </ha-dropdown-item>
            <wa-divider></wa-divider>`
        : nothing}
      <ha-dropdown-item value="info" .disabled=${!saved}>
        <ha-icon slot="icon" icon="mdi:information-outline"></ha-icon>
        Information
      </ha-dropdown-item>
      <ha-dropdown-item value="run" .disabled=${!runnable}>
        <ha-icon slot="icon" icon="mdi:play"></ha-icon>
        Run now${draft.steps.length > 1 ? ` (step ${this._step + 1})` : ""}
      </ha-dropdown-item>
      <ha-dropdown-item value="clear" .disabled=${!saved}>
        <ha-icon slot="icon" icon="mdi:notification-clear-all"></ha-icon>
        Clear notifications
      </ha-dropdown-item>
      <ha-dropdown-item value="duplicate" .disabled=${!saved}>
        <ha-icon slot="icon" icon="mdi:content-duplicate"></ha-icon>
        Duplicate
      </ha-dropdown-item>
      ${this._yaml
        ? html`<ha-dropdown-item value="visual" .disabled=${!!this._yaml.error}>
            <ha-icon slot="icon" icon="mdi:list-box-outline"></ha-icon>
            Edit in visual editor
          </ha-dropdown-item>`
        : html`<ha-dropdown-item value="yaml">
            <ha-icon slot="icon" icon="mdi:code-braces"></ha-icon>
            Edit in YAML
          </ha-dropdown-item>`}
      <wa-divider></wa-divider>
      <ha-dropdown-item value="toggle">
        <ha-icon
          slot="icon"
          .icon=${draft.enabled ? "mdi:stop-circle-outline" : "mdi:play-circle-outline"}
        ></ha-icon>
        ${draft.enabled ? "Disable" : "Enable"}
      </ha-dropdown-item>
      <ha-dropdown-item value="delete" variant="danger" .disabled=${!saved}>
        <ha-icon slot="icon" icon="mdi:delete"></ha-icon>
        Delete
      </ha-dropdown-item>
    </ha-dropdown>`;
  }

  private _renderEditor(draft: EditorNotification) {
    const view = this._previewView();
    const count = this.hass ? listedEntities(this.hass, draft).length : 0;
    const preview = view
      ? html`<notification-center-view class="preview" .hass=${this.hass} .view=${view}></notification-center-view>`
      : nothing;
    if (this._yaml) {
      const yaml = this._yaml;
      return html`
        ${preview}
        <ha-card outlined class="yaml">
          ${yaml.error ? html`<ha-alert alert-type="error">${yaml.error}</ha-alert>` : nothing}
          ${keyed(
            yaml.value,
            html`<ha-yaml-editor
              .hass=${this.hass}
              .defaultValue=${yaml.value}
              @value-changed=${this._yamlChanged}
            ></ha-yaml-editor>`,
          )}
        </ha-card>
      `;
    }
    return html`
      ${preview}
      ${this._panel("settings", "mdi:cog-outline", "Settings", undefined, () => this._renderSettings(draft))}
      ${this._panel("entities", "mdi:format-list-checks", "Entities", count, () => this._renderEntities(draft))}
      ${this._renderSteps(draft)}
    `;
  }

  // What the YAML editor shows: the notification as it is saved.
  private _yamlValue(draft: EditorNotification): unknown {
    return toSaved(draft);
  }

  private _yamlChanged(ev: CustomEvent<{ value: unknown; isValid: boolean }>): void {
    ev.stopPropagation();
    const yaml = this._yaml;
    if (!yaml || !this._draft) return;
    const value = ev.detail.value as Partial<EditorNotification> | null;
    const error = !ev.detail.isValid
      ? "This is not valid YAML."
      : !value || typeof value !== "object" || Array.isArray(value)
        ? "The notification has to be a mapping."
        : !Array.isArray(value.steps) || !value.steps.length
          ? "The notification needs at least one step (steps)."
          : value.steps.some((step) => !step || typeof step !== "object" || typeof step.message !== "string")
            ? "Every step needs a message."
            : undefined;
    if (error) {
      this._yaml = { ...yaml, error };
      return;
    }
    const copy = JSON.parse(JSON.stringify(value)) as EditorNotification;
    copy.id = this._draft.id;
    copy.entities ??= [];
    copy.entity_groups ??= [];
    copy.enabled ??= true;
    for (const step of copy.steps) {
      step.buttons ??= [];
      step.activation ??= { type: "triggers", triggers: [] };
      step.activation.triggers ??= [];
    }
    this._set(
      toEditor(
        copy,
        (this.config?.notifications ?? []) as unknown as EditorNotification[],
        this.state?.notifications,
      ),
    );
    this._step = Math.min(this._step, this._draft!.steps.length - 1);
    this._yaml = { value: yaml.value };
  }

  private _panel(
    key: string,
    icon: string,
    header: string,
    count: number | undefined,
    content: () => unknown,
  ) {
    return block({
      icon,
      header,
      count,
      expanded: this._expanded.has(key),
      toggled: (expanded) => this._toggle(key, expanded),
      content: content(),
    });
  }

  private _toggle(key: string, expanded: boolean): void {
    const next = new Set(this._expanded);
    if (expanded) next.add(key);
    else next.delete(key);
    this._expanded = next;
  }

  // -- Settings block ------------------------------------------------------

  private _renderSettings(draft: EditorNotification) {
    const category = categoryOf(this.config!, draft as unknown as Notification);
    return html`<div class="block">
      <div class="row">
        ${this._selector(
          { text: {} },
          draft.name,
          "Name",
          (value) => this._change({ name: (value as string) ?? "" }),
        )}
        ${iconSelect(
          draft.category,
          "Category",
          this.config!.categories.map((item) => ({
            value: item.id,
            label: item.name,
            icon: item.icon || "mdi:shape-outline",
          })),
          (value) => this._changeCategory(value || "general"),
        )}
      </div>
      <div class="row">
        ${this._selector(
          { icon: { placeholder: category?.icon ?? "mdi:bell" } },
          draft.icon ?? "",
          "Icon",
          (value) => this._change({ icon: (value as string) || null }),
        )}
        ${this._selector(
          {
            ui_color: {
              include_none: false,
              default_color: category?.card_color ?? "primary",
            },
          },
          draft.card_color ?? undefined,
          "Card color",
          (value) => this._change({ card_color: (value as string) || null }),
        )}
      </div>
    </div>`;
  }

  private _category() {
    return this._draft ? categoryOf(this.config!, this._draft as unknown as Notification) : undefined;
  }

  // Another category: its buttons are inherited from now on. The old
  // category's own buttons stay as the notification's own; a new
  // notification takes the new category's switches.
  private _changeCategory(value: string): void {
    const draft = JSON.parse(JSON.stringify(this._draft)) as EditorNotification;
    const previous = this._category();
    const next = this.config!.categories.find((item) => item.id === value);
    draft.category = value;
    detachCategoryButtons(draft, previous, next);
    if (this._isNew) applyCategoryDefaults(draft, next);
    this._set(draft);
  }

  private _selector(
    selector: Record<string, unknown>,
    value: unknown,
    label: string,
    changed: (value: unknown) => void,
    options: FieldOptions = {},
  ) {
    return field(this.hass, selector, value, label, changed, options);
  }

  // -- Entities block ------------------------------------------------------

  private _renderEntityText(entityId: string) {
    const { primary, secondary } = entityDisplay(this.hass!, entityId);
    return html`<div class="item-text">
      <div>${primary}</div>
      ${secondary ? html`<div class="secondary">${secondary}</div>` : nothing}
    </div>`;
  }

  private _renderEntities(draft: EditorNotification) {
    const hass = this.hass!;
    return html`<div class="block">
      ${draft.entities.length
        ? html`<ha-card outlined class="list">
            ${draft.entities.map(
              (item, index) => {
                const edit = () =>
                  (this._entity = { index, entityId: item.entity_id, actions: { ...(item.actions ?? {}) } });
                return html`<div class="item clickable" role="button" tabindex="0" @click=${edit}
                  @keydown=${(ev: KeyboardEvent) => ev.key === "Enter" && ev.target === ev.currentTarget && edit()}>
                <ha-switch
                  .checked=${item.enabled}
                  @click=${(ev: Event) => ev.stopPropagation()}
                  @change=${(ev: Event) => {
                    const entities = [...draft.entities];
                    entities[index] = { ...item, enabled: (ev.target as HTMLInputElement).checked };
                    this._change({ entities });
                  }}
                ></ha-switch>
                <ha-state-icon .hass=${hass} .stateObj=${hass.states[item.entity_id]}></ha-state-icon>
                ${this._renderEntityText(item.entity_id)}
                <ha-icon-button .label=${"Edit"}>
                  <ha-icon icon="mdi:pencil"></ha-icon>
                </ha-icon-button>
              </div>`;
              },
            )}
          </ha-card>`
        : nothing}
      ${draft.entity_groups.map((group, index) => this._renderGroup(draft, group, index))}
      <div class="buttons">
        ${this._addingEntity
          ? html`<ha-entity-picker
              class="add-entity"
              .hass=${hass}
              .value=${""}
              .excludeEntities=${draft.entities.map((item) => item.entity_id)}
              @picker-closed=${() => (this._addingEntity = false)}
              @value-changed=${(ev: CustomEvent<{ value?: string }>) => {
                ev.stopPropagation();
                const entityId = ev.detail.value;
                if (entityId) {
                  this._change({
                    entities: [...draft.entities, { entity_id: entityId, enabled: true, actions: {} }],
                  });
                }
                this._addingEntity = false;
              }}
            ></ha-entity-picker>`
          : html`<ha-button appearance="filled" size="s" @click=${this._addEntity}>
              <ha-icon slot="start" icon="mdi:plus"></ha-icon>
              Add entity
            </ha-button>`}
        <ha-button
          appearance="filled"
          size="s"
          @click=${() => (this._group = { index: -1, group: newGroup() })}
        >
          <ha-icon slot="start" icon="mdi:shape-plus-outline"></ha-icon>
          Add entity group
        </ha-button>
      </div>
    </div>`;
  }

  private async _addEntity(): Promise<void> {
    this._addingEntity = true;
    await this.updateComplete;
    // After the click is over, or the picker takes it as a click outside.
    await new Promise((resolve) => window.setTimeout(resolve, 50));
    const picker = this.shadowRoot?.querySelector("ha-entity-picker.add-entity") as
      | (HTMLElement & { open?: () => Promise<void> })
      | null;
    await picker?.open?.();
  }

  private _renderGroup(draft: EditorNotification, group: EntityGroup, index: number) {
    const hass = this.hass!;
    const members = groupMatches(hass, group);
    const active = members.filter((id) => !group.excluded.includes(id)).length;
    const setGroup = (changes: Partial<EntityGroup>) => {
      const groups = [...draft.entity_groups];
      groups[index] = { ...group, ...changes };
      this._change({ entity_groups: groups });
    };
    const edit = () => (this._group = { index, group });
    return html`<ha-card outlined class="list">
      <div
        class="item group clickable"
        role="button"
        tabindex="0"
        @click=${edit}
        @keydown=${(ev: KeyboardEvent) => ev.key === "Enter" && ev.target === ev.currentTarget && edit()}
      >
        <ha-switch
          .checked=${group.enabled}
          @click=${(ev: Event) => ev.stopPropagation()}
          @change=${(ev: Event) => setGroup({ enabled: (ev.target as HTMLInputElement).checked })}
        ></ha-switch>
        <ha-icon icon="mdi:shape-outline"></ha-icon>
        <div class="item-text">
          <div>${groupName(hass, group)}</div>
          ${group.add_new ? nothing : html`<div class="secondary">Fixed list</div>`}
        </div>
        <span class="count">${active}</span>
        <ha-icon-button .label=${"Edit"}>
          <ha-icon icon="mdi:pencil"></ha-icon>
        </ha-icon-button>
      </div>
      ${members.length
        ? members.map(
            (entityId) => html`<div
              class="item member clickable"
              role="button"
              tabindex="0"
              @click=${() => this._openMember(group, index, entityId)}
              @keydown=${(ev: KeyboardEvent) =>
                ev.key === "Enter" && ev.target === ev.currentTarget && this._openMember(group, index, entityId)}
            >
              <ha-switch
                .checked=${!group.excluded.includes(entityId)}
                @click=${(ev: Event) => ev.stopPropagation()}
                @change=${(ev: Event) => {
                  const on = (ev.target as HTMLInputElement).checked;
                  setGroup({
                    excluded: on
                      ? group.excluded.filter((id) => id !== entityId)
                      : [...group.excluded, entityId],
                  });
                }}
              ></ha-switch>
              <ha-state-icon .hass=${hass} .stateObj=${hass.states[entityId]}></ha-state-icon>
              ${this._renderEntityText(entityId)}
              <ha-icon-button .label=${"Edit"}>
                <ha-icon icon="mdi:pencil"></ha-icon>
              </ha-icon-button>
            </div>`,
          )
        : html`<div class="item member secondary">
            No ${domainName(group.domain).toLowerCase()} entities match yet.
          </div>`}
    </ha-card>`;
  }

  private _openMember(group: EntityGroup, groupIndex: number, entityId: string): void {
    this._member = {
      groupIndex,
      entityId,
      custom: structuredClone(group.member_actions?.[entityId] ?? {}),
    };
  }

  // A member of an entity group: its entity actions, each the group's or
  // its own (Custom action).
  private _renderMemberDialog() {
    const edit = this._member!;
    const draft = this._draft!;
    const group = draft.entity_groups[edit.groupIndex];
    const close = () => (this._member = undefined);
    if (!group) return nothing;
    const name = this.hass ? entityDisplay(this.hass, edit.entityId).primary : edit.entityId;
    return html`<ha-dialog
      open
      width="medium"
      header-title=${name}
      @closed=${(ev: Event) => {
        ev.stopPropagation();
        close();
      }}
    >
      <div class="dialog-slots">
        ${renderMemberSlots(this.hass, this.narrow, entityActionSlots(draft, this._category()), group.actions, edit.custom, (custom) => {
          this._member = { ...this._member!, custom };
        })}
      </div>
      <ha-dialog-footer slot="footer">
        <ha-button slot="secondaryAction" appearance="plain" @click=${close}>Cancel</ha-button>
        <ha-button
          slot="primaryAction"
          @click=${() => {
            const groups = [...draft.entity_groups];
            const memberActions = { ...(group.member_actions ?? {}) };
            if (Object.keys(edit.custom).length) memberActions[edit.entityId] = edit.custom;
            else delete memberActions[edit.entityId];
            groups[edit.groupIndex] = { ...group, member_actions: memberActions };
            this._change({ entity_groups: groups });
            close();
          }}
        >
          Save
        </ha-button>
      </ha-dialog-footer>
    </ha-dialog>`;
  }

  private _renderEntityDialog() {
    const edit = this._entity!;
    const draft = this._draft!;
    const close = () => (this._entity = undefined);
    const name = this.hass ? entityDisplay(this.hass, edit.entityId).primary : edit.entityId;
    return html`<ha-dialog
      open
      width="medium"
      header-title=${name}
      @closed=${(ev: Event) => {
        ev.stopPropagation();
        close();
      }}
    >
      <ha-icon-button
        slot="headerActionItems"
        .label=${"Delete"}
        @click=${() => {
          this._change({ entities: draft.entities.filter((_item, i) => i !== edit.index) });
          close();
        }}
      >
        <ha-icon icon="mdi:delete"></ha-icon>
      </ha-icon-button>
      <div class="dialog-slots">
        ${renderActionSlots(this.hass, this.narrow, entityActionSlots(draft, this._category()), edit.actions, (actions) => {
          this._entity = { ...this._entity!, actions };
        })}
      </div>
      <ha-dialog-footer slot="footer">
        <ha-button slot="secondaryAction" appearance="plain" @click=${close}>Cancel</ha-button>
        <ha-button
          slot="primaryAction"
          @click=${() => {
            const entities = [...draft.entities];
            entities[edit.index] = { ...entities[edit.index], actions: edit.actions };
            this._change({ entities });
            close();
          }}
        >
          Save
        </ha-button>
      </ha-dialog-footer>
    </ha-dialog>`;
  }

  private _groupClosed(ev: CustomEvent<{ result?: EntityGroup | "delete" }>): void {
    const edit = this._group;
    this._group = undefined;
    const result = ev.detail.result;
    if (!edit || !result || !this._draft) return;
    const groups = [...this._draft.entity_groups];
    if (result === "delete") {
      groups.splice(edit.index, 1);
    } else if (edit.index < 0) {
      groups.push(result);
    } else {
      // A new filter: the fixed list is made again when it is saved.
      const filterChanged = ["domain", "device_class", "areas", "floors", "labels"].some(
        (key) =>
          JSON.stringify(result[key as keyof EntityGroup]) !==
          JSON.stringify(edit.group[key as keyof EntityGroup]),
      );
      groups[edit.index] = filterChanged || result.add_new ? { ...result, members: null } : result;
    }
    this._change({ entity_groups: groups });
  }

  // -- Steps -----------------------------------------------------------------

  private _stepLabel(step: EditorStep, index: number): string {
    // Placeholders and template variables read as plain words: {Area} and
    // {{ states('sensor.x') }} lose their braces.
    const text = step.message
      .replace(/\{\{-?\s*(.*?)\s*-?\}\}/g, "$1")
      .replace(/\{%-?.*?-?%\}/g, "")
      .replace(/\{(\w+)\}/g, "$1")
      .replace(/\s+/g, " ")
      .trim();
    if (!text) return `Step ${index + 1}`;
    return text.length > 28 ? `${text.slice(0, 27)}…` : text;
  }

  private _renderSteps(draft: EditorNotification) {
    const index = Math.min(this._step, draft.steps.length - 1);
    const step = draft.steps[index];
    const stored = this._storedItem()?.steps.find((item) => item.id === step.id);
    const savedStep =
      !!stored &&
      JSON.stringify((stored as unknown as EditorStep).activation?.schedule ?? null) ===
        JSON.stringify(step.activation.type === "schedule" ? step.activation.schedule : null);
    const expanded = new Set(
      [...this._expanded].filter((key) => key.startsWith("step:")).map((key) => key.slice(5)),
    );
    const count = draft.steps.length;
    // The steps with an active card now: their number is green.
    const live = new Set(
      (this.state?.notifications[draft.id ?? ""]?.cards ?? [])
        .filter((card) => card.status === "active")
        .map((card) => card.step_id),
    );
    // The tabs sit on the page, without a card around the step, like Home
    // Assistant's tabbed pages.
    return html`<div class="steps">
      <div class="tabs">
        <ha-tab-group
          @wa-tab-show=${(ev: CustomEvent<{ name: string }>) => {
            const next = Number(ev.detail.name);
            if (!Number.isNaN(next)) this._step = next;
          }}
        >
          ${draft.steps.map(
            (item, i) => html`<ha-tab-group-tab
              slot="nav"
              panel=${String(i)}
              .active=${i === index}
              class="${item.enabled ? "" : "off"} ${item.id && live.has(item.id) ? "live" : ""}"
            >
              ${count > 1 ? html`<span class="step-number">${i + 1}</span>` : nothing}
              ${this._stepLabel(item, i)}
            </ha-tab-group-tab>`,
          )}
        </ha-tab-group>
        <span class="spacer"></span>
        <ha-button appearance="outlined" size="s" @click=${this._addStep}>
          <ha-icon slot="start" icon="mdi:plus"></ha-icon>
          Add step
        </ha-button>
        <ha-dropdown @wa-select=${(ev: CustomEvent<{ item: { value: string } }>) => this._stepMenu(ev.detail.item.value)}>
          <ha-icon-button slot="trigger" .label=${"Step menu"}>
            <ha-icon icon="mdi:dots-vertical"></ha-icon>
          </ha-icon-button>
          <ha-dropdown-item value="run" .disabled=${this._isNew || this._dirty || !draft.enabled || !step.enabled}>
            <ha-icon slot="icon" icon="mdi:play"></ha-icon>
            Run this step
          </ha-dropdown-item>
          <ha-dropdown-item value="duplicate">
            <ha-icon slot="icon" icon="mdi:content-duplicate"></ha-icon>
            Duplicate step
          </ha-dropdown-item>
          ${index > 0
            ? html`<ha-dropdown-item value="left">
                <ha-icon slot="icon" icon="mdi:arrow-left"></ha-icon>
                Move left
              </ha-dropdown-item>`
            : nothing}
          ${index < count - 1
            ? html`<ha-dropdown-item value="right">
                <ha-icon slot="icon" icon="mdi:arrow-right"></ha-icon>
                Move right
              </ha-dropdown-item>`
            : nothing}
          <wa-divider></wa-divider>
          <ha-dropdown-item value="toggle">
            <ha-icon
              slot="icon"
              .icon=${step.enabled ? "mdi:stop-circle-outline" : "mdi:play-circle-outline"}
            ></ha-icon>
            ${step.enabled ? "Disable step" : "Enable step"}
          </ha-dropdown-item>
          ${count > 1
            ? html`<ha-dropdown-item value="delete" variant="danger">
                <ha-icon slot="icon" icon="mdi:delete"></ha-icon>
                Delete step
              </ha-dropdown-item>`
            : nothing}
        </ha-dropdown>
      </div>
      <div class="step">
        ${step.enabled
          ? nothing
          : html`<ha-alert alert-type="info">
              This step is disabled.
              <ha-button slot="action" appearance="plain" size="s" @click=${() => this._stepMenu("toggle")}>
                Enable
              </ha-button>
            </ha-alert>`}
        <nc-step-editor
          .hass=${this.hass}
          .narrow=${this.narrow}
          .step=${step}
          .notificationId=${draft.id}
          .saved=${savedStep}
          .expanded=${expanded}
          .entities=${this.hass ? listedEntities(this.hass, draft) : []}
          .entityActions=${buttonsWithEntityActions(draft)}
          .category=${this._category()}
          .modes=${this.config?.modes ?? []}
          @value-changed=${(ev: CustomEvent<{ value: EditorStep }>) => {
            ev.stopPropagation();
            this._changeStep(index, ev.detail.value);
          }}
          @block-toggled=${(ev: CustomEvent<{ block: string; expanded: boolean }>) =>
            this._toggle(`step:${ev.detail.block}`, ev.detail.expanded)}
        ></nc-step-editor>
      </div>
    </div>`;
  }

  private _addStep(): void {
    const steps = [...this._draft!.steps, newStep(this._category())];
    this._change({ steps });
    this._step = steps.length - 1;
  }

  private async _stepMenu(action: string): Promise<void> {
    const draft = this._draft!;
    const index = this._step;
    const steps = [...draft.steps];
    const step = steps[index];
    switch (action) {
      case "run":
        await this._run(() => this._call("trigger", { step: index + 1 }));
        return;
      case "duplicate": {
        const copy = JSON.parse(JSON.stringify(step)) as EditorStep;
        delete copy.id;
        // A category's custom button is linked by its id: it keeps it.
        const linked = new Set(
          (this._category()?.buttons ?? []).filter((b) => b.type === "custom").map((b) => b.id),
        );
        copy.buttons = copy.buttons.map((button) =>
          linked.has(button.id) ? { ...button } : { ...button, id: newId() },
        );
        steps.splice(index + 1, 0, copy);
        this._change({ steps });
        this._step = index + 1;
        return;
      }
      case "left":
      case "right": {
        const target = action === "left" ? index - 1 : index + 1;
        [steps[index], steps[target]] = [steps[target], steps[index]];
        this._change({ steps });
        this._step = target;
        return;
      }
      case "toggle":
        steps[index] = { ...step, enabled: !step.enabled };
        this._change({ steps });
        return;
      case "delete":
        if (
          await confirmDialog(this, {
            title: `Delete step ${index + 1}?`,
            text: "Its cards are deleted when the notification is saved.",
            confirm: "Delete",
            destructive: true,
          })
        ) {
          steps.splice(index, 1);
          this._change({ steps });
          this._step = Math.max(0, index - 1);
        }
        return;
    }
  }

  // -- Actions ---------------------------------------------------------------

  private _sensor(): string | undefined {
    return this.state?.notifications[this._draft?.id ?? ""]?.entity_id ?? undefined;
  }

  private async _call(service: string, data: Record<string, unknown> = {}): Promise<void> {
    const entityId = this._sensor();
    if (!entityId) throw new Error("The notification's sensor is not there yet.");
    await this.hass!.callService!(DOMAIN, service, { entity_id: entityId, ...data });
  }

  private async _setEnabled(enabled: boolean): Promise<void> {
    const draft = this._draft!;
    if (this._isNew) {
      this._change({ enabled });
      return;
    }
    await this._run(async () => {
      await this.hass!.callWS({
        type: `${DOMAIN}/notification/set_enabled`,
        notification_id: draft.id,
        enabled,
      });
      // Saved at once: not a change to save.
      this._draft = { ...this._draft!, enabled };
      const original = JSON.parse(this._original) as EditorNotification;
      this._original = JSON.stringify({ ...original, enabled });
    });
  }

  private async _menu(ev: CustomEvent<{ item: { value: string } }>): Promise<void> {
    const draft = this._draft!;
    switch (ev.detail.item.value) {
      case "undo":
        this._undoChange();
        return;
      case "redo":
        this._redoChange();
        return;
      case "yaml":
        this._yaml = { value: this._yamlValue(draft) };
        return;
      case "visual":
        this._yaml = undefined;
        return;
      case "info": {
        const entityId = this._sensor();
        if (entityId) {
          this.dispatchEvent(
            new CustomEvent("hass-more-info", { detail: { entityId }, bubbles: true, composed: true }),
          );
        }
        return;
      }
      case "run":
        await this._run(() => this._call("trigger", { step: this._step + 1 }));
        return;
      case "clear":
        await this._run(async () => {
          for (let number = 1; number <= draft.steps.length; number++) {
            await this._call("clear", { step: number });
          }
        });
        return;
      case "duplicate":
        if (this._dirty && !(await this._confirmLeave())) return;
        await this._run(async () => {
          const copy = await this.hass!.callWS<Notification>({
            type: `${DOMAIN}/notification/duplicate`,
            notification_id: draft.id,
          });
          await this.hass!.callWS({
            type: `${DOMAIN}/notification/set_enabled`,
            notification_id: copy.id,
            enabled: false,
          });
          this._original = JSON.stringify(this._draft);
          navigate(`${this.base}/settings/notifications/${copy.id}`);
        });
        return;
      case "toggle":
        await this._setEnabled(!draft.enabled);
        return;
      case "delete":
        if (
          await confirmDialog(this, {
            title: `Delete ${draft.name}?`,
            text: "The notification, its cards and its sensor are deleted.",
            confirm: "Delete",
            destructive: true,
          })
        ) {
          await this._run(async () => {
            await this.hass!.callWS({
              type: `${DOMAIN}/item/delete`,
              section: "notifications",
              item_id: draft.id,
            });
            this._original = JSON.stringify(this._draft);
            navigate(`${this.base}/settings`);
          });
        }
        return;
    }
  }

  private async _save(): Promise<void> {
    const draft = this._draft;
    if (!draft || !this.hass) return;
    if (!draft.name.trim()) {
      this._error = "The notification needs a name (Settings).";
      this._toggle("settings", true);
      return;
    }
    this._saving = true;
    this._error = undefined;
    try {
      const data = toSaved(draft);
      const item = this._isNew
        ? await this.hass.callWS<Notification>({
            type: `${DOMAIN}/item/create`,
            section: "notifications",
            data,
          })
        : await this.hass.callWS<Notification>({
            type: `${DOMAIN}/item/update`,
            section: "notifications",
            item_id: draft.id,
            data,
          });
      const notifications = [
        ...(this.config?.notifications ?? []).filter((other) => other.id !== item.id),
        item,
      ];
      this._stored = JSON.stringify(item);
      this._draft = toEditor(
        item as unknown as EditorNotification,
        notifications as unknown as EditorNotification[],
        this.state?.notifications,
      );
      this._original = JSON.stringify(this._draft);
      if (this._isNew) {
        this._loadedFor = item.id;
        history.replaceState(history.state, "", `${this.base}/settings/notifications/${item.id}`);
        window.dispatchEvent(new CustomEvent("location-changed", { detail: { replace: true } }));
      }
    } catch (err) {
      this._error = errorText(err);
    } finally {
      this._saving = false;
    }
  }

  private async _confirmLeave(): Promise<boolean> {
    return confirmDialog(this, {
      title: "Leave without saving?",
      text: "The changes of this notification are lost.",
      confirm: "Leave",
      dismiss: "Stay",
      destructive: true,
    });
  }

  private async _back(): Promise<void> {
    if (this._dirty && !(await this._confirmLeave())) return;
    this._original = JSON.stringify(this._draft);
    navigate(`${this.base}/settings`);
  }

  private async _run(task: () => Promise<unknown>): Promise<void> {
    this._error = undefined;
    try {
      await task();
    } catch (err) {
      this._error = errorText(err);
    }
  }

  static override styles = [
    ACTION_SLOT_STYLES,
    css`
    :host {
      display: block;
      height: 100%;
    }
    ha-card.yaml {
      display: flex;
      flex-direction: column;
      gap: 8px;
      padding: 8px 0;
      overflow: hidden;
    }
    ha-card.yaml ha-alert {
      padding: 0 16px;
    }
    .toolbar {
      display: flex;
      align-items: center;
      gap: 4px;
    }
    .toolbar .status {
      margin-inline-end: 8px;
    }
    ha-switch {
      flex: none;
    }
    .toolbar ha-switch {
      margin: 0 8px;
    }
    .content {
      max-width: 1040px;
      margin: 0 auto;
      /* As much room under the header as on the overview. */
      padding: 16px 16px 96px;
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
      gap: 16px;
    }
    .row {
      display: flex;
      gap: 16px;
      flex-wrap: wrap;
    }
    .row > * {
      flex: 1 1 240px;
      min-width: 0;
    }
    .list {
      overflow: hidden;
    }
    .item {
      display: flex;
      align-items: center;
      gap: 12px;
      padding: 4px 4px 4px 16px;
      min-height: 56px;
      box-sizing: border-box;
      border-top: 1px solid var(--divider-color);
    }
    .item:first-child {
      border-top: none;
    }
    .item > ha-icon,
    .item > ha-state-icon {
      color: var(--state-icon-color, var(--secondary-text-color));
      flex: none;
      width: 24px;
    }
    .item.group {
      background-color: rgb(from var(--primary-text-color) r g b / 0.03);
      font-weight: var(--ha-font-weight-medium, 500);
    }
    .item.member {
      font-weight: normal;
    }
    .item.clickable {
      cursor: pointer;
    }
    .item.clickable:hover,
    .item.clickable:focus-visible {
      background-color: var(--secondary-background-color);
      outline: none;
    }
    .count {
      color: var(--secondary-text-color);
      padding: 0 8px;
    }
    .item-text {
      flex: 1;
      min-width: 0;
      overflow: hidden;
    }
    .item-text > div {
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .item-text .secondary {
      font-weight: normal;
    }
    .secondary {
      color: var(--secondary-text-color);
      font-size: var(--ha-font-size-s, 12px);
    }
    .buttons {
      display: flex;
      gap: 8px;
      flex-wrap: wrap;
      align-items: center;
    }
    .spacer {
      flex: 1;
    }
    .tabs > ha-button {
      flex: none;
      white-space: nowrap;
    }
    .icon-select {
      display: block;
    }
    .icon-select ha-picker-field {
      display: block;
      width: 100%;
    }
    .step-number {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      min-width: 20px;
      height: 20px;
      border-radius: 10px;
      margin-inline-end: 8px;
      font-size: var(--ha-font-size-s, 12px);
      color: var(--text-primary-color, #fff);
      background-color: var(--secondary-text-color);
    }
    ha-tab-group-tab[active] .step-number {
      background-color: var(--primary-color);
    }
    /* A step with an active card, like the Active status chip. */
    ha-tab-group-tab.live .step-number {
      background-color: var(--green-color, #4caf50);
    }
    .steps {
      display: block;
    }
    .tabs {
      display: flex;
      align-items: center;
      gap: 4px;
      padding-inline-end: 4px;
      border-bottom: 1px solid var(--divider-color);
    }
    .tabs ha-tab-group {
      flex: 0 1 auto;
      min-width: 0;
    }
    ha-tab-group-tab.off {
      opacity: 0.5;
    }
    .step {
      padding: 16px 0 0;
      display: flex;
      flex-direction: column;
      gap: 12px;
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
    ${unsafeCSS(STATUS_STYLES)}
    ${BLOCK_STYLES}
      .dialog-slots {
      margin-top: 0;
    }
  `,
  ];
}

declare global {
  interface HTMLElementTagNameMap {
    "nc-notification-editor": NcNotificationEditor;
  }
}
