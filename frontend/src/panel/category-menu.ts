// The ... menu of a category, the same in the Categories list and in the
// category editor's header: N notifications (the Notifications list
// filtered to it), Duplicate, then Delete under a line.

import { type LitElement, html } from "lit";

import { DOMAIN, type Category, type NotificationCenterConfig } from "../shared/config";
import { navigate } from "../shared/live";
import type { HomeAssistant } from "../shared/types";
import { confirmDialog } from "./confirm";

export interface CategoryMenu {
  // Saved: N notifications and Duplicate.
  saved: boolean;
  // Its number of notifications.
  count: number;
  // General cannot be deleted.
  deletable: boolean;
}

/** "1 notification", "3 notifications". */
export function notificationCount(count: number): string {
  return count === 1 ? "1 notification" : `${count} notifications`;
}

/** The items of the menu; the values are handled by the host. */
export function renderCategoryMenu(menu: CategoryMenu) {
  return html`
    <ha-dropdown-item value="notifications" .disabled=${!menu.saved}>
      <ha-icon slot="icon" icon="mdi:format-list-bulleted"></ha-icon>
      ${notificationCount(menu.count)}
    </ha-dropdown-item>
    <ha-dropdown-item value="duplicate" .disabled=${!menu.saved}>
      <ha-icon slot="icon" icon="mdi:content-duplicate"></ha-icon>
      Duplicate
    </ha-dropdown-item>
    <wa-divider></wa-divider>
    <ha-dropdown-item value="delete" variant="danger" .disabled=${!menu.saved || !menu.deletable}>
      <ha-icon slot="icon" icon="mdi:delete"></ha-icon>
      Delete
    </ha-dropdown-item>
  `;
}

/** Open the Notifications list filtered to the category. */
export function viewCategoryNotifications(base: string, categoryId: string): void {
  navigate(`${base}/settings/notifications?category=${encodeURIComponent(categoryId)}`);
}

/** Copy a category (as "Name (copy)") at the end of the list; returns the copy. */
export async function duplicateCategory(
  hass: HomeAssistant,
  config: NotificationCenterConfig,
  category: Category,
): Promise<Category> {
  const names = new Set(config.categories.map((item) => item.name.toLocaleLowerCase()));
  const base = `${category.name} (copy)`;
  let name = base;
  for (let number = 2; names.has(name.toLocaleLowerCase()); number++) {
    name = `${category.name} (copy ${number})`;
  }
  const data: Record<string, unknown> = { ...structuredClone(category), name };
  delete data.id;
  return hass.callWS<Category>({ type: `${DOMAIN}/item/create`, section: "categories", data });
}

/**
 * Delete a category after asking. One with notifications cannot be deleted:
 * the dialog says so and offers its notifications instead. Returns whether
 * it was deleted.
 */
export async function deleteCategory(
  host: LitElement,
  hass: HomeAssistant,
  config: NotificationCenterConfig,
  category: Category,
  base: string,
): Promise<boolean> {
  const count = config.notifications.filter((item) => item.category === category.id).length;
  if (count) {
    if (
      await confirmDialog(host, {
        title: `${category.name} has ${notificationCount(count)}`,
        text: "Move its notifications to another category or delete them, then delete the category.",
        confirm: "View notifications",
      })
    ) {
      viewCategoryNotifications(base, category.id);
    }
    return false;
  }
  if (
    !(await confirmDialog(host, {
      title: `Delete ${category.name}?`,
      confirm: "Delete",
      destructive: true,
    }))
  ) {
    return false;
  }
  await hass.callWS({ type: `${DOMAIN}/item/delete`, section: "categories", item_id: category.id });
  return true;
}
