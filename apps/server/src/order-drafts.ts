import type { TillSaleResult } from "./till-sale.js";
import { requireEconomicWrite, type TradingAdmission } from "./trading-admission.js";
import { and, asc, eq, inArray, notInArray, sql } from "drizzle-orm";
import {
  statementChunks,
  kitchenCourses,
  newId,
  nowIso,
  orderDraftEvents,
  orderDraftLines,
  orderDrafts,
  billEditStates,
  orderGroups,
  workingOrders,
} from "@waitron/db";
import type { Transaction } from "@waitron/db";
import { readExtraSelections, readOptionSelections } from "@waitron/catalogue";
import { persons } from "@waitron/identity";
import type { AllergyPatch, ZoneMenuOffer } from "@waitron/module";
import {
  AppError,
  isUuid,
  normaliseDraftLines,
  stringToThousandths,
  thousandthsToDecimal,
} from "@waitron/shared";
import type { ExtraSelection, OptionSelection } from "@waitron/shared";
import { invalid } from "./bill-allocation.js";
import { VENUE_SERVICE } from "./modules.js";
import { placeGroups } from "./order-groups.js";
import type { GroupLine, GroupRelease, SubmittedGroups, PartyCommandArgs } from "./order-groups.js";
import type { OriginConfig, TradingContext } from "./trading-context.js";
import {
  checkAndBumpParty,
  partyZone,
  partyRevisionOfOrder,
  requireBillOfParty,
  type FamilyBill,
  requireOpenParty,
  runServiceCommand,
} from "./parties.js";
import {
  createOpenOrder,
  readOrderRevision,
  refusePaymentInFlight,
  screenNote,
  takesExtras,
} from "./working-order.js";
import type { OrderAttendance } from "./working-order.js";
import { requireMakeAtStation } from "./dead-ends.js";
import { requireCourse, requireLiveCourse } from "./kitchen.js";
import { RETAINED_COURSE } from "./retained-course.js";
import type { AttendanceRecorder } from "./attendance-capture.js";
import {
  acquireBillEditor,
  closeBillDraft,
  parseBillEditExpected,
  readBillEditState,
  relocateBillEditor,
  requireBillEditors,
  requireBillEditor,
  transferBillEditor,
} from "./bill-editing.js";
import "./errors.js";
import { orderTableLabel } from "./kitchen-print.js";
import { enqueueKitchenAllergyChanges } from "./kitchen-allergy.js";
import type { LateSendConfirmation } from "./late-send.js";
import {
  applyPartyAllergyPatch,
  assertPartyAllergyAnswered,
  normaliseAllergyPatch,
} from "./party-allergy.js";

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
export type DraftLine = FreshDraftLine;

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
  invoice?: TillSaleResult;
  draft: Draft | null;
  edit: BillEditState;
}

export interface SplitDraftResult {
  billId: string;
  revision: number;
  source: BillDraftSnapshot;
  destination: BillDraftSnapshot;
}

export async function splitDraft(
  tx: Transaction,
  cfg: OriginConfig,
  partyId: string,
  draftId: string,
  input: PartyCommandArgs & { expectedEdit: BillEditExpected; lineIds: unknown },
  attendance?: AttendanceRecorder,
): Promise<SplitDraftResult> {
  const id = uuid(draftId, "draftId");
  const expectedEdit = parseBillEditExpected(input.expectedEdit);
  if (expectedEdit.draftId !== id) throw invalid("expectedEdit.draftId");
  if (!Array.isArray(input.lineIds) || input.lineIds.length === 0) throw invalid("lineIds");
  const lineIds = input.lineIds.map((value: unknown) => uuid(value, "lineIds"));
  if (new Set(lineIds).size !== lineIds.length) throw invalid("lineIds");
  const submissionId = uuid(input.submissionId, "submissionId");
  return runServiceCommand(
    tx,
    { kind: "party", partyId },
    submissionId,
    "draft.split",
    { partyId, draftId: id, operatorId: input.operatorId, expectedEdit, lineIds },
    async () => {
      const draft = await draftOnParty(tx, id, partyId);
      const billId = uuid(draft.billId, "billId");
      if (expectedEdit.billId !== billId) throw invalid("expectedEdit.billId");
      await requireBillOfParty(tx, partyId, billId);
      await refusePaymentInFlight(tx, [billId]);
      await requireBillEditor(tx, billId, input.operatorId, expectedEdit);
      const lines = (await storedLines(tx, [id])).map(({ line }) => line);
      const selected = lines.filter((line) => lineIds.includes(line.id));
      if (selected.length !== lineIds.length) throw invalid("lineIds");
      const revision = await checkAndBumpParty(tx, partyId, input.expectedPartyRevision, "open");
      const newBillId = newId();
      await createOpenOrder(tx, cfg, newBillId, [], await orderTableLabel(tx, billId), {
        partyId,
        existingService: true,
        copyServiceContextFrom: billId,
      });
      await acquireBillEditor(tx, newBillId, input.operatorId, {
        billId: newBillId,
        editorVersion: 0,
        draftId: null,
        draftRevision: null,
      });
      const newDraftId = newId();
      await tx.insert(orderDrafts).values({
        id: newDraftId,
        partyId,
        billId: newBillId,
        ownerId: input.operatorId,
      });
      await tx
        .update(orderDraftLines)
        .set({ draftId: newDraftId })
        .where(and(eq(orderDraftLines.draftId, id), inArray(orderDraftLines.id, lineIds)));
      const empty = selected.length === lines.length;
      if (empty) await closeBillDraft(tx, billId, input.operatorId, expectedEdit, "discarded");
      else
        await tx
          .update(orderDrafts)
          .set({ revision: draft.revision + 1, updatedAt: nowIso() })
          .where(eq(orderDrafts.id, id));
      const at = nowIso();
      await recordDraftEvents(
        tx,
        attendance === undefined ? undefined : { recorder: attendance, at },
        {
          draftId: newDraftId,
          kind: "created",
          fromPerson: null,
          toPerson: input.operatorId,
          actorId: input.operatorId,
          detail: { splitFrom: id, lineIds },
        },
      );
      if (empty)
        await recordDraftEvents(
          tx,
          attendance === undefined ? undefined : { recorder: attendance, at },
          {
            draftId: id,
            kind: "discarded",
            fromPerson: draft.ownerId,
            toPerson: draft.ownerId,
            actorId: input.operatorId,
            detail: { intoDraftId: newDraftId, lineIds },
          },
        );
      await captureDraft(tx, attendance, input.operatorId, id, draft.revision + 1, "save", at);
      return {
        billId: newBillId,
        revision,
        source: {
          draft: empty ? null : await readOpenDraft(tx, cfg, partyId, id),
          edit: await readBillEditState(tx, billId),
        },
        destination: {
          draft: await readOpenDraft(tx, cfg, partyId, newDraftId),
          edit: await readBillEditState(tx, newBillId),
        },
      };
    },
  );
}

export { normaliseDraftLines };

export type FreshDraftLineInput = Omit<
  FreshDraftLine,
  "id" | "unavailable" | "course" | "source"
> & { id?: string };
export type DraftLineInput = FreshDraftLineInput;

export interface SaveDraftInput {
  expectedEdit: BillEditExpected;
  billId: unknown;
  /** Null compares an unallocated outbox on this bill. */
  draftId: string | null;
  revision: number;
  /** Screened by the save before it reads or writes anything. */
  lines: unknown;
}

/** One bill’s saved unsent dishes; `lineCount` counts rows, not units. */
export interface UnsentDraft {
  billId: string;
  /** Null when the bill was stored with no number, a fault in Waitron. */
  billNumber: number | null;
  ownerId: string;
  ownerName: string;
  savedAt: string;
  lineCount: number;
}

export async function readDrafts(
  tx: Transaction,
  _cfg: TradingContext,
  partyId: string,
): Promise<Draft[]> {
  return readOpenDrafts(tx, partyId);
}

export async function saveDraft(
  tx: Transaction,
  cfg: TradingContext,
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
  if (draft !== null) previous = (await storedLines(tx, [draft.id])).map(({ line }) => line);
  const owned = new Map(previous.map((line) => [line.id, line]));
  const named = new Set<string>();
  for (const [index, line] of lines.entries()) {
    if (line.id === undefined) continue;
    if (!owned.has(line.id) || named.has(line.id)) throw invalid(`lines.${index}.id`);
    named.add(line.id);
  }
  await validateDraftPlaces(tx, partyId, lines);
  await requireCourses(tx, lines, previous);
  const offers = await offersFor(
    tx,
    partyId,
    lines.map((line) => line.menuItemId),
  );
  for (const line of lines) {
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
  for (const line of previous) {
    if (line.makeAt == null) continue;
    const key = JSON.stringify([line.menuItemId, line.variantId, line.makeAt]);
    priorChoices.set(key, (priorChoices.get(key) ?? 0) + 1);
  }
  for (const line of lines) {
    if (line.makeAt == null) continue;
    const key = JSON.stringify([line.menuItemId, line.variantId, line.makeAt]);
    const held = priorChoices.get(key) ?? 0;
    if (held > 0) priorChoices.set(key, held - 1);
    else await requireMakeAtStation(tx, line.makeAt);
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
      lines.map((line) => ({
        ...line,
        source: null,
        id: line.id ?? newId(),
        noMerge:
          line.noMerge ||
          offers.get(line.menuItemId)?.setLunch === true ||
          (line.id !== undefined && assigned.has(line.id)),
        unavailable: false,
        measured: soldMeasured(offers.get(line.menuItemId)),
      })),
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
    await captureDraft(tx, attendance, operatorId, draftId, draft!.revision + 1, "discard", at);
    return { draft: null, edit: released };
  }
  const saved = await readOpenDraft(tx, cfg, partyId, draftId, offers);
  await captureDraft(tx, attendance, operatorId, saved.id, saved.revision, "save", at);
  return { draft: saved, edit: await readBillEditState(tx, billId) };
}

export async function takeOverDraft(
  tx: Transaction,
  cfg: TradingContext,
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
  fromBillId: string,
  intoBillId: string,
  operatorId: string,
  expectedEdits: BillEditExpected[],
  attendance?: { recorder: AttendanceRecorder; at: string },
): Promise<void> {
  const edits = await requireBillEditors(tx, [fromBillId, intoBillId], operatorId, expectedEdits);
  const from = edits.find((e) => e.billId === fromBillId)!;
  const into = edits.find((e) => e.billId === intoBillId)!;
  const [bill] = await tx
    .select({ partyId: workingOrders.partyId })
    .from(workingOrders)
    .where(eq(workingOrders.id, intoBillId));
  if (bill?.partyId == null) throw invalid("billId");
  if (from.draftId !== null) {
    if (into.draftId === null) {
      await tx
        .update(orderDrafts)
        .set({
          partyId: bill.partyId,
          billId: intoBillId,
          revision: from.draftRevision! + 1,
          updatedAt: nowIso(),
        })
        .where(eq(orderDrafts.id, from.draftId));
    } else {
      await tx
        .update(orderDrafts)
        .set({
          billId: intoBillId,
          state: "discarded",
          revision: from.draftRevision! + 1,
          updatedAt: nowIso(),
        })
        .where(eq(orderDrafts.id, from.draftId));
      await addDiscardedDraft(
        tx,
        from.draftId,
        { id: into.draftId, revision: into.draftRevision! },
        operatorId,
        operatorId,
        attendance,
      );
    }
  } else if (into.draftId !== null) {
    await tx
      .update(orderDrafts)
      .set({ revision: into.draftRevision! + 1, updatedAt: nowIso() })
      .where(eq(orderDrafts.id, into.draftId));
  }
  // A merged bill releases its editor even when its draft moves intact to the surviving bill.
  for (const edit of edits) {
    const editorId =
      edit.billId === fromBillId || (from.draftId === null && into.draftId === null)
        ? null
        : operatorId;
    await tx
      .insert(billEditStates)
      .values({ billId: edit.billId, editorId, editorVersion: edit.editorVersion + 1 })
      .onConflictDoUpdate({
        target: billEditStates.billId,
        set: { editorId, editorVersion: edit.editorVersion + 1 },
      });
  }
}

export async function moveBillDraftsToParty(
  tx: Transaction,
  billId: string,
  intoPartyId: string,
  expectedEdit: BillEditExpected,
): Promise<void> {
  await relocateBillEditor(tx, billId, expectedEdit);
  await tx
    .update(orderDrafts)
    .set({
      partyId: intoPartyId,
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

export async function discardPartyDrafts(
  tx: Transaction,
  partyId: string,
  operatorId: string,
  attendance?: { recorder: AttendanceRecorder },
): Promise<void> {
  const at = nowIso();
  const open = await openDraftsOn(tx, partyId);
  if (open.length === 0) return;
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
}

export async function discardDraft(
  tx: Transaction,
  cfg: TradingContext,
  partyId: string,
  draftId: string,
  operatorId: string,
  input: DiscardDraftInput & { admission: TradingAdmission },
  attendance?: OrderAttendance,
  complete?: (billId: string) => Promise<TillSaleResult | null>,
): Promise<{
  invoice?: TillSaleResult;
  draftId: string;
  billId: string;
  revision: number;
  adjustmentIds: string[];
  party: { id: string; revision: number } | null;
}> {
  await requireEconomicWrite(tx, cfg, input.admission);
  const id = uuid(draftId, "draftId");
  const expectedEdit = parseBillEditExpected(input.expectedEdit);
  if (expectedEdit.draftId !== id) throw invalid("expectedEdit.draftId");
  if (input.revision !== expectedEdit.draftRevision) throw invalid("revision");
  const { submissionId, admission: _, ...command } = input;
  void _;
  return runServiceCommand(
    tx,
    { kind: "party", partyId },
    submissionId,
    "draft.discard",
    { ...command, expectedEdit, draftId: id, operatorId },
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
      const at = nowIso();
      await tx.delete(orderDraftLines).where(eq(orderDraftLines.draftId, draft.id));
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
        operatorId,
        draft.id,
        closed!.revision,
        "discard",
        at,
      );
      const invoice = await complete?.(billId);
      return {
        ...(invoice == null ? {} : { invoice }),
        draftId: draft.id,
        billId,
        revision: closed!.revision,
        adjustmentIds: [],
        party: await partyRevisionOfOrder(tx, billId),
      };
    },
    cfg.madeHereSink,
  );
}

export interface SubmitDraftInput extends PartyCommandArgs {
  allergy?: AllergyPatch;
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
  lateSend?: LateSendConfirmation;
}

/** The groups placed, and the operator's draft as it is left: null once every line was sent. */
export type SubmittedDraft = SubmittedGroups & BillDraftSnapshot;

export async function submitDraft(
  tx: Transaction,
  cfg: OriginConfig,
  partyId: string,
  draftId: string,
  input: SubmitDraftInput,
  attendance?: AttendanceRecorder,
  complete?: (billId: string) => Promise<TillSaleResult | null>,
): Promise<SubmittedDraft> {
  const at = nowIso();
  const { operatorId } = input;
  const allergyPatch =
    input.allergy === undefined ? undefined : normaliseAllergyPatch(input.allergy);
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
    { partyId, draftId: id, operatorId, groups, joinGroupId, expectedEdit, allergy: allergyPatch },
    async () => {
      const draft = await draftOnParty(tx, id, partyId);
      const billId = uuid(draft.billId, "billId");
      if (expectedEdit.billId !== billId) throw invalid("expectedEdit.billId");
      await requireBillOfParty(tx, partyId, billId);
      await refusePaymentInFlight(tx, [billId]);
      const edit = await requireBillEditor(tx, billId, operatorId, expectedEdit);
      await checkAndBumpParty(tx, partyId, input.expectedPartyRevision, "open");
      const lines = (await storedLines(tx, [id])).map(({ line }) => line);
      const known = new Set(lines.map((line) => line.id));
      const named = new Set<string>();
      for (const lineId of groups.flatMap((group) => group.lineIds)) {
        if (!known.has(lineId) || named.has(lineId)) throw invalid("groups");
        named.add(lineId);
      }
      if (allergyPatch !== undefined) {
        const changes = await applyPartyAllergyPatch(
          tx,
          partyId,
          allergyPatch,
          operatorId,
          lines
            .filter((line) => named.has(line.id))
            .map((line) => ({
              ref: { kind: "draft" as const, id: line.id },
              draftLineId: line.id,
              workingLineId: null,
            })),
        );
        await enqueueKitchenAllergyChanges(tx, cfg, changes);
      }
      await assertPartyAllergyAnswered(tx, partyId);
      const allergy = await VENUE_SERVICE.readPartyAllergy(tx, partyId);
      const assigned = new Set(
        allergy.ticks.flatMap((tick) => (tick.draftLineId === null ? [] : [tick.draftLineId])),
      );
      const offers = await offersFor(
        tx,
        partyId,
        lines.map((line) => line.menuItemId),
      );
      const freshGroups = groups.map(({ lineIds }) => {
        const selected = new Set(lineIds);
        return normaliseDraftLines(
          lines

            .filter((line) => selected.has(line.id))
            .map((line) => ({
              ...line,
              noMerge: assigned.has(line.id),
              measured: soldMeasured(offers.get(line.menuItemId)),
              slot: 0,
              joinGroupId: null,
              afterGroupId: null,
            })),
        );
      });
      const placed = await placeGroups(
        tx,
        cfg,
        partyId,
        {
          groups: groups.map(({ release, joinGroupId, afterGroupId }, index) => {
            return {
              release,
              joinGroupId,
              afterGroupId,
              lines: freshGroups[index]!.map(groupLine),
            };
          }),
          joinGroupId,
          operatorId,
          billId,
          expectedEdit,
          lateSend: input.lateSend,
          sourceDraftLineIds: freshGroups.flatMap((lines) => lines.map((line) => line.id)),
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
      await captureDraft(tx, attendance, operatorId, id, draft.revision + 1, "submit", at);
      const result = {
        ...placed,
        draft: emptied ? null : await readOpenDraft(tx, cfg, partyId, id, offers),
        edit: await readBillEditState(tx, billId),
      };
      const invoice = await complete?.(result.tabId);
      return { ...result, ...(invoice == null ? {} : { invoice }) };
    },
    cfg.madeHereSink,
  );
}

async function captureDraft(
  tx: Transaction,
  recorder: AttendanceRecorder | undefined,
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
    kind: "order",
    at,
    offsetMinutes: 0,
    outcome: "qualified",
  });
}

export async function readUnsentDrafts(
  tx: Transaction,
  partyIds: readonly string[],
  billsOf: ReadonlyMap<string, readonly FamilyBill[]>,
): Promise<Map<string, UnsentDraft[]>> {
  const unsent = new Map<string, UnsentDraft[]>(partyIds.map((id) => [id, []]));
  const shown = new Map(
    partyIds.map((id) => [id, billsOf.get(id)!.filter((bill) => bill.status !== "abandoned")]),
  );
  const billIds = [
    ...new Set([...shown.values()].flatMap((bills) => bills.map((bill) => bill.workingOrderId))),
  ];
  if (billIds.length === 0) return unsent;
  const rows = await tx
    .select({
      billId: orderDrafts.billId,
      ownerId: orderDrafts.ownerId,
      ownerName: persons.displayName,
      savedAt: orderDrafts.updatedAt,
      lineCount: sql<number>`cast(count(distinct ${orderDraftLines.id}) as int)`,
    })
    .from(orderDrafts)
    .leftJoin(orderDraftLines, eq(orderDraftLines.draftId, orderDrafts.id))
    .leftJoin(persons, eq(persons.id, orderDrafts.ownerId))
    .where(and(inArray(orderDrafts.billId, billIds), eq(orderDrafts.state, "open")))
    .groupBy(orderDrafts.id)
    .having(sql`count(${orderDraftLines.id}) > 0`);
  const byBill = new Map(rows.map((row) => [row.billId, row]));
  for (const [partyId, bills] of shown) {
    // A bill with no number (a fault in Waitron) comes after the numbered ones.
    const inNumberOrder = [...bills].sort(
      (a, b) => (a.billNumber ?? Infinity) - (b.billNumber ?? Infinity),
    );
    for (const bill of inNumberOrder) {
      const draft = byBill.get(bill.workingOrderId);
      if (draft !== undefined) {
        unsent.get(partyId)!.push({
          billId: bill.workingOrderId,
          billNumber: bill.billNumber,
          ownerId: draft.ownerId,
          ownerName: draft.ownerName ?? "",
          savedAt: draft.savedAt,
          lineCount: draft.lineCount,
        });
      }
    }
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
    if (entry.sourceLineId !== undefined && entry.sourceLineId !== null)
      throw invalid(field("sourceLineId"));
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
      await requireCourse(tx, line.courseId);
    } else {
      await requireLiveCourse(tx, line.courseId);
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
 * followed by the discarded draft's, retaining row ids and numbered from one, and `into`'s revision
 * moved on. The caller has already marked `fromDraftId` discarded.
 */
async function addDiscardedDraft(
  tx: Transaction,
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
  const stored = await storedLines(tx, [into.id, fromDraftId]);
  const combined = absorbLines(
    stored.filter(({ draftId }) => draftId === into.id).map(({ line }) => line),
    stored.filter(({ draftId }) => draftId === fromDraftId).map(({ line }) => line),
  );
  await replaceLines(tx, [into.id, fromDraftId], into.id, combined);
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
    const [order] = await tx
      .select({ id: workingOrders.id })
      .from(workingOrders)
      .innerJoin(orderDrafts, eq(orderDrafts.billId, workingOrders.id))
      .where(eq(orderDrafts.id, event.draftId))
      .limit(1);
    if (order === undefined) continue;
    await attendance.recorder(tx, {
      source: "draft",
      key: `event:${event.id}`,
      personId: event.actorId,
      kind: "order",
      at: attendance.at,
      offsetMinutes: 0,
      outcome: "qualified",
    });
  }
}

async function storedLines(
  tx: Transaction,
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
  return fresh.sort((a, b) => a.position - b.position || a.line.id.localeCompare(b.line.id));
}

async function replaceLines(
  tx: Transaction,
  fromDraftIds: readonly string[],
  intoDraftId: string,
  lines: readonly DraftLine[],
): Promise<void> {
  const fresh = lines.map((line, index) => ({ line, position: index + 1 }));
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
  for (const chunk of statementChunks(orderDraftLines, rows)) {
    await tx
      .insert(orderDraftLines)
      .values(chunk)
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
}

/** One open draft of the party, which the caller knows is there. */
async function readOpenDraft(
  tx: Transaction,
  _cfg: TradingContext,
  partyId: string,
  draftId: string,
  offers?: Map<string, ZoneMenuOffer>,
): Promise<Draft> {
  return (await readOpenDrafts(tx, partyId, draftId, offers))[0]!;
}

/** `known` is the offers of every line the drafts hold, when the caller has already read them. */
async function readOpenDrafts(
  tx: Transaction,
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
    drafts.map((draft) => draft.id),
  );
  const offers =
    known ??
    (await offersFor(
      tx,
      partyId,
      lines.map(({ line }) => line.menuItemId),
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
      .map(({ line }) => ({
        ...line,
        unavailable: unavailable(line, offers.get(line.menuItemId)),
      })),
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

/** Whether `offer` sells its dish in a weight or measure; false when the dish has no offer. */
function soldMeasured(offer: ZoneMenuOffer | undefined): boolean {
  return offer !== undefined && !takesExtras(offer.unit);
}

/** The live offers for the menu items in the zone of {@link partyZone}; none when there is no zone. */
async function offersFor(
  tx: Transaction,
  partyId: string,
  menuItemIds: readonly string[],
): Promise<Map<string, ZoneMenuOffer>> {
  if (menuItemIds.length === 0) return new Map();
  const zoneId = await partyZone(tx, partyId);
  if (zoneId === null) return new Map();
  const { offers } = await VENUE_SERVICE.listZoneOffers(tx, zoneId, {
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
