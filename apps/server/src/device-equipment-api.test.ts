import { randomUUID } from "node:crypto";
import { Hono } from "hono";
import { and, eq, inArray, sql } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { devices, locations, printerHolders, printers, withTransaction } from "@waitron/db";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { startManagementSession } from "@waitron/identity";
import { emptyPrinterLists, setProfilePrinterLists } from "@waitron/layouts";
import type { ProfilePrinterLists } from "@waitron/layouts";
import {
  cardReaderHolders,
  cardReaders,
  deviceCardReaders,
  failAttempting,
  payments,
  setProfileReaderList,
} from "@waitron/payments";
import { MANAGEMENT_COOKIE } from "@waitron/server-kit";
import { mountDeviceApi } from "./device-api.js";
import type { EquipmentRole, RoleEquipment, RoleSummary } from "./device-equipment.js";
import type { Logger } from "./logger.js";
import { createPairingMode } from "./pairing-mode.js";
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
          stationId: null,
          watcherId: null,
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
