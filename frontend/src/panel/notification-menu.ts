// The ... menu of a notification, the same in the Notifications list and
// in the editor's header: More info, Status, Run now for me, Run now for
// everyone, Dismiss notifications, Duplicate, (the editor's YAML switch),
// then Disable and Delete under a line.

import { html, nothing } from "lit";

import { DOMAIN } from "../shared/config";
import type { HomeAssistant } from "../shared/types";

export interface NotificationMenu {
  // Saved, with its sensor: More info, Status, Dismiss, Duplicate, Delete.
  saved: boolean;
  // Saved without changes and enabled: Run now.
  runnable: boolean;
  enabled: boolean;
  // " (step 2)" after Run now in a notification with more steps.
  stepText?: string;
  // The editor's YAML item: "yaml" (to YAML) or "visual" (back).
  yaml?: "yaml" | "visual";
  yamlDisabled?: boolean;
}

/** The items of the menu; the values are handled by the host. */
export function renderNotificationMenu(menu: NotificationMenu) {
  const step = menu.stepText ?? "";
  return html`
    <ha-dropdown-item value="more_info" .disabled=${!menu.saved}>
      <ha-icon slot="icon" icon="mdi:information-outline"></ha-icon>
      More info
    </ha-dropdown-item>
    <ha-dropdown-item value="info" .disabled=${!menu.saved}>
      <ha-icon slot="icon" icon="mdi:list-status"></ha-icon>
      Status
    </ha-dropdown-item>
    <ha-dropdown-item value="run_me" .disabled=${!menu.runnable}>
      <ha-icon slot="icon" icon="mdi:play"></ha-icon>
      Run now for me${step}
    </ha-dropdown-item>
    <ha-dropdown-item value="run" .disabled=${!menu.runnable}>
      <ha-icon slot="icon" icon="mdi:play-box-multiple-outline"></ha-icon>
      Run now for everyone${step}
    </ha-dropdown-item>
    <ha-dropdown-item value="dismiss" .disabled=${!menu.saved}>
      <ha-icon slot="icon" icon="mdi:notification-clear-all"></ha-icon>
      Dismiss notifications
    </ha-dropdown-item>
    <ha-dropdown-item value="duplicate" .disabled=${!menu.saved}>
      <ha-icon slot="icon" icon="mdi:content-duplicate"></ha-icon>
      Duplicate
    </ha-dropdown-item>
    ${menu.yaml === "visual"
      ? html`<ha-dropdown-item value="visual" .disabled=${!!menu.yamlDisabled}>
          <ha-icon slot="icon" icon="mdi:list-box-outline"></ha-icon>
          Edit in visual editor
        </ha-dropdown-item>`
      : menu.yaml === "yaml"
        ? html`<ha-dropdown-item value="yaml">
            <ha-icon slot="icon" icon="mdi:code-braces"></ha-icon>
            Edit in YAML
          </ha-dropdown-item>`
        : nothing}
    <wa-divider></wa-divider>
    <ha-dropdown-item value="toggle">
      <ha-icon
        slot="icon"
        .icon=${menu.enabled ? "mdi:stop-circle-outline" : "mdi:play-circle-outline"}
      ></ha-icon>
      ${menu.enabled ? "Disable" : "Enable"}
    </ha-dropdown-item>
    <ha-dropdown-item value="delete" variant="danger" .disabled=${!menu.saved}>
      <ha-icon slot="icon" icon="mdi:delete"></ha-icon>
      Delete
    </ha-dropdown-item>
  `;
}

/** Open Home Assistant's more info dialog of the notification's sensor. */
export function openMoreInfo(host: HTMLElement, entityId: string | undefined): void {
  if (!entityId) return;
  host.dispatchEvent(
    new CustomEvent("hass-more-info", { detail: { entityId }, bubbles: true, composed: true }),
  );
}

/** Run a step now (1: the first), for everyone or only the user. */
export async function runNow(
  hass: HomeAssistant,
  entityId: string | undefined,
  step: number,
  onlyMe: boolean,
): Promise<void> {
  if (!entityId) throw new Error("The notification's sensor is not there yet.");
  await hass.callService!(DOMAIN, "trigger", {
    entity_id: entityId,
    step,
    ...(onlyMe ? { only_me: true } : {}),
  });
}

/** Dismiss the open notifications of every step. */
export async function dismissAll(
  hass: HomeAssistant,
  entityId: string | undefined,
  steps: number,
): Promise<void> {
  if (!entityId) throw new Error("The notification's sensor is not there yet.");
  for (let step = 1; step <= steps; step++) {
    await hass.callService!(DOMAIN, "clear", { entity_id: entityId, step });
  }
}
