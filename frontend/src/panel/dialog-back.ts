// Back (the browser's, Android's or a mouse button) closes the open dialog
// of the panel instead of leaving the page, as Home Assistant's own dialogs
// do. Each dialog of the panel adds a history entry when it opens, and
// takes it away again when it closes another way.
//
// Home Assistant's own dialogs (such as Add action, opened from one of
// ours) move in the history themselves: while one is open, and a moment
// after, Back is theirs; then our entries are put back as needed.

type Dialog = HTMLElement & { open: boolean };

const openDialogs: Dialog[] = [];
let skip = 0;
let waiting: (() => void)[] = [];

/**
 * Resolves once the history entry of a dialog that just closed is gone, so
 * a page opened right after a dialog is not taken back by it.
 */
export function dialogsSettled(): Promise<void> {
  if (!skip) return Promise.resolve();
  return new Promise((resolve) => waiting.push(resolve));
}

function settle(): void {
  if (skip) return;
  const done = waiting;
  waiting = [];
  for (const resolve of done) resolve();
}
// Home Assistant's dialogs opened over ours; they do not always say when
// they close, so they are looked at when needed.
// One that has just closed still moves in the history for a moment.
const foreignDialogs: Dialog[] = [];
let foreignUntil = 0;

function foreignOpen(): boolean {
  for (let i = foreignDialogs.length - 1; i >= 0; i--) {
    const dialog = foreignDialogs[i];
    if (!dialog.isConnected || !dialog.open) {
      foreignDialogs.splice(i, 1);
      foreignUntil = Date.now() + 1000;
    }
  }
  return foreignDialogs.length > 0 || Date.now() < foreignUntil;
}

function isDialog(ev: Event): HTMLElement | undefined {
  const dialog = ev.composedPath()[0];
  return dialog instanceof HTMLElement && dialog.tagName === "HA-DIALOG" ? dialog : undefined;
}

function isOurs(ev: Event): boolean {
  return ev
    .composedPath()
    .some(
      (item) =>
        item instanceof HTMLElement &&
        (item.tagName.startsWith("NC-") || item.tagName.startsWith("NOTIFICATION-CENTER-")),
    );
}

function depth(): number {
  return Number((history.state as { ncDialog?: number } | null)?.ncDialog ?? 0);
}

function push(): void {
  history.pushState({ ...(history.state as object | null), ncDialog: openDialogs.length }, "");
  watch();
}

// A dialog that is taken away without closing (its page drew it no more):
// its entry goes too. Looked at only while one of ours is open.
let watcher: number | undefined;

function watch(): void {
  if (watcher !== undefined) return;
  watcher = window.setInterval(() => {
    const gone = openDialogs.filter((dialog) => !dialog.isConnected);
    for (const dialog of gone) openDialogs.splice(openDialogs.indexOf(dialog), 1);
    if (gone.length && !foreignOpen() && depth() > openDialogs.length) {
      skip++;
      history.back();
    }
    if (!openDialogs.length) {
      window.clearInterval(watcher);
      watcher = undefined;
    }
  }, 300);
}

// After a Home Assistant dialog: one entry for each of ours still open.
function resync(): void {
  for (let i = openDialogs.length - 1; i >= 0; i--) {
    if (!openDialogs[i].isConnected) openDialogs.splice(i, 1);
  }
  if (foreignOpen()) {
    window.setTimeout(resync, 500);
    return;
  }
  if (!openDialogs.length || depth() >= openDialogs.length) return;
  push();
}

window.addEventListener(
  "opened",
  (ev) => {
    const dialog = isDialog(ev) as Dialog | undefined;
    if (!dialog) return;
    if (!isOurs(ev)) {
      if (openDialogs.length && !foreignDialogs.includes(dialog)) foreignDialogs.push(dialog);
      return;
    }
    if (openDialogs.includes(dialog)) return;
    openDialogs.push(dialog);
    push();
  },
  true,
);

window.addEventListener(
  "closed",
  (ev) => {
    const dialog = isDialog(ev) as Dialog | undefined;
    if (!dialog) return;
    if (!isOurs(ev)) return;
    const index = openDialogs.indexOf(dialog);
    if (index < 0) return;
    // Closed with its own buttons: take its history entry away.
    openDialogs.splice(index, 1);
    if (foreignOpen() || depth() <= openDialogs.length) return;
    skip++;
    history.back();
  },
  true,
);

window.addEventListener(
  "popstate",
  (ev) => {
    if (skip) {
      skip--;
      ev.stopImmediatePropagation();
      settle();
      return;
    }
    if (foreignOpen()) {
      // Theirs: our entries are put back once it has closed.
      window.setTimeout(resync, 500);
      return;
    }
    let closed = false;
    while (openDialogs.length > depth()) {
      const dialog = openDialogs.pop()!;
      if (!dialog.isConnected) continue;
      closed = true;
      dialog.open = false;
    }
    if (closed) ev.stopImmediatePropagation();
  },
  true,
);
