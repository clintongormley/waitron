import {
  type Transaction,
  workingOrders,
  tableInService,
  diningTables,
  tableMerges,
  floorZones,
  needsMoving,
  partyTables,
  parties,
  partyTableLabels,
} from "@waitron/db";
import type { KitchenNoteSnapshot, FloorAnnotator } from "@waitron/module";
import type { Logger } from "@waitron/server-kit";
import {
  type TimingBand,
  type TableSignal,
  worstBand,
  classifyBand,
  rawCentsToDecimal,
  partyDisplayName,
  toScale,
  sumDecimals,
  decimal,
  MONEY_SCALE,
} from "@waitron/shared";
import { sql, eq, isNull } from "drizzle-orm";
import { foodOnItsWay } from "./delivery-release.js";
import type { Placement } from "./floor-reset-plan.js";
import { placementOf } from "./floor-today-store.js";
import { VENUE_SERVICE } from "./modules.js";
import { type UnsentDraft, readUnsentDrafts } from "./order-drafts.js";
import { type ReleaseReminder, readReleaseReminders } from "./order-group-reads.js";
import { type FamilyBill, readBillsOfParties } from "./parties.js";
import { readTableSteps, stepSignal } from "./service-step-signals.js";
import { readPartySignals, tableSignals, type SeatedPartyFacts } from "./table-signals.js";
import { parseUnservedLines, minutesSince } from "./working-order-station-queue.js";

/** The seated party a table belongs to, as the floor shows it. */
export interface TableParty {
  id: string;
  kitchenNote: KitchenNoteSnapshot;
  revision: number;
  guestCount: number | null;
  state: "open" | "closed";
  /** The name staff gave the party, or null. */
  name: string | null;
  /** `name`, or else the party's tables' shown names ({@link partyDisplayName}). */
  displayName: string;
  /**
   * The bill the till opens the table on: the lowest-numbered bill still owing, else the
   * highest-numbered shown bill, else null. Only a read for opening the screen; nothing writes to it
   * or sends to it in its stead.
   */
  openingBillId: string | null;
  /** What the party's bills, and those of every party merged into it, still owe. */
  outstanding: string;
  /** The party's bills that are not abandoned, merged parties' included. */
  billCount: number;
  /** Every table the party sits at, in the order they joined it. */
  tableIds: string[];
  /**
   * Each open draft on the party holding a line, in its bill's number order; a bill with no number
   * comes last.
   */
  unsentDrafts: UnsentDraft[];
  /**
   * The held group waiting to be released and when it is due; null with no held group, with
   * its department's reminders off, or once the party is no longer open.
   */
  reminder: ReleaseReminder | null;
}
/** Whether a party holds the table, it waits to be cleared, or it is free. */
export type TableCondition = "free" | "held" | "needs_clearing";
/** Held while a party holds the table, whatever its clearing state; else as its clearing state says. */
export function tableCondition(row: {
  held: boolean;
  needsClearingSince: string | null;
}): TableCondition {
  if (row.held) return "held";
  return row.needsClearingSince === null ? "free" : "needs_clearing";
}

export interface TableToday {
  /** `null` for an unplaced spare, or a table taken off. */
  placement: Placement | null;
  seats: number | null;
  fixed: boolean;
  takenOff: boolean;
  joinId: string | null;
  joinSeats: number | null;
  /** The revision of the table's room; 0 for a room with no today's plan. */
  zoneRevision: number;
  /** The table's own name for today; `null` for its saved name. */
  name: string | null;
  /** Its group's name for today; `null` outside a group or for the group's normal name. */
  joinName: string | null;
  /** A reset left its change waiting for someone to move the table. */
  needsMoving: boolean;
}
/** One row of the occupancy read-model. */
export interface TableState {
  id: string;
  label: string;
  /** The table's saved short name, else its full name. */
  shortName: string;
  zoneId: string | null;
  /** `open-tab` while a party holds the table, whether or not it has a bill still open. */
  state: "free" | "open-tab" | "delivery-pending";
  /** The party holding the table has an open bill. */
  hasOpenTab: boolean;
  condition: TableCondition;
  /** The lines on the party's open bills; present with `hasOpenTab`. */
  tabLineCount?: number;
  /** The GROSS draft total of the party's open bills; present with `hasOpenTab`. */
  tabTotal?: string;
  pendingDeliveries: number;
  /**
   * The unserved lines of every bill of the party's family that is not abandoned, paid ones
   * included, whatever their kitchen state.
   */
  pendingToServe: number;
  /** Those unserved lines whose ticket item is `ready`. */
  readyToServe: number;
  /**
   * The worst age band over those unserved lines that were fired or are waiting for the pass; a
   * counter delivery does not feed it.
   */
  timingBand: TimingBand;
  today: TableToday;
  /** Merged from the enabled modules' floor annotators; `null` when none annotates the table. */
  nextReservation: { time: string } | null;
  party: TableParty | null;
  hasAllergy?: true;
  /** One of the party's bills was closed as a deferred payment. */
  hasDeferredBill?: true;
  /** What wants attention at the table: its party's signals, then its own clearing. */
  signals: TableSignal[];
}
/**
 * Read the venue's active tables with their occupancy. Every table a party holds shows that
 * party's bills: the open ones for its line count and total, and for the dishes still to serve every
 * bill of its family that is not abandoned, since a paid or presented bill's dishes are still
 * carried to the table. A party takes precedence over a delivery. A pending delivery has kitchen
 * items and is neither collected nor abandoned. Made-here items count as bill lines but do not
 * contribute kitchen readiness, delivery presence or kitchen waiting time.
 */
export async function listTablesWithState(
  tx: Transaction,
  annotators: readonly FloorAnnotator[] = [],
  now: Date = new Date(),
  log?: Logger,
): Promise<TableState[]> {
  const result = await tx.execute<{
    id: string;
    label: string;
    short_name: string | null;
    zone_id: string | null;
    open_bills: number;
    tab_line_count: number;
    tab_total: string | null;
    pending_to_serve: number;
    ready_to_serve: number;
    // Classified in JS, never in SQL, so server and client share one classifier.
    tab_unserved_lines: string;
    pending_deliveries: number;
    needs_clearing_since: string | null;
  }>(sql`
    with recursive family(root, id) as (
      select party_id, party_id from party_tables where left_at is null
      union
      select f.root, p.id from parties p join family f on p.merged_into_party_id = f.id
    )
    select
      dt.id, dt.label, dt.short_name, dt.zone_id, dt.needs_clearing_since,
      cast(coalesce(tab.open_bills, 0) as int) as open_bills,
      cast(coalesce(tab.line_count, 0) as int) as tab_line_count,
      tab.tab_total,
      cast(coalesce(tab.pending_to_serve, 0) as int) as pending_to_serve,
      cast(coalesce(tab.ready_to_serve, 0) as int) as ready_to_serve,
      coalesce(tab.unserved_lines, '[]') as tab_unserved_lines,
      cast(coalesce(del.pending, 0) as int) as pending_deliveries
    from dining_tables dt
    left join (
      select pt.table_id,
             cast(count(distinct wo.id) filter (where wo.status = 'open') as int) as open_bills,
             cast(count(wol.id) filter (where wo.status = 'open') as int) as line_count,
             cast(count(wol.id) filter (where wol.served_at is null) as int) as pending_to_serve,
             -- The ticket item is joined 1:1 on the line -- its (working_order_line_id) UNIQUE gives
             -- at most one ti per wol, so this LEFT JOIN neither multiplies wol rows (line_count /
             -- tab_total stay correct) nor double-counts.
             cast(count(*) filter (where ti.state = 'ready' and wol.served_at is null) as int) as ready_to_serve,
             -- A count of whole cents read raw, cast to text and converted by rawCentsToDecimal in
             -- the mapping below -- see its doc comment for why it is text and not an integer cast.
             cast(coalesce(sum(wol.line_total) filter (where wo.status = 'open'), 0) as text) as tab_total,
             -- Order-timing alerts: the wait start + thresholds of each unserved kitchen line whose
             -- ticket item was fired or requested, so a HELD one does not age here, and a
             -- pass-controlled one ages from requested_at; one JSON object per line -- never a band
             -- label, reduced with classifyBand/worstBand in JS below. A line never sent has no
             -- ticket_items row and is excluded, same as a served one.
             --
             -- json_group_array returns JSON TEXT rather than a value the driver parses, so the
             -- row mapping parses it.
             json_group_array(
               json_object(
                 'queuedAt',
                 case when ti.pass_controlled then coalesce(ti.requested_at, ti.queued_at)
                      else ti.queued_at end,
                 'warmAfterMinutes', ks.warm_after_minutes,
                 'overdueAfterMinutes', ks.overdue_after_minutes,
                 'forgottenAfterMinutes', ks.forgotten_after_minutes
               )
             ) filter (
               where wol.served_at is null
                 and (ti.fired_at is not null or ti.requested_at is not null)
             ) as unserved_lines
      from party_tables pt
      join family f on f.root = pt.party_id
      join working_orders wo
        on wo.party_id = f.id and wo.status <> 'abandoned'
        and wo.id not in (select working_order_id from unpaid_departures)
      left join working_order_lines wol
        on wol.working_order_id = wo.id
      left join ticket_items ti
        on ti.working_order_line_id = wol.id and ti.made_here = 0
      -- The unserved line's OWN station thresholds, for the JSON aggregate above. LEFT (not INNER): a row
      -- with no ticket item (ti null) must survive so line_count/tab_total/the other aggregates above
      -- are unaffected by this join — such a row is excluded from unserved_lines by the FILTER instead.
      left join kitchen_stations ks
        on ks.id = ti.station_id
      where pt.left_at is null
      group by pt.table_id
    ) tab on tab.table_id = dt.id
    left join (
      select delivery_table_id, cast(count(*) as int) as pending
      from ${workingOrders}
      where ${foodOnItsWay()}
      group by delivery_table_id
    ) del on del.delivery_table_id = dt.id
    where ${tableInService(sql`dt.id`)}
    order by dt.label
  `);

  const today = await readTodayTables(tx);
  const { seated, facts } = await readSeatedParties(tx, log);
  const allergicParties = await VENUE_SERVICE.partiesWithAllergicGuests(tx, [
    ...new Set([...seated.values()].map((party) => party.id)),
  ]);
  // Not the `now` parameter, which is the VENUE clock the annotators take and a caller may supply.
  const nowMs = Date.now();
  const seatedParties = [...new Set(seated.values())];
  const partySignals = await readPartySignals(tx, seatedParties, facts, nowMs);
  const tableSteps = await readTableSteps(
    tx,
    seatedParties.map((party) => ({
      partyId: party.id,
      openedAt: facts.get(party.id)!.openedAt,
      tableIds: party.tableIds,
    })),
    nowMs,
  );

  const states = result.rows.map((r) => {
    const hasOpenTab = Number(r.open_bills) > 0;
    const party = seated.get(r.id);
    const pendingDeliveries = Number(r.pending_deliveries);
    const state: TableState["state"] =
      party !== undefined ? "open-tab" : pendingDeliveries > 0 ? "delivery-pending" : "free";
    const timingBand = worstBand(
      parseUnservedLines(r.tab_unserved_lines).map((line) =>
        classifyBand(nowMs - minutesSince(line.queuedAt, nowMs) * 60_000, nowMs, {
          warmAfterMinutes: line.warmAfterMinutes,
          overdueAfterMinutes: line.overdueAfterMinutes,
          forgottenAfterMinutes: line.forgottenAfterMinutes,
        }),
      ),
    );
    return {
      id: r.id,
      label: r.label,
      shortName: r.short_name ?? r.label,
      zoneId: r.zone_id,
      state,
      hasOpenTab,
      condition: tableCondition({
        held: party !== undefined,
        needsClearingSince: r.needs_clearing_since,
      }),
      pendingToServe: Number(r.pending_to_serve),
      readyToServe: Number(r.ready_to_serve),
      timingBand,
      pendingDeliveries,
      today: today.get(r.id)!,
      nextReservation: null as { time: string } | null,
      party: party ?? null,
      ...(party !== undefined && allergicParties.has(party.id)
        ? { hasAllergy: true as const }
        : {}),
      ...(party !== undefined && facts.get(party.id)!.bills.some((bill) => bill.deferred)
        ? { hasDeferredBill: true as const }
        : {}),
      signals: tableSignals(
        party === undefined ? undefined : partySignals.get(party.id),
        stepSignal(tableSteps.get(r.id)),
        r.needs_clearing_since,
      ),
      ...(hasOpenTab
        ? {
            tabLineCount: Number(r.tab_line_count),
            tabTotal: rawCentsToDecimal(r.tab_total!),
          }
        : {}),
    };
  });

  if (annotators.length > 0) {
    const tableIds = states.map((s) => s.id);
    for (const annotator of annotators) {
      const annotations = await annotator.annotate(tx, now, tableIds);
      for (const s of states) {
        const reserved = annotations.get(s.id)?.reservedTime ?? null;
        if (reserved !== null) s.nextReservation = { time: reserved };
      }
    }
  }
  return states;
}
/** Today's plan for each table that has a today's row, keyed by table. */
async function readTodayTables(tx: Transaction): Promise<Map<string, TableToday>> {
  const rows = await tx
    .select({
      tableId: diningTables.id,
      seats: diningTables.todaySeats,
      fixed: diningTables.todayFixed,
      takenOff: diningTables.takenOff,
      x: diningTables.todayX,
      y: diningTables.todayY,
      width: diningTables.todayWidth,
      height: diningTables.todayHeight,
      shape: diningTables.todayShape,
      rotation: diningTables.todayRotation,
      joinId: tableMerges.id,
      joinSeats: tableMerges.seats,
      zoneRevision: floorZones.todayRevision,
      name: diningTables.todayName,
      joinName: tableMerges.name,
      needsMoving: needsMoving(diningTables.id).mapWith(Boolean),
    })
    .from(diningTables)
    .innerJoin(floorZones, eq(floorZones.id, diningTables.zoneId))
    .leftJoin(tableMerges, eq(tableMerges.id, diningTables.mergeId))
    .where(eq(diningTables.onFloor, true));
  return new Map(
    rows.map((row) => [
      row.tableId,
      {
        placement: row.takenOff ? null : placementOf(row),
        seats: row.seats,
        fixed: row.fixed,
        takenOff: row.takenOff,
        joinId: row.joinId,
        joinSeats: row.joinSeats,
        zoneRevision: row.zoneRevision,
        name: row.name,
        joinName: row.joinName,
        needsMoving: row.needsMoving,
      },
    ]),
  );
}
/** {@link TableParty.openingBillId}; `bills` come in number order, unnumbered last. */
function openingBillOf(bills: readonly FamilyBill[]): string | null {
  const shown = bills.filter((bill) => bill.status !== "abandoned" && !bill.leftUnpaid);
  const owing = shown.find((bill) => bill.status === "open" || bill.status === "placed");
  return (owing ?? shown.at(-1))?.workingOrderId ?? null;
}
/**
 * Each table a party holds, with the party, and what else was read of each party,
 * keyed by party.
 */
async function readSeatedParties(
  tx: Transaction,
  log: Logger | undefined,
): Promise<{ seated: Map<string, TableParty>; facts: Map<string, SeatedPartyFacts> }> {
  const members = await tx
    .select({
      tableId: partyTables.tableId,
      partyId: parties.id,
      revision: parties.revision,
      guestCount: parties.guestCount,
      state: parties.state,
      name: parties.name,
      billRequestedAt: parties.billRequestedAt,
      openedAt: parties.openedAt,
      zoneId: diningTables.zoneId,
    })
    .from(partyTables)
    .innerJoin(parties, eq(parties.id, partyTables.partyId))
    .innerJoin(diningTables, eq(diningTables.id, partyTables.tableId))
    .where(isNull(partyTables.leftAt))
    .orderBy(partyTables.joinedAt, sql`${partyTables}.rowid`);
  const firstZones = new Map<string, string>();
  for (const member of members) {
    if (!firstZones.has(member.partyId)) firstZones.set(member.partyId, member.zoneId);
  }
  const partyIds = [...firstZones.keys()];
  const labels = await partyTableLabels(tx, partyIds);
  const bills = await readBillsOfParties(tx, partyIds, log);
  const unsentDrafts = await readUnsentDrafts(tx, partyIds, bills);
  const reminders = await readReleaseReminders(tx, partyIds, firstZones);
  const notes = await VENUE_SERVICE.readKitchenNotes(
    tx,
    partyIds.map((partyId) => ({ partyId })),
  );
  const partyOf = new Map<string, TableParty>();
  const facts = new Map<string, SeatedPartyFacts>();
  for (const member of members) {
    const known = partyOf.get(member.partyId);
    if (known !== undefined) {
      known.tableIds.push(member.tableId);
      continue;
    }
    const own = bills.get(member.partyId)!;
    facts.set(member.partyId, {
      bills: own,
      billRequestedAt: member.billRequestedAt,
      openedAt: member.openedAt,
    });
    partyOf.set(member.partyId, {
      id: member.partyId,
      kitchenNote: {
        ...notes.get(VENUE_SERVICE.kitchenNoteKey({ partyId: member.partyId }))!,
        scope: { partyId: member.partyId },
        ownerRevision: member.revision,
      },
      revision: member.revision,
      guestCount: member.guestCount,
      state: member.state,
      name: member.name,
      displayName: partyDisplayName(member.name, labels.get(member.partyId)!),
      openingBillId: openingBillOf(own),
      outstanding: toScale(
        sumDecimals(
          own.filter((bill) => !bill.leftUnpaid).map((bill) => decimal(bill.outstanding)),
        ),
        MONEY_SCALE,
      ),
      billCount: own.filter((bill) => bill.status !== "abandoned").length,
      tableIds: [member.tableId],
      unsentDrafts: unsentDrafts.get(member.partyId)!,
      reminder: reminders.get(member.partyId)!,
    });
  }
  return {
    seated: new Map(members.map((member) => [member.tableId, partyOf.get(member.partyId)!])),
    facts,
  };
}
