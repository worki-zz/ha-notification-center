// The page with nothing on it: a big icon over a short text and, for an
// administrator, a button on its own row.
import { LitElement, css, html, nothing } from "lit";
import { customElement, property } from "lit/decorators.js";

@customElement("nc-empty-state")
export class NcEmptyState extends LitElement {
  @property() icon = "mdi:message-bulleted";
  @property() text = "";
  // The label of the button; empty for no button.
  @property() action = "";

  protected override render() {
    return html`<ha-card outlined>
      <ha-icon .icon=${this.icon}></ha-icon>
      <div class="text">${this.text}</div>
      ${this.action
        ? html`<ha-button @click=${() => this.dispatchEvent(new CustomEvent("nc-action"))}>
            <ha-icon slot="start" icon="mdi:plus"></ha-icon>
            ${this.action}
          </ha-button>`
        : nothing}
    </ha-card>`;
  }

  static override styles = css`
    ha-card {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 12px;
      padding: 40px 16px;
      color: var(--primary-text-color);
      font-size: var(--ha-font-size-l, 16px);
      font-weight: var(--ha-font-weight-medium, 500);
    }
    ha-card > ha-icon {
      --mdc-icon-size: 48px;
    }
    .text {
      text-align: center;
    }
  `;
}

declare global {
  interface HTMLElementTagNameMap {
    "nc-empty-state": NcEmptyState;
  }
}
