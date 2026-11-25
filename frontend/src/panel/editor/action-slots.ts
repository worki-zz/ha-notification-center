// The entity actions of an entity or an entity group: one Home Assistant
// action editor for every switched on button whose action is Entity action.
// An action written for a button that is now off stays, it only is not shown.

import { css, html, nothing } from "lit";

import type { HomeAssistant } from "../../shared/types";
import { restoreButton } from "../fields";
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
 * group's action until it is changed here; the restore button beside the
 * button brings the group's back.
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
          ${own
            ? restoreButton("Restore the group's action", () => {
                const next: Obj = { ...custom };
                delete next[slot.id];
                changed(next);
              })
            : nothing}
        </div>
        <ha-automation-action
          .hass=${hass}
          .narrow=${narrow}
          .actions=${actions}
          @value-changed=${(ev: CustomEvent<{ value: unknown[] }>) => {
            ev.stopPropagation();
            changed({ ...custom, [slot.id]: ev.detail.value });
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
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    min-height: 32px;
    margin-bottom: 8px;
  }
  .slot-head .slot-label {
    margin-bottom: 0;
  }
  .slot-head .restore {
    margin: -8px 0;
    color: var(--secondary-text-color);
  }
  .slots-empty {
    color: var(--secondary-text-color);
  }
`;
