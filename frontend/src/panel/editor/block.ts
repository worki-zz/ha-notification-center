// A block of the editor that opens and closes: Home Assistant's outlined
// expansion panel with an icon, the name and a count, as in the automation
// editor.

import { css, html, nothing } from "lit";

export interface BlockOptions {
  icon: string;
  header: string;
  // A number (or text such as 2/2) after the name.
  count?: number | string;
  expanded: boolean;
  toggled: (expanded: boolean) => void;
  content: unknown;
  // One line above the content: what the block is about.
  intro?: string;
  // Under the name while the block is closed: what it holds (status
  // blocks, which have no count).
  summary?: string;
  // Has content: the name in the primary text colour and the icon in the
  // primary colour; empty, both secondary. Left out: when the count is not
  // 0 (a block without a count has content).
  filled?: boolean;
  // Always open, without the arrow (the category editor).
  fixed?: boolean;
  // Names the block on the page (data-block), so it can be scrolled to.
  key?: string;
}

export function block(options: BlockOptions) {
  const filled = options.filled ?? countFilled(options.count);
  const open = options.fixed || options.expanded;
  return html`<ha-expansion-panel
    outlined
    class="nc-block ${filled ? "filled" : "empty"}"
    data-block=${options.key ?? nothing}
    .expanded=${options.fixed || options.expanded}
    .noCollapse=${options.fixed ?? false}
    @expanded-will-change=${(ev: CustomEvent<{ expanded: boolean }>) => {
      // Panels inside the block (triggers, conditions) tell their own.
      if (ev.target !== ev.currentTarget) return;
      ev.stopPropagation();
      settle(ev.currentTarget as HTMLElement);
      // Before the panel measures its content, so the content is there.
      options.toggled(ev.detail.expanded);
    }}
    @expanded-changed=${(ev: Event) => {
      if (ev.target === ev.currentTarget) ev.stopPropagation();
    }}
  >
    <ha-icon slot="leading-icon" .icon=${options.icon}></ha-icon>
    <div slot="header" class="block-heading">
      <div class="block-header">
        ${options.header}
        ${options.count === undefined || options.count === ""
          ? nothing
          : html`<span class="block-count">${options.count}</span>`}
      </div>
      ${options.summary && !open
        ? html`<div class="block-summary">${options.summary}</div>`
        : nothing}
    </div>
    ${open ? html`<div class="block-content">
          ${options.intro ? html`<p class="block-intro">${options.intro}</p>` : nothing}${options.content}
        </div>` : nothing}
  </ha-expansion-panel>`;
}

// A count of 0 (or 0/5) means an empty block.
function countFilled(count: number | string | undefined): boolean {
  if (count === undefined || count === "") return true;
  return !/^0(\/|$)/.test(String(count));
}

/** One tab of a block: its name and, when it has content, a count. */
export interface BlockTab {
  key: string;
  label: string;
  count?: number;
}

/**
 * The tabs of a status block (Triggers, Conditions, Actions), with the
 * count of each that has content: "Actions · 2".
 */
export function blockTabs(tabs: BlockTab[], active: string, changed: (key: string) => void) {
  return html`<ha-tab-group
    class="block-tabs"
    @wa-tab-show=${(ev: CustomEvent<{ name: string }>) => {
      ev.stopPropagation();
      changed(ev.detail.name);
    }}
  >
    ${tabs.map(
      (tab) =>
        html`<ha-tab-group-tab slot="nav" panel=${tab.key} .active=${tab.key === active}>
          ${tab.count ? `${tab.label} · ${tab.count}` : tab.label}
        </ha-tab-group-tab>`,
    )}
  </ha-tab-group>`;
}

/**
 * The line at the top of each tab of a status block, under the tabs, by the
 * block's key and the tab's.
 */
export const TAB_INTROS: Record<string, Record<string, string>> = {
  start: {
    triggers: "When the notification becomes active",
    conditions: "When the notification can become active, or when it is shown",
    actions: "Runs when the notification becomes active",
  },
  done: {
    triggers: "When the notification is done by itself, without a button",
    actions: "Runs when the notification is done",
  },
  dismiss: {
    triggers: "When the notification is dismissed by itself, without a button",
    actions: "Runs when the notification is dismissed",
  },
  snooze: {
    triggers: "When the notification is snoozed by itself, without a button",
    actions: "Runs when the notification is snoozed",
  },
  mute: {
    triggers: "When the notification is muted by itself, without a button",
    actions: "Runs when the notification is muted",
  },
};

/** "2 triggers · 1 condition": the parts that are not 0. */
export function summaryOf(parts: [number, string][]): string {
  return parts
    .filter(([count]) => count > 0)
    .map(([count, name]) => `${count} ${name}${count === 1 ? "" : "s"}`)
    .join(" · ");
}

/** The line at the top of each block, by the block's key. */
export const BLOCK_INTROS: Record<string, string> = {
  message: "What the notification says",
  interactions: "What people can do with the notification",

  audience: "Who gets the notification in each state",
  channels: "How the notification is delivered in each home mode",
  entities: "Which entities the notification is about",
};

// The content is drawn only while the block is open. The panel animates to
// the height its content had when it opened; editors that load later
// (triggers, selectors) need it to follow them after that.
function settle(panel: HTMLElement): void {
  window.setTimeout(() => {
    const container = panel.shadowRoot?.querySelector<HTMLElement>(".container");
    if (container && panel.hasAttribute("expanded")) {
      container.style.removeProperty("height");
      container.style.overflow = "initial";
    }
  }, 400);
}

export const BLOCK_STYLES = css`
  ha-expansion-panel.nc-block {
    display: block;
    background-color: var(--card-background-color);
    --expansion-panel-summary-padding: 0 12px 0 16px;
    --expansion-panel-content-padding: 0;
  }
  ha-expansion-panel.nc-block[expanded]::part(summary) {
    border-bottom: 1px solid var(--divider-color);
  }
  ha-expansion-panel.nc-block > ha-icon[slot="leading-icon"] {
    color: var(--primary-color);
    margin-inline-end: 12px;
  }
  /* An empty block: its icon and name in the secondary colour. */
  ha-expansion-panel.nc-block.empty > ha-icon[slot="leading-icon"],
  ha-expansion-panel.nc-block.empty .block-header {
    color: var(--secondary-text-color);
  }
  .block-heading {
    flex: 1;
    display: flex;
    flex-direction: column;
    justify-content: center;
    min-width: 0;
  }
  .block-header {
    display: flex;
    align-items: baseline;
    gap: 12px;
    color: var(--primary-text-color);
    font-weight: var(--ha-font-weight-medium, 500);
  }
  .block-summary {
    color: var(--secondary-text-color);
    font-size: var(--ha-font-size-s, 12px);
  }
  ha-tab-group.block-tabs {
    display: block;
    margin: -16px -16px 16px;
  }
  .block-count {
    color: var(--secondary-text-color);
    font-weight: var(--ha-font-weight-normal, 400);
    font-size: var(--ha-font-size-s, 12px);
  }
  .block-intro {
    margin: 0 0 16px;
    color: var(--secondary-text-color);
  }
  .block-content {
    padding: 16px;
    /* The panels inside (trigger and condition rows) keep their own spacing. */
    --expansion-panel-summary-padding: initial;
    --expansion-panel-content-padding: initial;
  }
`;
