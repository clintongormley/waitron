import { locations, tills, workingOrders, type Database } from "@waitron/db";
import { decimal } from "@waitron/shared";
import { createAdjustmentReason } from "../src/operations.js";
import type { AdjustmentReason } from "../src/policy.js";

let orderNumber = 0;

/** An open working order on a fresh location and till; returns its id. */
export async function seedWorkingOrder(db: Database): Promise<string> {
  const [location] = await db
    .insert(locations)
    .values({ name: "Dining room", invoiceLocales: ["es"], operationDescription: "Hospitality" })
    .returning({ id: locations.id });
  const [till] = await db
    .insert(tills)
    .values({ locationId: location!.id, name: "Till 1" })
    .returning({ id: tills.id });
  orderNumber += 1;
  const [order] = await db
    .insert(workingOrders)
    .values({ tillId: till!.id, orderNumber })
    .returning({ id: workingOrders.id });
  return order!.id;
}

let reasonCount = 0;

/** An active reason allowing every action, under a name no other reason in the run has. */
export async function seedReason(db: Database): Promise<AdjustmentReason> {
  reasonCount += 1;
  return createAdjustmentReason(db, {
    name: `Complaint ${reasonCount}`,
    names: { en: `Complaint ${reasonCount}` },
    actions: ["cancel", "comp", "discount_percent", "discount_amount"],
    maxPercentBp: 5000,
    maxAmount: decimal("30.00"),
    applyRole: "supervisor",
    approverRole: "manager",
    noteRequired: false,
  });
}
