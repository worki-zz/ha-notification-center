// The Schedule and Repeat starts of a step.
//
// Schedule follows the calendar: every N days, weeks (on weekdays), months
// (on a day) or years, at a time. Repeat comes N days, weeks, months or
// years after the step was last done. Both show when they come next.

import { LitElement, css, html, nothing, type PropertyValues } from "lit";
import { customElement, property, state } from "lit/decorators.js";

import { DOMAIN } from "../../shared/config";
import { errorText } from "../../shared/live";
import type { HomeAssistant } from "../../shared/types";
import { field } from "../fields";
import type { Schedule, Unit } from "./model";

const WEEKDAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];
const UNITS: Unit[] = ["days", "weeks", "months", "years"];
const SINGULAR: Record<Unit, string> = { days: "day", weeks: "week", months: "month", years: "year" };

export function defaultSchedule(kind: Schedule["type"], from?: Schedule): Schedule {
  if (kind === "calendar") {
    const unit = from?.unit ?? "weeks";
    const schedule: Schedule = {
      type: "calendar",
      every: typeof from?.every === "number" ? from.every : 1,
      unit,
      at: from?.at || "08:00",
    };
    const today = new Date();
    if (unit === "weeks") schedule.weekdays = [WEEKDAYS[(today.getDay() + 6) % 7]];
    if (unit === "months" || unit === "years") schedule.day_of_month = today.getDate();
    if (unit === "years") schedule.month = today.getMonth() + 1;
    return schedule;
  }
  return {
    type: "after_last_done",
    every: from?.every ?? 1,
    unit: from?.unit ?? "weeks",
    at: from?.at ?? null,
  };
}

interface Preview {
  next: string[];
  last_done: string | null;
}

@customElement("nc-schedule-editor")
export class NcScheduleEditor extends LitElement {
  @property({ attribute: false }) public hass?: HomeAssistant;

  @property({ attribute: false }) public schedule?: Schedule;

  @property() public notificationId?: string;

  @property() public stepId?: string;

  // The step is stored with this schedule: Next can be set.
  @property({ type: Boolean }) public saved = false;

  @state() private _preview?: Preview;

  @state() private _previewError?: string;

  @state() private _editNext = false;

  @state() private _nextValue = "";

  @state() private _nextError?: string;

  private _timer?: number;

  protected override willUpdate(changed: PropertyValues): void {
    if (changed.has("schedule") || changed.has("stepId")) {
      window.clearTimeout(this._timer);
      this._timer = window.setTimeout(() => void this._loadPreview(), 300);
    }
  }

  public override disconnectedCallback(): void {
    super.disconnectedCallback();
    window.clearTimeout(this._timer);
  }

  private async _loadPreview(): Promise<void> {
    const schedule = this.schedule;
    if (!this.hass || !schedule) return;
    try {
      this._preview = await this.hass.callWS<Preview>({
        type: `${DOMAIN}/schedule/preview`,
        schedule,
        ...(this.notificationId && this.stepId
          ? { notification_id: this.notificationId, step_id: this.stepId }
          : {}),
      });
      this._previewError = undefined;
    } catch (err) {
      this._preview = undefined;
      this._previewError = errorText(err);
    }
  }

  private _change(changes: Partial<Schedule>): void {
    const schedule = { ...this.schedule!, ...changes } as Schedule & Record<string, unknown>;
    for (const key of Object.keys(changes)) {
      if (schedule[key] === undefined) delete schedule[key];
    }
    this.dispatchEvent(new CustomEvent("value-changed", { detail: { value: schedule } }));
  }

  private _selector(
    selector: Record<string, unknown>,
    value: unknown,
    label: string,
    changed: (value: unknown) => void,
    extraClass = "",
  ) {
    return field(this.hass, selector, value, label, changed, { className: extraClass });
  }

  protected override render() {
    const schedule = this.schedule;
    if (!schedule) return nothing;
    const calendar = schedule.type === "calendar";
    const every = typeof schedule.every === "number" ? schedule.every : 1;
    const plural = every !== 1 || !calendar;
    return html`
      <div class="row every">
        ${calendar ? nothing : this._renderEveryMode(schedule)}
        ${typeof schedule.every === "string"
          ? this._selector(
              { entity: { domain: ["input_number", "number", "sensor", "counter"] } },
              schedule.every,
              "",
              (value) => this._change({ every: (value as string) || 1 }),
              "grow",
            )
          : this._selector(
              { number: { min: 1, max: 999, mode: "box" } },
              schedule.every,
              "Every",
              (value) => this._change({ every: Math.max(1, Number(value) || 1) }),
              "number",
            )}
        ${this._selector(
          {
            select: {
              mode: "dropdown",
              options: UNITS.map((unit) => ({
                value: unit,
                label: plural ? unit : SINGULAR[unit],
              })),
            },
          },
          schedule.unit,
          "Unit",
          (value) => this._unitChanged(value as Unit),
          "unit",
        )}
        ${calendar ? this._renderOn(schedule) : nothing}
        ${this._selector(
          { time: { no_second: true } },
          schedule.at ?? undefined,
          "",
          (value) => this._change({ at: (value as string) || (calendar ? "00:00" : null) }),
          "grow",
        )}
        ${calendar && every > 1
          ? this._selector(
              { date: {} },
              schedule.starting,
              "Starting",
              (value) => this._change({ starting: (value as string) || undefined }),
              "grow",
            )
          : nothing}
      </div>
      ${this._renderNext(schedule)}
      ${this._editNext ? this._renderNextDialog(schedule) : nothing}
    `;
  }

  private _renderEveryMode(schedule: Schedule) {
    return this._selector(
      {
        select: {
          mode: "dropdown",
          options: [
            { value: "number", label: "Manual" },
            { value: "entity", label: "Entity" },
          ],
        },
      },
      typeof schedule.every === "string" ? "entity" : "number",
      "Type",
      (value) => {
        if (value === "entity" && typeof schedule.every !== "string") {
          this._change({ every: "" as unknown as string });
        } else if (value === "number" && typeof schedule.every === "string") {
          this._change({ every: 1 });
        }
      },
      "mode",
    );
  }

  private _unitChanged(unit: Unit): void {
    const changes: Partial<Schedule> = {
      unit,
      weekdays: undefined,
      day_of_month: undefined,
      month: undefined,
    };
    if (this.schedule?.type === "calendar") {
      const today = new Date();
      if (unit === "weeks") changes.weekdays = [WEEKDAYS[(today.getDay() + 6) % 7]];
      if (unit === "months") changes.day_of_month = today.getDate();
      if (unit === "years") {
        changes.month = today.getMonth() + 1;
        changes.day_of_month = today.getDate();
      }
    }
    this._change(changes);
  }

  private _renderOn(schedule: Schedule) {
    if (schedule.unit === "weeks") {
      const days = schedule.weekdays ?? [];
      const names = WEEKDAYS.map((_day, index) =>
        new Intl.DateTimeFormat(this.hass?.language, { weekday: "short" }).format(
          new Date(2024, 0, 1 + index),
        ),
      );
      return html`<div class="field">
        <div class="days" role="group" aria-label="On">
          ${WEEKDAYS.map(
            (day, index) => html`<ha-button
              size="s"
              appearance=${days.includes(day) ? "accent" : "outlined"}
              variant=${days.includes(day) ? "brand" : "neutral"}
              @click=${() => {
                const next = days.includes(day)
                  ? days.filter((item) => item !== day)
                  : WEEKDAYS.filter((item) => item === day || days.includes(item));
                this._change({ weekdays: next.length ? next : days });
              }}
              >${names[index]}</ha-button
            >`,
          )}
        </div>
      </div>`;
    }
    if (schedule.unit === "days") return nothing;
    const dayOptions = [
      ...Array.from({ length: 31 }, (_item, index) => ({
        value: String(index + 1),
        label: String(index + 1),
      })),
      { value: "last", label: "Last day" },
    ];
    const day = this._selector(
      { select: { mode: "dropdown", options: dayOptions } },
      schedule.day_of_month === undefined ? undefined : String(schedule.day_of_month),
      "On day",
      (value) =>
        this._change({
          day_of_month: value === "last" ? "last" : value ? Number(value) : undefined,
        }),
      "grow",
    );
    if (schedule.unit === "months") return day;
    const months = Array.from({ length: 12 }, (_item, index) => ({
      value: String(index + 1),
      label: new Intl.DateTimeFormat(this.hass?.language, { month: "long" }).format(
        new Date(2024, index, 1),
      ),
    }));
    return html`
      ${this._selector(
        { select: { mode: "dropdown", options: months } },
        schedule.month === undefined ? undefined : String(schedule.month),
        "In",
        (value) => this._change({ month: value ? Number(value) : undefined }),
        "grow",
      )}
      ${day}
    `;
  }

  private _format(value: string, withWeekday: boolean, withTime: boolean): string {
    const date = new Date(value);
    const options: Intl.DateTimeFormatOptions = { month: "short", day: "numeric" };
    if (withWeekday) options.weekday = "short";
    if (date.getFullYear() !== new Date().getFullYear()) options.year = "numeric";
    if (withTime) {
      options.hour = "numeric";
      options.minute = "2-digit";
    }
    return new Intl.DateTimeFormat(this.hass?.language, options).format(date);
  }

  private _renderNext(schedule: Schedule) {
    if (this._previewError) {
      return html`<div class="next error">${this._previewError}</div>`;
    }
    const next = this._preview?.next ?? [];
    if (!this._preview) return html`<div class="next">&nbsp;</div>`;
    if (!next.length) return html`<div class="next">Not scheduled.</div>`;
    if (schedule.type === "calendar") {
      const [first, ...rest] = next;
      return html`<div class="next">
        <ha-icon icon="mdi:calendar-clock"></ha-icon>
        <span>
          Next: ${this._format(first, true, true)}${rest.length
            ? ` · then ${rest.map((item) => this._format(item, false, false)).join(", ")}`
            : ""}
        </span>
      </div>`;
    }
    return html`<div class="next">
      <ha-icon icon="mdi:calendar-clock"></ha-icon>
      <span>Next: ${this._format(next[0], true, true)}</span>
      <ha-icon-button
        .label=${"Set the next time"}
        .disabled=${!this.saved}
        title=${this.saved ? "Set the next time" : "Save the notification first"}
        @click=${this._openNext}
      >
        <ha-icon icon="mdi:pencil"></ha-icon>
      </ha-icon-button>
    </div>`;
  }

  private _openNext(): void {
    const next = this._preview?.next[0];
    const date = next ? new Date(next) : new Date();
    const pad = (value: number) => String(value).padStart(2, "0");
    const day = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
    this._nextValue = this.schedule?.at ? day : `${day} ${pad(date.getHours())}:${pad(date.getMinutes())}:00`;
    this._nextError = undefined;
    this._editNext = true;
  }

  private _renderNextDialog(schedule: Schedule) {
    return html`<ha-dialog
      open
      width="small"
      header-title="Next time"
      @closed=${(ev: Event) => {
        ev.stopPropagation();
        this._editNext = false;
      }}
    >
      <p class="hint">
        The step comes next at this ${schedule.at ? "date, at its At time" : "time"}. It is
        stored as when it was last done.
      </p>
      ${this._nextError ? html`<ha-alert alert-type="error">${this._nextError}</ha-alert>` : nothing}
      <ha-selector
        .hass=${this.hass}
        .selector=${schedule.at ? { date: {} } : { datetime: {} }}
        .value=${this._nextValue}
        .label=${"Next"}
        @value-changed=${(ev: CustomEvent<{ value: string }>) => {
          ev.stopPropagation();
          this._nextValue = ev.detail.value;
        }}
      ></ha-selector>
      <ha-dialog-footer slot="footer">
        <ha-button slot="secondaryAction" appearance="plain" @click=${() => (this._editNext = false)}>
          Cancel
        </ha-button>
        <ha-button slot="primaryAction" @click=${this._saveNext}>Save</ha-button>
      </ha-dialog-footer>
    </ha-dialog>`;
  }

  private async _saveNext(): Promise<void> {
    if (!this.hass || !this.notificationId || !this.stepId || !this._nextValue) return;
    let value = this._nextValue;
    if (value.includes(" ")) {
      // A local date and time from the selector.
      value = new Date(value.replace(" ", "T")).toISOString();
    }
    try {
      await this.hass.callWS({
        type: `${DOMAIN}/step/set_next`,
        notification_id: this.notificationId,
        step_id: this.stepId,
        next: value,
      });
      this._editNext = false;
      await this._loadPreview();
    } catch (err) {
      this._nextError = errorText(err);
    }
  }

  static override styles = css`
    :host {
      display: flex;
      flex-direction: column;
      gap: 12px;
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
    .number {
      flex: 0 0 96px;
    }
    .unit {
      flex: 0 0 130px;
    }
    .mode {
      flex: 0 1 200px;
    }
    .field {
      flex: 0 1 auto;
      min-width: 0;
    }
    .days {
      display: flex;
      align-items: center;
      min-height: 56px;
      gap: 6px;
      flex-wrap: wrap;
    }
    .next {
      display: flex;
      align-items: center;
      gap: 8px;
      min-height: 40px;
      color: var(--secondary-text-color);
    }
    .next ha-icon {
      --mdc-icon-size: 20px;
    }
    .next.error {
      color: var(--error-color);
    }
    .hint {
      margin-top: 0;
      color: var(--secondary-text-color);
    }
  `;
}

declare global {
  interface HTMLElementTagNameMap {
    "nc-schedule-editor": NcScheduleEditor;
  }
}
