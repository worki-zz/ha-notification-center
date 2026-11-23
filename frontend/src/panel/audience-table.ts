// The Audience table of a category and of a step.

import { LitElement, html, nothing } from "lit";
import { customElement, property } from "lit/decorators.js";

import { type AudienceEntry, type AudienceState } from "../shared/config";
import type { HomeAssistant } from "../shared/types";

import { TABLE_STYLES } from "./table-styles";
import {
  STATE_NAMES,
  type PersonInfo,
  effectiveAudience,
  haPeople,
  personStates,
  visibleStates,
} from "./channel-helpers";

const STATE_HELP: Record<AudienceState, string> = {
  home: "At home and awake",
  sleep: "At home and asleep",
  away: "Not at home",
};


/** "As Home Assistant draws a person": the picture, or the initials. */
function avatar(person: PersonInfo) {
  if (customElements.get("ha-person-badge")) {
    return html`<ha-person-badge
      class="avatar"
      .person=${{ id: person.id, name: person.name, picture: person.picture }}
    ></ha-person-badge>`;
  }
  if (person.picture)
    return html`<img class="avatar" src=${person.picture} alt="" />`;
  const initials = person.name
    .trim()
    .split(/\s+/)
    .slice(0, 3)
    .map((part) => part.charAt(0))
    .join("")
    .toUpperCase();
  return html`<span class="avatar">${initials}</span>`;
}

// -- Audience ------------------------------------------------------------------

@customElement("nc-audience-table")
export class NcAudienceTable extends LitElement {
  @property({ attribute: false }) public hass?: HomeAssistant;

  // The category's audience (a step's table only): the step changes it.
  @property({ attribute: false }) public base?: Record<string, AudienceEntry>;

  // The audience being edited: the category's, or the step's own entries.
  @property({ attribute: false }) public value: Record<string, AudienceEntry> =
    {};

  // The people with a sleep condition: only they can be asleep, so only they
  // have a Sleep tick (no column at all when nobody has one).
  @property({ attribute: false }) public sleepers: string[] = [];

  // Each person's state now (a notification's editor only): the tick of
  // that state is green, and a person who gets the notification now has a
  // check on the avatar.
  @property({ attribute: false }) public personStates?: Record<string, AudienceState>;

  private get _isStep(): boolean {
    return this.base !== undefined;
  }

  private _emit(value: Record<string, AudienceEntry>): void {
    this.dispatchEvent(new CustomEvent("value-changed", { detail: { value } }));
  }

  private _effective(people: PersonInfo[]): Record<string, AudienceEntry> {
    const ids = people.map((person) => person.id);
    return this._isStep
      ? effectiveAudience(this.base, this.value, ids)
      : effectiveAudience(this.value, undefined, ids);
  }

  private _set(
    people: PersonInfo[],
    person: string,
    state: AudienceState,
    on: boolean,
  ): void {
    const effective = this._effective(people);
    const entry = { ...effective[person], [state]: on };
    if (this._isStep) {
      this._emit({ ...this.value, [person]: entry });
      return;
    }
    // A category lists everyone, so a person added later gets what they all
    // have in common, not what the first changes left.
    this._emit({ ...effective, [person]: entry });
  }

  private _reset(person: string): void {
    const value = { ...this.value };
    delete value[person];
    this._emit(value);
  }

  protected override render() {
    const people = haPeople(this.hass);
    if (!people.length) {
      return html`<p class="hint">
        No people in Home Assistant: the notifications go to everyone.
      </p>`;
    }
    const effective = this._effective(people);
    const states = visibleStates(this.sleepers);
    const nobody = people.every(
      (person) =>
        !personStates(person.id, this.sleepers).some(
          (state) => effective[person.id][state],
        ),
    );
    return html`
      <ha-card outlined>
        <div
          class="table"
          style="grid-template-columns: minmax(0, 1fr) repeat(${states.length}, minmax(56px, auto)) ${this
            ._isStep
            ? "48px"
            : ""}"
        >
          <div class="row head">
            <div class="cell name">Person</div>
            ${states.map(
              (state) =>
                html`<div class="cell tick" title=${STATE_HELP[state]}>
                  ${STATE_NAMES[state]}
                </div>`,
            )}
            ${this._isStep ? html`<div class="cell end"></div>` : nothing}
          </div>
          ${people.map((person) => {
            const entry = effective[person.id];
            const own = this._isStep && !!this.value[person.id];
            const now = this.personStates?.[person.id];
            const gets = !!now && entry[now];
            return html`<div class="row">
              <div class="cell name">
                <span class="avatar-wrap"
                  >${avatar(person)}${gets
                    ? html`<ha-icon class="gets" icon="mdi:check-circle" title="Gets it now"></ha-icon>`
                    : nothing}</span
                ><span class="name-text">${person.name}</span>
              </div>
              ${states.map((state) =>
                state === "sleep" && !this.sleepers.includes(person.id)
                  ? html`<div class="cell tick"></div>`
                  : html`<div class="cell tick">
                      <ha-checkbox
                        class=${state === now ? "now" : ""}
                        title=${state === now ? `${person.name} is ${STATE_NAMES[state].toLowerCase()} now` : ""}
                        .checked=${entry[state]}
                        .label=${`${person.name}: ${STATE_NAMES[state]}`}
                        @change=${(ev: Event) =>
                          this._set(
                            people,
                            person.id,
                            state,
                            (ev.target as HTMLInputElement).checked,
                          )}
                      ></ha-checkbox>
                    </div>`,
              )}
              ${this._isStep
                ? html`<div class="cell end">
                    ${own
                      ? html`<ha-icon-button
                          class="reset"
                          .label=${"Reset to the category's settings"}
                          @click=${() => this._reset(person.id)}
                        >
                          <ha-icon icon="mdi:restore"></ha-icon>
                        </ha-icon-button>`
                      : nothing}
                  </div>`
                : nothing}
            </div>`;
          })}
        </div>
      </ha-card>
      ${nobody
        ? html`<ha-alert alert-type="warning"
            >No condition ticked: nothing is sent.</ha-alert
          >`
        : nothing}
    `;
  }

  static override styles = TABLE_STYLES;
}

declare global {
  interface HTMLElementTagNameMap {
    "nc-audience-table": NcAudienceTable;
  }
}
