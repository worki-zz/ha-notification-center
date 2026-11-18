// Home Assistant loads its dashboard elements on demand. The card uses the
// tile card's elements (tile icon, control button) and the editor uses
// the tile card editor's form elements, so both are loaded through the
// dashboard's own card helpers.

let cardElements: Promise<void> | undefined;
let editorElements: Promise<void> | undefined;

interface ConfigurableCard {
  getConfigElement?: () => Promise<HTMLElement>;
}

async function tileCard(): Promise<ConfigurableCard | undefined> {
  const helpers = await window.loadCardHelpers?.();
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
