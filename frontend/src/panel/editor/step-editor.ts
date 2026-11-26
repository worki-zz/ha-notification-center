// One step of a notification: its message, how it starts, when it hides
// and when it is done. Starts, conditions and Done when are Home
// Assistant's own trigger and condition editors.

import { LitElement, html, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";

import { field, restoreButton } from "../fields";
import { PLACEHOLDERS, plainPlaceholders } from "../../shared/text";
import type { HomeAssistant } from "../../shared/types";
import {
  type DataType,
  type EditorStep,
  ENTITIES_NUMERIC,
  ENTITIES_STATE,
  type Expires,
  NOTIFICATION_STATE,
  type Obj,
  PINNED,
  PINNED_STATE,
  entryHasOwn,
  inheritedEntry,
  newId,
  type Schedule,
  type StepData,
  pinnedEntities,
  pinnedFilled,
  pinnedState,
  withOwnSensor,
} from "./model";
import { stateFilled } from "./builtin-forms";
import "./builtin-forms";
import { type EntitiesKind, entitiesFilled } from "./entities-form";
import "./entities-form";
import { defaultSchedule } from "./schedule-editor";
import { BLOCK_INTROS, block, blockTabs, summaryOf } from "./block";
import "./schedule-editor";
import type {
  AudienceEntry,
  AudienceState,
  Button,
  Category,
  CategoryButton,
  ChannelSettings,
  EffectiveButton,
  Mode,
  NotificationCenterConfig,
  StatusActions,
} from "../../shared/config";
import "../audience-table";
import "../channel-table";
import { audienceCount, channelCount, channelsOf } from "../channel-helpers";
import {
  categoryButtons,
  effectiveButtons,
  snoozeChoices,
} from "../../shared/live";
import {
  INTERACTION_DEFAULTS,
  buttonText,
  STATE_BLOCKS,
  type InteractionResult,
  pushButtonsWarning,
  runChoicesOf,
  runText,
} from "./interaction-dialog";
import "./interaction-dialog";
import { conditionTestHass } from "./condition-test";
import { HELP, type StartKind } from "./step-editor.help";
import { STEP_EDITOR_STYLES } from "./step-editor.styles";

// The Data field: empty is nothing; the time of the notification, an
// entity's state (or attribute, last changed, last updated), or a template.
type DataKind = "notification" | "entity" | "custom";

const KIND_OPTIONS: { value: DataKind; label: string }[] = [
  { value: "notification", label: "Notification" },
  { value: "entity", label: "Entity state" },
  { value: "custom", label: "Custom" },
];

const NOTIFICATION_OPTIONS: { value: DataType; label: string }[] = [
  { value: "active_since", label: "Active since" },
  { value: "last_done", label: "Last done" },
];

// Attribute values for the times of the entity, apart from its attributes.
const STATE = "__state";
const LAST_CHANGED = "__last_changed";
const LAST_UPDATED = "__last_updated";

// Attributes that are not worth showing on a card.
const HIDDEN_ATTRIBUTES = [
  "friendly_name",
  "icon",
  "entity_picture",
  "supported_features",
  "attribution",
];

const TIME_TYPES: DataType[] = [
  "active_since",
  "last_done",
  "last_changed",
  "last_updated",
];

function kindOf(type: DataType): DataKind | "" {
  if (type === "none") return "";
  if (type === "custom") return "custom";
  if (["active_since", "last_done"].includes(type)) return "notification";
  return "entity";
}

const FORMATS = [
  { value: "relative", label: "Relative (5 minutes ago)" },
  { value: "duration", label: "Duration (5 minutes)" },
  { value: "time", label: "Time" },
  { value: "date", label: "Date" },
  { value: "datetime", label: "Date and time" },
];

export const STEP_BLOCKS = [
  "message",
  "interactions",
  "start",
  "done",
  "dismiss",
  "snooze",
  "mute",
  "audience",
  "channels",
] as const;
export type StepBlock = (typeof STEP_BLOCKS)[number];

// The status blocks after Activation, and their keys in the step.
type WhenBlock = "done" | "dismiss" | "snooze" | "mute";
const WHEN_KEYS = {
  done: "done_when",
  dismiss: "dismiss_when",
  snooze: "snooze_when",
  mute: "mute_when",
} as const;

// A tab of a status block, with the word of its summary part.
type BlockTab = { key: string; label: string; count?: number; unit: string };

function actionCount(actions: StatusActions | undefined): number {
  return (actions?.entity_action ? 1 : 0) + (actions?.ha_actions.length ?? 0);
}

// The step's status blocks, as a button's Run … actions switch tells of them.
function blocksOf(step: EditorStep) {
  return Object.fromEntries(
    Object.entries(STATE_BLOCKS).map(([type, block]) => {
      const value = step[block.key] as { enabled?: boolean; actions: StatusActions };
      return [type, { enabled: value.enabled ?? true, actions: actionCount(value.actions) }];
    }),
  );
}

@customElement("nc-step-editor")
export class NcStepEditor extends LitElement {
  @property({ attribute: false }) public hass?: HomeAssistant;

  @property({ type: Boolean }) public narrow = false;

  @property({ attribute: false }) public step?: EditorStep;

  @property() public notificationId?: string;

  // Which step this is (from 0) and how many the notification has: steps
  // 2 and later have the Notification state rows.
  @property({ type: Number }) public stepIndex = 0;

  @property({ type: Number }) public stepCount = 1;

  // The step is stored as it is (Next of a Repeat can be set).
  @property({ type: Boolean }) public saved = false;

  @property({ attribute: false }) public expanded: Set<string> = new Set();

  // The entities of the notification's Entities block, switched on.
  @property({ attribute: false }) public entities: string[] = [];

  // The buttons some entity or entity group has an action for.
  @property({ attribute: false }) public entityActions: Set<string> = new Set();

  // The notification's category: its buttons are inherited.
  @property({ attribute: false }) public category?: Category;

  // The modes, for the Channels table.
  @property({ attribute: false }) public modes: Mode[] = [];

  // The configuration (the device channels) and the notification being
  // edited (the Test button uses its colour and highlight).
  @property({ attribute: false }) public config?: NotificationCenterConfig;

  @property({ attribute: false }) public notification?: Record<string, unknown>;

  // The people with a sleep condition (the Audience's Sleep ticks).
  @property({ attribute: false }) public sleepers: string[] = [];

  // The notification's sensor: the conditions' Test checks it.
  @property() public sensor?: string;

  // The home mode and the person states now: the tables mark them.
  @property({ attribute: false }) public liveMode?: string | null;

  @property({ attribute: false }) public livePeople?: Record<string, AudienceState>;

  // The interaction whose dialog is open: the step's own entry for it, the
  // category's button it inherits from, and whether it is a new own button.
  @state() private _interaction?: {
    button: Button;
    inherited?: CategoryButton;
    isNew: boolean;
  };

  @state() private _help?: keyof typeof HELP;

  // The open tab of each status block.
  @state() private _tabs: Record<string, string> = {};

  // The built-in rows that are open (by key).
  @state() private _openRows: Set<string> = new Set();

  // The text field the entity parameters go into.
  private _field: "message" | "info" = "message";

  private _emit(step: EditorStep): void {
    this.dispatchEvent(
      new CustomEvent("value-changed", { detail: { value: step } }),
    );
  }

  private _change(changes: Partial<EditorStep>): void {
    this._emit({ ...this.step!, ...changes });
  }

  private _panel(
    key: StepBlock,
    icon: string,
    header: string,
    count: number | string | undefined,
    content: unknown,
    more: { summary?: string; filled?: boolean } = {},
  ) {
    return block({
      icon,
      header,
      count,
      ...more,
      intro: BLOCK_INTROS[key],
      expanded: this.expanded.has(key),
      toggled: (expanded) =>
        this.dispatchEvent(
          new CustomEvent("block-toggled", {
            detail: { block: key, expanded },
          }),
        ),
      content,
    });
  }

  protected override render() {
    const step = this.step;
    if (!step) return nothing;
    const kind = this._kind(step);
    const status = (key: StepBlock, icon: string, header: string, tabs: BlockTab[], content: unknown) =>
      this._panel(key, icon, header, undefined, content, {
        summary: summaryOf(tabs.map((tab) => [tab.count ?? 0, tab.unit])),
        filled: tabs.some((tab) => tab.count),
      });
    const startTabs = this._startTabs(step);
    const doneTabs = this._whenTabs(step, "done");
    const dismissTabs = this._whenTabs(step, "dismiss");
    const snoozeTabs = this._whenTabs(step, "snooze");
    const muteTabs = this._whenTabs(step, "mute");
    return html`
      ${this._panel(
        "message",
        "mdi:message-text-outline",
        "Message",
        undefined,
        this._renderMessage(step),
        { filled: !!step.message.trim() },
      )}
      ${this._panel(
        "interactions",
        "mdi:gesture-tap-button",
        "Interactions",
        effectiveButtons(this.category, step).filter((button) => button.enabled)
          .length,
        this._renderInteractions(step),
      )}
      <div class="group-gap"></div>
      ${this._panel(
        "start",
        "mdi:play-circle-outline",
        "Activation",
        undefined,
        this._renderTabs("start", startTabs, step),
        {
          summary: [
            kind === "triggers" ? "" : kind === "repeat" ? "Repeat" : "Schedule",
            summaryOf(startTabs.map((tab) => [tab.count ?? 0, tab.unit])),
          ]
            .filter(Boolean)
            .join(" · "),
          filled: kind !== "triggers" || startTabs.some((tab) => tab.count),
        },
      )}
      ${status("done", "mdi:check-circle-outline", "Done when", doneTabs, this._renderTabs("done", doneTabs, step))}
      ${status(
        "dismiss",
        "mdi:close-circle-outline",
        "Dismiss when",
        dismissTabs,
        this._renderTabs("dismiss", dismissTabs, step),
      )}
      ${step.snooze_when.enabled
        ? status(
            "snooze",
            "mdi:alarm-snooze",
            "Snooze when",
            snoozeTabs,
            this._renderTabs("snooze", snoozeTabs, step),
          )
        : nothing}
      ${step.mute_when.enabled
        ? status("mute", "mdi:volume-off", "Mute when", muteTabs, this._renderTabs("mute", muteTabs, step))
        : nothing}
      <div class="group-gap"></div>
      ${this._panel(
        "channels",
        "mdi:broadcast",
        "Channels",
        channelCount(channelsOf(this.hass, this.config), this.category?.channels, step.channels),
        this._renderChannels(step),
      )}
      ${this._panel(
        "audience",
        "mdi:account-multiple",
        "Audience",
        audienceCount(
          this.hass,
          this.category?.audience,
          step.audience,
          this.sleepers,
        ),
        this._renderAudience(step),
      )}
      ${this._help ? this._renderHelp(this._help) : nothing}
      ${this._interaction ? this._renderInteractionDialog(step) : nothing}
    `;
  }

  // -- Status blocks: their tabs --------------------------------------------

  private _startTabs(step: EditorStep): BlockTab[] {
    const kind = this._kind(step);
    const stateCondition = pinnedState(step.conditions.conditions);
    return [
      {
        key: "triggers",
        label: kind === "triggers" ? "Triggers" : kind === "repeat" ? "Repeat" : "Schedule",
        count: kind === "triggers" ? this._startCount(step) : undefined,
        unit: "trigger",
      },
      {
        key: "conditions",
        label: "Conditions",
        count:
          step.conditions.conditions.length -
          (stateCondition && !stateFilled(stateCondition.options as Obj) ? 1 : 0),
        unit: "condition",
      },
      { key: "actions", label: "Actions", count: actionCount(step.activation.actions), unit: "action" },
    ];
  }

  private _whenTabs(step: EditorStep, key: WhenBlock): BlockTab[] {
    const value = step[WHEN_KEYS[key]];
    let triggers = value.triggers.length;
    if (key === "done" || key === "dismiss") {
      const when = value as EditorStep["done_when"];
      triggers += when.expires ? 1 : 0;
      if (key === "done" && when.activation_conditions_no_longer_true && this._startCanEnd(step)) triggers += 1;
    }
    return [
      { key: "triggers", label: "Triggers", count: triggers, unit: "trigger" },
      { key: "actions", label: "Actions", count: actionCount(value.actions), unit: "action" },
    ];
  }

  private _renderTabs(key: "start" | WhenBlock, tabs: BlockTab[], step: EditorStep) {
    const active = this._tabs[key] ?? "triggers";
    let content: unknown;
    if (active === "actions") content = this._renderStatusActions(step, key);
    else if (key === "start") content = active === "conditions" ? this._renderShow(step) : this._renderStart(step);
    else if (key === "done") content = this._renderDone(step);
    else if (key === "dismiss") content = this._renderDismiss(step);
    else content = this._renderWhenTriggers(step, key);
    return html`${blockTabs(tabs, active, (tab) => (this._tabs = { ...this._tabs, [key]: tab }))}
      ${content}`;
  }

  // The Actions tab of a status block: they run when a card reaches its
  // status, whatever caused it.
  private _renderStatusActions(step: EditorStep, key: "start" | WhenBlock) {
    const value = key === "start" ? step.activation : step[WHEN_KEYS[key]];
    const actions = value.actions;
    const set = (changes: Partial<StatusActions>) => {
      const next = { ...actions, ...changes };
      if (key === "start") this._change({ activation: { ...step.activation, actions: next } });
      else this._change({ [WHEN_KEYS[key]]: { ...value, actions: next } });
    };
    const snooze = key === "snooze";
    return html`<div class="block">
      ${snooze
        ? html`<ha-card outlined class="own-row">
            <ha-icon
              class="builtin ${step.snooze_when.rerun_activation ? "" : "off"}"
              icon="mdi:play-circle-outline"
            ></ha-icon>
            <div class="own-text">Run the Activation actions again when the snooze ends</div>
            <ha-switch
              .checked=${step.snooze_when.rerun_activation}
              @change=${(ev: Event) =>
                this._change({
                  snooze_when: {
                    ...step.snooze_when,
                    rerun_activation: (ev.target as HTMLInputElement).checked,
                  },
                })}
            ></ha-switch>
          </ha-card>`
        : nothing}
      <ha-card outlined class="own-row">
        <ha-icon
          class="builtin ${actions.entity_action ? "" : "off"}"
          icon="mdi:format-list-checks"
        ></ha-icon>
        <div class="own-text">
          <div>Run the entity action</div>
          <div class="secondary">Set the action for each entity in the Entities block.</div>
        </div>
        <ha-switch
          .checked=${actions.entity_action}
          @change=${(ev: Event) => set({ entity_action: (ev.target as HTMLInputElement).checked })}
        ></ha-switch>
      </ha-card>
      ${this._title("Actions", "actions")}
      <ha-automation-action
        .hass=${this.hass}
        .narrow=${this.narrow}
        .actions=${actions.ha_actions}
        @value-changed=${(ev: CustomEvent<{ value: unknown[] }>) => {
          ev.stopPropagation();
          set({ ha_actions: ev.detail.value });
        }}
      ></ha-automation-action>
    </div>`;
  }

  // The Triggers tab of Snooze when and Mute when.
  private _renderWhenTriggers(step: EditorStep, key: "snooze" | "mute") {
    const field = WHEN_KEYS[key];
    const value = step[field];
    return html`<div class="block">
      ${this._title("Triggers", key)}
      <ha-automation-trigger
        .hass=${this.hass}
        .narrow=${this.narrow}
        .triggers=${value.triggers}
        @value-changed=${(ev: CustomEvent<{ value: Obj[] }>) => {
          ev.stopPropagation();
          this._change({
            [field]: { ...value, triggers: withOwnSensor(value.triggers, ev.detail.value, this.sensor) },
          });
        }}
      ></ha-automation-trigger>
    </div>`;
  }

  private _startCount(step: EditorStep): number {
    const triggers = step.activation.triggers ?? [];
    const pinned = pinnedEntities(step);
    const state = pinnedState(triggers);
    return (
      triggers.length -
      (pinned && !entitiesFilled(pinned.kind, pinned.options) ? 1 : 0) -
      (state && !stateFilled(state.options as Obj) ? 1 : 0)
    );
  }

  private _kind(step: EditorStep): StartKind {
    if (step.activation.type === "triggers") return "triggers";
    return step.activation.schedule?.type === "after_last_done"
      ? "repeat"
      : "schedule";
  }

  // -- Message -------------------------------------------------------------

  private _renderMessage(step: EditorStep) {
    const data = step.data ?? { type: "none" };
    return html`<div class="block">
      ${this._text("message", "Message", step.message, (value) =>
        this._change({ message: value }),
      )}
      <div class="chips">
        ${PLACEHOLDERS.filter(
          (name) =>
            name !== "Floor" || Object.keys(this.hass?.floors ?? {}).length > 0,
        ).map(
          (name) =>
            html`<button
              class="param"
              type="button"
              @mousedown=${(ev: Event) => ev.preventDefault()}
              @click=${() => this._insert(`{${name}}`)}
            >
              {${name}}
            </button>`,
        )}
      </div>
      ${data.type === "none"
        ? html`<div class="row data">
            ${this._text("info", "Info", step.info ?? "", (value) =>
              this._change({ info: value || null }),
            )}
            ${this._renderData(data)}
          </div>`
        : html`${this._text("info", "Info", step.info ?? "", (value) =>
              this._change({ info: value || null }),
            )}
            <div class="row data">${this._renderData(data)}</div>`}
    </div>`;
  }

  private _renderData(data: StepData) {
    const kind = kindOf(data.type);
    const format = TIME_TYPES.includes(data.type)
      ? this._selector(
          { select: { mode: "dropdown", options: FORMATS } },
          data.format ?? "relative",
          "Format",
          (value) =>
            this._dataChanged({
              format: (value as StepData["format"]) ?? null,
            }),
        )
      : nothing;
    return html`
      ${this._selector(
        { select: { mode: "dropdown", options: KIND_OPTIONS } },
        kind,
        "Data",
        (value) => {
          const next = (value as DataKind | undefined) ?? "";
          if (next === kind) return;
          this._dataChanged({
            type:
              next === "notification"
                ? "active_since"
                : next === "entity"
                  ? "state"
                  : next || "none",
            entity_id: null,
            attribute: null,
          });
        },
        "data-type",
        true,
      )}
      ${kind === "notification"
        ? html`${this._selector(
            { select: { mode: "dropdown", options: NOTIFICATION_OPTIONS } },
            data.type,
            "Time",
            (value) =>
              this._dataChanged({
                type: (value as DataType) || "active_since",
              }),
          )}${format}`
        : nothing}
      ${kind === "entity"
        ? html`<ha-entity-picker
              class="data-entity"
              .hass=${this.hass}
              .value=${data.entity_id ?? ""}
              .placeholder=${"Active entity"}
              @value-changed=${(ev: CustomEvent<{ value?: string }>) => {
                ev.stopPropagation();
                this._dataChanged({ entity_id: ev.detail.value || null });
              }}
            ></ha-entity-picker
            >${this._renderAttribute(data)}${format}`
        : nothing}
      ${kind === "custom"
        ? this._selector({ text: {} }, data.text ?? "", "Template", (value) =>
            this._dataChanged({ text: (value as string) || null }),
          )
        : nothing}
    `;
  }

  private _text(
    name: "message" | "info",
    label: string,
    value: string,
    changed: (value: string) => void,
  ) {
    return html`<ha-selector
      class=${name}
      .hass=${this.hass}
      .selector=${{ text: {} }}
      .value=${value}
      .label=${label}
      .required=${false}
      @focusin=${() => (this._field = name)}
      @value-changed=${(ev: CustomEvent<{ value?: string }>) => {
        ev.stopPropagation();
        changed(ev.detail.value ?? "");
      }}
    ></ha-selector>`;
  }

  // State by default. The entity is the card's own unless one is chosen.
  private _renderAttribute(data: StepData) {
    const hass = this.hass!;
    const entityId = data.entity_id ?? this.entities[0];
    const stateObj = entityId ? hass.states[entityId] : undefined;
    const names = stateObj
      ? Object.keys(stateObj.attributes).filter(
          (name) => !HIDDEN_ATTRIBUTES.includes(name),
        )
      : [];
    if (data.attribute && !names.includes(data.attribute))
      names.push(data.attribute);
    const options = [
      { value: STATE, label: "State" },
      ...names.map((name) => ({
        value: name,
        label:
          stateObj && hass.formatEntityAttributeName
            ? hass.formatEntityAttributeName(stateObj, name)
            : name,
      })),
      { value: LAST_CHANGED, label: "Last changed" },
      { value: LAST_UPDATED, label: "Last updated" },
    ];
    const value =
      data.type === "last_changed"
        ? LAST_CHANGED
        : data.type === "last_updated"
          ? LAST_UPDATED
          : (data.attribute ?? STATE);
    return this._selector(
      { select: { mode: "dropdown", options } },
      value,
      "Attribute",
      (picked) => {
        const name = (picked as string | undefined) ?? STATE;
        if (name === LAST_CHANGED)
          this._dataChanged({ type: "last_changed", attribute: null });
        else if (name === LAST_UPDATED)
          this._dataChanged({ type: "last_updated", attribute: null });
        else if (name !== STATE)
          this._dataChanged({ type: "attribute", attribute: name });
        else this._dataChanged({ type: "state", attribute: null });
      },
    );
  }

  private _dataChanged(changes: Partial<StepData>): void {
    const data: StepData = {
      ...(this.step!.data ?? { type: "none" }),
      ...changes,
    };
    const clean: StepData = { type: data.type };
    if (TIME_TYPES.includes(data.type) && data.format)
      clean.format = data.format;
    if (kindOf(data.type) === "entity" && data.entity_id)
      clean.entity_id = data.entity_id;
    if (data.type === "attribute" && data.attribute)
      clean.attribute = data.attribute;
    if (data.type === "attribute" && !data.attribute) clean.type = "state";
    if (data.type === "custom" && data.text) clean.text = data.text;
    this._change({ data: data.type === "none" ? null : clean });
  }

  private _insert(token: string): void {
    const field = this._field;
    const host = this.renderRoot.querySelector(`ha-selector.${field}`);
    const input = host ? deepInput(host) : undefined;
    const current =
      (field === "message" ? this.step!.message : this.step!.info) ?? "";
    let next = `${current}${token}`;
    let cursor = next.length;
    if (input && input.selectionStart !== null && input.value === current) {
      const start = input.selectionStart;
      const end = input.selectionEnd ?? start;
      next = current.slice(0, start) + token + current.slice(end);
      cursor = start + token.length;
    }
    this._change(field === "message" ? { message: next } : { info: next });
    if (input) {
      void this.updateComplete.then(() => {
        window.setTimeout(() => {
          input.focus();
          input.setSelectionRange(cursor, cursor);
        }, 50);
      });
    }
  }

  private _selector(
    selector: Record<string, unknown>,
    value: unknown,
    label: string,
    changed: (value: unknown) => void,
    className?: string,
    clearable = false,
  ) {
    return field(this.hass, selector, value, label, changed, {
      className,
      clearable,
    });
  }

  // -- Start -----------------------------------------------------------------

  private _renderStart(step: EditorStep) {
    const kind = this._kind(step);
    return html`<div class="block">
      <ha-button-toggle-group
        size="s"
        .buttons=${[
          { label: "Triggers", value: "triggers" },
          { label: "Schedule", value: "schedule" },
          { label: "Repeat", value: "repeat" },
        ]}
        .active=${kind}
        @value-changed=${(ev: CustomEvent<{ value: StartKind }>) => {
          ev.stopPropagation();
          this._kindChanged(ev.detail.value);
        }}
      ></ha-button-toggle-group>
      ${kind === "triggers" ? this._renderPinned(step) : nothing}
      ${kind === "triggers" ? this._renderStateTrigger(step) : nothing}
      ${this._title(HELP[kind].title, kind)}
      ${kind === "triggers"
        ? html`<ha-automation-trigger
            .hass=${this.hass}
            .narrow=${this.narrow}
            .triggers=${this._listTriggers(step)}
            @value-changed=${(ev: CustomEvent<{ value: Obj[] }>) => {
              ev.stopPropagation();
              this._setTriggers(step, {
                rest: withOwnSensor(this._listTriggers(step), ev.detail.value, this.sensor),
              });
            }}
          ></ha-automation-trigger>`
        : html`<nc-schedule-editor
            .hass=${this.hass}
            .schedule=${step.activation.schedule}
            .notificationId=${this.notificationId}
            .stepId=${step.id}
            .saved=${this.saved}
            @value-changed=${(ev: CustomEvent<{ value: Schedule }>) => {
              ev.stopPropagation();
              this._change({
                activation: { ...step.activation, schedule: ev.detail.value },
              });
            }}
          ></nc-schedule-editor>`}
    </div>`;
  }

  // The triggers of the list: all but the built-in rows at the top.
  private _listTriggers(step: EditorStep): Obj[] {
    const triggers = step.activation.triggers ?? [];
    return triggers.filter((item) => !item[PINNED] && !item[PINNED_STATE]);
  }

  // The triggers in their stored order: Notification entities, Notification
  // state, then the list. A part not given stays as it is.
  private _setTriggers(
    step: EditorStep,
    parts: { entities?: Obj; state?: Obj; rest?: Obj[] },
  ): void {
    const entities = parts.entities ?? pinnedEntities(step)?.item;
    const state = parts.state ?? pinnedState(step.activation.triggers);
    const rest = parts.rest ?? this._listTriggers(step);
    const triggers = [entities, state, ...rest].filter((item): item is Obj => !!item);
    this._change({ activation: { ...step.activation, triggers } });
  }

  // A built-in row: in a card, as Home Assistant's trigger rows, so it has
  // their background; it opens and closes like one, closed at first.
  private _builtinRow(key: string, icon: string, title: string, filled: boolean, content: unknown) {
    return html`<ha-card outlined class="pinned-card"
      ><ha-expansion-panel
        class="pinned"
        .expanded=${this._openRows.has(key)}
        @expanded-changed=${(ev: CustomEvent<{ expanded: boolean }>) => {
          ev.stopPropagation();
          if (ev.target !== ev.currentTarget) return;
          const open = new Set(this._openRows);
          if (ev.detail.expanded) open.add(key);
          else open.delete(key);
          this._openRows = open;
        }}
        @expanded-will-change=${(ev: Event) => ev.stopPropagation()}
      >
        <ha-icon slot="leading-icon" class="builtin ${filled ? "" : "off"}" .icon=${icon}></ha-icon>
        <div slot="header" class="pinned-title">
          ${title}
          <span class="pinned-state">· ${filled ? "Set" : "Not in use"}</span>
        </div>
        <div class="pinned-content">${content}</div>
      </ha-expansion-panel></ha-card
    >`;
  }

  // Notification state at the top of Activation (or Conditions) on steps 2
  // and later: a state of a step of this notification, the previous one at
  // first. It is the first trigger (after Notification entities) or the
  // first condition.
  private _stateRow(key: "trigger" | "condition", items: Obj[], changed: (item: Obj) => void) {
    if (this.stepIndex < 1) return nothing;
    const item = pinnedState(items);
    const options = (item?.options as Obj | undefined) ?? {};
    return this._builtinRow(
      `state-${key}`,
      "mdi:message-badge-outline",
      "Notification state",
      stateFilled(options),
      html`<nc-state-form
        .hass=${this.hass}
        .value=${options}
        .stepIndex=${this.stepIndex}
        .stepCount=${this.stepCount}
        .condition=${key === "condition"}
        @value-changed=${(ev: CustomEvent<{ value: Obj }>) => {
          ev.stopPropagation();
          changed({ [key]: NOTIFICATION_STATE, options: ev.detail.value, [PINNED_STATE]: true });
        }}
      ></nc-state-form>`,
    );
  }

  private _renderStateTrigger(step: EditorStep) {
    return this._stateRow("trigger", step.activation.triggers ?? [], (item) =>
      this._setTriggers(step, { state: item }),
    );
  }

  // Expiration at the top of Done when and Dismiss when.
  private _expiresRow(key: "done" | "dismiss", value: Expires | null | undefined, changed: (value: Expires | null) => void) {
    return this._builtinRow(
      `expires-${key}`,
      "mdi:timer-sand",
      "Expiration",
      !!value,
      html`<nc-expires-form
        .hass=${this.hass}
        .value=${value ?? null}
        @value-changed=${(ev: CustomEvent<{ value: Expires | null }>) => {
          ev.stopPropagation();
          changed(ev.detail.value);
        }}
      ></nc-expires-form>`,
    );
  }

  // Notification entities at the top of Start, when the notification lists
  // entities: it edits the first trigger, on this notification's entities.
  // It opens and closes like a trigger row, closed at first.
  private _renderPinned(step: EditorStep) {
    const pinned = pinnedEntities(step);
    if (!pinned && !this.entities.length) return nothing;
    // Left empty, Numeric state when every listed entity has a number.
    const kind: EntitiesKind =
      pinned?.kind ?? (this._allNumeric() ? "numeric" : "state");
    const options = pinned?.options ?? {};
    return this._builtinRow(
      "entities",
      "mdi:format-list-checks",
      "Notification entities",
      pinnedFilled(step),
      html`<nc-entities-form
        kind-switch
        .hass=${this.hass}
        .kind=${kind}
        .value=${options}
        .entities=${this.entities}
        @kind-changed=${(ev: CustomEvent<{ value: EntitiesKind }>) => {
          ev.stopPropagation();
          // Every field stays, so switching back brings them again.
          this._pinnedChanged(step, ev.detail.value, options);
        }}
        @value-changed=${(ev: CustomEvent<{ value: Obj }>) => {
          ev.stopPropagation();
          this._pinnedChanged(step, kind, ev.detail.value);
        }}
      ></nc-entities-form>`,
    );
  }

  private _allNumeric(): boolean {
    const states = this.entities.map((entityId) => this.hass?.states[entityId]);
    return (
      states.length > 0 &&
      states.every(
        (entity) =>
          !!entity &&
          (entity.attributes.unit_of_measurement !== undefined ||
            entity.attributes.state_class !== undefined ||
            (entity.state.trim() !== "" &&
              !Number.isNaN(Number(entity.state)))),
      )
    );
  }

  private _pinnedChanged(
    step: EditorStep,
    kind: EntitiesKind,
    options: Obj,
  ): void {
    const item: Obj = {
      trigger: kind === "numeric" ? ENTITIES_NUMERIC : ENTITIES_STATE,
      options,
      [PINNED]: true,
    };
    this._setTriggers(step, { entities: item });
  }

  private _kindChanged(kind: StartKind): void {
    const step = this.step!;
    if (kind === this._kind(step)) return;
    if (kind === "triggers") {
      this._change({
        activation: {
          ...step.activation,
          type: "triggers",
          triggers: step.activation.triggers ?? [],
        },
      });
      return;
    }
    const type: Schedule["type"] =
      kind === "schedule" ? "calendar" : "after_last_done";
    this._change({
      activation: {
        ...step.activation,
        type: "schedule",
        schedule: defaultSchedule(type, step.activation.schedule),
      },
    });
  }

  private _title(title: string, help: keyof typeof HELP) {
    return html`<div class="title">
      <span>${title}</span>
      <ha-icon-button
        .label=${`About ${title}`}
        @click=${() => (this._help = help)}
      >
        <ha-icon icon="mdi:information-outline"></ha-icon>
      </ha-icon-button>
    </div>`;
  }

  // -- Conditions and Done when -----------------------------------------

  private _renderShow(step: EditorStep) {
    const show = step.conditions;
    const toggle =
      (key: "activate_only_while_met" | "hide_while_not_met") => (ev: Event) =>
        this._change({
          conditions: {
            ...show,
            [key]: (ev.target as HTMLInputElement).checked,
          },
        });
    return html`<div class="block">
      <div class="show-switches">
        <ha-card outlined class="own-row">
          <ha-icon class="builtin ${show.activate_only_while_met ? "" : "off"}" icon="mdi:play-circle-outline"></ha-icon>
          <div class="own-text">Activate only while conditions are met</div>
          <ha-switch
            .checked=${show.activate_only_while_met}
            @change=${toggle("activate_only_while_met")}
          ></ha-switch>
        </ha-card>
        <ha-card outlined class="own-row">
          <ha-icon class="builtin ${show.hide_while_not_met ? "" : "off"}" icon="mdi:eye-off-outline"></ha-icon>
          <div class="own-text">
            Hide while conditions are not met
          </div>
          <ha-switch
            .checked=${show.hide_while_not_met}
            @change=${toggle("hide_while_not_met")}
          ></ha-switch>
        </ha-card>
      </div>
      ${this._stateRow("condition", show.conditions, (item) =>
        this._change({
          conditions: {
            ...show,
            conditions: [item, ...show.conditions.filter((other) => !other[PINNED_STATE])],
          },
        }),
      )}
      ${this._title("Conditions", "show")}
      <ha-automation-condition
        .hass=${conditionTestHass(this.hass, this.sensor)}
        .narrow=${this.narrow}
        .conditions=${show.conditions.filter((item) => !item[PINNED_STATE])}
        @value-changed=${(ev: CustomEvent<{ value: Obj[] }>) => {
          ev.stopPropagation();
          const state = pinnedState(show.conditions);
          const conditions = withOwnSensor(
            show.conditions.filter((item) => !item[PINNED_STATE]),
            ev.detail.value,
            this.sensor,
          );
          this._change({
            conditions: {
              ...show,
              conditions: state ? [state, ...conditions] : conditions,
            },
          });
        }}
      ></ha-automation-condition>
    </div>`;
  }

  // When the activation is no longer true has something to watch:
  // Notification entities, or Conditions used at the activation of a
  // triggered step.
  private _startCanEnd(step: EditorStep): boolean {
    const show = step.conditions;
    return (
      pinnedFilled(step) ||
      (step.activation.type === "triggers" &&
        show.activate_only_while_met &&
        show.conditions.length > 0)
    );
  }

  private _renderDone(step: EditorStep) {
    const listed = this._startCanEnd(step);
    return html`<div class="block">
      ${this._expiresRow("done", step.done_when.expires, (expires) =>
        this._change({ done_when: { ...step.done_when, expires } }),
      )}
      ${listed
        ? html`<ha-card outlined class="own-row">
            <ha-icon class="builtin ${step.done_when.activation_conditions_no_longer_true ? "" : "off"}" icon="mdi:format-list-checks"></ha-icon>
            <div class="own-text">
              When the activation is no longer true
            </div>
            <ha-switch
              .checked=${step.done_when.activation_conditions_no_longer_true}
              @change=${(ev: Event) =>
                this._change({
                  done_when: {
                    ...step.done_when,
                    activation_conditions_no_longer_true: (
                      ev.target as HTMLInputElement
                    ).checked,
                  },
                })}
            ></ha-switch>
          </ha-card>`
        : nothing}
      ${this._title("Triggers", "done")}
      <ha-automation-trigger
        .hass=${this.hass}
        .narrow=${this.narrow}
        .triggers=${step.done_when.triggers}
        @value-changed=${(ev: CustomEvent<{ value: Obj[] }>) => {
          ev.stopPropagation();
          this._change({
            done_when: {
              ...step.done_when,
              triggers: withOwnSensor(step.done_when.triggers, ev.detail.value, this.sensor),
            },
          });
        }}
      ></ha-automation-trigger>
    </div>`;
  }

  private _renderDismiss(step: EditorStep) {
    return html`<div class="block">
      ${this._expiresRow("dismiss", step.dismiss_when.expires, (expires) =>
        this._change({ dismiss_when: { ...step.dismiss_when, expires } }),
      )}
      ${this._title("Triggers", "dismiss")}
      <ha-automation-trigger
        .hass=${this.hass}
        .narrow=${this.narrow}
        .triggers=${step.dismiss_when.triggers}
        @value-changed=${(ev: CustomEvent<{ value: Obj[] }>) => {
          ev.stopPropagation();
          this._change({
            dismiss_when: {
              ...step.dismiss_when,
              triggers: withOwnSensor(step.dismiss_when.triggers, ev.detail.value, this.sensor),
            },
          });
        }}
      ></ha-automation-trigger>
    </div>`;
  }

  // -- Interactions --------------------------------------------------------

  // The step's own entry for a button, matched as effectiveButtons does.
  private _entryIndex(
    step: EditorStep,
    button: Pick<Button, "id" | "type">,
    inherited: boolean,
  ): number {
    return step.buttons.findIndex((item) =>
      inherited && button.type !== "custom"
        ? item.type === button.type
        : item.type === button.type && item.id === button.id,
    );
  }

  private _setEntry(
    step: EditorStep,
    entry: Button,
    inherited: boolean,
    extra: Partial<EditorStep> = {},
  ): void {
    const buttons = [...step.buttons];
    const index = this._entryIndex(step, entry, inherited);
    // Empty values are not stored: they follow the category.
    if (inherited) entry = inheritedEntry(entry);
    if (index < 0) buttons.push(entry);
    else buttons[index] = entry;
    this._change({ ...extra, buttons });
  }

  // The people whose states differ from the category's; the rest as there.
  private _renderAudience(step: EditorStep) {
    return html`<div class="block">
      <nc-audience-table
        .hass=${this.hass}
        .sleepers=${this.sleepers}
        .personStates=${this.livePeople}
        .base=${this.category?.audience ?? {}}
        .value=${step.audience ?? {}}
        @value-changed=${(
          ev: CustomEvent<{ value: Record<string, AudienceEntry> }>,
        ) => {
          ev.stopPropagation();
          this._change({ audience: ev.detail.value });
        }}
      ></nc-audience-table>
    </div>`;
  }

  // The channels' modes and settings that differ from the category's.
  private _renderChannels(step: EditorStep) {
    return html`<div class="block">
      <nc-channel-table
        .hass=${this.hass}
        .narrow=${this.narrow}
        .modes=${this.modes}
        .channels=${channelsOf(this.hass, this.config)}
        .currentMode=${this.liveMode}
        .config=${this.config}
        .testContext=${{
          category: this.category,
          notification: this.notification,
          name: this.notification?.name,
          message: this.entities[0] ? step.message : plainPlaceholders(step.message),
          info: step.info && !this.entities[0] ? plainPlaceholders(step.info) : (step.info ?? null),
          // A test push reads its placeholders from the first entity, as the preview.
          entity_id: this.entities[0] ?? null,
          step: { audience: step.audience ?? {} },
        }}
        .base=${this.category?.channels ?? {}}
        .value=${step.channels ?? {}}
        @value-changed=${(
          ev: CustomEvent<{ value: Record<string, ChannelSettings> }>,
        ) => {
          ev.stopPropagation();
          this._change({ channels: ev.detail.value });
        }}
      ></nc-channel-table>
    </div>`;
  }

  private _renderInteractions(step: EditorStep) {
    const rows = effectiveButtons(this.category, step);
    const tap = rows.filter((button) => button.type === "tap");
    const builtin = rows.filter(
      (button) =>
        button.category && button.type !== "tap" && button.type !== "custom",
    );
    const fromCategory = rows.filter(
      (button) => button.category && button.type === "custom",
    );
    const own = rows.filter((button) => !button.category);
    const card = (items: EffectiveButton[]) =>
      html`<ha-card outlined class="interactions">
        ${items.map((button) => this._interactionRow(step, button))}
      </ha-card>`;
    return html`<div class="block">
      ${tap.length ? card(tap) : nothing}
      ${this._title("Buttons", "interactions")} ${pushButtonsWarning(rows)} ${card(builtin)}
      ${fromCategory.length ? card(fromCategory) : nothing}
      ${own.length ? card(own) : nothing}
      <div>
        <ha-button appearance="filled" size="s" @click=${this._addButton}>
          <ha-icon slot="start" icon="mdi:plus"></ha-icon>
          Add button
        </ha-button>
      </div>
    </div>`;
  }

  // The category's button an inherited one comes from.
  private _base(button: EffectiveButton): CategoryButton | undefined {
    if (!button.category) return undefined;
    return categoryButtons(this.category).find((item) =>
      button.type === "custom"
        ? item.type === "custom" && item.id === button.id
        : item.type === button.type,
    );
  }

  private _interactionRow(step: EditorStep, button: EffectiveButton) {
    const defaults = INTERACTION_DEFAULTS[button.type];
    const label =
      button.type === "tap" ? defaults.label : button.label || defaults.label;
    const parts: string[] = [];
    if (button.type === "snooze") {
      parts.push(
        snoozeChoices(button)
          .map((choice) => choice.text)
          .join(", "),
      );
    }
    const run = runText(button, effectiveButtons(this.category, step));
    if (run) parts.push(run);
    else parts.push(...buttonText(this.hass, button));
    const inherited = this._base(button);
    const entry = (): Button => {
      const index = this._entryIndex(step, button, button.category);
      // Nothing stored: everything follows the category.
      return index >= 0 ? step.buttons[index] : ({ id: button.id, type: button.type } as Button);
    };
    const own = button.category && entryHasOwn(entry());
    const open = () =>
      (this._interaction = { button: entry(), inherited, isNew: false });
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
          this._setEntry(
            step,
            { ...entry(), enabled: (ev.target as HTMLInputElement).checked },
            button.category,
          )}
      ></ha-switch>
      <ha-icon
        class=${button.category ? "builtin" : ""}
        .icon=${button.type === "tap"
          ? defaults.icon
          : button.icon || defaults.icon}
      ></ha-icon>
      <div class="own-text">
        <div>${label}</div>
        <div class="secondary">${parts.join(" · ")}</div>
      </div>
      ${own
        ? restoreButton("Restore the category's settings", () =>
            this._setEntry(step, { id: entry().id, type: button.type } as Button, true),
          )
        : nothing}
      <ha-icon-button .label=${"Edit"}>
        <ha-icon icon="mdi:pencil"></ha-icon>
      </ha-icon-button>
    </div>`;
  }

  private _addButton(): void {
    this._interaction = {
      isNew: true,
      button: {
        id: newId(),
        type: "custom",
        enabled: true,
        label: "",
        actions: {},
        show_in_push: true,
      },
    };
  }

  private _renderInteractionDialog(step: EditorStep) {
    const edit = this._interaction!;
    return html`<nc-interaction-dialog
      .hass=${this.hass}
      .narrow=${this.narrow}
      .button=${edit.button}
      .inherited=${edit.inherited}
      .isNew=${edit.isNew}
      .entityActionSet=${this.entityActions.has(edit.button.id)}
      .runChoices=${runChoicesOf(effectiveButtons(this.category, step))}
      .blocks=${blocksOf(step)}
      .generalOpenOnTap=${this.config?.general?.open_on_tap}
      @interaction-closed=${(ev: CustomEvent<InteractionResult>) => {
        ev.stopPropagation();
        this._interaction = undefined;
        const { result, enableBlock } = ev.detail;
        if (!result) return;
        // Run Snooze/Mute actions switched on also switches its block on.
        const extra: Partial<EditorStep> = enableBlock
          ? { [enableBlock]: { ...step[enableBlock], enabled: true } }
          : {};
        if (result === "delete") {
          this._change({
            buttons: step.buttons.filter(
              (button) =>
                !(
                  button.type === edit.button.type &&
                  button.id === edit.button.id
                ),
            ),
          });
          return;
        }
        this._setEntry(step, result, !!edit.inherited, extra);
      }}
    ></nc-interaction-dialog>`;
  }

  private _renderHelp(key: keyof typeof HELP) {
    const help = HELP[key];
    return html`<ha-dialog
      open
      width="small"
      header-title=${help.title}
      @closed=${(ev: Event) => {
        ev.stopPropagation();
        this._help = undefined;
      }}
    >
      ${help.text.map((text) => html`<p>${text}</p>`)}
      <ha-dialog-footer slot="footer">
        <ha-button slot="primaryAction" @click=${() => (this._help = undefined)}
          >OK</ha-button
        >
      </ha-dialog-footer>
    </ha-dialog>`;
  }

  static override styles = STEP_EDITOR_STYLES;
}

/** The text field inside an element, through the shadow roots. */
function deepInput(
  root: Element,
): HTMLInputElement | HTMLTextAreaElement | undefined {
  const queue: (Element | ShadowRoot)[] = [root];
  while (queue.length) {
    const node = queue.shift()!;
    const found = node.querySelector?.(
      "input, textarea",
    ) as HTMLInputElement | null;
    if (found) return found;
    if (node instanceof Element && node.shadowRoot) queue.push(node.shadowRoot);
    for (const child of Array.from(node.children ?? [])) {
      if (child.shadowRoot) queue.push(child.shadowRoot);
      else queue.push(child);
    }
  }
  return undefined;
}

declare global {
  interface HTMLElementTagNameMap {
    "nc-step-editor": NcStepEditor;
  }
}
