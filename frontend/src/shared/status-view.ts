// The Status of one card, in the Notification details dialog: what it is
// now, what starts and ends it, its steps, and for an active card what
// every channel does now and why.

import { html, nothing } from "lit";

import { STATE_NAMES, haPeople } from "../panel/channel-helpers";
import { avatar } from "./avatar";
import { channelIcon, channelsOf, type ChannelInfo, type ChannelKind } from "./channel-info";
import { effectiveChannel, modeColumns } from "./channels";
import type { AudienceState, CardState, ChannelView } from "./config";
import { detailsOf, statusLabel, type DetailsData, type DetailsTarget } from "./details";
import { entityState, formatTime, formatWhen } from "./format";
import { audienceOf, inAudience } from "./live";
import type { StoreData } from "./store";
import type { HomeAssistant } from "./types";

export interface StatusContext {
  hass: HomeAssistant;
  store: StoreData;
  data: DetailsData;
  now: number;
  // Open the Status of another step.
  select: (target: DetailsTarget) => void;
  // Open an entity's more info.
  moreInfo: (entityId: string) => void;
}

type Tone = "sends" | "waits" | "off";

const TONE_ICONS: Record<Tone, string> = {
  sends: "mdi:check-circle",
  waits: "mdi:pause-circle-outline",
  off: "mdi:close-circle-outline",
};

const STATUS_ICONS: Record<DetailsData["status"], string> = {
  active: "mdi:play-circle-outline",
  hidden: "mdi:eye-off-outline",
  snoozed: "mdi:alarm-snooze",
  done: "mdi:check-circle-outline",
  dismissed: "mdi:close-circle-outline",
  upcoming: "mdi:clock-outline",
  idle: "mdi:circle-outline",
  disabled: "mdi:stop-circle-outline",
};

const KIND_TITLES: Record<ChannelKind, string> = {
  dashboard: "Dashboard",
  push: "Push",
  light: "Lights",
  speaker: "Speakers",
  siren: "Sirens",
};

const WEEKDAY_NAMES: Record<string, string> = {
  mon: "Monday",
  tue: "Tuesday",
  wed: "Wednesday",
  thu: "Thursday",
  fri: "Friday",
  sat: "Saturday",
  sun: "Sunday",
};

const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

// The parts of a stored step the Status reads (the shared type is smaller).
interface StoredSchedule {
  type: "calendar" | "after_last_done";
  every: number | string;
  unit: "days" | "weeks" | "months" | "years";
  weekdays?: string[];
  day_of_month?: number | "last";
  month?: number;
  at?: string | null;
}

interface StoredStep {
  activation?: { type?: string; triggers?: unknown[]; schedule?: StoredSchedule };
  conditions?: { conditions?: unknown[] };
}

/** "a", "a or b", "a, b or c". */
function orList(items: string[]): string {
  return items.length < 2
    ? (items[0] ?? "")
    : `${items.slice(0, -1).join(", ")} or ${items[items.length - 1]}`;
}

/** "a", "a and b", "a, b and c". */
function andList(items: string[]): string {
  return items.length < 2
    ? (items[0] ?? "")
    : `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

function plural(count: number, word: string): string {
  return `${count} ${word}${count === 1 ? "" : "s"}`;
}

function entityName(hass: HomeAssistant, entityId: string): string {
  return String(hass.states[entityId]?.attributes.friendly_name ?? entityId);
}

/** An entity's name and state, as a row's second line says it. */
function entityText(hass: HomeAssistant, entityId: string): string {
  const stateObj = hass.states[entityId];
  return stateObj ? `${entityName(hass, entityId)} · ${entityState(hass, stateObj)}` : entityId;
}

/** A schedule in words: "Every 2 weeks on Tuesday at 19:00". */
export function scheduleText(hass: HomeAssistant, schedule: StoredSchedule): string {
  const unit = schedule.unit;
  const singular = unit.slice(0, -1);
  let every: string;
  if (typeof schedule.every === "string") {
    const stateObj = hass.states[schedule.every];
    every = `Every ${stateObj ? entityState(hass, stateObj) : "?"} ${unit}`;
  } else {
    every = schedule.every === 1 ? `Every ${singular}` : `Every ${schedule.every} ${unit}`;
  }
  const parts = [every];
  if (schedule.type === "calendar") {
    if (unit === "weeks" && schedule.weekdays?.length) {
      parts.push(`on ${andList(schedule.weekdays.map((day) => WEEKDAY_NAMES[day] ?? day))}`);
    }
    const day =
      schedule.day_of_month === "last" ? "the last day" : schedule.day_of_month ? `day ${schedule.day_of_month}` : "";
    if (unit === "months" && day) parts.push(`on ${day}`);
    if (unit === "years" && schedule.month) {
      parts.push(`on ${day ? `${day} of ` : ""}${MONTHS[schedule.month - 1] ?? schedule.month}`);
    }
  } else {
    parts.push("after it was done");
  }
  if (schedule.at) {
    const [hours, minutes] = schedule.at.split(":").map(Number);
    const at = new Date();
    at.setHours(hours || 0, minutes || 0, 0, 0);
    parts.push(`at ${formatTime(hass, at, "time")}`);
  }
  return parts.join(" ");
}

function row(icon: string, headline: string, text: string, tone?: Tone) {
  return html`<ha-list-item-base>
    <ha-icon slot="start" class="row-icon ${tone ?? ""}" .icon=${icon}></ha-icon>
    <span slot="headline">${headline}</span>
    ${text ? html`<span slot="supporting-text">${text}</span>` : nothing}
  </ha-list-item-base>`;
}

function linkRow(icon: string, headline: string, text: string, click: () => void) {
  return html`<ha-list-item-button @click=${click}>
    <ha-icon slot="start" class="row-icon" .icon=${icon}></ha-icon>
    <span slot="headline">${headline}</span>
    ${text ? html`<span slot="supporting-text">${text}</span>` : nothing}
    <ha-icon slot="end" class="chevron" icon="mdi:chevron-right"></ha-icon>
  </ha-list-item-button>`;
}

function block(title: string, rows: unknown[]) {
  if (!rows.length) return nothing;
  return html`<ha-card outlined class="block">
    ${title ? html`<div class="block-title">${title}</div>` : nothing}
    <ha-list-base>${rows}</ha-list-base>
  </ha-card>`;
}

/** The status in a line: "Snoozed · until 13:00". */
function statusValue(ctx: StatusContext): string {
  const { hass, data, now } = ctx;
  const card = data.card;
  const time = (iso: string | null | undefined) =>
    iso ? formatTime(hass, new Date(iso), "time", now) : "";
  switch (data.status) {
    case "active":
      return card?.muted ? "Active · muted" : "Active";
    case "hidden":
      return "Hidden · the conditions are not met";
    case "snoozed":
      return card?.snoozed_until
        ? `Snoozed · until ${formatWhen(hass, new Date(card.snoozed_until), now)}`
        : "Snoozed";
    case "done":
      return `Done · ${time(card?.closed_at)}`;
    case "dismissed":
      return `Dismissed · ${time(card?.closed_at)}`;
    case "upcoming":
      return data.due ? `Upcoming · shows ${formatWhen(hass, data.due, now)}` : "Upcoming";
    case "disabled":
      return "Disabled";
    default:
      return "Idle";
  }
}

// Block 1: the status, since when it is active, when it was last done.
function renderStatusBlock(ctx: StatusContext) {
  const { hass, store, data, now } = ctx;
  const card = data.card;
  const rows = [row(STATUS_ICONS[data.status], "Status", statusValue(ctx))];
  const open = card && (card.status === "active" || card.status === "hidden" || card.status === "snoozed");
  const since = open ? (card.active_since ?? card.state_since) : undefined;
  if (since) rows.push(row("mdi:clock-start", "Active since", formatWhen(hass, new Date(since), now)));
  const history = store.state?.notifications[data.notification.id]?.history ?? {};
  const lastDone = history[data.target.stepId]?.done;
  if (lastDone) rows.push(row("mdi:history", "Last done", formatWhen(hass, new Date(lastDone), now)));
  return block("", rows);
}

// Block 2: what starts the step and when it ends by itself.
function renderStartBlock(ctx: StatusContext) {
  const { hass, data, now } = ctx;
  const card = data.card;
  const step = data.live.step as unknown as StoredStep | undefined;
  const activation = step?.activation;
  const rows: unknown[] = [];
  const trigger = card?.trigger as { entity_id?: unknown } | null | undefined;
  if (activation?.type === "schedule" && activation.schedule) {
    const schedule = activation.schedule;
    const repeat = schedule.type === "after_last_done";
    rows.push(row(repeat ? "mdi:repeat" : "mdi:calendar-clock", repeat ? "Repeat" : "Schedule", scheduleText(hass, schedule)));
    if (typeof schedule.every === "string" && schedule.every) {
      const entityId = schedule.every;
      rows.push(linkRow("mdi:counter", "Frequency", entityText(hass, entityId), () => ctx.moreInfo(entityId)));
    }
  } else if (typeof trigger?.entity_id === "string" && hass.states[trigger.entity_id]) {
    const entityId = trigger.entity_id;
    rows.push(linkRow("mdi:flash-outline", "Trigger", entityText(hass, entityId), () => ctx.moreInfo(entityId)));
  } else {
    const triggers = activation?.triggers?.length ?? 0;
    const conditions = step?.conditions?.conditions?.length ?? 0;
    const summary = [triggers ? plural(triggers, "trigger") : "", conditions ? plural(conditions, "condition") : ""]
      .filter(Boolean)
      .join(" · ");
    rows.push(row("mdi:flash-outline", "Trigger", summary || "No trigger"));
  }
  const entityId = data.target.entityId;
  if (entityId && entityId !== trigger?.entity_id) {
    rows.push(linkRow("mdi:shape-outline", "Entity", entityText(hass, entityId), () => ctx.moreInfo(entityId)));
  }
  const open = card && (card.status === "active" || card.status === "hidden" || card.status === "snoozed");
  if (open && card.expires_at) {
    const verb = card.expires_as === "done" ? "Done" : "Dismiss";
    rows.push(row("mdi:timer-sand", "Expiration", `${verb} at ${formatWhen(hass, new Date(card.expires_at), now)}`));
  }
  return block("", rows);
}

/** The card of another step the Steps rows show: the same entity's, else an open one. */
function stepTarget(ctx: StatusContext, stepId: string): DetailsTarget {
  const { data, store } = ctx;
  const cards = store.state?.notifications[data.notification.id]?.cards ?? [];
  const own = cards.filter((card) => card.step_id === stepId);
  const card =
    own.find((item) => item.entity_id === data.target.entityId) ??
    own.find((item) => item.status === "active" || item.status === "snoozed" || item.status === "hidden") ??
    own[0];
  return { notificationId: data.notification.id, stepId, entityId: card?.entity_id ?? null };
}

// Block 3: the steps (with two or more), the current one marked.
function renderSteps(ctx: StatusContext) {
  const { hass, store, data, now } = ctx;
  const steps = data.notification.steps;
  if (steps.length < 2) return nothing;
  const rows = steps.map((step, index) => {
    const target = step.id === data.target.stepId ? data.target : stepTarget(ctx, step.id);
    const item = detailsOf(store, target);
    const headline = `${index + 1}. ${item?.message || `Step ${index + 1}`}`;
    const text = item ? statusLabel(hass, item, now) : "";
    const icon = STATUS_ICONS[item?.status ?? "idle"];
    if (step.id === data.target.stepId) {
      return html`<ha-list-item-base class="current">
        <ha-icon slot="start" class="row-icon" .icon=${icon}></ha-icon>
        <span slot="headline">${headline}</span>
        <span slot="supporting-text">${text}</span>
      </ha-list-item-base>`;
    }
    return linkRow(icon, headline, text, () => ctx.select(target));
  });
  return block("Steps", rows);
}

/** The home modes a channel is ticked in, for the card's step, by name. */
function modesOf(ctx: StatusContext, key: string): string[] {
  const { data, store } = ctx;
  const settings = effectiveChannel(data.live.category?.channels?.[key], data.live.step?.channels?.[key]);
  return modeColumns(store.config?.modes)
    .filter((mode) => settings.modes?.includes(mode.id))
    .map((mode) => mode.name);
}

/** What the channel itself says (home mode, delay, off, muted); empty: it sends. */
function channelText(ctx: StatusContext, channel: ChannelInfo, view: ChannelView, card: CardState): { text: string; tone?: Tone } {
  switch (view.reason) {
    case "off":
      return { text: "Off", tone: "off" };
    case "mode": {
      const modes = modesOf(ctx, channel.key);
      return {
        text: modes.length ? `Waits for the ${orList(modes)} home mode` : "Waits for another home mode",
        tone: "waits",
      };
    }
    case "delay":
      return {
        text: view.until ? `Waits until ${formatWhen(ctx.hass, new Date(view.until), ctx.now)}` : "Waits for its delay",
        tone: "waits",
      };
    default:
      break;
  }
  if (card.muted && channel.kind !== "dashboard") return { text: "Muted", tone: "off" };
  return { text: "" };
}

// Dashboard and Push: a row per person, the channel's text and the
// audience's side by side.
function personRows(ctx: StatusContext, channel: ChannelInfo, view: ChannelView, card: CardState) {
  const { hass, store, data } = ctx;
  const people = haPeople(hass);
  const own = channelText(ctx, channel, view, card);
  if (!people.length || view.reason === "off") {
    const tone = own.tone ?? "sends";
    return [
      html`<ha-list-item-base>
        <span slot="start" class="channel-icon">${channelIcon(hass, channel)}</span>
        <span slot="headline">${channel.name}</span>
        <span slot="supporting-text">${own.text || (channel.kind === "dashboard" ? "Shows" : "Sends")}</span>
        <ha-icon slot="end" class="row-icon ${tone}" .icon=${TONE_ICONS[tone]}></ha-icon>
      </ha-list-item-base>`,
    ];
  }
  const states = store.state?.people ?? {};
  const ids = people.map((person) => person.id);
  const audience = audienceOf(data.live.category, data.live.step, ids);
  return people.map((person) => {
    const state: AudienceState = states[person.id] ?? "away";
    const inAny = inAudience(data.live.category, data.live.step, person.id, ids);
    const inNow = audience[person.id]?.[state] ?? true;
    const noPhone = channel.kind === "push" && !!view.no_phone?.includes(person.id);
    let audienceText: string = STATE_NAMES[state];
    let tone: Tone = own.tone ?? "sends";
    if (!inAny) {
      audienceText = "Not in the audience";
      tone = "off";
    } else if (!inNow) {
      audienceText = `Not in the audience while ${STATE_NAMES[state].toLowerCase()}`;
      if (tone === "sends") tone = "waits";
    } else if (noPhone) {
      audienceText = `${STATE_NAMES[state]} · No phone set`;
      tone = "off";
    }
    const text = [own.text, audienceText].filter(Boolean).join(" · ");
    return html`<ha-list-item-base>
      <span slot="start" class="person-avatar">${avatar(person)}</span>
      <span slot="headline">${person.name}</span>
      <span slot="supporting-text">${text}</span>
      <ha-icon slot="end" class="row-icon ${tone}" .icon=${TONE_ICONS[tone]}></ha-icon>
    </ha-list-item-base>`;
  });
}

// A light, speaker or siren: one row, what it does now.
function deviceRow(ctx: StatusContext, channel: ChannelInfo, view: ChannelView, card: CardState) {
  const own = channelText(ctx, channel, view, card);
  let text = own.text;
  let tone = own.tone;
  if (!text && view.reason === "audience") {
    text = "Waits for someone of the audience";
    tone = "waits";
  }
  return html`<ha-list-item-base>
    <span slot="start" class="channel-icon">${channelIcon(ctx.hass, channel)}</span>
    <span slot="headline">${channel.name}</span>
    <span slot="supporting-text">${text || "Sends"}</span>
    <ha-icon slot="end" class="row-icon ${tone ?? "sends"}" .icon=${TONE_ICONS[tone ?? "sends"]}></ha-icon>
  </ha-list-item-base>`;
}

// The channel blocks of an active card, one per channel type.
function renderChannels(ctx: StatusContext) {
  const card = ctx.data.card;
  if (!card || card.status !== "active" || !card.channels) return nothing;
  const groups = new Map<ChannelKind, unknown[]>();
  for (const channel of channelsOf(ctx.hass, ctx.store.config)) {
    const view = card.channels[channel.key];
    const kind = channel.kind;
    if (!view || !kind) continue;
    const rows =
      kind === "dashboard" || kind === "push"
        ? personRows(ctx, channel, view, card)
        : [deviceRow(ctx, channel, view, card)];
    groups.set(kind, [...(groups.get(kind) ?? []), ...rows]);
  }
  return [...groups.entries()].map(([kind, rows]) => block(KIND_TITLES[kind], rows));
}

/** The Status of a card: its blocks, under the summary row. */
export function renderStatus(ctx: StatusContext) {
  return html`${renderStatusBlock(ctx)} ${renderStartBlock(ctx)} ${renderSteps(ctx)} ${renderChannels(ctx)}`;
}
