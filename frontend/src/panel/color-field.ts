// The fields of a category's and a notification's look: Color (a system
// colour or an own colour of the Colors list), Highlight and Chime. Each
// starts with "Default (value)": the category's in a notification, the
// built-in one in a category; an own value has an X that goes back to it.

import { html } from "lit";
import { ref } from "lit/directives/ref.js";

import {
  CHIME_DEFAULT,
  CHIME_NONE,
  DEFAULT_COLOR,
  type CardHighlight,
  type NotificationCenterConfig,
  SYSTEM_COLORS,
  orderedChimes,
} from "../shared/config";
import type { HomeAssistant } from "../shared/types";
import { cssColor } from "../shared/format";
import { inheritField } from "./fields";

// Only the listed colours, the system ones first: Home Assistant's colour
// picker offers what is typed in the search as a "Custom color", which is
// not a colour here (custom colours are made on the Colors page), and puts
// the extra options above its own. The inherited colour comes first, as
// "Default (Amber)", and the field shows it so while there is no own colour.
function onlyListed(element: Element | undefined): void {
  const picker = element as
    | (HTMLElement & {
        value?: string;
        defaultColor?: string;
        _getAdditionalItems?: () => unknown[];
        _getItems?: () => { id: string; primary: string }[];
        _valueRenderer?: (value: string) => unknown;
        extraOptions?: { value: string; display_color?: string }[];
        _ncListed?: boolean;
        requestUpdate?: () => void;
      })
    | undefined;
  if (!picker || picker._ncListed) return;
  picker._ncListed = true;
  picker._getAdditionalItems = () => [];
  const items = picker._getItems;
  if (items) {
    picker._getItems = () => {
      const all = items();
      const system = (item: { id: string }) => item.id in SYSTEM_COLORS;
      const sorted = [...all.filter(system), ...all.filter((item) => !system(item))];
      const fallback = picker.defaultColor;
      const index = fallback ? sorted.findIndex((item) => item.id === fallback) : -1;
      if (index < 0) return sorted;
      // Home Assistant marks it "Amber (Default)".
      const item = sorted[index];
      const name = item.primary.replace(/\s*\([^)]*\)$/, "");
      return [
        { ...item, primary: `Default (${name})` },
        ...sorted.slice(0, index),
        ...sorted.slice(index + 1),
      ];
    };
  }
  const renderValue = picker._valueRenderer;
  if (renderValue && picker._getItems) {
    const list = picker._getItems;
    picker._valueRenderer = (value: string) => {
      if (picker.value || !picker.defaultColor || value !== picker.defaultColor) {
        return renderValue(value);
      }
      const item = list().find((entry) => entry.id === value);
      return html`<span slot="start"
          ><span
            style="display: block; width: 20px; height: 20px; box-sizing: border-box; border-radius: var(--ha-border-radius-pill, 9999px); border: 1px solid var(--outline-color); background-color: ${picker.extraOptions?.find((option) => option.value === value)?.display_color ??
            cssColor(value)}"
          ></span></span
        ><span slot="headline">${item?.primary ?? value}</span>`;
    };
  }
  picker.requestUpdate?.();
}

/** The own colours of the Colors list, as options of Home Assistant's colour picker. */
export function ownColorOptions(config: NotificationCenterConfig | undefined) {
  return (config?.colors ?? []).map((color) => ({
    value: color.id,
    label: color.name,
    display_color: `rgb(${color.rgb.join(", ")})`,
  }));
}

/**
 * Color: the own colour, or Default (the category's in a notification, Amber
 * in a category). Choosing the inherited colour is no own value.
 */
export function colorField(
  hass: HomeAssistant | undefined,
  config: NotificationCenterConfig | undefined,
  value: string | null | undefined,
  changed: (value: string | null) => void,
  defaultColor?: string | null,
) {
  const known = (color: string | null | undefined) =>
    !!color && (color in SYSTEM_COLORS || !!config?.colors?.some((item) => item.id === color));
  const fallback = known(defaultColor) ? defaultColor! : DEFAULT_COLOR;
  return html`<ha-color-picker
        .hass=${hass}
        .label=${"Color"}
        .value=${value || undefined}
        ${ref((element) => onlyListed(element))}
        .defaultColor=${fallback}
        .includeNone=${false}
        .includeState=${false}
        .extraOptions=${ownColorOptions(config)}
        @value-changed=${(ev: CustomEvent<{ value?: string }>) => {
          ev.stopPropagation();
          const picked = ev.detail.value;
          changed(picked && picked !== fallback ? picked : null);
        }}
      ></ha-color-picker>`;
}

/**
 * Chime: what the speakers play: Default (the category's in a
 * notification, the default chime in a category), a chime, or in a
 * notification None.
 */
export function chimeField(
  config: NotificationCenterConfig | undefined,
  value: string | null | undefined,
  inherited: string | null | undefined,
  changed: (value: string | null) => void,
  options: { inherits?: boolean } = {},
) {
  const fallback = (options.inherits && inherited) || CHIME_DEFAULT;
  const chimes = [
    ...(options.inherits ? [{ value: CHIME_NONE, label: "None" }] : []),
    ...orderedChimes(config).map((chime) => ({ value: chime.id, label: chime.name })),
  ];
  const own = value && value !== fallback ? value : undefined;
  const name = chimes.find((chime) => chime.value === fallback)?.label ?? fallback;
  return inheritField(undefined, chimes, own, name, "Chime", (picked) =>
    changed(picked && picked !== fallback ? picked : null),
  );
}

/**
 * Highlight: Normal or one of the card's highlights (Pulse, Glow, Alert);
 * any highlight also makes the lights pulse. Default: the category's in a
 * notification, Normal in a category. Choosing the inherited one is no own
 * value.
 */
export function highlightField(
  value: CardHighlight | null | undefined,
  inherited: CardHighlight | undefined,
  changed: (value: CardHighlight | undefined) => void,
) {
  const fallback = inherited ?? "none";
  const options: { value: CardHighlight; label: string }[] = [
    { value: "none", label: "Normal" },
    { value: "pulse", label: "Pulse" },
    { value: "glow", label: "Glow" },
    { value: "alert", label: "Alert" },
  ];
  const own = value && value !== fallback ? value : undefined;
  const name = options.find((option) => option.value === fallback)?.label ?? fallback;
  return inheritField(undefined, options, own, name, "Highlight", (picked) =>
    changed(picked && picked !== fallback ? (picked as CardHighlight) : undefined),
  );
}
