// A field of the settings pages: a Home Assistant selector, or for a plain
// choice Home Assistant's select without a clear button.

import { html } from "lit";

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
