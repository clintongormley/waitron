import { createHash } from "node:crypto";
import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import {
  diningTables,
  nowIso,
  sales,
  serviceCommands,
  visitTables,
  visits,
  workingOrderLines,
  workingOrders,
} from "@waitron/db";
import type { Transaction } from "@waitron/db";
import { AppError, centsToDecimal, rawCentsToDecimal } from "@waitron/shared";
import { VENUE_SERVICE } from "./modules.js";
import type { TillConfig } from "./till-config.js";
import { openTab } from "./working-order.js";
import "./errors.js";

/** One bill of a visit's party, as the table screen lists it. */
export interface VisitBill {
  workingOrderId: string;
  /** The visit the bill is recorded on; for a bill a merged party kept, not the one asked about. */
  visitId: string;
  label: string | null;
  status: "open" | "placed" | "settled" | "abandoned";
  total: string;
  /** What is still to pay: the total of an open or placed bill, nothing on a settled or abandoned one. */
  outstanding: string;
  /** A sale has been filed for the bill, so its receipt can be printed again. */
  receiptAvailable: boolean;
}

export type CommandScope =
  { kind: "visit"; visitId: string } | { kind: "bill"; workingOrderId: string };

/**
 * What a tab path that moves lines or tables is sent (D19): the revision of each visit it changes, as
 * the caller last read it, and who acts. `expectedSourceVisitRevision` is the other visit's, on a
 * merge or transfer between two parties.
 */
export interface VisitCommand {
  expectedVisitRevision?: number;
  expectedSourceVisitRevision?: number;
  operatorId: string;
}

/**
 * Seat a party at a free table: one visit, its first table and its tab, in the caller's
 * transaction. A table that already belongs to a visit is refused inside `openTab`.
 */
export async function seatTable(
  tx: Transaction,
  cfg: TillConfig,
  args: {
    tableId: string;
    guestCount: number | null;
    operatorId: string;
    lines?: { menuItemId: string; quantity: string }[];
  },
): Promise<{ visitId: string; tabId: string; revision: number; orderNumber: number }> {
  const { tabId, orderNumber } = await openTab(tx, cfg, {
    tableId: args.tableId,
    lines: args.lines,
  });
  const { visitId, revision } = await openVisit(tx, {
    guestCount: args.guestCount,
    operatorId: args.operatorId,
    tableId: args.tableId,
  });
  await tx.update(workingOrders).set({ visitId }).where(eq(workingOrders.id, tabId));
  return { visitId, tabId, revision, orderNumber };
}

/** A new open visit holding one table. */
export async function openVisit(
  tx: Transaction,
  args: { guestCount: number | null; operatorId: string; tableId: string },
): Promise<{ visitId: string; revision: number }> {
  const [visit] = await tx
    .insert(visits)
    .values({ guestCount: args.guestCount, openedBy: args.operatorId })
    .returning({ visitId: visits.id, revision: visits.revision });
  await tx.insert(visitTables).values({ visitId: visit!.visitId, tableId: args.tableId });
  return visit!;
}

/** The visit a bill belongs to; null for a counter order, or an order that does not exist. */
export async function visitOfOrder(tx: Transaction, orderId: string): Promise<string | null> {
  const [order] = await tx
    .select({ visitId: workingOrders.visitId })
    .from(workingOrders)
    .where(eq(workingOrders.id, orderId));
  return order?.visitId ?? null;
}

/** The tables the visit holds now, in the order they joined it. */
export async function memberTables(tx: Transaction, visitId: string): Promise<string[]> {
  const rows = await tx
    .select({ tableId: visitTables.tableId })
    .from(visitTables)
    .where(and(eq(visitTables.visitId, visitId), isNull(visitTables.leftAt)))
    .orderBy(visitTables.joinedAt, visitTables.id);
  return rows.map((row) => row.tableId);
}

/** The table stops belonging to whichever visit holds it. */
export async function leaveTables(tx: Transaction, tableIds: readonly string[]): Promise<void> {
  if (tableIds.length === 0) return;
  await tx
    .update(visitTables)
    .set({ leftAt: nowIso() })
    .where(and(inArray(visitTables.tableId, [...tableIds]), isNull(visitTables.leftAt)));
}

/** Whether a party holds the table, as a member of an open visit or one still needing clearing. */
export async function tableHeld(tx: Transaction, tableId: string): Promise<boolean> {
  const [member] = await tx
    .select({ id: visitTables.id })
    .from(visitTables)
    .where(and(eq(visitTables.tableId, tableId), isNull(visitTables.leftAt)));
  return member !== undefined;
}

async function bumpOpenVisit(
  tx: Transaction,
  visitId: string,
  expected: number | undefined,
  field: "expectedVisitRevision" | "expectedSourceVisitRevision",
): Promise<void> {
  if (expected === undefined) {
    throw new AppError("management.request_invalid", { field });
  }
  if ((await readVisit(tx, visitId))?.state !== "open") {
    throw new AppError("visit.not_open", { visitId });
  }
  await checkAndBumpVisit(tx, visitId, expected);
}

/**
 * Check and move on the revision of each visit a tab path changes: the destination's against
 * `expectedVisitRevision`, and a different source's against `expectedSourceVisitRevision`. A visit
 * that is not open is refused before its revision moves. A bill on no visit needs no revision.
 */
export async function guardVisits(
  tx: Transaction,
  destination: string | null,
  source: string | null,
  command: Omit<VisitCommand, "operatorId"> | undefined,
): Promise<void> {
  if (destination !== null) {
    await bumpOpenVisit(tx, destination, command?.expectedVisitRevision, "expectedVisitRevision");
  }
  if (source !== null && source !== destination) {
    await bumpOpenVisit(
      tx,
      source,
      command?.expectedSourceVisitRevision,
      "expectedSourceVisitRevision",
    );
  }
}

/** The visit a table belongs to, while it belongs to one. */
export async function visitForTable(
  tx: Transaction,
  tableId: string,
): Promise<{ visitId: string; revision: number } | null> {
  const [row] = await tx
    .select({ visitId: visits.id, revision: visits.revision })
    .from(visitTables)
    .innerJoin(visits, eq(visits.id, visitTables.visitId))
    .where(and(eq(visitTables.tableId, tableId), isNull(visitTables.leftAt)));
  return row ?? null;
}

/**
 * Compare a command's visit revision with the visit's and move it on, in the caller's transaction,
 * so a command prepared from a stale copy of the visit writes nothing. Returns the new revision.
 */
export async function checkAndBumpVisit(
  tx: Transaction,
  visitId: string,
  expectedVisitRevision: number,
): Promise<number> {
  const [visit] = await tx
    .select({ revision: visits.revision })
    .from(visits)
    .where(eq(visits.id, visitId));
  if (visit === undefined) {
    throw new AppError("visit.not_open", { visitId });
  }
  if (visit.revision !== expectedVisitRevision) {
    throw new AppError("visit.out_of_date", { visitId, revision: visit.revision });
  }
  const revision = visit.revision + 1;
  await tx.update(visits).set({ revision }).where(eq(visits.id, visitId));
  return revision;
}

/**
 * The visit and every visit merged into it, directly or through a chain of merges. Only an open
 * visit can absorb another and the absorbed one closes, so a chain cannot loop.
 */
export async function visitFamily(tx: Transaction, visitId: string): Promise<string[]> {
  return (await visitFamilies(tx, [visitId])).get(visitId)!;
}

/** {@link visitFamily} for several visits in one query, keyed by each visit asked about. */
export async function visitFamilies(
  tx: Transaction,
  visitIds: readonly string[],
): Promise<Map<string, string[]>> {
  const families = new Map(visitIds.map((id) => [id, [] as string[]]));
  if (visitIds.length === 0) return families;
  const { rows } = await tx.execute<{ root: string; id: string }>(sql`
    with recursive family(root, id) as (
      select value, value from json_each(${JSON.stringify(visitIds)})
      union
      select f.root, v.id from visits v join family f on v.merged_into_visit_id = f.id
    )
    select root, id from family
  `);
  for (const row of rows) families.get(row.root)!.push(row.id);
  return families;
}

async function readVisit(
  tx: Transaction,
  visitId: string,
): Promise<{ state: "open" | "needs_clearing" | "closed" } | undefined> {
  const [visit] = await tx
    .select({ state: visits.state })
    .from(visits)
    .where(eq(visits.id, visitId));
  return visit;
}

/** Every bill of the visit's family, in the order they were opened. */
export async function readVisitBills(tx: Transaction, visitId: string): Promise<VisitBill[]> {
  if ((await readVisit(tx, visitId)) === undefined) {
    throw new AppError("visit.not_open", { visitId });
  }
  return (await readBillsOfVisits(tx, [visitId])).get(visitId)!;
}

/** {@link readVisitBills} for several visits at once, keyed by each visit asked about. */
export async function readBillsOfVisits(
  tx: Transaction,
  visitIds: readonly string[],
): Promise<Map<string, VisitBill[]>> {
  if (visitIds.length === 0) return new Map();
  const families = await visitFamilies(tx, visitIds);
  const members = [...new Set([...families.values()].flat())];
  const rows = await tx
    .select({
      workingOrderId: workingOrders.id,
      visitId: workingOrders.visitId,
      label: workingOrders.label,
      status: workingOrders.status,
      total: sql<string>`cast(coalesce(sum(${workingOrderLines.lineTotal}), 0) as text)`,
    })
    .from(workingOrders)
    .leftJoin(workingOrderLines, eq(workingOrderLines.workingOrderId, workingOrders.id))
    .where(inArray(workingOrders.visitId, members))
    .groupBy(workingOrders.id)
    .orderBy(workingOrders.openedAt, workingOrders.orderNumber, workingOrders.id);
  const filed = new Set(
    (
      await tx
        .select({ workingOrderId: sales.workingOrderId })
        .from(sales)
        .where(
          inArray(
            sales.workingOrderId,
            rows.map((row) => row.workingOrderId),
          ),
        )
    ).map((sale) => sale.workingOrderId),
  );
  const bills = rows.map((row): VisitBill => {
    const total = rawCentsToDecimal(row.total);
    const owing = row.status === "open" || row.status === "placed";
    return {
      workingOrderId: row.workingOrderId,
      visitId: row.visitId!,
      label: row.label,
      status: row.status,
      total,
      outstanding: owing ? total : centsToDecimal(0),
      receiptAvailable: filed.has(row.workingOrderId),
    };
  });
  return new Map(
    [...families].map(([root, family]) => {
      const inFamily = new Set(family);
      return [root, bills.filter((bill) => inFamily.has(bill.visitId))];
    }),
  );
}

/**
 * Take the tab pointer off every table the visit holds, and with `leave` end its memberships too,
 * which frees the tables for the next party.
 */
async function releaseTables(
  tx: Transaction,
  visitId: string,
  leave: { at: string } | null,
): Promise<void> {
  const members = await tx
    .select({ tableId: visitTables.tableId })
    .from(visitTables)
    .where(and(eq(visitTables.visitId, visitId), isNull(visitTables.leftAt)));
  await tx
    .update(diningTables)
    .set({ tabId: null })
    .where(
      inArray(
        diningTables.id,
        members.map((member) => member.tableId),
      ),
    );
  if (leave !== null) {
    await tx
      .update(visitTables)
      .set({ leftAt: leave.at })
      .where(and(eq(visitTables.visitId, visitId), isNull(visitTables.leftAt)));
  }
}

/**
 * Finish the party's table: refused while any bill of the visit's family is placed or open with
 * items on it; an empty open bill is abandoned. The visit then closes and frees its tables, or,
 * where the venue uses the clearing workflow, keeps them as needing clearing until
 * {@link markCleared}.
 */
export async function finishTable(
  tx: Transaction,
  cfg: TillConfig,
  args: { visitId: string; expectedVisitRevision: number; operatorId: string },
): Promise<{ state: "closed" | "needs_clearing" }> {
  void cfg;
  const { visitId } = args;
  if ((await readVisit(tx, visitId))?.state !== "open") {
    throw new AppError("visit.not_open", { visitId });
  }
  await checkAndBumpVisit(tx, visitId, args.expectedVisitRevision);

  const family = await visitFamily(tx, visitId);
  const bills = await tx
    .select({
      id: workingOrders.id,
      status: workingOrders.status,
      lines: sql<number>`count(${workingOrderLines.id})`,
    })
    .from(workingOrders)
    .leftJoin(workingOrderLines, eq(workingOrderLines.workingOrderId, workingOrders.id))
    .where(inArray(workingOrders.visitId, family))
    .groupBy(workingOrders.id);
  if (
    bills.some((bill) => bill.status === "placed" || (bill.status === "open" && bill.lines > 0))
  ) {
    throw new AppError("visit.bill_outstanding", { visitId });
  }
  const empty = bills.filter((bill) => bill.status === "open").map((bill) => bill.id);
  if (empty.length > 0) {
    await tx
      .update(workingOrders)
      .set({ status: "abandoned" })
      .where(inArray(workingOrders.id, empty));
  }

  const state = (await VENUE_SERVICE.readClearingWorkflow(tx)) ? "needs_clearing" : "closed";
  const at = nowIso();
  await tx
    .update(visits)
    .set({ state, closedAt: at, closedBy: args.operatorId })
    .where(eq(visits.id, visitId));
  await releaseTables(tx, visitId, state === "closed" ? { at } : null);
  return { state };
}

/** A table that needed clearing is ready for the next party: the visit closes and frees its tables. */
export async function markCleared(
  tx: Transaction,
  cfg: TillConfig,
  args: { visitId: string; expectedVisitRevision: number },
): Promise<void> {
  void cfg;
  const { visitId } = args;
  if ((await readVisit(tx, visitId))?.state !== "needs_clearing") {
    throw new AppError("visit.not_open", { visitId });
  }
  await checkAndBumpVisit(tx, visitId, args.expectedVisitRevision);
  await tx.update(visits).set({ state: "closed" }).where(eq(visits.id, visitId));
  await releaseTables(tx, visitId, { at: nowIso() });
}

/** Keys a retry may change without being another command: the id itself and re-read revisions. */
const NOT_FINGERPRINTED = new Set([
  "submissionId",
  "expectedVisitRevision",
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

function fingerprint(args: Record<string, unknown>): string {
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
 * retry is answered even once the visit has closed. The result is recorded as JSON, so a replay
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
  const scopeId = scope.kind === "visit" ? scope.visitId : scope.workingOrderId;
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
  if (scope.kind === "visit" && (await readVisit(tx, scope.visitId))?.state !== "open") {
    throw new AppError("visit.not_open", { visitId: scope.visitId });
  }
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
