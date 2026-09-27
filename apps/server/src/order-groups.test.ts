import { randomUUID } from "node:crypto";
import { and, asc, eq, inArray, isNotNull, sql } from "drizzle-orm";
import { beforeAll, describe, expect, expectTypeOf, it } from "vitest";
import {
  diningTables,
  locations,
  orderGroupEvents,
  orderGroups,
  printJobs,
  serviceCommands,
  ticketItems,
  tills,
  visits,
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
  createProduct,
  writeProductModifiers,
} from "@waitron/catalogue";
import { createPrinter } from "@waitron/printing";
import {
  locationId as brandLocationId,
  nodeId as brandNodeId,
  seriesId as brandSeriesId,
  tillId as brandTillId,
} from "@waitron/shared";
import type { TillConfig } from "./till-config.js";
import { createCourse, setProductCourse } from "./kitchen.js";
import { attachPrinterToStation } from "./station-printers.js";
import { createTable } from "./tables.js";
import { printedLines } from "./testing/decode-ticket.js";
import { seedLegacySellingUnits } from "./testing/seed-units.js";
import { offerProducts } from "./testing/zone-offers.js";
import { VENUE_SERVICE } from "./modules.js";
import {
  addTabRound,
  createOpenOrder,
  fireCourse,
  joinTable,
  mergeTabs,
  openTab,
  parkOrder,
  recallLines,
  sendLines,
  splitOffCheck,
  transferLines,
  unjoinTable,
  updateHeldOrder,
  updateOrderLine,
  voidTabLine,
  type TillSaleDeps,
} from "./working-order.js";
import { seatTable } from "./visits.js";
import {
  fireGroup,
  listOrderGroups,
  moveLinesToGroup,
  reorderHeldGroups,
  submitGroups,
  type GroupLine,
  type GroupRelease,
} from "./order-groups.js";
import "./errors.js";

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
  cfg: TillConfig;
  productId: Record<Dish, string>;
  printerId: string;
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
  const [till] = await db
    .insert(tills)
    .values({ locationId, name: "Caja 1" })
    .returning({ id: tills.id });
  const nodeId = await seedNode(db, brandLocationId(locationId));
  const cfg: TillConfig = {
    tillId: brandTillId(till!.id),
    nodeId: brandNodeId(nodeId),
    seriesId: brandSeriesId(randomUUID()),
    locationId: brandLocationId(locationId),
    locale: LOCALE,
    invoiceLocales: [LOCALE],
    tipsEnabled: false,
    orderFlow: "prepay",
  };
  return inTx(async (tx) => {
    const catalogue = await createCatalogue(tx, { name: "Carta" });
    const category = await createCategory(tx, { name: { en: "Platos" } });
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
    await tx.run(sql`
      update preparation_routes set station_id = null, no_preparation = 1
      where product_id = ${productId.water}`);
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
      extrasListId: extras.id,
      zoneId: offers.zoneId,
      offer: (dish: Dish) => offers.offerFor(productId[dish]),
    };
  });
}

interface Seated {
  visitId: string;
  tabId: string;
  tableId: string;
}

async function seated(v: Venue): Promise<Seated> {
  return inTx(async (tx) => {
    const { id: tableId } = await createTable(tx, v.cfg, {
      label: `T-${randomUUID().slice(0, 6)}`,
      zoneId: v.zoneId,
    });
    const { visitId, tabId } = await seatTable(tx, v.cfg, {
      tableId,
      guestCount: 4,
      operatorId: ALEX,
    });
    return { visitId, tabId, tableId };
  });
}

function line(v: Venue, dish: Dish, quantity = "1"): GroupLine {
  return { menuItemId: v.offer(dish), quantity };
}

async function revisionOf(visitId: string): Promise<number> {
  const [row] = await db
    .select({ revision: visits.revision })
    .from(visits)
    .where(eq(visits.id, visitId));
  return row!.revision;
}

interface CommandOptions {
  submissionId?: string;
  revision?: number;
  operatorId?: string;
}

async function args(visitId: string, opts: CommandOptions = {}) {
  return {
    submissionId: opts.submissionId ?? randomUUID(),
    expectedVisitRevision: opts.revision ?? (await revisionOf(visitId)),
    operatorId: opts.operatorId ?? ALEX,
  };
}

async function submit(
  v: Venue,
  visitId: string,
  groups: { lines: GroupLine[]; release: GroupRelease }[],
  opts: CommandOptions & { joinGroupId?: string } = {},
) {
  const command = await args(visitId, opts);
  return inTx((tx) =>
    submitGroups(tx, v.cfg, visitId, { ...command, groups, joinGroupId: opts.joinGroupId }),
  );
}

async function fire(v: Venue, visitId: string, groupId: string, opts: CommandOptions = {}) {
  const command = await args(visitId, opts);
  return inTx((tx) => fireGroup(tx, v.cfg, visitId, groupId, command));
}

async function reorder(visitId: string, ids: string[], opts: CommandOptions = {}) {
  const command = await args(visitId, opts);
  return inTx((tx) => reorderHeldGroups(tx, visitId, ids, command));
}

async function move(
  v: Venue,
  visitId: string,
  moves: { lineId: string; quantity: string }[],
  target: { groupId: string } | "new",
  opts: CommandOptions = {},
) {
  const command = await args(visitId, opts);
  return inTx((tx) => moveLinesToGroup(tx, v.cfg, visitId, moves, target, command));
}

async function groupsOf(visitId: string) {
  return inTx((tx) => listOrderGroups(tx, visitId));
}

/** The top-level lines of the visit's bills, by bill then line number. */
async function linesOf(visitId: string) {
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
    .where(and(eq(workingOrders.visitId, visitId), sql`${workingOrderLines.parentLineId} is null`))
    .orderBy(asc(workingOrders.openedAt), asc(workingOrderLines.lineNo));
}

async function linesIn(visitId: string, groupId: string) {
  return (await linesOf(visitId)).filter((row) => row.groupId === groupId);
}

async function ticketsOf(visitId: string) {
  return db
    .select({
      lineId: ticketItems.workingOrderLineId,
      firedAt: ticketItems.firedAt,
      quantity: ticketItems.quantity,
    })
    .from(ticketItems)
    .innerJoin(workingOrders, eq(workingOrders.id, ticketItems.workingOrderId))
    .where(eq(workingOrders.visitId, visitId));
}

async function firedTicketLineIds(visitId: string): Promise<string[]> {
  return (await ticketsOf(visitId))
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

async function eventsOf(visitId: string) {
  return db
    .select({
      groupId: orderGroupEvents.groupId,
      kind: orderGroupEvents.kind,
      actorId: orderGroupEvents.actorId,
      detail: orderGroupEvents.detail,
    })
    .from(orderGroupEvents)
    .where(eq(orderGroupEvents.visitId, visitId))
    .orderBy(sql`rowid`);
}

/** Every row a group command can write, so a refusal can be shown to have written none. */
async function snapshot(v: Venue, visitId: string) {
  const bills = await db
    .select({ id: workingOrders.id, revision: workingOrders.revision })
    .from(workingOrders)
    .where(eq(workingOrders.visitId, visitId))
    .orderBy(workingOrders.id);
  const billIds = bills.map((bill) => bill.id);
  return {
    visit: await db.select().from(visits).where(eq(visits.id, visitId)),
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
      .where(eq(orderGroups.visitId, visitId))
      .orderBy(orderGroups.id),
    events: await eventsOf(visitId),
    commands: await db
      .select()
      .from(serviceCommands)
      .where(eq(serviceCommands.scopeId, visitId))
      .orderBy(serviceCommands.id),
    printed: await printed(v),
  };
}

async function expectRefusedWithNothingWritten(
  v: Venue,
  visitId: string,
  attempt: () => Promise<unknown>,
  expected: { code: string; params?: Record<string, unknown> },
): Promise<void> {
  const before = await snapshot(v, visitId);
  await expect(attempt()).rejects.toMatchObject(expected);
  expect(await snapshot(v, visitId)).toEqual(before);
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
    (await submit(v, seat.visitId, [{ release, lines }])).groups[0]!.id;
  const drinks = await one("fire", [line(v, "beer", "2"), line(v, "water")]);
  const cold = await one("fire", [line(v, "cold", "4")]);
  const warm = await one("hold", [line(v, "warm", "4")]);
  const later = await submit(v, seat.visitId, [
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

    const { groups } = await groupsOf(s.visitId);
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
    const lines = await linesOf(s.visitId);
    const inGroup = (groupId: string) => lines.filter((row) => row.groupId === groupId);

    const routedFired = [...inGroup(s.drinks), ...inGroup(s.cold)]
      .filter((row) => row.productId !== v.productId.water)
      .map((row) => row.id)
      .sort();
    expect(await firedTicketLineIds(s.visitId)).toEqual(routedFired);
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
    await submit(v, s.visitId, [{ release: "hold", lines: [line(v, "steak", "2")] }], {
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
    await submit(v, s.visitId, [{ release: "fire", lines: [line(v, "beer")] }]);
    await db
      .update(workingOrders)
      .set({ status: "settled", settledAt: new Date().toISOString() })
      .where(eq(workingOrders.id, s.tabId));

    const result = await submit(v, s.visitId, [{ release: "fire", lines: [line(v, "flan")] }]);

    expect(result.tabId).not.toBe(s.tabId);
    expect(result.revision).toBe(await revisionOf(s.visitId));
    const [flan] = await linesIn(s.visitId, result.groups[0]!.id);
    expect(flan).toMatchObject({ workingOrderId: result.tabId, name: DISHES.flan.staff });
  });
});

describe("fire all now", () => {
  it("makes ONE fired group of a draft spanning four courses, never one per course", async () => {
    const v = await setupVenue();
    const s = await seated(v);

    const result = await submit(v, s.visitId, [
      {
        release: "fire",
        lines: [line(v, "beer"), line(v, "cold"), line(v, "steak"), line(v, "flan")],
      },
    ]);

    const { groups } = await groupsOf(s.visitId);
    expect(groups).toHaveLength(1);
    expect(groups[0]).toMatchObject({ id: result.groups[0]!.id, position: 1, state: "fired" });
    const lines = await linesOf(s.visitId);
    // The lines keep their four product-default courses, which the earliest-course rule would
    // have held; the group's release decides instead.
    expect(new Set(lines.map((row) => row.courseId)).size).toBe(4);
    expect(await firedTicketLineIds(s.visitId)).toEqual(lines.map((row) => row.id).sort());
  });
});

describe("later additions (§12 item 4)", () => {
  it("submits a later Steak released to fire as a new fired group", async () => {
    const v = await setupVenue();
    const s = await specExample(v);

    const result = await submit(v, s.visitId, [{ release: "fire", lines: [line(v, "steak")] }]);

    const { groups } = await groupsOf(s.visitId);
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

    const result = await submit(v, s.visitId, [{ release: "hold", lines: [line(v, "steak")] }], {
      joinGroupId: s.mains,
    });

    expect(result.groups.map((group) => group.id)).toEqual([s.mains]);
    const mains = (await groupsOf(s.visitId)).groups.find((group) => group.id === s.mains)!;
    expect(mains).toMatchObject({ position: 4, state: "held", remindAt });
    expect(mains.lineIds).toHaveLength(3);
    expect((await eventsOf(s.visitId)).at(-1)).toMatchObject({
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
      s.visitId,
      () =>
        submit(v, s.visitId, [{ release: "hold", lines: [line(v, "beer")] }], {
          joinGroupId: s.drinks,
        }),
      { code: "group.not_held", params: { groupId: s.drinks } },
    );
  });

  it("refuses to join a group the visit does not have (group.not_found), writing nothing", async () => {
    const v = await setupVenue();
    const s = await specExample(v);
    const other = await specExample(v);
    await expectRefusedWithNothingWritten(
      v,
      s.visitId,
      () =>
        submit(v, s.visitId, [{ release: "hold", lines: [line(v, "beer")] }], {
          joinGroupId: other.mains,
        }),
      { code: "group.not_found", params: { groupId: other.mains } },
    );
  });

  it("never matches a group by course: a fired Steak does not join the held mains", async () => {
    const v = await setupVenue();
    const s = await specExample(v);
    const mainsBefore = await linesIn(s.visitId, s.mains);

    const result = await submit(v, s.visitId, [{ release: "fire", lines: [line(v, "steak")] }]);

    expect(result.groups[0]!.id).not.toBe(s.mains);
    expect(await linesIn(s.visitId, s.mains)).toEqual(mainsBefore);
    const [steak] = await linesIn(s.visitId, result.groups[0]!.id);
    expect(steak!.courseId).toBe(mainsBefore[0]!.courseId);
  });
});

describe("editing held groups", () => {
  it("puts the desserts before the mains, leaving the fired groups at 1 and 2", async () => {
    const v = await setupVenue();
    const s = await specExample(v);

    await reorder(s.visitId, [s.warm, s.desserts, s.mains]);

    const { groups } = await groupsOf(s.visitId);
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

    await reorder(s.visitId, [s.desserts, s.mains, s.warm]);

    const { groups } = await groupsOf(s.visitId);
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
      s.visitId,
      () => reorder(s.visitId, [s.desserts, s.mains, s.warm, s.drinks]),
      { code: "group.not_held", params: { groupId: s.drinks } },
    );
  });

  it("refuses a reorder missing a held group (management.request_invalid), changing nothing", async () => {
    const v = await setupVenue();
    const s = await specExample(v);
    await expectRefusedWithNothingWritten(
      v,
      s.visitId,
      () => reorder(s.visitId, [s.desserts, s.mains]),
      { code: "management.request_invalid", params: { field: "heldGroupIds" } },
    );
    await expectRefusedWithNothingWritten(
      v,
      s.visitId,
      () => reorder(s.visitId, [s.desserts, s.mains, s.warm, s.warm]),
      { code: "management.request_invalid", params: { field: "heldGroupIds" } },
    );
  });

  it("moves one Steak of two from the mains to the desserts, splitting the row and its ticket", async () => {
    const v = await setupVenue();
    const s = await specExample(v);
    const [steak] = await linesIn(s.visitId, s.mains);

    await move(v, s.visitId, [{ lineId: steak!.id, quantity: "1" }], { groupId: s.desserts });

    const { groups } = await groupsOf(s.visitId);
    const byId = new Map(groups.map((group) => [group.id, group]));
    expect(byId.get(s.mains)!.summary).toBe("1 × Steak, 1 × Fish");
    expect(byId.get(s.desserts)!.summary).toBe("2 × Flan, 1 × Steak");
    const steaks = (await linesOf(s.visitId)).filter((row) => row.productId === v.productId.steak);
    expect(steaks.map((row) => [row.groupId, row.quantity, row.creditedTo])).toEqual([
      [s.mains, 1000, ALEX],
      [s.desserts, 1000, ALEX],
    ]);
    const tickets = await ticketsOf(s.visitId);
    for (const row of steaks) {
      expect(tickets.find((ticket) => ticket.lineId === row.id)).toMatchObject({
        firedAt: null,
        quantity: 1000,
      });
    }
  });

  it("answers the visit's revision as stored after a move that splits a row and empties a group", async () => {
    const v = await setupVenue();
    const s = await specExample(v);
    const fishOnly = (await submit(v, s.visitId, [{ release: "hold", lines: [line(v, "fish")] }]))
      .groups[0]!.id;
    const [fish] = await linesIn(s.visitId, fishOnly);
    const [steak] = await linesIn(s.visitId, s.mains);
    const before = await revisionOf(s.visitId);

    const result = await move(
      v,
      s.visitId,
      [
        { lineId: steak!.id, quantity: "1" },
        { lineId: fish!.id, quantity: "1" },
      ],
      { groupId: s.desserts },
    );

    expect(result).toEqual({ revision: before + 1 });
    expect(await revisionOf(s.visitId)).toBe(before + 1);
    const [row] = await db.select().from(orderGroups).where(eq(orderGroups.id, fishOnly));
    expect(row!.state).toBe("removed");
  });

  it("moves part of two lines of one bill in one request, splitting each into a numbered row of the target", async () => {
    const v = await setupVenue();
    const s = await specExample(v);
    const [steak] = await linesIn(s.visitId, s.mains);
    const [flan] = await linesIn(s.visitId, s.desserts);

    await move(
      v,
      s.visitId,
      [
        { lineId: steak!.id, quantity: "1" },
        { lineId: flan!.id, quantity: "1" },
      ],
      "new",
    );

    const target = (await groupsOf(s.visitId)).groups[5]!.id;
    const rows = (await linesOf(s.visitId)).map((row) => [
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
    const { groups } = await submit(v, s.visitId, [
      { release: "hold", lines: [line(v, "water", "3"), line(v, "steak", "2")] },
    ]);
    const groupId = groups[0]!.id;
    const [water, steak] = await linesIn(s.visitId, groupId);
    const revision = await revisionOf(s.visitId);
    const { checkId } = await inTx((tx) =>
      splitOffCheck(tx, v.cfg, s.tabId, [{ lineNo: water!.lineNo, quantity: "2" }], {
        expectedVisitRevision: revision,
        operatorId: ALEX,
      }),
    );
    const [checkWater] = await linesOfBill(checkId);

    await move(
      v,
      s.visitId,
      [
        { lineId: checkWater!.id, quantity: "1" },
        { lineId: steak!.id, quantity: "1" },
      ],
      "new",
    );

    const target = (await groupsOf(s.visitId)).groups[1]!.id;
    const lines = await linesOf(s.visitId);
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
    const [steak] = await linesIn(s.visitId, s.mains);

    await move(v, s.visitId, [{ lineId: steak!.id, quantity: "1" }], "new");

    const { groups } = await groupsOf(s.visitId);
    expect(groups).toHaveLength(6);
    expect(groups[5]).toMatchObject({ position: 6, state: "held", summary: "1 × Steak" });
    expect(groups[3]).toMatchObject({ id: s.mains, summary: "1 × Steak, 1 × Fish" });
  });

  it("removes a group a move empties: gone from the list, its events still readable", async () => {
    const v = await setupVenue();
    const s = await specExample(v);
    const fishOnly = (await submit(v, s.visitId, [{ release: "hold", lines: [line(v, "fish")] }]))
      .groups[0]!.id;
    const [fish] = await linesIn(s.visitId, fishOnly);

    await move(v, s.visitId, [{ lineId: fish!.id, quantity: "1" }], { groupId: s.desserts });

    const [row] = await db.select().from(orderGroups).where(eq(orderGroups.id, fishOnly));
    expect(row!.state).toBe("removed");
    expect((await groupsOf(s.visitId)).groups.map((group) => group.id)).not.toContain(fishOnly);
    const events = (await eventsOf(s.visitId)).filter((event) => event.groupId === fishOnly);
    expect(events.map((event) => event.kind)).toEqual(["submitted", "removed"]);
    expect((await linesIn(s.visitId, s.desserts)).map((line) => line.id)).toContain(fish!.id);
  });

  it("writes one event naming the operator, and moves the visit's revision on, for each change", async () => {
    const v = await setupVenue();
    const s = await specExample(v);
    const [steak] = await linesIn(s.visitId, s.mains);
    let fishGroup = "";
    const changes: [string, () => Promise<unknown>][] = [
      [
        "submitted",
        async () => {
          const result = await submit(
            v,
            s.visitId,
            [{ release: "hold", lines: [line(v, "fish")] }],
            { operatorId: MIA },
          );
          fishGroup = result.groups[0]!.id;
        },
      ],
      [
        "joined",
        () =>
          submit(v, s.visitId, [{ release: "hold", lines: [line(v, "flan")] }], {
            joinGroupId: s.desserts,
            operatorId: MIA,
          }),
      ],
      [
        "reordered",
        () => reorder(s.visitId, [fishGroup, s.warm, s.mains, s.desserts], { operatorId: MIA }),
      ],
      [
        "lines_moved",
        () =>
          move(
            v,
            s.visitId,
            [{ lineId: steak!.id, quantity: "1" }],
            { groupId: s.desserts },
            { operatorId: MIA },
          ),
      ],
      ["fired", () => fire(v, s.visitId, s.warm, { operatorId: MIA })],
    ];
    for (const [kind, change] of changes) {
      const revision = await revisionOf(s.visitId);
      const events = (await eventsOf(s.visitId)).length;
      await change();
      expect(await revisionOf(s.visitId)).toBe(revision + 1);
      const after = await eventsOf(s.visitId);
      expect(after).toHaveLength(events + 1);
      expect(after.at(-1)).toMatchObject({ kind, actorId: MIA });
    }
  });

  it("leaves a held group's line freely editable in place, in its group", async () => {
    const v = await setupVenue();
    const s = await specExample(v);
    const [steak] = await linesIn(s.visitId, s.mains);
    const [bill] = await db
      .select({ revision: workingOrders.revision })
      .from(workingOrders)
      .where(eq(workingOrders.id, s.tabId));

    await inTx((tx) =>
      updateOrderLine(tx, v.cfg, s.tabId, steak!.lineNo, { quantity: "3" }, bill!.revision),
    );

    const [edited] = await linesIn(s.visitId, s.mains);
    expect(edited).toMatchObject({ id: steak!.id, quantity: 3000, groupId: s.mains });
    expect(await printed(v)).toHaveLength(2);
  });
});

describe("firing", () => {
  it("fires the warm starters: sent, fired, printed at fire, and a fired event", async () => {
    const v = await setupVenue();
    const s = await specExample(v);
    const [warm] = await linesIn(s.visitId, s.warm);
    const jobsBefore = (await printed(v)).length;

    const result = await fire(v, s.visitId, s.warm, { operatorId: MIA });

    expect(result).toEqual({ revision: await revisionOf(s.visitId) });
    const [after] = await linesIn(s.visitId, s.warm);
    expect(after!.sentAt).not.toBeNull();
    expect(await firedTicketLineIds(s.visitId)).toContain(warm!.id);
    const jobs = await printed(v);
    expect(jobs).toHaveLength(jobsBefore + 1);
    expect(jobs.at(-1)).toContain(DISHES.warm.kitchen);
    const [group] = await db.select().from(orderGroups).where(eq(orderGroups.id, s.warm));
    expect(group).toMatchObject({ state: "fired", firedBy: MIA, firedAt: expect.any(String) });
    expect((await eventsOf(s.visitId)).at(-1)).toMatchObject({
      groupId: s.warm,
      kind: "fired",
      actorId: MIA,
    });
  });

  it("refuses to fire a fired group again under a new submission (group.not_held)", async () => {
    const v = await setupVenue();
    const s = await specExample(v);
    await fire(v, s.visitId, s.warm);
    await expectRefusedWithNothingWritten(v, s.visitId, () => fire(v, s.visitId, s.warm), {
      code: "group.not_held",
      params: { groupId: s.warm },
    });
  });

  it("refuses a group the visit does not have (group.not_found)", async () => {
    const v = await setupVenue();
    const s = await specExample(v);
    const missing = randomUUID();
    await expectRefusedWithNothingWritten(v, s.visitId, () => fire(v, s.visitId, missing), {
      code: "group.not_found",
      params: { groupId: missing },
    });
  });

  it("stamps a held no-route line sent only when its group fires", async () => {
    const v = await setupVenue();
    const s = await seated(v);
    const { groups } = await submit(v, s.visitId, [
      { release: "hold", lines: [line(v, "water"), line(v, "flan")] },
    ]);
    const groupId = groups[0]!.id;
    expect((await linesIn(s.visitId, groupId)).map((row) => row.sentAt)).toEqual([null, null]);

    await fire(v, s.visitId, groupId);

    const lines = await linesIn(s.visitId, groupId);
    expect(lines.map((row) => row.sentAt)).toEqual([expect.any(String), expect.any(String)]);
  });

  it("refuses a group holding a sold-out Steak, firing none of it, then fires once it is removed", async () => {
    const v = await setupVenue();
    const s = await specExample(v);
    await db.run(sql`update products set available = 0 where id = ${v.productId.steak}`);

    await expectRefusedWithNothingWritten(v, s.visitId, () => fire(v, s.visitId, s.mains), {
      code: "product.unavailable",
      params: { productId: v.productId.steak },
    });

    const [steak, fish] = await linesIn(s.visitId, s.mains);
    await inTx((tx) => voidTabLine(tx, v.cfg, s.tabId, steak!.lineNo));
    await fire(v, s.visitId, s.mains);
    expect(await firedTicketLineIds(s.visitId)).toContain(fish!.id);
  });

  it("fires nothing and prints nothing when the sold-out line is on the second of two bills", async () => {
    const v = await setupVenue();
    const s = await seated(v);
    const { groups } = await submit(v, s.visitId, [
      { release: "hold", lines: [line(v, "steak"), line(v, "water")] },
    ]);
    const groupId = groups[0]!.id;
    const [, water] = await linesIn(s.visitId, groupId);
    const revision = await revisionOf(s.visitId);
    // The check is opened after the tab, so its line is released second.
    await inTx((tx) =>
      splitOffCheck(tx, v.cfg, s.tabId, [{ lineNo: water!.lineNo }], {
        expectedVisitRevision: revision,
        operatorId: ALEX,
      }),
    );
    await db.run(sql`update products set available = 0 where id = ${v.productId.water}`);

    await expectRefusedWithNothingWritten(v, s.visitId, () => fire(v, s.visitId, groupId), {
      code: "product.unavailable",
      params: { productId: v.productId.water },
    });
    expect(await firedTicketLineIds(s.visitId)).toEqual([]);
    expect(await printed(v)).toEqual([]);
  });
});

describe("retries (D8): each writes nothing the second time", () => {
  it("answers a repeated submission with the same groups, even carrying the now-stale revision", async () => {
    const v = await setupVenue();
    const s = await seated(v);
    const submissionId = randomUUID();
    const revision = await revisionOf(s.visitId);
    const groups = [{ release: "fire" as const, lines: [line(v, "steak")] }];

    const first = await submit(v, s.visitId, groups, { submissionId, revision });
    const before = await snapshot(v, s.visitId);
    const second = await submit(v, s.visitId, groups, { submissionId, revision });

    expect(second).toEqual(first);
    expect(await snapshot(v, s.visitId)).toEqual(before);
  });

  it("adds a joined Steak once when the join is repeated", async () => {
    const v = await setupVenue();
    const s = await specExample(v);
    const submissionId = randomUUID();
    const revision = await revisionOf(s.visitId);
    const join = () =>
      submit(v, s.visitId, [{ release: "hold", lines: [line(v, "steak")] }], {
        joinGroupId: s.mains,
        submissionId,
        revision,
      });

    await join();
    const before = await snapshot(v, s.visitId);
    await join();

    expect(await snapshot(v, s.visitId)).toEqual(before);
    expect(await linesIn(s.visitId, s.mains)).toHaveLength(3);
  });

  it("prints a fired group once when the fire is repeated", async () => {
    const v = await setupVenue();
    const s = await specExample(v);
    const opts = { submissionId: randomUUID(), revision: await revisionOf(s.visitId) };

    const first = await fire(v, s.visitId, s.warm, opts);
    const before = await snapshot(v, s.visitId);
    const second = await fire(v, s.visitId, s.warm, opts);

    expect(second).toEqual(first);
    expect(await snapshot(v, s.visitId)).toEqual(before);
  });

  it("moves once when a move is repeated", async () => {
    const v = await setupVenue();
    const s = await specExample(v);
    const [steak] = await linesIn(s.visitId, s.mains);
    const opts = { submissionId: randomUUID(), revision: await revisionOf(s.visitId) };
    const moves = [{ lineId: steak!.id, quantity: "1" }];

    await move(v, s.visitId, moves, { groupId: s.desserts }, opts);
    const before = await snapshot(v, s.visitId);
    await move(v, s.visitId, moves, { groupId: s.desserts }, opts);

    expect(await snapshot(v, s.visitId)).toEqual(before);
  });
});

describe("an id reused for a different request (D8) is submission.id_reused", () => {
  it("refuses the same id with the Steak's quantity changed", async () => {
    const v = await setupVenue();
    const s = await seated(v);
    const submissionId = randomUUID();
    await submit(v, s.visitId, [{ release: "fire", lines: [line(v, "steak", "1")] }], {
      submissionId,
    });
    await expectRefusedWithNothingWritten(
      v,
      s.visitId,
      () =>
        submit(v, s.visitId, [{ release: "fire", lines: [line(v, "steak", "2")] }], {
          submissionId,
        }),
      { code: "submission.id_reused", params: { submissionId } },
    );
  });

  it("refuses the same id on a move naming another target group", async () => {
    const v = await setupVenue();
    const s = await specExample(v);
    const [steak] = await linesIn(s.visitId, s.mains);
    const submissionId = randomUUID();
    const moves = [{ lineId: steak!.id, quantity: "1" }];
    await move(v, s.visitId, moves, { groupId: s.desserts }, { submissionId });
    await expectRefusedWithNothingWritten(
      v,
      s.visitId,
      () => move(v, s.visitId, moves, { groupId: s.warm }, { submissionId }),
      { code: "submission.id_reused", params: { submissionId } },
    );
  });

  it("refuses an id first used by a submission, then sent with a fire", async () => {
    const v = await setupVenue();
    const s = await specExample(v);
    const submissionId = randomUUID();
    await submit(v, s.visitId, [{ release: "hold", lines: [line(v, "fish")] }], { submissionId });
    await expectRefusedWithNothingWritten(
      v,
      s.visitId,
      () => fire(v, s.visitId, s.warm, { submissionId }),
      { code: "submission.id_reused", params: { submissionId } },
    );
  });

  it("refuses an id that fired the mains, sent again to fire the desserts", async () => {
    const v = await setupVenue();
    const s = await specExample(v);
    const submissionId = randomUUID();
    await fire(v, s.visitId, s.mains, { submissionId });
    await expectRefusedWithNothingWritten(
      v,
      s.visitId,
      () => fire(v, s.visitId, s.desserts, { submissionId }),
      { code: "submission.id_reused", params: { submissionId } },
    );
  });
});

describe("stale screens (D19)", () => {
  it("fires a group whose lines sit on two bills of the visit: every line, on both bills", async () => {
    const v = await setupVenue();
    const s = await seated(v);
    const { groups } = await submit(v, s.visitId, [
      { release: "hold", lines: [line(v, "water", "2"), line(v, "steak")] },
    ]);
    const groupId = groups[0]!.id;
    const [water] = await linesIn(s.visitId, groupId);
    // A held line with no ticket may go onto a check (the kept `tab.split_held_line` refuses only
    // a held line the kitchen has a ticket for).
    const revision = await revisionOf(s.visitId);
    const { checkId } = await inTx((tx) =>
      splitOffCheck(tx, v.cfg, s.tabId, [{ lineNo: water!.lineNo, quantity: "1" }], {
        expectedVisitRevision: revision,
        operatorId: ALEX,
      }),
    );
    const billRevisions = async () =>
      db
        .select({ id: workingOrders.id, revision: workingOrders.revision })
        .from(workingOrders)
        .where(inArray(workingOrders.id, [s.tabId, checkId]))
        .orderBy(workingOrders.id);
    const before = await billRevisions();

    await fire(v, s.visitId, groupId);

    const lines = await linesIn(s.visitId, groupId);
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
    const seenByA = await revisionOf(s.visitId);
    const [steak] = await linesIn(s.visitId, s.mains);
    await move(v, s.visitId, [{ lineId: steak!.id, quantity: "2" }], { groupId: s.warm });

    await expectRefusedWithNothingWritten(
      v,
      s.visitId,
      () => fire(v, s.visitId, s.warm, { revision: seenByA }),
      { code: "visit.out_of_date", params: { visitId: s.visitId, revision: seenByA + 1 } },
    );

    await fire(v, s.visitId, s.warm);
    expect(await firedTicketLineIds(s.visitId)).toContain(steak!.id);
  });

  it("refuses a reorder and a move sent with a revision another device has moved on", async () => {
    const v = await setupVenue();
    const s = await specExample(v);
    const stale = await revisionOf(s.visitId);
    await reorder(s.visitId, [s.warm, s.desserts, s.mains]);
    const [steak] = await linesIn(s.visitId, s.mains);

    await expectRefusedWithNothingWritten(
      v,
      s.visitId,
      () => reorder(s.visitId, [s.mains, s.desserts, s.warm], { revision: stale }),
      { code: "visit.out_of_date" },
    );
    await expectRefusedWithNothingWritten(
      v,
      s.visitId,
      () =>
        move(
          v,
          s.visitId,
          [{ lineId: steak!.id, quantity: "1" }],
          { groupId: s.warm },
          {
            revision: stale,
          },
        ),
      { code: "visit.out_of_date" },
    );
  });
});

describe("two orders of events", () => {
  it("fire the mains, then move a Steak into them: group.not_held, and the Steak stays", async () => {
    const v = await setupVenue();
    const s = await specExample(v);
    const steakGroup = (
      await submit(v, s.visitId, [{ release: "hold", lines: [line(v, "steak")] }])
    ).groups[0]!.id;
    const [steak] = await linesIn(s.visitId, steakGroup);
    await fire(v, s.visitId, s.mains);

    await expectRefusedWithNothingWritten(
      v,
      s.visitId,
      () => move(v, s.visitId, [{ lineId: steak!.id, quantity: "1" }], { groupId: s.mains }),
      { code: "group.not_held", params: { groupId: s.mains } },
    );
    expect((await linesIn(s.visitId, steakGroup)).map((row) => row.id)).toEqual([steak!.id]);
  });

  it("move a Steak into the mains, then fire them: the Steak fires with them", async () => {
    const v = await setupVenue();
    const s = await specExample(v);
    const steakGroup = (
      await submit(v, s.visitId, [{ release: "hold", lines: [line(v, "steak")] }])
    ).groups[0]!.id;
    const [steak] = await linesIn(s.visitId, steakGroup);

    await move(v, s.visitId, [{ lineId: steak!.id, quantity: "1" }], { groupId: s.mains });
    await fire(v, s.visitId, s.mains);

    expect((await linesIn(s.visitId, s.mains)).map((row) => row.id)).toContain(steak!.id);
    expect(await firedTicketLineIds(s.visitId)).toContain(steak!.id);
  });

  it("refuses to move a line OUT of a fired group (group.not_held)", async () => {
    const v = await setupVenue();
    const s = await specExample(v);
    const [beer] = await linesIn(s.visitId, s.drinks);
    await expectRefusedWithNothingWritten(
      v,
      s.visitId,
      () => move(v, s.visitId, [{ lineId: beer!.id, quantity: "1" }], { groupId: s.mains }),
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
      s.visitId,
      () => submit(v, s.visitId, [{ release: "hold", lines: [line(v, "fish")] }]),
      { code: "order.payment_in_flight", params: { workingOrderId: s.tabId } },
    );
  });

  it("refuses to fire a group (order.payment_in_flight), writing nothing", async () => {
    const v = await setupVenue();
    const s = await specExample(v);
    await paying(s.tabId);
    await expectRefusedWithNothingWritten(v, s.visitId, () => fire(v, s.visitId, s.warm), {
      code: "order.payment_in_flight",
      params: { workingOrderId: s.tabId },
    });
  });

  it("refuses a move into a held group (order.payment_in_flight), writing nothing", async () => {
    const v = await setupVenue();
    const s = await specExample(v);
    const [steak] = await linesIn(s.visitId, s.mains);
    await paying(s.tabId);
    await expectRefusedWithNothingWritten(
      v,
      s.visitId,
      () => move(v, s.visitId, [{ lineId: steak!.id, quantity: "1" }], { groupId: s.desserts }),
      { code: "order.payment_in_flight", params: { workingOrderId: s.tabId } },
    );
  });

  it("refuses a reorder of the held groups (order.payment_in_flight), writing nothing", async () => {
    const v = await setupVenue();
    const s = await specExample(v);
    await paying(s.tabId);
    const revision = await revisionOf(s.visitId);
    const before = (await groupsOf(s.visitId)).groups.map(({ id, position }) => ({ id, position }));
    const events = await eventsOf(s.visitId);
    await expectRefusedWithNothingWritten(
      v,
      s.visitId,
      () => reorder(s.visitId, [s.desserts, s.mains, s.warm]),
      { code: "order.payment_in_flight", params: { workingOrderId: s.tabId } },
    );
    expect(await revisionOf(s.visitId)).toBe(revision);
    expect(
      (await groupsOf(s.visitId)).groups.map(({ id, position }) => ({ id, position })),
    ).toEqual(before);
    expect(await eventsOf(s.visitId)).toEqual(events);
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
      .where(and(eq(orderGroups.visitId, s.visitId), isNotNull(orderGroups.firedAt)))
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
      s.visitId,
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
      s.visitId,
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
    const { groups } = await submit(v, s.visitId, [
      { release: "hold", lines: [steakWithSauce(v)] },
    ]);
    const lines = await allLinesOf(s.tabId);
    const dish = lines.find((row) => row.groupId === groups[0]!.id && row.parentLineId === null)!;

    await move(v, s.visitId, [{ lineId: dish.id, quantity: "1" }], { groupId: s.mains });

    const moved = (await allLinesOf(s.tabId)).filter(
      (row) => row.id === dish.id || row.parentLineId === dish.id,
    );
    expect(moved.map((row) => row.groupId)).toEqual([s.mains, s.mains]);
  });

  it("refuses to move part of a dish that has extras (tab.transfer_modifier_line), writing nothing", async () => {
    const v = await setupVenue();
    const s = await seated(v);
    await submit(v, s.visitId, [
      { release: "hold", lines: [{ ...steakWithSauce(v), quantity: "2" }] },
    ]);
    const target = (await submit(v, s.visitId, [{ release: "hold", lines: [line(v, "flan")] }]))
      .groups[0]!.id;
    const dish = (await allLinesOf(s.tabId)).find(
      (row) => row.parentLineId === null && row.groupId !== target,
    )!;

    await expectRefusedWithNothingWritten(
      v,
      s.visitId,
      () => move(v, s.visitId, [{ lineId: dish.id, quantity: "1" }], { groupId: target }),
      { code: "tab.transfer_modifier_line" },
    );
  });

  it("refuses to move an extras line on its own (group.not_found), writing nothing", async () => {
    const v = await setupVenue();
    const s = await seated(v);
    await submit(v, s.visitId, [{ release: "hold", lines: [steakWithSauce(v)] }]);
    const target = (await submit(v, s.visitId, [{ release: "hold", lines: [line(v, "flan")] }]))
      .groups[0]!.id;
    const sauce = (await allLinesOf(s.tabId)).find((row) => row.parentLineId !== null)!;

    await expectRefusedWithNothingWritten(
      v,
      s.visitId,
      () => move(v, s.visitId, [{ lineId: sauce.id, quantity: "1" }], { groupId: target }),
      { code: "group.not_found", params: { lineId: sauce.id } },
    );
  });
});

describe("malformed commands are refused, writing nothing", () => {
  it("refuses a submission with no groups", async () => {
    const v = await setupVenue();
    const s = await seated(v);
    await expectRefusedWithNothingWritten(v, s.visitId, () => submit(v, s.visitId, []), {
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
      await expectRefusedWithNothingWritten(v, s.visitId, () => submit(v, s.visitId, groups), {
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
        s.visitId,
        () => submit(v, s.visitId, groups, { joinGroupId: s.mains }),
        { code: "management.request_invalid", params: { field: "joinGroupId" } },
      );
    }
  });

  it("refuses a join to a removed group as not found", async () => {
    const v = await setupVenue();
    const s = await specExample(v);
    const fishOnly = (await submit(v, s.visitId, [{ release: "hold", lines: [line(v, "fish")] }]))
      .groups[0]!.id;
    const [fish] = await linesIn(s.visitId, fishOnly);
    await move(v, s.visitId, [{ lineId: fish!.id, quantity: "1" }], { groupId: s.mains });

    await expectRefusedWithNothingWritten(
      v,
      s.visitId,
      () =>
        submit(v, s.visitId, [{ release: "hold", lines: [line(v, "fish")] }], {
          joinGroupId: fishOnly,
        }),
      { code: "group.not_found", params: { groupId: fishOnly } },
    );
  });

  it("refuses a reorder naming a group the visit does not have", async () => {
    const v = await setupVenue();
    const s = await specExample(v);
    const missing = randomUUID();
    await expectRefusedWithNothingWritten(
      v,
      s.visitId,
      () => reorder(s.visitId, [s.warm, s.mains, s.desserts, missing]),
      { code: "group.not_found", params: { groupId: missing } },
    );
  });

  it("refuses a move with no lines, or naming one line twice", async () => {
    const v = await setupVenue();
    const s = await specExample(v);
    const [steak] = await linesIn(s.visitId, s.mains);
    const twice = [
      { lineId: steak!.id, quantity: "1" },
      { lineId: steak!.id, quantity: "1" },
    ];
    for (const moves of [[], twice]) {
      await expectRefusedWithNothingWritten(
        v,
        s.visitId,
        () => move(v, s.visitId, moves, { groupId: s.desserts }),
        { code: "management.request_invalid", params: { field: "moves" } },
      );
    }
  });

  it("refuses a move of a line no group of the visit holds", async () => {
    const v = await setupVenue();
    const s = await specExample(v);
    const other = await specExample(v);
    const [steak] = await linesIn(other.visitId, other.mains);
    await expectRefusedWithNothingWritten(
      v,
      s.visitId,
      () => move(v, s.visitId, [{ lineId: steak!.id, quantity: "1" }], { groupId: s.desserts }),
      { code: "group.not_found", params: { lineId: steak!.id } },
    );
  });

  it("refuses a move of a malformed or too large quantity", async () => {
    const v = await setupVenue();
    const s = await specExample(v);
    const [steak] = await linesIn(s.visitId, s.mains);
    for (const quantity of ["abc", "3"]) {
      await expectRefusedWithNothingWritten(
        v,
        s.visitId,
        () => move(v, s.visitId, [{ lineId: steak!.id, quantity }], { groupId: s.desserts }),
        { code: "tab.transfer_quantity_invalid" },
      );
    }
  });

  it("refuses a submission when the visit's tables point at no tab", async () => {
    const v = await setupVenue();
    const s = await seated(v);
    await db.run(sql`update dining_tables set tab_id = null where tab_id = ${s.tabId}`);
    await expectRefusedWithNothingWritten(
      v,
      s.visitId,
      () => submit(v, s.visitId, [{ release: "fire", lines: [line(v, "beer")] }]),
      { code: "visit.not_open", params: { visitId: s.visitId } },
    );
  });

  it("lists no groups of a visit that does not exist", async () => {
    const missing = randomUUID();
    await expect(groupsOf(missing)).rejects.toMatchObject({
      code: "visit.not_open",
      params: { visitId: missing },
    });
  });
});

describe("a group's summary", () => {
  it("names a variant after its dish, adds equal dishes together and writes part quantities plainly", async () => {
    const v = await setupVenue();
    const s = await seated(v);
    const { groups } = await submit(v, s.visitId, [
      { release: "hold", lines: [line(v, "steak"), line(v, "fish", "2"), line(v, "fish", "10")] },
    ]);
    const [steak, fish] = await linesIn(s.visitId, groups[0]!.id);
    await db
      .update(workingOrderLines)
      .set({ variantName: "Rare" })
      .where(eq(workingOrderLines.id, steak!.id));
    await db
      .update(workingOrderLines)
      .set({ quantity: 1500 })
      .where(eq(workingOrderLines.id, fish!.id));

    expect((await groupsOf(s.visitId)).groups[0]!.summary).toBe("1 × Steak Rare, 11.5 × Fish");
  });
});

describe("a held line on a paid bill", () => {
  it("is not moved, whole or in part (working_order.not_open), writing nothing", async () => {
    const v = await setupVenue();
    const s = await specExample(v);
    const [steak] = await linesIn(s.visitId, s.mains);
    await db
      .update(workingOrders)
      .set({ status: "settled", settledAt: new Date().toISOString() })
      .where(eq(workingOrders.id, s.tabId));

    for (const quantity of ["2", "1"]) {
      await expectRefusedWithNothingWritten(
        v,
        s.visitId,
        () => move(v, s.visitId, [{ lineId: steak!.id, quantity }], { groupId: s.desserts }),
        { code: "working_order.not_open", params: { workingOrderId: s.tabId } },
      );
    }
  });
});

/** The VisitCommand a tab path is sent, at both visits' current revisions. */
async function tabCommand(visitId: string, sourceVisitId?: string) {
  return {
    expectedVisitRevision: await revisionOf(visitId),
    ...(sourceVisitId === undefined || sourceVisitId === visitId
      ? {}
      : { expectedSourceVisitRevision: await revisionOf(sourceVisitId) }),
    operatorId: ALEX,
  };
}

async function transfer(
  v: Venue,
  from: Seated,
  to: { visitId: string; tabId: string },
  transfers: { lineNo: number; quantity?: string }[],
) {
  const command = await tabCommand(to.visitId, from.visitId);
  return inTx((tx) => transferLines(tx, v.cfg, from.tabId, to.tabId, transfers, command));
}

/** A second table seated at the visit's own tab, so the tab can give one of them back. */
async function joined(v: Venue, s: Seated): Promise<string> {
  return inTx(async (tx) => {
    const { id: tableId } = await createTable(tx, v.cfg, {
      label: `J-${randomUUID().slice(0, 6)}`,
      zoneId: v.zoneId,
    });
    await joinTable(tx, v.cfg, s.tabId, tableId, {
      expectedVisitRevision: await revisionOf(s.visitId),
      operatorId: ALEX,
    });
    return tableId;
  });
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

describe("a line leaving its visit", () => {
  it.each([
    ["whole", undefined],
    ["part", "1"],
  ] as const)(
    "refuses to transfer a held-group line (%s) to another party's tab (group.held_leaves_visit), writing nothing",
    async (_, quantity) => {
      const v = await setupVenue();
      const s = await specExample(v);
      const other = await seated(v);
      const [steak] = await linesIn(s.visitId, s.mains);
      const before = [await snapshot(v, s.visitId), await snapshot(v, other.visitId)];

      await expect(
        transfer(v, s, other, [{ lineNo: steak!.lineNo, quantity }]),
      ).rejects.toMatchObject({
        code: "group.held_leaves_visit",
        params: { tabId: s.tabId, lineNo: steak!.lineNo },
      });

      expect([await snapshot(v, s.visitId), await snapshot(v, other.visitId)]).toEqual(before);
    },
  );

  it.each([
    ["whole", undefined],
    ["part", "1"],
  ] as const)(
    "moves a fired-group line (%s) to another party's tab with no group, and prints the MOVED slip",
    async (_, quantity) => {
      const v = await setupVenue();
      const s = await seated(v);
      const { groups } = await submit(v, s.visitId, [
        { release: "fire", lines: [line(v, "steak", "2")] },
      ]);
      const other = await seated(v);
      const [steak] = await linesIn(s.visitId, groups[0]!.id);
      const revisions = [await revisionOf(s.visitId), await revisionOf(other.visitId)];
      const jobsBefore = (await printed(v)).length;

      await transfer(v, s, other, [{ lineNo: steak!.lineNo, quantity: quantity ?? undefined }]);

      const landed = await linesOfBill(other.tabId);
      expect(landed).toHaveLength(1);
      expect(landed[0]).toMatchObject({
        groupId: null,
        creditedTo: ALEX,
        quantity: quantity === undefined ? 2000 : 1000,
      });
      if (quantity !== undefined) {
        // The part left behind stays in its group.
        expect((await linesOfBill(s.tabId))[0]).toMatchObject({
          groupId: groups[0]!.id,
          quantity: 1000,
        });
      }
      const jobs = await printed(v);
      expect(jobs).toHaveLength(jobsBefore + 1);
      expect(jobs.at(-1)).toContain("MOVED");
      expect(jobs.at(-1)).toContain(DISHES.steak.kitchen);
      expect([await revisionOf(s.visitId), await revisionOf(other.visitId)]).toEqual(
        revisions.map((revision) => revision + 1),
      );
    },
  );

  it("clears the group of a moved dish's extras lines too", async () => {
    const v = await setupVenue();
    const s = await seated(v);
    await submit(v, s.visitId, [
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
    const other = await seated(v);

    await transfer(v, s, other, [{ lineNo: 1 }]);

    const landed = await linesOfBill(other.tabId);
    expect(landed).toHaveLength(2);
    expect(landed.map((row) => row.groupId)).toEqual([null, null]);
  });

  it.each([
    ["whole", undefined],
    ["part", "1"],
  ] as const)(
    "keeps the group of a held line (%s) transferred to another tab of the same visit",
    async (_, quantity) => {
      const v = await setupVenue();
      const s = await specExample(v);
      // A second tab of the same visit, anchored to a table of its own.
      const secondTab = randomUUID();
      await inTx(async (tx) => {
        const { id: tableId } = await createTable(tx, v.cfg, {
          label: `S-${randomUUID().slice(0, 6)}`,
          zoneId: v.zoneId,
        });
        await createOpenOrder(tx, v.cfg, secondTab, [], null, { visitId: s.visitId });
        await VENUE_SERVICE.copyOrderContext(tx, v.cfg, s.tabId, secondTab);
        await tx.update(diningTables).set({ tabId: secondTab }).where(eq(diningTables.id, tableId));
      });
      const [steak] = await linesIn(s.visitId, s.mains);
      const revision = await revisionOf(s.visitId);

      await transfer(v, s, { visitId: s.visitId, tabId: secondTab }, [
        { lineNo: steak!.lineNo, quantity },
      ]);

      expect(await linesOfBill(secondTab)).toMatchObject([{ groupId: s.mains }]);
      expect(await revisionOf(s.visitId)).toBe(revision + 1);
    },
  );

  it("refuses to take a held-group line to the table's own new bill on an unjoin (group.held_leaves_visit), writing nothing", async () => {
    const v = await setupVenue();
    const s = await specExample(v);
    const tableId = await joined(v, s);
    const [steak] = await linesIn(s.visitId, s.mains);
    const before = await snapshot(v, s.visitId);
    const visitCount = async () => (await db.select({ id: visits.id }).from(visits)).length;
    const visitsBefore = await visitCount();
    const command = await tabCommand(s.visitId);

    await expect(
      inTx((tx) =>
        unjoinTable(
          tx,
          v.cfg,
          s.tabId,
          tableId,
          [{ lineNo: steak!.lineNo, quantity: "1" }],
          command,
        ),
      ),
    ).rejects.toMatchObject({
      code: "group.held_leaves_visit",
      params: { tabId: s.tabId, lineNo: steak!.lineNo },
    });

    expect(await snapshot(v, s.visitId)).toEqual(before);
    expect(await visitCount()).toBe(visitsBefore);
  });

  it("takes a fired-group line to the table's own new bill on an unjoin with no group, and prints the MOVED slip", async () => {
    const v = await setupVenue();
    const s = await specExample(v);
    const tableId = await joined(v, s);
    const [croquettes] = await linesIn(s.visitId, s.cold);
    const jobsBefore = (await printed(v)).length;
    const command = await tabCommand(s.visitId);

    const { tabId } = await inTx((tx) =>
      unjoinTable(tx, v.cfg, s.tabId, tableId, [{ lineNo: croquettes!.lineNo }], command),
    );

    expect(await linesOfBill(tabId!)).toMatchObject([{ id: croquettes!.id, groupId: null }]);
    expect((await groupsOf(s.visitId)).groups.find((g) => g.id === s.cold)!.lineIds).toEqual([]);
    const jobs = await printed(v);
    expect(jobs).toHaveLength(jobsBefore + 1);
    expect(jobs.at(-1)).toContain("MOVED");
    expect(jobs.at(-1)).toContain(DISHES.cold.kitchen);
  });
});

describe("merging two bills (D2)", () => {
  it("appends the source visit's groups after the target's, in their own order", async () => {
    const v = await setupVenue();
    const into = await seated(v);
    const target = await submit(v, into.visitId, [
      { release: "fire", lines: [line(v, "beer")] },
      { release: "hold", lines: [line(v, "flan")] },
    ]);
    const from = await specExample(v);
    // The source's held groups no longer sit in the order they were made.
    await reorder(from.visitId, [from.desserts, from.warm, from.mains]);
    const command = await tabCommand(into.visitId, from.visitId);

    await inTx((tx) =>
      mergeTabs(tx, v.cfg, into.tabId, from.tabId, { freeSourceTable: false, ...command }),
    );

    const { groups } = await groupsOf(into.visitId);
    expect(groups.map((group) => [group.id, group.position, group.state])).toEqual([
      [target.groups[0]!.id, 1, "fired"],
      [target.groups[1]!.id, 2, "held"],
      [from.drinks, 3, "fired"],
      [from.cold, 4, "fired"],
      [from.desserts, 5, "held"],
      [from.warm, 6, "held"],
      [from.mains, 7, "held"],
    ]);
    expect((await groupsOf(from.visitId)).groups).toEqual([]);
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

    await fire(v, into.visitId, from.mains);
    expect((await groupsOf(into.visitId)).groups.find((g) => g.id === from.mains)!.state).toBe(
      "fired",
    );
  });

  it("leaves the groups as they are when a check goes back onto its tab in the same visit", async () => {
    const v = await setupVenue();
    const s = await specExample(v);
    const [croquettes] = await linesIn(s.visitId, s.cold);
    const { checkId } = await inTx(async (tx) =>
      splitOffCheck(tx, v.cfg, s.tabId, [{ lineNo: croquettes!.lineNo, quantity: "1" }], {
        expectedVisitRevision: await revisionOf(s.visitId),
        operatorId: ALEX,
      }),
    );
    const groupsBefore = await db
      .select()
      .from(orderGroups)
      .where(eq(orderGroups.visitId, s.visitId))
      .orderBy(orderGroups.id);
    const command = await tabCommand(s.visitId);

    await inTx((tx) =>
      mergeTabs(tx, v.cfg, s.tabId, checkId, { freeSourceTable: false, ...command }),
    );

    expect(
      await db
        .select()
        .from(orderGroups)
        .where(eq(orderGroups.visitId, s.visitId))
        .orderBy(orderGroups.id),
    ).toEqual(groupsBefore);
    expect((await linesIn(s.visitId, s.cold)).map((row) => row.workingOrderId)).toEqual([
      s.tabId,
      s.tabId,
    ]);
  });
});

describe("merging a party's tab into a bill of no visit", () => {
  async function noVisitTab(v: Venue): Promise<string> {
    return inTx(async (tx) => {
      const { id: tableId } = await createTable(tx, v.cfg, {
        label: `N-${randomUUID().slice(0, 6)}`,
        zoneId: v.zoneId,
      });
      return (await openTab(tx, v.cfg, { tableId })).tabId;
    });
  }

  it("refuses when the party's tab holds a held-group line (group.held_leaves_visit), writing nothing", async () => {
    const v = await setupVenue();
    const s = await specExample(v);
    const into = await noVisitTab(v);
    const [warm] = await linesIn(s.visitId, s.warm);
    const before = [await snapshot(v, s.visitId), await linesOfBill(into)];
    const command = { expectedSourceVisitRevision: await revisionOf(s.visitId), operatorId: ALEX };

    await expect(
      inTx((tx) => mergeTabs(tx, v.cfg, into, s.tabId, { freeSourceTable: true, ...command })),
    ).rejects.toMatchObject({
      code: "group.held_leaves_visit",
      params: { tabId: s.tabId, lineNo: warm!.lineNo },
    });

    expect([await snapshot(v, s.visitId), await linesOfBill(into)]).toEqual(before);
  });

  it("moves fired-group lines with no group, their extras included", async () => {
    const v = await setupVenue();
    const s = await seated(v);
    await submit(v, s.visitId, [
      {
        release: "fire",
        lines: [
          {
            ...line(v, "steak"),
            extras: [
              { listId: v.extrasListId, picks: [{ productId: v.productId.sauce, quantity: 1 }] },
            ],
          },
          line(v, "beer"),
        ],
      },
    ]);
    const into = await noVisitTab(v);
    const command = { expectedSourceVisitRevision: await revisionOf(s.visitId), operatorId: ALEX };

    await inTx((tx) => mergeTabs(tx, v.cfg, into, s.tabId, { freeSourceTable: true, ...command }));

    const landed = await linesOfBill(into);
    expect(landed).toHaveLength(3);
    expect(landed.map((row) => row.groupId)).toEqual([null, null, null]);
  });
});

describe("a group split across bills of its visit", () => {
  /** A held group of a no-route Water ×2 and a Steak, with one Water on a check. */
  async function splitNoRoute(v: Venue) {
    const s = await seated(v);
    const { groups } = await submit(v, s.visitId, [
      { release: "hold", lines: [line(v, "water", "2"), line(v, "steak")] },
    ]);
    const groupId = groups[0]!.id;
    const [water] = await linesIn(s.visitId, groupId);
    const revision = await revisionOf(s.visitId);
    const { checkId } = await inTx((tx) =>
      splitOffCheck(tx, v.cfg, s.tabId, [{ lineNo: water!.lineNo, quantity: "1" }], {
        expectedVisitRevision: revision,
        operatorId: ALEX,
      }),
    );
    return { ...s, groupId, checkId, revisionBeforeSplit: revision };
  }

  it("keeps the group and credit of a held no-route line split onto a check, and moves the visit's revision on", async () => {
    const v = await setupVenue();
    const s = await splitNoRoute(v);

    expect(await linesOfBill(s.checkId)).toMatchObject([
      { groupId: s.groupId, creditedTo: ALEX, quantity: 1000, sentAt: null },
    ]);
    expect(await revisionOf(s.visitId)).toBe(s.revisionBeforeSplit + 1);
  });

  it("refuses device A's fire after device B split the group's line onto a check, then fires every line", async () => {
    const v = await setupVenue();
    const s = await seated(v);
    const { groups } = await submit(v, s.visitId, [
      { release: "hold", lines: [line(v, "water", "2"), line(v, "steak")] },
    ]);
    const groupId = groups[0]!.id;
    const seenByA = await revisionOf(s.visitId);
    const [water] = await linesIn(s.visitId, groupId);
    const { checkId } = await inTx((tx) =>
      splitOffCheck(tx, v.cfg, s.tabId, [{ lineNo: water!.lineNo, quantity: "1" }], {
        expectedVisitRevision: seenByA,
        operatorId: MIA,
      }),
    );

    await expectRefusedWithNothingWritten(
      v,
      s.visitId,
      () => fire(v, s.visitId, groupId, { revision: seenByA }),
      { code: "visit.out_of_date", params: { visitId: s.visitId, revision: seenByA + 1 } },
    );

    await fire(v, s.visitId, groupId);
    const lines = await linesIn(s.visitId, groupId);
    expect(lines.map((row) => row.workingOrderId).sort()).toEqual(
      [s.tabId, s.tabId, checkId].sort(),
    );
    expect(lines.every((row) => row.sentAt !== null)).toBe(true);
  });

  it("keeps the group and credit of a fired-group line split onto a check", async () => {
    const v = await setupVenue();
    const s = await specExample(v);
    const [croquettes] = await linesIn(s.visitId, s.cold);
    const revision = await revisionOf(s.visitId);

    const { checkId } = await inTx((tx) =>
      splitOffCheck(tx, v.cfg, s.tabId, [{ lineNo: croquettes!.lineNo, quantity: "1" }], {
        expectedVisitRevision: revision,
        operatorId: MIA,
      }),
    );

    expect(await linesOfBill(checkId)).toMatchObject([
      { groupId: s.cold, creditedTo: ALEX, quantity: 1000 },
    ]);
    expect(await revisionOf(s.visitId)).toBe(revision + 1);
  });

  it("still refuses a routed held-group line onto a check (tab.split_held_line), writing nothing", async () => {
    const v = await setupVenue();
    const s = await specExample(v);
    const [steak] = await linesIn(s.visitId, s.mains);
    const revision = await revisionOf(s.visitId);

    await expectRefusedWithNothingWritten(
      v,
      s.visitId,
      () =>
        inTx((tx) =>
          splitOffCheck(tx, v.cfg, s.tabId, [{ lineNo: steak!.lineNo, quantity: "1" }], {
            expectedVisitRevision: revision,
            operatorId: ALEX,
          }),
        ),
      { code: "tab.split_held_line", params: { tabId: s.tabId, lineNo: steak!.lineNo } },
    );
  });
});

describe("sending lines on their own", () => {
  it("refuses to send a line of a held group (group.line_held), writing nothing", async () => {
    const v = await setupVenue();
    const s = await specExample(v);
    const [steak] = await linesIn(s.visitId, s.mains);
    const [croquettes] = await linesIn(s.visitId, s.cold);

    await expectRefusedWithNothingWritten(
      v,
      s.visitId,
      () => inTx((tx) => sendLines(tx, v.cfg, s.tabId, [croquettes!.lineNo, steak!.lineNo])),
      { code: "group.line_held", params: { tabId: s.tabId, lineNo: steak!.lineNo } },
    );
  });

  it("sends a recalled line of a fired group again", async () => {
    const v = await setupVenue();
    const s = await specExample(v);
    const [croquettes] = await linesIn(s.visitId, s.cold);
    await inTx((tx) => recallLines(tx, v.cfg, s.tabId, [croquettes!.lineNo]));
    expect(await firedTicketLineIds(s.visitId)).not.toContain(croquettes!.id);
    const jobsBefore = (await printed(v)).length;

    await inTx((tx) => sendLines(tx, v.cfg, s.tabId, [croquettes!.lineNo]));

    expect(await firedTicketLineIds(s.visitId)).toContain(croquettes!.id);
    expect((await printed(v)).slice(jobsBefore).join("\n")).toContain(DISHES.cold.kitchen);
  });

  it("sends every recalled line and no held-group line when no line is named", async () => {
    const v = await setupVenue();
    const s = await specExample(v);
    const [croquettes] = await linesIn(s.visitId, s.cold);
    await inTx((tx) => recallLines(tx, v.cfg, s.tabId, [croquettes!.lineNo]));
    const held = [
      ...(await linesIn(s.visitId, s.warm)),
      ...(await linesIn(s.visitId, s.mains)),
      ...(await linesIn(s.visitId, s.desserts)),
    ];

    await inTx((tx) => sendLines(tx, v.cfg, s.tabId, []));

    const fired = await firedTicketLineIds(s.visitId);
    expect(fired).toContain(croquettes!.id);
    for (const row of held) expect(fired).not.toContain(row.id);
    const after = await linesOf(s.visitId);
    expect(
      after.filter((row) => held.some((h) => h.id === row.id)).map((row) => row.sentAt),
    ).toEqual(held.map(() => null));
    expect((await groupsOf(s.visitId)).groups.map((group) => group.state)).toEqual([
      "fired",
      "fired",
      "held",
      "held",
      "held",
    ]);
  });

  it("sends a recalled line that lost its group by moving to another party's tab", async () => {
    const v = await setupVenue();
    const s = await seated(v);
    await submit(v, s.visitId, [{ release: "fire", lines: [line(v, "steak")] }]);
    const other = await seated(v);
    await transfer(v, s, other, [{ lineNo: 1 }]);
    const [moved] = await linesOfBill(other.tabId);
    await inTx((tx) => recallLines(tx, v.cfg, other.tabId, [moved!.lineNo]));
    expect(await firedTicketLineIds(other.visitId)).toEqual([]);

    await inTx((tx) => sendLines(tx, v.cfg, other.tabId, [moved!.lineNo]));

    expect(moved).toMatchObject({ groupId: null });
    expect(await firedTicketLineIds(other.visitId)).toEqual([moved!.id]);
  });

  it("leaves a held group's no-route line held when a recalled line of the same course is sent", async () => {
    const v = await setupVenue();
    const s = await seated(v);
    await submit(v, s.visitId, [{ release: "fire", lines: [line(v, "beer")] }]);
    const { groups } = await submit(v, s.visitId, [{ release: "hold", lines: [line(v, "water")] }]);
    const [water] = await linesIn(s.visitId, groups[0]!.id);
    // The Beer is line 1; recalling it leaves no held Drinks ticket once it is sent again.
    await inTx((tx) => recallLines(tx, v.cfg, s.tabId, [1]));

    await inTx((tx) => sendLines(tx, v.cfg, s.tabId, [1]));

    expect((await linesIn(s.visitId, groups[0]!.id))[0]).toMatchObject({
      id: water!.id,
      sentAt: null,
    });
  });
});

describe("the course Fire of the station and the pass, on a visit", () => {
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
    const [steak, fish] = await linesIn(s.visitId, s.mains);
    const revision = await revisionOf(s.visitId);
    const jobsBefore = (await printed(v)).length;

    await inTx(async (tx) => fireCourse(tx, v.cfg, s.tabId, await courseIdOf(v, "steak"), MIA));

    expect(await revisionOf(s.visitId)).toBe(revision + 1);
    const states = Object.fromEntries(
      (await groupsOf(s.visitId)).groups.map((group) => [group.id, group.state]),
    );
    expect(states).toEqual({
      [s.drinks]: "fired",
      [s.cold]: "fired",
      [s.warm]: "held",
      [s.mains]: "fired",
      [s.desserts]: "held",
    });
    expect(await firedTicketLineIds(s.visitId)).toEqual(
      expect.arrayContaining([steak!.id, fish!.id]),
    );
    expect((await linesIn(s.visitId, s.mains)).every((row) => row.sentAt !== null)).toBe(true);
    expect((await printed(v)).slice(jobsBefore).join("\n")).toContain(DISHES.steak.kitchen);
    const [group] = await db.select().from(orderGroups).where(eq(orderGroups.id, s.mains));
    expect(group).toMatchObject({ firedBy: MIA, firedAt: expect.any(String) });
    expect((await eventsOf(s.visitId)).at(-1)).toMatchObject({
      groupId: s.mains,
      kind: "fired",
      actorId: MIA,
    });
  });

  it("fires every held group holding the course, whole and in position order", async () => {
    const v = await setupVenue();
    const s = await seated(v);
    const made = await submit(v, s.visitId, [
      { release: "hold", lines: [line(v, "steak")] },
      { release: "hold", lines: [line(v, "fish"), line(v, "flan")] },
      { release: "hold", lines: [line(v, "warm")] },
    ]);
    const [steakGroup, fishGroup, warmGroup] = made.groups.map((group) => group.id);
    await reorder(s.visitId, [fishGroup!, warmGroup!, steakGroup!]);

    await inTx(async (tx) => fireCourse(tx, v.cfg, s.tabId, await courseIdOf(v, "steak"), ALEX));

    const fired = (await eventsOf(s.visitId)).filter((event) => event.kind === "fired");
    expect(fired.map((event) => event.groupId)).toEqual([fishGroup, steakGroup]);
    const flan = (await linesIn(s.visitId, fishGroup!)).find(
      (row) => row.productId === v.productId.flan,
    );
    expect(flan!.sentAt).not.toBeNull();
    expect((await groupsOf(s.visitId)).groups.find((g) => g.id === warmGroup)!.state).toBe("held");
  });

  it("keeps a Steak added held after the mains fired held until the next course Fire, which fires its group", async () => {
    const v = await setupVenue();
    const s = await specExample(v);
    const mains = await courseIdOf(v, "steak");
    await inTx((tx) => fireCourse(tx, v.cfg, s.tabId, mains, ALEX));

    const later = await submit(v, s.visitId, [{ release: "hold", lines: [line(v, "steak")] }]);
    const laterGroup = later.groups[0]!.id;
    const [steak] = await linesIn(s.visitId, laterGroup);
    expect(steak!.sentAt).toBeNull();
    expect(await firedTicketLineIds(s.visitId)).not.toContain(steak!.id);

    await inTx((tx) => fireCourse(tx, v.cfg, s.tabId, mains, ALEX));

    expect((await linesIn(s.visitId, laterGroup))[0]!.sentAt).not.toBeNull();
    expect(await firedTicketLineIds(s.visitId)).toContain(steak!.id);
    expect((await groupsOf(s.visitId)).groups.find((g) => g.id === laterGroup)!.state).toBe(
      "fired",
    );
  });

  it("fires a held group of the course and sends a recalled line of that course again", async () => {
    const v = await setupVenue();
    const s = await seated(v);
    const first = await submit(v, s.visitId, [{ release: "fire", lines: [line(v, "steak")] }]);
    const held = await submit(v, s.visitId, [{ release: "hold", lines: [line(v, "fish")] }]);
    const [steak] = await linesIn(s.visitId, first.groups[0]!.id);
    const [fish] = await linesIn(s.visitId, held.groups[0]!.id);
    await inTx((tx) => recallLines(tx, v.cfg, s.tabId, [steak!.lineNo]));
    expect(await firedTicketLineIds(s.visitId)).not.toContain(steak!.id);
    const jobsBefore = (await printed(v)).length;

    await inTx(async (tx) => fireCourse(tx, v.cfg, s.tabId, await courseIdOf(v, "steak"), ALEX));

    expect(await firedTicketLineIds(s.visitId)).toEqual([steak!.id, fish!.id].sort());
    expect((await groupsOf(s.visitId)).groups.map((group) => group.state)).toEqual([
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
    const first = await submit(v, s.visitId, [{ release: "fire", lines: [line(v, "steak")] }]);
    const [steak] = await linesIn(s.visitId, first.groups[0]!.id);
    await inTx((tx) => recallLines(tx, v.cfg, s.tabId, [steak!.lineNo]));
    expect(await firedTicketLineIds(s.visitId)).toEqual([]);
    const jobsBefore = (await printed(v)).length;

    await inTx(async (tx) => fireCourse(tx, v.cfg, s.tabId, await courseIdOf(v, "steak"), ALEX));

    expect(await firedTicketLineIds(s.visitId)).toEqual([steak!.id]);
    expect((await printed(v)).slice(jobsBefore).join("\n")).toContain(DISHES.steak.kitchen);
  });

  it("refuses a held group holding a sold-out Steak (product.unavailable), firing none of it", async () => {
    const v = await setupVenue();
    const s = await specExample(v);
    const courseId = await courseIdOf(v, "steak");
    await db.run(sql`update products set available = 0 where id = ${v.productId.steak}`);

    await expectRefusedWithNothingWritten(
      v,
      s.visitId,
      () => inTx((tx) => fireCourse(tx, v.cfg, s.tabId, courseId, ALEX)),
      { code: "product.unavailable", params: { productId: v.productId.steak } },
    );
  });

  it("does nothing for a course no held group holds, and refuses a course the venue lacks", async () => {
    const v = await setupVenue();
    const s = await specExample(v);
    const drinks = await courseIdOf(v, "beer");
    const before = await snapshot(v, s.visitId);

    await inTx((tx) => fireCourse(tx, v.cfg, s.tabId, drinks, ALEX));
    expect(await snapshot(v, s.visitId)).toEqual(before);

    const missing = randomUUID();
    await expectRefusedWithNothingWritten(
      v,
      s.visitId,
      () => inTx((tx) => fireCourse(tx, v.cfg, s.tabId, missing, ALEX)),
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
  it("removes a held group whose only line is voided: gone from the list, its events kept, the visit moved on", async () => {
    const v = await setupVenue();
    const s = await specExample(v);
    const fishOnly = (await submit(v, s.visitId, [{ release: "hold", lines: [line(v, "fish")] }]))
      .groups[0]!.id;
    const [fish] = await linesIn(s.visitId, fishOnly);
    const revision = await revisionOf(s.visitId);

    await inTx((tx) => voidTabLine(tx, v.cfg, s.tabId, fish!.lineNo, undefined, MIA));

    expect((await groupRow(fishOnly)).state).toBe("removed");
    expect((await groupsOf(s.visitId)).groups.map((group) => group.id)).not.toContain(fishOnly);
    const events = (await eventsOf(s.visitId)).filter((event) => event.groupId === fishOnly);
    expect(events.map((event) => [event.kind, event.actorId])).toEqual([
      ["submitted", ALEX],
      ["removed", MIA],
    ]);
    expect(await revisionOf(s.visitId)).toBe(revision + 1);
  });

  it("removes a held group whose only line a whole-order save leaves out, naming the editor", async () => {
    const v = await setupVenue();
    const s = await specExample(v);
    const fishOnly = (await submit(v, s.visitId, [{ release: "hold", lines: [line(v, "fish")] }]))
      .groups[0]!.id;
    const [fish] = await linesIn(s.visitId, fishOnly);
    const revision = await revisionOf(s.visitId);

    await saveWhole(
      v,
      s.tabId,
      (await keptLines(v, s.tabId)).filter((kept) => kept.workingOrderLineId !== fish!.id),
      MIA,
    );

    expect((await groupRow(fishOnly)).state).toBe("removed");
    expect((await eventsOf(s.visitId)).at(-1)).toMatchObject({
      groupId: fishOnly,
      kind: "removed",
      actorId: MIA,
    });
    expect(await revisionOf(s.visitId)).toBe(revision + 1);
  });

  it("keeps a held group one of whose two lines is voided, writes no event, and moves the visit on", async () => {
    const v = await setupVenue();
    const s = await specExample(v);
    const [, fish] = await linesIn(s.visitId, s.mains);
    const revision = await revisionOf(s.visitId);
    const events = (await eventsOf(s.visitId)).length;

    await inTx((tx) => voidTabLine(tx, v.cfg, s.tabId, fish!.lineNo, undefined, MIA));

    expect((await groupRow(s.mains)).state).toBe("held");
    expect(await eventsOf(s.visitId)).toHaveLength(events);
    expect(await revisionOf(s.visitId)).toBe(revision + 1);
  });

  it("moves the visit on for part of a line voided", async () => {
    const v = await setupVenue();
    const s = await specExample(v);
    const [steak] = await linesIn(s.visitId, s.mains);
    const revision = await revisionOf(s.visitId);

    await inTx((tx) => voidTabLine(tx, v.cfg, s.tabId, steak!.lineNo, "1", MIA));

    expect((await linesIn(s.visitId, s.mains))[0]).toMatchObject({ id: steak!.id, quantity: 1000 });
    expect(await revisionOf(s.visitId)).toBe(revision + 1);
  });

  it("puts a FIRED line's raised quantity in a new fired group credited to the editor, leaving the line as it was", async () => {
    const v = await setupVenue();
    const s = await specExample(v);
    const [beer] = await linesIn(s.visitId, s.drinks);
    const revision = await revisionOf(s.visitId);

    await changeLine(v, s.tabId, beer!.lineNo, { quantity: "3" }, MIA);

    const { groups } = await groupsOf(s.visitId);
    expect(groups.map((group) => [group.position, group.state])).toEqual([
      [1, "fired"],
      [2, "fired"],
      [3, "held"],
      [4, "held"],
      [5, "held"],
      [6, "fired"],
    ]);
    const added = groups[5]!;
    const [extra] = await linesIn(s.visitId, added.id);
    expect(added.lineIds).toEqual([extra!.id]);
    expect(extra).toMatchObject({
      productId: v.productId.beer,
      quantity: 1000,
      creditedTo: MIA,
      sentAt: expect.any(String),
    });
    expect(await firedTicketLineIds(s.visitId)).toContain(extra!.id);
    expect((await linesIn(s.visitId, s.drinks))[0]).toMatchObject({
      id: beer!.id,
      quantity: 2000,
      groupId: s.drinks,
      creditedTo: ALEX,
    });
    expect((await eventsOf(s.visitId)).at(-1)).toMatchObject({
      groupId: added.id,
      kind: "submitted",
      actorId: MIA,
    });
    expect(await groupRow(added.id)).toMatchObject({ submittedBy: MIA, firedBy: MIA });
    expect(await revisionOf(s.visitId)).toBe(revision + 1);
  });

  it("changes a HELD line's quantity in place, in its group, and moves the visit on", async () => {
    const v = await setupVenue();
    const s = await specExample(v);
    const [steak] = await linesIn(s.visitId, s.mains);
    const revision = await revisionOf(s.visitId);
    const events = (await eventsOf(s.visitId)).length;

    await changeLine(v, s.tabId, steak!.lineNo, { quantity: "3" }, MIA);

    expect((await linesIn(s.visitId, s.mains))[0]).toMatchObject({
      id: steak!.id,
      quantity: 3000,
      creditedTo: ALEX,
      sentAt: null,
    });
    expect((await groupsOf(s.visitId)).groups).toHaveLength(5);
    expect(await eventsOf(s.visitId)).toHaveLength(events);
    expect(await revisionOf(s.visitId)).toBe(revision + 1);
  });

  it("leaves the visit's revision alone for an edit that changes nothing", async () => {
    const v = await setupVenue();
    const s = await specExample(v);
    const [steak] = await linesIn(s.visitId, s.mains);
    const revision = await revisionOf(s.visitId);

    await changeLine(v, s.tabId, steak!.lineNo, { quantity: "2" }, MIA);

    expect(await revisionOf(s.visitId)).toBe(revision);
  });

  it("puts an extra Mia adds to Alex's held Steak in the Steak's group, credited to Alex", async () => {
    const v = await setupVenue();
    const s = await seated(v);
    const held = (await submit(v, s.visitId, [{ release: "hold", lines: [line(v, "steak")] }]))
      .groups[0]!.id;
    const [steak] = await linesIn(s.visitId, held);

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
    expect((await groupsOf(s.visitId)).groups.map((group) => group.id)).toEqual([held]);
  });

  it("puts an extra Mia adds to Alex's FIRED Steak in the Steak's fired group, credited to Alex", async () => {
    const v = await setupVenue();
    const s = await seated(v);
    const fired = (await submit(v, s.visitId, [{ release: "fire", lines: [line(v, "steak")] }]))
      .groups[0]!.id;
    const [steak] = await linesIn(s.visitId, fired);
    const events = (await eventsOf(s.visitId)).length;

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
    expect((await groupsOf(s.visitId)).groups.map((group) => [group.id, group.state])).toEqual([
      [fired, "fired"],
    ]);
    expect(await eventsOf(s.visitId)).toHaveLength(events);
  });

  it("puts a new dish a save adds, where some line was sent, in a new fired group credited to the editor", async () => {
    const v = await setupVenue();
    const s = await specExample(v);
    const revision = await revisionOf(s.visitId);

    await saveWhole(v, s.tabId, [...(await keptLines(v, s.tabId)), line(v, "flan")], MIA);

    const { groups } = await groupsOf(s.visitId);
    expect(groups).toHaveLength(6);
    expect(groups[5]).toMatchObject({ position: 6, state: "fired", summary: "1 × Flan" });
    const [flan] = await linesIn(s.visitId, groups[5]!.id);
    expect(flan).toMatchObject({ creditedTo: MIA, sentAt: expect.any(String) });
    expect(await firedTicketLineIds(s.visitId)).toContain(flan!.id);
    expect((await eventsOf(s.visitId)).at(-1)).toMatchObject({
      groupId: groups[5]!.id,
      kind: "submitted",
      actorId: MIA,
    });
    expect(await revisionOf(s.visitId)).toBe(revision + 1);
  });

  it("puts a new dish a save adds, where every line is held, in a new held group at the end", async () => {
    const v = await setupVenue();
    const s = await seated(v);
    const first = (
      await submit(v, s.visitId, [{ release: "hold", lines: [line(v, "steak"), line(v, "fish")] }])
    ).groups[0]!.id;

    await saveWhole(v, s.tabId, [...(await keptLines(v, s.tabId)), line(v, "flan")], MIA);

    const { groups } = await groupsOf(s.visitId);
    expect(groups.map((group) => [group.id === first, group.position, group.state])).toEqual([
      [true, 1, "held"],
      [false, 2, "held"],
    ]);
    const [flan] = await linesIn(s.visitId, groups[1]!.id);
    expect(flan).toMatchObject({ productId: v.productId.flan, creditedTo: MIA, sentAt: null });
    expect(await firedTicketLineIds(s.visitId)).toEqual([]);
    expect(await groupRow(groups[1]!.id)).toMatchObject({ submittedBy: MIA, firedBy: null });
  });

  it("puts a new dish a save adds to a visit's tab of held no-route lines only in a new held group", async () => {
    const v = await setupVenue();
    const s = await seated(v);
    await submit(v, s.visitId, [{ release: "hold", lines: [line(v, "water")] }]);

    await saveWhole(v, s.tabId, [...(await keptLines(v, s.tabId)), line(v, "steak")], MIA);

    const { groups } = await groupsOf(s.visitId);
    expect(groups.map((group) => [group.position, group.state, group.summary])).toEqual([
      [1, "held", "1 × Water btl"],
      [2, "held", "1 × Steak"],
    ]);
    await fire(v, s.visitId, groups[1]!.id);
    const [steak] = await linesIn(s.visitId, groups[1]!.id);
    expect(await firedTicketLineIds(s.visitId)).toEqual([steak!.id]);
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

  it("credits nobody and starts no group for an edit with no operator on a bill of no visit", async () => {
    const v = await setupVenue();
    const tabId = await inTx(async (tx) => {
      const { id: tableId } = await createTable(tx, v.cfg, {
        label: `N-${randomUUID().slice(0, 6)}`,
        zoneId: v.zoneId,
      });
      const { tabId: id } = await openTab(tx, v.cfg, { tableId });
      await addTabRound(tx, v.cfg, id, [{ ...line(v, "steak"), release: true }], {
        creditedTo: ALEX,
      });
      return id;
    });
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
    const [beer] = await linesIn(s.visitId, s.drinks);

    await expectRefusedWithNothingWritten(
      v,
      s.visitId,
      () => changeLine(v, s.tabId, beer!.lineNo, { quantity: "3" }),
      { code: "management.request_invalid", params: { field: "operatorId" } },
    );
  });
});

describe("the bill a group's first event names", () => {
  it("names the bill its lines went on by the same key, whether a submission, a join or an edit started it", async () => {
    const v = await setupVenue();
    const s = await seated(v);
    const first = (await submit(v, s.visitId, [{ release: "fire", lines: [line(v, "cold")] }]))
      .groups[0]!.id;
    const held = (await submit(v, s.visitId, [{ release: "hold", lines: [line(v, "steak")] }]))
      .groups[0]!.id;
    await submit(v, s.visitId, [{ release: "hold", lines: [line(v, "fish")] }], {
      joinGroupId: held,
    });
    const [croquettes] = await linesIn(s.visitId, first);
    const { checkId } = await inTx(async (tx) =>
      splitOffCheck(tx, v.cfg, s.tabId, [{ lineNo: croquettes!.lineNo }], {
        expectedVisitRevision: await revisionOf(s.visitId),
        operatorId: ALEX,
      }),
    );
    const [onCheck] = await linesOfBill(checkId);

    await changeLine(v, checkId, onCheck!.lineNo, { quantity: "2" }, MIA);

    const added = (await groupsOf(s.visitId)).groups.at(-1)!.id;
    expect(
      (await eventsOf(s.visitId)).map((event) => [event.groupId, event.kind, event.detail]),
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
    const issue = { fiscal: {} as TillSaleDeps, saleCfg: null };
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
      return openTab(tx, v.cfg, {
        tableId,
        lines: [{ menuItemId: v.offer("flan"), quantity: "1" }],
        operatorId: MIA,
      });
    });

    expect(await linesOfBill(tabId)).toMatchObject([{ groupId: null, creditedTo: MIA }]);
  });
});
