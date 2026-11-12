import { randomUUID } from "node:crypto";
import { claimInvoiceDelivery, reserveInvoiceDelivery } from "./invoice-delivery.js";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  deviceProfiles,
  devices,
  deviceProfilePrinters,
  invoiceSeries,
  sales,
  pagePrinters,
  printerHolders,
  printers,
  withTransaction,
  deviceInvoiceRevisions,
  tenants,
  products,
  floorZones,
} from "@waitron/db";
import { persons, sessions, startManagementSession } from "@waitron/identity";
import { emptyPrinterLists, setProfilePrinterLists } from "@waitron/layouts";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { seedDevice } from "@waitron/db/testing/seed.js";
import { setProfileServiceScope } from "@waitron/venue-service";
import { recordSale } from "@waitron/core";
import {
  billlessSale,
  provisionOrderVenue,
  placedIssuedBill,
  collect,
  type OrderVenue,
} from "./testing/order-venue.js";
import {
  authorizeDocumentDelivery,
  readDocumentOffers,
  type DeliveryAuthority,
  type RoutingDeps,
} from "./document-printer-offers.js";
import { requireSession } from "./till-session.js";
import { Hono } from "hono";

const suite = useVenueDb({ migrations: migrationOptionsFor(manifestSets(), null) });
let venue: OrderVenue;
let deps: RoutingDeps;
let till: Extract<DeliveryAuthority, { surface: "till" }>;
let dashboard: DeliveryAuthority;
let saleId: string;
let office: string;
let terrace: string;
const frozen = new Date("2026-11-04T12:00:00.000Z");

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(frozen);
  venue = await provisionOrderVenue(suite.db);
  await suite.db.update(tenants).set({ taxpayerDomicile: "Saved domicile" });
  deps = {
    backend: venue.backend,
    cfg: { ...venue.cfg, locale: "en" },
    emailAvailable: true,
    originSource: {
      current: () => ({
        applianceId: venue.cfg.nodeId,
        nodeId: venue.cfg.nodeId,
        recoveryEpoch: "aaaaaaaa-bbbb-cccc-dddd-000000000001",
      }),
    },
  };
  dashboard = {
    surface: "dashboard",
    managementSessionId: venue.adminDashboard.split("=")[1]!,
    deviceProof: null,
  };
  const app = new Hono();
  app.get("/session", async (c) => {
    const session = await requireSession({ db: suite.db }, c);
    till = {
      surface: "till",
      sessionId: session.sessionId,
      deviceProof: { device: session.device, tokenHash: null },
    };
    return c.body(null, 200);
  });
  expect((await app.request("/session", { headers: { cookie: venue.cookie } })).status).toBe(200);
  await suite.db
    .update(deviceProfiles)
    .set({ capabilities: [...till.deviceProof.device.capabilities, "print-receipt"] })
    .where(eq(deviceProfiles.id, till.deviceProof.device.deviceProfileId));
  const [page] = await suite.db
    .insert(pagePrinters)
    .values({
      name: "Office",
      host: "10.0.0.9",
      port: 631,
      resourcePath: "/print",
      documentFormat: "application/pdf",
      supportedFormats: ["application/pdf"],
      media: "iso_a4_210x297mm",
      resolutionDpi: 300,
    })
    .returning();
  office = page!.id;
  const [portable] = await suite.db
    .insert(printers)
    .values({
      name: "Terrace",
      transport: "network_tcp",
      host: "10.0.0.8",
      portable: true,
    })
    .returning();
  terrace = portable!.id;
  await withTransaction(suite.db, (tx) =>
    setProfilePrinterLists(tx, till.deviceProof.device.deviceProfileId, {
      ...emptyPrinterLists(),
      receiptPrinterIds: [terrace],
      invoicePrinterIds: [office, terrace],
      invoicePrinterDefaultId: office,
    }),
  );
  saleId = await billlessSale(venue);
});
afterEach(() => vi.useRealTimers());
const offers = (
  authority: DeliveryAuthority = dashboard,
  document: "receipt" | "invoice" = "receipt",
  id = saleId,
) => withTransaction(suite.db, (tx) => readDocumentOffers(tx, deps, authority, id, document));

it("offers follow recorded sale and role", async () => {
  const result = await offers(till);
  expect(result).toMatchObject({
    saleId,
    invoiceType: "F2",
    documents: ["receipt"],
    designation: "duplicate",
    context: {
      surface: "till",
      deviceId: venue.deviceId,
      profileId: till.deviceProof.device.deviceProfileId,
    },
    printers: [],
    chosenPrinterId: null,
  });
  expect(result.language).toBe(venue.cfg.locale);
  expect(result.origin).toEqual(deps.originSource.current());
  expect(result.actions.email).toBe(false);
  await suite.db.insert(printerHolders).values({ printerId: terrace, deviceId: venue.deviceId });
  expect((await offers(till)).printers).toEqual([
    { id: terrace, name: "Terrace", kind: "receipt" },
  ]);
});

it("device Invoice uses mixed paper and eligible choice before the default", async () => {
  const id = await fullSale();
  const first = await offers(till, "invoice", id);
  expect(first.printers).toEqual([
    { id: office, name: "Office", kind: "a4" },
    { id: terrace, name: "Terrace", kind: "receipt" },
  ]);
  expect(first).toMatchObject({
    chosenPrinterId: null,
    defaultPrinterId: office,
    invoiceRevision: 0,
    documents: ["receipt", "invoice"],
    languages: [venue.cfg.locale],
    language: venue.cfg.locale,
  });
  await suite.db
    .update(devices)
    .set({ invoicePrinterId: terrace })
    .where(eq(devices.id, venue.deviceId));
  await suite.db.insert(deviceInvoiceRevisions).values({ deviceId: venue.deviceId, revision: 7 });
  expect(await offers(till, "invoice", id)).toMatchObject({
    chosenPrinterId: terrace,
    defaultPrinterId: office,
    invoiceRevision: 7,
  });
  await suite.db.update(printers).set({ active: false }).where(eq(printers.id, terrace));
  expect(await offers(till, "invoice", id)).toMatchObject({
    chosenPrinterId: null,
    defaultPrinterId: office,
  });
});

it("a sole Invoice offer without choice or default still requires a deliberate choice", async () => {
  await suite.db
    .delete(deviceProfilePrinters)
    .where(eq(deviceProfilePrinters.deviceProfileId, till.deviceProof.device.deviceProfileId));
  await suite.db.insert(deviceProfilePrinters).values({
    deviceProfileId: till.deviceProof.device.deviceProfileId,
    pagePrinterId: office,
    role: "invoice",
    position: 0,
  });
  expect(await offers(till, "invoice", await fullSale())).toMatchObject({
    printers: [{ id: office }],
    chosenPrinterId: null,
    defaultPrinterId: null,
  });
});

it("device-free dashboard offers all active venue printers for both documents", async () => {
  const id = await fullSale();
  const expected = (
    await suite.db
      .select({ id: printers.id, name: printers.name })
      .from(printers)
      .where(eq(printers.active, true))
  ).map((row) => ({ ...row, kind: "receipt" }));
  expected.push({ id: office, name: "Office", kind: "a4" });
  expected.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : a.id < b.id ? -1 : 1));
  for (const document of ["receipt", "invoice"] as const) {
    const result = await offers(dashboard, document, id);
    expect(result.printers).toEqual(expected);
    expect(result).toMatchObject({
      chosenPrinterId: null,
      defaultPrinterId: null,
      invoiceRevision: null,
      context: { surface: "dashboard", deviceId: null, profileId: null },
    });
  }
  const remembered = await suite.db.select().from(printerHolders);
  await suite.db.update(printers).set({ active: false }).where(eq(printers.id, terrace));
  expect((await offers(dashboard)).printers.map((p) => p.id)).not.toContain(terrace);
  expect(await suite.db.select().from(printerHolders)).toEqual(remembered);
});

it("accompanying device still restricts management delivery", async () => {
  const accompanied: DeliveryAuthority = {
    ...dashboard,
    surface: "dashboard",
    managementSessionId: venue.adminDashboard.split("=")[1]!,
    deviceProof: till.deviceProof,
  };
  expect((await offers(accompanied)).printers).toEqual([]);
  await suite.db.insert(printerHolders).values({ printerId: terrace, deviceId: venue.device2Id });
  expect((await offers(accompanied)).printers).toEqual([]);
  expect(
    (await offers(accompanied, "invoice", await fullSale())).printers.map((p) => p.id),
  ).toContain(terrace);
  await suite.db
    .update(deviceProfiles)
    .set({ capabilities: [] })
    .where(eq(deviceProfiles.id, till.deviceProof.device.deviceProfileId));
  await expect(offers(accompanied)).rejects.toMatchObject({ code: "device.forbidden_action" });
  expect(
    (await suite.db.select().from(printerHolders)).find((row) => row.printerId === terrace)
      ?.deviceId,
  ).toBe(venue.device2Id);
});

it("two same-venue profiles have independent printer lists", async () => {
  const other = await seedDevice(suite.db, { label: "Back till", capabilities: ["print-receipt"] });
  await suite.db.insert(deviceProfilePrinters).values({
    deviceProfileId: other.profileId,
    printerId: venue.printerId,
    role: "receipt",
    position: 0,
  });
  const accompanied: DeliveryAuthority = {
    surface: "dashboard",
    managementSessionId: venue.adminDashboard.split("=")[1]!,
    deviceProof: {
      tokenHash: null,
      device: {
        deviceId: other.deviceId,
        deviceProfileId: other.profileId,
        label: "Back till",
        formFactor: "till",
        capabilities: ["print-receipt"],
      },
    },
  };
  expect((await offers(accompanied)).printers).toEqual([
    {
      id: venue.printerId,
      name: (await suite.db.select().from(printers).where(eq(printers.id, venue.printerId)))[0]!
        .name,
      kind: "receipt",
    },
  ]);
  expect((await offers(till)).printers).toEqual([]);
});

it("offers do not expose inaccessible history", async () => {
  const staff: DeliveryAuthority = {
    surface: "dashboard",
    managementSessionId: venue.staffDashboard.split("=")[1]!,
    deviceProof: null,
  };
  await expect(offers(staff)).rejects.toMatchObject({ code: "working_order.not_found" });
  expect((await offers(till)).saleId).toBe(saleId);
  expect((await offers(dashboard)).saleId).toBe(saleId);
});

it.each(["ended", "suspended", "wrong-device", "disabled", "rotated-token"])(
  "authority is checked again after offers: %s",
  async (fault) => {
    await offers(till);
    if (fault === "ended")
      await suite.db
        .update(sessions)
        .set({ endedAt: frozen.toISOString() })
        .where(eq(sessions.id, till.sessionId));
    if (fault === "suspended")
      await suite.db
        .update(persons)
        .set({ status: "suspended" })
        .where(eq(persons.id, venue.operatorId));
    if (fault === "wrong-device")
      till = {
        ...till,
        deviceProof: {
          ...till.deviceProof,
          device: { ...till.deviceProof.device, deviceId: venue.device2Id },
        },
      };
    if (fault === "disabled")
      await suite.db.update(devices).set({ active: false }).where(eq(devices.id, venue.deviceId));
    if (fault === "rotated-token")
      till = { ...till, deviceProof: { ...till.deviceProof, tokenHash: "not-the-current-hash" } };
    await expect(
      withTransaction(suite.db, (tx) => authorizeDocumentDelivery(tx, deps, till, saleId)),
    ).rejects.toMatchObject({
      code:
        fault === "disabled" || fault === "rotated-token"
          ? "device.unauthorized"
          : "session.not_open",
    });
  },
);

it("refuses an ambiguous printer id instead of choosing its kind", async () => {
  await suite.db.insert(pagePrinters).values({
    id: terrace,
    name: "Other office",
    host: "10.0.0.10",
    port: 631,
    resourcePath: "/print",
    documentFormat: "application/pdf",
    supportedFormats: ["application/pdf"],
    media: "iso_a4_210x297mm",
    resolutionDpi: 300,
  });
  await expect(offers(dashboard)).rejects.toMatchObject({
    code: "invoice_delivery.printer_invalid",
  });
});

async function fullSale() {
  const [series] = await suite.db
    .insert(invoiceSeries)
    .values({ nodeId: venue.cfg.nodeId, code: `F-${randomUUID()}`, purpose: "full" })
    .returning();
  const issued = await withTransaction(suite.db, (tx) =>
    recordSale(tx, venue.backend, {
      origin: venue.cfg.origin,
      nodeId: venue.cfg.nodeId,
      seriesId: series!.id as typeof venue.seriesId,
      locale: venue.cfg.locale,
      invoiceLocales: [venue.cfg.locale],
      total: "1.00",
      lines: [
        {
          lineNo: 1,
          name: "Coffee",
          descriptions: { [venue.cfg.locale]: "Coffee" },
          quantity: "1",
          unitPrice: "1.00",
          vatRate: "0",
          lineTotal: "1.00",
        },
      ],
      clock: venue.clock,
      settlement: { kind: "deferred" },
      counterparty: { taxId: "12345678Z", legalName: "Saved customer", countryCode: "ES" },
      recipientAddress: "Saved address",
    }),
  );
  return issued.saleId;
}

it("accompanying profiles must see every source bill's zone", async () => {
  const [product] = await suite.db.select({ name: products.name }).from(products);
  const bill = await placedIssuedBill(venue, product!.name);
  const [issued] = await suite.db.select().from(sales).where(eq(sales.workingOrderId, bill));
  const [policy] = await suite.db.select().from(floorZones).where(eq(floorZones.id, venue.zoneId));
  await withTransaction(suite.db, (tx) =>
    setProfileServiceScope(tx, till.deviceProof.device.deviceProfileId, {
      departmentId: policy!.departmentId,
      allowedZoneIds: [venue.zoneId],
      startingZoneId: venue.zoneId,
    }),
  );
  const accompanied: DeliveryAuthority = {
    surface: "dashboard",
    managementSessionId: venue.adminDashboard.split("=")[1]!,
    deviceProof: till.deviceProof,
  };
  await expect(offers(accompanied, "receipt", issued!.id)).rejects.toMatchObject({
    code: "service_zone.not_allowed",
  });
  expect((await offers(dashboard, "receipt", issued!.id)).saleId).toBe(issued!.id);
  expect((await offers(accompanied, "receipt", saleId)).saleId).toBe(saleId);
});

it("restricted Orders scope still refuses a finished bill from an earlier day", async () => {
  const [product] = await suite.db.select({ name: products.name }).from(products);
  const bill = await placedIssuedBill(venue, product!.name);
  const [issued] = await suite.db.select().from(sales).where(eq(sales.workingOrderId, bill));
  expect((await collect(venue, bill, (issued!.total / 100).toFixed(2))).status).toBe(200);
  const staff: DeliveryAuthority = {
    surface: "dashboard",
    managementSessionId: venue.staffDashboard.split("=")[1]!,
    deviceProof: null,
  };
  expect((await offers(staff, "receipt", issued!.id)).saleId).toBe(issued!.id);
  vi.setSystemTime(new Date("2026-11-05T12:00:00.000Z"));
  const fresh = await withTransaction(suite.db, (tx) =>
    startManagementSession(tx, { personId: venue.operatorId }),
  );
  staff.managementSessionId = fresh.token;
  await expect(offers(staff, "receipt", issued!.id)).rejects.toMatchObject({
    code: "working_order.not_found",
  });
});

it("an ended management session cannot distinguish an existing sale from an absent one", async () => {
  const authority: DeliveryAuthority = {
    surface: "dashboard",
    managementSessionId: randomUUID(),
    deviceProof: null,
  };
  for (const id of [saleId, randomUUID()]) {
    await expect(offers(authority, "receipt", id)).rejects.toMatchObject({
      code: "management_session.required",
    });
  }
});

it("review L1: offers expire a lapsed claim before deciding whether Print is available", async () => {
  const id = await fullSale();
  const delivery = await withTransaction(suite.db, (tx) =>
    reserveInvoiceDelivery(tx, id, {
      medium: "email",
      personId: venue.adminId,
      requestKey: randomUUID(),
      recipient: "customer@example.test",
    }),
  );
  expect(
    await withTransaction(suite.db, (tx) =>
      claimInvoiceDelivery(tx, delivery.id, "server-one", frozen),
    ),
  ).toBeDefined();
  expect((await offers(dashboard, "invoice", id)).actions.print).toBe(false);
  vi.setSystemTime(new Date(frozen.getTime() + 120_000));
  expect((await offers(dashboard, "invoice", id)).actions.print).toBe(true);
});
