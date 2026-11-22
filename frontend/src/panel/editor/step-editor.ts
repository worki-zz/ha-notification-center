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
import type {
  AudienceEntry,
  Button,
  Category,
  CategoryButton,
  ChannelSettings,
  EffectiveButton,
  Mode,
} from "../../shared/config";
import "../channel-tables";
import { CHANNELS, audienceCount } from "../channel-tables";
import {
  categoryButtons,
  effectiveButtons,
  snoozeChoices,
} from "../../shared/live";
import { INTERACTION_DEFAULTS, actionText } from "./interaction-dialog";
import "./interaction-dialog";

type StartKind = "triggers" | "schedule" | "repeat";

const HELP: Record<
  StartKind | "show" | "done" | "interactions",
  { title: string; text: string[] }
> = {
  triggers: {
    title: "Triggers",
    text: [
      "The step is activated when one of its triggers fires, like an automation.",
      "Notification entities, at the top, watches the entities of the Entities block: every entity gets its own card when it starts to match, for example when a leak sensor turns on. State tests the state or an attribute; Numeric state tests a number against a limit. Left empty, it is not used.",
      "The Notification entities triggers in the list do the same with the entities of any notification, and Notification state activates the step when this or another notification (or one of its steps) reaches a state, for example when step 1 is snoozed.",
      "Without triggers, only the Trigger action (or Run now) activates the step.",
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
    title: "Conditions",
    text: [
      "One set of conditions, used as switched on above them.",
      "Activate only while conditions are met: the step is activated only when they are all true at that moment, for example the door card only while the alarm is armed. A scheduled card waits for them, hidden, until it expires.",
      "Hide active notification while conditions are not met: an active card is hidden while any of them is false, and shows again when they are all true, for example the window card only while the heating is on. Push and light come again when it shows.",
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
    title: "Done",
    text: [
      "The card closes as done by itself when one of these triggers fires, for example when the washing machine door opens.",
      "Done when activation conditions no longer true: an entity's card closes when that entity no longer matches Notification entities at the top of Activation (the leak is dry again), and a card closes when the Conditions it was activated with are no longer met (with Activate only while conditions are met switched on).",
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
  "show",
  "done",
  "audience",
  "channels",
] as const;
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

  // The buttons some entity or entity group has an action for.
  @property({ attribute: false }) public entityActions: Set<string> = new Set();

  // The notification's category: its buttons are inherited.
  @property({ attribute: false }) public category?: Category;

  // The modes, for the Channels table.
  @property({ attribute: false }) public modes: Mode[] = [];

  // The people with a sleep condition (the Audience's Sleep ticks).
  @property({ attribute: false }) public sleepers: string[] = [];

  // The interaction whose dialog is open: the step's own entry for it, the
  // category's button it inherits from, and whether it is a new own button.
  @state() private _interaction?: {
    button: Button;
    inherited?: CategoryButton;
    isNew: boolean;
  };

  @state() private _help?: keyof typeof HELP;

  @state() private _pinnedOpen = false;

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
  ) {
    return block({
      icon,
      header,
      count,
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
    const doneCount =
      step.done_when.triggers.length +
      (step.done_when.activation_conditions_no_longer_true &&
      this._startCanEnd(step)
        ? 1
        : 0);
    return html`
      ${this._panel(
        "message",
        "mdi:message-text-outline",
        "Message",
        undefined,
        this._renderMessage(step),
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
        kind === "triggers"
          ? this._startCount(step)
          : kind === "repeat"
            ? "Repeat"
            : "Schedule",
        this._renderStart(step),
      )}
      ${this._panel(
        "show",
        "mdi:eye-outline",
        "Conditions",
        step.conditions.conditions.length,
        this._renderShow(step),
      )}
      ${this._panel(
        "done",
        "mdi:check-circle-outline",
        "Done",
        doneCount,
        this._renderDone(step),
      )}
      <div class="group-gap"></div>
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
      ${this._panel(
        "channels",
        "mdi:broadcast",
        "Channels",
        undefined,
        this._renderChannels(step),
      )}
      ${this._help ? this._renderHelp(this._help) : nothing}
      ${this._interaction ? this._renderInteractionDialog(step) : nothing}
    `;
  }

  private _startCount(step: EditorStep): number {
    const triggers = step.activation.triggers ?? [];
    const pinned = pinnedEntities(step);
    return pinned && !entitiesFilled(pinned.kind, pinned.options)
      ? triggers.length - 1
      : triggers.length;
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
      ${this._title(HELP[kind].title, kind)}
      ${kind === "triggers"
        ? html`<ha-automation-trigger
            .hass=${this.hass}
            .narrow=${this.narrow}
            .triggers=${this._listTriggers(step)}
            @value-changed=${(ev: CustomEvent<{ value: Obj[] }>) => {
              ev.stopPropagation();
              const pinned = pinnedEntities(step);
              const triggers = pinned
                ? [pinned.item, ...ev.detail.value]
                : ev.detail.value;
              this._change({ activation: { ...step.activation, triggers } });
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

  // The triggers of the list: all but the one at the top.
  private _listTriggers(step: EditorStep): Obj[] {
    const triggers = step.activation.triggers ?? [];
    return pinnedEntities(step) ? triggers.slice(1) : triggers;
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
    // In a card, as Home Assistant's trigger rows, so it has their background.
    return html`<ha-card outlined class="pinned-card"
      ><ha-expansion-panel
        class="pinned"
        .expanded=${this._pinnedOpen}
        @expanded-changed=${(ev: CustomEvent<{ expanded: boolean }>) => {
          ev.stopPropagation();
          if (ev.target === ev.currentTarget)
            this._pinnedOpen = ev.detail.expanded;
        }}
        @expanded-will-change=${(ev: Event) => ev.stopPropagation()}
      >
        <ha-icon
          slot="leading-icon"
          class="builtin"
          icon="mdi:format-list-checks"
        ></ha-icon>
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
        ></nc-entities-form> </ha-expansion-panel
    ></ha-card>`;
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
    const rest = this._listTriggers(step);
    this._change({
      activation: { ...step.activation, triggers: [item, ...rest] },
    });
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
      start: {
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
          <ha-switch
            .checked=${show.activate_only_while_met}
            @change=${toggle("activate_only_while_met")}
          ></ha-switch>
          <ha-icon class="builtin" icon="mdi:play-circle-outline"></ha-icon>
          <div class="own-text">Activate only while conditions are met</div>
        </ha-card>
        <ha-card outlined class="own-row">
          <ha-switch
            .checked=${show.hide_while_not_met}
            @change=${toggle("hide_while_not_met")}
          ></ha-switch>
          <ha-icon class="builtin" icon="mdi:eye-off-outline"></ha-icon>
          <div class="own-text">
            Hide active notification while conditions are not met
          </div>
        </ha-card>
      </div>
      ${this._title("Conditions", "show")}
      <ha-automation-condition
        .hass=${this.hass}
        .narrow=${this.narrow}
        .conditions=${show.conditions}
        @value-changed=${(ev: CustomEvent<{ value: Obj[] }>) => {
          ev.stopPropagation();
          this._change({
            conditions: { ...show, conditions: ev.detail.value },
          });
        }}
      ></ha-automation-condition>
    </div>`;
  }

  // Done when activation conditions no longer true has something to watch:
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
      ${listed
        ? html`<ha-card outlined class="own-row">
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
            <ha-icon class="builtin" icon="mdi:format-list-checks"></ha-icon>
            <div class="own-text">
              Done when activation conditions no longer true
            </div>
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
            done_when: { ...step.done_when, triggers: ev.detail.value },
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

  private _setEntry(step: EditorStep, entry: Button, inherited: boolean): void {
    const buttons = [...step.buttons];
    const index = this._entryIndex(step, entry, inherited);
    if (index < 0) buttons.push(entry);
    else buttons[index] = entry;
    this._change({ buttons });
  }

  // The people whose states differ from the category's; the rest as there.
  private _renderAudience(step: EditorStep) {
    return html`<div class="block">
      <nc-audience-table
        .hass=${this.hass}
        .sleepers=${this.sleepers}
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
        .channels=${CHANNELS}
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
      ${this._title("Buttons", "interactions")} ${card(builtin)}
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
    if ((button.action?.type ?? "nothing") !== "nothing") {
      parts.push(actionText(this.hass, button.action));
    }
    const inherited = this._base(button);
    const entry = (): Button => {
      const index = this._entryIndex(step, button, button.category);
      return index >= 0
        ? step.buttons[index]
        : ({
            id: button.id,
            type: button.type,
            action: button.action,
          } as Button);
    };
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
        action: { type: "nothing" },
        show_in_push: true,
        confirm: false,
      },
    };
  }

  private _renderInteractionDialog(step: EditorStep) {
    const edit = this._interaction!;
    const otherPushButtons = effectiveButtons(this.category, step).filter(
      (button) =>
        !(button.type === edit.button.type && button.id === edit.button.id) &&
        !(
          edit.inherited &&
          edit.button.type !== "custom" &&
          button.type === edit.button.type
        ) &&
        button.enabled &&
        button.type !== "tap" &&
        button.show_in_push,
    ).length;
    return html`<nc-interaction-dialog
      .hass=${this.hass}
      .narrow=${this.narrow}
      .button=${edit.button}
      .inherited=${edit.inherited}
      .isNew=${edit.isNew}
      .entityActionSet=${this.entityActions.has(edit.button.id)}
      .otherPushButtons=${otherPushButtons}
      @interaction-closed=${(
        ev: CustomEvent<{ result?: Button | "delete" }>,
      ) => {
        ev.stopPropagation();
        this._interaction = undefined;
        const result = ev.detail.result;
        if (!result) return;
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
        this._setEntry(step, result, !!edit.inherited);
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

  static override styles = css`
    :host {
      display: flex;
      flex-direction: column;
      gap: 16px;
    }
    /* More room before Activation and after Done. */
    .group-gap {
      height: 0;
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
      align-items: flex-start;
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
    /* Close to the message they go in, more room before Info. */
    .chips {
      margin: -6px 0 6px;
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
      min-height: 32px;
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
    ha-card.pinned-card {
      overflow: hidden;
    }
    ha-expansion-panel.pinned {
      display: block;
      --expansion-panel-summary-padding: 0 8px 0 16px;
      /* The panel pads its content even while closed, so the form does. */
      --expansion-panel-content-padding: 0;
    }
    ha-expansion-panel.pinned nc-entities-form {
      padding: 16px;
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
      border-radius: var(--ha-border-radius-circle, 50%);
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
