/**
 * A `deactivatePrinter` started while a kitchen fire is open never aborts the fire: the fire enqueues
 * its job, the deactivation lands only afterwards, and the printer ends up inactive.
 *
 * Narrower than its name: there is no hook inside `enqueueKitchenTickets`, so the fire parks AFTER
 * it returns, uncommitted. What is observed is the venue file's write queue — a second write
 * transaction does not start while the first is open — not an interleave inside this call path. The
 * mechanism is stated on `assertExtraListForWrite` (`packages/catalogue/src/extras.ts`).
 */
import { randomUUID } from "node:crypto";
import { count as countRows, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import {
  locations,
  printJobs,
  printers,
  tills,
  withTransaction,
  workingOrderLines,
} from "@waitron/db";
import type { Transaction } from "@waitron/db";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { seedNode, seedTenant } from "@waitron/db/testing/seed.js";
import { assignCatalogueToLocation, createCatalogue, createProduct } from "@waitron/catalogue";
import { createPrinter, deactivatePrinter } from "@waitron/printing";
import type { PrintConfig } from "@waitron/printing";
import {
  locationId as brandLocationId,
  nodeId as brandNodeId,
  seriesId as brandSeriesId,
  tillId as brandTillId,
} from "@waitron/shared";
import type { TillConfig } from "./till-config.js";
import { createStation } from "./kitchen.js";
import { createOpenOrder } from "./working-order.js";
import { attachPrinterToStation } from "./station-printers.js";
import { enqueueKitchenTickets } from "./kitchen-print.js";
import { seedLegacySellingUnits } from "./testing/seed-units.js";
import { offerProducts } from "./testing/zone-offers.js";
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

function printCfg(cfg: TillConfig): PrintConfig {
  return { locationId: cfg.locationId };
}

describe("print-on-fire concurrency — the write queue around the mapping read", () => {
  it("a concurrent deactivatePrinter runs only after the fire commits, and never aborts it", async () => {
    // ---- Setup, committed before the two contending transactions are staged ----
    await seedTenant(suite.db);
    await seedLegacySellingUnits(suite.db);
    const [loc] = await suite.db
      .insert(locations)
      .values({
        name: "Barra",
        invoiceLocales: [LOCALE],
        operationDescription: "Venta en establecimiento",
      })
      .returning({ id: locations.id });
    const locationId = loc!.id;
    const [till] = await suite.db
      .insert(tills)
      .values({ locationId, name: "Caja 1" })
      .returning({ id: tills.id });
    const nodeId = await seedNode(suite.db, brandLocationId(locationId));
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
    const { cocinaId, printerId, orderId, lineId } = await withTransaction(suite.db, async (tx) => {
      const cat = await createCatalogue(tx, { name: "Carta" });
      await assignCatalogueToLocation(tx, locationId, cat.id);
      const cocina = await createStation(tx, cfg, { name: "Cocina", isDefault: true });
      const { id: printerId } = await createPrinter(tx, printCfg(cfg), {
        name: "Cocina printer",
        transport: "cloud_poll",
        pollId: `poll-${randomUUID()}`,
      });
      await attachPrinterToStation(tx, { stationId: cocina.id, printerId });
      const { id: product } = await createProduct(tx, {
        catalogueId: cat.id,
        categoryId: null,
        name: "Chuleton",
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
      return { cocinaId: cocina.id, printerId, orderId, lineId: line!.id };
    });

    const firedItems = [{ workingOrderLineId: lineId, stationId: cocinaId }];

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
        await deactivatePrinter(txB, printCfg(cfg), printerId);
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
