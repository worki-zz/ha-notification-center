// The Color field of a category and of a notification: a system colour, or
// Custom at the end of the list, which opens two pickers: the card's colour
// and the lights' colour (the card's until changed). A system colour shows
// on each light as that light's Colors tab sets it.

import { html, nothing } from "lit";
import { ref } from "lit/directives/ref.js";

import { SYSTEM_COLORS, parseRgb, rgbToHex } from "../shared/config";
import type { HomeAssistant } from "../shared/types";
import { field } from "./fields";

export interface ColorValue {
  card_color?: string | null;
  light_color?: number[] | null;
}

const CUSTOM = "nc_custom";

// No X on a colour that cannot be emptied: Home Assistant's colour picker
// has no setting for it, so its inner picker is told (without a required
// mark, which would put a star on the label).
function hideClear(element: Element | undefined, hide: boolean): void {
  if (!element) return;
  const picker = element as HTMLElement & { updateComplete?: Promise<unknown> };
  void Promise.resolve(picker.updateComplete).then(() => {
    const inner = picker.shadowRoot?.querySelector("ha-generic-picker") as
      | (HTMLElement & { hideClearIcon?: boolean })
      | null;
    if (inner) inner.hideClearIcon = hide;
  });
}

/** Whether a colour is a custom one (not a system colour by name). */
export function isCustomColor(value: ColorValue): boolean {
  return (!!value.card_color && !(value.card_color in SYSTEM_COLORS)) || !!value.light_color;
}

export function colorField(
  hass: HomeAssistant | undefined,
  value: ColorValue,
  changed: (value: ColorValue) => void,
  options: { defaultColor?: string; helper?: string; inherits?: boolean } = {},
) {
  const custom = isCustomColor(value);
  // A notification shows its category's colour until it sets its own; its
  // own one has an X that goes back to the category's.
  const own = !!value.card_color || !!value.light_color;
  const fallback = options.defaultColor && options.defaultColor in SYSTEM_COLORS ? options.defaultColor : "primary";
  const cardRgb = parseRgb(value.card_color) ?? SYSTEM_COLORS[value.card_color ?? fallback] ?? SYSTEM_COLORS.primary;
  return html`<ha-color-picker
      .hass=${hass}
      .label=${"Color"}
      .helper=${options.helper ?? ""}
      .value=${custom ? CUSTOM : (value.card_color ?? (options.inherits ? fallback : undefined))}
      ${ref((element) => hideClear(element, !options.inherits || !own))}
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

/**
 * Highlight: Normal or Highlighted. A notification shows its category's
 * until it sets its own, which has an X that goes back to the category's.
 */
export function highlightField(
  value: boolean | undefined,
  inherited: boolean | undefined,
  changed: (value: boolean | undefined) => void,
) {
  const own = value !== undefined;
  const shown = own ? value : !!inherited;
  return field(
    undefined,
    {
      select: {
        mode: "dropdown",
        options: [
          { value: "normal", label: "Normal" },
          { value: "highlighted", label: "Highlighted" },
        ],
      },
    },
    shown ? "highlighted" : "normal",
    "Highlight",
    (picked) => changed(picked === undefined ? undefined : picked === "highlighted"),
    { clearable: inherited !== undefined && own },
  );
}
