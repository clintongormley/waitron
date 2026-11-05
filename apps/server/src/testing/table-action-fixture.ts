import { observedMoveBillBody } from "./move-bill-fixture.js";
import { withTransaction, type Database, type Transaction } from "@waitron/db";
import { readBillEditState, readPartyBillIds } from "../bill-editing.js";
import type { BillEditExpected } from "../order-drafts.js";
import { holderOf } from "../parties.js";
import {
  combineParties as combine,
  joinTables as join,
  moveGuests as move,
  splitTable as split,
  type SplitSelection,
  type TableActionOptions as Options,
} from "../table-actions.js";
import type { OriginConfig, TradingContext } from "../trading-context.js";
import type { OrderAttendance } from "../working-order.js";
export * from "../table-actions.js";

export type TableActionOptions = Omit<Options, "expectedEdits"> & {
  expectedEdits?: BillEditExpected[];
};

export async function partyBillEditsForTest(
  tx: Transaction,
  partyIds: string[],
): Promise<BillEditExpected[]> {
  const edits: BillEditExpected[] = [];
  for (const billId of await readPartyBillIds(tx, partyIds))
    edits.push(await readBillEditState(tx, billId));
  return edits;
}

// Content fixtures supply the new contract; raw ownership tests keep their original expectations.
async function fixtureOptions(
  tx: Transaction,
  partyId: string,
  tableId: string,
  options: TableActionOptions,
): Promise<Options> {
  const other = await holderOf(tx, tableId);
  return {
    ...options,
    expectedEdits:
      options.expectedEdits ??
      (await partyBillEditsForTest(tx, other === null ? [partyId] : [partyId, other])),
  };
}

export async function joinTables(
  tx: Transaction,
  cfg: OriginConfig,
  partyId: string,
  tableId: string,
  options: TableActionOptions,
) {
  return join(tx, cfg, partyId, tableId, await fixtureOptions(tx, partyId, tableId, options));
}
export async function moveGuests(
  tx: Transaction,
  cfg: OriginConfig,
  partyId: string,
  tableId: string,
  options: TableActionOptions,
) {
  return move(tx, cfg, partyId, tableId, await fixtureOptions(tx, partyId, tableId, options));
}
export async function combineParties(
  tx: Transaction,
  cfg: TradingContext,
  args: Omit<Parameters<typeof combine>[2], "expectedEdits"> & {
    expectedEdits?: BillEditExpected[];
  },
) {
  return combine(tx, cfg, {
    ...args,
    expectedEdits: args.expectedEdits ?? (await partyBillEditsForTest(tx, [args.from, args.into])),
  });
}

/** The selection of one whole bill; null selects nothing, so the new party gets an empty bill. */
export function oneBill(billId: string | null): SplitSelection {
  return { wholeBillIds: billId === null ? [] : [billId], loose: [] };
}

/** The bills a selection names, each once and sorted; a malformed one names only what it spells. */
function billsNamedBy(selection: unknown): string[] {
  if (selection === null || typeof selection !== "object") return [];
  const { wholeBillIds, loose } = selection as { wholeBillIds?: unknown; loose?: unknown };
  const named: unknown[] = [
    ...(Array.isArray(wholeBillIds) ? wholeBillIds : []),
    ...(Array.isArray(loose) ? loose.map((entry) => (entry as { billId?: unknown })?.billId) : []),
  ];
  return [...new Set(named.filter((id): id is string => typeof id === "string"))].sort();
}

type SplitOptions = Omit<Parameters<typeof split>[5], "expectedEdits"> & {
  expectedEdits?: BillEditExpected[];
};

/** A bill id or null answers the one bill; a selection answers the new party's bills too. */
export async function splitTable(
  tx: Transaction,
  cfg: OriginConfig,
  partyId: string,
  tableId: string,
  chosen: string | null,
  options: SplitOptions,
  attendance?: OrderAttendance,
): Promise<{ partyId: string; billId: string }>;
export async function splitTable(
  tx: Transaction,
  cfg: OriginConfig,
  partyId: string,
  tableId: string,
  chosen: SplitSelection,
  options: SplitOptions,
  attendance?: OrderAttendance,
): Promise<{ partyId: string; billId: string; billIds: string[] }>;
export async function splitTable(
  tx: Transaction,
  cfg: OriginConfig,
  partyId: string,
  tableId: string,
  chosen: string | null | SplitSelection,
  options: SplitOptions,
  attendance?: OrderAttendance,
): Promise<{ partyId: string; billId: string; billIds?: string[] }> {
  const selection = chosen === null || typeof chosen === "string" ? oneBill(chosen) : chosen;
  const expectedEdits: BillEditExpected[] = [];
  if (options.expectedEdits === undefined)
    for (const billId of billsNamedBy(selection))
      expectedEdits.push(await readBillEditState(tx, billId));
  const { partyId: leavingParty, billIds } = await split(
    tx,
    cfg,
    partyId,
    tableId,
    selection,
    { ...options, expectedEdits: options.expectedEdits ?? expectedEdits },
    attendance,
  );
  const answer = { partyId: leavingParty, billId: billIds[0]! };
  return typeof chosen === "object" && chosen !== null ? { ...answer, billIds } : answer;
}

export async function observedTableActionBody(
  db: Database,
  path: string,
  body: unknown,
): Promise<unknown> {
  const match = /^\/api\/parties\/([^/]+)\/(join|move|split-table)$/.exec(path);
  if (
    match === null ||
    body === null ||
    typeof body !== "object" ||
    Array.isArray(body) ||
    Object.hasOwn(body, "expectedEdits")
  )
    return body;
  const ask = body as Record<string, unknown>;
  return withTransaction(db, async (tx) => {
    if (match[2] === "split-table") {
      const expectedEdits: BillEditExpected[] = [];
      for (const billId of billsNamedBy(ask.selection))
        expectedEdits.push(await readBillEditState(tx, billId));
      return { expectedEdits, ...ask };
    }
    const tableId = match[2] === "join" ? ask.tableId : ask.toTableId;
    const other = typeof tableId === "string" ? await holderOf(tx, tableId.toLowerCase()) : null;
    return {
      expectedEdits: await partyBillEditsForTest(
        tx,
        other === null ? [match[1]!.toLowerCase()] : [match[1]!.toLowerCase(), other],
      ),
      ...ask,
    };
  });
}

export function observedRelocationSender(
  database: () => Database,
  send: typeof import("./bill-venue.js").send,
): typeof send {
  return async (app, cookie, method, path, body) =>
    send(
      app,
      cookie,
      method,
      path,
      await observedTableActionBody(
        database(),
        path,
        await observedMoveBillBody(database(), path, body),
      ),
    );
}
