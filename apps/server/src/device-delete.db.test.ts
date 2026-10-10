import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import {
  CORE_CHANGE_SOURCES,
  billPaymentRefunds,
  billPayments,
  deviceApprovedProfiles,
  deviceMadeHereStations,
  deviceProfiles,
  devices,
  drawerOpens,
  installChangeFeed,
  joinRequests,
  kitchenStations,
  orderGroups,
  parties,
  printerHolders,
  printers,
  removeChangeFeed,
  subscribeToChanges,
  withTransaction,
  type Transaction,
} from "@waitron/db";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { recordIncident, recordSale } from "@waitron/core";
import { VerifactuBackend } from "@waitron/fiscal-verifactu";
import type { FiscalBackend, TrustedClock } from "@waitron/fiscal";
import { hashPin, loginWithPin, persons, sessions } from "@waitron/identity";
import {
  cardReaderHolders,
  cardReaders,
  deviceCardReaders,
  payments,
  type PaymentState,
} from "@waitron/payments";
import { AppError, deviceOrigin, type DeleteImpact, type ResourceIdentity } from "@waitron/shared";
import { deploymentEnvironment } from "./config.js";
import { ALL_MODULES } from "./modules.js";
import { parkOrder } from "./working-order.js";
import { deleteDevice, readDeviceDeleteImpact } from "./device-delete.js";
import { setupVenue, type Venue } from "./testing/venue-fixtures.js";
import { enrolDeviceForTest } from "./testing/enrol.js";
import { offerProducts } from "./testing/zone-offers.js";

const suite = useVenueDb({
  migrations: migrationOptionsFor(manifestSets(), null),
  timeoutMs: 60_000,
});

const NOW = new Date("2026-10-10T10:00:00.000Z");
const OPERATOR = "0000ffff-2222-4000-8000-0000000000aa";

let backend: FiscalBackend;
const clock: TrustedClock = {
  now: () => {
    const instant = new Date();
    return {
      instant,
      offsetMinutes: 0,
      confident: true,
      confidence: "anchored",
      anchorAgeSeconds: 0,
    };
  },
  anchor: () => {
    throw new Error("Unused anchor");
  },
  currentAnchor: () => null,
};

beforeAll(() => {
  backend = new VerifactuBackend({
    clock,
    db: suite.db,
    environment: deploymentEnvironment(process.env),
    deploymentEnvironment: deploymentEnvironment(process.env),
    resolveClient: () => Promise.reject(new Error("resolveClient must never be called")),
  });
});

type Rows = Record<string, unknown>[];
type Snapshot = Record<string, Rows>;

const byJson = (rows: Rows): Rows =>
  rows
    .map((row) => ({ key: JSON.stringify(row), row }))
    .sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0))
    .map(({ row }) => row);

/** Every table's rows, each table's rows in a fixed order, so two snapshots compare by value. */
async function snapshot(): Promise<Snapshot> {
  const tables = await suite.db.execute<{ name: string }>(
    sql`select name from sqlite_master where type = 'table' and name not like 'sqlite_%' order by name`,
  );
  const out: Snapshot = {};
  for (const { name } of tables.rows) {
    out[name] = byJson(
      (await suite.db.execute(sql`select * from ${sql.identifier(name)}`)).rows as Rows,
    );
  }
  return out;
}

const ENDED = "<ended>";

/** The snapshot with each sign-in the delete ended marked `ENDED`, since the time it is ended at is
 *  the wall clock's. */
function withEndedSessions(snap: Snapshot, deviceId: string, open: Set<unknown>): Snapshot {
  return {
    ...snap,
    sessions: byJson(
      snap.sessions!.map((row) => {
        if (row.device_id !== deviceId || !open.has(row.id)) return row;
        expect(typeof row.ended_at).toBe("string");
        return { ...row, ended_at: ENDED };
      }),
    ),
  };
}

/**
 * What deleting `deviceId` must leave, written from the spec rather than from the writer: its row
 * kept, switched off, marked deleted, its token and printer choices cleared; its sign-ins ended;
 * its holds, request, settings and kitchen screens gone. Every other row is as it was.
 */
function afterDelete(before: Snapshot, deviceId: string, now: Date): Snapshot {
  const notMine = (rows: Rows) => rows.filter((row) => row.device_id !== deviceId);
  return {
    ...before,
    devices: byJson(
      before.devices!.map((row) =>
        row.id === deviceId
          ? {
              ...row,
              active: 0,
              deleted_at: now.toISOString(),
              token_hash: "",
              receipt_printer_id: null,
              payment_slip_printer_id: null,
              cash_drawer_printer_id: null,
            }
          : row,
      ),
    ),
    sessions: byJson(
      before.sessions!.map((row) =>
        row.device_id === deviceId && row.ended_at === null ? { ...row, ended_at: ENDED } : row,
      ),
    ),
    printer_holders: notMine(before.printer_holders!),
    card_reader_holders: notMine(before.card_reader_holders!),
    device_made_here_stations: notMine(before.device_made_here_stations!),
    device_approved_profiles: notMine(before.device_approved_profiles!),
    device_card_readers: notMine(before.device_card_readers!),
    device_kitchen_screens: notMine(before.device_kitchen_screens!),
    device_kitchen_screen_stations: notMine(before.device_kitchen_screen_stations!),
    device_kitchen_screen_zones: notMine(before.device_kitchen_screen_zones!),
    device_kitchen_screen_removals: notMine(before.device_kitchen_screen_removals!),
    join_requests: before.join_requests!.filter((row) => row.id !== deviceId),
  };
}

const openSessionIds = (snap: Snapshot, deviceId: string) =>
  new Set(
    snap
      .sessions!.filter((row) => row.device_id === deviceId && row.ended_at === null)
      .map((row) => row.id),
  );

const inTx = <T>(run: (tx: Transaction) => Promise<T>) => withTransaction(suite.db, run);

async function signIn(deviceId: string): Promise<void> {
  const [person] = await suite.db
    .insert(persons)
    .values({ displayName: `Person ${randomUUID()}`, pinHash: hashPin("4321"), role: "staff" })
    .returning({ id: persons.id });
  await inTx((tx) => loginWithPin(tx, { deviceId, personId: person!.id, pin: "4321" }));
}

async function profile(name: string, formFactor: "till" | "kds" = "till"): Promise<string> {
  const [row] = await suite.db
    .insert(deviceProfiles)
    .values({ name, formFactor, capabilities: [] })
    .returning({ id: deviceProfiles.id });
  return row!.id;
}

async function station(venue: Venue, name: string): Promise<string> {
  const [row] = await suite.db
    .insert(kitchenStations)
    .values({ locationId: venue.cfg.locationId, name })
    .returning({ id: kitchenStations.id });
  return row!.id;
}

async function printer(venue: Venue, name: string, portable = false): Promise<string> {
  const [row] = await suite.db
    .insert(printers)
    .values({
      locationId: venue.cfg.locationId,
      name,
      transport: "network_tcp",
      host: `${name.toLowerCase().replaceAll(" ", "-")}.test`,
      portable,
      hasCashDrawer: true,
    })
    .returning({ id: printers.id });
  return row!.id;
}

async function reader(name: string): Promise<string> {
  const [row] = await suite.db
    .insert(cardReaders)
    .values({ provider: "stripe", providerRef: randomUUID(), name })
    .returning({ id: cardReaders.id });
  return row!.id;
}

/** An open order labelled `label` (null for none); its id. */
async function openOrder(venue: Venue, label: string | null = "Mesa 1"): Promise<string> {
  const orderId = randomUUID();
  const offers = await inTx((tx) => offerProducts(tx, venue.cfg));
  await parkOrder({ db: suite.db }, venue.cfg, {
    id: orderId,
    zoneId: offers.zoneId,
    lines: offers.toOfferLines([{ productId: venue.cafeId, quantity: "1" }]),
    ...(label === null ? {} : { label }),
  });
  return orderId;
}

async function cardPayment(orderId: string, deviceId: string, state: PaymentState) {
  await suite.db.insert(payments).values({
    workingOrderId: orderId,
    source: "device",
    deviceId,
    provider: "stripe",
    paymentRef: randomUUID(),
    amount: 150,
    state,
  });
}

type BillState = "pending" | "received" | "failed" | "declined";

async function billPayment(orderId: string, deviceId: string, state: BillState) {
  const at = new Date().toISOString();
  const [row] = await suite.db
    .insert(billPayments)
    .values({
      workingOrderId: orderId,
      submissionId: randomUUID(),
      fingerprint: "f",
      kind: "contribution",
      method: "card",
      applied: 150,
      state,
      receivedAt: state === "received" || state === "declined" ? at : null,
      failedAt: state === "failed" ? at : null,
      requestedBy: OPERATOR,
      source: "device",
      deviceId,
    })
    .returning({ id: billPayments.id });
  return row!.id;
}

async function refund(
  orderId: string,
  deviceId: string,
  state: "pending" | "completed" | "failed",
  receivedOn = deviceId,
) {
  const paid = await billPayment(orderId, receivedOn, "received");
  const at = new Date().toISOString();
  await suite.db.insert(billPaymentRefunds).values({
    billPaymentId: paid,
    submissionId: randomUUID(),
    fingerprint: "f",
    appliedAmount: 100,
    reason: "error",
    authorizedBy: OPERATOR,
    requestedBy: OPERATOR,
    source: "device",
    deviceId,
    state,
    completedAt: state === "completed" ? at : null,
    failedAt: state === "failed" ? at : null,
  });
}

/**
 * "Bar till", the device deleted, and "Pass", the control beside it, each with what a delete
 * touches, and history on Bar till that a delete must keep.
 */
async function seed() {
  const venue = await setupVenue(suite.db);
  const cfg = venue.cfg;
  const tills = await profile("Tills");
  const waiters = await profile("Waiters");
  const grill = await station(venue, "Grill");
  const bar = await station(venue, "Bar");
  const fryer = await station(venue, "Fryer");

  const barTill = (
    await enrolDeviceForTest(suite.db, cfg, {
      name: "Bar till",
      profileId: tills,
      stationId: venue.defaultStationId,
    })
  ).deviceId;
  const pass = (
    await enrolDeviceForTest(suite.db, cfg, {
      name: "Pass",
      profileId: tills,
      stationId: venue.defaultStationId,
    })
  ).deviceId;

  const handheldP = await printer(venue, "Handheld P", true);
  const counterP = await printer(venue, "Counter P");
  const passP = await printer(venue, "Pass P", true);
  await suite.db
    .update(devices)
    .set({
      receiptPrinterId: handheldP,
      paymentSlipPrinterId: counterP,
      cashDrawerPrinterId: counterP,
    })
    .where(eq(devices.id, barTill));
  await suite.db
    .update(devices)
    .set({ receiptPrinterId: passP, cashDrawerPrinterId: counterP })
    .where(eq(devices.id, pass));
  await suite.db.insert(printerHolders).values([
    { printerId: handheldP, deviceId: barTill },
    { printerId: passP, deviceId: pass },
  ]);

  const readerR = await reader("Reader R");
  const readerS = await reader("Reader S");
  await suite.db.insert(cardReaderHolders).values([
    { readerId: readerR, deviceId: barTill },
    { readerId: readerS, deviceId: pass },
  ]);
  await suite.db.insert(deviceCardReaders).values([
    { deviceId: barTill, readerId: readerR },
    { deviceId: pass, readerId: readerS },
  ]);
  await suite.db.insert(deviceMadeHereStations).values([
    { deviceId: barTill, stationId: grill },
    { deviceId: barTill, stationId: bar },
    { deviceId: pass, stationId: grill },
  ]);
  await suite.db.insert(deviceApprovedProfiles).values([
    { deviceId: barTill, deviceProfileId: waiters },
    { deviceId: pass, deviceProfileId: waiters },
  ]);

  // An ended sign-in on Bar till, which the delete neither counts nor ends.
  await signIn(barTill);
  await suite.db
    .update(sessions)
    .set({ endedAt: "2026-10-10T09:00:00.000Z" })
    .where(eq(sessions.deviceId, barTill));
  await signIn(barTill);
  await signIn(pass);

  await suite.db.insert(joinRequests).values({
    id: barTill,
    nodeId: cfg.nodeId,
    locationId: cfg.locationId,
    kind: "device",
    label: "Bar till",
    tokenHash: "returning",
    verificationNumber: "41",
    decoyNumbers: ["42", "43"],
  });

  // History a delete keeps: a cash sale, an incident, a drawer opening and a fired group on Bar till.
  const sale = await inTx((tx) =>
    recordSale(tx, backend, {
      origin: deviceOrigin(barTill),
      nodeId: cfg.nodeId,
      seriesId: cfg.seriesId,
      locale: "es-ES",
      invoiceLocales: ["es-ES"],
      total: "1.00",
      lines: [
        {
          lineNo: 1,
          name: "Café",
          descriptions: { "es-ES": "Café" },
          quantity: "1",
          unitPrice: "1.00",
          vatRate: "0",
          lineTotal: "1.00",
        },
      ],
      clock,
      settlement: {
        kind: "immediate",
        tenders: [{ method: "cash", amount: "1.00", tipAmount: "0.00", settledAt: NOW }],
      },
    }),
  );
  await inTx((tx) =>
    recordIncident(tx, {
      origin: deviceOrigin(barTill),
      saleId: sale.saleId,
      error: new AppError("device.not_found", { deviceId: barTill }),
      severity: "warning",
      detectedAt: NOW,
    }),
  );
  await suite.db.insert(drawerOpens).values({
    deviceId: barTill,
    personId: OPERATOR,
    authorizedBy: OPERATOR,
    reason: "manual",
  });
  const [party] = await suite.db
    .insert(parties)
    .values({ openedBy: OPERATOR })
    .returning({ id: parties.id });
  await suite.db.insert(orderGroups).values({
    partyId: party!.id,
    position: 0,
    state: "fired",
    firedAt: NOW.toISOString(),
    firedByDeviceId: barTill,
    submittedBy: OPERATOR,
  });

  return {
    venue,
    cfg,
    tills,
    barTill,
    pass,
    handheldP,
    counterP,
    readerR,
    grill,
    bar,
    fryer,
    waiters,
    saleId: sale.saleId,
  };
}

type Seeded = Awaited<ReturnType<typeof seed>>;

function expectedImpact(s: Seeded): DeleteImpact {
  return {
    target: { id: s.barTill, name: "Bar till" },
    refusals: [],
    ends: [
      { key: "sessions", count: 1, targets: [] },
      { key: "held_printers", count: 1, targets: [{ id: s.handheldP, name: "Handheld P" }] },
      { key: "held_readers", count: 1, targets: [{ id: s.readerR, name: "Reader R" }] },
      { key: "join_request", count: 1, targets: [] },
    ],
    removes: [
      {
        key: "printer_choices",
        count: 2,
        targets: [
          { id: s.counterP, name: "Counter P" },
          { id: s.handheldP, name: "Handheld P" },
        ],
      },
      {
        key: "made_here_stations",
        count: 2,
        targets: [
          { id: s.bar, name: "Bar" },
          { id: s.grill, name: "Grill" },
        ],
      },
      { key: "approved_profiles", count: 1, targets: [{ id: s.waiters, name: "Waiters" }] },
      { key: "card_reader", count: 1, targets: [{ id: s.readerR, name: "Reader R" }] },
      { key: "kitchen_screens", count: 1, targets: [] },
    ],
  };
}

async function codeOf(run: () => Promise<unknown>): Promise<unknown> {
  try {
    await run();
  } catch (error) {
    return error;
  }
  throw new Error("expected a refusal");
}

describe("the device delete impact", () => {
  it("names every sign-in, held printer and reader, request and setting the delete touches, and writes nothing", async () => {
    const s = await seed();
    const before = await snapshot();
    const impact = await inTx((tx) => readDeviceDeleteImpact(tx, s.cfg, s.barTill));
    expect(impact).toEqual(expectedImpact(s));
    expect(await snapshot()).toEqual(before);
  });

  it.each<[string, (orderId: string, deviceId: string) => Promise<unknown>]>([
    ["a card payment attempting", (o, d) => cardPayment(o, d, "attempting")],
    ["a card payment initiated", (o, d) => cardPayment(o, d, "initiated")],
    ["a bill payment pending", (o, d) => billPayment(o, d, "pending")],
    ["a refund pending", (o, d) => refund(o, d, "pending")],
  ])(
    "refuses with device.payment_in_progress naming each open order with %s",
    async (_what, start) => {
      const s = await seed();
      const control = await openOrder(s.venue, "Mesa 2");
      await start(control, s.pass);
      const unlabelled = await openOrder(s.venue, null);
      const orderId = await openOrder(s.venue);
      const read = () => inTx((tx) => readDeviceDeleteImpact(tx, s.cfg, s.barTill));
      expect((await read()).refusals).toEqual([]);

      await start(orderId, s.barTill);
      expect((await read()).refusals).toEqual([
        {
          code: "device.payment_in_progress",
          params: {},
          targets: [{ id: orderId, name: "Mesa 1" }],
        },
      ]);

      await start(unlabelled, s.barTill);
      const { rows } = await suite.db.execute<{ order_number: number }>(
        sql`select order_number from working_orders where id = ${unlabelled}`,
      );
      expect((await read()).refusals[0]!.targets).toEqual([
        { id: unlabelled, name: `#${rows[0]!.order_number}` },
        { id: orderId, name: "Mesa 1" },
      ]);

      const before = await snapshot();
      const error = await codeOf(() => inTx((tx) => deleteDevice(tx, s.cfg, s.barTill, NOW)));
      expect(error).toMatchObject({ code: "device.payment_in_progress" });
      expect(await snapshot()).toEqual(before);
    },
  );

  it("does not refuse for a payment in any state that is not in progress", async () => {
    const s = await seed();
    const settled: PaymentState[] = [
      "captured",
      "voided",
      "refunded",
      "partially_refunded",
      "failed",
      "accepted_offline",
      "settled",
      "declined",
    ];
    for (const state of settled) await cardPayment(await openOrder(s.venue), s.barTill, state);
    for (const state of ["received", "failed", "declined"] as const)
      await billPayment(await openOrder(s.venue), s.barTill, state);
    for (const state of ["completed", "failed"] as const)
      await refund(await openOrder(s.venue), s.barTill, state);

    const impact = await inTx((tx) => readDeviceDeleteImpact(tx, s.cfg, s.barTill));
    expect(impact.refusals).toEqual([]);
  });

  it("refuses for a pending refund on the device it was taken on, not the device that received the payment", async () => {
    const s = await seed();
    const orderId = await openOrder(s.venue);
    await refund(orderId, s.barTill, "pending", s.pass);
    const refusals = async (id: string) =>
      (await inTx((tx) => readDeviceDeleteImpact(tx, s.cfg, id))).refusals;
    expect(await refusals(s.barTill)).toEqual([
      {
        code: "device.payment_in_progress",
        params: {},
        targets: [{ id: orderId, name: "Mesa 1" }],
      },
    ]);
    expect(await refusals(s.pass)).toEqual([]);
  });

  it("answers device.not_found for an unknown device and a deleted one", async () => {
    const s = await seed();
    await inTx((tx) => deleteDevice(tx, s.cfg, s.barTill, NOW));
    const before = await snapshot();
    for (const id of [s.barTill, randomUUID()]) {
      expect(await codeOf(() => inTx((tx) => readDeviceDeleteImpact(tx, s.cfg, id)))).toMatchObject(
        { code: "device.not_found" },
      );
      expect(await codeOf(() => inTx((tx) => deleteDevice(tx, s.cfg, id, NOW)))).toMatchObject({
        code: "device.not_found",
      });
    }
    expect(await snapshot()).toEqual(before);
  });

  it("answers an empty impact for a disabled device with nothing left on it, and deletes it", async () => {
    const s = await seed();
    const spare = (await enrolDeviceForTest(suite.db, s.cfg, { name: "Spare", profileId: s.tills }))
      .deviceId;
    await suite.db.update(devices).set({ active: false }).where(eq(devices.id, spare));
    const empty: DeleteImpact = {
      target: { id: spare, name: "Spare" },
      refusals: [],
      ends: [],
      removes: [],
    };
    expect(await inTx((tx) => readDeviceDeleteImpact(tx, s.cfg, spare))).toEqual(empty);
    const before = await snapshot();
    expect(await inTx((tx) => deleteDevice(tx, s.cfg, spare, NOW))).toEqual(empty);
    expect(await snapshot()).toEqual(afterDelete(before, spare, NOW));
  });

  it("deletes: ends sign-ins, holds and the request, removes every setting, clears the token and printer choices, keeps the row and every history row", async () => {
    const s = await seed();
    const before = await snapshot();
    const history = [
      "sales",
      "incidents",
      "drawer_opens",
      "order_groups",
      "registros_facturacion",
      "order_amendments",
      "time_entries",
    ];
    expect(before.sales!.length).toBeGreaterThan(0);
    expect(before.incidents!.length).toBeGreaterThan(0);
    expect(before.drawer_opens!.length).toBeGreaterThan(0);
    expect(before.order_groups!.some((row) => row.fired_by_device_id === s.barTill)).toBe(true);
    expect(before.device_kitchen_screens!.some((row) => row.device_id === s.barTill)).toBe(true);
    expect(before.join_requests!.some((row) => row.id === s.barTill)).toBe(true);

    const impact = await inTx((tx) => deleteDevice(tx, s.cfg, s.barTill, NOW));

    expect(impact).toEqual(expectedImpact(s));
    const after = await snapshot();
    expect(withEndedSessions(after, s.barTill, openSessionIds(before, s.barTill))).toEqual(
      afterDelete(before, s.barTill, NOW),
    );
    for (const table of history) {
      expect(before[table], table).toBeDefined();
      expect(after[table], table).toEqual(before[table]);
    }
  });

  it("lets a new device take the deleted device's name at the same location", async () => {
    const s = await seed();
    await inTx((tx) => deleteDevice(tx, s.cfg, s.barTill, NOW));
    const again = await enrolDeviceForTest(suite.db, s.cfg, {
      name: "Bar till",
      profileId: s.tills,
    });
    const rows = await suite.db
      .select({ id: devices.id, active: devices.active })
      .from(devices)
      .where(eq(devices.label, "Bar till"));
    expect(rows.sort((a, b) => (a.id < b.id ? -1 : 1))).toEqual(
      [
        { id: s.barTill, active: false },
        { id: again.deviceId, active: true },
      ].sort((a, b) => (a.id < b.id ? -1 : 1)),
    );
  });

  it("recomputes inside the delete: a sign-in or setting added after the read is ended or removed too", async () => {
    const s = await seed();
    await inTx((tx) => readDeviceDeleteImpact(tx, s.cfg, s.barTill));
    await signIn(s.barTill);
    await suite.db
      .insert(deviceMadeHereStations)
      .values({ deviceId: s.barTill, stationId: s.fryer });
    const before = await snapshot();

    const impact = await inTx((tx) => deleteDevice(tx, s.cfg, s.barTill, NOW));

    expect(impact.ends.find((item) => item.key === "sessions")).toEqual({
      key: "sessions",
      count: 2,
      targets: [],
    });
    expect(impact.removes.find((item) => item.key === "made_here_stations")).toEqual({
      key: "made_here_stations",
      count: 3,
      targets: [
        { id: s.bar, name: "Bar" },
        { id: s.fryer, name: "Fryer" },
        { id: s.grill, name: "Grill" },
      ],
    });
    expect(
      withEndedSessions(await snapshot(), s.barTill, openSessionIds(before, s.barTill)),
    ).toEqual(afterDelete(before, s.barTill, NOW));
  });

  it("a payment started after the read refuses the delete, and nothing is written", async () => {
    const s = await seed();
    expect((await inTx((tx) => readDeviceDeleteImpact(tx, s.cfg, s.barTill))).refusals).toEqual([]);
    await cardPayment(await openOrder(s.venue), s.barTill, "attempting");
    const before = await snapshot();
    expect(await codeOf(() => inTx((tx) => deleteDevice(tx, s.cfg, s.barTill, NOW)))).toMatchObject(
      { code: "device.payment_in_progress" },
    );
    expect(await snapshot()).toEqual(before);
  });

  it("leaves the control device, its sign-in, its hold and its settings exactly as they were", async () => {
    const s = await seed();
    const before = await snapshot();
    await inTx((tx) => deleteDevice(tx, s.cfg, s.barTill, NOW));
    const after = await snapshot();
    const passRows = (snap: Snapshot, table: string, column = "device_id") =>
      snap[table]!.filter((row) => row[column] === s.pass);
    expect(passRows(before, "devices", "id")).toHaveLength(1);
    for (const [table, column] of [
      ["devices", "id"],
      ["sessions", "device_id"],
      ["printer_holders", "device_id"],
      ["card_reader_holders", "device_id"],
      ["device_made_here_stations", "device_id"],
      ["device_approved_profiles", "device_id"],
      ["device_card_readers", "device_id"],
      ["device_kitchen_screens", "device_id"],
      ["device_kitchen_screen_stations", "device_id"],
    ] as const) {
      expect(passRows(before, table, column).length, table).toBeGreaterThan(0);
      expect(passRows(after, table, column), table).toEqual(passRows(before, table, column));
    }
  });

  it("a refused final write leaves every row as it was and publishes no change", async () => {
    const s = await seed();
    await installChangeFeed(suite.db, [
      ...CORE_CHANGE_SOURCES,
      ...ALL_MODULES.flatMap((module) => module.changes ?? []),
    ]);
    const heard: ResourceIdentity[] = [];
    const unsubscribe = subscribeToChanges((change) => heard.push(...change.resources));
    // The reset between cases does not remove the feed's triggers, so this case does.
    try {
      const before = await snapshot();
      await suite.db.execute(
        sql.raw(`create trigger test_refuse before update of deleted_at on devices
          begin select raise(abort, 'test_delete_failure'); end`),
      );
      try {
        const error = await codeOf(() => inTx((tx) => deleteDevice(tx, s.cfg, s.barTill, NOW)));
        expect(String(error)).toMatch(/test_delete_failure/);
        expect(await snapshot()).toEqual(before);
        expect(heard).toEqual([]);
      } finally {
        await suite.db.execute(sql`drop trigger test_refuse`);
      }

      // Control: the same subscription hears the delete once the trigger is gone.
      await inTx((tx) => deleteDevice(tx, s.cfg, s.barTill, NOW));
      expect(heard).toContainEqual(expect.objectContaining({ type: "devices", id: s.barTill }));
    } finally {
      unsubscribe();
      removeChangeFeed(suite.db);
      await suite.db.execute(sql`delete from change_log`);
    }
  });
});
