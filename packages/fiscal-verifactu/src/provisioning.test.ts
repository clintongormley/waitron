import { sql } from "drizzle-orm";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { captureError, deployment, withTransaction, type Database } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { isAppError } from "@waitron/shared";
import type { ProvisionedNode } from "@waitron/module";
import { TEST_MIGRATIONS } from "../test/migrations.js";
import { TAXPAYER_A, seedTaxpayers } from "../test/fixtures.js";
import { FISCAL_PROVISIONING, WAITRON_ID_SISTEMA } from "./provisioning.js";
import { ALLOCATED_FISCAL_RESTORE } from "./allocated-lifecycle.js";
import { allocationFixture } from "../test/allocation-fixture.js";
import { readChainHead } from "./chain.js";
import { ID_SISTEMA_MAX_LENGTH } from "../test/sif-fixture.js";
import { currentSif } from "./registro-sif.js";

const suite = useVenueDb({ migrations: TEST_MIGRATIONS, timeoutMs: 60_000 });

let db: Database;

const NODE: ProvisionedNode = {
  nodeId: TAXPAYER_A.nodeId,
};

const seed = FISCAL_PROVISIONING.seed!;

beforeAll(() => {
  db = suite.db;
});

beforeEach(async () => {
  await seedTaxpayers(db);
  await db.insert(deployment).values({ id: 1, environment: "preproduction" });
});

describe("WAITRON_ID_SISTEMA", () => {
  it("is a product code within the bound registerSif enforces", () => {
    expect(WAITRON_ID_SISTEMA.length).toBeGreaterThan(0);
    expect(WAITRON_ID_SISTEMA.length).toBeLessThanOrEqual(ID_SISTEMA_MAX_LENGTH);
  });
});

describe("FISCAL_PROVISIONING.seed", () => {
  it("names its effect for the operator's plan", () => {
    expect(seed.summary).toMatch(/SIF/);
  });

  it("registers the node as a SIF under the taxpayer's own tax id and the product's software id", async () => {
    const fixture = allocationFixture({
      node: NODE,
      bases: [
        { code: "FA", purpose: "standard" },
        { code: "RF", purpose: "corrective" },
      ],
      identity: "S000001",
    });
    const report = await fixture.transaction(db, "setup", (tx, operation) =>
      seed.run(tx, NODE, operation),
    );
    const sif = await withTransaction(db, (tx) => currentSif(tx, TAXPAYER_A.nodeId));
    expect(sif.nif).toBe("89890001K"); // seedTaxpayers' tax_id for TAXPAYER_A, never an argument
    expect(sif.idSistemaInformatico).toBe(WAITRON_ID_SISTEMA);
    expect(sif.numeroInstalacion).toBe("S000001");
    expect(report).toContain(sif.id);
    expect(report).toContain("installation S000001");
  });

  it("refuses to seed a database with no taxpayer row, loudly and without a domain code", async () => {
    // Minting a SIF under a guessed NIF is unrepairable; no operator action fixes an empty table.
    await db.execute(sql`delete from taxpayer`);
    const error = await captureError(() => withTransaction(db, (tx) => seed.run(tx, NODE)));
    expect(isAppError(error)).toBe(false);
    expect((error as Error).message).toContain("taxpayer is empty");
  });

  it("restoring an existing node mints a fresh installation number and a new chain", async () => {
    const bases = [
      { code: "FA", purpose: "standard" },
      { code: "RF", purpose: "corrective" },
    ];
    const initial = allocationFixture({ node: NODE, bases, identity: "S000001" });
    const recovery = allocationFixture({ node: NODE, bases, identity: "P000042" });
    await initial.transaction(db, "setup", (tx, operation) => seed.run(tx, NODE, operation));
    await recovery.transaction(db, "restore", (tx, operation) =>
      ALLOCATED_FISCAL_RESTORE(tx, NODE, operation),
    );
    const sif = await withTransaction(db, (tx) => currentSif(tx, TAXPAYER_A.nodeId));
    expect(sif.numeroInstalacion).toBe("P000042");
    const head = await withTransaction(db, (tx) => readChainHead(tx, TAXPAYER_A.nodeId));
    expect(head.ultimaHuella).toBeNull();
  });
});
