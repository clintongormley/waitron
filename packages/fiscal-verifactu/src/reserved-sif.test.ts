import { sql } from "drizzle-orm";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Transaction } from "@waitron/db";
import { usePgliteDb } from "@waitron/db/testing/lifecycle.js";
import {
  currentSif,
  esPrimerRegistro,
  reserveInstallationNumber,
  writeReservedSif,
} from "./registro-sif.js";
import { seedNodesForSifContention, type SifContentionFixture } from "./testing/seed.js";

const suite = usePgliteDb({ migrations: migrationOptionsFor(manifestSets(), null) });

const SISTEMA = "W1";

let fixture: SifContentionFixture;

// Each case starts with unregistered nodes and an empty installation counter.
beforeEach(async () => {
  fixture = await seedNodesForSifContention(suite.db, 2);
});

afterEach(async () => {
  // These fixtures have no filed records; clear only their mutable identity and capture rows.
  await suite.db.transaction(async (tx) => {
    await tx.execute(sql`set local app.sync_apply = 'on'`);
    for (const table of [
      "cadenas",
      "registro_sif",
      "contadores_instalacion",
      "nodes",
      "locations",
      "tenants",
      "sync_log",
    ]) {
      await tx.execute(sql`delete from ${sql.identifier(table)}`);
    }
  });
});

function withTx<T>(fn: (tx: Transaction) => Promise<T>): Promise<T> {
  return suite.db.transaction(fn);
}

describe("reserved-sif primitives", () => {
  it("reserveInstallationNumber advances the counter and hands back the pre-increment value", async () => {
    // First reservation for a fresh (nif, idSistema) returns 1, the next returns 2 (never-reuse).
    const first = await withTx((tx) =>
      reserveInstallationNumber(tx, { nif: fixture.nif, idSistemaInformatico: SISTEMA }),
    );
    const second = await withTx((tx) =>
      reserveInstallationNumber(tx, { nif: fixture.nif, idSistemaInformatico: SISTEMA }),
    );
    expect(first).toBe(1);
    expect(second).toBe(2);
  });

  it("writeReservedSif persists a dormant SIF with the supplied number and a fresh empty chain", async () => {
    const cloud = fixture.nodeIds[1]!;
    const numero = await withTx((tx) =>
      reserveInstallationNumber(tx, { nif: fixture.nif, idSistemaInformatico: SISTEMA }),
    );
    await withTx((tx) =>
      writeReservedSif(tx, {
        tenantId: fixture.tenantId,
        nodeId: cloud,
        nif: fixture.nif,
        idSistemaInformatico: SISTEMA,
        numeroInstalacion: numero,
      }),
    );
    // The reserved SIF is the node's live identity (revocado_en IS NULL) and carries the supplied
    // number — never re-minted here.
    const sif = await withTx((tx) => currentSif(tx, fixture.tenantId, cloud));
    expect(sif.numeroInstalacion).toBe(numero);
    expect(sif.revocadoEn).toBeNull();
    // ...on a brand-new empty chain (first record).
    expect(await withTx((tx) => esPrimerRegistro(tx, fixture.tenantId, cloud))).toBe(true);
  });

  it("the unique index rejects re-persisting the same (nif, idSistema, numero)", async () => {
    const [nodeA, nodeB] = [fixture.nodeIds[0]!, fixture.nodeIds[1]!];
    const numero = await withTx((tx) =>
      reserveInstallationNumber(tx, { nif: fixture.nif, idSistemaInformatico: SISTEMA }),
    );
    await withTx((tx) =>
      writeReservedSif(tx, {
        tenantId: fixture.tenantId,
        nodeId: nodeA,
        nif: fixture.nif,
        idSistemaInformatico: SISTEMA,
        numeroInstalacion: numero,
      }),
    );
    await expect(
      withTx((tx) =>
        writeReservedSif(tx, {
          tenantId: fixture.tenantId,
          nodeId: nodeB,
          nif: fixture.nif,
          idSistemaInformatico: SISTEMA,
          numeroInstalacion: numero,
        }),
      ),
    ).rejects.toThrow(); // 23505 on registro_sif_instalacion_uq
  });
});
