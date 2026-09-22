/**
 * RED ON THIS BRANCH, AND NOT BY OVERSIGHT — the `for("share", { of: printers })` on
 * `kitchen-print.ts`'s station→printer mapping read, which is this whole suite's subject, is gone.
 *
 * The clause is deleted, not translated: SQLite has no row locks and drizzle's SQLite query builder
 * has no `.for()`. What keeps a `deactivatePrinter` out of the gap between the mapping read and
 * `enqueuePrintJob`'s own `active = true` re-check instead is the venue file's write queue — one
 * write transaction on the file at a time — stated once, with its measurement and its control, on
 * `assertExtraListForWrite` (`packages/catalogue/src/extras.ts`).
 *
 * The proof below cannot be re-run to say whether it still discriminates, because this suite does
 * not COLLECT: `useTemplateDb` throws
 * `useTemplateDb: no shared container in scope. Wire the package's vitest globalSetup to a file
 * that calls startSharedContainer and provide("sharedPg", handle).` — the real-PostgreSQL harness
 * this branch removed. Measured 2026-09-22 by running this file alone. It is left in place rather
 * than deleted because its behavioural subject — a fire COMPLETES rather than aborting with
 * `printer.not_found` when an admin deactivates the same printer at the same moment — still has to
 * hold on this engine, and nothing asserts it yet. Its MECHANISM sentences are false about the
 * current code, and the ones in `kitchen-print.ts` have been corrected.
 *
 * Two things in here have no SQLite form at all and should not be rewritten: the `pg_locks` probe
 * (`waitForABlockedBackend`), and the three separate backends, which exist because PGlite serialises
 * every query onto one. On this engine the corresponding question is whether the write queue admits
 * the second transaction, and `racePair` (`packages/catalogue/test/fixtures.ts`) is the shape that
 * asks it.
 *
 * WHAT THE PostgreSQL-ONLY SWEEP CHANGED HERE, and what it deliberately did not. The fixture's
 * `locations`/`tills` inserts now go through their table definitions, because `array[…]` is a
 * syntax error on this engine and both ids are JavaScript generators a raw insert never reaches.
 * Three reads lost a `::int`/`::` cast that was only ever shaping the DRIVER's answer: each call
 * site already wraps the value in `Number(…)` or reads it through the column, so no assertion
 * moved. The `pg_locks` SELECT itself is left exactly as it was, cast apart — it is PostgreSQL's
 * own catalogue and there is nothing to translate it INTO.
 *
 * NOTHING BELOW HAS BEEN RUN on this branch, this sweep included: the file still does not COLLECT,
 * for the `useTemplateDb` reason above (re-measured 2026-09-22 by running this file alone after the
 * sweep — `1 test | 1 skipped`, then the file fails). So the conversions here are checked by the
 * typechecker and by reading, and by nothing else.
 */
import { randomUUID } from "node:crypto";
import { count as countRows, eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  asAppUser,
  locations,
  printJobs,
  printers,
  tills,
  withTransaction,
  workingOrderLines,
} from "@waitron/db";
import type { Database } from "@waitron/db";
import { useTemplateDb } from "@waitron/db/testing/lifecycle.js";
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

// REAL Postgres, NOT PGlite: this proves a LOCK interaction between two concurrent backends, and PGlite
// serialises every query onto one backend — it CANNOT reach the race and would be a false pass
// (CLAUDE.md §4). The fire tx runs at READ COMMITTED: `withTransaction` opens it through
// `db.transaction()` and asks for no isolation level, so the server's default stands. Without the
// `FOR SHARE` lock a `deactivatePrinter` committing between enqueueKitchenTickets' mapping read and
// `enqueuePrintJob`'s own `active = true` re-check would flip the printer inactive and throw
// `printer.not_found`, aborting the fire (a §5 never-block violation). With the lock, the deactivation
// must WAIT until the fire commits.
const LOCALE = "es-ES";
const suite = useTemplateDb({ template: "manifest" });

// Two racing backends (A fires, B deactivates) plus a read-only probe that watches `pg_locks`. Each
// needs its OWN backend process — `suite.pg.connect()` promises that per call — so the block below is a
// real cross-connection wait, not a self-deadlock on one backend. `suite.admin` only seeds.
let a: Database;
let b: Database;
let probe: Database;

beforeAll(async () => {
  a = await suite.pg.connect();
  b = await suite.pg.connect();
  probe = await suite.pg.connect();
});

afterAll(async () => {
  if (a !== undefined) await a.close();
  if (b !== undefined) await b.close();
  if (probe !== undefined) await probe.close();
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

/** Block until some backend is WAITING on a lock it has not been granted — the deterministic barrier
 *  that replaces "sleep and hope". `pg_locks` is readable by any role and an ungranted entry is the
 *  literal fact we need: connection B's deactivate UPDATE is queued behind A's FOR SHARE lock. */
async function waitForABlockedBackend(): Promise<void> {
  for (let attempt = 0; attempt < 400; attempt += 1) {
    // `pg_locks` is PostgreSQL's own catalogue and stays as it is. Only the `::int` went: it existed
    // so node-postgres handed back a number rather than a bigint string, and the `Number(...)` on
    // the next line already covers that.
    const waiting = await probe.execute<{ n: number }>(
      sql`select count(*) as n from pg_locks where not granted`,
    );
    if (Number(waiting.rows[0]!.n) > 0) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(
    "no backend ever blocked — the FOR SHARE barrier this test depends on did not engage",
  );
}

function printCfg(cfg: TillConfig): PrintConfig {
  return { locationId: cfg.locationId };
}

describe("print-on-fire concurrency — FOR SHARE on the mapping read", () => {
  it("a concurrent deactivatePrinter WAITS for the fire to commit instead of aborting it", async () => {
    // ---- Setup, committed on the admin connection so both racing backends see it ----
    await seedTenant(suite.admin);
    await seedLegacySellingUnits(suite.admin);
    const [loc] = await suite.admin
      .insert(locations)
      .values({
        name: "Barra",
        invoiceLocales: [LOCALE],
        operationDescription: "Venta en establecimiento",
      })
      .returning({ id: locations.id });
    const locationId = loc!.id;
    const [till] = await suite.admin
      .insert(tills)
      .values({ locationId, name: "Caja 1" })
      .returning({ id: tills.id });
    const nodeId = await seedNode(suite.admin, brandLocationId(locationId));
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
    const { cocinaId, printerId, orderId, lineId } = await withTransaction(
      suite.admin,
      async (tx) => {
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
      },
    );

    const firedItems = [{ workingOrderLineId: lineId, stationId: cocinaId }];

    // ---- The race ----
    // Connection A: run the REAL enqueueKitchenTickets (takes FOR SHARE on the printer + enqueues) and
    // then HOLD the transaction open — so the FOR SHARE lock is still held when B tries to deactivate.
    const readDone = gate();
    const releaseA = gate();
    const firePromise = withTransaction(a, async (txA) => {
      await asAppUser(txA);
      await enqueueKitchenTickets(txA, cfg, orderId, firedItems);
      readDone.open(); // lock taken + job enqueued; tx deliberately NOT committed yet
      await releaseA.passed;
    });
    await readDone.passed; // A now holds FOR SHARE on the printer row

    // Connection B: deactivate the SAME printer. Its UPDATE needs a FOR NO KEY UPDATE row lock, which
    // conflicts with A's FOR SHARE, so it MUST block until A commits.
    let deactivateDone = false;
    const deactivatePromise = withTransaction(b, async (txB) => {
      await asAppUser(txB);
      await deactivatePrinter(txB, printCfg(cfg), printerId);
    }).then(() => {
      deactivateDone = true;
    });

    // Deterministic proof B is blocked: a backend is waiting on an ungranted lock, and B has not
    // completed while A holds the FOR SHARE.
    await waitForABlockedBackend();
    expect(deactivateDone).toBe(false);

    // Let A commit — the fire SUCCEEDS (no printer.not_found throw despite B's pending deactivation).
    releaseA.open();
    await firePromise;

    // Only NOW can B proceed; it completes and the printer ends up inactive.
    await deactivatePromise;
    expect(deactivateDone).toBe(true);

    // The fire enqueued its job (proof it was never aborted), and B's deactivation landed AFTER it.
    const jobs = await suite.admin
      .select({ n: countRows() })
      .from(printJobs)
      .where(eq(printJobs.printerId, printerId));
    expect(Number(jobs[0]!.n)).toBe(1);
    // Read through the table definition: `printers.active` is an integer column with a boolean read
    // mapping on this engine, so a raw `select active` would hand back 0/1 and the assertion below
    // — unchanged — would be comparing a number with `false`.
    const printerRow = await suite.admin
      .select({ active: printers.active })
      .from(printers)
      .where(eq(printers.id, printerId));
    expect(printerRow[0]!.active).toBe(false);
  });
});
