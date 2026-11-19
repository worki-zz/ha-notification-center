// A block of the editor that opens and closes, with the look of Home
// Assistant's outlined expansion panel. The content is drawn only while
// open and without a height animation, so editors that grow after they
// load (triggers, selectors) always get their room.

import { LitElement, css, html, nothing } from "lit";
import { customElement, property } from "lit/decorators.js";

@customElement("nc-block")
export class NcBlock extends LitElement {
  @property({ reflect: true }) public header = "";

  @property() public secondary = "";

  @property({ type: Boolean, reflect: true }) public expanded = false;

  private _toggle(ev: Event): void {
    if (ev instanceof KeyboardEvent && ev.key !== "Enter" && ev.key !== " ") return;
    ev.preventDefault();
    this.dispatchEvent(new CustomEvent("toggled", { detail: { expanded: !this.expanded } }));
  }

  protected override render() {
    return html`
      <div
        class="summary"
        role="button"
        tabindex="0"
        aria-expanded=${this.expanded}
        @click=${this._toggle}
        @keydown=${this._toggle}
      >
        <div class="text">
          <div class="header">${this.header}</div>
          ${this.secondary ? html`<div class="secondary">${this.secondary}</div>` : nothing}
        </div>
        <ha-icon class="chevron" icon="mdi:chevron-down"></ha-icon>
      </div>
      ${this.expanded ? html`<div class="content"><slot></slot></div>` : nothing}
    `;
  }

  static override styles = css`
    :host {
      display: block;
      border: 1px solid var(--outline-color, var(--divider-color));
      border-radius: var(--ha-card-border-radius, 12px);
      background-color: var(--card-background-color);
    }
    .summary {
      display: flex;
      align-items: center;
      gap: 8px;
      min-height: 48px;
      padding: 8px 12px 8px 16px;
      cursor: pointer;
      border-radius: var(--ha-card-border-radius, 12px);
      outline: none;
    }
    .summary:focus-visible {
      background-color: rgb(from var(--primary-text-color) r g b / 0.06);
    }
    .text {
      flex: 1;
      min-width: 0;
    }
    .header {
      font-weight: var(--ha-font-weight-medium, 500);
    }
    .secondary {
      color: var(--secondary-text-color);
      font-size: var(--ha-font-size-s, 12px);
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .chevron {
      color: var(--secondary-text-color);
      transition: transform 150ms cubic-bezier(0.4, 0, 0.2, 1);
    }
    :host([expanded]) .chevron {
      transform: rotate(180deg);
    }
    .content {
      padding: 0 16px 8px;
    }
  `;
}

declare global {
  interface HTMLElementTagNameMap {
    "nc-block": NcBlock;
  }
}
