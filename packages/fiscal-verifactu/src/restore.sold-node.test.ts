import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { deployment, withTransaction } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { locationId as brandLocationId } from "@waitron/shared";
import type { ProvisionedNode } from "@waitron/module";
import { appendToChain } from "./chain.js";
import { currentSif, esPrimerRegistro } from "./registro-sif.js";
import { ALLOCATED_FISCAL_RESTORE } from "./allocated-lifecycle.js";
import { allocationFixture } from "../test/allocation-fixture.js";
import { altaFor, seedSale, seedTill } from "./testing/seed.js";

const suite = useVenueDb({ migrations: migrationOptionsFor(manifestSets(), null) });

describe("restoreFiscal", () => {
  it("re-registers a sold node onto the supplied SIF with an empty chain head", async () => {
    const till = await seedTill(suite.db);
    const { rows } = await suite.db.execute<{ location_id: string }>(
      sql`select location_id from nodes where id = ${till.nodeId}`,
    );
    const node: ProvisionedNode = {
      locationId: brandLocationId(rows[0]!.location_id),
      nodeId: till.nodeId,
    };
    const sale = await seedSale(suite.db, till, 1);
    await suite.db.transaction((tx) => appendToChain(tx, till.nodeId, altaFor(till, sale, 1, 1)));
    const before = await withTransaction(suite.db, (tx) => currentSif(tx, till.nodeId));

    await suite.db.insert(deployment).values({ id: 1, environment: "preproduction" });
    const fixture = allocationFixture({
      node,
      bases: [{ code: "GA", purpose: "standard" }],
      identity: "P000042",
      taxpayerNif: before.nif,
      softwareId: before.idSistemaInformatico,
    });
    const outcome = await fixture.transaction(suite.db, "restore", (tx, operation) =>
      ALLOCATED_FISCAL_RESTORE(tx, node, operation),
    );

    const after = await withTransaction(suite.db, (tx) => currentSif(tx, till.nodeId));
    expect(after.id).not.toBe(before.id);
    expect(after.numeroInstalacion).toBe("P000042");
    expect(after.numeroInstalacion).not.toBe(before.numeroInstalacion);
    expect(await withTransaction(suite.db, (tx) => esPrimerRegistro(tx, till.nodeId))).toBe(true);
    const { rows: ledger } = await suite.db.execute<{ n: number }>(
      sql`select count(*) as n from registros_facturacion where node_id = ${till.nodeId}`,
    );
    expect(ledger[0]?.n).toBe(1);
    expect(outcome.series).toBeUndefined();
    const { rows: series } = await suite.db.execute<{ code: string; purpose: string }>(sql`
      select code, purpose from invoice_series
      where node_id = ${node.nodeId} and retired_at is null order by code
    `);
    expect(series).toEqual([{ code: "GA-P000042", purpose: "standard" }]);
  });
});
