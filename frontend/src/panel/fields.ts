// A field of the settings pages: a Home Assistant selector, or for a plain
// choice Home Assistant's select without a clear button.

import { html, nothing } from "lit";

import type { HomeAssistant } from "../shared/types";

export interface FieldOptions {
  required?: boolean;
  helper?: string;
  className?: string;
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
      @selected=${(ev: CustomEvent<{ value?: string }>) => {
        ev.stopPropagation();
        if (ev.detail.value !== undefined && ev.detail.value !== String(value ?? "")) {
          changed(ev.detail.value);
        }
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
    .required=${options.required ?? false}
    @value-changed=${(ev: CustomEvent<{ value: unknown }>) => {
      ev.stopPropagation();
      changed(ev.detail.value);
    }}
  ></ha-selector>`;
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
