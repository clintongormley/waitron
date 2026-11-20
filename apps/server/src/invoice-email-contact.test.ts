import { workingOrders } from "@waitron/db";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";
import { CORE_MIGRATIONS, invoiceSeries, sales, withTransaction } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import {
  seedDeviceProfiles,
  seedNode,
  seedVenue,
  seedWorkingOrder,
  seedZone,
  seedDepartmentReceipt,
} from "@waitron/db/testing/seed.js";
import { departments, setProfileServiceAccess } from "@waitron/venue-service";
import { resolveInvoiceEmailContact } from "./invoice-email-contact.js";

const suite = useVenueDb({
  migrations: [CORE_MIGRATIONS],
});
async function fixture(nullHeader = false) {
  await seedVenue(suite.db, {
    name: randomUUID(),
    invoiceLocales: ["es-ES"],
  });

  const nodeId = await seedNode(suite.db);
  const [primary] = await suite.db
    .insert(departments)
    .values({ name: "Dining", tradingName: "Dining" })
    .returning();
  const [fallback] = await suite.db
    .insert(departments)
    .values({
      name: "Default",
      tradingName: "Default",
      isDefault: true,
      active: true,
    })
    .returning();
  const order = await seedWorkingOrder(suite.db, {
    nodeId,
    source: "readiness_test",
    orderNumber: 1,
  });
  const zone = await seedZone(suite.db, { name: "Dining zone" });
  await suite.db
    .update(workingOrders)
    .set({
      zoneId: zone!.id,
      departmentId: primary!.id,
      serviceMode: "prepay",
    })
    .where(eq(workingOrders.id, order!.id));
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
      receiptDepartmentId: nullHeader ? null : primary!.id,
      receiptTradingName: "Saved",
      receiptPrintsTradingName: true,
    })
    .returning();
  return {
    primary: primary!.id,
    fallback: fallback!.id,
    orderId: order!.id,
    saleId: sale!.id,
  };
}
async function authored(departmentId: string, receipt: Record<string, unknown>) {
  await seedDepartmentReceipt(suite.db, departmentId, receipt);
}
const read = (source: Parameters<typeof resolveInvoiceEmailContact>[1]) =>
  withTransaction(suite.db, (tx) => resolveInvoiceEmailContact(tx, source));

describe("independent invoice email contact", () => {
  it.each(["order", "sale"] as const)(
    "reads authoritative %s department and keeps its own optional phone",
    async (kind) => {
      const f = await fixture();
      await authored(f.primary, { email: "dining@example.com", phone: "+34911234567" });
      await authored(f.fallback, { email: "fallback@example.com", phone: "+34922345678" });
      const source = kind === "order" ? { kind, orderId: f.orderId } : { kind, saleId: f.saleId };
      expect(await read(source)).toEqual({
        email: "dining@example.com",
        phone: "+34911234567",
      });
      await authored(f.primary, { email: "dining@example.com" });
      expect(await read(source)).toEqual({ email: "dining@example.com" });
    },
  );
  it.each([{}, { email: "invalid" }, { email: "valid@example.com", phone: "bad telephone" }])(
    "validates imported contact %j without mixing phone owners",
    async (receipt) => {
      const f = await fixture();
      await authored(f.primary, receipt);
      await authored(f.fallback, { email: "fallback@example.com", phone: "+34922345678" });
      expect(await read({ kind: "order", orderId: f.orderId })).toEqual(
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

      const source =
        kind === "order" ? { kind, orderId: randomUUID() } : { kind, saleId: randomUUID() };
      expect(await read(source)).toEqual({ email: "fallback@example.com" });
      await authored(f.fallback, { email: "bad", phone: "+34922345678" });
      expect(await read(source)).toBeNull();
      await suite.db
        .update(departments)
        .set({ isDefault: false })
        .where(eq(departments.id, f.fallback));
      expect(await read(source)).toBeNull();
    },
  );
  it("uses the sale's recorded department rather than its order's later context", async () => {
    const f = await fixture();
    await authored(f.primary, { email: "original@example.com" });
    await authored(f.fallback, { email: "new@example.com" });
    await suite.db
      .update(workingOrders)
      .set({ departmentId: f.fallback })
      .where(eq(workingOrders.id, f.orderId));
    expect(await read({ kind: "sale", saleId: f.saleId })).toEqual({
      email: "original@example.com",
    });
    expect(await read({ kind: "order", orderId: f.orderId })).toEqual({
      email: "new@example.com",
    });
  });
  it("uses designated fallback for null recorded department", async () => {
    const f = await fixture(true);
    await authored(f.primary, { email: "wrong-venue@example.com" });
    await authored(f.fallback, { email: "first-default@example.com" });
    expect(await read({ kind: "sale", saleId: f.saleId })).toEqual({
      email: "first-default@example.com",
    });
  });
});

describe("contact imported-row boundaries", () => {
  it("drops an invalid default phone while retaining its valid email", async () => {
    const f = await fixture();
    await authored(f.primary, { phone: "+34911234567" });
    await authored(f.fallback, { email: "fallback@example.com", phone: "not a telephone" });
    expect(await read({ kind: "sale", saleId: f.saleId })).toEqual({
      email: "fallback@example.com",
    });
  });
  it("keeps a disabled recorded department's contact", async () => {
    const f = await fixture();
    await authored(f.primary, { email: "disabled@example.com" });
    await suite.db.update(departments).set({ active: false }).where(eq(departments.id, f.primary));
    expect(await read({ kind: "sale", saleId: f.saleId })).toEqual({
      email: "disabled@example.com",
    });
  });
});

describe("a bill not saved yet", () => {
  /** A till profile starting in a zone of `primary`, and a zone of a third department, Bar. */
  async function newOrder(f: Awaited<ReturnType<typeof fixture>>) {
    const start = await seedZone(suite.db, { name: "Dining counter", departmentId: f.primary });
    const [bar] = await suite.db
      .insert(departments)
      .values({ name: "Bar", tradingName: "Bar" })
      .returning();
    const barZone = await seedZone(suite.db, { name: "Bar counter", departmentId: bar!.id });
    const [profile] = await seedDeviceProfiles(suite.db, { name: "Till", formFactor: "till" });
    await withTransaction(suite.db, (tx) =>
      setProfileServiceAccess(tx, profile!.id, {
        departmentId: f.primary,
        allowedZoneIds: null,
        startingZoneId: start.id,
      }),
    );
    return { bar: bar!.id, barZone: barZone.id, profileId: profile!.id };
  }

  it("reads the department of the zone it would open in: the one named, else the profile's start", async () => {
    const f = await fixture();
    const n = await newOrder(f);
    await authored(f.primary, { email: "dining@example.com" });
    await authored(n.bar, { email: "bar@example.com" });
    await authored(f.fallback, { email: "fallback@example.com" });
    expect(await read({ kind: "new-order", zoneId: undefined, profileId: n.profileId })).toEqual({
      email: "dining@example.com",
    });
    expect(await read({ kind: "new-order", zoneId: n.barZone, profileId: n.profileId })).toEqual({
      email: "bar@example.com",
    });
  });

  it("falls back to the default department, and finds none when neither has a contact or the default is deleted", async () => {
    const f = await fixture();
    const n = await newOrder(f);
    const source = { kind: "new-order", zoneId: undefined, profileId: n.profileId } as const;
    await authored(f.fallback, { email: "fallback@example.com" });
    expect(await read(source)).toEqual({ email: "fallback@example.com" });
    await suite.db.update(departments).set({ active: false }).where(eq(departments.id, f.fallback));
    expect(await read(source)).toBeNull();
    await suite.db.update(departments).set({ active: true }).where(eq(departments.id, f.fallback));
    await authored(f.fallback, {});
    expect(await read(source)).toBeNull();
  });
});

it("does not choose a deleted default when the recorded source has no contact", async () => {
  const f = await fixture();
  await authored(f.fallback, { email: "deleted-default@example.com" });
  await suite.db.update(departments).set({ active: false }).where(eq(departments.id, f.fallback));
  expect(await read({ kind: "sale", saleId: f.saleId })).toBeNull();
});

it("propagates a recorded contact storage failure instead of selecting a fallback", async () => {
  const f = await fixture();
  await authored(f.primary, { email: "recorded@example.com" });
  await authored(f.fallback, { email: "fallback@example.com" });
  const failure = new Error("Receipt storage unavailable");
  const session = (
    suite.db as unknown as { session: { prepareQuery: (...args: unknown[]) => unknown } }
  ).session;
  const original = session.prepareQuery.bind(session);
  let failed = false;
  const spy = vi.spyOn(session, "prepareQuery").mockImplementation((...args) => {
    const query = args[0] as { sql: string };
    if (!failed && query.sql.includes('left join "media_images"')) {
      failed = true;
      throw failure;
    }
    return original(...args);
  });
  try {
    await expect(read({ kind: "sale", saleId: f.saleId })).rejects.toBe(failure);
  } finally {
    spy.mockRestore();
  }
});
