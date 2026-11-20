// The dialog of an entity group: a domain with an optional device class,
// areas, floors and labels.

import { LitElement, css, html, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";

import { field } from "../fields";
import { deviceClassName } from "../../shared/text";
import type { HomeAssistant } from "../../shared/types";
import { ACTION_SLOT_STYLES, renderActionSlots } from "./action-slots";
import { type ActionSlot, type EntityGroup, groupMatches } from "./model";

export function newGroup(): EntityGroup {
  return {
    domain: "binary_sensor",
    device_class: null,
    areas: [],
    floors: [],
    labels: [],
    add_new: true,
    enabled: true,
    excluded: [],
  };
}

/** "Binary sensor · moisture" */
export function groupName(hass: HomeAssistant | undefined, group: EntityGroup): string {
  const domain = domainName(group.domain);
  const parts = [domain];
  if (group.device_class) parts.push(deviceClassName(hass, group.domain, group.device_class));
  const places = [
    ...group.floors.map((id) => hass?.floors?.[id]?.name ?? id),
    ...group.areas.map((id) => hass?.areas?.[id]?.name ?? id),
  ];
  if (places.length) parts.push(places.join(", "));
  return parts.join(" · ");
}

export function domainName(domain: string): string {
  const text = domain.replace(/_/g, " ");
  return text.charAt(0).toUpperCase() + text.slice(1);
}

@customElement("nc-group-dialog")
export class NcGroupDialog extends LitElement {
  @property({ attribute: false }) public hass?: HomeAssistant;

  @property({ attribute: false }) public group?: EntityGroup;

  @property({ type: Boolean }) public isNew = false;

  @property({ type: Boolean }) public narrow = false;

  // The buttons that run an entity action.
  @property({ attribute: false }) public slots: ActionSlot[] = [];

  @state() private _group?: EntityGroup;

  @state() private _open = true;

  // An existing category opens on its entity actions.
  @state() private _tab: "actions" | "settings" = "actions";

  private _result?: EntityGroup | "delete";

  protected override willUpdate(): void {
    if (!this._group && this.group) this._group = { ...this.group };
  }

  private _domains(): string[] {
    const domains = new Set(Object.keys(this.hass?.states ?? {}).map((id) => id.split(".")[0]));
    return [...domains].sort();
  }

  private _deviceClasses(domain: string): string[] {
    const classes = new Set<string>();
    for (const [id, state] of Object.entries(this.hass?.states ?? {})) {
      const value = state.attributes.device_class;
      if (id.startsWith(`${domain}.`) && typeof value === "string") classes.add(value);
    }
    return [...classes].sort();
  }

  private _set(changes: Partial<EntityGroup>): void {
    this._group = { ...this._group!, ...changes };
  }

  protected override render() {
    const group = this._group;
    const hass = this.hass;
    if (!group || !hass) return nothing;
    const count = groupMatches(hass, { ...group, members: null, add_new: true }).length;
    const classes = this._deviceClasses(group.domain);
    return html`<ha-dialog
      .open=${this._open}
      header-title=${this.isNew ? "Add entity group" : "Entity group"}
      @closed=${this._closed}
    >
      ${this.isNew
        ? nothing
        : html`<ha-icon-button
            slot="headerActionItems"
            .label=${"Delete"}
            @click=${() => this._close("delete")}
          >
            <ha-icon icon="mdi:delete"></ha-icon>
          </ha-icon-button>`}
      ${this.isNew
        ? nothing
        : html`<ha-tab-group
            @wa-tab-show=${(ev: CustomEvent<{ name: string }>) => {
              ev.stopPropagation();
              this._tab = ev.detail.name === "settings" ? "settings" : "actions";
            }}
          >
            <ha-tab-group-tab slot="nav" panel="actions" .active=${this._tab === "actions"}>
              Entity actions
            </ha-tab-group-tab>
            <ha-tab-group-tab slot="nav" panel="settings" .active=${this._tab === "settings"}>
              Settings
            </ha-tab-group-tab>
          </ha-tab-group>`}
      ${!this.isNew && this._tab === "actions"
        ? html`<div class="form">
            ${renderActionSlots(
              hass,
              this.narrow,
              this.slots,
              group.actions,
              (actions) => this._set({ actions }),
              false,
            )}
          </div>`
        : this._renderSettings(group, count, classes)}
      <ha-dialog-footer slot="footer">
        <ha-button slot="secondaryAction" appearance="plain" @click=${() => this._close()}>
          Cancel
        </ha-button>
        <ha-button slot="primaryAction" @click=${() => this._close(this._group)}>
          ${this.isNew ? "Add" : "Update"}
        </ha-button>
      </ha-dialog-footer>
    </ha-dialog>`;
  }

  private _renderSettings(group: EntityGroup, count: number, classes: string[]) {
    const hass = this.hass!;
    return html`<div class="form">
      ${this._selector(
        {
          select: {
            mode: "dropdown",
            options: this._domains().map((value) => ({ value, label: domainName(value) })),
          },
        },
        group.domain,
        "Domain",
        (value) => this._set({ domain: (value as string) || group.domain, device_class: null }),
      )}
      ${this._selector(
        {
          select: {
            mode: "dropdown",
            options: [
              { value: "", label: "Any" },
              ...classes.map((value) => ({ value, label: deviceClassName(hass, group.domain, value) })),
            ],
          },
        },
        group.device_class ?? "",
        "Device class",
        (value) => this._set({ device_class: (value as string) || null }),
      )}
      ${Object.keys(hass.floors ?? {}).length || group.floors.length
        ? this._selector({ floor: { multiple: true } }, group.floors, "Floors", (value) =>
            this._set({ floors: (value as string[]) ?? [] }),
          )
        : nothing}
      ${this._selector({ area: { multiple: true } }, group.areas, "Areas", (value) =>
        this._set({ areas: (value as string[]) ?? [] }),
      )}
      ${this._selector({ label: { multiple: true } }, group.labels, "", (value) =>
        this._set({ labels: (value as string[]) ?? [] }),
      )}
      <ha-alert alert-type="info">${count} matching ${count === 1 ? "entity" : "entities"}</ha-alert>
      <div class="divider"></div>
      <ha-settings-row>
        <span slot="heading">Add new matching entities</span>
        <ha-switch
          .checked=${group.add_new}
          @change=${(ev: Event) => this._set({ add_new: (ev.target as HTMLInputElement).checked })}
        ></ha-switch>
      </ha-settings-row>
    </div>`;
  }

  private _selector(
    selector: Record<string, unknown>,
    value: unknown,
    label: string,
    changed: (value: unknown) => void,
  ) {
    return field(this.hass, selector, value, label, changed);
  }

  private _close(result?: EntityGroup | "delete"): void {
    this._result = result;
    this._open = false;
  }

  private _closed(ev: Event): void {
    if (ev.target !== ev.currentTarget) return;
    ev.stopPropagation();
    this.dispatchEvent(new CustomEvent("group-closed", { detail: { result: this._result } }));
  }

  static override styles = [
    ACTION_SLOT_STYLES,
    css`
    .form {
      display: flex;
      flex-direction: column;
      gap: 16px;
    }
    /* Not as tall as in a settings page. */
    ha-settings-row {
      padding: 0;
      margin: -8px 0;
      min-height: 0;
    }
    ha-tab-group {
      display: block;
      margin: -8px -24px 16px;
    }
    .divider {
      height: 1px;
      background-color: var(--divider-color);
      margin: 0 -24px;
    }
  `,
  ];
}

declare global {
  interface HTMLElementTagNameMap {
    "nc-group-dialog": NcGroupDialog;
  }
}
