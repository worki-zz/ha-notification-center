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

// Retry a failed subscription after these delays (the last one repeats).
const RETRY_MS = [1000, 2000, 5000, 10000, 30000];

function errorCode(err: unknown): string | undefined {
  const code = (err as { code?: unknown } | null)?.code;
  return typeof code === "string" ? code : undefined;
}

function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String((err as { message?: string } | null)?.message ?? err);
}

class Store {
  private readonly _listeners = new Set<Listener>();

  private _data: StoreData = {};

  private _unsubscribe: Promise<() => Promise<void>>[] = [];

  // Counts subscription attempts, so the answers of an old one are ignored.
  private _attempt = 0;

  private _failures = 0;

  private _retryTimer?: number;

  private readonly _onReady = () => {
    // Home Assistant came back: the old subscriptions died with the old
    // connection, subscribe again (the integration may still be loading).
    this._unsubscribe = [];
    this._failures = 0;
    this._subscribe();
  };

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
    this._connection.addEventListener?.("ready", this._onReady);
    this._failures = 0;
    this._subscribe();
  }

  private _subscribe(): void {
    window.clearTimeout(this._retryTimer);
    this._retryTimer = undefined;
    const attempt = ++this._attempt;
    const current = () => attempt === this._attempt;
    let failed = false;
    const fail = (err: unknown) => {
      if (!current() || failed) return;
      failed = true;
      this._cancel();
      // While Home Assistant starts, the integration's commands are not
      // there yet ("Unknown command"): stay as it is (Loading… at first)
      // and try again. Other errors show, and are tried again as well.
      if (errorCode(err) !== "unknown_command") {
        this._set({ error: errorMessage(err) });
      }
      const delay = RETRY_MS[Math.min(this._failures, RETRY_MS.length - 1)];
      this._failures += 1;
      this._retryTimer = window.setTimeout(() => {
        if (current()) this._subscribe();
      }, delay);
    };
    const config = this._connection.subscribeMessage<ConfigMessage>(
      (message) => {
        if (!current()) return;
        this._failures = 0;
        this._set({ config: message.config, hasData: message.has_data, error: undefined });
      },
      { type: `${DOMAIN}/config/subscribe` },
      { resubscribe: false },
    );
    const state = this._connection.subscribeMessage<StateMessage>(
      (message) => {
        if (!current()) return;
        this._set({ state: message, error: undefined });
      },
      { type: `${DOMAIN}/state/subscribe` },
      { resubscribe: false },
    );
    config.catch(fail);
    state.catch(fail);
    this._unsubscribe = [config, state];
  }

  private _cancel(): void {
    for (const unsubscribe of this._unsubscribe) {
      void unsubscribe.then((stop) => stop()).catch(() => undefined);
    }
    this._unsubscribe = [];
  }

  private _stop(): void {
    this._connection.removeEventListener?.("ready", this._onReady);
    window.clearTimeout(this._retryTimer);
    this._retryTimer = undefined;
    this._attempt += 1;
    this._cancel();
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
