// The Home Assistant elements the settings pages are built with.
//
// The trigger and condition editors, the subpage layout, the dialogs and
// the selectors come with the Settings panel of Home Assistant, which loads
// them on demand. They are loaded here the way Home Assistant's own panel
// resolver does, so the editor uses the very same elements.

interface Routes {
  routerOptions: { routes: Record<string, { load: () => Promise<unknown> }> };
}

interface PanelResolver extends HTMLElement, Routes {
  hass: unknown;
  _updateRoutes(): void;
}

let loading: Promise<boolean> | undefined;

async function load(): Promise<boolean> {
  await customElements.whenDefined("partial-panel-resolver");
  if (!customElements.get("ha-panel-config")) {
    const resolver = document.createElement("partial-panel-resolver") as PanelResolver;
    resolver.hass = { panels: [{ url_path: "tmp", component_name: "config" }] };
    resolver._updateRoutes();
    await resolver.routerOptions.routes.tmp.load();
  }
  await customElements.whenDefined("ha-panel-config");
  if (!customElements.get("ha-automation-trigger")) {
    const config = document.createElement("ha-panel-config") as unknown as Routes;
    await config.routerOptions.routes.automation.load();
  }
  await Promise.all(
    ["ha-automation-trigger", "ha-automation-condition", "hass-subpage", "ha-selector"].map(
      (name) => customElements.whenDefined(name),
    ),
  );
  await loadSelectors();
  patchTriggerEditor();
  return true;
}

// Home Assistant's trigger editor misses the padding its condition and
// action siblings have when it is shown in the row (not in the sidebar, as
// the automation editor shows it on a wide screen). Without it the open
// trigger is wider than its card.
function patchTriggerEditor(): void {
  const editor = customElements.get("ha-automation-trigger-editor") as
    | (CustomElementConstructor & { elementStyles?: unknown[] })
    | undefined;
  if (!editor?.elementStyles) return;
  const sheet = new CSSStyleSheet();
  sheet.replaceSync(".card-content.card { padding: 16px; }");
  editor.elementStyles.push(sheet);
}

// Selectors (and the elements that come with them, such as the button toggle
// group and the entity picker) load when a selector of their type is first
// drawn. The editor uses some of those elements directly, so they are loaded
// here, each by drawing its selector once out of sight.
const SELECTORS: Record<string, Record<string, unknown>> = {
  button_toggle: { button_toggle: { options: ["a"] } },
  entity: { entity: {} },
  icon: { icon: {} },
  ui_color: { ui_color: {} },
  select: { select: { options: ["a"] } },
  text: { text: {} },
  number: { number: {} },
  time: { time: {} },
  date: { date: {} },
  duration: { duration: {} },
  attribute: { attribute: {} },
  template: { template: {} },
};

async function loadSelectors(): Promise<void> {
  const holder = document.createElement("div");
  holder.style.display = "none";
  document.body.appendChild(holder);
  try {
    await Promise.race([
      Promise.all([
        customElements.whenDefined("ha-button-toggle-group"),
        ...Object.entries(SELECTORS).map(([type, selector]) => {
          const element = document.createElement("ha-selector") as HTMLElement & {
            selector: unknown;
          };
          element.selector = selector;
          holder.appendChild(element);
          return customElements.whenDefined(`ha-selector-${type}`);
        }),
      ]),
      new Promise((resolve) => window.setTimeout(resolve, 5000)),
    ]);
  } finally {
    holder.remove();
  }
}

/** Load the elements of the settings pages; true when they are there. */
export function loadSettingsElements(): Promise<boolean> {
  loading ??= load().catch(() => {
    loading = undefined;
    return false;
  });
  return loading;
}
