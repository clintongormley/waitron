import { randomUUID } from "node:crypto";
import { Hono } from "hono";
import { eq, inArray } from "drizzle-orm";
import { beforeAll, describe, expect, it, vi } from "vitest";
import {
  deviceProfiles,
  devices,
  locations,
  printerHolders,
  printJobs,
  printers,
  withTransaction,
} from "@waitron/db";
import type { Transaction } from "@waitron/db";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { VerifactuBackend } from "@waitron/fiscal-verifactu";
import type { FiscalBackend, TrustedClock } from "@waitron/fiscal";
import { endDeviceSessions, endSession, hashPin, loginWithPin, persons } from "@waitron/identity";
import {
  CAPABILITY_FLAGS,
  emptyPrinterLists,
  resolveDevicePrinterId,
  selectDevicePrinter,
  setProfilePrinterLists,
} from "@waitron/layouts";
import type { ProfilePrinterLists } from "@waitron/layouts";
import {
  cardReaderHolders,
  cardReaders,
  deviceCardReaders,
  resolveDeviceReaderId,
  selectDeviceReader,
  setProfileReaderList,
} from "@waitron/payments";
import { departmentSalePolicies, departments } from "@waitron/venue-service";
import { deviceOrigin } from "@waitron/shared";
import { deploymentEnvironment } from "./config.js";
import { approveDeviceProfiles, switchActiveProfile } from "./device.js";
import { mountDeviceApi } from "./device-api.js";
import { readDeviceEquipment, readDevicesEquipment } from "./device-equipment.js";
import { acceptDeviceJoinRequest, createJoinRequest } from "./join-requests.js";
import type { Logger } from "./logger.js";
import { createPairingMode } from "./pairing-mode.js";
import { resolvePaymentSlipPrinter } from "./receipt-print.js";
import { recordTillSale } from "./till-sale.js";
import { enrolDeviceForTest } from "./testing/enrol.js";
import { setupVenue, type Venue } from "./testing/venue-fixtures.js";
import { offerProducts } from "./testing/zone-offers.js";

const suite = useVenueDb({
  migrations: migrationOptionsFor(manifestSets(), null),
  timeoutMs: 60_000,
});
const noopLog: Logger = () => {};
const OPERATOR = "0000ffff-3333-4000-8000-0000000000bb";

let backend: FiscalBackend;
let clock: TrustedClock;

beforeAll(() => {
  clock = {
    now: () => {
      const instant = new Date();
      return {
        instant,
        offsetMinutes: -instant.getTimezoneOffset(),
        confident: true,
        confidence: "anchored",
        anchorAgeSeconds: 0,
      };
    },
    anchor: () => {
      throw new Error("device-equipment.test: anchor() is not used here");
    },
    currentAnchor: () => null,
  };
  backend = new VerifactuBackend({
    clock,
    db: suite.db,
    environment: deploymentEnvironment(process.env),
    deploymentEnvironment: deploymentEnvironment(process.env),
    resolveClient: () =>
      Promise.reject(new Error("device-equipment.test: resolveClient must never be called")),
  });
});

const inTx = <T>(fn: (tx: Transaction) => Promise<T>) => withTransaction(suite.db, fn);

let profileCounter = 0;
async function seedProfile(): Promise<string> {
  profileCounter += 1;
  const [row] = await suite.db
    .insert(deviceProfiles)
    .values({
      name: `Equipment ${profileCounter}`,
      formFactor: "till",
      capabilities: [...CAPABILITY_FLAGS],
    })
    .returning({ id: deviceProfiles.id });
  return row!.id;
}

async function seedPrinter(
  venue: Venue,
  name: string,
  opts: { portable?: boolean; hasCashDrawer?: boolean } = {},
): Promise<string> {
  const [row] = await suite.db
    .insert(printers)
    .values({
      locationId: venue.cfg.locationId,
      name,
      transport: "network_tcp",
      host: "10.0.0.9",
      portable: opts.portable ?? false,
      hasCashDrawer: opts.hasCashDrawer ?? false,
    })
    .returning({ id: printers.id });
  return row!.id;
}

async function seedReader(name: string): Promise<string> {
  const [row] = await suite.db
    .insert(cardReaders)
    .values({ provider: "sumup", providerRef: `${name}-${randomUUID()}`, name })
    .returning({ id: cardReaders.id });
  return row!.id;
}

function printerLists(profileId: string, partial: Partial<ProfilePrinterLists>) {
  return inTx((tx) =>
    setProfilePrinterLists(tx, profileId, { ...emptyPrinterLists(), ...partial }),
  );
}

function readerList(profileId: string, readerIds: string[], defaultReaderId: string | null) {
  return inTx((tx) => setProfileReaderList(tx, profileId, { readerIds, defaultReaderId }));
}

async function enrol(venue: Venue, name: string, profileId: string): Promise<string> {
  return (await enrolDeviceForTest(suite.db, venue.cfg, { name, profileId })).deviceId;
}

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

async function readerChoice(deviceId: string): Promise<string | null> {
  const [row] = await suite.db
    .select({ readerId: deviceCardReaders.readerId })
    .from(deviceCardReaders)
    .where(eq(deviceCardReaders.deviceId, deviceId));
  return row?.readerId ?? null;
}

async function printerHoldersOf(ids: string[]): Promise<Record<string, string>> {
  const rows = await suite.db
    .select()
    .from(printerHolders)
    .where(inArray(printerHolders.printerId, ids));
  return Object.fromEntries(rows.map((r) => [r.printerId, r.deviceId]));
}

async function readerHoldersOf(ids: string[]): Promise<Record<string, string>> {
  const rows = await suite.db
    .select()
    .from(cardReaderHolders)
    .where(inArray(cardReaderHolders.readerId, ids));
  return Object.fromEntries(rows.map((r) => [r.readerId, r.deviceId]));
}

async function signIn(deviceId: string, displayName = "Lucía") {
  const [person] = await suite.db
    .insert(persons)
    .values({ displayName, pinHash: hashPin("4321"), role: "staff" })
    .returning({ id: persons.id });
  const session = await inTx((tx) =>
    loginWithPin(tx, { deviceId, personId: person!.id, pin: "4321" }),
  );
  return { personId: person!.id, sessionId: session.id, token: session.token };
}

async function cashSale(venue: Venue, deviceId: string): Promise<void> {
  const departmentIds = (
    await suite.db
      .select({ id: departments.id })
      .from(departments)
      .where(eq(departments.locationId, venue.cfg.locationId))
  ).map((row) => row.id);
  await suite.db
    .update(departmentSalePolicies)
    .set({ receiptPrintMode: "auto" })
    .where(inArray(departmentSalePolicies.departmentId, departmentIds));
  const cfg = { ...venue.cfg, origin: deviceOrigin(deviceId) };
  const offers = await inTx((tx) => offerProducts(tx, cfg));
  await recordTillSale(
    { db: suite.db, backend, clock },
    cfg,
    {
      zoneId: offers.zoneId,
      lines: offers.toOfferLines([{ productId: venue.aguaId, quantity: "1" }]),
      tender: { method: "cash", amount: "2.00" },
    },
    OPERATOR,
  );
}

async function documentJobPrinters(): Promise<string[]> {
  const rows = await suite.db
    .select({ printerId: printJobs.printerId })
    .from(printJobs)
    .where(eq(printJobs.kind, "document"));
  return rows.map((row) => row.printerId);
}

/** A device coming back with the cookie it was disabled with, accepted under `profileId`. */
async function reEnable(venue: Venue, deviceId: string, profileId: string): Promise<void> {
  const [row] = await suite.db
    .select({ tokenHash: devices.tokenHash })
    .from(devices)
    .where(eq(devices.id, deviceId));
  await inTx(async (tx) => {
    const made = await createJoinRequest(tx, venue.cfg, {
      kind: "device",
      label: "Caja",
      returning: { deviceId, tokenHash: row!.tokenHash },
    });
    await acceptDeviceJoinRequest(tx, venue.cfg, made.joinId, { label: "Caja", profileId });
  });
}

function mountApp(venue: Venue): Hono {
  const app = new Hono();
  mountDeviceApi(
    app,
    { db: suite.db, cfg: venue.cfg, secureCookies: false, pairingMode: createPairingMode() },
    noopLog,
  );
  return app;
}

function managerRequest(
  app: Hono,
  venue: Venue,
  method: "POST" | "PATCH",
  path: string,
  body?: unknown,
) {
  return app.request(path, {
    method,
    headers: { cookie: venue.managerCookie, "content-type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

describe("a device's equipment as it joins, switches profile and is revoked", () => {
  it("a newly accepted device starts on Use default and takes its profile's free portable defaults", async () => {
    const venue = await setupVenue(suite.db);
    const profile = await seedProfile();
    const handheld = await seedPrinter(venue, "Handheld", { portable: true });
    const bar = await seedPrinter(venue, "Bar");
    const reader = await seedReader("Reader");
    await printerLists(profile, {
      receiptPrinterIds: [handheld, bar],
      receiptPrinterDefaultId: handheld,
      paymentSlipPrinterIds: [bar],
      paymentSlipPrinterDefaultId: bar,
    });
    await readerList(profile, [reader], reader);

    const a = await enrol(venue, "Caja A", profile);
    const b = await enrol(venue, "Caja B", profile);

    expect(await columns(a)).toEqual({ receipt: null, slip: null, drawer: null });
    expect(await readerChoice(a)).toBeNull();
    expect(await printerHoldersOf([handheld, bar])).toEqual({ [handheld]: a });
    expect(await readerHoldersOf([reader])).toEqual({ [reader]: a });
    expect(await inTx((tx) => resolveDevicePrinterId(tx, a, "receipt"))).toBe(handheld);
    expect(await inTx((tx) => resolveDeviceReaderId(tx, a))).toBe(reader);
    expect(await inTx((tx) => resolveDevicePrinterId(tx, b, "receipt"))).toBeNull();
    expect(await inTx((tx) => resolveDevicePrinterId(tx, b, "payment_slip"))).toBe(bar);
    expect(await inTx((tx) => resolveDeviceReaderId(tx, b))).toBeNull();
  });

  it("a device on Use default prints its receipt and slip on the profile's defaults", async () => {
    const venue = await setupVenue(suite.db);
    const profile = await seedProfile();
    const bar = await seedPrinter(venue, "Bar");
    const counter = await seedPrinter(venue, "Counter");
    await printerLists(profile, {
      receiptPrinterIds: [counter, bar],
      receiptPrinterDefaultId: bar,
      paymentSlipPrinterIds: [bar, counter],
      paymentSlipPrinterDefaultId: counter,
    });
    const a = await enrol(venue, "Caja", profile);

    await cashSale(venue, a);

    expect(await documentJobPrinters()).toEqual([bar]);
    expect((await inTx((tx) => resolvePaymentSlipPrinter(tx, deviceOrigin(a))))?.id).toBe(counter);
  });

  /** A till on `from` with an explicit receipt printer both profiles list, an explicit portable slip
   * printer and reader only `from` lists, and `to` approved for it. */
  async function switchable(venue: Venue) {
    const from = await seedProfile();
    const to = await seedProfile();
    const bar = await seedPrinter(venue, "Bar");
    const handheld = await seedPrinter(venue, "Handheld", { portable: true });
    const spare = await seedPrinter(venue, "Spare", { portable: true });
    const held = await seedPrinter(venue, "Held", { portable: true });
    const r1 = await seedReader("R1");
    const r2 = await seedReader("R2");
    await printerLists(from, { receiptPrinterIds: [bar], paymentSlipPrinterIds: [handheld] });
    await printerLists(to, {
      receiptPrinterIds: [bar, spare],
      receiptPrinterDefaultId: spare,
      paymentSlipPrinterIds: [held],
      paymentSlipPrinterDefaultId: held,
    });
    await readerList(from, [r1], null);
    await readerList(to, [r2], r2);
    const a = await enrol(venue, "Caja", from);
    const b = await enrol(venue, "Otra", to);
    await inTx(async (tx) => {
      await selectDevicePrinter(tx, {
        deviceId: a,
        role: "receipt",
        selection: { id: bar },
        via: "list",
      });
      await selectDevicePrinter(tx, {
        deviceId: a,
        role: "payment_slip",
        selection: { id: handheld },
        via: "list",
      });
      await selectDeviceReader(tx, { deviceId: a, selection: { id: r1 }, via: "list" });
      await approveDeviceProfiles(tx, a, [to]);
    });
    return { from, to, a, b, bar, handheld, spare, held, r1, r2 };
  }

  it("a profile switch keeps an explicit choice the new profile lists and releases the rest", async () => {
    const venue = await setupVenue(suite.db);
    const s = await switchable(venue);
    expect(await printerHoldersOf([s.handheld])).toEqual({ [s.handheld]: s.a });
    const me = await signIn(s.a);

    const switched = await inTx((tx) =>
      switchActiveProfile(tx, {
        deviceId: s.a,
        sessionId: me.sessionId,
        personId: me.personId,
        profileId: s.to,
      }),
    );

    expect(switched).toEqual({ activeProfileId: s.to });
    expect(await columns(s.a)).toEqual({ receipt: s.bar, slip: null, drawer: null });
    expect(await readerChoice(s.a)).toBeNull();
    expect(await printerHoldersOf([s.handheld])).toEqual({});
    expect(await readerHoldersOf([s.r1])).toEqual({});
  });

  it("a profile switch takes the new profile's free portable defaults, never one another device holds", async () => {
    const venue = await setupVenue(suite.db);
    const s = await switchable(venue);
    // `b` joined on `to`, so it took that profile's free defaults; free one of them again.
    await inTx((tx) => tx.delete(cardReaderHolders).where(eq(cardReaderHolders.readerId, s.r2)));
    const me = await signIn(s.a);

    await inTx((tx) =>
      switchActiveProfile(tx, {
        deviceId: s.a,
        sessionId: me.sessionId,
        personId: me.personId,
        profileId: s.to,
      }),
    );

    expect(await printerHoldersOf([s.spare, s.held])).toEqual({ [s.spare]: s.b, [s.held]: s.b });
    expect(await readerHoldersOf([s.r2])).toEqual({ [s.r2]: s.a });
    expect(await inTx((tx) => resolveDevicePrinterId(tx, s.a, "payment_slip"))).toBeNull();
    expect(await inTx((tx) => resolveDeviceReaderId(tx, s.a))).toBe(s.r2);
  });

  it("a manager moving a device to another profile settles the same way", async () => {
    const venue = await setupVenue(suite.db);
    const s = await switchable(venue);
    await inTx((tx) => tx.delete(cardReaderHolders).where(eq(cardReaderHolders.readerId, s.r2)));
    const app = mountApp(venue);

    const res = await managerRequest(app, venue, "PATCH", `/management-api/devices/${s.a}`, {
      name: "Caja",
      profileId: s.to,
      receiptPrinterId: s.bar,
      paymentSlipPrinterId: null,
    });

    expect(res.status).toBe(204);
    expect(await columns(s.a)).toEqual({ receipt: s.bar, slip: null, drawer: null });
    expect(await readerChoice(s.a)).toBeNull();
    expect(await printerHoldersOf([s.handheld])).toEqual({});
    expect(await readerHoldersOf([s.r1, s.r2])).toEqual({ [s.r2]: s.a });
  });

  it("renaming a device keeps its reader, its printer choices and its holds, and takes nothing", async () => {
    const venue = await setupVenue(suite.db);
    const profile = await seedProfile();
    const handheld = await seedPrinter(venue, "Handheld", { portable: true });
    const bar = await seedPrinter(venue, "Bar");
    const listed = await seedReader("Listed");
    const unlisted = await seedReader("Unlisted");
    const a = await enrol(venue, "Caja", profile);
    // Lists set after the join take nothing, so both defaults are free.
    await printerLists(profile, {
      receiptPrinterIds: [handheld],
      receiptPrinterDefaultId: handheld,
    });
    await readerList(profile, [listed], listed);
    // Choices the profile does not list, as a device chosen before its lists named them keeps.
    await suite.db.update(devices).set({ paymentSlipPrinterId: bar }).where(eq(devices.id, a));
    await suite.db.insert(deviceCardReaders).values({ deviceId: a, readerId: unlisted });
    await suite.db.insert(cardReaderHolders).values({ readerId: unlisted, deviceId: a });
    const app = mountApp(venue);

    const res = await managerRequest(app, venue, "PATCH", `/management-api/devices/${a}`, {
      name: "Caja renombrada",
      profileId: profile,
      receiptPrinterId: null,
      paymentSlipPrinterId: bar,
    });

    expect(res.status).toBe(204);
    expect(await columns(a)).toEqual({ receipt: null, slip: bar, drawer: null });
    expect(await readerChoice(a)).toBe(unlisted);
    expect(await readerHoldersOf([listed, unlisted])).toEqual({ [unlisted]: a });
    expect(await printerHoldersOf([handheld, bar])).toEqual({});
  });

  it("revoke, another device takes it, re-enable: the device comes back holding nothing taken meanwhile", async () => {
    const venue = await setupVenue(suite.db);
    const profile = await seedProfile();
    const handheld = await seedPrinter(venue, "Handheld", { portable: true });
    const reader = await seedReader("Reader");
    await printerLists(profile, {
      receiptPrinterIds: [handheld],
      receiptPrinterDefaultId: handheld,
    });
    await readerList(profile, [reader], reader);
    const a = await enrol(venue, "Caja A", profile);
    const b = await enrol(venue, "Caja B", profile);
    await inTx(async (tx) => {
      await selectDevicePrinter(tx, {
        deviceId: a,
        role: "receipt",
        selection: { id: handheld },
        via: "list",
      });
      await selectDeviceReader(tx, { deviceId: a, selection: { id: reader }, via: "list" });
    });
    expect(await columns(a)).toMatchObject({ receipt: handheld });
    expect(await readerChoice(a)).toBe(reader);
    const app = mountApp(venue);

    const revoked = await managerRequest(app, venue, "POST", `/management-api/devices/${a}/revoke`);

    expect(revoked.status).toBe(204);
    expect(await columns(a)).toEqual({ receipt: handheld, slip: null, drawer: null });
    expect(await readerChoice(a)).toBe(reader);
    expect(await printerHoldersOf([handheld])).toEqual({});
    expect(await readerHoldersOf([reader])).toEqual({});

    await inTx(async (tx) => {
      await selectDevicePrinter(tx, {
        deviceId: b,
        role: "receipt",
        selection: { id: handheld },
        via: "scan",
      });
      await selectDeviceReader(tx, { deviceId: b, selection: { id: reader }, via: "scan" });
    });
    await reEnable(venue, a, profile);

    expect(await inTx((tx) => resolveDevicePrinterId(tx, a, "receipt"))).toBeNull();
    expect(await inTx((tx) => resolveDeviceReaderId(tx, a))).toBeNull();
    expect(await columns(a)).toEqual({ receipt: null, slip: null, drawer: null });
    expect(await readerChoice(a)).toBeNull();
    expect(await printerHoldersOf([handheld])).toEqual({ [handheld]: b });
    expect(await readerHoldersOf([reader])).toEqual({ [reader]: b });
    await cashSale(venue, a);
    expect(await documentJobPrinters()).toEqual([]);
  });

  it("revoke then re-enable with nothing taken meanwhile: the device holds its kept choices again", async () => {
    const venue = await setupVenue(suite.db);
    const profile = await seedProfile();
    const handheld = await seedPrinter(venue, "Handheld", { portable: true });
    const reader = await seedReader("Reader");
    await printerLists(profile, { receiptPrinterIds: [handheld] });
    await readerList(profile, [reader], null);
    const a = await enrol(venue, "Caja A", profile);
    await inTx(async (tx) => {
      await selectDevicePrinter(tx, {
        deviceId: a,
        role: "receipt",
        selection: { id: handheld },
        via: "list",
      });
      await selectDeviceReader(tx, { deviceId: a, selection: { id: reader }, via: "list" });
    });
    const app = mountApp(venue);
    expect(
      (await managerRequest(app, venue, "POST", `/management-api/devices/${a}/revoke`)).status,
    ).toBe(204);

    await reEnable(venue, a, profile);

    expect(await columns(a)).toMatchObject({ receipt: handheld });
    expect(await readerChoice(a)).toBe(reader);
    expect(await printerHoldersOf([handheld])).toEqual({ [handheld]: a });
    expect(await readerHoldersOf([reader])).toEqual({ [reader]: a });
    expect(await inTx((tx) => resolveDevicePrinterId(tx, a, "receipt"))).toBe(handheld);
    expect(await inTx((tx) => resolveDeviceReaderId(tx, a))).toBe(reader);
  });

  it("a sign-in, a sign-out and an ended session leave holder rows and explicit choices unchanged", async () => {
    const venue = await setupVenue(suite.db);
    const profile = await seedProfile();
    const handheld = await seedPrinter(venue, "Handheld", { portable: true });
    const reader = await seedReader("Reader");
    await printerLists(profile, { receiptPrinterIds: [handheld] });
    await readerList(profile, [reader], null);
    const a = await enrol(venue, "Caja", profile);
    await inTx(async (tx) => {
      await selectDevicePrinter(tx, {
        deviceId: a,
        role: "receipt",
        selection: { id: handheld },
        via: "list",
      });
      await selectDeviceReader(tx, { deviceId: a, selection: { id: reader }, via: "list" });
    });
    const before = {
      columns: await columns(a),
      reader: await readerChoice(a),
      printers: await printerHoldersOf([handheld]),
      readers: await readerHoldersOf([reader]),
    };

    const first = await signIn(a, "Ana");
    await inTx((tx) => endSession(tx, first.token));
    await signIn(a, "Bea");
    await inTx((tx) => endDeviceSessions(tx, a));

    expect({
      columns: await columns(a),
      reader: await readerChoice(a),
      printers: await printerHoldersOf([handheld]),
      readers: await readerHoldersOf([reader]),
    }).toEqual(before);
    expect(before.printers).toEqual({ [handheld]: a });
    expect(before.readers).toEqual({ [reader]: a });
  });
});

describe("readDeviceEquipment", () => {
  it("offers the listed printers in list order, leaving out those switched off or at another location", async () => {
    const venue = await setupVenue(suite.db);
    const profile = await seedProfile();
    const here = await seedPrinter(venue, "Aquí", { hasCashDrawer: true });
    const counter = await seedPrinter(venue, "Mostrador");
    const off = await seedPrinter(venue, "Apagada");
    const [away] = await suite.db
      .insert(locations)
      .values({ name: "Otra", invoiceLocales: ["es-ES"], operationDescription: "Venta" })
      .returning({ id: locations.id });
    const [far] = await suite.db
      .insert(printers)
      .values({
        locationId: away!.id,
        name: "Fuera",
        transport: "network_tcp",
        host: "10.0.0.8",
        hasCashDrawer: true,
      })
      .returning({ id: printers.id });
    await printerLists(profile, {
      receiptPrinterIds: [far!.id, counter, off, here],
      paymentSlipPrinterIds: [far!.id],
      cashDrawerPrinterIds: [far!.id, here],
    });
    const a = await enrol(venue, "Caja A", profile);
    await suite.db.update(printers).set({ active: false }).where(eq(printers.id, off));

    const seen = await inTx((tx) => readDeviceEquipment(tx, a));

    expect(
      seen.roles.map((role) => ({ role: role.role, choices: role.choices.map((c) => c.id) })),
    ).toEqual([
      { role: "receipt", choices: [counter, here] },
      { role: "payment_slip", choices: [] },
      { role: "cash_drawer", choices: [here] },
      { role: "card_terminal", choices: [] },
    ]);
  });

  it("names each card reader's provider, on what the role pays on and on what it may choose", async () => {
    const venue = await setupVenue(suite.db);
    const profile = await seedProfile();
    const sumup = await seedReader("Lector");
    const [stripe] = await suite.db
      .insert(cardReaders)
      .values({ provider: "stripe", providerRef: `tmr_${randomUUID()}`, name: "Terminal" })
      .returning({ id: cardReaders.id });
    await readerList(profile, [sumup, stripe!.id], sumup);
    const bar = await seedPrinter(venue, "Bar");
    await printerLists(profile, { receiptPrinterIds: [bar] });
    const a = await enrol(venue, "Caja A", profile);

    const { roles } = await inTx((tx) => readDeviceEquipment(tx, a));
    const terminal = roles[3]!;

    expect(terminal.resolved).toEqual({
      id: sumup,
      name: "Lector",
      available: true,
      provider: "sumup",
    });
    expect(terminal.default).toMatchObject({ id: sumup, provider: "sumup" });
    expect(terminal.choices.map((choice) => [choice.id, choice.provider])).toEqual([
      [sumup, "sumup"],
      [stripe!.id, "stripe"],
    ]);
    expect(roles[0]!.choices.map((choice) => choice.id)).toEqual([bar]);
    expect(roles[0]!.choices[0]).not.toHaveProperty("provider");
  });

  it("takes nine reads for one device's equipment and six for the devices list of two", async () => {
    const venue = await setupVenue(suite.db);
    const profile = await seedProfile();
    const handheld = await seedPrinter(venue, "Handheld", { portable: true });
    const drawer = await seedPrinter(venue, "Cajón", { hasCashDrawer: true });
    const reader = await seedReader("Lector");
    await printerLists(profile, {
      receiptPrinterIds: [handheld],
      receiptPrinterDefaultId: handheld,
      cashDrawerPrinterIds: [drawer],
    });
    await readerList(profile, [reader], reader);
    const b = await enrol(venue, "Caja B", profile);
    const a = await enrol(venue, "Caja A", profile);
    await signIn(b);

    /** The reads `read` takes, and what it returns. */
    const readsOf = <T>(read: (tx: Transaction) => Promise<T>) =>
      inTx(async (tx) => {
        const selects = vi.spyOn(tx, "select");
        try {
          const value = await read(tx);
          return { value, reads: selects.mock.calls.length };
        } finally {
          selects.mockRestore();
        }
      });
    const one = await readsOf((tx) => readDeviceEquipment(tx, a));
    const both = await readsOf((tx) => readDevicesEquipment(tx, [a, b]));

    expect(one.value.roles[0]!.default!.heldBy).toMatchObject({ deviceId: b, personName: "Lucía" });
    expect(both.value.get(b)![3]!.resolved).toMatchObject({ id: reader });
    // Devices, the profiles' printers, the printers with their holders; the device's reader
    // choices, the profiles' readers, the readers with their holders; then, for the device's own
    // read only, payments in progress and the holding devices' names and who is signed in on them.
    expect(one.reads).toBe(9);
    expect(both.reads).toBe(6);
  });

  it("names the holder device and its signed-in person; null person when nobody is signed in", async () => {
    const venue = await setupVenue(suite.db);
    const profile = await seedProfile();
    const handheld = await seedPrinter(venue, "Handheld", { portable: true });
    const bar = await seedPrinter(venue, "Bar");
    const drawer = await seedPrinter(venue, "Cajón", { hasCashDrawer: true });
    const reader = await seedReader("Lector");
    await printerLists(profile, {
      receiptPrinterIds: [handheld, bar],
      receiptPrinterDefaultId: handheld,
      cashDrawerPrinterIds: [drawer],
    });
    await readerList(profile, [reader], reader);
    const b = await enrol(venue, "Caja B", profile);
    const a = await enrol(venue, "Caja A", profile);
    await suite.db.update(printers).set({ active: false }).where(eq(printers.id, bar));

    const holderB = { deviceId: b, deviceName: "Caja B", personName: null };
    const seen = await inTx((tx) => readDeviceEquipment(tx, a));

    expect(seen.roles.map((role) => role.role)).toEqual([
      "receipt",
      "payment_slip",
      "cash_drawer",
      "card_terminal",
    ]);
    expect(seen.roles[0]).toEqual({
      role: "receipt",
      selection: "default",
      chosenId: null,
      resolved: null,
      chosen: null,
      default: {
        id: handheld,
        name: "Handheld",
        portable: true,
        available: true,
        busy: false,
        heldBy: holderB,
      },
      choices: [
        {
          id: handheld,
          name: "Handheld",
          portable: true,
          available: true,
          busy: false,
          heldBy: holderB,
        },
      ],
    });
    expect(seen.roles[1]).toEqual({
      role: "payment_slip",
      selection: "default",
      chosenId: null,
      resolved: null,
      chosen: null,
      default: null,
      choices: [],
    });
    expect(seen.roles[2]).toMatchObject({
      role: "cash_drawer",
      default: null,
      choices: [
        { id: drawer, name: "Cajón", portable: false, available: true, busy: false, heldBy: null },
      ],
    });
    expect(seen.roles[3]).toMatchObject({
      role: "card_terminal",
      selection: "default",
      resolved: null,
      default: { id: reader, name: "Lector", portable: true, heldBy: holderB },
    });

    await signIn(b, "Lucía");
    const signedIn = await inTx((tx) => readDeviceEquipment(tx, a));
    expect(signedIn.roles[0]!.default!.heldBy).toEqual({ ...holderB, personName: "Lucía" });

    const own = await inTx((tx) => readDeviceEquipment(tx, b));
    expect(own.roles[0]).toMatchObject({
      resolved: { id: handheld, name: "Handheld", available: true },
      default: { id: handheld, heldBy: null },
    });
    expect(own.roles[3]).toMatchObject({
      resolved: { id: reader, name: "Lector", available: true },
      default: { id: reader, heldBy: null, busy: false },
    });
  });
});
