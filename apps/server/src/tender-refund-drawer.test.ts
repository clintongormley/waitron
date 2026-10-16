import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import {
  CORE_MIGRATIONS,
  deviceProfilePrinters,
  deviceProfiles,
  devices,
  drawerOpens,
  invoiceSeries,
  locations,
  printers,
  printJobs,
  sales,
  tenderRefunds,
  tenders,
  withTransaction,
} from "@waitron/db";
import { seedDevice, seedNode, seedTenant } from "@waitron/db/testing/seed.js";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { deviceOrigin, jobOrigin, locationId } from "@waitron/shared";
import { enqueueTenderRefundDrawer } from "./receipt-print.js";
import type { DeviceRequestConfig, OriginConfig } from "./till-config.js";

const store = useVenueDb({ migrations: [CORE_MIGRATIONS] });
const PERSON = "cccccccc-0000-4000-8000-000000000001";
const AUTH = { authorizedBy: "cccccccc-0000-4000-8000-000000000002", viaOverride: true };
const AT = "2026-10-16T09:00:00.000Z";
let cfg: DeviceRequestConfig;
let profileId: string;
let saleId: string;
let tenderId: string;
let drawerId: string;
let receiptId: string;
beforeEach(async () => {
  const db = store.db;
  await seedTenant(db);
  const [place] = await db
    .insert(locations)
    .values({ name: "Returns", invoiceLocales: ["en"], operationDescription: "Meals" })
    .returning();
  const placeId = locationId(place!.id);
  const nodeId = await seedNode(db, placeId);
  const device = await seedDevice(db, {
    locationId: placeId,
    capabilities: ["take-cash", "open-cash-drawer"],
  });
  profileId = device.profileId;
  cfg = {
    nodeId,
    locationId: placeId,
    origin: deviceOrigin(device.deviceId),
    locale: "en",
    invoiceLocales: ["en"],
    tipsEnabled: true,
    simplifiedInvoiceLimit: null,
  };
  const [series] = await db
    .insert(invoiceSeries)
    .values({ nodeId, code: "TR", purpose: "standard" })
    .returning();
  const [sale] = await db
    .insert(sales)
    .values({
      source: "device",
      deviceId: device.deviceId,
      nodeId,
      seriesId: series!.id,
      invoiceNumber: 1,
      issuedAt: AT,
      issuedOffsetMinutes: 0,
      total: 1000,
      vatBreakdown: [],
      locale: "en",
      invoiceLocales: ["en"],
      fiscalBackend: "none",
      fiscalState: "not_applicable",
    })
    .returning();
  saleId = sale!.id;
  const [tender] = await db
    .insert(tenders)
    .values({ saleId, method: "cash", amount: 1000, settledAt: AT })
    .returning();
  tenderId = tender!.id;
  const choices = await db
    .insert(printers)
    .values([
      {
        locationId: placeId,
        name: "Drawer",
        transport: "cloud_poll",
        pollId: randomUUID(),
        hasCashDrawer: true,
      },
      {
        locationId: placeId,
        name: "Receipt",
        transport: "cloud_poll",
        pollId: randomUUID(),
        hasCashDrawer: true,
      },
    ])
    .returning();
  drawerId = choices[0]!.id;
  receiptId = choices[1]!.id;
  await db.insert(deviceProfilePrinters).values([
    {
      deviceProfileId: profileId,
      printerId: drawerId,
      role: "cash_drawer",
      isDefault: true,
      position: 0,
    },
    {
      deviceProfileId: profileId,
      printerId: receiptId,
      role: "receipt",
      isDefault: true,
      position: 0,
    },
  ]);
});
async function refund(patch: Partial<typeof tenderRefunds.$inferInsert> = {}) {
  const [row] = await store.db
    .insert(tenderRefunds)
    .values({
      saleId,
      tenderId,
      submissionId: randomUUID(),
      fingerprint: "drawer",
      appliedAmount: 200,
      tipAmount: 0,
      reason: "Goodwill",
      requestedBy: PERSON,
      authorizedBy: AUTH.authorizedBy,
      source: "device",
      deviceId: cfg.origin.deviceId,
      nodeId: cfg.nodeId,
      locationId: cfg.locationId,
      method: "cash",
      manual: false,
      state: "completed",
      completedAt: AT,
      ...patch,
    })
    .returning();
  return row!;
}
const enqueue = (id: string, config: OriginConfig = cfg) =>
  withTransaction(store.db, (tx) => enqueueTenderRefundDrawer(tx, config, id, PERSON, AUTH));
const audits = () => store.db.select().from(drawerOpens);
const jobs = () => store.db.select().from(printJobs);
async function empty() {
  expect(await audits()).toEqual([]);
  expect(await jobs()).toEqual([]);
}

describe("settled-tender refund audited drawer", () => {
  it("uses the drawer's profile default and records the original sale and refund", async () => {
    const row = await refund();
    await enqueue(row.id);
    expect(await audits()).toEqual([
      expect.objectContaining({
        deviceId: cfg.origin.deviceId,
        printerId: drawerId,
        personId: PERSON,
        authorizedBy: AUTH.authorizedBy,
        viaOverride: true,
        reason: "tender_refund",
        saleId,
        tenderRefundId: row.id,
        billPaymentId: null,
      }),
    ]);
    expect(await jobs()).toEqual([
      expect.objectContaining({ printerId: drawerId, kind: "drawer", saleId: null }),
    ]);
    expect([...(await jobs())[0]!.payload]).toEqual([0x1b, 0x70, 0x00, 0x19, 0xfa]);
  });
  it("uses an explicit drawer choice independently of the receipt choice", async () => {
    await store.db.insert(deviceProfilePrinters).values({
      deviceProfileId: profileId,
      printerId: receiptId,
      role: "cash_drawer",
      isDefault: false,
      position: 1,
    });
    await store.db
      .update(devices)
      .set({ cashDrawerPrinterId: receiptId, receiptPrinterId: drawerId })
      .where(eq(devices.id, cfg.origin.deviceId));
    const row = await refund();
    await enqueue(row.id);
    expect((await audits())[0]!.printerId).toBe(receiptId);
    expect((await jobs())[0]!.printerId).toBe(receiptId);
  });
  it("records an operator's own authorization", async () => {
    const row = await refund({ authorizedBy: PERSON });
    await withTransaction(store.db, (tx) =>
      enqueueTenderRefundDrawer(tx, cfg, row.id, PERSON, {
        authorizedBy: PERSON,
        viaOverride: false,
      }),
    );
    expect((await audits())[0]).toMatchObject({
      personId: PERSON,
      authorizedBy: PERSON,
      viaOverride: false,
    });
  });
  it.each(["permission", "inactive", "no-drawer", "no-choice"] as const)(
    "queues nothing with %s",
    async (why) => {
      const row = await refund();
      if (why === "permission")
        await store.db
          .update(deviceProfiles)
          .set({ capabilities: ["take-cash"] })
          .where(eq(deviceProfiles.id, profileId));
      if (why === "inactive")
        await store.db.update(printers).set({ active: false }).where(eq(printers.id, drawerId));
      if (why === "no-drawer")
        await store.db
          .update(printers)
          .set({ hasCashDrawer: false })
          .where(eq(printers.id, drawerId));
      if (why === "no-choice")
        await store.db
          .delete(deviceProfilePrinters)
          .where(eq(deviceProfilePrinters.role, "cash_drawer"));
      await enqueue(row.id);
      await empty();
    },
  );
  it.each(["pending", "failed"] as const)("does not open for a %s refund", async (state) => {
    const row = await refund({
      state,
      completedAt: null,
      failedAt: state === "failed" ? AT : null,
    });
    await enqueue(row.id);
    await empty();
  });
  it.each([false, true])("does not open for a card refund (manual %s)", async (manual) => {
    const row = await refund({
      method: "card",
      manual,
      ...(manual
        ? {}
        : {
            provider: "fake",
            providerPaymentRef: randomUUID(),
            providerRefundRef: randomUUID(),
            providerStatus: "completed",
          }),
    });
    await enqueue(row.id);
    await empty();
  });
  it("queues nothing for a missing refund", async () => {
    await enqueue(randomUUID());
    await empty();
  });
  it("does not open a second device's drawer on a replay", async () => {
    const row = await refund();
    const other = await seedDevice(store.db, { locationId: cfg.locationId, profileId });
    await enqueue(row.id, { ...cfg, origin: deviceOrigin(other.deviceId) });
    await empty();
  });
  it("does not open for a job origin", async () => {
    const row = await refund();
    await enqueue(row.id, { ...cfg, origin: jobOrigin("dashboard") });
    await empty();
  });
  it.each(["node", "location"] as const)(
    "does not enqueue under a different %s provenance",
    async (which) => {
      const row = await refund();
      const [place] = await store.db
        .insert(locations)
        .values({ name: "Elsewhere", invoiceLocales: ["en"], operationDescription: "Meals" })
        .returning();
      const placeId = locationId(place!.id);
      const node = await seedNode(store.db, placeId);
      await enqueue(
        row.id,
        which === "node" ? { ...cfg, nodeId: node } : { ...cfg, locationId: placeId },
      );
      await empty();
    },
  );
  it("queues a refund's audited kick once even across simultaneous transactions", async () => {
    const row = await refund();
    await Promise.all([enqueue(row.id), enqueue(row.id)]);
    await enqueue(row.id);
    expect(await audits()).toHaveLength(1);
    expect(await jobs()).toHaveLength(1);
  });
  it("rolls the completed refund, audit and kick back together", async () => {
    const row = await refund({ state: "pending", completedAt: null });
    await expect(
      withTransaction(store.db, async (tx) => {
        await tx
          .update(tenderRefunds)
          .set({ state: "completed", completedAt: AT })
          .where(eq(tenderRefunds.id, row.id));
        await enqueueTenderRefundDrawer(tx, cfg, row.id, PERSON, AUTH);
        throw new Error("after drawer enqueue");
      }),
    ).rejects.toThrow("after drawer enqueue");
    await empty();
    expect((await store.db.select().from(tenderRefunds))[0]!.state).toBe("pending");
  });
});
