import { createHash } from "node:crypto";
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
import {
  AppError,
  centsToDecimal,
  MONEY_SCALE,
  rawCentsToDecimal,
  subtractDecimal,
  toScale,
} from "@waitron/shared";
import { VENUE_SERVICE } from "./modules.js";
import type { TillConfig } from "./till-config.js";
import { openTab } from "./working-order.js";
import { readReceivedByBill, refuseBillHoldingMoney } from "./bill-payments.js";
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
  /** A sale has been filed for the bill, so its receipt can be printed again. */
  receiptAvailable: boolean;
}

export type CommandScope =
  { kind: "visit"; partyId: string } | { kind: "bill"; workingOrderId: string };

/**
 * What a tab path that moves lines or tables is sent (D19): the revision of each party it changes, as
 * the caller last read it, and who acts. `expectedSourcePartyRevision` is the other party's, on a
 * merge or transfer between two parties.
 */
export interface PartyCommand {
  expectedPartyRevision?: number;
  expectedSourcePartyRevision?: number;
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
  return { partyId, tabId, revision, orderNumber };
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

/** Whether a party holds the table, as a member of an open party or one still needing clearing. */
export async function tableHeld(tx: Transaction, tableId: string): Promise<boolean> {
  const [member] = await tx
    .select({ id: partyTables.id })
    .from(partyTables)
    .where(and(eq(partyTables.tableId, tableId), isNull(partyTables.leftAt)));
  return member !== undefined;
}

async function bumpOpenParty(
  tx: Transaction,
  partyId: string,
  expected: number | undefined,
  field: "expectedPartyRevision" | "expectedSourcePartyRevision",
): Promise<void> {
  if (expected === undefined) {
    throw new AppError("management.request_invalid", { field });
  }
  await checkAndBumpParty(tx, partyId, expected, "open");
}

/**
 * Check and move on the revision of each party a tab path changes: the destination's against
 * `expectedPartyRevision`, and a different source's against `expectedSourcePartyRevision`. A party
 * that is not open is refused before its revision moves. A bill on no party needs no revision.
 */
export async function guardParties(
  tx: Transaction,
  destination: string | null,
  source: string | null,
  command: Omit<PartyCommand, "operatorId"> | undefined,
): Promise<void> {
  if (destination !== null) {
    await bumpOpenParty(tx, destination, command?.expectedPartyRevision, "expectedPartyRevision");
  }
  if (source !== null && source !== destination) {
    await bumpOpenParty(
      tx,
      source,
      command?.expectedSourcePartyRevision,
      "expectedSourcePartyRevision",
    );
  }
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
  requiredState: "open" | "needs_clearing",
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
): Promise<{ state: "open" | "needs_clearing" | "closed" } | undefined> {
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
  const received = await readReceivedByBill(
    tx,
    rows.filter((row) => row.status === "open").map((row) => row.workingOrderId),
  );
  const bills = rows.map((row): Omit<PartyBill, "receiptAvailable"> => {
    const total = rawCentsToDecimal(row.total);
    const owing = row.status === "open" || row.status === "placed";
    const paid = received.get(row.workingOrderId);
    return {
      workingOrderId: row.workingOrderId,
      partyId: row.partyId!,
      label: row.label,
      status: row.status,
      total,
      outstanding: !owing
        ? centsToDecimal(0)
        : paid === undefined
          ? total
          : toScale(subtractDecimal(total, paid), MONEY_SCALE),
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
 * Take the tab pointer off every table the party holds, and with `leave` end its memberships too,
 * which frees the tables for the next party.
 */
async function releaseTables(
  tx: Transaction,
  partyId: string,
  leave: { at: string } | null,
): Promise<void> {
  const members = await memberTables(tx, partyId);
  await tx.update(diningTables).set({ tabId: null }).where(inArray(diningTables.id, members));
  if (leave !== null) {
    await leaveTables(tx, members, leave.at);
  }
}

/**
 * Finish the party's table: refused while any bill of the party's family is placed or open with
 * items on it; an empty open bill is abandoned. The party then closes and frees its tables, or,
 * where the venue uses the clearing workflow, keeps them as needing clearing until
 * {@link markCleared}.
 */
export async function finishTable(
  tx: Transaction,
  args: { partyId: string; expectedPartyRevision: number; operatorId: string },
): Promise<{ state: "closed" | "needs_clearing" }> {
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

  const state = (await VENUE_SERVICE.readClearingWorkflow(tx)) ? "needs_clearing" : "closed";
  const at = nowIso();
  await tx
    .update(parties)
    .set({ state, closedAt: at, closedBy: args.operatorId })
    .where(eq(parties.id, partyId));
  await releaseTables(tx, partyId, state === "closed" ? { at } : null);
  return { state };
}

/** A table that needed clearing is ready for the next party: the party closes and frees its tables. */
export async function markCleared(
  tx: Transaction,
  args: { partyId: string; expectedPartyRevision: number },
): Promise<void> {
  const { partyId } = args;
  await checkAndBumpParty(tx, partyId, args.expectedPartyRevision, "needs_clearing");
  await tx.update(parties).set({ state: "closed" }).where(eq(parties.id, partyId));
  await releaseTables(tx, partyId, { at: nowIso() });
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
  const scopeId = scope.kind === "visit" ? scope.partyId : scope.workingOrderId;
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
  if (scope.kind === "visit") await requireOpenParty(tx, scope.partyId);
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
