// One step of a notification: its message, how it starts, when it hides
// and when it is done. Starts, conditions and Done when are Home
// Assistant's own trigger and condition editors.

import { LitElement, css, html, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";

import { field } from "../fields";
import { PLACEHOLDERS } from "../../shared/text";
import type { HomeAssistant } from "../../shared/types";
import { type DataType, type EditorStep, type Obj, type Schedule, type StepData, startsWithListed } from "./model";
import { defaultSchedule } from "./schedule-editor";
import "./block";
import "./schedule-editor";

type StartKind = "triggers" | "schedule" | "repeat";

const HELP: Record<StartKind | "conditions" | "hide" | "done", { title: string; text: string[] }> = {
  triggers: {
    title: "Triggers",
    text: [
      "The step starts when one of its triggers fires, like an automation.",
      "With the Listed entities trigger every entity of the Entities block gets its own card when it starts to match.",
      "Notification state starts the step when this or another notification (or one of its steps) reaches a state, for example when step 1 is snoozed.",
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
      "Start condition no longer true: with Listed entities, an entity's card closes when that entity stops matching (the leak is dry again).",
    ],
  },
};

const DATA_OPTIONS: { value: DataType; label: string }[] = [
  { value: "none", label: "Nothing" },
  { value: "active_since", label: "Active since" },
  { value: "due", label: "Due" },
  { value: "last_done", label: "Last done" },
  { value: "state", label: "Entity state" },
  { value: "attribute", label: "Entity attribute" },
  { value: "last_changed", label: "Entity last changed" },
  { value: "custom", label: "Custom text" },
];

const TIME_TYPES: DataType[] = ["active_since", "due", "last_done", "last_changed"];

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

  @state() private _help?: keyof typeof HELP;

  // The text field the entity parameters go into.
  private _field: "message" | "info" = "message";

  private _emit(step: EditorStep): void {
    this.dispatchEvent(new CustomEvent("value-changed", { detail: { value: step } }));
  }

  private _change(changes: Partial<EditorStep>): void {
    this._emit({ ...this.step!, ...changes });
  }

  private _panel(block: StepBlock, header: string, secondary: string, content: unknown) {
    return html`<nc-block
      .header=${header}
      .secondary=${secondary}
      .expanded=${this.expanded.has(block)}
      @toggled=${(ev: CustomEvent<{ expanded: boolean }>) => {
        ev.stopPropagation();
        this.dispatchEvent(
          new CustomEvent("block-toggled", { detail: { block, expanded: ev.detail.expanded } }),
        );
      }}
    >
      ${this.expanded.has(block) ? content : nothing}
    </nc-block>`;
  }

  protected override render() {
    const step = this.step;
    if (!step) return nothing;
    return html`
      ${this._panel("message", "Message", this._messageSummary(step), this._renderMessage(step))}
      ${this._panel("start", "Start", this._startSummary(step), this._renderStart(step))}
      ${this._panel(
        "hide",
        "Hide while",
        step.hide_while.length ? `${step.hide_while.length} conditions` : "Always shown",
        this._renderHide(step),
      )}
      ${this._panel("done", "Done when", this._doneSummary(step), this._renderDone(step))}
      ${this._help ? this._renderHelp(this._help) : nothing}
    `;
  }

  // -- Summaries -------------------------------------------------------------

  private _messageSummary(step: EditorStep): string {
    return step.message || "No message yet";
  }

  private _kind(step: EditorStep): StartKind {
    if (step.start.type === "triggers") return "triggers";
    return step.start.schedule?.type === "after_last_done" ? "repeat" : "schedule";
  }

  private _startSummary(step: EditorStep): string {
    const kind = this._kind(step);
    if (kind === "triggers") {
      const count = step.start.triggers?.length ?? 0;
      return count ? `Triggers · ${count}` : "Only by the trigger action";
    }
    const schedule = step.start.schedule!;
    const every = typeof schedule.every === "number" ? schedule.every : "N";
    const unit = every === 1 ? schedule.unit.replace(/s$/, "") : schedule.unit;
    return kind === "schedule"
      ? `Schedule · every ${every === 1 ? "" : `${every} `}${unit}${schedule.at ? ` at ${schedule.at}` : ""}`
      : `Repeat · ${every} ${unit} after done`;
  }

  private _doneSummary(step: EditorStep): string {
    const parts: string[] = [];
    if (step.done_when.start_no_longer_true && startsWithListed(step)) {
      parts.push("start no longer true");
    }
    if (step.done_when.triggers.length) parts.push(`${step.done_when.triggers.length} triggers`);
    return parts.length ? parts.join(" · ") : "Only by the Done button";
  }

  // -- Message -------------------------------------------------------------

  private _renderMessage(step: EditorStep) {
    const data = step.data ?? { type: "none" };
    return html`<div class="block">
      <ha-selector
        class="message"
        .hass=${this.hass}
        .selector=${{ text: { multiline: true } }}
        .value=${step.message}
        .label=${"Message"}
        .required=${false}
        @focusin=${() => (this._field = "message")}
        @value-changed=${(ev: CustomEvent<{ value?: string }>) => {
          ev.stopPropagation();
          this._change({ message: ev.detail.value ?? "" });
        }}
      ></ha-selector>
      <ha-selector
        class="info"
        .hass=${this.hass}
        .selector=${{ text: {} }}
        .value=${step.info ?? ""}
        .label=${"Info"}
        .required=${false}
        .helper=${"A second line, smaller."}
        @focusin=${() => (this._field = "info")}
        @value-changed=${(ev: CustomEvent<{ value?: string }>) => {
          ev.stopPropagation();
          this._change({ info: ev.detail.value || null });
        }}
      ></ha-selector>
      <div class="chips">
        <span class="chips-label">Entity parameters</span>
        ${PLACEHOLDERS.map(
          (name) => html`<ha-assist-chip
            .label=${name}
            @mousedown=${(ev: Event) => ev.preventDefault()}
            @click=${() => this._insert(`{${name}}`)}
          ></ha-assist-chip>`,
        )}
      </div>
      <div class="row">
        ${this._selector(
          { select: { mode: "dropdown", options: DATA_OPTIONS } },
          data.type,
          "Data after the label",
          (value) => this._dataChanged({ type: (value as DataType) || "none" }),
        )}
        ${TIME_TYPES.includes(data.type)
          ? this._selector(
              { select: { mode: "dropdown", options: FORMATS } },
              data.format ?? "relative",
              "Format",
              (value) => this._dataChanged({ format: (value as StepData["format"]) ?? null }),
            )
          : nothing}
      </div>
      ${["state", "attribute", "last_changed"].includes(data.type)
        ? html`<div class="row">
            ${this._selector(
              { entity: {} },
              data.entity_id ?? undefined,
              "Entity",
              (value) => this._dataChanged({ entity_id: (value as string) || null }),
              "The card's entity when empty.",
            )}
            ${data.type === "attribute"
              ? this._selector(
                  { attribute: { entity_id: data.entity_id ?? undefined } },
                  data.attribute ?? undefined,
                  "Attribute",
                  (value) => this._dataChanged({ attribute: (value as string) || null }),
                )
              : nothing}
          </div>`
        : nothing}
      ${data.type === "custom"
        ? this._selector(
            { text: {} },
            data.text ?? "",
            "Text",
            (value) => this._dataChanged({ text: (value as string) || null }),
            "A template; the entity parameters work too.",
          )
        : nothing}
    </div>`;
  }

  private _dataChanged(changes: Partial<StepData>): void {
    const data: StepData = { ...(this.step!.data ?? { type: "none" }), ...changes };
    const clean: StepData = { type: data.type };
    if (TIME_TYPES.includes(data.type) && data.format) clean.format = data.format;
    if (["state", "attribute", "last_changed"].includes(data.type) && data.entity_id) {
      clean.entity_id = data.entity_id;
    }
    if (data.type === "attribute" && data.attribute) clean.attribute = data.attribute;
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
    helper?: string,
  ) {
    return field(this.hass, selector, value, label, changed, { helper });
  }

  // -- Start -----------------------------------------------------------------

  private _renderStart(step: EditorStep) {
    const kind = this._kind(step);
    return html`<div class="block">
      <ha-button-toggle-group
        full-width
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
        ? html`<ha-automation-trigger
            .hass=${this.hass}
            .narrow=${this.narrow}
            .triggers=${step.start.triggers ?? []}
            @value-changed=${(ev: CustomEvent<{ value: Obj[] }>) => {
              ev.stopPropagation();
              this._change({ start: { ...step.start, triggers: ev.detail.value } });
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
    const listed = startsWithListed(step);
    return html`<div class="block">
      ${this._title("Triggers", "done")}
      ${listed
        ? html`<ha-card outlined class="own-row">
            <ha-icon icon="mdi:format-list-checks"></ha-icon>
            <div class="own-text">
              <div>Start condition no longer true</div>
              <div class="secondary">
                An entity's card closes when that entity stops matching the Listed entities trigger.
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
      padding: 8px 0 8px;
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
      font-size: var(--ha-font-size-s, 12px);
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
