// The Entities block of the notification editor: the entities and entity
// groups a notification lists, and the dialogs to edit them.

import { LitElement, html, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";

import type { Category } from "../../shared/config";
import type { HomeAssistant } from "../../shared/types";
import { addEntityButton } from "../devices";
import { ACTION_SLOT_STYLES, renderActionSlots, renderMemberSlots } from "./action-slots";
import { ENTITIES_BLOCK_STYLES } from "./entities-block.styles";
import { domainName, groupName, newGroup } from "./group-dialog";
import "./group-dialog";
import {
  type EditorNotification,
  type EntityGroup,
  type Obj,
  entityActionSlots,
  entityDisplay,
  groupMatches,
} from "./model";

@customElement("nc-entities-block")
export class NcEntitiesBlock extends LitElement {
  @property({ attribute: false }) public hass?: HomeAssistant;

  @property({ type: Boolean }) public narrow = false;

  @property({ attribute: false }) public draft!: EditorNotification;

  // The notification's category, for the buttons its entity actions come from.
  @property({ attribute: false }) public category?: Category;

  @state() private _group?: { index: number; group: EntityGroup };

  @state() private _entity?: { index: number; entityId: string; actions: Obj };

  // A member of an entity group whose custom actions are being edited.
  @state() private _member?: { groupIndex: number; entityId: string; custom: Obj };

  // The parent applies the change to its draft.
  private _emit(changes: Partial<EditorNotification>): void {
    this.dispatchEvent(new CustomEvent("entities-changed", { detail: changes }));
  }

  protected override render() {
    if (!this.hass || !this.draft) return nothing;
    return html`${this._renderEntities(this.draft)}
    ${this._group
      ? html`<nc-group-dialog
          .hass=${this.hass}
          .group=${this._group.group}
          .isNew=${this._group.index < 0}
          .narrow=${this.narrow}
          .slots=${entityActionSlots(this.draft, this.category)}
          @group-closed=${this._groupClosed}
        ></nc-group-dialog>`
      : nothing}
    ${this._entity ? this._renderEntityDialog() : nothing}
    ${this._member ? this._renderMemberDialog() : nothing}`;
  }

  private _renderEntityText(entityId: string) {
    const { primary, secondary } = entityDisplay(this.hass!, entityId);
    return html`<div class="item-text">
      <div>${primary}</div>
      ${secondary ? html`<div class="secondary">${secondary}</div>` : nothing}
    </div>`;
  }

  private _renderEntities(draft: EditorNotification) {
    const hass = this.hass!;
    return html`<div class="block">
      ${draft.entities.length
        ? html`<ha-card outlined class="list">
            ${draft.entities.map(
              (item, index) => {
                const edit = () =>
                  (this._entity = { index, entityId: item.entity_id, actions: { ...(item.actions ?? {}) } });
                return html`<div class="item clickable" role="button" tabindex="0" @click=${edit}
                  @keydown=${(ev: KeyboardEvent) => ev.key === "Enter" && ev.target === ev.currentTarget && edit()}>
                <ha-switch
                  .checked=${item.enabled}
                  @click=${(ev: Event) => ev.stopPropagation()}
                  @change=${(ev: Event) => {
                    const entities = [...draft.entities];
                    entities[index] = { ...item, enabled: (ev.target as HTMLInputElement).checked };
                    this._emit({ entities });
                  }}
                ></ha-switch>
                <ha-state-icon .hass=${hass} .stateObj=${hass.states[item.entity_id]}></ha-state-icon>
                ${this._renderEntityText(item.entity_id)}
                <ha-icon-button .label=${"Edit"}>
                  <ha-icon icon="mdi:pencil"></ha-icon>
                </ha-icon-button>
              </div>`;
              },
            )}
          </ha-card>`
        : nothing}
      ${draft.entity_groups.map((group, index) => this._renderGroup(draft, group, index))}
      <div class="buttons">
        ${addEntityButton({
          hass,
          label: "Add entity",
          exclude: draft.entities.map((item) => item.entity_id),
          picked: (entityId) =>
            this._emit({
              entities: [...draft.entities, { entity_id: entityId, enabled: true, actions: {} }],
            }),
        })}
        <ha-button
          appearance="filled"
          size="s"
          @click=${() => (this._group = { index: -1, group: newGroup() })}
        >
          <ha-icon slot="start" icon="mdi:shape-plus-outline"></ha-icon>
          Add entity group
        </ha-button>
      </div>
    </div>`;
  }

  private _renderGroup(draft: EditorNotification, group: EntityGroup, index: number) {
    const hass = this.hass!;
    const members = groupMatches(hass, group);
    const active = members.filter((id) => !group.excluded.includes(id)).length;
    const setGroup = (changes: Partial<EntityGroup>) => {
      const groups = [...draft.entity_groups];
      groups[index] = { ...group, ...changes };
      this._emit({ entity_groups: groups });
    };
    const edit = () => (this._group = { index, group });
    return html`<ha-card outlined class="list">
      <div
        class="item group clickable"
        role="button"
        tabindex="0"
        @click=${edit}
        @keydown=${(ev: KeyboardEvent) => ev.key === "Enter" && ev.target === ev.currentTarget && edit()}
      >
        <ha-switch
          .checked=${group.enabled}
          @click=${(ev: Event) => ev.stopPropagation()}
          @change=${(ev: Event) => setGroup({ enabled: (ev.target as HTMLInputElement).checked })}
        ></ha-switch>
        <ha-icon icon="mdi:shape-outline"></ha-icon>
        <div class="item-text">
          <div>${groupName(hass, group)}</div>
          ${group.add_new ? nothing : html`<div class="secondary">Fixed list</div>`}
        </div>
        <span class="count">${active}</span>
        <ha-icon-button .label=${"Edit"}>
          <ha-icon icon="mdi:pencil"></ha-icon>
        </ha-icon-button>
      </div>
      ${members.length
        ? members.map(
            (entityId) => html`<div
              class="item member clickable"
              role="button"
              tabindex="0"
              @click=${() => this._openMember(group, index, entityId)}
              @keydown=${(ev: KeyboardEvent) =>
                ev.key === "Enter" && ev.target === ev.currentTarget && this._openMember(group, index, entityId)}
            >
              <ha-switch
                .checked=${!group.excluded.includes(entityId)}
                @click=${(ev: Event) => ev.stopPropagation()}
                @change=${(ev: Event) => {
                  const on = (ev.target as HTMLInputElement).checked;
                  setGroup({
                    excluded: on
                      ? group.excluded.filter((id) => id !== entityId)
                      : [...group.excluded, entityId],
                  });
                }}
              ></ha-switch>
              <ha-state-icon .hass=${hass} .stateObj=${hass.states[entityId]}></ha-state-icon>
              ${this._renderEntityText(entityId)}
              <ha-icon-button .label=${"Edit"}>
                <ha-icon icon="mdi:pencil"></ha-icon>
              </ha-icon-button>
            </div>`,
          )
        : html`<div class="item member secondary">
            No ${domainName(group.domain).toLowerCase()} entities match yet.
          </div>`}
    </ha-card>`;
  }

  private _openMember(group: EntityGroup, groupIndex: number, entityId: string): void {
    this._member = {
      groupIndex,
      entityId,
      custom: structuredClone(group.member_actions?.[entityId] ?? {}),
    };
  }

  // A member of an entity group: its entity actions, each the group's or
  // its own (Custom action).
  private _renderMemberDialog() {
    const edit = this._member!;
    const draft = this.draft;
    const group = draft.entity_groups[edit.groupIndex];
    const close = () => (this._member = undefined);
    if (!group) return nothing;
    const display = this.hass
      ? entityDisplay(this.hass, edit.entityId)
      : { primary: edit.entityId, secondary: "" };
    // Room ▸ device above the name, as in Home Assistant's more info dialog.
    return html`<ha-dialog
      open
      width="medium"
      header-title=${display.primary}
      header-subtitle=${display.secondary}
      header-subtitle-position="above"
      @closed=${(ev: Event) => {
        ev.stopPropagation();
        close();
      }}
    >
      <div class="dialog-slots">
        ${renderMemberSlots(this.hass, this.narrow, entityActionSlots(draft, this.category), group.actions, edit.custom, (custom) => {
          this._member = { ...this._member!, custom };
        })}
      </div>
      <ha-dialog-footer slot="footer">
        <ha-button slot="secondaryAction" appearance="plain" @click=${close}>Cancel</ha-button>
        <ha-button
          slot="primaryAction"
          @click=${() => {
            const groups = [...draft.entity_groups];
            const memberActions = { ...(group.member_actions ?? {}) };
            if (Object.keys(edit.custom).length) memberActions[edit.entityId] = edit.custom;
            else delete memberActions[edit.entityId];
            groups[edit.groupIndex] = { ...group, member_actions: memberActions };
            this._emit({ entity_groups: groups });
            close();
          }}
        >
          Save
        </ha-button>
      </ha-dialog-footer>
    </ha-dialog>`;
  }

  private _renderEntityDialog() {
    const edit = this._entity!;
    const draft = this.draft;
    const close = () => (this._entity = undefined);
    const display = this.hass
      ? entityDisplay(this.hass, edit.entityId)
      : { primary: edit.entityId, secondary: "" };
    // Room ▸ device above the name, as in Home Assistant's more info dialog.
    return html`<ha-dialog
      open
      width="medium"
      header-title=${display.primary}
      header-subtitle=${display.secondary}
      header-subtitle-position="above"
      @closed=${(ev: Event) => {
        ev.stopPropagation();
        close();
      }}
    >
      <ha-icon-button
        slot="headerActionItems"
        .label=${"Delete"}
        @click=${() => {
          this._emit({ entities: draft.entities.filter((_item, i) => i !== edit.index) });
          close();
        }}
      >
        <ha-icon icon="mdi:delete"></ha-icon>
      </ha-icon-button>
      <div class="dialog-slots">
        ${renderActionSlots(this.hass, this.narrow, entityActionSlots(draft, this.category), edit.actions, (actions) => {
          this._entity = { ...this._entity!, actions };
        })}
      </div>
      <ha-dialog-footer slot="footer">
        <ha-button slot="secondaryAction" appearance="plain" @click=${close}>Cancel</ha-button>
        <ha-button
          slot="primaryAction"
          @click=${() => {
            const entities = [...draft.entities];
            entities[edit.index] = { ...entities[edit.index], actions: edit.actions };
            this._emit({ entities });
            close();
          }}
        >
          Save
        </ha-button>
      </ha-dialog-footer>
    </ha-dialog>`;
  }

  private _groupClosed(ev: CustomEvent<{ result?: EntityGroup | "delete" }>): void {
    const edit = this._group;
    this._group = undefined;
    const result = ev.detail.result;
    if (!edit || !result || !this.draft) return;
    const groups = [...this.draft.entity_groups];
    if (result === "delete") {
      groups.splice(edit.index, 1);
    } else if (edit.index < 0) {
      groups.push(result);
    } else {
      // A new filter: the fixed list is made again when it is saved.
      const filterChanged = ["domain", "device_class", "areas", "floors", "labels"].some(
        (key) =>
          JSON.stringify(result[key as keyof EntityGroup]) !==
          JSON.stringify(edit.group[key as keyof EntityGroup]),
      );
      groups[edit.index] = filterChanged || result.add_new ? { ...result, members: null } : result;
    }
    this._emit({ entity_groups: groups });
  }

  static override styles = [ACTION_SLOT_STYLES, ENTITIES_BLOCK_STYLES];
}

declare global {
  interface HTMLElementTagNameMap {
    "nc-entities-block": NcEntitiesBlock;
  }
}
