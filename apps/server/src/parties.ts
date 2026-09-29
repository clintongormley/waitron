import { createHash, randomUUID } from "node:crypto";
import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import {
  diningTables,
  nowIso,
  sales,
  serviceCommands,
  partyTables,
  parties,
  workingOrderLines,
  workingOrders,
} from "@waitron/db";
import type { Transaction } from "@waitron/db";
import { AppError, centsToDecimal, normalisePartyName, rawCentsToDecimal } from "@waitron/shared";
import { VENUE_SERVICE } from "./modules.js";
import type { TillConfig } from "./till-config.js";
import { createOpenOrder, openTab } from "./working-order.js";
import { outstandingOf, readPaymentsByBill, refuseBillHoldingMoney } from "./bill-payments.js";
import { discardPartyDrafts } from "./order-drafts.js";
import "./errors.js";

/** One bill of a party, as the table screen lists it. */
export interface PartyBill {
  workingOrderId: string;
  /** The party the bill is recorded on; for a bill a merged party kept, not the one asked about. */
  partyId: string;
  label: string | null;
  status: "open" | "placed" | "settled" | "abandoned";
  total: string;
  /**
   * What is still to pay: the total of an open or placed bill less the money received against it
   * before its invoice, and nothing on a settled or abandoned one.
   */
  outstanding: string;
  /** A payment is pending or received on the bill, one given back in full included. */
  hasPayments: boolean;
  /** A sale has been filed for the bill, so its receipt can be printed again. */
  receiptAvailable: boolean;
}

export type CommandScope =
  { kind: "party"; partyId: string } | { kind: "bill"; workingOrderId: string };

/** What a bill action is sent (D19): the party's revision as the caller last read it, and who acts. */
export interface PartyCommand {
  expectedPartyRevision?: number;
  operatorId: string;
}

/**
 * Seat a party at a free table: one party, its first table and its tab, in the caller's
 * transaction. A table that already belongs to a party is refused inside `openTab`.
 */
export async function seatTable(
  tx: Transaction,
  cfg: TillConfig,
  args: {
    tableId: string;
    guestCount: number | null;
    operatorId: string;
  },
): Promise<{ partyId: string; tabId: string; revision: number; orderNumber: number }> {
  // The party row comes first because the tab is inserted naming it, and the table joins it only
  // after `openTab` has checked that no party holds the table. A refusal from `openTab` therefore
  // leaves the party row for the caller's transaction to roll back.
  const { partyId, revision } = await insertParty(tx, args);
  const { tabId, orderNumber } = await openTab(tx, cfg, {
    tableId: args.tableId,
    partyId,
  });
  await tx.insert(partyTables).values({ partyId, tableId: args.tableId });
  await setMainBill(tx, partyId, tabId);
  return { partyId, tabId, revision, orderNumber };
}

/**
 * The party's main bill, where an order that names no bill goes: always an open bill of the party.
 * When the party has none, an empty one is made on the party and becomes its main bill, moving the
 * party's revision on unless the caller's command already has (`"moved"`). A main bill that is not
 * an open bill of the party is refused `tab.not_open`, so a caller may write to the answer without
 * checking it again.
 */
export async function partyMainBill(
  tx: Transaction,
  cfg: TillConfig,
  partyId: string,
  revision: "move" | "moved" = "move",
): Promise<string> {
  const [party] = await tx
    .select({
      state: parties.state,
      mainBillId: parties.mainBillId,
      billStatus: workingOrders.status,
      billPartyId: workingOrders.partyId,
    })
    .from(parties)
    .leftJoin(workingOrders, eq(workingOrders.id, parties.mainBillId))
    .where(eq(parties.id, partyId));
  if (party?.state !== "open") {
    throw new AppError("party.not_open", { partyId });
  }
  if (party.mainBillId !== null) {
    if (party.billStatus !== "open" || party.billPartyId !== partyId) {
      throw new AppError("tab.not_open", { tabId: party.mainBillId });
    }
    return party.mainBillId;
  }
  const billId = randomUUID();
  const zoneId = await partyZone(tx, cfg, partyId);
  await createOpenOrder(tx, cfg, billId, [], null, { zoneId: zoneId ?? undefined, partyId });
  await setMainBill(tx, partyId, billId);
  if (revision === "move") await bumpPartyRevision(tx, partyId);
  return billId;
}

/**
 * Name the party's main bill. This is the only writer of `parties.main_bill_id` in apps/server. The
 * database checks only that it names an existing order; nothing checks that the bill is open or the
 * party's, and the triggers in `0038_main_bill_release.sql` only clear it.
 */
export async function setMainBill(
  tx: Transaction,
  partyId: string,
  billId: string | null,
): Promise<void> {
  await tx.update(parties).set({ mainBillId: billId }).where(eq(parties.id, partyId));
}

/** The party's main bill as recorded, or null. */
export async function readMainBill(tx: Transaction, partyId: string): Promise<string | null> {
  const [party] = await tx
    .select({ mainBillId: parties.mainBillId })
    .from(parties)
    .where(eq(parties.id, partyId));
  return party!.mainBillId;
}

/** The service zone of the party's earliest active table; null when it holds none, or no zone. */
export async function partyZone(
  tx: Transaction,
  cfg: TillConfig,
  partyId: string,
): Promise<string | null> {
  void cfg;
  const [table] = await tx
    .select({ zoneId: diningTables.zoneId })
    .from(partyTables)
    .innerJoin(diningTables, eq(diningTables.id, partyTables.tableId))
    .where(and(eq(partyTables.partyId, partyId), isNull(partyTables.leftAt)))
    .orderBy(partyTables.joinedAt, partyTables.id)
    .limit(1);
  return table?.zoneId ?? null;
}

/** Name the party, or with an empty name clear it; a party command guarded by its revision. */
export async function setPartyName(
  tx: Transaction,
  args: { partyId: string; name: unknown; expectedPartyRevision: number },
): Promise<{ revision: number; name: string | null }> {
  const revision = await checkAndBumpParty(tx, args.partyId, args.expectedPartyRevision, "open");
  const name = normalisePartyName(args.name);
  await tx.update(parties).set({ name }).where(eq(parties.id, args.partyId));
  return { revision, name };
}

/**
 * Refuse an order sent to a bill that is not an open bill of the party, in this order: a
 * bill of another party (or of none) first, then a paid, an abandoned and a presented one. An id
 * naming no bill is `tab.not_open`, as an absent tab is elsewhere.
 */
export async function requireBillOfParty(
  tx: Transaction,
  partyId: string,
  billId: string,
): Promise<void> {
  const [bill] = await tx
    .select({ partyId: workingOrders.partyId, status: workingOrders.status })
    .from(workingOrders)
    .where(eq(workingOrders.id, billId));
  if (bill === undefined) throw new AppError("tab.not_open", { tabId: billId });
  if (bill.partyId !== partyId) {
    throw new AppError("bill.other_party", { workingOrderId: billId });
  }
  if (bill.status === "settled") throw new AppError("bill.paid", { workingOrderId: billId });
  if (bill.status === "abandoned") throw new AppError("tab.not_open", { tabId: billId });
  if (bill.status === "placed") throw new AppError("bill.presented", { workingOrderId: billId });
}

async function insertParty(
  tx: Transaction,
  args: { guestCount: number | null; operatorId: string },
): Promise<{ partyId: string; revision: number }> {
  const [party] = await tx
    .insert(parties)
    .values({ guestCount: args.guestCount, openedBy: args.operatorId })
    .returning({ partyId: parties.id, revision: parties.revision });
  return party!;
}

/** A new open party holding one table. */
export async function openParty(
  tx: Transaction,
  args: { guestCount: number | null; operatorId: string; tableId: string },
): Promise<{ partyId: string; revision: number }> {
  const party = await insertParty(tx, args);
  await tx.insert(partyTables).values({ partyId: party.partyId, tableId: args.tableId });
  return party;
}

/** The party a bill belongs to; null for a counter order, or an order that does not exist. */
export async function partyOfOrder(tx: Transaction, orderId: string): Promise<string | null> {
  const [order] = await tx
    .select({ partyId: workingOrders.partyId })
    .from(workingOrders)
    .where(eq(workingOrders.id, orderId));
  return order?.partyId ?? null;
}

/** The party a bill belongs to, at its revision now; null for a bill with no party, or an order that
 * does not exist. */
export async function partyRevisionOfOrder(
  tx: Transaction,
  orderId: string,
): Promise<{ id: string; revision: number } | null> {
  const [party] = await tx
    .select({ id: parties.id, revision: parties.revision })
    .from(workingOrders)
    .innerJoin(parties, eq(parties.id, workingOrders.partyId))
    .where(eq(workingOrders.id, orderId));
  return party ?? null;
}

/** The tables the party holds now, in the order they joined it. */
export async function memberTables(tx: Transaction, partyId: string): Promise<string[]> {
  const rows = await tx
    .select({ tableId: partyTables.tableId })
    .from(partyTables)
    .where(and(eq(partyTables.partyId, partyId), isNull(partyTables.leftAt)))
    .orderBy(partyTables.joinedAt, partyTables.id);
  return rows.map((row) => row.tableId);
}

/** The table stops belonging to whichever party holds it. */
export async function leaveTables(
  tx: Transaction,
  tableIds: readonly string[],
  at: string = nowIso(),
): Promise<void> {
  await tx
    .update(partyTables)
    .set({ leftAt: at })
    .where(and(inArray(partyTables.tableId, [...tableIds]), isNull(partyTables.leftAt)));
}

/** Whether a party holds the table: an active membership row. */
export async function tableHeld(tx: Transaction, tableId: string): Promise<boolean> {
  const [member] = await tx
    .select({ id: partyTables.id })
    .from(partyTables)
    .where(and(eq(partyTables.tableId, tableId), isNull(partyTables.leftAt)));
  return member !== undefined;
}

/**
 * Check and move on the revision of the party a bill action changes, against
 * `expectedPartyRevision`, which it must carry. A party that is not open is refused before its
 * revision moves.
 */
export async function guardParty(
  tx: Transaction,
  partyId: string,
  command: Omit<PartyCommand, "operatorId">,
): Promise<void> {
  if (command.expectedPartyRevision === undefined) {
    throw new AppError("management.request_invalid", { field: "expectedPartyRevision" });
  }
  await checkAndBumpParty(tx, partyId, command.expectedPartyRevision, "open");
}

/**
 * Compare a command's party revision with the party's and move it on, in the caller's transaction,
 * so a command prepared from a stale copy of the party writes nothing. A party not in
 * `requiredState` is `party.not_open` whatever revision was sent. Returns the new revision.
 */
export async function checkAndBumpParty(
  tx: Transaction,
  partyId: string,
  expectedPartyRevision: number,
  requiredState: "open",
): Promise<number> {
  const [party] = await tx
    .select({ state: parties.state, revision: parties.revision })
    .from(parties)
    .where(eq(parties.id, partyId));
  if (party?.state !== requiredState) {
    throw new AppError("party.not_open", { partyId });
  }
  if (party.revision !== expectedPartyRevision) {
    throw new AppError("party.out_of_date", { partyId, revision: party.revision });
  }
  const revision = party.revision + 1;
  await tx.update(parties).set({ revision }).where(eq(parties.id, partyId));
  return revision;
}

/**
 * Refuse a command naming a party it read somewhere the party no longer is: `party.out_of_date`
 * with the party's current revision, or `party.not_open` when no party has that id.
 */
export async function refuseMovedParty(tx: Transaction, partyId: string): Promise<never> {
  const [party] = await tx
    .select({ revision: parties.revision })
    .from(parties)
    .where(eq(parties.id, partyId));
  if (party === undefined) throw new AppError("party.not_open", { partyId });
  throw new AppError("party.out_of_date", { partyId, revision: party.revision });
}

/**
 * Move the party's revision on without comparing it: for a write that is not a party command of its
 * own and carries no revision (D19), such as a line edit or a void, whose bill's revision guards it.
 */
export async function bumpPartyRevision(tx: Transaction, partyId: string): Promise<void> {
  await tx
    .update(parties)
    .set({ revision: sql`${parties.revision} + 1` })
    .where(eq(parties.id, partyId));
}

/**
 * The party and every party merged into it, directly or through a chain of merges. Only an open
 * party can absorb another and the absorbed one closes, so a chain cannot loop.
 */
export async function partyFamily(tx: Transaction, partyId: string): Promise<string[]> {
  return (await partyFamilies(tx, [partyId])).get(partyId)!;
}

/** {@link partyFamily} for several parties in one query, keyed by each party asked about. */
export async function partyFamilies(
  tx: Transaction,
  partyIds: readonly string[],
): Promise<Map<string, string[]>> {
  const families = new Map(partyIds.map((id) => [id, [] as string[]]));
  const { rows } = await tx.execute<{ root: string; id: string }>(sql`
    with recursive family(root, id) as (
      select value, value from json_each(${JSON.stringify(partyIds)})
      union
      select f.root, v.id from parties v join family f on v.merged_into_party_id = f.id
    )
    select root, id from family
  `);
  for (const row of rows) families.get(row.root)!.push(row.id);
  return families;
}

async function readParty(
  tx: Transaction,
  partyId: string,
): Promise<{ state: "open" | "closed" } | undefined> {
  const [party] = await tx
    .select({ state: parties.state })
    .from(parties)
    .where(eq(parties.id, partyId));
  return party;
}

export async function requireOpenParty(tx: Transaction, partyId: string): Promise<void> {
  if ((await readParty(tx, partyId))?.state !== "open") {
    throw new AppError("party.not_open", { partyId });
  }
}

/** Every bill of the party's family, in the order they were opened. */
export async function readPartyBills(tx: Transaction, partyId: string): Promise<PartyBill[]> {
  if ((await readParty(tx, partyId)) === undefined) {
    throw new AppError("party.not_open", { partyId });
  }
  const bills = (await readBillsOfParties(tx, [partyId])).get(partyId)!;
  const filed = new Set(
    (
      await tx
        .select({ workingOrderId: sales.workingOrderId })
        .from(sales)
        .where(
          inArray(
            sales.workingOrderId,
            bills.map((bill) => bill.workingOrderId),
          ),
        )
    ).map((sale) => sale.workingOrderId),
  );
  return bills.map((bill) => ({ ...bill, receiptAvailable: filed.has(bill.workingOrderId) }));
}

/**
 * {@link readPartyBills} for several parties at once, keyed by each party asked about, without
 * reading whether each bill's receipt can be printed again.
 */
export async function readBillsOfParties(
  tx: Transaction,
  partyIds: readonly string[],
): Promise<Map<string, Omit<PartyBill, "receiptAvailable">[]>> {
  if (partyIds.length === 0) return new Map();
  const families = await partyFamilies(tx, partyIds);
  const members = [...new Set([...families.values()].flat())];
  const rows = await tx
    .select({
      workingOrderId: workingOrders.id,
      partyId: workingOrders.partyId,
      label: workingOrders.label,
      status: workingOrders.status,
      total: sql<string>`cast(coalesce(sum(${workingOrderLines.lineTotal}), 0) as text)`,
    })
    .from(workingOrders)
    .leftJoin(workingOrderLines, eq(workingOrderLines.workingOrderId, workingOrders.id))
    .where(inArray(workingOrders.partyId, members))
    .groupBy(workingOrders.id)
    .orderBy(workingOrders.openedAt, workingOrders.orderNumber, workingOrders.id);
  const { received, holding } = await readPaymentsByBill(
    tx,
    rows.map((row) => row.workingOrderId),
  );
  const bills = rows.map((row): Omit<PartyBill, "receiptAvailable"> => {
    const total = rawCentsToDecimal(row.total);
    const owing = row.status === "open" || row.status === "placed";
    return {
      workingOrderId: row.workingOrderId,
      partyId: row.partyId!,
      label: row.label,
      status: row.status,
      total,
      outstanding: owing
        ? outstandingOf(total, received.get(row.workingOrderId))
        : centsToDecimal(0),
      hasPayments: holding.has(row.workingOrderId),
    };
  });
  return new Map(
    [...families].map(([root, family]) => {
      const inFamily = new Set(family);
      return [root, bills.filter((bill) => inFamily.has(bill.partyId))];
    }),
  );
}

/**
 * The tables' parties have left them: their memberships end, their manual status goes,
 * and, where the venue's clearing setting is on, each needs clearing from `at` until
 * {@link markTableCleared}.
 */
export async function leaveForClearing(
  tx: Transaction,
  tableIds: readonly string[],
  at: string,
): Promise<void> {
  await leaveTables(tx, tableIds, at);
  const clearing = await VENUE_SERVICE.readClearingWorkflow(tx);
  await tx
    .update(diningTables)
    .set({ statusId: null, ...(clearing ? { needsClearingSince: at } : {}) })
    .where(inArray(diningTables.id, [...tableIds]));
}

/**
 * Finish the party's table: refused while any bill of the party's family is placed or open with
 * items on it; an empty open bill is abandoned. The party then closes and leaves its tables
 * ({@link leaveForClearing}).
 */
export async function finishTable(
  tx: Transaction,
  args: { partyId: string; expectedPartyRevision: number; operatorId: string },
): Promise<{ state: "closed" }> {
  const { partyId } = args;
  await checkAndBumpParty(tx, partyId, args.expectedPartyRevision, "open");

  const family = await partyFamily(tx, partyId);
  const bills = await tx
    .select({
      id: workingOrders.id,
      status: workingOrders.status,
      lines: sql<number>`count(${workingOrderLines.id})`,
    })
    .from(workingOrders)
    .leftJoin(workingOrderLines, eq(workingOrderLines.workingOrderId, workingOrders.id))
    .where(inArray(workingOrders.partyId, family))
    .groupBy(workingOrders.id);
  if (
    bills.some((bill) => bill.status === "placed" || (bill.status === "open" && bill.lines > 0))
  ) {
    throw new AppError("party.bill_outstanding", { partyId });
  }
  const empty = bills.filter((bill) => bill.status === "open").map((bill) => bill.id);
  // An emptied bill can still hold a tip its refunded payment kept (design §2.3, §4.5).
  await refuseBillHoldingMoney(tx, empty);
  if (empty.length > 0) {
    await tx
      .update(workingOrders)
      .set({ status: "abandoned" })
      .where(inArray(workingOrders.id, empty));
  }

  await discardPartyDrafts(tx, partyId, args.operatorId);

  const at = nowIso();
  const tables = await memberTables(tx, partyId);
  await tx
    .update(parties)
    .set({ state: "closed", closedAt: at, closedBy: args.operatorId })
    .where(eq(parties.id, partyId));
  await leaveForClearing(tx, tables, at);
  return { state: "closed" };
}

/** The table is ready for the next party. Clearing a table that does not need it is not refused. */
export async function markTableCleared(tx: Transaction, tableId: string): Promise<void> {
  const cleared = await tx
    .update(diningTables)
    .set({ needsClearingSince: null })
    .where(eq(diningTables.id, tableId))
    .returning({ id: diningTables.id });
  if (cleared.length === 0) throw new AppError("table.not_found", { tableId });
}

/** Keys a retry may change without being another command: the id itself and re-read revisions. */
const NOT_FINGERPRINTED = new Set([
  "submissionId",
  "expectedPartyRevision",
  "draftRevision",
  "expectedRevision",
]);

/** JSON with every object's keys sorted, so two spellings of one value print alike. */
function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(",")}]`;
  }
  if (value !== null && typeof value === "object") {
    const record = value as Record<string, unknown>;
    const keys = Object.keys(record)
      .filter((key) => record[key] !== undefined)
      .sort();
    return `{${keys.map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

/**
 * SHA-256 of `args` as canonical JSON, leaving out the keys a retry may change without being
 * another request (the submission id itself, and re-read revisions).
 */
export function fingerprint(args: Record<string, unknown>): string {
  const kept = Object.fromEntries(
    Object.entries(args).filter(([key]) => !NOT_FINGERPRINTED.has(key)),
  );
  return createHash("sha256").update(canonicalJson(kept)).digest("hex");
}

/**
 * Run a service command at most once per submission id in its scope, in the caller's transaction.
 * `args` is the command's path ids and body. A repeat of the same kind and arguments returns the
 * recorded result and runs nothing; the same id with another kind or other arguments is
 * `submission.id_reused`. The replay check comes before anything else the command checks, so a
 * retry is answered even once the party has closed. The result is recorded as JSON, so a replay
 * returns what JSON can carry of it.
 */
export async function runServiceCommand<R>(
  tx: Transaction,
  scope: CommandScope,
  submissionId: string,
  kind: string,
  args: Record<string, unknown>,
  run: () => Promise<R>,
): Promise<R> {
  const scopeId = scope.kind === "party" ? scope.partyId : scope.workingOrderId;
  const print = fingerprint(args);
  const [recorded] = await tx
    .select({
      kind: serviceCommands.kind,
      fingerprint: serviceCommands.fingerprint,
      result: serviceCommands.result,
    })
    .from(serviceCommands)
    .where(
      and(
        eq(serviceCommands.scopeKind, scope.kind),
        eq(serviceCommands.scopeId, scopeId),
        eq(serviceCommands.submissionId, submissionId),
      ),
    );
  if (recorded !== undefined) {
    if (recorded.kind !== kind || recorded.fingerprint !== print) {
      throw new AppError("submission.id_reused", { submissionId });
    }
    return recorded.result.value as R;
  }
  if (scope.kind === "party") await requireOpenParty(tx, scope.partyId);
  const result = await run();
  await tx.insert(serviceCommands).values({
    scopeKind: scope.kind,
    scopeId,
    submissionId,
    kind,
    fingerprint: print,
    result: { value: result },
  });
  return result;
}
