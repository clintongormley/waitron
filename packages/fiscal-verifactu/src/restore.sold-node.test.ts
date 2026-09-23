/**
 * `restoreFiscal` over a node that has actually sold.
 *
 * Named for its fixture, which is the only thing separating it from the sibling `restore.test.ts`:
 * the SIF, the series, the sale and the chain head the restore runs over here are written by the
 * production path (`seedTill`, `seedSale`, `appendToChain`), where that file's first case asserts
 * the same properties over rows `test/fixtures.ts`'s `seedSoldRegistro` wrote by hand.
 */
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { withTransaction } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { locationId as brandLocationId } from "@waitron/shared";
import type { ProvisionedNode } from "@waitron/module";
import { appendToChain } from "./chain.js";
import { currentSif, esPrimerRegistro } from "./registro-sif.js";
import { installationFloor, restoreFiscal } from "./restore.js";
import { altaFor, seedSale, seedTill } from "./testing/seed.js";

const suite = useVenueDb({ migrations: migrationOptionsFor(manifestSets(), null) });
const NOW = new Date("2026-09-06T10:00:00.000Z");

describe("restoreFiscal", () => {
  it("re-registers a sold node onto a fresh, floored SIF with an empty chain head", async () => {
    const till = await seedTill(suite.db);
    const { rows } = await suite.db.execute<{ location_id: string }>(
      sql`select location_id from nodes where id = ${till.nodeId}`,
    );
    const node: ProvisionedNode = {
      locationId: brandLocationId(rows[0]!.location_id),
      nodeId: till.nodeId,
    };
    const sale = await seedSale(suite.db, till, 1);
    await suite.db.transaction((tx) =>
      appendToChain(tx, till.nodeId, altaFor(till.tillId, sale, 1, 1)),
    );
    const before = await withTransaction(suite.db, (tx) => currentSif(tx, till.nodeId));

    const outcome = await withTransaction(suite.db, (tx) => restoreFiscal(tx, node, NOW));

    const after = await withTransaction(suite.db, (tx) => currentSif(tx, till.nodeId));
    expect(after.id).not.toBe(before.id);
    expect(after.numeroInstalacion).toBeGreaterThanOrEqual(installationFloor(NOW));
    expect(await withTransaction(suite.db, (tx) => esPrimerRegistro(tx, till.nodeId))).toBe(true);
    // `count(*)::int` was casting away the BigInt the PostgreSQL driver returned. Measured on
    // node v26.7.0 against `node:sqlite`: `select count(*) as n` comes back as a JavaScript
    // `number` (`typeof` is `"number"`), so nothing needs casting — and the `::` the cast needed
    // reaches this engine as `unrecognized token: ":"`, the failure this file opened with.
    const { rows: ledger } = await suite.db.execute<{ n: number }>(
      sql`select count(*) as n from registros_facturacion where node_id = ${till.nodeId}`,
    );
    expect(ledger[0]?.n).toBe(1);
    expect(outcome.series?.map((s) => s.code)).toEqual([`GA-${after.numeroInstalacion}`]); // seedTill's `GA` standard series
  });
});
