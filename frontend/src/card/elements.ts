// Home Assistant loads its dashboard elements on demand. The card uses the
// tile card's elements (tile icon, control button) and the editor uses
// the tile card editor's form elements, so both are loaded through the
// dashboard's own card helpers.

let cardElements: Promise<void> | undefined;
let editorElements: Promise<void> | undefined;

interface ConfigurableCard {
  getConfigElement?: () => Promise<HTMLElement>;
}

interface PanelResolver extends HTMLElement {
  hass: unknown;
  _updateRoutes(): void;
  routerOptions: { routes: Record<string, { load: () => Promise<unknown> }> };
}

// The card helpers come with the dashboards. A page outside them (the
// Notification Center panel opened first) loads the dashboard code the way
// Home Assistant's own panel resolver does.
async function cardHelpers() {
  if (!window.loadCardHelpers) {
    try {
      await customElements.whenDefined("partial-panel-resolver");
      const resolver = document.createElement("partial-panel-resolver") as PanelResolver;
      resolver.hass = { panels: [{ url_path: "tmp", component_name: "lovelace" }] };
      resolver._updateRoutes();
      await resolver.routerOptions.routes.tmp.load();
    } catch {
      // Without them the card draws with what is there.
    }
  }
  return window.loadCardHelpers?.();
}

async function tileCard(): Promise<ConfigurableCard | undefined> {
  const helpers = await cardHelpers();
  if (!helpers) return undefined;
  // A tile card with a feature: this loads the tile card and its control
  // buttons. The element itself is never shown.
  helpers.createCardElement({
    type: "tile",
    entity: "sun.sun",
    features: [{ type: "toggle" }],
  });
  await customElements.whenDefined("hui-tile-card");
  return customElements.get("hui-tile-card") as unknown as ConfigurableCard;
}

/** Load the elements the card draws with; safe to call often. */
export function loadDashboardElements(): Promise<void> {
  cardElements ??= tileCard()
    .then(() => undefined)
    .catch(() => undefined);
  return cardElements;
}

/** Load the form elements of the card editor. */
export function loadEditorElements(): Promise<void> {
  editorElements ??= tileCard()
    .then(async (card) => {
      await card?.getConfigElement?.();
    })
    .catch(() => undefined);
  return editorElements;
}
