import { execFile } from "node:child_process";
import { cp, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createPostgresDb, readStandardSeriesId, type Database } from "@waitron/db";
import {
  cloneTemplate,
  nextCloneName,
  pickTemplate,
  resolveSharedHandle,
} from "@waitron/db/testing/lifecycle.js";
import { databaseUrl, type RealPostgres } from "@waitron/db/testing/postgres.js";
import { FISCAL_RESTORE, installationFloor } from "@waitron/fiscal-verifactu";
import { expectedSchemaVersion, manifestSets, migrationOptionsFor } from "@waitron/migrations";
import type { WaitronModule } from "@waitron/module";
import { ALL_MODULES } from "./modules.js";
import { buildManifest, schemaVersionsByModule } from "./backup-manifest.js";
import { packArchive, type ArchiveEntry } from "./backup-archive.js";
import { encryptArtifact } from "./artifact-cipher.js";
import {
  restoreFromArtifact,
  validateArtifact,
  writeValidated,
  type RestoreDeps,
} from "./restore.js";
import { formatEnvFile, parseEnvFile } from "./env-file.js";
import type { Logger } from "./logger.js";
import type { PgRestoreRunner } from "./pg-restore.js";
import { locateSharedContainer } from "./testing/locate-shared-container.js";

// Real PostgreSQL exercises restored triggers and origin capture as the container superuser.
// The suite owns baseline clones and empty targets so pg_restore sees a fresh database.
const execFileAsync = promisify(execFile);
const RECOVERY_KEY = "s3cr3t-recovery-key-for-fiscal-restore-e2e";
const MEDIA_NAME = "deadbeefdeadbeefdeadbeefdeadbeef.jpg";
const BASELINE_MEDIA = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46]);
const HUELLA = "A".repeat(64);
const noopLog: Logger = () => {};

const F = {
  tenantId: "c0000000-0000-4000-8000-000000000001",
  locationId: "c0000000-0000-4000-8000-000000000002",
  tillId: "c0000000-0000-4000-8000-000000000003",
  seriesId: "c0000000-0000-4000-8000-000000000004",
  saleId: "c0000000-0000-4000-8000-000000000005",
  sifId: "c0000000-0000-4000-8000-000000000006",
  nodeId: "c0000000-0000-4000-8000-000000000008",
};

async function seedFiscalRegistro(admin: Database): Promise<void> {
  await admin.execute(
    sql`insert into tenants (id, country, tax_id, legal_name) values (${F.tenantId}, 'ES', '89890001K', 'Waitron SL')`,
  );
  await admin.execute(
    sql`insert into locations (id, tenant_id, name, invoice_locales, operation_description) values (${F.locationId}, ${F.tenantId}, 'Local principal', array['es'], 'Venta en establecimiento')`,
  );
  await admin.execute(
    sql`insert into tills (id, tenant_id, location_id, name) values (${F.tillId}, ${F.tenantId}, ${F.locationId}, 'Caja 1')`,
  );
  await admin.execute(
    sql`insert into nodes (id, tenant_id, location_id, name) values (${F.nodeId}, ${F.tenantId}, ${F.locationId}, 'Node 1')`,
  );
  await admin.execute(
    sql`insert into invoice_series (id, tenant_id, node_id, code, purpose, next_number) values (${F.seriesId}, ${F.tenantId}, ${F.nodeId}, 'FA', 'standard', 5)`,
  );
  await admin.execute(
    sql`insert into invoice_series (tenant_id, node_id, code, purpose) values (${F.tenantId}, ${F.nodeId}, 'RE', 'rectificative')`,
  );
  await admin.execute(
    sql`insert into contadores_instalacion (nif, id_sistema_informatico, proximo_numero) values ('89890001K', 'W1', 2)`,
  );
  await admin.execute(
    sql`insert into registro_sif (id, tenant_id, node_id, nif, id_sistema_informatico, numero_instalacion) values (${F.sifId}, ${F.tenantId}, ${F.nodeId}, '89890001K', 'W1', 1)`,
  );
  await admin.execute(
    sql`insert into sales (id, tenant_id, till_id, node_id, series_id, invoice_number, issued_at, issued_offset_minutes, total, vat_breakdown, locale, invoice_locales, fiscal_backend, fiscal_state) values (${F.saleId}, ${F.tenantId}, ${F.tillId}, ${F.nodeId}, ${F.seriesId}, 4, '2026-07-20T19:20:30+01:00', 60, '0.00', '[]'::jsonb, 'es', array['es'], 'verifactu', 'recorded')`,
  );
  const registro = await admin.execute<{ id: string }>(sql`
    insert into registros_facturacion (tenant_id, till_id, node_id, sif_id, sale_id, secuencia, tipo_registro,
      id_emisor_factura, num_serie_factura, fecha_expedicion_factura, nombre_razon_emisor,
      tipo_factura, descripcion_operacion, desglose, cuota_total, importe_total,
      primer_registro, sistema_informatico, fecha_hora_huso_gen_registro, offset_minutos, tipo_huella, huella)
    values (${F.tenantId}, ${F.tillId}, ${F.nodeId}, ${F.sifId}, ${F.saleId}, 1, 'alta',
      '89890001K', 'FA/4', '2026-07-20', 'Waitron SL',
      'F2', 'Venta en establecimiento', '[]'::jsonb, '12.35', '123.45',
      true, '{}'::jsonb, '2026-07-20T19:20:30+01:00', 60, '01', ${HUELLA})
    returning id`);
  // The chain head: no row exists until an append or a registration creates one — insert it
  // explicitly, pointing at the record, at sequence 1 (both pointers set: `cadenas_puntero_ck`).
  await admin.execute(
    sql`insert into cadenas (tenant_id, node_id, secuencia, ultimo_registro_id, ultima_huella) values (${F.tenantId}, ${F.nodeId}, 1, ${registro.rows[0]!.id}, ${HUELLA})`,
  );
}

function containerPgRestore(containerId: string): PgRestoreRunner {
  let n = 0;
  return async ({ databaseUrl: url, inFile, signal }) => {
    const dbn = new URL(url).pathname.replace(/^\//, "");
    const internal = internalUrl(url, dbn);
    const inContainer = `/tmp/waitron-restore-fiscal-e2e-${process.pid}-${(n += 1)}.dump`;
    await execFileAsync("docker", ["cp", inFile, `${containerId}:${inContainer}`]);
    try {
      await execFileAsync(
        "docker",
        ["exec", containerId, "pg_restore", "--no-owner", "--dbname", internal, inContainer],
        { signal },
      );
    } finally {
      await execFileAsync("docker", ["exec", containerId, "rm", "-f", inContainer]).catch(() => {});
    }
  };
}

/** The internal (container-side) libpq URL for `db` on the shared container, from a host admin URL. */
function internalUrl(adminUrl: string, db: string): string {
  const u = new URL(adminUrl);
  return `postgresql://${u.username}:${u.password}@localhost:5432/${db}`;
}

let adminUri: string;
let containerId: string | undefined;
let migrationsRoot: string;
/** {@link migrationsRoot} plus one extra core migration — see the OLDER-artifact note in `beforeAll`. */
let olderMigrationsRoot: string;
let scratchRoot: string;
let artifactPath: string;
let olderArtifactPath: string;
let baselinePg: RealPostgres | undefined;
let olderBaselinePg: RealPostgres | undefined;
const targets: string[] = [];
let targetCounter = 0;

async function makeFreshTarget(): Promise<string> {
  const name = `restore_fiscal_${process.pid}_${targetCounter++}`;
  // PostgreSQL utility statements cannot bind identifiers.
  if (!/^restore_fiscal_[0-9]+_[0-9]+$/.test(name)) throw new Error("Invalid target name");
  await execFileAsync("docker", [
    "exec",
    containerId!,
    "psql",
    internalUrl(adminUri, "postgres"),
    "-v",
    "ON_ERROR_STOP=1",
    "-c",
    `create database ${name}`,
  ]);
  targets.push(name);
  return databaseUrl(adminUri, name);
}

async function arrangeDirs(): Promise<{ mediaDir: string; stateDir: string }> {
  const mediaDir = await mkdtemp(join(scratchRoot, "media-"));
  const stateDir = await mkdtemp(join(scratchRoot, "state-"));
  return { mediaDir, stateDir };
}

async function restoreDepsFor(
  targetUrl: string,
  dirs: { mediaDir: string; stateDir: string },
  artifact = artifactPath,
): Promise<RestoreDeps> {
  return {
    artifact: await readFile(artifact),
    recoveryKey: RECOVERY_KEY,
    databaseUrl: targetUrl,
    ...dirs,
    stagingDir: join(dirs.stateDir, "restore-staging"),
    // The OLDER artifact is one migration behind ITS root, not behind the shipped one.
    migrationsRoot: artifact === olderArtifactPath ? olderMigrationsRoot : migrationsRoot,
    modules: ALL_MODULES,
    environment: "preproduction",
    runRestore: containerPgRestore(containerId!),
    log: noopLog,
  };
}

async function drive(
  targetUrl: string,
  dirs: { mediaDir: string; stateDir: string },
  artifact = artifactPath,
) {
  return restoreFromArtifact(await restoreDepsFor(targetUrl, dirs, artifact));
}

beforeAll(async () => {
  const handle = resolveSharedHandle(undefined);
  adminUri = handle.uri;
  containerId = await locateSharedContainer(new URL(adminUri), {
    tag: "fiscal restore e2e",
    unproven: "the fiscal restore end-to-end flow is UNPROVEN in this run.",
  });
  if (containerId === undefined) return; // LOUD skip already logged; each `it` returns early too

  const fromSource = migrationOptionsFor(manifestSets(), null);
  scratchRoot = await mkdtemp(join(tmpdir(), "waitron-restore-fiscal-e2e-"));
  migrationsRoot = join(scratchRoot, "migrations");
  for (const [index, set] of manifestSets().entries()) {
    await cp(fromSource[index]!.migrationsFolder, join(migrationsRoot, set.name), {
      recursive: true,
    });
  }

  // The OLDER artifact needs a database one core migration behind the code it is restored with.
  // Rewinding the journal table cannot express that any more: core ships a two-file baseline, so
  // "one behind" would re-run `0001_db_baseline_sql` against a database that already holds its
  // functions — `42723, function ... already exists`. Instead the older restore gets its OWN root:
  // the shipped sets plus one extra core step that re-adds the column its dump lacks. The dump is
  // then genuinely one migration behind that root, and only the extra step replays.
  olderMigrationsRoot = join(scratchRoot, "migrations-older");
  await cp(migrationsRoot, olderMigrationsRoot, { recursive: true });
  const coreSet = ALL_MODULES.find((m) => m.name === "core")!.migrations;
  const extraTag = "9999_readd_retired_at";
  const olderCoreDir = join(olderMigrationsRoot, coreSet.name);
  await writeFile(
    join(olderCoreDir, `${extraTag}.sql`),
    `ALTER TABLE "invoice_series" ADD COLUMN "retired_at" timestamp with time zone;`,
  );
  const journalPath = join(olderCoreDir, "meta", "_journal.json");
  const journal = JSON.parse(await readFile(journalPath, "utf8")) as {
    entries: { idx: number; version: string; when: number; tag: string; breakpoints: boolean }[];
  };
  journal.entries.push({
    idx: journal.entries.length,
    version: "7",
    // Drizzle replays an entry only when its `when` is later than the newest applied row's
    // created_at, and every shipped `when` was stamped at `db:generate` time — in the past.
    when: Date.now(),
    tag: extraTag,
    breakpoints: true,
  });
  await writeFile(journalPath, JSON.stringify(journal));

  baselinePg = await cloneTemplate(adminUri, pickTemplate(handle, "manifest"), nextCloneName());
  olderBaselinePg = await cloneTemplate(
    adminUri,
    pickTemplate(handle, "manifest"),
    nextCloneName(),
  );
  artifactPath = join(scratchRoot, "baseline.backup.enc");
  olderArtifactPath = join(scratchRoot, "older.backup.enc");
  for (const [pg, artifact, older] of [
    [baselinePg, artifactPath, false],
    [olderBaselinePg, olderArtifactPath, true],
  ] as const) {
    const baselineAdmin = await createPostgresDb(pg.uri);
    try {
      await seedFiscalRegistro(baselineAdmin);
      const head = await baselineAdmin.execute<{ secuencia: number; ultima_huella: string }>(
        sql`select secuencia, ultima_huella from cadenas`,
      );
      expect(head.rows).toEqual([{ secuencia: 1, ultima_huella: HUELLA }]);
      // The journal table is left alone: this database is at the head of the SHIPPED chain and one
      // behind `olderMigrationsRoot`, which is what the artifact's manifest then records.
      if (older) {
        await baselineAdmin.execute(sql`alter table invoice_series drop column retired_at`);
      }
      const manifest = await buildManifest({
        db: baselineAdmin,
        modules: ALL_MODULES,
        environment: "preproduction",
        now: new Date(),
      });
      const core = ALL_MODULES.find((m) => m.name === "core")!;
      expect(manifest.modules.core).toBe(
        expectedSchemaVersion(core.migrations, older ? olderMigrationsRoot : migrationsRoot) -
          (older ? 1 : 0),
      );

      const baselineName = new URL(pg.uri).pathname.replace(/^\//, "");
      const dumpInContainer = `/tmp/waitron-restore-fiscal-baseline-${process.pid}-${older}.dump`;
      const hostDump = join(scratchRoot, `baseline-${older}.dump`);
      await execFileAsync("docker", [
        "exec",
        containerId,
        "pg_dump",
        "--format=custom",
        "--file",
        dumpInContainer,
        internalUrl(adminUri, baselineName),
      ]);
      await execFileAsync("docker", ["cp", `${containerId}:${dumpInContainer}`, hostDump]);
      await execFileAsync("docker", ["exec", containerId, "rm", "-f", dumpInContainer]).catch(
        () => {},
      );
      const dumpBytes = await readFile(hostDump);
      const entries: ArchiveEntry[] = [
        { name: "manifest.json", bytes: Buffer.from(JSON.stringify(manifest)) },
        { name: "db.dump", bytes: dumpBytes },
        { name: `media/${MEDIA_NAME}`, bytes: BASELINE_MEDIA },
        {
          name: "secrets/trading.env",
          bytes: Buffer.from(
            formatEnvFile({
              WAITRON_TILL_TENANT_ID: F.tenantId,
              WAITRON_TILL_TILL_ID: F.tillId,
              WAITRON_TILL_NODE_ID: F.nodeId,
              WAITRON_TILL_SERIES_ID: F.seriesId,
              WAITRON_TILL_LOCATION_ID: F.locationId,
              DATABASE_URL: "postgres://app@localhost/waitron",
              WAITRON_MIGRATIONS_DATABASE_URL: "postgres://owner@localhost/waitron",
              WAITRON_ENV: "preproduction",
            }),
          ),
        },
        { name: "secrets/secrets.env", bytes: Buffer.from("WAITRON_CREDENTIALS_KEY=deadbeef\n") },
      ];
      await writeFile(artifact, encryptArtifact(packArchive(entries), RECOVERY_KEY));
    } finally {
      await baselineAdmin.close();
    }
  }
});

afterAll(async () => {
  if (containerId !== undefined) {
    for (const name of targets) {
      await execFileAsync("docker", [
        "exec",
        containerId,
        "psql",
        internalUrl(adminUri, "postgres"),
        "-v",
        "ON_ERROR_STOP=1",
        "-c",
        `drop database ${name} with (force)`,
      ]).catch(() => {});
    }
  }
  if (baselinePg !== undefined) await baselinePg.stop().catch(() => {});
  if (olderBaselinePg !== undefined) await olderBaselinePg.stop().catch(() => {});
  if (scratchRoot !== undefined) await rm(scratchRoot, { recursive: true, force: true });
});

describe("fiscal restore (real Postgres, end to end)", () => {
  it("re-registers the SIF, retires and replaces the series, rewrites trading.env, keeps the ledger immutable, stamps the origin", async () => {
    if (containerId === undefined) return;
    const target = await makeFreshTarget();
    const dirs = await arrangeDirs();
    await drive(target, dirs);

    const db = await createPostgresDb(target);
    try {
      const sifs = await db.execute<{ numero_instalacion: number; revocado_en: string | null }>(
        sql`select numero_instalacion, revocado_en from registro_sif where node_id = ${F.nodeId}::uuid order by numero_instalacion`,
      );
      expect(sifs.rows).toHaveLength(2);
      expect(sifs.rows[0]).toMatchObject({ numero_instalacion: 1 });
      expect(sifs.rows[0]?.revocado_en).not.toBeNull();
      expect(sifs.rows[1]?.revocado_en).toBeNull();
      expect(sifs.rows[1]!.numero_instalacion).toBeGreaterThanOrEqual(
        installationFloor(new Date(Date.now() - 60_000)),
      );
      const n = sifs.rows[1]!.numero_instalacion;
      const head = await db.execute<{ ultima_huella: string | null; secuencia: number }>(
        sql`select ultima_huella, secuencia from cadenas where node_id = ${F.nodeId}::uuid`,
      );
      expect(head.rows[0]).toEqual({ ultima_huella: null, secuencia: 1 });
      const series = await db.execute<{ code: string; retired: boolean; next_number: number }>(
        sql`select code, retired_at is not null as retired, next_number from invoice_series where node_id = ${F.nodeId}::uuid order by code`,
      );
      expect(series.rows).toEqual([
        { code: "FA", retired: true, next_number: 5 },
        { code: `FA-${n}`, retired: false, next_number: 1 },
        { code: "RE", retired: true, next_number: 1 },
        { code: `RE-${n}`, retired: false, next_number: 1 },
      ]);
      const env = parseEnvFile(await readFile(join(dirs.stateDir, "trading.env"), "utf8"));
      expect(env.WAITRON_TILL_SERIES_ID).toBe(await readStandardSeriesId(db, F.tenantId, F.nodeId));
      expect(env.WAITRON_TILL_NODE_ID).toBe(F.nodeId);
      expect(env.DATABASE_URL).toBe("postgres://app@localhost/waitron");
      expect(await readFile(join(dirs.stateDir, "secrets.env"), "utf8")).toBe(
        "WAITRON_CREDENTIALS_KEY=deadbeef\n",
      );
      const ledger = await db.execute<{ n: number }>(
        sql`select count(*)::int as n from registros_facturacion`,
      );
      expect(ledger.rows[0]?.n).toBe(1);
      const blocked = await db
        .execute(sql`update registros_facturacion set huella = ${"E".repeat(64)}`)
        .then(() => undefined)
        .catch((e: unknown) => e as { code?: string; cause?: { code?: string } });
      expect(blocked?.code ?? blocked?.cause?.code).toBe("WT001");
      // Origin stamping: the hook's captured rows carry THIS node, not the all-zero origin.
      const captured = await db.execute<{ n: number }>(
        sql`select count(*)::int as n from sync_log where table_name in ('registro_sif', 'cadenas') and origin_id = ${F.nodeId}::uuid`,
      );
      expect(captured.rows[0]!.n).toBeGreaterThanOrEqual(3); // revoke + insert + head reset
      expect(await schemaVersionsByModule(db, ALL_MODULES)).toEqual(
        Object.fromEntries(
          ALL_MODULES.map((m) => [m.name, expectedSchemaVersion(m.migrations, migrationsRoot)]),
        ),
      );
    } finally {
      await db.close();
    }
    await expect(stat(join(dirs.stateDir, "restore-staging", "db.dump"))).rejects.toMatchObject({
      code: "ENOENT",
    });
  });

  it("an OLDER artifact (one core migration behind) is migrated before the hook runs — and is NOT without the migrate step", async () => {
    if (containerId === undefined) return;
    const target = await makeFreshTarget();
    const dirs = await arrangeDirs();
    await drive(target, dirs, olderArtifactPath);
    const db = await createPostgresDb(target);
    try {
      expect(await schemaVersionsByModule(db, ALL_MODULES)).toEqual(
        Object.fromEntries(
          ALL_MODULES.map((m) => [
            m.name,
            expectedSchemaVersion(m.migrations, olderMigrationsRoot),
          ]),
        ),
      );
      const series = await db.execute<{ n: number }>(
        sql`select count(*)::int as n from invoice_series where retired_at is not null`,
      );
      expect(series.rows[0]?.n).toBe(2);
    } finally {
      await db.close();
    }
    // Control: with the migrate step stubbed out the hook reads a column the older dump lacks.
    const control = await makeFreshTarget();
    const controlDirs = await arrangeDirs();
    // DrizzleQueryError exposes PostgreSQL's missing retired_at column error through cause.
    await expect(
      restoreFromArtifact({
        ...(await restoreDepsFor(control, controlDirs, olderArtifactPath)),
        migrate: async () => {},
      }),
    ).rejects.toMatchObject({
      cause: { code: "42703", message: expect.stringContaining("retired_at") },
    });
    await expect(stat(join(controlDirs.stateDir, "trading.env"))).rejects.toMatchObject({
      code: "ENOENT",
    });
  });

  it("NEGATIVE CONTROL — skipSecrets:true (the rejoin shape) leaves SIF, series and stateDir untouched", async () => {
    if (containerId === undefined) return;
    const target = await makeFreshTarget();
    const dirs = await arrangeDirs();
    await restoreFromArtifact({ ...(await restoreDepsFor(target, dirs)), skipSecrets: true });
    const db = await createPostgresDb(target);
    try {
      const sifs = await db.execute<{ n: number }>(
        sql`select count(*)::int as n from registro_sif where revocado_en is null and numero_instalacion = 1`,
      );
      expect(sifs.rows[0]?.n).toBe(1);
      const retired = await db.execute<{ n: number }>(
        sql`select count(*)::int as n from invoice_series where retired_at is not null`,
      );
      expect(retired.rows[0]?.n).toBe(0);
    } finally {
      await db.close();
    }
    await expect(stat(join(dirs.stateDir, "trading.env"))).rejects.toMatchObject({
      code: "ENOENT",
    });
  });

  it("a failure AFTER the fiscal hook minted and the series were retired rolls everything back and writes no identity", async () => {
    if (containerId === undefined) return;
    // The real fiscal hook runs, then its outcome is replaced by a code the node already holds — the
    // orchestrator's insert collides after the retire, and the whole transaction (SIF included) must roll back.
    const sabotaged: WaitronModule[] = ALL_MODULES.map((m) =>
      m.name === "fiscal"
        ? {
            ...m,
            backup: {
              ...m.backup,
              restore: async (tx, node) => ({
                ...(await FISCAL_RESTORE(tx, node)),
                series: [{ code: "FA", purpose: "standard" }],
              }),
            },
          }
        : m,
    );
    const target = await makeFreshTarget();
    const dirs = await arrangeDirs();
    const rd = await restoreDepsFor(target, dirs);
    const validated = await validateArtifact(rd);
    await expect(writeValidated(validated, { ...rd, modules: sabotaged })).rejects.toMatchObject({
      code: "restore.hook_failed",
      params: { module: "fiscal", code: "series.code_collision" },
    });
    const db = await createPostgresDb(target);
    try {
      const sifs = await db.execute<{ n: number }>(
        sql`select count(*)::int as n from registro_sif`,
      );
      expect(sifs.rows[0]?.n).toBe(1); // the hook's new row rolled back
      const counter = await db.execute<{ proximo_numero: number }>(
        sql`select proximo_numero from contadores_instalacion`,
      );
      expect(counter.rows[0]?.proximo_numero).toBe(2); // the floor rolled back with it
      const retired = await db.execute<{ n: number }>(
        sql`select count(*)::int as n from invoice_series where retired_at is not null`,
      );
      expect(retired.rows[0]?.n).toBe(0);
    } finally {
      await db.close();
    }
    await expect(stat(join(dirs.stateDir, "trading.env"))).rejects.toMatchObject({
      code: "ENOENT",
    });
    await expect(stat(join(dirs.stateDir, "secrets.env"))).rejects.toMatchObject({
      code: "ENOENT",
    });
  });
});
