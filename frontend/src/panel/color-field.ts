// The fields of a category's and a notification's look: Color (a system
// colour or an own colour of the Colors list), Highlight and Chime. A
// notification shows its category's until it sets its own, which has an X
// that goes back to the category's.

import { html } from "lit";
import { ref } from "lit/directives/ref.js";

import { CHIME_NONE, type NotificationCenterConfig, SYSTEM_COLORS, orderedChimes } from "../shared/config";
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

// Only the listed colours: Home Assistant's colour picker offers what is
// typed in the search as a "Custom color", which is not a colour here (own
// colours are made on the Colors page).
function onlyListed(element: Element | undefined): void {
  const picker = element as (HTMLElement & { _getAdditionalItems?: () => unknown[]; requestUpdate?: () => void }) | undefined;
  if (!picker || (picker as { _ncListed?: boolean })._ncListed) return;
  (picker as { _ncListed?: boolean })._ncListed = true;
  picker._getAdditionalItems = () => [];
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
        .defaultColor=${fallback}
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
 * Chime: what the speakers play. A category's None plays nothing; a
 * notification can also choose None over its category's chime.
 */
export function chimeField(
  config: NotificationCenterConfig | undefined,
  value: string | null | undefined,
  inherited: string | null | undefined,
  changed: (value: string | null) => void,
  options: { inherits?: boolean } = {},
) {
  const own = value !== undefined && value !== null;
  const shown = own ? value : (options.inherits ? inherited : value) ?? CHIME_NONE;
  return field(
    undefined,
    {
      select: {
        mode: "dropdown",
        options: [
          { value: CHIME_NONE, label: "None" },
          ...orderedChimes(config).map((chime) => ({ value: chime.id, label: chime.name })),
        ],
      },
    },
    shown ?? CHIME_NONE,
    "Chime",
    (picked) => {
      if (picked === undefined || picked === null) changed(null);
      else if (options.inherits) changed(String(picked));
      else changed(picked === CHIME_NONE ? null : String(picked));
    },
    { clearable: !!options.inherits && own },
  );
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
