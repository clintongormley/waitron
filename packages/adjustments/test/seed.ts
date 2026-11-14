import { readSettings, VENUE_SETTINGS } from "@waitron/db";
import { withTransaction, type Database } from "@waitron/db";
import { seedVenue, seedWorkingOrder as seedOrder } from "@waitron/db/testing/seed.js";
import { decimal } from "@waitron/shared";
import { createAdjustmentReason, type AdjustmentReasonInput } from "../src/operations.js";
import type { AdjustmentReason } from "../src/policy.js";

let orderNumber = 0;

/** An open working order at the venue (seeded on first use), opened from the dashboard; returns
 * its id. */
export async function seedWorkingOrder(db: Database): Promise<string> {
  const venue = await readSettings(db, VENUE_SETTINGS);
  if (venue.revision === 0)
    await seedVenue(db, {
      name: "Dining room",
      invoiceLocales: ["es"],
      operationDescription: "Hospitality",
    });
  orderNumber += 1;
  const order = await seedOrder(db, { source: "dashboard", deviceId: null, orderNumber });
  return order.id;
}

let reasonCount = 0;

function seed(db: Database, input: (name: string) => AdjustmentReasonInput) {
  reasonCount += 1;
  return withTransaction(db, (tx) => createAdjustmentReason(tx, input(`${reasonCount}`)));
}

/** A Comp reason offering every comp action, under a name no other reason in the run has. */
export function seedReason(db: Database): Promise<AdjustmentReason> {
  return seed(db, (n) => ({
    name: `Complaint ${n}`,
    names: { en: `Complaint ${n}` },
    kind: "comp",
    actions: ["comp", "discount_percent", "discount_amount"],
    maxPercentBp: null,
    maxAmount: decimal("30.00"),
    noteRequired: false,
  }));
}

/** A Void reason, which only cancels, under a name no other reason in the run has. */
export function seedVoidReason(db: Database): Promise<AdjustmentReason> {
  return seed(db, (n) => ({
    name: `Mistake ${n}`,
    names: { en: `Mistake ${n}` },
    kind: "void",
    actions: ["cancel"],
    maxPercentBp: null,
    maxAmount: null,
    noteRequired: false,
  }));
}
