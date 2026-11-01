import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { withTransaction, billPayments, sales } from "@waitron/db";
import type { Database } from "@waitron/db";
import { createCategory, createProduct } from "@waitron/catalogue";
import { createPinThrottle, loginWithPin } from "@waitron/identity";
import { insertCapturedPayment } from "@waitron/payments";
import { decimal, deviceOrigin } from "@waitron/shared";
import { provisionBillVenue } from "./bill-venue.js";
import { offerProducts } from "./zone-offers.js";
import { createTable } from "./live-table.js";
import { openPartyTab, fireAll } from "./serve-line.js";
import { overridePinAttempts } from "../till-api.js";
import { TradingAdmission } from "../trading-admission.js";
import { readBillEditState } from "../bill-editing.js";

export async function zonePaymentVenue(db: Database) {
  const venue = await provisionBillVenue(db);
  venue.cfg = { ...venue.cfg, origin: deviceOrigin(venue.deviceId) };
  const admission = new TradingAdmission();
  admission.admit();
  let instant = "2026-10-14T23:30:00.000Z";
  const clock = {
    ...venue.clock,
    now: () => ({ ...venue.clock.now(), instant: new Date(instant), offsetMinutes: 0 }),
  };
  const prepared = await withTransaction(db, async (tx) => {
    const category = await createCategory(tx, { name: "Worker checks" });
    const product = await createProduct(tx, {
      catalogueId: tx.all<{ id: string }>(sql`select id from catalogues limit 1`)[0]!.id,
      categoryId: category.id,
      name: "Worker dish",
      customerName: { "en-GB": "Customer dish" },
      kitchenName: "Kitchen dish",
      vatClass: "general",
      pricingUnit: "each",
      unitPrice: decimal("12.10"),
    });
    const offers = await offerProducts(tx, venue.cfg, {
      zone: { zoneId: venue.zoneId },
      orderStart: "table",
      productIds: [product.id],
    });
    const session = await loginWithPin(tx, {
      deviceId: venue.deviceId,
      personId: venue.adminId,
      pin: "1234",
    });
    return { offer: offers.offerFor(product.id), session };
  });
  const operator = {
    personId: venue.adminId,
    sessionId: prepared.session.id,
    attempts: overridePinAttempts(createPinThrottle(), venue.deviceId),
  };
  const deps = {
    ...venue,
    admission,
    clock,
    provider: venue.card,
    refundProviderFor: async () => venue.card,
  };
  async function bill() {
    return withTransaction(db, async (tx) => {
      const table = await createTable(tx, venue.cfg, {
        label: `Worker ${randomUUID()}`,
        zoneId: venue.zoneId,
      });
      const party = await openPartyTab(tx, venue.cfg, {
        tableId: table.id,
        operatorId: operator.personId,
        lines: [{ menuItemId: prepared.offer, quantity: "2" }],
      });
      await fireAll(tx, venue.cfg, party.tabId);
      return party.tabId;
    });
  }
  async function request(id: string, method: "cash" | "card" = "cash", amount = "24.20") {
    return {
      submissionId: randomUUID(),
      kind: "contribution" as const,
      method,
      amount,
      applied: amount,
      tip: "0.00",
      ...(method === "cash" ? { tendered: amount } : {}),
      expectedEdit: await withTransaction(db, (tx) => readBillEditState(tx, id)),
    };
  }
  async function pending(id: string, captured = true, applied = 2420) {
    return withTransaction(db, async (tx) => {
      const [payment] = await tx
        .insert(billPayments)
        .values({
          workingOrderId: id,
          submissionId: randomUUID(),
          fingerprint: "worker-fixture",
          kind: "contribution",
          method: "card",
          applied,
          state: "pending",
          requestedBy: operator.personId,
          ...venue.cfg.origin,
        })
        .returning();
      if (captured)
        await insertCapturedPayment(tx, {
          origin: venue.cfg.origin,
          workingOrderId: id,
          provider: "fake",
          paymentRef: randomUUID(),
          amount: decimal((applied / 100).toFixed(2)),
          settledAt: new Date("2026-10-14T21:59:59.000Z"),
          billPaymentId: payment!.id,
        });
      return payment!;
    });
  }
  function snapshot() {
    return Object.fromEntries(
      [
        "bill_payments",
        "bill_payment_refunds",
        "tender_refunds",
        "payments",
        "payment_refunds",
        "payment_resolutions",
        "sales",
        "tenders",
        "sale_settlements",
        "invoice_series",
        "registros_facturacion",
        "drawer_opens",
        "print_jobs",
        "attendance_operation_facts",
      ].map((name) => [name, db.all(sql`select * from ${sql.identifier(name)} order by rowid`)]),
    );
  }
  async function facts(id: string) {
    return db
      .select({ instant: sales.issuedAt, offset: sales.issuedOffsetMinutes })
      .from(sales)
      .where(eq(sales.workingOrderId, id));
  }
  return {
    ...venue,
    deps,
    operator,
    bill,
    request,
    pending,
    snapshot,
    facts,
    set: (value: string) => {
      instant = value;
    },
  };
}
