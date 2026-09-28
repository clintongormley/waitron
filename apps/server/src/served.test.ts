import { randomUUID } from "node:crypto";
import { asc, eq, inArray, sql } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import {
  assignCatalogueToLocation,
  createCatalogue,
  createCategory,
  createExtraList,
  createProduct,
  writeProductModifiers,
} from "@waitron/catalogue";
import {
  billPaymentRefunds,
  billPayments,
  devices,
  saleLines,
  sales,
  serviceCommands,
  ticketItems,
  visits,
  withTransaction,
  workingOrderLines,
  workingOrders,
} from "@waitron/db";
import type { Transaction } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { VerifactuBackend, registrosFacturacion } from "@waitron/fiscal-verifactu";
import type { FiscalBackend, TrustedClock } from "@waitron/fiscal";
import { hashPassword, hashPin } from "@waitron/identity";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { applyVenue, planVenue } from "@waitron/provisioning";
import {
  locationId as brandLocationId,
  nodeId as brandNodeId,
  seriesId as brandSeriesId,
  tillId as brandTillId,
} from "@waitron/shared";
import { deploymentEnvironment } from "./config.js";
import { ALL_MODULES } from "./modules.js";
import { createTable } from "./tables.js";
import type { TillConfig } from "./till-config.js";
import { payWorkingOrder } from "./till-sale.js";
import { offerProducts } from "./testing/zone-offers.js";
import {
  fireGroup,
  moveLinesToGroup,
  submitGroups,
  type GroupLine,
  type GroupRelease,
} from "./order-groups.js";
import { seatTable } from "./visits.js";
import {
  addTabRound,
  markGroupServed,
  markServed,
  recallLines,
  splitOffCheck,
  unmarkServed,
  updateOrderLine,
  voidTabLine,
} from "./working-order.js";
import "./errors.js";

// What serving records, by quantity, on the lines of a party (spec §4, §12 item 5; plan D8, D18,
// D19). Serving is an operational fact: it never touches a filed sale.
const LOCALE = "es-ES";
const ALEX = "cccccccc-0000-4000-8000-00000000000a";
const MIA = "cccccccc-0000-4000-8000-00000000000b";

const suite = useVenueDb({
  migrations: migrationOptionsFor(manifestSets(), null),
  timeoutMs: 60_000,
});

let backend: FiscalBackend;
let clock: TrustedClock;
let taxIds = 0;

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
      throw new Error("served.test: anchor() is not used");
    },
    currentAnchor: () => null,
  };
  backend = new VerifactuBackend({
    clock,
    db: suite.db,
    environment: deploymentEnvironment(process.env),
    deploymentEnvironment: deploymentEnvironment(process.env),
    resolveClient: () => Promise.reject(new Error("served.test: filing never contacts AEAT")),
  });
});

const inTx = <T>(fn: (tx: Transaction) => Promise<T>): Promise<T> => withTransaction(suite.db, fn);

const DISHES = {
  croquetas: "8.00",
  steak: "22.00",
  sauce: "1.50",
  flan: "5.00",
  water: "2.00",
} as const;
type Dish = keyof typeof DISHES;

interface Venue {
  cfg: TillConfig;
  zoneId: string;
  offer(dish: Dish): string;
  /** The Steak's extras list, whose one pick is the sauce. */
  extrasListId: string;
  sauceId: string;
}

async function setupVenue(): Promise<Venue> {
  taxIds += 1;
  const venue = await applyVenue(
    planVenue(
      {
        country: "ES",
        taxId: `${String(62_000_000 + taxIds).padStart(8, "0")}K`,
        legalName: "Servido SL",
        location: {
          name: "Sala",
          fiscalTerritory: "ES-common",
          invoiceLocales: [LOCALE],
          operationDescription: "Restaurante",
          addressLine1: "Calle Mayor 1",
          addressLine2: null,
          postalCode: "28013",
          city: "Madrid",
          province: "Madrid",
          timeZone: "Europe/Madrid",
          dayCutover: "05:00",
        },
        tillName: "Caja 1",
        seriesCode: "A",
        rectificativeSeriesCode: "R",
        admin: {
          displayName: "Administradora",
          pinHash: hashPin("1234"),
          passwordHash: hashPassword("dashPass123"),
          email: "owner@example.test",
        },
      },
      ALL_MODULES,
    ),
    { db: suite.db, modules: ALL_MODULES },
  );
  const cfg: TillConfig = {
    tillId: brandTillId(venue.tillId),
    nodeId: brandNodeId(venue.nodeId),
    seriesId: brandSeriesId(venue.seriesIds[0]!),
    locationId: brandLocationId(venue.locationId),
    locale: LOCALE,
    invoiceLocales: [LOCALE],
    tipsEnabled: false,
    orderFlow: "prepay",
  };
  return inTx(async (tx) => {
    const catalogue = await createCatalogue(tx, { name: "Carta" });
    const category = await createCategory(tx, { name: { [LOCALE]: "Platos" } });
    const productId = {} as Record<Dish, string>;
    for (const [dish, unitPrice] of Object.entries(DISHES) as [Dish, string][]) {
      productId[dish] = (
        await createProduct(tx, {
          catalogueId: catalogue.id,
          categoryId: category.id,
          name: dish,
          pricingUnit: "each",
          unitPrice,
          vatClass: "general",
        })
      ).id;
    }
    const extras = await createExtraList(
      tx,
      {
        name: "Salsas",
        customerName: null,
        kitchenName: null,
        minPicks: 0,
        maxPicks: 1,
        active: true,
        items: [{ productId: productId.sauce, maxQuantity: 1, preselected: false, price: "1.50" }],
      },
      LOCALE,
    );
    await writeProductModifiers(tx, productId.steak, [{ kind: "extras", id: extras.id }]);
    await assignCatalogueToLocation(tx, venue.locationId, catalogue.id);
    const offers = await offerProducts(tx, cfg, { zone: "tables" });
    // Bottled water is handed over at the bar: no kitchen ticket, only a sent stamp.
    await tx.run(sql`
      update preparation_routes set station_id = null, no_preparation = 1
      where product_id = ${productId.water}`);
    return {
      cfg,
      zoneId: offers.zoneId,
      offer: (dish: Dish) => offers.offerFor(productId[dish]),
      extrasListId: extras.id,
      sauceId: productId.sauce,
    };
  });
}

interface Seated {
  visitId: string;
  tabId: string;
}

async function seated(v: Venue): Promise<Seated> {
  return inTx(async (tx) => {
    const { id: tableId } = await createTable(tx, v.cfg, {
      label: `S-${randomUUID().slice(0, 6)}`,
      zoneId: v.zoneId,
    });
    const { visitId, tabId } = await seatTable(tx, v.cfg, {
      tableId,
      guestCount: 2,
      operatorId: ALEX,
    });
    return { visitId, tabId };
  });
}

function line(v: Venue, dish: Dish, quantity = "1"): GroupLine {
  return { menuItemId: v.offer(dish), quantity };
}

async function revisionOf(visitId: string): Promise<number> {
  const [row] = await suite.db
    .select({ revision: visits.revision })
    .from(visits)
    .where(eq(visits.id, visitId));
  return row!.revision;
}

interface CommandOptions {
  submissionId?: string;
  revision?: number;
}

async function args(visitId: string, opts: CommandOptions = {}) {
  return {
    submissionId: opts.submissionId ?? randomUUID(),
    expectedVisitRevision: opts.revision ?? (await revisionOf(visitId)),
    operatorId: ALEX,
  };
}

/** Submits one group; answers its id. */
async function group(
  v: Venue,
  visitId: string,
  release: GroupRelease,
  lines: GroupLine[],
): Promise<string> {
  const command = await args(visitId);
  const { groups } = await inTx((tx) =>
    submitGroups(tx, v.cfg, visitId, { ...command, groups: [{ release, lines }] }),
  );
  return groups[0]!.id;
}

async function fire(v: Venue, visitId: string, groupId: string) {
  const command = await args(visitId);
  return inTx((tx) => fireGroup(tx, v.cfg, visitId, groupId, command));
}

type Items = { lineId: string; quantity: string }[];

async function serve(v: Venue, visitId: string, items: Items, opts: CommandOptions = {}) {
  const command = await args(visitId, opts);
  return inTx((tx) => markServed(tx, v.cfg, visitId, items, command));
}

async function unserve(v: Venue, visitId: string, items: Items, opts: CommandOptions = {}) {
  const command = await args(visitId, opts);
  return inTx((tx) => unmarkServed(tx, v.cfg, visitId, items, command));
}

async function serveGroup(v: Venue, visitId: string, groupId: string, opts: CommandOptions = {}) {
  const command = await args(visitId, opts);
  return inTx((tx) => markGroupServed(tx, v.cfg, visitId, groupId, command));
}

/** Every line of the visit's bills, extras included, by bill then line number. */
async function linesOf(visitId: string) {
  return suite.db
    .select({
      id: workingOrderLines.id,
      workingOrderId: workingOrderLines.workingOrderId,
      lineNo: workingOrderLines.lineNo,
      name: workingOrderLines.name,
      quantity: workingOrderLines.quantity,
      servedQuantity: workingOrderLines.servedQuantity,
      servedAt: workingOrderLines.servedAt,
      groupId: workingOrderLines.groupId,
      parentLineId: workingOrderLines.parentLineId,
    })
    .from(workingOrderLines)
    .innerJoin(workingOrders, eq(workingOrders.id, workingOrderLines.workingOrderId))
    .where(eq(workingOrders.visitId, visitId))
    .orderBy(asc(workingOrders.openedAt), asc(workingOrderLines.lineNo));
}

async function lineNamed(visitId: string, name: Dish) {
  const found = (await linesOf(visitId)).filter((row) => row.name === name);
  expect(found).toHaveLength(1);
  return found[0]!;
}

async function lineById(visitId: string, id: string) {
  return (await linesOf(visitId)).find((row) => row.id === id)!;
}

async function billRevision(billId: string): Promise<number> {
  const [row] = await suite.db
    .select({ revision: workingOrders.revision })
    .from(workingOrders)
    .where(eq(workingOrders.id, billId));
  return row!.revision;
}

/** Moves a fully served line's `served_at` to a fixed past instant, so a later write that
 * re-stamps it shows, however fast the suite runs; answers the instant. */
async function backdateServed(lineId: string): Promise<string> {
  const at = "2026-01-01T12:00:00.000Z";
  await suite.db
    .update(workingOrderLines)
    .set({ servedAt: at })
    .where(eq(workingOrderLines.id, lineId));
  return at;
}

/** Every row a served command could write, and the filed sales it must never touch. */
async function snapshot(visitId: string) {
  const bills = await suite.db
    .select({ id: workingOrders.id, revision: workingOrders.revision })
    .from(workingOrders)
    .where(eq(workingOrders.visitId, visitId))
    .orderBy(workingOrders.id);
  const billIds = bills.map((bill) => bill.id);
  const filed = await suite.db
    .select()
    .from(sales)
    .where(inArray(sales.workingOrderId, billIds))
    .orderBy(sales.id);
  return {
    visit: await suite.db.select().from(visits).where(eq(visits.id, visitId)),
    bills,
    lines: await suite.db
      .select()
      .from(workingOrderLines)
      .where(inArray(workingOrderLines.workingOrderId, billIds))
      .orderBy(workingOrderLines.id),
    tickets: await suite.db
      .select()
      .from(ticketItems)
      .where(inArray(ticketItems.workingOrderId, billIds))
      .orderBy(ticketItems.id),
    commands: await suite.db
      .select()
      .from(serviceCommands)
      .where(eq(serviceCommands.scopeId, visitId))
      .orderBy(serviceCommands.id),
    sales: filed,
    saleLines: await suite.db
      .select()
      .from(saleLines)
      .where(
        inArray(
          saleLines.saleId,
          filed.map((sale) => sale.id),
        ),
      )
      .orderBy(saleLines.id),
    registros: await suite.db.select().from(registrosFacturacion).orderBy(registrosFacturacion.id),
  };
}

async function expectRefusedWithNothingWritten(
  visitId: string,
  attempt: () => Promise<unknown>,
  expected: { code: string; params?: Record<string, unknown> },
): Promise<void> {
  const before = await snapshot(visitId);
  await expect(attempt()).rejects.toMatchObject(expected);
  expect(await snapshot(visitId)).toEqual(before);
}

async function pay(v: Venue, billId: string, amount: string): Promise<void> {
  await payWorkingOrder({ db: suite.db, backend, clock }, v.cfg, {
    id: billId,
    lines: [],
    tender: { method: "cash", amount },
  });
}

/** A party with Croquetas ×4 fired. */
async function croquetas(v: Venue) {
  const s = await seated(v);
  const groupId = await group(v, s.visitId, "fire", [line(v, "croquetas", "4")]);
  const croq = await lineNamed(s.visitId, "croquetas");
  return { ...s, groupId, croq };
}

describe("served by quantity (§12 item 5)", () => {
  it("serves 2 of Croquetas ×4, then the other 2, which sets served_at", async () => {
    const v = await setupVenue();
    const s = await croquetas(v);
    const revision = await revisionOf(s.visitId);

    const first = await serve(v, s.visitId, [{ lineId: s.croq.id, quantity: "2" }]);

    expect(first).toEqual({ revision: revision + 1 });
    expect(await revisionOf(s.visitId)).toBe(revision + 1);
    expect(await lineById(s.visitId, s.croq.id)).toMatchObject({
      quantity: 4000,
      servedQuantity: 2000,
      servedAt: null,
    });

    await serve(v, s.visitId, [{ lineId: s.croq.id, quantity: "2" }]);

    expect(await lineById(s.visitId, s.croq.id)).toMatchObject({
      quantity: 4000,
      servedQuantity: 4000,
      servedAt: expect.any(String),
    });
  });

  it("unserving 1 clears served_at and leaves 3 of 4 served", async () => {
    const v = await setupVenue();
    const s = await croquetas(v);
    await serve(v, s.visitId, [{ lineId: s.croq.id, quantity: "4" }]);
    const revision = await revisionOf(s.visitId);

    const answer = await unserve(v, s.visitId, [{ lineId: s.croq.id, quantity: "1" }]);

    expect(answer).toEqual({ revision: revision + 1 });
    expect(await lineById(s.visitId, s.croq.id)).toMatchObject({
      servedQuantity: 3000,
      servedAt: null,
    });
  });

  it("serves several lines in one command", async () => {
    const v = await setupVenue();
    const s = await seated(v);
    await group(v, s.visitId, "fire", [line(v, "croquetas", "4"), line(v, "water", "2")]);
    const croq = await lineNamed(s.visitId, "croquetas");
    const water = await lineNamed(s.visitId, "water");

    await serve(v, s.visitId, [
      { lineId: croq.id, quantity: "1" },
      { lineId: water.id, quantity: "2" },
    ]);

    expect(await lineById(s.visitId, croq.id)).toMatchObject({
      servedQuantity: 1000,
      servedAt: null,
    });
    expect(await lineById(s.visitId, water.id)).toMatchObject({
      servedQuantity: 2000,
      servedAt: expect.any(String),
    });
  });

  it("markGroupServed serves every line of the group, including one split onto another bill of the visit", async () => {
    const v = await setupVenue();
    const s = await seated(v);
    const groupId = await group(v, s.visitId, "fire", [
      line(v, "croquetas", "4"),
      line(v, "water", "2"),
    ]);
    const croq = await lineNamed(s.visitId, "croquetas");
    const { checkId } = await inTx(async (tx) =>
      splitOffCheck(tx, v.cfg, s.tabId, [{ lineNo: croq.lineNo, quantity: "1" }], {
        expectedVisitRevision: await revisionOf(s.visitId),
        operatorId: MIA,
      }),
    );
    await serve(v, s.visitId, [{ lineId: croq.id, quantity: "1" }]);
    const inGroup = (await linesOf(s.visitId)).filter((row) => row.groupId === groupId);
    expect(inGroup.map((row) => row.workingOrderId).sort()).toEqual(
      [s.tabId, s.tabId, checkId].sort(),
    );
    const revision = await revisionOf(s.visitId);

    const answer = await serveGroup(v, s.visitId, groupId);

    expect(answer).toEqual({ revision: revision + 1 });
    const served = (await linesOf(s.visitId)).filter((row) => row.groupId === groupId);
    expect(served).toHaveLength(3);
    for (const row of served) {
      expect(row).toMatchObject({ servedQuantity: row.quantity, servedAt: expect.any(String) });
    }
  });

  it("markGroupServed leaves a line already fully served as it was", async () => {
    const v = await setupVenue();
    const s = await seated(v);
    const groupId = await group(v, s.visitId, "fire", [
      line(v, "croquetas", "4"),
      line(v, "water", "2"),
    ]);
    const water = await lineNamed(s.visitId, "water");
    await serve(v, s.visitId, [{ lineId: water.id, quantity: "2" }]);
    const servedAt = await backdateServed(water.id);

    await serveGroup(v, s.visitId, groupId);

    expect(await lineById(s.visitId, water.id)).toMatchObject({ servedQuantity: 2000, servedAt });
  });

  it("serves a paper-only station's item straight after it fired, and leaves its kitchen state as the kitchen left it", async () => {
    const v = await setupVenue();
    const s = await croquetas(v);
    const [ticket] = await suite.db
      .select({ stationId: ticketItems.stationId, firedAt: ticketItems.firedAt })
      .from(ticketItems)
      .where(eq(ticketItems.workingOrderLineId, s.croq.id));
    expect(ticket!.firedAt).not.toBeNull();
    expect(
      await suite.db.select().from(devices).where(eq(devices.stationId, ticket!.stationId)),
    ).toEqual([]);

    await serve(v, s.visitId, [{ lineId: s.croq.id, quantity: "4" }]);

    expect(await lineById(s.visitId, s.croq.id)).toMatchObject({
      servedQuantity: 4000,
      servedAt: expect.any(String),
    });
    const [after] = await suite.db
      .select({
        state: ticketItems.state,
        readyAt: ticketItems.readyAt,
        awayAt: ticketItems.awayAt,
      })
      .from(ticketItems)
      .where(eq(ticketItems.workingOrderLineId, s.croq.id));
    expect(after).toEqual({ state: "queued", readyAt: null, awayAt: null });
  });

  it("serves a dish's extras in step with it, and unserves them with it", async () => {
    const v = await setupVenue();
    const s = await seated(v);
    await group(v, s.visitId, "fire", [
      {
        ...line(v, "steak", "2"),
        extras: [{ listId: v.extrasListId, picks: [{ productId: v.sauceId, quantity: 1 }] }],
      },
    ]);
    const steak = (await linesOf(s.visitId)).find((row) => row.name === "steak")!;
    const child = () =>
      linesOf(s.visitId).then((rows) => rows.find((row) => row.parentLineId === steak.id)!);
    expect(await child()).toMatchObject({ quantity: 2000, servedQuantity: 0 });

    await serve(v, s.visitId, [{ lineId: steak.id, quantity: "1" }]);
    expect(await child()).toMatchObject({ servedQuantity: 1000, servedAt: null });

    await serve(v, s.visitId, [{ lineId: steak.id, quantity: "1" }]);
    expect(await child()).toMatchObject({ servedQuantity: 2000, servedAt: expect.any(String) });

    await unserve(v, s.visitId, [{ lineId: steak.id, quantity: "2" }]);
    expect(await child()).toMatchObject({ servedQuantity: 0, servedAt: null });
  });

  it("does not serve an extras line on its own (group.not_found), writing nothing", async () => {
    const v = await setupVenue();
    const s = await seated(v);
    await group(v, s.visitId, "fire", [
      {
        ...line(v, "steak"),
        extras: [{ listId: v.extrasListId, picks: [{ productId: v.sauceId, quantity: 1 }] }],
      },
    ]);
    const sauce = (await linesOf(s.visitId)).find((row) => row.parentLineId !== null)!;

    await expectRefusedWithNothingWritten(
      s.visitId,
      () => serve(v, s.visitId, [{ lineId: sauce.id, quantity: "1" }]),
      { code: "group.not_found", params: { lineId: sauce.id } },
    );
  });

  it("serves a line put on the bill outside any group", async () => {
    const v = await setupVenue();
    const s = await seated(v);
    await inTx((tx) => addTabRound(tx, v.cfg, s.tabId, [line(v, "croquetas", "2")]));
    const croq = await lineNamed(s.visitId, "croquetas");
    expect(croq.groupId).toBeNull();

    await serve(v, s.visitId, [{ lineId: croq.id, quantity: "2" }]);

    expect(await lineById(s.visitId, croq.id)).toMatchObject({
      servedQuantity: 2000,
      servedAt: expect.any(String),
    });
  });
});

describe("refusals, each writing nothing", () => {
  it.each([
    ["more than is unserved", "5"],
    ["zero", "0"],
    ["a negative quantity", "-1"],
    ["a quantity that is not a number", "abc"],
    ["a quantity finer than the unit counts", "1.5"],
  ])("refuses serving %s (tab.serve_quantity_invalid)", async (_name, quantity) => {
    const v = await setupVenue();
    const s = await croquetas(v);
    await expectRefusedWithNothingWritten(
      s.visitId,
      () => serve(v, s.visitId, [{ lineId: s.croq.id, quantity }]),
      {
        code: "tab.serve_quantity_invalid",
        params: { tabId: s.tabId, lineNo: s.croq.lineNo, quantity },
      },
    );
  });

  it("refuses serving 3 more once 2 of 4 are served", async () => {
    const v = await setupVenue();
    const s = await croquetas(v);
    await serve(v, s.visitId, [{ lineId: s.croq.id, quantity: "2" }]);
    await expectRefusedWithNothingWritten(
      s.visitId,
      () => serve(v, s.visitId, [{ lineId: s.croq.id, quantity: "3" }]),
      {
        code: "tab.serve_quantity_invalid",
        params: { tabId: s.tabId, lineNo: s.croq.lineNo, quantity: "3" },
      },
    );
  });

  it("refuses unserving more than is served (tab.serve_quantity_invalid)", async () => {
    const v = await setupVenue();
    const s = await croquetas(v);
    await serve(v, s.visitId, [{ lineId: s.croq.id, quantity: "2" }]);
    await expectRefusedWithNothingWritten(
      s.visitId,
      () => unserve(v, s.visitId, [{ lineId: s.croq.id, quantity: "3" }]),
      {
        code: "tab.serve_quantity_invalid",
        params: { tabId: s.tabId, lineNo: s.croq.lineNo, quantity: "3" },
      },
    );
  });

  it("refuses a line of another party, and an id naming no line (group.not_found)", async () => {
    const v = await setupVenue();
    const s = await croquetas(v);
    const other = await croquetas(v);
    for (const lineId of [other.croq.id, randomUUID()]) {
      await expectRefusedWithNothingWritten(
        s.visitId,
        () => serve(v, s.visitId, [{ lineId, quantity: "1" }]),
        { code: "group.not_found", params: { lineId } },
      );
    }
  });

  it("refuses an empty list and a line named twice (management.request_invalid)", async () => {
    const v = await setupVenue();
    const s = await croquetas(v);
    for (const items of [
      [],
      [
        { lineId: s.croq.id, quantity: "1" },
        { lineId: s.croq.id, quantity: "1" },
      ],
    ]) {
      await expectRefusedWithNothingWritten(s.visitId, () => serve(v, s.visitId, items), {
        code: "management.request_invalid",
        params: { field: "items" },
      });
    }
  });

  it("refuses serving a line of a held group, one by one or the whole group (group.line_held)", async () => {
    const v = await setupVenue();
    const s = await seated(v);
    const held = await group(v, s.visitId, "hold", [line(v, "flan", "2"), line(v, "water")]);
    const flan = await lineNamed(s.visitId, "flan");

    await expectRefusedWithNothingWritten(
      s.visitId,
      () => serve(v, s.visitId, [{ lineId: flan.id, quantity: "1" }]),
      { code: "group.line_held", params: { tabId: s.tabId, lineNo: flan.lineNo } },
    );
    await expectRefusedWithNothingWritten(s.visitId, () => serveGroup(v, s.visitId, held), {
      code: "group.line_held",
      params: { tabId: s.tabId, lineNo: flan.lineNo },
    });
  });

  it("refuses a line of a held group that the kitchen has no ticket for (group.line_held)", async () => {
    const v = await setupVenue();
    const s = await seated(v);
    await group(v, s.visitId, "hold", [line(v, "water")]);
    const water = await lineNamed(s.visitId, "water");

    await expectRefusedWithNothingWritten(
      s.visitId,
      () => serve(v, s.visitId, [{ lineId: water.id, quantity: "1" }]),
      { code: "group.line_held", params: { tabId: s.tabId, lineNo: water.lineNo } },
    );
  });

  it("refuses a line outside any group whose kitchen item is held (group.line_held)", async () => {
    const v = await setupVenue();
    const s = await seated(v);
    await inTx((tx) => addTabRound(tx, v.cfg, s.tabId, [{ ...line(v, "croquetas"), hold: true }]));
    const croq = await lineNamed(s.visitId, "croquetas");
    expect(croq.groupId).toBeNull();

    await expectRefusedWithNothingWritten(
      s.visitId,
      () => serve(v, s.visitId, [{ lineId: croq.id, quantity: "1" }]),
      { code: "group.line_held", params: { tabId: s.tabId, lineNo: croq.lineNo } },
    );
  });

  it("refuses a line of a fired group that was recalled from the kitchen, one by one or the whole group (group.line_held)", async () => {
    const v = await setupVenue();
    const s = await croquetas(v);
    await inTx((tx) => recallLines(tx, v.cfg, s.tabId, [s.croq.lineNo]));
    const [ticket] = await suite.db
      .select({ firedAt: ticketItems.firedAt, sentAt: workingOrderLines.sentAt })
      .from(ticketItems)
      .innerJoin(workingOrderLines, eq(workingOrderLines.id, ticketItems.workingOrderLineId))
      .where(eq(ticketItems.workingOrderLineId, s.croq.id));
    expect(ticket).toEqual({ firedAt: null, sentAt: expect.any(String) });

    const refusal = { code: "group.line_held", params: { tabId: s.tabId, lineNo: s.croq.lineNo } };
    await expectRefusedWithNothingWritten(
      s.visitId,
      () => serve(v, s.visitId, [{ lineId: s.croq.id, quantity: "1" }]),
      refusal,
    );
    await expectRefusedWithNothingWritten(
      s.visitId,
      () => serveGroup(v, s.visitId, s.groupId),
      refusal,
    );
  });

  it("refuses a held line outside any group that needs no kitchen (group.line_held)", async () => {
    const v = await setupVenue();
    const s = await seated(v);
    await inTx((tx) => addTabRound(tx, v.cfg, s.tabId, [{ ...line(v, "water"), hold: true }]));
    const water = await lineNamed(s.visitId, "water");
    expect(water.groupId).toBeNull();
    const tickets = await suite.db
      .select()
      .from(ticketItems)
      .where(eq(ticketItems.workingOrderLineId, water.id));
    expect(tickets).toEqual([]);

    await expectRefusedWithNothingWritten(
      s.visitId,
      () => serve(v, s.visitId, [{ lineId: water.id, quantity: "1" }]),
      { code: "group.line_held", params: { tabId: s.tabId, lineNo: water.lineNo } },
    );
  });

  it("refuses a held group with no line left on the party's bills as gone (group.not_found)", async () => {
    const v = await setupVenue();
    const s = await seated(v);
    const held = await group(v, s.visitId, "hold", [line(v, "flan")]);
    const flan = await lineNamed(s.visitId, "flan");
    // What a removal would leave, before the group itself is marked removed.
    await suite.db
      .update(workingOrderLines)
      .set({ groupId: null })
      .where(eq(workingOrderLines.id, flan.id));

    await expectRefusedWithNothingWritten(s.visitId, () => serveGroup(v, s.visitId, held), {
      code: "group.not_found",
      params: { groupId: held },
    });
  });

  it("refuses a group of another party, or none (group.not_found)", async () => {
    const v = await setupVenue();
    const s = await croquetas(v);
    const other = await croquetas(v);
    for (const groupId of [other.groupId, randomUUID()]) {
      await expectRefusedWithNothingWritten(s.visitId, () => serveGroup(v, s.visitId, groupId), {
        code: "group.not_found",
        params: { groupId },
      });
    }
  });
});

describe("the bill's revision and a card payment (ruling 3; menus plan D10, D22)", () => {
  it("counts a served mark and its undo on the open bill's revision too", async () => {
    const v = await setupVenue();
    const s = await croquetas(v);
    const before = await billRevision(s.tabId);

    await serve(v, s.visitId, [{ lineId: s.croq.id, quantity: "1" }]);
    expect(await billRevision(s.tabId)).toBe(before + 1);

    await unserve(v, s.visitId, [{ lineId: s.croq.id, quantity: "1" }]);
    expect(await billRevision(s.tabId)).toBe(before + 2);

    await serveGroup(v, s.visitId, s.groupId);
    expect(await billRevision(s.tabId)).toBe(before + 3);
  });

  it("refuses a served mark, its undo and a group's served mark while a card payment runs on the bill (order.payment_in_flight)", async () => {
    const v = await setupVenue();
    const s = await croquetas(v);
    await serve(v, s.visitId, [{ lineId: s.croq.id, quantity: "1" }]);
    await suite.db
      .update(workingOrders)
      .set({ paymentAttemptAt: new Date().toISOString() })
      .where(eq(workingOrders.id, s.tabId));
    const refused = { code: "order.payment_in_flight", params: { workingOrderId: s.tabId } };

    await expectRefusedWithNothingWritten(
      s.visitId,
      () => serve(v, s.visitId, [{ lineId: s.croq.id, quantity: "1" }]),
      refused,
    );
    await expectRefusedWithNothingWritten(
      s.visitId,
      () => unserve(v, s.visitId, [{ lineId: s.croq.id, quantity: "1" }]),
      refused,
    );
    await expectRefusedWithNothingWritten(
      s.visitId,
      () => serveGroup(v, s.visitId, s.groupId),
      refused,
    );
  });
});

describe("retries and stale screens (Review Focus 2 and 3; D8, D19)", () => {
  it("serves 2 of Croquetas ×4 once when the command is sent twice with one submission id", async () => {
    const v = await setupVenue();
    const s = await croquetas(v);
    const opts = { submissionId: randomUUID(), revision: await revisionOf(s.visitId) };
    const items = [{ lineId: s.croq.id, quantity: "2" }];

    const first = await serve(v, s.visitId, items, opts);
    const before = await snapshot(s.visitId);
    const second = await serve(v, s.visitId, items, opts);

    expect(second).toEqual(first);
    expect(await snapshot(s.visitId)).toEqual(before);
    expect(await lineById(s.visitId, s.croq.id)).toMatchObject({ servedQuantity: 2000 });
  });

  it("answers a repeated undo and a repeated group served mark once each", async () => {
    const v = await setupVenue();
    const s = await croquetas(v);
    await serve(v, s.visitId, [{ lineId: s.croq.id, quantity: "4" }]);
    const undo = { submissionId: randomUUID(), revision: await revisionOf(s.visitId) };
    const items = [{ lineId: s.croq.id, quantity: "1" }];
    const first = await unserve(v, s.visitId, items, undo);
    let before = await snapshot(s.visitId);
    expect(await unserve(v, s.visitId, items, undo)).toEqual(first);
    expect(await snapshot(s.visitId)).toEqual(before);

    const whole = { submissionId: randomUUID(), revision: await revisionOf(s.visitId) };
    const served = await serveGroup(v, s.visitId, s.groupId, whole);
    before = await snapshot(s.visitId);
    expect(await serveGroup(v, s.visitId, s.groupId, whole)).toEqual(served);
    expect(await snapshot(s.visitId)).toEqual(before);
  });

  it("refuses the same submission id with quantity 3 (submission.id_reused), and nothing changes", async () => {
    const v = await setupVenue();
    const s = await croquetas(v);
    const submissionId = randomUUID();
    await serve(v, s.visitId, [{ lineId: s.croq.id, quantity: "2" }], { submissionId });

    await expectRefusedWithNothingWritten(
      s.visitId,
      () => serve(v, s.visitId, [{ lineId: s.croq.id, quantity: "3" }], { submissionId }),
      { code: "submission.id_reused", params: { submissionId } },
    );
    await expectRefusedWithNothingWritten(
      s.visitId,
      () => unserve(v, s.visitId, [{ lineId: s.croq.id, quantity: "2" }], { submissionId }),
      { code: "submission.id_reused", params: { submissionId } },
    );
  });

  it("refuses device A's group served mark after device B moved a line into the held group and fired it, then serves every line, the moved one included", async () => {
    const v = await setupVenue();
    const s = await seated(v);
    const mains = await group(v, s.visitId, "hold", [line(v, "croquetas", "2")]);
    await group(v, s.visitId, "hold", [line(v, "flan")]);
    const flan = await lineNamed(s.visitId, "flan");
    const seenByA = await revisionOf(s.visitId);

    // Device B: a fired group can never be joined (spec §12.4), so B moves the Flan in while the
    // group is held, then fires it; each is a command of its own.
    const moveCommand = await args(s.visitId);
    await inTx((tx) =>
      moveLinesToGroup(
        tx,
        v.cfg,
        s.visitId,
        [{ lineId: flan.id, quantity: "1" }],
        { groupId: mains },
        moveCommand,
      ),
    );
    await fire(v, s.visitId, mains);

    await expectRefusedWithNothingWritten(
      s.visitId,
      () => serveGroup(v, s.visitId, mains, { revision: seenByA }),
      { code: "visit.out_of_date", params: { visitId: s.visitId, revision: seenByA + 2 } },
    );

    await serveGroup(v, s.visitId, mains);
    const served = (await linesOf(s.visitId)).filter((row) => row.groupId === mains);
    expect(served.map((row) => row.id)).toContain(flan.id);
    expect(served).toHaveLength(2);
    for (const row of served) {
      expect(row).toMatchObject({ servedQuantity: row.quantity, servedAt: expect.any(String) });
    }
  });

  it("answers a retry carrying the revision it was first sent with, after the visit moved on", async () => {
    const v = await setupVenue();
    const s = await croquetas(v);
    const opts = { submissionId: randomUUID(), revision: await revisionOf(s.visitId) };
    const items = [{ lineId: s.croq.id, quantity: "1" }];
    const first = await serve(v, s.visitId, items, opts);
    await serve(v, s.visitId, [{ lineId: s.croq.id, quantity: "1" }]);

    expect(await serve(v, s.visitId, items, opts)).toEqual(first);
    expect(await lineById(s.visitId, s.croq.id)).toMatchObject({ servedQuantity: 2000 });
  });
});

describe("served on a settled bill (D18)", () => {
  it("marks the Flan served after its bill is paid, leaving the filed sale and its registro as they were", async () => {
    const v = await setupVenue();
    const s = await seated(v);
    await group(v, s.visitId, "fire", [line(v, "croquetas", "2")]);
    const desserts = await group(v, s.visitId, "hold", [line(v, "flan")]);
    await fire(v, s.visitId, desserts);
    await pay(v, s.tabId, "21.00");
    const [bill] = await suite.db
      .select({ status: workingOrders.status, revision: workingOrders.revision })
      .from(workingOrders)
      .where(eq(workingOrders.id, s.tabId));
    expect(bill!.status).toBe("settled");
    const flan = await lineNamed(s.visitId, "flan");
    expect(flan.servedAt).toBeNull();
    const before = await snapshot(s.visitId);
    expect(before.sales).toHaveLength(1);
    expect(before.saleLines.length).toBeGreaterThan(0);
    expect(before.registros).toHaveLength(1);

    await serve(v, s.visitId, [{ lineId: flan.id, quantity: "1" }]);

    expect(await lineById(s.visitId, flan.id)).toMatchObject({
      servedQuantity: 1000,
      servedAt: expect.any(String),
    });
    const after = await snapshot(s.visitId);
    expect(after.sales).toEqual(before.sales);
    expect(after.saleLines).toEqual(before.saleLines);
    expect(after.registros).toEqual(before.registros);
    expect(await billRevision(s.tabId)).toBe(bill!.revision);

    await serveGroup(v, s.visitId, desserts);
    await unserve(v, s.visitId, [{ lineId: flan.id, quantity: "1" }]);
    expect(await lineById(s.visitId, flan.id)).toMatchObject({ servedQuantity: 0, servedAt: null });
    const croq = await lineNamed(s.visitId, "croquetas");
    await serveGroup(v, s.visitId, croq.groupId!);
    expect(await lineById(s.visitId, croq.id)).toMatchObject({
      servedQuantity: 2000,
      servedAt: expect.any(String),
    });
    const last = await snapshot(s.visitId);
    expect(last.sales).toEqual(before.sales);
    expect(last.saleLines).toEqual(before.saleLines);
    expect(last.registros).toEqual(before.registros);
  });
});

describe("served on a bill paid before its group was fired (D18)", () => {
  it("serves the Flan and the Water of a group fired after the bill was paid", async () => {
    const v = await setupVenue();
    const s = await seated(v);
    await group(v, s.visitId, "fire", [line(v, "croquetas", "2")]);
    const desserts = await group(v, s.visitId, "hold", [line(v, "flan"), line(v, "water")]);
    await pay(v, s.tabId, "23.00");
    await fire(v, s.visitId, desserts);
    const flan = await lineNamed(s.visitId, "flan");
    const water = await lineNamed(s.visitId, "water");
    const [bill] = await suite.db
      .select({ status: workingOrders.status })
      .from(workingOrders)
      .where(eq(workingOrders.id, s.tabId));
    expect(bill!.status).toBe("settled");
    // Firing on the paid bill released the Flan to the kitchen; nothing stamps a settled line sent.
    const [ticket] = await suite.db
      .select({ firedAt: ticketItems.firedAt })
      .from(ticketItems)
      .where(eq(ticketItems.workingOrderLineId, flan.id));
    expect(ticket!.firedAt).not.toBeNull();
    const [sent] = await suite.db
      .select({ sentAt: workingOrderLines.sentAt })
      .from(workingOrderLines)
      .where(eq(workingOrderLines.id, water.id));
    expect(sent!.sentAt).toBeNull();
    const before = await snapshot(s.visitId);

    await serve(v, s.visitId, [{ lineId: flan.id, quantity: "1" }]);
    await serveGroup(v, s.visitId, desserts);

    for (const row of [flan, water]) {
      expect(await lineById(s.visitId, row.id)).toMatchObject({
        servedQuantity: 1000,
        servedAt: expect.any(String),
      });
    }
    const after = await snapshot(s.visitId);
    expect(after.sales).toEqual(before.sales);
    expect(after.saleLines).toEqual(before.saleLines);
    expect(after.registros).toEqual(before.registros);
  });
});

describe("a card refund pending on a bill (ruling 3 is for an OPEN bill only)", () => {
  /** A received card payment of the bill, and a refund of it the provider has not answered. */
  async function pendingRefund(v: Venue, billId: string): Promise<void> {
    const [payment] = await suite.db
      .insert(billPayments)
      .values({
        workingOrderId: billId,
        submissionId: randomUUID(),
        fingerprint: "f",
        kind: "contribution",
        method: "card",
        applied: 100,
        state: "received",
        receivedAt: new Date().toISOString(),
        requestedBy: ALEX,
        tillId: v.cfg.tillId,
      })
      .returning({ id: billPayments.id });
    await suite.db.insert(billPaymentRefunds).values({
      billPaymentId: payment!.id,
      submissionId: randomUUID(),
      fingerprint: "f",
      appliedAmount: 100,
      reason: "r",
      authorizedBy: ALEX,
      requestedBy: ALEX,
      tillId: v.cfg.tillId,
      state: "pending",
    });
  }

  it("does not hold up a served mark on a paid bill", async () => {
    const v = await setupVenue();
    const s = await seated(v);
    const desserts = await group(v, s.visitId, "fire", [line(v, "flan")]);
    await pay(v, s.tabId, "5.00");
    await pendingRefund(v, s.tabId);
    const flan = await lineNamed(s.visitId, "flan");

    await serve(v, s.visitId, [{ lineId: flan.id, quantity: "1" }]);
    await unserve(v, s.visitId, [{ lineId: flan.id, quantity: "1" }]);
    await serveGroup(v, s.visitId, desserts);

    expect(await lineById(s.visitId, flan.id)).toMatchObject({
      servedQuantity: 1000,
      servedAt: expect.any(String),
    });
  });

  it("still refuses a served mark on an open bill while its refund is pending (bill.refund_in_progress)", async () => {
    const v = await setupVenue();
    const s = await croquetas(v);
    await pendingRefund(v, s.tabId);

    await expectRefusedWithNothingWritten(
      s.visitId,
      () => serve(v, s.visitId, [{ lineId: s.croq.id, quantity: "1" }]),
      { code: "bill.refund_in_progress", params: { workingOrderId: s.tabId } },
    );
  });
});

describe("a partly served line split or cut (ruling 6)", () => {
  it("keeps as much served on the line as it still holds and gives the rest to the split row", async () => {
    const v = await setupVenue();
    const s = await croquetas(v);
    await serve(v, s.visitId, [{ lineId: s.croq.id, quantity: "3" }]);

    const { checkId } = await inTx(async (tx) =>
      splitOffCheck(tx, v.cfg, s.tabId, [{ lineNo: s.croq.lineNo, quantity: "2" }], {
        expectedVisitRevision: await revisionOf(s.visitId),
        operatorId: ALEX,
      }),
    );

    const rows = (await linesOf(s.visitId)).filter((row) => row.name === "croquetas");
    expect(rows.map((row) => [row.workingOrderId, row.quantity, row.servedQuantity])).toEqual([
      [s.tabId, 2000, 2000],
      [checkId, 2000, 1000],
    ]);
    expect(rows[0]!.servedAt).not.toBeNull();
    expect(rows[1]!.servedAt).toBeNull();
  });

  it("leaves a split row unserved when the part served stays on the line", async () => {
    const v = await setupVenue();
    const s = await croquetas(v);
    await serve(v, s.visitId, [{ lineId: s.croq.id, quantity: "1" }]);

    await inTx(async (tx) =>
      splitOffCheck(tx, v.cfg, s.tabId, [{ lineNo: s.croq.lineNo, quantity: "1" }], {
        expectedVisitRevision: await revisionOf(s.visitId),
        operatorId: ALEX,
      }),
    );

    const rows = (await linesOf(s.visitId)).filter((row) => row.name === "croquetas");
    expect(rows.map((row) => [row.quantity, row.servedQuantity, row.servedAt])).toEqual([
      [3000, 1000, null],
      [1000, 0, null],
    ]);
  });

  it("a whole served line split in part keeps both rows fully served", async () => {
    const v = await setupVenue();
    const s = await croquetas(v);
    await serve(v, s.visitId, [{ lineId: s.croq.id, quantity: "4" }]);
    const servedAt = await backdateServed(s.croq.id);

    await inTx(async (tx) =>
      splitOffCheck(tx, v.cfg, s.tabId, [{ lineNo: s.croq.lineNo, quantity: "1" }], {
        expectedVisitRevision: await revisionOf(s.visitId),
        operatorId: ALEX,
      }),
    );

    const rows = (await linesOf(s.visitId)).filter((row) => row.name === "croquetas");
    expect(rows.map((row) => [row.quantity, row.servedQuantity, row.servedAt])).toEqual([
      [3000, 3000, servedAt],
      [1000, 1000, servedAt],
    ]);
  });

  it("cuts what was served to what a part void leaves, and marks the line served when that is all of it", async () => {
    const v = await setupVenue();
    const s = await croquetas(v);
    await serve(v, s.visitId, [{ lineId: s.croq.id, quantity: "3" }]);

    await inTx((tx) => voidTabLine(tx, v.cfg, s.tabId, s.croq.lineNo, "2", ALEX));

    expect(await lineById(s.visitId, s.croq.id)).toMatchObject({
      quantity: 2000,
      servedQuantity: 2000,
      servedAt: expect.any(String),
    });
  });

  it("keeps the time a line was first fully served when a part void cuts it", async () => {
    const v = await setupVenue();
    const s = await croquetas(v);
    await serve(v, s.visitId, [{ lineId: s.croq.id, quantity: "4" }]);
    const servedAt = await backdateServed(s.croq.id);

    await inTx((tx) => voidTabLine(tx, v.cfg, s.tabId, s.croq.lineNo, "1", ALEX));

    expect(await lineById(s.visitId, s.croq.id)).toMatchObject({
      quantity: 3000,
      servedQuantity: 3000,
      servedAt,
    });
  });

  it("keeps what was served when a part void leaves more than that", async () => {
    const v = await setupVenue();
    const s = await croquetas(v);
    await serve(v, s.visitId, [{ lineId: s.croq.id, quantity: "1" }]);

    await inTx((tx) => voidTabLine(tx, v.cfg, s.tabId, s.croq.lineNo, "2", ALEX));

    expect(await lineById(s.visitId, s.croq.id)).toMatchObject({
      quantity: 2000,
      servedQuantity: 1000,
      servedAt: null,
    });
  });

  it("follows a line edit: a cut clamps and marks it served, a raise clears served_at", async () => {
    const v = await setupVenue();
    const s = await seated(v);
    await group(v, s.visitId, "fire", [line(v, "water", "3")]);
    const water = await lineNamed(s.visitId, "water");
    await serve(v, s.visitId, [{ lineId: water.id, quantity: "2" }]);

    await inTx(async (tx) =>
      updateOrderLine(
        tx,
        v.cfg,
        s.tabId,
        water.lineNo,
        { quantity: "2" },
        await billRevision(s.tabId),
        ALEX,
      ),
    );
    expect(await lineById(s.visitId, water.id)).toMatchObject({
      quantity: 2000,
      servedQuantity: 2000,
      servedAt: expect.any(String),
    });

    await inTx(async (tx) =>
      updateOrderLine(
        tx,
        v.cfg,
        s.tabId,
        water.lineNo,
        { quantity: "1" },
        await billRevision(s.tabId),
        ALEX,
      ),
    );
    expect(await lineById(s.visitId, water.id)).toMatchObject({
      quantity: 1000,
      servedQuantity: 1000,
      servedAt: expect.any(String),
    });

    await inTx(async (tx) =>
      updateOrderLine(
        tx,
        v.cfg,
        s.tabId,
        water.lineNo,
        { quantity: "3" },
        await billRevision(s.tabId),
        ALEX,
      ),
    );
    expect(await lineById(s.visitId, water.id)).toMatchObject({
      quantity: 3000,
      servedQuantity: 1000,
      servedAt: null,
    });
  });
});
