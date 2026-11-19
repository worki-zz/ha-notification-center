// The editor of one notification, laid out like Home Assistant's automation
// editor: the name and status in the header with undo, redo, the Enabled
// switch and the menu; a preview of the selected step's card; the blocks
// Settings, Entities and the steps; Save when something changed.

import { LitElement, css, html, nothing, unsafeCSS, type PropertyValues } from "lit";
import { customElement, property, state } from "lit/decorators.js";

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
import { isTemplate } from "../../shared/text";
import type { HomeAssistant } from "../../shared/types";
import { confirmDialog } from "../confirm";
import { type FieldOptions, field } from "../fields";
import { STATUS_STYLES, renderStatus, statusOf } from "../status";
import { domainName, groupName, newGroup } from "./group-dialog";
import "./block";
import "./group-dialog";
import {
  type EditorNotification,
  type EditorStep,
  type EntityGroup,
  groupMatches,
  listedEntities,
  newNotification,
  newStep,
  toEditor,
  toSaved,
} from "./model";
import "./step-editor";

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

  @state() private _expanded = new Set<string>();

  @state() private _error?: string;

  @state() private _saving = false;

  @state() private _undo: string[] = [];

  @state() private _redo: string[] = [];

  @state() private _preview: PreviewText[] = [];

  @state() private _addingEntity = false;

  @state() private _group?: { index: number; group: EntityGroup };

  @state() private _openGroups = new Set<number>();

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
    if (changed.has("notificationId") && this._loadedFor !== this.notificationId) {
      this._draft = undefined;
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
      this._draft = newNotification();
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
    this._set({ ...this._draft!, ...changes });
  }

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
  }

  private _redoChange(): void {
    const next = this._redo.at(-1);
    if (!next || !this._draft) return;
    this._undo = [...this._undo, JSON.stringify(this._draft)];
    this._redo = this._redo.slice(0, -1);
    this._draft = JSON.parse(next) as EditorNotification;
    this._step = Math.min(this._step, this._draft.steps.length - 1);
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
    const texts = [
      step.message,
      step.info ?? null,
      step.data?.type === "custom" ? (step.data.text ?? null) : null,
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
      message: (message?.text ?? (isTemplate(step.message) ? "" : step.message)) || "Message",
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
            @group-closed=${this._groupClosed}
          ></nc-group-dialog>`
        : nothing}
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
    return html`
      ${view
        ? html`<notification-center-view class="preview" .hass=${this.hass} .view=${view}></notification-center-view>`
        : nothing}
      ${this._panel("settings", "Settings", this._settingsSummary(draft), () => this._renderSettings(draft))}
      ${this._panel("entities", "Entities", this._entitiesSummary(draft), () => this._renderEntities(draft))}
      ${this._renderSteps(draft)}
    `;
  }

  private _panel(key: string, header: string, secondary: string, content: () => unknown) {
    const expanded = this._expanded.has(key);
    return html`<nc-block
      .header=${header}
      .secondary=${secondary}
      .expanded=${expanded}
      @toggled=${(ev: CustomEvent<{ expanded: boolean }>) => this._toggle(key, ev.detail.expanded)}
    >
      ${expanded ? content() : nothing}
    </nc-block>`;
  }

  private _toggle(key: string, expanded: boolean): void {
    const next = new Set(this._expanded);
    if (expanded) next.add(key);
    else next.delete(key);
    this._expanded = next;
  }

  // -- Settings block ------------------------------------------------------

  private _settingsSummary(draft: EditorNotification): string {
    const category = this.config?.categories.find((item) => item.id === draft.category);
    return category?.name ?? draft.category;
  }

  private _renderSettings(draft: EditorNotification) {
    const category = categoryOf(this.config!, draft as unknown as Notification);
    return html`<div class="block">
      <div class="row">
        ${this._selector(
          { text: {} },
          draft.name,
          "Name",
          (value) => this._change({ name: (value as string) ?? "" }),
          { required: true },
        )}
        ${this._selector(
          {
            select: {
              mode: "dropdown",
              options: this.config!.categories.map((item) => ({ value: item.id, label: item.name })),
            },
          },
          draft.category,
          "Category",
          (value) => this._change({ category: (value as string) || "general" }),
          { required: true },
        )}
      </div>
      ${this._selector(
        { icon: { placeholder: category?.icon ?? "mdi:bell" } },
        draft.icon ?? "",
        "Icon",
        (value) => this._change({ icon: (value as string) || null }),
        { helper: `Empty: the category's icon.` },
      )}
      <div class="row">
        ${this._selector(
          { ui_color: { include_none: false } },
          draft.card_color ?? undefined,
          "Card color",
          (value) => this._change({ card_color: (value as string) || null }),
          { helper: `Empty: the category's (${category?.card_color ?? "primary"}).` },
        )}
        <div class="color">
          ${draft.light_color
            ? html`${this._selector(
                  { color_rgb: {} },
                  draft.light_color,
                  "Light color",
                  (value) => this._change({ light_color: (value as number[]) ?? null }),
                )}
                <ha-icon-button
                  .label=${"Use the category's light color"}
                  @click=${() => this._change({ light_color: null })}
                >
                  <ha-icon icon="mdi:close"></ha-icon>
                </ha-icon-button>`
            : html`<div class="unset">
                <div>
                  <div>Light color</div>
                  <div class="secondary">The category's.</div>
                </div>
                <ha-button
                  appearance="plain"
                  size="s"
                  @click=${() => this._change({ light_color: [255, 160, 0] })}
                >
                  Set
                </ha-button>
              </div>`}
        </div>
      </div>
    </div>`;
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

  private _entitiesSummary(draft: EditorNotification): string {
    const count = this.hass ? listedEntities(this.hass, draft).length : 0;
    if (!draft.entities.length && !draft.entity_groups.length) return "None";
    return `${count} ${count === 1 ? "entity" : "entities"}`;
  }

  private _entityName(entityId: string): string {
    const state = this.hass?.states[entityId];
    return (state?.attributes.friendly_name as string | undefined) ?? entityId;
  }

  private _renderEntities(draft: EditorNotification) {
    const hass = this.hass!;
    return html`<div class="block">
      <p class="hint">
        The entities a Listed entities trigger watches. Each gets its own card, and the
        message can name it with the entity parameters.
      </p>
      ${draft.entities.length || draft.entity_groups.length
        ? html`<ha-card outlined class="list">
            ${draft.entities.map(
              (item, index) => html`<div class="item">
                <ha-switch
                  .checked=${item.enabled}
                  @change=${(ev: Event) => {
                    const entities = [...draft.entities];
                    entities[index] = { ...item, enabled: (ev.target as HTMLInputElement).checked };
                    this._change({ entities });
                  }}
                ></ha-switch>
                <ha-state-icon .hass=${hass} .stateObj=${hass.states[item.entity_id]}></ha-state-icon>
                <div class="item-text">
                  <div>${this._entityName(item.entity_id)}</div>
                  <div class="secondary">${item.entity_id}</div>
                </div>
                <ha-icon-button
                  .label=${"Remove"}
                  @click=${() =>
                    this._change({ entities: draft.entities.filter((_item, i) => i !== index) })}
                >
                  <ha-icon icon="mdi:close"></ha-icon>
                </ha-icon-button>
              </div>`,
            )}
            ${draft.entity_groups.map((group, index) => this._renderGroup(draft, group, index))}
          </ha-card>`
        : nothing}
      ${this._addingEntity
        ? html`<ha-selector
            .hass=${hass}
            .selector=${{
              entity: { exclude_entities: draft.entities.map((item) => item.entity_id) },
            }}
            .label=${"Entity"}
            @value-changed=${(ev: CustomEvent<{ value?: string }>) => {
              ev.stopPropagation();
              const entityId = ev.detail.value;
              this._addingEntity = false;
              if (entityId) {
                this._change({
                  entities: [...draft.entities, { entity_id: entityId, enabled: true, actions: {} }],
                });
              }
            }}
          ></ha-selector>`
        : nothing}
      <div class="buttons">
        <ha-button appearance="filled" size="s" @click=${() => (this._addingEntity = true)}>
          <ha-icon slot="start" icon="mdi:plus"></ha-icon>
          Add entity
        </ha-button>
        <ha-button
          appearance="filled"
          size="s"
          @click=${() => (this._group = { index: -1, group: newGroup() })}
        >
          <ha-icon slot="start" icon="mdi:plus"></ha-icon>
          Add entity category
        </ha-button>
      </div>
    </div>`;
  }

  private _renderGroup(draft: EditorNotification, group: EntityGroup, index: number) {
    const hass = this.hass!;
    const members = groupMatches(hass, group);
    const active = members.filter((id) => !group.excluded.includes(id)).length;
    const open = this._openGroups.has(index);
    const setGroup = (changes: Partial<EntityGroup>) => {
      const groups = [...draft.entity_groups];
      groups[index] = { ...group, ...changes };
      this._change({ entity_groups: groups });
    };
    return html`<div class="item group">
        <ha-switch
          .checked=${group.enabled}
          @change=${(ev: Event) => setGroup({ enabled: (ev.target as HTMLInputElement).checked })}
        ></ha-switch>
        <ha-icon icon="mdi:shape-outline"></ha-icon>
        <div class="item-text clickable" @click=${() => this._toggleGroup(index)}>
          <div>${groupName(hass, group)}</div>
          <div class="secondary">
            ${active} ${active === 1 ? "entity" : "entities"}${group.add_new ? "" : " · fixed list"}
          </div>
        </div>
        <ha-icon-button .label=${open ? "Hide the entities" : "Show the entities"} @click=${() => this._toggleGroup(index)}>
          <ha-icon .icon=${open ? "mdi:chevron-up" : "mdi:chevron-down"}></ha-icon>
        </ha-icon-button>
        <ha-icon-button .label=${"Edit"} @click=${() => (this._group = { index, group })}>
          <ha-icon icon="mdi:pencil"></ha-icon>
        </ha-icon-button>
      </div>
      ${open
        ? html`<div class="members">
            ${members.length
              ? members.map(
                  (entityId) => html`<div class="member">
                    <ha-switch
                      .checked=${!group.excluded.includes(entityId)}
                      @change=${(ev: Event) => {
                        const on = (ev.target as HTMLInputElement).checked;
                        setGroup({
                          excluded: on
                            ? group.excluded.filter((id) => id !== entityId)
                            : [...group.excluded, entityId],
                        });
                      }}
                    ></ha-switch>
                    <div class="item-text">
                      <div>${this._entityName(entityId)}</div>
                      <div class="secondary">${entityId}</div>
                    </div>
                  </div>`,
                )
              : html`<div class="secondary empty-group">
                  No ${domainName(group.domain).toLowerCase()} entities match yet.
                </div>`}
          </div>`
        : nothing}`;
  }

  private _toggleGroup(index: number): void {
    const next = new Set(this._openGroups);
    if (next.has(index)) next.delete(index);
    else next.add(index);
    this._openGroups = next;
  }

  private _groupClosed(ev: CustomEvent<{ result?: EntityGroup | "delete" }>): void {
    const edit = this._group;
    this._group = undefined;
    const result = ev.detail.result;
    if (!edit || !result || !this._draft) return;
    const groups = [...this._draft.entity_groups];
    if (result === "delete") {
      groups.splice(edit.index, 1);
      this._openGroups = new Set();
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
    const text = step.message.trim();
    if (!text) return `Step ${index + 1}`;
    return text.length > 28 ? `${text.slice(0, 27)}…` : text;
  }

  private _renderSteps(draft: EditorNotification) {
    const index = Math.min(this._step, draft.steps.length - 1);
    const step = draft.steps[index];
    const stored = this._storedItem()?.steps.find((item) => item.id === step.id);
    const savedStep =
      !!stored &&
      JSON.stringify((stored as unknown as EditorStep).start?.schedule ?? null) ===
        JSON.stringify(step.start.type === "schedule" ? step.start.schedule : null);
    const expanded = new Set(
      [...this._expanded].filter((key) => key.startsWith("step:")).map((key) => key.slice(5)),
    );
    const count = draft.steps.length;
    return html`<ha-card outlined class="steps">
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
              class=${item.enabled ? "" : "off"}
            >
              ${this._stepLabel(item, i)}
            </ha-tab-group-tab>`,
          )}
        </ha-tab-group>
        <ha-button appearance="plain" size="s" @click=${this._addStep}>
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
          : html`<ha-alert alert-type="info">This step is disabled.</ha-alert>`}
        <nc-step-editor
          .hass=${this.hass}
          .narrow=${this.narrow}
          .step=${step}
          .notificationId=${draft.id}
          .saved=${savedStep}
          .expanded=${expanded}
          @value-changed=${(ev: CustomEvent<{ value: EditorStep }>) => {
            ev.stopPropagation();
            this._changeStep(index, ev.detail.value);
          }}
          @block-toggled=${(ev: CustomEvent<{ block: string; expanded: boolean }>) =>
            this._toggle(`step:${ev.detail.block}`, ev.detail.expanded)}
        ></nc-step-editor>
      </div>
    </ha-card>`;
  }

  private _addStep(): void {
    const steps = [...this._draft!.steps, newStep()];
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
        copy.buttons = copy.buttons.map((button) => ({ ...button, id: "" }));
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
      padding: 16px 16px 96px;
      display: flex;
      flex-direction: column;
      gap: 16px;
      box-sizing: border-box;
    }
    .preview {
      max-width: 520px;
      width: 100%;
      margin: 8px auto;
      pointer-events: none;
    }
    .block {
      display: flex;
      flex-direction: column;
      gap: 16px;
      padding: 8px 0 12px;
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
    .color {
      display: flex;
      align-items: flex-start;
      gap: 4px;
    }
    .color ha-selector {
      flex: 1;
    }
    .unset {
      flex: 1;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
      min-height: 56px;
      padding: 0 4px 0 16px;
      border-bottom: 1px solid var(--secondary-text-color);
      background-color: var(--input-fill-color, rgba(127, 127, 127, 0.08));
      border-radius: 4px 4px 0 0;
      color: var(--secondary-text-color);
    }
    .hint {
      margin: 0;
      color: var(--secondary-text-color);
    }
    .list {
      overflow: hidden;
    }
    .item,
    .member {
      display: flex;
      align-items: center;
      gap: 12px;
      padding: 8px 8px 8px 16px;
      min-height: 48px;
      border-top: 1px solid var(--divider-color);
    }
    .item:first-child {
      border-top: none;
    }
    .item > ha-icon,
    .item > ha-state-icon {
      color: var(--state-icon-color, var(--secondary-text-color));
      flex: none;
    }
    .members {
      padding-inline-start: 40px;
    }
    .member {
      border-top: none;
      min-height: 40px;
      padding-top: 4px;
      padding-bottom: 4px;
    }
    .empty-group {
      padding: 8px 16px 12px;
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
    .clickable {
      cursor: pointer;
    }
    .secondary {
      color: var(--secondary-text-color);
      font-size: var(--ha-font-size-s, 12px);
    }
    .buttons {
      display: flex;
      gap: 8px;
      flex-wrap: wrap;
    }
    .steps {
      overflow: hidden;
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
      padding: 16px;
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
  `;
}

declare global {
  interface HTMLElementTagNameMap {
    "nc-notification-editor": NcNotificationEditor;
  }
}
