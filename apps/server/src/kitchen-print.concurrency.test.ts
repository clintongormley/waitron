import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { asAppUser, withTenant, workingOrderLines } from "@waitron/db";
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
import "./errors.js";

// REAL Postgres, NOT PGlite: this proves a LOCK interaction between two concurrent backends, and PGlite
// serialises every query onto one backend — it CANNOT reach the race and would be a false pass
// (CLAUDE.md §4). The fire tx runs at READ COMMITTED (`withTenant` = `db.transaction()`), so without the
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
    const waiting = await probe.execute<{ n: number }>(
      sql`select count(*)::int as n from pg_locks where not granted`,
    );
    if (Number(waiting.rows[0]!.n) > 0) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(
    "no backend ever blocked — the FOR SHARE barrier this test depends on did not engage",
  );
}

function printCfg(cfg: TillConfig): PrintConfig {
  return { tenantId: cfg.tenantId, locationId: cfg.locationId };
}

describe("print-on-fire concurrency — FOR SHARE on the mapping read", () => {
  it("a concurrent deactivatePrinter WAITS for the fire to commit instead of aborting it", async () => {
    // ---- Setup, committed on the admin connection so both racing backends see it ----
    const tenantId = await seedTenant(suite.admin);
    const loc = await suite.admin.execute<{ id: string }>(sql`
      insert into locations (tenant_id, name, invoice_locales, operation_description)
      values (${tenantId}, 'Barra', array[${LOCALE}], 'Venta en establecimiento') returning id`);
    const locationId = loc.rows[0]!.id;
    const till = await suite.admin.execute<{ id: string }>(sql`
      insert into tills (tenant_id, location_id, name)
      values (${tenantId}, ${locationId}, 'Caja 1') returning id`);
    const nodeId = await seedNode(suite.admin, tenantId, brandLocationId(locationId));
    const cfg: TillConfig = {
      tenantId,
      tillId: brandTillId(till.rows[0]!.id),
      nodeId: brandNodeId(nodeId),
      seriesId: brandSeriesId(randomUUID()),
      locationId: brandLocationId(locationId),
      locale: LOCALE,
      invoiceLocales: [LOCALE],
      cardProvider: "none",
      tipsEnabled: false,
      orderFlow: "prepay",
    };
    const { cocinaId, printerId, orderId, lineId } = await withTenant(
      suite.admin,
      tenantId,
      async (tx) => {
        await asAppUser(tx);
        const cat = await createCatalogue(tx, tenantId, { name: "Carta" });
        await assignCatalogueToLocation(tx, locationId, cat.id);
        const cocina = await createStation(tx, cfg, { name: "Cocina", isDefault: true });
        const { id: printerId } = await createPrinter(tx, printCfg(cfg), {
          name: "Cocina printer",
          transport: "cloud_poll",
          pollId: `poll-${randomUUID()}`,
        });
        await attachPrinterToStation(tx, printCfg(cfg), { stationId: cocina.id, printerId });
        const { id: product } = await createProduct(tx, tenantId, {
          catalogueId: cat.id,
          categoryId: null,
          descriptions: { [LOCALE]: "Chuleton" },
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
      { nodeId: cfg.nodeId },
    );

    const firedItems = [{ workingOrderLineId: lineId, stationId: cocinaId }];

    // ---- The race ----
    // Connection A: run the REAL enqueueKitchenTickets (takes FOR SHARE on the printer + enqueues) and
    // then HOLD the transaction open — so the FOR SHARE lock is still held when B tries to deactivate.
    const readDone = gate();
    const releaseA = gate();
    const firePromise = withTenant(
      a,
      tenantId,
      async (txA) => {
        await asAppUser(txA);
        await enqueueKitchenTickets(txA, cfg, orderId, firedItems);
        readDone.open(); // lock taken + job enqueued; tx deliberately NOT committed yet
        await releaseA.passed;
      },
      { nodeId: cfg.nodeId },
    );
    await readDone.passed; // A now holds FOR SHARE on the printer row

    // Connection B: deactivate the SAME printer. Its UPDATE needs a FOR NO KEY UPDATE row lock, which
    // conflicts with A's FOR SHARE, so it MUST block until A commits.
    let deactivateDone = false;
    const deactivatePromise = withTenant(
      b,
      tenantId,
      async (txB) => {
        await asAppUser(txB);
        await deactivatePrinter(txB, printCfg(cfg), printerId);
      },
      { nodeId: cfg.nodeId },
    ).then(() => {
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
    const jobs = await suite.admin.execute<{ n: number }>(
      sql`select count(*)::int as n from print_jobs where printer_id = ${printerId}`,
    );
    expect(Number(jobs.rows[0]!.n)).toBe(1);
    const printerRow = await suite.admin.execute<{ active: boolean }>(
      sql`select active from printers where id = ${printerId}`,
    );
    expect(printerRow.rows[0]!.active).toBe(false);
  });
});
