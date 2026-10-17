import { and, asc, eq, inArray, notInArray, sql } from "drizzle-orm";
import {
  kitchenCourses,
  newId,
  nowIso,
  orderDraftEvents,
  orderDraftLines,
  orderDraftRecalledLines,
  workingOrderLines,
  orderDrafts,
  orderGroups,
  workingOrders,
} from "@waitron/db";
import type { Transaction } from "@waitron/db";
import { readExtraSelections, readOptionSelections } from "@waitron/catalogue";
import { persons } from "@waitron/identity";
import type { ZoneMenuOffer, ZoneOffers } from "@waitron/module";
import {
  AppError,
  centsToDecimal,
  sumDecimals,
  isUuid,
  normaliseDraftLines,
  stringToThousandths,
  thousandthsToDecimal,
} from "@waitron/shared";
import type { ExtraSelection, OptionSelection } from "@waitron/shared";
import { invalid } from "./bill-allocation.js";
import { VENUE_SERVICE } from "./modules.js";
import { listOrderGroups, placeGroups } from "./order-groups.js";
import type { GroupLine, GroupRelease, SubmittedGroups, PartyCommandArgs } from "./order-groups.js";
import type { OriginConfig, TillConfig } from "./till-config.js";
import {
  checkAndBumpParty,
  partyZone,
  partyRevisionOfOrder,
  requireBillOfParty,
  requireOpenParty,
  runServiceCommand,
} from "./parties.js";
import {
  prepareRecalledModifiers,
  readTabLines,
  readOrderRevision,
  refusePaymentInFlight,
  screenNote,
} from "./working-order.js";
import type { TabLine, OrderAttendance } from "./working-order.js";
import { requireMakeAtStation } from "./dead-ends.js";
import { requireCourse, requireLiveCourse } from "./kitchen.js";
import { RETAINED_COURSE } from "./retained-course.js";
import { saveRecalledLine } from "./draft-recall.js";
import { applyAdjustment, type AdjustmentArgs } from "./adjustments-apply.js";
import type { PinAttempts } from "@waitron/identity";
import type { AttendanceRecorder } from "./attendance-capture.js";
import {
  acquireBillEditor,
  closeBillDraft,
  parseBillEditExpected,
  readBillEditState,
  relocateBillEditor,
  requireBillEditor,
  transferBillEditor,
} from "./bill-editing.js";
import "./errors.js";

export interface FreshDraftLine {
  sourceLineId: null;
  source: null;
  id: string;
  menuItemId: string;
  variantId: string | null;
  menuVersionId: string | null;
  options: OptionSelection[];
  extras: ExtraSelection[];
  note: string | null;
  quantity: string;
  courseId: string | null;
  course?: { id: string; name: string; displayOrder: number; heldUntilFired: boolean };
  makeAt?: string | null;
  noMerge: boolean;
  slot: number;
  joinGroupId: string | null;
  afterGroupId: string | null;
  unavailable: boolean;
}

export interface RecalledDraftLine {
  id: string;
  sourceLineId: string;
  source: { line: TabLine; extras: TabLine[]; netAmount: string };
  quantity: string;
  note: string | null;
  courseId: string | null;
  course?: FreshDraftLine["course"];
  makeAt: string | null;
  noMerge: true;
  slot: number;
  joinGroupId: string | null;
  afterGroupId: string | null;
  unavailable: false;
  menuItemId?: never;
  variantId?: never;
  menuVersionId?: never;
  options?: never;
  extras?: never;
}
export type DraftLine = FreshDraftLine | RecalledDraftLine;

export interface Draft {
  id: string;
  partyId: string;
  billId: string;
  ownerId: string;
  ownerName: string;
  revision: number;
  lines: DraftLine[];
  /** The owner before the draft's latest `taken_over` event; null when it was never taken over. */
  takenOverFrom: { personId: string; name: string } | null;
}

export interface BillEditState {
  billId: string;
  editorId: string | null;
  editorName: string | null;
  editorVersion: number;
  draftId: string | null;
  draftRevision: number | null;
}

export type BillEditExpected = Pick<
  BillEditState,
  "billId" | "editorVersion" | "draftId" | "draftRevision"
>;

export interface BillDraftSnapshot {
  draft: Draft | null;
  edit: BillEditState;
}

export { normaliseDraftLines };

export type FreshDraftLineInput = Omit<
  FreshDraftLine,
  "id" | "unavailable" | "course" | "source"
> & { id?: string };
export type RecalledDraftLineInput = Pick<
  RecalledDraftLine,
  | "id"
  | "sourceLineId"
  | "quantity"
  | "note"
  | "courseId"
  | "makeAt"
  | "slot"
  | "joinGroupId"
  | "afterGroupId"
> & {
  options?: OptionSelection[];
  extras?: ExtraSelection[];
};
export type DraftLineInput = FreshDraftLineInput | RecalledDraftLineInput;

export interface SaveDraftInput {
  expectedEdit: BillEditExpected;
  billId: unknown;
  /** Null compares an unallocated outbox on this bill. */
  draftId: string | null;
  revision: number;
  /** Screened by the save before it reads or writes anything. */
  lines: unknown;
}

/** One unsent draft on a party, as the floor shows it: `lineCount` counts rows, not units. */
export interface UnsentDraft {
  ownerName: string;
  lineCount: number;
}

export async function readDrafts(
  tx: Transaction,
  cfg: TillConfig,
  partyId: string,
): Promise<Draft[]> {
  return readOpenDrafts(tx, cfg, partyId);
}

export async function appendRecalledLine(
  tx: Transaction,
  cfg: TillConfig,
  partyId: string,
  billId: string,
  operatorId: string,
  sourceLineId: string,
  joinGroupId: string | null,
  attendance?: OrderAttendance,
): Promise<Draft> {
  const [own] = await openDraftsOn(tx, partyId, operatorId, billId);
  const draftId = own?.id ?? newId();
  if (own === undefined) {
    await tx.insert(orderDrafts).values({ id: draftId, partyId, billId, ownerId: operatorId });
    await recordDraftEvents(
      tx,
      attendance === undefined
        ? undefined
        : {
            recorder: attendance.recorder,
            at: attendance.clock.now().instant.toISOString(),
          },
      {
        draftId,
        kind: "created",
        fromPerson: null,
        toPerson: operatorId,
        actorId: operatorId,
        detail: {},
      },
    );
  } else
    await tx
      .update(orderDrafts)
      .set({ revision: own.revision + 1, updatedAt: nowIso() })
      .where(eq(orderDrafts.id, draftId));
  const held = await storedLines(tx, cfg, [draftId]);
  const position = held.reduce((maximum, line) => Math.max(maximum, line.position), 0) + 1;
  const place =
    joinGroupId === null
      ? await recalledPlace(
          tx,
          cfg,
          partyId,
          sourceLineId,
          held.map((row) => row.line),
        )
      : { joinGroupId, slot: 0, afterGroupId: null };
  await tx.insert(orderDraftRecalledLines).values({ draftId, sourceLineId, position, ...place });
  return readOpenDraft(tx, cfg, partyId, draftId);
}

async function recalledPlace(
  tx: Transaction,
  cfg: TillConfig,
  partyId: string,
  sourceLineId: string,
  own: readonly DraftLine[],
): Promise<{ slot: number; joinGroupId: string | null; afterGroupId: string | null }> {
  const fire = { slot: 0, joinGroupId: null, afterGroupId: null };
  const [source] = await tx
    .select({ courseId: workingOrderLines.courseId })
    .from(workingOrderLines)
    .where(eq(workingOrderLines.id, sourceLineId));
  if (source!.courseId === null) return fire;
  const courses = await tx
    .select()
    .from(kitchenCourses)
    .where(eq(kitchenCourses.locationId, cfg.locationId));
  const course = courses.find((candidate) => candidate.id === source!.courseId);
  if (course?.heldUntilFired === false) return fire;
  const groups = (await listOrderGroups(tx, partyId)).groups.filter(
    (group) => group.state === "held",
  );
  const slots = [
    ...new Map(own.filter((line) => line.slot > 0).map((line) => [line.slot, line])).values(),
  ].sort((a, b) => a.slot - b.slot);
  const atSlot = (slot: number) =>
    own.some((line) => line.slot === slot && line.courseId === source!.courseId);
  const placeOf = (line: DraftLine) => ({
    slot: line.slot,
    joinGroupId: null,
    afterGroupId: line.afterGroupId,
  });
  for (const group of groups) {
    if (
      group.courseIds.includes(source!.courseId) ||
      own.some((line) => line.joinGroupId === group.id && line.courseId === source!.courseId)
    )
      return { ...fire, joinGroupId: group.id };
    const match = slots.find((line) => line.afterGroupId === group.id && atSlot(line.slot));
    if (match !== undefined) return placeOf(match);
  }
  const ids = new Set(groups.map((group) => group.id));
  const match = slots.find((line) => !ids.has(line.afterGroupId ?? "") && atSlot(line.slot));
  if (match !== undefined) return placeOf(match);
  const later =
    course !== undefined &&
    groups.length > 0 &&
    groups.every((group) =>
      group.courseIds.every((id) => {
        const previous = courses.find((candidate) => candidate.id === id);
        return previous !== undefined && course.displayOrder > previous.displayOrder;
      }),
    );
  return later ? { ...fire, slot: (slots.at(-1)?.slot ?? 0) + 1 } : fire;
}

export async function saveDraft(
  tx: Transaction,
  cfg: TillConfig,
  partyId: string,
  operatorId: string,
  input: SaveDraftInput,
  attendance?: AttendanceRecorder,
): Promise<BillDraftSnapshot> {
  const at = nowIso();
  const lines = parseDraftLines(input.lines);
  await requireOpenParty(tx, partyId);
  const billId = uuid(input.billId, "billId");
  const expected = parseBillEditExpected(input.expectedEdit);
  if (expected.billId !== billId) throw invalid("expectedEdit.billId");
  if (expected.draftId !== (input.draftId === null ? null : foldIfUuid(input.draftId)))
    throw invalid("expectedEdit.draftId");
  if (input.revision !== (expected.draftRevision ?? 0)) throw invalid("revision");
  if (expected.draftId !== null) {
    const [named] = await tx.select().from(orderDrafts).where(eq(orderDrafts.id, expected.draftId));
    if (named === undefined || named.partyId !== partyId || named.state === "submitted")
      await requireDraft(tx, expected.draftId, partyId);
    if (named?.billId !== undefined && named.billId !== billId) throw invalid("billId");
  }
  await requireBillOfParty(tx, partyId, billId);
  await refusePaymentInFlight(tx, [billId]);
  const edit = await requireBillEditor(tx, billId, operatorId, expected);
  if (lines.length === 0 && edit.draftId === null) return { draft: null, edit };
  let previous: DraftLine[] = [];
  const draft = edit.draftId === null ? null : await requireDraft(tx, edit.draftId, partyId);
  if (draft !== null) previous = (await storedLines(tx, cfg, [draft.id])).map(({ line }) => line);
  const owned = new Map(previous.map((line) => [line.id, line]));
  const named = new Set<string>();
  for (const [index, line] of lines.entries()) {
    if (line.id === undefined) continue;
    if (!owned.has(line.id) || named.has(line.id)) throw invalid(`lines.${index}.id`);
    named.add(line.id);
  }
  const retainedSources = new Set(previous.filter(isRecalled).map((line) => line.id));
  for (const [index, line] of lines.entries()) {
    const prior = line.id === undefined ? undefined : owned.get(line.id);
    if (line.sourceLineId === null) {
      if (prior?.sourceLineId != null) throw invalid(`lines.${index}.sourceLineId`);
      continue;
    }
    if (prior?.sourceLineId !== line.sourceLineId) throw invalid(`lines.${index}.sourceLineId`);
    const source = prior as RecalledDraftLine;
    if (stringToThousandths(line.quantity) < stringToThousandths(source.quantity))
      throw invalid(`lines.${index}.quantity`);
    if (
      source.source.line.menuItemId === null &&
      (line.options !== undefined || line.extras !== undefined)
    )
      throw invalid(`lines.${index}.sourceLineId`);
    retainedSources.delete(line.id);
  }
  if (retainedSources.size > 0) throw invalid("lines");
  const freshLines = lines.filter(isFresh);
  await validateDraftPlaces(tx, partyId, lines);
  await requireCourses(tx, cfg, freshLines, previous.filter(isFresh));
  const choiceOffers = lines.flatMap((line) =>
    line.sourceLineId !== null && (line.options !== undefined || line.extras !== undefined)
      ? [(owned.get(line.id)! as RecalledDraftLine).source.line.menuItemId!]
      : [],
  );
  let snapshot: ZoneOffers | undefined;
  if (choiceOffers.length > 0) {
    const zoneId = await partyZone(tx, cfg, partyId);
    if (zoneId !== null)
      snapshot = await VENUE_SERVICE.listZoneOffers(tx, cfg, zoneId, {
        menuItemIds: [...new Set([...choiceOffers, ...freshLines.map((line) => line.menuItemId)])],
        withDefault: false,
      });
  }
  const offers =
    snapshot === undefined
      ? await offersFor(
          tx,
          cfg,
          partyId,
          freshLines.map((line) => line.menuItemId),
        )
      : new Map(snapshot.offers.map((offer) => [offer.id, offer]));
  for (const line of freshLines) {
    const offer = offers.get(line.menuItemId);
    if (offer?.ordering === "not_sold_separately") {
      throw new AppError("product.not_sold_separately", { productId: offer.productId });
    }
  }
  let draftId: string;
  if (draft === null) {
    await acquireBillEditor(tx, billId, operatorId, expected);
    draftId = newId();
    await tx.insert(orderDrafts).values({ id: draftId, partyId, billId, ownerId: operatorId });
    await recordDraftEvents(
      tx,
      attendance === undefined ? undefined : { recorder: attendance, at },
      {
        draftId,
        kind: "created",
        fromPerson: null,
        toPerson: operatorId,
        actorId: operatorId,
        detail: {},
      },
    );
  } else {
    draftId = draft.id;
    if (lines.length > 0)
      await tx
        .update(orderDrafts)
        .set({ revision: draft.revision + 1, updatedAt: nowIso() })
        .where(eq(orderDrafts.id, draftId));
  }
  const priorChoices = new Map<string, number>();
  for (const line of previous.filter(isFresh)) {
    if (line.makeAt == null) continue;
    const key = JSON.stringify([line.menuItemId, line.variantId, line.makeAt]);
    priorChoices.set(key, (priorChoices.get(key) ?? 0) + 1);
  }
  for (const line of freshLines) {
    if (line.makeAt == null) continue;
    const key = JSON.stringify([line.menuItemId, line.variantId, line.makeAt]);
    const held = priorChoices.get(key) ?? 0;
    if (held > 0) priorChoices.set(key, held - 1);
    else await requireMakeAtStation(tx, cfg, line.makeAt);
  }
  const sources = lines.filter((line) => line.sourceLineId !== null);
  const families =
    sources.length === 0
      ? []
      : await tx
          .select()
          .from(workingOrderLines)
          .where(eq(workingOrderLines.workingOrderId, billId));
  const sourcePlans = await prepareRecalledModifiers(
    tx,
    cfg,
    billId,
    sources.map((line) => {
      const parent = families.find((row) => row.id === line.sourceLineId);
      if (parent === undefined) throw invalid("sourceLineId");
      return {
        parent,
        children: families.filter((child) => child.parentLineId === parent.id),
        input: line,
      };
    }),
    snapshot,
  );
  for (const line of lines) {
    if (line.sourceLineId !== null)
      await saveRecalledLine(
        tx,
        cfg,
        partyId,
        line.sourceLineId,
        line,
        operatorId,
        sourcePlans.get(line.sourceLineId),
      );
  }
  const allergy = await VENUE_SERVICE.readPartyAllergy(tx, partyId);
  const assigned = new Set(
    allergy.ticks.flatMap((tick) => (tick.draftLineId === null ? [] : [tick.draftLineId])),
  );
  await replaceLines(
    tx,
    [draftId],
    draftId,
    normaliseDraftLines(
      lines.map((line): DraftLine =>
        line.sourceLineId === null
          ? {
              ...line,
              source: null,
              id: line.id ?? newId(),
              noMerge: line.noMerge || (line.id !== undefined && assigned.has(line.id)),
              unavailable: false,
            }
          : {
              ...(owned.get(line.id)! as RecalledDraftLine),
              slot: line.slot,
              joinGroupId: line.joinGroupId,
              afterGroupId: line.afterGroupId,
            },
      ),
    ),
  );
  if (lines.length === 0) {
    const released = await closeBillDraft(tx, billId, operatorId, expected, "discarded");
    await recordDraftEvents(
      tx,
      attendance === undefined ? undefined : { recorder: attendance, at },
      {
        draftId,
        kind: "discarded",
        fromPerson: operatorId,
        toPerson: operatorId,
        actorId: operatorId,
        detail: {},
      },
    );
    await captureDraft(
      tx,
      attendance,
      cfg.locationId,
      operatorId,
      draftId,
      draft!.revision + 1,
      "discard",
      at,
    );
    return { draft: null, edit: released };
  }
  const saved = await readOpenDraft(tx, cfg, partyId, draftId, offers);
  await captureDraft(
    tx,
    attendance,
    cfg.locationId,
    operatorId,
    saved.id,
    saved.revision,
    "save",
    at,
  );
  return { draft: saved, edit: await readBillEditState(tx, billId) };
}

export async function takeOverDraft(
  tx: Transaction,
  cfg: TillConfig,
  partyId: string,
  draftId: string,
  operatorId: string,
  ask: { revision: number; expectedEdit: BillEditExpected; submissionId: string },
  attendance?: AttendanceRecorder,
): Promise<BillDraftSnapshot> {
  const id = uuid(draftId, "draftId");
  const expectedEdit = parseBillEditExpected(ask.expectedEdit);
  const submissionId = uuid(ask.submissionId, "submissionId");
  if (expectedEdit.draftId !== id) throw invalid("expectedEdit.draftId");
  if (ask.revision !== expectedEdit.draftRevision) throw invalid("revision");
  return runServiceCommand(
    tx,
    { kind: "party", partyId },
    submissionId,
    "draft.take-over",
    { partyId, draftId: id, operatorId, revision: ask.revision, expectedEdit },
    async () => {
      const draft = await draftOnParty(tx, id, partyId);
      const billId = uuid(draft.billId, "billId");
      if (expectedEdit.billId !== billId) throw invalid("expectedEdit.billId");
      await requireBillOfParty(tx, partyId, billId);
      await refusePaymentInFlight(tx, [billId]);
      const edit = await transferBillEditor(tx, billId, operatorId, expectedEdit);
      if (draft.ownerId !== operatorId) {
        const at = nowIso();
        await recordDraftEvents(
          tx,
          attendance === undefined ? undefined : { recorder: attendance, at },
          {
            draftId: draft.id,
            kind: "taken_over",
            fromPerson: draft.ownerId,
            toPerson: operatorId,
            actorId: operatorId,
            detail: {},
          },
        );
        await captureDraft(
          tx,
          attendance,
          cfg.locationId,
          operatorId,
          draft.id,
          edit.draftRevision!,
          "take-over",
          at,
        );
      }
      return { draft: await readOpenDraft(tx, cfg, partyId, draft.id), edit };
    },
  );
}

export async function moveDraftsToBill(
  tx: Transaction,
  cfg: TillConfig,
  fromBillId: string,
  intoBillId: string,
  operatorId: string,
  attendance?: { recorder: AttendanceRecorder; at: string },
): Promise<void> {
  const [bill] = await tx
    .select({ partyId: workingOrders.partyId })
    .from(workingOrders)
    .where(eq(workingOrders.id, intoBillId));
  if (bill?.partyId == null) throw invalid("billId");
  const moving = await tx
    .select({ id: orderDrafts.id, ownerId: orderDrafts.ownerId })
    .from(orderDrafts)
    .where(and(eq(orderDrafts.billId, fromBillId), eq(orderDrafts.state, "open")));
  for (const draft of moving) {
    const [own] = await openDraftsOn(tx, bill.partyId, draft.ownerId, intoBillId);
    await tx
      .update(orderDrafts)
      .set({
        ...(own === undefined ? { partyId: bill.partyId } : {}),
        billId: intoBillId,
        revision: sql`${orderDrafts.revision} + 1`,
        updatedAt: nowIso(),
        ...(own === undefined ? {} : { state: "discarded" as const }),
      })
      .where(eq(orderDrafts.id, draft.id));
    if (own !== undefined)
      await addDiscardedDraft(tx, cfg, draft.id, own, draft.ownerId, operatorId, attendance);
  }
}

export async function moveBillDraftsToParty(
  tx: Transaction,
  billId: string,
  intoPartyId: string,
): Promise<void> {
  await tx
    .update(orderDrafts)
    .set({
      partyId: intoPartyId,
      revision: sql`${orderDrafts.revision} + 1`,
      updatedAt: nowIso(),
    })
    .where(and(eq(orderDrafts.billId, billId), eq(orderDrafts.state, "open")));
}

export async function moveDraftsToParty(
  tx: Transaction,
  fromPartyId: string,
  intoPartyId: string,
  expectedEdits: BillEditExpected[],
): Promise<void> {
  // Separate bills keep their outboxes; explicit bill merges resolve theirs before relocation.
  for (const expected of expectedEdits) {
    await relocateBillEditor(tx, expected.billId, expected);
    await tx
      .update(orderDrafts)
      .set({ partyId: intoPartyId })
      .where(
        and(
          eq(orderDrafts.partyId, fromPartyId),
          eq(orderDrafts.billId, expected.billId),
          eq(orderDrafts.state, "open"),
        ),
      );
  }
}

/** Finishing a table: every open draft on the party is discarded with an event, its lines kept. */
export async function discardPartyDrafts(
  tx: Transaction,
  partyId: string,
  operatorId: string,
  attendance?: { recorder: AttendanceRecorder; locationId: string },
): Promise<void> {
  const at = nowIso();
  const open = await openDraftsOn(tx, partyId);
  if (open.length === 0) return;
  const [unresolved] = await tx
    .select({ id: orderDraftRecalledLines.id })
    .from(orderDraftRecalledLines)
    .where(
      inArray(
        orderDraftRecalledLines.draftId,
        open.map((draft) => draft.id),
      ),
    )
    .limit(1);
  if (unresolved !== undefined) throw invalid("drafts");
  await discardDrafts(
    tx,
    open.map((draft) => draft.id),
  );
  await recordDraftEvents(
    tx,
    attendance === undefined ? undefined : { recorder: attendance.recorder, at },
    ...open.map((draft) => ({
      draftId: draft.id,
      kind: "discarded" as const,
      fromPerson: draft.ownerId,
      toPerson: draft.ownerId,
      actorId: operatorId,
      detail: {},
    })),
  );
  if (attendance !== undefined) {
    for (const draft of open) {
      await captureDraft(
        tx,
        attendance.recorder,
        attendance.locationId,
        operatorId,
        draft.id,
        draft.revision + 1,
        "discard",
        at,
      );
    }
  }
}

export interface DiscardDraftInput {
  expectedEdit: BillEditExpected;
  submissionId: string;
  revision: number;
  expectedRevision: number;
  reasonId?: string;
  note: string | null;
  approver?: AdjustmentArgs["approver"];
}

export async function discardDraft(
  tx: Transaction,
  cfg: TillConfig,
  partyId: string,
  draftId: string,
  operatorId: string,
  input: DiscardDraftInput,
  venueLocale: string,
  attempts?: PinAttempts,
  attendance?: OrderAttendance,
): Promise<{
  draftId: string;
  billId: string;
  revision: number;
  adjustmentIds: string[];
  party: { id: string; revision: number } | null;
}> {
  const id = uuid(draftId, "draftId");
  const expectedEdit = parseBillEditExpected(input.expectedEdit);
  if (expectedEdit.draftId !== id) throw invalid("expectedEdit.draftId");
  if (input.revision !== expectedEdit.draftRevision) throw invalid("revision");
  const { submissionId, approver, ...command } = input;
  return runServiceCommand(
    tx,
    { kind: "party", partyId },
    submissionId,
    "draft.discard",
    { ...command, expectedEdit, draftId: id, operatorId, approverId: approver?.personId },
    async () => {
      const draft = await draftOnParty(tx, id, partyId);
      const billId = uuid(draft.billId, "billId");
      if (expectedEdit.billId !== billId) throw invalid("expectedEdit.billId");
      await requireBillOfParty(tx, partyId, billId);
      await refusePaymentInFlight(tx, [billId]);
      await requireBillEditor(tx, billId, operatorId, expectedEdit);
      const revision = await readOrderRevision(tx, billId);
      if (revision !== input.expectedRevision)
        throw new AppError("working_order.out_of_date", { workingOrderId: billId, revision });
      const sources = await tx
        .select({ sourceLineId: orderDraftRecalledLines.sourceLineId })
        .from(orderDraftRecalledLines)
        .where(eq(orderDraftRecalledLines.draftId, draft.id))
        .orderBy(orderDraftRecalledLines.position);
      if (sources.length > 0 && input.reasonId === undefined) throw invalid("reasonId");
      const adjustmentIds: string[] = [];
      for (const source of sources) {
        const applied = await applyAdjustment(
          tx,
          cfg,
          {
            orderId: billId,
            expectedRevision: await readOrderRevision(tx, billId),
            submissionId: newId(),
            lineId: source.sourceLineId,
            action: "cancel",
            reasonId: input.reasonId!,
            note: input.note,
            operatorId,
            ...(approver === undefined ? {} : { approver }),
          },
          venueLocale,
          attempts,
          attendance,
        );
        adjustmentIds.push(...applied.adjustmentIds);
      }
      const at = nowIso();
      await tx.delete(orderDraftLines).where(eq(orderDraftLines.draftId, draft.id));
      await tx.delete(orderDraftRecalledLines).where(eq(orderDraftRecalledLines.draftId, draft.id));
      await closeBillDraft(
        tx,
        billId,
        operatorId,
        await readBillEditState(tx, billId),
        "discarded",
      );
      await recordDraftEvents(
        tx,
        attendance === undefined ? undefined : { recorder: attendance.recorder, at },
        {
          draftId: draft.id,
          kind: "discarded",
          fromPerson: operatorId,
          toPerson: operatorId,
          actorId: operatorId,
          detail: {},
        },
      );
      const [closed] = await tx
        .select({ revision: orderDrafts.revision })
        .from(orderDrafts)
        .where(eq(orderDrafts.id, draft.id));
      await captureDraft(
        tx,
        attendance?.recorder,
        cfg.locationId,
        operatorId,
        draft.id,
        closed!.revision,
        "discard",
        at,
      );
      return {
        draftId: draft.id,
        billId,
        revision: closed!.revision,
        adjustmentIds,
        party: await partyRevisionOfOrder(tx, billId),
      };
    },
    cfg.madeHereSink,
  );
}

export interface SubmitDraftInput extends PartyCommandArgs {
  expectedEdit: BillEditExpected;
  draftRevision: number;
  /** Lines of the draft's current revision, each named once across the groups. */
  groups: {
    lineIds: string[];
    release: GroupRelease;
    joinGroupId?: string;
    afterGroupId?: string;
  }[];
  /** As `submitGroups` takes it: add the one held group's lines to this held group. */
  joinGroupId?: string;
}

/** The groups placed, and the operator's draft as it is left: null once every line was sent. */
export type SubmittedDraft = SubmittedGroups & { draft: Draft | null; edit: BillEditState };

export async function submitDraft(
  tx: Transaction,
  cfg: OriginConfig,
  partyId: string,
  draftId: string,
  input: SubmitDraftInput,
  attendance?: AttendanceRecorder,
): Promise<SubmittedDraft> {
  const at = nowIso();
  const { operatorId } = input;
  const id = uuid(draftId, "draftId");
  const expectedEdit = parseBillEditExpected(input.expectedEdit);
  if (expectedEdit.draftId !== id) throw invalid("expectedEdit.draftId");
  if (input.draftRevision !== expectedEdit.draftRevision) throw invalid("draftRevision");
  const groups = input.groups.map(({ lineIds, release, joinGroupId, afterGroupId }) => ({
    lineIds: lineIds.map(foldIfUuid),
    release,
    ...(joinGroupId === undefined ? {} : { joinGroupId: foldIfUuid(joinGroupId) }),
    ...(afterGroupId === undefined ? {} : { afterGroupId: foldIfUuid(afterGroupId) }),
  }));
  const joinGroupId = input.joinGroupId === undefined ? undefined : foldIfUuid(input.joinGroupId);
  return runServiceCommand(
    tx,
    { kind: "party", partyId },
    input.submissionId,
    "draft.submit",
    { partyId, draftId: id, operatorId, groups, joinGroupId, expectedEdit },
    async () => {
      const draft = await draftOnParty(tx, id, partyId);
      const billId = uuid(draft.billId, "billId");
      if (expectedEdit.billId !== billId) throw invalid("expectedEdit.billId");
      await requireBillOfParty(tx, partyId, billId);
      await refusePaymentInFlight(tx, [billId]);
      const edit = await requireBillEditor(tx, billId, operatorId, expectedEdit);
      await checkAndBumpParty(tx, partyId, input.expectedPartyRevision, "open");
      const lines = (await storedLines(tx, cfg, [id])).map(({ line }) => line);
      const known = new Set(lines.map((line) => line.id));
      const named = new Set<string>();
      for (const lineId of groups.flatMap((group) => group.lineIds)) {
        if (!known.has(lineId) || named.has(lineId)) throw invalid("groups");
        named.add(lineId);
      }
      const allergy = await VENUE_SERVICE.readPartyAllergy(tx, partyId);
      const assigned = new Set(
        allergy.ticks.flatMap((tick) => (tick.draftLineId === null ? [] : [tick.draftLineId])),
      );
      const freshGroups = groups.map(({ lineIds }) => {
        const selected = new Set(lineIds);
        return normaliseDraftLines(
          lines
            .filter(isFresh)
            .filter((line) => selected.has(line.id))
            .map((line) => ({
              ...line,
              noMerge: assigned.has(line.id),
              slot: 0,
              joinGroupId: null,
              afterGroupId: null,
            })),
        );
      });
      const sources = lines.filter(isRecalled).filter((line) => named.has(line.id));
      await tx.delete(orderDraftRecalledLines).where(
        inArray(
          orderDraftRecalledLines.id,
          sources.map((line) => line.id),
        ),
      );
      const placed = await placeGroups(
        tx,
        cfg,
        partyId,
        {
          groups: groups.map(({ lineIds, release, joinGroupId, afterGroupId }, index) => {
            const inGroup = new Set(lineIds);
            return {
              release,
              joinGroupId,
              afterGroupId,
              existingLineIds: sources
                .filter((line) => inGroup.has(line.id))
                .map((line) => line.sourceLineId),
              lines: freshGroups[index]!.map(groupLine),
            };
          }),
          joinGroupId,
          operatorId,
          billId,
          sourceDraftLineIds: freshGroups.flatMap((lines) => lines.map((line) => line.id)),
          revisionMoved: true,
        },
        attendance === undefined ? undefined : { recorder: attendance, at },
      );
      const emptied = named.size === lines.length;
      await tx.delete(orderDraftLines).where(inArray(orderDraftLines.id, [...named]));
      if (emptied) await closeBillDraft(tx, billId, operatorId, edit, "submitted");
      else
        await tx
          .update(orderDrafts)
          .set({ revision: draft.revision + 1, updatedAt: nowIso() })
          .where(eq(orderDrafts.id, id));
      await recordDraftEvents(
        tx,
        attendance === undefined ? undefined : { recorder: attendance, at },
        {
          draftId: id,
          kind: "submitted",
          fromPerson: operatorId,
          toPerson: operatorId,
          actorId: operatorId,
          detail: { groupIds: placed.groups.map((group) => group.id) },
        },
      );
      await captureDraft(
        tx,
        attendance,
        cfg.locationId,
        operatorId,
        id,
        draft.revision + 1,
        "submit",
        at,
      );
      return {
        ...placed,
        draft: emptied ? null : await readOpenDraft(tx, cfg, partyId, id),
        edit: await readBillEditState(tx, billId),
      };
    },
    cfg.madeHereSink,
  );
}

async function captureDraft(
  tx: Transaction,
  recorder: AttendanceRecorder | undefined,
  locationId: string,
  personId: string,
  draftId: string,
  revision: number,
  action: "save" | "take-over" | "submit" | "discard",
  at: string,
): Promise<void> {
  await recorder?.(tx, {
    source: "draft",
    key: `${draftId}:${revision}:${action}`,
    personId,
    locationId,
    kind: "order",
    at,
    offsetMinutes: 0,
    outcome: "qualified",
  });
}

/** Each party's unsent rows by owner, in oldest-draft order. */
export async function readUnsentDrafts(
  tx: Transaction,
  partyIds: readonly string[],
): Promise<Map<string, UnsentDraft[]>> {
  const unsent = new Map<string, UnsentDraft[]>(partyIds.map((id) => [id, []]));
  if (partyIds.length === 0) return unsent;
  const rows = await tx
    .select({
      partyId: orderDrafts.partyId,
      ownerName: persons.displayName,
      lineCount: sql<number>`cast(count(distinct ${orderDraftLines.id}) + count(distinct ${orderDraftRecalledLines.id}) as int)`,
    })
    .from(orderDrafts)
    .leftJoin(orderDraftLines, eq(orderDraftLines.draftId, orderDrafts.id))
    .leftJoin(orderDraftRecalledLines, eq(orderDraftRecalledLines.draftId, orderDrafts.id))
    .leftJoin(persons, eq(persons.id, orderDrafts.ownerId))
    .where(and(inArray(orderDrafts.partyId, [...partyIds]), eq(orderDrafts.state, "open")))
    .groupBy(orderDrafts.partyId, orderDrafts.ownerId)
    .having(sql`count(${orderDraftLines.id}) + count(${orderDraftRecalledLines.id}) > 0`)
    .orderBy(sql`min(${orderDrafts.createdAt})`, sql`min(${orderDrafts.id})`);
  for (const row of rows) {
    unsent.get(row.partyId)!.push({ ownerName: row.ownerName ?? "", lineCount: row.lineCount });
  }
  return unsent;
}

const QUANTITY_PATTERN = /^(?:0|[1-9]\d{0,8})(?:\.\d{1,3})?$/;

async function validateDraftPlaces(
  tx: Transaction,
  partyId: string,
  lines: readonly DraftLineInput[],
): Promise<void> {
  const anchors = new Map<number, string | null>();
  const ids = new Set<string>();
  for (const [index, line] of lines.entries()) {
    if (line.slot > 0) {
      if (anchors.has(line.slot) && anchors.get(line.slot) !== line.afterGroupId) {
        throw invalid(`lines.${index}.slot`);
      }
      anchors.set(line.slot, line.afterGroupId);
    }
    if (line.joinGroupId !== null) ids.add(line.joinGroupId);
    if (line.afterGroupId !== null) ids.add(line.afterGroupId);
  }
  if (ids.size === 0) return;
  const rows = await tx
    .select({ id: orderGroups.id, state: orderGroups.state })
    .from(orderGroups)
    .where(and(eq(orderGroups.partyId, partyId), inArray(orderGroups.id, [...ids])));
  const states = new Map(rows.map((row) => [row.id, row.state]));
  for (const groupId of ids) {
    const state = states.get(groupId);
    if (state === undefined) throw new AppError("group.not_found", { groupId });
    if (state !== "held") throw new AppError("group.not_held", { groupId });
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** A UUID in lower case, the spelling the stored ids and the merge key compare in. */
function uuid(value: unknown, field: string): string {
  if (typeof value !== "string" || !isUuid(value)) throw invalid(field);
  return value.toLowerCase();
}

/** An id a line may leave out: absent or null is none. */
function optionalId(value: unknown, field: string): string | null {
  if (value === undefined || value === null) return null;
  return uuid(value, field);
}

/** An id that is no UUID names nothing, so it is kept as sent and then refused or not found. */
function foldIfUuid(id: string): string {
  return isUuid(id) ? id.toLowerCase() : id;
}

/** A draft line as pricing takes a basket line, with each null field left out. */
function groupLine(line: FreshDraftLine): GroupLine {
  return {
    [RETAINED_COURSE]: true,
    menuItemId: line.menuItemId,
    quantity: line.quantity,
    options: line.options,
    extras: line.extras,
    ...(line.variantId === null ? {} : { variantId: line.variantId }),
    ...(line.menuVersionId === null ? {} : { menuVersionId: line.menuVersionId }),
    ...(line.courseId === null ? {} : { courseId: line.courseId }),
    ...(line.makeAt == null ? {} : { makeAt: line.makeAt }),
    ...(line.note === null ? {} : { note: line.note }),
  };
}

/**
 * Screen every line before anything is written. A quantity is a positive decimal of at most three
 * places, so the row holds exactly what was sent.
 */
function parseDraftLines(value: unknown): DraftLineInput[] {
  if (!Array.isArray(value)) throw invalid("lines");
  return value.map((entry: unknown, index): DraftLineInput => {
    const field = (name: string) => `lines.${index}.${name}`;
    if (!isRecord(entry)) throw invalid(`lines.${index}`);
    const { quantity, note, noMerge } = entry;
    if (
      typeof quantity !== "string" ||
      !QUANTITY_PATTERN.test(quantity) ||
      stringToThousandths(quantity) === 0
    ) {
      throw invalid(field("quantity"));
    }
    if (note !== undefined && note !== null && typeof note !== "string") {
      throw invalid(field("note"));
    }
    if (noMerge !== undefined && typeof noMerge !== "boolean") throw invalid(field("noMerge"));
    const slot = entry.slot === undefined ? 0 : entry.slot;
    if (typeof slot !== "number" || !Number.isInteger(slot) || slot < 0) {
      throw invalid(field("slot"));
    }
    const joinGroupId = optionalId(entry.joinGroupId, field("joinGroupId"));
    const afterGroupId = optionalId(entry.afterGroupId, field("afterGroupId"));
    if (joinGroupId !== null && slot !== 0) throw invalid(field("slot"));
    if (afterGroupId !== null && slot === 0) throw invalid(field("afterGroupId"));
    const sourceLineId =
      entry.sourceLineId === undefined || entry.sourceLineId === null
        ? null
        : uuid(entry.sourceLineId, field("sourceLineId"));
    if (sourceLineId !== null)
      return {
        id: uuid(entry.id, field("id")),
        sourceLineId,
        quantity,
        note: screenNote(note),
        courseId: optionalId(entry.courseId, field("courseId")),
        makeAt: optionalId(entry.makeAt, field("makeAt")),
        slot,
        joinGroupId,
        afterGroupId,
        ...(entry.options === undefined ? {} : { options: readOptionSelections(entry.options) }),
        ...(entry.extras === undefined ? {} : { extras: readExtraSelections(entry.extras) }),
      };
    return {
      ...(entry.id === undefined ? {} : { id: uuid(entry.id, field("id")) }),
      sourceLineId: null,
      menuItemId: uuid(entry.menuItemId, field("menuItemId")),
      variantId: optionalId(entry.variantId, field("variantId")),
      menuVersionId: optionalId(entry.menuVersionId, field("menuVersionId")),
      options: entry.options === undefined ? [] : readOptionSelections(entry.options),
      extras: entry.extras === undefined ? [] : readExtraSelections(entry.extras),
      note: screenNote(note),
      quantity,
      courseId: optionalId(entry.courseId, field("courseId")),
      makeAt: optionalId(entry.makeAt, field("makeAt")),
      noMerge: noMerge ?? false,
      slot,
      joinGroupId,
      afterGroupId,
    };
  });
}

async function requireCourses(
  tx: Transaction,
  cfg: TillConfig,
  lines: readonly FreshDraftLineInput[],
  previous: readonly FreshDraftLine[],
): Promise<void> {
  const keyOf = (line: FreshDraftLineInput) =>
    JSON.stringify([
      foldIfUuid(line.menuItemId),
      line.variantId === null ? null : foldIfUuid(line.variantId),
      line.courseId === null ? null : foldIfUuid(line.courseId),
    ]);
  const retained = new Map<string, number>();
  for (const line of previous) {
    const key = keyOf(line);
    retained.set(key, (retained.get(key) ?? 0) + 1);
  }
  for (const line of lines) {
    if (line.courseId === null) continue;
    const key = keyOf(line);
    const count = retained.get(key) ?? 0;
    if (count > 0) {
      retained.set(key, count - 1);
      await requireCourse(tx, cfg, line.courseId);
    } else {
      await requireLiveCourse(tx, cfg, line.courseId);
    }
  }
}

async function requireDraft(tx: Transaction, draftId: string, partyId: string) {
  const draft = await draftOnParty(tx, draftId, partyId);
  if (draft.state === "discarded") throw new AppError("draft.not_found", { draftId });
  if (draft.state === "submitted") throw new AppError("draft.already_submitted", { draftId });
  return draft;
}

async function draftOnParty(tx: Transaction, draftId: string, partyId: string) {
  const [draft] = await tx
    .select({
      id: orderDrafts.id,
      partyId: orderDrafts.partyId,
      billId: orderDrafts.billId,
      ownerId: orderDrafts.ownerId,
      revision: orderDrafts.revision,
      state: orderDrafts.state,
      createdAt: orderDrafts.createdAt,
    })
    .from(orderDrafts)
    .where(eq(orderDrafts.id, draftId));
  if (draft === undefined || draft.partyId !== partyId) {
    throw new AppError("draft.not_found", { draftId });
  }
  return draft;
}

async function openDraftsOn(tx: Transaction, partyId: string, ownerId?: string, billId?: string) {
  return tx
    .select({
      id: orderDrafts.id,
      billId: orderDrafts.billId,
      ownerId: orderDrafts.ownerId,
      revision: orderDrafts.revision,
    })
    .from(orderDrafts)
    .where(
      and(
        eq(orderDrafts.partyId, partyId),
        eq(orderDrafts.state, "open"),
        ownerId === undefined ? undefined : eq(orderDrafts.ownerId, ownerId),
        billId === undefined ? undefined : eq(orderDrafts.billId, billId),
      ),
    );
}

/** Mark the drafts discarded, each with its revision moved on. */
async function discardDrafts(tx: Transaction, draftIds: readonly string[]): Promise<void> {
  if (draftIds.length === 0) return;
  await tx
    .update(orderDrafts)
    .set({ state: "discarded", revision: sql`${orderDrafts.revision} + 1`, updatedAt: nowIso() })
    .where(inArray(orderDrafts.id, [...draftIds]));
}

/**
 * Discarding `fromDraftId` into `into`, which its owner holds: the event, then `into`'s lines
 * followed by the discarded draft's, added together and numbered from one, and `into`'s revision
 * moved on. The caller has already marked `fromDraftId` discarded.
 */
async function addDiscardedDraft(
  tx: Transaction,
  cfg: TillConfig,
  fromDraftId: string,
  into: { id: string; revision: number },
  ownerId: string,
  actorId: string,
  attendance?: { recorder: AttendanceRecorder; at: string },
): Promise<void> {
  await recordDraftEvents(tx, attendance, {
    draftId: fromDraftId,
    kind: "discarded",
    fromPerson: ownerId,
    toPerson: ownerId,
    actorId,
    detail: { intoDraftId: into.id },
  });
  const stored = await storedLines(tx, cfg, [into.id, fromDraftId]);
  const combined = absorbLines(
    stored.filter(({ draftId }) => draftId === into.id).map(({ line }) => line),
    stored.filter(({ draftId }) => draftId === fromDraftId).map(({ line }) => line),
  );
  const [owner] = await tx
    .select({ partyId: orderDrafts.partyId })
    .from(orderDrafts)
    .where(eq(orderDrafts.id, into.id));
  const allergy = await VENUE_SERVICE.readPartyAllergy(tx, owner!.partyId);
  const assigned = new Set(
    allergy.ticks.flatMap((tick) => (tick.draftLineId === null ? [] : [tick.draftLineId])),
  );
  await replaceLines(
    tx,
    [into.id, fromDraftId],
    into.id,
    normaliseDraftLines(
      combined.map((line) => (assigned.has(line.id) ? { ...line, noMerge: true } : line)),
    ),
  );
  await tx
    .update(orderDrafts)
    .set({ revision: into.revision + 1, updatedAt: nowIso() })
    .where(eq(orderDrafts.id, into.id));
}

function absorbLines(receiving: readonly DraftLine[], absorbed: readonly DraftLine[]): DraftLine[] {
  const offset = receiving.reduce((maximum, line) => Math.max(maximum, line.slot), 0);
  return [
    ...receiving,
    ...absorbed.map((line) => (line.slot > 0 ? { ...line, slot: line.slot + offset } : line)),
  ];
}

type DraftEvent = typeof orderDraftEvents.$inferInsert;

async function recordDraftEvents(
  tx: Transaction,
  attendance: { recorder: AttendanceRecorder; at: string } | undefined,
  ...events: DraftEvent[]
): Promise<void> {
  const saved = await tx.insert(orderDraftEvents).values(events).returning();
  if (attendance === undefined) return;
  for (const event of saved) {
    const orders = await tx
      .selectDistinct({ locationId: workingOrders.locationId })
      .from(workingOrders)
      .innerJoin(orderDrafts, eq(orderDrafts.billId, workingOrders.id))
      .where(eq(orderDrafts.id, event.draftId));
    if (orders.length !== 1) continue;
    await attendance.recorder(tx, {
      source: "draft",
      key: `event:${event.id}`,
      personId: event.actorId,
      locationId: orders[0]!.locationId,
      kind: "order",
      at: attendance.at,
      offsetMinutes: 0,
      outcome: "qualified",
    });
  }
}

/**
 * The drafts' stored lines, in position order, each with its draft's id, and `unavailable` not yet
 * worked out.
 */
function isRecalled(line: DraftLine): line is RecalledDraftLine {
  return line.sourceLineId !== null;
}
function isFresh<T extends DraftLine | DraftLineInput>(
  line: T,
): line is T & (FreshDraftLine | FreshDraftLineInput) {
  return line.sourceLineId === null;
}

async function storedLines(
  tx: Transaction,
  cfg: TillConfig,
  draftIds: readonly string[],
): Promise<{ draftId: string; position: number; line: DraftLine }[]> {
  const rows = await tx
    .select({
      line: orderDraftLines,
      course: {
        id: kitchenCourses.id,
        name: kitchenCourses.name,
        displayOrder: kitchenCourses.displayOrder,
        heldUntilFired: kitchenCourses.heldUntilFired,
      },
    })
    .from(orderDraftLines)
    .leftJoin(kitchenCourses, eq(kitchenCourses.id, orderDraftLines.courseId))
    .where(inArray(orderDraftLines.draftId, [...draftIds]))
    .orderBy(asc(orderDraftLines.position), asc(orderDraftLines.id));
  const fresh = rows.map(
    ({ line: row, course }) =>
      ({
        draftId: row.draftId,
        position: row.position,
        line: {
          sourceLineId: null,
          source: null,
          id: row.id,
          menuItemId: row.menuItemId,
          variantId: row.variantId,
          menuVersionId: row.menuVersionId,
          options: row.options,
          extras: row.extras,
          note: row.note,
          quantity: thousandthsToDecimal(row.quantity),
          courseId: row.courseId,
          ...(course === null ? {} : { course }),
          makeAt: row.makeAtStationId,
          noMerge: row.noMerge,
          slot: row.slot,
          joinGroupId: row.joinGroupId,
          afterGroupId: row.afterGroupId,
          unavailable: false,
        },
      }) satisfies { draftId: string; position: number; line: FreshDraftLine },
  );
  const sources = await tx
    .select({
      reference: orderDraftRecalledLines,
      billId: orderDrafts.billId,
      sourceBillId: workingOrderLines.workingOrderId,
      parentLineId: workingOrderLines.parentLineId,
      course: {
        id: kitchenCourses.id,
        name: kitchenCourses.name,
        displayOrder: kitchenCourses.displayOrder,
        heldUntilFired: kitchenCourses.heldUntilFired,
      },
      makeAt: workingOrderLines.makeAtStationId,
    })
    .from(orderDraftRecalledLines)
    .innerJoin(orderDrafts, eq(orderDrafts.id, orderDraftRecalledLines.draftId))
    .innerJoin(workingOrderLines, eq(workingOrderLines.id, orderDraftRecalledLines.sourceLineId))
    .leftJoin(kitchenCourses, eq(kitchenCourses.id, workingOrderLines.courseId))
    .where(inArray(orderDraftRecalledLines.draftId, [...draftIds]));
  const recalled: { draftId: string; position: number; line: RecalledDraftLine }[] = [];
  for (const billId of new Set(sources.map((row) => row.billId))) {
    if (billId === null) throw invalid("billId");
    const bill = await readTabLines(tx, cfg, billId);
    const amounts = await tx
      .select({ id: workingOrderLines.id, total: workingOrderLines.lineTotal })
      .from(workingOrderLines)
      .where(eq(workingOrderLines.workingOrderId, billId));
    const totals = new Map(amounts.map((row) => [row.id, centsToDecimal(row.total)]));
    for (const { reference, sourceBillId, parentLineId, makeAt, course } of sources.filter(
      (row) => row.billId === billId,
    )) {
      if (sourceBillId !== billId || parentLineId !== null) throw invalid("sourceLineId");
      const line = bill.find((line) => line.id === reference.sourceLineId)!;
      const extras = bill.filter((child) => child.parentLineNo === line.lineNo);
      recalled.push({
        draftId: reference.draftId,
        position: reference.position,
        line: {
          id: reference.id,
          sourceLineId: line.id,
          source: {
            line,
            extras,
            netAmount: sumDecimals([line, ...extras].map((row) => totals.get(row.id)!)),
          },
          quantity: line.quantity,
          note: line.note,
          courseId: line.courseId,
          ...(course === null ? {} : { course }),
          makeAt,
          noMerge: true,
          unavailable: false,
          slot: reference.slot,
          joinGroupId: reference.joinGroupId,
          afterGroupId: reference.afterGroupId,
        },
      });
    }
  }
  return [...fresh, ...recalled].sort(
    (a, b) => a.position - b.position || a.line.id.localeCompare(b.line.id),
  );
}

async function replaceLines(
  tx: Transaction,
  fromDraftIds: readonly string[],
  intoDraftId: string,
  lines: readonly DraftLine[],
): Promise<void> {
  for (const [index, line] of lines.entries()) {
    if (isRecalled(line))
      await tx
        .update(orderDraftRecalledLines)
        .set({
          draftId: intoDraftId,
          position: index + 1,
          slot: line.slot,
          joinGroupId: line.joinGroupId,
          afterGroupId: line.afterGroupId,
        })
        .where(eq(orderDraftRecalledLines.id, line.id));
  }
  const fresh = lines.flatMap((line, index) =>
    isFresh(line) ? [{ line, position: index + 1 }] : [],
  );
  // Retained draft lines keep their allergy ticks, whose foreign key cascades on deletion.
  await tx.delete(orderDraftLines).where(
    and(
      inArray(orderDraftLines.draftId, [...fromDraftIds]),
      fresh.length === 0
        ? undefined
        : notInArray(
            orderDraftLines.id,
            fresh.map(({ line }) => line.id),
          ),
    ),
  );
  if (fresh.length === 0) return;
  const rows = fresh.map(({ line, position }) => ({
    id: line.id,
    draftId: intoDraftId,
    position,
    menuItemId: line.menuItemId,
    variantId: line.variantId,
    menuVersionId: line.menuVersionId,
    options: line.options,
    extras: line.extras,
    note: line.note,
    quantity: stringToThousandths(line.quantity),
    courseId: line.courseId,
    makeAtStationId: line.makeAt ?? null,
    noMerge: line.noMerge,
    slot: line.slot,
    joinGroupId: line.joinGroupId,
    afterGroupId: line.afterGroupId,
  }));
  await tx
    .insert(orderDraftLines)
    .values(rows)
    .onConflictDoUpdate({
      target: orderDraftLines.id,
      set: {
        draftId: intoDraftId,
        position: sql`excluded.position`,
        menuItemId: sql`excluded.menu_item_id`,
        variantId: sql`excluded.variant_id`,
        menuVersionId: sql`excluded.menu_version_id`,
        options: sql`excluded.options`,
        extras: sql`excluded.extras`,
        note: sql`excluded.note`,
        courseId: sql`excluded.course_id`,
        makeAtStationId: sql`excluded.make_at_station_id`,
        quantity: sql`excluded.quantity`,
        noMerge: sql`excluded.no_merge`,
        slot: sql`excluded.slot`,
        joinGroupId: sql`excluded.join_group_id`,
        afterGroupId: sql`excluded.after_group_id`,
      },
    });
}

/** One open draft of the party, which the caller knows is there. */
async function readOpenDraft(
  tx: Transaction,
  cfg: TillConfig,
  partyId: string,
  draftId: string,
  offers?: Map<string, ZoneMenuOffer>,
): Promise<Draft> {
  return (await readOpenDrafts(tx, cfg, partyId, draftId, offers))[0]!;
}

/** `known` is the offers of every line the drafts hold, when the caller has already read them. */
async function readOpenDrafts(
  tx: Transaction,
  cfg: TillConfig,
  partyId: string,
  draftId?: string,
  known?: Map<string, ZoneMenuOffer>,
): Promise<Draft[]> {
  const drafts = await tx
    .select({
      id: orderDrafts.id,
      partyId: orderDrafts.partyId,
      billId: orderDrafts.billId,
      ownerId: orderDrafts.ownerId,
      ownerName: persons.displayName,
      revision: orderDrafts.revision,
    })
    .from(orderDrafts)
    .leftJoin(persons, eq(persons.id, orderDrafts.ownerId))
    .where(
      and(
        eq(orderDrafts.partyId, partyId),
        eq(orderDrafts.state, "open"),
        draftId === undefined ? undefined : eq(orderDrafts.id, draftId),
      ),
    )
    .orderBy(asc(orderDrafts.createdAt), asc(orderDrafts.id));
  if (drafts.length === 0) return [];
  const lines = await storedLines(
    tx,
    cfg,
    drafts.map((draft) => draft.id),
  );
  const offers =
    known ??
    (await offersFor(
      tx,
      cfg,
      partyId,
      lines.flatMap(({ line }) => (isFresh(line) ? [line.menuItemId] : [])),
    ));
  const takenFrom = await takenOverFrom(
    tx,
    drafts.map((draft) => draft.id),
  );
  return drafts.map((draft) => ({
    ...draft,
    billId: uuid(draft.billId, "billId"),
    ownerName: draft.ownerName ?? "",
    takenOverFrom: takenFrom.get(draft.id) ?? null,
    lines: lines
      .filter((stored) => stored.draftId === draft.id)
      .map(({ line }) =>
        isRecalled(line)
          ? line
          : {
              ...line,
              unavailable: unavailable(line, offers.get(line.menuItemId)),
            },
      ),
  }));
}

/**
 * Each draft's owner before its latest `taken_over` event, named as the floor names an owner. The
 * latest is the last by `rowid`, not `created_at`, which a clock stepped back can put out of order:
 * SQLite gives a new row one more than the table's largest `rowid`, and this table is append-only.
 * `VACUUM` and `VACUUM INTO` kept that order when measured (node:sqlite, Node v26.7.0, 2026-09-28).
 */
async function takenOverFrom(
  tx: Transaction,
  draftIds: readonly string[],
): Promise<Map<string, { personId: string; name: string }>> {
  const rows = await tx
    .select({
      draftId: orderDraftEvents.draftId,
      personId: orderDraftEvents.fromPerson,
      name: persons.displayName,
    })
    .from(orderDraftEvents)
    .leftJoin(persons, eq(persons.id, orderDraftEvents.fromPerson))
    .where(
      and(
        inArray(orderDraftEvents.draftId, [...draftIds]),
        eq(orderDraftEvents.kind, "taken_over"),
      ),
    )
    .orderBy(sql`${orderDraftEvents}.rowid`);
  return new Map(
    rows.map((row) => [row.draftId, { personId: row.personId!, name: row.name ?? "" }] as const),
  );
}

/** The live offers for the menu items in the zone of {@link partyZone}; none when there is no zone. */
async function offersFor(
  tx: Transaction,
  cfg: TillConfig,
  partyId: string,
  menuItemIds: readonly string[],
): Promise<Map<string, ZoneMenuOffer>> {
  if (menuItemIds.length === 0) return new Map();
  const zoneId = await partyZone(tx, cfg, partyId);
  if (zoneId === null) return new Map();
  const { offers } = await VENUE_SERVICE.listZoneOffers(tx, cfg, zoneId, {
    menuItemIds: [...new Set(menuItemIds)],
    withDefault: false,
  });
  return new Map(offers.map((offer) => [offer.id, offer]));
}

/**
 * True when the line's menu item has no offer; the dish cannot be sold, or is not sold on its own;
 * its variant cannot be sold; an extras pick is not an available item of that extras list on the
 * offer; or an option answer is not an available label of that options list on the offer. Each of
 * those is refused when the line is priced. An options list the line leaves unanswered is not
 * checked.
 */
function unavailable(line: FreshDraftLine, offer: ZoneMenuOffer | undefined): boolean {
  if (offer === undefined || !offer.available || offer.ordering === "not_sold_separately")
    return true;
  if (
    line.variantId !== null &&
    !offer.variants.find((variant) => variant.id === line.variantId)?.available
  ) {
    return true;
  }
  const offered = new Set(
    offer.offeredModifiers.flatMap((list) =>
      (list.kind === "extras"
        ? list.items.filter((item) => item.available).map((item) => item.productId)
        : list.labels.filter((label) => label.available).map((label) => label.id)
      ).map((id) => JSON.stringify([list.kind, list.id, id])),
    ),
  );
  return (
    line.extras.some(({ listId, picks }) =>
      picks.some(({ productId }) => !offered.has(JSON.stringify(["extras", listId, productId]))),
    ) ||
    line.options.some(
      ({ listId, labelId }) => !offered.has(JSON.stringify(["options", listId, labelId])),
    )
  );
}
