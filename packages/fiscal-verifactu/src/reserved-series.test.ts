import { seedFixtureSif as registerSif } from "../test/sif-fixture.js";
import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { newId, withTransaction } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { TEST_MIGRATIONS } from "../test/migrations.js";
import { TENANT_A, seedTenants } from "../test/fixtures.js";

import { deriveReservedSeriesCodes, liveSeriesBases, stripOwnSuffixes } from "./reserved-series.js";

describe("deriveReservedSeriesCodes", () => {
  it("suffixes each code with the installation number and preserves purpose", () => {
    const derived = deriveReservedSeriesCodes(
      [
        { code: "A", purpose: "standard" },
        { code: "R", purpose: "rectificative" },
      ],
      "P000042",
    );
    expect(derived).toEqual([
      { code: "A-P000042", purpose: "standard" },
      { code: "R-P000042", purpose: "rectificative" },
    ]);
  });

  it("returns an empty array for empty input", () => {
    expect(deriveReservedSeriesCodes([], "P000042")).toEqual([]);
  });
});

describe("stripOwnSuffixes", () => {
  it("strips only trailing groups that are registered installation identities", () => {
    const registered = new Set(["S000001", "P000042"]);
    expect(stripOwnSuffixes("FA", registered)).toBe("FA");
    expect(stripOwnSuffixes("FA-S000001", registered)).toBe("FA");
    expect(stripOwnSuffixes("FA-P000042", registered)).toBe("FA");
    expect(stripOwnSuffixes("FA-S000001-P000042", registered)).toBe("FA");
    expect(stripOwnSuffixes("FA-2026", registered)).toBe("FA-2026");
    expect(stripOwnSuffixes("FA-2026-S000001", registered)).toBe("FA-2026");
  });
});

describe("liveSeriesBases", () => {
  const suite = useVenueDb({ migrations: [...TEST_MIGRATIONS], setup: seedTenants });

  it("keeps one base per (code, purpose) pair in first-seen order", async () => {
    await withTransaction(suite.db, async (tx) => {
      const node = { nodeId: TENANT_A.nodeId };
      const identity = { ...node, nif: "89890001K", idSistemaInformatico: "WT" };
      await registerSif(tx, { ...identity, numeroInstalacion: "S000001" });
      const registered = await registerSif(tx, { ...identity, numeroInstalacion: "P000042" });
      expect(registered.numeroInstalacion).toBe("P000042");
      // Raw inserts supply `id`: its `$defaultFn` runs only for a builder insert.
      await tx.execute(sql`
        insert into invoice_series (id, node_id, code, purpose) values (${newId()}, ${node.nodeId}, 'FA', 'standard'),
          (${newId()}, ${node.nodeId}, 'FA-P000042', 'standard')
      `);
      expect(await liveSeriesBases(tx, node)).toEqual([{ code: "FA", purpose: "standard" }]);

      await tx.execute(sql`
        insert into invoice_series (id, node_id, code, purpose) values (${newId()}, ${node.nodeId}, 'RE', 'rectificative'),
          (${newId()}, ${node.nodeId}, 'FA-P000042-P000042', 'rectificative'),
          (${newId()}, ${node.nodeId}, 'FA-P000042-P000042-P000042', 'rectificative')
      `);
      expect(await liveSeriesBases(tx, node)).toEqual([
        { code: "FA", purpose: "standard" },
        { code: "FA-P000042-P000042", purpose: "rectificative" },
        { code: "RE", purpose: "rectificative" },
      ]);
    });
  });
});

describe("liveSeriesBases across purposes", () => {
  const suite = useVenueDb({ migrations: [...TEST_MIGRATIONS], setup: seedTenants });

  it("keeps FA standard and FA-S000001 rectificative distinct when S000001 is registered", async () => {
    await withTransaction(suite.db, async (tx) => {
      const node = { nodeId: TENANT_A.nodeId };
      const sif = await registerSif(tx, {
        ...node,
        nif: "89890001K",
        idSistemaInformatico: "WT",
        numeroInstalacion: "S000001",
      });
      expect(sif.numeroInstalacion).toBe("S000001");
      await tx.execute(sql`
          insert into invoice_series (id, node_id, code, purpose) values (${newId()}, ${node.nodeId}, 'FA', 'standard'),
            (${newId()}, ${node.nodeId}, 'FA-S000001', 'rectificative')
        `);
      expect(await liveSeriesBases(tx, node)).toEqual([
        { code: "FA", purpose: "standard" },
        { code: "FA-S000001", purpose: "rectificative" },
      ]);
    });
  });
});

describe("externally allocated installation suffixes", () => {
  it("removes retained paper and emergency identities without removing a human suffix", () => {
    const registered = new Set(["P000042", "E00000000000000000000000000"]);
    expect(stripOwnSuffixes("FA-P000042", registered)).toBe("FA");
    expect(stripOwnSuffixes("FA-P000042-E00000000000000000000000000", registered)).toBe("FA");
    expect(stripOwnSuffixes("FA-2026-P000042", registered)).toBe("FA-2026");
    expect(stripOwnSuffixes("FA-P000043", registered)).toBe("FA-P000043");
  });
});
