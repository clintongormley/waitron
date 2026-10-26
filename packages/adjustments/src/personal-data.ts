import { workingOrders } from "@waitron/db";
import type { Transaction } from "@waitron/db";
import { jsonFile, type ModulePersonalData } from "@waitron/module";
import { basisPointsToDecimal, centsToDecimal, thousandthsToDecimal } from "@waitron/shared";
import { and, asc, eq, or } from "drizzle-orm";
import { ADJUSTMENT_ACTIONS } from "./policy.js";
import { adjustments } from "./schema/adjustments.js";

/** A row marked `by_guest` is the guests' request, never the requester's, as the Adjustment report
 * counts it; its approver's part still stands. `note` is left out: it is free text that can name
 * someone else. `credited_to` is not carried yet: backlog, The rest of "who did what" in the
 * download. */
export const ADJUSTMENTS_PERSONAL_DATA: ModulePersonalData = {
  files: ["adjustments.json"],

  async prepare(tx: Transaction, { personId }) {
    const requestedOwn = and(eq(adjustments.requestedBy, personId), eq(adjustments.byGuest, false));
    const rows = await tx
      .select({
        action: adjustments.action,
        createdAt: adjustments.createdAt,
        order: workingOrders.orderNumber,
        lineName: adjustments.lineName,
        quantity: adjustments.quantity,
        percentBp: adjustments.percentBp,
        reduction: adjustments.reduction,
        nominalValue: adjustments.nominalValue,
        reasonName: adjustments.reasonName,
        stage: adjustments.stage,
        chargeKept: adjustments.chargeKept,
        preparationStarted: adjustments.preparationStarted,
        requestedBy: adjustments.requestedBy,
        approvedBy: adjustments.approvedBy,
        byGuest: adjustments.byGuest,
      })
      .from(adjustments)
      .innerJoin(workingOrders, eq(workingOrders.id, adjustments.workingOrderId))
      .where(or(requestedOwn, eq(adjustments.approvedBy, personId)))
      .orderBy(asc(adjustments.createdAt), asc(adjustments.id));

    return async () => {
      if (rows.length === 0) return [];
      const counts = Object.fromEntries(ADJUSTMENT_ACTIONS.map((action) => [action, 0])) as Record<
        (typeof ADJUSTMENT_ACTIONS)[number],
        number
      >;
      const entries = rows.map((row) => {
        counts[row.action] += 1;
        const yourPart: string[] = [];
        if (row.requestedBy === personId && !row.byGuest) yourPart.push("requested");
        if (row.approvedBy === personId) yourPart.push("approved");
        return {
          action: row.action,
          at: row.createdAt,
          order: row.order,
          item: row.lineName,
          quantity: row.quantity === null ? null : thousandthsToDecimal(row.quantity),
          percent: row.percentBp === null ? null : basisPointsToDecimal(row.percentBp),
          takenOff: centsToDecimal(row.reduction),
          listValue: centsToDecimal(row.nominalValue),
          reason: row.reasonName,
          stage: row.stage,
          chargeKept: row.chargeKept,
          preparationStarted: row.preparationStarted,
          yourPart,
        };
      });
      return [jsonFile("adjustments.json", { counts, entries })];
    };
  },
};
