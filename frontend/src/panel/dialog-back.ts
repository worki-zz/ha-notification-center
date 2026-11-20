// Back (the browser's, Android's or a mouse button) closes the open dialog
// of the panel instead of leaving the page, as Home Assistant's own dialogs
// do. Each dialog of the panel adds a history entry when it opens, and
// takes it away again when it closes another way.

type Dialog = HTMLElement & { open: boolean };

const openDialogs: Dialog[] = [];
let skip = 0;

function panelDialog(ev: Event): Dialog | undefined {
  const path = ev.composedPath();
  const dialog = path[0];
  if (!(dialog instanceof HTMLElement) || dialog.tagName !== "HA-DIALOG") return undefined;
  const ours = path.some(
    (item) =>
      item instanceof HTMLElement &&
      (item.tagName.startsWith("NC-") || item.tagName.startsWith("NOTIFICATION-CENTER-")),
  );
  return ours ? (dialog as Dialog) : undefined;
}

window.addEventListener(
  "opened",
  (ev) => {
    const dialog = panelDialog(ev);
    if (!dialog || openDialogs.includes(dialog)) return;
    openDialogs.push(dialog);
    history.pushState({ ...(history.state as object | null), ncDialog: openDialogs.length }, "");
  },
  true,
);

window.addEventListener(
  "closed",
  (ev) => {
    const dialog = panelDialog(ev);
    const index = dialog ? openDialogs.indexOf(dialog) : -1;
    if (index < 0) return;
    // Closed with its own buttons: take its history entry away.
    openDialogs.splice(index, 1);
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
      return;
    }
    while (openDialogs.length) {
      const dialog = openDialogs.pop()!;
      if (!dialog.isConnected) continue;
      ev.stopImmediatePropagation();
      dialog.open = false;
      return;
    }
  },
  true,
);

/** The number of panel dialogs open now. */
export function openDialogCount(): number {
  return openDialogs.length;
}
