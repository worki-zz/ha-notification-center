// A field of the settings pages: a Home Assistant selector, or for a plain
// choice Home Assistant's select without a clear button.

import { html, nothing } from "lit";

import type { HomeAssistant } from "../shared/types";

export interface FieldOptions {
  required?: boolean;
  helper?: string;
  className?: string;
  // A choice that can be emptied with a clear button.
  clearable?: boolean;
  placeholder?: string;
}

interface SelectSelector {
  select?: { mode?: string; multiple?: boolean; options?: { value: string; label: string }[] };
}

export function field(
  hass: HomeAssistant | undefined,
  selector: Record<string, unknown>,
  value: unknown,
  label: string,
  changed: (value: unknown) => void,
  options: FieldOptions = {},
) {
  const select = (selector as SelectSelector).select;
  if (select && select.mode === "dropdown" && !select.multiple) {
    return html`<ha-select
      class=${options.className ?? ""}
      .label=${label}
      .helper=${options.helper ?? ""}
      .value=${value === undefined || value === null ? "" : String(value)}
      .options=${select.options ?? []}
      .clearable=${options.clearable ?? false}
      @selected=${(ev: CustomEvent<{ value?: string }>) => {
        ev.stopPropagation();
        if (ev.detail.value === undefined) {
          if (options.clearable && value) changed(undefined);
          return;
        }
        if (ev.detail.value !== String(value ?? "")) changed(ev.detail.value);
      }}
      @closed=${(ev: Event) => ev.stopPropagation()}
    ></ha-select>`;
  }
  return html`<ha-selector
    class=${options.className ?? ""}
    .hass=${hass}
    .selector=${selector}
    .value=${value}
    .label=${label}
    .helper=${options.helper}
    .placeholder=${options.placeholder}
    .required=${options.required ?? false}
    @value-changed=${(ev: CustomEvent<{ value: unknown }>) => {
      ev.stopPropagation();
      changed(ev.detail.value);
    }}
  ></ha-selector>`;
}

/** The value of the Default option of an inheriting choice. */
export const DEFAULT_OPTION = "__default__";

/**
 * A choice that inherits: its first option is "Default (value)", which
 * means no own value; an own value has Home Assistant's clear X. Choosing
 * the Default option, or clearing, gives undefined.
 */
export function inheritField(
  hass: HomeAssistant | undefined,
  options: { value: string; label: string }[],
  own: string | undefined,
  inherited: string,
  label: string,
  changed: (value: string | undefined) => void,
  helper?: string,
) {
  return field(
    hass,
    {
      select: {
        mode: "dropdown",
        options: [{ value: DEFAULT_OPTION, label: `Default (${inherited})` }, ...options],
      },
    },
    own ?? DEFAULT_OPTION,
    label,
    (value) => changed(value === undefined || value === DEFAULT_OPTION ? undefined : String(value)),
    { clearable: own !== undefined, helper },
  );
}

/**
 * The icon-only button that brings back what is inherited (mdi:restore),
 * shown only where there is an own value; no confirmation.
 */
export function restoreButton(
  label: string,
  restore: () => void,
  className = "restore",
  slot?: string,
) {
  return html`<ha-icon-button
    class=${className}
    slot=${slot ?? nothing}
    .label=${label}
    @click=${(ev: Event) => {
      ev.stopPropagation();
      restore();
    }}
  >
    <ha-icon icon="mdi:restore"></ha-icon>
  </ha-icon-button>`;
}

// The names of dashboard views, by path, once loaded ("Overview ▸ Home").
const VIEW_NAMES = new Map<string, string>();

type Panels = Record<string, { url_path?: string; title?: string | null; component_name?: string }>;

function panelOf(hass: HomeAssistant | undefined, path: string) {
  const panels = (hass as { panels?: Panels } | undefined)?.panels;
  const [key, view] = path.replace(/^\/+/, "").split(/[?#]/)[0].split("/");
  return { key, view, panel: panels?.[key] };
}

/**
 * The name of a page, as the navigation picker shows it: a panel's or
 * dashboard's title (with the view's, once `loadPageName` has read it),
 * else the path itself. Empty: the Overview.
 */
export function pageName(hass: HomeAssistant | undefined, path: string | null | undefined): string {
  if (!path) return "Overview";
  const known = VIEW_NAMES.get(path);
  if (known) return known;
  const { panel } = panelOf(hass, path);
  const title = panel?.title;
  if (!title) return path;
  // Built-in panels have a translation key as their title.
  const localize = (hass as { localize?: (key: string) => string } | undefined)?.localize;
  return localize?.(`panel.${title}`) || title;
}

/**
 * Read the title of a dashboard view, so that `pageName` names it; true
 * when a new name was found.
 */
export async function loadPageName(
  hass: HomeAssistant | undefined,
  path: string | null | undefined,
): Promise<boolean> {
  if (!hass || !path || VIEW_NAMES.has(path)) return false;
  const { key, view, panel } = panelOf(hass, path);
  if (!view || panel?.component_name !== "lovelace") return false;
  try {
    const config = (await hass.callWS({
      type: "lovelace/config",
      url_path: key === "lovelace" ? null : key,
    })) as { views?: { path?: string; title?: string }[] };
    const views = config.views ?? [];
    const index = /^\d+$/.test(view) ? Number(view) : -1;
    const found = views.find((item) => item.path === view) ?? views[index];
    if (!found?.title) return false;
    VIEW_NAMES.set(path, `${pageName(hass, `/${key}`)} ▸ ${found.title}`);
    return true;
  } catch {
    return false;
  }
}

export interface IconOption {
  value: string;
  label: string;
  icon?: string | null;
}

/**
 * A choice whose options have icons, shown also in the field: Home
 * Assistant's picker field and dropdown, as its select builds them.
 */
export function iconSelect(
  value: string,
  label: string,
  options: IconOption[],
  changed: (value: string) => void,
  className = "",
) {
  const current = options.find((option) => option.value === value);
  return html`<ha-dropdown
    class="icon-select ${className}"
    placement="bottom"
    @wa-select=${(ev: CustomEvent<{ item: { value: string } }>) => {
      ev.stopPropagation();
      if (ev.detail.item.value !== value) changed(ev.detail.item.value);
    }}
    @wa-show=${(ev: Event) => {
      const host = ev.currentTarget as HTMLElement;
      const trigger = host.querySelector("ha-picker-field") as HTMLElement | null;
      if (trigger) host.style.setProperty("--select-menu-width", `${trigger.offsetWidth}px`);
    }}
  >
    <ha-picker-field
      slot="trigger"
      type="button"
      compact
      hide-clear-icon
      .hideClearIcon=${true}
      .label=${label}
      .value=${current?.label ?? value}
      .icon=${current?.icon ?? undefined}
    ></ha-picker-field>
    ${options.map(
      (option) => html`<ha-dropdown-item .value=${option.value} .selected=${option.value === value}>
        ${option.icon ? html`<ha-icon slot="icon" .icon=${option.icon}></ha-icon>` : nothing}
        ${option.label}
      </ha-dropdown-item>`,
    )}
  </ha-dropdown>`;
}

/**
 * The title of a page header (hass-subpage), on one line: a long one is
 * cut with an ellipsis (Home Assistant wraps it to two lines), and shows
 * in full on hover.
 */
export function subpageTitle(text: string) {
  return html`<span
    slot="header"
    title=${text}
    style="display: block; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;"
    >${text}</span
  >`;
}
