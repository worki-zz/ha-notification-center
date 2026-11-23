// The fields of a category's and a notification's look: Color (a system
// colour or an own colour of the Colors list), Highlight and Chime. A
// notification shows its category's until it sets its own, which has an X
// that goes back to the category's.

import { html } from "lit";
import { ref } from "lit/directives/ref.js";

import {
  CHIME_DEFAULT,
  CHIME_NONE,
  type CardHighlight,
  type NotificationCenterConfig,
  SYSTEM_COLORS,
  orderedChimes,
} from "../shared/config";
import type { HomeAssistant } from "../shared/types";
import { field } from "./fields";

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

// Only the listed colours, the system ones first: Home Assistant's colour
// picker offers what is typed in the search as a "Custom color", which is
// not a colour here (custom colours are made on the Colors page), and puts
// the extra options above its own.
function onlyListed(element: Element | undefined): void {
  const picker = element as
    | (HTMLElement & {
        _getAdditionalItems?: () => unknown[];
        _getItems?: () => { id: string }[];
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
      return [...all.filter(system), ...all.filter((item) => !system(item))];
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

export function colorField(
  hass: HomeAssistant | undefined,
  config: NotificationCenterConfig | undefined,
  value: string | null | undefined,
  changed: (value: string | null) => void,
  options: { defaultColor?: string | null; inherits?: boolean } = {},
) {
  const known = (color: string | null | undefined) =>
    !!color && (color in SYSTEM_COLORS || !!config?.colors?.some((item) => item.id === color));
  const fallback = known(options.defaultColor) ? options.defaultColor! : "primary";
  const own = !!value;
  return html`<ha-color-picker
        .hass=${hass}
        .label=${"Color"}
        .value=${value || fallback}
        ${ref((element) => {
          onlyListed(element);
          hideClear(element, !options.inherits || !own);
        })}
        .defaultColor=${options.inherits ? fallback : undefined}
        .includeNone=${false}
        .includeState=${false}
        .extraOptions=${ownColorOptions(config)}
        @value-changed=${(ev: CustomEvent<{ value?: string }>) => {
          ev.stopPropagation();
          changed(ev.detail.value || null);
        }}
      ></ha-color-picker>`;
}

/**
 * Chime: what the speakers play. A category always has one (the default
 * Chime when it sets none); a notification shows its category's until it
 * sets its own, which can also be None.
 */
export function chimeField(
  config: NotificationCenterConfig | undefined,
  value: string | null | undefined,
  inherited: string | null | undefined,
  changed: (value: string | null) => void,
  options: { inherits?: boolean } = {},
) {
  const fallback = options.inherits ? inherited || CHIME_DEFAULT : CHIME_DEFAULT;
  const own = !!value && (options.inherits || value !== CHIME_DEFAULT);
  return field(
    undefined,
    {
      select: {
        mode: "dropdown",
        options: [
          ...(options.inherits ? [{ value: CHIME_NONE, label: "None" }] : []),
          ...orderedChimes(config).map((chime) => ({ value: chime.id, label: chime.name })),
        ].map((option) =>
          // Only a notification marks its category's; a category shows what it has.
          options.inherits && option.value === fallback ? { ...option, label: `${option.label} (default)` } : option,
        ),
      },
    },
    value || fallback,
    "Chime",
    // The default is no own value, as in the colour picker.
    (picked) => changed(picked === undefined || picked === null || picked === fallback ? null : String(picked)),
    { clearable: !!options.inherits && own },
  );
}

/**
 * Highlight: Normal or one of the card's highlights (Pulse, Glow, Alert);
 * any highlight also makes the lights blink. A notification shows its
 * category's until it sets its own, which has an X that goes back to the
 * category's; choosing the category's is no own value, as in the colour
 * picker.
 */
export function highlightField(
  value: CardHighlight | undefined,
  inherited: CardHighlight | undefined,
  changed: (value: CardHighlight | undefined) => void,
) {
  const own = value !== undefined;
  const fallback = inherited ?? "none";
  const shown = own ? value : fallback;
  const options: [CardHighlight, string][] = [
    ["none", "Normal"],
    ["pulse", "Pulse"],
    ["glow", "Glow"],
    ["alert", "Alert"],
  ];
  return field(
    undefined,
    {
      select: {
        mode: "dropdown",
        options: options.map(([key, text]) => ({
          value: key,
          label: inherited !== undefined && key === fallback ? `${text} (default)` : text,
        })),
      },
    },
    shown,
    "Highlight",
    (picked) => {
      if (picked === undefined || picked === null) changed(undefined);
      else if (inherited === undefined) changed(picked as CardHighlight);
      else changed(picked === fallback ? undefined : (picked as CardHighlight));
    },
    { clearable: inherited !== undefined && own },
  );
}
