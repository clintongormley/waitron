/**
 * A `deactivatePrinter` landing at the same moment as a kitchen fire never aborts the fire.
 *
 * ## What this file proved on PostgreSQL, and what of it is gone
 *
 * Its subject was `kitchen-print.ts`'s `for("share", { of: printers })` on the station→printer
 * mapping read. Three backends (`suite.pg.connect()` gave one per call), a transaction held open
 * mid-fire, and a `pg_locks where not granted` poll that waited until the deactivating backend was
 * seen queued behind that lock.
 *
 * **LOST, and replaced by nothing: the proof that the mapping read's lock is what holds the
 * property.** The clause is deleted rather than translated — SQLite has no row locks and drizzle's
 * SQLite query builder has no `.for()` — so there is no longer a clause to delete as a control. The
 * two distinct backends and the `pg_locks` catalogue have no counterpart either, and neither does
 * the deployment role: every write below used to run after `set local role app_user` on a
 * non-superuser connection, and `asAppUser` is now an empty body
 * (`packages/db/src/testing/roles.ts`).
 *
 * ## What replaced the lock observation, and the control behind it
 *
 * The venue file's write queue. `withTransaction` (`packages/db/src/tenancy.ts`) runs its body
 * inside `db.withWriteLock`, and `packages/store/src/write-queue.ts` issues `begin immediate`,
 * awaits the body, then `commit`, so the next caller's `begin` does not run until that `commit` has
 * returned — the mechanism stated once on `assertExtraListForWrite`
 * (`packages/catalogue/src/extras.ts`).
 *
 * So the thing observed moved: not "the deactivate is BLOCKED on a lock", but "the deactivate has
 * not STARTED". {@link parkedThenRelease} below takes that reading — the same shape as
 * `racePair` (`packages/catalogue/test/fixtures.ts`) and `packages/printing/src/runtime.race.test.ts`.
 *
 * Control in the other direction, taken here 2026-09-22 on Node v26.7.0: with `withTransaction`
 * removed from `parkedThenRelease`'s second body and nothing else changed, the case fails on
 * `the second transaction started while the first was still open: expected true to be false`;
 * restored, it passes. So the `false` is not a reading that could never have printed anything else
 * (CLAUDE.md §1).
 *
 * ## The narrower thing this case now asks, stated so nobody assumes the old one
 *
 * The PostgreSQL version staged the gap INSIDE the fire — the deactivate was made to contend while
 * the mapping read's lock was held, before `enqueuePrintJob`'s own `active = true` re-check. There
 * is no hook to park inside `enqueueKitchenTickets`, so the park point here is AFTER it returns:
 * the fire's statements have all run and are uncommitted. What is observed is therefore the QUEUE —
 * a second write transaction cannot start while the first is open, for any pair of bodies — and not
 * this call path in particular. The control above says the observation discriminates; it does not
 * say the interleave was reached, because it was not.
 *
 * ## What the case still asserts, unchanged
 *
 * The fire COMPLETES and enqueues its one job; the deactivation lands only afterwards; the printer
 * ends up inactive. Those are the outcomes the PostgreSQL version asserted, and they are what a
 * till operator and an admin each see. What no longer has a receipt is WHY they hold.
 */
import { randomUUID } from "node:crypto";
import { count as countRows, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import {
  asAppUser,
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
import "./errors.js";

const LOCALE = "es-ES";
const suite = useVenueDb({
  migrations: migrationOptionsFor(manifestSets(), null),
  timeoutMs: 60_000,
});

/** A promise that resolves when `open()` is called — holds a transaction open at an EXACT point rather
 *  than for a duration (a `setTimeout` barrier is the same unsynchronised race in slower clothing). */
function gate(): { passed: Promise<void>; open: () => void } {
  let open!: () => void;
  const passed = new Promise<void>((resolve) => {
    open = resolve;
  });
  return { passed, open };
}

/**
 * Starts `second` while `first` is parked mid-transaction, and reports that it has not run.
 *
 * `parked` resolves the instant the first body reaches the point the test wants held, so the second
 * transaction is staged with certainty rather than by timing luck. The 20 ms pause is a real one,
 * not a microtask turn: it has to give the second transaction every chance to run a statement it
 * must not run. `release` is called in a `finally`, so a failed observation still lets the first
 * body finish rather than hanging the suite.
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
      await asAppUser(tx);
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
      await createOpenOrder(tx, cfg, orderId, [{ productId: product, quantity: "1" }], null);
      const [line] = await tx
        .select({ id: workingOrderLines.id })
        .from(workingOrderLines)
        .where(eq(workingOrderLines.workingOrderId, orderId));
      return { cocinaId: cocina.id, printerId, orderId, lineId: line!.id };
    });

    const firedItems = [{ workingOrderLineId: lineId, stationId: cocinaId }];

    // ---- The race ----
    // The fire runs the REAL enqueueKitchenTickets and then parks with its transaction still open
    // and uncommitted. The deactivate of the SAME printer is started while it is parked, and must
    // not run: the printer this fire depends on may not change under it before it commits. The
    // file header states what this does and does not reach.
    const readDone = gate();
    const releaseA = gate();
    let deactivateDone = false;
    await parkedThenRelease(
      async (txA) => {
        await asAppUser(txA);
        await enqueueKitchenTickets(txA, cfg, orderId, firedItems);
        readDone.open(); // job enqueued; tx deliberately NOT committed yet
        await releaseA.passed;
      },
      readDone.passed,
      releaseA.open,
      async (txB) => {
        await asAppUser(txB);
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
    // Read through the table definition: `printers.active` is an integer column with a boolean read
    // mapping on this engine, so a raw `select active` would hand back 0/1 and the assertion below
    // — unchanged — would be comparing a number with `false`.
    const printerRow = await suite.db
      .select({ active: printers.active })
      .from(printers)
      .where(eq(printers.id, printerId));
    expect(printerRow[0]!.active).toBe(false);
  });
});
