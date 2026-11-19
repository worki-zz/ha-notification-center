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
  return true;
}

/** Load the elements of the settings pages; true when they are there. */
export function loadSettingsElements(): Promise<boolean> {
  loading ??= load().catch(() => {
    loading = undefined;
    return false;
  });
  return loading;
}
