import { recallLines } from "./testing/order-writer-fixture.js";
import { randomUUID } from "node:crypto";
import { and, asc, eq, isNotNull, sql } from "drizzle-orm";
import { beforeAll, describe, expect, it, vi } from "vitest";
import {
  kitchenPrintJobLines,
  kitchenPrintJobs,
  locations,
  orderGroups,
  printJobs,
  parties,
  ticketItems,
  withTransaction,
  workingOrderLines,
} from "@waitron/db";
import type { Database, Transaction } from "@waitron/db";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { seedKitchenStation, seedNode, seedTenant } from "@waitron/db/testing/seed.js";
import {
  assignCatalogueToLocation,
  createCatalogue,
  createCategory,
  createProduct,
} from "@waitron/catalogue";
import {
  createPrinter,
  deactivatePrinter,
  enqueuePrintJob,
  MAX_DELIVERY_ATTEMPTS,
  resendPrintJob,
  updatePrinter,
} from "@waitron/printing";
import { locationId as brandLocationId, nodeId as brandNodeId } from "@waitron/shared";
import type { DeviceRequestConfig, TillConfig } from "./till-config.js";
import { deviceRequestCfg } from "./testing/session-device.js";
import { createStation } from "./kitchen.js";
import { attachPrinterToStation, detachPrinterFromStation } from "./station-printers.js";
import { createTable } from "./testing/live-table.js";
import { listPrintProblems, ordersWithPrintProblem, reprintOrderTickets } from "./kitchen-print.js";
import { seedLegacySellingUnits } from "./testing/seed-units.js";
import { routeProductTo, offerProducts } from "./testing/zone-offers.js";
import { listStationQueue } from "./working-order.js";
import { readPartyBills, seatTable } from "./parties.js";
import {
  fireGroup,
  listOrderGroups,
  moveLinesToGroup,
  submitGroups,
  type GroupLine,
  type GroupRelease,
} from "./testing/group-composition-fixture.js";
import { printingAlertSource } from "./alert-sources.js";
import { VENUE_SERVICE } from "./modules.js";
import { JOBS_WAITING_MS } from "./print-job-trouble.js";
import { printedLines } from "./testing/decode-ticket.js";
import "./errors.js";
import { splitBill } from "./testing/bill-action-fixture.js";
import { joinTables } from "./testing/table-action-fixture.js";
import { moveBill } from "./testing/move-bill-fixture.js";
import { cancelLine } from "./testing/cancel-line.js";
import { setStationPrinting } from "./testing/station-printing.js";

// Review Focus 6: a kitchen ticket that failed or is stuck shows as a printing problem on the table
// and on its station's card, never refuses the next order, and clears once a reprint has printed,
// once a Reprint would print nothing on that printer for that station, once a resend of it from
// the Printers screen has printed, or once a resend of a failed Reprint has printed.

const LOCALE = "es-ES";
const ALEX = "cccccccc-0000-4000-8000-00000000000a";

const suite = useVenueDb({
  migrations: migrationOptionsFor(manifestSets(), null),
  timeoutMs: 60_000,
});
let db: Database;
beforeAll(() => {
  db = suite.db;
});

const inTx = <T>(fn: (tx: Transaction) => Promise<T>): Promise<T> => withTransaction(db, fn);

// Each dish's three names differ (docs/developers/products.md).
const DISHES = {
  burger: { staff: "Burger", customer: "Beef burger", kitchen: "K-BURGER", price: "12.00" },
  fish: { staff: "Fish", customer: "Catch of the day", kitchen: "K-FISH", price: "18.00" },
  beer: { staff: "Beer tap", customer: "Draught beer", kitchen: "K-BEER", price: "3.00" },
} as const;
type Dish = keyof typeof DISHES;

interface Venue {
  cfg: DeviceRequestConfig;
  kitchenStationId: string;
  barStationId: string;
  kitchenPrinterId: string;
  barPrinterId: string;
  receiptPrinter: string;
  zoneId: string;
  offer(dish: Dish): string;
}

async function setupVenue(): Promise<Venue> {
  await seedTenant(db);
  await seedLegacySellingUnits(db);
  const [location] = await db
    .insert(locations)
    .values({ name: "Sala", invoiceLocales: [LOCALE], operationDescription: "Restaurante" })
    .returning({ id: locations.id });
  const locationId = location!.id;
  const kitchenStationId = await seedKitchenStation(db, {
    locationId: brandLocationId(locationId),
  });
  const nodeId = await seedNode(db, brandLocationId(locationId));
  const cfg = await deviceRequestCfg(db, {
    nodeId: brandNodeId(nodeId),
    locationId: brandLocationId(locationId),
    locale: LOCALE,
    invoiceLocales: [LOCALE],
    tipsEnabled: false,
    simplifiedInvoiceLimit: null,
  } satisfies TillConfig);
  return inTx(async (tx) => {
    const { id: barStationId } = await createStation(tx, cfg, { name: "Barra" });
    const catalogue = await createCatalogue(tx, { name: "Carta" });
    const category = await createCategory(tx, { name: "Platos" });
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
    }
    await routeProductTo(tx, cfg, productId.beer, barStationId);
    await assignCatalogueToLocation(tx, locationId, catalogue.id);
    const offers = await offerProducts(tx, cfg, { zone: "tables" });
    const printer = async (name: string) =>
      (
        await createPrinter(
          tx,
          { locationId: cfg.locationId },
          { name, transport: "cloud_poll", pollId: `poll-${randomUUID()}` },
        )
      ).id;
    const kitchenPrinterId = await printer("Cocina");
    const barPrinterId = await printer("Barra");
    const receiptPrinter = await printer("Recibos");
    await attachPrinterToStation(tx, {
      locationId: cfg.locationId,
      stationId: kitchenStationId,
      printerId: kitchenPrinterId,
    });
    await attachPrinterToStation(tx, {
      locationId: cfg.locationId,
      stationId: barStationId,
      printerId: barPrinterId,
    });
    return {
      cfg,
      kitchenStationId,
      barStationId,
      kitchenPrinterId,
      barPrinterId,
      receiptPrinter,
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

async function seated(v: Venue, label: string): Promise<Seated> {
  return inTx(async (tx) => {
    const { id: tableId } = await createTable(tx, v.cfg, { label, zoneId: v.zoneId });
    const { partyId, tabId } = await seatTable(tx, v.cfg, {
      tableId,
      guestCount: 2,
      operatorId: ALEX,
    });
    return { partyId, tabId, tableId };
  });
}

const line = (v: Venue, dish: Dish, quantity = "1"): GroupLine => ({
  menuItemId: v.offer(dish),
  quantity,
});

async function command(partyId: string) {
  const [row] = await db
    .select({ revision: parties.revision })
    .from(parties)
    .where(eq(parties.id, partyId));
  return { submissionId: randomUUID(), expectedPartyRevision: row!.revision, operatorId: ALEX };
}

async function submit(
  v: Venue,
  partyId: string,
  groups: { lines: GroupLine[]; release: GroupRelease }[],
) {
  const args = await command(partyId);
  return inTx((tx) =>
    submitGroups(tx, v.cfg, partyId, {
      ...args,
      allergy: { party: { answer: "none", guests: [] }, ticks: [] },
      groups,
    }),
  );
}

/** Seats `label` and fires one group of `dishes`, answering the party, its tab and the group. */
async function firedTable(v: Venue, label: string, dishes: Dish[] = ["burger"]) {
  const seat = await seated(v, label);
  const { groups } = await submit(v, seat.partyId, [
    { release: "fire", lines: dishes.map((dish) => line(v, dish)) },
  ]);
  return { ...seat, groupId: groups[0]!.id };
}

/** Every link row, with its job's printer, in the order they were written. */
async function links() {
  return db
    .select({
      printJobId: kitchenPrintJobs.printJobId,
      workingOrderId: kitchenPrintJobs.workingOrderId,
      stationId: kitchenPrintJobs.stationId,
      reprint: kitchenPrintJobs.reprint,
      printerId: printJobs.printerId,
    })
    .from(kitchenPrintJobs)
    .innerJoin(printJobs, eq(printJobs.id, kitchenPrintJobs.printJobId))
    .orderBy(sql`${kitchenPrintJobs}.rowid`);
}

/** The one job printed for `orderId` at `printerId`. */
async function jobFor(orderId: string, printerId: string): Promise<string> {
  const rows = (await links()).filter(
    (row) => row.workingOrderId === orderId && row.printerId === printerId,
  );
  expect(rows).toHaveLength(1);
  return rows[0]!.printJobId;
}

/** Every job queued for `printerId`, oldest first, each as the lines it prints. */
async function jobsAt(printerId: string): Promise<{ id: string; lines: string[] }[]> {
  const rows = await db
    .select({ id: printJobs.id, payload: printJobs.payload })
    .from(printJobs)
    .where(eq(printJobs.printerId, printerId))
    .orderBy(sql`rowid`);
  return rows.map((row) => ({
    id: row.id,
    lines: printedLines(row.payload).filter((text) => text !== ""),
  }));
}

async function setJob(
  jobId: string,
  values: Partial<{
    status: "queued" | "printing" | "done" | "failed";
    attempts: number;
    createdAt: string;
  }>,
) {
  await db.update(printJobs).set(values).where(eq(printJobs.id, jobId));
}

const exhausted = { status: "failed", attempts: MAX_DELIVERY_ATTEMPTS } as const;

async function createdAtOf(jobId: string): Promise<string> {
  const [row] = await db
    .select({ createdAt: printJobs.createdAt })
    .from(printJobs)
    .where(eq(printJobs.id, jobId));
  return row!.createdAt;
}

/** The count the printer's "jobs waiting" alert shows for `printerId`, or 0 when it raises none. */
async function waitingAt(printerId: string): Promise<number> {
  const alerts = await inTx((tx) => printingAlertSource().read({ tx, now: new Date() }));
  const alert = alerts.find((a) => a.key === `printer.jobs_waiting:${printerId}`);
  return alert === undefined ? 0 : Number(alert.params.count);
}

const problemsOf = (partyId: string, now?: Date) =>
  inTx((tx) => listPrintProblems(tx, partyId, now));

async function stationCard(stationId: string, orderId: string) {
  const cards = await inTx((tx) => listStationQueue(tx, stationId));
  const card = cards.find((c) => c.orderId === orderId);
  expect(card).toBeDefined();
  return card!;
}

/** What the table and the kitchen read of the party's order, less the printing problem itself. */
async function orderAsRead(v: Venue, s: Seated) {
  const card = { ...(await stationCard(v.kitchenStationId, s.tabId)) };
  delete card.printProblem;
  return {
    bills: await inTx((tx) => readPartyBills(tx, s.partyId)),
    groups: await inTx((tx) => listOrderGroups(tx, s.partyId)),
    lines: await db
      .select()
      .from(workingOrderLines)
      .where(eq(workingOrderLines.workingOrderId, s.tabId))
      .orderBy(asc(workingOrderLines.lineNo)),
    card,
  };
}

describe("the link from a kitchen ticket to its bill and station", () => {
  it("links each bill's own ticket when a fired group's dishes sit on two bills of the party", async () => {
    const v = await setupVenue();
    const s = await firedTable(v, "Mesa 4", ["burger", "fish"]);
    const lineNo = await lineNoOf(s.tabId, "fish");
    const { billId: checkId } = await inTx(async (tx) =>
      splitBill(tx, v.cfg, s.tabId, [{ lineNo, quantity: "1" }], {
        expectedPartyRevision: (await command(s.partyId)).expectedPartyRevision,
        operatorId: ALEX,
      }),
    );
    const before = (await links()).length;

    await inTx(async (tx) => {
      await reprintOrderTickets(tx, v.cfg, s.tabId);
      await reprintOrderTickets(tx, v.cfg, checkId);
    });

    expect(
      (await links()).slice(before).map((row) => [row.workingOrderId, row.stationId, row.reprint]),
    ).toEqual([
      [s.tabId, v.kitchenStationId, true],
      [checkId, v.kitchenStationId, true],
    ]);
  });

  it("records a Reprint's fired and held lines on the one job that prints both", async () => {
    const v = await holdingVenue();
    const s = await seated(v, "Mesa 4");
    await submit(v, s.partyId, [
      { release: "fire", lines: [line(v, "burger")] },
      { release: "hold", lines: [line(v, "fish")] },
    ]);
    const before = (await links()).length;

    await inTx((tx) => reprintOrderTickets(tx, v.cfg, s.tabId));

    const [reprint] = (await links()).slice(before);
    expect(await linesCarried(reprint!.printJobId)).toEqual(["Burger", "Fish"]);
  });

  it("marks a reprint's links as a reprint", async () => {
    const v = await setupVenue();
    const s = await firedTable(v, "Mesa 4");
    await inTx((tx) => reprintOrderTickets(tx, v.cfg, s.tabId));

    expect((await links()).map((row) => [row.stationId, row.reprint])).toEqual([
      [v.kitchenStationId, false],
      [v.kitchenStationId, true],
    ]);
  });
});

describe("a printing problem on the table and the station (Review Focus 6)", () => {
  it("shows a ticket that failed every delivery attempt on Mesa 4 and on its station's card", async () => {
    const v = await setupVenue();
    const table4 = await firedTable(v, "Mesa 4", ["burger", "beer"]);
    const job = await jobFor(table4.tabId, v.kitchenPrinterId);
    await setJob(job, exhausted);

    expect(await problemsOf(table4.partyId)).toEqual([
      {
        workingOrderId: table4.tabId,
        stationId: v.kitchenStationId,
        stationName: "Cocina",
        since: await createdAtOf(job),
      },
    ]);
    expect((await stationCard(v.kitchenStationId, table4.tabId)).printProblem).toBe(true);
    // The bar's ticket printed its own job, which has not failed.
    expect("printProblem" in (await stationCard(v.barStationId, table4.tabId))).toBe(false);
  });

  it("does not show a ticket that failed but still has attempts left, while it is young", async () => {
    const v = await setupVenue();
    const table4 = await firedTable(v, "Mesa 4");
    await setJob(await jobFor(table4.tabId, v.kitchenPrinterId), {
      status: "failed",
      attempts: MAX_DELIVERY_ATTEMPTS - 1,
    });

    expect(await problemsOf(table4.partyId)).toEqual([]);
    expect("printProblem" in (await stationCard(v.kitchenStationId, table4.tabId))).toBe(false);
  });

  it("shows a ticket still queued after JOBS_WAITING_MS, and not one queued a moment less", async () => {
    const v = await setupVenue();
    const table4 = await firedTable(v, "Mesa 4");
    const job = await jobFor(table4.tabId, v.kitchenPrinterId);
    const created = Date.parse(await createdAtOf(job));

    expect(await problemsOf(table4.partyId, new Date(created + JOBS_WAITING_MS - 1_000))).toEqual(
      [],
    );
    expect(
      await problemsOf(table4.partyId, new Date(created + JOBS_WAITING_MS + 1_000)),
    ).toMatchObject([{ workingOrderId: table4.tabId, stationId: v.kitchenStationId }]);

    // The station card reads the real clock: age the job instead.
    expect("printProblem" in (await stationCard(v.kitchenStationId, table4.tabId))).toBe(false);
    await setJob(job, { createdAt: new Date(Date.now() - JOBS_WAITING_MS - 60_000).toISOString() });
    expect((await stationCard(v.kitchenStationId, table4.tabId)).printProblem).toBe(true);
  });

  it("still accepts a new round on Mesa 4 while the problem stands, and reads the order as before", async () => {
    const v = await setupVenue();
    const table4 = await firedTable(v, "Mesa 4");
    const before = await orderAsRead(v, table4);
    const job = await jobFor(table4.tabId, v.kitchenPrinterId);
    await setJob(job, exhausted);

    expect(await orderAsRead(v, table4)).toEqual(before);

    const next = await submit(v, table4.partyId, [{ release: "fire", lines: [line(v, "fish")] }]);
    expect(next.groups).toMatchObject([{ state: "fired" }]);
    expect(await problemsOf(table4.partyId)).toMatchObject([
      {
        workingOrderId: table4.tabId,
        stationId: v.kitchenStationId,
        since: await createdAtOf(job),
      },
    ]);
  });

  it("clears once a reprint of the bill has printed, and not while the reprint waits", async () => {
    const v = await setupVenue();
    const table4 = await firedTable(v, "Mesa 4");
    await setJob(await jobFor(table4.tabId, v.kitchenPrinterId), exhausted);

    await inTx((tx) => reprintOrderTickets(tx, v.cfg, table4.tabId));
    const reprint = (await links()).find((row) => row.reprint)!.printJobId;
    expect(await problemsOf(table4.partyId)).toHaveLength(1);

    await setJob(reprint, { status: "done" });
    expect(await problemsOf(table4.partyId)).toEqual([]);
    expect("printProblem" in (await stationCard(v.kitchenStationId, table4.tabId))).toBe(false);
  });

  it("clears once a resend of the failed ticket has printed, and not while the resend waits", async () => {
    const v = await setupVenue();
    const table4 = await firedTable(v, "Mesa 4");
    const job = await jobFor(table4.tabId, v.kitchenPrinterId);
    await setJob(job, exhausted);

    const copy = await inTx(async (tx) => (await resendPrintJob(tx, job)).jobId);
    expect(await problemsOf(table4.partyId)).toHaveLength(1);

    await setJob(copy, { status: "done" });
    expect(await problemsOf(table4.partyId)).toEqual([]);
    expect("printProblem" in (await stationCard(v.kitchenStationId, table4.tabId))).toBe(false);
  });

  it("stays clear when a resend of the printed copy then runs out of attempts, while the printer's alert counts that copy", async () => {
    const v = await setupVenue();
    const table4 = await firedTable(v, "Mesa 4");
    const job = await jobFor(table4.tabId, v.kitchenPrinterId);
    await setJob(job, exhausted);
    const printed = await inTx(async (tx) => (await resendPrintJob(tx, job)).jobId);
    await setJob(printed, { status: "done" });

    await setJob(await inTx(async (tx) => (await resendPrintJob(tx, printed)).jobId), exhausted);
    // A resend is a byte-for-byte copy, so once one printed the kitchen has every dish the ticket carried.
    expect(await problemsOf(table4.partyId)).toEqual([]);
    expect("printProblem" in (await stationCard(v.kitchenStationId, table4.tabId))).toBe(false);
    const alerts = await inTx((tx) => printingAlertSource().read({ tx, now: new Date() }));
    expect(alerts.filter((a) => a.code === "printer.jobs_waiting")).toMatchObject([
      { params: { count: 1 } },
    ]);
  });

  it("is not cleared by a later round's ticket printing, which does not carry the lost dishes", async () => {
    const v = await setupVenue();
    const table4 = await firedTable(v, "Mesa 4");
    await setJob(await jobFor(table4.tabId, v.kitchenPrinterId), exhausted);
    await submit(v, table4.partyId, [{ release: "fire", lines: [line(v, "fish")] }]);
    const later = (await links()).at(-1)!.printJobId;

    await setJob(later, { status: "done" });
    expect(await problemsOf(table4.partyId)).toHaveLength(1);
  });

  it("clears once a reprint on the same printer has printed, though it was queued in the same millisecond", async () => {
    const v = await setupVenue();
    const table4 = await firedTable(v, "Mesa 4");
    const job = await jobFor(table4.tabId, v.kitchenPrinterId);
    await setJob(job, exhausted);
    await inTx((tx) => reprintOrderTickets(tx, v.cfg, table4.tabId));
    const reprint = (await links()).find((row) => row.reprint)!.printJobId;

    await setJob(reprint, { status: "done", createdAt: await createdAtOf(job) });
    expect(await problemsOf(table4.partyId)).toEqual([]);
  });

  it("decides which ticket came later by the order they were queued, not by their clock stamps", async () => {
    const v = await setupVenue();
    const table4 = await firedTable(v, "Mesa 4");
    const job = await jobFor(table4.tabId, v.kitchenPrinterId);
    await setJob(job, exhausted);
    await inTx((tx) => reprintOrderTickets(tx, v.cfg, table4.tabId));
    await inTx((tx) => reprintOrderTickets(tx, v.cfg, table4.tabId));
    const [first, second] = (await links()).filter((row) => row.reprint).map((r) => r.printJobId);
    // The first reprint printed, the second failed; the clock reads the first as the later one.
    await setJob(first!, { status: "done", createdAt: "2030-01-01T00:00:00.000Z" });
    await setJob(second!, exhausted);

    expect(await problemsOf(table4.partyId)).toMatchObject([
      {
        workingOrderId: table4.tabId,
        stationId: v.kitchenStationId,
        since: await createdAtOf(second!),
      },
    ]);

    // A reprint queued after the failure clears it, though its clock stamp is the earliest.
    await inTx((tx) => reprintOrderTickets(tx, v.cfg, table4.tabId));
    const third = (await links()).at(-1)!.printJobId;
    await setJob(third, { status: "done", createdAt: "2000-01-01T00:00:00.000Z" });
    expect(await problemsOf(table4.partyId)).toEqual([]);
  });

  it("follows the dishes when the bill whose ticket failed is merged into another table's bill", async () => {
    const v = await setupVenue();
    const table4 = await firedTable(v, "Mesa 4");
    const table5 = await firedTable(v, "Mesa 5");
    const job = await jobFor(table4.tabId, v.kitchenPrinterId);
    await setJob(job, exhausted);

    await mergeBills(v, table4, table5);

    expect(await problemsOf(table5.partyId)).toEqual([
      {
        workingOrderId: table5.tabId,
        stationId: v.kitchenStationId,
        stationName: "Cocina",
        since: await createdAtOf(job),
      },
    ]);
    expect((await stationCard(v.kitchenStationId, table5.tabId)).printProblem).toBe(true);

    // Mesa 5's bill now carries Mesa 4's dishes, so its reprint printing clears the problem.
    await inTx((tx) => reprintOrderTickets(tx, v.cfg, table5.tabId));
    await setJob((await links()).at(-1)!.printJobId, { status: "done" });
    expect(await problemsOf(table5.partyId)).toEqual([]);
  });

  it("keeps a failure merged in from another bill when the receiving bill was reprinted before the merge", async () => {
    const v = await setupVenue();
    const source = await firedTable(v, "Mesa 4");
    const destination = await firedTable(v, "Mesa 5");
    const failed = await jobFor(source.tabId, v.kitchenPrinterId);
    await setJob(failed, exhausted);
    await inTx((tx) => reprintOrderTickets(tx, v.cfg, destination.tabId));
    await setJob((await links()).at(-1)!.printJobId, { status: "done" });
    expect(await problemsOf(source.partyId)).toHaveLength(1);

    await mergeBills(v, source, destination);

    expect(await problemsOf(destination.partyId)).toEqual([
      {
        workingOrderId: destination.tabId,
        stationId: v.kitchenStationId,
        stationName: "Cocina",
        since: await createdAtOf(failed),
      },
    ]);
    expect((await stationCard(v.kitchenStationId, destination.tabId)).printProblem).toBe(true);
  });

  it("keeps the receiving bill's own failure when the merged bill's reprint printed before the merge", async () => {
    const v = await setupVenue();
    const source = await firedTable(v, "Mesa 4");
    const destination = await firedTable(v, "Mesa 5");
    const failed = await jobFor(destination.tabId, v.kitchenPrinterId);
    await setJob(failed, exhausted);
    await inTx((tx) => reprintOrderTickets(tx, v.cfg, source.tabId));
    await setJob((await links()).at(-1)!.printJobId, { status: "done" });

    await mergeBills(v, source, destination);

    expect(await problemsOf(destination.partyId)).toEqual([
      {
        workingOrderId: destination.tabId,
        stationId: v.kitchenStationId,
        stationName: "Cocina",
        since: await createdAtOf(failed),
      },
    ]);
    expect((await stationCard(v.kitchenStationId, destination.tabId)).printProblem).toBe(true);
  });

  it("keeps the receiving bill's own failure when the merged bill's reprint, waiting at the merge, prints after it", async () => {
    const v = await setupVenue();
    const source = await firedTable(v, "Mesa 4");
    const destination = await firedTable(v, "Mesa 5");
    const failed = await jobFor(destination.tabId, v.kitchenPrinterId);
    await setJob(failed, exhausted);
    await inTx((tx) => reprintOrderTickets(tx, v.cfg, source.tabId));
    const waiting = (await links()).at(-1)!.printJobId;

    await mergeBills(v, source, destination);
    await setJob(waiting, { status: "done" });

    expect(await problemsOf(destination.partyId)).toEqual([
      {
        workingOrderId: destination.tabId,
        stationId: v.kitchenStationId,
        stationName: "Cocina",
        since: await createdAtOf(failed),
      },
    ]);
    expect((await stationCard(v.kitchenStationId, destination.tabId)).printProblem).toBe(true);
  });

  it("does not bring back a merged bill's failure that its own reprint had already cleared", async () => {
    const v = await setupVenue();
    const source = await firedTable(v, "Mesa 4");
    const destination = await firedTable(v, "Mesa 5");
    await setJob(await jobFor(source.tabId, v.kitchenPrinterId), exhausted);
    await inTx((tx) => reprintOrderTickets(tx, v.cfg, source.tabId));
    await setJob((await links()).at(-1)!.printJobId, { status: "done" });
    expect(await problemsOf(source.partyId)).toEqual([]);

    await mergeBills(v, source, destination);

    expect(await problemsOf(destination.partyId)).toEqual([]);
    expect("printProblem" in (await stationCard(v.kitchenStationId, destination.tabId))).toBe(
      false,
    );
  });

  it("does not bring back a merged bill's failure that a printed resend of its failed Reprint had cleared", async () => {
    const v = await setupVenue();
    const source = await firedTable(v, "Mesa 4");
    const destination = await firedTable(v, "Mesa 5");
    await setJob(await jobFor(source.tabId, v.kitchenPrinterId), exhausted);
    await inTx((tx) => reprintOrderTickets(tx, v.cfg, source.tabId));
    const reprint = (await links()).at(-1)!.printJobId;
    await setJob(reprint, exhausted);
    const resend = await inTx((tx) => resendPrintJob(tx, reprint));
    await setJob(resend.jobId, { status: "done" });
    expect(await problemsOf(source.partyId)).toEqual([]);

    await mergeBills(v, source, destination);

    expect(await problemsOf(destination.partyId)).toEqual([]);
    expect(await waitingAt(v.kitchenPrinterId)).toBe(0);
  });

  it("raises no table problem for a failed job no kitchen ticket links, such as a receipt", async () => {
    const v = await setupVenue();
    const table4 = await firedTable(v, "Mesa 4");
    const { jobId } = await inTx((tx) =>
      enqueuePrintJob(tx, { locationId: v.cfg.locationId }, v.receiptPrinter, Uint8Array.from([1])),
    );
    await setJob(jobId, { ...exhausted, createdAt: "2026-01-01T00:00:00.000Z" });

    expect(await problemsOf(table4.partyId)).toEqual([]);
    expect("printProblem" in (await stationCard(v.kitchenStationId, table4.tabId))).toBe(false);
  });

  it("keeps another table's problem off Mesa 4", async () => {
    const v = await setupVenue();
    const table4 = await firedTable(v, "Mesa 4");
    const table5 = await firedTable(v, "Mesa 5");
    await setJob(await jobFor(table5.tabId, v.kitchenPrinterId), exhausted);

    expect(await problemsOf(table4.partyId)).toEqual([]);
    expect(await problemsOf(table5.partyId)).toMatchObject([{ workingOrderId: table5.tabId }]);
    expect("printProblem" in (await stationCard(v.kitchenStationId, table4.tabId))).toBe(false);
    expect((await stationCard(v.kitchenStationId, table5.tabId)).printProblem).toBe(true);
  });

  it("refuses party.not_open for a party that does not exist", async () => {
    await setupVenue();
    const partyId = randomUUID();
    await expect(problemsOf(partyId)).rejects.toMatchObject({
      code: "party.not_open",
      params: { partyId },
    });
  });
});

describe("the printer's alert after the till's Reprint (A167)", () => {
  it("counts a failed ticket while the till's Reprint waits, and drops it once the Reprint has printed", async () => {
    const v = await setupVenue();
    const table4 = await firedTable(v, "Mesa 4");
    await setJob(await jobFor(table4.tabId, v.kitchenPrinterId), exhausted);
    await inTx((tx) => reprintOrderTickets(tx, v.cfg, table4.tabId));
    const reprint = (await links()).find((row) => row.reprint)!.printJobId;
    expect(await waitingAt(v.kitchenPrinterId)).toBe(1);

    await setJob(reprint, { status: "done" });
    expect(await waitingAt(v.kitchenPrinterId)).toBe(0);
    expect(await problemsOf(table4.partyId)).toEqual([]);
  });

  it("counts both when the till's Reprint also runs out of attempts", async () => {
    const v = await setupVenue();
    const table4 = await firedTable(v, "Mesa 4");
    await setJob(await jobFor(table4.tabId, v.kitchenPrinterId), exhausted);
    await inTx((tx) => reprintOrderTickets(tx, v.cfg, table4.tabId));
    await setJob((await links()).find((row) => row.reprint)!.printJobId, exhausted);

    expect(await waitingAt(v.kitchenPrinterId)).toBe(2);
  });

  it("drops a failed ticket once a Printers-screen resend of its failed Reprint has printed", async () => {
    const v = await setupVenue();
    const table4 = await firedTable(v, "Mesa 4");
    await setJob(await jobFor(table4.tabId, v.kitchenPrinterId), exhausted);
    await inTx((tx) => reprintOrderTickets(tx, v.cfg, table4.tabId));
    const reprint = (await links()).at(-1)!.printJobId;
    await setJob(reprint, exhausted);
    const resend = await inTx((tx) => resendPrintJob(tx, reprint));
    expect(await waitingAt(v.kitchenPrinterId)).toBe(2);

    await setJob(resend.jobId, { status: "done" });
    expect(await waitingAt(v.kitchenPrinterId)).toBe(0);
    expect(await problemsOf(table4.partyId)).toEqual([]);
  });

  it("clears a two-bill ticket's problem on the bill whose failed Reprint's resend printed, and only there", async () => {
    const v = await setupVenue();
    const table4 = await firedTable(v, "Mesa 4", ["burger", "fish"]);
    await setJob(await jobFor(table4.tabId, v.kitchenPrinterId), exhausted);
    const lineNo = await lineNoOf(table4.tabId, "fish");
    const { billId: checkId } = await inTx(async (tx) =>
      splitBill(tx, v.cfg, table4.tabId, [{ lineNo }], {
        expectedPartyRevision: (await command(table4.partyId)).expectedPartyRevision,
        operatorId: ALEX,
      }),
    );
    await inTx((tx) => reprintOrderTickets(tx, v.cfg, checkId));
    const reprint = (await links()).at(-1)!;
    expect(reprint).toMatchObject({ workingOrderId: checkId, reprint: true });
    await setJob(reprint.printJobId, exhausted);
    const resend = await inTx((tx) => resendPrintJob(tx, reprint.printJobId));
    await setJob(resend.jobId, { status: "done" });

    // Mesa 4's own link to the original ticket has no Reprint yet.
    expect(await waitingAt(v.kitchenPrinterId)).toBe(1);
    expect(await problemsOf(table4.partyId)).toMatchObject([{ workingOrderId: table4.tabId }]);
  });

  it("keeps counting a failed ticket when the resend of its failed Reprint also runs out of attempts", async () => {
    const v = await setupVenue();
    const table4 = await firedTable(v, "Mesa 4");
    const original = await jobFor(table4.tabId, v.kitchenPrinterId);
    const earlier = new Date(Date.now() - 1000).toISOString();
    await setJob(original, { ...exhausted, createdAt: earlier });
    await inTx((tx) => reprintOrderTickets(tx, v.cfg, table4.tabId));
    const reprint = (await links()).at(-1)!.printJobId;
    await setJob(reprint, exhausted);
    const resend = await inTx((tx) => resendPrintJob(tx, reprint));

    await setJob(resend.jobId, exhausted);
    // The original ticket, the Reprint and its resend.
    expect(await waitingAt(v.kitchenPrinterId)).toBe(3);
    expect(await problemsOf(table4.partyId)).toMatchObject([
      { workingOrderId: table4.tabId, since: earlier },
    ]);
  });

  it("keeps counting a failed ticket when a later round's ticket prints, which is no Reprint", async () => {
    const v = await setupVenue();
    const table4 = await firedTable(v, "Mesa 4");
    await setJob(await jobFor(table4.tabId, v.kitchenPrinterId), exhausted);
    await submit(v, table4.partyId, [{ release: "fire", lines: [line(v, "fish")] }]);
    const later = (await links()).at(-1)!;
    expect(later).toMatchObject({ printerId: v.kitchenPrinterId, reprint: false });

    await setJob(later.printJobId, { status: "done" });
    expect(await waitingAt(v.kitchenPrinterId)).toBe(1);
  });

  it("drops a failed Reprint once a later Reprint has printed", async () => {
    const v = await setupVenue();
    const table4 = await firedTable(v, "Mesa 4");
    await setJob(await jobFor(table4.tabId, v.kitchenPrinterId), exhausted);
    await inTx((tx) => reprintOrderTickets(tx, v.cfg, table4.tabId));
    await setJob((await links()).at(-1)!.printJobId, exhausted);
    await inTx((tx) => reprintOrderTickets(tx, v.cfg, table4.tabId));
    expect(await waitingAt(v.kitchenPrinterId)).toBe(2);

    await setJob((await links()).at(-1)!.printJobId, { status: "done" });
    expect(await waitingAt(v.kitchenPrinterId)).toBe(0);
  });

  it("keeps counting a Reprint that runs out of attempts after an earlier Reprint printed", async () => {
    const v = await setupVenue();
    const table4 = await firedTable(v, "Mesa 4");
    await setJob(await jobFor(table4.tabId, v.kitchenPrinterId), exhausted);
    await inTx((tx) => reprintOrderTickets(tx, v.cfg, table4.tabId));
    await setJob((await links()).at(-1)!.printJobId, { status: "done" });
    await inTx((tx) => reprintOrderTickets(tx, v.cfg, table4.tabId));
    const failedAgain = (await links()).at(-1)!.printJobId;
    await setJob(failedAgain, exhausted);

    expect(await waitingAt(v.kitchenPrinterId)).toBe(1);
    expect(await problemsOf(table4.partyId)).toMatchObject([
      { workingOrderId: table4.tabId, since: await createdAtOf(failedAgain) },
    ]);
  });

  it("keeps counting a ticket linked to two bills until each bill's Reprint has printed", async () => {
    const v = await setupVenue();
    const table4 = await firedTable(v, "Mesa 4", ["burger", "fish"]);
    await setJob(await jobFor(table4.tabId, v.kitchenPrinterId), exhausted);
    const lineNo = await lineNoOf(table4.tabId, "fish");
    const { billId: checkId } = await inTx(async (tx) =>
      splitBill(tx, v.cfg, table4.tabId, [{ lineNo }], {
        expectedPartyRevision: (await command(table4.partyId)).expectedPartyRevision,
        operatorId: ALEX,
      }),
    );

    await reprintPrinted(v, checkId);
    expect(await waitingAt(v.kitchenPrinterId)).toBe(1);

    await reprintPrinted(v, table4.tabId);
    expect(await waitingAt(v.kitchenPrinterId)).toBe(0);
  });

  it("keeps counting a failed job no kitchen ticket links, such as a receipt", async () => {
    const v = await setupVenue();
    await firedTable(v, "Mesa 4");
    const { jobId } = await inTx((tx) =>
      enqueuePrintJob(
        tx,
        { locationId: v.cfg.locationId },
        v.kitchenPrinterId,
        Uint8Array.from([1]),
      ),
    );
    await setJob(jobId, exhausted);

    expect(await waitingAt(v.kitchenPrinterId)).toBe(1);
  });
});

describe("a failed HOLD ticket (service plan Task 6)", () => {
  const TIME = expect.stringMatching(/^\d\d:\d\d$/);
  const REPRINTED = expect.stringMatching(/^\*\*\* REPRINT \d\d:\d\d \*\*\*$/);

  it("shows on Mesa 4 and on its station's card, as a failed fire ticket does", async () => {
    const v = await holdingVenue();
    const table4 = await seated(v, "Mesa 4");
    await submit(v, table4.partyId, [{ release: "hold", lines: [line(v, "burger")] }]);
    const [hold] = await jobsAt(v.kitchenPrinterId);
    expect(hold!.lines[0]).toBe("*** HOLD ***");
    await setJob(hold!.id, exhausted);

    expect(await problemsOf(table4.partyId)).toEqual([
      {
        workingOrderId: table4.tabId,
        stationId: v.kitchenStationId,
        stationName: "Cocina",
        since: await createdAtOf(hold!.id),
      },
    ]);
    expect((await stationCard(v.kitchenStationId, table4.tabId)).printProblem).toBe(true);
  });

  it("is reprinted under REPRINT and HOLD on a party with nothing fired, and clears once that prints", async () => {
    const v = await holdingVenue();
    const table4 = await seated(v, "Mesa 4");
    await submit(v, table4.partyId, [{ release: "hold", lines: [line(v, "burger", "2")] }]);
    const [hold] = await jobsAt(v.kitchenPrinterId);
    await setJob(hold!.id, exhausted);

    await inTx((tx) => reprintOrderTickets(tx, v.cfg, table4.tabId));

    const [, reprint] = await jobsAt(v.kitchenPrinterId);
    expect(reprint!.lines).toEqual([
      REPRINTED,
      ...hold!.lines.slice(0, 4),
      TIME,
      "GROUP 1",
      `2.000 x ${DISHES.burger.kitchen}`,
    ]);
    expect(hold!.lines.slice(5)).toEqual(["GROUP 1", `2.000 x ${DISHES.burger.kitchen}`]);
    expect(await problemsOf(table4.partyId)).toHaveLength(1);

    await setJob(reprint!.id, { status: "done" });
    expect(await problemsOf(table4.partyId)).toEqual([]);
    expect("printProblem" in (await stationCard(v.kitchenStationId, table4.tabId))).toBe(false);
  });

  // Fails if the fired and held parts go out as two jobs: the later one's printing would clear every
  // earlier failure for that bill and station on that printer, including tickets it does not carry.
  it("reprints fired and held work as one job per printer, the held work alone under HOLD", async () => {
    const v = await holdingVenue();
    const table4 = await seated(v, "Mesa 4");
    await submit(v, table4.partyId, [
      { release: "fire", lines: [line(v, "burger")] },
      { release: "hold", lines: [line(v, "fish"), line(v, "beer")] },
    ]);
    const [fire, hold] = await jobsAt(v.kitchenPrinterId);
    const [barHold] = await jobsAt(v.barPrinterId);
    await setJob(fire!.id, exhausted);
    await setJob(hold!.id, exhausted);
    await setJob(barHold!.id, exhausted);
    const before = (await links()).length;

    await inTx((tx) => reprintOrderTickets(tx, v.cfg, table4.tabId));

    const head = (station: string) => [station, "Mesa 4", fire!.lines[2], TIME];
    const kitchenStationId = (await jobsAt(v.kitchenPrinterId)).slice(2);
    expect(kitchenStationId.map((job) => job.lines)).toEqual([
      [
        REPRINTED,
        ...head("Cocina"),
        "GROUP 1",
        `1.000 x ${DISHES.burger.kitchen}`,
        REPRINTED,
        "*** HOLD ***",
        ...head("Cocina"),
        "GROUP 2",
        `1.000 x ${DISHES.fish.kitchen}`,
      ],
    ]);
    const barStationId = (await jobsAt(v.barPrinterId)).slice(1);
    expect(barStationId.map((job) => job.lines)).toEqual([
      [REPRINTED, "*** HOLD ***", ...head("Barra"), "GROUP 2", `1.000 x ${DISHES.beer.kitchen}`],
    ]);
    expect(
      (await links()).slice(before).map((row) => [row.printJobId, row.stationId, row.reprint]),
    ).toEqual([
      [kitchenStationId[0]!.id, v.kitchenStationId, true],
      [barStationId[0]!.id, v.barStationId, true],
    ]);

    await setJob(kitchenStationId[0]!.id, { status: "done" });
    await setJob(barStationId[0]!.id, { status: "done" });
    expect(await problemsOf(table4.partyId)).toEqual([]);
  });

  // Fails if each part reads the clock itself: the HOLD part's first dish read comes after the
  // fired part's heading, and the spy moves the clock on there, so its heading would say 15:21.
  it("A808 a reprint reads its time once, for every part", async () => {
    const v = await holdingVenue();
    const table4 = await seated(v, "Mesa 4");
    await submit(v, table4.partyId, [
      { release: "fire", lines: [line(v, "burger")] },
      { release: "hold", lines: [line(v, "fish")] },
    ]);
    const before = (await jobsAt(v.kitchenPrinterId)).length;
    const real = VENUE_SERVICE.readLinesSoldInEach.bind(VENUE_SERVICE);
    let calls = 0;
    const between = vi
      .spyOn(VENUE_SERVICE, "readLinesSoldInEach")
      .mockImplementation(async (...args) => {
        calls += 1;
        if (calls === 2) vi.setSystemTime(new Date(2026, 9, 27, 15, 21));
        return real(...args);
      });
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(2026, 9, 27, 15, 20));
    try {
      await inTx((tx) => reprintOrderTickets(tx, v.cfg, table4.tabId));
    } finally {
      vi.useRealTimers();
      between.mockRestore();
    }

    expect(calls).toBeGreaterThanOrEqual(2);
    const [reprint] = (await jobsAt(v.kitchenPrinterId)).slice(before);
    expect(reprint!.lines.filter((text) => text.startsWith("*** REPRINT"))).toEqual([
      "*** REPRINT 15:20 ***",
      "*** REPRINT 15:20 ***",
    ]);
    expect(reprint!.lines).toContain("*** HOLD ***");
  });

  // Fails if a reprint prints the reprint time under the order, or the first-fired dish's time
  // rather than the earliest, or the HOLD part takes the fired part's time.
  it("A808 prints the reprint time in the heading and each part's original send time below the order", async () => {
    const v = await holdingVenue();
    const table4 = await seated(v, "Mesa 4");
    const { groups } = await submit(v, table4.partyId, [
      { release: "fire", lines: [line(v, "burger")] },
      { release: "hold", lines: [line(v, "fish")] },
    ]);
    await submit(v, table4.partyId, [{ release: "fire", lines: [line(v, "burger")] }]);
    const fired = await db
      .select({ id: ticketItems.id })
      .from(ticketItems)
      .where(and(eq(ticketItems.workingOrderId, table4.tabId), isNotNull(ticketItems.firedAt)))
      .orderBy(sql`rowid`);
    expect(fired).toHaveLength(2);
    const at = (hours: number, minutes: number) =>
      new Date(2026, 9, 27, hours, minutes).toISOString();
    await db
      .update(ticketItems)
      .set({ firedAt: at(14, 30) })
      .where(eq(ticketItems.id, fired[0]!.id));
    await db
      .update(ticketItems)
      .set({ firedAt: at(14, 5) })
      .where(eq(ticketItems.id, fired[1]!.id));
    await db
      .update(orderGroups)
      .set({ holdPrintedAt: at(14, 10) })
      .where(eq(orderGroups.id, groups[1]!.id));
    const before = (await jobsAt(v.kitchenPrinterId)).length;

    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(2026, 9, 27, 15, 20));
    try {
      await inTx((tx) => reprintOrderTickets(tx, v.cfg, table4.tabId));
    } finally {
      vi.useRealTimers();
    }

    const [reprint] = (await jobsAt(v.kitchenPrinterId)).slice(before);
    const lines = reprint!.lines;
    const heldAt = lines.lastIndexOf("*** REPRINT 15:20 ***");
    expect(heldAt).toBeGreaterThan(0);
    expect(lines.slice(0, 5)).toEqual([
      "*** REPRINT 15:20 ***",
      "Cocina",
      "Mesa 4",
      lines[3],
      "14:05",
    ]);
    expect(lines.slice(heldAt)).toEqual([
      "*** REPRINT 15:20 ***",
      "*** HOLD ***",
      "Cocina",
      "Mesa 4",
      lines[3],
      "14:10",
      "GROUP 2",
      `1.000 x ${DISHES.fish.kitchen}`,
    ]);
  });

  it("does not reprint a held group whose HOLD ticket was never queued", async () => {
    const v = await setupVenue();
    const table4 = await seated(v, "Mesa 4");
    await submit(v, table4.partyId, [
      { release: "fire", lines: [line(v, "burger")] },
      { release: "hold", lines: [line(v, "fish")] },
    ]);
    expect(await jobsAt(v.kitchenPrinterId)).toHaveLength(1);

    await inTx((tx) => reprintOrderTickets(tx, v.cfg, table4.tabId));

    const [fire, reprint] = await jobsAt(v.kitchenPrinterId);
    expect(reprint!.lines).toEqual([
      REPRINTED,
      ...fire!.lines.slice(0, 3),
      TIME,
      ...fire!.lines.slice(4),
    ]);
    expect(fire!.lines.at(-1)).toBe(`1.000 x ${DISHES.burger.kitchen}`);
  });

  it("reprints a fired group as fired work, not under HOLD, and that clears its failed HOLD ticket", async () => {
    const v = await holdingVenue();
    const table4 = await seated(v, "Mesa 4");
    const { groups } = await submit(v, table4.partyId, [
      { release: "hold", lines: [line(v, "burger")] },
    ]);
    await setJob((await jobsAt(v.kitchenPrinterId))[0]!.id, exhausted);
    await inTx(async (tx) =>
      fireGroup(tx, v.cfg, table4.partyId, groups[0]!.id, await command(table4.partyId)),
    );
    const [hold, fireSlip] = await jobsAt(v.kitchenPrinterId);
    expect(fireSlip!.lines[0]).toBe("*** FIRE ***");

    await inTx((tx) => reprintOrderTickets(tx, v.cfg, table4.tabId));

    const [, , reprint] = await jobsAt(v.kitchenPrinterId);
    expect(reprint!.lines).toEqual([
      REPRINTED,
      ...hold!.lines.slice(1, 4),
      TIME,
      ...hold!.lines.slice(5),
    ]);
    await setJob(reprint!.id, { status: "done" });
    expect(await problemsOf(table4.partyId)).toEqual([]);
  });

  it("does not reprint under HOLD a line recalled from a fired group whose HOLD ticket was queued", async () => {
    const v = await holdingVenue();
    const table4 = await seated(v, "Mesa 4");
    const { groups } = await submit(v, table4.partyId, [
      { release: "hold", lines: [line(v, "burger"), line(v, "fish")] },
    ]);
    await inTx(async (tx) =>
      fireGroup(tx, v.cfg, table4.partyId, groups[0]!.id, await command(table4.partyId)),
    );
    const fish = await lineNoOf(table4.tabId, "fish");
    await inTx((tx) => recallLines(tx, v.cfg, table4.tabId, [fish]));
    const before = (await jobsAt(v.kitchenPrinterId)).length;

    await inTx((tx) => reprintOrderTickets(tx, v.cfg, table4.tabId));

    const reprints = (await jobsAt(v.kitchenPrinterId)).slice(before).map((job) => job.lines);
    expect(reprints).toEqual([
      [
        REPRINTED,
        "Cocina",
        "Mesa 4",
        expect.any(String),
        TIME,
        "GROUP 1",
        `1.000 x ${DISHES.burger.kitchen}`,
      ],
    ]);
  });

  it("follows the held dishes when their bill is merged into another table's, and clears by that bill's reprint", async () => {
    const v = await holdingVenue();
    const table4 = await seated(v, "Mesa 4");
    await submit(v, table4.partyId, [{ release: "hold", lines: [line(v, "burger")] }]);
    const [hold] = await jobsAt(v.kitchenPrinterId);
    await setJob(hold!.id, exhausted);
    const table5 = await firedTable(v, "Mesa 5", ["fish"]);

    await mergeBills(v, table4, table5);

    expect(await problemsOf(table5.partyId)).toEqual([
      {
        workingOrderId: table5.tabId,
        stationId: v.kitchenStationId,
        stationName: "Cocina",
        since: await createdAtOf(hold!.id),
      },
    ]);
    expect((await stationCard(v.kitchenStationId, table5.tabId)).printProblem).toBe(true);

    await inTx((tx) => reprintOrderTickets(tx, v.cfg, table5.tabId));
    const reprint = (await jobsAt(v.kitchenPrinterId)).at(-1)!;
    // Both tables now seat the merged bill and the header names them together (spec decision 9);
    // their order is not this test's subject.
    const table = expect.stringMatching(/^Mesa (4, 5|5, 4)$/);
    expect(reprint.lines).toEqual([
      REPRINTED,
      "Cocina",
      table,
      expect.any(String),
      TIME,
      expect.stringMatching(/^GROUP 1 · Mesa (4, 5|5, 4)$/),
      `1.000 x ${DISHES.fish.kitchen}`,
      REPRINTED,
      "*** HOLD ***",
      "Cocina",
      table,
      expect.any(String),
      TIME,
      "GROUP 1 · Mesa 4",
      `1.000 x ${DISHES.burger.kitchen}`,
    ]);
    await setJob(reprint.id, { status: "done" });
    expect(await problemsOf(table5.partyId)).toEqual([]);
  });

  it("raises no problem for a failed HOLD correction slip, as for every correction slip", async () => {
    const v = await holdingVenue();
    const table4 = await seated(v, "Mesa 4");
    await submit(v, table4.partyId, [
      { release: "hold", lines: [line(v, "burger"), line(v, "fish")] },
    ]);
    await voidDish(v, table4, "fish");
    const [, slip] = await jobsAt(v.kitchenPrinterId);
    expect(slip!.lines[0]).toBe("*** HOLD CANCELLED ***");
    const linked = (await links()).map((row) => row.printJobId);

    await setJob(slip!.id, exhausted);

    expect(linked).not.toContain(slip!.id);
    expect(await problemsOf(table4.partyId)).toEqual([]);
    expect("printProblem" in (await stationCard(v.kitchenStationId, table4.tabId))).toBe(false);
  });
});

describe("a printing problem a Reprint would print nothing for", () => {
  it("clears a failed fire ticket once every dish it carried for that station is voided", async () => {
    const v = await setupVenue();
    const table4 = await firedTable(v, "Mesa 4", ["burger", "beer"]);
    await setJob(await jobFor(table4.tabId, v.kitchenPrinterId), exhausted);
    expect(await problemsOf(table4.partyId)).toMatchObject([{ stationId: v.kitchenStationId }]);
    expect(await stationSees(v.kitchenStationId, table4.tabId)).toBe(true);

    await voidDish(v, table4, "burger");

    expect(await problemsOf(table4.partyId)).toEqual([]);
    expect(await stationSees(v.kitchenStationId, table4.tabId)).toBe(false);
    // What the rule stands on: a Reprint of the bill prints nothing on the Cocina printer now.
    const before = (await links()).length;
    await inTx((tx) => reprintOrderTickets(tx, v.cfg, table4.tabId));
    expect((await links()).slice(before).map((row) => [row.printerId, row.stationId])).toEqual([
      [v.barPrinterId, v.barStationId],
    ]);
  });

  it("clears a failed HOLD ticket once every held dish it carried for that station is voided", async () => {
    const v = await holdingVenue();
    const table4 = await seated(v, "Mesa 4");
    await submit(v, table4.partyId, [{ release: "hold", lines: [line(v, "burger")] }]);
    await setJob(await jobFor(table4.tabId, v.kitchenPrinterId), exhausted);
    expect(await problemsOf(table4.partyId)).toMatchObject([{ stationId: v.kitchenStationId }]);
    expect(await stationSees(v.kitchenStationId, table4.tabId)).toBe(true);

    await voidDish(v, table4, "burger");

    expect(await problemsOf(table4.partyId)).toEqual([]);
    expect(await stationSees(v.kitchenStationId, table4.tabId)).toBe(false);
    // What the rule stands on: a Reprint of the bill prints nothing at all now.
    const before = (await links()).length;
    await inTx((tx) => reprintOrderTickets(tx, v.cfg, table4.tabId));
    expect((await links()).slice(before)).toEqual([]);
  });

  it("keeps a failed ticket whose station still has a dish to reprint after other dishes are voided, until the Reprint prints", async () => {
    const v = await setupVenue();
    const table4 = await firedTable(v, "Mesa 4", ["burger", "fish", "beer"]);
    const failed = await jobFor(table4.tabId, v.kitchenPrinterId);
    await setJob(failed, exhausted);

    await voidDish(v, table4, "fish");
    await voidDish(v, table4, "beer");

    expect(await problemsOf(table4.partyId)).toEqual([
      {
        workingOrderId: table4.tabId,
        stationId: v.kitchenStationId,
        stationName: "Cocina",
        since: await createdAtOf(failed),
      },
    ]);
    expect((await stationCard(v.kitchenStationId, table4.tabId)).printProblem).toBe(true);

    await reprintPrinted(v, table4.tabId);
    expect(await problemsOf(table4.partyId)).toEqual([]);
  });

  it("keeps showing a failed ticket while its printer is switched off, and clears it once the printer is back on and a Reprint prints", async () => {
    const v = await setupVenue();
    const table4 = await firedTable(v, "Mesa 4", ["burger", "beer"]);
    const failed = await jobFor(table4.tabId, v.kitchenPrinterId);
    await setJob(failed, exhausted);
    const printerCfg = { locationId: v.cfg.locationId };

    await inTx((tx) => deactivatePrinter(tx, printerCfg, v.kitchenPrinterId));

    const problem = {
      workingOrderId: table4.tabId,
      stationId: v.kitchenStationId,
      stationName: "Cocina",
      since: await createdAtOf(failed),
    };
    expect(await problemsOf(table4.partyId)).toEqual([problem]);
    expect(await stationSees(v.kitchenStationId, table4.tabId)).toBe(true);

    // A Reprint prints on switched-on printers only, so it cannot clear the problem yet.
    const before = (await links()).length;
    await inTx((tx) => reprintOrderTickets(tx, v.cfg, table4.tabId));
    const whileOff = (await links()).slice(before);
    expect(whileOff.map((row) => [row.printerId, row.stationId])).toEqual([
      [v.barPrinterId, v.barStationId],
    ]);
    await setJob(whileOff[0]!.printJobId, { status: "done" });
    expect(await problemsOf(table4.partyId)).toEqual([problem]);

    await inTx((tx) => updatePrinter(tx, printerCfg, v.kitchenPrinterId, { active: true }));
    await reprintPrinted(v, table4.tabId);
    expect(await problemsOf(table4.partyId)).toEqual([]);
    expect(await stationSees(v.kitchenStationId, table4.tabId)).toBe(false);
  });

  it("drops a failed ticket once its printer is detached from the station", async () => {
    const v = await setupVenue();
    const table4 = await firedTable(v, "Mesa 4", ["burger", "beer"]);
    await setJob(await jobFor(table4.tabId, v.kitchenPrinterId), exhausted);
    expect(await problemsOf(table4.partyId)).toMatchObject([{ stationId: v.kitchenStationId }]);

    await inTx((tx) =>
      detachPrinterFromStation(
        tx,
        { locationId: v.cfg.locationId },
        { stationId: v.kitchenStationId, printerId: v.kitchenPrinterId },
      ),
    );

    expect(await problemsOf(table4.partyId)).toEqual([]);
    expect(await stationSees(v.kitchenStationId, table4.tabId)).toBe(false);
  });
});

describe("a printing problem whose dishes move to another bill", () => {
  /**
   * The dish, or `quantity` of it, goes from `from`'s bill onto `to`'s as items reach another party:
   * split onto a new bill, which then moves to `to`'s table and merges into its main bill.
   */
  async function transferDish(v: Venue, from: Seated, to: Seated, dish: Dish, quantity?: string) {
    const lineNo = await lineNoOf(from.tabId, dish);
    const { billId } = await inTx(async (tx) =>
      splitBill(tx, v.cfg, from.tabId, [{ lineNo, quantity }], {
        expectedPartyRevision: (await command(from.partyId)).expectedPartyRevision,
        operatorId: ALEX,
      }),
    );
    const moved = await inTx(async (tx) =>
      moveBill(
        tx,
        v.cfg,
        billId,
        { tableId: to.tableId },
        {
          bills: "merge",
          partyId: from.partyId,
          expectedPartyRevision: (await command(from.partyId)).expectedPartyRevision,
          otherPartyId: to.partyId,
          expectedOtherPartyRevision: (await command(to.partyId)).expectedPartyRevision,
          operatorId: ALEX,
        },
      ),
    );
    expect(moved).toEqual({ partyId: to.partyId, billId: to.tabId, merged: true });
  }

  it("shows a failed ticket on the check its dish was split off to, and clears it by the check's Reprint", async () => {
    const v = await setupVenue();
    const table4 = await firedTable(v, "Mesa 4", ["burger", "beer"]);
    const failed = await jobFor(table4.tabId, v.kitchenPrinterId);
    await setJob(failed, exhausted);

    const lineNo = await lineNoOf(table4.tabId, "burger");
    const { billId: checkId } = await inTx(async (tx) =>
      splitBill(tx, v.cfg, table4.tabId, [{ lineNo }], {
        expectedPartyRevision: (await command(table4.partyId)).expectedPartyRevision,
        operatorId: ALEX,
      }),
    );

    expect(await problemsOf(table4.partyId)).toEqual([
      {
        workingOrderId: checkId,
        stationId: v.kitchenStationId,
        stationName: "Cocina",
        since: await createdAtOf(failed),
      },
    ]);
    expect(await stationSees(v.kitchenStationId, checkId)).toBe(true);
    expect(await stationSees(v.kitchenStationId, table4.tabId)).toBe(false);

    await reprintPrinted(v, checkId);
    expect(await problemsOf(table4.partyId)).toEqual([]);
    expect(await stationSees(v.kitchenStationId, checkId)).toBe(false);
  });

  it("shows a failed ticket on the table its dish was transferred to, and clears it by that bill's Reprint", async () => {
    const v = await setupVenue();
    const table4 = await firedTable(v, "Mesa 4", ["burger", "beer"]);
    const table5 = await firedTable(v, "Mesa 5", ["fish"]);
    const failed = await jobFor(table4.tabId, v.kitchenPrinterId);
    await setJob(failed, exhausted);
    // Mesa 5's own ticket printed, and so did a Reprint of it before the move, which never
    // carried the burger.
    await setJob(await jobFor(table5.tabId, v.kitchenPrinterId), { status: "done" });
    await reprintPrinted(v, table5.tabId);

    await transferDish(v, table4, table5, "burger");

    expect(await problemsOf(table5.partyId)).toEqual([
      {
        workingOrderId: table5.tabId,
        stationId: v.kitchenStationId,
        stationName: "Cocina",
        since: await createdAtOf(failed),
      },
    ]);
    expect(await stationSees(v.kitchenStationId, table5.tabId)).toBe(true);
    expect(await problemsOf(table4.partyId)).toEqual([]);

    await reprintPrinted(v, table5.tabId);
    expect(await problemsOf(table5.partyId)).toEqual([]);
    expect(await stationSees(v.kitchenStationId, table5.tabId)).toBe(false);
  });

  it("keeps the failure on both bills when part of the dish moves, and each bill's Reprint clears only its own", async () => {
    const v = await setupVenue();
    const table4 = await seated(v, "Mesa 4");
    await submit(v, table4.partyId, [{ release: "fire", lines: [line(v, "burger", "2")] }]);
    const table5 = await seated(v, "Mesa 5");
    const failed = await jobFor(table4.tabId, v.kitchenPrinterId);
    await setJob(failed, exhausted);

    await transferDish(v, table4, table5, "burger", "1");

    const problem = {
      stationId: v.kitchenStationId,
      stationName: "Cocina",
      since: await createdAtOf(failed),
    };
    expect(await problemsOf(table4.partyId)).toEqual([
      { workingOrderId: table4.tabId, ...problem },
    ]);
    expect(await problemsOf(table5.partyId)).toEqual([
      { workingOrderId: table5.tabId, ...problem },
    ]);

    await reprintPrinted(v, table5.tabId);
    expect(await problemsOf(table5.partyId)).toEqual([]);
    expect(await problemsOf(table4.partyId)).toEqual([
      { workingOrderId: table4.tabId, ...problem },
    ]);
    expect(await stationSees(v.kitchenStationId, table4.tabId)).toBe(true);
  });

  it("does not show the source bill's failure at a station none of the moved dishes go to", async () => {
    const v = await setupVenue();
    const table4 = await firedTable(v, "Mesa 4", ["burger", "beer"]);
    const table5 = await firedTable(v, "Mesa 5", ["beer"]);
    await setJob(await jobFor(table4.tabId, v.barPrinterId), exhausted);
    await setJob(await jobFor(table5.tabId, v.barPrinterId), { status: "done" });

    await transferDish(v, table4, table5, "burger");

    expect(await problemsOf(table5.partyId)).toEqual([]);
    expect(await problemsOf(table4.partyId)).toMatchObject([
      { workingOrderId: table4.tabId, stationId: v.barStationId },
    ]);
  });

  it("does not carry a failure whose ticket carried only dishes that stayed behind", async () => {
    const v = await setupVenue();
    const table4 = await firedTable(v, "Mesa 4", ["burger"]);
    const table5 = await seated(v, "Mesa 5");
    await setJob(await jobFor(table4.tabId, v.kitchenPrinterId), { status: "done" });
    await submit(v, table4.partyId, [{ release: "fire", lines: [line(v, "fish")] }]);
    const fishTicket = (await links()).at(-1)!;
    expect([fishTicket.workingOrderId, fishTicket.printerId]).toEqual([
      table4.tabId,
      v.kitchenPrinterId,
    ]);
    await setJob(fishTicket.printJobId, exhausted);

    await transferDish(v, table4, table5, "burger");

    expect(await problemsOf(table5.partyId)).toEqual([]);
    expect(await stationSees(v.kitchenStationId, table5.tabId)).toBe(false);
    expect(await problemsOf(table4.partyId)).toEqual([
      {
        workingOrderId: table4.tabId,
        stationId: v.kitchenStationId,
        stationName: "Cocina",
        since: await createdAtOf(fishTicket.printJobId),
      },
    ]);
  });

  it("carries a failure to the bill the dish its ticket carried moves to", async () => {
    const v = await setupVenue();
    const table4 = await firedTable(v, "Mesa 4", ["burger"]);
    const table5 = await seated(v, "Mesa 5");
    await setJob(await jobFor(table4.tabId, v.kitchenPrinterId), { status: "done" });
    await submit(v, table4.partyId, [{ release: "fire", lines: [line(v, "fish")] }]);
    const fishTicket = (await links()).at(-1)!;
    await setJob(fishTicket.printJobId, exhausted);

    await transferDish(v, table4, table5, "fish");

    expect(await problemsOf(table5.partyId)).toEqual([
      {
        workingOrderId: table5.tabId,
        stationId: v.kitchenStationId,
        stationName: "Cocina",
        since: await createdAtOf(fishTicket.printJobId),
      },
    ]);
  });

  it("shows a failure on both bills when its ticket carried a dish that moved and one that stayed", async () => {
    const v = await setupVenue();
    const table4 = await firedTable(v, "Mesa 4", ["burger", "fish"]);
    const table5 = await seated(v, "Mesa 5");
    const failed = await jobFor(table4.tabId, v.kitchenPrinterId);
    await setJob(failed, exhausted);

    await transferDish(v, table4, table5, "burger");

    const problem = {
      stationId: v.kitchenStationId,
      stationName: "Cocina",
      since: await createdAtOf(failed),
    };
    expect(await problemsOf(table4.partyId)).toEqual([
      { workingOrderId: table4.tabId, ...problem },
    ]);
    expect(await problemsOf(table5.partyId)).toEqual([
      { workingOrderId: table5.tabId, ...problem },
    ]);
  });

  it("carries a failure on with the part of a dish split off to another bill when that part moves again", async () => {
    const v = await setupVenue();
    const table4 = await seated(v, "Mesa 4");
    await submit(v, table4.partyId, [{ release: "fire", lines: [line(v, "burger", "2")] }]);
    const table5 = await seated(v, "Mesa 5");
    const table6 = await seated(v, "Mesa 6");
    const failed = await jobFor(table4.tabId, v.kitchenPrinterId);
    await setJob(failed, exhausted);

    await transferDish(v, table4, table5, "burger", "1");
    await transferDish(v, table5, table6, "burger");

    expect(await problemsOf(table6.partyId)).toEqual([
      {
        workingOrderId: table6.tabId,
        stationId: v.kitchenStationId,
        stationName: "Cocina",
        since: await createdAtOf(failed),
      },
    ]);
  });

  it("carries a failed Reprint to the bill a dish it carried moves to", async () => {
    const v = await setupVenue();
    const table4 = await firedTable(v, "Mesa 4", ["burger"]);
    const table5 = await seated(v, "Mesa 5");
    await setJob(await jobFor(table4.tabId, v.kitchenPrinterId), { status: "done" });
    await inTx((tx) => reprintOrderTickets(tx, v.cfg, table4.tabId));
    const reprint = (await links()).at(-1)!;
    expect([reprint.printerId, reprint.reprint]).toEqual([v.kitchenPrinterId, true]);
    await setJob(reprint.printJobId, exhausted);

    await transferDish(v, table4, table5, "burger");

    expect(await problemsOf(table5.partyId)).toEqual([
      {
        workingOrderId: table5.tabId,
        stationId: v.kitchenStationId,
        stationName: "Cocina",
        since: await createdAtOf(reprint.printJobId),
      },
    ]);
  });

  it("clears by a Reprint queued before some of the held dishes moved to a new group of the same bill", async () => {
    const v = await holdingVenue();
    const table4 = await seated(v, "Mesa 4");
    await submit(v, table4.partyId, [{ release: "hold", lines: [line(v, "burger", "2")] }]);
    await setJob(await jobFor(table4.tabId, v.kitchenPrinterId), exhausted);
    await inTx((tx) => reprintOrderTickets(tx, v.cfg, table4.tabId));
    const reprint = (await links()).at(-1)!;
    expect([reprint.printerId, reprint.stationId, reprint.reprint]).toEqual([
      v.kitchenPrinterId,
      v.kitchenStationId,
      true,
    ]);
    const [burger] = await db
      .select({ id: workingOrderLines.id })
      .from(workingOrderLines)
      .where(eq(workingOrderLines.name, DISHES.burger.staff));
    const moved = await command(table4.partyId);

    await inTx((tx) =>
      moveLinesToGroup(
        tx,
        v.cfg,
        table4.partyId,
        [{ lineId: burger!.id, quantity: "1" }],
        "new",
        moved,
      ),
    );

    expect(await problemsOf(table4.partyId)).toMatchObject([{ stationId: v.kitchenStationId }]);
    await setJob(reprint.printJobId, { status: "done" });
    expect(await problemsOf(table4.partyId)).toEqual([]);
    expect(await stationSees(v.kitchenStationId, table4.tabId)).toBe(false);
  });

  it("merges a bill onto one already carrying its failure, and moves a dish back onto the bill it left", async () => {
    const v = await setupVenue();
    const table4 = await firedTable(v, "Mesa 4", ["burger", "fish"]);
    const table5 = await firedTable(v, "Mesa 5", ["beer"]);
    const failed = await jobFor(table4.tabId, v.kitchenPrinterId);
    await setJob(failed, exhausted);
    const problem = {
      stationId: v.kitchenStationId,
      stationName: "Cocina",
      since: await createdAtOf(failed),
    };

    await transferDish(v, table4, table5, "burger");
    await transferDish(v, table5, table4, "burger");
    expect(await problemsOf(table4.partyId)).toEqual([
      { workingOrderId: table4.tabId, ...problem },
    ]);

    await transferDish(v, table4, table5, "burger");
    await mergeBills(v, table4, table5);
    expect(await problemsOf(table5.partyId)).toEqual([
      { workingOrderId: table5.tabId, ...problem },
    ]);

    await reprintPrinted(v, table5.tabId);
    expect(await problemsOf(table5.partyId)).toEqual([]);
  });
});

describe("a printing problem on a printer two stations share (A366)", () => {
  /** A station printer Cocina and Barra both list, beside each one's own. */
  async function sharedPrinter(v: Venue): Promise<string> {
    return inTx(async (tx) => {
      const { id } = await createPrinter(
        tx,
        { locationId: v.cfg.locationId },
        { name: "Compartida", transport: "cloud_poll", pollId: `poll-${randomUUID()}` },
      );
      await attachPrinterToStation(tx, {
        locationId: v.cfg.locationId,
        stationId: v.kitchenStationId,
        printerId: id,
      });
      await attachPrinterToStation(tx, {
        locationId: v.cfg.locationId,
        stationId: v.barStationId,
        printerId: id,
      });
      return id;
    });
  }

  // Fired work on the shared printer covers Barra and Cocina, held work only Cocina: the Reprint
  // still goes there as one job.
  it("shows a failed combined ticket on both stations' cards, and one Reprint there clears both", async () => {
    const v = await holdingVenue();
    const shared = await sharedPrinter(v);
    const table4 = await seated(v, "Mesa 4");
    await submit(v, table4.partyId, [
      { release: "fire", lines: [line(v, "burger"), line(v, "beer")] },
      { release: "hold", lines: [line(v, "fish")] },
    ]);
    const sent = await jobsAt(shared);
    expect(sent).toHaveLength(2);
    for (const job of sent) await setJob(job.id, exhausted);

    expect((await problemsOf(table4.partyId)).map((p) => p.stationId).sort()).toEqual(
      [v.barStationId, v.kitchenStationId].sort(),
    );
    expect((await stationCard(v.kitchenStationId, table4.tabId)).printProblem).toBe(true);
    expect((await stationCard(v.barStationId, table4.tabId)).printProblem).toBe(true);

    const before = (await links()).length;
    await inTx((tx) => reprintOrderTickets(tx, v.cfg, table4.tabId));

    const reprints = (await jobsAt(shared)).slice(sent.length);
    expect(reprints).toHaveLength(1);
    expect(
      (await links())
        .slice(before)
        .filter((row) => row.printerId === shared)
        .map((row) => [row.printJobId, row.stationId, row.reprint])
        .sort(),
    ).toEqual(
      [
        [reprints[0]!.id, v.barStationId, true],
        [reprints[0]!.id, v.kitchenStationId, true],
      ].sort(),
    );
    expect(await linesCarried(reprints[0]!.id)).toEqual(
      [DISHES.beer.staff, DISHES.burger.staff, DISHES.fish.staff].sort(),
    );
    expect(await problemsOf(table4.partyId)).toHaveLength(2);

    await setJob(reprints[0]!.id, { status: "done" });
    expect(await problemsOf(table4.partyId)).toEqual([]);
    expect(await stationSees(v.kitchenStationId, table4.tabId)).toBe(false);
    expect(await stationSees(v.barStationId, table4.tabId)).toBe(false);
  });

  it("drops one station's problem there once a Reprint would carry nothing for it, and keeps the other's", async () => {
    const v = await setupVenue();
    const shared = await sharedPrinter(v);
    const table4 = await firedTable(v, "Mesa 4", ["burger", "beer"]);
    const [combined] = await jobsAt(shared);
    await setJob(combined!.id, exhausted);
    expect(await stationSees(v.barStationId, table4.tabId)).toBe(true);

    await voidDish(v, table4, "beer");

    expect(await problemsOf(table4.partyId)).toMatchObject([{ stationId: v.kitchenStationId }]);
    expect(await stationSees(v.kitchenStationId, table4.tabId)).toBe(true);
    expect(await stationSees(v.barStationId, table4.tabId)).toBe(false);
  });

  it("a pass printer's printed reprint does not clear a station printer's failed ticket", async () => {
    const v = await setupVenue();
    const pass = await sharedPrinter(v);
    const table4 = await firedTable(v, "Mesa 4");
    await setJob(await jobFor(table4.tabId, v.kitchenPrinterId), exhausted);
    await setJob(await jobFor(table4.tabId, pass), { status: "done" });

    const before = (await links()).length;
    await inTx((tx) => reprintOrderTickets(tx, v.cfg, table4.tabId));
    const passReprints = (await links())
      .slice(before)
      .filter((row) => row.printerId === pass)
      .map((row) => row.printJobId);
    expect(passReprints.length).toBeGreaterThan(0);
    for (const id of passReprints) await setJob(id, { status: "done" });

    expect(await problemsOf(table4.partyId)).toMatchObject([
      { workingOrderId: table4.tabId, stationId: v.kitchenStationId },
    ]);
    expect(await waitingAt(v.kitchenPrinterId)).toBe(1);
  });
});

/** The staff names of the lines `printJobId` recorded carrying, sorted. */
async function linesCarried(printJobId: string): Promise<string[]> {
  const rows = await db
    .select({ name: workingOrderLines.name })
    .from(kitchenPrintJobLines)
    .innerJoin(workingOrderLines, eq(workingOrderLines.id, kitchenPrintJobLines.workingOrderLineId))
    .where(eq(kitchenPrintJobLines.printJobId, printJobId));
  return rows.map((row) => row.name).sort();
}

/** Whether the station's own read, which its cards use, finds a problem on `orderId`. */
function stationSees(stationId: string, orderId: string): Promise<boolean> {
  return inTx(async (tx) =>
    (await ordersWithPrintProblem(tx, stationId, [orderId], new Date())).has(orderId),
  );
}

/** A venue that prints held groups in advance. */
async function holdingVenue(): Promise<Venue> {
  const v = await setupVenue();
  await inTx((tx) => setStationPrinting(tx, { printHeldWork: true }));
  return v;
}

/** The line number of `dish` on the bill `orderId`. */
async function lineNoOf(orderId: string, dish: Dish): Promise<number> {
  const [row] = await db
    .select({ lineNo: workingOrderLines.lineNo })
    .from(workingOrderLines)
    .where(
      and(
        eq(workingOrderLines.workingOrderId, orderId),
        eq(workingOrderLines.name, DISHES[dish].staff),
      ),
    );
  return row!.lineNo;
}

/** Void `dish`'s line on `s`'s bill. */
async function voidDish(v: Venue, s: Seated, dish: Dish): Promise<void> {
  const lineNo = await lineNoOf(s.tabId, dish);
  await inTx((tx) => cancelLine(tx, v.cfg, s.tabId, lineNo, undefined, ALEX));
}

/** Reprint `orderId` and mark every job the reprint queued as printed. */
async function reprintPrinted(v: Venue, orderId: string): Promise<void> {
  const before = (await links()).length;
  await inTx((tx) => reprintOrderTickets(tx, v.cfg, orderId));
  const reprints = (await links()).slice(before);
  expect(reprints.length).toBeGreaterThan(0);
  for (const row of reprints) await setJob(row.printJobId, { status: "done" });
}

/**
 * Merge `source`'s bill into `destination`'s: `destination`'s party joins `source`'s table, which
 * combines the parties and merges their main bills.
 */
async function mergeBills(v: Venue, source: Seated, destination: Seated): Promise<void> {
  const merge = {
    bills: "merge" as const,
    expectedPartyRevision: (await command(destination.partyId)).expectedPartyRevision,
    otherPartyId: source.partyId,
    expectedOtherPartyRevision: (await command(source.partyId)).expectedPartyRevision,
    operatorId: ALEX,
  };
  const result = await inTx((tx) =>
    joinTables(tx, v.cfg, destination.partyId, source.tableId, merge),
  );
  expect(result).toEqual({
    partyId: destination.partyId,
    mainBillId: destination.tabId,
    merged: true,
  });
}
