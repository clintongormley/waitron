import { sql } from "drizzle-orm";
import { withTenant } from "@waitron/db";
import { usePgliteDb } from "@waitron/db/testing/lifecycle.js";
import { TEST_MIGRATIONS } from "../test/migrations.js";
import { TENANT_A, seedTenants } from "../test/fixtures.js";
import { registerSif } from "./registro-sif.js";
import { describe, expect, it } from "vitest";
import { deriveReservedSeriesCodes, liveSeriesBases, stripOwnSuffixes } from "./reserved-series.js";

describe("deriveReservedSeriesCodes", () => {
  it("suffixes each code with the installation number and preserves purpose", () => {
    const derived = deriveReservedSeriesCodes(
      [
        { code: "A", purpose: "standard" },
        { code: "R", purpose: "rectificative" },
      ],
      42,
    );
    expect(derived).toEqual([
      { code: "A-42", purpose: "standard" },
      { code: "R-42", purpose: "rectificative" },
    ]);
  });

  it("returns an empty array for empty input", () => {
    expect(deriveReservedSeriesCodes([], 42)).toEqual([]);
  });
});

describe("stripOwnSuffixes", () => {
  it("strips only trailing -<digits> groups that are registered installation numbers", () => {
    const registered = new Set([7, 210441234]);
    expect(stripOwnSuffixes("FA", registered)).toBe("FA");
    expect(stripOwnSuffixes("FA-7", registered)).toBe("FA");
    expect(stripOwnSuffixes("FA-210441234", registered)).toBe("FA");
    expect(stripOwnSuffixes("FA-7-210441234", registered)).toBe("FA");
    expect(stripOwnSuffixes("FA-2026", registered)).toBe("FA-2026");
    expect(stripOwnSuffixes("FA-2026-7", registered)).toBe("FA-2026");
  });
});

describe("liveSeriesBases", () => {
  // PGlite exercises the derivation over stored series; no privileges or contention are asserted.
  const suite = usePgliteDb({ migrations: [...TEST_MIGRATIONS], setup: seedTenants });

  it("keeps one base per (code, purpose) pair in first-seen order", async () => {
    await withTenant(suite.db, TENANT_A.id, async (tx) => {
      const node = { tenantId: TENANT_A.id, nodeId: TENANT_A.nodeId };
      const identity = { ...node, nif: "89890001K", idSistemaInformatico: "WT" };
      await registerSif(tx, identity);
      const registered = await registerSif(tx, identity);
      expect(registered.numeroInstalacion).toBe(2);
      await tx.execute(sql`
        insert into invoice_series (tenant_id, node_id, code, purpose) values
          (${node.tenantId}, ${node.nodeId}, 'FA', 'standard'),
          (${node.tenantId}, ${node.nodeId}, 'FA-2', 'standard')
      `);
      expect(await liveSeriesBases(tx, node)).toEqual([{ code: "FA", purpose: "standard" }]);

      await tx.execute(sql`
        insert into invoice_series (tenant_id, node_id, code, purpose) values
          (${node.tenantId}, ${node.nodeId}, 'RE', 'rectificative'),
          (${node.tenantId}, ${node.nodeId}, 'FA-2-2', 'rectificative'),
          (${node.tenantId}, ${node.nodeId}, 'FA-2-2-2', 'rectificative')
      `);
      expect(await liveSeriesBases(tx, node)).toEqual([
        { code: "FA", purpose: "standard" },
        { code: "FA-2-2", purpose: "rectificative" },
        { code: "RE", purpose: "rectificative" },
      ]);
    });
  });
});

describe("liveSeriesBases across purposes", () => {
  // Each fixture owns its database so registration counters and live codes cannot depend on test order.
  const suite = usePgliteDb({ migrations: [...TEST_MIGRATIONS], setup: seedTenants });

  it("keeps FA standard and FA-1 rectificative distinct when installation 1 is registered", async () => {
    await withTenant(suite.db, TENANT_A.id, async (tx) => {
      const node = { tenantId: TENANT_A.id, nodeId: TENANT_A.nodeId };
      const sif = await registerSif(tx, { ...node, nif: "89890001K", idSistemaInformatico: "WT" });
      expect(sif.numeroInstalacion).toBe(1);
      await tx.execute(sql`
          insert into invoice_series (tenant_id, node_id, code, purpose) values
            (${node.tenantId}, ${node.nodeId}, 'FA', 'standard'),
            (${node.tenantId}, ${node.nodeId}, 'FA-1', 'rectificative')
        `);
      expect(await liveSeriesBases(tx, node)).toEqual([
        { code: "FA", purpose: "standard" },
        { code: "FA-1", purpose: "rectificative" },
      ]);
    });
  });
});
