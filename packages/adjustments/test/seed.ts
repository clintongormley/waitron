import { locations, withTransaction, workingOrders, type Database } from "@waitron/db";
import { decimal } from "@waitron/shared";
import { createAdjustmentReason, type AdjustmentReasonInput } from "../src/operations.js";
import type { AdjustmentReason } from "../src/policy.js";

let orderNumber = 0;

/** An open working order on a fresh location, opened from the dashboard; returns its id. */
export async function seedWorkingOrder(db: Database): Promise<string> {
  const [location] = await db
    .insert(locations)
    .values({ name: "Dining room", invoiceLocales: ["es"], operationDescription: "Hospitality" })
    .returning({ id: locations.id });
  orderNumber += 1;
  const [order] = await db
    .insert(workingOrders)
    .values({ source: "dashboard", deviceId: null, locationId: location!.id, orderNumber })
    .returning({ id: workingOrders.id });
  return order!.id;
}

let reasonCount = 0;

function seed(db: Database, input: (name: string) => AdjustmentReasonInput) {
  reasonCount += 1;
  return withTransaction(db, (tx) => createAdjustmentReason(tx, input(`${reasonCount}`)));
}

/** An active Comp reason offering every comp action, under a name no other reason in the run has. */
export function seedReason(db: Database): Promise<AdjustmentReason> {
  return seed(db, (n) => ({
    name: `Complaint ${n}`,
    names: { en: `Complaint ${n}` },
    kind: "comp",
    actions: ["comp", "discount_percent", "discount_amount"],
    maxPercentBp: null,
    maxAmount: decimal("30.00"),
    applyRoles: ["supervisor", "manager", "admin"],
    approverRoles: ["manager", "admin"],
    noteRequired: false,
  }));
}

/** An active Void reason, which only cancels, under a name no other reason in the run has. */
export function seedVoidReason(db: Database): Promise<AdjustmentReason> {
  return seed(db, (n) => ({
    name: `Mistake ${n}`,
    names: { en: `Mistake ${n}` },
    kind: "void",
    actions: ["cancel"],
    maxPercentBp: null,
    maxAmount: null,
    applyRoles: [],
    approverRoles: [],
    noteRequired: false,
  }));
}
