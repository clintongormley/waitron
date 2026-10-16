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
  departmentSalePolicies,
  zoneSalePolicies,
  zoneServicePolicies,
} from "@waitron/venue-service";
import { readSaleOperationDescription } from "./sale-operation-description.js";

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
      active: true,
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
  await suite.db
    .insert(departmentSalePolicies)
    .values([{ departmentId: primary!.id }, { departmentId: fallback!.id }]);
  await suite.db.insert(zoneServicePolicies).values({
    locationId: cfg.locationId,
    zoneId: zone!.id,
    departmentId: primary!.id,
  });
  await suite.db.insert(zoneSalePolicies).values({ zoneId: zone!.id });
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
    zoneId: zone!.id,
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
  cfg: { locationId: ReturnType<typeof locationId>; operationDescriptionDefault?: string },
  source: Parameters<typeof readSaleOperationDescription>[2],
) => withTransaction(suite.db, (tx) => readSaleOperationDescription(tx, cfg, source));

describe("department operation description", () => {
  it.each(["order", "sale"] as const)(
    "reads the %s department without venue/default substitution",
    async (kind) => {
      const f = await fixture();
      await authored(f.primary, { operationDescription: "Deli meals" });
      await authored(f.fallback, { operationDescription: "Terrace drinks" });
      const source = kind === "order" ? { kind, orderId: f.orderId } : { kind, saleId: f.saleId };
      expect(await read(f.cfg, source)).toBe("Deli meals");
    },
  );
  it("fresh issuance follows the zone's current department, while corrections retain the sale's", async () => {
    const f = await fixture();
    await authored(f.primary, { operationDescription: "Deli meals" });
    await authored(f.fallback, { operationDescription: "Terrace drinks" });
    await suite.db
      .update(zoneServicePolicies)
      .set({ departmentId: f.fallback })
      .where(eq(zoneServicePolicies.zoneId, f.zoneId));
    expect(await read(f.cfg, { kind: "order", orderId: f.orderId })).toBe("Terrace drinks");
    expect(await read(f.cfg, { kind: "sale", saleId: f.saleId })).toBe("Deli meals");
  });
  it("reads a retained deleted department for a correction", async () => {
    const f = await fixture();
    await authored(f.primary, { operationDescription: "Retained meals" });
    await suite.db.update(departments).set({ active: false }).where(eq(departments.id, f.primary));
    expect(await read(f.cfg, { kind: "sale", saleId: f.saleId })).toBe("Retained meals");
  });
  it.each([undefined, "", " \t\n ", 7, ["Deli meals"], "x".repeat(501), "Bad\u0000text"])(
    "refuses missing/invalid authored description %j when no default is offered, without another department fallback",
    async (operationDescription) => {
      const f = await fixture();
      await authored(f.primary, operationDescription === undefined ? {} : { operationDescription });
      await authored(f.fallback, { operationDescription: "Fallback drinks" });
      for (const source of [
        { kind: "order", orderId: f.orderId },
        { kind: "sale", saleId: f.saleId },
      ] as const) {
        await expect(read(f.cfg, source)).rejects.toMatchObject({
          code: "department.operation_description_required",
          params: { departmentId: f.primary },
        });
      }
      await authored(f.primary, { operationDescription: "Deli meals" });
      expect(await read(f.cfg, { kind: "order", orderId: f.orderId })).toBe("Deli meals");
    },
  );
  it.each([undefined, "", " \t\n ", 7, ["Deli meals"], "x".repeat(501), "Bad\u0000text"])(
    "files the fiscal seat's default for missing/invalid authored description %j",
    async (operationDescription) => {
      const f = await fixture();
      const cfg = { ...f.cfg, operationDescriptionDefault: "Seat default" };
      await authored(f.primary, operationDescription === undefined ? {} : { operationDescription });
      await authored(f.fallback, { operationDescription: "Fallback drinks" });
      for (const source of [
        { kind: "order", orderId: f.orderId },
        { kind: "sale", saleId: f.saleId },
      ] as const) {
        expect(await read(cfg, source)).toBe("Seat default");
      }
      await authored(f.primary, { operationDescription: "Deli meals" });
      expect(await read(cfg, { kind: "order", orderId: f.orderId })).toBe("Deli meals");
      expect(await read(cfg, { kind: "sale", saleId: f.saleId })).toBe("Deli meals");
    },
  );
  it("files the default for a department with no receipt row at all, and refuses without one", async () => {
    const f = await fixture();
    expect(
      await suite.db
        .select()
        .from(departmentReceipts)
        .where(eq(departmentReceipts.departmentId, f.primary)),
    ).toEqual([]);
    const withDefault = { ...f.cfg, operationDescriptionDefault: "Seat default" };
    for (const source of [
      { kind: "order", orderId: f.orderId },
      { kind: "sale", saleId: f.saleId },
    ] as const) {
      expect(await read(withDefault, source)).toBe("Seat default");
      await expect(read(f.cfg, source)).rejects.toMatchObject({
        code: "department.operation_description_required",
        params: { departmentId: f.primary },
      });
    }
  });
  it.each(["", " \t\n "])("treats a blank default %j as no default", async (blank) => {
    const f = await fixture();
    const cfg = { ...f.cfg, operationDescriptionDefault: blank };
    for (const source of [
      { kind: "order", orderId: f.orderId },
      { kind: "sale", saleId: f.saleId },
    ] as const) {
      await expect(read(cfg, source)).rejects.toMatchObject({
        code: "department.operation_description_required",
        params: { departmentId: f.primary },
      });
    }
  });
  it.each(["order", "sale"] as const)(
    "refuses missing %s context even when the fiscal seat offers a default",
    async (kind) => {
      const f = await fixture();
      const cfg = { ...f.cfg, operationDescriptionDefault: "Seat default" };
      const source =
        kind === "order" ? { kind, orderId: randomUUID() } : { kind, saleId: randomUUID() };
      await expect(read(cfg, source)).rejects.toMatchObject({
        code: "sale.department_missing",
        params: {},
      });
    },
  );
  it("refuses a sale's null department header even when the fiscal seat offers a default", async () => {
    const f = await fixture(true);
    const cfg = { ...f.cfg, operationDescriptionDefault: "Seat default" };
    await expect(read(cfg, { kind: "sale", saleId: f.saleId })).rejects.toMatchObject({
      code: "sale.department_missing",
      params: {},
    });
  });
  it.each(["order", "sale"] as const)(
    "refuses missing %s context without a default department",
    async (kind) => {
      const f = await fixture();
      await authored(f.fallback, { operationDescription: "Fallback drinks" });
      const source =
        kind === "order" ? { kind, orderId: randomUUID() } : { kind, saleId: randomUUID() };
      await expect(read(f.cfg, source)).rejects.toEqual(
        expect.objectContaining({
          code: "sale.department_missing",
          params: {},
        }),
      );
    },
  );
  it("refuses a sale's null department header", async () => {
    const f = await fixture(true);
    await authored(f.fallback, { operationDescription: "Fallback drinks" });
    await expect(read(f.cfg, { kind: "sale", saleId: f.saleId })).rejects.toEqual(
      expect.objectContaining({
        code: "sale.department_missing",
        params: {},
      }),
    );
  });
  it.each(["order", "sale"] as const)("refuses another location's %s context", async (kind) => {
    const f = await fixture();
    const other = await fixture();
    await authored(f.primary, { operationDescription: "Deli meals" });
    await authored(other.primary, { operationDescription: "Other meals" });
    await authored(other.fallback, { operationDescription: "Other default drinks" });
    const source = kind === "order" ? { kind, orderId: f.orderId } : { kind, saleId: f.saleId };
    await expect(read(other.cfg, source)).rejects.toEqual(
      expect.objectContaining({
        code: "sale.department_missing",
        params: {},
      }),
    );
    expect(await read(f.cfg, source)).toBe("Deli meals");
  });
});
