// The forms of two built-in rows of a step:
//
// - Expiration, at the top of Done when and Dismiss when: the notification
//   closes by itself after a duration from when it became active, or on that
//   day (or N days later) at a time.
// - Notification state, at the top of Activation and Conditions on steps 2
//   and later: a state of a step of this notification (the previous one at
//   first), for a while. The same form edits Notification state triggers
//   and conditions in Home Assistant's rows, with a Notification field.

import { LitElement, css, html, nothing } from "lit";
import { customElement, property } from "lit/decorators.js";

import type { Duration } from "../../shared/config";
import type { HomeAssistant } from "../../shared/types";
import { field } from "../fields";
import { ANY_STEP, type Expires, type ExpiresOnDay, type Obj } from "./model";

// After a duration is shown in hours: days count as 24 hours each.
function inHours(expires: Duration): Duration {
  if (!expires.days) return expires;
  const { days, ...rest } = expires;
  return { ...rest, hours: (rest.hours ?? 0) + days * 24 };
}

type ExpiresKind = "never" | "after" | "on";

export function expiresKind(expires: Expires | null | undefined): ExpiresKind {
  return !expires ? "never" : "day" in expires ? "on" : "after";
}

function dayLabel(day: number): string {
  return day === 0 ? "Same day" : day === 1 ? "Next day" : `${day} days later`;
}

@customElement("nc-expires-form")
export class NcExpiresForm extends LitElement {
  @property({ attribute: false }) public hass?: HomeAssistant;

  @property({ attribute: false }) public value?: Expires | null;

  private _emit(value: Expires | null): void {
    this.dispatchEvent(new CustomEvent("value-changed", { detail: { value } }));
  }

  protected override render() {
    const expires = this.value ?? null;
    const kind = expiresKind(expires);
    const onDay = kind === "on" ? (expires as ExpiresOnDay) : undefined;
    const days = [0, 1, 2, 3, 4, 5, 6, 7];
    if (onDay && !days.includes(onDay.day)) days.push(onDay.day);
    return html`<div class="row">
      ${field(
        this.hass,
        {
          select: {
            mode: "dropdown",
            options: [
              { value: "never", label: "Not in use" },
              { value: "after", label: "After" },
              { value: "on", label: "On day" },
            ],
          },
        },
        kind,
        "Expiration",
        (value) => {
          if (value === kind) return;
          this._emit(
            value === "after" ? { hours: 6 } : value === "on" ? { day: 0, at: "23:59" } : null,
          );
        },
        { className: "mode" },
      )}
      ${kind === "after"
        ? field(
            this.hass,
            { duration: {} },
            inHours(expires as Duration),
            "",
            (value) => this._emit((value as Duration) || { hours: 6 }),
            { className: "grow" },
          )
        : nothing}
      ${onDay
        ? html`${field(
            this.hass,
            {
              select: {
                mode: "dropdown",
                options: days.map((day) => ({ value: String(day), label: dayLabel(day) })),
              },
            },
            String(onDay.day),
            "Day",
            (value) => this._emit({ ...onDay, day: Number(value) || 0 }),
            { className: "grow" },
          )}
          ${field(
            this.hass,
            { time: { no_second: true } },
            onDay.at,
            "At",
            (value) => this._emit({ ...onDay, at: (value as string) || "23:59" }),
            { className: "grow" },
          )}`
        : nothing}
    </div>`;
  }

  static override styles = css`
    :host {
      display: block;
      container-type: inline-size;
    }
    .row {
      display: flex;
      gap: 12px;
      flex-wrap: wrap;
      align-items: flex-start;
    }
    .row > * {
      min-width: 0;
    }
    .mode {
      flex: 0 1 200px;
    }
    .grow {
      flex: 1 1 150px;
    }
    /* On a phone the Expiration dropdown takes the whole width. */
    @container (max-width: 450px) {
      .mode {
        flex: 1 1 100%;
      }
    }
  `;
}

const STATES = [
  { value: "active", label: "Active" },
  { value: "done", label: "Done" },
  { value: "dismissed", label: "Dismissed" },
  { value: "snoozed", label: "Snoozed" },
];

/** True when the Notification state row tests something (a state is set). */
export function stateFilled(options: Obj | undefined): boolean {
  return !!options?.state;
}

// Finds the steps of a notification (their names) from its sensor; "" is
// the notification being edited. The editor sets it, since only it knows
// every notification and the draft.
let stepsResolver: (sensor: string) => string[] | undefined = () => undefined;

export function setStepsResolver(find: (sensor: string) => string[] | undefined): void {
  stepsResolver = find;
}

const NOTIFICATION_FIELD = {
  name: "notification",
  required: true,
  selector: { entity: { filter: { integration: "notification_center", domain: "sensor" } } },
};

// Conditions: in the state now (for at least a while), or reached it
// within the last while, even if it has left it since.
const TIME_FIELD = {
  name: "time",
  selector: {
    choose: {
      translation_key: "nc.state_time",
      choices: { now: { selector: { duration: {} } }, within: { selector: { duration: {} } } },
    },
  },
};

const OWN_LABELS: Record<string, string> = {
  "nc.state_time.choices.now": "Now, for at least",
  "nc.state_time.choices.within": "Within the last",
};

/**
 * The form of a Notification state trigger or condition: the built-in row
 * of a step (this notification, the previous step at first) and Home
 * Assistant's trigger and condition rows (with a Notification field).
 */
@customElement("nc-state-form")
export class NcStateForm extends LitElement {
  @property({ attribute: false }) public hass?: HomeAssistant;

  // The options: notification (its sensor, in a list row), step (its
  // number, or an id from an automation), state, for, within.
  @property({ attribute: false }) public value: Obj = {};

  // The built-in row: the step being edited (from 0) and how many there are.
  @property({ type: Number }) public stepIndex = 0;

  @property({ type: Number }) public stepCount = 1;

  // In Home Assistant's rows: ask for the notification.
  @property({ type: Boolean, attribute: "with-notification" }) public withNotification = false;

  // A condition: Now or Within the last; a trigger has For only.
  @property({ type: Boolean }) public condition = false;

  @property({ type: Boolean }) public disabled = false;

  private _emit(changes: Obj): void {
    const value: Obj = { ...this.value, ...changes };
    for (const key of Object.keys(value)) {
      if (value[key] === undefined || value[key] === null || value[key] === "") delete value[key];
    }
    this.dispatchEvent(new CustomEvent("value-changed", { detail: { value } }));
  }

  // The step shown: in the built-in row the previous one until a state is
  // chosen (a saved row without a step is any step).
  private _step(): string {
    const step = this.value.step;
    if (step !== undefined && step !== null && step !== "") return String(step);
    if (this.withNotification || this.value.state) return ANY_STEP;
    return String(this.stepIndex);
  }

  private _stepOptions(current: string) {
    const sensor = this.withNotification ? String(this.value.notification ?? "") : "";
    let names = stepsResolver(sensor);
    if (!names && !this.withNotification) {
      names = Array.from({ length: this.stepCount }, (_, index) => `Step ${index + 1}`);
    }
    const options = [{ value: ANY_STEP, label: "Any step" }];
    (names ?? []).forEach((name, index) => {
      const number = index + 1;
      // The built-in row does not offer its own step.
      if (!this.withNotification && number === this.stepIndex + 1) return;
      let label = name === `Step ${number}` ? name : `Step ${number} · ${name}`;
      if (!this.withNotification && number === this.stepIndex) label += " (previous)";
      options.push({ value: String(number), label });
    });
    // A step given by an id (an automation), or one the list does not know.
    if (!options.some((option) => option.value === current)) {
      options.push({ value: current, label: /^\d+$/.test(current) ? `Step ${current}` : current });
    }
    return options;
  }

  private _setStep(value: string): void {
    const step: unknown =
      value === ANY_STEP
        ? this.withNotification
          ? undefined
          : ANY_STEP
        : /^\d+$/.test(value)
          ? Number(value)
          : value;
    this._emit({ step });
  }

  protected override render() {
    if (!this.hass) return nothing;
    const step = this._step();
    const state = (this.value.state as string | undefined) ?? "";
    const within = this.condition && this.value.within !== undefined;
    return html`${this.withNotification
        ? html`<ha-form
            .hass=${this.hass}
            .data=${this.value}
            .schema=${[NOTIFICATION_FIELD]}
            .disabled=${this.disabled}
            .computeLabel=${() => "Notification"}
            @value-changed=${(ev: CustomEvent<{ value: Obj }>) => {
              ev.stopPropagation();
              const notification = ev.detail.value.notification;
              if (notification === this.value.notification) return;
              // The steps are another notification's: any step.
              this._emit({ notification, step: undefined });
            }}
          ></ha-form>`
        : nothing}
      <div class="row">
        ${field(
          this.hass,
          { select: { mode: "dropdown", options: this._stepOptions(step) } },
          step,
          "Step",
          (value) => this._setStep(String(value)),
          { className: "grow" },
        )}
        ${field(
          this.hass,
          { select: { mode: "dropdown", options: STATES } },
          state,
          "State",
          (value) => {
            const changes: Obj = { state: value };
            // The built-in row stores the step with the state, so it stays
            // the one shown.
            if (!this.withNotification && value && this.value.step === undefined) {
              changes.step = this.stepIndex;
            }
            this._emit(changes);
          },
          { className: "grow", clearable: !this.withNotification },
        )}
        ${this.condition
          ? nothing
          : field(
              this.hass,
              { duration: {} },
              this.value.for,
              "For",
              (value) => this._emit({ for: value }),
              { className: "grow" },
            )}
      </div>
      ${this.condition
        ? html`<ha-form
            .hass=${this.hass}
            .data=${{
              time: within
                ? { active_choice: "within", within: this.value.within }
                : { active_choice: "now", now: this.value.for },
            }}
            .schema=${[TIME_FIELD]}
            .disabled=${this.disabled}
            .computeLabel=${() => "When"}
            .localizeValue=${(key: string) => OWN_LABELS[key] ?? this.hass?.localize?.(key) ?? key}
            @value-changed=${this._timeChanged}
          ></ha-form>`
        : nothing}
      ${this.condition && !within && (state === "done" || state === "dismissed")
        ? html`<div class="help">
            Now counts only today's notifications: they are forgotten at midnight. For one done
            yesterday evening, use Within the last.
          </div>`
        : nothing}`;
  }

  private _timeChanged = (ev: CustomEvent<{ value: Obj }>): void => {
    ev.stopPropagation();
    const time = ev.detail.value.time as Obj | undefined;
    if (!time || typeof time !== "object") {
      this._emit({ for: undefined, within: undefined });
      return;
    }
    const choice = time.active_choice === "within" ? "within" : "now";
    // Switching keeps the duration.
    const duration = time[choice] ?? time[choice === "within" ? "now" : "within"];
    this._emit(
      choice === "within"
        ? { within: duration ?? { hours: 12 }, for: undefined }
        : { for: duration, within: undefined },
    );
  };

  static override styles = css`
    :host {
      display: flex;
      flex-direction: column;
      gap: 12px;
    }
    :host([with-notification]) {
      padding: 0 16px 16px;
    }
    .row {
      display: flex;
      gap: 12px;
      flex-wrap: wrap;
      align-items: flex-start;
    }
    .row > * {
      min-width: 0;
    }
    .grow {
      flex: 1 1 150px;
    }
    .help {
      color: var(--secondary-text-color);
      font-size: 0.875rem;
    }
  `;
}

declare global {
  interface HTMLElementTagNameMap {
    "nc-state-form": NcStateForm;
  }
}
