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
  // Always open, without the arrow (the category editor).
  fixed?: boolean;
}

export function block(options: BlockOptions) {
  return html`<ha-expansion-panel
    outlined
    class="nc-block"
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
    <div slot="header" class="block-header">
      ${options.header}
      ${options.count === undefined || options.count === ""
        ? nothing
        : html`<span class="block-count">${options.count}</span>`}
    </div>
    ${options.fixed || options.expanded ? html`<div class="block-content">${options.content}</div>` : nothing}
  </ha-expansion-panel>`;
}

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
    color: var(--secondary-text-color);
    margin-inline-end: 12px;
  }
  .block-header {
    flex: 1;
    display: flex;
    align-items: baseline;
    gap: 12px;
    font-weight: var(--ha-font-weight-medium, 500);
  }
  .block-count {
    color: var(--secondary-text-color);
    font-weight: var(--ha-font-weight-normal, 400);
    font-size: var(--ha-font-size-s, 12px);
  }
  .block-content {
    padding: 16px;
    /* The panels inside (trigger and condition rows) keep their own spacing. */
    --expansion-panel-summary-padding: initial;
    --expansion-panel-content-padding: initial;
  }
`;
