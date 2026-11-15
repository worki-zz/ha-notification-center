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

export interface HomeAssistant {
  user?: HassUser;
  language: string;
  themes?: { darkMode?: boolean };
  connection: HassConnection;
  callWS<T>(message: HassMessage): Promise<T>;
}

export interface PanelInfo {
  url_path: string;
  title: string | null;
  config: Record<string, unknown>;
}

export interface CardConfig {
  type: string;
}

// Entry in the dashboard card picker.
export interface CustomCardEntry {
  type: string;
  name: string;
  description?: string;
  preview?: boolean;
  documentationURL?: string;
}

declare global {
  interface Window {
    customCards?: CustomCardEntry[];
  }
}
