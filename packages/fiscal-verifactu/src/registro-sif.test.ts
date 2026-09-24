import {
  UNIQUE_VIOLATION,
  captureError,
  refusalOn,
  withTransaction,
  type Database,
} from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { AppError } from "@waitron/shared";
import { sql } from "drizzle-orm";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { TEST_MIGRATIONS } from "../test/migrations.js";
import { currentSif, esPrimerRegistro, registerSif, writeReservedSif } from "./registro-sif.js";
import { registroSif } from "./schema/sif.js";
import { TENANT_A, TENANT_B, seedSoldRegistro, seedTenants } from "../test/fixtures.js";

// ONE database for the suite, emptied by the helper after every test. The counter under test is
// monotonic and never resets, so a case that shares another case's counter makes every assertion
// about "strictly greater" depend on execution order; the per-test reset empties
// `contadores_instalacion` with every other data table.
const suite = useVenueDb({ migrations: TEST_MIGRATIONS, timeoutMs: 60_000 });

let db: Database;

const SIF_PARAMS = {
  nif: "89890001K",
  idSistemaInformatico: "WT",
} as const;

/**
 * The key `registro_sif_instalacion_uq` declares, in its own column order (./schema/sif.ts). The
 * two cases below match it with `refusalOn`: the class alone says only "some unique index or
 * primary key".
 */
const INSTALACION_KEY = {
  table: "registro_sif",
  columns: ["nif", "id_sistema_informatico", "numero_instalacion"],
} as const;

beforeAll(() => {
  db = suite.db;
});

beforeEach(async () => {
  await seedTenants(db);
});

describe("registerSif", () => {
  it("mints an installation number on first registration", async () => {
    const reg = await withTransaction(db, (tx) =>
      registerSif(tx, { ...SIF_PARAMS, nodeId: TENANT_A.nodeId }),
    );
    expect(reg.numeroInstalacion).toBe(1);
    expect(reg.nif).toBe("89890001K");
    expect(reg.revocadoEn).toBeNull();
  });

  it("mints strictly increasing numbers across tills of one obligado", async () => {
    const first = await withTransaction(db, (tx) =>
      registerSif(tx, { ...SIF_PARAMS, nodeId: TENANT_A.nodeId }),
    );
    const second = await withTransaction(db, (tx) =>
      registerSif(tx, { ...SIF_PARAMS, nodeId: TENANT_A.nodeId2 }),
    );
    expect(second.numeroInstalacion).toBeGreaterThan(first.numeroInstalacion);
  });

  it("counts per (NIF, IdSIF), not globally", async () => {
    // A SIF is identified by NIF + IdSIF + NºInstalación, so the counter is scoped to the first
    // two. A global counter would still be correct but would leak one obligado's till count to
    // another, and would make the number needlessly large.
    await withTransaction(db, (tx) => registerSif(tx, { ...SIF_PARAMS, nodeId: TENANT_A.nodeId }));
    const other = await withTransaction(db, (tx) =>
      registerSif(tx, {
        nif: "12345678Z",
        idSistemaInformatico: "WT",
        nodeId: TENANT_B.nodeId,
      }),
    );
    expect(other.numeroInstalacion).toBe(1);
  });

  it("never reuses a number after a reimage", async () => {
    // The failure mode most likely in a self-hosted deployment, and the one a manual list gets
    // wrong. A wiped till has no registration, so it must re-register — correct by construction.
    // The wipe is simulated by doing nothing to the upstream database at all and simply calling
    // registerSif again: that is exactly what a reformatted machine does.
    const before = await withTransaction(db, (tx) =>
      registerSif(tx, { ...SIF_PARAMS, nodeId: TENANT_A.nodeId }),
    );
    const after = await withTransaction(db, (tx) =>
      registerSif(tx, { ...SIF_PARAMS, nodeId: TENANT_A.nodeId }),
    );
    // Strictly greater, and explicitly NOT equal — `toBeGreaterThan` alone would pass if the
    // implementation returned NaN, and equality is the specific thing forbidden.
    expect(after.numeroInstalacion).toBeGreaterThan(before.numeroInstalacion);
    expect(after.numeroInstalacion).not.toBe(before.numeroInstalacion);
    expect(after.id).not.toBe(before.id);
  });

  it("revokes the previous registration rather than updating it", async () => {
    // The old identity's registros are immutable and must keep pointing at the identity that
    // actually generated them. Overwriting the row would silently rewrite history.
    const before = await withTransaction(db, (tx) =>
      registerSif(tx, { ...SIF_PARAMS, nodeId: TENANT_A.nodeId }),
    );
    await withTransaction(db, (tx) => registerSif(tx, { ...SIF_PARAMS, nodeId: TENANT_A.nodeId }));
    const rows = await db.execute<{
      id: string;
      numero_instalacion: number;
      revocado_en: Date | null;
    }>(
      sql`select id, numero_instalacion, revocado_en from registro_sif order by numero_instalacion`,
    );
    expect(rows.rows).toHaveLength(2);
    expect(rows.rows[0]?.id).toBe(before.id);
    expect(rows.rows[0]?.revocado_en).not.toBeNull();
    expect(rows.rows[1]?.revocado_en).toBeNull();
  });

  it("mints again after a third registration, never returning to a burned number", async () => {
    const seen: number[] = [];
    for (let i = 0; i < 3; i += 1) {
      const reg = await withTransaction(db, (tx) =>
        registerSif(tx, { ...SIF_PARAMS, nodeId: TENANT_A.nodeId }),
      );
      seen.push(reg.numeroInstalacion);
    }
    expect(seen).toEqual([...seen].sort((a, b) => a - b));
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
        nodeId: TENANT_A.nodeId,
      }),
    ).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(AppError);
    expect((err as AppError).code).toBe("sif.id_sistema_invalid");
    expect((err as AppError).params).toEqual({ value: bad, maxLength: 2 });
    const written = await db.execute(
      sql`select 1 from registro_sif where node_id = ${TENANT_A.nodeId}`,
    );
    expect(written.rows).toEqual([]);
  });
});

describe("writeReservedSif", () => {
  it("refuses an IdSistemaInformatico longer than two characters, before writing anything", async () => {
    // The bound is applied by the PRIMITIVE, not only by its callers: `registro_sif` carries no
    // CHECK on the column, so a caller reaching writeReservedSif directly with an unusable id must
    // still be refused.
    const err = await withTransaction(db, (tx) =>
      writeReservedSif(tx, {
        ...SIF_PARAMS,
        idSistemaInformatico: "WTX",
        nodeId: TENANT_A.nodeId,
        numeroInstalacion: 7,
      }),
    ).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(AppError);
    expect((err as AppError).code).toBe("sif.id_sistema_invalid");
    expect((err as AppError).params).toEqual({ value: "WTX", maxLength: 2 });
    const written = await db.execute(
      sql`select 1 from registro_sif where node_id = ${TENANT_A.nodeId}`,
    );
    expect(written.rows).toEqual([]);
  });
});

describe("re-registration begins a new chain", () => {
  it("does not continue the old chain", async () => {
    // A new NúmeroInstalación is a NEW SIF IDENTITY, therefore a new chain. Chains
    // cannot be merged or migrated: the old one ends, a new one begins.
    const first = await withTransaction(db, (tx) =>
      registerSif(tx, { ...SIF_PARAMS, nodeId: TENANT_A.nodeId }),
    );

    // Simulate the till having sold: the chain head now points at a real registro and carries a
    // huella. See seedSoldRegistro's doc comment for why this must be a real
    // registros_facturacion row rather than a bare column update.
    await seedSoldRegistro(db, {
      tillId: TENANT_A.tillId,
      nodeId: TENANT_A.nodeId,
      sifId: first.id,
      nif: SIF_PARAMS.nif,
      secuencia: 7,
      huella: "C".repeat(64),
    });

    expect(await withTransaction(db, (tx) => esPrimerRegistro(tx, TENANT_A.nodeId))).toBe(false);

    const second = await withTransaction(db, (tx) =>
      registerSif(tx, { ...SIF_PARAMS, nodeId: TENANT_A.nodeId }),
    );
    expect(second.numeroInstalacion).toBeGreaterThan(first.numeroInstalacion);

    const head = await db.execute<{
      secuencia: number;
      ultima_huella: string | null;
      ultimo_registro_id: string | null;
    }>(
      sql`select secuencia, ultima_huella, ultimo_registro_id from cadenas
          where node_id = ${TENANT_A.nodeId}`,
    );
    // The chain POINTER is broken — the next record cannot chain to the old one.
    expect(head.rows[0]?.ultima_huella).toBeNull();
    expect(head.rows[0]?.ultimo_registro_id).toBeNull();
    // But the sequence is NOT reset. It is ours, an ordering aid for the outbox, and resetting it
    // would collide with UNIQUE (node_id, secuencia) on the very next append.
    expect(head.rows[0]?.secuencia).toBe(7);
  });

  it("reports PrimerRegistro from local state, not from a flag", async () => {
    // AEAT returns a non-rejecting warning if PrimerRegistro="S" is claimed when records already
    // exist for that SIF+NIF — a useful signal that a till was accidentally re-provisioned. It is
    // only useful if the value is DERIVED. A caller-set flag would make the warning report the
    // caller's belief back to itself.
    const reg = await withTransaction(db, (tx) =>
      registerSif(tx, { ...SIF_PARAMS, nodeId: TENANT_A.nodeId }),
    );
    expect(await withTransaction(db, (tx) => esPrimerRegistro(tx, TENANT_A.nodeId))).toBe(true);

    await seedSoldRegistro(db, {
      tillId: TENANT_A.tillId,
      nodeId: TENANT_A.nodeId,
      sifId: reg.id,
      nif: SIF_PARAMS.nif,
      secuencia: 1,
      huella: "D".repeat(64),
    });
    expect(await withTransaction(db, (tx) => esPrimerRegistro(tx, TENANT_A.nodeId))).toBe(false);
  });
});

describe("currentSif", () => {
  it("returns the live registration", async () => {
    const reg = await withTransaction(db, (tx) =>
      registerSif(tx, { ...SIF_PARAMS, nodeId: TENANT_A.nodeId }),
    );
    const found = await withTransaction(db, (tx) => currentSif(tx, TENANT_A.nodeId));
    expect(found.id).toBe(reg.id);
  });

  it("throws a structured error for an unregistered till", async () => {
    // The concrete encoding of "a till cannot be provisioned offline": an unprovisioned till gets
    // a structured refusal that reaches a screen translatable, never a locally invented number.
    const err = await withTransaction(db, (tx) =>
      currentSif(tx, TENANT_A.nodeId).then(
        () => null,
        (e: unknown) => e,
      ),
    );
    expect(err).toBeInstanceOf(AppError);
    expect((err as AppError).code).toBe("sif.not_registered");
    expect((err as AppError).params).toMatchObject({ nodeId: TENANT_A.nodeId });
  });

  it("does not return a revoked registration", async () => {
    const first = await withTransaction(db, (tx) =>
      registerSif(tx, { ...SIF_PARAMS, nodeId: TENANT_A.nodeId }),
    );
    const second = await withTransaction(db, (tx) =>
      registerSif(tx, { ...SIF_PARAMS, nodeId: TENANT_A.nodeId }),
    );
    const found = await withTransaction(db, (tx) => currentSif(tx, TENANT_A.nodeId));
    expect(found.id).toBe(second.id);
    expect(found.id).not.toBe(first.id);
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
      registerSif(tx, { ...SIF_PARAMS, nodeId: TENANT_A.nodeId }),
    );
    const error = await captureError(() =>
      db.insert(registroSif).values({
        nodeId: TENANT_A.nodeId2,
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
      registerSif(tx, { ...SIF_PARAMS, nodeId: TENANT_A.nodeId }),
    );
    const error = await captureError(() =>
      db.insert(registroSif).values({
        nodeId: TENANT_B.nodeId,
        nif: SIF_PARAMS.nif,
        idSistemaInformatico: SIF_PARAMS.idSistemaInformatico,
        numeroInstalacion: reg.numeroInstalacion,
      }),
    );
    expect(refusalOn(error, UNIQUE_VIOLATION, INSTALACION_KEY)).toBe(true);
  });
});
