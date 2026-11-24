import { readChainHead } from "./chain.js";
import { seedFixtureSif } from "../test/sif-fixture.js";
import {
  UNIQUE_VIOLATION,
  captureError,
  checkFailed,
  refusalOn,
  withTransaction,
  type Database,
  type Transaction,
} from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { AppError } from "@waitron/shared";
import { sql } from "drizzle-orm";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { TEST_MIGRATIONS } from "../test/migrations.js";
import { writeReservedSif } from "../test/sif-fixture.js";
import { currentSif } from "./registro-sif.js";
import { verifactuIdentities } from "./schema/verifactu-identities.js";
import { TAXPAYER_A, TAXPAYER_B, seedSoldRegistro, seedTaxpayers } from "../test/fixtures.js";

const suite = useVenueDb({ migrations: TEST_MIGRATIONS, timeoutMs: 60_000 });

let db: Database;

const SIF_PARAMS = {
  nif: "89890001K",
  idSistemaInformatico: "WT",
} as const;

/**
 * The key `verifactu_identities_instalacion_uq` declares, in its own column order (./schema/sif.ts). The
 * two cases below match it with `refusalOn`: the class alone says only "some unique index or
 * primary key".
 */
const INSTALACION_KEY = {
  table: "verifactu_identities",
  columns: ["nif", "id_sistema_informatico", "numero_instalacion"],
} as const;

beforeAll(() => {
  db = suite.db;
});

beforeEach(async () => {
  await seedTaxpayers(db);
});

async function registerSif(
  tx: Transaction,
  params: {
    nodeId: Parameters<typeof seedFixtureSif>[1]["nodeId"];
    nif: string;
    idSistemaInformatico: string;
  },
) {
  const retained = tx.execute<{ n: number }>(
    sql`select count(*) as n from verifactu_identities where nif = ${params.nif} and id_sistema_informatico = ${params.idSistemaInformatico}`,
  ).rows[0]!.n;
  const supplied = ["S000001", "P000042", "P000043"][retained]!;
  return seedFixtureSif(tx, { ...params, numeroInstalacion: supplied });
}

describe("registerSif", () => {
  it("persists the supplied identity on first registration", async () => {
    const reg = await withTransaction(db, (tx) =>
      registerSif(tx, { ...SIF_PARAMS, nodeId: TAXPAYER_A.nodeId }),
    );
    expect(reg.numeroInstalacion).toBe("S000001");
    expect(reg.nif).toBe("89890001K");
    expect(reg.revocadoEn).toBeNull();
  });

  it("persists distinct supplied identities across tills of one obligado", async () => {
    const first = await withTransaction(db, (tx) =>
      registerSif(tx, { ...SIF_PARAMS, nodeId: TAXPAYER_A.nodeId }),
    );
    const second = await withTransaction(db, (tx) =>
      registerSif(tx, { ...SIF_PARAMS, nodeId: TAXPAYER_A.nodeId2 }),
    );
    expect(first.numeroInstalacion).toBe("S000001");
    expect(second.numeroInstalacion).toBe("P000042");
  });

  it("permits the same supplied identity under a different taxpayer", async () => {
    await withTransaction(db, (tx) =>
      registerSif(tx, { ...SIF_PARAMS, nodeId: TAXPAYER_A.nodeId }),
    );
    const other = await withTransaction(db, (tx) =>
      registerSif(tx, {
        nif: "12345678Z",
        idSistemaInformatico: "WT",
        nodeId: TAXPAYER_B.nodeId,
      }),
    );
    expect(other.numeroInstalacion).toBe("S000001");
  });

  it("never reuses a number after a reimage", async () => {
    // The failure mode most likely in a self-hosted deployment, and the one a manual list gets
    // wrong. A wiped node has no registration, so it needs a restored identity — correct by construction.
    // The wipe is simulated by doing nothing to the upstream database at all and simply calling
    // registerSif again: that is exactly what a reformatted machine does.
    const before = await withTransaction(db, (tx) =>
      registerSif(tx, { ...SIF_PARAMS, nodeId: TAXPAYER_A.nodeId }),
    );
    const after = await withTransaction(db, (tx) =>
      registerSif(tx, { ...SIF_PARAMS, nodeId: TAXPAYER_A.nodeId }),
    );
    expect(after.numeroInstalacion).toBe("P000042");
    expect(after.numeroInstalacion).not.toBe(before.numeroInstalacion);
    expect(after.id).not.toBe(before.id);
  });

  it("revokes the previous registration rather than updating it", async () => {
    // The old identity's registros are immutable and must keep pointing at the identity that
    // actually generated them. Overwriting the row would silently rewrite history.
    const before = await withTransaction(db, (tx) =>
      registerSif(tx, { ...SIF_PARAMS, nodeId: TAXPAYER_A.nodeId }),
    );
    await withTransaction(db, (tx) =>
      registerSif(tx, { ...SIF_PARAMS, nodeId: TAXPAYER_A.nodeId }),
    );
    const rows = await db.execute<{
      id: string;
      numero_instalacion: string;
      revocado_en: Date | null;
    }>(
      sql`select id, numero_instalacion, revocado_en from verifactu_identities order by revocado_en is null, numero_instalacion`,
    );
    expect(rows.rows).toHaveLength(2);
    expect(rows.rows[0]?.id).toBe(before.id);
    expect(rows.rows[0]?.revocado_en).not.toBeNull();
    expect(rows.rows[1]?.revocado_en).toBeNull();
  });

  it("persists all three supplied identities without reuse", async () => {
    const seen: string[] = [];
    for (let i = 0; i < 3; i += 1) {
      const reg = await withTransaction(db, (tx) =>
        registerSif(tx, { ...SIF_PARAMS, nodeId: TAXPAYER_A.nodeId }),
      );
      seen.push(reg.numeroInstalacion);
    }
    expect(seen).toEqual(["S000001", "P000042", "P000043"]);
    expect(new Set(seen).size).toBe(seen.length);
  });

  it.each([
    ["longer than two characters", "WTRN01"],
    ["empty", ""],
  ])("refuses an IdSistemaInformatico that is %s, before writing anything", async (_label, bad) => {
    const err = await withTransaction(db, (tx) =>
      registerSif(tx, {
        ...SIF_PARAMS,
        idSistemaInformatico: bad,
        nodeId: TAXPAYER_A.nodeId,
      }),
    ).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(AppError);
    expect((err as AppError).code).toBe("sif.id_sistema_invalid");
    expect((err as AppError).params).toEqual({ value: bad, maxLength: 2 });
    const written = await db.execute(
      sql`select 1 from verifactu_identities where node_id = ${TAXPAYER_A.nodeId}`,
    );
    expect(written.rows).toEqual([]);
  });
});

describe("writeReservedSif", () => {
  it("refuses an IdSistemaInformatico longer than two characters, before writing anything", async () => {
    // The bound is applied by the PRIMITIVE, not only by its callers: `verifactu_identities` carries no
    // CHECK on the column, so a caller reaching writeReservedSif directly with an unusable id must
    // still be refused.
    const err = await withTransaction(db, (tx) =>
      writeReservedSif(tx, {
        ...SIF_PARAMS,
        idSistemaInformatico: "WTX",
        nodeId: TAXPAYER_A.nodeId,
        numeroInstalacion: "7",
      }),
    ).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(AppError);
    expect((err as AppError).code).toBe("sif.id_sistema_invalid");
    expect((err as AppError).params).toEqual({ value: "WTX", maxLength: 2 });
    const written = await db.execute(
      sql`select 1 from verifactu_identities where node_id = ${TAXPAYER_A.nodeId}`,
    );
    expect(written.rows).toEqual([]);
  });
});

describe("a new SIF identity begins a new chain", () => {
  it("does not continue the old chain", async () => {
    // A new NúmeroInstalación is a NEW SIF IDENTITY, therefore a new chain. Chains
    // cannot be merged or migrated: the old one ends, a new one begins.
    const first = await withTransaction(db, (tx) =>
      registerSif(tx, { ...SIF_PARAMS, nodeId: TAXPAYER_A.nodeId }),
    );

    await seedSoldRegistro(db, {
      nodeId: TAXPAYER_A.nodeId,
      sifId: first.id,
      nif: SIF_PARAMS.nif,
      secuencia: 7,
      huella: "C".repeat(64),
    });

    const predecessor = await withTransaction(db, (tx) => readChainHead(tx, TAXPAYER_A.nodeId));
    expect(predecessor.ultimoRegistroId).not.toBeNull();

    const second = await withTransaction(db, (tx) =>
      registerSif(tx, { ...SIF_PARAMS, nodeId: TAXPAYER_A.nodeId }),
    );
    expect(first.numeroInstalacion).toBe("S000001");
    expect(second.numeroInstalacion).toBe("P000042");

    const head = await withTransaction(db, (tx) => readChainHead(tx, TAXPAYER_A.nodeId));
    expect(head.ultimaHuella).toBeNull();
    expect(head.ultimoRegistroId).toBeNull();
    expect(head.secuencia).toBe(7);
  });

  it("finds a predecessor after the first sale", async () => {
    const reg = await withTransaction(db, (tx) =>
      registerSif(tx, { ...SIF_PARAMS, nodeId: TAXPAYER_A.nodeId }),
    );
    const empty = await withTransaction(db, (tx) => readChainHead(tx, TAXPAYER_A.nodeId));
    expect(empty.ultimoRegistroId).toBeNull();

    await seedSoldRegistro(db, {
      nodeId: TAXPAYER_A.nodeId,
      sifId: reg.id,
      nif: SIF_PARAMS.nif,
      secuencia: 1,
      huella: "D".repeat(64),
    });
    const predecessor = await withTransaction(db, (tx) => readChainHead(tx, TAXPAYER_A.nodeId));
    expect(predecessor.ultimoRegistroId).not.toBeNull();
  });
});

describe("currentSif", () => {
  it("returns the live registration", async () => {
    const reg = await withTransaction(db, (tx) =>
      registerSif(tx, { ...SIF_PARAMS, nodeId: TAXPAYER_A.nodeId }),
    );
    const found = await withTransaction(db, (tx) => currentSif(tx, TAXPAYER_A.nodeId));
    expect(found.id).toBe(reg.id);
  });

  it("throws a structured error for an unregistered till", async () => {
    // The concrete encoding of "a till cannot be provisioned offline": an unprovisioned till gets
    // a structured refusal that reaches a screen translatable, never a locally invented number.
    const err = await withTransaction(db, (tx) =>
      currentSif(tx, TAXPAYER_A.nodeId).then(
        () => null,
        (e: unknown) => e,
      ),
    );
    expect(err).toBeInstanceOf(AppError);
    expect((err as AppError).code).toBe("sif.not_registered");
    expect((err as AppError).params).toMatchObject({ nodeId: TAXPAYER_A.nodeId });
  });

  it("does not return a revoked registration", async () => {
    const first = await withTransaction(db, (tx) =>
      registerSif(tx, { ...SIF_PARAMS, nodeId: TAXPAYER_A.nodeId }),
    );
    const second = await withTransaction(db, (tx) =>
      registerSif(tx, { ...SIF_PARAMS, nodeId: TAXPAYER_A.nodeId }),
    );
    const found = await withTransaction(db, (tx) => currentSif(tx, TAXPAYER_A.nodeId));
    expect(found.id).toBe(second.id);
    expect(found.id).not.toBe(first.id);
  });
});

describe("identity allocation columns", () => {
  const allocation = {
    environment: "preproduction",
    event_key: "event",
    allocation_key: "allocation",
    allocation: "{}",
    approval: "{}",
    bases: "[]",
    result: "{}",
  };

  function insertIdentity(
    nodeId: string,
    installation: string,
    fields: Partial<Record<keyof typeof allocation, string | null>>,
  ) {
    return db.execute(sql`insert into verifactu_identities
      (id, node_id, nif, id_sistema_informatico, numero_instalacion, registrado_en,
       environment, event_key, allocation_key, allocation, approval, bases, result)
      values (${installation}, ${nodeId}, ${SIF_PARAMS.nif}, ${SIF_PARAMS.idSistemaInformatico},
        ${installation}, '2026-09-22T10:00:00.000Z',
        ${fields.environment ?? null}, ${fields.event_key ?? null}, ${fields.allocation_key ?? null},
        ${fields.allocation ?? null}, ${fields.approval ?? null}, ${fields.bases ?? null}, ${fields.result ?? null})`);
  }

  it.each(Object.keys(allocation) as (keyof typeof allocation)[])(
    "rejects an otherwise complete allocation missing %s",
    async (missing) => {
      const error = await captureError(() =>
        insertIdentity(TAXPAYER_A.nodeId, "incomplete", { ...allocation, [missing]: null }),
      );
      expect(checkFailed(error, "verifactu_identities_allocation_ck")).toBe(true);
    },
  );

  it("rejects an event key by itself", async () => {
    const error = await captureError(() =>
      insertIdentity(TAXPAYER_A.nodeId, "event-only", { event_key: allocation.event_key }),
    );
    expect(checkFailed(error, "verifactu_identities_allocation_ck")).toBe(true);
  });

  it.each(["event_key", "allocation_key"] as const)("refuses reusing %s", async (column) => {
    await insertIdentity(TAXPAYER_A.nodeId, "first", allocation);
    const error = await captureError(() =>
      insertIdentity(TAXPAYER_A.nodeId2, "second", {
        ...allocation,
        event_key: "other-event",
        allocation_key: "other-allocation",
        [column]: allocation[column],
      }),
    );
    expect(
      refusalOn(error, UNIQUE_VIOLATION, { table: "verifactu_identities", columns: [column] }),
    ).toBe(true);
  });

  it("keeps separate installation names when neither identity has an allocation", async () => {
    await insertIdentity(TAXPAYER_A.nodeId, "first-empty", {});
    await insertIdentity(TAXPAYER_A.nodeId2, "second-empty", {});
    const found =
      await db.execute(sql`select numero_instalacion, event_key from verifactu_identities
      order by numero_instalacion`);
    expect(found.rows).toEqual([
      { numero_instalacion: "first-empty", event_key: null },
      { numero_instalacion: "second-empty", event_key: null },
    ]);
  });
});

describe("the database, not the application, is what forbids a duplicate", () => {
  it("rejects a duplicate installation number inserted directly", async () => {
    // Bypasses registerSif entirely. If this passes only because the allocator is careful, the
    // guarantee is application discipline wearing a constraint's clothes — and every future
    // caller, migration script and manual fix-up is outside it.
    //
    // `captureError` + `refusalOn`, not `.rejects.toMatchObject({ ... })`: `refusalOn` checks the
    // refusal class (`errcode`) and the table and columns the engine's message named together, on
    // one layer of the error, and compares the columns as a key rather than as message text
    // (packages/db/src/constraint-target.ts).
    //
    // Written through the table definition rather than as raw SQL: it still bypasses the
    // allocator, and it reaches the client-side column defaults a raw statement does not.
    const reg = await withTransaction(db, (tx) =>
      registerSif(tx, { ...SIF_PARAMS, nodeId: TAXPAYER_A.nodeId }),
    );
    const error = await captureError(() =>
      db.insert(verifactuIdentities).values({
        nodeId: TAXPAYER_A.nodeId2,
        nif: SIF_PARAMS.nif,
        idSistemaInformatico: SIF_PARAMS.idSistemaInformatico,
        numeroInstalacion: reg.numeroInstalacion,
        revocadoEn: new Date(),
      }),
    );
    expect(refusalOn(error, UNIQUE_VIOLATION, INSTALACION_KEY)).toBe(true);
  });

  it("rejects a duplicate installation identity raised under a different NIF's node", async () => {
    // The unique installation identity is (NIF, IdSIF, number) and nothing else. Through the table
    // definition, as above.
    const reg = await withTransaction(db, (tx) =>
      registerSif(tx, { ...SIF_PARAMS, nodeId: TAXPAYER_A.nodeId }),
    );
    const error = await captureError(() =>
      db.insert(verifactuIdentities).values({
        nodeId: TAXPAYER_B.nodeId,
        nif: SIF_PARAMS.nif,
        idSistemaInformatico: SIF_PARAMS.idSistemaInformatico,
        numeroInstalacion: reg.numeroInstalacion,
      }),
    );
    expect(refusalOn(error, UNIQUE_VIOLATION, INSTALACION_KEY)).toBe(true);
  });
});
