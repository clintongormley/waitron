import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import {
  locations,
  invoiceSeries,
  sales,
  workingOrders,
  floorZones,
  tenantReceipts,
  withTransaction,
} from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { seedNode } from "@waitron/db/testing/seed.js";
import { locationId, nodeId as brandNodeId } from "@waitron/shared";
import {
  departments,
  orderServiceContexts,
  saleReceiptHeaders,
  departmentReceipts,
} from "@waitron/venue-service";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { checkedInvoiceChoiceDelivery } from "./invoice-choice-delivery.js";
import { setOrderInvoiceChoice } from "./working-order.js";

const suite = useVenueDb({
  migrations: migrationOptionsFor(manifestSets(), null),
});
async function fixture(nullHeader = false) {
  const [place] = await suite.db
    .insert(locations)
    .values({ name: randomUUID(), invoiceLocales: ["es-ES"], operationDescription: "Hospitality" })
    .returning();
  const cfg = { locationId: locationId(place!.id) };
  const nodeId = await seedNode(suite.db, cfg.locationId);
  const [primary] = await suite.db
    .insert(departments)
    .values({ locationId: cfg.locationId, name: "Dining", tradingName: "Dining" })
    .returning();
  const [fallback] = await suite.db
    .insert(departments)
    .values({
      locationId: cfg.locationId,
      name: "Default",
      tradingName: "Default",
      isDefault: true,
      active: true,
    })
    .returning();
  const [order] = await suite.db
    .insert(workingOrders)
    .values({
      nodeId,
      locationId: cfg.locationId,
      source: "readiness_test",
      orderNumber: 1,
      status: "open",
    })
    .returning();
  const [zone] = await suite.db
    .insert(floorZones)
    .values({ locationId: cfg.locationId, name: "Dining zone" })
    .returning();
  await suite.db.insert(orderServiceContexts).values({
    workingOrderId: order!.id,
    locationId: cfg.locationId,
    zoneId: zone!.id,
    departmentId: primary!.id,
    serviceMode: "prepay",
  });
  const [series] = await suite.db.insert(invoiceSeries).values({ nodeId, code: "F" }).returning();
  const [sale] = await suite.db
    .insert(sales)
    .values({
      source: "readiness_test",
      nodeId,
      seriesId: series!.id,
      invoiceNumber: 1,
      issuedAt: "2026-10-10T00:00:00Z",
      issuedOffsetMinutes: 0,
      total: 0,
      vatBreakdown: [],
      locale: "es-ES",
      invoiceLocales: ["es-ES"],
      fiscalBackend: "none",
      fiscalState: "not_applicable",
    })
    .returning();
  await suite.db.insert(saleReceiptHeaders).values({
    saleId: sale!.id,
    departmentId: nullHeader ? null : primary!.id,
    tradingName: "Saved",
    printTradingName: true,
  });
  return {
    cfg,
    nodeId: brandNodeId(nodeId),
    primary: primary!.id,
    fallback: fallback!.id,
    orderId: order!.id,
    saleId: sale!.id,
  };
}
async function authored(departmentId: string, receipt: Record<string, unknown>) {
  await suite.db
    .insert(departmentReceipts)
    .values({ departmentId, receipt })
    .onConflictDoUpdate({ target: departmentReceipts.departmentId, set: { receipt } });
}

const now = new Date("2026-10-12T00:00:00Z");
const context = { personId: "operator", emailAvailable: true, now };
function delivery(email = "dining@example.com", phone: string | undefined = "+34911234567") {
  return {
    medium: "email",
    recipient: " customer@example.com ",
    consent: {
      accepted: true,
      statementVersion: "invoice-email-v1",
      language: "es-ES",
      contactEmail: email,
      ...(phone === undefined ? {} : { contactPhone: phone }),
    },
  };
}
async function contacts(f: Awaited<ReturnType<typeof fixture>>) {
  await authored(f.primary, { email: "dining@example.com", phone: "+34911234567" });
  await authored(f.fallback, { email: "default@example.com", phone: "+34922345678" });
  await suite.db
    .insert(tenantReceipts)
    .values({ receipt: { email: "global@example.com", phone: "+34933456789" } });
}
describe("invoice-choice consent contact selection", () => {
  it.each(["order", "sale"] as const)(
    "validates consent against its %s department rather than global contact",
    async (kind) => {
      const f = await fixture();
      await contacts(f);
      const input = {
        delivery: delivery(),
        invoiceType: "F1" as const,
        locationId: f.cfg.locationId,
        context,
        source: kind === "order" ? { kind, orderId: f.orderId } : { kind, saleId: f.saleId },
      };
      expect(
        await withTransaction(suite.db, (tx) => checkedInvoiceChoiceDelivery(tx, input)),
      ).toEqual({
        medium: "email",
        recipient: "customer@example.com",
        consent: {
          statementVersion: "invoice-email-v1",
          language: "es-ES",
          recordedAt: "2026-10-12T00:00:00.000Z",
          personId: "operator",
          contactEmail: "dining@example.com",
          contactPhone: "+34911234567",
        },
      });
    },
  );
  it("rejects consent naming the global contact even when the global row still contains it", async () => {
    const f = await fixture();
    await contacts(f);
    const input = {
      delivery: delivery("global@example.com", "+34933456789"),
      invoiceType: "F1" as const,
      locationId: f.cfg.locationId,
      context,
      source: { kind: "order" as const, orderId: f.orderId },
    };
    await expect(
      withTransaction(suite.db, (tx) => checkedInvoiceChoiceDelivery(tx, input)),
    ).rejects.toMatchObject({
      code: "management.request_invalid",
      params: { field: "delivery.consent" },
    });
  });
  it("uses the local default department contact when the selected department has no email", async () => {
    const f = await fixture();
    await contacts(f);
    await authored(f.primary, {});
    const input = {
      delivery: delivery("default@example.com", "+34922345678"),
      invoiceType: "F1" as const,
      locationId: f.cfg.locationId,
      context,
      source: { kind: "order" as const, orderId: f.orderId },
    };
    expect(
      await withTransaction(suite.db, (tx) => checkedInvoiceChoiceDelivery(tx, input)),
    ).toMatchObject({
      consent: { contactEmail: "default@example.com", contactPhone: "+34922345678" },
    });
    await authored(f.fallback, {});
    await expect(
      withTransaction(suite.db, (tx) => checkedInvoiceChoiceDelivery(tx, input)),
    ).rejects.toMatchObject({
      code: "invoice_delivery.email_unavailable",
      params: {},
    });
  });
  it("stages the real order's matching consent and refuses a stale contact without changing its revision", async () => {
    const f = await fixture();
    await contacts(f);
    const request = {
      revision: 0,
      invoiceType: "F1" as const,
      recipient: {
        taxId: "B12345674",
        legalName: "Cliente SL",
        address: "Calle Mayor 2, 28013 Madrid, Madrid, España",
        countryCode: "ES",
      },
      delivery: delivery(),
    };
    await expect(
      setOrderInvoiceChoice(
        suite.db,
        { recipientNameMaxLength: 120 },
        f,
        f.orderId,
        request,
        context,
      ),
    ).resolves.toBe(1);
    const saved = await suite.db
      .select()
      .from(workingOrders)
      .where(eq(workingOrders.id, f.orderId));
    expect(saved[0]!.invoiceDelivery).toMatchObject({
      consent: { contactEmail: "dining@example.com", personId: "operator" },
    });
    await authored(f.primary, { email: "changed@example.com" });
    await expect(
      setOrderInvoiceChoice(
        suite.db,
        { recipientNameMaxLength: 120 },
        f,
        f.orderId,
        { ...request, revision: 1 },
        context,
      ),
    ).rejects.toMatchObject({
      code: "management.request_invalid",
      params: { field: "delivery.consent" },
    });
    expect(
      await suite.db.select().from(workingOrders).where(eq(workingOrders.id, f.orderId)),
    ).toEqual(saved);
  });
});
