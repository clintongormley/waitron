import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import {
  CORE_CHANGE_SOURCES,
  CORE_MIGRATIONS,
  deviceProfilePrinters,
  deviceProfiles,
  devices,
  drawerOpens,
  installChangeFeed,
  invoiceDeliveries,
  invoiceSeries,
  kitchenPrintJobs,
  kitchenStations,
  locations,
  printerHolders,
  printers,
  printJobs,
  receiptReprints,
  stationPrinters,
  subscribeToChanges,
  withTransaction,
  workingOrders,
} from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { seedNode, seedTenant } from "@waitron/db/testing/seed.js";
import {
  MAX_DELIVERY_ATTEMPTS,
  PRINTER_DELETED,
  deactivatePrinter,
  updatePrinter,
} from "@waitron/printing";
import { recordSale } from "@waitron/core";
import { enabledModules, fiscalSlot, parseModuleConfig } from "@waitron/module";
import type { TrustedClock } from "@waitron/fiscal";
import {
  jobOrigin,
  locationId as brandLocationId,
  nodeId as brandNodeId,
  seriesId,
  type DeleteImpact,
  type ResourceIdentity,
} from "@waitron/shared";
import { ALL_MODULES } from "./modules.js";
import { venueModuleConfig } from "./provision.js";
import { endDeactivatedInvoicePrintDeliveries } from "./invoice-print.js";
import { resolveDevicePrinterId } from "@waitron/layouts";
import { deletePrinter, readPrinterDeleteImpact } from "./printer-delete.js";

const suite = useVenueDb({ migrations: [CORE_MIGRATIONS] });

const NOW = new Date("2026-10-10T10:00:00.000Z");
const clock: TrustedClock = {
  now: () => ({
    instant: new Date("2026-10-07T12:00:00.000Z"),
    offsetMinutes: 0,
    confident: true,
    confidence: "anchored",
    anchorAgeSeconds: 0,
  }),
  anchor: () => {
    throw new Error("Unused anchor");
  },
  currentAnchor: () => null,
};

type Rows = Record<string, unknown>[];
type Snapshot = Record<string, Rows>;

/** Every table's rows, each table's rows in a fixed order, so two snapshots compare by value. */
async function snapshot(): Promise<Snapshot> {
  const tables = await suite.db.execute<{ name: string }>(
    sql`select name from sqlite_master where type = 'table' and name not like 'sqlite_%' order by name`,
  );
  const out: Snapshot = {};
  for (const { name } of tables.rows) {
    const rows = (await suite.db.execute(sql`select * from ${sql.identifier(name)}`)).rows as Rows;
    out[name] = rows
      .map((row) => ({ key: JSON.stringify(row), row }))
      .sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0))
      .map(({ row }) => row);
  }
  return out;
}

/**
 * What deleting `printerId` must leave, written from the spec rather than from the writer: the row
 * kept and switched off, its live jobs ended, their receipts ended, its choices cleared and its
 * links and holder gone. Every other row of every table is left as it was.
 */
function afterDelete(
  before: Snapshot,
  printerId: string,
  liveJobIds: string[],
  now: Date,
): Snapshot {
  const printerJobIds = new Set(
    before.print_jobs!.filter((row) => row.printer_id === printerId).map((row) => row.id),
  );
  const resort = (rows: Rows): Rows =>
    rows
      .map((row) => ({ key: JSON.stringify(row), row }))
      .sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0))
      .map(({ row }) => row);
  const withoutPrinter = (rows: Rows) => rows.filter((row) => row.printer_id !== printerId);
  return {
    ...before,
    printers: resort(
      before.printers!.map((row) =>
        row.id === printerId ? { ...row, active: 0, deleted_at: now.toISOString() } : row,
      ),
    ),
    print_jobs: resort(
      before.print_jobs!.map((row) =>
        liveJobIds.includes(row.id as string)
          ? {
              ...row,
              status: "failed",
              attempts: MAX_DELIVERY_ATTEMPTS,
              last_error: PRINTER_DELETED,
            }
          : row,
      ),
    ),
    invoice_deliveries: resort(
      before.invoice_deliveries!.map((row) =>
        row.medium === "receipt" &&
        printerJobIds.has(row.print_job_id) &&
        (row.status === "queued" || row.status === "sending")
          ? {
              ...row,
              status: row.status === "sending" ? "unknown" : "failed",
              failure_code: "transport_failed",
              expired_at: row.status === "sending" ? now.toISOString() : row.expired_at,
            }
          : row,
      ),
    ),
    devices: resort(
      before.devices!.map((row) => ({
        ...row,
        receipt_printer_id: row.receipt_printer_id === printerId ? null : row.receipt_printer_id,
        payment_slip_printer_id:
          row.payment_slip_printer_id === printerId ? null : row.payment_slip_printer_id,
        cash_drawer_printer_id:
          row.cash_drawer_printer_id === printerId ? null : row.cash_drawer_printer_id,
      })),
    ),
    device_profile_printers: withoutPrinter(before.device_profile_printers!),
    station_printers: withoutPrinter(before.station_printers!),
    printer_holders: withoutPrinter(before.printer_holders!),
  };
}

async function newSale(): Promise<string> {
  const [series] = await suite.db.select().from(invoiceSeries);
  const modules = enabledModules(
    ALL_MODULES,
    venueModuleConfig(parseModuleConfig({}, ALL_MODULES), "GB-vat"),
  );
  const backend = fiscalSlot(modules, null).makeBackend({
    db: suite.db,
    clock,
    environment: "preproduction",
  });
  const sale = await withTransaction(suite.db, (tx) =>
    recordSale(tx, backend, {
      origin: jobOrigin("operator_script"),
      nodeId: brandNodeId(series!.nodeId),
      seriesId: seriesId(series!.id),
      locale: "es-ES",
      invoiceLocales: ["es-ES"],
      total: "1.00",
      lines: [
        {
          lineNo: 1,
          name: "Coffee",
          descriptions: { "es-ES": "Café" },
          quantity: "1",
          unitPrice: "1.00",
          vatRate: "0",
          lineTotal: "1.00",
        },
      ],
      clock,
      settlement: { kind: "deferred" },
    }),
  );
  return sale.saleId;
}

/**
 * Printer P ("Counter printer", portable, with a drawer) and its every kind of link; printer Q the
 * control beside it in each; Z with nothing; D switched off with one waiting job.
 */
async function seedVenue() {
  await seedTenant(suite.db);
  const [location] = await suite.db
    .insert(locations)
    .values({ name: "Bar", invoiceLocales: ["es-ES"], operationDescription: "Sale on premises" })
    .returning();
  const [terrace] = await suite.db
    .insert(locations)
    .values({ name: "Terrace", invoiceLocales: ["es-ES"], operationDescription: "Terrace" })
    .returning();
  const locationId = location!.id;
  const nodeId = await seedNode(suite.db, brandLocationId(locationId));
  await suite.db.insert(invoiceSeries).values({ nodeId, code: "F", purpose: "standard" });
  const cfg = { locationId };

  const printer = async (values: {
    name: string;
    portable?: boolean;
    hasCashDrawer?: boolean;
    active?: boolean;
    location?: string;
  }) =>
    (
      await suite.db
        .insert(printers)
        .values({
          locationId: values.location ?? locationId,
          name: values.name,
          transport: "network_tcp",
          host: `${values.name.toLowerCase().replaceAll(" ", "-")}.test`,
          portable: values.portable ?? false,
          hasCashDrawer: values.hasCashDrawer ?? false,
          active: values.active ?? true,
        })
        .returning({ id: printers.id })
    )[0]!.id;
  const P = await printer({ name: "Counter printer", portable: true, hasCashDrawer: true });
  const Q = await printer({ name: "Kitchen printer", portable: true, hasCashDrawer: true });
  const Z = await printer({ name: "Spare printer" });
  const D = await printer({ name: "Old printer", active: false });

  const profile = async (name: string) =>
    (
      await suite.db
        .insert(deviceProfiles)
        .values({ name, formFactor: "till" })
        .returning({ id: deviceProfiles.id })
    )[0]!.id;
  const waiters = await profile("Waiters");
  const bar = await profile("Bar");
  await suite.db.insert(deviceProfilePrinters).values([
    { deviceProfileId: waiters, printerId: P, role: "receipt", position: 0, isDefault: true },
    { deviceProfileId: waiters, printerId: Q, role: "receipt", position: 1, isDefault: false },
    { deviceProfileId: waiters, printerId: P, role: "payment_slip", position: 0, isDefault: true },
    { deviceProfileId: waiters, printerId: P, role: "cash_drawer", position: 0, isDefault: true },
    { deviceProfileId: waiters, printerId: Q, role: "cash_drawer", position: 1, isDefault: false },
    { deviceProfileId: bar, printerId: Q, role: "receipt", position: 0, isDefault: true },
    { deviceProfileId: bar, printerId: Q, role: "payment_slip", position: 0, isDefault: true },
    { deviceProfileId: bar, printerId: P, role: "payment_slip", position: 1, isDefault: false },
    { deviceProfileId: bar, printerId: Q, role: "cash_drawer", position: 0, isDefault: true },
  ]);

  const device = async (values: {
    label: string;
    profileId: string;
    location?: string;
    active?: boolean;
    receipt?: string;
    slip?: string;
    drawer?: string;
  }) =>
    (
      await suite.db
        .insert(devices)
        .values({
          locationId: values.location ?? locationId,
          deviceProfileId: values.profileId,
          label: values.label,
          tokenHash: randomUUID(),
          active: values.active ?? true,
          receiptPrinterId: values.receipt ?? null,
          paymentSlipPrinterId: values.slip ?? null,
          cashDrawerPrinterId: values.drawer ?? null,
        })
        .returning({ id: devices.id })
    )[0]!.id;
  const ana = await device({
    label: "Handheld Ana",
    profileId: waiters,
    receipt: P,
    slip: P,
    drawer: P,
  });
  const oldHandheld = await device({
    label: "Old handheld",
    profileId: waiters,
    active: false,
    receipt: P,
    drawer: Q,
  });
  const barTill = await device({ label: "Bar till", profileId: waiters });
  const barTill2 = await device({ label: "Bar till 2", profileId: bar, slip: P });
  const terraceTill = await device({
    label: "Terrace till",
    profileId: waiters,
    location: terrace!.id,
  });
  await suite.db.insert(printerHolders).values([
    { printerId: P, deviceId: ana },
    { printerId: Q, deviceId: barTill2 },
  ]);

  const [grill] = await suite.db
    .insert(kitchenStations)
    .values({ locationId, name: "Grill" })
    .returning({ id: kitchenStations.id });
  const [drinks] = await suite.db
    .insert(kitchenStations)
    .values({ locationId, name: "Drinks" })
    .returning({ id: kitchenStations.id });
  await suite.db.insert(stationPrinters).values([
    { stationId: grill!.id, printerId: P },
    { stationId: drinks!.id, printerId: Q },
  ]);

  const sales = [] as string[];
  for (let i = 0; i < 5; i++) sales.push(await newSale());

  const job = async (
    printerId: string,
    values: Partial<typeof printJobs.$inferInsert> = {},
  ): Promise<string> =>
    (
      await suite.db
        .insert(printJobs)
        .values({ locationId, printerId, payload: new Uint8Array([27, 64]), ...values })
        .returning({ id: printJobs.id })
    )[0]!.id;
  const queued = await job(P, { saleId: sales[0], receiptCopy: false });
  const printing = await job(P, {
    status: "printing",
    attempts: 1,
    claimedAt: "2026-10-10T09:59:00.000Z",
    saleId: sales[1],
    receiptCopy: false,
  });
  const retryable = await job(P, { status: "failed", attempts: 1, lastError: "transport_failed" });
  const exhausted = await job(P, {
    status: "failed",
    attempts: MAX_DELIVERY_ATTEMPTS,
    lastError: "transport_failed",
  });
  const doneWithReceipt = await job(P, {
    status: "done",
    attempts: 1,
    deliveredAt: "2026-10-10T09:00:00.000Z",
    saleId: sales[2],
    receiptCopy: false,
  });
  const reprinted = await job(P, {
    status: "done",
    attempts: 1,
    saleId: sales[0],
    receiptCopy: true,
  });
  const drawer = await job(P, { kind: "drawer" });
  const qJob = await job(Q, { saleId: sales[3], receiptCopy: false });
  const dJob = await job(D);

  const delivery = (saleId: string, printJobId: string, status: "queued" | "sending") => ({
    saleId,
    printJobId,
    requestKey: randomUUID(),
    medium: "receipt" as const,
    designation: "original" as const,
    status,
    generation: 1,
    ...(status === "sending"
      ? { claimedBy: "server-one", claimedAt: "2026-10-10T09:59:00.000Z", attempts: 1 }
      : {}),
  });
  await suite.db
    .insert(invoiceDeliveries)
    .values([
      delivery(sales[0]!, queued, "queued"),
      delivery(sales[1]!, printing, "sending"),
      delivery(sales[2]!, doneWithReceipt, "queued"),
      delivery(sales[3]!, qJob, "queued"),
    ]);
  await suite.db
    .insert(receiptReprints)
    .values({ saleId: sales[0]!, printJobId: reprinted, personId: "staff-one" });
  await suite.db.insert(drawerOpens).values({
    printerId: P,
    personId: "manager-one",
    authorizedBy: "manager-one",
    reason: "calibration",
  });
  const [order] = await suite.db
    .insert(workingOrders)
    .values({ source: "dashboard", locationId, orderNumber: 1 })
    .returning({ id: workingOrders.id });
  await suite.db.insert(kitchenPrintJobs).values({
    printJobId: exhausted,
    workingOrderId: order!.id,
    stationId: grill!.id,
    reprint: false,
  });

  return {
    cfg,
    P,
    Q,
    Z,
    D,
    waiters,
    bar,
    ana,
    oldHandheld,
    barTill,
    barTill2,
    terraceTill,
    grill: grill!.id,
    jobs: {
      queued,
      printing,
      retryable,
      exhausted,
      doneWithReceipt,
      reprinted,
      drawer,
      qJob,
      dJob,
    },
  };
}

type Venue = Awaited<ReturnType<typeof seedVenue>>;

function expectedImpactOfP(v: Venue): DeleteImpact {
  return {
    target: { id: v.P, name: "Counter printer" },
    refusals: [],
    ends: [
      { key: "print_jobs", count: 4, targets: [] },
      { key: "invoice_receipts", count: 3, targets: [] },
      { key: "portable_holder", count: 1, targets: [{ id: v.ana, name: "Handheld Ana" }] },
    ],
    removes: [
      {
        key: "device_receipt",
        count: 2,
        targets: [
          { id: v.ana, name: "Handheld Ana" },
          { id: v.oldHandheld, name: "Old handheld" },
        ],
      },
      {
        key: "device_payment_slip",
        count: 2,
        targets: [
          { id: v.barTill2, name: "Bar till 2" },
          { id: v.ana, name: "Handheld Ana" },
        ],
      },
      { key: "device_cash_drawer", count: 1, targets: [{ id: v.ana, name: "Handheld Ana" }] },
      { key: "profile_receipt", count: 1, targets: [{ id: v.waiters, name: "Waiters" }] },
      {
        key: "profile_payment_slip",
        count: 2,
        targets: [
          { id: v.bar, name: "Bar" },
          { id: v.waiters, name: "Waiters" },
        ],
      },
      { key: "profile_cash_drawer", count: 1, targets: [{ id: v.waiters, name: "Waiters" }] },
      { key: "profile_receipt_default", count: 1, targets: [{ id: v.waiters, name: "Waiters" }] },
      {
        key: "profile_payment_slip_default",
        count: 1,
        targets: [{ id: v.waiters, name: "Waiters" }],
      },
      {
        key: "profile_cash_drawer_default",
        count: 1,
        targets: [{ id: v.waiters, name: "Waiters" }],
      },
      // Bar till and Old handheld inherit P for receipts and slips too, but P is portable and Ana
      // holds it, so it serves neither of them there; a drawer is never held.
      {
        key: "device_cash_drawer_default",
        count: 1,
        targets: [{ id: v.barTill, name: "Bar till" }],
      },
      { key: "station_printers", count: 1, targets: [{ id: v.grill, name: "Grill" }] },
    ],
  };
}

const LIVE = (v: Venue) => [v.jobs.queued, v.jobs.printing, v.jobs.retryable, v.jobs.drawer];

describe("the printer delete impact", () => {
  it("names every job, receipt, holder, device, profile, default and station the delete touches, and writes nothing", async () => {
    const v = await seedVenue();
    const before = await snapshot();

    const impact = await withTransaction(suite.db, (tx) => readPrinterDeleteImpact(tx, v.cfg, v.P));

    expect(impact).toEqual(expectedImpactOfP(v));
    expect(await snapshot()).toEqual(before);
  });

  it("names a device under an inherited default only where that default serves it: a portable one only for its holder", async () => {
    const v = await seedVenue();
    // Ana keeps holding P and goes back to Use default for receipts and slips.
    await suite.db
      .update(devices)
      .set({ receiptPrinterId: null, paymentSlipPrinterId: null })
      .where(eq(devices.id, v.ana));

    const impact = await withTransaction(suite.db, (tx) => readPrinterDeleteImpact(tx, v.cfg, v.P));

    expect(impact.removes.filter((item) => item.key.startsWith("device_"))).toEqual([
      { key: "device_receipt", count: 1, targets: [{ id: v.oldHandheld, name: "Old handheld" }] },
      { key: "device_payment_slip", count: 1, targets: [{ id: v.barTill2, name: "Bar till 2" }] },
      { key: "device_cash_drawer", count: 1, targets: [{ id: v.ana, name: "Handheld Ana" }] },
      { key: "device_receipt_default", count: 1, targets: [{ id: v.ana, name: "Handheld Ana" }] },
      {
        key: "device_payment_slip_default",
        count: 1,
        targets: [{ id: v.ana, name: "Handheld Ana" }],
      },
      {
        key: "device_cash_drawer_default",
        count: 1,
        targets: [{ id: v.barTill, name: "Bar till" }],
      },
    ]);
  });

  it("answers an empty impact for a printer nothing refers to, and for a switched-off one only its own work", async () => {
    const v = await seedVenue();

    expect(
      await withTransaction(suite.db, (tx) => readPrinterDeleteImpact(tx, v.cfg, v.Z)),
    ).toEqual({ target: { id: v.Z, name: "Spare printer" }, refusals: [], ends: [], removes: [] });
    expect(
      await withTransaction(suite.db, (tx) => readPrinterDeleteImpact(tx, v.cfg, v.D)),
    ).toEqual({
      target: { id: v.D, name: "Old printer" },
      refusals: [],
      ends: [{ key: "print_jobs", count: 1, targets: [] }],
      removes: [],
    });
  });

  it("lists each item's targets in label order: numbers by value, letters ignoring case", async () => {
    const v = await seedVenue();
    for (const label of ["Till 10", "till 3", "Till 2"])
      await suite.db.insert(devices).values({
        locationId: v.cfg.locationId,
        deviceProfileId: v.bar,
        label,
        tokenHash: randomUUID(),
        receiptPrinterId: v.Z,
      });

    const impact = await withTransaction(suite.db, (tx) => readPrinterDeleteImpact(tx, v.cfg, v.Z));

    expect(impact.removes.map((item) => item.targets.map((target) => target.name))).toEqual([
      ["Till 2", "till 3", "Till 10"],
    ]);
  });

  it("answers printer.not_found for a deleted or unknown printer", async () => {
    const v = await seedVenue();
    await withTransaction(suite.db, (tx) => deletePrinter(tx, v.cfg, v.Z, NOW));

    for (const id of [v.Z, randomUUID()]) {
      await expect(
        withTransaction(suite.db, (tx) => readPrinterDeleteImpact(tx, v.cfg, id)),
      ).rejects.toMatchObject({ code: "printer.not_found", params: { id } });
    }
  });
});

describe("deleting a printer", () => {
  it("returns the impact it read and leaves exactly what the spec says, every other row as it was", async () => {
    const v = await seedVenue();
    const before = await snapshot();
    const read = await withTransaction(suite.db, (tx) => readPrinterDeleteImpact(tx, v.cfg, v.P));

    const done = await withTransaction(suite.db, (tx) => deletePrinter(tx, v.cfg, v.P, NOW));

    expect(done).toEqual(read);
    expect(await snapshot()).toEqual(afterDelete(before, v.P, LIVE(v), NOW));
  });

  it("clears every matching choice and link, including an inactive device's, and promotes no other default", async () => {
    const v = await seedVenue();

    await withTransaction(suite.db, (tx) => deletePrinter(tx, v.cfg, v.P, NOW));

    const choices = await suite.db
      .select({
        id: devices.id,
        receipt: devices.receiptPrinterId,
        slip: devices.paymentSlipPrinterId,
        drawer: devices.cashDrawerPrinterId,
      })
      .from(devices);
    expect(choices).toEqual(
      expect.arrayContaining([
        { id: v.ana, receipt: null, slip: null, drawer: null },
        { id: v.oldHandheld, receipt: null, slip: null, drawer: v.Q },
        { id: v.barTill, receipt: null, slip: null, drawer: null },
        { id: v.barTill2, receipt: null, slip: null, drawer: null },
      ]),
    );
    expect(
      await suite.db
        .select({
          profile: deviceProfilePrinters.deviceProfileId,
          printer: deviceProfilePrinters.printerId,
          role: deviceProfilePrinters.role,
          position: deviceProfilePrinters.position,
          isDefault: deviceProfilePrinters.isDefault,
        })
        .from(deviceProfilePrinters)
        .where(eq(deviceProfilePrinters.deviceProfileId, v.waiters)),
    ).toEqual(
      expect.arrayContaining([
        { profile: v.waiters, printer: v.Q, role: "receipt", position: 1, isDefault: false },
        { profile: v.waiters, printer: v.Q, role: "cash_drawer", position: 1, isDefault: false },
      ]),
    );
    expect(
      await suite.db
        .select()
        .from(deviceProfilePrinters)
        .where(eq(deviceProfilePrinters.deviceProfileId, v.waiters)),
    ).toHaveLength(2);
    expect(await suite.db.select().from(printerHolders)).toEqual([
      expect.objectContaining({ printerId: v.Q, deviceId: v.barTill2 }),
    ]);
  });

  it("recomputes inside the delete: work and settings added after the read are ended and removed, and a job finished meanwhile stays finished", async () => {
    const v = await seedVenue();
    const read = await withTransaction(suite.db, (tx) => readPrinterDeleteImpact(tx, v.cfg, v.P));
    expect(read).toEqual(expectedImpactOfP(v));

    // Between the read and the delete: an agent finishes one job, two more are queued, the holder
    // changes, and a device, a profile and a station take the printer.
    await suite.db
      .update(printJobs)
      .set({ status: "done", deliveredAt: "2026-10-10T09:59:30.000Z" })
      .where(eq(printJobs.id, v.jobs.queued));
    const added = [] as string[];
    for (let i = 0; i < 2; i++) {
      const [row] = await suite.db
        .insert(printJobs)
        .values({ locationId: v.cfg.locationId, printerId: v.P, payload: new Uint8Array([1]) })
        .returning({ id: printJobs.id });
      added.push(row!.id);
    }
    await suite.db
      .update(printerHolders)
      .set({ deviceId: v.barTill })
      .where(eq(printerHolders.printerId, v.P));
    await suite.db
      .update(devices)
      .set({ cashDrawerPrinterId: v.P })
      .where(eq(devices.id, v.barTill2));
    await suite.db.insert(deviceProfilePrinters).values({
      deviceProfileId: v.bar,
      printerId: v.P,
      role: "receipt",
      position: 1,
      isDefault: false,
    });
    const [drinks] = await suite.db
      .select({ id: kitchenStations.id })
      .from(kitchenStations)
      .where(eq(kitchenStations.name, "Drinks"));
    await suite.db.insert(stationPrinters).values({ stationId: drinks!.id, printerId: v.P });
    const before = await snapshot();

    const done = await withTransaction(suite.db, (tx) => deletePrinter(tx, v.cfg, v.P, NOW));

    const expected = expectedImpactOfP(v);
    const item = (list: DeleteImpact["ends"], key: string) => list.find((i) => i.key === key)!;
    item(expected.ends, "print_jobs").count = 5;
    item(expected.ends, "portable_holder").targets = [{ id: v.barTill, name: "Bar till" }];
    item(expected.removes, "device_cash_drawer").count = 2;
    item(expected.removes, "device_cash_drawer").targets = [
      { id: v.barTill2, name: "Bar till 2" },
      { id: v.ana, name: "Handheld Ana" },
    ];
    item(expected.removes, "profile_receipt").count = 2;
    item(expected.removes, "profile_receipt").targets = [
      { id: v.bar, name: "Bar" },
      { id: v.waiters, name: "Waiters" },
    ];
    item(expected.removes, "station_printers").count = 2;
    item(expected.removes, "station_printers").targets = [
      { id: drinks!.id, name: "Drinks" },
      { id: v.grill, name: "Grill" },
    ];
    // Bar till now holds P, so the receipt and slip defaults it inherits resolve to P.
    expected.removes.splice(
      expected.removes.findIndex((i) => i.key === "device_cash_drawer_default"),
      0,
      { key: "device_receipt_default", count: 1, targets: [{ id: v.barTill, name: "Bar till" }] },
      {
        key: "device_payment_slip_default",
        count: 1,
        targets: [{ id: v.barTill, name: "Bar till" }],
      },
    );
    expect(done).toEqual(expected);
    const live = [v.jobs.printing, v.jobs.retryable, v.jobs.drawer, ...added];
    expect(await snapshot()).toEqual(afterDelete(before, v.P, live, NOW));
    const [finished] = await suite.db
      .select({ status: printJobs.status, lastError: printJobs.lastError })
      .from(printJobs)
      .where(eq(printJobs.id, v.jobs.queued));
    expect(finished).toEqual({ status: "done", lastError: null });
  });

  it("leaves a device on the profile's deleted cash-drawer default with no drawer, not the other listed one", async () => {
    const v = await seedVenue();
    const drawerOf = (deviceId: string) =>
      withTransaction(suite.db, (tx) => resolveDevicePrinterId(tx, deviceId, "cash_drawer"));
    expect(await drawerOf(v.barTill)).toBe(v.P);

    await withTransaction(suite.db, (tx) => deletePrinter(tx, v.cfg, v.P, NOW));

    expect(await drawerOf(v.barTill)).toBeNull();
    const waitersDrawers = await suite.db
      .select({
        printerId: deviceProfilePrinters.printerId,
        isDefault: deviceProfilePrinters.isDefault,
      })
      .from(deviceProfilePrinters)
      .where(
        sql`${deviceProfilePrinters.deviceProfileId} = ${v.waiters} and ${deviceProfilePrinters.role} = 'cash_drawer'`,
      );
    expect(waitersDrawers).toEqual([{ printerId: v.Q, isDefault: false }]);
  });

  it("deletes a printer nothing refers to and a switched-off one", async () => {
    const v = await seedVenue();
    const before = await snapshot();

    await withTransaction(suite.db, (tx) => deletePrinter(tx, v.cfg, v.Z, NOW));
    const afterZ = afterDelete(before, v.Z, [], NOW);
    expect(await snapshot()).toEqual(afterZ);

    const later = new Date("2026-10-10T11:00:00.000Z");
    await withTransaction(suite.db, (tx) => deletePrinter(tx, v.cfg, v.D, later));
    expect(await snapshot()).toEqual(afterDelete(afterZ, v.D, [v.jobs.dJob], later));
  });

  it("answers printer.not_found to a second delete and writes nothing", async () => {
    const v = await seedVenue();
    await withTransaction(suite.db, (tx) => deletePrinter(tx, v.cfg, v.P, NOW));
    const before = await snapshot();

    for (const id of [v.P, randomUUID()]) {
      await expect(
        withTransaction(suite.db, (tx) => deletePrinter(tx, v.cfg, id, new Date())),
      ).rejects.toMatchObject({ code: "printer.not_found", params: { id } });
    }
    expect(await snapshot()).toEqual(before);
  });

  it("rolls back every ending and removal when the final write is refused, and publishes no change", async () => {
    const v = await seedVenue();
    await installChangeFeed(suite.db, CORE_CHANGE_SOURCES);
    const heard: ResourceIdentity[] = [];
    const unsubscribe = subscribeToChanges((change) => heard.push(...change.resources));
    if (!/^[0-9a-f-]{36}$/.test(v.P)) throw new Error(`unexpected printer id ${v.P}`);
    const before = await snapshot();
    // Trigger bodies take no bound value; the id is checked to be a plain uuid above.
    await suite.db.execute(
      sql.raw(`create trigger test_delete_failure before update on printers
        when old.id = '${v.P}' and new.deleted_at is not null
        begin select raise(abort, 'test_delete_failure'); end`),
    );
    try {
      await expect(
        withTransaction(suite.db, (tx) => deletePrinter(tx, v.cfg, v.P, NOW)),
      ).rejects.toThrow(/test_delete_failure/);
      expect(await snapshot()).toEqual(before);
      expect(heard).toEqual([]);
    } finally {
      await suite.db.execute(sql`drop trigger test_delete_failure`);
    }

    // Control: the same subscription hears the delete once the trigger is gone.
    await withTransaction(suite.db, (tx) => deletePrinter(tx, v.cfg, v.P, NOW));
    unsubscribe();
    expect(heard).toContainEqual(expect.objectContaining({ type: "printers", id: v.P }));
  });

  it("is unlike Disable, which keeps ordinary waiting jobs, settings and holder, and can be undone by Enable", async () => {
    const v = await seedVenue();
    const before = await snapshot();

    // What the deactivate route runs.
    await withTransaction(suite.db, async (tx) => {
      await deactivatePrinter(tx, v.cfg, v.P);
      await endDeactivatedInvoicePrintDeliveries(tx, v.P, NOW);
    });
    const after = await snapshot();
    for (const table of [
      "devices",
      "device_profile_printers",
      "station_printers",
      "printer_holders",
    ]) {
      expect(after[table], table).toEqual(before[table]);
    }
    for (const id of [v.jobs.retryable, v.jobs.drawer]) {
      expect(after.print_jobs!.find((row) => row.id === id)).toEqual(
        before.print_jobs!.find((row) => row.id === id),
      );
    }

    await withTransaction(suite.db, (tx) => updatePrinter(tx, v.cfg, v.P, { active: true }));
    const [row] = await suite.db
      .select({ active: printers.active, deletedAt: printers.deletedAt })
      .from(printers)
      .where(eq(printers.id, v.P));
    expect(row).toEqual({ active: true, deletedAt: null });
  });
});
