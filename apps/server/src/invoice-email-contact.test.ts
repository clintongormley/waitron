import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { CATALOGUE_MIGRATIONS } from "@waitron/catalogue";
import {
  CORE_MIGRATIONS,
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
import { locationId } from "@waitron/shared";
import {
  VENUE_SERVICE_MIGRATIONS,
  departments,
  orderServiceContexts,
  saleReceiptHeaders,
  departmentReceipts,
} from "@waitron/venue-service";
import { resolveInvoiceEmailContact } from "./invoice-email-contact.js";

const suite = useVenueDb({
  migrations: [CORE_MIGRATIONS, CATALOGUE_MIGRATIONS, VENUE_SERVICE_MIGRATIONS],
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
      active: false,
    })
    .returning();
  const [order] = await suite.db
    .insert(workingOrders)
    .values({ nodeId, locationId: cfg.locationId, source: "readiness_test", orderNumber: 1 })
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
const read = (
  cfg: { locationId: ReturnType<typeof locationId> },
  source: Parameters<typeof resolveInvoiceEmailContact>[2],
) => withTransaction(suite.db, (tx) => resolveInvoiceEmailContact(tx, cfg, source));

describe("independent invoice email contact", () => {
  it.each(["order", "sale"] as const)(
    "reads authoritative %s department and keeps its own optional phone",
    async (kind) => {
      const f = await fixture();
      await authored(f.primary, { email: "dining@example.com", phone: "+34911234567" });
      await authored(f.fallback, { email: "fallback@example.com", phone: "+34922345678" });
      const source = kind === "order" ? { kind, orderId: f.orderId } : { kind, saleId: f.saleId };
      expect(await read(f.cfg, source)).toEqual({
        email: "dining@example.com",
        phone: "+34911234567",
      });
      await authored(f.primary, { email: "dining@example.com" });
      expect(await read(f.cfg, source)).toEqual({ email: "dining@example.com" });
    },
  );
  it.each([{}, { email: "invalid" }, { email: "valid@example.com", phone: "bad telephone" }])(
    "validates imported contact %j without mixing phone owners",
    async (receipt) => {
      const f = await fixture();
      await authored(f.primary, receipt);
      await authored(f.fallback, { email: "fallback@example.com", phone: "+34922345678" });
      expect(await read(f.cfg, { kind: "order", orderId: f.orderId })).toEqual(
        receipt.email === "valid@example.com"
          ? { email: "valid@example.com" }
          : { email: "fallback@example.com", phone: "+34922345678" },
      );
    },
  );
  it.each(["order", "sale"] as const)(
    "falls back for a missing %s context, but never reads venue contact",
    async (kind) => {
      const f = await fixture();
      await authored(f.fallback, { email: "fallback@example.com" });
      await suite.db
        .insert(tenantReceipts)
        .values({ receipt: { email: "venue@example.com", phone: "+34933456789" } });
      const source =
        kind === "order" ? { kind, orderId: randomUUID() } : { kind, saleId: randomUUID() };
      expect(await read(f.cfg, source)).toEqual({ email: "fallback@example.com" });
      await authored(f.fallback, { email: "bad", phone: "+34922345678" });
      expect(await read(f.cfg, source)).toBeNull();
      await suite.db
        .update(departments)
        .set({ isDefault: false })
        .where(eq(departments.id, f.fallback));
      expect(await read(f.cfg, source)).toBeNull();
    },
  );
  it("uses the sale's recorded department rather than its order's later context", async () => {
    const f = await fixture();
    await authored(f.primary, { email: "original@example.com" });
    await authored(f.fallback, { email: "new@example.com" });
    await suite.db
      .update(orderServiceContexts)
      .set({ departmentId: f.fallback })
      .where(eq(orderServiceContexts.workingOrderId, f.orderId));
    expect(await read(f.cfg, { kind: "sale", saleId: f.saleId })).toEqual({
      email: "original@example.com",
    });
    expect(await read(f.cfg, { kind: "order", orderId: f.orderId })).toEqual({
      email: "new@example.com",
    });
  });
  it("uses designated local fallback for null recorded department and does not borrow another location", async () => {
    const f = await fixture(true);
    const other = await fixture();
    await authored(f.primary, { email: "wrong-location@example.com" });
    await authored(f.fallback, { email: "first-default@example.com" });
    await authored(other.fallback, { email: "local-default@example.com" });
    expect(await read(f.cfg, { kind: "sale", saleId: f.saleId })).toEqual({
      email: "first-default@example.com",
    });
    expect(await read(other.cfg, { kind: "order", orderId: f.orderId })).toEqual({
      email: "local-default@example.com",
    });
    expect(await read(other.cfg, { kind: "sale", saleId: f.saleId })).toEqual({
      email: "local-default@example.com",
    });
  });
});

describe("contact imported-row boundaries", () => {
  it("drops an invalid default phone while retaining its valid email", async () => {
    const f = await fixture();
    await authored(f.primary, { phone: "+34911234567" });
    await authored(f.fallback, { email: "fallback@example.com", phone: "not a telephone" });
    expect(await read(f.cfg, { kind: "sale", saleId: f.saleId })).toEqual({
      email: "fallback@example.com",
    });
  });
  it("keeps a disabled recorded department's contact", async () => {
    const f = await fixture();
    await authored(f.primary, { email: "disabled@example.com" });
    await suite.db.update(departments).set({ active: false }).where(eq(departments.id, f.primary));
    expect(await read(f.cfg, { kind: "sale", saleId: f.saleId })).toEqual({
      email: "disabled@example.com",
    });
  });
  it("refuses a cross-location department in imported order context and uses its own default", async () => {
    const f = await fixture();
    const other = await fixture();
    await authored(other.primary, { email: "foreign@example.com" });
    await authored(f.fallback, { email: "local@example.com" });
    await suite.db
      .update(orderServiceContexts)
      .set({ departmentId: other.primary })
      .where(eq(orderServiceContexts.workingOrderId, f.orderId));
    expect(await read(f.cfg, { kind: "order", orderId: f.orderId })).toEqual({
      email: "local@example.com",
    });
  });
});
