import { randomUUID } from "node:crypto";
import { inArray } from "drizzle-orm";
import { workingOrderLines, withTransaction, type Database, type Transaction } from "@waitron/db";
import { readBillEditState } from "../bill-editing.js";
import {
  moveLinesToGroup as move,
  splitHeldLineIntoUnits as split,
  type PartyCommandArgs,
} from "../order-groups.js";
import type { BillEditExpected } from "../order-drafts.js";
import type { TillConfig } from "../till-config.js";
import type { OrderAttendance } from "../working-order.js";
export * from "../order-groups.js";

type Observations = { expectedEdit?: BillEditExpected; expectedEdits?: BillEditExpected[] };
const direct = new WeakMap<object, Map<string, Observations>>();
const http = new WeakMap<Database, Map<string, Observations>>();
async function observations(
  tx: Transaction,
  kind: "move" | "split",
  lineIds: string[],
): Promise<{ value: Observations; found: boolean }> {
  const lines =
    lineIds.length === 0
      ? []
      : await tx
          .select({ billId: workingOrderLines.workingOrderId })
          .from(workingOrderLines)
          .where(
            inArray(
              workingOrderLines.id,
              lineIds.map((id) => id.toLowerCase()),
            ),
          );
  const expectedEdits: BillEditExpected[] = [];
  for (const id of [...new Set(lines.map((line) => line.billId))].sort())
    expectedEdits.push(await readBillEditState(tx, id));
  return {
    value:
      kind === "move"
        ? { expectedEdits }
        : {
            expectedEdit: expectedEdits[0] ?? {
              billId: randomUUID(),
              editorVersion: 0,
              draftId: null,
              draftRevision: null,
            },
          },
    found: lines.length > 0,
  };
}
async function captured(
  tx: Transaction,
  cache: Map<string, Observations>,
  key: string,
  kind: "move" | "split",
  ids: string[],
) {
  let value = cache.get(key);
  if (value === undefined) {
    const observation = await observations(tx, kind, ids);
    value = observation.value;
    if (observation.found) cache.set(key, value);
  }
  return value;
}
function directCache(command: object) {
  let cache = direct.get(command);
  if (cache === undefined) {
    cache = new Map();
    direct.set(command, cache);
  }
  return cache;
}
// Content tests capture observations once; retries keep their original ownership envelope.
export async function observedGroupCompositionBody(
  db: Database,
  path: string,
  body: unknown,
): Promise<unknown> {
  const match = /^\/api\/parties\/([^/]+)\/groups\/(move|split-line)$/.exec(path);
  if (match === null || body === null || typeof body !== "object" || Array.isArray(body))
    return body;
  const ask = body as Record<string, unknown>;
  if (typeof ask.submissionId !== "string") return body;
  const kind = match[2] === "move" ? "move" : "split";
  const ids =
    kind === "split"
      ? typeof ask.lineId === "string"
        ? [ask.lineId]
        : []
      : Array.isArray(ask.moves)
        ? ask.moves.flatMap((m: unknown) =>
            m !== null && typeof m === "object" && "lineId" in m && typeof m.lineId === "string"
              ? [m.lineId]
              : [],
          )
        : [];
  let cache = http.get(db);
  if (cache === undefined) {
    cache = new Map();
    http.set(db, cache);
  }
  const value = await withTransaction(db, (tx) =>
    captured(tx, cache, `${match[1]}:${kind}:${ask.submissionId}`, kind, ids),
  );
  return { ...value, ...ask };
}
export async function moveLinesToGroup(
  tx: Transaction,
  cfg: TillConfig,
  partyId: string,
  moves: Parameters<typeof move>[3],
  target: Parameters<typeof move>[4],
  args: PartyCommandArgs & { expectedEdits?: BillEditExpected[] },
  attendance?: OrderAttendance,
) {
  const value =
    args.expectedEdits === undefined
      ? await captured(
          tx,
          directCache(args),
          `${partyId}:move`,
          "move",
          moves.map((m) => m.lineId),
        )
      : args;
  return move(
    tx,
    cfg,
    partyId,
    moves,
    target,
    { ...args, expectedEdits: value.expectedEdits! },
    attendance,
  );
}
export async function splitHeldLineIntoUnits(
  tx: Transaction,
  cfg: TillConfig,
  partyId: string,
  lineId: string,
  args: PartyCommandArgs & { expectedEdit?: BillEditExpected },
  attendance?: OrderAttendance,
) {
  const value =
    args.expectedEdit === undefined
      ? await captured(tx, directCache(args), `${partyId}:split`, "split", [lineId])
      : args;
  return split(
    tx,
    cfg,
    partyId,
    lineId,
    { ...args, expectedEdit: value.expectedEdit! },
    attendance,
  );
}
