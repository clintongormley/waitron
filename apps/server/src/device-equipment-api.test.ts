import { testTradingAdmission } from "./testing/trading-admission.js";
import { randomUUID } from "node:crypto";
import { mkdtempSync } from "node:fs";
import { tmpdir, type networkInterfaces } from "node:os";
import { join } from "node:path";
import { Hono, type Context } from "hono";
import { and, eq, inArray, sql } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  billPayments,
  devices,
  kitchenStations,
  locations,
  pagePrinters,
  printerHolders,
  printers,
  printJobs,
  stationPrinters,
  withTransaction,
} from "@waitron/db";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { loadKeyRing, putCredential } from "@waitron/credentials";
import { startManagementSession } from "@waitron/identity";
import { emptyPrinterLists, setProfilePrinterLists } from "@waitron/layouts";
import type { ProfilePrinterLists } from "@waitron/layouts";
import type { StaffNotice, StaffNoticeReadContext, WaitronModule } from "@waitron/module";
import {
  cardReaderHolders,
  cardReaders,
  deviceCardReaders,
  failAttempting,
  payments,
  setProfileReaderList,
  type CardProviderContribution,
} from "@waitron/payments";
import { MAX_DELIVERY_ATTEMPTS } from "@waitron/printing";
import { MANAGEMENT_COOKIE } from "@waitron/server-kit";
import { printingAlertSource } from "./alert-sources.js";
import {
  BOX_NOTICE_OWNER,
  boxStaffNoticeSource,
  deviceNoticeSources,
  devicePrinterNoticeSources,
  documentPrintersOf,
} from "./box-staff-notices.js";
import { prepareCardReaderDelete } from "./card-reader-delete.js";
import type { ClockWitnessStore } from "./clock-witnesses.js";
import { mountDeviceApi, type DeviceApiDeps } from "./device-api.js";
import { createDiskFullState } from "./disk-full-state.js";
import { createFreeSpaceState } from "./free-space-watch.js";
import type { EquipmentRole, RoleEquipment, RoleSummary } from "./device-equipment.js";
import type { Logger } from "./logger.js";
import { mountJoinApi } from "./join-api.js";
import { createPairingMode } from "./pairing-mode.js";
import { mountPaymentsApi } from "./payments-api.js";
import { deletePrinter } from "./printer-delete.js";
import { requestFromBox } from "./request-from-box.js";
import type { OwnedStaffNoticeSource } from "./staff-notices.js";
import { provisionBillVenue, send, tabWith, type BillVenue } from "./testing/bill-venue.js";

// Choosing equipment over HTTP: two tills A ("Barra") and B ("Terraza") on one profile, each with
// a session for "Ana", reader R1 held by A and R2 by B, R3 free; a portable printer PP, a fixed one
// FP and a drawer printer DR on the profile's lists.
const suite = useVenueDb({
  migrations: migrationOptionsFor(manifestSets(), null),
  timeoutMs: 60_000,
});
const quiet: Logger = () => {};

let venue: BillVenue;
let deviceApp: Hono;
let managerCookie: string;
let profileId: string;
let a: string;
let b: string;
let pp: string;
let fp: string;
let dr: string;
let r1: string;
let r2: string;
let r3: string;

const inTx = <T>(fn: Parameters<typeof withTransaction<T>>[1]) => withTransaction(suite.db, fn);

async function seedPrinter(
  name: string,
  opts: { portable?: boolean; hasCashDrawer?: boolean; locationId?: string } = {},
): Promise<string> {
  const [row] = await suite.db
    .insert(printers)
    .values({
      locationId: opts.locationId ?? venue.cfg.locationId,
      name,
      transport: "network_tcp",
      host: "10.0.0.9",
      portable: opts.portable ?? false,
      hasCashDrawer: opts.hasCashDrawer ?? false,
    })
    .returning({ id: printers.id });
  return row!.id;
}

async function seedPagePrinter(name: string): Promise<string> {
  const [row] = await suite.db
    .insert(pagePrinters)
    .values({
      locationId: venue.cfg.locationId,
      name,
      host: "10.0.0.8",
      port: 631,
      resourcePath: "/ipp/print",
      documentFormat: "application/pdf",
      supportedFormats: ["application/pdf"],
      media: "iso_a4_210x297mm",
      resolutionDpi: 600,
    })
    .returning({ id: pagePrinters.id });
  return row!.id;
}

async function seedReader(name: string, provider = "fake"): Promise<string> {
  const [row] = await suite.db
    .insert(cardReaders)
    .values({ provider, providerRef: `${name}-${randomUUID()}`, name })
    .returning({ id: cardReaders.id });
  return row!.id;
}

function printerLists(partial: Partial<ProfilePrinterLists>) {
  return inTx((tx) =>
    setProfilePrinterLists(tx, profileId, {
      ...emptyPrinterLists(),
      receiptPrinterIds: [fp, pp],
      paymentSlipPrinterIds: [fp, pp],
      cashDrawerPrinterIds: [dr],
      ...partial,
    }),
  );
}

function readerList(readerIds: string[], defaultReaderId: string | null = null) {
  return inTx((tx) => setProfileReaderList(tx, profileId, { readerIds, defaultReaderId }));
}

beforeEach(async () => {
  venue = await provisionBillVenue(suite.db);
  a = venue.deviceId;
  b = venue.device2Id;
  const [row] = await suite.db
    .select({ profileId: devices.deviceProfileId })
    .from(devices)
    .where(eq(devices.id, a));
  profileId = row!.profileId;
  const readerOf = (ref: string) =>
    suite.db.all<{ id: string }>(sql`select id from card_readers where provider_ref = ${ref}`)[0]!
      .id;
  r1 = readerOf("reader-1");
  r2 = readerOf("reader-2");
  r3 = await seedReader("Lector 3");
  pp = await seedPrinter("Portátil", { portable: true });
  fp = await seedPrinter("Barra fija");
  dr = await seedPrinter("Cajón", { hasCashDrawer: true });
  await printerLists({});
  await readerList([r1, r2, r3]);
  deviceApp = new Hono();
  mountDeviceApi(
    deviceApp,
    { db: suite.db, cfg: venue.cfg, secureCookies: false, pairingMode: createPairingMode() },
    quiet,
  );
  const session = await inTx((tx) => startManagementSession(tx, { personId: venue.adminId }));
  managerCookie = `${MANAGEMENT_COOKIE}=${session.token}`;
});

type Selection = "default" | { id: string };

function choose(
  cookie: string,
  role: EquipmentRole,
  selection: Selection,
  via: "scan" | "list",
  takeOver?: boolean,
) {
  return send(deviceApp, cookie, "PUT", "/api/device/equipment", {
    role,
    selection,
    via,
    ...(takeOver === undefined ? {} : { takeOver }),
  });
}

async function equipmentOf(cookie: string): Promise<RoleEquipment[]> {
  const res = await send(deviceApp, cookie, "GET", "/api/device/equipment");
  expect(res.status).toBe(200);
  return (res.json as { roles: RoleEquipment[] }).roles;
}

const roleOf = <T extends { role: EquipmentRole }>(roles: T[], role: EquipmentRole) =>
  roles.find((r) => r.role === role)!;

const summary = ({ role, selection, chosenId, resolved }: RoleEquipment): RoleSummary => ({
  role,
  selection,
  chosenId,
  resolved,
});

async function columns(deviceId: string) {
  const [row] = await suite.db
    .select({
      receipt: devices.receiptPrinterId,
      slip: devices.paymentSlipPrinterId,
      drawer: devices.cashDrawerPrinterId,
    })
    .from(devices)
    .where(eq(devices.id, deviceId));
  return row!;
}

async function readerChoices(): Promise<Record<string, string>> {
  const rows = await suite.db
    .select()
    .from(deviceCardReaders)
    .where(inArray(deviceCardReaders.deviceId, [a, b]));
  return Object.fromEntries(rows.map((row) => [row.deviceId, row.readerId]));
}

async function printerHolder(printerId: string): Promise<string | null> {
  const [row] = await suite.db
    .select({ deviceId: printerHolders.deviceId })
    .from(printerHolders)
    .where(eq(printerHolders.printerId, printerId));
  return row?.deviceId ?? null;
}

async function readerHolders(readerId: string): Promise<string[]> {
  const rows = await suite.db
    .select({ deviceId: cardReaderHolders.deviceId })
    .from(cardReaderHolders)
    .where(eq(cardReaderHolders.readerId, readerId));
  return rows.map((row) => row.deviceId);
}

function payBody(readerId?: string) {
  return {
    id: randomUUID(),
    zoneId: venue.zoneId,
    lines: [{ menuItemId: venue.offerFor("Caña"), quantity: "1" }],
    ...(readerId === undefined ? {} : { readerId }),
  };
}

async function pay(cookie: string, readerId?: string) {
  const body = payBody(readerId);
  return {
    workingOrderId: body.id,
    ...(await send(venue.appTipsOff, cookie, "POST", "/api/pay", body)),
  };
}

function paymentsOf(workingOrderId: string) {
  return suite.db
    .select({
      readerId: payments.readerId,
      deviceId: payments.deviceId,
      state: payments.state,
      paymentRef: payments.paymentRef,
    })
    .from(payments)
    .where(eq(payments.workingOrderId, workingOrderId));
}

/** A's charge on its reader left `attempting`, as a reader that stopped answering leaves it. */
async function stalledPayment(cookie: string, readerId?: string) {
  venue.card.stallNextCollect();
  const paid = await pay(cookie, readerId);
  expect(paid.status, JSON.stringify(paid.json)).toBe(200);
  return paid.workingOrderId;
}

function cardOnBill(billId: string, cookie: string, readerId?: string) {
  return send(venue.app, cookie, "POST", `/api/working-orders/${billId}/payments`, {
    submissionId: randomUUID(),
    kind: "contribution",
    amount: "5.00",
    method: "card",
    entry: "reader",
    applied: "5.00",
    tip: "0.00",
    ...(readerId === undefined ? {} : { readerId }),
  });
}

describe("choosing a portable printer, by scan or by a confirmed list choice", () => {
  it("scan and confirmed list reach the same assignment", async () => {
    expect((await choose(venue.cookie, "receipt", { id: pp }, "list")).status).toBe(200);
    expect(await printerHolder(pp)).toBe(a);

    const scanned = await choose(venue.cookie2, "receipt", { id: pp }, "scan");
    expect(scanned.status).toBe(200);
    const afterScan = {
      holder: await printerHolder(pp),
      a: (await columns(a)).receipt,
      b: (await columns(b)).receipt,
      heldBy: roleOf(await equipmentOf(venue.cookie), "receipt").choices.find((c) => c.id === pp)!
        .heldBy,
    };

    expect((await choose(venue.cookie, "receipt", { id: pp }, "scan")).status).toBe(200);
    expect(await printerHolder(pp)).toBe(a);
    const confirmed = await choose(venue.cookie2, "receipt", { id: pp }, "list", true);
    expect(confirmed.status).toBe(200);
    const afterList = {
      holder: await printerHolder(pp),
      a: (await columns(a)).receipt,
      b: (await columns(b)).receipt,
      heldBy: roleOf(await equipmentOf(venue.cookie), "receipt").choices.find((c) => c.id === pp)!
        .heldBy,
    };

    const expected = {
      holder: b,
      a: null,
      b: pp,
      heldBy: { deviceId: b, deviceName: "Terraza", personName: "Ana" },
    };
    expect(afterScan).toEqual(expected);
    expect(afterList).toEqual(expected);
  });

  it("a legitimate selection of a free item succeeds", async () => {
    const res = await choose(venue.cookie, "receipt", { id: fp }, "list");

    expect(res.status).toBe(200);
    expect(roleOf((res.json as { roles: RoleEquipment[] }).roles, "receipt")).toMatchObject({
      selection: "item",
      chosenId: fp,
      resolved: { id: fp, name: "Barra fija", available: true },
    });
    expect((await columns(a)).receipt).toBe(fp);
  });

  it("an unconfirmed list takeover is refused device.equipment_held naming B's device and person, and changes nothing", async () => {
    expect((await choose(venue.cookie2, "receipt", { id: pp }, "list")).status).toBe(200);
    const before = { a: await columns(a), b: await columns(b), holder: await printerHolder(pp) };

    const res = await choose(venue.cookie, "receipt", { id: pp }, "list");

    expect(res.status).toBe(409);
    expect(res.json).toEqual({
      code: "device.equipment_held",
      params: {
        field: "receiptPrinterId",
        holderDeviceId: b,
        holderDeviceName: "Terraza",
        holderPersonName: "Ana",
      },
    });
    expect({ a: await columns(a), b: await columns(b), holder: await printerHolder(pp) }).toEqual(
      before,
    );
  });

  it("the drawer role takes a listed drawer printer and holds nothing", async () => {
    const res = await choose(venue.cookie, "cash_drawer", { id: dr }, "list");

    expect(res.status).toBe(200);
    expect((await columns(a)).drawer).toBe(dr);
    expect(await printerHolder(dr)).toBeNull();
  });

  it("a switched-off chosen printer is reported available:false and stays chosen", async () => {
    expect((await choose(venue.cookie, "receipt", { id: fp }, "list")).status).toBe(200);
    await suite.db.update(printers).set({ active: false }).where(eq(printers.id, fp));

    const receipt = roleOf(await equipmentOf(venue.cookie), "receipt");

    expect(receipt).toMatchObject({
      selection: "item",
      chosenId: fp,
      resolved: { id: fp, available: false },
      chosen: { id: fp, available: false },
    });
    expect((await columns(a)).receipt).toBe(fp);
  });
});

describe("two devices racing for one item", () => {
  it("two devices racing to take one reader by scan leave exactly one holder whose explicit choice names it", async () => {
    const [first, second] = await Promise.all([
      choose(venue.cookie, "card_terminal", { id: r3 }, "scan"),
      choose(venue.cookie2, "card_terminal", { id: r3 }, "scan"),
    ]);

    expect([first.status, second.status]).toEqual([200, 200]);
    const holders = await readerHolders(r3);
    expect(holders).toHaveLength(1);
    const choosing = Object.entries(await readerChoices()).filter(([, reader]) => reader === r3);
    expect(choosing).toEqual([[holders[0], r3]]);
  });

  it("racing by unconfirmed list: one 200, one 409 device.equipment_held", async () => {
    const answers = await Promise.all([
      choose(venue.cookie, "card_terminal", { id: r3 }, "list"),
      choose(venue.cookie2, "card_terminal", { id: r3 }, "list"),
    ]);

    expect(answers.map((answer) => answer.status).sort()).toEqual([200, 409]);
    expect(answers.find((answer) => answer.status === 409)!.json).toMatchObject({
      code: "device.equipment_held",
      params: { field: "cardReaderId" },
    });
    expect(await readerHolders(r3)).toHaveLength(1);
  });
});

describe("a reader with a payment in progress", () => {
  it("cannot be taken by B, held or free; the payment keeps its reader and device", async () => {
    const workingOrderId = await stalledPayment(venue.cookie);
    expect(await paymentsOf(workingOrderId)).toMatchObject([
      { readerId: r1, deviceId: a, state: "attempting" },
    ]);

    const held = await choose(venue.cookie2, "card_terminal", { id: r1 }, "scan");
    expect(held.status).toBe(409);
    expect(held.json).toEqual({ code: "reader.payment_in_progress", params: { readerId: r1 } });
    expect(await readerHolders(r1)).toEqual([a]);

    expect((await choose(venue.cookie2, "card_terminal", "default", "list")).status).toBe(200);
    expect((await choose(venue.cookie, "card_terminal", { id: r2 }, "list")).status).toBe(200);
    expect(await readerHolders(r1)).toEqual([]);
    expect(await paymentsOf(workingOrderId)).toMatchObject([
      { readerId: r1, deviceId: a, state: "attempting" },
    ]);
    const free = await choose(venue.cookie2, "card_terminal", { id: r1 }, "scan");
    expect(free.status).toBe(409);
    expect(free.json).toMatchObject({ code: "reader.payment_in_progress" });

    const [row] = await paymentsOf(workingOrderId);
    await inTx((tx) => failAttempting(tx, { provider: "fake", paymentRef: row!.paymentRef }));
    expect((await choose(venue.cookie2, "card_terminal", { id: r1 }, "scan")).status).toBe(200);
    expect(await readerHolders(r1)).toEqual([b]);
  });

  it("a reader with only captured or failed payments can be taken", async () => {
    expect((await pay(venue.cookie)).status).toBe(200);
    venue.card.failNextCollect();
    expect((await pay(venue.cookie)).status).toBe(200);

    const res = await choose(venue.cookie2, "card_terminal", { id: r1 }, "scan");

    expect(res.status).toBe(200);
    expect(await readerHolders(r1)).toEqual([b]);
  });

  it("GET shows a reader with another device's payment in progress as busy", async () => {
    await stalledPayment(venue.cookie);

    const terminal = roleOf(await equipmentOf(venue.cookie2), "card_terminal");

    expect(terminal.choices.map((c) => ({ id: c.id, busy: c.busy }))).toEqual([
      { id: r1, busy: true },
      { id: r2, busy: false },
      { id: r3, busy: false },
    ]);
    expect(roleOf(await equipmentOf(venue.cookie), "card_terminal").resolved).toMatchObject({
      id: r1,
    });
    expect(
      roleOf(await equipmentOf(venue.cookie), "card_terminal").choices.find((c) => c.id === r1)!
        .busy,
    ).toBe(false);
  });
});

describe("paying only on a reader this device holds, with no other device's payment on it", () => {
  it("with no readerId it charges on the resolved reader and the payment row records it from its attempting state on", async () => {
    const stalled = await stalledPayment(venue.cookie);
    expect(await paymentsOf(stalled)).toMatchObject([{ readerId: r1, state: "attempting" }]);

    const paid = await pay(venue.cookie2);

    expect(paid.status).toBe(200);
    expect(await paymentsOf(paid.workingOrderId)).toMatchObject([
      { readerId: r2, deviceId: b, state: "captured" },
    ]);
  });

  it("/api/pay on a reader this device does not hold is reader.not_held and charges nothing", async () => {
    const calls = venue.card.collectCalls.length;

    const named = await pay(venue.cookie, r2);

    expect(named.status).toBe(409);
    expect(named.json).toEqual({ code: "reader.not_held", params: { readerId: r2 } });
    expect(await paymentsOf(named.workingOrderId)).toEqual([]);

    // The device's stored choice names a reader another device holds.
    await suite.db
      .update(deviceCardReaders)
      .set({ readerId: r2 })
      .where(eq(deviceCardReaders.deviceId, a));
    const stored = await pay(venue.cookie);

    expect(stored.status).toBe(409);
    expect(stored.json).toEqual({ code: "reader.not_held", params: { readerId: r2 } });
    expect(await paymentsOf(stored.workingOrderId)).toEqual([]);
    expect(venue.card.collectCalls.length).toBe(calls);
  });

  it("/api/pay on a reader with another device's payment in progress is reader.payment_in_progress", async () => {
    await stalledPayment(venue.cookie2);
    // A stuck payment of B's stays on R2 while A comes to hold it.
    await suite.db
      .update(cardReaderHolders)
      .set({ deviceId: a })
      .where(eq(cardReaderHolders.readerId, r2));
    const calls = venue.card.collectCalls.length;

    const paid = await pay(venue.cookie, r2);

    expect(paid.status).toBe(409);
    expect(paid.json).toEqual({ code: "reader.payment_in_progress", params: { readerId: r2 } });
    expect(await paymentsOf(paid.workingOrderId)).toEqual([]);
    expect(venue.card.collectCalls.length).toBe(calls);
  });

  it("a takeover between resolving the reader and starting the charge is refused at the start", async () => {
    const release = venue.card.holdNextCollect();
    const calls = venue.card.collectCalls.length;
    const paying = pay(venue.cookie);
    await vi.waitFor(() => expect(venue.card.collectCalls.length).toBe(calls + 1));

    expect((await choose(venue.cookie2, "card_terminal", { id: r1 }, "scan")).status).toBe(200);
    release();
    const paid = await paying;

    expect(paid.status).toBe(409);
    expect(paid.json).toEqual({ code: "reader.not_held", params: { readerId: r1 } });
    expect(await paymentsOf(paid.workingOrderId)).toEqual([]);
  });

  describe("the bill payment route", () => {
    it("refuses a reader this device does not hold as reader.not_held, charging nothing", async () => {
      const billId = await tabWith(venue, "Tarta");
      const calls = venue.card.collectCalls.length;

      const paid = await cardOnBill(billId, venue.cookie, r2);

      expect(paid.status).toBe(409);
      expect(paid.json).toEqual({ code: "reader.not_held", params: { readerId: r2 } });
      expect(venue.card.collectCalls.length).toBe(calls);
    });

    it("refuses a reader with another device's payment in progress as reader.payment_in_progress", async () => {
      await stalledPayment(venue.cookie2);
      await suite.db
        .update(cardReaderHolders)
        .set({ deviceId: a })
        .where(eq(cardReaderHolders.readerId, r2));
      const billId = await tabWith(venue, "Tarta");
      const calls = venue.card.collectCalls.length;

      const paid = await cardOnBill(billId, venue.cookie, r2);

      expect(paid.status).toBe(409);
      expect(paid.json).toEqual({ code: "reader.payment_in_progress", params: { readerId: r2 } });
      expect(venue.card.collectCalls.length).toBe(calls);
    });

    it("a takeover between resolving the reader and starting the charge fails the bill payment, releasing its reservation", async () => {
      const billId = await tabWith(venue, "Tarta");
      const release = venue.card.holdNextCollect();
      const calls = venue.card.collectCalls.length;
      const paying = cardOnBill(billId, venue.cookie);
      await vi.waitFor(() => expect(venue.card.collectCalls.length).toBe(calls + 1));

      expect((await choose(venue.cookie2, "card_terminal", { id: r1 }, "scan")).status).toBe(200);
      release();
      const paid = await paying;

      expect(paid.status).toBe(409);
      expect(paid.json).toEqual({ code: "reader.not_held", params: { readerId: r1 } });
      const balance = await send(
        venue.app,
        venue.cookie,
        "GET",
        `/api/working-orders/${billId}/payments`,
      );
      expect(balance.json).toMatchObject({ reserved: "0.00", payments: [{ state: "failed" }] });
    });

    it("charges the reader the device holds", async () => {
      const billId = await tabWith(venue, "Tarta");

      const paid = await cardOnBill(billId, venue.cookie);

      expect(paid.status).toBe(200);
      const [row] = await suite.db
        .select({ readerId: payments.readerId, deviceId: payments.deviceId })
        .from(payments)
        .where(and(eq(payments.workingOrderId, billId), eq(payments.state, "captured")));
      expect(row).toEqual({ readerId: r1, deviceId: a });
    });
  });
});

describe("what a device may newly choose", () => {
  it.each([
    "unlisted printer",
    "printer at another location",
    "switched-off printer",
    "unknown printer",
    "disabled reader",
    "unpaired reader",
    "unlisted reader",
  ] as const)("a %s is device.binding_invalid naming the role's field", async (shape) => {
    const reader = shape.endsWith("reader");
    let id: string;
    if (shape === "unlisted printer") id = await seedPrinter("Sin lista");
    else if (shape === "printer at another location") {
      const [away] = await suite.db
        .insert(locations)
        .values({ name: "Otra", invoiceLocales: ["es-ES"], operationDescription: "Venta" })
        .returning({ id: locations.id });
      id = await seedPrinter("Fuera", { locationId: away!.id });
      await printerLists({ receiptPrinterIds: [fp, pp, id] });
    } else if (shape === "switched-off printer") {
      await suite.db.update(printers).set({ active: false }).where(eq(printers.id, fp));
      id = fp;
    } else if (shape === "unknown printer") id = randomUUID();
    else if (shape === "disabled reader") {
      await suite.db.update(cardReaders).set({ active: false }).where(eq(cardReaders.id, r3));
      id = r3;
    } else if (shape === "unpaired reader") {
      const at = new Date().toISOString();
      await suite.db
        .update(cardReaders)
        .set({ active: false, disabledAt: at, unpairedAt: at })
        .where(eq(cardReaders.id, r3));
      id = r3;
    } else id = await seedReader("Sin lista");
    const before = { a: await columns(a), readers: await readerChoices() };

    const res = await choose(venue.cookie, reader ? "card_terminal" : "receipt", { id }, "scan");

    expect(res.status).toBe(400);
    expect(res.json).toEqual({
      code: "device.binding_invalid",
      params: { field: reader ? "cardReaderId" : "receiptPrinterId" },
    });
    expect({ a: await columns(a), readers: await readerChoices() }).toEqual(before);
  });

  it("refuses a malformed body as a request fault", async () => {
    for (const [body, field] of [
      [{ role: "kitchen", selection: "default", via: "list" }, "role"],
      [{ role: "receipt", selection: { id: "nope" }, via: "list" }, "selection"],
      [{ role: "receipt", selection: "none", via: "list" }, "selection"],
      [{ role: "receipt", selection: "default", via: "manage" }, "via"],
      [{ role: "receipt", selection: "default", via: "list", takeOver: "yes" }, "takeOver"],
    ] as const) {
      const res = await send(deviceApp, venue.cookie, "PUT", "/api/device/equipment", body);
      expect(res.status, field).toBe(400);
      expect(res.json).toMatchObject({ code: expect.any(String), params: { field } });
    }
  });

  it("a revoked device's session cannot select, and GET without a device cookie is 401", async () => {
    await suite.db.update(devices).set({ active: false }).where(eq(devices.id, a));

    const revoked = await choose(venue.cookie, "receipt", { id: fp }, "list");

    expect(revoked.status).toBe(401);
    expect(revoked.json).toMatchObject({ code: "device.unauthorized" });
    expect((await columns(a)).receipt).toBeNull();
    const anonymous = await send(deviceApp, "", "GET", "/api/device/equipment");
    expect(anonymous.status).toBe(401);
  });

  async function aState() {
    return {
      columns: await columns(a),
      printerHolds: await suite.db
        .select({ printerId: printerHolders.printerId })
        .from(printerHolders)
        .where(eq(printerHolders.deviceId, a)),
      readerHolds: await suite.db
        .select({ readerId: cardReaderHolders.readerId })
        .from(cardReaderHolders)
        .where(eq(cardReaderHolders.deviceId, a)),
      readerChoice: await suite.db
        .select({ readerId: deviceCardReaders.readerId })
        .from(deviceCardReaders)
        .where(eq(deviceCardReaders.deviceId, a)),
    };
  }

  /** A's choice of `item` for `role`, with `between` landing while the till's request is reading
   * its body, after requireSession has passed it. */
  async function racedChoice(
    role: EquipmentRole,
    item: string,
    between: () => Promise<void>,
    app: Hono = deviceApp,
  ) {
    let afterManagement: Awaited<ReturnType<typeof aState>> | undefined;
    const racing = new Hono();
    racing.use("/api/device/equipment", async (c, next) => {
      const parse = c.req.json.bind(c.req);
      c.req.json = async () => {
        await between();
        afterManagement = await aState();
        return parse();
      };
      await next();
    });
    racing.route("/", app);
    const res = await send(racing, venue.cookie, "PUT", "/api/device/equipment", {
      role,
      selection: { id: item },
      via: "list",
    });
    return { res, afterManagement, after: await aState() };
  }

  describe.each([
    ["Delete", "DELETE", ""],
    ["Disable", "POST", "/revoke"],
  ] as const)("a %s committed after the session check", (_name, method, suffix) => {
    it.each([
      ["receipt", () => pp],
      ["card_terminal", () => r3],
    ] as const)("refuses a %s choice and writes nothing for the device", async (role, item) => {
      const { res, afterManagement, after } = await racedChoice(role, item(), async () => {
        const res = await send(
          deviceApp,
          managerCookie,
          method,
          `/management-api/devices/${a}${suffix}`,
        );
        expect(res.status, JSON.stringify(res.json)).toBeLessThan(300);
      });

      expect(afterManagement).toBeDefined();
      expect(res.status).toBe(401);
      expect(res.json).toMatchObject({ code: "device.unauthorized" });
      expect(after).toEqual(afterManagement);
      expect(after).toMatchObject({
        columns: { receipt: null, slip: null, drawer: null },
        printerHolds: [],
        readerHolds: [],
      });
      if (method === "DELETE") expect(after.readerChoice).toEqual([]);
    });
  });

  /** Nothing of `item` reached A: the receipt column, a printer hold, a reader hold or choice. */
  function expectNothingOf(
    after: Awaited<ReturnType<typeof aState>>,
    afterManagement: Awaited<ReturnType<typeof aState>> | undefined,
    item: string,
  ) {
    expect(afterManagement).toBeDefined();
    expect(after).toEqual(afterManagement);
    expect(after.columns.receipt).not.toBe(item);
    expect(after.printerHolds.map((row) => row.printerId)).not.toContain(item);
    expect(after.readerHolds.map((row) => row.readerId)).not.toContain(item);
    expect(after.readerChoice.map((row) => row.readerId)).not.toContain(item);
  }

  it.each([
    ["receipt", () => pp],
    ["card_terminal", () => r3],
  ] as const)(
    "refuses a %s choice whose person signed out after the session check",
    async (role, item) => {
      const { res, afterManagement, after } = await racedChoice(role, item(), async () => {
        const out = await send(venue.app, venue.cookie, "DELETE", "/api/session");
        expect(out.status).toBe(200);
      });

      expect(res.status).toBe(401);
      expect(res.json).toMatchObject({ code: "session.required" });
      expectNothingOf(after, afterManagement, item());
    },
  );

  it.each([
    ["receipt", () => pp],
    ["card_terminal", () => r3],
  ] as const)(
    "refuses a %s choice when a Disable and then an Enable both land after the session check",
    async (role, item) => {
      // Join-api beside device-api on one pairing window, as boot wires them, so Pair can enable A.
      const pairingMode = createPairingMode();
      const app = new Hono();
      mountDeviceApi(
        app,
        { db: suite.db, cfg: venue.cfg, secureCookies: false, pairingMode },
        quiet,
      );
      mountJoinApi(
        app,
        { db: suite.db, cfg: venue.cfg, pairingMode, deviceAddress: "https://waitron.local" },
        quiet,
      );
      const hold = await send(app, managerCookie, "POST", "/management-api/pairing-mode/holds");
      expect(hold.status).toBe(200);
      const holdId = hold.json.holdId as string;

      const { res, afterManagement, after } = await racedChoice(
        role,
        item(),
        async () => {
          const off = await send(app, managerCookie, "POST", `/management-api/devices/${a}/revoke`);
          expect(off.status, JSON.stringify(off.json)).toBeLessThan(300);
          const knock = await send(app, venue.cookie, "POST", "/api/device/join", {
            name: "Barra",
          });
          expect(knock.status, JSON.stringify(knock.json)).toBe(200);
          expect(knock.json.joinId).toBe(a);
          const asks = await send(
            app,
            managerCookie,
            "GET",
            "/management-api/join-requests?kind=device",
          );
          const ask = (asks.json as unknown as { id: string; createdAt: string }[]).find(
            (row) => row.id === a,
          )!;
          const checked = await send(
            app,
            managerCookie,
            "POST",
            `/management-api/device-join-requests/${a}/check`,
            { choice: knock.json.verificationNumber, holdId, createdAt: ask.createdAt },
          );
          expect(checked.status, JSON.stringify(checked.json)).toBe(204);
          const paired = await send(
            app,
            managerCookie,
            "POST",
            `/management-api/device-join-requests/${a}/accept`,
            { name: "Barra", profileId },
          );
          expect(paired.status, JSON.stringify(paired.json)).toBe(200);
          const [row] = await suite.db
            .select({ active: devices.active })
            .from(devices)
            .where(eq(devices.id, a));
          expect(row!.active).toBe(true);
        },
        app,
      );

      expect(res.status).toBe(401);
      expect(res.json).toMatchObject({ code: "session.required" });
      expectNothingOf(after, afterManagement, item());
    },
  );

  it("no longer answers the old printers route, and stores nothing through it", async () => {
    const gone = await send(deviceApp, venue.cookie, "PUT", "/api/device/printers", {
      paymentSlipPrinterId: fp,
    });

    expect(gone.status).toBe(404);
    expect((await columns(a)).slip).toBeNull();
  });
});

describe("GET /api/till's readers", () => {
  it("the boot payload lists only the device's resolved reader", async () => {
    const counter = await seedReader("Mostrador", "stripe");
    await seedReader("Otro", "stripe");
    await readerList([r1, r2, r3, counter]);
    expect((await choose(venue.cookie, "card_terminal", { id: counter }, "list")).status).toBe(200);

    const res = await send(venue.app, venue.cookie, "GET", "/api/till");

    expect(res.status).toBe(200);
    expect(res.json).toMatchObject({
      cardProvider: "stripe_terminal",
      defaultReaderId: counter,
      activeReaders: [{ id: counter, name: "Mostrador", provider: "stripe_terminal" }],
    });
  });
});

describe("management: a device's equipment", () => {
  function patch(deviceId: string, changes: Record<string, unknown>) {
    return suite.db
      .select({
        name: devices.label,
        profileId: devices.deviceProfileId,
        receiptPrinterId: devices.receiptPrinterId,
        paymentSlipPrinterId: devices.paymentSlipPrinterId,
      })
      .from(devices)
      .where(eq(devices.id, deviceId))
      .then(([row]) =>
        send(deviceApp, managerCookie, "PATCH", `/management-api/devices/${deviceId}`, {
          ...row,
          ...changes,
        }),
      );
  }

  it("a portable printer another device holds is device.equipment_held under its field", async () => {
    expect((await choose(venue.cookie2, "receipt", { id: pp }, "list")).status).toBe(200);

    const res = await patch(a, { receiptPrinterId: pp });

    expect(res.status).toBe(409);
    expect(res.json).toMatchObject({
      code: "device.equipment_held",
      params: { field: "receiptPrinterId", holderDeviceId: b, holderDeviceName: "Terraza" },
    });
    expect(await printerHolder(pp)).toBe(b);
    expect((await columns(a)).receipt).toBeNull();
  });

  it("Use default (null) stores NULL", async () => {
    expect((await choose(venue.cookie, "receipt", { id: fp }, "list")).status).toBe(200);

    const res = await patch(a, { receiptPrinterId: null });

    expect(res.status).toBe(204);
    expect((await columns(a)).receipt).toBeNull();
  });

  it("cashDrawerPrinterId takes a listed drawer printer, and an absent one keeps it", async () => {
    const set = await patch(a, { cashDrawerPrinterId: dr });
    expect(set.status).toBe(204);
    expect((await columns(a)).drawer).toBe(dr);

    const kept = await patch(a, { name: "Barra 2" });
    expect(kept.status).toBe(204);
    expect((await columns(a)).drawer).toBe(dr);

    const unlisted = await patch(a, { cashDrawerPrinterId: fp });
    expect(unlisted.status).toBe(400);
    expect(unlisted.json).toEqual({
      code: "device.binding_invalid",
      params: { field: "cashDrawerPrinterId" },
    });
    expect((await columns(a)).drawer).toBe(dr);
  });

  it("lists what each device's roles resolve to, and its drawer choice", async () => {
    expect((await choose(venue.cookie, "cash_drawer", { id: dr }, "list")).status).toBe(200);
    expect((await choose(venue.cookie2, "receipt", { id: pp }, "scan")).status).toBe(200);
    await stalledPayment(venue.cookie);

    const res = await send(deviceApp, managerCookie, "GET", "/management-api/devices");

    expect(res.status).toBe(200);
    const rows = res.json as unknown as {
      id: string;
      cashDrawerPrinterId: string | null;
      equipment: RoleSummary[];
    }[];
    const rowA = rows.find((row) => row.id === a)!;
    const rowB = rows.find((row) => row.id === b)!;
    expect(rowA.cashDrawerPrinterId).toBe(dr);
    expect(rowA.equipment.map((role) => role.role)).toEqual([
      "receipt",
      "payment_slip",
      "cash_drawer",
      "invoice",
      "card_terminal",
    ]);
    expect(rowA.equipment).toEqual((await equipmentOf(venue.cookie)).map(summary));
    expect(rowB.equipment).toEqual((await equipmentOf(venue.cookie2)).map(summary));
    expect(roleOf(rowB.equipment, "receipt").resolved).toMatchObject({ id: pp });
    expect(roleOf(rowB.equipment, "card_terminal").resolved).toMatchObject({ id: r2 });
  });

  it("a stalled payment on a reader changes nothing in the devices list", async () => {
    const listed = async () => {
      const res = await send(deviceApp, managerCookie, "GET", "/management-api/devices");
      expect(res.status).toBe(200);
      return Object.fromEntries(
        (res.json as unknown as { id: string; equipment: RoleSummary[] }[]).map((row) => [
          row.id,
          row.equipment,
        ]),
      );
    };
    const before = await listed();

    await stalledPayment(venue.cookie);

    expect(roleOf(await equipmentOf(venue.cookie2), "card_terminal").choices).toContainEqual(
      expect.objectContaining({ id: r1, busy: true }),
    );
    expect(await listed()).toEqual(before);
  });
});

describe("the invoice role, which names a receipt printer or an A4 printer", () => {
  let office: string;

  beforeEach(async () => {
    office = await seedPagePrinter("Oficina");
    await printerLists({ invoicePrinterIds: [office, pp], invoicePrinterDefaultId: office });
  });

  it("lists the invoice role after the drawer, its choices carrying each printer's kind", async () => {
    const roles = await equipmentOf(venue.cookie);

    expect(roles.map((role) => role.role)).toEqual([
      "receipt",
      "payment_slip",
      "cash_drawer",
      "invoice",
      "card_terminal",
    ]);
    const invoice = roleOf(roles, "invoice");
    expect(invoice).toMatchObject({
      selection: "default",
      chosenId: null,
      resolved: { id: office, name: "Oficina", available: true },
    });
    expect(invoice.choices).toEqual([
      {
        id: office,
        name: "Oficina",
        kind: "a4",
        portable: false,
        available: true,
        busy: false,
        heldBy: null,
      },
      {
        id: pp,
        name: "Portátil",
        kind: "receipt",
        portable: true,
        available: true,
        busy: false,
        heldBy: null,
      },
    ]);
  });

  it("shows no holder on an invoice choice another device holds, while the receipt role does", async () => {
    expect((await choose(venue.cookie2, "receipt", { id: pp }, "scan")).status).toBe(200);

    const roles = await equipmentOf(venue.cookie);

    expect(roleOf(roles, "receipt").choices.find((c) => c.id === pp)!.heldBy).toMatchObject({
      deviceId: b,
    });
    expect(roleOf(roles, "invoice").choices.find((c) => c.id === pp)!.heldBy).toBeNull();
  });

  it.each(["a receipt", "an A4"] as const)("chooses %s printer for invoices", async (kind) => {
    const id = kind === "an A4" ? office : pp;

    const res = await choose(venue.cookie, "invoice", { id }, "list");

    expect(res.status, JSON.stringify(res.json)).toBe(200);
    const invoice = roleOf((res.json as { roles: RoleEquipment[] }).roles, "invoice");
    expect(invoice).toMatchObject({ selection: "item", chosenId: id, resolved: { id } });
    expect(invoice.chosen).toMatchObject({ id, kind: kind === "an A4" ? "a4" : "receipt" });
    expect(await printerHolder(pp)).toBeNull();
  });

  it("refuses an invoice printer the profile does not list, naming the invoice field", async () => {
    const res = await choose(venue.cookie, "invoice", { id: fp }, "list");

    expect(res.status).toBe(400);
    expect(res.json).toEqual({
      code: "device.binding_invalid",
      params: { field: "invoicePrinterId" },
    });
  });
});

describe("a deleted printer named by a stale choice", () => {
  const removePrinter = (id: string) => inTx((tx) => deletePrinter(tx, venue.cfg, id));

  async function deviceState(deviceId: string) {
    const [row] = await suite.db
      .select({
        name: devices.label,
        receipt: devices.receiptPrinterId,
        slip: devices.paymentSlipPrinterId,
        drawer: devices.cashDrawerPrinterId,
      })
      .from(devices)
      .where(eq(devices.id, deviceId));
    return { ...row!, holders: await suite.db.select().from(printerHolders) };
  }

  it.each(
    (["receipt", "payment_slip", "cash_drawer"] as const).flatMap((role) =>
      (
        [
          ["scan", undefined],
          ["list", undefined],
          ["list", true],
          ["scan", true],
        ] as const
      ).map(([via, takeOver]) => [role, via, takeOver] as const),
    ),
  )(
    "the till choosing it again for %s by %s (takeOver %s) is 400 printer.not_found, changing nothing",
    async (role, via, takeOver) => {
      const target = role === "cash_drawer" ? dr : fp;
      expect((await choose(venue.cookie, role, { id: target }, "list")).status).toBe(200);
      await removePrinter(target);
      const before = await deviceState(a);

      const res = await choose(venue.cookie, role, { id: target }, via, takeOver);

      expect(res.status).toBe(400);
      expect(res.json).toEqual({ code: "printer.not_found", params: { id: target } });
      expect(await deviceState(a)).toEqual(before);
    },
  );

  it("a scan taking over a deleted portable printer another device held is 400 printer.not_found", async () => {
    expect((await choose(venue.cookie2, "receipt", { id: pp }, "list")).status).toBe(200);
    await removePrinter(pp);
    const before = [await deviceState(a), await deviceState(b)];

    const res = await choose(venue.cookie, "receipt", { id: pp }, "scan", true);

    expect(res.status).toBe(400);
    expect(res.json).toEqual({ code: "printer.not_found", params: { id: pp } });
    expect([await deviceState(a), await deviceState(b)]).toEqual(before);
  });

  it("the till can still choose Use default and a printer that is not deleted", async () => {
    expect((await choose(venue.cookie, "receipt", { id: fp }, "list")).status).toBe(200);
    await removePrinter(fp);

    expect((await choose(venue.cookie, "receipt", "default", "list")).status).toBe(200);
    expect((await choose(venue.cookie, "payment_slip", { id: pp }, "list")).status).toBe(200);
    expect(await columns(a)).toEqual({ receipt: null, slip: pp, drawer: null });
  });

  function patchDevice(deviceId: string, changes: Record<string, unknown>) {
    return send(deviceApp, managerCookie, "PATCH", `/management-api/devices/${deviceId}`, {
      name: "Barra",
      profileId,
      receiptPrinterId: null,
      paymentSlipPrinterId: null,
      ...changes,
    });
  }

  it.each([
    ["receiptPrinterId", "receipt"],
    ["paymentSlipPrinterId", "payment_slip"],
    ["cashDrawerPrinterId", "cash_drawer"],
  ] as const)(
    "a manager's stale form resubmitting the deleted %s unchanged is 400 printer.not_found",
    async (field, role) => {
      const target = role === "cash_drawer" ? dr : fp;
      expect((await patchDevice(a, { [field]: target })).status).toBe(204);
      await removePrinter(target);
      const before = await deviceState(a);

      const res = await patchDevice(a, { [field]: target });

      expect(res.status).toBe(400);
      expect(res.json).toEqual({ code: "printer.not_found", params: { id: target } });
      expect(await deviceState(a)).toEqual(before);
    },
  );

  it("a stale form naming the deleted printer then a new one rolls back every field it changed", async () => {
    expect((await patchDevice(a, { receiptPrinterId: fp })).status).toBe(204);
    await removePrinter(fp);
    const before = await deviceState(a);

    const res = await patchDevice(a, {
      name: "Barra nueva",
      receiptPrinterId: fp,
      paymentSlipPrinterId: pp,
      cashDrawerPrinterId: dr,
    });

    expect(res.status).toBe(400);
    expect(res.json).toEqual({ code: "printer.not_found", params: { id: fp } });
    expect(await deviceState(a)).toEqual(before);
  });

  it("a stored choice still naming a deleted printer, resubmitted unchanged, is 400 printer.not_found", async () => {
    expect((await patchDevice(a, { receiptPrinterId: fp })).status).toBe(204);
    // Only the tombstone: a real delete clears the choice, so this pins a backstop for a state it
    // never leaves.
    await suite.db
      .update(printers)
      .set({ active: false, deletedAt: new Date().toISOString() })
      .where(eq(printers.id, fp));
    const before = await deviceState(a);

    const res = await patchDevice(a, { name: "Barra nueva", receiptPrinterId: fp });

    expect(res.status).toBe(400);
    expect(res.json).toEqual({ code: "printer.not_found", params: { id: fp } });
    expect(await deviceState(a)).toEqual(before);
  });

  it("a manager can still clear the role and choose a printer that is not deleted", async () => {
    expect((await patchDevice(a, { receiptPrinterId: fp })).status).toBe(204);
    await removePrinter(fp);

    const res = await patchDevice(a, { receiptPrinterId: null, paymentSlipPrinterId: pp });

    expect(res.status).toBe(204);
    expect(await columns(a)).toEqual({ receipt: null, slip: pp, drawer: null });
  });
});

describe("a deleted reader", () => {
  const RING = loadKeyRing({
    WAITRON_CREDENTIALS_KEY: Buffer.alloc(32, 7).toString("base64"),
    WAITRON_CREDENTIALS_KEY_VERSION: "1",
  });
  const unused = (): never => {
    throw new Error("the fake seat is only asked to unpair");
  };
  let removed: string[];
  /** Run inside the seat's `remove`, while a delete is at the provider. */
  let duringRemove: () => Promise<void>;
  /** The bill venue's `fake` provider as a seat that unpairs, recording each provider id removed. */
  const fakeSeat: CardProviderContribution = {
    providerId: "fake",
    credentialPurpose: "payments.stripe",
    credentialFields: [],
    readerAdd: { kind: "reference", refLabelKey: "x" },
    connect: unused,
    build: unused,
    readers: {
      canUnpair: true,
      list: unused,
      add: unused,
      status: unused,
      remove: async (_deps, providerRef) => {
        removed.push(providerRef);
        await duringRemove();
      },
    },
  };
  let paymentsApp: Hono;

  beforeEach(async () => {
    removed = [];
    duringRemove = async () => {};
    await inTx((tx) =>
      putCredential(tx, RING, {
        purpose: "payments.stripe",
        value: {
          secretKey: "sk_test_deleted_reader",
          webhookSecret: "whsec_test",
          successUrl: "https://example.test/ok",
          cancelUrl: "https://example.test/cancel",
        },
      }),
    );
    paymentsApp = new Hono();
    mountPaymentsApi(
      paymentsApp,
      {
        admission: testTradingAdmission(),
        db: suite.db,
        backend: venue.backend,
        clock: venue.clock,
        cfg: venue.cfg,
        ring: RING,
        environment: "preproduction",
        pool: venue.pool,
        providers: [fakeSeat],
      },
      quiet,
    );
  });

  async function deleteReader(id: string) {
    const res = await send(
      paymentsApp,
      managerCookie,
      "DELETE",
      `/management-api/payments/readers/${id}`,
    );
    expect(res.status, JSON.stringify(res.json)).toBe(200);
  }

  async function readerState() {
    return {
      choices: await readerChoices(),
      holders: await suite.db.select().from(cardReaderHolders),
    };
  }

  function billRowsOf(billId: string) {
    return suite.db
      .select({ state: billPayments.state })
      .from(billPayments)
      .where(eq(billPayments.workingOrderId, billId));
  }

  it.each([
    ["list", undefined],
    ["list", true],
    ["scan", undefined],
    ["scan", true],
  ] as const)(
    "the till choosing the deleted reader again by %s (takeOver %s) is 400 reader.not_found, changing nothing",
    async (via, takeOver) => {
      await deleteReader(r1);
      expect(removed).toEqual(["reader-1"]);
      const before = await readerState();

      const res = await choose(venue.cookie, "card_terminal", { id: r1 }, via, takeOver);

      expect(res.status).toBe(400);
      expect(res.json).toEqual({ code: "reader.not_found", params: { id: r1 } });
      expect(await readerState()).toEqual(before);
    },
  );

  it("a scan taking over a deleted reader another device held is 400 reader.not_found", async () => {
    await deleteReader(r2);
    const before = await readerState();

    const res = await choose(venue.cookie, "card_terminal", { id: r2 }, "scan", true);

    expect(res.status).toBe(400);
    expect(res.json).toEqual({ code: "reader.not_found", params: { id: r2 } });
    expect(await readerState()).toEqual(before);
  });

  it("the till can still choose Use default, and an unlisted reader that is not deleted is still device.binding_invalid", async () => {
    await deleteReader(r1);

    expect((await choose(venue.cookie, "card_terminal", "default", "list")).status).toBe(200);
    expect((await choose(venue.cookie, "card_terminal", { id: r3 }, "list")).status).toBe(200);
    expect(await readerChoices()).toEqual({ [a]: r3, [b]: r2 });

    const unlisted = await seedReader("Sin lista");
    const res = await choose(venue.cookie, "card_terminal", { id: unlisted }, "scan", true);
    expect(res.status).toBe(400);
    expect(res.json).toEqual({
      code: "device.binding_invalid",
      params: { field: "cardReaderId" },
    });
  });

  it("/api/pay naming the deleted reader is 404 reader.not_found, charging nothing and writing no payment", async () => {
    await deleteReader(r1);
    const calls = venue.card.collectCalls.length;

    const named = await pay(venue.cookie, r1);

    expect(named.status).toBe(404);
    expect(named.json).toEqual({ code: "reader.not_found", params: { id: r1 } });
    expect(await paymentsOf(named.workingOrderId)).toEqual([]);
    expect(venue.card.collectCalls.length).toBe(calls);
  });

  it("a card bill payment naming the deleted reader is 404 reader.not_found, charging nothing", async () => {
    await deleteReader(r1);
    const billId = await tabWith(venue, "Tarta");
    const calls = venue.card.collectCalls.length;

    const paid = await cardOnBill(billId, venue.cookie, r1);

    expect(paid.status).toBe(404);
    expect(paid.json).toEqual({ code: "reader.not_found", params: { id: r1 } });
    expect(await paymentsOf(billId)).toEqual([]);
    expect(await billRowsOf(billId)).toEqual([]);
    expect(venue.card.collectCalls.length).toBe(calls);
  });

  it("while the delete is at the provider, Enable is refused and a pay naming the reader is 404 reader.not_found, charging nothing", async () => {
    const calls = venue.card.collectCalls.length;
    let enabled: { status: number; json: unknown } | undefined;
    let paid: Awaited<ReturnType<typeof pay>> | undefined;
    duringRemove = async () => {
      enabled = await send(
        paymentsApp,
        managerCookie,
        "POST",
        `/management-api/payments/readers/${r1}/enable`,
      );
      paid = await pay(venue.cookie, r1);
    };

    await deleteReader(r1);

    expect(enabled).toMatchObject({
      status: 409,
      json: { code: "reader.unpair_in_progress", params: { readerId: r1 } },
    });
    expect(paid).toMatchObject({
      status: 404,
      json: { code: "reader.not_found", params: { id: r1 } },
    });
    expect(await paymentsOf(paid!.workingOrderId)).toEqual([]);
    expect(venue.card.collectCalls.length).toBe(calls);
  });

  describe("once the delete has switched the reader off, before the provider is called", () => {
    const prepare = (id: string) =>
      inTx((tx) => prepareCardReaderDelete(tx, [fakeSeat], id)).then((plan) => {
        expect(plan.unpairAtProvider).toBe(true);
      });

    it("control: before it, the same pays reach the provider", async () => {
      const calls = venue.card.collectCalls.length;

      const named = await pay(venue.cookie, r1);
      const resolved = await pay(venue.cookie);

      expect([named.status, resolved.status]).toEqual([200, 200]);
      expect(venue.card.collectCalls.length).toBe(calls + 2);
    });

    it("a pay naming the reader and a pay on the device's own choice are 404 reader.not_found, writing no payment", async () => {
      await prepare(r1);
      const calls = venue.card.collectCalls.length;

      const named = await pay(venue.cookie, r1);
      const resolved = await pay(venue.cookie);

      for (const res of [named, resolved]) {
        expect(res.status).toBe(404);
        expect(res.json).toEqual({ code: "reader.not_found", params: { id: r1 } });
        expect(await paymentsOf(res.workingOrderId)).toEqual([]);
      }
      expect(venue.card.collectCalls.length).toBe(calls);
      expect(removed).toEqual([]);
    });
  });
});

describe("GET /api/device/equipment's notices", () => {
  const READING = { instant: new Date("2026-10-22T10:00:00.000Z"), offsetMinutes: 120 };
  const notice = (key: string, severity: StaffNotice["severity"]): StaffNotice => ({
    key,
    code: `test.${key}`,
    severity,
    params: {},
  });
  const answering = (owner: string, ...notices: StaffNotice[]): OwnedStaffNoticeSource => ({
    owner,
    source: { read: () => Promise.resolve(notices) },
  });

  function noticeApp(
    sources: readonly OwnedStaffNoticeSource[],
    over: Partial<NonNullable<DeviceApiDeps["notices"]>> = {},
    log: Logger = quiet,
  ): Hono {
    const app = new Hono();
    mountDeviceApi(
      app,
      {
        db: suite.db,
        cfg: venue.cfg,
        secureCookies: false,
        pairingMode: createPairingMode(),
        notices: {
          sources,
          clock: { now: () => ({ ...READING, confident: true }) as never },
          filing: () => ({ enabled: false }),
          ...over,
        },
      },
      log,
    );
    return app;
  }

  async function read(app: Hono) {
    const res = await send(app, venue.cookie, "GET", "/api/device/equipment");
    expect(res.status).toBe(200);
    return res.json as {
      roles: RoleEquipment[];
      notices: (StaffNotice & { owner: string })[];
      noticesUnavailable: string[];
    };
  }

  const diskFull = () => {
    const disk = createDiskFullState({
      dir: mkdtempSync(join(tmpdir(), "equipment-notices-")),
      now: () => new Date(),
      log: quiet,
    });
    disk.noteRefused();
    return disk;
  };

  it("with no notice dependencies, answers none", async () => {
    const roles = await equipmentOf(venue.cookie);
    const body = await read(deviceApp);
    expect(body.notices).toEqual([]);
    expect(body.noticesUnavailable).toEqual([]);
    expect(body.roles).toEqual(roles);
  });

  it("severity first, then the order of the sources", async () => {
    const body = await read(
      noticeApp([
        answering("box", notice("box-warning", "warning")),
        answering("m", notice("m-error", "error"), notice("m-notice", "notice")),
      ]),
    );
    expect(body.notices.map(({ key, owner }) => ({ key, owner }))).toEqual([
      { key: "m-error", owner: "m" },
      { key: "box-warning", owner: "box" },
      { key: "m-notice", owner: "m" },
    ]);
    expect(body.noticesUnavailable).toEqual([]);
  });

  it("every source is asked with one reading of the clock and the filing fact", async () => {
    const seen: StaffNoticeReadContext[] = [];
    const recording = (owner: string): OwnedStaffNoticeSource => ({
      owner,
      source: {
        read: (ctx) => {
          seen.push(ctx);
          return Promise.resolve([]);
        },
      },
    });
    let calls = 0;
    const app = noticeApp([recording("one"), recording("two")], {
      clock: {
        now: () => {
          calls += 1;
          return { instant: new Date(), offsetMinutes: 0, confident: true } as never;
        },
      },
      filing: () => ({ enabled: true }),
    });
    await read(app);
    expect(seen).toHaveLength(2);
    expect(seen[0]!.reading).toBe(seen[1]!.reading);
    expect(calls).toBe(1);
    expect(seen.map((ctx) => ctx.filing)).toEqual([{ enabled: true }, { enabled: true }]);
  });

  it("a failing source is named, and logged once over three reads, and its recovery once", async () => {
    const lines: string[] = [];
    let reads = 0;
    const app = noticeApp(
      [
        {
          owner: "f",
          source: {
            read: () => {
              reads += 1;
              return reads <= 3 ? Promise.reject(new Error("down")) : Promise.resolve([]);
            },
          },
        },
      ],
      {},
      (_level, event) => lines.push(event),
    );
    for (let i = 0; i < 3; i += 1) expect((await read(app)).noticesUnavailable).toEqual(["f"]);
    expect(lines.filter((event) => event === "staff_notice.source_unavailable")).toHaveLength(1);
    expect((await read(app)).noticesUnavailable).toEqual([]);
    expect(lines.filter((event) => event === "staff_notice.source_recovered")).toHaveLength(1);
  });

  it("the box's real source: red while the stop is noted", async () => {
    const box = boxStaffNoticeSource({
      disk: diskFull(),
      space: createFreeSpaceState({ log: quiet }),
    });
    const body = await read(noticeApp([{ owner: BOX_NOTICE_OWNER, source: box }]));
    expect(body.notices).toEqual([
      {
        key: "storage.disk_full",
        code: "storage.disk_full",
        severity: "error",
        params: {},
        owner: "box",
      },
    ]);
  });

  // A pin: the PUT already answers the equipment alone.
  it("the PUT answers no notices", async () => {
    const app = noticeApp([answering("box", notice("box-error", "error"))]);
    const res = await send(app, venue.cookie, "PUT", "/api/device/equipment", {
      role: "receipt",
      selection: "default",
      via: "list",
    });
    expect(res.status).toBe(200);
    expect(res.json).not.toHaveProperty("notices");
    expect(res.json).not.toHaveProperty("noticesUnavailable");
  });

  describe("printer notices", () => {
    const ago = (ms: number) => new Date(READING.instant.getTime() - ms).toISOString();
    const MINUTE = 60_000;

    const printerApp = () =>
      noticeApp([], {
        deviceSources: devicePrinterNoticeSources({
          now: () => READING.instant,
          locationId: venue.cfg.locationId,
          cacheMs: 0,
        }),
      });

    async function job(
      printerId: string,
      createdAt: string,
      over: { status?: "queued" | "done" | "failed"; attempts?: number } = {},
    ): Promise<string> {
      const [row] = await suite.db
        .insert(printJobs)
        .values({
          locationId: venue.cfg.locationId,
          printerId,
          payload: Uint8Array.from([1]),
          kind: "document",
          status: over.status ?? "queued",
          attempts: over.attempts ?? 0,
          createdAt,
        })
        .returning({ id: printJobs.id });
      return row!.id;
    }

    async function kitchenPrinter(): Promise<string> {
      const id = await seedPrinter("Kitchen");
      const [station] = await suite.db
        .insert(kitchenStations)
        .values({ locationId: venue.cfg.locationId, name: "Kitchen", isDefault: false })
        .returning({ id: kitchenStations.id });
      await suite.db.insert(stationPrinters).values({ stationId: station!.id, printerId: id });
      return id;
    }

    async function noticesOf(app: Hono, cookie: string) {
      const res = await send(app, cookie, "GET", "/api/device/equipment");
      expect(res.status).toBe(200);
      return (res.json as { notices: (StaffNotice & { owner: string })[] }).notices;
    }
    const printerNotices = async (app: Hono, cookie: string) =>
      (await noticesOf(app, cookie)).filter((n) => n.owner === "printers");

    it("a stuck kitchen printer shows on both tills", async () => {
      const id = await kitchenPrinter();
      const since = ago(3 * MINUTE);
      await job(id, since);
      const app = printerApp();
      for (const cookie of [venue.cookie, venue.cookie2]) {
        expect(await noticesOf(app, cookie)).toContainEqual({
          owner: "printers",
          key: `printer.jobs_waiting:${id}`,
          code: "printer.jobs_waiting",
          severity: "warning",
          params: { printer: "Kitchen", since },
        });
      }
    });

    it("a kitchen printer that printed a later ticket shows nothing, and the bell still names it", async () => {
      const id = await kitchenPrinter();
      await job(id, ago(10 * MINUTE), { status: "failed", attempts: MAX_DELIVERY_ATTEMPTS });
      const done = await job(id, ago(5 * MINUTE), { status: "done" });
      const app = printerApp();
      for (const cookie of [venue.cookie, venue.cookie2]) {
        expect(await printerNotices(app, cookie)).toEqual([]);
      }
      const alerts = await inTx((tx) =>
        printingAlertSource().read({ tx, now: READING.instant } as never),
      );
      expect(alerts.map((alert) => alert.key)).toContain(`printer.jobs_waiting:${id}`);

      await suite.db.delete(printJobs).where(eq(printJobs.id, done));
      expect((await printerNotices(app, venue.cookie)).map((n) => n.key)).toEqual([
        `printer.jobs_waiting:${id}`,
      ]);
    });

    it("a receipt printer's notice shows only on the till whose receipts go to it, and on one whose slips do", async () => {
      expect((await choose(venue.cookie, "receipt", { id: fp }, "list")).status).toBe(200);
      expect((await choose(venue.cookie2, "receipt", { id: pp }, "list")).status).toBe(200);
      expect(await inTx((tx) => documentPrintersOf(tx, b))).not.toContain(fp);
      await job(fp, ago(3 * MINUTE));
      const app = printerApp();
      const key = `printer.jobs_waiting:${fp}`;
      expect((await printerNotices(app, venue.cookie)).map((n) => n.key)).toEqual([key]);
      expect(await printerNotices(app, venue.cookie2)).toEqual([]);

      expect((await choose(venue.cookie2, "payment_slip", { id: fp }, "list")).status).toBe(200);
      expect((await printerNotices(app, venue.cookie2)).map((n) => n.key)).toEqual([key]);
    });

    it("a ticket under two minutes old shows nothing", async () => {
      const id = await kitchenPrinter();
      await job(id, ago(MINUTE));
      const app = printerApp();
      for (const cookie of [venue.cookie, venue.cookie2]) {
        expect(await printerNotices(app, cookie)).toEqual([]);
      }
    });

    it("a failing printer check names only its owner, and the box's notices still come", async () => {
      const body = await read(
        noticeApp([answering("box", notice("box-error", "error"))], {
          deviceSources: () => [
            { owner: "printers", source: { read: () => Promise.reject(new Error("boom")) } },
          ],
        }),
      );
      expect(body.noticesUnavailable).toEqual(["printers"]);
      expect(body.notices.map((n) => n.key)).toContain("box-error");
    });
  });

  it("the box's red comes before a module's red", async () => {
    const module = {
      name: "m",
      staffNotices: [{ read: () => Promise.resolve([notice("m-error", "error")]) }],
    } as unknown as WaitronModule;
    const sources = deviceNoticeSources(
      { disk: diskFull(), space: createFreeSpaceState({ log: quiet }) },
      [module],
    );
    const body = await read(noticeApp(sources));
    expect(body.notices.map(({ key, owner }) => ({ key, owner }))).toEqual([
      { key: "storage.disk_full", owner: "box" },
      { key: "m-error", owner: "m" },
    ]);
  });
});

describe("the device's clock on the equipment read", () => {
  type Noted = Parameters<ClockWitnessStore["noteDevice"]>;

  function clockApp(requestFromBox: DeviceApiDeps["requestFromBox"] = () => false) {
    const noted: Noted[] = [];
    let wall = 1_792_000_000_000;
    let mono = 5_000;
    const app = new Hono();
    mountDeviceApi(
      app,
      {
        db: suite.db,
        cfg: venue.cfg,
        secureCookies: false,
        pairingMode: createPairingMode(),
        clockWitnesses: { noteDevice: (...args) => void noted.push(args) },
        clock: { wall: () => (wall += 1_000), monotonic: () => (mono += 7) },
        requestFromBox,
      },
      quiet,
    );
    return { app, noted };
  }

  const read = (app: Hono, headers: Record<string, string>, remoteAddress?: string) =>
    app.request(
      "/api/device/equipment",
      { headers },
      remoteAddress === undefined ? undefined : { incoming: { socket: { remoteAddress } } },
    );

  it("notes the device's id, its address, its clock and the box's first readings when the request arrived", async () => {
    const { app, noted } = clockApp();
    const res = await read(
      app,
      { cookie: venue.cookie, "x-waitron-device-clock": "1792000060000" },
      "192.168.10.31",
    );
    expect(res.status).toBe(200);
    expect(noted).toEqual([
      [a, "192.168.10.31", 1_792_000_060_000, { wallMs: 1_792_000_001_000, monoMs: 5_007 }],
    ]);
  });

  it("notes nothing from a till or browser on the box itself, and still answers the equipment", async () => {
    const { app, noted } = clockApp(() => true);
    const res = await read(
      app,
      { cookie: venue.cookie, "x-waitron-device-clock": "1792000060000" },
      "192.168.10.31",
    );
    expect(res.status).toBe(200);
    expect(noted).toEqual([]);
  });

  describe("through the box's real check of where a request came from", () => {
    const interfaces = (() => ({
      eth0: [{ address: "192.168.10.20", family: "IPv4", internal: false }],
      lo: [{ address: "127.0.0.1", family: "IPv4", internal: true }],
    })) as unknown as typeof networkInterfaces;
    const realCheck = (c: Context) => requestFromBox(c, { interfaces });
    const headers = () => ({ cookie: venue.cookie, "x-waitron-device-clock": "1792000060000" });

    it("notes nothing from the box's own address", async () => {
      const { app, noted } = clockApp(realCheck);
      expect((await read(app, headers(), "192.168.10.20")).status).toBe(200);
      expect(noted).toEqual([]);
    });

    it("notes nothing from a request with no connection to read", async () => {
      const { app, noted } = clockApp(realCheck);
      expect((await read(app, headers())).status).toBe(200);
      expect(noted).toEqual([]);
    });

    it("notes once, with its address, a device elsewhere on the network", async () => {
      const { app, noted } = clockApp(realCheck);
      expect((await read(app, headers(), "192.168.10.31")).status).toBe(200);
      expect(noted).toEqual([[a, "192.168.10.31", 1_792_000_060_000, expect.anything()]]);
    });

    it("notes an IPv4-mapped or scoped address in the plain form the box's own check compares", async () => {
      const { app, noted } = clockApp(realCheck);
      expect((await read(app, headers(), "::ffff:192.168.10.31")).status).toBe(200);
      expect((await read(app, headers(), "192.168.10.31")).status).toBe(200);
      expect((await read(app, headers(), "fe80::2%eth0")).status).toBe(200);
      expect(noted.map(([, address]) => address)).toEqual([
        "192.168.10.31",
        "192.168.10.31",
        "fe80::2",
      ]);
      expect((await read(app, headers(), "::ffff:192.168.10.20")).status).toBe(200);
      expect(noted).toHaveLength(3);
    });
  });

  it("reads the box's clocks before waiting for the write lock the device's sighting needs", async () => {
    await suite.db.update(devices).set({ lastSeenAt: null }).where(eq(devices.id, a));
    const noted: Noted[] = [];
    let wallCalls = 0;
    let locked = true;
    const app = new Hono();
    mountDeviceApi(
      app,
      {
        db: suite.db,
        cfg: venue.cfg,
        secureCookies: false,
        pairingMode: createPairingMode(),
        clockWitnesses: { noteDevice: (...args) => void noted.push(args) },
        clock: {
          wall: () => (wallCalls++, locked ? 1_792_000_000_000 : 1_792_000_090_000),
          monotonic: () => 5_000,
        },
        requestFromBox: () => false,
      },
      quiet,
    );
    let release!: () => void;
    const held = suite.db.withWriteLock(() => new Promise<void>((r) => (release = r)));
    const answer = read(app, { cookie: venue.cookie, "x-waitron-device-clock": "1792000060000" });
    try {
      await vi.waitFor(() => expect(wallCalls).toBe(1));
    } finally {
      locked = false;
      release();
    }
    await held;
    expect((await answer).status).toBe(200);
    expect(noted).toEqual([
      [a, undefined, 1_792_000_060_000, { wallMs: 1_792_000_000_000, monoMs: 5_000 }],
    ]);
  });

  it.each([
    ["no header", undefined],
    ["letters", "abc"],
    ["an empty value", ""],
    ["a fraction", "1792000060000.5"],
    ["a sign", "-1792000060000"],
    ["a number past a safe integer", "9007199254740993"],
  ])("notes nothing for %s, and still answers the equipment", async (_, value) => {
    const { app, noted } = clockApp();
    const res = await read(app, {
      cookie: venue.cookie,
      ...(value === undefined ? {} : { "x-waitron-device-clock": value }),
    });
    expect(res.status).toBe(200);
    expect(noted).toEqual([]);
  });

  it("refuses an unpaired request as before and notes nothing", async () => {
    const { app, noted } = clockApp();
    const res = await read(app, { "x-waitron-device-clock": "1792000060000" });
    expect(res.status).toBe(401);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe(
      "device.unauthorized",
    );
    expect(noted).toEqual([]);
  });
});
