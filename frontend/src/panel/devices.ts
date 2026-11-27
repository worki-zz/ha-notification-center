// The device channels: the lights, the speakers and the sirens of the
// General settings. Helpers shared by their pages and the channel tables,
// and the second step of a new device: the modes it sends in, set the same
// in every category (as a new mode's channels).

import { LitElement, css, html, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";

import { DOMAIN, type Mode } from "../shared/config";
import { errorText } from "../shared/live";
import type { HassEntity, HomeAssistant } from "../shared/types";

export {
  type ChannelInfo,
  type ChannelKind,
  channelIcon,
  channelsOf,
  entityName,
  entityState,
} from "../shared/channel-info";

// Media player and siren features, as Home Assistant numbers them.
export const MEDIA_VOLUME_SET = 4;
export const MEDIA_ANNOUNCE = 1048576;
export const SIREN_TONES = 4;
export const SIREN_VOLUME_SET = 8;
export const SIREN_DURATION = 16;

export function features(state: HassEntity | undefined): number {
  return Number(state?.attributes.supported_features ?? 0);
}

/** Run a device channel once (the Test button). */
export async function testChannel(
  hass: HomeAssistant | undefined,
  channel: string,
  data: Record<string, unknown> = {},
): Promise<void> {
  await hass?.callWS({ type: `${DOMAIN}/channel/test`, channel, ...data });
}

/** The Test button of a dialog's header: a play icon. */
export function testButton(label: string, run: () => void, disabled = false, icon = "mdi:play") {
  return html`<ha-icon-button
    slot="headerActionItems"
    .label=${label}
    title=${label}
    .disabled=${disabled}
    @click=${run}
  >
    <ha-icon .icon=${icon}></ha-icon>
  </ha-icon-button>`;
}

/**
 * An Add button that opens Home Assistant's entity picker under it, as
 * the Add target button of an action: the entity is chosen at once.
 */
export function addEntityButton(options: {
  hass: HomeAssistant | undefined;
  label: string;
  domains?: string[];
  exclude: string[];
  picked: (entityId: string) => void;
}) {
  return html`<ha-entity-picker
    add-button
    .addButtonLabel=${options.label}
    .hass=${options.hass}
    .value=${""}
    .includeDomains=${options.domains}
    .excludeEntities=${options.exclude}
    @value-changed=${(ev: CustomEvent<{ value?: string }>) => {
      ev.stopPropagation();
      const picker = ev.currentTarget as HTMLElement & { value?: string };
      const entityId = ev.detail.value;
      // Back to the button, for the next one.
      picker.value = "";
      if (entityId) options.picked(entityId);
    }}
  ></ha-entity-picker>`;
}

/** The modes as Home Assistant's order shows them: the unconditional Home first. */
function modeColumns(modes: Mode[] | undefined): Mode[] {
  const list = modes ?? [];
  const home = list.find((mode) => mode.id === "home" && !mode.condition);
  return home ? [home, ...list.filter((mode) => mode !== home)] : list;
}

// Step 2 of a new device: the modes its channel sends in, in every category.
@customElement("nc-device-modes-dialog")
export class NcDeviceModesDialog extends LitElement {
  @property({ attribute: false }) public hass?: HomeAssistant;

  @property({ attribute: false }) public modes: Mode[] = [];

  // The channel key and its name.
  @property() public channel = "";

  @property() public name = "";

  @state() private _on = new Set<string>(["home"]);

  @state() private _error?: string;

  @state() private _busy = false;

  private _saved = false;

  protected override render() {
    const modes = modeColumns(this.modes);
    return html`<ha-dialog
      open
      width="medium"
      header-title=${`${this.name}: home modes`}
      prevent-scrim-close
      @closed=${(ev: Event) => {
        if (ev.target !== ev.currentTarget) return;
        ev.stopPropagation();
        // Closed without Save: the ticks shown are saved all the same.
        void (this._saved ? Promise.resolve() : this._save()).finally(() => this._done());
      }}
    >
      <p class="hint">The home modes it sends in, in every category. Each category can change it later.</p>
      ${this._error ? html`<ha-alert alert-type="error">${this._error}</ha-alert>` : nothing}
      <ha-card outlined>
        ${modes.map(
          (mode) => html`<label class="row">
            <ha-switch
              .checked=${this._on.has(mode.id)}
              @change=${(ev: Event) => {
                const next = new Set(this._on);
                if ((ev.target as HTMLInputElement).checked) next.add(mode.id);
                else next.delete(mode.id);
                this._on = next;
              }}
            ></ha-switch>
            <ha-icon .icon=${mode.icon || "mdi:home-outline"}></ha-icon>
            <div class="text">${mode.name}</div>
          </label>`,
        )}
      </ha-card>
      <ha-dialog-footer slot="footer">
        <ha-button slot="primaryAction" .disabled=${this._busy} @click=${this._save}>Save</ha-button>
      </ha-dialog-footer>
    </ha-dialog>`;
  }

  private async _save(): Promise<void> {
    if (!this.hass || this._busy) return;
    this._busy = true;
    this._error = undefined;
    try {
      const order = modeColumns(this.modes).map((mode) => mode.id);
      await this.hass.callWS({
        type: `${DOMAIN}/channel/set_modes`,
        channel: this.channel,
        modes: order.filter((id) => this._on.has(id)),
      });
      this._saved = true;
      this._done();
    } catch (err) {
      this._error = errorText(err);
    } finally {
      this._busy = false;
    }
  }

  private _done(): void {
    this.dispatchEvent(new CustomEvent("closed-dialog"));
  }

  static override styles = css`
    .hint {
      margin: 0 0 12px;
      color: var(--secondary-text-color);
    }
    ha-card {
      overflow: hidden;
    }
    .row {
      display: flex;
      align-items: center;
      gap: 16px;
      padding: 8px 16px;
      min-height: 56px;
      box-sizing: border-box;
      cursor: pointer;
    }
    .row + .row {
      border-top: 1px solid var(--divider-color);
    }
    .row ha-icon {
      color: var(--secondary-text-color);
    }
    .text {
      flex: 1;
    }
  `;
}

declare global {
  interface HTMLElementTagNameMap {
    "nc-device-modes-dialog": NcDeviceModesDialog;
  }
}
