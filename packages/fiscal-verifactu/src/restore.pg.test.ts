import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { withTenant } from "@waitron/db";
import { usePgliteDb } from "@waitron/db/testing/lifecycle.js";
import { locationId as brandLocationId } from "@waitron/shared";
import type { ProvisionedNode } from "@waitron/module";
import { appendToChain } from "./chain.js";
import { currentSif, esPrimerRegistro } from "./registro-sif.js";
import { installationFloor, restoreFiscal } from "./restore.js";
import { altaFor, seedSale, seedTill } from "./testing/seed.js";

const suite = usePgliteDb({ migrations: migrationOptionsFor(manifestSets(), null) });
const NOW = new Date("2026-09-06T10:00:00.000Z");

describe("restoreFiscal", () => {
  it("re-registers a sold node onto a fresh, floored SIF with an empty chain head", async () => {
    const till = await seedTill(suite.db);
    const { rows } = await suite.db.execute<{ location_id: string }>(
      sql`select location_id from nodes where id = ${till.nodeId}`,
    );
    const node: ProvisionedNode = {
      tenantId: till.tenantId,
      locationId: brandLocationId(rows[0]!.location_id),
      nodeId: till.nodeId,
    };
    const sale = await seedSale(suite.db, till, 1);
    await suite.db.transaction((tx) =>
      appendToChain(tx, till.tenantId, till.nodeId, altaFor(till.tillId, sale, 1, 1)),
    );
    const before = await withTenant(suite.db, till.tenantId, (tx) =>
      currentSif(tx, till.tenantId, till.nodeId),
    );

    const outcome = await withTenant(suite.db, till.tenantId, (tx) => restoreFiscal(tx, node, NOW));

    const after = await withTenant(suite.db, till.tenantId, (tx) =>
      currentSif(tx, till.tenantId, till.nodeId),
    );
    expect(after.id).not.toBe(before.id);
    expect(after.numeroInstalacion).toBeGreaterThanOrEqual(installationFloor(NOW));
    expect(
      await withTenant(suite.db, till.tenantId, (tx) =>
        esPrimerRegistro(tx, till.tenantId, till.nodeId),
      ),
    ).toBe(true);
    const { rows: ledger } = await suite.db.execute<{ n: number }>(
      sql`select count(*)::int as n from registros_facturacion where node_id = ${till.nodeId}`,
    );
    expect(ledger[0]?.n).toBe(1);
    expect(outcome.series?.map((s) => s.code)).toEqual([`GA-${after.numeroInstalacion}`]); // seedTill's `GA` standard series
  });
});
