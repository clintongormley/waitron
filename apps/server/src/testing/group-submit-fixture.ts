import { parties, withTransaction, type Database, type Transaction } from "@waitron/db";
import { eq } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { isUuid } from "@waitron/shared";
import { readBillEditState } from "../bill-editing.js";
import {
  placeGroups as place,
  submitGroups as submit,
  type PlaceGroupsInput,
  type SubmitGroupsInput,
} from "../order-groups.js";
import type { BillEditExpected } from "../order-drafts.js";
import { partyMainBill } from "../parties.js";
import type { OriginConfig } from "../till-config.js";
import type { OrderAttendance } from "../working-order.js";
import type { AttendanceRecorder } from "../attendance-capture.js";

const commands = new WeakMap<object, Map<string, BillEditExpected>>();
const http = new WeakMap<Database, Map<string, BillEditExpected>>();

async function observation(
  tx: Transaction,
  cfg: OriginConfig,
  partyId: string,
  billId: string | undefined,
  revisionMoved?: boolean,
): Promise<BillEditExpected> {
  const id = billId ?? (await partyMainBill(tx, cfg, partyId, revisionMoved ? "moved" : "move"));
  return readBillEditState(tx, id.toLowerCase());
}

// Content fixtures capture the first request's observation and keep it on completed retries.
export async function submitGroups(
  tx: Transaction,
  cfg: OriginConfig,
  partyId: string,
  input: Omit<SubmitGroupsInput, "expectedEdit"> & { expectedEdit?: BillEditExpected },
  attendance?: OrderAttendance,
) {
  let cache = commands.get(cfg);
  if (cache === undefined) {
    cache = new Map();
    commands.set(cfg, cache);
  }
  const key = `${partyId}:${input.submissionId}`;
  let expectedEdit = input.expectedEdit ?? cache.get(key);
  if (expectedEdit === undefined) {
    expectedEdit = await observation(tx, cfg, partyId, input.billId, true);
    cache.set(key, expectedEdit);
  }
  return submit(tx, cfg, partyId, { ...input, expectedEdit }, attendance);
}

export async function placeGroups(
  tx: Transaction,
  cfg: OriginConfig,
  partyId: string,
  input: Omit<PlaceGroupsInput, "expectedEdit"> & { expectedEdit?: BillEditExpected },
  attendance?: { recorder: AttendanceRecorder; at: string },
) {
  return place(
    tx,
    cfg,
    partyId,
    {
      ...input,
      expectedEdit:
        input.expectedEdit ?? (await observation(tx, cfg, partyId, input.billId, false)),
    },
    attendance,
  );
}

export async function observedGroupSubmitBody(
  db: Database,
  path: string,
  body: unknown,
): Promise<unknown> {
  const match = /^\/api\/parties\/([^/]+)\/groups$/.exec(path);
  if (match === null || body === null || typeof body !== "object" || Array.isArray(body))
    return body;
  const ask = body as Record<string, unknown>;
  if (Object.hasOwn(ask, "expectedEdit") || typeof ask.submissionId !== "string") return body;
  let cache = http.get(db);
  if (cache === undefined) {
    cache = new Map();
    http.set(db, cache);
  }
  const key = `${match[1]}:${ask.submissionId}`;
  let expectedEdit = cache.get(key);
  if (expectedEdit === undefined) {
    const [party] = await db
      .select({ billId: parties.mainBillId })
      .from(parties)
      .where(eq(parties.id, match[1]!));
    const id =
      typeof ask.billId === "string" && isUuid(ask.billId)
        ? ask.billId
        : (party?.billId ?? randomUUID());
    expectedEdit = await withTransaction(db, (tx) => readBillEditState(tx, id));
    cache.set(key, expectedEdit);
  }
  return { expectedEdit, ...ask };
}
