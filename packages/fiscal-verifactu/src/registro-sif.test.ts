import {
  CORE_MIGRATIONS,
  captureError,
  createPgliteDb,
  pgErrorCode,
  runMigrations,
  withTenant,
} from "@waitron/db";
import { AppError } from "@waitron/shared";
import { sql } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { FISCAL_MIGRATIONS } from "./migrations.js";
import { currentSif, esPrimerRegistro, registerSif } from "./registro-sif.js";
import { TENANT_A, TENANT_B, seedSoldRegistro, seedTenants } from "../test/fixtures.js";

let db: Awaited<ReturnType<typeof createPgliteDb>>;

const SIF_PARAMS = {
  nif: "89890001K",
  idSistemaInformatico: "WT",
} as const;

beforeEach(async () => {
  // A fresh database per test. The counter under test is monotonic and never resets, so a shared
  // database would make every assertion about "strictly greater" depend on test execution order —
  // and the first reordering would produce a failure that looks like a real defect. That
  // requirement is why this suite cannot use `usePgliteDb`, which owns ONE database for the suite.
  db = await createPgliteDb();
  await runMigrations(db, CORE_MIGRATIONS);
  await runMigrations(db, FISCAL_MIGRATIONS);
  await seedTenants(db);
});

// Paired with that `beforeEach`, not an `afterAll`: one database per test needs one close per test.
// Until 2026-07-31 this suite had no teardown at all, so every WASM PostgreSQL it started stayed
// open for the rest of the run.
afterEach(async () => {
  if (db !== undefined) await db.close();
});

describe("registerSif", () => {
  it("mints an installation number on first registration", async () => {
    const reg = await withTenant(db, TENANT_A.id, (tx) =>
      registerSif(tx, { ...SIF_PARAMS, tenantId: TENANT_A.id, tillId: TENANT_A.tillId }),
    );
    expect(reg.numeroInstalacion).toBe(1);
    expect(reg.nif).toBe("89890001K");
    expect(reg.revocadoEn).toBeNull();
  });

  it("mints strictly increasing numbers across tills of one obligado", async () => {
    const first = await withTenant(db, TENANT_A.id, (tx) =>
      registerSif(tx, { ...SIF_PARAMS, tenantId: TENANT_A.id, tillId: TENANT_A.tillId }),
    );
    const second = await withTenant(db, TENANT_A.id, (tx) =>
      registerSif(tx, { ...SIF_PARAMS, tenantId: TENANT_A.id, tillId: TENANT_A.tillId2 }),
    );
    expect(second.numeroInstalacion).toBeGreaterThan(first.numeroInstalacion);
  });

  it("counts per (NIF, IdSIF), not globally", async () => {
    // A SIF is identified by NIF + IdSIF + NºInstalación, so the counter is scoped to the first
    // two. A global counter would still be correct but would leak one obligado's till count to
    // another, and would make the number needlessly large.
    await withTenant(db, TENANT_A.id, (tx) =>
      registerSif(tx, { ...SIF_PARAMS, tenantId: TENANT_A.id, tillId: TENANT_A.tillId }),
    );
    const other = await withTenant(db, TENANT_B.id, (tx) =>
      registerSif(tx, {
        nif: "12345678Z",
        idSistemaInformatico: "WT",
        tenantId: TENANT_B.id,
        tillId: TENANT_B.tillId,
      }),
    );
    expect(other.numeroInstalacion).toBe(1);
  });

  it("never reuses a number after a reimage", async () => {
    // The failure mode most likely in a self-hosted deployment, and the one a manual list gets
    // wrong. A wiped till has no registration, so it must re-register — correct by construction.
    // The wipe is simulated by doing nothing to the upstream database at all and simply calling
    // registerSif again: that is exactly what a reformatted machine does.
    const before = await withTenant(db, TENANT_A.id, (tx) =>
      registerSif(tx, { ...SIF_PARAMS, tenantId: TENANT_A.id, tillId: TENANT_A.tillId }),
    );
    const after = await withTenant(db, TENANT_A.id, (tx) =>
      registerSif(tx, { ...SIF_PARAMS, tenantId: TENANT_A.id, tillId: TENANT_A.tillId }),
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
    const before = await withTenant(db, TENANT_A.id, (tx) =>
      registerSif(tx, { ...SIF_PARAMS, tenantId: TENANT_A.id, tillId: TENANT_A.tillId }),
    );
    await withTenant(db, TENANT_A.id, (tx) =>
      registerSif(tx, { ...SIF_PARAMS, tenantId: TENANT_A.id, tillId: TENANT_A.tillId }),
    );
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
      const reg = await withTenant(db, TENANT_A.id, (tx) =>
        registerSif(tx, { ...SIF_PARAMS, tenantId: TENANT_A.id, tillId: TENANT_A.tillId }),
      );
      seen.push(reg.numeroInstalacion);
    }
    expect(seen).toEqual([...seen].sort((a, b) => a - b));
    expect(new Set(seen).size).toBe(seen.length);
  });
});

describe("re-registration begins a new chain", () => {
  it("does not continue the old chain", async () => {
    // A new NúmeroInstalación is a NEW SIF IDENTITY, therefore a new chain (findings §1). Chains
    // cannot be merged or migrated: the old one ends, a new one begins.
    const first = await withTenant(db, TENANT_A.id, (tx) =>
      registerSif(tx, { ...SIF_PARAMS, tenantId: TENANT_A.id, tillId: TENANT_A.tillId }),
    );

    // Simulate the till having sold: the chain head now points at a real registro and carries a
    // huella. See seedSoldRegistro's doc comment for why this must be a real
    // registros_facturacion row rather than a bare column update.
    await seedSoldRegistro(db, {
      tenantId: TENANT_A.id,
      tillId: TENANT_A.tillId,
      sifId: first.id,
      nif: SIF_PARAMS.nif,
      secuencia: 7,
      huella: "C".repeat(64),
    });

    expect(
      await withTenant(db, TENANT_A.id, (tx) => esPrimerRegistro(tx, TENANT_A.id, TENANT_A.tillId)),
    ).toBe(false);

    const second = await withTenant(db, TENANT_A.id, (tx) =>
      registerSif(tx, { ...SIF_PARAMS, tenantId: TENANT_A.id, tillId: TENANT_A.tillId }),
    );
    expect(second.numeroInstalacion).toBeGreaterThan(first.numeroInstalacion);

    const head = await db.execute<{
      secuencia: number;
      ultima_huella: string | null;
      ultimo_registro_id: string | null;
    }>(
      sql`select secuencia, ultima_huella, ultimo_registro_id from cadenas
          where tenant_id = ${TENANT_A.id} and till_id = ${TENANT_A.tillId}`,
    );
    // The chain POINTER is broken — the next record cannot chain to the old one.
    expect(head.rows[0]?.ultima_huella).toBeNull();
    expect(head.rows[0]?.ultimo_registro_id).toBeNull();
    // But the sequence is NOT reset. It is ours, an ordering aid for the outbox, and resetting it
    // would collide with UNIQUE (tenant_id, till_id, secuencia) on the very next append.
    expect(head.rows[0]?.secuencia).toBe(7);
  });

  it("reports PrimerRegistro from local state, not from a flag", async () => {
    // AEAT returns a non-rejecting warning if PrimerRegistro="S" is claimed when records already
    // exist for that SIF+NIF — a useful signal that a till was accidentally re-provisioned. It is
    // only useful if the value is DERIVED. A caller-set flag would make the warning report the
    // caller's belief back to itself.
    const reg = await withTenant(db, TENANT_A.id, (tx) =>
      registerSif(tx, { ...SIF_PARAMS, tenantId: TENANT_A.id, tillId: TENANT_A.tillId }),
    );
    expect(
      await withTenant(db, TENANT_A.id, (tx) => esPrimerRegistro(tx, TENANT_A.id, TENANT_A.tillId)),
    ).toBe(true);

    await seedSoldRegistro(db, {
      tenantId: TENANT_A.id,
      tillId: TENANT_A.tillId,
      sifId: reg.id,
      nif: SIF_PARAMS.nif,
      secuencia: 1,
      huella: "D".repeat(64),
    });
    expect(
      await withTenant(db, TENANT_A.id, (tx) => esPrimerRegistro(tx, TENANT_A.id, TENANT_A.tillId)),
    ).toBe(false);
  });
});

describe("currentSif", () => {
  it("returns the live registration", async () => {
    const reg = await withTenant(db, TENANT_A.id, (tx) =>
      registerSif(tx, { ...SIF_PARAMS, tenantId: TENANT_A.id, tillId: TENANT_A.tillId }),
    );
    const found = await withTenant(db, TENANT_A.id, (tx) =>
      currentSif(tx, TENANT_A.id, TENANT_A.tillId),
    );
    expect(found.id).toBe(reg.id);
  });

  it("throws a structured error for an unregistered till", async () => {
    // The concrete encoding of "a till cannot be provisioned offline": an unprovisioned till gets
    // a structured refusal that reaches a screen translatable, never a locally invented number.
    const err = await withTenant(db, TENANT_A.id, (tx) =>
      currentSif(tx, TENANT_A.id, TENANT_A.tillId).then(
        () => null,
        (e: unknown) => e,
      ),
    );
    expect(err).toBeInstanceOf(AppError);
    expect((err as AppError).code).toBe("sif.not_registered");
    expect((err as AppError).params).toMatchObject({ tillId: TENANT_A.tillId });
  });

  it("does not return a revoked registration", async () => {
    const first = await withTenant(db, TENANT_A.id, (tx) =>
      registerSif(tx, { ...SIF_PARAMS, tenantId: TENANT_A.id, tillId: TENANT_A.tillId }),
    );
    const second = await withTenant(db, TENANT_A.id, (tx) =>
      registerSif(tx, { ...SIF_PARAMS, tenantId: TENANT_A.id, tillId: TENANT_A.tillId }),
    );
    const found = await withTenant(db, TENANT_A.id, (tx) =>
      currentSif(tx, TENANT_A.id, TENANT_A.tillId),
    );
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
    // `captureError` + `pgErrorCode`, not `.rejects.toMatchObject({ code: "23505" })`: drizzle
    // wraps every failed query in a `DrizzleQueryError` whose own `.code` is undefined — the real
    // SQLSTATE lives on `.cause.code` — so a bare `.rejects.toMatchObject` assertion never sees
    // it and would fail even against a correctly-enforced constraint. Confirmed live in this
    // task's red phase.
    const reg = await withTenant(db, TENANT_A.id, (tx) =>
      registerSif(tx, { ...SIF_PARAMS, tenantId: TENANT_A.id, tillId: TENANT_A.tillId }),
    );
    const error = await captureError(() =>
      db.execute(sql`
        insert into registro_sif (tenant_id, till_id, nif, id_sistema_informatico, numero_instalacion, revocado_en)
        values (${TENANT_A.id}, ${TENANT_A.tillId2}, ${SIF_PARAMS.nif}, ${SIF_PARAMS.idSistemaInformatico},
                ${reg.numeroInstalacion}, now())`),
    );
    expect(pgErrorCode(error)).toBe("23505");
  });

  it("rejects a duplicate raised by a different tenant it cannot even see", async () => {
    // Unique constraints are NOT RLS-filtered. A second obligado sharing a NIF still collides,
    // which is the behaviour that makes never-reuse true across the whole installation rather
    // than within one tenant's visible slice.
    const reg = await withTenant(db, TENANT_A.id, (tx) =>
      registerSif(tx, { ...SIF_PARAMS, tenantId: TENANT_A.id, tillId: TENANT_A.tillId }),
    );
    const error = await captureError(() =>
      db.execute(sql`
        insert into registro_sif (tenant_id, till_id, nif, id_sistema_informatico, numero_instalacion)
        values (${TENANT_B.id}, ${TENANT_B.tillId}, ${SIF_PARAMS.nif}, ${SIF_PARAMS.idSistemaInformatico},
                ${reg.numeroInstalacion})`),
    );
    expect(pgErrorCode(error)).toBe("23505");
  });
});
