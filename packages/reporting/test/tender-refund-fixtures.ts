import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { saleSettlements, tenderRefunds, tenders } from "@waitron/db";
import type { Database } from "@waitron/db";
import { addDecimal, decimal, stringToCents } from "@waitron/shared";
import { seedSale, seedTender } from "./fixtures.js";
import type { SeededVenue } from "./fixtures.js";

export async function seedRefundableSale(
  db: Database,
  venue: SeededVenue,
  input: {
    method: "cash" | "card";
    applied: string;
    tip: string;
    at: string;
    invoiceNumber: number;
    billPaymentId?: string;
    vatRate?: string;
    base?: string;
  },
) {
  const saleId = await seedSale(db, venue, {
    invoiceNumber: input.invoiceNumber,
    issuedAt: input.at,
    total: input.applied,
    lines: [{ vatRate: input.vatRate ?? "0.00", lineTotal: input.base ?? input.applied }],
  });
  await seedTender(
    db,
    { saleId },
    {
      method: input.method,
      amount: addDecimal(decimal(input.applied), decimal(input.tip)),
      tipAmount: input.tip,
      settledAt: input.at,
      billPaymentId: input.billPaymentId,
    },
  );
  await db.insert(saleSettlements).values({ saleId, settledAt: input.at });
  const [tender] = await db.select().from(tenders).where(eq(tenders.saleId, saleId));
  return { saleId, tenderId: tender!.id, method: input.method, venue };
}

export async function seedTenderRefund(
  db: Database,
  target: Awaited<ReturnType<typeof seedRefundableSale>>,
  input: {
    applied: string;
    tip: string;
    state: "pending" | "completed" | "failed";
    createdAt: string;
    at: string | null;
    origin?: SeededVenue;
    source?: "device" | "demo_seed";
  },
) {
  const origin = input.origin ?? target.venue;
  const [row] = await db
    .insert(tenderRefunds)
    .values({
      saleId: target.saleId,
      tenderId: target.tenderId,
      submissionId: randomUUID(),
      fingerprint: "reporting-fixture",
      reason: "Money returned after the invoice",
      requestedBy: randomUUID(),
      authorizedBy: randomUUID(),
      appliedAmount: stringToCents(input.applied),
      tipAmount: stringToCents(input.tip),
      method: target.method,
      manual: target.method === "card",
      source: input.source ?? "device",
      deviceId: input.source === "demo_seed" ? null : origin.deviceId,
      nodeId: origin.nodeId,
      locationId: origin.locationId,
      state: input.state,
      createdAt: input.createdAt,
      completedAt: input.state === "completed" ? input.at : null,
      failedAt: input.state === "failed" ? input.at : null,
    })
    .returning({ id: tenderRefunds.id });
  return row!.id;
}
