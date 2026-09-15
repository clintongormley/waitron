import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { withTransaction } from "@waitron/db";
import { usePgliteDb } from "@waitron/db/testing/lifecycle.js";
import { locationId as brandLocationId, tenantId as brandTenantId } from "@waitron/shared";
import type { ProvisionedNode } from "@waitron/module";
import { appendToChain } from "./chain.js";
import { currentSif, esPrimerRegistro } from "./registro-sif.js";
import { installationFloor, restoreFiscal } from "./restore.js";
import { altaFor, seedSale, seedTill } from "./testing/seed.js";

const suite = usePgliteDb({ migrations: migrationOptionsFor(manifestSets(), null) });
const NOW = new Date("2026-09-06T10:00:00.000Z");

// `ProvisionedNode` (`@waitron/module`) still declares a `tenantId` and nothing in this package
// reads one; it goes when `packages/provisioning`, its last supplier, is converted. This fixed
// value stands in until then.
const INERT_TENANT_ID = brandTenantId("00000000-0000-4000-8000-000000000001");

describe("restoreFiscal", () => {
  it("re-registers a sold node onto a fresh, floored SIF with an empty chain head", async () => {
    const till = await seedTill(suite.db);
    const { rows } = await suite.db.execute<{ location_id: string }>(
      sql`select location_id from nodes where id = ${till.nodeId}`,
    );
    const node: ProvisionedNode = {
      tenantId: INERT_TENANT_ID,
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
    const { rows: ledger } = await suite.db.execute<{ n: number }>(
      sql`select count(*)::int as n from registros_facturacion where node_id = ${till.nodeId}`,
    );
    expect(ledger[0]?.n).toBe(1);
    expect(outcome.series?.map((s) => s.code)).toEqual([`GA-${after.numeroInstalacion}`]); // seedTill's `GA` standard series
  });
});
