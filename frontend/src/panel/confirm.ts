// A confirmation in Home Assistant's own dialog.

import { LitElement, html, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";

export interface ConfirmOptions {
  title: string;
  text?: string;
  confirm?: string;
  dismiss?: string;
  destructive?: boolean;
}

@customElement("nc-confirm-dialog")
export class NcConfirmDialog extends LitElement {
  @property({ attribute: false }) public options?: ConfirmOptions;

  @state() private _open = true;

  public resolve?: (value: boolean) => void;

  private _answer = false;

  protected override render() {
    const options = this.options;
    if (!options) return nothing;
    return html`
      <ha-dialog
        .open=${this._open}
        type="alert"
        width="small"
        header-title=${options.title}
        @closed=${this._closed}
      >
        ${options.text ? html`<p>${options.text}</p>` : nothing}
        <ha-dialog-footer slot="footer">
          <ha-button slot="secondaryAction" appearance="plain" @click=${() => this._close(false)}>
            ${options.dismiss ?? "Cancel"}
          </ha-button>
          <ha-button
            slot="primaryAction"
            variant=${options.destructive ? "danger" : "brand"}
            @click=${() => this._close(true)}
          >
            ${options.confirm ?? "OK"}
          </ha-button>
        </ha-dialog-footer>
      </ha-dialog>
    `;
  }

  private _close(answer: boolean): void {
    this._answer = answer;
    this._open = false;
  }

  private _closed(ev: Event): void {
    ev.stopPropagation();
    this.resolve?.(this._answer);
    this.remove();
  }
}

/** Ask a question in a dialog; true when it is confirmed. */
export function confirmDialog(host: LitElement, options: ConfirmOptions): Promise<boolean> {
  return new Promise((resolve) => {
    const dialog = document.createElement("nc-confirm-dialog");
    dialog.options = options;
    dialog.resolve = resolve;
    (host.renderRoot as ShadowRoot).appendChild(dialog);
  });
}

declare global {
  interface HTMLElementTagNameMap {
    "nc-confirm-dialog": NcConfirmDialog;
  }
}
