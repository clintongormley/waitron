import {
  parties,
  withTransaction,
  workingOrders,
  type Database,
  type Transaction,
} from "@waitron/db";
import { eq } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { AppError, isUuid } from "@waitron/shared";
import { readBillEditState } from "../bill-editing.js";
import type { AllergyPatch } from "@waitron/module";
import { enqueueKitchenAllergyChanges } from "../kitchen-allergy.js";
import {
  placeGroups as place,
  submitGroups as submit,
  type GroupLine,
  type GroupRelease,
  type PlaceGroupsInput,
  type SubmitGroupsInput,
} from "../order-groups.js";
import { applyPartyAllergyPatch, assertPartyAllergyAnswered } from "../party-allergy.js";
import { insertTabRound, priceTabRound } from "../working-order.js";
import type { BillEditExpected } from "../order-drafts.js";
import { bumpPartyRevision, insertPartyBill, setMainBill } from "../parties.js";
import { firstOpenBillOf } from "./party-bill-of.js";
import type { OriginConfig } from "../trading-context.js";
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
  const id = billId ?? (await openBillFor(tx, cfg, partyId, revisionMoved));
  return readBillEditState(tx, id.toLowerCase());
}

/**
 * The bill a round sent without one lands on: the party's lowest-numbered open bill, else a new
 * one, which moves the party's revision unless the caller's command moves it.
 */
async function openBillFor(
  tx: Transaction,
  cfg: OriginConfig,
  partyId: string,
  revisionMoved: boolean | undefined,
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
  if (party?.state !== "open") throw new AppError("party.not_open", { partyId });
  // Task 6c removes this.
  if (party.mainBillId !== null && (party.billStatus !== "open" || party.billPartyId !== partyId))
    throw new AppError("tab.not_open", { tabId: party.mainBillId });
  const open = await firstOpenBillOf(tx, partyId);
  if (open !== null) return open;
  const billId = await insertPartyBill(tx, cfg, partyId);
  // Task 6c removes this.
  await setMainBill(tx, partyId, billId);
  if (revisionMoved !== true) await bumpPartyRevision(tx, partyId);
  return billId;
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

/**
 * One group placed with each input line stored as one row, for tests of a line holding several
 * dishes. Allergy ticks name lines as `submitGroups`' do (`groupIndex` 0) and are applied before
 * anything prints, as there. Unlike `submitGroups` it records no replay, leaves the party's
 * revision alone, does not normalise the allergy patch, and checks the party's allergy answer only
 * when given a patch.
 */
export async function placeGroupedRound(
  tx: Transaction,
  cfg: OriginConfig,
  seat: { partyId: string; tabId: string },
  group: { lines: GroupLine[]; release: GroupRelease },
  operatorId: string,
  allergy?: AllergyPatch,
) {
  const round = await priceTabRound(tx, cfg, seat.tabId, group.lines, "checked");
  const rows = await insertTabRound(
    tx,
    cfg,
    round,
    round.rows.map((row) => ({ ...row, creditedTo: operatorId })),
  );
  const dishes = rows.filter((row) => row.parentLineId == null).map((row) => row.id);
  return place(
    tx,
    cfg,
    seat.partyId,
    {
      operatorId,
      billId: seat.tabId,
      expectedEdit: await readBillEditState(tx, seat.tabId),
      groups: [{ release: group.release, lines: [], existingLineIds: dishes }],
    },
    undefined,
    async () => {
      if (allergy === undefined) return;
      const targets = dishes.map((id, lineIndex) => ({
        ref: { kind: "submitted" as const, groupIndex: 0, lineIndex },
        draftLineId: null,
        workingLineId: id,
      }));
      const changes = await applyPartyAllergyPatch(tx, seat.partyId, allergy, operatorId, targets);
      await enqueueKitchenAllergyChanges(tx, cfg, changes);
      await assertPartyAllergyAnswered(tx, seat.partyId);
    },
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
    const partyId = match[1]!;
    expectedEdit = await withTransaction(db, async (tx) => {
      const id =
        typeof ask.billId === "string" && isUuid(ask.billId)
          ? ask.billId
          : ((await firstOpenBillOf(tx, partyId)) ?? randomUUID());
      return readBillEditState(tx, id);
    });
    cache.set(key, expectedEdit);
  }
  return { expectedEdit, ...ask };
}
