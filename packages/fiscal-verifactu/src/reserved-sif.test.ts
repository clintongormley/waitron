import { beforeEach, describe, expect, it } from "vitest";
import type { Transaction } from "@waitron/db";
import { useTemplateDb } from "@waitron/db/testing/lifecycle.js";
import {
  currentSif,
  esPrimerRegistro,
  reserveInstallationNumber,
  writeReservedSif,
} from "./registro-sif.js";
import { seedNodesForSifContention, type SifContentionFixture } from "./testing/seed.js";

/**
 * Real PostgreSQL via a clone of the shared container's `manifest` template, like every other
 * real-Postgres suite in this package (see chain.concurrency.test.ts's own note on why Docker
 * absence throws rather than skips). `reserveInstallationNumber`'s whole point is the atomic
 * `contadores_instalacion` bump, which PGlite serialises onto one backend and so cannot exercise
 * (registro-sif.ts:50-57).
 */
const suite = useTemplateDb({ template: "manifest" });

const SISTEMA = "W1";

let fixture: SifContentionFixture;

// A fresh tenant (therefore a fresh NIF, via seedNodesForSifContention → freshNif) plus two bare,
// UNregistered nodes on every test — so each test's (NIF, IdSistema) counter starts empty and the
// pre-increment values are deterministically 1, then 2. No truncate: registros_facturacion's
// append-only trigger blocks it (chain.concurrency.test.ts's own note), and a fresh NIF per test
// makes each run's rows independent of the last.
beforeEach(async () => {
  fixture = await seedNodesForSifContention(suite.admin, 2);
});

function withTx<T>(fn: (tx: Transaction) => Promise<T>): Promise<T> {
  return suite.admin.transaction(fn);
}

describe("reserved-sif primitives (real Postgres)", () => {
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
