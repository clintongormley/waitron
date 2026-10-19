import { and, eq, inArray, max } from "drizzle-orm";
import { isDeepStrictEqual } from "node:util";
import {
  orderDraftRecalledLines,
  orderDrafts,
  orderGroups,
  ticketItems,
  workingOrderLines,
  type Transaction,
} from "@waitron/db";
import {
  AppError,
  centsToDecimal,
  decimal,
  decimalToCents,
  decimalToThousandths,
  divideDecimal,
  MONEY_SCALE,
  multiplyDecimal,
  stringToThousandths,
  thousandthsToDecimal,
} from "@waitron/shared";
import { MAX_UNIT_PRECISION, assertQuantityPrecision } from "@waitron/catalogue";
import { captureKitchenActivity } from "./attendance-capture.js";
import { invalid } from "./bill-allocation.js";
import { readLineCancellations } from "./line-service-state.js";
import { dishKitchenItems } from "./dish-kitchen.js";
import { enqueueCorrectionSlips, enqueueHoldCorrections, isStarted } from "./kitchen-print.js";
import { VENUE_SERVICE } from "./modules.js";
import { appendRecalledLine, type Draft, type DraftLineInput } from "./order-drafts.js";
import { requireLiveCourse } from "./kitchen.js";
import { requireMakeAtStation } from "./dead-ends.js";
import type { PartyCommandArgs } from "./order-groups.js";
import { checkAndBumpParty, requireBillOfParty, runServiceCommand } from "./parties.js";
import type { TillConfig } from "./till-config.js";
import { assertBillInvariant, refusePaidLines } from "./bill-payments.js";
import {
  bumpRevision,
  extraQuantityFor,
  prepareRecalledModifiers,
  partyAfterEdit,
  refuseOrderOverSimplifiedLimit,
  refusePaymentInFlight,
  storedOrderTotal,
  type RecalledModifierPlan,
  type OrderAttendance,
} from "./working-order.js";
import {
  acquireBillEditor,
  parseBillEditExpected,
  readBillEditState,
  requireBillEditor,
} from "./bill-editing.js";
import type { BillEditExpected, BillEditState } from "./order-drafts.js";
import "./errors.js";

export async function saveRecalledLine(
  tx: Transaction,
  cfg: TillConfig,
  partyId: string,
  sourceLineId: string,
  input: DraftLineInput,
  operatorId: string,
  prepared?: RecalledModifierPlan,
): Promise<void> {
  const [owned] = await tx
    .select({ line: workingOrderLines })
    .from(orderDraftRecalledLines)
    .innerJoin(orderDrafts, eq(orderDrafts.id, orderDraftRecalledLines.draftId))
    .innerJoin(workingOrderLines, eq(workingOrderLines.id, orderDraftRecalledLines.sourceLineId))
    .where(
      and(
        eq(orderDraftRecalledLines.id, input.id ?? ""),
        eq(orderDraftRecalledLines.sourceLineId, sourceLineId),
        eq(orderDrafts.partyId, partyId),
        eq(orderDrafts.ownerId, operatorId),
        eq(orderDrafts.state, "open"),
        eq(orderDrafts.billId, workingOrderLines.workingOrderId),
      ),
    );
  if (
    owned === undefined ||
    input.sourceLineId !== sourceLineId ||
    owned.line.parentLineId !== null
  )
    throw invalid("sourceLineId");
  const { line } = owned;
  const quantity = stringToThousandths(input.quantity);
  if (quantity < line.quantity) throw invalid("quantity");
  const children = await tx
    .select()
    .from(workingOrderLines)
    .where(eq(workingOrderLines.parentLineId, line.id));
  const modifiers =
    prepared ??
    (
      await prepareRecalledModifiers(tx, cfg, line.workingOrderId, [
        { parent: line, children, input },
      ])
    ).get(line.id)!;
  const extrasChanged = modifiers.removed.length > 0 || modifiers.added !== null;
  const changed =
    !isDeepStrictEqual(modifiers.options, line.optionSnapshots) ||
    extrasChanged ||
    quantity !== line.quantity ||
    line.note !== input.note ||
    line.courseId !== input.courseId ||
    line.makeAtStationId !== input.makeAt;
  if (!changed) return;
  await requireBillOfParty(tx, partyId, line.workingOrderId);
  await refusePaymentInFlight(tx, [line.workingOrderId]);
  assertQuantityPrecision(input.quantity, line.unitPrecision ?? MAX_UNIT_PRECISION, {
    positive: true,
  });
  await refusePaidLines(
    tx,
    line.workingOrderId,
    [line, ...children].map((part) => ({ id: part.id, lineNo: part.lineNo, keeps: 0 })),
  );
  if (input.courseId !== null && input.courseId !== line.courseId)
    await requireLiveCourse(tx, cfg, input.courseId);
  if (input.makeAt != null && input.makeAt !== line.makeAtStationId)
    await requireMakeAtStation(tx, cfg, input.makeAt);
  const before =
    (quantity !== line.quantity || extrasChanged) && cfg.simplifiedInvoiceLimit !== null
      ? await storedOrderTotal(tx, line.workingOrderId)
      : null;
  await tx
    .update(workingOrderLines)
    .set({
      note: input.note,
      courseId: input.courseId,
      makeAtStationId: input.makeAt,
      optionSnapshots: modifiers.options,
      ...(quantity === line.quantity
        ? {}
        : {
            quantity,
            lineTotal: decimalToCents(
              divideDecimal(
                multiplyDecimal(centsToDecimal(line.unitPriceGross), decimal(input.quantity)),
                thousandthsToDecimal(line.priceQuantity),
                MONEY_SCALE,
              ),
            ),
          }),
    })
    .where(eq(workingOrderLines.id, sourceLineId));
  if (quantity !== line.quantity) {
    for (const { child, perDish } of modifiers.kept) {
      const childQuantity = extraQuantityFor(perDish, decimal(input.quantity), child.priceQuantity);
      await tx
        .update(workingOrderLines)
        .set({
          quantity: decimalToThousandths(childQuantity),
          lineTotal: decimalToCents(
            divideDecimal(
              multiplyDecimal(child.unitPriceGross, childQuantity),
              child.priceQuantity!,
              MONEY_SCALE,
            ),
          ),
        })
        .where(eq(workingOrderLines.id, child.id));
    }
  }
  if (modifiers.removed.length > 0)
    await tx.delete(workingOrderLines).where(
      inArray(
        workingOrderLines.id,
        modifiers.removed.map((child) => child.id),
      ),
    );
  if (modifiers.added !== null) {
    const [last] = await tx
      .select({ number: max(workingOrderLines.lineNo) })
      .from(workingOrderLines)
      .where(eq(workingOrderLines.workingOrderId, line.workingOrderId));
    let next = last!.number ?? 0;
    const rows = modifiers.added.lineRows.filter((row) => row.parentLineId !== null);
    await tx.insert(workingOrderLines).values(
      rows.map((row) => ({
        ...row,
        parentLineId: line.id,
        lineNo: ++next,
        groupId: line.groupId,
        creditedTo: line.creditedTo,
      })),
    );
    const ids = new Set(rows.map((row) => row.id));
    await VENUE_SERVICE.recordLineContexts(
      tx,
      cfg,
      line.workingOrderId,
      modifiers.added.lineContexts.filter((row) => ids.has(row.workingOrderLineId)),
      modifiers.added.offers,
    );
  }
  if (quantity !== line.quantity || extrasChanged) {
    await assertBillInvariant(tx, [line.workingOrderId]);
    await refuseOrderOverSimplifiedLimit(tx, cfg, line.workingOrderId, before);
  }
  await bumpRevision(tx, [line.workingOrderId]);
  await partyAfterEdit(tx, line.workingOrderId, [], operatorId);
}

export async function recallToDraft(
  tx: Transaction,
  cfg: TillConfig,
  partyId: string,
  lineId: string,
  args: PartyCommandArgs & { expectedEdit: BillEditExpected },
  attendance?: OrderAttendance,
): Promise<{ revision: number; draft: Draft; edit: BillEditState }> {
  const expectedEdit = parseBillEditExpected(args.expectedEdit);
  return runServiceCommand(
    tx,
    { kind: "party", partyId },
    args.submissionId,
    "line.recall-draft",
    { partyId, lineId, operatorId: args.operatorId, expectedEdit },
    async () => {
      const revision = await checkAndBumpParty(tx, partyId, args.expectedPartyRevision, "open");
      const [line] = await tx
        .select()
        .from(workingOrderLines)
        .where(eq(workingOrderLines.id, lineId));
      if (line === undefined) throw new AppError("group.not_found", { lineId });
      await requireBillOfParty(tx, partyId, line.workingOrderId);
      await refusePaymentInFlight(tx, [line.workingOrderId]);
      await requireBillEditor(tx, line.workingOrderId, args.operatorId, expectedEdit);
      if (line.parentLineId !== null) throw invalid("lineId");
      if (!(await VENUE_SERVICE.readEditSentLines(tx)))
        throw new AppError("ticket.already_fired", { workingOrderId: line.workingOrderId });
      const items = (await dishKitchenItems(tx, [lineId])).get(lineId) ?? [];
      const started = items.find((item) => isStarted(item.state));
      if (started !== undefined)
        throw new AppError("ticket.already_started", {
          ticketItemId: started.ticketItemId,
        });
      const cancellations = await readLineCancellations(tx, [lineId]);
      if (line.servedQuantity > 0 || (cancellations.get(lineId) ?? 0) > 0) throw invalid("lineId");
      const [reserved] = await tx
        .select({ id: orderDraftRecalledLines.id })
        .from(orderDraftRecalledLines)
        .where(eq(orderDraftRecalledLines.sourceLineId, lineId));
      if (reserved !== undefined) throw invalid("lineId");
      const [group] =
        line.groupId === null
          ? []
          : await tx
              .select()
              .from(orderGroups)
              .where(and(eq(orderGroups.id, line.groupId), eq(orderGroups.partyId, partyId)));
      if (group === undefined && line.sentAt === null && items.length === 0)
        throw new AppError("ticket.not_sent", { workingOrderId: line.workingOrderId, lineId });
      await acquireBillEditor(tx, line.workingOrderId, args.operatorId, expectedEdit);
      const fired = items
        .filter((item) => item.firedAt !== null)
        .map((item) => ({
          workingOrderLineId: item.workingOrderLineId,
          stationId: item.stationId,
          quantity: item.firedQuantity,
          wasStarted: false,
        }));
      await enqueueCorrectionSlips(tx, cfg, line.workingOrderId, fired, "RECALLED");
      if (group?.state === "held" && group.holdPrintedAt !== null)
        await enqueueHoldCorrections(
          tx,
          cfg,
          line.workingOrderId,
          items
            .filter((item) => item.firedAt === null)
            .map((item) => ({
              workingOrderLineId: item.workingOrderLineId,
              stationId: item.stationId,
              quantity: item.firedQuantity,
              wasStarted: false,
              group: group.displayNumber,
            })),
          { kind: "HOLD CANCELLED" },
        );
      if (items.length > 0)
        await tx.delete(ticketItems).where(
          inArray(
            ticketItems.id,
            items.map((item) => item.ticketItemId),
          ),
        );
      const draft = await appendRecalledLine(
        tx,
        cfg,
        partyId,
        line.workingOrderId,
        args.operatorId,
        lineId,
        group?.state === "held" ? group.id : null,
        attendance,
      );
      await bumpRevision(tx, [line.workingOrderId]);
      await captureKitchenActivity(
        tx,
        attendance,
        args.operatorId,
        [line.workingOrderId],
        args.submissionId,
      );
      return { revision, draft, edit: await readBillEditState(tx, line.workingOrderId) };
    },
  );
}
