import {
  type Database,
  type Transaction,
  withTransaction,
  kitchenCourses,
  parties,
  workingOrderLines,
  workingOrders,
  ticketItems,
  printJobs,
  orderEvents,
  orderGroups,
  serviceCommands,
  kitchenStations,
  diningTables,
} from "@waitron/db";
import {
  seedPerson,
  seedTaxpayer,
  seedVenue,
  seedKitchenStation,
  seedNode,
} from "@waitron/db/testing/seed.js";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import {
  createMenu,
  createCategory,
  createProduct,
  createExtraList,
  writeProductModifiers,
  assignMenuToVenue,
} from "@waitron/menu";
import { migrationOptionsFor, manifestSets } from "@waitron/migrations";
import { createPrinter } from "@waitron/printing";
import { nodeId as brandNodeId } from "@waitron/shared";
import { VENUE_SERVICE_PROVISIONING, setRoutingCell } from "@waitron/venue-service";
import { eq, and, sql, asc, inArray } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { createCourse, setProductCourse } from "../kitchen.js";
import { VENUE_SERVICE } from "../modules.js";
import { reorderHeldGroups } from "../order-group-edits.js";
import { bumpGroupReady } from "../order-group-readiness.js";
import { listOrderGroups } from "../order-group-reads.js";
import type { GroupRelease } from "../order-group-records.js";
import { fireGroup } from "../order-group-release.js";
import type { GroupLine } from "../order-group-submission.js";
import { seatTable } from "../parties.js";
import { readScopedPassBoard } from "../pass-board.js";
import type { PassBoard, PassCard } from "../pass-card.js";
import { attachPrinterToStation } from "../station-printers.js";
import type { DeviceRequestConfig, TradingContext } from "../trading-context.js";
import { createOpenOrder } from "../working-order-open.js";
import { transferItems, cutParts, splitBill } from "./bill-action-fixture.js";
import { printedLines } from "./decode-ticket.js";
import { floorLabelSuffix } from "./floor-label.js";
import { moveLinesToGroup } from "./group-composition-fixture.js";
import { submitGroups, placeGroupedRound } from "./group-submit-fixture.js";
import { createTable } from "./live-table.js";
import { moveBill } from "./move-bill-fixture.js";
import {
  updateHeldOrder as updateHeldOrderForTest,
  updateOrderLine,
} from "./order-writer-fixture.js";
import { EVERY, boardCards } from "./pass-board-probe.js";
import { seedLegacySellingUnits } from "./seed-units.js";
import { openPartyTab } from "./serve-line.js";
import { deviceRequestCfg } from "./session-device.js";
import { ticketItemsWithBill } from "./ticket-items-with-bill.js";
import { testTradingAdmission } from "./trading-admission.js";
import { offerProducts } from "./zone-offers.js";

export const LOCALE = "es-ES";
export const ALEX = "cccccccc-0000-4000-8000-00000000000a";
export const MIA = "cccccccc-0000-4000-8000-00000000000b";
const suite = useVenueDb({
  migrations: migrationOptionsFor(manifestSets(), null),
  timeoutMs: 60_000,
});
export let db: Database;
beforeAll(() => {
  db = suite.db;
});
export const inTx = <T>(fn: (tx: Transaction) => Promise<T>): Promise<T> => withTransaction(db, fn);
/**
 * Each dish's three names differ, so a surface reading the wrong one shows the wrong text: the
 * staff name is what a group's summary shows, the kitchen name is what a ticket prints.
 */
export const DISHES = {
  beer: { staff: "Beer tap", customer: "Draught beer", kitchen: "K-BEER", price: "3.00" },
  water: { staff: "Water btl", customer: "Mineral water", kitchen: "K-WATER", price: "2.00" },
  cold: { staff: "Croquettes", customer: "Ham croquettes", kitchen: "K-CROQ", price: "8.00" },
  warm: { staff: "Octopus", customer: "Grilled octopus", kitchen: "K-OCTO", price: "14.00" },
  steak: { staff: "Steak", customer: "Sirloin steak", kitchen: "K-STEAK", price: "22.00" },
  fish: { staff: "Fish", customer: "Catch of the day", kitchen: "K-FISH", price: "18.00" },
  flan: { staff: "Flan", customer: "Caramel custard", kitchen: "K-FLAN", price: "5.00" },
  sauce: { staff: "Pepper sc", customer: "Pepper sauce", kitchen: "K-PEPPER", price: "1.50" },
} as const;
export type Dish = keyof typeof DISHES;
export const COURSES = {
  drinks: "Drinks",
  starters: "Starters",
  mains: "Mains",
  desserts: "Desserts",
};
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
export interface Venue {
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
export async function setupVenue(countryCourses = false): Promise<Venue> {
  for (const id of [ALEX, MIA]) await seedPerson(db, { id, displayName: id });
  await seedTaxpayer(db);
  await seedLegacySellingUnits(db);
  await seedVenue(db, {
    name: "Main room",
    invoiceLocales: [countryCourses ? "en-GB" : LOCALE],
  });
  const stationId = await seedKitchenStation(db, {});
  const nodeId = await seedNode(db);
  const cfg = await deviceRequestCfg(db, {
    nodeId: brandNodeId(nodeId),
    locale: LOCALE,
    simplifiedInvoiceLimit: null,
  } satisfies TradingContext);
  return inTx(async (tx) => {
    if (countryCourses) await VENUE_SERVICE_PROVISIONING.seed!.run(tx, { nodeId });
    const seededCourses = countryCourses ? await tx.select().from(kitchenCourses) : [];
    const menu = await createMenu(tx, { name: "Carta" });
    const category = await createCategory(tx, { name: "Platos" });
    const courseIds: Record<string, string> = {};
    let displayOrder = 1;
    for (const [key, name] of Object.entries(COURSES)) {
      const seeded = seededCourses.find(
        (course) => course.name === (key === "drinks" ? "Sharing plates" : name),
      );
      courseIds[key] = countryCourses
        ? seeded!.id
        : (await createCourse(tx, { name, displayOrder: displayOrder++ })).id;
    }
    const productId = {} as Record<Dish, string>;
    for (const [dish, names] of Object.entries(DISHES) as [Dish, (typeof DISHES)[Dish]][]) {
      const product = await createProduct(tx, {
        categoryId: category.id,
        name: names.staff,
        customerName: { en: names.customer },
        kitchenName: names.kitchen,
        pricingUnit: "each",
        unitPrice: names.price,
        vatClass: "general",
      });
      productId[dish] = product.id;
      await setProductCourse(tx, product.id, courseIds[COURSE_OF[dish]]!);
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
    await assignMenuToVenue(tx, menu.id);
    const offers = await offerProducts(tx, { zone: "tables" });
    // Bottled water is handed over at the bar: no kitchen ticket, only a sent stamp.
    await setRoutingCell(
      tx,
      { row: { kind: "product", productId: productId.water }, zoneId: null },
      { kind: "no_preparation" },
    );
    const { id: printerId } = await createPrinter(tx, {
      name: "Cocina",
      transport: "cloud_poll",
      pollId: `poll-${randomUUID()}`,
    });
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
export interface Seated {
  partyId: string;
  tabId: string;
  tableId: string;
}
export async function seated(v: Venue): Promise<Seated> {
  return inTx(async (tx) => {
    const { id: tableId } = await createTable(tx, {
      label: `T-${floorLabelSuffix().padStart(6, "0")}`,
      zoneId: v.zoneId,
    });
    const { partyId, tabId } = await seatTable(tx, v.cfg, {
      tableId,
      guestCount: 4,
      operatorId: ALEX,
    });
    await VENUE_SERVICE.writePartyAllergy(tx, partyId, { answer: "none", guests: [] }, ALEX);
    return { partyId, tabId, tableId };
  });
}
export function line(v: Venue, dish: Dish, quantity = "1"): GroupLine {
  return { menuItemId: v.offer(dish), quantity };
}
export async function revisionOf(partyId: string): Promise<number> {
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
export async function args(partyId: string, opts: CommandOptions = {}) {
  return {
    submissionId: opts.submissionId ?? randomUUID(),
    expectedPartyRevision: opts.revision ?? (await revisionOf(partyId)),
    operatorId: opts.operatorId ?? ALEX,
  };
}
export async function submit(
  v: Venue,
  partyId: string,
  groups: {
    lines: GroupLine[];
    release: GroupRelease;
    joinGroupId?: string;
    afterGroupId?: string;
  }[],
  opts: CommandOptions & { joinGroupId?: string } = {},
) {
  const command = await args(partyId, opts);
  return inTx((tx) =>
    submitGroups(tx, v.cfg, partyId, { ...command, groups, joinGroupId: opts.joinGroupId }),
  );
}
export async function submitGrouped(
  v: Venue,
  s: { partyId: string; tabId: string },
  groups: { lines: GroupLine[]; release: GroupRelease }[],
) {
  return inTx(async (tx) => {
    const placed = [];
    for (const group of groups)
      placed.push(...(await placeGroupedRound(tx, v.cfg, s, group, ALEX)).groups);
    return { groups: placed };
  });
}
export async function fire(v: Venue, partyId: string, groupId: string, opts: CommandOptions = {}) {
  const command = await args(partyId, opts);
  return inTx((tx) => fireGroup(tx, v.cfg, partyId, groupId, command));
}
export async function reorder(partyId: string, ids: string[], opts: CommandOptions = {}) {
  const command = await args(partyId, opts);
  return inTx((tx) => reorderHeldGroups(tx, partyId, ids, command));
}
export async function move(
  v: Venue,
  partyId: string,
  moves: { lineId: string; quantity: string }[],
  target: { groupId: string } | "new",
  opts: CommandOptions = {},
) {
  const command = await args(partyId, opts);
  return inTx((tx) => moveLinesToGroup(tx, v.cfg, partyId, moves, target, command));
}
export async function groupsOf(partyId: string) {
  return inTx((tx) => listOrderGroups(tx, partyId));
}
export async function passBoard(): Promise<PassBoard> {
  return inTx((tx) => readScopedPassBoard(tx, EVERY));
}
export function groupIdOf(card: PassCard): string | null {
  return card.target.kind === "group" ? card.target.groupId : null;
}
/** The party's group cards on the pass, by group position. */
export function groupCardsOf(board: PassBoard, partyId: string): PassCard[] {
  return boardCards(board)
    .filter((card) => card.party?.id === partyId && card.group !== undefined)
    .sort((a, b) => a.group!.position - b.group!.position);
}
/** The top-level lines of the party's bills, by bill then line number. */
export async function linesOf(partyId: string) {
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
export async function linesIn(partyId: string, groupId: string) {
  return (await linesOf(partyId)).filter((row) => row.groupId === groupId);
}
export async function ticketsOf(partyId: string) {
  return db
    .select({
      lineId: ticketItems.workingOrderLineId,
      firedAt: ticketItems.firedAt,
      quantity: ticketItems.quantity,
    })
    .from(ticketItems)
    .innerJoin(workingOrderLines, eq(workingOrderLines.id, ticketItems.workingOrderLineId))
    .innerJoin(workingOrders, eq(workingOrders.id, workingOrderLines.workingOrderId))
    .where(eq(workingOrders.partyId, partyId));
}
export async function firedTicketLineIds(partyId: string): Promise<string[]> {
  return (await ticketsOf(partyId))
    .filter((ticket) => ticket.firedAt !== null)
    .map((ticket) => ticket.lineId)
    .sort();
}
export async function printed(v: Venue): Promise<string[]> {
  const jobs = await db
    .select({ payload: printJobs.payload })
    .from(printJobs)
    .where(eq(printJobs.printerId, v.printerId))
    .orderBy(sql`rowid`);
  return jobs.map((job) => printedLines(job.payload).join("\n"));
}
export async function eventsOf(partyId: string) {
  return db
    .select({
      groupId: orderEvents.groupId,
      kind: orderEvents.kind,
      actorId: orderEvents.actorId,
      detail: orderEvents.detail,
    })
    .from(orderEvents)
    .where(and(eq(orderEvents.partyId, partyId), sql`${orderEvents.kind} like 'group.%'`))
    .orderBy(sql`rowid`);
}
/** Every row a group command can write, so a refusal can be shown to have written none. */
export async function snapshot(v: Venue, partyId: string) {
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
    tickets: await ticketItemsWithBill(db)
      .where(inArray(workingOrderLines.workingOrderId, billIds))
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
export async function expectRefusedWithNothingWritten(
  v: Venue,
  partyId: string,
  attempt: () => Promise<unknown>,
  expected: { code: string; params?: Record<string, unknown> },
): Promise<void> {
  const before = await snapshot(v, partyId);
  await expect(attempt()).rejects.toMatchObject(expected);
  expect(await snapshot(v, partyId)).toEqual(before);
}
export async function stillPaying(tabId: string): Promise<void> {
  expect(db.all(sql`select state from bill_payments where working_order_id = ${tabId}`)).toEqual([
    { state: "pending" },
  ]);
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
 * warm starters, then hold the mains and the desserts as two groups in one submission. The
 * "grouped" shape stores each line as one row and places each group on its own.
 */
export async function specExample(v: Venue, shape?: "grouped"): Promise<SpecExample> {
  const seat = await seated(v);
  const place = (groups: Parameters<typeof submitGrouped>[2]) =>
    shape === "grouped" ? submitGrouped(v, seat, groups) : submit(v, seat.partyId, groups);
  const one = async (release: GroupRelease, lines: GroupLine[]) =>
    (await place([{ release, lines }])).groups[0]!.id;
  const drinks = await one("fire", [line(v, "beer", "2"), line(v, "water")]);
  const cold = await one("fire", [line(v, "cold", "4")]);
  const warm = await one("hold", [line(v, "warm", "4")]);
  const later = await place([
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
/** What a bill action on the party is sent: its revision as read now, and who acts. */
export async function billCommand(partyId: string) {
  return { expectedPartyRevision: await revisionOf(partyId), operatorId: ALEX };
}
/**
 * A party's bill, with its lines as `fill` rings them, taken to the counter with no zone: a bill of
 * no party that keeps the table zone's service mode.
 */
export async function billOfNoParty(
  v: Venue,
  fill: (tx: Transaction, billId: string) => Promise<void>,
): Promise<string> {
  const { tabId, partyId } = await inTx(async (tx) => {
    const { id: tableId } = await createTable(tx, {
      label: `N-${floorLabelSuffix().padStart(6, "0")}`,
      zoneId: v.zoneId,
    });
    const opened = await openPartyTab(tx, v.cfg, { tableId });
    await VENUE_SERVICE.writePartyAllergy(tx, opened.partyId, { answer: "none", guests: [] }, ALEX);
    await fill(tx, opened.tabId);
    return opened;
  });
  await inTx(async (tx) =>
    moveBill(
      tx,
      v.cfg,
      tabId,
      { counter: { zoneId: null } },
      { ...(await billCommand(partyId)), partyId },
    ),
  );
  return tabId;
}
/**
 * The chosen items of the party's tab transferred onto a new, empty bill of the party, sent at
 * `revision` by `operatorId`.
 */
export async function onSecondBill(
  v: Venue,
  s: Seated,
  transfers: { lineNo: number; quantity?: string }[],
  revision: number,
  operatorId: string,
): Promise<string> {
  const billId = randomUUID();
  await inTx(async (tx) => {
    await createOpenOrder(tx, v.cfg, billId, [], null, {
      partyId: s.partyId,
      existingService: true,
      copyServiceContextFrom: s.tabId,
    });
    await transferItems(tx, v.cfg, s.tabId, billId, await cutParts(tx, v.cfg, s.tabId, transfers), {
      expectedPartyRevision: revision,
      operatorId,
    });
  });
  return billId;
}
export async function linesOfBill(tabId: string) {
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
/**
 * The chosen items of the party's tab moved onto a new check, sent at `revision` by `operatorId`;
 * a part is first cut off its line inside the tab.
 */
export async function splitToCheck(
  v: Venue,
  s: Seated,
  transfers: { lineNo: number; quantity?: string }[],
  revision?: number,
  operatorId = ALEX,
): Promise<string> {
  const expectedPartyRevision = revision ?? (await revisionOf(s.partyId));
  const { billId } = await inTx(async (tx) =>
    splitBill(tx, v.cfg, s.tabId, await cutParts(tx, v.cfg, s.tabId, transfers), {
      expectedPartyRevision,
      operatorId,
    }),
  );
  return billId;
}
/** A printed ticket's lines, minus the blank line the cut leaves. */
export function ticketLines(ticket: string): string[] {
  return ticket.split("\n").filter((text) => text !== "");
}
/** What a kitchen ticket for this bill of the party prints under its mark: station, table, bill, time. */
export async function billHead(v: Venue, s: Seated, billId: string): Promise<unknown[]> {
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
export async function billRevisionOf(orderId: string): Promise<number> {
  const [row] = await db
    .select({ revision: workingOrders.revision })
    .from(workingOrders)
    .where(eq(workingOrders.id, orderId));
  return row!.revision;
}
/** A whole-order save's lines keeping every dish of the bill as it stands. */
export async function keptLines(v: Venue, orderId: string) {
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
export async function saveWhole(
  v: Venue,
  orderId: string,
  lines: Awaited<ReturnType<typeof keptLines>> | ReturnType<typeof line>[],
  operatorId: string | undefined,
) {
  return updateHeldOrderForTest({ admission: testTradingAdmission(), db }, v.cfg, orderId, {
    lines,
    revision: await billRevisionOf(orderId),
    operatorId,
  });
}
export async function changeLine(
  v: Venue,
  orderId: string,
  lineNo: number,
  patch: Parameters<typeof updateOrderLine>[4],
  operatorId?: string,
) {
  const revision = await billRevisionOf(orderId);
  return inTx((tx) => updateOrderLine(tx, v.cfg, orderId, lineNo, patch, revision, operatorId));
}
export async function groupRow(groupId: string) {
  const [row] = await db.select().from(orderGroups).where(eq(orderGroups.id, groupId));
  return row!;
}
export async function ready(partyId: string, groupId: string, opts: CommandOptions = {}) {
  const command = await args(partyId, opts);
  return inTx((tx) => bumpGroupReady(tx, partyId, groupId, command));
}
/** The kitchen's items for a group's dishes, whichever bill they sit on. */
export async function groupTickets(groupId: string) {
  return db
    .select({
      id: ticketItems.id,
      workingOrderId: workingOrderLines.workingOrderId,
      state: ticketItems.state,
      firedAt: ticketItems.firedAt,
      readyAt: ticketItems.readyAt,
    })
    .from(ticketItems)
    .innerJoin(workingOrderLines, eq(workingOrderLines.id, ticketItems.workingOrderLineId))
    .where(eq(workingOrderLines.groupId, groupId))
    .orderBy(ticketItems.id);
}
/** The spec's example with one croquette split onto a check: the fired cold starters span two bills. */
export async function specExampleOnTwoBills(v: Venue) {
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
