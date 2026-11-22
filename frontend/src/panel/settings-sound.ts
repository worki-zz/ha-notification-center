// The Sound page of the General settings: the speakers and the sirens of
// the Sound channels in one list, with an Add button for each that picks the
// entity at once (its settings take their defaults, a row opens them). Below,
// Chimes opens its own page (the chimes in the lists' order, draggable) and
// Read the message a dialog (the text-to-speech that reads the message).
// A new device then asks for the home modes it sends in, in every category.

import { LitElement, css, html, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { repeat } from "lit/directives/repeat.js";

import {
  type Chime,
  DOMAIN,
  type GeneralSettings,
  type NotificationCenterConfig,
  type Siren,
  type Speaker,
  orderedChimes,
} from "../shared/config";
import { errorText, navigate } from "../shared/live";
import type { HomeAssistant } from "../shared/types";
import { confirmDialog } from "./confirm";
import "./devices";
import {
  MEDIA_ANNOUNCE,
  MEDIA_VOLUME_SET,
  SIREN_DURATION,
  SIREN_TONES,
  SIREN_VOLUME_SET,
  addEntityButton,
  channelIcon,
  entityName,
  entityState,
  features,
  openEntityPicker,
  testButton,
  testChannel,
} from "./devices";
import { field } from "./fields";
import { DEVICE_PAGE_STYLES } from "./settings-lights";

type Edit =
  | { section: "speakers"; item: Partial<Speaker> }
  | { section: "sirens"; item: Partial<Siren> }
  | { section: "chimes"; item: Partial<Chime> };

type DeviceSection = "speakers" | "sirens";

const KIND: Record<DeviceSection, "speaker" | "siren"> = { speakers: "speaker", sirens: "siren" };

const DOMAINS: Record<DeviceSection, string[]> = {
  speakers: ["media_player"],
  sirens: ["siren", "switch", "select"],
};

interface Reading {
  tts_service?: string | null;
  language?: string | null;
}

/** "hu-HU" → "Hungarian (Hungary)", as the browser names it. */
function languageName(code: string): string {
  try {
    const names = new Intl.DisplayNames([navigator.language || "en"], { type: "language" });
    return names.of(code) ?? code;
  } catch {
    return code;
  }
}

@customElement("nc-settings-sound")
export class NcSettingsSound extends LitElement {
  @property({ attribute: false }) public hass?: HomeAssistant;

  @property({ attribute: false }) public config?: NotificationCenterConfig;

  // The Sound page, or its Chimes page.
  @property() public view: "sound" | "chimes" = "sound";

  @property() public base = "/notification-center";

  @state() private _edit?: Edit;

  @state() private _modesFor?: { key: string; name: string };

  @state() private _error?: string;

  @state() private _dialogError?: string;

  @state() private _busy = false;

  // The Add button whose entity picker is open.
  @state() private _adding?: DeviceSection;

  @state() private _sirenInfo = false;

  // The Read the message dialog, while open.
  @state() private _reading?: Reading;

  // The languages of the chosen text-to-speech, by its entity.
  @state() private _languages: Record<string, string[]> = {};

  protected override render() {
    return html`
      ${this._error ? html`<ha-alert alert-type="error">${this._error}</ha-alert>` : nothing}
      ${this.view === "chimes" ? this._renderChimes() : this._renderSound()}
      ${this._edit ? this._renderDialog(this._edit) : nothing}
      ${this._reading ? this._renderReading(this._reading) : nothing}
      ${this._modesFor
        ? html`<nc-device-modes-dialog
            .hass=${this.hass}
            .modes=${this.config?.modes ?? []}
            .channel=${this._modesFor.key}
            .name=${this._modesFor.name}
            @closed-dialog=${() => (this._modesFor = undefined)}
          ></nc-device-modes-dialog>`
        : nothing}
    `;
  }

  // -- The Sound page --------------------------------------------------------

  private _renderSound() {
    const config = this.config;
    const speakers = config?.speakers ?? [];
    const sirens = config?.sirens ?? [];
    const reading = config?.general?.read_the_message ?? {};
    const chimes = orderedChimes(config);
    return html`
      ${speakers.length || sirens.length
        ? html`<ha-card outlined>
            ${speakers.length
              ? html`<div class="group-header">Speakers</div>
                  <div class="rows">${speakers.map((item) => this._deviceRow("speakers", item))}</div>`
              : nothing}
            ${sirens.length
              ? html`${this._sirenHeader()}
                  <div class="rows">${sirens.map((item) => this._deviceRow("sirens", item))}</div>`
              : nothing}
          </ha-card>`
        : html`<ha-alert alert-type="info">No speakers or sirens yet.</ha-alert>`}
      <div class="buttons">
        ${this._addButton("speakers", "Add speaker", "mdi:speaker")}
        ${this._addButton("sirens", "Add siren", "mdi:alarm-light-outline")}
      </div>
      <ha-card outlined>
        <ha-list-base>
          <ha-list-item-button @click=${() => navigate(`${this.base}/settings/general/chimes`)}>
            <ha-icon slot="start" class="nav-icon" icon="mdi:music-note-outline"></ha-icon>
            <span slot="headline">Chimes</span>
            <span slot="supporting-text">${chimes.map((chime) => chime.name).join(", ")}</span>
            <ha-icon-next slot="end"></ha-icon-next>
          </ha-list-item-button>
          <ha-list-item-button @click=${this._openReading}>
            <ha-icon slot="start" class="nav-icon" icon="mdi:account-voice"></ha-icon>
            <span slot="headline">Read the message</span>
            <span slot="supporting-text"
              >${reading.tts_service
                ? [entityName(this.hass, reading.tts_service), reading.language ? languageName(reading.language) : ""]
                    .filter(Boolean)
                    .join(" · ")
                : "No text-to-speech chosen"}</span
            >
          </ha-list-item-button>
        </ha-list-base>
      </ha-card>
    `;
  }

  private _sirenHeader() {
    return html`<div class="group-header">
        Sirens
        <ha-icon-button
          class="info"
          .label=${"What can be a siren"}
          @click=${() => (this._sirenInfo = !this._sirenInfo)}
        >
          <ha-icon icon="mdi:information-outline"></ha-icon>
        </ha-icon-button>
      </div>
      ${this._sirenInfo
        ? html`<p class="hint group-hint">A siren, a switch, or a select whose option sounds the siren.</p>`
        : nothing}`;
  }

  private _deviceRow(section: DeviceSection, item: Speaker | Siren) {
    const name = entityName(this.hass, item.entity_id);
    const icon = section === "speakers" ? "mdi:speaker" : "mdi:alarm-light-outline";
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
  }

  private _addButton(section: DeviceSection, label: string, icon: string) {
    const used = [...(this.config?.speakers ?? []), ...(this.config?.sirens ?? [])].map((item) => item.entity_id);
    return addEntityButton({
      hass: this.hass,
      adding: this._adding === section,
      label,
      icon,
      className: `add-${section}`,
      domains: DOMAINS[section],
      exclude: used,
      start: () => {
        this._adding = section;
        void openEntityPicker(this, `add-${section}`);
      },
      picked: (entityId) => {
        this._adding = undefined;
        if (entityId) void this._add(section, entityId);
      },
    });
  }

  // A new speaker or siren with its defaults; a select first asks which
  // option sounds the siren.
  private async _add(section: DeviceSection, entityId: string): Promise<void> {
    if (section === "sirens" && entityId.startsWith("select.")) {
      this._open({ section, item: { entity_id: entityId } });
      return;
    }
    this._error = undefined;
    try {
      await this._create(section, { entity_id: entityId });
    } catch (err) {
      this._error = errorText(err);
    }
  }

  private async _create(section: DeviceSection, data: Record<string, unknown>): Promise<void> {
    const item = await this.hass!.callWS<{ id: string; entity_id: string }>({
      type: `${DOMAIN}/item/create`,
      section,
      data,
    });
    this._modesFor = { key: `${KIND[section]}:${item.id}`, name: entityName(this.hass, item.entity_id) };
  }

  private _summary(section: DeviceSection, item: Speaker | Siren): string {
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

  // -- The Chimes page -------------------------------------------------------

  private _renderChimes() {
    const own = new Map((this.config?.chimes ?? []).map((chime) => [chime.id, chime]));
    const chimes = orderedChimes(this.config);
    return html`<ha-card outlined>
        <ha-sortable handle-selector=".handle" @item-moved=${this._chimeMoved}>
          <div class="rows">
            ${repeat(
              chimes,
              (chime) => chime.id,
              (chime) => {
                const item = own.get(chime.id);
                return html`<div
                  class=${item ? "row" : "row static"}
                  role=${item ? "button" : nothing}
                  tabindex=${item ? "0" : nothing}
                  @click=${() => {
                    if (item) this._open({ section: "chimes", item: structuredClone(item) });
                  }}
                >
                  <div class="handle" title="Drag to reorder" @click=${(ev: Event) => ev.stopPropagation()}>
                    <ha-icon icon="mdi:drag-horizontal-variant"></ha-icon>
                  </div>
                  <ha-icon .icon=${item ? "mdi:music-note-outline" : "mdi:music-note"}></ha-icon>
                  <div class="text">
                    <div>${chime.name}</div>
                    <div class="secondary">${item ? (item.media?.media_content_id ?? "") : "Built-in"}</div>
                  </div>
                  ${item ? html`<ha-icon-next></ha-icon-next>` : nothing}
                </div>`;
              },
            )}
          </div>
        </ha-sortable>
      </ha-card>
      <div>
        <ha-button appearance="filled" size="s" @click=${() => this._open({ section: "chimes", item: { name: "" } })}>
          <ha-icon slot="start" icon="mdi:plus"></ha-icon>
          Add chime
        </ha-button>
      </div>`;
  }

  private async _chimeMoved(ev: CustomEvent<{ oldIndex: number; newIndex: number }>): Promise<void> {
    ev.stopPropagation();
    const ids = orderedChimes(this.config).map((chime) => chime.id);
    const [moved] = ids.splice(ev.detail.oldIndex, 1);
    ids.splice(ev.detail.newIndex, 0, moved);
    this._error = undefined;
    await this._updateGeneral({ chime_order: ids }, (err) => (this._error = err));
  }

  private async _updateGeneral(changes: Partial<GeneralSettings>, failed: (error: string) => void): Promise<boolean> {
    if (!this.hass) return false;
    this._busy = true;
    try {
      const general: Partial<GeneralSettings> = this.config?.general ?? {};
      await this.hass.callWS({ type: `${DOMAIN}/general/update`, data: { ...general, ...changes } });
      return true;
    } catch (err) {
      failed(errorText(err));
      return false;
    } finally {
      this._busy = false;
    }
  }

  // -- Read the message ------------------------------------------------------

  private _openReading(): void {
    const saved = this.config?.general?.read_the_message ?? {};
    this._dialogError = undefined;
    this._reading = { tts_service: saved.tts_service ?? null, language: saved.language ?? null };
    if (saved.tts_service) void this._loadLanguages(saved.tts_service);
  }

  private async _loadLanguages(entityId: string): Promise<void> {
    if (!this.hass || this._languages[entityId]) return;
    try {
      const result = await this.hass.callWS<{ provider?: { supported_languages?: string[] } }>({
        type: "tts/engine/get",
        engine_id: entityId,
      });
      this._languages = { ...this._languages, [entityId]: result.provider?.supported_languages ?? [] };
    } catch {
      this._languages = { ...this._languages, [entityId]: [] };
    }
  }

  private _renderReading(reading: Reading) {
    const languages = reading.tts_service ? (this._languages[reading.tts_service] ?? []) : [];
    const options = languages
      .map((code) => ({ value: code, label: `${languageName(code)} (${code})` }))
      .sort((a, b) => a.label.localeCompare(b.label));
    if (reading.language && !languages.includes(reading.language)) {
      options.unshift({ value: reading.language, label: `${languageName(reading.language)} (${reading.language})` });
    }
    return html`<ha-dialog
      open
      width="medium"
      header-title="Read the message"
      @closed=${(ev: Event) => {
        if (ev.target !== ev.currentTarget) return;
        ev.stopPropagation();
        this._reading = undefined;
      }}
    >
      <div class="form">
        <p class="hint">Choose the text-to-speech service that reads the message aloud on the speakers.</p>
        ${this._dialogError ? html`<ha-alert alert-type="error">${this._dialogError}</ha-alert>` : nothing}
        ${field(
          this.hass,
          { entity: { filter: [{ domain: "tts" }] } },
          reading.tts_service ?? undefined,
          "Text-to-speech",
          (tts) => {
            const entityId = (tts as string) || null;
            this._reading = {
              tts_service: entityId,
              language: entityId === reading.tts_service ? reading.language : null,
            };
            if (entityId) void this._loadLanguages(entityId);
          },
        )}
        ${reading.tts_service
          ? field(
              this.hass,
              { select: { mode: "dropdown", options } },
              reading.language ?? "",
              "Language",
              (language) => (this._reading = { ...reading, language: (language as string) || null }),
              { clearable: true },
            )
          : nothing}
      </div>
      <ha-dialog-footer slot="footer">
        <ha-button slot="secondaryAction" appearance="plain" @click=${() => (this._reading = undefined)}>
          Cancel
        </ha-button>
        <ha-button slot="primaryAction" .disabled=${this._busy} @click=${this._saveReading}>Save</ha-button>
      </ha-dialog-footer>
    </ha-dialog>`;
  }

  private async _saveReading(): Promise<void> {
    const reading = this._reading;
    if (!reading) return;
    this._dialogError = undefined;
    const saved = this.config?.general?.read_the_message ?? {};
    const done = await this._updateGeneral(
      { read_the_message: { ...saved, ...reading } },
      (err) => (this._dialogError = err),
    );
    if (done) this._reading = undefined;
  }

  // -- The dialog of a speaker, a siren or a chime ---------------------------

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
        : entityName(this.hass, edit.item.entity_id ?? "");
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
      ${edit.section !== "chimes" ? testButton("Test", () => void this._test(edit), !this._valid(edit)) : nothing}
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
      ${state && supported & MEDIA_VOLUME_SET
        ? this._volume(item.volume, "Empty: the speaker's volume stays as it is.")
        : nothing}
      ${state
        ? html`<ha-alert alert-type="info">
            ${supported & MEDIA_ANNOUNCE
              ? "This speaker announces: what it plays is lowered and comes back after the chime."
              : "This speaker does not announce: what it plays stops for the chime."}
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
    const sirenFields =
      domain === "siren" && [SIREN_TONES, SIREN_VOLUME_SET, SIREN_DURATION].some((bit) => supported & bit);
    return html`
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
        : domain === "siren" && !sirenFields
          ? html`<p class="hint">The siren sounds while the notification sends.</p>`
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
      } else if (edit.section === "chimes") {
        await this.hass.callWS({ type: `${DOMAIN}/item/create`, section: edit.section, data });
      } else {
        await this._create(edit.section, data);
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

  static override styles = [
    DEVICE_PAGE_STYLES(),
    css`
      .handle {
        cursor: grab;
        display: flex;
        color: var(--secondary-text-color);
        margin-inline-end: -4px;
      }
      .nav-icon {
        color: var(--secondary-text-color);
      }
    `,
  ];
}

declare global {
  interface HTMLElementTagNameMap {
    "nc-settings-sound": NcSettingsSound;
  }
}
