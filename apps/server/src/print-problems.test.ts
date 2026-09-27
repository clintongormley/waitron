import { randomUUID } from "node:crypto";
import { asc, eq, sql } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import {
  kitchenPrintJobs,
  locations,
  printJobs,
  tills,
  visits,
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
  enqueuePrintJob,
  MAX_DELIVERY_ATTEMPTS,
  updatePrinter,
} from "@waitron/printing";
import {
  locationId as brandLocationId,
  nodeId as brandNodeId,
  seriesId as brandSeriesId,
  tillId as brandTillId,
} from "@waitron/shared";
import type { TillConfig } from "./till-config.js";
import { createStation, setProductStation } from "./kitchen.js";
import { attachPrinterToStation } from "./station-printers.js";
import { createTable } from "./tables.js";
import { listPrintProblems, reprintOrderTickets } from "./kitchen-print.js";
import { seedLegacySellingUnits } from "./testing/seed-units.js";
import { offerProducts } from "./testing/zone-offers.js";
import {
  listStationQueue,
  mergeTabs,
  recallLines,
  splitOffCheck,
  voidTabLine,
} from "./working-order.js";
import { readVisitBills, seatTable } from "./visits.js";
import {
  fireGroup,
  listOrderGroups,
  submitGroups,
  type GroupLine,
  type GroupRelease,
} from "./order-groups.js";
import { JOBS_WAITING_MS } from "./print-job-trouble.js";
import { printedLines } from "./testing/decode-ticket.js";
import { writePrintHeldWork } from "@waitron/venue-service";
import "./errors.js";

// Review Focus 6: a kitchen ticket that failed or is stuck shows as a printing problem on the table
// and on its station's card, never refuses the next order, and clears once a reprint has printed.

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
  cfg: TillConfig;
  cocina: string;
  barra: string;
  cocinaPrinter: string;
  barraPrinter: string;
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
  const cocina = await seedKitchenStation(db, { locationId: brandLocationId(locationId) });
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
    const { id: barra } = await createStation(tx, cfg, { name: "Barra" });
    const catalogue = await createCatalogue(tx, { name: "Carta" });
    const category = await createCategory(tx, { name: { en: "Platos" } });
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
    await setProductStation(tx, cfg, productId.beer, barra);
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
    const cocinaPrinter = await printer("Cocina");
    const barraPrinter = await printer("Barra");
    const receiptPrinter = await printer("Recibos");
    await attachPrinterToStation(tx, { stationId: cocina, printerId: cocinaPrinter });
    await attachPrinterToStation(tx, { stationId: barra, printerId: barraPrinter });
    return {
      cfg,
      cocina,
      barra,
      cocinaPrinter,
      barraPrinter,
      receiptPrinter,
      zoneId: offers.zoneId,
      offer: (dish: Dish) => offers.offerFor(productId[dish]),
    };
  });
}

interface Seated {
  visitId: string;
  tabId: string;
}

async function seated(v: Venue, label: string): Promise<Seated> {
  return inTx(async (tx) => {
    const { id: tableId } = await createTable(tx, v.cfg, { label, zoneId: v.zoneId });
    const { visitId, tabId } = await seatTable(tx, v.cfg, {
      tableId,
      guestCount: 2,
      operatorId: ALEX,
    });
    return { visitId, tabId };
  });
}

const line = (v: Venue, dish: Dish, quantity = "1"): GroupLine => ({
  menuItemId: v.offer(dish),
  quantity,
});

async function command(visitId: string) {
  const [row] = await db
    .select({ revision: visits.revision })
    .from(visits)
    .where(eq(visits.id, visitId));
  return { submissionId: randomUUID(), expectedVisitRevision: row!.revision, operatorId: ALEX };
}

async function submit(
  v: Venue,
  visitId: string,
  groups: { lines: GroupLine[]; release: GroupRelease }[],
) {
  const args = await command(visitId);
  return inTx((tx) => submitGroups(tx, v.cfg, visitId, { ...args, groups }));
}

/** Seats `label` and fires one group of `dishes`, answering the visit, its tab and the group. */
async function firedTable(v: Venue, label: string, dishes: Dish[] = ["burger"]) {
  const seat = await seated(v, label);
  const { groups } = await submit(v, seat.visitId, [
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

const problemsOf = (visitId: string, now?: Date) =>
  inTx((tx) => listPrintProblems(tx, visitId, now));

async function stationCard(stationId: string, orderId: string) {
  const cards = await inTx((tx) => listStationQueue(tx, stationId));
  const card = cards.find((c) => c.orderId === orderId);
  expect(card).toBeDefined();
  return card!;
}

/** What the table and the kitchen read of the party's order, less the printing problem itself. */
async function orderAsRead(v: Venue, s: Seated) {
  const card = { ...(await stationCard(v.cocina, s.tabId)) };
  delete card.printProblem;
  return {
    bills: await inTx((tx) => readVisitBills(tx, s.visitId)),
    groups: await inTx((tx) => listOrderGroups(tx, s.visitId)),
    lines: await db
      .select()
      .from(workingOrderLines)
      .where(eq(workingOrderLines.workingOrderId, s.tabId))
      .orderBy(asc(workingOrderLines.lineNo)),
    card,
  };
}

describe("the link from a kitchen ticket to its bill and station", () => {
  it("writes one row per job, bill and station: a station ticket names its station, an order ticket every station it carries", async () => {
    const v = await setupVenue();
    const pase = await inTx(async (tx) => {
      const { id } = await createPrinter(
        tx,
        { locationId: v.cfg.locationId },
        { name: "Pase", transport: "cloud_poll", pollId: `poll-${randomUUID()}` },
      );
      await updatePrinter(tx, { locationId: v.cfg.locationId }, id, { ticketScope: "order" });
      await attachPrinterToStation(tx, { stationId: v.cocina, printerId: id });
      await attachPrinterToStation(tx, { stationId: v.barra, printerId: id });
      return id;
    });
    const s = await firedTable(v, "Mesa 4", ["burger", "beer"]);

    const rows = await links();
    const expected = [
      { printerId: v.cocinaPrinter, stationId: v.cocina },
      { printerId: v.barraPrinter, stationId: v.barra },
      { printerId: pase, stationId: v.cocina },
      { printerId: pase, stationId: v.barra },
    ].map((row) => ({ ...row, workingOrderId: s.tabId, reprint: false }));
    expect(
      rows
        .map(({ printerId, stationId, workingOrderId, reprint }) => ({
          printerId,
          stationId,
          workingOrderId,
          reprint,
        }))
        .sort(byPrinterThenStation),
    ).toEqual(expected.sort(byPrinterThenStation));
    // The order ticket is ONE job carrying both stations.
    const paseJobs = new Set(rows.filter((r) => r.printerId === pase).map((r) => r.printJobId));
    expect(paseJobs.size).toBe(1);
    // Every job the fire printed is linked, and nothing else is.
    const jobs = await db.select({ id: printJobs.id }).from(printJobs);
    expect(new Set(rows.map((r) => r.printJobId))).toEqual(new Set(jobs.map((j) => j.id)));
  });

  it("links each bill's own ticket when a fired group's dishes sit on two bills of the party", async () => {
    const v = await setupVenue();
    const s = await firedTable(v, "Mesa 4", ["burger", "fish"]);
    const [fish] = await db
      .select({ lineNo: workingOrderLines.lineNo })
      .from(workingOrderLines)
      .where(eq(workingOrderLines.name, DISHES.fish.staff));
    const { checkId } = await inTx(async (tx) =>
      splitOffCheck(tx, v.cfg, s.tabId, [{ lineNo: fish!.lineNo, quantity: "1" }], {
        expectedVisitRevision: (await command(s.visitId)).expectedVisitRevision,
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
      [s.tabId, v.cocina, true],
      [checkId, v.cocina, true],
    ]);
  });

  it("marks a reprint's links as a reprint", async () => {
    const v = await setupVenue();
    const s = await firedTable(v, "Mesa 4");
    await inTx((tx) => reprintOrderTickets(tx, v.cfg, s.tabId));

    expect((await links()).map((row) => [row.stationId, row.reprint])).toEqual([
      [v.cocina, false],
      [v.cocina, true],
    ]);
  });
});

describe("a printing problem on the table and the station (Review Focus 6)", () => {
  it("shows a ticket that failed every delivery attempt on Mesa 4 and on its station's card", async () => {
    const v = await setupVenue();
    const mesa4 = await firedTable(v, "Mesa 4", ["burger", "beer"]);
    const job = await jobFor(mesa4.tabId, v.cocinaPrinter);
    await setJob(job, exhausted);

    expect(await problemsOf(mesa4.visitId)).toEqual([
      {
        workingOrderId: mesa4.tabId,
        stationId: v.cocina,
        stationName: "Cocina",
        since: await createdAtOf(job),
      },
    ]);
    expect((await stationCard(v.cocina, mesa4.tabId)).printProblem).toBe(true);
    // The bar's ticket printed its own job, which has not failed.
    expect("printProblem" in (await stationCard(v.barra, mesa4.tabId))).toBe(false);
  });

  it("does not show a ticket that failed but still has attempts left, while it is young", async () => {
    const v = await setupVenue();
    const mesa4 = await firedTable(v, "Mesa 4");
    await setJob(await jobFor(mesa4.tabId, v.cocinaPrinter), {
      status: "failed",
      attempts: MAX_DELIVERY_ATTEMPTS - 1,
    });

    expect(await problemsOf(mesa4.visitId)).toEqual([]);
    expect("printProblem" in (await stationCard(v.cocina, mesa4.tabId))).toBe(false);
  });

  it("shows a ticket still queued after JOBS_WAITING_MS, and not one queued a moment less", async () => {
    const v = await setupVenue();
    const mesa4 = await firedTable(v, "Mesa 4");
    const job = await jobFor(mesa4.tabId, v.cocinaPrinter);
    const created = Date.parse(await createdAtOf(job));

    expect(await problemsOf(mesa4.visitId, new Date(created + JOBS_WAITING_MS - 1_000))).toEqual(
      [],
    );
    expect(
      await problemsOf(mesa4.visitId, new Date(created + JOBS_WAITING_MS + 1_000)),
    ).toMatchObject([{ workingOrderId: mesa4.tabId, stationId: v.cocina }]);

    // The station card reads the real clock: age the job instead.
    expect("printProblem" in (await stationCard(v.cocina, mesa4.tabId))).toBe(false);
    await setJob(job, { createdAt: new Date(Date.now() - JOBS_WAITING_MS - 60_000).toISOString() });
    expect((await stationCard(v.cocina, mesa4.tabId)).printProblem).toBe(true);
  });

  it("still accepts a new round on Mesa 4 while the problem stands, and reads the order as before", async () => {
    const v = await setupVenue();
    const mesa4 = await firedTable(v, "Mesa 4");
    const before = await orderAsRead(v, mesa4);
    const job = await jobFor(mesa4.tabId, v.cocinaPrinter);
    await setJob(job, exhausted);

    expect(await orderAsRead(v, mesa4)).toEqual(before);

    const next = await submit(v, mesa4.visitId, [{ release: "fire", lines: [line(v, "fish")] }]);
    expect(next.groups).toMatchObject([{ state: "fired" }]);
    expect(await problemsOf(mesa4.visitId)).toMatchObject([
      { workingOrderId: mesa4.tabId, stationId: v.cocina, since: await createdAtOf(job) },
    ]);
  });

  it("clears once a reprint of the bill has printed, and not while the reprint waits", async () => {
    const v = await setupVenue();
    const mesa4 = await firedTable(v, "Mesa 4");
    await setJob(await jobFor(mesa4.tabId, v.cocinaPrinter), exhausted);

    await inTx((tx) => reprintOrderTickets(tx, v.cfg, mesa4.tabId));
    const reprint = (await links()).find((row) => row.reprint)!.printJobId;
    expect(await problemsOf(mesa4.visitId)).toHaveLength(1);

    await setJob(reprint, { status: "done" });
    expect(await problemsOf(mesa4.visitId)).toEqual([]);
    expect("printProblem" in (await stationCard(v.cocina, mesa4.tabId))).toBe(false);
  });

  it("is not cleared by a later round's ticket printing, which does not carry the lost dishes", async () => {
    const v = await setupVenue();
    const mesa4 = await firedTable(v, "Mesa 4");
    await setJob(await jobFor(mesa4.tabId, v.cocinaPrinter), exhausted);
    await submit(v, mesa4.visitId, [{ release: "fire", lines: [line(v, "fish")] }]);
    const later = (await links()).at(-1)!.printJobId;

    await setJob(later, { status: "done" });
    expect(await problemsOf(mesa4.visitId)).toHaveLength(1);
  });

  it("is not cleared by the pass printer's reprint printing while the station printer's reprint failed again", async () => {
    const v = await setupVenue();
    const pase = await passPrinter(v);
    const mesa4 = await firedTable(v, "Mesa 4");
    await setJob(await jobFor(mesa4.tabId, v.cocinaPrinter), exhausted);
    await setJob(await jobFor(mesa4.tabId, pase), { status: "done" });

    const before = (await links()).length;
    await inTx((tx) => reprintOrderTickets(tx, v.cfg, mesa4.tabId));
    const reprints = (await links()).slice(before);
    const cocinaReprint = reprints.find((row) => row.printerId === v.cocinaPrinter)!.printJobId;
    const paseReprint = reprints.find((row) => row.printerId === pase)!.printJobId;
    await setJob(cocinaReprint, exhausted);
    await setJob(paseReprint, {
      status: "done",
      createdAt: new Date(Date.parse(await createdAtOf(cocinaReprint)) + 1).toISOString(),
    });

    expect(await problemsOf(mesa4.visitId)).toMatchObject([
      { workingOrderId: mesa4.tabId, stationId: v.cocina },
    ]);
    expect((await stationCard(v.cocina, mesa4.tabId)).printProblem).toBe(true);
  });

  it("clears once a reprint on the same printer has printed, though it was queued in the same millisecond", async () => {
    const v = await setupVenue();
    const mesa4 = await firedTable(v, "Mesa 4");
    const job = await jobFor(mesa4.tabId, v.cocinaPrinter);
    await setJob(job, exhausted);
    await inTx((tx) => reprintOrderTickets(tx, v.cfg, mesa4.tabId));
    const reprint = (await links()).find((row) => row.reprint)!.printJobId;

    await setJob(reprint, { status: "done", createdAt: await createdAtOf(job) });
    expect(await problemsOf(mesa4.visitId)).toEqual([]);
  });

  it("decides which ticket came later by the order they were queued, not by their clock stamps", async () => {
    const v = await setupVenue();
    const mesa4 = await firedTable(v, "Mesa 4");
    const job = await jobFor(mesa4.tabId, v.cocinaPrinter);
    await setJob(job, exhausted);
    await inTx((tx) => reprintOrderTickets(tx, v.cfg, mesa4.tabId));
    await inTx((tx) => reprintOrderTickets(tx, v.cfg, mesa4.tabId));
    const [first, second] = (await links()).filter((row) => row.reprint).map((r) => r.printJobId);
    // The first reprint printed, the second failed; the clock reads the first as the later one.
    await setJob(first!, { status: "done", createdAt: "2030-01-01T00:00:00.000Z" });
    await setJob(second!, exhausted);

    expect(await problemsOf(mesa4.visitId)).toMatchObject([
      { workingOrderId: mesa4.tabId, stationId: v.cocina, since: await createdAtOf(second!) },
    ]);

    // A reprint queued after the failure clears it, though its clock stamp is the earliest.
    await inTx((tx) => reprintOrderTickets(tx, v.cfg, mesa4.tabId));
    const third = (await links()).at(-1)!.printJobId;
    await setJob(third, { status: "done", createdAt: "2000-01-01T00:00:00.000Z" });
    expect(await problemsOf(mesa4.visitId)).toEqual([]);
  });

  it("follows the dishes when the bill whose ticket failed is merged into another table's bill", async () => {
    const v = await setupVenue();
    const mesa4 = await firedTable(v, "Mesa 4");
    const mesa5 = await firedTable(v, "Mesa 5");
    const job = await jobFor(mesa4.tabId, v.cocinaPrinter);
    await setJob(job, exhausted);

    const merge = {
      freeSourceTable: false,
      expectedVisitRevision: (await command(mesa5.visitId)).expectedVisitRevision,
      expectedSourceVisitRevision: (await command(mesa4.visitId)).expectedVisitRevision,
      operatorId: ALEX,
    };
    await inTx((tx) => mergeTabs(tx, v.cfg, mesa5.tabId, mesa4.tabId, merge));

    expect(await problemsOf(mesa5.visitId)).toEqual([
      {
        workingOrderId: mesa5.tabId,
        stationId: v.cocina,
        stationName: "Cocina",
        since: await createdAtOf(job),
      },
    ]);
    expect((await stationCard(v.cocina, mesa5.tabId)).printProblem).toBe(true);

    // Mesa 5's bill now carries Mesa 4's dishes, so its reprint printing clears the problem.
    await inTx((tx) => reprintOrderTickets(tx, v.cfg, mesa5.tabId));
    await setJob((await links()).at(-1)!.printJobId, { status: "done" });
    expect(await problemsOf(mesa5.visitId)).toEqual([]);
  });

  it("keeps a failure merged in from another bill when the receiving bill was reprinted before the merge", async () => {
    const v = await setupVenue();
    const source = await firedTable(v, "Mesa 4");
    const destination = await firedTable(v, "Mesa 5");
    const failed = await jobFor(source.tabId, v.cocinaPrinter);
    await setJob(failed, exhausted);
    await inTx((tx) => reprintOrderTickets(tx, v.cfg, destination.tabId));
    await setJob((await links()).at(-1)!.printJobId, { status: "done" });
    expect(await problemsOf(source.visitId)).toHaveLength(1);

    await mergeBills(v, source, destination);

    expect(await problemsOf(destination.visitId)).toEqual([
      {
        workingOrderId: destination.tabId,
        stationId: v.cocina,
        stationName: "Cocina",
        since: await createdAtOf(failed),
      },
    ]);
    expect((await stationCard(v.cocina, destination.tabId)).printProblem).toBe(true);
  });

  it("keeps the receiving bill's own failure when the merged bill's reprint printed before the merge", async () => {
    const v = await setupVenue();
    const source = await firedTable(v, "Mesa 4");
    const destination = await firedTable(v, "Mesa 5");
    const failed = await jobFor(destination.tabId, v.cocinaPrinter);
    await setJob(failed, exhausted);
    await inTx((tx) => reprintOrderTickets(tx, v.cfg, source.tabId));
    await setJob((await links()).at(-1)!.printJobId, { status: "done" });

    await mergeBills(v, source, destination);

    expect(await problemsOf(destination.visitId)).toEqual([
      {
        workingOrderId: destination.tabId,
        stationId: v.cocina,
        stationName: "Cocina",
        since: await createdAtOf(failed),
      },
    ]);
    expect((await stationCard(v.cocina, destination.tabId)).printProblem).toBe(true);
  });

  it("keeps the receiving bill's own failure when the merged bill's reprint, waiting at the merge, prints after it", async () => {
    const v = await setupVenue();
    const source = await firedTable(v, "Mesa 4");
    const destination = await firedTable(v, "Mesa 5");
    const failed = await jobFor(destination.tabId, v.cocinaPrinter);
    await setJob(failed, exhausted);
    await inTx((tx) => reprintOrderTickets(tx, v.cfg, source.tabId));
    const waiting = (await links()).at(-1)!.printJobId;

    await mergeBills(v, source, destination);
    await setJob(waiting, { status: "done" });

    expect(await problemsOf(destination.visitId)).toEqual([
      {
        workingOrderId: destination.tabId,
        stationId: v.cocina,
        stationName: "Cocina",
        since: await createdAtOf(failed),
      },
    ]);
    expect((await stationCard(v.cocina, destination.tabId)).printProblem).toBe(true);
  });

  it("does not bring back a merged bill's failure that its own reprint had already cleared", async () => {
    const v = await setupVenue();
    const source = await firedTable(v, "Mesa 4");
    const destination = await firedTable(v, "Mesa 5");
    await setJob(await jobFor(source.tabId, v.cocinaPrinter), exhausted);
    await inTx((tx) => reprintOrderTickets(tx, v.cfg, source.tabId));
    await setJob((await links()).at(-1)!.printJobId, { status: "done" });
    expect(await problemsOf(source.visitId)).toEqual([]);

    await mergeBills(v, source, destination);

    expect(await problemsOf(destination.visitId)).toEqual([]);
    expect("printProblem" in (await stationCard(v.cocina, destination.tabId))).toBe(false);
  });

  it("keeps a merged bill's station-printer failure though its pass printer's reprint printed", async () => {
    const v = await setupVenue();
    const pase = await passPrinter(v);
    const source = await firedTable(v, "Mesa 4", ["burger", "beer"]);
    const destination = await firedTable(v, "Mesa 5");
    const paseJobOf = (rows: Awaited<ReturnType<typeof links>>) => {
      const ids = new Set(
        rows
          .filter((row) => row.workingOrderId === source.tabId && row.printerId === pase)
          .map((row) => row.printJobId),
      );
      expect(ids.size).toBe(1);
      return [...ids][0]!;
    };
    const cocinaFailed = await jobFor(source.tabId, v.cocinaPrinter);
    const paseFailed = paseJobOf(await links());
    await setJob(cocinaFailed, exhausted);
    await setJob(await jobFor(source.tabId, v.barraPrinter), { status: "done" });
    await setJob(paseFailed, exhausted);

    const before = (await links()).length;
    await inTx((tx) => reprintOrderTickets(tx, v.cfg, source.tabId));
    const reprints = (await links()).slice(before);
    const paseReprint = paseJobOf(reprints);
    await setJob(reprints.find((row) => row.printerId === v.cocinaPrinter)!.printJobId, exhausted);
    await setJob(reprints.find((row) => row.printerId === v.barraPrinter)!.printJobId, {
      status: "done",
    });
    await setJob(paseReprint, { status: "done" });
    const cocinaProblem = {
      stationId: v.cocina,
      stationName: "Cocina",
      since: await createdAtOf(cocinaFailed),
    };
    expect(await problemsOf(source.visitId)).toEqual([
      { workingOrderId: source.tabId, ...cocinaProblem },
    ]);

    await mergeBills(v, source, destination);

    expect(await problemsOf(destination.visitId)).toEqual([
      { workingOrderId: destination.tabId, ...cocinaProblem },
    ]);
    expect((await stationCard(v.cocina, destination.tabId)).printProblem).toBe(true);
    // The pass printer's failed ticket, which its printed reprint covered, stays on the closed bill.
    expect("printProblem" in (await stationCard(v.barra, destination.tabId))).toBe(false);
    expect(
      (await links())
        .filter((row) => row.printJobId === paseFailed || row.printJobId === paseReprint)
        .map((row) => [row.printJobId, row.workingOrderId, row.stationId, row.reprint])
        .sort(),
    ).toEqual(
      [
        [paseFailed, source.tabId, v.cocina, false],
        [paseFailed, source.tabId, v.barra, false],
        [paseReprint, source.tabId, v.cocina, true],
        [paseReprint, source.tabId, v.barra, true],
      ].sort(),
    );
  });

  it("raises no table problem for a failed job no kitchen ticket links, such as a receipt", async () => {
    const v = await setupVenue();
    const mesa4 = await firedTable(v, "Mesa 4");
    const { jobId } = await inTx((tx) =>
      enqueuePrintJob(tx, { locationId: v.cfg.locationId }, v.receiptPrinter, Uint8Array.from([1])),
    );
    await setJob(jobId, { ...exhausted, createdAt: "2026-01-01T00:00:00.000Z" });

    expect(await problemsOf(mesa4.visitId)).toEqual([]);
    expect("printProblem" in (await stationCard(v.cocina, mesa4.tabId))).toBe(false);
  });

  it("keeps another table's problem off Mesa 4", async () => {
    const v = await setupVenue();
    const mesa4 = await firedTable(v, "Mesa 4");
    const mesa5 = await firedTable(v, "Mesa 5");
    await setJob(await jobFor(mesa5.tabId, v.cocinaPrinter), exhausted);

    expect(await problemsOf(mesa4.visitId)).toEqual([]);
    expect(await problemsOf(mesa5.visitId)).toMatchObject([{ workingOrderId: mesa5.tabId }]);
    expect("printProblem" in (await stationCard(v.cocina, mesa4.tabId))).toBe(false);
    expect((await stationCard(v.cocina, mesa5.tabId)).printProblem).toBe(true);
  });

  it("refuses visit.not_open for a visit that does not exist", async () => {
    await setupVenue();
    const visitId = randomUUID();
    await expect(problemsOf(visitId)).rejects.toMatchObject({
      code: "visit.not_open",
      params: { visitId },
    });
  });
});

describe("a failed HOLD ticket (service plan Task 6)", () => {
  const TIME = expect.stringMatching(/^\d\d:\d\d$/);

  /** A venue that prints held groups in advance. */
  async function holdingVenue(): Promise<Venue> {
    const v = await setupVenue();
    await inTx((tx) => writePrintHeldWork(tx, true));
    return v;
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

  it("shows on Mesa 4 and on its station's card, as a failed fire ticket does", async () => {
    const v = await holdingVenue();
    const mesa4 = await seated(v, "Mesa 4");
    await submit(v, mesa4.visitId, [{ release: "hold", lines: [line(v, "burger")] }]);
    const [hold] = await jobsAt(v.cocinaPrinter);
    expect(hold!.lines[0]).toBe("*** HOLD ***");
    await setJob(hold!.id, exhausted);

    expect(await problemsOf(mesa4.visitId)).toEqual([
      {
        workingOrderId: mesa4.tabId,
        stationId: v.cocina,
        stationName: "Cocina",
        since: await createdAtOf(hold!.id),
      },
    ]);
    expect((await stationCard(v.cocina, mesa4.tabId)).printProblem).toBe(true);
  });

  it("is reprinted under REPRINT and HOLD on a party with nothing fired, and clears once that prints", async () => {
    const v = await holdingVenue();
    const mesa4 = await seated(v, "Mesa 4");
    await submit(v, mesa4.visitId, [{ release: "hold", lines: [line(v, "burger", "2")] }]);
    const [hold] = await jobsAt(v.cocinaPrinter);
    await setJob(hold!.id, exhausted);

    await inTx((tx) => reprintOrderTickets(tx, v.cfg, mesa4.tabId));

    const [, reprint] = await jobsAt(v.cocinaPrinter);
    expect(reprint!.lines).toEqual([
      "*** REPRINT ***",
      ...hold!.lines.slice(0, 4),
      TIME,
      "GROUP 1",
      `2.000 ea x ${DISHES.burger.kitchen}`,
    ]);
    expect(hold!.lines.slice(5)).toEqual(["GROUP 1", `2.000 ea x ${DISHES.burger.kitchen}`]);
    expect(await problemsOf(mesa4.visitId)).toHaveLength(1);

    await setJob(reprint!.id, { status: "done" });
    expect(await problemsOf(mesa4.visitId)).toEqual([]);
    expect("printProblem" in (await stationCard(v.cocina, mesa4.tabId))).toBe(false);
  });

  // Fails if the fired and held parts go out as two jobs: each would be a printed reprint for the
  // same bill, station and printer, so either one printing would clear the other's failure.
  it("reprints fired and held work as one job per printer, the held work alone under HOLD", async () => {
    const v = await holdingVenue();
    const mesa4 = await seated(v, "Mesa 4");
    await submit(v, mesa4.visitId, [
      { release: "fire", lines: [line(v, "burger")] },
      { release: "hold", lines: [line(v, "fish"), line(v, "beer")] },
    ]);
    const [fire, hold] = await jobsAt(v.cocinaPrinter);
    const [barHold] = await jobsAt(v.barraPrinter);
    await setJob(fire!.id, exhausted);
    await setJob(hold!.id, exhausted);
    await setJob(barHold!.id, exhausted);
    const before = (await links()).length;

    await inTx((tx) => reprintOrderTickets(tx, v.cfg, mesa4.tabId));

    const head = (station: string) => [station, "Mesa 4", fire!.lines[2], TIME];
    const cocina = (await jobsAt(v.cocinaPrinter)).slice(2);
    expect(cocina.map((job) => job.lines)).toEqual([
      [
        "*** REPRINT ***",
        ...head("Cocina"),
        "GROUP 1",
        `1.000 ea x ${DISHES.burger.kitchen}`,
        "*** REPRINT ***",
        "*** HOLD ***",
        ...head("Cocina"),
        "GROUP 2",
        `1.000 ea x ${DISHES.fish.kitchen}`,
      ],
    ]);
    const barra = (await jobsAt(v.barraPrinter)).slice(1);
    expect(barra.map((job) => job.lines)).toEqual([
      [
        "*** REPRINT ***",
        "*** HOLD ***",
        ...head("Barra"),
        "GROUP 2",
        `1.000 ea x ${DISHES.beer.kitchen}`,
      ],
    ]);
    expect(
      (await links()).slice(before).map((row) => [row.printJobId, row.stationId, row.reprint]),
    ).toEqual([
      [cocina[0]!.id, v.cocina, true],
      [barra[0]!.id, v.barra, true],
    ]);

    await setJob(cocina[0]!.id, { status: "done" });
    await setJob(barra[0]!.id, { status: "done" });
    expect(await problemsOf(mesa4.visitId)).toEqual([]);
  });

  it("does not reprint a held group whose HOLD ticket was never queued", async () => {
    const v = await setupVenue();
    const mesa4 = await seated(v, "Mesa 4");
    await submit(v, mesa4.visitId, [
      { release: "fire", lines: [line(v, "burger")] },
      { release: "hold", lines: [line(v, "fish")] },
    ]);
    expect(await jobsAt(v.cocinaPrinter)).toHaveLength(1);

    await inTx((tx) => reprintOrderTickets(tx, v.cfg, mesa4.tabId));

    const [fire, reprint] = await jobsAt(v.cocinaPrinter);
    expect(reprint!.lines).toEqual([
      "*** REPRINT ***",
      ...fire!.lines.slice(0, 3),
      TIME,
      ...fire!.lines.slice(4),
    ]);
    expect(fire!.lines.at(-1)).toBe(`1.000 ea x ${DISHES.burger.kitchen}`);
  });

  it("reprints a fired group as fired work, not under HOLD, and that clears its failed HOLD ticket", async () => {
    const v = await holdingVenue();
    const mesa4 = await seated(v, "Mesa 4");
    const { groups } = await submit(v, mesa4.visitId, [
      { release: "hold", lines: [line(v, "burger")] },
    ]);
    await setJob((await jobsAt(v.cocinaPrinter))[0]!.id, exhausted);
    await inTx(async (tx) =>
      fireGroup(tx, v.cfg, mesa4.visitId, groups[0]!.id, await command(mesa4.visitId)),
    );
    const [hold, fireSlip] = await jobsAt(v.cocinaPrinter);
    expect(fireSlip!.lines[0]).toBe("*** FIRE ***");

    await inTx((tx) => reprintOrderTickets(tx, v.cfg, mesa4.tabId));

    const [, , reprint] = await jobsAt(v.cocinaPrinter);
    expect(reprint!.lines).toEqual([
      "*** REPRINT ***",
      ...hold!.lines.slice(1, 4),
      TIME,
      ...hold!.lines.slice(5),
    ]);
    await setJob(reprint!.id, { status: "done" });
    expect(await problemsOf(mesa4.visitId)).toEqual([]);
  });

  it("does not reprint under HOLD a line recalled from a fired group whose HOLD ticket was queued", async () => {
    const v = await holdingVenue();
    const mesa4 = await seated(v, "Mesa 4");
    const { groups } = await submit(v, mesa4.visitId, [
      { release: "hold", lines: [line(v, "burger"), line(v, "fish")] },
    ]);
    await inTx(async (tx) =>
      fireGroup(tx, v.cfg, mesa4.visitId, groups[0]!.id, await command(mesa4.visitId)),
    );
    const [fish] = await db
      .select({ lineNo: workingOrderLines.lineNo })
      .from(workingOrderLines)
      .where(eq(workingOrderLines.name, DISHES.fish.staff));
    await inTx((tx) => recallLines(tx, v.cfg, mesa4.tabId, [fish!.lineNo]));
    const before = (await jobsAt(v.cocinaPrinter)).length;

    await inTx((tx) => reprintOrderTickets(tx, v.cfg, mesa4.tabId));

    const reprints = (await jobsAt(v.cocinaPrinter)).slice(before).map((job) => job.lines);
    expect(reprints).toEqual([
      [
        "*** REPRINT ***",
        "Cocina",
        "Mesa 4",
        expect.any(String),
        TIME,
        "GROUP 1",
        `1.000 ea x ${DISHES.burger.kitchen}`,
      ],
    ]);
  });

  it("follows the held dishes when their bill is merged into another table's, and clears by that bill's reprint", async () => {
    const v = await holdingVenue();
    const mesa4 = await seated(v, "Mesa 4");
    await submit(v, mesa4.visitId, [{ release: "hold", lines: [line(v, "burger")] }]);
    const [hold] = await jobsAt(v.cocinaPrinter);
    await setJob(hold!.id, exhausted);
    const mesa5 = await firedTable(v, "Mesa 5", ["fish"]);

    await mergeBills(v, mesa4, mesa5);

    expect(await problemsOf(mesa5.visitId)).toEqual([
      {
        workingOrderId: mesa5.tabId,
        stationId: v.cocina,
        stationName: "Cocina",
        since: await createdAtOf(hold!.id),
      },
    ]);
    expect((await stationCard(v.cocina, mesa5.tabId)).printProblem).toBe(true);

    await inTx((tx) => reprintOrderTickets(tx, v.cfg, mesa5.tabId));
    const reprint = (await jobsAt(v.cocinaPrinter)).at(-1)!;
    // Both tables now seat the merged bill; which one the header names is not this test's subject.
    const table = expect.stringMatching(/^Mesa [45]$/);
    expect(reprint.lines).toEqual([
      "*** REPRINT ***",
      "Cocina",
      table,
      expect.any(String),
      TIME,
      "GROUP 1",
      `1.000 ea x ${DISHES.fish.kitchen}`,
      "*** REPRINT ***",
      "*** HOLD ***",
      "Cocina",
      table,
      expect.any(String),
      TIME,
      "GROUP 2",
      `1.000 ea x ${DISHES.burger.kitchen}`,
    ]);
    await setJob(reprint.id, { status: "done" });
    expect(await problemsOf(mesa5.visitId)).toEqual([]);
  });

  it("raises no problem for a failed HOLD correction slip, as for every correction slip", async () => {
    const v = await holdingVenue();
    const mesa4 = await seated(v, "Mesa 4");
    await submit(v, mesa4.visitId, [
      { release: "hold", lines: [line(v, "burger"), line(v, "fish")] },
    ]);
    const [fish] = await db
      .select({ lineNo: workingOrderLines.lineNo })
      .from(workingOrderLines)
      .where(eq(workingOrderLines.name, DISHES.fish.staff));
    await inTx((tx) => voidTabLine(tx, v.cfg, mesa4.tabId, fish!.lineNo, undefined, ALEX));
    const [, slip] = await jobsAt(v.cocinaPrinter);
    expect(slip!.lines[0]).toBe("*** HOLD CANCELLED ***");
    const linked = (await links()).map((row) => row.printJobId);

    await setJob(slip!.id, exhausted);

    expect(linked).not.toContain(slip!.id);
    expect(await problemsOf(mesa4.visitId)).toEqual([]);
    expect("printProblem" in (await stationCard(v.cocina, mesa4.tabId))).toBe(false);
  });
});

/** Merge `source`'s bill into `destination`'s, keeping the source's table seated. */
async function mergeBills(v: Venue, source: Seated, destination: Seated): Promise<void> {
  const merge = {
    freeSourceTable: false,
    expectedVisitRevision: (await command(destination.visitId)).expectedVisitRevision,
    expectedSourceVisitRevision: (await command(source.visitId)).expectedVisitRevision,
    operatorId: ALEX,
  };
  await inTx((tx) => mergeTabs(tx, v.cfg, destination.tabId, source.tabId, merge));
}

/** An order-scope (pass) printer attached to both stations. */
async function passPrinter(v: Venue): Promise<string> {
  return inTx(async (tx) => {
    const { id } = await createPrinter(
      tx,
      { locationId: v.cfg.locationId },
      { name: "Pase", transport: "cloud_poll", pollId: `poll-${randomUUID()}` },
    );
    await updatePrinter(tx, { locationId: v.cfg.locationId }, id, { ticketScope: "order" });
    await attachPrinterToStation(tx, { stationId: v.cocina, printerId: id });
    await attachPrinterToStation(tx, { stationId: v.barra, printerId: id });
    return id;
  });
}

function byPrinterThenStation(
  a: { printerId: string; stationId: string },
  b: { printerId: string; stationId: string },
): number {
  return a.printerId.localeCompare(b.printerId) || a.stationId.localeCompare(b.stationId);
}
