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
  newId,
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
import type { Button } from "../../shared/config";
import { snoozeChoices } from "../../shared/live";
import { INTERACTION_DEFAULTS, actionText } from "./interaction-dialog";
import "./interaction-dialog";

// The order of the Interactions list: the tap, the built-in buttons, then
// the own buttons as they were added.
const INTERACTION_ORDER: Button["type"][] = ["tap", "done", "dismiss", "snooze", "custom"];

type StartKind = "triggers" | "schedule" | "repeat";

const HELP: Record<StartKind | "show" | "done" | "interactions", { title: string; text: string[] }> = {
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
  show: {
    title: "Show when",
    text: [
      "One set of conditions, used as switched on above them.",
      "Start while conditions are met: the step starts only when they are all true at that moment, for example the door card only while the alarm is armed. A scheduled card waits for them, hidden, until it expires.",
      "Hide while conditions are not met: an open card is hidden while any of them is false, and shows again when they are all true, for example the window card only while the heating is on. Push and light come again when it shows.",
    ],
  },
  interactions: {
    title: "Interactions",
    text: [
      "The buttons of the card and what a tap on it does. Done marks the card done, Dismiss dismisses it and Snooze snoozes it, for one of its times; the tap and the own buttons leave the card as it is.",
      "Every one can also run an action: the entity action set for the card's entity in the Entities block, More info, a Home Assistant action or Navigate.",
      "Show in push puts the button on the push notification too (with the push channel). Android shows at most 3.",
    ],
  },
  done: {
    title: "Done when",
    text: [
      "The card closes as done by itself when one of these triggers fires, for example when the washing machine door opens.",
      "Start condition no longer true: an entity's card closes when that entity no longer matches Notification entities at the top of Start (the leak is dry again), and a card closes when the Show when conditions it started with are no longer met (with Start while conditions are met switched on).",
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

export const STEP_BLOCKS = ["message", "start", "show", "done", "interactions", "audience"] as const;
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

  // The buttons some entity or entity category has an action for.
  @property({ attribute: false }) public entityActions: Set<string> = new Set();

  // The interaction whose dialog is open (index -1: a new button).
  @state() private _interaction?: { index: number; button: Button };

  @state() private _help?: keyof typeof HELP;

  @state() private _pinnedOpen = false;


  // The text field the entity parameters go into.
  private _field: "message" | "info" = "message";

  private _emit(step: EditorStep): void {
    this.dispatchEvent(new CustomEvent("value-changed", { detail: { value: step } }));
  }

  private _change(changes: Partial<EditorStep>): void {
    this._emit({ ...this.step!, ...changes });
  }

  private _panel(key: StepBlock, icon: string, header: string, count: number | string | undefined, content: unknown) {
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
      (step.done_when.start_no_longer_true && this._startCanEnd(step) ? 1 : 0);
    return html`
      ${this._panel("message", "mdi:message-text-outline", "Message", undefined, this._renderMessage(step))}
      ${this._panel(
        "start",
        "mdi:play-circle-outline",
        "Start",
        kind === "triggers" ? this._startCount(step) : undefined,
        this._renderStart(step),
      )}
      ${this._panel("show", "mdi:eye-outline", "Show when", step.show_when.conditions.length, this._renderShow(step))}
      ${this._panel("done", "mdi:check-circle-outline", "Done when", doneCount, this._renderDone(step))}
      ${this._panel(
        "interactions",
        "mdi:gesture-tap-button",
        "Interactions",
        step.buttons.filter((button) => button.enabled).length,
        this._renderInteractions(step),
      )}
      ${this._panel("audience", "mdi:account-multiple", "Audience", this._audienceCount(step), this._renderAudience(step))}
      ${this._help ? this._renderHelp(this._help) : nothing}
      ${this._interaction ? this._renderInteractionDialog(step) : nothing}
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
      ${this._text("message", "Message", step.message, (value) => this._change({ message: value }))}
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
      ${this._text("info", "Info", step.info ?? "", (value) => this._change({ info: value || null }))}
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
    </div>`;
  }

  // The triggers of the list: all but the one at the top.
  private _listTriggers(step: EditorStep): Obj[] {
    const triggers = step.start.triggers ?? [];
    return pinnedEntities(step) ? triggers.slice(1) : triggers;
  }

  // Notification entities at the top of Start, when the notification lists
  // entities: it edits the first trigger, on this notification's entities.
  // It opens and closes like a trigger row, closed at first.
  private _renderPinned(step: EditorStep) {
    const pinned = pinnedEntities(step);
    if (!pinned && !this.entities.length) return nothing;
    // Left empty, Numeric state when every listed entity has a number.
    const kind: EntitiesKind = pinned?.kind ?? (this._allNumeric() ? "numeric" : "state");
    const options = pinned?.options ?? {};
    return html`<ha-expansion-panel
      outlined
      class="pinned"
      .expanded=${this._pinnedOpen}
      @expanded-changed=${(ev: CustomEvent<{ expanded: boolean }>) => {
        ev.stopPropagation();
        if (ev.target === ev.currentTarget) this._pinnedOpen = ev.detail.expanded;
      }}
      @expanded-will-change=${(ev: Event) => ev.stopPropagation()}
    >
      <ha-icon slot="leading-icon" class="builtin" icon="mdi:format-list-checks"></ha-icon>
      <div slot="header" class="pinned-title">Notification entities</div>
      <nc-entities-form
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
      ></nc-entities-form>
    </ha-expansion-panel>`;
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
            (entity.state.trim() !== "" && !Number.isNaN(Number(entity.state)))),
      )
    );
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

  // -- Show when and Done when ------------------------------------------

  private _renderShow(step: EditorStep) {
    const show = step.show_when;
    const toggle = (key: "start" | "hide") => (ev: Event) =>
      this._change({ show_when: { ...show, [key]: (ev.target as HTMLInputElement).checked } });
    return html`<div class="block">
      <div class="show-switches">
        <ha-card outlined class="own-row">
          <ha-icon class="builtin" icon="mdi:play-circle-outline"></ha-icon>
          <div class="own-text">
            <div>Start while conditions are met</div>
            <div class="secondary">The step starts only when they are true.</div>
          </div>
          <ha-switch .checked=${show.start} @change=${toggle("start")}></ha-switch>
        </ha-card>
        <ha-card outlined class="own-row">
          <ha-icon class="builtin" icon="mdi:eye-off-outline"></ha-icon>
          <div class="own-text">
            <div>Hide while conditions are not met</div>
            <div class="secondary">An open card shows only while they are true.</div>
          </div>
          <ha-switch .checked=${show.hide} @change=${toggle("hide")}></ha-switch>
        </ha-card>
      </div>
      ${this._title("Conditions", "show")}
      <ha-automation-condition
        .hass=${this.hass}
        .narrow=${this.narrow}
        .conditions=${show.conditions}
        @value-changed=${(ev: CustomEvent<{ value: Obj[] }>) => {
          ev.stopPropagation();
          this._change({ show_when: { ...show, conditions: ev.detail.value } });
        }}
      ></ha-automation-condition>
    </div>`;
  }

  // Start condition no longer true has something to watch: Notification
  // entities, or Show when used at the start of a triggered step.
  private _startCanEnd(step: EditorStep): boolean {
    const show = step.show_when;
    return (
      pinnedFilled(step) || (step.start.type === "triggers" && show.start && show.conditions.length > 0)
    );
  }

  private _renderDone(step: EditorStep) {
    const listed = this._startCanEnd(step);
    return html`<div class="block">
      ${this._title("Triggers", "done")}
      ${listed
        ? html`<ha-card outlined class="own-row">
            <ha-icon class="builtin" icon="mdi:format-list-checks"></ha-icon>
            <div class="own-text">
              <div>Start condition no longer true</div>
              <div class="secondary">
                The card closes when what started it is no longer true: its entity no longer matches
                Notification entities, or Show when is no longer met.
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

  // -- Interactions --------------------------------------------------------

  private _sortedButtons(step: EditorStep): { button: Button; index: number }[] {
    return step.buttons
      .map((button, index) => ({ button, index }))
      .sort(
        (a, b) =>
          INTERACTION_ORDER.indexOf(a.button.type) - INTERACTION_ORDER.indexOf(b.button.type) ||
          a.index - b.index,
      );
  }

  // Every person of Home Assistant, by name.
  private _people(): { id: string; name: string; picture?: string }[] {
    return Object.values(this.hass?.states ?? {})
      .filter((state) => state.entity_id.startsWith("person."))
      .map((state) => ({
        id: state.entity_id,
        name: String(state.attributes.friendly_name ?? state.entity_id.slice(7)),
        picture: (state.attributes.entity_picture as string | undefined) ?? undefined,
      }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  private _audienceCount(step: EditorStep): string | undefined {
    const people = this._people();
    if (!people.length) return undefined;
    const audience = step.audience ?? [];
    const on = audience.length ? people.filter((person) => audience.includes(person.id)).length : people.length;
    return `${on}/${people.length}`;
  }

  // Empty means everyone, a person added later too; with someone switched
  // off, only the ones switched on.
  private _renderAudience(step: EditorStep) {
    const people = this._people();
    const audience = step.audience ?? [];
    const everyone = audience.length === 0;
    if (!people.length) {
      return html`<div class="block"><div class="secondary">No people in Home Assistant: everyone sees the card.</div></div>`;
    }
    const set = (id: string, on: boolean) => {
      const chosen = new Set(everyone ? people.map((person) => person.id) : audience);
      if (on) chosen.add(id);
      else chosen.delete(id);
      const all = people.every((person) => chosen.has(person.id));
      this._change({ audience: all ? [] : people.map((person) => person.id).filter((item) => chosen.has(item)) });
    };
    return html`<div class="block">
      <div class="secondary">
        Who sees the card (and, later, gets the push). With everyone on, people added later see it too.
      </div>
      <ha-card outlined class="interactions">
        ${people.map((person) => {
          const on = everyone || audience.includes(person.id);
          return html`<div class="own-row">
            ${person.picture
              ? html`<img class="avatar" src=${person.picture} alt="" />`
              : html`<span class="avatar">${initials(person.name)}</span>`}
            <div class="own-text">${person.name}</div>
            <ha-switch
              .checked=${on}
              @change=${(ev: Event) => set(person.id, (ev.target as HTMLInputElement).checked)}
            ></ha-switch>
          </div>`;
        })}
      </ha-card>
      ${!everyone && audience.every((id) => !people.some((person) => person.id === id))
        ? html`<ha-alert alert-type="warning">Nobody listed exists any more: nobody sees the card.</ha-alert>`
        : nothing}
    </div>`;
  }

  private _renderInteractions(step: EditorStep) {
    return html`<div class="block">
      ${this._title("Buttons", "interactions")}
      <ha-card outlined class="interactions">
        ${this._sortedButtons(step).map(({ button, index }) => {
          const defaults = INTERACTION_DEFAULTS[button.type];
          const label = button.type === "tap" ? defaults.label : button.label || defaults.label;
          const parts: string[] = [];
          if (button.type === "snooze") {
            parts.push(snoozeChoices(button).map((choice) => choice.text).join(", "));
          }
          if (button.type !== "snooze" || (button.action?.type ?? "nothing") !== "nothing") {
            parts.push(actionText(this.hass, button.action));
          }
          const open = () => (this._interaction = { index, button });
          return html`<div
            class="interaction ${button.enabled ? "" : "off"}"
            role="button"
            tabindex="0"
            @click=${open}
            @keydown=${(ev: KeyboardEvent) => {
              if (ev.key === "Enter") open();
            }}
          >
            <ha-icon
              class=${button.type === "custom" ? "" : "builtin"}
              .icon=${button.type === "tap" ? defaults.icon : button.icon || defaults.icon}
            ></ha-icon>
            <div class="own-text">
              <div>${label}</div>
              <div class="secondary">${parts.join(" · ")}</div>
            </div>
            <ha-switch
              .checked=${button.enabled}
              @click=${(ev: Event) => ev.stopPropagation()}
              @change=${(ev: Event) => {
                const buttons = [...step.buttons];
                buttons[index] = { ...button, enabled: (ev.target as HTMLInputElement).checked };
                this._change({ buttons });
              }}
            ></ha-switch>
          </div>`;
        })}
      </ha-card>
      <div>
        <ha-button appearance="filled" size="s" @click=${this._addButton}>
          <ha-icon slot="start" icon="mdi:plus"></ha-icon>
          Add button
        </ha-button>
      </div>
    </div>`;
  }

  private _addButton(): void {
    this._interaction = {
      index: -1,
      button: {
        id: newId(),
        type: "custom",
        enabled: true,
        label: "",
        action: { type: "nothing" },
        show_in_push: false,
        confirm: false,
      },
    };
  }

  private _renderInteractionDialog(step: EditorStep) {
    const edit = this._interaction!;
    const otherPushButtons = step.buttons.filter(
      (button, index) =>
        index !== edit.index &&
        button.enabled &&
        button.type !== "tap" &&
        (button.show_in_push ?? button.type !== "custom"),
    ).length;
    return html`<nc-interaction-dialog
      .hass=${this.hass}
      .narrow=${this.narrow}
      .button=${edit.button}
      .isNew=${edit.index < 0}
      .entityActionSet=${this.entityActions.has(edit.button.id)}
      .otherPushButtons=${otherPushButtons}
      @interaction-closed=${(ev: CustomEvent<{ result?: Button | "delete" }>) => {
        ev.stopPropagation();
        this._interaction = undefined;
        const result = ev.detail.result;
        if (!result) return;
        const buttons = [...step.buttons];
        if (result === "delete") buttons.splice(edit.index, 1);
        else if (edit.index < 0) buttons.push(result);
        else buttons[edit.index] = result;
        this._change({ buttons });
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
    /* On a phone each Data field takes the whole width. */
    @media (max-width: 600px) {
      .row.data > *,
      .row.data > .data-type {
        flex: 1 1 100%;
      }
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
    /* Like a trigger row of Home Assistant's list. */
    ha-expansion-panel.pinned {
      display: block;
      background-color: var(--card-background-color);
      --expansion-panel-summary-padding: 0 8px 0 16px;
      /* The panel pads its content even while closed, so the form does. */
      --expansion-panel-content-padding: 0;
    }
    ha-expansion-panel.pinned nc-entities-form {
      padding: 8px 16px 16px;
    }
    ha-expansion-panel.pinned > ha-icon[slot="leading-icon"] {
      margin-inline-end: 12px;
    }
    .pinned-title {
      flex: 1;
    }
    /* The built-in rows, which are not Home Assistant's triggers. */
    ha-icon.builtin {
      color: var(--amber-color, #ffc107);
    }
    /* Side by side where there is room. */
    .show-switches {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
      gap: 8px;
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
    .own-row {
      display: flex;
      align-items: center;
      gap: 16px;
      padding: 12px 16px;
    }
    .own-row ha-icon {
      flex: none;
    }
    .own-row + .own-row {
      border-top: 1px solid var(--divider-color);
    }
    /* As Home Assistant draws a person: the picture, or the initials. */
    .avatar {
      flex: none;
      width: 40px;
      height: 40px;
      border-radius: 50%;
      object-fit: cover;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      background-color: var(--light-primary-color);
      color: var(--text-light-primary-color, var(--primary-text-color));
      font-size: var(--ha-font-size-m, 14px);
      overflow: hidden;
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
  `;
}

/** "Test User" -> "TU", as Home Assistant's person badge. */
function initials(name: string): string {
  return name
    .trim()
    .split(/\s+/)
    .slice(0, 3)
    .map((part) => part.charAt(0))
    .join("")
    .toUpperCase();
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
