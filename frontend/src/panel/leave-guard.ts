// Back (the browser's, Android's gesture or a mouse button) on an editor
// with unsaved changes asks first, as the editor's own back button does.
//
// While the page has changes, one extra history entry (the same address)
// is on top of its own. Back takes the page to its own entry: the guard
// asks, and either puts the extra entry back (Stay) or goes back once more
// (Leave). The dialogs of the panel move in the history too (see
// dialog-back.ts): the extra entry is added only while none is open, and
// Back closes an open dialog before it reaches the guard.

import { navigate } from "../shared/live";
import { dialogsSettled } from "./dialog-back";

const MARK = "ncLeave";

type HistoryState = Record<string, unknown> | null;

// The extra entry. Home Assistant's dialogs, opened on top, keep the state
// of the entry under theirs as its oldState.
function marked(): boolean {
  const state = history.state as HistoryState;
  return !!(state?.[MARK] || (state?.oldState as HistoryState)?.[MARK]);
}

// One of the panel's dialogs, or one of Home Assistant's, is open.
function inDialog(): boolean {
  const state = history.state as HistoryState;
  return Number(state?.ncDialog ?? 0) > 0 || (!!state?.dialog && state.open === true);
}

export class LeaveGuard {
  // The extra entry is on top of the page's own.
  private _guarded = false;

  // Going back past the extra entry, then to this page (Leave, or the
  // editor navigating itself).
  private _then?: { path?: string; replace: boolean };

  private _asking = false;

  private _retry?: number;

  private _connected = false;

  constructor(
    private readonly _dirty: () => boolean,
    private readonly _confirm: () => Promise<boolean>,
  ) {}

  public connect(): void {
    this._connected = true;
    // Before Home Assistant's own handler, after the dialogs' one.
    window.addEventListener("popstate", this._popstate, true);
    window.addEventListener("beforeunload", this._beforeUnload);
    this.update();
  }

  public disconnect(): void {
    this._connected = false;
    window.removeEventListener("popstate", this._popstate, true);
    window.removeEventListener("beforeunload", this._beforeUnload);
    window.clearTimeout(this._retry);
  }

  /** After every update of the page: add the extra entry when it has changes. */
  public update(): void {
    if (!this._connected || this._guarded || this._asking || this._then || !this._dirty()) return;
    if (inDialog()) {
      // A dialog's entry is on top: once it has closed.
      window.clearTimeout(this._retry);
      this._retry = window.setTimeout(() => this.update(), 400);
      return;
    }
    history.pushState({ ...(history.state as object | null), [MARK]: true }, "");
    this._guarded = true;
  }

  /** Go to a page from the editor itself, without the extra entry. */
  public async navigate(path: string, replace = false): Promise<void> {
    await dialogsSettled();
    if (this._guarded && marked()) {
      this._then = { path, replace };
      history.back();
      return;
    }
    navigate(path, replace);
  }

  private _popstate = (ev: PopStateEvent): void => {
    if (!this._guarded || marked()) return;
    // Back reached the page's own entry: the address is the same, so Home
    // Assistant has nothing to do.
    ev.stopImmediatePropagation();
    this._guarded = false;
    const then = this._then;
    this._then = undefined;
    if (then) {
      if (then.path) navigate(then.path, then.replace);
      else history.back();
      return;
    }
    if (!this._dirty()) {
      // Saved meanwhile: Back goes on.
      history.back();
      return;
    }
    void this._ask();
  };

  private async _ask(): Promise<void> {
    this._asking = true;
    let leave: boolean;
    try {
      leave = await this._confirm();
      // The confirmation's own entry goes first.
      await dialogsSettled();
    } finally {
      this._asking = false;
    }
    if (!this._connected) return;
    if (leave) {
      // Past the page's own entry, to the page before.
      history.back();
    } else {
      this.update();
    }
  }

  private _beforeUnload = (ev: BeforeUnloadEvent): void => {
    if (this._dirty()) ev.preventDefault();
  };
}
