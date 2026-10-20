import type {
  FloorCueIcon,
  FloorMapCue,
  FloorMapFill,
  FloorMapOutline,
  FloorMapPulse,
} from "@waitron/ui";
import type { TableState } from "../api/client.js";
import { countText, t } from "../i18n/t.js";
import type { StringKey } from "../i18n/strings.js";
import { heldChip } from "../widgets/signal-chips.js";
import { needsMovingToday } from "./floor-today.js";
import { minutesToFire, reminderDueAt } from "./release-reminder.js";
import { PRECEDENCE, tableStates, type TableStateKind } from "./table-precedence.js";

/** `delivery` and `moving` are drawn on the map only; the list card does not rank them. */
export type MapKind = TableStateKind | "delivery" | "moving";

export const MAP_PRECEDENCE: readonly MapKind[] = PRECEDENCE.flatMap((kind): MapKind[] => {
  if (kind === "step") return [kind, "delivery"];
  if (kind === "clearing") return [kind, "moving"];
  return [kind];
});

const inMapOrder = (kinds: ReadonlySet<MapKind>): MapKind[] =>
  MAP_PRECEDENCE.filter((kind) => kinds.has(kind));

/**
 * Nothing needed means no other state, so it goes once a map-only kind or another member brings
 * one; and Needs clearing's words win over Needs moving's, because it must be cleared first.
 */
function settled(kinds: Set<MapKind>): MapKind[] {
  if (kinds.has("clearing")) kinds.delete("moving");
  const nothingNeeded = MAP_PRECEDENCE.indexOf("nothing-needed");
  if ([...kinds].some((kind) => MAP_PRECEDENCE.indexOf(kind) < nothingNeeded))
    kinds.delete("nothing-needed");
  return inMapOrder(kinds);
}

export function mapKinds(table: TableState, now: number): MapKind[] {
  const kinds = new Set<MapKind>(tableStates(table, now));
  if (needsMovingToday(table)) kinds.add("moving");
  if (table.state === "delivery-pending") kinds.add("delivery");
  return settled(kinds);
}

export interface MapLook {
  fill: FloorMapFill;
  outline: FloorMapOutline | null;
  pulse: FloorMapPulse | null;
  cue: FloorMapCue | null;
  top: MapKind | undefined;
  kinds: MapKind[];
  description: string;
}

/** The kinds above Reserved that bring a fill of their own; any other kind takes the next one's. */
const FILL_OF: Partial<Record<MapKind, FloorMapFill>> = {
  forgotten: "danger",
  unavailable: "warning",
  fire: "warning",
  bill: "bill",
  ready: "ready",
  step: "seated",
  delivery: "seated",
  "not-sent": "seated",
  held: "calm",
  "nothing-needed": "calm",
};

const PULSES: readonly FloorMapPulse[] = ["forgotten", "overdue", "fire"];

const FIXED_CUE: Partial<Record<MapKind, { icon: FloorCueIcon; text: StringKey }>> = {
  forgotten: { icon: "floor-timer", text: "floor.forgotten" },
  overdue: { icon: "floor-timer", text: "signal.wait_overdue" },
  unavailable: { icon: "floor-out", text: "floor.cue_out" },
  fire: { icon: "floor-fire", text: "floor.cue_fire" },
  bill: { icon: "floor-bill", text: "floor.cue_bill" },
  step: { icon: "floor-step", text: "signal.take_order" },
  "not-sent": { icon: "floor-unsent", text: "floor.unsent_mark" },
  waiting: { icon: "floor-timer", text: "signal.wait_warm" },
  clearing: { icon: "floor-clear", text: "floor.cue_clear" },
  moving: { icon: "floor-move", text: "floor.cue_move" },
};

const FIXED_WORDS: Partial<Record<MapKind, StringKey>> = {
  forgotten: "floor.forgotten",
  overdue: "signal.wait_overdue",
  fire: "floor.fire_due",
  bill: "signal.bill_requested",
  step: "signal.take_order",
  "not-sent": "floor.unsent_mark",
  waiting: "signal.wait_warm",
  clearing: "floor.needs_clearing",
  moving: "floor.needs_moving",
  "nothing-needed": "floor.nothing_needed",
  free: "floor.free",
};

/** "2 ready", or "1 ready" for one. */
export function readyText(n: number): string {
  return countText(n, "table.flash_ready", "table.flash_ready_one");
}

function readyCount(table: TableState): number {
  if (table.readyToServe > 0) return table.readyToServe;
  const atStations = table.signals
    .flatMap((signal) => (signal.kind === "ready" ? signal.byStation : []))
    .reduce((sum, { count }) => sum + count, 0);
  return atStations > 0 ? atStations : table.enRoute;
}

// A merge's ready count comes from one member, never a sum: every table a party sits at carries its
// signals (packages/shared/src/table-signals.ts:4-5) and its whole family's ready and on-the-way
// counts (the `tab` subquery joins each table to the party's bills, working-order.ts:8267-8270).
const largestReady = (members: readonly TableState[]): number =>
  Math.max(0, ...members.map(readyCount));

// Counter deliveries are counted per table (`group by delivery_table_id`, working-order.ts:8289), so
// a merge's add up.
const totalDeliveries = (members: readonly TableState[]): number =>
  members.reduce((sum, member) => sum + member.pendingDeliveries, 0);

/** The member whose held dishes fire soonest; one with no time counts as never. */
function soonestHeld(members: readonly TableState[], now: number) {
  let soonest: { member: TableState; dueAt: number } | undefined;
  for (const member of members) {
    if (heldChip(member.signals, reminderDueAt(member.party?.reminder), now) === null) continue;
    const dueAt = reminderDueAt(member.party?.reminder);
    if (soonest === undefined || dueAt < soonest.dueAt) soonest = { member, dueAt };
  }
  return soonest!;
}

function soonestBooking(members: readonly TableState[]): string {
  return members
    .flatMap((member) => (member.nextReservation === null ? [] : [member.nextReservation.time]))
    .sort()[0]!;
}

function unavailableDishes(members: readonly TableState[]): string {
  const member = members.find((each) =>
    each.signals.some((signal) => signal.kind === "held_unavailable"),
  )!;
  return member.signals
    .flatMap((signal) => (signal.kind === "held_unavailable" ? signal.lineNames : []))
    .join(", ");
}

/**
 * A kind's words, as the card says them; a merge's ready count reads from one member. `kind` must
 * be one of the members' own kinds (from `mapLook` or `mapKinds`) at the same `now`: Held,
 * Unavailable and Reserved read dishes or a booking that only such a member has, and Held only
 * until it is due.
 */
export function kindWords(kind: MapKind, members: readonly TableState[], now: number): string {
  const fixed = FIXED_WORDS[kind];
  if (fixed !== undefined) return t(fixed);
  switch (kind) {
    case "unavailable":
      return t("signal.unavailable").replace("{items}", () => unavailableDishes(members));
    case "ready":
      return readyText(largestReady(members));
    case "delivery":
      return `${totalDeliveries(members)} ${t("floor.pending_delivery")}`;
    case "held": {
      const { member, dueAt } = soonestHeld(members, now);
      return heldChip(member.signals, dueAt, now)!.text;
    }
    default:
      return `${t("floor.reserved")} ${soonestBooking(members)}`;
  }
}

function cueOf(kind: MapKind, members: readonly TableState[], now: number): FloorMapCue | null {
  const fixed = FIXED_CUE[kind];
  if (fixed !== undefined) return { icon: fixed.icon, text: t(fixed.text) };
  switch (kind) {
    case "ready":
      return { icon: "floor-ready", text: String(largestReady(members)) };
    case "delivery":
      return { icon: "floor-step", text: kindWords(kind, members, now) };
    case "held": {
      const { dueAt } = soonestHeld(members, now);
      const text =
        dueAt === Number.POSITIVE_INFINITY
          ? kindWords(kind, members, now)
          : t("floor.cue_minutes").replace("{m}", String(minutesToFire(dueAt, now)));
      return { icon: "floor-held", text };
    }
    case "nothing-needed":
      return { icon: "floor-check", text: "" };
    case "reserved":
      return { icon: null, text: soonestBooking(members) };
    default:
      return null;
  }
}

function fillOf(kinds: readonly MapKind[], members: readonly TableState[]): FloorMapFill {
  for (const kind of kinds) {
    const fill = FILL_OF[kind];
    if (fill !== undefined) return fill;
  }
  if (members.some((member) => member.party !== null)) return "calm";
  if (kinds.includes("reserved")) return "reserved";
  if (kinds.includes("free")) return "free";
  return "plain";
}

function outlineOf(kinds: readonly MapKind[]): FloorMapOutline | null {
  const has = (kind: MapKind) => kinds.includes(kind);
  if (has("overdue")) return "overdue";
  if (has("waiting") && !has("forgotten") && !has("fire")) return "waiting";
  if (has("clearing") || has("moving")) return "clearing";
  return null;
}

/** "Seated" when a member has a party, then every kind's words; Free's only when it is alone. */
function describe(kinds: readonly MapKind[], members: readonly TableState[], now: number): string {
  const said = kinds.length === 1 ? kinds : kinds.filter((kind) => kind !== "free");
  const words = said.map((kind) => kindWords(kind, members, now));
  if (members.some((member) => member.party !== null)) words.unshift(t("floor.status_seated"));
  return words.join(", ");
}

/** The map look of a table, or of a merge or linked party when its members are passed together. */
export function mapLook(members: readonly TableState[], now: number): MapLook {
  const kinds = settled(new Set(members.flatMap((member) => mapKinds(member, now))));
  const top = kinds[0];
  return {
    fill: fillOf(kinds, members),
    outline: outlineOf(kinds),
    pulse: PULSES.find((pulse) => kinds.includes(pulse)) ?? null,
    cue: top === undefined ? null : cueOf(top, members, now),
    top,
    kinds,
    description: describe(kinds, members, now),
  };
}

/** Each table's minutes to fire, or "due": it changes whenever a look can change with time. */
export function reminderClock(tables: readonly TableState[], now: number): string {
  return tables
    .flatMap((table) => {
      const dueAt = reminderDueAt(table.party?.reminder);
      if (dueAt === Number.POSITIVE_INFINITY) return [];
      return [`${table.id}:${dueAt <= now ? "due" : minutesToFire(dueAt, now)}`];
    })
    .join(",");
}
