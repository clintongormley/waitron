import { setRoutingCell } from "@waitron/venue-service";
import { randomUUID } from "node:crypto";
import { and, asc, eq, inArray, isNotNull, sql } from "drizzle-orm";
import { beforeAll, describe, expect, expectTypeOf, it } from "vitest";
import {
  devices,
  diningTables,
  kitchenPrintJobs,
  kitchenStations,
  locations,
  kitchenTimingDefaults,
  orderGroupEvents,
  orderGroups,
  printJobs,
  printers,
  products,
  serviceCommands,
  ticketItems,
  parties,
  withTransaction,
  workingOrderLines,
  workingOrders,
} from "@waitron/db";
import type { Database, Transaction } from "@waitron/db";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { seedKitchenStation, seedNode, seedTenant } from "@waitron/db/testing/seed.js";
import {
  assignCatalogueToLocation,
  createCatalogue,
  createCategory,
  createExtraList,
  createOptionList,
  createProduct,
  units,
  updateProduct,
  writeProductModifiers,
} from "@waitron/catalogue";
import { createPrinter } from "@waitron/printing";
import {
  locationId as brandLocationId,
  nodeId as brandNodeId,
  seriesId as brandSeriesId,
} from "@waitron/shared";
import type { DeviceRequestConfig, TillConfig } from "./till-config.js";
import { deviceRequestCfg, seedSessionDevice } from "./testing/session-device.js";
import { createCourse, setProductCourse } from "./kitchen.js";
import { attachPrinterToStation } from "./station-printers.js";
import { createTable } from "./tables.js";
import { printedLines } from "./testing/decode-ticket.js";
import { republishMenus } from "./testing/publish-menu.js";
import { reprintOrderTickets } from "./kitchen-print.js";
import { seedLegacySellingUnits } from "./testing/seed-units.js";
import { offerProducts } from "./testing/zone-offers.js";
import { VENUE_SERVICE } from "./modules.js";
import {
  addTabRound,
  createOpenOrder,
  fireCourse,
  listExpoQueue,
  listStationQueue,
  parkOrder,
  recallLines,
  sendLines,
  updateHeldOrder,
  updateOrderLine,
  type TillSaleDeps,
} from "./working-order.js";
import { seatTable } from "./parties.js";
import {
  listStationNotices,
  writeKitchenTicketGrouping,
  writePrintHeldWork,
} from "@waitron/venue-service";
import {
  bumpGroupReady,
  fireGroup,
  listOrderGroups,
  readCurrentOrders,
  markGroupAway,
  moveLinesToGroup,
  reorderHeldGroups,
  submitGroups,
  type GroupLine,
  type GroupRelease,
} from "./order-groups.js";
import "./errors.js";
import { openPartyTab } from "./testing/serve-line.js";
import { splitBill, mergeBills, transferItems } from "./bill-actions.js";
import { joinTables } from "./table-actions.js";
import { moveBill } from "./move-bill.js";
import { cancelLine } from "./testing/cancel-line.js";

const LOCALE = "es-ES";
const ALEX = "cccccccc-0000-4000-8000-00000000000a";
const MIA = "cccccccc-0000-4000-8000-00000000000b";

const suite = useVenueDb({
  migrations: migrationOptionsFor(manifestSets(), null),
  timeoutMs: 60_000,
});
let db: Database;
beforeAll(() => {
  db = suite.db;
});

const inTx = <T>(fn: (tx: Transaction) => Promise<T>): Promise<T> => withTransaction(db, fn);

/**
 * Each dish's three names differ, so a surface reading the wrong one shows the wrong text: the
 * staff name is what a group's summary shows, the kitchen name is what a ticket prints.
 */
const DISHES = {
  beer: { staff: "Beer tap", customer: "Draught beer", kitchen: "K-BEER", price: "3.00" },
  water: { staff: "Water btl", customer: "Mineral water", kitchen: "K-WATER", price: "2.00" },
  cold: { staff: "Croquettes", customer: "Ham croquettes", kitchen: "K-CROQ", price: "8.00" },
  warm: { staff: "Octopus", customer: "Grilled octopus", kitchen: "K-OCTO", price: "14.00" },
  steak: { staff: "Steak", customer: "Sirloin steak", kitchen: "K-STEAK", price: "22.00" },
  fish: { staff: "Fish", customer: "Catch of the day", kitchen: "K-FISH", price: "18.00" },
  flan: { staff: "Flan", customer: "Caramel custard", kitchen: "K-FLAN", price: "5.00" },
  sauce: { staff: "Pepper sc", customer: "Pepper sauce", kitchen: "K-PEPPER", price: "1.50" },
} as const;
type Dish = keyof typeof DISHES;

const COURSES = { drinks: "Drinks", starters: "Starters", mains: "Mains", desserts: "Desserts" };
const COURSE_OF: Record<Dish, keyof typeof COURSES> = {
  beer: "drinks",
  water: "drinks",
  cold: "starters",
  warm: "starters",
  steak: "mains",
  fish: "mains",
  flan: "desserts",
  sauce: "mains",
};

interface Venue {
  cfg: DeviceRequestConfig;
  productId: Record<Dish, string>;
  printerId: string;
  /** The one kitchen station every routed dish goes to. */
  stationId: string;
  /** The Steak's extras list, whose one pick is the pepper sauce. */
  extrasListId: string;
  offer(dish: Dish): string;
  zoneId: string;
}

async function setupVenue(): Promise<Venue> {
  await seedTenant(db);
  await seedLegacySellingUnits(db);
  const [location] = await db
    .insert(locations)
    .values({ name: "Sala", invoiceLocales: [LOCALE], operationDescription: "Restaurante" })
    .returning({ id: locations.id });
  const locationId = location!.id;
  const stationId = await seedKitchenStation(db, { locationId: brandLocationId(locationId) });
  await db.insert(kitchenTimingDefaults).values({ locationId });
  const nodeId = await seedNode(db, brandLocationId(locationId));
  const cfg = await deviceRequestCfg(db, {
    nodeId: brandNodeId(nodeId),
    seriesId: brandSeriesId(randomUUID()),
    locationId: brandLocationId(locationId),
    locale: LOCALE,
    invoiceLocales: [LOCALE],
    tipsEnabled: false,
    simplifiedInvoiceLimit: null,
  } satisfies TillConfig);
  return inTx(async (tx) => {
    const catalogue = await createCatalogue(tx, { name: "Carta" });
    const category = await createCategory(tx, { name: "Platos" });
    const courseIds: Record<string, string> = {};
    let displayOrder = 1;
    for (const [key, name] of Object.entries(COURSES)) {
      courseIds[key] = (await createCourse(tx, cfg, { name, displayOrder: displayOrder++ })).id;
    }
    const productId = {} as Record<Dish, string>;
    for (const [dish, names] of Object.entries(DISHES) as [Dish, (typeof DISHES)[Dish]][]) {
      const product = await createProduct(tx, {
        catalogueId: catalogue.id,
        categoryId: category.id,
        name: names.staff,
        customerName: { en: names.customer },
        kitchenName: names.kitchen,
        pricingUnit: "each",
        unitPrice: names.price,
        vatClass: "general",
      });
      productId[dish] = product.id;
      await setProductCourse(tx, cfg, product.id, courseIds[COURSE_OF[dish]]!);
    }
    const extras = await createExtraList(
      tx,
      {
        name: "Sauces",
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
    await assignCatalogueToLocation(tx, locationId, catalogue.id);
    const offers = await offerProducts(tx, cfg, { zone: "tables" });
    // Bottled water is handed over at the bar: no kitchen ticket, only a sent stamp.
    await setRoutingCell(
      tx,
      cfg,
      { row: { kind: "product", productId: productId.water }, zoneId: null },
      { kind: "no_preparation" },
    );
    const { id: printerId } = await createPrinter(
      tx,
      { locationId: cfg.locationId },
      { name: "Cocina", transport: "cloud_poll", pollId: `poll-${randomUUID()}` },
    );
    await attachPrinterToStation(tx, { stationId, printerId });
    return {
      cfg,
      productId,
      printerId,
      stationId,
      extrasListId: extras.id,
      zoneId: offers.zoneId,
      offer: (dish: Dish) => offers.offerFor(productId[dish]),
    };
  });
}

interface Seated {
  partyId: string;
  tabId: string;
  tableId: string;
}

async function seated(v: Venue): Promise<Seated> {
  return inTx(async (tx) => {
    const { id: tableId } = await createTable(tx, v.cfg, {
      label: `T-${randomUUID().slice(0, 6)}`,
      zoneId: v.zoneId,
    });
    const { partyId, tabId } = await seatTable(tx, v.cfg, {
      tableId,
      guestCount: 4,
      operatorId: ALEX,
    });
    return { partyId, tabId, tableId };
  });
}

function line(v: Venue, dish: Dish, quantity = "1"): GroupLine {
  return { menuItemId: v.offer(dish), quantity };
}

async function revisionOf(partyId: string): Promise<number> {
  const [row] = await db
    .select({ revision: parties.revision })
    .from(parties)
    .where(eq(parties.id, partyId));
  return row!.revision;
}

interface CommandOptions {
  submissionId?: string;
  revision?: number;
  operatorId?: string;
}

async function args(partyId: string, opts: CommandOptions = {}) {
  return {
    submissionId: opts.submissionId ?? randomUUID(),
    expectedPartyRevision: opts.revision ?? (await revisionOf(partyId)),
    operatorId: opts.operatorId ?? ALEX,
  };
}

async function submit(
  v: Venue,
  partyId: string,
  groups: { lines: GroupLine[]; release: GroupRelease }[],
  opts: CommandOptions & { joinGroupId?: string } = {},
) {
  const command = await args(partyId, opts);
  return inTx((tx) =>
    submitGroups(tx, v.cfg, partyId, { ...command, groups, joinGroupId: opts.joinGroupId }),
  );
}

async function fire(v: Venue, partyId: string, groupId: string, opts: CommandOptions = {}) {
  const command = await args(partyId, opts);
  return inTx((tx) => fireGroup(tx, v.cfg, partyId, groupId, command));
}

async function reorder(partyId: string, ids: string[], opts: CommandOptions = {}) {
  const command = await args(partyId, opts);
  return inTx((tx) => reorderHeldGroups(tx, partyId, ids, command));
}

async function move(
  v: Venue,
  partyId: string,
  moves: { lineId: string; quantity: string }[],
  target: { groupId: string } | "new",
  opts: CommandOptions = {},
) {
  const command = await args(partyId, opts);
  return inTx((tx) => moveLinesToGroup(tx, v.cfg, partyId, moves, target, command));
}

async function groupsOf(partyId: string) {
  return inTx((tx) => listOrderGroups(tx, partyId));
}

/** The top-level lines of the party's bills, by bill then line number. */
async function linesOf(partyId: string) {
  return db
    .select({
      id: workingOrderLines.id,
      workingOrderId: workingOrderLines.workingOrderId,
      lineNo: workingOrderLines.lineNo,
      productId: workingOrderLines.productId,
      name: workingOrderLines.name,
      quantity: workingOrderLines.quantity,
      groupId: workingOrderLines.groupId,
      creditedTo: workingOrderLines.creditedTo,
      courseId: workingOrderLines.courseId,
      sentAt: workingOrderLines.sentAt,
    })
    .from(workingOrderLines)
    .innerJoin(workingOrders, eq(workingOrders.id, workingOrderLines.workingOrderId))
    .where(and(eq(workingOrders.partyId, partyId), sql`${workingOrderLines.parentLineId} is null`))
    .orderBy(asc(workingOrders.openedAt), asc(workingOrderLines.lineNo));
}

async function linesIn(partyId: string, groupId: string) {
  return (await linesOf(partyId)).filter((row) => row.groupId === groupId);
}

async function ticketsOf(partyId: string) {
  return db
    .select({
      lineId: ticketItems.workingOrderLineId,
      firedAt: ticketItems.firedAt,
      quantity: ticketItems.quantity,
    })
    .from(ticketItems)
    .innerJoin(workingOrders, eq(workingOrders.id, ticketItems.workingOrderId))
    .where(eq(workingOrders.partyId, partyId));
}

async function firedTicketLineIds(partyId: string): Promise<string[]> {
  return (await ticketsOf(partyId))
    .filter((ticket) => ticket.firedAt !== null)
    .map((ticket) => ticket.lineId)
    .sort();
}

async function printed(v: Venue): Promise<string[]> {
  const jobs = await db
    .select({ payload: printJobs.payload })
    .from(printJobs)
    .where(eq(printJobs.printerId, v.printerId))
    .orderBy(sql`rowid`);
  return jobs.map((job) => printedLines(job.payload).join("\n"));
}

async function eventsOf(partyId: string) {
  return db
    .select({
      groupId: orderGroupEvents.groupId,
      kind: orderGroupEvents.kind,
      actorId: orderGroupEvents.actorId,
      detail: orderGroupEvents.detail,
    })
    .from(orderGroupEvents)
    .where(eq(orderGroupEvents.partyId, partyId))
    .orderBy(sql`rowid`);
}

/** Every row a group command can write, so a refusal can be shown to have written none. */
async function snapshot(v: Venue, partyId: string) {
  const bills = await db
    .select({ id: workingOrders.id, revision: workingOrders.revision })
    .from(workingOrders)
    .where(eq(workingOrders.partyId, partyId))
    .orderBy(workingOrders.id);
  const billIds = bills.map((bill) => bill.id);
  return {
    party: await db.select().from(parties).where(eq(parties.id, partyId)),
    bills,
    lines: await db
      .select()
      .from(workingOrderLines)
      .where(inArray(workingOrderLines.workingOrderId, billIds))
      .orderBy(workingOrderLines.id),
    tickets: await db
      .select()
      .from(ticketItems)
      .where(inArray(ticketItems.workingOrderId, billIds))
      .orderBy(ticketItems.id),
    groups: await db
      .select()
      .from(orderGroups)
      .where(eq(orderGroups.partyId, partyId))
      .orderBy(orderGroups.id),
    events: await eventsOf(partyId),
    commands: await db
      .select()
      .from(serviceCommands)
      .where(eq(serviceCommands.scopeId, partyId))
      .orderBy(serviceCommands.id),
    printed: await printed(v),
  };
}

async function expectRefusedWithNothingWritten(
  v: Venue,
  partyId: string,
  attempt: () => Promise<unknown>,
  expected: { code: string; params?: Record<string, unknown> },
): Promise<void> {
  const before = await snapshot(v, partyId);
  await expect(attempt()).rejects.toMatchObject(expected);
  expect(await snapshot(v, partyId)).toEqual(before);
}

interface SpecExample extends Seated {
  drinks: string;
  cold: string;
  warm: string;
  mains: string;
  desserts: string;
}

/**
 * Spec §3's example, submitted as a waiter would: fire the drinks, fire the cold starters, hold the
 * warm starters, then hold the mains and the desserts as two groups in one submission.
 */
async function specExample(v: Venue): Promise<SpecExample> {
  const seat = await seated(v);
  const one = async (release: GroupRelease, lines: GroupLine[]) =>
    (await submit(v, seat.partyId, [{ release, lines }])).groups[0]!.id;
  const drinks = await one("fire", [line(v, "beer", "2"), line(v, "water")]);
  const cold = await one("fire", [line(v, "cold", "4")]);
  const warm = await one("hold", [line(v, "warm", "4")]);
  const later = await submit(v, seat.partyId, [
    { release: "hold", lines: [line(v, "steak", "2"), line(v, "fish")] },
    { release: "hold", lines: [line(v, "flan", "2")] },
  ]);
  return {
    ...seat,
    drinks,
    cold,
    warm,
    mains: later.groups[0]!.id,
    desserts: later.groups[1]!.id,
  };
}

describe("the spec's example (§3, §12 item 3)", () => {
  it("fires the drinks and cold starters as groups 1 and 2 and holds the rest as 3, 4 and 5", async () => {
    const v = await setupVenue();
    const s = await specExample(v);

    const { groups } = await groupsOf(s.partyId);
    expect(groups.map((group) => [group.id, group.position, group.state])).toEqual([
      [s.drinks, 1, "fired"],
      [s.cold, 2, "fired"],
      [s.warm, 3, "held"],
      [s.mains, 4, "held"],
      [s.desserts, 5, "held"],
    ]);
    expect(groups.map((group) => group.summary)).toEqual([
      "2 × Beer tap, 1 × Water btl",
      "4 × Croquettes",
      "4 × Octopus",
      "2 × Steak, 1 × Fish",
      "2 × Flan",
    ]);
    // The two starter groups are two groups, and nothing about them names a course.
    expect(s.cold).not.toBe(s.warm);
    for (const group of groups) {
      for (const course of Object.values(COURSES)) expect(group.summary).not.toContain(course);
    }
  });

  it("gives fired tickets, prints and sent stamps to groups 1 and 2 only", async () => {
    const v = await setupVenue();
    const s = await specExample(v);
    const lines = await linesOf(s.partyId);
    const inGroup = (groupId: string) => lines.filter((row) => row.groupId === groupId);

    const routedFired = [...inGroup(s.drinks), ...inGroup(s.cold)]
      .filter((row) => row.productId !== v.productId.water)
      .map((row) => row.id)
      .sort();
    expect(await firedTicketLineIds(s.partyId)).toEqual(routedFired);
    for (const row of [...inGroup(s.drinks), ...inGroup(s.cold)]) {
      expect(row.sentAt).not.toBeNull();
    }
    for (const row of [...inGroup(s.warm), ...inGroup(s.mains), ...inGroup(s.desserts)]) {
      expect(row.sentAt).toBeNull();
    }
    const tickets = (await printed(v)).join("\n");
    expect(tickets).toContain(DISHES.beer.kitchen);
    expect(tickets).toContain(DISHES.cold.kitchen);
    for (const dish of ["warm", "steak", "fish", "flan"] as const) {
      expect(tickets).not.toContain(DISHES[dish].kitchen);
    }
  });

  it("credits every submitted line to the operator who submitted it", async () => {
    const v = await setupVenue();
    const s = await seated(v);
    await submit(v, s.partyId, [{ release: "hold", lines: [line(v, "steak", "2")] }], {
      operatorId: MIA,
    });
    const rows = await db
      .select({ creditedTo: workingOrderLines.creditedTo })
      .from(workingOrderLines)
      .where(eq(workingOrderLines.workingOrderId, s.tabId));
    expect(rows).toEqual([{ creditedTo: MIA }]);
  });

  it("puts the lines on the party's next tab when its tab has been paid, and names that tab", async () => {
    const v = await setupVenue();
    const s = await seated(v);
    await submit(v, s.partyId, [{ release: "fire", lines: [line(v, "beer")] }]);
    await db
      .update(workingOrders)
      .set({ status: "settled", settledAt: new Date().toISOString() })
      .where(eq(workingOrders.id, s.tabId));

    const result = await submit(v, s.partyId, [{ release: "fire", lines: [line(v, "flan")] }]);

    expect(result.tabId).not.toBe(s.tabId);
    expect(result.revision).toBe(await revisionOf(s.partyId));
    const [flan] = await linesIn(s.partyId, result.groups[0]!.id);
    expect(flan).toMatchObject({ workingOrderId: result.tabId, name: DISHES.flan.staff });
  });
});

describe("fire all now", () => {
  it("makes ONE fired group of a draft spanning four courses, never one per course", async () => {
    const v = await setupVenue();
    const s = await seated(v);

    const result = await submit(v, s.partyId, [
      {
        release: "fire",
        lines: [line(v, "beer"), line(v, "cold"), line(v, "steak"), line(v, "flan")],
      },
    ]);

    const { groups } = await groupsOf(s.partyId);
    expect(groups).toHaveLength(1);
    expect(groups[0]).toMatchObject({ id: result.groups[0]!.id, position: 1, state: "fired" });
    const lines = await linesOf(s.partyId);
    // The lines keep their four product-default courses, which the earliest-course rule would
    // have held; the group's release decides instead.
    expect(new Set(lines.map((row) => row.courseId)).size).toBe(4);
    expect(await firedTicketLineIds(s.partyId)).toEqual(lines.map((row) => row.id).sort());
  });
});

describe("later additions (§12 item 4)", () => {
  it("submits a later Steak released to fire as a new fired group", async () => {
    const v = await setupVenue();
    const s = await specExample(v);

    const result = await submit(v, s.partyId, [{ release: "fire", lines: [line(v, "steak")] }]);

    const { groups } = await groupsOf(s.partyId);
    expect(groups.map((group) => group.id)).toEqual([
      s.drinks,
      s.cold,
      s.warm,
      s.mains,
      s.desserts,
      result.groups[0]!.id,
    ]);
    expect(groups[5]).toMatchObject({ position: 6, state: "fired", summary: "1 × Steak" });
  });

  it("joins a later Steak to the held mains, keeping its position and reminder", async () => {
    const v = await setupVenue();
    const s = await specExample(v);
    const remindAt = "2026-09-27T21:15:00.000Z";
    await db.update(orderGroups).set({ remindAt }).where(eq(orderGroups.id, s.mains));

    const result = await submit(v, s.partyId, [{ release: "hold", lines: [line(v, "steak")] }], {
      joinGroupId: s.mains,
    });

    expect(result.groups.map((group) => group.id)).toEqual([s.mains]);
    const mains = (await groupsOf(s.partyId)).groups.find((group) => group.id === s.mains)!;
    expect(mains).toMatchObject({ position: 4, state: "held", remindAt });
    expect(mains.lineIds).toHaveLength(3);
    expect((await eventsOf(s.partyId)).at(-1)).toMatchObject({
      groupId: s.mains,
      kind: "joined",
      actorId: ALEX,
    });
  });

  it("refuses to join a fired group (group.not_held), writing nothing", async () => {
    const v = await setupVenue();
    const s = await specExample(v);
    await expectRefusedWithNothingWritten(
      v,
      s.partyId,
      () =>
        submit(v, s.partyId, [{ release: "hold", lines: [line(v, "beer")] }], {
          joinGroupId: s.drinks,
        }),
      { code: "group.not_held", params: { groupId: s.drinks } },
    );
  });

  it("refuses to join a group the party does not have (group.not_found), writing nothing", async () => {
    const v = await setupVenue();
    const s = await specExample(v);
    const other = await specExample(v);
    await expectRefusedWithNothingWritten(
      v,
      s.partyId,
      () =>
        submit(v, s.partyId, [{ release: "hold", lines: [line(v, "beer")] }], {
          joinGroupId: other.mains,
        }),
      { code: "group.not_found", params: { groupId: other.mains } },
    );
  });

  it("never matches a group by course: a fired Steak does not join the held mains", async () => {
    const v = await setupVenue();
    const s = await specExample(v);
    const mainsBefore = await linesIn(s.partyId, s.mains);

    const result = await submit(v, s.partyId, [{ release: "fire", lines: [line(v, "steak")] }]);

    expect(result.groups[0]!.id).not.toBe(s.mains);
    expect(await linesIn(s.partyId, s.mains)).toEqual(mainsBefore);
    const [steak] = await linesIn(s.partyId, result.groups[0]!.id);
    expect(steak!.courseId).toBe(mainsBefore[0]!.courseId);
  });
});

describe("editing held groups", () => {
  it("puts the desserts before the mains, leaving the fired groups at 1 and 2", async () => {
    const v = await setupVenue();
    const s = await specExample(v);

    await reorder(s.partyId, [s.warm, s.desserts, s.mains]);

    const { groups } = await groupsOf(s.partyId);
    expect(groups.map((group) => [group.id, group.position])).toEqual([
      [s.drinks, 1],
      [s.cold, 2],
      [s.warm, 3],
      [s.desserts, 4],
      [s.mains, 5],
    ]);
  });

  it("reverses three held groups at once", async () => {
    const v = await setupVenue();
    const s = await specExample(v);

    await reorder(s.partyId, [s.desserts, s.mains, s.warm]);

    const { groups } = await groupsOf(s.partyId);
    expect(groups.map((group) => group.id)).toEqual([
      s.drinks,
      s.cold,
      s.desserts,
      s.mains,
      s.warm,
    ]);
  });

  it("refuses a reorder naming a fired group (group.not_held), changing nothing", async () => {
    const v = await setupVenue();
    const s = await specExample(v);
    await expectRefusedWithNothingWritten(
      v,
      s.partyId,
      () => reorder(s.partyId, [s.desserts, s.mains, s.warm, s.drinks]),
      { code: "group.not_held", params: { groupId: s.drinks } },
    );
  });

  it("refuses a reorder missing a held group (management.request_invalid), changing nothing", async () => {
    const v = await setupVenue();
    const s = await specExample(v);
    await expectRefusedWithNothingWritten(
      v,
      s.partyId,
      () => reorder(s.partyId, [s.desserts, s.mains]),
      { code: "management.request_invalid", params: { field: "heldGroupIds" } },
    );
    await expectRefusedWithNothingWritten(
      v,
      s.partyId,
      () => reorder(s.partyId, [s.desserts, s.mains, s.warm, s.warm]),
      { code: "management.request_invalid", params: { field: "heldGroupIds" } },
    );
  });

  it("moves one Steak of two from the mains to the desserts, splitting the row and its ticket", async () => {
    const v = await setupVenue();
    const s = await specExample(v);
    const [steak] = await linesIn(s.partyId, s.mains);

    await move(v, s.partyId, [{ lineId: steak!.id, quantity: "1" }], { groupId: s.desserts });

    const { groups } = await groupsOf(s.partyId);
    const byId = new Map(groups.map((group) => [group.id, group]));
    expect(byId.get(s.mains)!.summary).toBe("1 × Steak, 1 × Fish");
    expect(byId.get(s.desserts)!.summary).toBe("2 × Flan, 1 × Steak");
    const steaks = (await linesOf(s.partyId)).filter((row) => row.productId === v.productId.steak);
    expect(steaks.map((row) => [row.groupId, row.quantity, row.creditedTo])).toEqual([
      [s.mains, 1000, ALEX],
      [s.desserts, 1000, ALEX],
    ]);
    const tickets = await ticketsOf(s.partyId);
    for (const row of steaks) {
      expect(tickets.find((ticket) => ticket.lineId === row.id)).toMatchObject({
        firedAt: null,
        quantity: 1000,
      });
    }
  });

  it("answers the party's revision as stored after a move that splits a row and empties a group", async () => {
    const v = await setupVenue();
    const s = await specExample(v);
    const fishOnly = (await submit(v, s.partyId, [{ release: "hold", lines: [line(v, "fish")] }]))
      .groups[0]!.id;
    const [fish] = await linesIn(s.partyId, fishOnly);
    const [steak] = await linesIn(s.partyId, s.mains);
    const before = await revisionOf(s.partyId);

    const result = await move(
      v,
      s.partyId,
      [
        { lineId: steak!.id, quantity: "1" },
        { lineId: fish!.id, quantity: "1" },
      ],
      { groupId: s.desserts },
    );

    expect(result).toEqual({ revision: before + 1 });
    expect(await revisionOf(s.partyId)).toBe(before + 1);
    const [row] = await db.select().from(orderGroups).where(eq(orderGroups.id, fishOnly));
    expect(row!.state).toBe("removed");
  });

  it("moves part of two lines of one bill in one request, splitting each into a numbered row of the target", async () => {
    const v = await setupVenue();
    const s = await specExample(v);
    const [steak] = await linesIn(s.partyId, s.mains);
    const [flan] = await linesIn(s.partyId, s.desserts);

    await move(
      v,
      s.partyId,
      [
        { lineId: steak!.id, quantity: "1" },
        { lineId: flan!.id, quantity: "1" },
      ],
      "new",
    );

    const target = (await groupsOf(s.partyId)).groups[5]!.id;
    const rows = (await linesOf(s.partyId)).map((row) => [
      row.lineNo,
      row.productId,
      row.quantity,
      row.groupId,
    ]);
    expect(rows.slice(4)).toEqual([
      [5, v.productId.steak, 1000, s.mains],
      [6, v.productId.fish, 1000, s.mains],
      [7, v.productId.flan, 1000, s.desserts],
      [8, v.productId.steak, 1000, target],
      [9, v.productId.flan, 1000, target],
    ]);
  });

  it("moves part of a line on each of two bills in one request, splitting each on its own bill", async () => {
    const v = await setupVenue();
    const s = await seated(v);
    const { groups } = await submit(v, s.partyId, [
      { release: "hold", lines: [line(v, "water", "3"), line(v, "steak", "2")] },
    ]);
    const groupId = groups[0]!.id;
    const [water, steak] = await linesIn(s.partyId, groupId);
    const revision = await revisionOf(s.partyId);
    const checkId = await onSecondBill(
      v,
      s,
      [{ lineNo: water!.lineNo, quantity: "2" }],
      revision,
      ALEX,
    );
    const [checkWater] = await linesOfBill(checkId);

    await move(
      v,
      s.partyId,
      [
        { lineId: checkWater!.id, quantity: "1" },
        { lineId: steak!.id, quantity: "1" },
      ],
      "new",
    );

    const target = (await groupsOf(s.partyId)).groups[1]!.id;
    const lines = await linesOf(s.partyId);
    const rowsOf = (billId: string) =>
      lines
        .filter((row) => row.workingOrderId === billId)
        .map((row) => [row.lineNo, row.productId, row.quantity, row.groupId]);
    expect(rowsOf(s.tabId)).toEqual([
      [1, v.productId.water, 1000, groupId],
      [2, v.productId.steak, 1000, groupId],
      [3, v.productId.steak, 1000, target],
    ]);
    expect(rowsOf(checkId)).toEqual([
      [1, v.productId.water, 1000, groupId],
      [2, v.productId.water, 1000, target],
    ]);
  });

  it("splits Steak ×2 into two rows by moving one into a new held group at the end", async () => {
    const v = await setupVenue();
    const s = await specExample(v);
    const [steak] = await linesIn(s.partyId, s.mains);

    await move(v, s.partyId, [{ lineId: steak!.id, quantity: "1" }], "new");

    const { groups } = await groupsOf(s.partyId);
    expect(groups).toHaveLength(6);
    expect(groups[5]).toMatchObject({ position: 6, state: "held", summary: "1 × Steak" });
    expect(groups[3]).toMatchObject({ id: s.mains, summary: "1 × Steak, 1 × Fish" });
  });

  it("split part of a held line into its own group: two rows in that group, quantities summing to the original", async () => {
    const v = await setupVenue();
    const s = await specExample(v);
    const [steak] = await linesIn(s.partyId, s.mains);
    const revision = await revisionOf(s.partyId);
    const events = (await eventsOf(s.partyId)).length;

    await move(v, s.partyId, [{ lineId: steak!.id, quantity: "1" }], { groupId: s.mains });

    expect((await linesIn(s.partyId, s.mains)).map((row) => [row.productId, row.quantity])).toEqual(
      [
        [v.productId.steak, 1000],
        [v.productId.fish, 1000],
        [v.productId.steak, 1000],
      ],
    );
    const { groups } = await groupsOf(s.partyId);
    expect(groups).toHaveLength(5);
    expect(groups[3]).toMatchObject({
      id: s.mains,
      position: 4,
      state: "held",
      summary: "2 × Steak, 1 × Fish",
    });
    const after = await eventsOf(s.partyId);
    expect(after.slice(events).map((event) => [event.groupId, event.kind])).toEqual([
      [s.mains, "lines_moved"],
    ]);
    expect(await revisionOf(s.partyId)).toBe(revision + 1);
  });

  it("removes a group a move empties: gone from the list, its events still readable", async () => {
    const v = await setupVenue();
    const s = await specExample(v);
    const fishOnly = (await submit(v, s.partyId, [{ release: "hold", lines: [line(v, "fish")] }]))
      .groups[0]!.id;
    const [fish] = await linesIn(s.partyId, fishOnly);

    await move(v, s.partyId, [{ lineId: fish!.id, quantity: "1" }], { groupId: s.desserts });

    const [row] = await db.select().from(orderGroups).where(eq(orderGroups.id, fishOnly));
    expect(row!.state).toBe("removed");
    expect((await groupsOf(s.partyId)).groups.map((group) => group.id)).not.toContain(fishOnly);
    const events = (await eventsOf(s.partyId)).filter((event) => event.groupId === fishOnly);
    expect(events.map((event) => event.kind)).toEqual(["submitted", "removed"]);
    expect((await linesIn(s.partyId, s.desserts)).map((line) => line.id)).toContain(fish!.id);
  });

  it("writes one event naming the operator, and moves the party's revision on, for each change", async () => {
    const v = await setupVenue();
    const s = await specExample(v);
    const [steak] = await linesIn(s.partyId, s.mains);
    let fishGroup = "";
    const changes: [string, () => Promise<unknown>][] = [
      [
        "submitted",
        async () => {
          const result = await submit(
            v,
            s.partyId,
            [{ release: "hold", lines: [line(v, "fish")] }],
            { operatorId: MIA },
          );
          fishGroup = result.groups[0]!.id;
        },
      ],
      [
        "joined",
        () =>
          submit(v, s.partyId, [{ release: "hold", lines: [line(v, "flan")] }], {
            joinGroupId: s.desserts,
            operatorId: MIA,
          }),
      ],
      [
        "reordered",
        () => reorder(s.partyId, [fishGroup, s.warm, s.mains, s.desserts], { operatorId: MIA }),
      ],
      [
        "lines_moved",
        () =>
          move(
            v,
            s.partyId,
            [{ lineId: steak!.id, quantity: "1" }],
            { groupId: s.desserts },
            { operatorId: MIA },
          ),
      ],
      ["fired", () => fire(v, s.partyId, s.warm, { operatorId: MIA })],
    ];
    for (const [kind, change] of changes) {
      const revision = await revisionOf(s.partyId);
      const events = (await eventsOf(s.partyId)).length;
      await change();
      expect(await revisionOf(s.partyId)).toBe(revision + 1);
      const after = await eventsOf(s.partyId);
      expect(after).toHaveLength(events + 1);
      expect(after.at(-1)).toMatchObject({ kind, actorId: MIA });
    }
  });

  it("leaves a held group's line freely editable in place, in its group", async () => {
    const v = await setupVenue();
    const s = await specExample(v);
    const [steak] = await linesIn(s.partyId, s.mains);
    const [bill] = await db
      .select({ revision: workingOrders.revision })
      .from(workingOrders)
      .where(eq(workingOrders.id, s.tabId));

    await inTx((tx) =>
      updateOrderLine(tx, v.cfg, s.tabId, steak!.lineNo, { quantity: "3" }, bill!.revision),
    );

    const [edited] = await linesIn(s.partyId, s.mains);
    expect(edited).toMatchObject({ id: steak!.id, quantity: 3000, groupId: s.mains });
    expect(await printed(v)).toHaveLength(2);
  });
});

describe("firing", () => {
  it("fires the warm starters: sent, fired, printed at fire, and a fired event", async () => {
    const v = await setupVenue();
    const s = await specExample(v);
    const [warm] = await linesIn(s.partyId, s.warm);
    const jobsBefore = (await printed(v)).length;

    const result = await fire(v, s.partyId, s.warm, { operatorId: MIA });

    expect(result).toEqual({ revision: await revisionOf(s.partyId) });
    const [after] = await linesIn(s.partyId, s.warm);
    expect(after!.sentAt).not.toBeNull();
    expect(await firedTicketLineIds(s.partyId)).toContain(warm!.id);
    const jobs = await printed(v);
    expect(jobs).toHaveLength(jobsBefore + 1);
    expect(jobs.at(-1)).toContain(DISHES.warm.kitchen);
    const [group] = await db.select().from(orderGroups).where(eq(orderGroups.id, s.warm));
    expect(group).toMatchObject({ state: "fired", firedBy: MIA, firedAt: expect.any(String) });
    expect((await eventsOf(s.partyId)).at(-1)).toMatchObject({
      groupId: s.warm,
      kind: "fired",
      actorId: MIA,
    });
  });

  it("refuses to fire a fired group again under a new submission (group.not_held)", async () => {
    const v = await setupVenue();
    const s = await specExample(v);
    await fire(v, s.partyId, s.warm);
    await expectRefusedWithNothingWritten(v, s.partyId, () => fire(v, s.partyId, s.warm), {
      code: "group.not_held",
      params: { groupId: s.warm },
    });
  });

  it("refuses a group the party does not have (group.not_found)", async () => {
    const v = await setupVenue();
    const s = await specExample(v);
    const missing = randomUUID();
    await expectRefusedWithNothingWritten(v, s.partyId, () => fire(v, s.partyId, missing), {
      code: "group.not_found",
      params: { groupId: missing },
    });
  });

  it("stamps a held no-route line sent only when its group fires", async () => {
    const v = await setupVenue();
    const s = await seated(v);
    const { groups } = await submit(v, s.partyId, [
      { release: "hold", lines: [line(v, "water"), line(v, "flan")] },
    ]);
    const groupId = groups[0]!.id;
    expect((await linesIn(s.partyId, groupId)).map((row) => row.sentAt)).toEqual([null, null]);

    await fire(v, s.partyId, groupId);

    const lines = await linesIn(s.partyId, groupId);
    expect(lines.map((row) => row.sentAt)).toEqual([expect.any(String), expect.any(String)]);
  });

  it("refuses a group holding a sold-out Steak, firing none of it, then fires once it is removed", async () => {
    const v = await setupVenue();
    const s = await specExample(v);
    await db.run(sql`update products set available = 0 where id = ${v.productId.steak}`);

    await expectRefusedWithNothingWritten(v, s.partyId, () => fire(v, s.partyId, s.mains), {
      code: "product.unavailable",
      params: { productId: v.productId.steak },
    });

    const [steak, fish] = await linesIn(s.partyId, s.mains);
    await inTx((tx) => cancelLine(tx, v.cfg, s.tabId, steak!.lineNo));
    await fire(v, s.partyId, s.mains);
    expect(await firedTicketLineIds(s.partyId)).toContain(fish!.id);
  });

  it("fires nothing and prints nothing when the sold-out line is on the second of two bills", async () => {
    const v = await setupVenue();
    const s = await seated(v);
    const { groups } = await submit(v, s.partyId, [
      { release: "hold", lines: [line(v, "steak"), line(v, "water")] },
    ]);
    const groupId = groups[0]!.id;
    const [, water] = await linesIn(s.partyId, groupId);
    const revision = await revisionOf(s.partyId);
    // The second bill is opened after the tab, so its line is released second.
    await onSecondBill(v, s, [{ lineNo: water!.lineNo }], revision, ALEX);
    await db.run(sql`update products set available = 0 where id = ${v.productId.water}`);

    await expectRefusedWithNothingWritten(v, s.partyId, () => fire(v, s.partyId, groupId), {
      code: "product.unavailable",
      params: { productId: v.productId.water },
    });
    expect(await firedTicketLineIds(s.partyId)).toEqual([]);
    expect(await printed(v)).toEqual([]);
  });
});

describe("retries (D8): each writes nothing the second time", () => {
  it("answers a repeated submission with the same groups, even carrying the now-stale revision", async () => {
    const v = await setupVenue();
    const s = await seated(v);
    const submissionId = randomUUID();
    const revision = await revisionOf(s.partyId);
    const groups = [{ release: "fire" as const, lines: [line(v, "steak")] }];

    const first = await submit(v, s.partyId, groups, { submissionId, revision });
    const before = await snapshot(v, s.partyId);
    const second = await submit(v, s.partyId, groups, { submissionId, revision });

    expect(second).toEqual(first);
    expect(await snapshot(v, s.partyId)).toEqual(before);
  });

  it("adds a joined Steak once when the join is repeated", async () => {
    const v = await setupVenue();
    const s = await specExample(v);
    const submissionId = randomUUID();
    const revision = await revisionOf(s.partyId);
    const join = () =>
      submit(v, s.partyId, [{ release: "hold", lines: [line(v, "steak")] }], {
        joinGroupId: s.mains,
        submissionId,
        revision,
      });

    await join();
    const before = await snapshot(v, s.partyId);
    await join();

    expect(await snapshot(v, s.partyId)).toEqual(before);
    expect(await linesIn(s.partyId, s.mains)).toHaveLength(3);
  });

  it("prints a fired group once when the fire is repeated", async () => {
    const v = await setupVenue();
    const s = await specExample(v);
    const opts = { submissionId: randomUUID(), revision: await revisionOf(s.partyId) };

    const first = await fire(v, s.partyId, s.warm, opts);
    const before = await snapshot(v, s.partyId);
    const second = await fire(v, s.partyId, s.warm, opts);

    expect(second).toEqual(first);
    expect(await snapshot(v, s.partyId)).toEqual(before);
  });

  it("moves once when a move is repeated", async () => {
    const v = await setupVenue();
    const s = await specExample(v);
    const [steak] = await linesIn(s.partyId, s.mains);
    const opts = { submissionId: randomUUID(), revision: await revisionOf(s.partyId) };
    const moves = [{ lineId: steak!.id, quantity: "1" }];

    await move(v, s.partyId, moves, { groupId: s.desserts }, opts);
    const before = await snapshot(v, s.partyId);
    await move(v, s.partyId, moves, { groupId: s.desserts }, opts);

    expect(await snapshot(v, s.partyId)).toEqual(before);
  });
});

describe("an id reused for a different request (D8) is submission.id_reused", () => {
  it("refuses the same id with the Steak's quantity changed", async () => {
    const v = await setupVenue();
    const s = await seated(v);
    const submissionId = randomUUID();
    await submit(v, s.partyId, [{ release: "fire", lines: [line(v, "steak", "1")] }], {
      submissionId,
    });
    await expectRefusedWithNothingWritten(
      v,
      s.partyId,
      () =>
        submit(v, s.partyId, [{ release: "fire", lines: [line(v, "steak", "2")] }], {
          submissionId,
        }),
      { code: "submission.id_reused", params: { submissionId } },
    );
  });

  it("refuses the same id on a move naming another target group", async () => {
    const v = await setupVenue();
    const s = await specExample(v);
    const [steak] = await linesIn(s.partyId, s.mains);
    const submissionId = randomUUID();
    const moves = [{ lineId: steak!.id, quantity: "1" }];
    await move(v, s.partyId, moves, { groupId: s.desserts }, { submissionId });
    await expectRefusedWithNothingWritten(
      v,
      s.partyId,
      () => move(v, s.partyId, moves, { groupId: s.warm }, { submissionId }),
      { code: "submission.id_reused", params: { submissionId } },
    );
  });

  it("refuses an id first used by a submission, then sent with a fire", async () => {
    const v = await setupVenue();
    const s = await specExample(v);
    const submissionId = randomUUID();
    await submit(v, s.partyId, [{ release: "hold", lines: [line(v, "fish")] }], { submissionId });
    await expectRefusedWithNothingWritten(
      v,
      s.partyId,
      () => fire(v, s.partyId, s.warm, { submissionId }),
      { code: "submission.id_reused", params: { submissionId } },
    );
  });

  it("refuses an id that fired the mains, sent again to fire the desserts", async () => {
    const v = await setupVenue();
    const s = await specExample(v);
    const submissionId = randomUUID();
    await fire(v, s.partyId, s.mains, { submissionId });
    await expectRefusedWithNothingWritten(
      v,
      s.partyId,
      () => fire(v, s.partyId, s.desserts, { submissionId }),
      { code: "submission.id_reused", params: { submissionId } },
    );
  });
});

describe("stale screens (D19)", () => {
  it("fires a group whose lines sit on two bills of the party: every line, on both bills", async () => {
    const v = await setupVenue();
    const s = await seated(v);
    const { groups } = await submit(v, s.partyId, [
      { release: "hold", lines: [line(v, "water", "2"), line(v, "steak")] },
    ]);
    const groupId = groups[0]!.id;
    const [water] = await linesIn(s.partyId, groupId);
    const revision = await revisionOf(s.partyId);
    const checkId = await onSecondBill(
      v,
      s,
      [{ lineNo: water!.lineNo, quantity: "1" }],
      revision,
      ALEX,
    );
    const billRevisions = async () =>
      db
        .select({ id: workingOrders.id, revision: workingOrders.revision })
        .from(workingOrders)
        .where(inArray(workingOrders.id, [s.tabId, checkId]))
        .orderBy(workingOrders.id);
    const before = await billRevisions();

    await fire(v, s.partyId, groupId);

    const lines = await linesIn(s.partyId, groupId);
    expect(lines.map((row) => row.workingOrderId).sort()).toEqual(
      [s.tabId, s.tabId, checkId].sort(),
    );
    expect(lines.every((row) => row.sentAt !== null)).toBe(true);
    expect(await billRevisions()).toEqual(
      before.map((bill) => ({ ...bill, revision: bill.revision + 1 })),
    );
  });

  it("refuses device A's fire after device B moved a line between held groups, then fires the moved line", async () => {
    const v = await setupVenue();
    const s = await specExample(v);
    const seenByA = await revisionOf(s.partyId);
    const [steak] = await linesIn(s.partyId, s.mains);
    await move(v, s.partyId, [{ lineId: steak!.id, quantity: "2" }], { groupId: s.warm });

    await expectRefusedWithNothingWritten(
      v,
      s.partyId,
      () => fire(v, s.partyId, s.warm, { revision: seenByA }),
      { code: "party.out_of_date", params: { partyId: s.partyId, revision: seenByA + 1 } },
    );

    await fire(v, s.partyId, s.warm);
    expect(await firedTicketLineIds(s.partyId)).toContain(steak!.id);
  });

  it("refuses a reorder and a move sent with a revision another device has moved on", async () => {
    const v = await setupVenue();
    const s = await specExample(v);
    const stale = await revisionOf(s.partyId);
    await reorder(s.partyId, [s.warm, s.desserts, s.mains]);
    const [steak] = await linesIn(s.partyId, s.mains);

    await expectRefusedWithNothingWritten(
      v,
      s.partyId,
      () => reorder(s.partyId, [s.mains, s.desserts, s.warm], { revision: stale }),
      { code: "party.out_of_date" },
    );
    await expectRefusedWithNothingWritten(
      v,
      s.partyId,
      () =>
        move(
          v,
          s.partyId,
          [{ lineId: steak!.id, quantity: "1" }],
          { groupId: s.warm },
          {
            revision: stale,
          },
        ),
      { code: "party.out_of_date" },
    );
  });
});

describe("two orders of events", () => {
  it("fire the mains, then move a Steak into them: group.not_held, and the Steak stays", async () => {
    const v = await setupVenue();
    const s = await specExample(v);
    const steakGroup = (
      await submit(v, s.partyId, [{ release: "hold", lines: [line(v, "steak")] }])
    ).groups[0]!.id;
    const [steak] = await linesIn(s.partyId, steakGroup);
    await fire(v, s.partyId, s.mains);

    await expectRefusedWithNothingWritten(
      v,
      s.partyId,
      () => move(v, s.partyId, [{ lineId: steak!.id, quantity: "1" }], { groupId: s.mains }),
      { code: "group.not_held", params: { groupId: s.mains } },
    );
    expect((await linesIn(s.partyId, steakGroup)).map((row) => row.id)).toEqual([steak!.id]);
  });

  it("move a Steak into the mains, then fire them: the Steak fires with them", async () => {
    const v = await setupVenue();
    const s = await specExample(v);
    const steakGroup = (
      await submit(v, s.partyId, [{ release: "hold", lines: [line(v, "steak")] }])
    ).groups[0]!.id;
    const [steak] = await linesIn(s.partyId, steakGroup);

    await move(v, s.partyId, [{ lineId: steak!.id, quantity: "1" }], { groupId: s.mains });
    await fire(v, s.partyId, s.mains);

    expect((await linesIn(s.partyId, s.mains)).map((row) => row.id)).toContain(steak!.id);
    expect(await firedTicketLineIds(s.partyId)).toContain(steak!.id);
  });

  it("refuses to move a line OUT of a fired group (group.not_held)", async () => {
    const v = await setupVenue();
    const s = await specExample(v);
    const [beer] = await linesIn(s.partyId, s.drinks);
    await expectRefusedWithNothingWritten(
      v,
      s.partyId,
      () => move(v, s.partyId, [{ lineId: beer!.id, quantity: "1" }], { groupId: s.mains }),
      { code: "group.not_held", params: { groupId: s.drinks } },
    );
  });
});

describe("during a card payment", () => {
  async function paying(tabId: string): Promise<void> {
    await db
      .update(workingOrders)
      .set({ paymentAttemptAt: new Date().toISOString() })
      .where(eq(workingOrders.id, tabId));
  }

  it("refuses a submission (order.payment_in_flight), writing nothing", async () => {
    const v = await setupVenue();
    const s = await specExample(v);
    await paying(s.tabId);
    await expectRefusedWithNothingWritten(
      v,
      s.partyId,
      () => submit(v, s.partyId, [{ release: "hold", lines: [line(v, "fish")] }]),
      { code: "order.payment_in_flight", params: { workingOrderId: s.tabId } },
    );
  });

  it("refuses to fire a group (order.payment_in_flight), writing nothing", async () => {
    const v = await setupVenue();
    const s = await specExample(v);
    await paying(s.tabId);
    await expectRefusedWithNothingWritten(v, s.partyId, () => fire(v, s.partyId, s.warm), {
      code: "order.payment_in_flight",
      params: { workingOrderId: s.tabId },
    });
  });

  it("refuses a move into a held group (order.payment_in_flight), writing nothing", async () => {
    const v = await setupVenue();
    const s = await specExample(v);
    const [steak] = await linesIn(s.partyId, s.mains);
    await paying(s.tabId);
    await expectRefusedWithNothingWritten(
      v,
      s.partyId,
      () => move(v, s.partyId, [{ lineId: steak!.id, quantity: "1" }], { groupId: s.desserts }),
      { code: "order.payment_in_flight", params: { workingOrderId: s.tabId } },
    );
  });

  it("refuses a reorder of the held groups (order.payment_in_flight), writing nothing", async () => {
    const v = await setupVenue();
    const s = await specExample(v);
    await paying(s.tabId);
    const revision = await revisionOf(s.partyId);
    const before = (await groupsOf(s.partyId)).groups.map(({ id, position }) => ({ id, position }));
    const events = await eventsOf(s.partyId);
    await expectRefusedWithNothingWritten(
      v,
      s.partyId,
      () => reorder(s.partyId, [s.desserts, s.mains, s.warm]),
      { code: "order.payment_in_flight", params: { workingOrderId: s.tabId } },
    );
    expect(await revisionOf(s.partyId)).toBe(revision);
    expect(
      (await groupsOf(s.partyId)).groups.map(({ id, position }) => ({ id, position })),
    ).toEqual(before);
    expect(await eventsOf(s.partyId)).toEqual(events);
  });
});

describe("the fired groups' lines", () => {
  it("record who fired them and when, and no held group has a fired time", async () => {
    const v = await setupVenue();
    const s = await specExample(v);
    const rows = await db
      .select({
        id: orderGroups.id,
        firedBy: orderGroups.firedBy,
        submittedBy: orderGroups.submittedBy,
      })
      .from(orderGroups)
      .where(and(eq(orderGroups.partyId, s.partyId), isNotNull(orderGroups.firedAt)))
      .orderBy(orderGroups.position);
    expect(rows).toEqual([
      { id: s.drinks, firedBy: ALEX, submittedBy: ALEX },
      { id: s.cold, firedBy: ALEX, submittedBy: ALEX },
    ]);
  });
});

describe("extras lines follow their dish", () => {
  function steakWithSauce(v: Venue): GroupLine {
    return {
      ...line(v, "steak"),
      extras: [{ listId: v.extrasListId, picks: [{ productId: v.productId.sauce, quantity: 1 }] }],
    };
  }

  async function allLinesOf(tabId: string) {
    return db
      .select({
        id: workingOrderLines.id,
        parentLineId: workingOrderLines.parentLineId,
        groupId: workingOrderLines.groupId,
        creditedTo: workingOrderLines.creditedTo,
      })
      .from(workingOrderLines)
      .where(eq(workingOrderLines.workingOrderId, tabId))
      .orderBy(workingOrderLines.lineNo);
  }

  it("puts a submitted dish's extras in its group, credited to the same operator", async () => {
    const v = await setupVenue();
    const s = await seated(v);
    const { groups } = await submit(
      v,
      s.partyId,
      [{ release: "hold", lines: [steakWithSauce(v)] }],
      { operatorId: MIA },
    );

    const [dish, sauce] = await allLinesOf(s.tabId);
    expect(sauce).toMatchObject({
      parentLineId: dish!.id,
      groupId: groups[0]!.id,
      creditedTo: MIA,
    });
    expect(groups[0]).toMatchObject({ lineIds: [dish!.id], summary: "1 × Steak" });
  });

  it("puts each dish's extras in its own group when one submission carries two groups", async () => {
    const v = await setupVenue();
    const s = await seated(v);
    const { groups } = await submit(
      v,
      s.partyId,
      [
        { release: "fire", lines: [steakWithSauce(v), line(v, "beer")] },
        { release: "hold", lines: [line(v, "flan"), steakWithSauce(v)] },
      ],
      { operatorId: MIA },
    );
    const [first, second] = groups.map((group) => group.id);

    const rows = await db
      .select({
        id: workingOrderLines.id,
        lineNo: workingOrderLines.lineNo,
        productId: workingOrderLines.productId,
        parentLineId: workingOrderLines.parentLineId,
        groupId: workingOrderLines.groupId,
        creditedTo: workingOrderLines.creditedTo,
      })
      .from(workingOrderLines)
      .where(eq(workingOrderLines.workingOrderId, s.tabId))
      .orderBy(workingOrderLines.lineNo);
    const lineNoOf = new Map(rows.map((row) => [row.id, row.lineNo]));
    expect(
      rows.map((row) => [
        row.lineNo,
        row.productId,
        row.parentLineId === null ? null : lineNoOf.get(row.parentLineId),
        row.groupId,
        row.creditedTo,
      ]),
    ).toEqual([
      [1, v.productId.steak, null, first, MIA],
      [2, v.productId.sauce, 1, first, MIA],
      [3, v.productId.beer, null, first, MIA],
      [4, v.productId.flan, null, second, MIA],
      [5, v.productId.steak, null, second, MIA],
      [6, v.productId.sauce, 5, second, MIA],
    ]);
  });

  it("moves a whole dish with its extras into another held group", async () => {
    const v = await setupVenue();
    const s = await specExample(v);
    const { groups } = await submit(v, s.partyId, [
      { release: "hold", lines: [steakWithSauce(v)] },
    ]);
    const lines = await allLinesOf(s.tabId);
    const dish = lines.find((row) => row.groupId === groups[0]!.id && row.parentLineId === null)!;

    await move(v, s.partyId, [{ lineId: dish.id, quantity: "1" }], { groupId: s.mains });

    const moved = (await allLinesOf(s.tabId)).filter(
      (row) => row.id === dish.id || row.parentLineId === dish.id,
    );
    expect(moved.map((row) => row.groupId)).toEqual([s.mains, s.mains]);
  });

  it("refuses to move part of a dish that has extras (tab.transfer_modifier_line), writing nothing", async () => {
    const v = await setupVenue();
    const s = await seated(v);
    await submit(v, s.partyId, [
      { release: "hold", lines: [{ ...steakWithSauce(v), quantity: "2" }] },
    ]);
    const target = (await submit(v, s.partyId, [{ release: "hold", lines: [line(v, "flan")] }]))
      .groups[0]!.id;
    const dish = (await allLinesOf(s.tabId)).find(
      (row) => row.parentLineId === null && row.groupId !== target,
    )!;

    await expectRefusedWithNothingWritten(
      v,
      s.partyId,
      () => move(v, s.partyId, [{ lineId: dish.id, quantity: "1" }], { groupId: target }),
      { code: "tab.transfer_modifier_line" },
    );
  });

  it("refuses to move an extras line on its own (group.not_found), writing nothing", async () => {
    const v = await setupVenue();
    const s = await seated(v);
    await submit(v, s.partyId, [{ release: "hold", lines: [steakWithSauce(v)] }]);
    const target = (await submit(v, s.partyId, [{ release: "hold", lines: [line(v, "flan")] }]))
      .groups[0]!.id;
    const sauce = (await allLinesOf(s.tabId)).find((row) => row.parentLineId !== null)!;

    await expectRefusedWithNothingWritten(
      v,
      s.partyId,
      () => move(v, s.partyId, [{ lineId: sauce.id, quantity: "1" }], { groupId: target }),
      { code: "group.not_found", params: { lineId: sauce.id } },
    );
  });
});

describe("malformed commands are refused, writing nothing", () => {
  it("refuses a submission with no groups", async () => {
    const v = await setupVenue();
    const s = await seated(v);
    await expectRefusedWithNothingWritten(v, s.partyId, () => submit(v, s.partyId, []), {
      code: "management.request_invalid",
      params: { field: "groups" },
    });
  });

  it("refuses a submission holding a group with no lines, first or later (sale.empty_basket)", async () => {
    const v = await setupVenue();
    const s = await specExample(v);
    const empty = { release: "hold" as const, lines: [] };
    const fish = { release: "fire" as const, lines: [line(v, "fish")] };
    for (const groups of [
      [empty, fish],
      [fish, empty],
    ]) {
      await expectRefusedWithNothingWritten(v, s.partyId, () => submit(v, s.partyId, groups), {
        code: "sale.empty_basket",
      });
    }
  });

  it("refuses a join carrying two groups, or one released to fire", async () => {
    const v = await setupVenue();
    const s = await specExample(v);
    const hold = { release: "hold" as const, lines: [line(v, "fish")] };
    for (const groups of [[hold, hold], [{ ...hold, release: "fire" as const }]]) {
      await expectRefusedWithNothingWritten(
        v,
        s.partyId,
        () => submit(v, s.partyId, groups, { joinGroupId: s.mains }),
        { code: "management.request_invalid", params: { field: "joinGroupId" } },
      );
    }
  });

  it("refuses a join to a removed group as not found", async () => {
    const v = await setupVenue();
    const s = await specExample(v);
    const fishOnly = (await submit(v, s.partyId, [{ release: "hold", lines: [line(v, "fish")] }]))
      .groups[0]!.id;
    const [fish] = await linesIn(s.partyId, fishOnly);
    await move(v, s.partyId, [{ lineId: fish!.id, quantity: "1" }], { groupId: s.mains });

    await expectRefusedWithNothingWritten(
      v,
      s.partyId,
      () =>
        submit(v, s.partyId, [{ release: "hold", lines: [line(v, "fish")] }], {
          joinGroupId: fishOnly,
        }),
      { code: "group.not_found", params: { groupId: fishOnly } },
    );
  });

  it("refuses a reorder naming a group the party does not have", async () => {
    const v = await setupVenue();
    const s = await specExample(v);
    const missing = randomUUID();
    await expectRefusedWithNothingWritten(
      v,
      s.partyId,
      () => reorder(s.partyId, [s.warm, s.mains, s.desserts, missing]),
      { code: "group.not_found", params: { groupId: missing } },
    );
  });

  it("refuses a move with no lines, or naming one line twice", async () => {
    const v = await setupVenue();
    const s = await specExample(v);
    const [steak] = await linesIn(s.partyId, s.mains);
    const twice = [
      { lineId: steak!.id, quantity: "1" },
      { lineId: steak!.id, quantity: "1" },
    ];
    for (const moves of [[], twice]) {
      await expectRefusedWithNothingWritten(
        v,
        s.partyId,
        () => move(v, s.partyId, moves, { groupId: s.desserts }),
        { code: "management.request_invalid", params: { field: "moves" } },
      );
    }
  });

  it("refuses a move of a line no group of the party holds", async () => {
    const v = await setupVenue();
    const s = await specExample(v);
    const other = await specExample(v);
    const [steak] = await linesIn(other.partyId, other.mains);
    await expectRefusedWithNothingWritten(
      v,
      s.partyId,
      () => move(v, s.partyId, [{ lineId: steak!.id, quantity: "1" }], { groupId: s.desserts }),
      { code: "group.not_found", params: { lineId: steak!.id } },
    );
  });

  it("refuses a move of a malformed or too large quantity", async () => {
    const v = await setupVenue();
    const s = await specExample(v);
    const [steak] = await linesIn(s.partyId, s.mains);
    for (const quantity of ["abc", "3"]) {
      await expectRefusedWithNothingWritten(
        v,
        s.partyId,
        () => move(v, s.partyId, [{ lineId: steak!.id, quantity }], { groupId: s.desserts }),
        { code: "tab.transfer_quantity_invalid" },
      );
    }
  });

  it("lists no groups of a party that does not exist", async () => {
    const missing = randomUUID();
    await expect(groupsOf(missing)).rejects.toMatchObject({
      code: "party.not_open",
      params: { partyId: missing },
    });
  });
});

describe("a group's summary", () => {
  it("names a variant after its dish, adds equal dishes together and writes part quantities plainly", async () => {
    const v = await setupVenue();
    const s = await seated(v);
    const { groups } = await submit(v, s.partyId, [
      { release: "hold", lines: [line(v, "steak"), line(v, "fish", "2"), line(v, "fish", "10")] },
    ]);
    const [steak, fish] = await linesIn(s.partyId, groups[0]!.id);
    await db
      .update(workingOrderLines)
      .set({ variantName: "Rare" })
      .where(eq(workingOrderLines.id, steak!.id));
    await db
      .update(workingOrderLines)
      .set({ quantity: 1500 })
      .where(eq(workingOrderLines.id, fish!.id));

    expect((await groupsOf(s.partyId)).groups[0]!.summary).toBe("1 × Steak (Rare), 11.5 × Fish");
  });
});

describe("a held line on a paid bill", () => {
  it("is not moved, whole or in part (working_order.not_open), writing nothing", async () => {
    const v = await setupVenue();
    const s = await specExample(v);
    const [steak] = await linesIn(s.partyId, s.mains);
    await db
      .update(workingOrders)
      .set({ status: "settled", settledAt: new Date().toISOString() })
      .where(eq(workingOrders.id, s.tabId));

    for (const quantity of ["2", "1"]) {
      await expectRefusedWithNothingWritten(
        v,
        s.partyId,
        () => move(v, s.partyId, [{ lineId: steak!.id, quantity }], { groupId: s.desserts }),
        { code: "working_order.not_open", params: { workingOrderId: s.tabId } },
      );
    }
  });
});

/** The PartyCommand a tab path is sent, at both parties' current revisions. */
/** What a bill action on the party is sent: its revision as read now, and who acts. */
async function billCommand(partyId: string) {
  return { expectedPartyRevision: await revisionOf(partyId), operatorId: ALEX };
}

/**
 * A party's bill, with its lines as `fill` rings them, taken to the counter with no zone: a bill of
 * no party that keeps the table zone's service mode.
 */
async function billOfNoParty(
  v: Venue,
  fill: (tx: Transaction, billId: string) => Promise<void>,
): Promise<string> {
  const { tabId, partyId } = await inTx(async (tx) => {
    const { id: tableId } = await createTable(tx, v.cfg, {
      label: `N-${randomUUID().slice(0, 6)}`,
      zoneId: v.zoneId,
    });
    const opened = await openPartyTab(tx, v.cfg, { tableId });
    await fill(tx, opened.tabId);
    return opened;
  });
  await inTx(async (tx) =>
    moveBill(
      tx,
      v.cfg,
      tabId,
      { counter: { zoneId: null } },
      { ...(await billCommand(partyId)), bills: "separate", partyId },
    ),
  );
  return tabId;
}

/**
 * The chosen items of the party's tab transferred onto a new, empty bill of the party, sent at
 * `revision` by `operatorId`.
 */
async function onSecondBill(
  v: Venue,
  s: Seated,
  transfers: { lineNo: number; quantity?: string }[],
  revision: number,
  operatorId: string,
): Promise<string> {
  const billId = randomUUID();
  await inTx(async (tx) => {
    await createOpenOrder(tx, v.cfg, billId, [], null, { partyId: s.partyId });
    await VENUE_SERVICE.copyOrderContext(tx, v.cfg, s.tabId, billId);
    await transferItems(tx, v.cfg, s.tabId, billId, transfers, {
      expectedPartyRevision: revision,
      operatorId,
    });
  });
  return billId;
}

async function linesOfBill(tabId: string) {
  return db
    .select({
      id: workingOrderLines.id,
      lineNo: workingOrderLines.lineNo,
      quantity: workingOrderLines.quantity,
      groupId: workingOrderLines.groupId,
      creditedTo: workingOrderLines.creditedTo,
      sentAt: workingOrderLines.sentAt,
      parentLineId: workingOrderLines.parentLineId,
    })
    .from(workingOrderLines)
    .where(eq(workingOrderLines.workingOrderId, tabId))
    .orderBy(asc(workingOrderLines.lineNo));
}

describe("a line leaving its party", () => {
  it("clears the group of a dish's extras lines too when its bill leaves the party", async () => {
    const v = await setupVenue();
    const s = await seated(v);
    await submit(v, s.partyId, [
      {
        release: "fire",
        lines: [
          {
            ...line(v, "steak"),
            extras: [
              { listId: v.extrasListId, picks: [{ productId: v.productId.sauce, quantity: 1 }] },
            ],
          },
        ],
      },
    ]);
    const { billId } = await inTx(async (tx) =>
      splitBill(tx, v.cfg, s.tabId, [{ lineNo: 1 }], await billCommand(s.partyId)),
    );
    expect((await linesOfBill(billId)).map((row) => row.groupId)).not.toContain(null);

    await inTx(async (tx) =>
      moveBill(
        tx,
        v.cfg,
        billId,
        { counter: { zoneId: null } },
        { ...(await billCommand(s.partyId)), bills: "separate", partyId: s.partyId },
      ),
    );

    const landed = await linesOfBill(billId);
    expect(landed).toHaveLength(2);
    expect(landed.map((row) => row.groupId)).toEqual([null, null]);
  });

  it.each([
    ["whole", undefined],
    ["part", "1"],
  ] as const)(
    "keeps the group of a held line (%s) transferred to another bill of the same party",
    async (_, quantity) => {
      const v = await setupVenue();
      const s = await specExample(v);
      const secondTab = randomUUID();
      await inTx(async (tx) => {
        await createOpenOrder(tx, v.cfg, secondTab, [], null, { partyId: s.partyId });
        await VENUE_SERVICE.copyOrderContext(tx, v.cfg, s.tabId, secondTab);
      });
      const [steak] = await linesIn(s.partyId, s.mains);
      const revision = await revisionOf(s.partyId);

      await inTx(async (tx) =>
        transferItems(
          tx,
          v.cfg,
          s.tabId,
          secondTab,
          [{ lineNo: steak!.lineNo, quantity }],
          await billCommand(s.partyId),
        ),
      );

      expect(await linesOfBill(secondTab)).toMatchObject([{ groupId: s.mains }]);
      expect(await revisionOf(s.partyId)).toBe(revision + 1);
    },
  );
});

describe("merging two bills (D2)", () => {
  it("appends the source party's groups after the target's, in their own order", async () => {
    const v = await setupVenue();
    const into = await seated(v);
    const target = await submit(v, into.partyId, [
      { release: "fire", lines: [line(v, "beer")] },
      { release: "hold", lines: [line(v, "flan")] },
    ]);
    const from = await specExample(v);
    // The source's held groups no longer sit in the order they were made.
    await reorder(from.partyId, [from.desserts, from.warm, from.mains]);
    const command = {
      bills: "merge" as const,
      expectedPartyRevision: await revisionOf(into.partyId),
      otherPartyId: from.partyId,
      expectedOtherPartyRevision: await revisionOf(from.partyId),
      operatorId: ALEX,
    };

    await inTx((tx) => joinTables(tx, v.cfg, into.partyId, from.tableId, command));

    const { groups } = await groupsOf(into.partyId);
    expect(groups.map((group) => [group.id, group.position, group.state])).toEqual([
      [target.groups[0]!.id, 1, "fired"],
      [target.groups[1]!.id, 2, "held"],
      [from.drinks, 3, "fired"],
      [from.cold, 4, "fired"],
      [from.desserts, 5, "held"],
      [from.warm, 6, "held"],
      [from.mains, 7, "held"],
    ]);
    expect((await groupsOf(from.partyId)).groups).toEqual([]);
    const moved = await linesOfBill(into.tabId);
    expect(new Set(moved.map((row) => row.groupId))).toEqual(
      new Set([
        ...target.groups.map((group) => group.id),
        from.drinks,
        from.cold,
        from.warm,
        from.mains,
        from.desserts,
      ]),
    );

    await fire(v, into.partyId, from.mains);
    expect((await groupsOf(into.partyId)).groups.find((g) => g.id === from.mains)!.state).toBe(
      "fired",
    );
  });

  it("leaves the groups as they are when a check goes back onto its tab in the same party", async () => {
    const v = await setupVenue();
    const s = await specExample(v);
    const [croquettes] = await linesIn(s.partyId, s.cold);
    const { billId: checkId } = await inTx(async (tx) =>
      splitBill(tx, v.cfg, s.tabId, [{ lineNo: croquettes!.lineNo, quantity: "1" }], {
        expectedPartyRevision: await revisionOf(s.partyId),
        operatorId: ALEX,
      }),
    );
    const groupsBefore = await db
      .select()
      .from(orderGroups)
      .where(eq(orderGroups.partyId, s.partyId))
      .orderBy(orderGroups.id);
    const command = await billCommand(s.partyId);

    await inTx((tx) => mergeBills(tx, v.cfg, s.tabId, checkId, command));

    expect(
      await db
        .select()
        .from(orderGroups)
        .where(eq(orderGroups.partyId, s.partyId))
        .orderBy(orderGroups.id),
    ).toEqual(groupsBefore);
    expect((await linesIn(s.partyId, s.cold)).map((row) => row.workingOrderId)).toEqual([
      s.tabId,
      s.tabId,
    ]);
  });
});

describe("a group split across bills of its party", () => {
  it("refuses device A's fire after device B moved the group's line onto another bill, then fires every line", async () => {
    const v = await setupVenue();
    const s = await seated(v);
    const { groups } = await submit(v, s.partyId, [
      { release: "hold", lines: [line(v, "water", "2"), line(v, "steak")] },
    ]);
    const groupId = groups[0]!.id;
    const seenByA = await revisionOf(s.partyId);
    const [water] = await linesIn(s.partyId, groupId);
    const checkId = await onSecondBill(
      v,
      s,
      [{ lineNo: water!.lineNo, quantity: "1" }],
      seenByA,
      MIA,
    );

    await expectRefusedWithNothingWritten(
      v,
      s.partyId,
      () => fire(v, s.partyId, groupId, { revision: seenByA }),
      { code: "party.out_of_date", params: { partyId: s.partyId, revision: seenByA + 1 } },
    );

    await fire(v, s.partyId, groupId);
    const lines = await linesIn(s.partyId, groupId);
    expect(lines.map((row) => row.workingOrderId).sort()).toEqual(
      [s.tabId, s.tabId, checkId].sort(),
    );
    expect(lines.every((row) => row.sentAt !== null)).toBe(true);
  });

  it("keeps the group and credit of a fired-group line split onto a check", async () => {
    const v = await setupVenue();
    const s = await specExample(v);
    const [croquettes] = await linesIn(s.partyId, s.cold);
    const revision = await revisionOf(s.partyId);

    const { billId: checkId } = await inTx((tx) =>
      splitBill(tx, v.cfg, s.tabId, [{ lineNo: croquettes!.lineNo, quantity: "1" }], {
        expectedPartyRevision: revision,
        operatorId: MIA,
      }),
    );

    expect(await linesOfBill(checkId)).toMatchObject([
      { groupId: s.cold, creditedTo: ALEX, quantity: 1000 },
    ]);
    expect(await revisionOf(s.partyId)).toBe(revision + 1);
  });

  it("keeps the group and credit of a routed held-group line split onto a check, still held", async () => {
    const v = await setupVenue();
    const s = await specExample(v);
    const [steak] = await linesIn(s.partyId, s.mains);
    const revision = await revisionOf(s.partyId);

    const checkId = await splitToCheck(v, s, [{ lineNo: steak!.lineNo }], revision, MIA);

    expect(await linesOfBill(checkId)).toMatchObject([
      { id: steak!.id, groupId: s.mains, creditedTo: ALEX, quantity: 2000, sentAt: null },
    ]);
    expect(await dishTickets(s.partyId, v.productId.steak)).toEqual([
      { workingOrderId: checkId, lineId: steak!.id, firedAt: null, quantity: 2000 },
    ]);
    expect(await revisionOf(s.partyId)).toBe(revision + 1);
  });

  it("fires a held-group line split onto a check once, on the check, when its group fires", async () => {
    const v = await setupVenue();
    const s = await specExample(v);
    const [steak] = await linesIn(s.partyId, s.mains);
    const checkId = await splitToCheck(v, s, [{ lineNo: steak!.lineNo }]);
    const jobsBefore = (await printed(v)).length;

    await fire(v, s.partyId, s.mains);

    const tickets = await dishTickets(s.partyId, v.productId.steak);
    expect(tickets).toMatchObject([{ workingOrderId: checkId, lineId: steak!.id }]);
    expect(tickets[0]!.firedAt).not.toBeNull();
    expect((await linesOfBill(checkId))[0]!.sentAt).not.toBeNull();
    expect(
      (await linesOf(s.partyId)).filter(
        (row) => row.workingOrderId === s.tabId && row.productId === v.productId.steak,
      ),
    ).toEqual([]);
    expect(timesPrinted((await printed(v)).slice(jobsBefore), DISHES.steak.kitchen)).toBe(1);
  });

  it("fires a held group split whole onto a check on the check alone", async () => {
    const v = await setupVenue();
    const s = await specExample(v);
    const mains = await linesIn(s.partyId, s.mains);
    const checkId = await splitToCheck(
      v,
      s,
      mains.map((row) => ({ lineNo: row.lineNo })),
    );
    expect((await linesIn(s.partyId, s.mains)).map((row) => row.workingOrderId)).toEqual([
      checkId,
      checkId,
    ]);
    const tabTicketsBefore = await ticketsOfBill(s.tabId);
    const jobsBefore = (await printed(v)).length;

    await fire(v, s.partyId, s.mains);

    const fired = await linesIn(s.partyId, s.mains);
    expect(fired.map((row) => row.workingOrderId)).toEqual([checkId, checkId]);
    expect(fired.every((row) => row.sentAt !== null)).toBe(true);
    expect((await ticketsOfBill(checkId)).every((ticket) => ticket.firedAt !== null)).toBe(true);
    expect(await ticketsOfBill(s.tabId)).toEqual(tabTicketsBefore);
    const newJobs = (await printed(v)).slice(jobsBefore);
    expect(timesPrinted(newJobs, DISHES.steak.kitchen)).toBe(1);
    expect(timesPrinted(newJobs, DISHES.fish.kitchen)).toBe(1);
  });

  it("splits part of a held-group line onto a check as two held rows of the group, and fires both", async () => {
    const v = await setupVenue();
    const s = await specExample(v);
    const [steak] = await linesIn(s.partyId, s.mains);

    const checkId = await splitToCheck(v, s, [{ lineNo: steak!.lineNo, quantity: "1" }]);

    const [split] = await linesOfBill(checkId);
    expect(
      (await linesIn(s.partyId, s.mains)).filter((row) => row.productId === v.productId.steak),
    ).toMatchObject([
      { id: steak!.id, workingOrderId: s.tabId, quantity: 1000, sentAt: null },
      { id: split!.id, workingOrderId: checkId, quantity: 1000, sentAt: null },
    ]);
    expect(sortedByBill(await dishTickets(s.partyId, v.productId.steak), s.tabId)).toEqual([
      { workingOrderId: s.tabId, lineId: steak!.id, firedAt: null, quantity: 1000 },
      { workingOrderId: checkId, lineId: split!.id, firedAt: null, quantity: 1000 },
    ]);
    const jobsBefore = (await printed(v)).length;

    await fire(v, s.partyId, s.mains);

    expect((await printed(v)).slice(jobsBefore).map(ticketLines)).toEqual([
      [
        ...(await billHead(v, s, s.tabId)),
        "GROUP 4",
        `1.000 x ${DISHES.steak.kitchen}`,
        `1.000 x ${DISHES.fish.kitchen}`,
      ],
      [...(await billHead(v, s, checkId)), "GROUP 4", `1.000 x ${DISHES.steak.kitchen}`],
    ]);
    const fired = sortedByBill(await dishTickets(s.partyId, v.productId.steak), s.tabId);
    expect(fired).toMatchObject([
      { workingOrderId: s.tabId, lineId: steak!.id, quantity: 1000 },
      { workingOrderId: checkId, lineId: split!.id, quantity: 1000 },
    ]);
    expect(fired.every((ticket) => ticket.firedAt !== null)).toBe(true);
  });

  it("refuses device A's fire after device B split the held group's line onto a check, then fires every line", async () => {
    const v = await setupVenue();
    const s = await specExample(v);
    const seenByA = await revisionOf(s.partyId);
    const [steak] = await linesIn(s.partyId, s.mains);
    const checkId = await splitToCheck(
      v,
      s,
      [{ lineNo: steak!.lineNo, quantity: "1" }],
      seenByA,
      MIA,
    );

    await expectRefusedWithNothingWritten(
      v,
      s.partyId,
      () => fire(v, s.partyId, s.mains, { revision: seenByA }),
      { code: "party.out_of_date", params: { partyId: s.partyId, revision: seenByA + 1 } },
    );

    await fire(v, s.partyId, s.mains);
    const lines = await linesIn(s.partyId, s.mains);
    expect(lines.map((row) => row.workingOrderId).sort()).toEqual(
      [s.tabId, s.tabId, checkId].sort(),
    );
    expect(lines.every((row) => row.sentAt !== null)).toBe(true);
  });

  it("still refuses a recalled dish of a fired group onto a check (tab.split_held_line), writing nothing", async () => {
    const v = await setupVenue();
    const s = await specExample(v);
    const [croquettes] = await linesIn(s.partyId, s.cold);
    await inTx((tx) => recallLines(tx, v.cfg, s.tabId, [croquettes!.lineNo]));

    for (const quantity of [undefined, "1"]) {
      await expectRefusedWithNothingWritten(
        v,
        s.partyId,
        () => splitToCheck(v, s, [{ lineNo: croquettes!.lineNo, quantity }]),
        { code: "tab.split_held_line", params: { tabId: s.tabId, lineNo: croquettes!.lineNo } },
      );
    }
  });
});

/** The chosen items of the party's tab split onto a new check, sent at `revision` by `operatorId`. */
async function splitToCheck(
  v: Venue,
  s: Seated,
  transfers: { lineNo: number; quantity?: string }[],
  revision?: number,
  operatorId = ALEX,
): Promise<string> {
  const expectedPartyRevision = revision ?? (await revisionOf(s.partyId));
  const { billId } = await inTx((tx) =>
    splitBill(tx, v.cfg, s.tabId, transfers, { expectedPartyRevision, operatorId }),
  );
  return billId;
}

/** The ticket items of the party's lines of this product, with the bill each is on. */
async function dishTickets(partyId: string, productId: string) {
  return db
    .select({
      workingOrderId: ticketItems.workingOrderId,
      lineId: ticketItems.workingOrderLineId,
      firedAt: ticketItems.firedAt,
      quantity: ticketItems.quantity,
    })
    .from(ticketItems)
    .innerJoin(workingOrderLines, eq(workingOrderLines.id, ticketItems.workingOrderLineId))
    .innerJoin(workingOrders, eq(workingOrders.id, ticketItems.workingOrderId))
    .where(and(eq(workingOrders.partyId, partyId), eq(workingOrderLines.productId, productId)))
    .orderBy(ticketItems.workingOrderLineId);
}

/** The original bill's tickets first. */
function sortedByBill<T extends { workingOrderId: string }>(
  tickets: T[],
  firstBillId: string,
): T[] {
  return [...tickets].sort(
    (a, b) => Number(b.workingOrderId === firstBillId) - Number(a.workingOrderId === firstBillId),
  );
}

async function ticketsOfBill(billId: string) {
  return db
    .select()
    .from(ticketItems)
    .where(eq(ticketItems.workingOrderId, billId))
    .orderBy(ticketItems.id);
}

/** A printed ticket's lines, minus the blank line the cut leaves. */
function ticketLines(ticket: string): string[] {
  return ticket.split("\n").filter((text) => text !== "");
}

/** What a kitchen ticket for this bill of the party prints under its mark: station, table, bill, time. */
async function billHead(v: Venue, s: Seated, billId: string): Promise<unknown[]> {
  const [station] = await db
    .select({ name: kitchenStations.name })
    .from(kitchenStations)
    .where(eq(kitchenStations.id, v.stationId));
  const [table] = await db
    .select({ label: diningTables.label })
    .from(diningTables)
    .where(eq(diningTables.id, s.tableId));
  const [bill] = await db
    .select({ orderNumber: workingOrders.orderNumber })
    .from(workingOrders)
    .where(eq(workingOrders.id, billId));
  return [
    station!.name,
    table!.label,
    String(bill!.orderNumber),
    expect.stringMatching(/^\d\d:\d\d$/),
  ];
}

/** How many times the kitchen name appears across these printed jobs. */
function timesPrinted(jobs: string[], kitchenName: string): number {
  return jobs.join("\n").split(kitchenName).length - 1;
}

describe("sending lines on their own", () => {
  it("refuses to send a line of a held group (group.line_held), writing nothing", async () => {
    const v = await setupVenue();
    const s = await specExample(v);
    const [steak] = await linesIn(s.partyId, s.mains);
    const [croquettes] = await linesIn(s.partyId, s.cold);

    await expectRefusedWithNothingWritten(
      v,
      s.partyId,
      () => inTx((tx) => sendLines(tx, v.cfg, s.tabId, [croquettes!.lineNo, steak!.lineNo])),
      { code: "group.line_held", params: { tabId: s.tabId, lineNo: steak!.lineNo } },
    );
  });

  it("sends a recalled line of a fired group again", async () => {
    const v = await setupVenue();
    const s = await specExample(v);
    const [croquettes] = await linesIn(s.partyId, s.cold);
    await inTx((tx) => recallLines(tx, v.cfg, s.tabId, [croquettes!.lineNo]));
    expect(await firedTicketLineIds(s.partyId)).not.toContain(croquettes!.id);
    const jobsBefore = (await printed(v)).length;

    await inTx((tx) => sendLines(tx, v.cfg, s.tabId, [croquettes!.lineNo]));

    expect(await firedTicketLineIds(s.partyId)).toContain(croquettes!.id);
    expect((await printed(v)).slice(jobsBefore).join("\n")).toContain(DISHES.cold.kitchen);
  });

  it("sends every recalled line and no held-group line when no line is named", async () => {
    const v = await setupVenue();
    const s = await specExample(v);
    const [croquettes] = await linesIn(s.partyId, s.cold);
    await inTx((tx) => recallLines(tx, v.cfg, s.tabId, [croquettes!.lineNo]));
    const held = [
      ...(await linesIn(s.partyId, s.warm)),
      ...(await linesIn(s.partyId, s.mains)),
      ...(await linesIn(s.partyId, s.desserts)),
    ];

    await inTx((tx) => sendLines(tx, v.cfg, s.tabId, []));

    const fired = await firedTicketLineIds(s.partyId);
    expect(fired).toContain(croquettes!.id);
    for (const row of held) expect(fired).not.toContain(row.id);
    const after = await linesOf(s.partyId);
    expect(
      after.filter((row) => held.some((h) => h.id === row.id)).map((row) => row.sentAt),
    ).toEqual(held.map(() => null));
    expect((await groupsOf(s.partyId)).groups.map((group) => group.state)).toEqual([
      "fired",
      "fired",
      "held",
      "held",
      "held",
    ]);
  });

  it("sends a recalled line that is in no group", async () => {
    const v = await setupVenue();
    const other = await seated(v);
    // A round, not a group submission, leaves the fired line in no group.
    await inTx((tx) => addTabRound(tx, v.cfg, other.tabId, [line(v, "steak")]));
    const [moved] = await linesOfBill(other.tabId);
    await inTx((tx) => recallLines(tx, v.cfg, other.tabId, [moved!.lineNo]));
    expect(await firedTicketLineIds(other.partyId)).toEqual([]);

    await inTx((tx) => sendLines(tx, v.cfg, other.tabId, [moved!.lineNo]));

    expect(moved).toMatchObject({ groupId: null });
    expect(await firedTicketLineIds(other.partyId)).toEqual([moved!.id]);
  });

  it("leaves a held group's no-route line held when a recalled line of the same course is sent", async () => {
    const v = await setupVenue();
    const s = await seated(v);
    await submit(v, s.partyId, [{ release: "fire", lines: [line(v, "beer")] }]);
    const { groups } = await submit(v, s.partyId, [{ release: "hold", lines: [line(v, "water")] }]);
    const [water] = await linesIn(s.partyId, groups[0]!.id);
    // The Beer is line 1; recalling it leaves no held Drinks ticket once it is sent again.
    await inTx((tx) => recallLines(tx, v.cfg, s.tabId, [1]));

    await inTx((tx) => sendLines(tx, v.cfg, s.tabId, [1]));

    expect((await linesIn(s.partyId, groups[0]!.id))[0]).toMatchObject({
      id: water!.id,
      sentAt: null,
    });
  });
});

describe("a device as the firer", () => {
  async function firingDevice(v: Venue): Promise<{ id: string; label: string }> {
    const id = await seedSessionDevice(db, v.cfg);
    const [row] = await db.select({ label: devices.label }).from(devices).where(eq(devices.id, id));
    return { id, label: row!.label };
  }

  it("records the device, not a person, when a course fires its held groups, and shows it as the sender", async () => {
    const v = await setupVenue();
    const s = await specExample(v);
    const device = await firingDevice(v);
    const [steak] = await db
      .select({ courseId: workingOrderLines.courseId })
      .from(workingOrderLines)
      .where(eq(workingOrderLines.productId, v.productId.steak))
      .limit(1);

    await inTx((tx) => fireCourse(tx, v.cfg, s.tabId, steak!.courseId!, { deviceId: device.id }));

    const [group] = await db.select().from(orderGroups).where(eq(orderGroups.id, s.mains));
    expect(group).toMatchObject({ state: "fired", firedBy: null, firedByDeviceId: device.id });
    const [event] = await db
      .select()
      .from(orderGroupEvents)
      .where(and(eq(orderGroupEvents.groupId, s.mains), eq(orderGroupEvents.kind, "fired")));
    expect(event).toMatchObject({ actorId: null, actorDeviceId: device.id });
    const read = await inTx((tx) => readCurrentOrders(tx, s.partyId));
    expect(read.groups.find((g) => g.id === s.mains)?.sentBy).toBe(device.label);
    expect(read.groups.find((g) => g.id === s.drinks)?.sentBy).toBeNull();
  });

  it("records the device when a group fires, keeping the device's id as the command's operator", async () => {
    const v = await setupVenue();
    const s = await specExample(v);
    const device = await firingDevice(v);
    const command = await args(s.partyId, { operatorId: device.id });

    await inTx((tx) => fireGroup(tx, v.cfg, s.partyId, s.warm, command, { deviceId: device.id }));

    const [group] = await db.select().from(orderGroups).where(eq(orderGroups.id, s.warm));
    expect(group).toMatchObject({ state: "fired", firedBy: null, firedByDeviceId: device.id });
    expect((await eventsOf(s.partyId)).at(-1)).toMatchObject({
      groupId: s.warm,
      kind: "fired",
      actorId: null,
    });
    const replay = await inTx((tx) =>
      fireGroup(tx, v.cfg, s.partyId, s.warm, command, { deviceId: device.id }),
    );
    expect(replay).toEqual({ revision: await revisionOf(s.partyId) });
  });

  it("records the person a group's command names when no firer is given", async () => {
    const v = await setupVenue();
    const s = await specExample(v);
    await fire(v, s.partyId, s.warm, { operatorId: MIA });
    const [group] = await db.select().from(orderGroups).where(eq(orderGroups.id, s.warm));
    expect(group).toMatchObject({ firedBy: MIA, firedByDeviceId: null });
  });
});

describe("the course Fire of the station and the pass, on a party", () => {
  async function courseIdOf(v: Venue, dish: Dish): Promise<string> {
    const [row] = await db
      .select({ courseId: workingOrderLines.courseId })
      .from(workingOrderLines)
      .where(eq(workingOrderLines.productId, v.productId[dish]))
      .limit(1);
    return row!.courseId!;
  }

  it("fires the held group holding the course's lines, as fireGroup does", async () => {
    const v = await setupVenue();
    const s = await specExample(v);
    const [steak, fish] = await linesIn(s.partyId, s.mains);
    const revision = await revisionOf(s.partyId);
    const jobsBefore = (await printed(v)).length;

    await inTx(async (tx) =>
      fireCourse(tx, v.cfg, s.tabId, await courseIdOf(v, "steak"), { personId: MIA }),
    );

    expect(await revisionOf(s.partyId)).toBe(revision + 1);
    const states = Object.fromEntries(
      (await groupsOf(s.partyId)).groups.map((group) => [group.id, group.state]),
    );
    expect(states).toEqual({
      [s.drinks]: "fired",
      [s.cold]: "fired",
      [s.warm]: "held",
      [s.mains]: "fired",
      [s.desserts]: "held",
    });
    expect(await firedTicketLineIds(s.partyId)).toEqual(
      expect.arrayContaining([steak!.id, fish!.id]),
    );
    expect((await linesIn(s.partyId, s.mains)).every((row) => row.sentAt !== null)).toBe(true);
    expect((await printed(v)).slice(jobsBefore).join("\n")).toContain(DISHES.steak.kitchen);
    const [group] = await db.select().from(orderGroups).where(eq(orderGroups.id, s.mains));
    expect(group).toMatchObject({ firedBy: MIA, firedAt: expect.any(String) });
    expect((await eventsOf(s.partyId)).at(-1)).toMatchObject({
      groupId: s.mains,
      kind: "fired",
      actorId: MIA,
    });
  });

  it("fires every held group holding the course, whole and in position order", async () => {
    const v = await setupVenue();
    const s = await seated(v);
    const made = await submit(v, s.partyId, [
      { release: "hold", lines: [line(v, "steak")] },
      { release: "hold", lines: [line(v, "fish"), line(v, "flan")] },
      { release: "hold", lines: [line(v, "warm")] },
    ]);
    const [steakGroup, fishGroup, warmGroup] = made.groups.map((group) => group.id);
    await reorder(s.partyId, [fishGroup!, warmGroup!, steakGroup!]);

    await inTx(async (tx) =>
      fireCourse(tx, v.cfg, s.tabId, await courseIdOf(v, "steak"), { personId: ALEX }),
    );

    const fired = (await eventsOf(s.partyId)).filter((event) => event.kind === "fired");
    expect(fired.map((event) => event.groupId)).toEqual([fishGroup, steakGroup]);
    const flan = (await linesIn(s.partyId, fishGroup!)).find(
      (row) => row.productId === v.productId.flan,
    );
    expect(flan!.sentAt).not.toBeNull();
    expect((await groupsOf(s.partyId)).groups.find((g) => g.id === warmGroup)!.state).toBe("held");
  });

  it("keeps a Steak added held after the mains fired held until the next course Fire, which fires its group", async () => {
    const v = await setupVenue();
    const s = await specExample(v);
    const mains = await courseIdOf(v, "steak");
    await inTx((tx) => fireCourse(tx, v.cfg, s.tabId, mains, { personId: ALEX }));

    const later = await submit(v, s.partyId, [{ release: "hold", lines: [line(v, "steak")] }]);
    const laterGroup = later.groups[0]!.id;
    const [steak] = await linesIn(s.partyId, laterGroup);
    expect(steak!.sentAt).toBeNull();
    expect(await firedTicketLineIds(s.partyId)).not.toContain(steak!.id);

    await inTx((tx) => fireCourse(tx, v.cfg, s.tabId, mains, { personId: ALEX }));

    expect((await linesIn(s.partyId, laterGroup))[0]!.sentAt).not.toBeNull();
    expect(await firedTicketLineIds(s.partyId)).toContain(steak!.id);
    expect((await groupsOf(s.partyId)).groups.find((g) => g.id === laterGroup)!.state).toBe(
      "fired",
    );
  });

  it("fires a held group of the course and sends a recalled line of that course again", async () => {
    const v = await setupVenue();
    const s = await seated(v);
    const first = await submit(v, s.partyId, [{ release: "fire", lines: [line(v, "steak")] }]);
    const held = await submit(v, s.partyId, [{ release: "hold", lines: [line(v, "fish")] }]);
    const [steak] = await linesIn(s.partyId, first.groups[0]!.id);
    const [fish] = await linesIn(s.partyId, held.groups[0]!.id);
    await inTx((tx) => recallLines(tx, v.cfg, s.tabId, [steak!.lineNo]));
    expect(await firedTicketLineIds(s.partyId)).not.toContain(steak!.id);
    const jobsBefore = (await printed(v)).length;

    await inTx(async (tx) =>
      fireCourse(tx, v.cfg, s.tabId, await courseIdOf(v, "steak"), { personId: ALEX }),
    );

    expect(await firedTicketLineIds(s.partyId)).toEqual([steak!.id, fish!.id].sort());
    expect((await groupsOf(s.partyId)).groups.map((group) => group.state)).toEqual([
      "fired",
      "fired",
    ]);
    const slips = (await printed(v)).slice(jobsBefore).join("\n");
    expect(slips).toContain(DISHES.steak.kitchen);
    expect(slips).toContain(DISHES.fish.kitchen);
  });

  it("sends a recalled line of the course again when no held group holds the course", async () => {
    const v = await setupVenue();
    const s = await seated(v);
    const first = await submit(v, s.partyId, [{ release: "fire", lines: [line(v, "steak")] }]);
    const [steak] = await linesIn(s.partyId, first.groups[0]!.id);
    await inTx((tx) => recallLines(tx, v.cfg, s.tabId, [steak!.lineNo]));
    expect(await firedTicketLineIds(s.partyId)).toEqual([]);
    const jobsBefore = (await printed(v)).length;

    await inTx(async (tx) =>
      fireCourse(tx, v.cfg, s.tabId, await courseIdOf(v, "steak"), { personId: ALEX }),
    );

    expect(await firedTicketLineIds(s.partyId)).toEqual([steak!.id]);
    expect((await printed(v)).slice(jobsBefore).join("\n")).toContain(DISHES.steak.kitchen);
  });

  it("refuses a held group holding a sold-out Steak (product.unavailable), firing none of it", async () => {
    const v = await setupVenue();
    const s = await specExample(v);
    const courseId = await courseIdOf(v, "steak");
    await db.run(sql`update products set available = 0 where id = ${v.productId.steak}`);

    await expectRefusedWithNothingWritten(
      v,
      s.partyId,
      () => inTx((tx) => fireCourse(tx, v.cfg, s.tabId, courseId, { personId: ALEX })),
      { code: "product.unavailable", params: { productId: v.productId.steak } },
    );
  });

  it("does nothing for a course no held group holds, and refuses a course the venue lacks", async () => {
    const v = await setupVenue();
    const s = await specExample(v);
    const drinks = await courseIdOf(v, "beer");
    const before = await snapshot(v, s.partyId);

    await inTx((tx) => fireCourse(tx, v.cfg, s.tabId, drinks, { personId: ALEX }));
    expect(await snapshot(v, s.partyId)).toEqual(before);

    const missing = randomUUID();
    await expectRefusedWithNothingWritten(
      v,
      s.partyId,
      () => inTx((tx) => fireCourse(tx, v.cfg, s.tabId, missing, { personId: ALEX })),
      { code: "course.not_found", params: { courseId: missing } },
    );
  });
});

async function billRevisionOf(orderId: string): Promise<number> {
  const [row] = await db
    .select({ revision: workingOrders.revision })
    .from(workingOrders)
    .where(eq(workingOrders.id, orderId));
  return row!.revision;
}

/** A whole-order save's lines keeping every dish of the bill as it stands. */
async function keptLines(v: Venue, orderId: string) {
  const dishOf = new Map(
    (Object.keys(v.productId) as Dish[]).map((dish) => [v.productId[dish], dish]),
  );
  return (await linesOfBillWithProduct(orderId)).map((row) => ({
    workingOrderLineId: row.id,
    menuItemId: v.offer(dishOf.get(row.productId!)!),
    quantity: String(row.quantity / 1000),
  }));
}

async function linesOfBillWithProduct(orderId: string) {
  return db
    .select({
      id: workingOrderLines.id,
      productId: workingOrderLines.productId,
      quantity: workingOrderLines.quantity,
    })
    .from(workingOrderLines)
    .where(
      and(
        eq(workingOrderLines.workingOrderId, orderId),
        sql`${workingOrderLines.parentLineId} is null`,
      ),
    )
    .orderBy(asc(workingOrderLines.lineNo));
}

async function saveWhole(
  v: Venue,
  orderId: string,
  lines: Awaited<ReturnType<typeof keptLines>> | ReturnType<typeof line>[],
  operatorId: string | undefined,
) {
  return updateHeldOrder({ db }, v.cfg, orderId, {
    lines,
    revision: await billRevisionOf(orderId),
    operatorId,
  });
}

async function changeLine(
  v: Venue,
  orderId: string,
  lineNo: number,
  patch: Parameters<typeof updateOrderLine>[4],
  operatorId?: string,
) {
  const revision = await billRevisionOf(orderId);
  return inTx((tx) => updateOrderLine(tx, v.cfg, orderId, lineNo, patch, revision, operatorId));
}

async function groupRow(groupId: string) {
  const [row] = await db.select().from(orderGroups).where(eq(orderGroups.id, groupId));
  return row!;
}

describe("edits inside groups (D19)", () => {
  it("removes a held group whose only line is voided: gone from the list, its events kept, the party moved on", async () => {
    const v = await setupVenue();
    const s = await specExample(v);
    const fishOnly = (await submit(v, s.partyId, [{ release: "hold", lines: [line(v, "fish")] }]))
      .groups[0]!.id;
    const [fish] = await linesIn(s.partyId, fishOnly);
    const revision = await revisionOf(s.partyId);

    await inTx((tx) => cancelLine(tx, v.cfg, s.tabId, fish!.lineNo, undefined, MIA));

    expect((await groupRow(fishOnly)).state).toBe("removed");
    expect((await groupsOf(s.partyId)).groups.map((group) => group.id)).not.toContain(fishOnly);
    const events = (await eventsOf(s.partyId)).filter((event) => event.groupId === fishOnly);
    expect(events.map((event) => [event.kind, event.actorId])).toEqual([
      ["submitted", ALEX],
      ["removed", MIA],
    ]);
    expect(await revisionOf(s.partyId)).toBe(revision + 1);
  });

  it("removes a held group whose only line a whole-order save leaves out, naming the editor", async () => {
    const v = await setupVenue();
    const s = await specExample(v);
    const fishOnly = (await submit(v, s.partyId, [{ release: "hold", lines: [line(v, "fish")] }]))
      .groups[0]!.id;
    const [fish] = await linesIn(s.partyId, fishOnly);
    const revision = await revisionOf(s.partyId);

    await saveWhole(
      v,
      s.tabId,
      (await keptLines(v, s.tabId)).filter((kept) => kept.workingOrderLineId !== fish!.id),
      MIA,
    );

    expect((await groupRow(fishOnly)).state).toBe("removed");
    expect((await eventsOf(s.partyId)).at(-1)).toMatchObject({
      groupId: fishOnly,
      kind: "removed",
      actorId: MIA,
    });
    expect(await revisionOf(s.partyId)).toBe(revision + 1);
  });

  it("keeps a held group one of whose two lines is voided, writes no event, and moves the party on", async () => {
    const v = await setupVenue();
    const s = await specExample(v);
    const [, fish] = await linesIn(s.partyId, s.mains);
    const revision = await revisionOf(s.partyId);
    const events = (await eventsOf(s.partyId)).length;

    await inTx((tx) => cancelLine(tx, v.cfg, s.tabId, fish!.lineNo, undefined, MIA));

    expect((await groupRow(s.mains)).state).toBe("held");
    expect(await eventsOf(s.partyId)).toHaveLength(events);
    expect(await revisionOf(s.partyId)).toBe(revision + 1);
  });

  it("moves the party on for part of a line voided", async () => {
    const v = await setupVenue();
    const s = await specExample(v);
    const [steak] = await linesIn(s.partyId, s.mains);
    const revision = await revisionOf(s.partyId);

    await inTx((tx) => cancelLine(tx, v.cfg, s.tabId, steak!.lineNo, "1", MIA));

    expect((await linesIn(s.partyId, s.mains))[0]).toMatchObject({ id: steak!.id, quantity: 1000 });
    expect(await revisionOf(s.partyId)).toBe(revision + 1);
  });

  it("puts a FIRED line's raised quantity in a new fired group credited to the editor, leaving the line as it was", async () => {
    const v = await setupVenue();
    const s = await specExample(v);
    const [beer] = await linesIn(s.partyId, s.drinks);
    const revision = await revisionOf(s.partyId);

    await changeLine(v, s.tabId, beer!.lineNo, { quantity: "3" }, MIA);

    const { groups } = await groupsOf(s.partyId);
    expect(groups.map((group) => [group.position, group.state])).toEqual([
      [1, "fired"],
      [2, "fired"],
      [3, "held"],
      [4, "held"],
      [5, "held"],
      [6, "fired"],
    ]);
    const added = groups[5]!;
    const [extra] = await linesIn(s.partyId, added.id);
    expect(added.lineIds).toEqual([extra!.id]);
    expect(extra).toMatchObject({
      productId: v.productId.beer,
      quantity: 1000,
      creditedTo: MIA,
      sentAt: expect.any(String),
    });
    expect(await firedTicketLineIds(s.partyId)).toContain(extra!.id);
    expect((await linesIn(s.partyId, s.drinks))[0]).toMatchObject({
      id: beer!.id,
      quantity: 2000,
      groupId: s.drinks,
      creditedTo: ALEX,
    });
    expect((await eventsOf(s.partyId)).at(-1)).toMatchObject({
      groupId: added.id,
      kind: "submitted",
      actorId: MIA,
    });
    expect(await groupRow(added.id)).toMatchObject({ submittedBy: MIA, firedBy: MIA });
    expect(await revisionOf(s.partyId)).toBe(revision + 1);
  });

  it("refuses raising a FIRED line's quantity once a publish makes its dish not sold separately, writing nothing", async () => {
    const v = await setupVenue();
    const s = await specExample(v);
    const [beer] = await linesIn(s.partyId, s.drinks);
    await inTx(async (tx) => {
      await updateProduct(tx, v.productId.beer, { ordering: "not_sold_separately" });
      await republishMenus(tx);
    });

    await expectRefusedWithNothingWritten(
      v,
      s.partyId,
      () => changeLine(v, s.tabId, beer!.lineNo, { quantity: "3" }, MIA),
      { code: "product.not_sold_separately", params: { productId: v.productId.beer } },
    );
  });

  it("changes a HELD line's quantity in place, in its group, and moves the party on", async () => {
    const v = await setupVenue();
    const s = await specExample(v);
    const [steak] = await linesIn(s.partyId, s.mains);
    const revision = await revisionOf(s.partyId);
    const events = (await eventsOf(s.partyId)).length;

    await changeLine(v, s.tabId, steak!.lineNo, { quantity: "3" }, MIA);

    expect((await linesIn(s.partyId, s.mains))[0]).toMatchObject({
      id: steak!.id,
      quantity: 3000,
      creditedTo: ALEX,
      sentAt: null,
    });
    expect((await groupsOf(s.partyId)).groups).toHaveLength(5);
    expect(await eventsOf(s.partyId)).toHaveLength(events);
    expect(await revisionOf(s.partyId)).toBe(revision + 1);
  });

  it("leaves the party's revision alone for an edit that changes nothing", async () => {
    const v = await setupVenue();
    const s = await specExample(v);
    const [steak] = await linesIn(s.partyId, s.mains);
    const revision = await revisionOf(s.partyId);

    await changeLine(v, s.tabId, steak!.lineNo, { quantity: "2" }, MIA);

    expect(await revisionOf(s.partyId)).toBe(revision);
  });

  it("puts an extra Mia adds to Alex's held Steak in the Steak's group, credited to Alex", async () => {
    const v = await setupVenue();
    const s = await seated(v);
    const held = (await submit(v, s.partyId, [{ release: "hold", lines: [line(v, "steak")] }]))
      .groups[0]!.id;
    const [steak] = await linesIn(s.partyId, held);

    await changeLine(
      v,
      s.tabId,
      steak!.lineNo,
      {
        extras: [
          { listId: v.extrasListId, picks: [{ productId: v.productId.sauce, quantity: 1 }] },
        ],
      },
      MIA,
    );

    const rows = await linesOfBill(s.tabId);
    expect(rows.map((row) => [row.parentLineId, row.groupId, row.creditedTo])).toEqual([
      [null, held, ALEX],
      [steak!.id, held, ALEX],
    ]);
    expect((await groupsOf(s.partyId)).groups.map((group) => group.id)).toEqual([held]);
  });

  it("puts an extra Mia adds to Alex's FIRED Steak in the Steak's fired group, credited to Alex", async () => {
    const v = await setupVenue();
    const s = await seated(v);
    const fired = (await submit(v, s.partyId, [{ release: "fire", lines: [line(v, "steak")] }]))
      .groups[0]!.id;
    const [steak] = await linesIn(s.partyId, fired);
    const events = (await eventsOf(s.partyId)).length;

    await changeLine(
      v,
      s.tabId,
      steak!.lineNo,
      {
        extras: [
          { listId: v.extrasListId, picks: [{ productId: v.productId.sauce, quantity: 1 }] },
        ],
      },
      MIA,
    );

    const rows = await linesOfBill(s.tabId);
    expect(rows.map((row) => [row.parentLineId, row.groupId, row.creditedTo])).toEqual([
      [null, fired, ALEX],
      [steak!.id, fired, ALEX],
    ]);
    expect((await groupsOf(s.partyId)).groups.map((group) => [group.id, group.state])).toEqual([
      [fired, "fired"],
    ]);
    expect(await eventsOf(s.partyId)).toHaveLength(events);
  });

  it("puts a new dish a save adds, where some line was sent, in a new fired group credited to the editor", async () => {
    const v = await setupVenue();
    const s = await specExample(v);
    const revision = await revisionOf(s.partyId);

    await saveWhole(v, s.tabId, [...(await keptLines(v, s.tabId)), line(v, "flan")], MIA);

    const { groups } = await groupsOf(s.partyId);
    expect(groups).toHaveLength(6);
    expect(groups[5]).toMatchObject({ position: 6, state: "fired", summary: "1 × Flan" });
    const [flan] = await linesIn(s.partyId, groups[5]!.id);
    expect(flan).toMatchObject({ creditedTo: MIA, sentAt: expect.any(String) });
    expect(await firedTicketLineIds(s.partyId)).toContain(flan!.id);
    expect((await eventsOf(s.partyId)).at(-1)).toMatchObject({
      groupId: groups[5]!.id,
      kind: "submitted",
      actorId: MIA,
    });
    expect(await revisionOf(s.partyId)).toBe(revision + 1);
  });

  it("puts a new dish a save adds, where every line is held, in a new held group at the end", async () => {
    const v = await setupVenue();
    const s = await seated(v);
    const first = (
      await submit(v, s.partyId, [{ release: "hold", lines: [line(v, "steak"), line(v, "fish")] }])
    ).groups[0]!.id;

    await saveWhole(v, s.tabId, [...(await keptLines(v, s.tabId)), line(v, "flan")], MIA);

    const { groups } = await groupsOf(s.partyId);
    expect(groups.map((group) => [group.id === first, group.position, group.state])).toEqual([
      [true, 1, "held"],
      [false, 2, "held"],
    ]);
    const [flan] = await linesIn(s.partyId, groups[1]!.id);
    expect(flan).toMatchObject({ productId: v.productId.flan, creditedTo: MIA, sentAt: null });
    expect(await firedTicketLineIds(s.partyId)).toEqual([]);
    expect(await groupRow(groups[1]!.id)).toMatchObject({ submittedBy: MIA, firedBy: null });
  });

  it("puts a new dish a save adds to a party's tab of held no-route lines only in a new held group", async () => {
    const v = await setupVenue();
    const s = await seated(v);
    await submit(v, s.partyId, [{ release: "hold", lines: [line(v, "water")] }]);

    await saveWhole(v, s.tabId, [...(await keptLines(v, s.tabId)), line(v, "steak")], MIA);

    const { groups } = await groupsOf(s.partyId);
    expect(groups.map((group) => [group.position, group.state, group.summary])).toEqual([
      [1, "held", "1 × Water btl"],
      [2, "held", "1 × Steak"],
    ]);
    await fire(v, s.partyId, groups[1]!.id);
    const [steak] = await linesIn(s.partyId, groups[1]!.id);
    expect(await firedTicketLineIds(s.partyId)).toEqual([steak!.id]);
  });

  it("puts no line of a counter order in a group, crediting a line a save adds to the editor", async () => {
    const v = await setupVenue();
    const id = randomUUID();
    await parkOrder({ db }, v.cfg, {
      id,
      lines: [line(v, "steak")],
      zoneId: v.zoneId,
      operatorId: ALEX,
    });

    await saveWhole(v, id, [...(await keptLines(v, id)), line(v, "flan")], MIA);

    expect((await linesOfBill(id)).map((row) => [row.groupId, row.creditedTo, row.sentAt])).toEqual(
      [
        [null, ALEX, null],
        [null, MIA, null],
      ],
    );
    expect(await db.select().from(orderGroups)).toEqual([]);
  });

  it("credits nobody and starts no group for an edit with no operator on a bill of no party", async () => {
    const v = await setupVenue();
    const tabId = await billOfNoParty(v, (tx, id) =>
      addTabRound(tx, v.cfg, id, [{ ...line(v, "steak"), release: true }], {
        creditedTo: ALEX,
      }),
    );
    expect(await linesOfBill(tabId)).toMatchObject([{ sentAt: expect.any(String) }]);

    await changeLine(v, tabId, 1, { quantity: "2" });
    await saveWhole(v, tabId, [...(await keptLines(v, tabId)), line(v, "flan")], undefined);

    expect(
      (await linesOfBill(tabId)).map((row) => [
        row.lineNo,
        row.quantity,
        row.groupId,
        row.creditedTo,
      ]),
    ).toEqual([
      [1, 1000, null, ALEX],
      [2, 1000, null, null],
      [3, 1000, null, null],
    ]);
    expect(await db.select().from(orderGroups)).toEqual([]);
  });

  it("refuses an edit that must start a group when no operator is named, writing nothing", async () => {
    const v = await setupVenue();
    const s = await specExample(v);
    const [beer] = await linesIn(s.partyId, s.drinks);

    await expectRefusedWithNothingWritten(
      v,
      s.partyId,
      () => changeLine(v, s.tabId, beer!.lineNo, { quantity: "3" }),
      { code: "management.request_invalid", params: { field: "operatorId" } },
    );
  });
});

describe("the bill a group's first event names", () => {
  it("names the bill its lines went on by the same key, whether a submission, a join or an edit started it", async () => {
    const v = await setupVenue();
    const s = await seated(v);
    const first = (await submit(v, s.partyId, [{ release: "fire", lines: [line(v, "cold")] }]))
      .groups[0]!.id;
    const held = (await submit(v, s.partyId, [{ release: "hold", lines: [line(v, "steak")] }]))
      .groups[0]!.id;
    await submit(v, s.partyId, [{ release: "hold", lines: [line(v, "fish")] }], {
      joinGroupId: held,
    });
    const [croquettes] = await linesIn(s.partyId, first);
    const { billId: checkId } = await inTx(async (tx) =>
      splitBill(tx, v.cfg, s.tabId, [{ lineNo: croquettes!.lineNo }], {
        expectedPartyRevision: await revisionOf(s.partyId),
        operatorId: ALEX,
      }),
    );
    const [onCheck] = await linesOfBill(checkId);

    await changeLine(v, checkId, onCheck!.lineNo, { quantity: "2" }, MIA);

    const added = (await groupsOf(s.partyId)).groups.at(-1)!.id;
    expect(
      (await eventsOf(s.partyId)).map((event) => [event.groupId, event.kind, event.detail]),
    ).toEqual([
      [first, "submitted", { workingOrderId: s.tabId, release: "fire" }],
      [held, "submitted", { workingOrderId: s.tabId, release: "hold" }],
      [held, "joined", { workingOrderId: s.tabId, release: "hold" }],
      [added, "submitted", { workingOrderId: checkId, release: "fire" }],
    ]);
  });
});

describe("credit (D5)", () => {
  // The directive is the assertion: typecheck reports an unused `@ts-expect-error` the moment a
  // save that may issue the bill's invoice types without naming who saves. Vitest does not typecheck.
  it("will not type a save that may issue the invoice without naming who saves", () => {
    const cfg = {} as TillConfig;
    const issue = { fiscal: {} as TillSaleDeps, saleCfg: {} as DeviceRequestConfig };
    const unnamed = { lines: [], revision: 0 };
    expectTypeOf(updateHeldOrder).toBeCallableWith({ db }, cfg, "order", unnamed);
    expectTypeOf(updateHeldOrder).toBeCallableWith(
      { db },
      cfg,
      "order",
      { ...unnamed, operatorId: MIA },
      issue,
    );
    // @ts-expect-error a save given `issue` must carry `operatorId`
    expectTypeOf(updateHeldOrder).toBeCallableWith({ db }, cfg, "order", unnamed, issue);
  });

  it("credits the lines a parked counter order is created with to the operator who parked it", async () => {
    const v = await setupVenue();
    const id = randomUUID();

    await parkOrder({ db }, v.cfg, {
      id,
      lines: [line(v, "steak"), line(v, "flan")],
      zoneId: v.zoneId,
      operatorId: MIA,
    });

    expect((await linesOfBill(id)).map((row) => row.creditedTo)).toEqual([MIA, MIA]);
  });

  it("credits the lines a tab is opened with to the operator who opened it", async () => {
    const v = await setupVenue();
    const { tabId } = await inTx(async (tx) => {
      const { id: tableId } = await createTable(tx, v.cfg, {
        label: `O-${randomUUID().slice(0, 6)}`,
        zoneId: v.zoneId,
      });
      return openPartyTab(tx, v.cfg, {
        tableId,
        lines: [{ menuItemId: v.offer("flan"), quantity: "1" }],
        operatorId: MIA,
      });
    });

    expect(await linesOfBill(tabId)).toMatchObject([{ groupId: null, creditedTo: MIA }]);
  });
});

async function ready(v: Venue, partyId: string, groupId: string, opts: CommandOptions = {}) {
  const command = await args(partyId, opts);
  return inTx((tx) => bumpGroupReady(tx, v.cfg, partyId, groupId, command));
}

async function away(v: Venue, partyId: string, groupId: string, opts: CommandOptions = {}) {
  const command = await args(partyId, opts);
  return inTx((tx) => markGroupAway(tx, v.cfg, partyId, groupId, command));
}

/** The kitchen's items for a group's dishes, whichever bill they sit on. */
async function groupTickets(groupId: string) {
  return db
    .select({
      id: ticketItems.id,
      workingOrderId: ticketItems.workingOrderId,
      state: ticketItems.state,
      firedAt: ticketItems.firedAt,
      readyAt: ticketItems.readyAt,
      awayAt: ticketItems.awayAt,
    })
    .from(ticketItems)
    .innerJoin(workingOrderLines, eq(workingOrderLines.id, ticketItems.workingOrderLineId))
    .where(eq(workingOrderLines.groupId, groupId))
    .orderBy(ticketItems.id);
}

async function commandsOf(partyId: string) {
  return db
    .select({ kind: serviceCommands.kind, submissionId: serviceCommands.submissionId })
    .from(serviceCommands)
    .where(eq(serviceCommands.scopeId, partyId))
    .orderBy(sql`rowid`);
}

async function closeParty(partyId: string): Promise<void> {
  await db
    .update(parties)
    .set({ state: "closed", closedAt: new Date().toISOString(), closedBy: ALEX })
    .where(eq(parties.id, partyId));
}

/** The spec's example with one croquette split onto a check: the fired cold starters span two bills. */
async function specExampleOnTwoBills(v: Venue) {
  const s = await specExample(v);
  const [croquettes] = await linesIn(s.partyId, s.cold);
  const revision = await revisionOf(s.partyId);
  const { billId: checkId } = await inTx((tx) =>
    splitBill(tx, v.cfg, s.tabId, [{ lineNo: croquettes!.lineNo, quantity: "1" }], {
      expectedPartyRevision: revision,
      operatorId: MIA,
    }),
  );
  return { ...s, checkId };
}

describe("the pass by group (D1)", () => {
  it("bumps the fired cold starters ready on both bills, then sends them away, leaving every other group as it was", async () => {
    const v = await setupVenue();
    const s = await specExampleOnTwoBills(v);
    const cold = await groupTickets(s.cold);
    expect(new Set(cold.map((item) => item.workingOrderId))).toEqual(new Set([s.tabId, s.checkId]));
    expect(cold.every((item) => item.state === "queued" && item.firedAt !== null)).toBe(true);
    const drinksBefore = await groupTickets(s.drinks);
    const warmBefore = await groupTickets(s.warm);

    const readied = await ready(v, s.partyId, s.cold);

    expect(readied).toEqual({ revision: await revisionOf(s.partyId) });
    const coldReady = await groupTickets(s.cold);
    expect(coldReady.map((item) => [item.state, item.awayAt])).toEqual(
      cold.map(() => ["ready", null]),
    );
    expect(coldReady.every((item) => item.readyAt !== null)).toBe(true);
    expect(await groupTickets(s.drinks)).toEqual(drinksBefore);
    expect(await groupTickets(s.warm)).toEqual(warmBefore);

    const sent = await away(v, s.partyId, s.cold);

    expect(sent).toEqual({ revision: await revisionOf(s.partyId) });
    expect((await groupTickets(s.cold)).every((item) => item.awayAt !== null)).toBe(true);
    expect(await groupTickets(s.drinks)).toEqual(drinksBefore);
  });

  it("sends away only what is ready: a group still cooking gets no away stamp", async () => {
    const v = await setupVenue();
    const s = await specExample(v);
    const before = await groupTickets(s.drinks);

    await away(v, s.partyId, s.drinks);

    expect(await groupTickets(s.drinks)).toEqual(before);
  });

  it("changes no kitchen item for a held group, yet records the command and moves the party on", async () => {
    const v = await setupVenue();
    const s = await specExample(v);
    const before = await groupTickets(s.warm);
    expect(before.every((item) => item.firedAt === null)).toBe(true);
    const revision = await revisionOf(s.partyId);
    const readyId = randomUUID();
    const awayId = randomUUID();

    await ready(v, s.partyId, s.warm, { submissionId: readyId });
    await away(v, s.partyId, s.warm, { submissionId: awayId });

    expect(await groupTickets(s.warm)).toEqual(before);
    expect(await revisionOf(s.partyId)).toBe(revision + 2);
    expect((await commandsOf(s.partyId)).slice(-2)).toEqual([
      { kind: "group.ready", submissionId: readyId },
      { kind: "group.away", submissionId: awayId },
    ]);
  });

  it("reads a group ready only once every fired kitchen item of it is ready", async () => {
    const v = await setupVenue();
    const s = await specExampleOnTwoBills(v);
    const readyOf = async (groupId: string) =>
      (await groupsOf(s.partyId)).groups.find((group) => group.id === groupId)!.ready === true;
    expect(await readyOf(s.cold)).toBe(false);

    // One of the two bills' items plated by the station is not the whole group.
    const [first] = await groupTickets(s.cold);
    await db.update(ticketItems).set({ state: "ready" }).where(eq(ticketItems.id, first!.id));
    expect(await readyOf(s.cold)).toBe(false);

    await ready(v, s.partyId, s.cold);
    expect(await readyOf(s.cold)).toBe(true);
    expect(await readyOf(s.drinks)).toBe(false);
    expect(await readyOf(s.warm)).toBe(false);
  });

  // Fails if a group sent away still reads only "ready", or reads away before every bill's items left.
  it("reads a group away only once every fired kitchen item of it has left the pass", async () => {
    const v = await setupVenue();
    const s = await specExampleOnTwoBills(v);
    const groupOf = async (groupId: string) =>
      (await groupsOf(s.partyId)).groups.find((group) => group.id === groupId)!;
    await ready(v, s.partyId, s.cold);
    expect((await groupOf(s.cold)).away).toBeUndefined();

    // One of the two bills' items gone is not the whole group.
    const [first, ...rest] = await groupTickets(s.cold);
    expect(rest.some((item) => item.workingOrderId !== first!.workingOrderId)).toBe(true);
    await db
      .update(ticketItems)
      .set({ awayAt: new Date().toISOString() })
      .where(eq(ticketItems.id, first!.id));
    expect((await groupOf(s.cold)).away).toBeUndefined();

    await away(v, s.partyId, s.cold);
    expect(await groupOf(s.cold)).toMatchObject({ ready: true, away: true });
    expect((await groupOf(s.drinks)).away).toBeUndefined();
    expect((await groupOf(s.warm)).away).toBeUndefined();
  });

  it("never reads ready a fired group with nothing for the kitchen, since nobody recorded it", async () => {
    const v = await setupVenue();
    const s = await seated(v);
    const { groups } = await submit(v, s.partyId, [{ release: "fire", lines: [line(v, "water")] }]);
    expect(await groupTickets(groups[0]!.id)).toEqual([]);

    await ready(v, s.partyId, groups[0]!.id);

    expect((await groupsOf(s.partyId)).groups[0]!.ready).toBeUndefined();
  });
});

describe("pass retries (D8, D19)", () => {
  it("records an away resent with its submission id once, answering the first answer", async () => {
    const v = await setupVenue();
    const s = await specExample(v);
    await ready(v, s.partyId, s.cold);
    const opts = { submissionId: randomUUID(), revision: await revisionOf(s.partyId) };

    const first = await away(v, s.partyId, s.cold, opts);
    const before = await snapshot(v, s.partyId);
    const second = await away(v, s.partyId, s.cold, opts);

    expect(second).toEqual(first);
    expect(await snapshot(v, s.partyId)).toEqual(before);
  });

  it("records a ready resent with its submission id once", async () => {
    const v = await setupVenue();
    const s = await specExample(v);
    const opts = { submissionId: randomUUID(), revision: await revisionOf(s.partyId) };

    const first = await ready(v, s.partyId, s.cold, opts);
    const before = await snapshot(v, s.partyId);
    const second = await ready(v, s.partyId, s.cold, opts);

    expect(second).toEqual(first);
    expect(await snapshot(v, s.partyId)).toEqual(before);
  });

  it("refuses the same id sent for another group (submission.id_reused), writing nothing", async () => {
    const v = await setupVenue();
    const s = await specExample(v);
    const submissionId = randomUUID();
    await ready(v, s.partyId, s.cold, { submissionId });
    await away(v, s.partyId, s.drinks, { submissionId: randomUUID() });

    await expectRefusedWithNothingWritten(
      v,
      s.partyId,
      () => ready(v, s.partyId, s.drinks, { submissionId }),
      { code: "submission.id_reused", params: { submissionId } },
    );
    await expectRefusedWithNothingWritten(
      v,
      s.partyId,
      () => away(v, s.partyId, s.cold, { submissionId }),
      { code: "submission.id_reused", params: { submissionId } },
    );
  });

  it("refuses a ready or an away sent with a stale party revision (party.out_of_date), writing nothing", async () => {
    const v = await setupVenue();
    const s = await specExample(v);
    const stale = await revisionOf(s.partyId);
    await fire(v, s.partyId, s.warm);

    for (const step of [ready, away]) {
      await expectRefusedWithNothingWritten(
        v,
        s.partyId,
        () => step(v, s.partyId, s.cold, { revision: stale }),
        { code: "party.out_of_date", params: { partyId: s.partyId, revision: stale + 1 } },
      );
    }
  });

  it("refuses a ready or an away on a closed party (party.not_open), writing nothing", async () => {
    const v = await setupVenue();
    const s = await specExample(v);
    await closeParty(s.partyId);

    for (const step of [ready, away]) {
      await expectRefusedWithNothingWritten(v, s.partyId, () => step(v, s.partyId, s.cold), {
        code: "party.not_open",
        params: { partyId: s.partyId },
      });
    }
  });

  it("refuses a group the party does not have, or another party's (group.not_found), writing nothing", async () => {
    const v = await setupVenue();
    const s = await specExample(v);
    const other = await seated(v);
    const theirs = (
      await submit(v, other.partyId, [{ release: "fire", lines: [line(v, "steak")] }])
    ).groups[0]!.id;

    for (const step of [ready, away]) {
      for (const groupId of [randomUUID(), theirs]) {
        await expectRefusedWithNothingWritten(v, s.partyId, () => step(v, s.partyId, groupId), {
          code: "group.not_found",
          params: { groupId },
        });
      }
    }
  });

  it("refuses a ready or an away on a removed group (group.not_found), writing nothing", async () => {
    const v = await setupVenue();
    const s = await specExample(v);
    const fishOnly = (await submit(v, s.partyId, [{ release: "hold", lines: [line(v, "fish")] }]))
      .groups[0]!.id;
    const [fish] = await linesIn(s.partyId, fishOnly);
    await move(v, s.partyId, [{ lineId: fish!.id, quantity: "1" }], { groupId: s.mains });

    for (const step of [ready, away]) {
      await expectRefusedWithNothingWritten(v, s.partyId, () => step(v, s.partyId, fishOnly), {
        code: "group.not_found",
        params: { groupId: fishOnly },
      });
    }
  });
});

describe("a paper-only station (Review Focus 6, server half)", () => {
  it("leaves every fired item queued and the group not ready, when no kitchen screen is enrolled", async () => {
    const v = await setupVenue();
    const s = await specExample(v);
    expect(db.all(sql`select device_id from device_kitchen_screens`)).toEqual([]);

    await fire(v, s.partyId, s.warm);

    const warm = await groupTickets(s.warm);
    expect(warm.length).toBeGreaterThan(0);
    expect(warm.map((item) => [item.state, item.readyAt])).toEqual(
      warm.map(() => ["queued", null]),
    );
    const group = (await groupsOf(s.partyId)).groups.find((row) => row.id === s.warm)!;
    expect(group).toMatchObject({ state: "fired", firedAt: expect.any(String) });
    expect(group.ready).toBeUndefined();
  });
});

describe("the kitchen and the pass read a party's groups", () => {
  it("names the party on each station card and the group of each item", async () => {
    const v = await setupVenue();
    const s = await specExampleOnTwoBills(v);
    const revision = await revisionOf(s.partyId);
    const positions = new Map([
      [s.drinks, [1, "fired"]],
      [s.cold, [2, "fired"]],
      [s.warm, [3, "held"]],
      [s.mains, [4, "held"]],
      [s.desserts, [5, "held"]],
    ] as const);

    const cards = (await inTx((tx) => listStationQueue(tx, v.stationId))).filter((card) =>
      [s.tabId, s.checkId].includes(card.orderId),
    );

    expect(cards.map((card) => card.orderId).sort()).toEqual([s.tabId, s.checkId].sort());
    for (const card of cards) {
      expect(card.party).toEqual({ id: s.partyId, revision });
    }
    const lines = await linesOf(s.partyId);
    const groupOfLine = new Map(lines.map((row) => [row.id, row.groupId]));
    const items = cards.flatMap((card) => card.items);
    expect(items.length).toBeGreaterThan(0);
    for (const item of items) {
      const groupId = groupOfLine.get(item.workingOrderLineId)!;
      const [position, state] = positions.get(groupId)!;
      expect(item.group).toEqual({ id: groupId, position, state });
    }
  });

  it("sections a party's order on the pass by group position, held groups unfired, and names no course", async () => {
    const v = await setupVenue();
    const s = await specExample(v);
    const revision = await revisionOf(s.partyId);

    const order = (await inTx((tx) => listExpoQueue(tx, v.cfg))).find(
      (row) => row.orderId === s.tabId,
    )!;

    expect(order.party).toEqual({ id: s.partyId, revision });
    expect(order.courses).toEqual([]);
    expect(
      order.groups.map((group) => [group.groupId, group.position, group.state, group.fired]),
    ).toEqual([
      // The drinks' water needs no preparation, so only the beer is on the pass.
      [s.drinks, 1, "fired", true],
      [s.cold, 2, "fired", true],
      [s.warm, 3, "held", false],
      [s.mains, 4, "held", false],
      [s.desserts, 5, "held", false],
    ]);
    expect(order.groups.map((group) => group.items.map((item) => item.name))).toEqual([
      [DISHES.beer.kitchen],
      [DISHES.cold.kitchen],
      [DISHES.warm.kitchen],
      [DISHES.steak.kitchen, DISHES.fish.kitchen],
      [DISHES.flan.kitchen],
    ]);
    expect(order.groups[1]!.items[0]!.group).toEqual({ id: s.cold, position: 2, state: "fired" });
    expect(order.groups.every((group) => !group.away)).toBe(true);
  });

  // Fails if the pass orders groups by course (the rows' own order) rather than by position.
  it("orders a party's groups on the pass by position, not by course", async () => {
    const v = await setupVenue();
    const s = await specExample(v);
    await reorder(s.partyId, [s.desserts, s.mains, s.warm]);

    const order = (await inTx((tx) => listExpoQueue(tx, v.cfg))).find(
      (row) => row.orderId === s.tabId,
    )!;

    expect(order.groups.map((group) => [group.groupId, group.position])).toEqual([
      [s.drinks, 1],
      [s.cold, 2],
      [s.desserts, 3],
      [s.mains, 4],
      [s.warm, 5],
    ]);
  });

  // Fails if two groups at one position fall back to course order instead of the earlier-made first.
  it("puts the earlier-made of two groups at one position first on the pass", async () => {
    const v = await setupVenue();
    const s = await specExample(v);
    await db
      .update(orderGroups)
      .set({ position: 4, createdAt: "2000-01-01T00:00:00.000Z" })
      .where(eq(orderGroups.id, s.desserts));

    const order = (await inTx((tx) => listExpoQueue(tx, v.cfg))).find(
      (row) => row.orderId === s.tabId,
    )!;

    expect(order.groups.map((group) => group.groupId)).toEqual([
      s.drinks,
      s.cold,
      s.warm,
      s.desserts,
      s.mains,
    ]);
  });

  it("shows a group split across two bills under its own number on each bill, and rolls its away up", async () => {
    const v = await setupVenue();
    const s = await specExampleOnTwoBills(v);
    await ready(v, s.partyId, s.cold);
    await away(v, s.partyId, s.cold);

    const board = await inTx((tx) => listExpoQueue(tx, v.cfg));
    const tab = board.find((row) => row.orderId === s.tabId)!;
    expect(tab.groups.find((group) => group.groupId === s.cold)).toMatchObject({
      position: 2,
      fired: true,
      away: true,
    });
    // The check holds only the away croquette, so it has left the pass.
    expect(board.find((row) => row.orderId === s.checkId)).toBeUndefined();
  });

  it("puts a fired line in no group in one section with no group, first", async () => {
    const v = await setupVenue();
    const s = await specExample(v);
    // A round, not a group submission, leaves the fired line in no group.
    await inTx((tx) => addTabRound(tx, v.cfg, s.tabId, [line(v, "steak")]));

    const order = (await inTx((tx) => listExpoQueue(tx, v.cfg))).find(
      (row) => row.orderId === s.tabId,
    )!;

    expect(order.groups[0]).toMatchObject({ groupId: null, position: null, state: null });
    expect(order.groups[0]!.items.map((item) => [item.name, "group" in item])).toEqual([
      [DISHES.steak.kitchen, false],
    ]);
    expect(order.groups.slice(1).map((group) => group.position)).toEqual([1, 2, 3, 4, 5]);
  });

  it("keeps a bill of no party in course sections, with no party and no groups", async () => {
    const v = await setupVenue();
    const tabId = await billOfNoParty(v, (tx, id) =>
      addTabRound(tx, v.cfg, id, [
        { menuItemId: v.offer("beer"), quantity: "1" },
        { menuItemId: v.offer("steak"), quantity: "1" },
      ]),
    );

    const order = (await inTx((tx) => listExpoQueue(tx, v.cfg))).find(
      (row) => row.orderId === tabId,
    )!;
    const [card] = (await inTx((tx) => listStationQueue(tx, v.stationId))).filter(
      (row) => row.orderId === tabId,
    );

    expect(order.party).toBeUndefined();
    expect(order.groups).toEqual([]);
    expect(order.courses.map((course) => course.courseName)).toEqual([
      COURSES.drinks,
      COURSES.mains,
    ]);
    expect("party" in card!).toBe(false);
    expect(card!.items.map((item) => "group" in item)).toEqual([false, false]);
    expect("party" in order).toBe(false);
  });
});

describe("kitchen tickets for a party's groups (Task 5)", () => {
  // Fails if a group's fire ticket stops naming its group, or names it anywhere but under the header.
  it("names the group under the header of each group's fire ticket", async () => {
    const v = await setupVenue();
    const s = await specExample(v);
    const [drinks, cold] = (await printed(v)).map(ticketLines);
    expect(drinks![4]).toBe("GROUP 1");
    expect(drinks!.slice(5).join("\n")).toContain(DISHES.beer.kitchen);
    expect(cold![4]).toBe("GROUP 2");

    await fire(v, s.partyId, s.warm);

    const warm = ticketLines((await printed(v)).at(-1)!);
    expect(warm[4]).toBe("GROUP 3");
    expect(warm.filter((text) => text.startsWith("GROUP"))).toEqual(["GROUP 3"]);
  });

  // The REPRINT line is what fails first; the rows compared before and after were already left
  // alone by the reprint before this task (it only enqueues print jobs).
  it("marks a reprint REPRINT, heads each group, and records no event, ticket item or sent stamp", async () => {
    const v = await setupVenue();
    const s = await specExample(v);
    await fire(v, s.partyId, s.warm);
    const rows = async () => ({
      events: await eventsOf(s.partyId),
      tickets: await db
        .select()
        .from(ticketItems)
        .where(eq(ticketItems.workingOrderId, s.tabId))
        .orderBy(ticketItems.id),
      sent: (await linesOf(s.partyId)).map((row) => [row.id, row.sentAt]),
    });
    const before = await rows();
    const jobsBefore = (await printed(v)).length;

    await inTx((tx) => reprintOrderTickets(tx, v.cfg, s.tabId));

    const jobs = await printed(v);
    expect(jobs).toHaveLength(jobsBefore + 1);
    const reprint = ticketLines(jobs.at(-1)!);
    expect(reprint[0]).toBe("*** REPRINT ***");
    const at = (text: string) => reprint.findIndex((row) => row.includes(text));
    expect(reprint.filter((text) => text.startsWith("GROUP"))).toEqual([
      "GROUP 1",
      "GROUP 2",
      "GROUP 3",
    ]);
    expect(at("GROUP 1")).toBeLessThan(at(DISHES.beer.kitchen));
    expect(at(DISHES.beer.kitchen)).toBeLessThan(at("GROUP 2"));
    expect(at("GROUP 2")).toBeLessThan(at(DISHES.cold.kitchen));
    expect(at(DISHES.cold.kitchen)).toBeLessThan(at("GROUP 3"));
    expect(at("GROUP 3")).toBeLessThan(at(DISHES.warm.kitchen));
    expect(await rows()).toEqual(before);
  });

  // Fails if a reprint prints in line order rather than group order: the mains were added after
  // the warm starters but moved ahead of them.
  it("prints a reprint's groups in position order, not in the order their lines were added", async () => {
    const v = await setupVenue();
    const s = await specExample(v);
    await reorder(s.partyId, [s.mains, s.warm, s.desserts]);
    await fire(v, s.partyId, s.mains);
    await fire(v, s.partyId, s.warm);

    await inTx((tx) => reprintOrderTickets(tx, v.cfg, s.tabId));

    const reprint = ticketLines((await printed(v)).at(-1)!);
    const at = (text: string) => reprint.findIndex((row) => row.includes(text));
    expect(reprint.filter((text) => text.startsWith("GROUP"))).toEqual([
      "GROUP 1",
      "GROUP 2",
      "GROUP 3",
      "GROUP 4",
    ]);
    expect(at("GROUP 3")).toBeLessThan(at(DISHES.steak.kitchen));
    expect(at(DISHES.steak.kitchen)).toBeLessThan(at("GROUP 4"));
    expect(at("GROUP 4")).toBeLessThan(at(DISHES.warm.kitchen));
  });

  // Fails if the fire ticket or the reprint ignores the venue's grouping setting.
  it("prints Steak x3 as one 3 x entry under combined and three 1 x entries under separate, leaving the bill alone", async () => {
    const v = await setupVenue();
    const steaksOn = (ticket: string) =>
      ticketLines(ticket).filter((text) => text.includes(DISHES.steak.kitchen));
    const bill = (tabId: string) =>
      db
        .select({
          productId: workingOrderLines.productId,
          quantity: workingOrderLines.quantity,
          unitPriceGross: workingOrderLines.unitPriceGross,
          lineTotal: workingOrderLines.lineTotal,
        })
        .from(workingOrderLines)
        .where(eq(workingOrderLines.workingOrderId, tabId))
        .orderBy(asc(workingOrderLines.lineNo));
    const three = (qty: string) => expect.stringMatching(new RegExp(`^${qty} .*x K-STEAK$`));

    const first = await seated(v);
    await submit(v, first.partyId, [{ release: "fire", lines: [line(v, "steak", "3")] }]);
    expect(steaksOn((await printed(v)).at(-1)!)).toEqual([three("3\\.000")]);

    await inTx((tx) => writeKitchenTicketGrouping(tx, "separate"));
    const second = await seated(v);
    await submit(v, second.partyId, [{ release: "fire", lines: [line(v, "steak", "3")] }]);
    expect(steaksOn((await printed(v)).at(-1)!)).toEqual([
      three("1\\.000"),
      three("1\\.000"),
      three("1\\.000"),
    ]);

    await inTx((tx) => reprintOrderTickets(tx, v.cfg, first.tabId));
    expect(steaksOn((await printed(v)).at(-1)!)).toEqual([
      three("1\\.000"),
      three("1\\.000"),
      three("1\\.000"),
    ]);

    const firstBill = await bill(first.tabId);
    expect(firstBill).toHaveLength(1);
    expect(firstBill[0]!.quantity).toBe(3000);
    expect(await bill(second.tabId)).toEqual(firstBill);
  });

  // Fails if two portions sold by the gram are added together under combined, or one portion is
  // split into single grams under separate; dishes sold in Each must still merge and split.
  it("prints each portion sold by weight as sold, under combined and separate alike", async () => {
    const v = await setupVenue();
    const sold = await inTx(async (tx) => {
      const [steak] = await tx
        .select({ catalogueId: products.catalogueId, categoryId: products.categoryId })
        .from(products)
        .where(eq(products.id, v.productId.steak));
      // As the venue seed makes it (`packages/catalogue/src/provisioning.ts`): whole grams only.
      const grams = { en: "g", es: "g", ca: "g", gl: "g", eu: "g" };
      const [gram] = await tx
        .insert(units)
        .values({ name: grams, abbreviation: grams, precision: 0, hardwareUnit: "g" })
        .returning({ id: units.id });
      const dish = (name: string, kitchenName: string, unit: { unitId: string } | object) =>
        createProduct(tx, {
          ...steak!,
          name,
          customerName: { en: `${name} of the day` },
          kitchenName,
          ...unit,
          unitPrice: "0.05",
          vatClass: "general",
        });
      const hake = await dish("Hake", "K-HAKE", { unitId: gram!.id });
      const ham = await dish("Ham", "K-HAM", { pricingUnit: "weight" });
      const offers = await offerProducts(tx, v.cfg, {
        zone: "tables",
        productIds: [hake.id, ham.id],
      });
      return { hake: offers.offerFor(hake.id), ham: offers.offerFor(ham.id) };
    });
    const hake = (quantity: string): GroupLine => ({ menuItemId: sold.hake, quantity });
    const ofDish = (ticket: string, kitchenName: string) =>
      ticketLines(ticket).filter((text) => text.endsWith(`x ${kitchenName}`));

    const first = await seated(v);
    await submit(v, first.partyId, [
      {
        release: "fire",
        lines: [
          hake("350"),
          line(v, "steak"),
          hake("350"),
          line(v, "steak"),
          { menuItemId: sold.ham, quantity: "0.375" },
        ],
      },
    ]);
    const combined = (await printed(v)).at(-1)!;
    expect(ofDish(combined, "K-HAKE")).toEqual(["350.000 g x K-HAKE", "350.000 g x K-HAKE"]);
    expect(ofDish(combined, "K-STEAK")).toEqual([expect.stringMatching(/^2\.000 .*x K-STEAK$/)]);
    expect(ofDish(combined, "K-HAM")).toEqual(["0.375 kg x K-HAM"]);

    await inTx((tx) => writeKitchenTicketGrouping(tx, "separate"));
    const second = await seated(v);
    await submit(v, second.partyId, [
      { release: "fire", lines: [hake("350"), line(v, "steak", "2")] },
    ]);
    const separate = (await printed(v)).at(-1)!;
    expect(ofDish(separate, "K-HAKE")).toEqual(["350.000 g x K-HAKE"]);
    expect(ofDish(separate, "K-STEAK")).toEqual([
      expect.stringMatching(/^1\.000 .*x K-STEAK$/),
      expect.stringMatching(/^1\.000 .*x K-STEAK$/),
    ]);
  });

  // Fails if identical lines of one group print as separate entries under the default.
  it.each(["fire", "hold"] as const)(
    "prints three separate Steak lines as one 3 x entry by default (%s)",
    async (release) => {
      const v = await setupVenue();
      const s = await seated(v);
      const { groups } = await submit(v, s.partyId, [
        { release, lines: [line(v, "steak"), line(v, "steak"), line(v, "steak")] },
      ]);
      if (release === "hold") await fire(v, s.partyId, groups[0]!.id);

      const steaks = await linesIn(s.partyId, groups[0]!.id);
      expect(steaks.map((row) => row.quantity)).toEqual([1000, 1000, 1000]);
      const ticket = ticketLines((await printed(v)).at(-1)!);
      expect(ticket.filter((text) => text.includes(DISHES.steak.kitchen))).toEqual([
        expect.stringMatching(/^3\.000 .*x K-STEAK$/),
      ]);
    },
  );
});

describe("advance HOLD tickets (Task 6)", () => {
  const printHeldWork = (on: boolean) => inTx((tx) => writePrintHeldWork(tx, on));

  /** What every ticket and slip for the party's tab prints under its mark. */
  const head = (v: Venue, s: Seated) => billHead(v, s, s.tabId);

  /** The jobs printed since `from`, each as its lines. */
  async function printedSince(v: Venue, from: number): Promise<string[][]> {
    return (await printed(v)).slice(from).map(ticketLines);
  }

  async function noticesAt(v: Venue) {
    return (await inTx((tx) => listStationNotices(tx, v.cfg, v.stationId))).map((notice) => ({
      kind: notice.kind,
      lineName: notice.lineName,
      quantity: notice.quantity,
      direction: notice.direction,
    }));
  }

  /** The print jobs `kitchen_print_jobs` links to a bill: the ones a printing problem can name. */
  async function linkedJobs(): Promise<string[]> {
    const rows = await db
      .select({ printJobId: kitchenPrintJobs.printJobId })
      .from(kitchenPrintJobs)
      .orderBy(sql`${kitchenPrintJobs}.rowid`);
    return rows.map((row) => row.printJobId);
  }

  async function jobIds(v: Venue): Promise<string[]> {
    const rows = await db
      .select({ id: printJobs.id })
      .from(printJobs)
      .where(eq(printJobs.printerId, v.printerId))
      .orderBy(sql`rowid`);
    return rows.map((row) => row.id);
  }

  const lineOf = async (s: Seated, groupId: string, dish: Dish, v: Venue) =>
    (await linesIn(s.partyId, groupId)).find((row) => row.productId === v.productId[dish])!;

  async function noticesWithNotes(v: Venue) {
    return (await inTx((tx) => listStationNotices(tx, v.cfg, v.stationId))).map((notice) => ({
      kind: notice.kind,
      quantity: notice.quantity,
      direction: notice.direction,
      note: notice.note,
    }));
  }

  /** A held group of two rare Steaks on a fresh party, and the Steak's line. */
  async function rareSteaks(v: Venue) {
    const s = await seated(v);
    const [group] = (
      await submit(v, s.partyId, [
        { release: "hold", lines: [{ ...line(v, "steak", "2"), note: "rare" }] },
      ])
    ).groups;
    const [steak] = await linesIn(s.partyId, group!.id);
    return { s, group: group!.id, steak: steak! };
  }

  /**
   * A dish that must be cooked one of two ways, published to the venue's tables. Its three names
   * differ, as do each way's, so paper reading a staff or customer name shows the wrong text.
   */
  async function tunaWithDoneness(v: Venue) {
    return inTx(async (tx) => {
      const [steak] = await tx
        .select({ catalogueId: products.catalogueId, categoryId: products.categoryId })
        .from(products)
        .where(eq(products.id, v.productId.steak));
      const tuna = await createProduct(tx, {
        ...steak!,
        name: "Tuna",
        customerName: { en: "Seared tuna" },
        kitchenName: "K-TUNA",
        pricingUnit: "each",
        unitPrice: "20.00",
        vatClass: "general",
      });
      const list = await createOptionList(
        tx,
        {
          name: "Doneness",
          customerName: { es: "Punto" },
          kitchenName: "K-DONE",
          defaultLabelId: null,
          active: true,
          labels: ["Rare", "Well"].map((way) => ({
            name: `${way} staff`,
            customerName: { es: `${way} customer` },
            kitchenName: `K-${way.toUpperCase()}`,
            available: true,
          })),
        },
        LOCALE,
      );
      await writeProductModifiers(tx, tuna.id, [{ kind: "options", id: list.id }]);
      const offers = await offerProducts(tx, v.cfg, { zone: "tables", productIds: [tuna.id] });
      const [rare, well] = list.labels.map((label) => ({ listId: list.id, labelId: label.id }));
      return { offer: offers.offerFor(tuna.id), rare: rare!, well: well! };
    });
  }

  it("setting off (the default): holding prints nothing, and firing prints the group's current contents, edits included", async () => {
    const v = await setupVenue();
    const s = await specExample(v);
    expect(await printed(v)).toHaveLength(2);
    const steak = await lineOf(s, s.mains, "steak", v);
    const fish = await lineOf(s, s.mains, "fish", v);

    await move(v, s.partyId, [{ lineId: steak.id, quantity: "1" }], { groupId: s.desserts });
    await changeLine(v, s.tabId, fish.lineNo, { quantity: "2" }, MIA);
    expect(await printed(v)).toHaveLength(2);
    expect(await noticesAt(v)).toEqual([]);

    await fire(v, s.partyId, s.mains);

    expect(await printedSince(v, 2)).toEqual([
      [
        ...(await head(v, s)),
        "GROUP 4",
        `1.000 x ${DISHES.steak.kitchen}`,
        `2.000 x ${DISHES.fish.kitchen}`,
      ],
    ]);
    for (const group of [s.warm, s.mains, s.desserts]) {
      expect((await groupRow(group)).holdPrintedAt).toBeNull();
    }
  });

  describe("setting on", () => {
    it("sends held quantity changes and cancellation from order edits to a second printer on the station", async () => {
      const v = await setupVenue();
      await printHeldWork(true);
      const secondPrinter = await inTx(async (tx) => {
        const printer = await createPrinter(
          tx,
          { locationId: v.cfg.locationId },
          {
            name: "Held second",
            transport: "cloud_poll",
            pollId: `poll-${randomUUID()}`,
          },
        );
        await attachPrinterToStation(tx, { stationId: v.stationId, printerId: printer.id });
        return printer.id;
      });
      const s = await specExample(v);
      const secondPaper = async () =>
        (
          await db
            .select({ payload: printJobs.payload })
            .from(printJobs)
            .where(eq(printJobs.printerId, secondPrinter))
        ).map((job) => printedLines(job.payload).join(" "));
      const before = (await secondPaper()).length;
      const steak = await lineOf(s, s.mains, "steak", v);
      const fish = await lineOf(s, s.mains, "fish", v);
      await changeLine(v, s.tabId, steak.lineNo, { quantity: "1" }, MIA);
      const changed = (await secondPaper()).slice(before);
      expect(changed).toHaveLength(1);
      expect(changed[0]).toContain("HOLD CHANGED");
      expect(changed[0]).toContain("K-STEAK");
      await saveWhole(
        v,
        s.tabId,
        (await keptLines(v, s.tabId)).filter((line) => line.workingOrderLineId !== fish.id),
        MIA,
      );
      const cancelled = (await secondPaper()).slice(before + changed.length);
      expect(cancelled).toHaveLength(1);
      expect(cancelled[0]).toContain("HOLD CANCELLED");
      expect(cancelled[0]).toContain("K-FISH");
    });
    it("holding the mains prints a ticket headed HOLD listing 2 x Steak and 1 x Fish, linked so a printing problem can name it", async () => {
      const v = await setupVenue();
      await printHeldWork(true);
      const s = await specExample(v);

      const jobs = await printedSince(v, 0);
      expect(jobs).toHaveLength(5);
      expect(jobs[3]).toEqual([
        "*** HOLD ***",
        ...(await head(v, s)),
        "GROUP 4",
        `2.000 x ${DISHES.steak.kitchen}`,
        `1.000 x ${DISHES.fish.kitchen}`,
      ]);
      expect(jobs.map((job) => job[0])).toEqual([
        expect.not.stringContaining("***"),
        expect.not.stringContaining("***"),
        "*** HOLD ***",
        "*** HOLD ***",
        "*** HOLD ***",
      ]);
      expect(jobs[4]!.slice(5)).toEqual(["GROUP 5", `2.000 x ${DISHES.flan.kitchen}`]);
      expect(await linkedJobs()).toEqual(await jobIds(v));
      expect((await groupRow(s.mains)).holdPrintedAt).not.toBeNull();
      expect((await groupRow(s.drinks)).holdPrintedAt).toBeNull();
      expect((await groupRow(s.cold)).holdPrintedAt).toBeNull();
    });

    it("moves a Steak, removes the Fish and fires the mains: -1/+1 corrections, a HOLD cancellation, then one FIRE slip", async () => {
      const v = await setupVenue();
      await printHeldWork(true);
      const s = await specExample(v);
      const header = await head(v, s);
      const steak = await lineOf(s, s.mains, "steak", v);
      const fish = await lineOf(s, s.mains, "fish", v);

      await move(v, s.partyId, [{ lineId: steak.id, quantity: "1" }], { groupId: s.desserts });

      expect(await printedSince(v, 5)).toEqual([
        ["*** HOLD CHANGED ***", ...header, "GROUP 4", `-1.000 x ${DISHES.steak.kitchen}`],
        ["*** HOLD CHANGED ***", ...header, "GROUP 5", `+1.000 x ${DISHES.steak.kitchen}`],
      ]);
      expect(await noticesAt(v)).toEqual([
        {
          kind: "changed",
          lineName: DISHES.steak.kitchen,
          quantity: "1.000",
          direction: "removed",
        },
        { kind: "changed", lineName: DISHES.steak.kitchen, quantity: "1.000", direction: "added" },
      ]);

      await inTx((tx) => cancelLine(tx, v.cfg, s.tabId, fish.lineNo, undefined, MIA));

      expect(await printedSince(v, 7)).toEqual([
        ["*** HOLD CANCELLED ***", ...header, "GROUP 4", `1.000 x ${DISHES.fish.kitchen}`],
      ]);
      expect((await noticesAt(v)).at(-1)).toEqual({
        kind: "void",
        lineName: DISHES.fish.kitchen,
        quantity: "1.000",
        direction: null,
      });
      const linkedBefore = await linkedJobs();

      await fire(v, s.partyId, s.mains);

      expect(await printedSince(v, 8)).toEqual([
        ["*** FIRE ***", ...header, "GROUP 4", `1.000 x ${DISHES.steak.kitchen}`],
      ]);
      // The FIRE slip is linked as the fire and HOLD tickets are; the corrections are not.
      expect(await linkedJobs()).toEqual([...linkedBefore, (await jobIds(v)).at(-1)]);
      expect(linkedBefore).toEqual((await jobIds(v)).slice(0, 5));
    });

    it("prints a FIRE slip through the course Fire too", async () => {
      const v = await setupVenue();
      await printHeldWork(true);
      const s = await specExample(v);
      const steak = await lineOf(s, s.mains, "steak", v);

      await inTx((tx) => fireCourse(tx, v.cfg, s.tabId, steak.courseId!, { personId: MIA }));

      expect(await printedSince(v, 5)).toEqual([
        [
          "*** FIRE ***",
          ...(await head(v, s)),
          "GROUP 4",
          `2.000 x ${DISHES.steak.kitchen}`,
          `1.000 x ${DISHES.fish.kitchen}`,
        ],
      ]);
    });

    it("prints nothing when a Steak of the printed mains is split onto a check, then one FIRE slip from each bill for its own dishes", async () => {
      const v = await setupVenue();
      await printHeldWork(true);
      const s = await specExample(v);
      const steak = await lineOf(s, s.mains, "steak", v);
      const holdJob = (await jobIds(v))[3]!;
      expect((await printedSince(v, 3))[0]).toEqual([
        "*** HOLD ***",
        ...(await head(v, s)),
        "GROUP 4",
        `2.000 x ${DISHES.steak.kitchen}`,
        `1.000 x ${DISHES.fish.kitchen}`,
      ]);

      const checkId = await splitToCheck(
        v,
        s,
        [{ lineNo: steak.lineNo, quantity: "1" }],
        undefined,
        MIA,
      );

      expect(await printedSince(v, 5)).toEqual([]);
      expect(await noticesAt(v)).toEqual([]);

      await fire(v, s.partyId, s.mains);

      expect(await printedSince(v, 5)).toEqual([
        [
          "*** FIRE ***",
          ...(await head(v, s)),
          "GROUP 4",
          `1.000 x ${DISHES.steak.kitchen}`,
          `1.000 x ${DISHES.fish.kitchen}`,
        ],
        [
          "*** FIRE ***",
          ...(await billHead(v, s, checkId)),
          "GROUP 4",
          `1.000 x ${DISHES.steak.kitchen}`,
        ],
      ]);
      const [tabSlip, checkSlip] = (await jobIds(v)).slice(5);
      const linksOf = async (billId: string) =>
        (
          await db
            .select({ printJobId: kitchenPrintJobs.printJobId })
            .from(kitchenPrintJobs)
            .where(eq(kitchenPrintJobs.workingOrderId, billId))
            .orderBy(sql`${kitchenPrintJobs}.rowid`)
        ).map((row) => row.printJobId);
      // A printing problem on the check can name the HOLD ticket its Steak was announced on.
      expect(await linksOf(checkId)).toEqual([holdJob, checkSlip]);
      expect(await linksOf(s.tabId)).toEqual([...(await jobIds(v)).slice(0, 5), tabSlip]);
    });

    it("prints +1 for a Steak joined to the printed mains, with an added notice", async () => {
      const v = await setupVenue();
      await printHeldWork(true);
      const s = await specExample(v);

      await submit(v, s.partyId, [{ release: "hold", lines: [line(v, "steak")] }], {
        joinGroupId: s.mains,
      });

      expect(await printedSince(v, 5)).toEqual([
        [
          "*** HOLD CHANGED ***",
          ...(await head(v, s)),
          "GROUP 4",
          `+1.000 x ${DISHES.steak.kitchen}`,
        ],
      ]);
      expect(await noticesAt(v)).toEqual([
        { kind: "changed", lineName: DISHES.steak.kitchen, quantity: "1.000", direction: "added" },
      ]);
    });

    it("prints a HOLD ticket for the new group a move makes, and -1 for the printed group it left", async () => {
      const v = await setupVenue();
      await printHeldWork(true);
      const s = await specExample(v);
      const header = await head(v, s);
      const steak = await lineOf(s, s.mains, "steak", v);

      await move(v, s.partyId, [{ lineId: steak.id, quantity: "1" }], "new");

      const created = (await groupsOf(s.partyId)).groups.at(-1)!;
      expect(created.position).toBe(6);
      expect(await printedSince(v, 5)).toEqual([
        ["*** HOLD CHANGED ***", ...header, "GROUP 4", `-1.000 x ${DISHES.steak.kitchen}`],
        ["*** HOLD ***", ...header, "GROUP 6", `1.000 x ${DISHES.steak.kitchen}`],
      ]);
      expect((await groupRow(created.id)).holdPrintedAt).not.toBeNull();
      expect((await noticesAt(v)).map((notice) => notice.direction)).toEqual(["removed"]);
    });

    it("prints -1 and +1 for a whole line moved between printed groups", async () => {
      const v = await setupVenue();
      await printHeldWork(true);
      const s = await specExample(v);
      const header = await head(v, s);
      const fish = await lineOf(s, s.mains, "fish", v);

      await move(v, s.partyId, [{ lineId: fish.id, quantity: "1" }], { groupId: s.warm });

      expect(await printedSince(v, 5)).toEqual([
        ["*** HOLD CHANGED ***", ...header, "GROUP 4", `-1.000 x ${DISHES.fish.kitchen}`],
        ["*** HOLD CHANGED ***", ...header, "GROUP 3", `+1.000 x ${DISHES.fish.kitchen}`],
      ]);
    });

    it("prints nothing for part of a line moved within its own printed group", async () => {
      const v = await setupVenue();
      await printHeldWork(true);
      const s = await specExample(v);
      const steak = await lineOf(s, s.mains, "steak", v);

      await move(v, s.partyId, [{ lineId: steak.id, quantity: "1" }], { groupId: s.mains });

      expect(await linesIn(s.partyId, s.mains)).toHaveLength(3);
      expect(await printedSince(v, 5)).toEqual([]);
      expect(await noticesAt(v)).toEqual([]);
    });

    // A fired group keeps the time its HOLD ticket was queued; its work is corrected as fired work.
    it("prints no HOLD correction for a line recalled from a fired group whose HOLD ticket was queued", async () => {
      const v = await setupVenue();
      await printHeldWork(true);
      const s = await specExample(v);
      await fire(v, s.partyId, s.mains);
      const fish = await lineOf(s, s.mains, "fish", v);
      await inTx((tx) => recallLines(tx, v.cfg, s.tabId, [fish.lineNo]));
      expect((await printedSince(v, 6)).map((job) => job[0])).toEqual(["*** RECALLED ***"]);

      await inTx((tx) => cancelLine(tx, v.cfg, s.tabId, fish.lineNo, undefined, MIA));

      expect(await printedSince(v, 7)).toEqual([]);
      expect((await noticesAt(v)).map((notice) => notice.kind)).toEqual(["recalled"]);
    });

    // An edit that is not a quantity alone takes the dish away as it read and gives it back as
    // it now reads.
    it("prints a changed note as -N of the dish as it read, then +N as it now reads", async () => {
      const v = await setupVenue();
      await printHeldWork(true);
      const { s, steak } = await rareSteaks(v);
      const header = await head(v, s);

      await changeLine(v, s.tabId, steak.lineNo, { note: "no pepper" }, MIA);

      expect(await printedSince(v, 1)).toEqual([
        [
          "*** HOLD CHANGED ***",
          ...header,
          "GROUP 1",
          `-2.000 x ${DISHES.steak.kitchen}`,
          "  * rare",
        ],
        [
          "*** HOLD CHANGED ***",
          ...header,
          "GROUP 1",
          `+2.000 x ${DISHES.steak.kitchen}`,
          "  * no pepper",
        ],
      ]);
      expect(await noticesWithNotes(v)).toEqual([
        { kind: "changed", quantity: "2.000", direction: "removed", note: "rare" },
        { kind: "changed", quantity: "2.000", direction: "added", note: "no pepper" },
      ]);
    });

    it("prints a quantity and a note changed together as the old dish taken away and the new one given", async () => {
      const v = await setupVenue();
      await printHeldWork(true);
      const { s, steak } = await rareSteaks(v);
      const header = await head(v, s);

      await changeLine(v, s.tabId, steak.lineNo, { quantity: "1", note: "well done" }, MIA);

      expect(await printedSince(v, 1)).toEqual([
        [
          "*** HOLD CHANGED ***",
          ...header,
          "GROUP 1",
          `-2.000 x ${DISHES.steak.kitchen}`,
          "  * rare",
        ],
        [
          "*** HOLD CHANGED ***",
          ...header,
          "GROUP 1",
          `+1.000 x ${DISHES.steak.kitchen}`,
          "  * well done",
        ],
      ]);
      expect(await noticesWithNotes(v)).toEqual([
        { kind: "changed", quantity: "2.000", direction: "removed", note: "rare" },
        { kind: "changed", quantity: "1.000", direction: "added", note: "well done" },
      ]);
    });

    it("prints an added extra as the dish without it taken away and the dish with it given", async () => {
      const v = await setupVenue();
      await printHeldWork(true);
      const { s, steak } = await rareSteaks(v);
      const header = await head(v, s);
      const sauce = [
        { listId: v.extrasListId, picks: [{ productId: v.productId.sauce, quantity: 1 }] },
      ];

      await changeLine(v, s.tabId, steak.lineNo, { extras: sauce }, MIA);

      expect(await printedSince(v, 1)).toEqual([
        [
          "*** HOLD CHANGED ***",
          ...header,
          "GROUP 1",
          `-2.000 x ${DISHES.steak.kitchen}`,
          "  * rare",
        ],
        [
          "*** HOLD CHANGED ***",
          ...header,
          "GROUP 1",
          `+2.000 x ${DISHES.steak.kitchen}`,
          `  + ${DISHES.sauce.staff}`,
          "  * rare",
        ],
      ]);
      expect(await noticesWithNotes(v)).toEqual([
        { kind: "changed", quantity: "2.000", direction: "removed", note: "rare" },
        { kind: "changed", quantity: "2.000", direction: "added", note: "rare" },
      ]);
    });

    it("prints a changed options answer as the dish cooked the old way taken away and the new way given", async () => {
      const v = await setupVenue();
      await printHeldWork(true);
      const tuna = await tunaWithDoneness(v);
      const s = await seated(v);
      const [group] = (
        await submit(v, s.partyId, [
          {
            release: "hold",
            lines: [{ menuItemId: tuna.offer, quantity: "1", options: [tuna.rare] }],
          },
        ])
      ).groups;
      const [dish] = await linesIn(s.partyId, group!.id);
      const header = await head(v, s);

      await changeLine(v, s.tabId, dish!.lineNo, { options: [tuna.well] }, MIA);

      expect(await printedSince(v, 1)).toEqual([
        ["*** HOLD CHANGED ***", ...header, "GROUP 1", "-1.000 x K-TUNA", "  + K-DONE: K-RARE"],
        ["*** HOLD CHANGED ***", ...header, "GROUP 1", "+1.000 x K-TUNA", "  + K-DONE: K-WELL"],
      ]);
      expect((await noticesWithNotes(v)).map((notice) => notice.direction)).toEqual([
        "removed",
        "added",
      ]);
    });

    it("prints nothing for the same edits on a group whose HOLD ticket was never queued", async () => {
      const v = await setupVenue();
      const tuna = await tunaWithDoneness(v);
      const { s, steak } = await rareSteaks(v);
      const [group] = (
        await submit(v, s.partyId, [
          {
            release: "hold",
            lines: [{ menuItemId: tuna.offer, quantity: "1", options: [tuna.rare] }],
          },
        ])
      ).groups;
      const [dish] = await linesIn(s.partyId, group!.id);
      await printHeldWork(true);

      await changeLine(v, s.tabId, steak.lineNo, { note: "no pepper" }, MIA);
      await changeLine(v, s.tabId, steak.lineNo, { quantity: "1", note: "well done" }, MIA);
      await changeLine(
        v,
        s.tabId,
        steak.lineNo,
        {
          extras: [
            { listId: v.extrasListId, picks: [{ productId: v.productId.sauce, quantity: 1 }] },
          ],
        },
        MIA,
      );
      await changeLine(v, s.tabId, dish!.lineNo, { options: [tuna.well] }, MIA);

      expect(await printed(v)).toEqual([]);
      expect(await noticesWithNotes(v)).toEqual([]);
    });

    it("prints +1 and -1 for a held Steak's quantity raised and lowered by an edit", async () => {
      const v = await setupVenue();
      await printHeldWork(true);
      const s = await specExample(v);
      const header = await head(v, s);
      const steak = await lineOf(s, s.mains, "steak", v);

      await changeLine(v, s.tabId, steak.lineNo, { quantity: "3" }, MIA);
      await changeLine(v, s.tabId, steak.lineNo, { quantity: "1" }, MIA);

      expect(await printedSince(v, 5)).toEqual([
        ["*** HOLD CHANGED ***", ...header, "GROUP 4", `+1.000 x ${DISHES.steak.kitchen}`],
        ["*** HOLD CHANGED ***", ...header, "GROUP 4", `-2.000 x ${DISHES.steak.kitchen}`],
      ]);
      expect(await noticesAt(v)).toEqual([
        { kind: "changed", lineName: DISHES.steak.kitchen, quantity: "1.000", direction: "added" },
        {
          kind: "changed",
          lineName: DISHES.steak.kitchen,
          quantity: "2.000",
          direction: "removed",
        },
      ]);
    });

    it("prints a HOLD cancellation for a held line a whole-order save leaves out", async () => {
      const v = await setupVenue();
      await printHeldWork(true);
      const s = await specExample(v);
      const fish = await lineOf(s, s.mains, "fish", v);

      await saveWhole(
        v,
        s.tabId,
        (await keptLines(v, s.tabId)).filter((kept) => kept.workingOrderLineId !== fish.id),
        MIA,
      );

      expect(await printedSince(v, 5)).toEqual([
        [
          "*** HOLD CANCELLED ***",
          ...(await head(v, s)),
          "GROUP 4",
          `1.000 x ${DISHES.fish.kitchen}`,
        ],
      ]);
      expect(await noticesAt(v)).toEqual([
        { kind: "void", lineName: DISHES.fish.kitchen, quantity: "1.000", direction: null },
      ]);
    });

    it("prints a HOLD cancellation for the part of a held line voided, and for a void that empties its group", async () => {
      const v = await setupVenue();
      await printHeldWork(true);
      const s = await specExample(v);
      const header = await head(v, s);
      const steak = await lineOf(s, s.mains, "steak", v);
      const flan = await lineOf(s, s.desserts, "flan", v);

      await inTx((tx) => cancelLine(tx, v.cfg, s.tabId, steak.lineNo, "1", MIA));
      await inTx((tx) => cancelLine(tx, v.cfg, s.tabId, flan.lineNo, undefined, MIA));

      expect(await printedSince(v, 5)).toEqual([
        ["*** HOLD CANCELLED ***", ...header, "GROUP 4", `1.000 x ${DISHES.steak.kitchen}`],
        ["*** HOLD CANCELLED ***", ...header, "GROUP 5", `2.000 x ${DISHES.flan.kitchen}`],
      ]);
      expect((await groupRow(s.desserts)).state).toBe("removed");
      expect((await noticesAt(v)).map((notice) => notice.kind)).toEqual(["void", "void"]);
    });

    it("prints a HOLD ticket for the held group an edit makes on a party with nothing sent", async () => {
      const v = await setupVenue();
      await printHeldWork(true);
      const s = await seated(v);
      await submit(v, s.partyId, [{ release: "hold", lines: [line(v, "steak")] }]);
      expect(await printed(v)).toHaveLength(1);

      await saveWhole(v, s.tabId, [...(await keptLines(v, s.tabId)), line(v, "fish")], MIA);

      const created = (await groupsOf(s.partyId)).groups.at(-1)!;
      expect(created.summary).toBe("1 × Fish");
      expect(await printedSince(v, 1)).toEqual([
        ["*** HOLD ***", ...(await head(v, s)), "GROUP 2", `1.000 x ${DISHES.fish.kitchen}`],
      ]);
      expect((await groupRow(created.id)).holdPrintedAt).not.toBeNull();
    });

    it("records no HOLD ticket where no active printer took one, and the group fires as before", async () => {
      const v = await setupVenue();
      await printHeldWork(true);
      await db.update(printers).set({ active: false }).where(eq(printers.id, v.printerId));
      const s = await seated(v);
      const [held] = (await submit(v, s.partyId, [{ release: "hold", lines: [line(v, "fish")] }]))
        .groups;
      expect((await groupRow(held!.id)).holdPrintedAt).toBeNull();
      await db.update(printers).set({ active: true }).where(eq(printers.id, v.printerId));

      await fire(v, s.partyId, held!.id);

      expect(await printedSince(v, 0)).toEqual([
        [...(await head(v, s)), "GROUP 1", `1.000 x ${DISHES.fish.kitchen}`],
      ]);
    });
  });

  describe("a group held before the setting was turned on", () => {
    it("fires with a normal ticket, and its edits print nothing", async () => {
      const v = await setupVenue();
      const s = await specExample(v);
      await printHeldWork(true);
      const steak = await lineOf(s, s.mains, "steak", v);

      await move(v, s.partyId, [{ lineId: steak.id, quantity: "1" }], { groupId: s.desserts });
      await changeLine(v, s.tabId, steak.lineNo, { quantity: "2" }, MIA);
      await submit(v, s.partyId, [{ release: "hold", lines: [line(v, "fish")] }], {
        joinGroupId: s.mains,
      });
      expect(await printed(v)).toHaveLength(2);
      expect(await noticesAt(v)).toEqual([]);

      await fire(v, s.partyId, s.mains);

      expect(await printedSince(v, 2)).toEqual([
        [
          ...(await head(v, s)),
          "GROUP 4",
          `2.000 x ${DISHES.steak.kitchen}`,
          `2.000 x ${DISHES.fish.kitchen}`,
        ],
      ]);
    });

    it("is the marker, not the setting: a group whose HOLD ticket was queued still fires with a FIRE slip once the setting is off", async () => {
      const v = await setupVenue();
      await printHeldWork(true);
      const s = await specExample(v);
      await printHeldWork(false);
      const fish = await lineOf(s, s.mains, "fish", v);

      await inTx((tx) => cancelLine(tx, v.cfg, s.tabId, fish.lineNo, undefined, MIA));
      await fire(v, s.partyId, s.mains);

      expect((await printedSince(v, 5)).map((job) => job[0])).toEqual([
        "*** HOLD CANCELLED ***",
        "*** FIRE ***",
      ]);
    });
  });

  describe("retries (D8) print nothing the second time", () => {
    it("prints a repeated held submission's HOLD ticket once", async () => {
      const v = await setupVenue();
      await printHeldWork(true);
      const s = await seated(v);
      const opts = { submissionId: randomUUID(), revision: await revisionOf(s.partyId) };
      const groups = [{ release: "hold" as const, lines: [line(v, "steak")] }];

      await submit(v, s.partyId, groups, opts);
      await submit(v, s.partyId, groups, opts);

      expect((await printed(v)).map((job) => ticketLines(job)[0])).toEqual(["*** HOLD ***"]);
    });

    it("prints a repeated move's corrections once", async () => {
      const v = await setupVenue();
      await printHeldWork(true);
      const s = await specExample(v);
      const steak = await lineOf(s, s.mains, "steak", v);
      const opts = { submissionId: randomUUID(), revision: await revisionOf(s.partyId) };
      const moves = [{ lineId: steak.id, quantity: "1" }];

      await move(v, s.partyId, moves, { groupId: s.desserts }, opts);
      await move(v, s.partyId, moves, { groupId: s.desserts }, opts);

      expect(await printedSince(v, 5)).toHaveLength(2);
      expect(await noticesAt(v)).toHaveLength(2);
    });
  });
});
