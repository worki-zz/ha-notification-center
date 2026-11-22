// The Color field of a category and of a notification: a system colour, or
// Custom at the end of the list, which opens two pickers: the card's colour
// and the lights' colour (the card's until changed). A system colour shows
// on each light as that light's Colors tab sets it.

import { html, nothing } from "lit";

import { SYSTEM_COLORS, parseRgb, rgbToHex } from "../shared/config";
import type { HomeAssistant } from "../shared/types";
import { field } from "./fields";

export interface ColorValue {
  card_color?: string | null;
  light_color?: number[] | null;
}

const CUSTOM = "nc_custom";

/** Whether a colour is a custom one (not a system colour by name). */
export function isCustomColor(value: ColorValue): boolean {
  return (!!value.card_color && !(value.card_color in SYSTEM_COLORS)) || !!value.light_color;
}

export function colorField(
  hass: HomeAssistant | undefined,
  value: ColorValue,
  changed: (value: ColorValue) => void,
  options: { defaultColor?: string; helper?: string } = {},
) {
  const custom = isCustomColor(value);
  const fallback = options.defaultColor && options.defaultColor in SYSTEM_COLORS ? options.defaultColor : "primary";
  const cardRgb = parseRgb(value.card_color) ?? SYSTEM_COLORS[value.card_color ?? fallback] ?? SYSTEM_COLORS.primary;
  return html`<ha-color-picker
      .hass=${hass}
      .label=${"Color"}
      .helper=${options.helper ?? ""}
      .value=${custom ? CUSTOM : (value.card_color ?? undefined)}
      .defaultColor=${fallback}
      .includeNone=${false}
      .includeState=${false}
      .extraOptions=${[{ value: CUSTOM, label: "Custom", icon: "mdi:palette-outline" }]}
      @value-changed=${(ev: CustomEvent<{ value?: string }>) => {
        ev.stopPropagation();
        const picked = ev.detail.value;
        if (picked === CUSTOM) {
          if (!custom) changed({ card_color: rgbToHex(cardRgb), light_color: null });
          return;
        }
        changed({ card_color: picked || null, light_color: null });
      }}
    ></ha-color-picker>
    ${custom
      ? html`${field(hass, { color_rgb: {} }, cardRgb, "Card color", (rgb) => {
            const parsed = parseRgb(rgb);
            if (parsed) changed({ ...value, card_color: rgbToHex(parsed) });
          })}
          ${field(
            hass,
            { color_rgb: {} },
            value.light_color ?? cardRgb,
            "Light color",
            (rgb) => {
              const parsed = parseRgb(rgb);
              if (!parsed) return;
              const same = parsed.every((part, index) => part === cardRgb[index]);
              changed({ ...value, light_color: same ? null : parsed });
            },
            { helper: value.light_color ? "" : "The card color until changed." },
          )}`
      : nothing}`;
}
