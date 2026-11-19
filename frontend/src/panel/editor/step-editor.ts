// One step of a notification: its message, how it starts, when it hides
// and when it is done. Starts, conditions and Done when are Home
// Assistant's own trigger and condition editors.

import { LitElement, css, html, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";

import { field } from "../fields";
import { PLACEHOLDERS } from "../../shared/text";
import type { HomeAssistant } from "../../shared/types";
import {
  type DataType,
  type EditorStep,
  ENTITIES_NUMERIC,
  ENTITIES_STATE,
  type Obj,
  PINNED,
  type Schedule,
  type StepData,
  pinnedEntities,
  pinnedFilled,
} from "./model";
import { type EntitiesKind, entitiesFilled } from "./entities-form";
import "./entities-form";
import { defaultSchedule } from "./schedule-editor";
import { BLOCK_STYLES, block } from "./block";
import "./schedule-editor";

type StartKind = "triggers" | "schedule" | "repeat";

const HELP: Record<StartKind | "conditions" | "hide" | "done", { title: string; text: string[] }> = {
  triggers: {
    title: "Triggers",
    text: [
      "The step starts when one of its triggers fires, like an automation.",
      "Notification entities, at the top, watches the entities of the Entities block: every entity gets its own card when it starts to match, for example when a leak sensor turns on. State tests the state or an attribute; Numeric state tests a number against a limit. Left empty, it is not used.",
      "The Notification entities triggers in the list do the same with the entities of any notification, and Notification state starts the step when this or another notification (or one of its steps) reaches a state, for example when step 1 is snoozed.",
      "Without triggers, only the Trigger action (or Run now) starts the step.",
    ],
  },
  schedule: {
    title: "Schedule",
    text: [
      "The step comes on the calendar: every N days, weeks on the chosen days, months on a day, or years, at a time.",
      "Expires closes a card nobody did, after a while or on a day at a time.",
    ],
  },
  repeat: {
    title: "Repeat after done",
    text: [
      "The step comes again N days, weeks, months or years after it was last done, at a time if one is set. Watering plants or changing a filter are typical.",
      "A new step counts from when it was made. The pencil sets the next time: it is stored as when the step was last done.",
      "Every can be a number or the value of an entity, such as an input number.",
    ],
  },
  conditions: {
    title: "Conditions",
    text: ["The step starts only when all of its conditions are true at that moment."],
  },
  hide: {
    title: "Hide while",
    text: [
      "The card stays open but is hidden while any of these conditions is true, for example while nobody is home. Push and light come again when it shows.",
    ],
  },
  done: {
    title: "Done when",
    text: [
      "The card closes as done by itself when one of these triggers fires, for example when the washing machine door opens.",
      "Start condition no longer true: an entity's card closes when that entity no longer matches Notification entities at the top of Start (the leak is dry again).",
    ],
  },
};

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
const HIDDEN_ATTRIBUTES = ["friendly_name", "icon", "entity_picture", "supported_features", "attribution"];

const TIME_TYPES: DataType[] = ["active_since", "last_done", "last_changed", "last_updated"];

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

export const STEP_BLOCKS = ["message", "start", "hide", "done"] as const;
export type StepBlock = (typeof STEP_BLOCKS)[number];

@customElement("nc-step-editor")
export class NcStepEditor extends LitElement {
  @property({ attribute: false }) public hass?: HomeAssistant;

  @property({ type: Boolean }) public narrow = false;

  @property({ attribute: false }) public step?: EditorStep;

  @property() public notificationId?: string;

  // The step is stored as it is (Next of a Repeat can be set).
  @property({ type: Boolean }) public saved = false;

  @property({ attribute: false }) public expanded: Set<string> = new Set();

  // The entities of the notification's Entities block, switched on.
  @property({ attribute: false }) public entities: string[] = [];

  @state() private _help?: keyof typeof HELP;


  // The text field the entity parameters go into.
  private _field: "message" | "info" = "message";

  private _emit(step: EditorStep): void {
    this.dispatchEvent(new CustomEvent("value-changed", { detail: { value: step } }));
  }

  private _change(changes: Partial<EditorStep>): void {
    this._emit({ ...this.step!, ...changes });
  }

  private _panel(key: StepBlock, icon: string, header: string, count: number | undefined, content: unknown) {
    return block({
      icon,
      header,
      count,
      expanded: this.expanded.has(key),
      toggled: (expanded) =>
        this.dispatchEvent(new CustomEvent("block-toggled", { detail: { block: key, expanded } })),
      content,
    });
  }

  protected override render() {
    const step = this.step;
    if (!step) return nothing;
    const kind = this._kind(step);
    const doneCount =
      step.done_when.triggers.length +
      (step.done_when.start_no_longer_true && pinnedFilled(step) ? 1 : 0);
    return html`
      ${this._panel("message", "mdi:message-text-outline", "Message", undefined, this._renderMessage(step))}
      ${this._panel(
        "start",
        "mdi:play-circle-outline",
        "Start",
        kind === "triggers" ? this._startCount(step) : undefined,
        this._renderStart(step),
      )}
      ${this._panel("hide", "mdi:eye-off-outline", "Hide while", step.hide_while.length, this._renderHide(step))}
      ${this._panel("done", "mdi:check-circle-outline", "Done when", doneCount, this._renderDone(step))}
      ${this._help ? this._renderHelp(this._help) : nothing}
    `;
  }

  private _startCount(step: EditorStep): number {
    const triggers = step.start.triggers ?? [];
    const pinned = pinnedEntities(step);
    return pinned && !entitiesFilled(pinned.kind, pinned.options) ? triggers.length - 1 : triggers.length;
  }

  private _kind(step: EditorStep): StartKind {
    if (step.start.type === "triggers") return "triggers";
    return step.start.schedule?.type === "after_last_done" ? "repeat" : "schedule";
  }

  // -- Message -------------------------------------------------------------

  private _renderMessage(step: EditorStep) {
    const data = step.data ?? { type: "none" };
    return html`<div class="block">
      <div class="row">
        ${this._text("message", "Message", step.message, (value) => this._change({ message: value }))}
        ${this._text("info", "Info", step.info ?? "", (value) => this._change({ info: value || null }))}
      </div>
      <div class="chips">
        <span class="chips-label">Entity parameters</span>
        ${PLACEHOLDERS.filter(
          (name) => name !== "Floor" || Object.keys(this.hass?.floors ?? {}).length > 0,
        ).map(
          (name) => html`<button
            class="param"
            type="button"
            @mousedown=${(ev: Event) => ev.preventDefault()}
            @click=${() => this._insert(`{${name}}`)}
          >
            {${name}}
          </button>`,
        )}
      </div>
      <div class="row data">${this._renderData(data)}</div>
    </div>`;
  }

  private _renderData(data: StepData) {
    const kind = kindOf(data.type);
    const format = TIME_TYPES.includes(data.type)
      ? this._selector(
          { select: { mode: "dropdown", options: FORMATS } },
          data.format ?? "relative",
          "Format",
          (value) => this._dataChanged({ format: (value as StepData["format"]) ?? null }),
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
            type: next === "notification" ? "active_since" : next === "entity" ? "state" : next || "none",
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
            (value) => this._dataChanged({ type: (value as DataType) || "active_since" }),
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
        ? this._selector(
            { text: {} },
            data.text ?? "",
            "Template",
            (value) => this._dataChanged({ text: (value as string) || null }),
          )
        : nothing}
    `;
  }

  private _text(name: "message" | "info", label: string, value: string, changed: (value: string) => void) {
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
      ? Object.keys(stateObj.attributes).filter((name) => !HIDDEN_ATTRIBUTES.includes(name))
      : [];
    if (data.attribute && !names.includes(data.attribute)) names.push(data.attribute);
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
        if (name === LAST_CHANGED) this._dataChanged({ type: "last_changed", attribute: null });
        else if (name === LAST_UPDATED) this._dataChanged({ type: "last_updated", attribute: null });
        else if (name !== STATE) this._dataChanged({ type: "attribute", attribute: name });
        else this._dataChanged({ type: "state", attribute: null });
      },
    );
  }

  private _dataChanged(changes: Partial<StepData>): void {
    const data: StepData = { ...(this.step!.data ?? { type: "none" }), ...changes };
    const clean: StepData = { type: data.type };
    if (TIME_TYPES.includes(data.type) && data.format) clean.format = data.format;
    if (kindOf(data.type) === "entity" && data.entity_id) clean.entity_id = data.entity_id;
    if (data.type === "attribute" && data.attribute) clean.attribute = data.attribute;
    if (data.type === "attribute" && !data.attribute) clean.type = "state";
    if (data.type === "custom" && data.text) clean.text = data.text;
    this._change({ data: data.type === "none" ? null : clean });
  }

  private _insert(token: string): void {
    const field = this._field;
    const host = this.renderRoot.querySelector(`ha-selector.${field}`);
    const input = host ? deepInput(host) : undefined;
    const current = (field === "message" ? this.step!.message : this.step!.info) ?? "";
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
    return field(this.hass, selector, value, label, changed, { className, clearable });
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
      ${this._title(HELP[kind].title, kind)}
      ${kind === "triggers"
        ? html`${this._renderPinned(step)}<ha-automation-trigger
            .hass=${this.hass}
            .narrow=${this.narrow}
            .triggers=${this._listTriggers(step)}
            @value-changed=${(ev: CustomEvent<{ value: Obj[] }>) => {
              ev.stopPropagation();
              const pinned = pinnedEntities(step);
              const triggers = pinned ? [pinned.item, ...ev.detail.value] : ev.detail.value;
              this._change({ start: { ...step.start, triggers } });
            }}
          ></ha-automation-trigger>`
        : html`<nc-schedule-editor
            .hass=${this.hass}
            .schedule=${step.start.schedule}
            .notificationId=${this.notificationId}
            .stepId=${step.id}
            .saved=${this.saved}
            @value-changed=${(ev: CustomEvent<{ value: Schedule }>) => {
              ev.stopPropagation();
              this._change({ start: { ...step.start, schedule: ev.detail.value } });
            }}
          ></nc-schedule-editor>`}
      <div class="divider"></div>
      ${this._title("Conditions", "conditions")}
      <ha-automation-condition
        .hass=${this.hass}
        .narrow=${this.narrow}
        .conditions=${step.start.conditions}
        @value-changed=${(ev: CustomEvent<{ value: Obj[] }>) => {
          ev.stopPropagation();
          this._change({ start: { ...step.start, conditions: ev.detail.value } });
        }}
      ></ha-automation-condition>
    </div>`;
  }

  // The triggers of the list: all but the one at the top.
  private _listTriggers(step: EditorStep): Obj[] {
    const triggers = step.start.triggers ?? [];
    return pinnedEntities(step) ? triggers.slice(1) : triggers;
  }

  // Notification entities at the top of Start, when the notification lists
  // entities: it edits the first trigger, on this notification's entities.
  private _renderPinned(step: EditorStep) {
    const pinned = pinnedEntities(step);
    if (!pinned && !this.entities.length) return nothing;
    const kind: EntitiesKind = pinned?.kind ?? "state";
    const options = pinned?.options ?? {};
    return html`<ha-card outlined class="pinned">
      <div class="pinned-header">
        <ha-icon icon="mdi:format-list-bulleted"></ha-icon>
        <div class="own-text">
          <div>Notification entities</div>
          <div class="secondary">
            ${this.entities.length === 1 ? "1 entity" : `${this.entities.length} entities`} ·
            ${entitiesFilled(kind, options) ? "each gets its own card" : "not used while empty"}
          </div>
        </div>
        <ha-button-toggle-group
          size="s"
          .buttons=${[
            { label: "State", value: "state" },
            { label: "Numeric state", value: "numeric" },
          ]}
          .active=${kind}
          @value-changed=${(ev: CustomEvent<{ value: EntitiesKind }>) => {
            ev.stopPropagation();
            if (ev.detail.value === kind) return;
            // Attribute and For stay; the test itself differs.
            const kept: Obj = {};
            if (options.attribute !== undefined) kept.attribute = options.attribute;
            if (options.for !== undefined) kept.for = options.for;
            this._pinnedChanged(step, ev.detail.value, kept);
          }}
        ></ha-button-toggle-group>
      </div>
      <nc-entities-form
        .hass=${this.hass}
        .kind=${kind}
        .value=${options}
        .entities=${this.entities}
        @value-changed=${(ev: CustomEvent<{ value: Obj }>) => {
          ev.stopPropagation();
          this._pinnedChanged(step, kind, ev.detail.value);
        }}
      ></nc-entities-form>
    </ha-card>`;
  }

  private _pinnedChanged(step: EditorStep, kind: EntitiesKind, options: Obj): void {
    const item: Obj = {
      trigger: kind === "numeric" ? ENTITIES_NUMERIC : ENTITIES_STATE,
      options,
      [PINNED]: true,
    };
    const rest = this._listTriggers(step);
    this._change({ start: { ...step.start, triggers: [item, ...rest] } });
  }

  private _kindChanged(kind: StartKind): void {
    const step = this.step!;
    if (kind === this._kind(step)) return;
    if (kind === "triggers") {
      this._change({ start: { ...step.start, type: "triggers", triggers: step.start.triggers ?? [] } });
      return;
    }
    const type: Schedule["type"] = kind === "schedule" ? "calendar" : "after_last_done";
    this._change({
      start: {
        ...step.start,
        type: "schedule",
        schedule: defaultSchedule(type, step.start.schedule),
      },
    });
  }

  private _title(title: string, help: keyof typeof HELP) {
    return html`<div class="title">
      <span>${title}</span>
      <ha-icon-button .label=${`About ${title}`} @click=${() => (this._help = help)}>
        <ha-icon icon="mdi:information-outline"></ha-icon>
      </ha-icon-button>
    </div>`;
  }

  // -- Hide while and Done when ------------------------------------------

  private _renderHide(step: EditorStep) {
    return html`<div class="block">
      ${this._title("Conditions", "hide")}
      <ha-automation-condition
        .hass=${this.hass}
        .narrow=${this.narrow}
        .conditions=${step.hide_while}
        @value-changed=${(ev: CustomEvent<{ value: Obj[] }>) => {
          ev.stopPropagation();
          this._change({ hide_while: ev.detail.value });
        }}
      ></ha-automation-condition>
    </div>`;
  }

  private _renderDone(step: EditorStep) {
    const listed = pinnedFilled(step);
    return html`<div class="block">
      ${this._title("Triggers", "done")}
      ${listed
        ? html`<ha-card outlined class="own-row">
            <ha-icon icon="mdi:format-list-checks"></ha-icon>
            <div class="own-text">
              <div>Start condition no longer true</div>
              <div class="secondary">
                An entity's card closes when that entity no longer matches Notification entities at the top of Start.
              </div>
            </div>
            <ha-switch
              .checked=${step.done_when.start_no_longer_true}
              @change=${(ev: Event) =>
                this._change({
                  done_when: {
                    ...step.done_when,
                    start_no_longer_true: (ev.target as HTMLInputElement).checked,
                  },
                })}
            ></ha-switch>
          </ha-card>`
        : nothing}
      <ha-automation-trigger
        .hass=${this.hass}
        .narrow=${this.narrow}
        .triggers=${step.done_when.triggers}
        @value-changed=${(ev: CustomEvent<{ value: Obj[] }>) => {
          ev.stopPropagation();
          this._change({ done_when: { ...step.done_when, triggers: ev.detail.value } });
        }}
      ></ha-automation-trigger>
    </div>`;
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
        <ha-button slot="primaryAction" @click=${() => (this._help = undefined)}>OK</ha-button>
      </ha-dialog-footer>
    </ha-dialog>`;
  }

  static override styles = css`
    :host {
      display: flex;
      flex-direction: column;
      gap: 12px;
    }
    .block {
      display: flex;
      flex-direction: column;
      gap: 12px;
    }
    ha-button-toggle-group {
      align-self: flex-start;
    }
    .row.data {
      align-items: flex-end;
    }
    .row > .data-type {
      flex: 0 1 220px;
    }
    .param {
      font-family: var(--ha-font-family-code, monospace);
      font-size: var(--ha-font-size-s, 12px);
      color: var(--primary-color);
      background-color: rgb(from var(--primary-color) r g b / 0.1);
      border: none;
      border-radius: 4px;
      padding: 3px 6px;
      cursor: pointer;
    }
    .param:hover {
      background-color: rgb(from var(--primary-color) r g b / 0.2);
    }
    .row {
      display: flex;
      gap: 12px;
      flex-wrap: wrap;
    }
    .row > * {
      flex: 1 1 200px;
      min-width: 0;
    }
    .chips {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 6px;
    }
    .chips-label {
      color: var(--secondary-text-color);
      margin-inline-end: 4px;
    }
    .title {
      display: flex;
      align-items: center;
      gap: 4px;
      margin: 4px 0 -4px;
      font-weight: var(--ha-font-weight-medium, 500);
    }
    .title ha-icon-button {
      --ha-icon-button-size: 32px;
      --mdc-icon-size: 18px;
      color: var(--secondary-text-color);
    }
    /* Full width across the panel's padding. */
    .divider {
      height: 1px;
      background-color: var(--divider-color);
      margin: 4px -16px 0;
    }
    .pinned {
      display: flex;
      flex-direction: column;
      gap: 12px;
      padding: 12px 16px 16px;
    }
    .pinned-header {
      display: flex;
      align-items: center;
      gap: 16px;
      flex-wrap: wrap;
    }
    .pinned-header ha-icon {
      color: var(--secondary-text-color);
      flex: none;
    }
    .own-row {
      display: flex;
      align-items: center;
      gap: 16px;
      padding: 12px 16px;
    }
    .own-row ha-icon {
      color: var(--secondary-text-color);
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
    ${BLOCK_STYLES}
    /* The step's blocks stand out on the steps card. */
    ha-expansion-panel.nc-block {
      background-color: var(--primary-background-color);
    }
  `;
}

/** The text field inside an element, through the shadow roots. */
function deepInput(root: Element): HTMLInputElement | HTMLTextAreaElement | undefined {
  const queue: (Element | ShadowRoot)[] = [root];
  while (queue.length) {
    const node = queue.shift()!;
    const found = node.querySelector?.("input, textarea") as HTMLInputElement | null;
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
