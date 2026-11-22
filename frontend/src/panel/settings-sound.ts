// The Sound page of the General settings: the speakers and the sirens of
// the Sound channels, the chimes a speaker can play (the built-in ones and
// your own media), and the text-to-speech that reads the message. A
// device's dialog shows what its entity can do; a new one then asks for
// the modes it sends in, in every category.

import { LitElement, html, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";

import {
  BUILTIN_CHIMES,
  type Chime,
  DOMAIN,
  type GeneralSettings,
  type NotificationCenterConfig,
  type Siren,
  type Speaker,
} from "../shared/config";
import { errorText } from "../shared/live";
import type { HomeAssistant } from "../shared/types";
import { confirmDialog } from "./confirm";
import "./devices";
import {
  MEDIA_ANNOUNCE,
  MEDIA_VOLUME_SET,
  SIREN_DURATION,
  SIREN_TONES,
  SIREN_VOLUME_SET,
  channelIcon,
  entityName,
  entityState,
  features,
  testButton,
  testChannel,
} from "./devices";
import { field } from "./fields";
import { DEVICE_PAGE_STYLES } from "./settings-lights";

type Section = "speakers" | "sirens" | "chimes";

type Edit =
  | { section: "speakers"; item: Partial<Speaker> }
  | { section: "sirens"; item: Partial<Siren> }
  | { section: "chimes"; item: Partial<Chime> };

const KIND: Record<"speakers" | "sirens", "speaker" | "siren"> = { speakers: "speaker", sirens: "siren" };

const TITLES: Record<Section, string> = { speakers: "speaker", sirens: "siren", chimes: "chime" };

@customElement("nc-settings-sound")
export class NcSettingsSound extends LitElement {
  @property({ attribute: false }) public hass?: HomeAssistant;

  @property({ attribute: false }) public config?: NotificationCenterConfig;

  @state() private _edit?: Edit;

  @state() private _modesFor?: { key: string; name: string };

  @state() private _error?: string;

  @state() private _dialogError?: string;

  @state() private _busy = false;

  // Read the message, being edited; undefined while unchanged.
  @state() private _reading?: { tts_service?: string | null; language?: string | null };

  protected override render() {
    const config = this.config;
    return html`
      ${this._error ? html`<ha-alert alert-type="error">${this._error}</ha-alert>` : nothing}
      <div class="block-title">Speakers</div>
      ${this._devices("speakers", config?.speakers ?? [], "mdi:speaker")}
      <div class="block-title">Sirens</div>
      <p class="hint">A siren, a switch, or a select whose option sounds the siren (such as a smoke alarm's).</p>
      ${this._devices("sirens", config?.sirens ?? [], "mdi:alarm-light-outline")}
      <div class="block-title">Chimes</div>
      ${this._renderChimes(config?.chimes ?? [])}
      <div class="block-title">Read the message</div>
      ${this._renderReading()}
      ${this._edit ? this._renderDialog(this._edit) : nothing}
      ${this._modesFor
        ? html`<nc-device-modes-dialog
            .hass=${this.hass}
            .modes=${config?.modes ?? []}
            .channel=${this._modesFor.key}
            .name=${this._modesFor.name}
            @closed-dialog=${() => (this._modesFor = undefined)}
          ></nc-device-modes-dialog>`
        : nothing}
    `;
  }

  private _devices(section: "speakers" | "sirens", items: (Speaker | Siren)[], icon: string) {
    return html`${items.length
        ? html`<ha-card outlined>
            <div class="rows">
              ${items.map((item) => {
                const name = entityName(this.hass, item.entity_id);
                return html`<div
                  class="row"
                  role="button"
                  tabindex="0"
                  @click=${() => this._open({ section, item: structuredClone(item) } as Edit)}
                >
                  ${channelIcon(this.hass, { key: `${KIND[section]}:${item.id}`, name, icon, entity_id: item.entity_id })}
                  <div class="text">
                    <div>${name}</div>
                    <div class="secondary">${this._summary(section, item)}</div>
                  </div>
                  <ha-icon-next></ha-icon-next>
                </div>`;
              })}
            </div>
          </ha-card>`
        : nothing}
      <div>
        <ha-button appearance="filled" size="s" @click=${() => this._open({ section, item: { entity_id: "" } } as Edit)}>
          <ha-icon slot="start" icon="mdi:plus"></ha-icon>
          Add ${TITLES[section]}
        </ha-button>
      </div>`;
  }

  private _summary(section: "speakers" | "sirens", item: Speaker | Siren): string {
    const parts: string[] = [];
    if (item.volume !== undefined && item.volume !== null) parts.push(`Volume ${Math.round(item.volume * 100)}%`);
    if (section === "speakers") {
      if (features(entityState(this.hass, item.entity_id)) & MEDIA_ANNOUNCE) parts.push("Announces");
    } else {
      const siren = item as Siren;
      if (siren.option) parts.push(`Option ${siren.option}`);
      if (siren.tone) parts.push(`Tone ${siren.tone}`);
      if (siren.duration) parts.push(`${siren.duration} s`);
    }
    return parts.join(" · ") || item.entity_id;
  }

  private _renderChimes(chimes: Chime[]) {
    return html`<ha-card outlined>
        <div class="rows">
          ${BUILTIN_CHIMES.map(
            (chime) => html`<div class="row static">
              <ha-icon icon="mdi:music-note"></ha-icon>
              <div class="text">
                <div>${chime.name}</div>
                <div class="secondary">Built-in</div>
              </div>
            </div>`,
          )}
          ${chimes.map(
            (chime) => html`<div
              class="row"
              role="button"
              tabindex="0"
              @click=${() => this._open({ section: "chimes", item: structuredClone(chime) })}
            >
              <ha-icon icon="mdi:music-note-outline"></ha-icon>
              <div class="text">
                <div>${chime.name}</div>
                <div class="secondary">${chime.media?.media_content_id ?? ""}</div>
              </div>
              <ha-icon-next></ha-icon-next>
            </div>`,
          )}
        </div>
      </ha-card>
      <div>
        <ha-button appearance="filled" size="s" @click=${() => this._open({ section: "chimes", item: { name: "" } })}>
          <ha-icon slot="start" icon="mdi:plus"></ha-icon>
          Add chime
        </ha-button>
      </div>`;
  }

  private _renderReading() {
    const saved = this.config?.general?.read_the_message ?? {};
    const value = this._reading ?? saved;
    const changed = this._reading !== undefined;
    return html`<ha-card outlined>
      <div class="card-content form">
        <p class="hint">
          A speaker channel can read the message after the chime. It is read with this text-to-speech.
        </p>
        ${field(
          this.hass,
          { entity: { filter: [{ domain: "tts" }] } },
          value.tts_service ?? undefined,
          "Text-to-speech",
          (tts) => (this._reading = { ...value, tts_service: (tts as string) || null }),
        )}
        ${field(
          this.hass,
          { text: {} },
          value.language ?? "",
          "Language",
          (language) => (this._reading = { ...value, language: (language as string) || null }),
          { helper: "Empty: the text-to-speech's own, for example en-US or hu-HU." },
        )}
      </div>
      <div class="card-actions">
        <ha-button .disabled=${this._busy || !changed} @click=${this._saveReading}>Save</ha-button>
      </div>
    </ha-card>`;
  }

  private async _saveReading(): Promise<void> {
    const reading = this._reading;
    if (!reading || !this.hass) return;
    this._busy = true;
    this._error = undefined;
    try {
      const general: Partial<GeneralSettings> = this.config?.general ?? {};
      await this.hass.callWS({
        type: `${DOMAIN}/general/update`,
        data: { ...general, read_the_message: { ...(general.read_the_message ?? {}), ...reading } },
      });
      this._reading = undefined;
    } catch (err) {
      this._error = errorText(err);
    } finally {
      this._busy = false;
    }
  }

  private _open(edit: Edit): void {
    this._dialogError = undefined;
    this._edit = edit;
  }

  private _set(changes: Record<string, unknown>): void {
    const edit = this._edit!;
    this._edit = { ...edit, item: { ...edit.item, ...changes } } as Edit;
  }

  private _valid(edit: Edit): boolean {
    if (edit.section === "chimes") return !!edit.item.name?.trim() && !!edit.item.media?.media_content_id;
    if (!edit.item.entity_id) return false;
    if (edit.section === "sirens" && edit.item.entity_id.startsWith("select.")) return !!edit.item.option;
    return true;
  }

  private _renderDialog(edit: Edit) {
    const id = edit.item.id;
    const title =
      edit.section === "chimes"
        ? id
          ? (edit.item.name ?? "Chime")
          : "Add chime"
        : id
          ? entityName(this.hass, edit.item.entity_id ?? "")
          : `Add ${TITLES[edit.section]}`;
    return html`<ha-dialog
      open
      width="medium"
      header-title=${title}
      @closed=${(ev: Event) => {
        if (ev.target !== ev.currentTarget) return;
        ev.stopPropagation();
        this._edit = undefined;
      }}
    >
      ${edit.section !== "chimes"
        ? testButton("Test", () => void this._test(edit), !edit.item.entity_id)
        : nothing}
      ${id
        ? html`<ha-icon-button slot="headerActionItems" .label=${"Delete"} @click=${() => void this._delete(edit)}>
            <ha-icon icon="mdi:delete"></ha-icon>
          </ha-icon-button>`
        : nothing}
      <div class="form">
        ${this._dialogError ? html`<ha-alert alert-type="error">${this._dialogError}</ha-alert>` : nothing}
        ${edit.section === "speakers"
          ? this._renderSpeaker(edit.item)
          : edit.section === "sirens"
            ? this._renderSiren(edit.item)
            : this._renderChime(edit.item)}
      </div>
      <ha-dialog-footer slot="footer">
        <ha-button slot="secondaryAction" appearance="plain" @click=${() => (this._edit = undefined)}>
          Cancel
        </ha-button>
        <ha-button slot="primaryAction" .disabled=${this._busy || !this._valid(edit)} @click=${this._save}>
          Save
        </ha-button>
      </ha-dialog-footer>
    </ha-dialog>`;
  }

  private _volume(value: number | null | undefined, helper: string) {
    return field(
      this.hass,
      { number: { min: 0, max: 100, step: 1, mode: "box", unit_of_measurement: "%" } },
      value === undefined || value === null ? undefined : Math.round(value * 100),
      "Volume",
      (volume) =>
        this._set({ volume: volume === undefined || volume === null || volume === "" ? null : Number(volume) / 100 }),
      { helper },
    );
  }

  private _renderSpeaker(item: Partial<Speaker>) {
    const state = entityState(this.hass, item.entity_id);
    const supported = features(state);
    return html`
      ${field(
        this.hass,
        { entity: { filter: [{ domain: "media_player" }] } },
        item.entity_id || undefined,
        "Entity",
        (value) => this._set({ entity_id: (value as string) ?? "" }),
      )}
      ${state && supported & MEDIA_VOLUME_SET
        ? this._volume(item.volume, "Empty: the speaker's volume stays as it is.")
        : nothing}
      ${state
        ? html`<ha-alert alert-type="info">
            ${supported & MEDIA_ANNOUNCE
              ? "This speaker announces: what it plays is lowered and comes back after the chime."
              : "This speaker does not announce: what it plays stops for the chime. The volume is set back after it."}
          </ha-alert>`
        : nothing}
    `;
  }

  private _renderSiren(item: Partial<Siren>) {
    const state = entityState(this.hass, item.entity_id);
    const supported = features(state);
    const domain = (item.entity_id ?? "").split(".")[0];
    const options = ((state?.attributes.options as string[] | undefined) ?? []).map((option) => ({
      value: option,
      label: option,
    }));
    const tones = state?.attributes.available_tones as string[] | Record<string, string> | undefined;
    const toneOptions = Array.isArray(tones)
      ? tones.map((tone) => ({ value: tone, label: tone }))
      : Object.entries(tones ?? {}).map(([value, label]) => ({ value, label: String(label) }));
    return html`
      ${field(
        this.hass,
        { entity: { filter: [{ domain: "siren" }, { domain: "switch" }, { domain: "select" }] } },
        item.entity_id || undefined,
        "Entity",
        (value) => this._set({ entity_id: (value as string) ?? "", option: null, stop_option: null, tone: null }),
      )}
      ${domain === "select"
        ? html`<div class="row-fields">
            ${field(
              this.hass,
              { select: { mode: "dropdown", options } },
              item.option ?? "",
              "Sound option",
              (value) => this._set({ option: (value as string) || null }),
              { helper: "Selected while the notification sends." },
            )}
            ${field(
              this.hass,
              { select: { mode: "dropdown", options } },
              item.stop_option ?? "",
              "Stop option",
              (value) => this._set({ stop_option: (value as string) || null }),
              { helper: "Selected when it stops.", clearable: true },
            )}
          </div>`
        : nothing}
      ${domain === "siren" && supported & SIREN_TONES && toneOptions.length
        ? field(
            this.hass,
            { select: { mode: "dropdown", options: toneOptions } },
            item.tone ?? "",
            "Tone",
            (value) => this._set({ tone: (value as string) || null }),
            { clearable: true },
          )
        : nothing}
      ${domain === "siren" && supported & SIREN_VOLUME_SET
        ? this._volume(item.volume, "Empty: the siren's own.")
        : nothing}
      ${domain === "siren" && supported & SIREN_DURATION
        ? field(
            this.hass,
            { number: { min: 1, mode: "box", unit_of_measurement: "s" } },
            item.duration ?? undefined,
            "Duration",
            (value) => this._set({ duration: value === undefined || value === "" ? null : Number(value) }),
            { helper: "Empty: until the notification stops sending." },
          )
        : nothing}
      ${domain === "switch"
        ? html`<p class="hint">The switch is on while the notification sends.</p>`
        : nothing}
    `;
  }

  private _renderChime(item: Partial<Chime>) {
    return html`
      ${field(this.hass, { text: {} }, item.name ?? "", "Name", (value) => this._set({ name: (value as string) ?? "" }))}
      ${field(
        this.hass,
        { media: {} },
        item.media
          ? {
              entity_id: this._speakerForMedia(),
              media_content_id: item.media.media_content_id,
              media_content_type: item.media.media_content_type,
              metadata: item.media.metadata,
            }
          : { entity_id: this._speakerForMedia() },
        "Media",
        (value) => {
          const media = value as Record<string, unknown> | undefined;
          this._set({
            media: media?.media_content_id
              ? {
                  media_content_id: media.media_content_id,
                  media_content_type: media.media_content_type,
                  metadata: media.metadata,
                }
              : undefined,
          });
        },
        { helper: "A sound file of the Media browser, for example from My media." },
      )}
    `;
  }

  // The media selector browses through a speaker: the first one set.
  private _speakerForMedia(): string | undefined {
    return this.config?.speakers?.[0]?.entity_id;
  }

  private async _test(edit: Edit): Promise<void> {
    if (edit.section === "chimes") return;
    this._dialogError = undefined;
    const { id, ...device } = edit.item;
    try {
      await testChannel(this.hass, `${KIND[edit.section]}:${id ?? "new"}`, { device });
    } catch (err) {
      this._dialogError = errorText(err);
    }
  }

  private async _save(): Promise<void> {
    const edit = this._edit;
    if (!edit || !this.hass) return;
    const { id, ...data } = edit.item;
    this._busy = true;
    this._dialogError = undefined;
    try {
      if (id) {
        await this.hass.callWS({ type: `${DOMAIN}/item/update`, section: edit.section, item_id: id, data });
      } else {
        const item = await this.hass.callWS<{ id: string; entity_id?: string }>({
          type: `${DOMAIN}/item/create`,
          section: edit.section,
          data,
        });
        if (edit.section !== "chimes") {
          this._modesFor = {
            key: `${KIND[edit.section]}:${item.id}`,
            name: entityName(this.hass, item.entity_id ?? ""),
          };
        }
      }
      this._edit = undefined;
    } catch (err) {
      this._dialogError = errorText(err);
    } finally {
      this._busy = false;
    }
  }

  private async _delete(edit: Edit): Promise<void> {
    const id = edit.item.id;
    if (!id || !this.hass) return;
    const name =
      edit.section === "chimes" ? (edit.item.name ?? "the chime") : entityName(this.hass, edit.item.entity_id ?? "");
    if (
      !(await confirmDialog(this, {
        title: `Delete ${name}?`,
        text:
          edit.section === "chimes"
            ? "Categories and channels that play it play nothing instead."
            : "It leaves its channel in every category and notification.",
        confirm: "Delete",
        destructive: true,
      }))
    ) {
      return;
    }
    try {
      await this.hass.callWS({ type: `${DOMAIN}/item/delete`, section: edit.section, item_id: id });
      this._edit = undefined;
    } catch (err) {
      this._dialogError = errorText(err);
    }
  }

  static override styles = DEVICE_PAGE_STYLES();
}

declare global {
  interface HTMLElementTagNameMap {
    "nc-settings-sound": NcSettingsSound;
  }
}
