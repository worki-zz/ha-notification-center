// The parts of the Home Assistant frontend objects this code uses.
// Home Assistant does not publish these types, so only what is needed is declared.

export interface HassUser {
  id: string;
  name: string;
  is_admin: boolean;
}

export interface HassMessage {
  type: string;
  [key: string]: unknown;
}

export interface HassConnection {
  subscribeMessage<T>(
    callback: (message: T) => void,
    message: HassMessage,
  ): Promise<() => Promise<void>>;
}

export interface HassEntity {
  entity_id: string;
  state: string;
  attributes: Record<string, unknown>;
  last_changed: string;
  last_updated: string;
}

// Entity registry entry as the frontend has it (`hass.entities`).
export interface HassEntityEntry {
  entity_id: string;
  name?: string | null;
  icon?: string | null;
  platform?: string;
  device_id?: string | null;
  area_id?: string | null;
  labels?: string[];
}

export interface HassDevice {
  id: string;
  name?: string | null;
  name_by_user?: string | null;
  area_id?: string | null;
  labels?: string[];
  // The device this one is part of (older Home Assistant: via_device_id).
  parent_device_id?: string | null;
  via_device_id?: string | null;
}

export interface HassArea {
  area_id: string;
  name: string;
  floor_id?: string | null;
}

export interface HassFloor {
  floor_id: string;
  name: string;
}

export interface HassLocale {
  language: string;
  time_format?: string;
  // "language" or a weekday name such as "monday".
  first_weekday?: string;
}

export interface HomeAssistant {
  user?: HassUser;
  language: string;
  locale?: HassLocale;
  themes?: { darkMode?: boolean };
  connection: HassConnection;
  states: Record<string, HassEntity>;
  entities?: Record<string, HassEntityEntry>;
  devices?: Record<string, HassDevice>;
  areas?: Record<string, HassArea>;
  floors?: Record<string, HassFloor>;
  callWS<T>(message: HassMessage): Promise<T>;
  callService?(
    domain: string,
    service: string,
    data?: Record<string, unknown>,
  ): Promise<unknown>;
  formatEntityState?(stateObj: HassEntity, state?: string): string;
  formatEntityAttributeValue?(stateObj: HassEntity, attribute: string): string;
  formatEntityAttributeName?(stateObj: HassEntity, attribute: string): string;
  localize?(key: string, ...args: unknown[]): string;
}

export interface PanelInfo {
  url_path: string;
  title: string | null;
  config: Record<string, unknown>;
}

export interface CardConfig {
  type: string;
}

// A Home Assistant action, as the action selector writes it.
export interface ActionConfig {
  action: string;
  [key: string]: unknown;
}

// Entry in the dashboard card picker.
export interface CustomCardEntry {
  type: string;
  name: string;
  description?: string;
  preview?: boolean;
  documentationURL?: string;
}

// The card helpers of the dashboard (`window.loadCardHelpers`).
export interface CardHelpers {
  createCardElement(config: Record<string, unknown>): HTMLElement;
  createBadgeElement?(config: Record<string, unknown>): HTMLElement;
}

declare global {
  interface Window {
    customCards?: CustomCardEntry[];
    // Entries in the dashboard badge picker.
    customBadges?: CustomCardEntry[];
    loadCardHelpers?: () => Promise<CardHelpers>;
  }
}
