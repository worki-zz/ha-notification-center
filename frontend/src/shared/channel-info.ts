// The channels of the Notification Center: Dashboard, Push, the lights,
// the speakers and the sirens, with their names and icons. Shared by the
// settings and the Status of a notification (also on a dashboard).

import { html } from "lit";

import { CHANNEL_DASHBOARD, CHANNEL_PUSH, type NotificationCenterConfig } from "./config";
import type { HassEntity, HomeAssistant } from "./types";

export type ChannelKind = "dashboard" | "push" | "light" | "speaker" | "siren";

export interface ChannelInfo {
  key: string;
  name: string;
  icon: string;
  kind?: ChannelKind;
  entity_id?: string;
}

const KIND_ICONS: Record<ChannelKind, string> = {
  dashboard: "mdi:view-dashboard-outline",
  push: "mdi:cellphone-message",
  light: "mdi:lightbulb-outline",
  speaker: "mdi:speaker",
  siren: "mdi:alarm-light-outline",
};

/** The entity's name in Home Assistant, or its entity id. */
export function entityName(hass: HomeAssistant | undefined, entityId: string): string {
  const state = hass?.states[entityId];
  return String(state?.attributes.friendly_name ?? entityId);
}

export function entityState(hass: HomeAssistant | undefined, entityId: string | undefined): HassEntity | undefined {
  return entityId ? hass?.states[entityId] : undefined;
}

/** The channels in their order: Dashboard, Push, the lights, the speakers, the sirens. */
export function channelsOf(
  hass: HomeAssistant | undefined,
  config: NotificationCenterConfig | undefined,
): ChannelInfo[] {
  const channels: ChannelInfo[] = [
    { key: CHANNEL_DASHBOARD, name: "Dashboard", icon: KIND_ICONS.dashboard, kind: "dashboard" },
    { key: CHANNEL_PUSH, name: "Push", icon: KIND_ICONS.push, kind: "push" },
  ];
  const add = (items: { id: string; entity_id: string }[] | undefined, kind: ChannelKind) => {
    for (const item of items ?? []) {
      channels.push({
        key: `${kind}:${item.id}`,
        name: entityName(hass, item.entity_id),
        icon: KIND_ICONS[kind],
        kind,
        entity_id: item.entity_id,
      });
    }
  };
  add(config?.lights, "light");
  add(config?.speakers, "speaker");
  add(config?.sirens, "siren");
  return channels;
}

/** The icon of a channel: its entity's own icon, as Home Assistant shows it. */
export function channelIcon(hass: HomeAssistant | undefined, channel: ChannelInfo) {
  const stateObj = entityState(hass, channel.entity_id);
  if (stateObj && customElements.get("ha-state-icon")) {
    return html`<ha-state-icon class="channel-icon" .hass=${hass} .stateObj=${stateObj}></ha-state-icon>`;
  }
  return html`<ha-icon class="channel-icon" .icon=${channel.icon}></ha-icon>`;
}

