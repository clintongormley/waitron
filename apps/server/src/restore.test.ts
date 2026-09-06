import { mkdtemp, readFile, rm, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { usePgliteDb } from "@waitron/db/testing/lifecycle.js";
import { sql } from "drizzle-orm";
import { AppError } from "@waitron/shared";
import type { RestoreHook, WaitronModule } from "@waitron/module";
import { formatEnvFile, parseEnvFile } from "./env-file.js";
import { ALL_MODULES } from "./modules.js";
import { type ArchiveEntry, packArchive } from "./backup-archive.js";
import { encryptArtifact } from "./artifact-cipher.js";
import type { BackupManifest } from "./backup-manifest.js";
import type { PgRestoreRunner } from "./pg-restore.js";
import type { Logger } from "./logger.js";
import {
  type RestoreDeps,
  restoreDatabase,
  restoreFromArtifact,
  restoreMedia,
  restoreSecrets,
  validateArtifact,
  writeValidated,
} from "./restore.js";

// PGlite exercises transaction rollback here; these tests make no privilege or concurrency claim.
const suite = usePgliteDb({
  migrations: migrationOptionsFor(manifestSets(), null),
  timeoutMs: 120_000,
});

const T = {
  tenantId: "c0000000-0000-4000-8000-000000000001",
  locationId: "c0000000-0000-4000-8000-000000000002",
  tillId: "c0000000-0000-4000-8000-000000000003",
  seriesId: "c0000000-0000-4000-8000-000000000004",
  nodeId: "c0000000-0000-4000-8000-000000000008",
};
const TRADING_ENV = formatEnvFile({
  WAITRON_TILL_TENANT_ID: T.tenantId,
  WAITRON_TILL_TILL_ID: T.tillId,
  WAITRON_TILL_NODE_ID: T.nodeId,
  WAITRON_TILL_SERIES_ID: T.seriesId,
  WAITRON_TILL_LOCATION_ID: T.locationId,
  DATABASE_URL: "postgres://app@localhost/waitron",
  WAITRON_MIGRATIONS_DATABASE_URL: "postgres://owner@localhost/waitron",
  WAITRON_ENV: "preproduction",
});

beforeAll(async () => {
  const db = suite.db;
  await db.execute(
    sql`insert into tenants (id, country, tax_id, legal_name) values (${T.tenantId}, 'ES', '89890001K', 'Waitron SL')`,
  );
  await db.execute(
    sql`insert into locations (id, tenant_id, name, invoice_locales, operation_description) values (${T.locationId}, ${T.tenantId}, 'Local', array['es'], 'Venta')`,
  );
  await db.execute(
    sql`insert into tills (id, tenant_id, location_id, name) values (${T.tillId}, ${T.tenantId}, ${T.locationId}, 'Caja 1')`,
  );
  await db.execute(
    sql`insert into nodes (id, tenant_id, location_id, name) values (${T.nodeId}, ${T.tenantId}, ${T.locationId}, 'Node 1')`,
  );
  await db.execute(
    sql`insert into invoice_series (id, tenant_id, node_id, code) values (${T.seriesId}, ${T.tenantId}, ${T.nodeId}, 'FA')`,
  );
});

/** Re-arm the node's series between tests: FA live, anything a hook opened removed. */
async function resetSeries(): Promise<void> {
  await suite.db.execute(
    sql`delete from invoice_series where node_id = ${T.nodeId} and id <> ${T.seriesId}`,
  );
  await suite.db.execute(sql`update invoice_series set retired_at = null where id = ${T.seriesId}`);
}

const openDb = async () => ({ db: suite.db, close: async () => {} });

/** ALL_MODULES with every real `migrations` kept (the gate and the migrate step resolve them) and the
 * restore hooks replaced: named modules get the given hook, every other module none. */
function withHooks(hooks: Partial<Record<string, RestoreHook>>): WaitronModule[] {
  return ALL_MODULES.map((m) => ({
    ...m,
    backup: { ...m.backup, restore: hooks[m.name] },
  }));
}

const KEY = "correct horse battery staple";
const noopLog: Logger = () => {};

const MANIFEST: BackupManifest = {
  manifestVersion: 1,
  createdAt: "2026-09-05T00:00:00.000Z",
  environment: "preproduction",
  modules: {},
};

const DUMP = Buffer.from("PGDMP-fake-custom-format-dump");
const MEDIA = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]); // jpeg-ish binary
const SECRET = "WAITRON_VAULT_MASTER_KEY=deadbeef\n";

function buildArtifact(
  entries: ArchiveEntry[],
  manifest: BackupManifest | "omit" = MANIFEST,
): Uint8Array {
  const all: ArchiveEntry[] = [];
  if (manifest !== "omit") {
    all.push({ name: "manifest.json", bytes: Buffer.from(JSON.stringify(manifest)) });
  }
  all.push(...entries);
  return encryptArtifact(packArchive(all), KEY);
}

const FULL_ENTRIES: ArchiveEntry[] = [
  { name: "db.dump", bytes: DUMP },
  { name: "media/abc123.jpg", bytes: MEDIA },
  { name: "secrets/secrets.env", bytes: Buffer.from(SECRET) },
  { name: "secrets/trading.env", bytes: Buffer.from(TRADING_ENV) },
];

// Each describe registers its own temp-directory lifecycle while sharing these path bindings.
let mediaDir: string;
let stateDir: string;
let stagingDir: string;

function useTempDirs(prefix: string): void {
  beforeEach(async () => {
    mediaDir = await mkdtemp(join(tmpdir(), `${prefix}media-`));
    stateDir = await mkdtemp(join(tmpdir(), `${prefix}state-`));
    stagingDir = await mkdtemp(join(tmpdir(), `${prefix}staging-`));
  });
  afterEach(async () => {
    for (const dir of [mediaDir, stateDir, stagingDir]) {
      await rm(dir, { recursive: true, force: true });
    }
  });
}

describe("restoreFromArtifact", () => {
  useTempDirs("waitron-restore-");
  let restored: { databaseUrl: string; inFile: string; bytes: Uint8Array } | undefined;
  let runRestore: PgRestoreRunner;

  beforeEach(() => {
    restored = undefined;
    runRestore = vi.fn(async ({ databaseUrl, inFile }) => {
      // Read the staged file AT restore time — the orchestrator cleans staging afterwards.
      restored = { databaseUrl, inFile, bytes: await readFile(inFile) };
    });
  });

  function deps(overrides: Partial<Parameters<typeof restoreFromArtifact>[0]> = {}) {
    return {
      artifact: buildArtifact(FULL_ENTRIES),
      recoveryKey: KEY,
      databaseUrl: "postgres://admin@localhost/fresh",
      mediaDir,
      stateDir,
      stagingDir,
      migrationsRoot: null as string | null,
      modules: withHooks({}),
      openDb,
      migrate: vi.fn(async () => {}),
      environment: "preproduction" as const,
      runRestore,
      log: noopLog,
      ...overrides,
    };
  }

  it("restores db dump, media and secrets, then cleans staging", async () => {
    await restoreFromArtifact(deps());

    // DB dump reached the runner, byte-for-byte, under the target connection.
    expect(runRestore).toHaveBeenCalledTimes(1);
    expect(restored?.databaseUrl).toBe("postgres://admin@localhost/fresh");
    expect(restored?.bytes).toEqual(DUMP);

    // Media landed in mediaDir (prefix stripped), byte-for-byte.
    expect(await readFile(join(mediaDir, "abc123.jpg"))).toEqual(MEDIA);

    // Secret landed in stateDir (prefix stripped).
    expect(await readFile(join(stateDir, "secrets.env"), "utf8")).toBe(SECRET);

    expect(await readFile(join(stateDir, "trading.env"), "utf8")).toBe(TRADING_ENV);

    // Staging cleaned in finally.
    await expect(stat(join(stagingDir, "db.dump"))).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("creates its own destination roots (staging/media/state) when they do not yet exist", async () => {
    // A fresh/returning box may not carry `<stateDir>/restore-staging`, its media store, or its
    // state dir. Restore must create each before the guard `realpath`s it — otherwise the guard
    // ENOENTs, and via `runRejoin` that happens AFTER the irreversible wipe (wiped-but-not-restored).
    // Point all three roots at not-yet-existing subpaths and assert the restore SUCCEEDS. Proven by
    // deletion: remove the three `mkdir`s in restore.ts and this fails with ENOENT from `realpath`.
    const newStaging = join(stagingDir, "restore-staging");
    const newMedia = join(mediaDir, "media-store");
    const newState = join(stateDir, "state-store");
    await restoreFromArtifact(
      deps({ stagingDir: newStaging, mediaDir: newMedia, stateDir: newState }),
    );

    expect(runRestore).toHaveBeenCalledTimes(1); // db restored — staging dir was created
    expect(await readFile(join(newMedia, "abc123.jpg"))).toEqual(MEDIA); // media dir was created
    expect(await readFile(join(newState, "secrets.env"), "utf8")).toBe(SECRET); // state dir was created
    await expect(stat(join(newStaging, "db.dump"))).rejects.toMatchObject({ code: "ENOENT" }); // cleaned
    // stagingDir (whole-DB plaintext dump) and stateDir (secrets) are created 0700 — a group/world
    // -readable dir would expose the 0600 files inside by traversal (mediaDir is public, default mode).
    expect((await stat(newStaging)).mode & 0o777).toBe(0o700);
    expect((await stat(newState)).mode & 0o777).toBe(0o700);
  });

  it("skips secrets when skipSecrets is true (keeps own identity), still restores db+media", async () => {
    await restoreFromArtifact(deps({ skipSecrets: true }));
    // db restored (pg_restore fake called) and media restored …
    expect(runRestore).toHaveBeenCalledTimes(1);
    expect(await readFile(join(mediaDir, "abc123.jpg"))).toEqual(MEDIA);
    // … but the secret was NOT written — the node keeps its own identity
    await expect(stat(join(stateDir, "secrets.env"))).rejects.toMatchObject({ code: "ENOENT" });
    // staging still cleaned
    await expect(stat(join(stagingDir, "db.dump"))).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("cleans staging even when pg_restore throws", async () => {
    const boom: PgRestoreRunner = vi.fn(async () => {
      throw new Error("pg_restore failed");
    });
    await expect(restoreFromArtifact(deps({ runRestore: boom }))).rejects.toThrow(
      "pg_restore failed",
    );
    await expect(stat(join(stagingDir, "db.dump"))).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("refuses an incompatible manifest BEFORE any restore or write", async () => {
    const artifact = buildArtifact(FULL_ENTRIES, { ...MANIFEST, environment: "production" });
    await expect(restoreFromArtifact(deps({ artifact }))).rejects.toMatchObject({
      code: "restore.environment_mismatch",
    });
    expect(runRestore).not.toHaveBeenCalled();
    await expect(stat(join(mediaDir, "abc123.jpg"))).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("refuses a schema-too-new manifest via the gate (versions read from code)", async () => {
    // core's real applied version in the archive is impossibly high, so the gate — fed the target's
    // own `expectedSchemaVersion(core.migrations, null)` computed from the module list — refuses.
    const artifact = buildArtifact(FULL_ENTRIES, { ...MANIFEST, modules: { core: 99999 } });
    await expect(restoreFromArtifact(deps({ artifact }))).rejects.toMatchObject({
      code: "restore.schema_too_new",
    });
    expect(runRestore).not.toHaveBeenCalled();
  });

  it("refuses a traversal entry name BEFORE any restore or write", async () => {
    const evil: ArchiveEntry[] = [
      { name: "db.dump", bytes: DUMP },
      { name: "media/../../evil.jpg", bytes: MEDIA },
    ];
    await expect(
      restoreFromArtifact(deps({ artifact: buildArtifact(evil) })),
    ).rejects.toMatchObject({ code: "restore.unsafe_entry_path" });
    expect(runRestore).not.toHaveBeenCalled();
  });

  it("throws archive_incomplete when manifest.json is absent", async () => {
    const artifact = buildArtifact(FULL_ENTRIES, "omit");
    await expect(restoreFromArtifact(deps({ artifact }))).rejects.toMatchObject({
      code: "restore.archive_incomplete",
      params: { missing: "manifest.json" },
    });
    expect(runRestore).not.toHaveBeenCalled();
  });

  it("throws archive_incomplete when db.dump is absent", async () => {
    const artifact = buildArtifact([{ name: "media/abc123.jpg", bytes: MEDIA }]);
    await expect(restoreFromArtifact(deps({ artifact }))).rejects.toMatchObject({
      code: "restore.archive_incomplete",
      params: { missing: "db.dump" },
    });
    expect(runRestore).not.toHaveBeenCalled();
  });

  it("rejects an unrecognised top-level entry (fail-visible) BEFORE any restore or write", async () => {
    // A future second non-DB source id would pack `<source>/...` blobs the orchestrator does not
    // route. Today it must fail LOUD rather than silently drop the entry (CLAUDE.md §5) — proven
    // here with a `documents/x` entry alongside a valid `db.dump`.
    const artifact = buildArtifact([
      { name: "db.dump", bytes: DUMP },
      { name: "documents/x", bytes: Buffer.from("orphan") },
    ]);
    await expect(restoreFromArtifact(deps({ artifact }))).rejects.toMatchObject({
      code: "restore.unexpected_entry",
      params: { name: "documents/x" },
    });
    expect(runRestore).not.toHaveBeenCalled();
    await expect(stat(join(mediaDir, "abc123.jpg"))).rejects.toMatchObject({ code: "ENOENT" });
  });
});

describe("validateArtifact / writeValidated (R3 validate-before-wipe split)", () => {
  useTempDirs("waitron-validate-");
  let runRestore: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    runRestore = vi.fn(async () => {});
  });

  function deps(overrides: Partial<Parameters<typeof validateArtifact>[0]> = {}) {
    return {
      artifact: buildArtifact(FULL_ENTRIES),
      recoveryKey: KEY,
      databaseUrl: "postgres://admin@localhost/fresh",
      mediaDir,
      stateDir,
      stagingDir,
      migrationsRoot: null as string | null,
      modules: withHooks({}),
      openDb,
      migrate: vi.fn(async () => {}),
      environment: "preproduction" as const,
      runRestore: runRestore as unknown as PgRestoreRunner,
      log: noopLog,
      ...overrides,
    };
  }

  it("validateArtifact throws on a wrong recovery key and writes NOTHING", async () => {
    // The commonest DR operator error. `validateArtifact` decrypts and must reject before any write —
    // so R3 can run it BEFORE the irreversible wipe. No db restore, no media written.
    await expect(validateArtifact(deps({ recoveryKey: "the-wrong-key" }))).rejects.toMatchObject({
      code: "recovery.passphrase_invalid",
    });
    expect(runRestore).not.toHaveBeenCalled();
    await expect(stat(join(mediaDir, "abc123.jpg"))).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("validateArtifact throws on an incompatible manifest (gate) and writes NOTHING", async () => {
    const artifact = buildArtifact(FULL_ENTRIES, { ...MANIFEST, environment: "production" });
    await expect(validateArtifact(deps({ artifact }))).rejects.toMatchObject({
      code: "restore.environment_mismatch",
    });
    expect(runRestore).not.toHaveBeenCalled();
    await expect(stat(join(mediaDir, "abc123.jpg"))).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("validateArtifact throws on a traversal entry (guard) and writes NOTHING", async () => {
    const evil: ArchiveEntry[] = [
      { name: "db.dump", bytes: DUMP },
      { name: "media/../../evil.jpg", bytes: MEDIA },
    ];
    await expect(validateArtifact(deps({ artifact: buildArtifact(evil) }))).rejects.toMatchObject({
      code: "restore.unsafe_entry_path",
    });
    expect(runRestore).not.toHaveBeenCalled();
    await expect(stat(join(mediaDir, "abc123.jpg"))).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("validateArtifact returns the classified pieces and writeValidated then writes them", async () => {
    // The two halves compose to exactly restoreFromArtifact's behaviour: validate returns the pieces,
    // write consumes them. writeValidated is the ONLY writer — the gate/guard live solely in validate,
    // so the security pass is single-sourced.
    let staged: Uint8Array | undefined;
    const capturing = vi.fn(async ({ inFile }: { inFile: string }) => {
      staged = await readFile(inFile);
    }) as unknown as PgRestoreRunner;

    const validated = await validateArtifact(deps());
    expect(validated.dumpEntry.bytes).toEqual(DUMP);
    expect(validated.mediaEntries.map((e) => e.name)).toEqual(["media/abc123.jpg"]);
    expect(validated.secretEntries.map((e) => e.name)).toEqual([
      "secrets/secrets.env",
      "secrets/trading.env",
    ]);

    await writeValidated(validated, deps({ runRestore: capturing }));
    expect(staged).toEqual(DUMP);
    expect(await readFile(join(mediaDir, "abc123.jpg"))).toEqual(MEDIA);
    expect(await readFile(join(stateDir, "secrets.env"), "utf8")).toBe(SECRET);
    await expect(stat(join(stagingDir, "db.dump"))).rejects.toMatchObject({ code: "ENOENT" });
  });
});

describe("restore steps (R3 composition)", () => {
  useTempDirs("waitron-step-");

  it("restoreDatabase stages the dump and feeds it to the runner", async () => {
    let seen: Uint8Array | undefined;
    const runRestore: PgRestoreRunner = async ({ inFile }) => {
      seen = await readFile(inFile);
    };
    const staged = await restoreDatabase({
      dumpBytes: DUMP,
      stagingDir,
      databaseUrl: "postgres://x",
      runRestore,
      log: noopLog,
    });
    expect(seen).toEqual(DUMP);
    expect(staged).toBe(join(stagingDir, "db.dump"));
  });

  it("restoreDatabase rejects a runner but leaves the staged file for the caller to clean", async () => {
    const runRestore: PgRestoreRunner = async () => {
      throw new Error("nope");
    };
    await expect(
      restoreDatabase({
        dumpBytes: DUMP,
        stagingDir,
        databaseUrl: "postgres://x",
        runRestore,
        log: noopLog,
      }),
    ).rejects.toThrow("nope");
  });

  it("restoreMedia strips the prefix and writes each blob; guards traversal", async () => {
    await restoreMedia({
      entries: [{ name: "media/deadbeef.png", bytes: MEDIA }],
      mediaDir,
      log: noopLog,
    });
    expect(await readFile(join(mediaDir, "deadbeef.png"))).toEqual(MEDIA);

    await expect(
      restoreMedia({
        entries: [{ name: "media/../escape.png", bytes: MEDIA }],
        mediaDir,
        log: noopLog,
      }),
    ).rejects.toMatchObject({ code: "restore.unsafe_entry_path" });
  });

  it("restoreMedia catches a symlinked-parent escape", async () => {
    // A pre-existing mediaDir/sub -> /outside symlink: a lexically-fine name still escapes.
    const outside = await mkdtemp(join(tmpdir(), "waitron-outside-"));
    await symlink(outside, join(mediaDir, "sub"));
    await expect(
      restoreMedia({
        entries: [{ name: "media/sub/x.png", bytes: MEDIA }],
        mediaDir,
        log: noopLog,
      }),
    ).rejects.toMatchObject({ code: "restore.unsafe_entry_path" });
    await rm(outside, { recursive: true, force: true });
  });

  it("restoreSecrets strips the prefix and writes via unpackBundleToDir", async () => {
    await restoreSecrets({
      entries: [
        { name: "secrets/secrets.env", bytes: Buffer.from(SECRET) },
        { name: "secrets/tls/ca.crt", bytes: Buffer.from("CERT") },
      ],
      stateDir,
      log: noopLog,
    });
    expect(await readFile(join(stateDir, "secrets.env"), "utf8")).toBe(SECRET);
    expect(await readFile(join(stateDir, "tls", "ca.crt"), "utf8")).toBe("CERT");
  });
});

describe("restore hooks (identity phase)", () => {
  useTempDirs("waitron-hooks-");
  beforeEach(resetSeries);

  function deps(overrides: Partial<RestoreDeps> = {}): RestoreDeps {
    return {
      artifact: buildArtifact(FULL_ENTRIES),
      recoveryKey: KEY,
      databaseUrl: "postgres://admin@localhost/fresh",
      mediaDir,
      stateDir,
      stagingDir,
      migrationsRoot: null,
      modules: withHooks({}),
      environment: "preproduction",
      runRestore: vi.fn(async () => {}),
      openDb,
      migrate: vi.fn(async () => {}),
      log: noopLog,
      ...overrides,
    };
  }

  it("migrates after pg_restore and BEFORE any hook; hooks run BEFORE secrets are written", async () => {
    const order: string[] = [];
    const migrate = vi.fn(async () => {
      order.push("migrate");
    });
    const hook: RestoreHook = async () => {
      order.push("hook");
      await expect(stat(join(stateDir, "secrets.env"))).rejects.toMatchObject({ code: "ENOENT" });
      return { report: "ok" };
    };
    await restoreFromArtifact(
      deps({
        migrate,
        modules: withHooks({ fiscal: hook }),
        runRestore: vi.fn(async () => {
          order.push("pg_restore");
        }),
      }),
    );
    expect(order).toEqual(["pg_restore", "migrate", "hook"]);
    expect(migrate).toHaveBeenCalledWith("postgres://admin@localhost/fresh", expect.any(Array));
    expect(await readFile(join(stateDir, "secrets.env"), "utf8")).toBe(SECRET);
  });

  it("skipSecrets:true runs NO hook and reads no identity — an artifact with no trading.env restores fine", async () => {
    const hook = vi.fn(async () => ({ report: "must not run" }));
    const noIdentity = FULL_ENTRIES.filter((e) => e.name !== "secrets/trading.env");
    await restoreFromArtifact(
      deps({
        skipSecrets: true,
        artifact: buildArtifact(noIdentity),
        modules: withHooks({ fiscal: hook }),
      }),
    );
    expect(hook).not.toHaveBeenCalled();
  });

  it("hands each hook (tx, node) with the ids from the ARTIFACT's trading.env, not the target's", async () => {
    await writeFile(
      join(stateDir, "trading.env"),
      formatEnvFile({
        WAITRON_TILL_TENANT_ID: "stale",
        WAITRON_TILL_NODE_ID: "stale",
        WAITRON_TILL_LOCATION_ID: "stale",
        WAITRON_TILL_SERIES_ID: "stale",
      }),
    );
    const hook = vi.fn(async () => ({ report: "ok" }));
    await restoreFromArtifact(deps({ modules: withHooks({ fiscal: hook }) }));
    expect(hook).toHaveBeenCalledWith(expect.anything(), {
      tenantId: T.tenantId,
      locationId: T.locationId,
      nodeId: T.nodeId,
    });
    expect(await readFile(join(stateDir, "trading.env"), "utf8")).toBe(TRADING_ENV); // the artifact's, restored over the stale one
  });

  it("a pre-existing VALID identity is set aside BEFORE pg_restore runs, so a failed hook leaves NO trading.env", async () => {
    // The target already holds a bootable identity (the artifact's own shape, with a different node).
    const existing = formatEnvFile({
      ...parseEnvFile(TRADING_ENV),
      WAITRON_TILL_NODE_ID: "c0000000-0000-4000-8000-0000000000aa",
    });
    await writeFile(join(stateDir, "trading.env"), existing);
    let goneWhenRestoreRan = false;
    const runRestore: PgRestoreRunner = vi.fn(async () => {
      goneWhenRestoreRan = await stat(join(stateDir, "trading.env")).then(
        () => false,
        () => true,
      );
    });
    const boom: RestoreHook = async () => {
      throw new AppError("restore.unexpected_entry", { name: "boom" });
    };
    await expect(
      restoreFromArtifact(deps({ runRestore, modules: withHooks({ fiscal: boom }) })),
    ).rejects.toMatchObject({
      code: "restore.hook_failed",
      params: { module: "fiscal", code: "restore.unexpected_entry" },
    });
    expect(goneWhenRestoreRan).toBe(true); // set aside before the first irreversible step
    await expect(stat(join(stateDir, "trading.env"))).rejects.toMatchObject({ code: "ENOENT" });
    expect(await readFile(join(stateDir, "trading.env.replaced"), "utf8")).toBe(existing);
  });

  it("a pre-existing identity is UNTOUCHED under skipSecrets (the rejoin shape keeps its own)", async () => {
    const own = formatEnvFile({ WAITRON_TILL_NODE_ID: "own" });
    await writeFile(join(stateDir, "trading.env"), own);
    await restoreFromArtifact(deps({ skipSecrets: true }));
    expect(await readFile(join(stateDir, "trading.env"), "utf8")).toBe(own);
    await expect(stat(join(stateDir, "trading.env.replaced"))).rejects.toMatchObject({
      code: "ENOENT",
    });
  });

  it("series returned → old retired + new opened in the SAME transaction, trading.env rewritten in exactly one key", async () => {
    const hook: RestoreHook = async () => ({
      report: "ok",
      series: [{ code: "FA-9", purpose: "standard" }],
    });
    await restoreFromArtifact(deps({ modules: withHooks({ fiscal: hook }) }));
    const rows = await suite.db.execute<{ code: string; retired: boolean; next: number }>(
      sql`select code, retired_at is not null as retired, next_number as next from invoice_series where node_id = ${T.nodeId} order by code`,
    );
    expect(rows.rows).toEqual([
      { code: "FA", retired: true, next: 1 },
      { code: "FA-9", retired: false, next: 1 },
    ]);
    const written = parseEnvFile(await readFile(join(stateDir, "trading.env"), "utf8"));
    const original = parseEnvFile(TRADING_ENV);
    expect(written.WAITRON_TILL_SERIES_ID).not.toBe(T.seriesId);
    expect({ ...written, WAITRON_TILL_SERIES_ID: original.WAITRON_TILL_SERIES_ID }).toEqual(
      original,
    );
    expect(Object.keys(written)).toEqual(Object.keys(original)); // order preserved
  });

  it("no series returned → the node must still hold one live standard series, and trading.env is byte-identical", async () => {
    await restoreFromArtifact(
      deps({ modules: withHooks({ fiscal: async () => ({ report: "ok" }) }) }),
    );
    expect(await readFile(join(stateDir, "trading.env"), "utf8")).toBe(TRADING_ENV);
    // The restored node has NO live standard series (retired in the backup) → refuse, no identity written.
    await suite.db.execute(
      sql`update invoice_series set retired_at = now() where id = ${T.seriesId}`,
    );
    await expect(restoreFromArtifact(deps({ modules: withHooks({}) }))).rejects.toMatchObject({
      code: "restore.hook_failed",
      params: { module: "core", code: "series.no_standard_for_node" },
    });
    await expect(stat(join(stateDir, "trading.env"))).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("no series returned but the artifact's series id is not the live standard one → env is corrected", async () => {
    await suite.db.execute(
      sql`insert into invoice_series (tenant_id, node_id, code) values (${T.tenantId}, ${T.nodeId}, 'FB')`,
    );
    await suite.db.execute(
      sql`update invoice_series set retired_at = now() where id = ${T.seriesId}`,
    );
    await restoreFromArtifact(deps({ modules: withHooks({}) }));
    const written = parseEnvFile(await readFile(join(stateDir, "trading.env"), "utf8"));
    const [fb] = (
      await suite.db.execute<{ id: string }>(sql`select id from invoice_series where code = 'FB'`)
    ).rows;
    expect(written.WAITRON_TILL_SERIES_ID).toBe(fb!.id);
  });

  it("no series returned and TWO live standard series in the restored db → refused (loud), no identity written", async () => {
    await suite.db.execute(
      sql`insert into invoice_series (tenant_id, node_id, code) values (${T.tenantId}, ${T.nodeId}, 'FB')`,
    );
    await expect(restoreFromArtifact(deps({ modules: withHooks({}) }))).rejects.toThrow(
      /more than one standard series/,
    );
    await expect(stat(join(stateDir, "trading.env"))).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("a failure AFTER the replacement series were inserted rolls the inserts and the retire back", async () => {
    // Two standard replacements insert fine; the settling read then finds two live standard series
    // and aborts — the inserts and the retire must both be gone.
    const hook: RestoreHook = async () => ({
      report: "ok",
      series: [
        { code: "FA-9", purpose: "standard" },
        { code: "FA-10", purpose: "standard" },
      ],
    });
    await expect(
      restoreFromArtifact(deps({ modules: withHooks({ fiscal: hook }) })),
    ).rejects.toThrow(/more than one standard series/);
    const rows = await suite.db.execute<{ code: string; retired: boolean }>(
      sql`select code, retired_at is not null as retired from invoice_series where node_id = ${T.nodeId} order by code`,
    );
    expect(rows.rows).toEqual([{ code: "FA", retired: false }]);
    await expect(stat(join(stateDir, "trading.env"))).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("a colliding replacement code fails AFTER the retire started and rolls everything back", async () => {
    // `FA` is the node's own live code; returning it collides with the retired row → the whole
    // transaction (the retire included) rolls back, and no identity is written.
    const hook: RestoreHook = async () => ({
      report: "ok",
      series: [{ code: "FA", purpose: "standard" }],
    });
    await expect(
      restoreFromArtifact(deps({ modules: withHooks({ fiscal: hook }) })),
    ).rejects.toMatchObject({
      code: "restore.hook_failed",
      params: { module: "fiscal", code: "series.code_collision" },
    });
    const rows = await suite.db.execute<{ code: string; retired: boolean }>(
      sql`select code, retired_at is not null as retired from invoice_series where node_id = ${T.nodeId}`,
    );
    expect(rows.rows).toEqual([{ code: "FA", retired: false }]);
    await expect(stat(join(stateDir, "trading.env"))).rejects.toMatchObject({ code: "ENOENT" });
    await expect(stat(join(stateDir, "secrets.env"))).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("two modules returning series → restore.series_conflict; an empty list → hook_failed wrapping no_standard_for_node", async () => {
    const a: RestoreHook = async () => ({
      report: "a",
      series: [{ code: "FA-1", purpose: "standard" }],
    });
    const b: RestoreHook = async () => ({
      report: "b",
      series: [{ code: "FA-2", purpose: "standard" }],
    });
    await expect(
      restoreFromArtifact(deps({ modules: withHooks({ core: a, fiscal: b }) })),
    ).rejects.toMatchObject({
      code: "restore.series_conflict",
      params: { modules: "core,fiscal" },
    });
    const empty: RestoreHook = async () => ({ report: "a", series: [] });
    await expect(
      restoreFromArtifact(deps({ modules: withHooks({ fiscal: empty }) })),
    ).rejects.toMatchObject({
      code: "restore.hook_failed",
      params: { module: "fiscal", code: "series.no_standard_for_node" },
    });
  });

  it.each(["key", "file"] as const)(
    "refuses a missing identity %s during validation, with the target intact",
    async (missing) => {
      const existing = formatEnvFile({
        ...parseEnvFile(TRADING_ENV),
        WAITRON_TILL_NODE_ID: "c0000000-0000-4000-8000-0000000000aa",
      });
      await writeFile(join(stateDir, "trading.env"), existing);
      const entries = FULL_ENTRIES.filter((e) => e.name !== "secrets/trading.env");
      if (missing === "key") {
        entries.push({
          name: "secrets/trading.env",
          bytes: Buffer.from(
            formatEnvFile({ ...parseEnvFile(TRADING_ENV), WAITRON_TILL_NODE_ID: "" }),
          ),
        });
      }
      const runRestore = vi.fn(async () => {});
      const migrate = vi.fn(async () => {});
      const restoreDeps = deps({ artifact: buildArtifact(entries), runRestore, migrate });
      const error = {
        code: "restore.identity_incomplete",
        params: { missing: missing === "key" ? "WAITRON_TILL_NODE_ID" : "trading.env" },
      };

      await expect(restoreFromArtifact(restoreDeps)).rejects.toMatchObject(error);
      expect.soft(runRestore).not.toHaveBeenCalled();
      expect.soft(migrate).not.toHaveBeenCalled();
      await expect(readFile(join(stateDir, "trading.env"), "utf8")).resolves.toBe(existing);
      await expect(stat(join(stateDir, "trading.env.replaced"))).rejects.toMatchObject({
        code: "ENOENT",
      });
      await expect(validateArtifact(restoreDeps)).rejects.toMatchObject(error);
    },
  );

  it("identity_incomplete on a missing key or file; identity_unknown on a node the restored db lacks", async () => {
    const base = FULL_ENTRIES.filter((e) => e.name !== "secrets/trading.env");
    const withEnv = (body: string) =>
      buildArtifact([...base, { name: "secrets/trading.env", bytes: Buffer.from(body) }]);
    await expect(
      restoreFromArtifact(
        deps({
          artifact: withEnv(
            formatEnvFile({ ...parseEnvFile(TRADING_ENV), WAITRON_TILL_NODE_ID: "" }),
          ),
        }),
      ),
    ).rejects.toMatchObject({
      code: "restore.identity_incomplete",
      params: { missing: "WAITRON_TILL_NODE_ID" },
    });
    await expect(
      restoreFromArtifact(deps({ artifact: buildArtifact(base) })),
    ).rejects.toMatchObject({
      code: "restore.identity_incomplete",
      params: { missing: "trading.env" },
    });
    await expect(
      restoreFromArtifact(
        deps({
          artifact: withEnv(
            formatEnvFile({
              ...parseEnvFile(TRADING_ENV),
              WAITRON_TILL_NODE_ID: "c0000000-0000-4000-8000-0000000000ff",
            }),
          ),
        }),
      ),
    ).rejects.toMatchObject({ code: "restore.identity_unknown" });
    await expect(stat(join(stateDir, "trading.env"))).rejects.toMatchObject({ code: "ENOENT" });
  });
});
