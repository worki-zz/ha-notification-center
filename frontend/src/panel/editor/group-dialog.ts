// The dialog of an entity category: a domain with an optional device class,
// areas, floors and labels.

import { LitElement, css, html, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";

import { field } from "../fields";
import type { HomeAssistant } from "../../shared/types";
import { type EntityGroup, groupMatches } from "./model";

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
  if (group.device_class) parts.push(group.device_class.replace(/_/g, " "));
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

  @state() private _group?: EntityGroup;

  @state() private _open = true;

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
      header-title=${this.isNew ? "Add entity category" : "Entity category"}
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
      <div class="form">
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
                ...classes.map((value) => ({ value, label: value.replace(/_/g, " ") })),
              ],
            },
          },
          group.device_class ?? "",
          "Device class",
          (value) => this._set({ device_class: (value as string) || null }),
        )}
        ${this._selector({ floor: { multiple: true } }, group.floors, "Floors", (value) =>
          this._set({ floors: (value as string[]) ?? [] }),
        )}
        ${this._selector({ area: { multiple: true } }, group.areas, "Areas", (value) =>
          this._set({ areas: (value as string[]) ?? [] }),
        )}
        ${this._selector({ label: { multiple: true } }, group.labels, "Labels", (value) =>
          this._set({ labels: (value as string[]) ?? [] }),
        )}
        <ha-settings-row>
          <span slot="heading">Add new matching entities</span>
          <span slot="description">
            Off: only the entities that match when the notification is saved.
          </span>
          <ha-switch
            .checked=${group.add_new}
            @change=${(ev: Event) => this._set({ add_new: (ev.target as HTMLInputElement).checked })}
          ></ha-switch>
        </ha-settings-row>
        <div class="count">${count} ${count === 1 ? "entity" : "entities"}</div>
      </div>
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

  static override styles = css`
    .form {
      display: flex;
      flex-direction: column;
      gap: 16px;
    }
    ha-settings-row {
      padding: 0;
    }
    .count {
      color: var(--secondary-text-color);
    }
  `;
}

declare global {
  interface HTMLElementTagNameMap {
    "nc-group-dialog": NcGroupDialog;
  }
}
