import { randomUUID } from "node:crypto";
import { count as countRows, eq } from "drizzle-orm";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  deviceProfiles,
  printJobs,
  printers,
  ticketItems,
  withTransaction,
  workingOrderLines,
  venueLocationId,
} from "@waitron/db";
import type { Transaction } from "@waitron/db";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { seedNode, seedTenant, seedVenue } from "@waitron/db/testing/seed.js";
import { assignCatalogueToVenue, createCatalogue, createProduct } from "@waitron/catalogue";
import { createPrinter, deactivatePrinter } from "@waitron/printing";
import { nodeId as brandNodeId, jobOrigin } from "@waitron/shared";
import type { OriginConfig } from "./trading-context.js";
import type { WithVenueRowId } from "./testing/venue-row-id.js";
import { createStation } from "./kitchen.js";
import { createOpenOrder } from "./working-order.js";
import { attachPrinterToStation } from "./station-printers.js";
import { enqueueKitchenTickets } from "./kitchen-print.js";
import { seedLegacySellingUnits } from "./testing/seed-units.js";
import { offerProducts } from "./testing/zone-offers.js";
import { setupSplitExtrasVenue, useSplitExtrasDb } from "./testing/split-extras-venue.js";
import { setStationsWaitForPass } from "./testing/pass-waiting.js";
import { placeGroups } from "./testing/group-submit-fixture.js";
import { OPERATOR } from "./testing/party-venue.js";
import { enrolDeviceForTest } from "./testing/enrol.js";
import { decodeTicket } from "./testing/decode-ticket.js";
import { VENUE_SERVICE } from "./modules.js";
import { passScopeOf, readScopedPassBoard } from "./pass-board.js";
import { releasePassItems, type PassActor } from "./pass-release.js";
import "./errors.js";

const LOCALE = "es-ES";
const suite = useVenueDb({
  migrations: migrationOptionsFor(manifestSets(), null),
  timeoutMs: 60_000,
});

/** A promise that resolves when `open()` is called, to hold a transaction open at an exact point rather
 *  than for a duration. */
function gate(): { passed: Promise<void>; open: () => void } {
  let open!: () => void;
  const passed = new Promise<void>((resolve) => {
    open = resolve;
  });
  return { passed, open };
}

/**
 * Starts `second` while `first` is parked mid-transaction, and asserts that it has not run. The 20 ms
 * pause is a real one, not a microtask turn, to give the second transaction every chance to run.
 * `release` is in a `finally` so a failed assertion does not hang the suite.
 */
async function parkedThenRelease<A, B>(
  first: (tx: Transaction) => Promise<A>,
  parked: Promise<void>,
  release: () => void,
  second: (tx: Transaction) => Promise<B>,
): Promise<[A, B]> {
  let secondStarted = false;
  const one = withTransaction(suite.db, first);
  await parked;
  // Started without awaiting `one`. Nothing but the write queue keeps it out.
  const two = withTransaction(suite.db, (tx: Transaction) => {
    secondStarted = true;
    return second(tx);
  });
  const settled = Promise.all([one, two]);
  try {
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(secondStarted, "the second transaction started while the first was still open").toBe(
      false,
    );
  } finally {
    release();
  }
  return settled;
}

/** A kitchen ticket prints its time in the process's own time zone (`hhmm`, kitchen-ticket.ts). */
const ticketClock = (at: Date) =>
  `${String(at.getHours()).padStart(2, "0")}:${String(at.getMinutes()).padStart(2, "0")}`;
const AT_CLOCK = ticketClock(new Date("2026-03-14T12:00:00.000Z"));

/**
 * A `deactivatePrinter` started while a kitchen fire is open never aborts the fire: the fire enqueues
 * its job, the deactivation lands only afterwards, and the printer ends up inactive.
 *
 * Narrower than its name: there is no hook inside `enqueueKitchenTickets`, so the fire parks AFTER
 * it returns, uncommitted. What is observed is the venue file's write queue — a second write
 * transaction does not start while the first is open — not an interleave inside this call path. The
 * mechanism is stated on `assertExtraListForWrite` (`packages/catalogue/src/extras.ts`).
 */
describe("print-on-fire concurrency — the write queue around the mapping read", () => {
  it("a concurrent deactivatePrinter runs only after the fire commits, and never aborts it", async () => {
    // ---- Setup, committed before the two contending transactions are staged ----
    await seedTenant(suite.db);
    await seedLegacySellingUnits(suite.db);
    await seedVenue(suite.db, {
      name: "Bar",
      invoiceLocales: [LOCALE],
      operationDescription: "Venta en establecimiento",
    });
    const locationId = await venueLocationId(suite.db);
    const nodeId = await seedNode(suite.db);
    const cfg: WithVenueRowId<OriginConfig> = {
      origin: jobOrigin("dashboard"),
      nodeId: brandNodeId(nodeId),
      locationId: locationId,
      locale: LOCALE,
      invoiceLocales: [LOCALE],
      tipsEnabled: false,
      simplifiedInvoiceLimit: null,
    };
    const { kitchenId, printerId, orderId, lineId } = await withTransaction(
      suite.db,
      async (tx) => {
        const cat = await createCatalogue(tx, { name: "Menu" });
        await assignCatalogueToVenue(tx, cat.id);
        const kitchen = await createStation(tx, { name: "Kitchen", isDefault: true });
        const { id: printerId } = await createPrinter(tx, {
          name: "Kitchen printer",
          transport: "cloud_poll",
          pollId: `poll-${randomUUID()}`,
        });
        await attachPrinterToStation(tx, {
          stationId: kitchen.id,
          printerId,
        });
        const { id: product } = await createProduct(tx, {
          catalogueId: cat.id,
          categoryId: null,
          name: "Ribeye",
          pricingUnit: "each",
          unitPrice: "1.50",
          vatClass: "general",
        });
        const orderId = randomUUID();
        const offers = await offerProducts(tx, cfg);
        await createOpenOrder(
          tx,
          cfg,
          orderId,
          offers.toOfferLines([{ productId: product, quantity: "1" }]),
          null,
          { zoneId: offers.zoneId },
        );
        const [line] = await tx
          .select({ id: workingOrderLines.id })
          .from(workingOrderLines)
          .where(eq(workingOrderLines.workingOrderId, orderId));
        return { kitchenId: kitchen.id, printerId, orderId, lineId: line!.id };
      },
    );

    const firedItems = [{ workingOrderLineId: lineId, stationId: kitchenId }];

    // ---- The race ----
    // The fire parks uncommitted after enqueueing; the deactivate of the same printer, started
    // meanwhile, must not run before it commits.
    const readDone = gate();
    const releaseA = gate();
    let deactivateDone = false;
    await parkedThenRelease(
      async (txA) => {
        await enqueueKitchenTickets(txA, cfg, orderId, firedItems);
        readDone.open(); // job enqueued; tx deliberately NOT committed yet
        await releaseA.passed;
      },
      readDone.passed,
      releaseA.open,
      async (txB) => {
        await deactivatePrinter(txB, printerId);
        deactivateDone = true;
      },
    );
    expect(deactivateDone).toBe(true);

    // The fire enqueued its job (proof it was never aborted), and the deactivation landed AFTER it.
    const jobs = await suite.db
      .select({ n: countRows() })
      .from(printJobs)
      .where(eq(printJobs.printerId, printerId));
    expect(Number(jobs[0]!.n)).toBe(1);
    // Through the table definition: `printers.active` is an integer column with a boolean read
    // mapping, so a raw `select active` would return 0/1.
    const printerRow = await suite.db
      .select({ active: printers.active })
      .from(printers)
      .where(eq(printers.id, printerId));
    expect(printerRow[0]!.active).toBe(false);
  });
});

describe("A773 pass release: a printer two pass screens share", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("prints once when both screens Fire the same card, and the other screen then shows it In progress", async () => {
    vi.useFakeTimers({ toFake: ["Date"], now: new Date("2026-03-14T12:00:00.000Z") });
    useSplitExtrasDb(suite.db);
    const venue = await setupSplitExtrasVenue();
    const item = await withTransaction(suite.db, async (tx) => {
      await setStationsWaitForPass(tx, true, [venue.stations.grill]);
      const group = (
        await placeGroups(tx, venue.cfg, venue.party.partyId, {
          operatorId: OPERATOR,
          groups: [
            {
              lines: [{ menuItemId: venue.tables.offerFor(venue.products.burger), quantity: "1" }],
              release: "fire",
            },
          ],
        })
      ).groups[0]!;
      const [row] = await tx
        .select({ id: ticketItems.id })
        .from(ticketItems)
        .where(eq(ticketItems.workingOrderLineId, group.lineIds[0]!));
      return row!.id;
    });
    const screen = async (name: string): Promise<PassActor> => {
      const [profile] = await withTransaction(suite.db, (tx) =>
        tx
          .insert(deviceProfiles)
          .values({
            name: `${name} profile`,
            formFactor: "kds",
            capabilities: ["act-as-kds", "prepare-orders", "run-the-pass"],
          })
          .returning({ id: deviceProfiles.id }),
      );
      const joined = await enrolDeviceForTest(suite.db, venue.cfg, {
        name,
        profileId: profile!.id,
        kitchenScreen: { kind: "pass", stationIds: [venue.stations.grill], zoneIds: null },
      });
      return { deviceId: joined.deviceId, personId: null };
    };
    const board = (by: PassActor) =>
      withTransaction(suite.db, async (tx) => {
        const pass = (await VENUE_SERVICE.readDeviceKitchenScreens(tx, by.deviceId)).find(
          (candidate) => candidate.kind === "pass",
        )!;
        return readScopedPassBoard(tx, passScopeOf(pass));
      });
    const front = await screen("Front pass");
    const back = await screen("Back pass");
    const [frontCard] = (await board(front)).toFire;
    const [backCard] = (await board(back)).toFire;
    expect([frontCard!.releaseTicketItemIds, backCard!.releaseTicketItemIds]).toEqual([
      [item],
      [item],
    ]);
    const askOf = (card: typeof frontCard) => ({
      submissionId: randomUUID(),
      target: card!.target,
      ticketItemIds: card!.releaseTicketItemIds,
      expectedContext: card!.releaseContext,
    });

    const parked = gate();
    const go = gate();
    const first = withTransaction(suite.db, async (tx) => {
      const released = await releasePassItems(tx, venue.cfg, front, askOf(frontCard));
      parked.open();
      await go.passed;
      return released;
    });
    await Promise.race([parked.passed, first.then(undefined, () => undefined)]);
    let secondStarted = false;
    const second = withTransaction(suite.db, (tx) => {
      secondStarted = true;
      return releasePassItems(tx, venue.cfg, back, askOf(backCard));
    });
    const settled = Promise.allSettled([first, second]);
    try {
      await new Promise((resolve) => setTimeout(resolve, 20));
      expect(secondStarted, "the second Fire started while the first was still open").toBe(false);
    } finally {
      go.open();
    }
    expect(await settled).toMatchObject([
      { status: "fulfilled", value: { releasedTicketItemIds: [item] } },
      {
        status: "rejected",
        reason: expect.objectContaining({ code: "ticket.pass_context_changed" }),
      },
    ]);

    const fire = `Grill\nSplit extras\n1\n${AT_CLOCK}\nGROUP 1\n1.000 x BURG\n`;
    const printedAt = async (printerId: string) =>
      (
        await suite.db
          .select({ payload: printJobs.payload })
          .from(printJobs)
          .where(eq(printJobs.printerId, printerId))
      ).map((job) => decodeTicket(job.payload));
    expect({
      grill: await printedAt(venue.printers.grill),
      pass: await printedAt(venue.printers.pass),
    }).toEqual({ grill: [fire], pass: [fire] });
    const after = await board(back);
    expect(after.toFire).toEqual([]);
    expect(after.inProgress.map((card) => card.key)).toEqual([backCard!.key]);
  });
});
