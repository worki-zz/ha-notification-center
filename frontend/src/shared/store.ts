// One live copy of the Notification Center configuration and state per
// connection, shared by every card on the page.

import {
  DOMAIN,
  type ConfigMessage,
  type NotificationCenterConfig,
  type StateMessage,
} from "./config";
import type { HassConnection } from "./types";

export interface StoreData {
  config?: NotificationCenterConfig;
  // False until something was stored (a fresh install).
  hasData?: boolean;
  state?: StateMessage;
  error?: string;
}

type Listener = (data: StoreData) => void;

class Store {
  private readonly _listeners = new Set<Listener>();

  private _data: StoreData = {};

  private _unsubscribe: Promise<() => Promise<void>>[] = [];

  constructor(private readonly _connection: HassConnection) {}

  public add(listener: Listener): () => void {
    this._listeners.add(listener);
    if (this._listeners.size === 1) {
      this._start();
    } else {
      listener(this._data);
    }
    return () => {
      this._listeners.delete(listener);
      if (this._listeners.size === 0) {
        this._stop();
      }
    };
  }

  private _start(): void {
    const failed = (err: unknown) => {
      this._set({ error: err instanceof Error ? err.message : String((err as { message?: string })?.message ?? err) });
    };
    const config = this._connection.subscribeMessage<ConfigMessage>(
      (message) => this._set({ config: message.config, hasData: message.has_data }),
      { type: `${DOMAIN}/config/subscribe` },
    );
    const state = this._connection.subscribeMessage<StateMessage>(
      (message) => this._set({ state: message }),
      { type: `${DOMAIN}/state/subscribe` },
    );
    config.catch(failed);
    state.catch(failed);
    this._unsubscribe = [config, state];
  }

  private _stop(): void {
    for (const unsubscribe of this._unsubscribe) {
      void unsubscribe.then((stop) => stop()).catch(() => undefined);
    }
    this._unsubscribe = [];
    this._data = {};
  }

  private _set(changes: Partial<StoreData>): void {
    this._data = { ...this._data, ...changes };
    for (const listener of this._listeners) {
      listener(this._data);
    }
  }
}

const stores = new WeakMap<HassConnection, Store>();

/** Follow the Notification Center; returns the function that stops it. */
export function subscribeStore(connection: HassConnection, listener: Listener): () => void {
  let store = stores.get(connection);
  if (!store) {
    store = new Store(connection);
    stores.set(connection, store);
  }
  return store.add(listener);
}
