import { workingOrders } from "@waitron/db";
import { jsonFile, type ModulePersonalData } from "@waitron/module";
import { asc, eq } from "drizzle-orm";
import { payments } from "./schema/payments.js";

export const PAYMENTS_PERSONAL_DATA: ModulePersonalData = {
  files: ["payment-holds.json"],

  async prepare(tx, { personId }) {
    const entries = await tx
      .select({
        order: workingOrders.orderNumber,
        decision: payments.holdOutcome,
        at: payments.holdDecidedAt,
      })
      .from(payments)
      .innerJoin(workingOrders, eq(workingOrders.id, payments.workingOrderId))
      .where(eq(payments.holdDecidedBy, personId))
      .orderBy(asc(payments.holdDecidedAt), asc(payments.id));

    return async () => (entries.length === 0 ? [] : [jsonFile("payment-holds.json", { entries })]);
  },
};
