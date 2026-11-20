// The entity actions of an entity or an entity group: one Home Assistant
// action editor for every switched on button whose action is Entity action.
// An action written for a button that is now off stays, it only is not shown.

import { css, html, nothing } from "lit";

import type { HomeAssistant } from "../../shared/types";
import type { ActionSlot, Obj } from "./model";

export function renderActionSlots(
  hass: HomeAssistant | undefined,
  narrow: boolean,
  slots: ActionSlot[],
  actions: Obj | undefined,
  changed: (actions: Obj) => void,
  title = true,
) {
  return html`<div class="slots">
    ${title ? html`<div class="slots-title">Entity actions</div>` : nothing}
    ${slots.length
      ? slots.map(
          (slot) =>
            html`<div class="slot">
              <div class="slot-label">${slot.label}</div>
              <ha-automation-action
                .hass=${hass}
                .narrow=${narrow}
                .actions=${(actions?.[slot.id] as unknown[] | undefined) ?? []}
                @value-changed=${(ev: CustomEvent<{ value: unknown[] }>) => {
                  ev.stopPropagation();
                  const next: Obj = { ...(actions ?? {}) };
                  if (ev.detail.value.length) next[slot.id] = ev.detail.value;
                  else delete next[slot.id];
                  changed(next);
                }}
              ></ha-automation-action>
            </div>`,
        )
      : html`<div class="slots-empty">No interaction uses Entity action.</div>`}
  </div>`;
}

/**
 * The entity actions of a member of an entity group: for each button the
 * group's action, or with Custom action switched on its own one (it starts
 * as a copy of the group's).
 */
export function renderMemberSlots(
  hass: HomeAssistant | undefined,
  narrow: boolean,
  slots: ActionSlot[],
  groupActions: Obj | undefined,
  custom: Obj,
  changed: (custom: Obj) => void,
) {
  if (!slots.length) return html`<div class="slots-empty">No interaction uses Entity action.</div>`;
  return html`<div class="slots">
    ${slots.map((slot) => {
      const own = slot.id in custom;
      const actions = ((own ? custom[slot.id] : groupActions?.[slot.id]) as unknown[] | undefined) ?? [];
      return html`<div class="slot">
        <div class="slot-head">
          <div class="slot-label">${slot.label}</div>
          <label class="slot-custom">
            <ha-switch
              .checked=${own}
              @change=${(ev: Event) => {
                const next: Obj = { ...custom };
                if ((ev.target as HTMLInputElement).checked) {
                  next[slot.id] = structuredClone((groupActions?.[slot.id] as unknown[] | undefined) ?? []);
                } else {
                  delete next[slot.id];
                }
                changed(next);
              }}
            ></ha-switch>
            <span>Custom action</span>
          </label>
        </div>
        <ha-automation-action
          .hass=${hass}
          .narrow=${narrow}
          .disabled=${!own}
          .actions=${actions}
          @value-changed=${(ev: CustomEvent<{ value: unknown[] }>) => {
            ev.stopPropagation();
            if (own) changed({ ...custom, [slot.id]: ev.detail.value });
          }}
        ></ha-automation-action>
      </div>`;
    })}
  </div>`;
}

export const ACTION_SLOT_STYLES = css`
  .slots {
    display: flex;
    flex-direction: column;
    gap: 12px;
  }
  /* Stronger than the actions listed under them. */
  .slots-title {
    font-size: var(--ha-font-size-l, 18px);
    font-weight: var(--ha-font-weight-medium, 500);
  }
  .slot-label {
    margin-bottom: 8px;
    font-weight: var(--ha-font-weight-medium, 500);
  }
  .slot-head {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 8px;
    margin-bottom: 8px;
  }
  .slot-head .slot-label {
    margin-bottom: 0;
  }
  .slot-custom {
    display: flex;
    align-items: center;
    gap: 12px;
    cursor: pointer;
  }
  .slots-empty {
    color: var(--secondary-text-color);
  }
`;
