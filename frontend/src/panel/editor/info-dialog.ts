// The Status dialog of a notification (or of one of its steps): its
// status, and for each active step what every channel does now and why.
// Opened from the editor's menu, its status chip and the step menu.

import { LitElement, css, html, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";

import type {
  AudienceState,
  CardState,
  ChannelView,
  Notification,
  NotificationCenterConfig,
  StateMessage,
} from "../../shared/config";
import { formatWhen } from "../../shared/format";
import { categoryOf } from "../../shared/live";
import type { HomeAssistant } from "../../shared/types";
import { avatar } from "../audience-table";
import { STATE_NAMES, effectiveChannel, haPeople } from "../channel-helpers";
import { type ChannelInfo, channelIcon, channelsOf } from "../devices";

const STATE_PHRASES: Record<AudienceState, string> = {
  home: "is at home",
  sleep: "is asleep",
  away: "is not home",
};

type Tone = "sends" | "waits" | "off";

interface ChannelLine {
  text: string;
  tone: Tone;
  icon: string;
}

const TONE_ICONS: Record<Tone, string> = {
  sends: "mdi:check-circle",
  waits: "mdi:pause-circle-outline",
  off: "mdi:close-circle-outline",
};


/** "Anna", "Anna and Béla", "Anna, Béla and Cecil". */
function names(list: string[]): string {
  if (list.length < 2) return list.join("");
  return `${list.slice(0, -1).join(", ")} and ${list[list.length - 1]}`;
}

@customElement("nc-info-dialog")
export class NcInfoDialog extends LitElement {
  @property({ attribute: false }) public hass?: HomeAssistant;

  @property({ attribute: false }) public config?: NotificationCenterConfig;

  @property({ attribute: false }) public state?: StateMessage;

  // The saved notification: the channels are worked out from it.
  @property({ attribute: false }) public notification?: Notification;

  // One step only (Step information).
  @property() public stepId?: string;

  @state() private _open = true;

  // Ticks every 30 seconds, so a delay that ends shows it.
  @state() private _now = Date.now();

  private _timer?: number;

  override connectedCallback(): void {
    super.connectedCallback();
    this._timer = window.setInterval(() => (this._now = Date.now()), 30_000);
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    window.clearInterval(this._timer);
  }

  private _personName(id: string): string {
    const state = this.hass?.states[id];
    return String(state?.attributes.friendly_name ?? id.replace(/^person\./, ""));
  }

  private _when(iso: string | null | undefined): string {
    if (!iso || !this.hass) return "";
    return formatWhen(this.hass, new Date(iso), this._now);
  }

  private _stepName(stepId: string): string {
    const steps = this.notification?.steps ?? [];
    const index = steps.findIndex((step) => step.id === stepId);
    return index < 0 ? "Step" : `Step ${index + 1}`;
  }

  protected override render() {
    const notification = this.notification;
    if (!notification) return nothing;
    const live = this.state?.notifications[notification.id];
    const steps = notification.steps.length;
    const step = this.stepId ? notification.steps.findIndex((item) => item.id === this.stepId) : -1;
    const subtitle =
      step >= 0 && steps > 1 ? `${notification.name} · Step ${step + 1}` : notification.name;
    const cards = (live?.cards ?? []).filter(
      (card) => !this.stepId || card.step_id === this.stepId,
    );
    const active = cards.filter((card) => card.status === "active");
    return html`<ha-dialog
      .open=${this._open}
      width="medium"
      header-title="Status"
      header-subtitle=${subtitle}
      @closed=${this._closed}
    >
      ${live?.entity_id
        ? html`<ha-icon-button slot="headerActionItems" .label=${"More info"} @click=${this._moreInfo}>
            <ha-icon icon="mdi:information-outline"></ha-icon>
          </ha-icon-button>`
        : nothing}
      <div class="section">Status</div>
      <ha-list-base>${this._renderStatus(cards)}</ha-list-base>
      ${active.map((card) => this._renderCard(card, steps > 1 && !this.stepId))}
      <ha-dialog-footer slot="footer">
        <ha-button slot="primaryAction" @click=${() => (this._open = false)}>Close</ha-button>
      </ha-dialog-footer>
    </ha-dialog>`;
  }

  private _row(icon: string, headline: string, text: string, tone?: Tone) {
    return html`<ha-list-item-base>
      <ha-icon slot="start" class="row-icon ${tone ?? ""}" .icon=${icon}></ha-icon>
      <span slot="headline">${headline}</span>
      ${text ? html`<span slot="supporting-text" class=${tone ?? ""}>${text}</span>` : nothing}
    </ha-list-item-base>`;
  }

  private _renderStatus(cards: CardState[]) {
    const notification = this.notification!;
    const live = this.state?.notifications[notification.id];
    const history = live?.history ?? {};
    const latest = (key: string) => {
      const times = Object.entries(history)
        .filter(([id]) => !this.stepId || id === this.stepId)
        .map(([, states]) => states[key])
        .filter((value): value is string => !!value)
        .sort();
      return times[times.length - 1] ?? null;
    };
    const rows = [];
    const active = cards.filter((card) => card.status === "active");
    if (!notification.enabled) {
      rows.push(this._row("mdi:stop-circle-outline", "Disabled", "", "off"));
    } else if (active.length) {
      const since = active.map((card) => card.active_since ?? card.state_since).sort()[0];
      rows.push(
        this._row(
          "mdi:play-circle",
          "Active",
          `Since ${this._when(since)}${active.length > 1 ? ` · ${active.length} notifications` : ""}`,
          "sends",
        ),
      );
    } else {
      rows.push(this._row("mdi:circle-outline", "Not active", "", "off"));
    }
    for (const card of cards) {
      if (card.status === "snoozed" && card.snoozed_until) {
        rows.push(this._row("mdi:alarm-snooze", "Snoozed", `Until ${this._when(card.snoozed_until)}`, "waits"));
      } else if (card.status === "hidden") {
        rows.push(this._row("mdi:eye-off-outline", "Hidden", "The conditions are not met", "waits"));
      }
    }
    const lastActive = latest("active");
    if (lastActive && !active.length) {
      rows.push(this._row("mdi:history", "Last active", this._when(lastActive)));
    }
    const lastDone = latest("done");
    if (lastDone) rows.push(this._row("mdi:check-circle-outline", "Last done", this._when(lastDone)));
    const due = (live?.upcoming ?? [])
      .filter((item) => !this.stepId || item.step_id === this.stepId)
      .map((item) => item.due)
      .sort()[0];
    if (due) rows.push(this._row("mdi:calendar-clock", "Next due", this._when(due)));
    return rows;
  }

  private _renderCard(card: CardState, numbered: boolean) {
    const channels = channelsOf(this.hass, this.config);
    const entity = card.entity_id
      ? String(this.hass?.states[card.entity_id]?.attributes.friendly_name ?? card.entity_id)
      : "";
    const head = [numbered ? this._stepName(card.step_id) : "", entity].filter(Boolean).join(" · ");
    return html`<div class="section">Channels${head ? ` · ${head}` : ""}</div>
      <ha-list-base>
        ${channels.map((channel) => {
          const view = card.channels?.[channel.key];
          if (!view) return nothing;
          const line = this._channelLine(card, channel, view);
          const people = this._renderPeople(card, channel, view);
          // With a row per person below, the channel row is only a heading.
          return html`<ha-list-item-base>
              <span slot="start" class="channel-icon">${channelIcon(this.hass, channel)}</span>
              <span slot="headline">${channel.name}</span>
              ${people === nothing
                ? html`<span slot="supporting-text">${line.text}</span>
                    <ha-icon slot="end" class="row-icon ${line.tone}" .icon=${line.icon}></ha-icon>`
                : nothing}
            </ha-list-item-base>
            ${people}`;
        })}
      </ha-list-base>`;
  }

  /**
   * Dashboard and Push: one row per person under the channel, when the
   * audience decides (not the home mode, the delay or a channel off).
   */
  private _renderPeople(card: CardState, channel: ChannelInfo, view: ChannelView): unknown {
    if (channel.kind !== "dashboard" && channel.kind !== "push") return nothing;
    if (view.reason !== null && view.reason !== "audience") return nothing;
    if (card.silenced && channel.kind === "push") return nothing;
    const people = haPeople(this.hass);
    if (!people.length) return nothing;
    const states = this.state?.people ?? {};
    return people.map((person) => {
      const state = states[person.id] ?? "away";
      const gets = view.people.includes(person.id);
      const noPhone = gets && !!view.no_phone?.includes(person.id);
      let text: string = STATE_NAMES[state];
      if (noPhone) text += " · No phone set";
      else if (!view.audience.includes(person.id)) text += " · Not in the audience";
      else if (!gets) text += ` · Not in the audience while ${STATE_NAMES[state].toLowerCase()}`;
      const ok = gets && !noPhone;
      // Not in the audience now: it waits, like a channel waiting for its
      // home mode. No phone: nothing to wait for, so off.
      const tone: Tone = ok ? "sends" : noPhone ? "off" : "waits";
      return html`<ha-list-item-base class="person">
        <span slot="start" class="person-avatar">${avatar(person)}</span>
        <span slot="headline">${person.name}</span>
        <span slot="supporting-text">${text}</span>
        <ha-icon
          slot="end"
          class="row-icon ${tone}"
          .icon=${TONE_ICONS[tone]}
        ></ha-icon>
      </ha-list-item-base>`;
    });
  }

  private _channelLine(card: CardState, channel: ChannelInfo, view: ChannelView): ChannelLine {
    const everyone = !haPeople(this.hass).length;
    switch (view.reason) {
      case "off":
        return { text: "Off", tone: "off", icon: TONE_ICONS.off };
      case "mode": {
        const modes = this._modesOf(card, channel.key);
        const now = this.config?.modes.find((mode) => mode.id === this.state?.mode)?.name;
        return {
          text: `Waiting for home mode: ${modes.join(" or ")}${now ? ` (now ${now})` : ""}`,
          tone: "waits",
          icon: TONE_ICONS.waits,
        };
      }
      case "delay":
        return { text: `Delay until ${this._when(view.until)}`, tone: "waits", icon: "mdi:timer-sand" };
      case "audience": {
        const people = this.state?.people ?? {};
        const why = view.audience.map(
          (id) => `${this._personName(id)} ${STATE_PHRASES[people[id] ?? "away"]}`,
        );
        return {
          text: why.length ? `Nobody in the audience: ${names(why)}` : "Nobody in the audience",
          tone: "waits",
          icon: TONE_ICONS.waits,
        };
      }
      default:
        break;
    }
    if (card.silenced && channel.kind !== "dashboard") {
      return { text: "Silenced", tone: "off", icon: "mdi:volume-off" };
    }
    const to = view.people.map((id) => this._personName(id));
    const verb = channel.kind === "dashboard" ? "Shows" : "Sends";
    let text = everyone || !to.length ? verb : `${verb} to ${names(to)}`;
    if (channel.kind === "push" && view.no_phone?.length) {
      const missing = view.no_phone.map((id) => this._personName(id));
      if (missing.length === to.length) {
        return { text: `No phone set: ${names(missing)}`, tone: "waits", icon: "mdi:cellphone-off" };
      }
      text += ` · No phone set: ${names(missing)}`;
    }
    return { text, tone: "sends", icon: TONE_ICONS.sends };
  }

  /** The home modes a channel is ticked in, for the card's step. */
  private _modesOf(card: CardState, key: string): string[] {
    const notification = this.notification!;
    const step = notification.steps.find((item) => item.id === card.step_id);
    const category = this.config ? categoryOf(this.config, notification) : undefined;
    const settings = effectiveChannel(category?.channels?.[key], step?.channels?.[key]);
    return (this.config?.modes ?? [])
      .filter((mode) => settings.modes?.includes(mode.id))
      .map((mode) => mode.name);
  }

  private _moreInfo(): void {
    const entityId = this.state?.notifications[this.notification?.id ?? ""]?.entity_id;
    if (!entityId) return;
    this._open = false;
    this.dispatchEvent(
      new CustomEvent("hass-more-info", { detail: { entityId }, bubbles: true, composed: true }),
    );
  }

  private _closed(ev: Event): void {
    if (ev.target !== ev.currentTarget) return;
    ev.stopPropagation();
    this.dispatchEvent(new CustomEvent("info-closed"));
  }

  static override styles = css`
    .section {
      padding: 16px 0 4px;
      color: var(--secondary-text-color);
      font-size: var(--ha-font-size-s, 12px);
      font-weight: var(--ha-font-weight-medium, 500);
      text-transform: uppercase;
      letter-spacing: 0.05em;
    }
    .section:first-child {
      padding-top: 0;
    }
    ha-list-base {
      --ha-list-item-padding-inline: 0;
    }
    .row-icon,
    .channel-icon {
      color: var(--secondary-text-color);
    }
    .row-icon.sends {
      color: var(--ha-color-fill-success-loud-resting, var(--success-color, #4caf50));
    }
    /* A person under Dashboard or Push: indented to the channel's name. */
    ha-list-item-base.person {
      margin-inline-start: 40px;
    }
    /* The person's picture or initials, as in the Audience table. */
    .person-avatar .avatar {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 32px;
      height: 32px;
      border-radius: 50%;
      object-fit: cover;
      overflow: hidden;
      background-color: var(--light-primary-color);
      color: var(--text-light-primary-color, var(--primary-text-color));
      font-size: var(--ha-font-size-s, 12px);
      --ha-person-badge-size: 32px;
    }
    .row-icon.waits {
      color: var(--ha-color-fill-warning-loud-resting, var(--warning-color, #ff9800));
    }
  `;
}

declare global {
  interface HTMLElementTagNameMap {
    "nc-info-dialog": NcInfoDialog;
  }
}
