import { execFile } from "node:child_process";
import { cp, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createPostgresDb, writeNodeMembership, type Database } from "@waitron/db";
import {
  cloneTemplate,
  nextCloneName,
  pickTemplate,
  resolveSharedHandle,
} from "@waitron/db/testing/lifecycle.js";
import { databaseUrl, type RealPostgres } from "@waitron/db/testing/postgres.js";
import type { SignedMembershipDocument } from "@waitron/membership";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { tablesForLane } from "@waitron/sync";
import { ALL_MODULES, ALL_SYNC_ENROLMENTS } from "./modules.js";
import { buildManifest } from "./backup-manifest.js";
import { packArchive, type ArchiveEntry } from "./backup-archive.js";
import { encryptArtifact } from "./artifact-cipher.js";
import { restoreFromArtifact, type RestoreDeps } from "./restore.js";
import type { PgRestoreRunner } from "./pg-restore.js";
import { runRejoin } from "./rejoin-command.js";
import { locateSharedContainer } from "./testing/locate-shared-container.js";

const execFileAsync = promisify(execFile);

// The HEADLINE R3 receipt (Task 5): drive the WHOLE operator flow through the real `runRejoin`
// (env-driven) against a real Postgres container — a "diverged" ex-primary is wiped, the primary's
// baseline artifact is restored (secrets SKIPPED → the returning node keeps its OWN identity), and the
// fiscal ledger comes back IMMUTABLE. Only ONE seam is substituted: `runRejoin`'s `restore` seam wraps
// the REAL `restoreFromArtifact` with a `pg_restore` runner that shells out INSIDE the container. The
// host carries no pg18 client binaries (macOS/CI), so — exactly like pg-restore.test.ts and
// backup-sweep.test.ts — `pg_dump`/`pg_restore` run via `docker exec` while everything else
// (the guard ladder, the drain read, `dropAndCreateDatabase`, `closePreWipe`, the till/env resolution,
// decrypt/unpack/gate/guard, media restore, staging cleanup) is the shipped code.
//
// Ruling 4: the maintenance/admin connection is the shared container superuser
// (`resolveSharedHandle(undefined).uri`, the default `test` db); the baseline and diverged-target dbs
// are BOTH throwaway clones this suite creates on that container and drops itself. The wipe only ever
// drops the throwaway TARGET — never the shared `test` db or the `manifest` template. Only the raw
// connections and clones this suite opens itself need guarded teardown (§4); everything is torn down in
// a `finally` so the suite is order-independent. Building baseline+target dbs is the §4 exception —
// this suite legitimately owns its own resources — so guarded raw setup is correct here.
//
// A skipped smoke proves nothing (CLAUDE.md §2): when `docker`/the container id cannot be resolved this
// degrades to a LOUD skip, never a silent green.

const RECOVERY_KEY = "s3cr3t-recovery-key-for-r3-rejoin-e2e";
const CARRIER_ID = "carrier-1"; // the serving-primary the returned node drains onto / streams from
const MEDIA_NAME = "deadbeefdeadbeefdeadbeefdeadbeef.jpg"; // a content-addressed media blob name
const BASELINE_MEDIA = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46]);
// The returning node's OWN identity secret, written into stateDir BEFORE the flow. `skipSecrets:true`
// means R3 keeps this byte-for-byte; the artifact carries a DIFFERENT secret that must NOT overwrite it.
const OWN_IDENTITY = "own-node-identity-key-KEEP-THIS-UNCHANGED\n";
const PRIMARY_SECRET = "primary-node-identity-key-MUST-NOT-LAND-ON-THE-MIRROR\n";

const BASELINE_HUELLA = "A".repeat(64); // the primary's chain row (what the target must end up with)
const DIVERGED_HUELLA = "D".repeat(64); // the diverged local row (must be gone after the wipe+restore)

// Fixed ids for the one seeded tenant/till/node/SIF/sale/registro — pg-restore.test.ts's `F`, reused so
// the FK closure the fiscal row needs is exactly the current migrated schema. The SAME ids are seeded
// into the (separate) baseline and target dbs; only the `huella` differs, so a single-row read tells
// baseline from diverged after the restore.
const F = {
  tenantId: "c0000000-0000-4000-8000-000000000001",
  locationId: "c0000000-0000-4000-8000-000000000002",
  tillId: "c0000000-0000-4000-8000-000000000003",
  seriesId: "c0000000-0000-4000-8000-000000000004",
  saleId: "c0000000-0000-4000-8000-000000000005",
  sifId: "c0000000-0000-4000-8000-000000000006",
  nodeId: "c0000000-0000-4000-8000-000000000008",
};

// A held chart naming THIS node (F.nodeId) `sell-only` (fenced) under a serving-primary carrier — the
// standing rejoin requires (isFencedStanding) plus a carrier to stream from (servingPrimaryNodeId).
// retire.test.ts's shape; the signature is never verified on a read-back.
function heldDoc(): SignedMembershipDocument {
  return {
    body: {
      term: 3,
      nodes: [
        { nodeId: F.nodeId, contactUrl: "", standing: "sell-only" },
        { nodeId: CARRIER_ID, contactUrl: "https://carrier", standing: "serving-primary" },
      ],
    },
    signerNodeId: CARRIER_ID,
    signature: "held-placeholder-sig",
    endorsements: [],
  } as unknown as SignedMembershipDocument;
}

// Seeds exactly the FK closure `registros_facturacion` needs plus the row itself, as plain unscoped
// statements (the container superuser bypasses RLS; FKs still enforced) — pg-restore.test.ts's
// `seedFiscalRegistro`, parametrised by `huella` so baseline and diverged rows are distinguishable.
async function seedFiscalRegistro(admin: Database, huella: string): Promise<void> {
  await admin.execute(sql`
    insert into tenants (id, country, tax_id, legal_name)
    values (${F.tenantId}, 'ES', '89890001K', 'Waitron SL')
  `);
  await admin.execute(sql`
    insert into locations (id, tenant_id, name, invoice_locales, operation_description)
    values (${F.locationId}, ${F.tenantId}, 'Local principal', array['es'], 'Venta en establecimiento')
  `);
  await admin.execute(sql`
    insert into tills (id, tenant_id, location_id, name)
    values (${F.tillId}, ${F.tenantId}, ${F.locationId}, 'Caja 1')
  `);
  await admin.execute(sql`
    insert into nodes (id, tenant_id, location_id, name)
    values (${F.nodeId}, ${F.tenantId}, ${F.locationId}, 'Node 1')
  `);
  await admin.execute(sql`
    insert into invoice_series (id, tenant_id, node_id, code)
    values (${F.seriesId}, ${F.tenantId}, ${F.nodeId}, 'A')
  `);
  await admin.execute(sql`
    insert into sales (
      id, tenant_id, till_id, node_id, series_id, invoice_number,
      issued_at, issued_offset_minutes,
      total, vat_breakdown,
      locale, invoice_locales, fiscal_backend, fiscal_state
    ) values (
      ${F.saleId}, ${F.tenantId}, ${F.tillId}, ${F.nodeId}, ${F.seriesId}, 1,
      '2026-07-20T19:20:30+01:00', 60,
      '0.00', '[]'::jsonb,
      'es', array['es'], 'verifactu', 'recorded'
    )
  `);
  await admin.execute(sql`
    insert into registro_sif (id, tenant_id, node_id, nif, id_sistema_informatico, numero_instalacion)
    values (${F.sifId}, ${F.tenantId}, ${F.nodeId}, '89890001K', 'WAITRON01', 1)
  `);
  await admin.execute(sql`
    insert into registros_facturacion (
      tenant_id, till_id, node_id, sif_id, sale_id, secuencia, tipo_registro,
      id_emisor_factura, num_serie_factura, fecha_expedicion_factura, nombre_razon_emisor,
      tipo_factura, descripcion_operacion, desglose, cuota_total, importe_total,
      primer_registro, sistema_informatico,
      fecha_hora_huso_gen_registro, offset_minutos, tipo_huella, huella
    ) values (
      ${F.tenantId}, ${F.tillId}, ${F.nodeId}, ${F.sifId}, ${F.saleId}, 1, 'alta',
      '89890001K', 'A/1', '2026-07-20', 'Waitron SL',
      'F2', 'Venta en establecimiento', '[]'::jsonb, '12.35', '123.45',
      true, '{}'::jsonb,
      '2026-07-20T19:20:30+01:00', 60, '01', ${huella}
    )
  `);
}

/** A `pg_restore` runner that shells out INSIDE the container. `restoreFromArtifact` stages the dump to
 * a HOST file (`stagingDir/db.dump`) and hands us that path; we `docker cp` it in and restore against
 * the container-internal server (localhost:5432), translating the host `databaseUrl` (published port)
 * to the internal one. This is the ONLY substitution — the real `restoreFromArtifact` runs around it. */
function containerPgRestore(containerId: string): PgRestoreRunner {
  let n = 0;
  return async ({ databaseUrl: url, inFile, signal }) => {
    const dbn = new URL(url).pathname.replace(/^\//, "");
    const internal = internalUrl(url, dbn);
    const inContainer = `/tmp/waitron-rejoin-e2e-${process.pid}-${(n += 1)}.dump`;
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

let adminUri: string; // shared container superuser on the default `test` maintenance db (Ruling 4)
let containerId: string | undefined; // undefined ⇒ LOUD skip (docker/container unresolvable)
let migrationsRoot: string; // the shipped migration folders, for the restore compatibility gate
let scratchRoot: string; // holds the built artifact + per-test media/state dirs
let artifactPath: string; // the real encrypted baseline artifact `runRejoin` reads
let baselinePg: RealPostgres | undefined; // the primary's baseline db (dumped into the artifact)
const targets: RealPostgres[] = []; // every throwaway target this suite created, dropped in afterAll

async function makeTarget(): Promise<RealPostgres> {
  const handle = resolveSharedHandle(undefined);
  const pg = await cloneTemplate(adminUri, pickTemplate(handle, "manifest"), nextCloneName());
  targets.push(pg);
  return pg;
}

/** Per-test media + state dirs. `<stateDir>/restore-staging` is DELIBERATELY not created here: the
 * shipped `restoreFromArtifact` mkdir's its own staging/media/state roots before the guard realpath's
 * them (restore.ts), so this e2e exercises that fix end to end rather than masking it. Only the
 * node's OWN identity secret is pre-written, to prove `skipSecrets` keeps it. */
async function arrangeDirs(): Promise<{ mediaDir: string; stateDir: string; stagingDir: string }> {
  const mediaDir = await mkdtemp(join(scratchRoot, "media-"));
  const stateDir = await mkdtemp(join(scratchRoot, "state-"));
  const stagingDir = join(stateDir, "restore-staging");
  await writeFile(join(stateDir, "identity.key"), OWN_IDENTITY);
  return { mediaDir, stateDir, stagingDir };
}

function envFor(target: RealPostgres, dirs: { mediaDir: string; stateDir: string }) {
  const targetName = new URL(target.uri).pathname.replace(/^\//, "");
  const targetUrl = databaseUrl(adminUri, targetName);
  return {
    WAITRON_BACKUP_RECOVERY_KEY: RECOVERY_KEY,
    WAITRON_RESTORE_DATABASE_URL: targetUrl,
    DATABASE_URL: targetUrl,
    WAITRON_SYNC_DATABASE_URL: targetUrl,
    WAITRON_MAINTENANCE_DATABASE_URL: adminUri,
    WAITRON_TILL_TENANT_ID: F.tenantId,
    WAITRON_TILL_TILL_ID: F.tillId,
    WAITRON_TILL_NODE_ID: F.nodeId,
    WAITRON_TILL_SERIES_ID: F.seriesId,
    WAITRON_TILL_LOCATION_ID: F.locationId,
    WAITRON_MEDIA_DIR: dirs.mediaDir,
    WAITRON_STATE_DIR: dirs.stateDir,
    WAITRON_MIGRATIONS_DIR: migrationsRoot,
    WAITRON_ENV: "preproduction",
  } satisfies Record<string, string>;
}

/** Drive the real `runRejoin`, substituting only the in-container `pg_restore`. */
async function drive(
  target: RealPostgres,
  dirs: { mediaDir: string; stateDir: string },
): Promise<{ code: number; out: string[] }> {
  const out: string[] = [];
  const code = await runRejoin({
    argv: ["rejoin", artifactPath],
    env: envFor(target, dirs),
    out: (l) => out.push(l),
    // The REAL restore, with only the pg_restore shell-out redirected into the container.
    restore: (rd: RestoreDeps) =>
      restoreFromArtifact({ ...rd, runRestore: containerPgRestore(containerId!) }),
  });
  return { code, out };
}

beforeAll(async () => {
  const handle = resolveSharedHandle(undefined);
  adminUri = handle.uri;

  containerId = await locateSharedContainer(new URL(adminUri), {
    tag: "R3 rejoin e2e",
    unproven: "the R3 wipe-and-restore end-to-end flow is UNPROVEN in this run.",
  });
  if (containerId === undefined) return; // LOUD skip already logged; each `it` returns early too

  // The shipped migration folders (boot's from-source default does not exist), so WAITRON_MIGRATIONS_DIR
  // can point the restore compatibility gate at the per-set journals — adopt-e2e.rls.test.ts's shape.
  const fromSource = migrationOptionsFor(manifestSets(), null);
  scratchRoot = await mkdtemp(join(tmpdir(), "waitron-rejoin-e2e-"));
  migrationsRoot = join(scratchRoot, "migrations");
  for (const [index, set] of manifestSets().entries()) {
    await cp(fromSource[index]!.migrationsFolder, join(migrationsRoot, set.name), {
      recursive: true,
    });
  }

  // Build the PRIMARY's baseline artifact: a real fully-migrated db with the primary's chain row,
  // pg_dump'd (custom format) in-container, then packed {manifest, db.dump, media/<sha>, secrets/*} and
  // encrypted — the exact composition order backup-sweep.ts uses.
  baselinePg = await cloneTemplate(adminUri, pickTemplate(handle, "manifest"), nextCloneName());
  const baselineAdmin = await createPostgresDb(baselinePg.uri);
  try {
    await seedFiscalRegistro(baselineAdmin, BASELINE_HUELLA);
    const manifest = await buildManifest({
      db: baselineAdmin,
      modules: ALL_MODULES,
      environment: "preproduction",
      now: new Date(),
    });

    const baselineName = new URL(baselinePg.uri).pathname.replace(/^\//, "");
    const dumpInContainer = `/tmp/waitron-rejoin-baseline-${process.pid}.dump`;
    const hostDump = join(scratchRoot, "baseline.dump");
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
      { name: "secrets/identity.key", bytes: Buffer.from(PRIMARY_SECRET) },
    ];
    artifactPath = join(scratchRoot, "baseline.backup.enc");
    await writeFile(artifactPath, encryptArtifact(packArchive(entries), RECOVERY_KEY));
  } finally {
    await baselineAdmin.close();
  }
});

afterAll(async () => {
  for (const pg of targets) await pg.stop().catch(() => {});
  if (baselinePg !== undefined) await baselinePg.stop().catch(() => {});
  if (scratchRoot !== undefined) await rm(scratchRoot, { recursive: true, force: true });
});

describe("R3 rejoin-as-secondary (real Postgres, end to end)", () => {
  it("wipes the diverged db, restores the baseline (skipping secrets), and preserves fiscal immutability", async () => {
    if (containerId === undefined) return; // LOUD skip logged in beforeAll

    // ARRANGE — a diverged target: the primary chain row with a DIFFERENT huella, a held chart marking
    // this node fenced under the carrier, and NO own-origin sync_log rows (drained TRIVIALLY).
    const target = await makeTarget();
    const targetName = new URL(target.uri).pathname.replace(/^\//, "");
    const seed = await createPostgresDb(target.uri);
    try {
      await seedFiscalRegistro(seed, DIVERGED_HUELLA);
      await writeNodeMembership(seed, heldDoc());
    } finally {
      await seed.close(); // gone before the FORCE drop
    }
    const dirs = await arrangeDirs();

    // ACT
    const { code, out } = await drive(target, dirs);
    expect(code, out.join("\n")).toBe(0);
    expect(out.join("\n")).toContain(CARRIER_ID); // streams from the held carrier after the restore

    // ASSERT — the target now matches the BASELINE, not the diverged local state.
    const fresh = await createPostgresDb(databaseUrl(adminUri, targetName));
    try {
      const rows = await fresh.execute<{ n: number; huella: string | null }>(sql`
        select count(*)::int as n, max(huella) as huella from registros_facturacion
      `);
      expect(rows.rows[0]?.n).toBe(1); // exactly the one baseline row
      expect(rows.rows[0]?.huella).toBe(BASELINE_HUELLA); // baseline's chain, not the diverged 'D' row

      // Fiscal immutability restored ACTIVE: a post-restore UPDATE is rejected by the append-only
      // trigger (SQLSTATE WT001). Connect as superuser, who bypasses REVOKE ALL but NOT the trigger.
      // `db.execute` wraps the driver error; the real SQLSTATE lives on `.cause` (pg-restore.test.ts).
      const blocked = await fresh
        .execute(sql`update registros_facturacion set huella = ${"E".repeat(64)}`)
        .then(() => undefined)
        .catch((e: unknown) => e as { code?: string; cause?: { code?: string } });
      expect(
        blocked,
        "the restored ledger accepted an UPDATE — immutability inactive",
      ).toBeDefined();
      expect(blocked?.code ?? blocked?.cause?.code).toBe("WT001");
    } finally {
      await fresh.close();
    }

    // Media restored (byte-for-byte) into mediaDir.
    expect(await readFile(join(dirs.mediaDir, MEDIA_NAME))).toEqual(BASELINE_MEDIA);

    // Own-identity secret UNTOUCHED — skipSecrets kept it; the artifact's secret did NOT land.
    expect(await readFile(join(dirs.stateDir, "identity.key"), "utf8")).toBe(OWN_IDENTITY);

    // Staging cleaned — no whole-DB plaintext dump left behind.
    await expect(stat(join(dirs.stagingDir, "db.dump"))).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("refuses an un-drained node with rejoin.not_drained and leaves the diverged db UNTOUCHED", async () => {
    if (containerId === undefined) return; // LOUD skip logged in beforeAll

    // ARRANGE — same fenced held chart, but seed an own-origin sync_log tail with NO carrier cursor, so
    // readDrainProgress returns drained:false (disposal.rls.test.ts's not-drained shape).
    const target = await makeTarget();
    const targetName = new URL(target.uri).pathname.replace(/^\//, "");
    const orderedTable = tablesForLane(ALL_SYNC_ENROLMENTS, "ordered")[0]!;
    const seed = await createPostgresDb(target.uri);
    try {
      await seedFiscalRegistro(seed, DIVERGED_HUELLA);
      await writeNodeMembership(seed, heldDoc());
      await seed.execute(sql`
        insert into sync_log (seq, origin_id, table_name, op, tenant_id, row_image)
        overriding system value
        values (100, ${F.nodeId}::uuid, ${orderedTable}, 'insert', ${F.tenantId}::uuid, '{}'::jsonb)
      `);
    } finally {
      await seed.close();
    }
    const dirs = await arrangeDirs();

    // ACT
    const { code, out } = await drive(target, dirs);

    // The guard refuses BEFORE anything irreversible.
    expect(code).toBe(1);
    expect(out.join("\n")).toContain("rejoin.not_drained");

    // ASSERT — the diverged db is UNTOUCHED: the wipe never ran.
    const fresh = await createPostgresDb(databaseUrl(adminUri, targetName));
    try {
      const rows = await fresh.execute<{ huella: string | null }>(
        sql`select max(huella) as huella from registros_facturacion`,
      );
      expect(rows.rows[0]?.huella).toBe(DIVERGED_HUELLA); // the diverged row is still here
      const tail = await fresh.execute<{ n: number }>(
        sql`select count(*)::int as n from sync_log where origin_id = ${F.nodeId}::uuid`,
      );
      expect(tail.rows[0]?.n).toBe(1); // the un-drained tail is still here
    } finally {
      await fresh.close();
    }

    // Nothing was staged and no media was written — the restore never started.
    await expect(stat(join(dirs.stagingDir, "db.dump"))).rejects.toMatchObject({ code: "ENOENT" });
    await expect(stat(join(dirs.mediaDir, MEDIA_NAME))).rejects.toMatchObject({ code: "ENOENT" });
    // The own-identity secret is untouched (the whole flow refused before any secret decision).
    expect(await readFile(join(dirs.stateDir, "identity.key"), "utf8")).toBe(OWN_IDENTITY);
  });
});
