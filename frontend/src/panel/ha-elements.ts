// The Home Assistant elements the settings pages are built with.
//
// The trigger and condition editors, the subpage layout, the dialogs and
// the selectors come with the Settings panel of Home Assistant, which loads
// them on demand. They are loaded here the way Home Assistant's own panel
// resolver does, so the editor uses the very same elements.

import "./editor/entities-form";
import type { EntitiesKind, NcEntitiesForm } from "./editor/entities-form";

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
  if (!customElements.get("ha-person-badge")) {
    // The People page brings the person badge of the Audience; not waited for.
    const config = document.createElement("ha-panel-config") as unknown as Routes;
    void config.routerOptions.routes.person?.load().catch(() => undefined);
  }
  await Promise.all(
    [
      "ha-automation-trigger",
      "ha-automation-condition",
      "ha-automation-action",
      "hass-subpage",
      "ha-selector",
    ].map(
      (name) => customElements.whenDefined(name),
    ),
  );
  await loadSelectors();
  patchTriggerEditor();
  patchRowTitles();
  patchPlatform("ha-automation-trigger-platform", "trigger");
  patchPlatform("ha-automation-condition-platform", "condition");
  return true;
}

// The Notification entities triggers and conditions: inside the editor
// they show the compact form of Home Assistant's own State and Numeric
// state triggers instead of the generic form (with a check box for each
// optional field) that Home Assistant builds from their description.
const ENTITIES_KINDS: Record<string, EntitiesKind> = {
  "notification_center.entities_state": "state",
  "notification_center.entities_numeric_state": "numeric",
};

interface PlatformElement extends HTMLElement {
  hass: unknown;
  disabled: boolean;
  _ncForm?: NcEntitiesForm;
  [key: string]: unknown;
}

function patchPlatform(name: string, key: "trigger" | "condition"): void {
  void customElements.whenDefined(name).then(() => {
    const element = customElements.get(name) as unknown as { prototype: { render(): unknown } };
    const proto = element.prototype as { render(): unknown; _ncPatched?: boolean };
    if (proto._ncPatched) return;
    proto._ncPatched = true;
    const original = proto.render;
    proto.render = function (this: PlatformElement) {
      const item = this[key] as Record<string, unknown> | undefined;
      const kind = item ? ENTITIES_KINDS[String(item[key])] : undefined;
      if (!item || !kind) return original.call(this);
      let form = this._ncForm;
      if (!form) {
        form = document.createElement("nc-entities-form");
        form.setAttribute("with-notification", "");
        form.addEventListener("value-changed", (ev) => {
          ev.stopPropagation();
          const current = this[key] as Record<string, unknown>;
          const { target: _target, ...rest } = current;
          void _target;
          this.dispatchEvent(
            new CustomEvent("value-changed", {
              detail: { value: { ...rest, options: (ev as CustomEvent<{ value: unknown }>).detail.value } },
              bubbles: true,
              composed: true,
            }),
          );
        });
        this._ncForm = form;
      }
      form.hass = this.hass as NcEntitiesForm["hass"];
      form.kind = kind;
      form.disabled = this.disabled;
      form.value = { ...((item.options as Record<string, unknown> | undefined) ?? {}) };
      return form;
    };
  });
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

// The title of a trigger, condition or action row is an h3 that relies on
// the page's styles for its margin; in this panel it gets the browser's
// default margin and every row is half as tall again.
function patchRowTitles(): void {
  for (const name of [
    "ha-automation-trigger-row",
    "ha-automation-condition-row",
    "ha-automation-action-row",
  ]) {
    void customElements.whenDefined(name).then(() => {
      const row = customElements.get(name) as
        | (CustomElementConstructor & { elementStyles?: unknown[]; _ncRowPatched?: boolean })
        | undefined;
      if (!row?.elementStyles || row._ncRowPatched) return;
      row._ncRowPatched = true;
      const sheet = new CSSStyleSheet();
      sheet.replaceSync("h3 { margin: 0; }");
      row.elementStyles.push(sheet);
    });
  }
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
  state: { state: {} },
  choose: { choose: { choices: { a: { selector: { text: {} } } } } },
  template: { template: {} },
  navigation: { navigation: {} },
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
