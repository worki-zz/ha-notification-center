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
  .slots-empty {
    color: var(--secondary-text-color);
  }
`;
