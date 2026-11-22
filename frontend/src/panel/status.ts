// The status chip of a notification, the same in the list and the editor.

import { html, nothing } from "lit";

import type { Notification, NotificationState } from "../shared/config";

export interface Status {
  label: string;
  // green, yellow, purple or grey
  tone: "green" | "yellow" | "purple" | "grey";
}

/** Active, Upcoming, Snoozed or Disabled; nothing when idle. */
export function statusOf(
  notification: Pick<Notification, "enabled">,
  state: NotificationState | undefined,
): Status | undefined {
  if (!notification.enabled) return { label: "Disabled", tone: "grey" };
  switch (state?.state) {
    case "active":
      return { label: "Active", tone: "green" };
    case "snoozed":
      return { label: "Snoozed", tone: "yellow" };
    case "upcoming":
      return { label: "Upcoming", tone: "yellow" };
    default:
      return undefined;
  }
}

export function renderStatus(status: Status | undefined) {
  if (!status) return nothing;
  return html`<span class="status ${status.tone}">${status.label}</span>`;
}

// For the styles of the elements that show the chip.
export const STATUS_STYLES = `
  .status {
    display: inline-flex;
    align-items: center;
    height: 24px;
    padding: 0 10px;
    /* As Home Assistant's entity badges. */
    border-radius: var(--ha-badge-border-radius, 9999px);
    font-size: var(--ha-font-size-s, 12px);
    font-weight: var(--ha-font-weight-medium, 500);
    white-space: nowrap;
    flex: none;
  }
  .status.green {
    color: var(--green-color, #4caf50);
    background-color: rgb(from var(--green-color, #4caf50) r g b / 0.15);
  }
  .status.yellow {
    color: var(--amber-color, #ff9800);
    background-color: rgb(from var(--amber-color, #ff9800) r g b / 0.15);
  }
  .status.purple {
    color: var(--deep-purple-color, #673ab7);
    background-color: rgb(from var(--deep-purple-color, #673ab7) r g b / 0.15);
  }
  .status.grey {
    color: var(--secondary-text-color);
    background-color: var(--secondary-background-color, rgba(127, 127, 127, 0.15));
  }
`;
