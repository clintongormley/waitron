import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { withTenant } from "@waitron/db";
import { useTemplateDb } from "@waitron/db/testing/lifecycle.js";
import { locationId as brandLocationId } from "@waitron/shared";
import type { ProvisionedNode } from "@waitron/module";
import { appendToChain } from "./chain.js";
import { currentSif, esPrimerRegistro } from "./registro-sif.js";
import { installationFloor, restoreFiscal } from "./restore.js";
import { altaFor, seedSale, seedTill } from "./testing/seed.js";

// On real PostgreSQL as the superuser-class admin, checks a fresh live SIF identity, an installation
// number at least the clock floor, an empty chain head, the retained ledger count and derived series
// codes. This does not test preserving a counter above the floor or non-superuser RLS enforcement.
const suite = useTemplateDb({ template: "manifest" });
const NOW = new Date("2026-09-06T10:00:00.000Z");

describe("restoreFiscal on real PostgreSQL", () => {
  it("re-registers a sold node onto a fresh, floored SIF with an empty chain head", async () => {
    const till = await seedTill(suite.admin);
    const { rows } = await suite.admin.execute<{ location_id: string }>(
      sql`select location_id from nodes where id = ${till.nodeId}`,
    );
    const node: ProvisionedNode = {
      tenantId: till.tenantId,
      locationId: brandLocationId(rows[0]!.location_id),
      nodeId: till.nodeId,
    };
    const sale = await seedSale(suite.admin, till, 1);
    await suite.admin.transaction((tx) =>
      appendToChain(tx, till.tenantId, till.nodeId, altaFor(till.tillId, sale, 1, 1)),
    );
    const before = await withTenant(suite.admin, till.tenantId, (tx) =>
      currentSif(tx, till.tenantId, till.nodeId),
    );

    const outcome = await withTenant(suite.admin, till.tenantId, (tx) =>
      restoreFiscal(tx, node, NOW),
    );

    const after = await withTenant(suite.admin, till.tenantId, (tx) =>
      currentSif(tx, till.tenantId, till.nodeId),
    );
    expect(after.id).not.toBe(before.id);
    expect(after.numeroInstalacion).toBeGreaterThanOrEqual(installationFloor(NOW));
    expect(
      await withTenant(suite.admin, till.tenantId, (tx) =>
        esPrimerRegistro(tx, till.tenantId, till.nodeId),
      ),
    ).toBe(true);
    const { rows: ledger } = await suite.admin.execute<{ n: number }>(
      sql`select count(*)::int as n from registros_facturacion where node_id = ${till.nodeId}`,
    );
    expect(ledger[0]?.n).toBe(1);
    expect(outcome.series?.map((s) => s.code)).toEqual([`GA-${after.numeroInstalacion}`]); // seedTill's `GA` standard series
  });
});
