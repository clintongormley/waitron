import { joinedOutOfService, needsMoving, tableInService } from "@waitron/db";
import { and, eq, gt, inArray, isNull, sql } from "drizzle-orm";
import {
  diningTables,
  orderGroups,
  orderDraftRecalledLines,
  parties,
  partyTableLabels,
  ticketItems,
  workingOrderLines,
  workingOrders,
} from "@waitron/db";
import type { Transaction } from "@waitron/db";
import type { AllergyMoveRead, AllergyPatch } from "@waitron/module";
import { AppError, isUuid, partyDisplayName } from "@waitron/shared";
import { guardPathParty } from "./bill-actions.js";
import { enqueueMovedSlips, firedQuantity, readSentWork, type SentWork } from "./kitchen-print.js";
import { moveBillDraftsToParty } from "./order-drafts.js";
import {
  readPartyBillIds,
  requireRelocatableBillEditors,
  relocateBillEditor,
} from "./bill-editing.js";
import type { BillEditExpected } from "./order-drafts.js";
import { VENUE_SERVICE } from "./modules.js";
import { inheritKitchenNote } from "./order-kitchen-note.js";
import { groupArrivingDishes, printHoldTickets, type Firer } from "./order-groups.js";
import { enqueueKitchenAllergyChanges } from "./kitchen-allergy.js";
import {
  applyPartyAllergyPatch,
  normaliseAllergyPatch,
  readArrivingAllergyDishes,
} from "./party-allergy.js";
import {
  checkAndBumpParty,
  holderOf,
  openParty,
  partyZone,
  readMainBill,
  refuseMovedParty,
  runServiceCommand,
  setMainBill,
} from "./parties.js";
import type { OriginConfig, TradingContext } from "./trading-context.js";
import {
  assertSendable,
  clearGroups,
  fireLines,
  refuseHeldLeavingParty,
  unsentDishLines,
} from "./working-order.js";
import type { OrderAttendance } from "./working-order.js";
import "./errors.js";

export type MoveTarget = { tableId: string } | { counter: { zoneId: string | null } };

/** The party a command read at the table it names, as {@link readTargetTable} checks it. */
export interface OtherPartyRead {
  /** The revision of the party holding the target table, required when one does. */
  expectedOtherPartyRevision?: number;
  /** The party the till read at the target table, required with its revision; null when it read
   * the table free. */
  otherPartyId?: string | null;
}

export interface MoveBillOptions extends OtherPartyRead {
  submissionId?: string;
  allergy?: AllergyPatch;
  expectedEdits: BillEditExpected[];
  /** Ignored: a bill always arrives as a bill of its own. Removed in A803 slice 3 Task 4b. */
  bills?: "merge" | "separate";
  /** The bill's own party's, required when it has one. */
  expectedPartyRevision?: number;
  /** The party the till read the bill under; null when it read the bill with no party. */
  partyId?: string | null;
  operatorId: string;
}

export interface MoveBillResult {
  partyId: string | null;
  billId: string;
  /** Always false: a move never merges. Removed in A803 slice 3 Task 4b. */
  merged: boolean;
}

/** Where the bill goes: the counter, a free table, or a table another party holds. */
type Destination =
  | { kind: "counter"; zoneId: string | null }
  | { kind: "free"; tableId: string; zoneId: string }
  | { kind: "party"; partyId: string };

export async function previewBillMoveAllergy(
  tx: Transaction,
  cfg: TradingContext,
  billId: string,
  tableId: string,
  options: MoveBillOptions,
): Promise<AllergyMoveRead> {
  const [bill] = await tx
    .select({ partyId: workingOrders.partyId, status: workingOrders.status })
    .from(workingOrders)
    .where(and(eq(workingOrders.id, billId), eq(workingOrders.locationId, cfg.locationId)));
  if (bill === undefined || bill.status === "abandoned")
    throw new AppError("tab.not_open", { tabId: billId });
  if (bill.status === "settled") throw new AppError("bill.paid", { workingOrderId: billId });
  if (bill.partyId !== null) await refuseMovedParty(tx, bill.partyId);
  if (options.partyId !== null)
    throw new AppError("management.request_invalid", { field: "partyId" });
  if (options.otherPartyId === undefined)
    throw new AppError("management.request_invalid", { field: "otherPartyId" });
  const table = await inspectTargetTable(tx, cfg, tableId, null, options);
  if (table.holding === null) await refuseUnseatable(tx, cfg, table);
  await requireRelocatableBillEditors(
    tx,
    [billId, ...(table.holding === null ? [] : await readPartyBillIds(tx, [table.holding]))],
    options.operatorId,
    options.expectedEdits,
  );
  return {
    billId,
    tableId,
    partyId: table.holding,
    snapshot:
      table.holding === null ? null : await VENUE_SERVICE.readPartyAllergy(tx, table.holding),
    dishes: await readArrivingAllergyDishes(tx, billId),
  };
}

/**
 * Move a whole bill to another party, a free table (a new party) or the counter, or a counter order
 * into a party. Both parties' revisions are checked before either the bill's or the table's own
 * state, so of two tills acting from one read the second is refused `party.out_of_date`.
 */
export async function moveBill(
  tx: Transaction,
  cfg: OriginConfig,
  billId: string,
  to: MoveTarget,
  options: MoveBillOptions,
  attendance?: OrderAttendance,
): Promise<MoveBillResult> {
  if ((options.submissionId === undefined) !== (options.allergy === undefined))
    throw new AppError("management.request_invalid", { field: "allergy" });
  if (options.submissionId !== undefined) {
    if (!isUuid(options.submissionId) || !("tableId" in to))
      throw new AppError("management.request_invalid", { field: "submissionId" });
    if (options.partyId !== null)
      throw new AppError("management.request_invalid", { field: "partyId" });
    if (options.otherPartyId === undefined)
      throw new AppError("management.request_invalid", { field: "otherPartyId" });
    const command = {
      ...options,
      submissionId: options.submissionId.toLowerCase(),
      allergy: normaliseAllergyPatch(options.allergy!),
    };
    return runServiceCommand(
      tx,
      { kind: "bill", workingOrderId: billId },
      command.submissionId,
      "bill.move.allergy",
      { billId, to, ...command },
      () => moveBillOnce(tx, cfg, billId, to, command, attendance),
      cfg.madeHereSink,
    );
  }
  return moveBillOnce(tx, cfg, billId, to, options, attendance);
}

async function moveBillOnce(
  tx: Transaction,
  cfg: OriginConfig,
  billId: string,
  to: MoveTarget,
  options: MoveBillOptions,
  attendance?: OrderAttendance,
): Promise<MoveBillResult> {
  const path = await guardPathParty(tx, billId, options);
  if (options.allergy !== undefined && path.partyId !== null)
    throw new AppError("management.request_invalid", { field: "allergy" });
  const destination = await resolveDestination(tx, cfg, path.partyId, to, options);

  if (path.status === "abandoned") throw new AppError("tab.not_open", { tabId: billId });
  if (path.status === "settled") throw new AppError("bill.paid", { workingOrderId: billId });
  const affected = [
    billId,
    ...(destination.kind === "party" ? await readPartyBillIds(tx, [destination.partyId]) : []),
  ];
  await requireRelocatableBillEditors(tx, affected, options.operatorId, options.expectedEdits);
  const main = destination.kind === "party" ? await readMainBill(tx, destination.partyId) : null;
  const zoneId =
    destination.kind === "party" ? await partyZone(tx, cfg, destination.partyId) : null;
  const expectedEdit = options.expectedEdits.find((e) => e.billId === billId)!;
  const open = path.status === "open";
  const activity =
    attendance === undefined
      ? undefined
      : {
          recorder: attendance.recorder,
          at: attendance.clock.now().instant.toISOString(),
        };

  const source = path.partyId === null ? null : await readSourceParty(tx, path.partyId);
  const noteScope = path.partyId === null ? { workingOrderId: billId } : { partyId: path.partyId };
  let firers: ReadonlyMap<string, Firer> = new Map();
  if (source !== null) firers = await leaveParty(tx, billId);
  const before = await readSentWork(tx, billId);

  let result: MoveBillResult;
  let held: string[] = [];
  const recordAllergy = async (partyId: string) => {
    if (options.allergy === undefined) return;
    const lines = await tx
      .select({ id: workingOrderLines.id })
      .from(workingOrderLines)
      .where(
        and(eq(workingOrderLines.workingOrderId, billId), isNull(workingOrderLines.parentLineId)),
      );
    const changes = await applyPartyAllergyPatch(
      tx,
      partyId,
      options.allergy,
      options.operatorId,
      lines.map((line) => ({
        ref: { kind: "working", id: line.id },
        draftLineId: null,
        workingLineId: line.id,
      })),
    );
    await enqueueKitchenAllergyChanges(tx, cfg, changes);
  };
  if (destination.kind === "counter") {
    if (source === null) throw new AppError("management.request_invalid", { field: "to" });
    await inheritKitchenNote(tx, cfg, noteScope, { workingOrderId: billId }, "copy");
    await tx
      .update(workingOrders)
      .set({
        partyId: null,
        revision: movedRevision,
        ...(open ? { label: await counterLabel(tx, source) } : {}),
      })
      .where(eq(workingOrders.id, billId));
    await VENUE_SERVICE.releaseBillNumber(tx, billId);
    if (open && destination.zoneId !== null) await adoptZone(tx, cfg, billId, destination.zoneId);
    await relocateBillEditor(tx, billId, expectedEdit);
    result = { partyId: null, billId, merged: false };
  } else if (destination.kind === "free") {
    const { partyId } = await openParty(tx, {
      guestCount: null,
      operatorId: options.operatorId,
      tableId: destination.tableId,
    });
    await inheritKitchenNote(tx, cfg, noteScope, { partyId }, "copy");
    if (source !== null)
      await VENUE_SERVICE.moveBillAllergies(tx, source.id, partyId, billId, options.operatorId);
    await takeIntoParty(tx, cfg, billId, partyId, destination.zoneId, () => recordAllergy(partyId));
    await VENUE_SERVICE.allocateBillNumber(tx, billId, partyId);
    await moveBillDraftsToParty(tx, billId, partyId, expectedEdit);
    ({ held } = await groupArrivingDishes(
      tx,
      cfg,
      partyId,
      billId,
      options.operatorId,
      firers,
      activity,
    ));
    if (open) await setMainBill(tx, partyId, billId);
    result = { partyId, billId, merged: false };
  } else {
    const partyId = destination.partyId;
    await inheritKitchenNote(tx, cfg, noteScope, { partyId }, "combine", [billId]);
    if (source !== null)
      await VENUE_SERVICE.moveBillAllergies(tx, source.id, partyId, billId, options.operatorId);
    await takeIntoParty(tx, cfg, billId, partyId, zoneId, () => recordAllergy(partyId));
    ({ held } = await groupArrivingDishes(
      tx,
      cfg,
      partyId,
      billId,
      options.operatorId,
      firers,
      activity,
    ));
    await VENUE_SERVICE.allocateBillNumber(tx, billId, partyId);
    await moveBillDraftsToParty(tx, billId, partyId, expectedEdit);
    if (main === null && open) await setMainBill(tx, partyId, billId);
    result = { partyId, billId, merged: false };
  }

  await VENUE_SERVICE.withdrawPendingDepartmentTransfers(tx, [billId]);

  await printHoldTickets(tx, cfg, held);
  await enqueueMovedSlips(tx, cfg, before, result.billId);
  return result;
}

/**
 * Move a paid bill not yet handed over from `from`, the party being finished, to the counter. The
 * bill keeps its label, revision and zone: the database lets a settled bill's own row leave its
 * party and change nothing else. Only the stations with something on it still to come are told.
 */
export async function moveSettledBillToCounter(
  tx: Transaction,
  cfg: OriginConfig,
  billId: string,
  from: { partyId: string },
  expectedEdit: BillEditExpected,
): Promise<void> {
  const [bill] = await tx
    .select({
      status: workingOrders.status,
      collectedAt: workingOrders.collectedAt,
      partyId: workingOrders.partyId,
    })
    .from(workingOrders)
    .where(eq(workingOrders.id, billId));
  if (bill?.status !== "settled" || bill.collectedAt !== null || bill.partyId === null)
    throw new AppError("management.request_invalid", { field: "billId" });
  const before = await workStillToCome(tx, await readSentWork(tx, billId));
  await inheritKitchenNote(tx, cfg, from, { workingOrderId: billId }, "copy");
  await leaveParty(tx, billId);
  await tx.update(workingOrders).set({ partyId: null }).where(eq(workingOrders.id, billId));
  await VENUE_SERVICE.releaseBillNumber(tx, billId);
  await relocateBillEditor(tx, billId, expectedEdit);
  await VENUE_SERVICE.withdrawPendingDepartmentTransfers(tx, [billId]);
  await enqueueMovedSlips(tx, cfg, before, billId);
}

/** `sent` narrowed to the items whose line has more fired than served; null when none is left. */
async function workStillToCome(tx: Transaction, sent: SentWork | null): Promise<SentWork | null> {
  if (sent === null) return null;
  const rows = await tx
    .select({ id: ticketItems.id })
    .from(ticketItems)
    .innerJoin(workingOrderLines, eq(workingOrderLines.id, ticketItems.workingOrderLineId))
    .where(
      and(
        inArray(ticketItems.id, [...sent.ticketItemIds]),
        gt(firedQuantity, workingOrderLines.servedQuantity),
      ),
    );
  if (rows.length === 0) return null;
  const live = new Set(rows.map((row) => row.id));
  return {
    places: sent.places,
    ticketItemIds: live,
    heldItemIds: new Set([...sent.heldItemIds].filter((id) => live.has(id))),
  };
}

/**
 * The destination, with the party the till read at the target table checked first, by identity and
 * revision, and that revision moved on ({@link readTargetTable}); then the table's own state.
 */
async function resolveDestination(
  tx: Transaction,
  cfg: TradingContext,
  source: string | null,
  to: MoveTarget,
  options: MoveBillOptions,
): Promise<Destination> {
  if ("counter" in to) return { kind: "counter", zoneId: to.counter.zoneId };
  const { tableId } = to;
  const table = await readTargetTable(tx, cfg, tableId, source, options);
  if (table.holding !== null && table.holding === source) {
    throw new AppError("table.already_in_party", { tableId });
  }
  if (table.holding !== null) return { kind: "party", partyId: table.holding };
  await refuseUnseatable(tx, cfg, table);
  return { kind: "free", tableId, zoneId: table.zoneId };
}

/** A table an action names, as {@link readTargetTable} answers it. */
export interface TargetTable {
  /** The party holding the table now, or null. */
  holding: string | null;
  zoneId: string;
}

/**
 * A revision alone can match a replacement party. Check the holder's identity as well, then advance
 * its revision in the action's transaction. Read-only previews use inspectTargetTable instead.
 */
export async function readTargetTable(
  tx: Transaction,
  cfg: TradingContext,
  tableId: string,
  source: string | null,
  read: OtherPartyRead,
): Promise<TargetTable> {
  const table = await inspectTargetTable(tx, cfg, tableId, source, read);
  if (table.holding !== null && table.holding !== source)
    await checkAndBumpParty(tx, table.holding, read.expectedOtherPartyRevision!, "open");
  return table;
}

async function inspectTargetTable(
  tx: Transaction,
  cfg: TradingContext,
  tableId: string,
  source: string | null,
  read: OtherPartyRead,
): Promise<TargetTable> {
  const { otherPartyId, expectedOtherPartyRevision } = read;
  if (typeof otherPartyId !== "string" && expectedOtherPartyRevision !== undefined) {
    throw new AppError("management.request_invalid", { field: "otherPartyId" });
  }
  const holding = await holderOf(tx, tableId);
  if (otherPartyId === null && holding !== null && holding !== source) {
    await refuseMovedParty(tx, holding);
  }
  if (typeof otherPartyId === "string" && otherPartyId !== holding) {
    await refuseMovedParty(tx, otherPartyId);
  }
  if (holding !== null && holding !== source) {
    if (expectedOtherPartyRevision === undefined) {
      throw new AppError("management.request_invalid", { field: "expectedOtherPartyRevision" });
    }
    const [party] = await tx
      .select({ state: parties.state, revision: parties.revision })
      .from(parties)
      .where(eq(parties.id, holding));
    if (party?.state !== "open") throw new AppError("party.not_open", { partyId: holding });
    if (party.revision !== expectedOtherPartyRevision)
      throw new AppError("party.out_of_date", { partyId: holding, revision: party.revision });
  }
  const [table] = await tx
    .select({
      inService: tableInService(diningTables.id).mapWith(Boolean),
      joined: joinedOutOfService(diningTables.id).mapWith(Boolean),
      zoneId: diningTables.zoneId,
      needsClearingSince: diningTables.needsClearingSince,
      needsMoving: needsMoving(diningTables.id).mapWith(Boolean),
    })
    .from(diningTables)
    .where(and(eq(diningTables.id, tableId), eq(diningTables.locationId, cfg.locationId)));
  if (table === undefined) throw new AppError("table.not_found", { tableId });
  if (!table.inService) throw new AppError("table.inactive", { tableId });
  if (table.joined) throw new AppError("table.in_joined_table", { tableId });
  if (table.needsClearingSince !== null) throw new AppError("table.needs_clearing", { tableId });
  if (table.needsMoving) throw new AppError("table.needs_moving", { tableId });
  return { holding, zoneId: table.zoneId };
}

/** A table no party holds, refused as seating refuses one in a zone that seats no one. */
export async function refuseUnseatable(
  tx: Transaction,
  cfg: TradingContext,
  table: TargetTable,
): Promise<void> {
  const context = await VENUE_SERVICE.resolveZoneContext(tx, cfg, table.zoneId);
  if (context.serviceMode !== "table_tab") {
    throw new AppError("service_zone.mode_incompatible", {
      zoneId: table.zoneId,
      expected: "table_tab",
      actual: context.serviceMode,
    });
  }
}

interface SourceParty {
  id: string;
  name: string | null;
}

async function readSourceParty(tx: Transaction, partyId: string): Promise<SourceParty> {
  const [party] = await tx
    .select({ id: parties.id, name: parties.name })
    .from(parties)
    .where(eq(parties.id, partyId));
  return party!;
}

/** What a bill taken from the party to the counter is labelled: the party's display name. */
async function counterLabel(tx: Transaction, party: SourceParty): Promise<string> {
  return partyDisplayName(party.name, (await partyTableLabels(tx, [party.id])).get(party.id)!);
}

/** A bill's status and when a payment in full at a reader began, as {@link takeIntoParty} answers. */
export interface BillState {
  status: (typeof workingOrders.$inferSelect)["status"];
  attemptAt: string | null;
}

/**
 * One more write on an open or presented bill, without `bumpRevision`'s refusal of money in flight:
 * a move changes no amount, and a card at the reader completes on the bill wherever it now is.
 */
const movedRevision = sql`${workingOrders.revision} + 1`;

/**
 * The bill joins the party: no longer delivered to a table, its revision moved on, and, while it is
 * open or presented, its service context taking `zoneId`, so a till limited to that zone may take
 * its payment. Answers the bill's state.
 */
export async function takeIntoParty(
  tx: Transaction,
  cfg: TradingContext,
  billId: string,
  partyId: string,
  zoneId: string | null,
  beforeSend?: () => Promise<void>,
): Promise<BillState> {
  const [bill] = await tx
    .update(workingOrders)
    .set({ partyId, deliveryTableId: null, revision: movedRevision })
    .where(eq(workingOrders.id, billId))
    .returning({ status: workingOrders.status, attemptAt: workingOrders.paymentAttemptAt });
  await VENUE_SERVICE.withdrawPendingDepartmentTransfers(tx, [billId]);
  await beforeSend?.();
  if (zoneId !== null && (bill!.status === "open" || bill!.status === "placed")) {
    await adoptZone(tx, cfg, billId, zoneId, { takesOrders: bill!.status === "open" });
  }
  return bill!;
}

/**
 * Active held kitchen work cannot leave its party. Recalled sources travel as unsent draft rows.
 * Sent dishes leave their groups, keeping their ticket and served state. Returns,
 * by line id, the person or kitchen display that fired each dish's group, for the dishes that were
 * in one.
 */
export async function leaveParty(
  tx: Transaction,
  billId: string,
): Promise<ReadonlyMap<string, Firer>> {
  const lines = await tx
    .select({
      id: workingOrderLines.id,
      groupId: workingOrderLines.groupId,
      firedBy: orderGroups.firedBy,
      firedByDeviceId: orderGroups.firedByDeviceId,
      recalledId: orderDraftRecalledLines.id,
    })
    .from(workingOrderLines)
    .leftJoin(orderGroups, eq(orderGroups.id, workingOrderLines.groupId))
    .leftJoin(
      orderDraftRecalledLines,
      eq(orderDraftRecalledLines.sourceLineId, workingOrderLines.id),
    )
    .where(
      and(eq(workingOrderLines.workingOrderId, billId), isNull(workingOrderLines.parentLineId)),
    );
  await refuseHeldLeavingParty(
    tx,
    billId,
    lines.filter((line) => line.recalledId === null).map((line) => line.id),
  );
  await clearGroups(
    tx,
    lines.filter((line) => line.groupId !== null).map((line) => line.id),
  );
  const firers = new Map<string, Firer>();
  for (const line of lines) {
    if (line.firedBy !== null) firers.set(line.id, { personId: line.firedBy });
    else if (line.firedByDeviceId !== null) firers.set(line.id, { deviceId: line.firedByDeviceId });
  }
  return firers;
}

/**
 * The bill takes `zoneId`'s service context. A bill entering table service from another mode
 * has its unsent dishes sent now, as a round is: table service sends a dish when it is ordered, and
 * none when the bill is paid. As placing does, the move is refused
 * `product.unavailable` when one cannot be sold now. Only a bill that `takesOrders` is refused a
 * zone closed to new orders: a presented bill takes no new order.
 */
async function adoptZone(
  tx: Transaction,
  cfg: TradingContext,
  billId: string,
  zoneId: string,
  options: { takesOrders: boolean } = { takesOrders: true },
): Promise<void> {
  const previous = await VENUE_SERVICE.findOrderContext(tx, cfg, billId);
  if (options.takesOrders && previous?.zoneId !== zoneId)
    await VENUE_SERVICE.assertZoneTakesNewOrders(tx, cfg, zoneId, new Date());
  if (previous === null) {
    await VENUE_SERVICE.recordOrderContext(tx, cfg, billId, zoneId);
  } else {
    await VENUE_SERVICE.retargetOrderContext(tx, cfg, billId, zoneId);
  }
  // Within table service a later course's dishes wait for their course. `fireLines` judges the
  // earliest course from this bill's ticket items and the lines it is given, and a no-preparation
  // dish leaves no ticket item, so it would send one waiting for a later course.
  if (!(await moveWouldSend(tx, cfg, billId, zoneId, previous?.serviceMode ?? "prepay"))) return;
  const unsent = await unsentDishLines(tx, billId);
  await assertSendable(
    tx,
    unsent.map((line) => line.id),
  );
  await fireLines(tx, cfg, billId, unsent);
}

export async function moveWouldSend(
  tx: Transaction,
  cfg: TradingContext,
  billId: string,
  toZoneId: string,
  previousMode?: string,
): Promise<boolean> {
  const sourceMode =
    previousMode ??
    (await VENUE_SERVICE.findOrderContext(tx, cfg, billId))?.serviceMode ??
    "prepay";
  const targetMode = (await VENUE_SERVICE.resolveZoneContext(tx, cfg, toZoneId)).serviceMode;
  return sourceMode !== "table_tab" && targetMode === "table_tab";
}
