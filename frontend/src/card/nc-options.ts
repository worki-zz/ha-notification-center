// The options of a card or badge placed for one notification's sensor:
// Show when the notification is (default: always) and Ignore audience
// (default on). The form fields and how the form's data is stored.

import { SHOW_STATUSES, SHOW_STATUS_LABELS, type ShowStatus } from "../shared/entity-status";

export const NC_OPTION_LABELS: Record<string, string> = {
  show_when: "Show when the notification is",
  ignore_audience: "Ignore audience",
};

export const NC_OPTION_HELPERS: Record<string, string> = {
  ignore_audience:
    "On: everyone sees it. Off: only the notification's Audience, in their state now. The channels do not count.",
};

/** The form fields (ha-form schema). */
export function ncOptionsSchema() {
  return [
    {
      name: "show_when",
      selector: {
        select: {
          multiple: true,
          mode: "list",
          options: SHOW_STATUSES.map((value) => ({ value, label: SHOW_STATUS_LABELS[value] })),
        },
      },
    },
    { name: "ignore_audience", selector: { boolean: {} } },
  ];
}

/** The form's values of a stored configuration (the defaults filled in). */
export function ncOptionsData(config: { show_when?: ShowStatus[]; ignore_audience?: boolean }) {
  return {
    show_when: config.show_when?.length ? config.show_when : [...SHOW_STATUSES],
    ignore_audience: config.ignore_audience ?? true,
  };
}

/** Leave out the options at their defaults (every status, Ignore audience on). */
export function storeNcOptions(config: Record<string, unknown>): void {
  const showWhen = config.show_when as ShowStatus[] | undefined;
  if (!showWhen || SHOW_STATUSES.every((status) => showWhen.includes(status))) {
    delete config.show_when;
  } else {
    config.show_when = SHOW_STATUSES.filter((status) => showWhen.includes(status));
  }
  if (config.ignore_audience !== false) delete config.ignore_audience;
}
