// The forms of two built-in rows of a step:
//
// - Expires, at the top of Done when and Dismiss when: the notification
//   closes by itself after a duration from when it became active, or on that
//   day (or N days later) at a time.
// - Notification state, at the top of Activation and Conditions on steps 2
//   and later: a state of a step of this notification (the previous one at
//   first), for a while.

import { LitElement, css, html, nothing } from "lit";
import { customElement, property } from "lit/decorators.js";

import type { Duration } from "../../shared/config";
import type { HomeAssistant } from "../../shared/types";
import { field } from "../fields";
import type { Expires, ExpiresOnDay, Obj } from "./model";

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
        "Expires",
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

@customElement("nc-state-form")
export class NcStateForm extends LitElement {
  @property({ attribute: false }) public hass?: HomeAssistant;

  // The options of the trigger or condition: step (its number), state, for.
  @property({ attribute: false }) public value: Obj = {};

  // The step being edited (from 0) and how many there are.
  @property({ type: Number }) public stepIndex = 0;

  @property({ type: Number }) public stepCount = 1;

  private _emit(changes: Obj): void {
    const value: Obj = { ...this.value, ...changes };
    for (const key of Object.keys(value)) {
      if (value[key] === undefined || value[key] === null || value[key] === "") delete value[key];
    }
    this.dispatchEvent(new CustomEvent("value-changed", { detail: { value } }));
  }

  protected override render() {
    const steps = Array.from({ length: this.stepCount }, (_, index) => index + 1)
      .filter((number) => number !== this.stepIndex + 1)
      .map((number) => ({
        value: String(number),
        label: number === this.stepIndex ? `Step ${number} (previous)` : `Step ${number}`,
      }));
    const step = this.value.step ?? this.stepIndex;
    return html`<div class="row">
      ${field(
        this.hass,
        { select: { mode: "dropdown", options: steps } },
        String(step),
        "Step",
        (value) => this._emit({ step: Number(value) }),
        { className: "grow" },
      )}
      ${field(
        this.hass,
        { select: { mode: "dropdown", options: STATES } },
        this.value.state ?? "",
        "State",
        (value) =>
          this._emit({
            state: value,
            // The step is stored with the state, so it stays the one shown.
            step: value ? step : undefined,
          }),
        { className: "grow", clearable: true },
      )}
      ${field(
        this.hass,
        { duration: {} },
        this.value.for,
        "For",
        (value) => this._emit({ for: value }),
        { className: "grow" },
      )}
    </div>`;
  }

  static override styles = css`
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
  `;
}
