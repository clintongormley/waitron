import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rename,
  rm,
  rmdir,
  stat,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { eq, sql } from "drizzle-orm";
import {
  invoiceSeries,
  locations,
  nodes,
  openVenueDatabase,
  tenants,
  tills,
  withTransaction,
} from "@waitron/db";
import { nodeId as brandNodeId } from "@waitron/shared";
import { FISCAL_RESTORE, currentSif, registerSif } from "@waitron/fiscal-verifactu";
import { AppError, isAppError } from "@waitron/shared";
import { enabledModules, fiscalSlot } from "@waitron/module";
import type { RestoreHook, WaitronModule } from "@waitron/module";
import { formatEnvFile, parseEnvFile } from "./env-file.js";
import { readModuleConfig } from "./module-config.js";
import { REBUILD_MARKER } from "./rebuild-first-start.js";
import { ALL_MODULES } from "./modules.js";
import { type ArchiveEntry, packArchive } from "./backup-archive.js";
import { encryptArtifact } from "./artifact-cipher.js";
import type { BackupManifest } from "./backup-manifest.js";
import type { Logger } from "./logger.js";
import {
  type RestoreDeps,
  restoreDatabase,
  restoreFromArtifact,
  restoreSecrets,
  setAsideExistingIdentity,
  validateArtifact,
  writeValidated,
} from "./restore.js";

// One real SQLite venue directory for the hook phase: these tests exercise transaction rollback and
// the series settlement, and make no concurrency claim.
const suite = useVenueDb({
  resetPerTest: false,
  migrations: migrationOptionsFor(manifestSets(), null),
  timeoutMs: 120_000,
});

const T = {
  locationId: "c0000000-0000-4000-8000-000000000002",
  tillId: "c0000000-0000-4000-8000-000000000003",
  seriesId: "c0000000-0000-4000-8000-000000000004",
  nodeId: "c0000000-0000-4000-8000-000000000008",
};
const TRADING_ENV = formatEnvFile({
  WAITRON_TILL_TILL_ID: T.tillId,
  WAITRON_TILL_NODE_ID: T.nodeId,
  WAITRON_TILL_SERIES_ID: T.seriesId,
  WAITRON_TILL_LOCATION_ID: T.locationId,
  DATABASE_URL: "postgres://app@localhost/waitron",
  WAITRON_MIGRATIONS_DATABASE_URL: "postgres://owner@localhost/waitron",
  WAITRON_ENV: "preproduction",
});

beforeAll(async () => {
  // Through the table definitions, not raw SQL: every one of these tables defaults `id` and
  // `created_at` with a `$defaultFn`, which drizzle runs per insert and a hand-written INSERT does
  // not get (`packages/db/src/schema/columns.ts`).
  const db = suite.db;
  await db
    .insert(tenants)
    .values({ id: 1, country: "ES", taxId: "89890001K", legalName: "Waitron SL" });
  await db.insert(locations).values({
    id: T.locationId,
    name: "Local",
    invoiceLocales: ["es"],
    operationDescription: "Venta",
  });
  await db.insert(tills).values({ id: T.tillId, locationId: T.locationId, name: "Caja 1" });
  await db.insert(nodes).values({ id: T.nodeId, locationId: T.locationId, name: "Node 1" });
  await db.insert(invoiceSeries).values({ id: T.seriesId, nodeId: T.nodeId, code: "FA" });
});

/** Re-arm the node's series between tests: FA live, anything a hook opened removed. */
async function resetSeries(): Promise<void> {
  await suite.db.execute(
    sql`delete from invoice_series where node_id = ${T.nodeId} and id <> ${T.seriesId}`,
  );
  await suite.db
    .update(invoiceSeries)
    .set({ retiredAt: null })
    .where(eq(invoiceSeries.id, T.seriesId));
}

/** The node's series as the assertions below read them, oldest code first. */
async function seriesOfNode(): Promise<{ code: string; retired: boolean; next: number }[]> {
  const rows = await suite.db
    .select({
      code: invoiceSeries.code,
      retiredAt: invoiceSeries.retiredAt,
      next: invoiceSeries.nextNumber,
    })
    .from(invoiceSeries)
    .where(eq(invoiceSeries.nodeId, T.nodeId))
    .orderBy(invoiceSeries.code);
  // `retired_at is not null` in SQL would come back as 0/1 here; the mapping is in JavaScript so the
  // assertion reads the boolean the column means.
  return rows.map(({ code, retiredAt, next }) => ({ code, retired: retiredAt !== null, next }));
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

/**
 * Stands in for the archive's database entry in every case below that does not OPEN it.
 *
 * The orchestration cases inject `migrate` and `openDb`, so nothing here ever opens what
 * `restoreDatabase` placed — which is exactly what makes these bytes enough: the assertion is that
 * the archive's bytes reached `venue.db` unchanged, or that they never did. The cases that DO open
 * the restored file build a real database (see `a real SQLite venue file` and
 * `restore-fiscal-receipt.test.ts`).
 */
const VENUE_BYTES = Buffer.from("SQLite format 3\u0000 — placed, never opened by this suite");
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
  { name: "db.dump", bytes: VENUE_BYTES },
  { name: "secrets/secrets.env", bytes: Buffer.from(SECRET) },
  { name: "secrets/trading.env", bytes: Buffer.from(TRADING_ENV) },
];

// Each describe registers its own temp-directory lifecycle while sharing these path bindings.
let stateDir: string;
let stagingDir: string;
let venueDir: string;

/** The file `openVenueStore` opens, and the working name `restoreDatabase` writes through. */
const venueFile = (): string => join(venueDir, "venue.db");
const incomingFile = (): string => `${venueFile()}.incoming`;

/**
 * What every case that used to assert `runRestore` was not called asserts instead.
 *
 * The injected runner is gone (`restore.ts`), so "the database was not restored" is now a claim
 * about the venue directory rather than about a mock — which is what those cases always meant.
 */
async function expectVenueUntouched(): Promise<void> {
  await expect(stat(venueFile())).rejects.toMatchObject({ code: "ENOENT" });
}

/** The archive's database entry landed at `venue.db`, byte for byte, with no working file left. */
async function expectVenueRestored(bytes: Uint8Array = VENUE_BYTES): Promise<void> {
  expect(await readFile(venueFile())).toEqual(Buffer.from(bytes));
  await expect(stat(incomingFile())).rejects.toMatchObject({ code: "ENOENT" });
}

function makeRestoreDeps(overrides: Partial<RestoreDeps> = {}): RestoreDeps {
  return {
    artifact: buildArtifact(FULL_ENTRIES),
    recoveryKey: KEY,
    venueDir,
    stateDir,
    stagingDir,
    migrationsRoot: null,
    modules: withHooks({}),
    environment: "preproduction",
    openDb,
    migrate: vi.fn(async () => {}),
    log: noopLog,
    ...overrides,
  };
}

function useTempDirs(prefix: string): void {
  beforeEach(async () => {
    stateDir = await mkdtemp(join(tmpdir(), `${prefix}state-`));
    stagingDir = await mkdtemp(join(tmpdir(), `${prefix}staging-`));
    // Made by `mkdtemp` and then REMOVED, so each case starts with the venue directory absent —
    // the shape a cold-recovery box is in, and the one where a leftover `venue.db` could not be
    // mistaken for the one this restore placed.
    venueDir = await mkdtemp(join(tmpdir(), `${prefix}venue-`));
    await rm(venueDir, { recursive: true, force: true });
  });
  afterEach(async () => {
    for (const dir of [stateDir, stagingDir, venueDir]) {
      await rm(dir, { recursive: true, force: true });
    }
  });
}

describe("restoreFromArtifact", () => {
  useTempDirs("waitron-restore-");

  function deps(overrides: Partial<RestoreDeps> = {}): RestoreDeps {
    return makeRestoreDeps(overrides);
  }

  it("rejects filesystem image entries before restoring the database or secrets", async () => {
    const artifact = buildArtifact([...FULL_ENTRIES, { name: "media/abc123.jpg", bytes: MEDIA }]);
    await expect(restoreFromArtifact(deps({ artifact }))).rejects.toMatchObject({
      code: "restore.unexpected_entry",
      params: { name: "media/abc123.jpg" },
    });
    await expectVenueUntouched();
    await expect(stat(join(stateDir, "secrets.env"))).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("refuses to replace the venue database while another process holds the folder", async () => {
    await mkdir(venueDir, { recursive: true });
    await writeFile(join(stateDir, "trading.env"), TRADING_ENV);
    const script = `import { DatabaseSync } from "node:sqlite";
const db = new DatabaseSync(process.argv[1]);
db.exec("begin immediate");
process.stdout.write("held");
setInterval(() => db, 1000);`;
    const holder = spawn(
      process.execPath,
      ["--input-type=module", "-e", script, join(venueDir, "venue.lock")],
      { stdio: ["ignore", "pipe", "inherit"] },
    );
    try {
      await new Promise<void>((resolve, reject) => {
        holder.stdout.on("data", (c: Buffer) => c.toString().includes("held") && resolve());
        holder.on("exit", (code) => reject(new Error(`holder exited early (${code})`)));
      });
      await expect(restoreFromArtifact(deps())).rejects.toMatchObject({
        code: "provisioning.database_in_use",
      });
      // Refused before anything changed: no database placed, no identity set aside or written.
      await expectVenueUntouched();
      expect(await readFile(join(stateDir, "trading.env"), "utf8")).toBe(TRADING_ENV);
      await expect(stat(join(stateDir, "trading.env.replaced"))).rejects.toMatchObject({
        code: "ENOENT",
      });
      await expect(stat(join(stateDir, "secrets.env"))).rejects.toMatchObject({ code: "ENOENT" });
    } finally {
      holder.kill("SIGKILL");
    }
  }, 20_000);

  it("places the archive's database at venue.db and writes the secrets", async () => {
    await restoreFromArtifact(deps());

    // The archive's database entry reached `venue.db`, byte-for-byte, with nothing left over.
    await expectVenueRestored();
    // The venue directory holds the whole database and is created for the operator alone.
    expect((await stat(venueDir)).mode & 0o777).toBe(0o700);
    expect((await stat(venueFile())).mode & 0o777).toBe(0o600);

    // Secret landed in stateDir (prefix stripped).
    expect(await readFile(join(stateDir, "secrets.env"), "utf8")).toBe(SECRET);

    expect(await readFile(join(stateDir, "trading.env"), "utf8")).toBe(TRADING_ENV);
  });

  it("creates its own destination roots (staging/state/venue) when they do not yet exist", async () => {
    // Both protected roots must exist before their first path guard runs, and the venue directory
    // before the database is placed in it.
    const newStaging = join(stagingDir, "restore-staging");
    const newState = join(stateDir, "state-store");
    const newVenue = join(venueDir, "nested", "venue");
    await restoreFromArtifact(
      deps({ stagingDir: newStaging, stateDir: newState, venueDir: newVenue }),
    );

    expect(await readFile(join(newVenue, "venue.db"))).toEqual(VENUE_BYTES); // venue dir was created
    expect(await readFile(join(newState, "secrets.env"), "utf8")).toBe(SECRET); // state dir was created
    // stagingDir, stateDir (secrets) and the venue directory (the whole database) are created 0700 —
    // a group/world-readable dir would expose the 0600 files inside by traversal.
    expect((await stat(newStaging)).mode & 0o777).toBe(0o700);
    expect((await stat(newState)).mode & 0o777).toBe(0o700);
    expect((await stat(newVenue)).mode & 0o777).toBe(0o700);
  });

  it("skips secrets when skipSecrets is true (keeps own identity), still restores the database", async () => {
    await restoreFromArtifact(deps({ skipSecrets: true }));
    // The database is restored, while the node keeps its own secrets.
    await expectVenueRestored();
    // … but the secret was NOT written — the node keeps its own identity
    await expect(stat(join(stateDir, "secrets.env"))).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("leaves no working file behind when the database cannot be placed", async () => {
    // A venue directory that cannot be made: its parent is a FILE, so `mkdir` fails ENOTDIR before
    // a byte is written. The whole restore fails with it, and the state dir keeps no half-restore.
    const blocker = join(stagingDir, "not-a-directory");
    await writeFile(blocker, "");
    await expect(restoreFromArtifact(deps({ venueDir: join(blocker, "venue") }))).rejects.toThrow(
      /ENOTDIR|ENOENT/,
    );
    await expect(stat(join(stateDir, "secrets.env"))).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("refuses an incompatible manifest BEFORE any restore or write", async () => {
    const artifact = buildArtifact(FULL_ENTRIES, { ...MANIFEST, environment: "production" });
    await expect(restoreFromArtifact(deps({ artifact }))).rejects.toMatchObject({
      code: "restore.environment_mismatch",
    });
    await expectVenueUntouched();
    await expect(stat(join(stateDir, "secrets.env"))).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("refuses a schema-too-new manifest via the gate (versions read from code)", async () => {
    // core's real applied version in the archive is impossibly high, so the gate — fed the target's
    // own `expectedSchemaVersion(core.migrations, null)` computed from the module list — refuses.
    const artifact = buildArtifact(FULL_ENTRIES, { ...MANIFEST, modules: { core: 99999 } });
    await expect(restoreFromArtifact(deps({ artifact }))).rejects.toMatchObject({
      code: "restore.schema_too_new",
    });
    await expectVenueUntouched();
  });

  it("refuses a traversal entry name BEFORE any restore or write", async () => {
    const evil: ArchiveEntry[] = [
      { name: "db.dump", bytes: VENUE_BYTES },
      { name: "secrets/../../evil.env", bytes: Buffer.from(SECRET) },
    ];
    await expect(
      restoreFromArtifact(deps({ artifact: buildArtifact(evil) })),
    ).rejects.toMatchObject({ code: "restore.unsafe_entry_path" });
    await expectVenueUntouched();
  });

  it("throws archive_incomplete when manifest.json is absent", async () => {
    const artifact = buildArtifact(FULL_ENTRIES, "omit");
    await expect(restoreFromArtifact(deps({ artifact }))).rejects.toMatchObject({
      code: "restore.archive_incomplete",
      params: { missing: "manifest.json" },
    });
    await expectVenueUntouched();
  });

  it("throws archive_incomplete when db.dump is absent", async () => {
    const artifact = buildArtifact([{ name: "media/abc123.jpg", bytes: MEDIA }]);
    await expect(restoreFromArtifact(deps({ artifact }))).rejects.toMatchObject({
      code: "restore.archive_incomplete",
      params: { missing: "db.dump" },
    });
    await expectVenueUntouched();
  });

  it("rejects an unrecognised top-level entry (fail-visible) BEFORE any restore or write", async () => {
    // A future second non-DB source id would pack `<source>/...` blobs the orchestrator does not
    // route. Today it must fail LOUD rather than silently drop the entry (CLAUDE.md §5) — proven
    // here with a `documents/x` entry alongside a valid `db.dump`.
    const artifact = buildArtifact([
      { name: "db.dump", bytes: VENUE_BYTES },
      { name: "documents/x", bytes: Buffer.from("orphan") },
    ]);
    await expect(restoreFromArtifact(deps({ artifact }))).rejects.toMatchObject({
      code: "restore.unexpected_entry",
      params: { name: "documents/x" },
    });
    await expectVenueUntouched();
    await expect(stat(join(stateDir, "secrets.env"))).rejects.toMatchObject({ code: "ENOENT" });
  });

  // Plan Reconciliation N23: the archive's old-box check runs after validation and before anything
  // is placed.
  it("stops before anything is placed when the source check refuses", async () => {
    await writeFile(join(stateDir, "trading.env"), TRADING_ENV);
    const checkSourceLive = vi.fn(async () => {
      throw new AppError("restore.stream_source_live", {
        lastChangeAt: "2026-09-23T11:58:00.000Z",
      });
    });
    await expect(restoreFromArtifact(deps({ checkSourceLive }))).rejects.toMatchObject({
      code: "restore.stream_source_live",
    });
    expect(checkSourceLive).toHaveBeenCalledOnce();
    expect(checkSourceLive).toHaveBeenCalledWith(
      expect.objectContaining({ dumpEntry: expect.objectContaining({ name: "db.dump" }) }),
    );
    await expectVenueUntouched();
    await expect(stat(join(stateDir, REBUILD_MARKER))).rejects.toMatchObject({ code: "ENOENT" });
    expect(await readFile(join(stateDir, "trading.env"), "utf8")).toBe(TRADING_ENV);
    await expect(stat(join(stateDir, "secrets.env"))).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("does not run the source check for a restore that keeps the box's own identity", async () => {
    const checkSourceLive = vi.fn(async () => {});
    await restoreFromArtifact(deps({ skipSecrets: true, checkSourceLive }));
    expect(checkSourceLive).not.toHaveBeenCalled();
    await expectVenueRestored();
  });

  it("restores once the source check lets it through", async () => {
    const checkSourceLive = vi.fn(async () => {});
    await restoreFromArtifact(deps({ checkSourceLive }));
    expect(checkSourceLive).toHaveBeenCalledOnce();
    await expectVenueRestored();
  });
});

describe("the first-start marker (rebuild-first-start.ts)", () => {
  useTempDirs("waitron-marker-");

  const boom: RestoreHook = async () => {
    throw new AppError("restore.unexpected_entry", { name: "boom" });
  };
  const noMarker = () =>
    expect(stat(join(stateDir, REBUILD_MARKER))).rejects.toMatchObject({ code: "ENOENT" });

  it("leaves the marker, naming the archive as its source", async () => {
    await restoreFromArtifact(makeRestoreDeps());
    expect(JSON.parse(await readFile(join(stateDir, REBUILD_MARKER), "utf8"))).toEqual({
      version: 1,
      source: "archive",
    });
    expect((await stat(join(stateDir, REBUILD_MARKER))).mode & 0o777).toBe(0o600);
  });

  it("names the stream as the source when a stream restore passes it", async () => {
    await restoreFromArtifact(makeRestoreDeps({ rebuildSource: "stream" }));
    expect(JSON.parse(await readFile(join(stateDir, REBUILD_MARKER), "utf8"))).toEqual({
      version: 1,
      source: "stream",
    });
  });

  it("leaves no marker when it keeps the box's own identity (a rejoin)", async () => {
    await restoreFromArtifact(makeRestoreDeps({ skipSecrets: true }));
    await noMarker();
  });

  it("leaves no marker when the restore fails after it began writing", async () => {
    await expect(
      restoreFromArtifact(makeRestoreDeps({ modules: withHooks({ "fiscal-verifactu": boom }) })),
    ).rejects.toMatchObject({ code: "restore.hook_failed" });
    await noMarker();
  });

  it("leaves no marker when the venue folder is held by a running server", async () => {
    const lockVenue = async () => {
      throw new AppError("provisioning.database_in_use", { database: "venue.db" });
    };
    await expect(restoreFromArtifact(makeRestoreDeps({ lockVenue }))).rejects.toMatchObject({
      code: "provisioning.database_in_use",
    });
    await noMarker();
  });

  it("removes the marker before it releases the lock when a restore fails", async () => {
    const seen: boolean[] = [];
    const lockVenue = async () => ({
      release: () => {
        seen.push(existsSync(join(stateDir, REBUILD_MARKER)));
      },
    });
    await expect(
      restoreFromArtifact(
        makeRestoreDeps({ lockVenue, modules: withHooks({ "fiscal-verifactu": boom }) }),
      ),
    ).rejects.toMatchObject({ code: "restore.hook_failed" });
    expect(seen).toEqual([false]);
  });

  it("holds the marker while it places the restore", async () => {
    let seenDuringMigrate: boolean | undefined;
    const migrate = vi.fn(async () => {
      seenDuringMigrate = existsSync(join(stateDir, REBUILD_MARKER));
    });
    await restoreFromArtifact(makeRestoreDeps({ migrate }));
    expect(seenDuringMigrate).toBe(true);
  });

  it("leaves no marker when validation refuses the archive", async () => {
    const artifact = buildArtifact(FULL_ENTRIES, { ...MANIFEST, environment: "production" });
    await expect(restoreFromArtifact(makeRestoreDeps({ artifact }))).rejects.toMatchObject({
      code: "restore.environment_mismatch",
    });
    await noMarker();
  });

  // `validateArtifact` creates the state folder; the write does not create one it was not given.
  it("refuses before placing anything when handed a state folder validation never created", async () => {
    const validated = await validateArtifact(makeRestoreDeps());
    const migrate = vi.fn(async () => {});
    await expect(
      writeValidated(validated, makeRestoreDeps({ stateDir: join(stateDir, "absent"), migrate })),
    ).rejects.toMatchObject({ code: "ENOENT" });
    expect(existsSync(join(venueDir, "venue.db"))).toBe(false);
    expect(migrate).not.toHaveBeenCalled();
  });
});

describe("validateArtifact / writeValidated (R3 validate-before-wipe split)", () => {
  useTempDirs("waitron-validate-");

  function deps(overrides: Partial<RestoreDeps> = {}): RestoreDeps {
    return makeRestoreDeps(overrides);
  }

  it("validateArtifact throws on a wrong recovery key and writes NOTHING", async () => {
    // The commonest DR operator error. `validateArtifact` decrypts and must reject before any write —
    // so R3 can run it BEFORE the irreversible wipe. No database or secret writes.
    await expect(validateArtifact(deps({ recoveryKey: "the-wrong-key" }))).rejects.toMatchObject({
      code: "recovery.passphrase_invalid",
    });
    await expectVenueUntouched();
    await expect(stat(join(stateDir, "secrets.env"))).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("validateArtifact throws on an incompatible manifest (gate) and writes NOTHING", async () => {
    const artifact = buildArtifact(FULL_ENTRIES, { ...MANIFEST, environment: "production" });
    await expect(validateArtifact(deps({ artifact }))).rejects.toMatchObject({
      code: "restore.environment_mismatch",
    });
    await expectVenueUntouched();
    await expect(stat(join(stateDir, "secrets.env"))).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("validateArtifact throws on a traversal entry (guard) and writes NOTHING", async () => {
    const evil: ArchiveEntry[] = [
      { name: "db.dump", bytes: VENUE_BYTES },
      { name: "secrets/../../evil.env", bytes: Buffer.from(SECRET) },
    ];
    await expect(validateArtifact(deps({ artifact: buildArtifact(evil) }))).rejects.toMatchObject({
      code: "restore.unsafe_entry_path",
    });
    await expectVenueUntouched();
    await expect(stat(join(stateDir, "secrets.env"))).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("validateArtifact returns the classified pieces and writeValidated then writes them", async () => {
    // The two halves compose to exactly restoreFromArtifact's behaviour: validate returns the pieces,
    // write consumes them. writeValidated is the ONLY writer — the gate/guard live solely in validate,
    // so the security pass is single-sourced.
    const validated = await validateArtifact(deps());
    expect(validated.dumpEntry.bytes).toEqual(VENUE_BYTES);
    expect(validated.secretEntries.map((e) => e.name)).toEqual([
      "secrets/secrets.env",
      "secrets/trading.env",
    ]);

    await writeValidated(validated, deps());
    await expectVenueRestored();
    expect(await readFile(join(stateDir, "secrets.env"), "utf8")).toBe(SECRET);
  });
});

describe("restore steps (R3 composition)", () => {
  useTempDirs("waitron-step-");

  it("restoreDatabase writes the archive's bytes to venue.db and returns that path", async () => {
    const placed = await restoreDatabase({ dumpBytes: VENUE_BYTES, venueDir, log: noopLog });
    expect(placed).toBe(venueFile());
    expect(await readFile(placed)).toEqual(VENUE_BYTES);
    await expect(stat(incomingFile())).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("restoreDatabase leaves the EXISTING database alone when the incoming write cannot start", async () => {
    // The bytes are written to the working file BEFORE anything is removed, so a placement that
    // never gets going leaves the box where it was rather than with no database at all.
    await mkdir(venueDir, { recursive: true });
    await writeFile(venueFile(), "THE-DATABASE-THAT-WAS-ALREADY-THERE");
    await mkdir(incomingFile(), { recursive: true });
    await expect(
      restoreDatabase({ dumpBytes: VENUE_BYTES, venueDir, log: noopLog }),
    ).rejects.toMatchObject({ code: "ERR_FS_EISDIR" });
    expect(await readFile(venueFile(), "utf8")).toBe("THE-DATABASE-THAT-WAS-ALREADY-THERE");
  });

  it("restoreSecrets guards traversal before writing", async () => {
    await expect(
      restoreSecrets({
        entries: [{ name: "secrets/../escape.env", bytes: Buffer.from(SECRET) }],
        stateDir,
        log: noopLog,
      }),
    ).rejects.toMatchObject({ code: "recovery.bundle_invalid", params: { reason: "unsafe_path" } });
  });

  it("restoreSecrets catches a symlinked-parent escape", async () => {
    const outside = await mkdtemp(join(tmpdir(), "waitron-outside-"));
    try {
      await symlink(outside, join(stateDir, "sub"));
      await expect(
        restoreSecrets({
          entries: [{ name: "secrets/sub/x.env", bytes: Buffer.from(SECRET) }],
          stateDir,
          log: noopLog,
        }),
      ).rejects.toMatchObject({
        code: "recovery.bundle_invalid",
        params: { reason: "unsafe_path" },
      });
    } finally {
      await rm(outside, { recursive: true, force: true });
    }
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

/**
 * The two ways putting a venue file in place goes silently wrong, each against a REAL SQLite file.
 *
 * Neither is visible to a case whose writer was CLOSED rather than killed or left open: a clean
 * `close()` checkpoints the write-ahead file and deletes both sidecars, so the broken implementation
 * and the correct one behave identically. That is why these two cases exist and why they are built
 * the awkward way — a killed child process, and a connection deliberately left open. Leave the
 * side files where they are in `restoreDatabase` and both fail; the readings are in its comment.
 */
describe("restoreDatabase places a REAL venue file (the two silent failures)", () => {
  useTempDirs("waitron-place-");

  /** One self-contained SQLite database holding a marker row nothing else has. */
  async function archiveBytes(marker: string): Promise<Buffer> {
    const dir = await mkdtemp(join(tmpdir(), "waitron-archive-"));
    try {
      const path = join(dir, "archive.db");
      const db = new DatabaseSync(path);
      db.exec("create table marker (id integer primary key, v text)");
      db.exec(`insert into marker (v) values ('${marker}')`);
      // No write-ahead mode: the archive comes out as one file with no sidecar, which is what
      // `archiveTo`'s `VACUUM INTO` produces (`packages/store/src/archive.ts`).
      db.close();
      return await readFile(path);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }

  /** What the venue directory answers with, opened by the product's own opener. */
  async function markersIn(directory: string): Promise<string[]> {
    const store = await openVenueDatabase(directory);
    try {
      const rows = store.venue.all<{ v: string }>(sql`select v from marker order by id`);
      return rows.map((row) => row.v);
    } finally {
      await store.close();
    }
  }

  /**
   * A child commits a row in write-ahead mode and is SIGKILLed — a box losing power mid-service.
   * The committed row is then in `venue.db-wal` and NOT in `venue.db`, and both sidecars are left
   * behind. `-e` runs CommonJS, which is why this is `require` rather than an import.
   */
  async function killedWriter(path: string): Promise<void> {
    const script = `
      const { DatabaseSync } = require("node:sqlite");
      const db = new DatabaseSync(${JSON.stringify(path)});
      db.exec("pragma journal_mode = wal");
      db.exec("create table marker (id integer primary key, v text)");
      db.exec("insert into marker (v) values ('CRASHED-TAIL')");
      process.stdout.write("ready");
      setInterval(() => db, 1000);
    `;
    const child = spawn(process.execPath, ["-e", script], {
      stdio: ["ignore", "pipe", "inherit"],
    });
    let ready = false;
    await new Promise<void>((resolve, reject) => {
      child.stdout.on("data", (chunk: Buffer) => {
        if (chunk.toString("utf8").includes("ready")) {
          ready = true;
          resolve();
        }
      });
      child.once("error", reject);
      child.once("exit", () => {
        if (!ready) reject(new Error("the writer exited before it committed"));
      });
    });
    child.kill("SIGKILL");
    await new Promise<void>((resolve) => child.once("exit", () => resolve()));
  }

  it("removes the STALE SIDECARS a killed writer left, so its tail is not replayed over the archive", async () => {
    await mkdir(venueDir, { recursive: true });
    await killedWriter(venueFile());
    // The crashed writer's row is in the write-ahead file. Replacing `venue.db` alone leaves that
    // file to be recovered on the next open, and the archive's rows are simply absent — with no
    // error raised in either direction.
    expect((await stat(`${venueFile()}-wal`)).size).toBeGreaterThan(0);

    await restoreDatabase({
      dumpBytes: await archiveBytes("FROM-ARCHIVE"),
      venueDir,
      log: noopLog,
    });

    expect(await markersIn(venueDir)).toEqual(["FROM-ARCHIVE"]);
  });

  it("removes Litestream's own folder beside the replaced database, so a stale record cannot describe it", async () => {
    const ltx = join(venueDir, ".venue.db-litestream", "ltx", "0");
    await mkdir(ltx, { recursive: true });
    await writeFile(join(ltx, "0000000000000005-0000000000000005.ltx"), "from the old database");
    await restoreDatabase({
      dumpBytes: await archiveBytes("FROM-ARCHIVE"),
      venueDir,
      log: noopLog,
    });
    await expect(stat(join(venueDir, ".venue.db-litestream"))).rejects.toMatchObject({
      code: "ENOENT",
    });
    expect(await markersIn(venueDir)).toEqual(["FROM-ARCHIVE"]);
  });

  it("moves the side files with the venue file, so an open connection cannot undo the restore", async () => {
    const live = await openVenueDatabase(venueDir);
    live.venue.run(sql`create table marker (id integer primary key, v text)`);
    live.venue.run(sql`insert into marker (v) values ('LIVE')`);

    await restoreDatabase({
      dumpBytes: await archiveBytes("FROM-ARCHIVE"),
      venueDir,
      log: noopLog,
    });

    // The stale handle is on an orphaned inode now and can still write: `restoreDatabase` takes no
    // lock, and the hold `writeValidated` takes is shared with opens in the same process. Neither
    // its write nor the checkpoint its close performs may reach the file the next boot opens.
    live.venue.run(sql`insert into marker (v) values ('WRITTEN-AFTER-RESTORE')`);
    await live.close();

    expect(await markersIn(venueDir)).toEqual(["FROM-ARCHIVE"]);
  });
});

describe("restore hooks (identity phase)", () => {
  useTempDirs("waitron-hooks-");
  beforeEach(resetSeries);

  it("restores FA standard and FA-1 rectificative through the real fiscal hook", async () => {
    await withTransaction(suite.db, async (tx) => {
      const sif = await registerSif(tx, {
        ...T,
        nodeId: brandNodeId(T.nodeId),
        nif: "89890001K",
        idSistemaInformatico: "WT",
      });
      expect(sif.numeroInstalacion).toBe(1);
      await tx
        .insert(invoiceSeries)
        .values({ nodeId: T.nodeId, code: "FA-1", purpose: "rectificative" });
    });
    await restoreFromArtifact(
      makeRestoreDeps({ modules: withHooks({ "fiscal-verifactu": FISCAL_RESTORE }) }),
    );
    const sif = await withTransaction(suite.db, (tx) => currentSif(tx, brandNodeId(T.nodeId)));
    const { rows } = await suite.db.execute<{ id: string; code: string; purpose: string }>(sql`
      select id, code, purpose from invoice_series where node_id = ${T.nodeId} and retired_at is null order by purpose desc
    `);
    expect(rows.map(({ code, purpose }) => ({ code, purpose }))).toEqual([
      { code: `FA-${sif.numeroInstalacion}`, purpose: "standard" },
      { code: `FA-1-${sif.numeroInstalacion}`, purpose: "rectificative" },
    ]);
    expect(
      parseEnvFile(await readFile(join(stateDir, "trading.env"), "utf8")).WAITRON_TILL_SERIES_ID,
    ).toBe(rows[0]!.id);
  });

  it("canonicalizes a sole identity alias before rewriting and publishing it", async () => {
    const entries = FULL_ENTRIES.map((entry) =>
      entry.name === "secrets/trading.env" ? { ...entry, name: "secrets/./trading.env" } : entry,
    );
    const deps = makeRestoreDeps({
      artifact: buildArtifact(entries),
      modules: withHooks({
        "fiscal-verifactu": async () => ({
          report: "ok",
          series: [{ code: "FA-9", purpose: "standard" }],
        }),
      }),
    });
    const validated = await validateArtifact(deps);
    expect(validated.secretEntries.map((entry) => entry.name)).toEqual([
      "secrets/secrets.env",
      "secrets/trading.env",
    ]);
    await writeValidated(validated, deps);
    const written = parseEnvFile(await readFile(join(stateDir, "trading.env"), "utf8"));
    const { rows } = await suite.db.execute<{ id: string }>(
      sql`select id from invoice_series where node_id = ${T.nodeId} and code = 'FA-9'`,
    );
    expect(written.WAITRON_TILL_SERIES_ID).toBe(rows[0]!.id);
  });

  it("rejects duplicate identity destinations during validation before set-aside", async () => {
    await writeFile(join(stateDir, "trading.env"), TRADING_ENV);
    const migrate = vi.fn(async () => {});
    const deps = makeRestoreDeps({
      artifact: buildArtifact([
        ...FULL_ENTRIES,
        { name: "secrets/./trading.env", bytes: Buffer.from(TRADING_ENV) },
      ]),
      migrate,
    });
    const error = { code: "restore.unsafe_entry_path" };
    await expect(validateArtifact(deps)).rejects.toMatchObject(error);
    await expect(restoreFromArtifact(deps)).rejects.toMatchObject(error);
    await expectVenueUntouched();
    expect(migrate).not.toHaveBeenCalled();
    expect(await readFile(join(stateDir, "trading.env"), "utf8")).toBe(TRADING_ENV);
    await expect(stat(join(stateDir, "trading.env.replaced"))).rejects.toMatchObject({
      code: "ENOENT",
    });
  });

  it("leaves no trading.env when a later TLS secret write fails with EISDIR", async () => {
    await mkdir(join(stateDir, "tls/server.key"), { recursive: true });
    await expect(
      restoreFromArtifact(
        makeRestoreDeps({
          artifact: buildArtifact([
            ...FULL_ENTRIES,
            { name: "secrets/tls/server.key", bytes: Buffer.from("KEY") },
          ]),
        }),
      ),
    ).rejects.toMatchObject({ code: "EISDIR" });
    await expect(stat(join(stateDir, "trading.env"))).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("migrates AFTER the venue file is in place and BEFORE any hook; hooks run BEFORE secrets are written", async () => {
    // The database restore has no callback to record any more, so its position in the order is read
    // off the filesystem instead: `migrate` asserts that `venue.db` already holds the archive's
    // bytes at the moment it runs, which is a stronger claim than the call order it replaces.
    const order: string[] = [];
    const migrate = vi.fn(async () => {
      expect(await readFile(venueFile())).toEqual(VENUE_BYTES);
      order.push("migrate");
    });
    const hook: RestoreHook = async () => {
      order.push("hook");
      await expect(stat(join(stateDir, "secrets.env"))).rejects.toMatchObject({ code: "ENOENT" });
      return { report: "ok" };
    };
    await restoreFromArtifact(
      makeRestoreDeps({ migrate, modules: withHooks({ "fiscal-verifactu": hook }) }),
    );
    expect(order).toEqual(["migrate", "hook"]);
    // The venue DIRECTORY, not a connection string: `applyMigrations` opens the two files itself.
    expect(migrate).toHaveBeenCalledWith(venueDir, expect.any(Array));
    expect(await readFile(join(stateDir, "secrets.env"), "utf8")).toBe(SECRET);
  });

  it("skipSecrets:true runs NO hook and reads no identity — an artifact with no trading.env restores fine", async () => {
    const hook = vi.fn(async () => ({ report: "must not run" }));
    const noIdentity = FULL_ENTRIES.filter((e) => e.name !== "secrets/trading.env");
    await restoreFromArtifact(
      makeRestoreDeps({
        skipSecrets: true,
        artifact: buildArtifact(noIdentity),
        modules: withHooks({ "fiscal-verifactu": hook }),
      }),
    );
    expect(hook).not.toHaveBeenCalled();
  });

  it("hands each hook (tx, node) with the ids from the ARTIFACT's trading.env, not the target's", async () => {
    await writeFile(
      join(stateDir, "trading.env"),
      formatEnvFile({
        WAITRON_TILL_NODE_ID: "stale",
        WAITRON_TILL_LOCATION_ID: "stale",
        WAITRON_TILL_SERIES_ID: "stale",
      }),
    );
    const hook = vi.fn(async () => ({ report: "ok" }));
    await restoreFromArtifact(
      makeRestoreDeps({ modules: withHooks({ "fiscal-verifactu": hook }) }),
    );
    expect(hook).toHaveBeenCalledWith(expect.anything(), {
      locationId: T.locationId,
      nodeId: T.nodeId,
    });
    expect(await readFile(join(stateDir, "trading.env"), "utf8")).toBe(TRADING_ENV); // the artifact's, restored over the stale one
  });

  it("a pre-existing VALID identity is set aside BEFORE the venue file is replaced", async () => {
    // Proven by stopping the restore AT the placement: the venue directory cannot be made (its
    // parent is a file), so nothing after `restoreDatabase` runs at all. The identity being gone by
    // then is what "set aside before the first irreversible step" means.
    const existing = formatEnvFile({
      ...parseEnvFile(TRADING_ENV),
      WAITRON_TILL_NODE_ID: "c0000000-0000-4000-8000-0000000000aa",
    });
    await writeFile(join(stateDir, "trading.env"), existing);
    const blocker = join(stagingDir, "not-a-directory");
    await writeFile(blocker, "");
    const migrate = vi.fn(async () => {});
    // No lock: the real one would be refused creating the same folder, before the set-aside.
    const lockVenue = async () => ({ release: () => {} });
    await expect(
      restoreFromArtifact(
        makeRestoreDeps({ venueDir: join(blocker, "venue"), migrate, lockVenue }),
      ),
    ).rejects.toThrow(/ENOTDIR|ENOENT/);
    expect(migrate).not.toHaveBeenCalled();
    await expect(stat(join(stateDir, "trading.env"))).rejects.toMatchObject({ code: "ENOENT" });
    expect(await readFile(join(stateDir, "trading.env.replaced"), "utf8")).toBe(existing);
  });

  it("a failed hook leaves NO trading.env, neither the target's nor the artifact's", async () => {
    const existing = formatEnvFile({
      ...parseEnvFile(TRADING_ENV),
      WAITRON_TILL_NODE_ID: "c0000000-0000-4000-8000-0000000000aa",
    });
    await writeFile(join(stateDir, "trading.env"), existing);
    const boom: RestoreHook = async () => {
      throw new AppError("restore.unexpected_entry", { name: "boom" });
    };
    await expect(
      restoreFromArtifact(makeRestoreDeps({ modules: withHooks({ "fiscal-verifactu": boom }) })),
    ).rejects.toMatchObject({
      code: "restore.hook_failed",
      params: { module: "fiscal-verifactu", code: "restore.unexpected_entry" },
    });
    await expectVenueRestored();
    await expect(stat(join(stateDir, "trading.env"))).rejects.toMatchObject({ code: "ENOENT" });
    expect(await readFile(join(stateDir, "trading.env.replaced"), "utf8")).toBe(existing);
  });

  it("a pre-existing identity is UNTOUCHED under skipSecrets (the rejoin shape keeps its own)", async () => {
    const own = formatEnvFile({ WAITRON_TILL_NODE_ID: "own" });
    await writeFile(join(stateDir, "trading.env"), own);
    await restoreFromArtifact(makeRestoreDeps({ skipSecrets: true }));
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
    await restoreFromArtifact(
      makeRestoreDeps({ modules: withHooks({ "fiscal-verifactu": hook }) }),
    );
    expect(await seriesOfNode()).toEqual([
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
      makeRestoreDeps({
        modules: withHooks({ "fiscal-verifactu": async () => ({ report: "ok" }) }),
      }),
    );
    expect(await readFile(join(stateDir, "trading.env"), "utf8")).toBe(TRADING_ENV);
    // The restored node has NO live standard series (retired in the backup) → refuse, no identity written.
    await suite.db
      .update(invoiceSeries)
      .set({ retiredAt: new Date() })
      .where(eq(invoiceSeries.id, T.seriesId));
    await expect(
      restoreFromArtifact(makeRestoreDeps({ modules: withHooks({}) })),
    ).rejects.toMatchObject({
      code: "restore.hook_failed",
      params: { module: "core", code: "series.no_standard_for_node" },
    });
    await expect(stat(join(stateDir, "trading.env"))).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("no series returned but the artifact's series id is not the live standard one → env is corrected", async () => {
    await suite.db.insert(invoiceSeries).values({ nodeId: T.nodeId, code: "FB" });
    await suite.db
      .update(invoiceSeries)
      .set({ retiredAt: new Date() })
      .where(eq(invoiceSeries.id, T.seriesId));
    await restoreFromArtifact(makeRestoreDeps({ modules: withHooks({}) }));
    const written = parseEnvFile(await readFile(join(stateDir, "trading.env"), "utf8"));
    const [fb] = await suite.db
      .select({ id: invoiceSeries.id })
      .from(invoiceSeries)
      .where(eq(invoiceSeries.code, "FB"));
    expect(written.WAITRON_TILL_SERIES_ID).toBe(fb!.id);
  });

  it("no series returned and TWO live standard series in the restored db → refused (loud), no identity written", async () => {
    await suite.db.insert(invoiceSeries).values({ nodeId: T.nodeId, code: "FB" });
    await expect(restoreFromArtifact(makeRestoreDeps({ modules: withHooks({}) }))).rejects.toThrow(
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
      restoreFromArtifact(makeRestoreDeps({ modules: withHooks({ "fiscal-verifactu": hook }) })),
    ).rejects.toThrow(/more than one standard series/);
    expect(await seriesOfNode()).toEqual([{ code: "FA", retired: false, next: 1 }]);
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
      restoreFromArtifact(makeRestoreDeps({ modules: withHooks({ "fiscal-verifactu": hook }) })),
    ).rejects.toMatchObject({
      code: "restore.hook_failed",
      params: { module: "fiscal-verifactu", code: "series.code_collision" },
    });
    expect(await seriesOfNode()).toEqual([{ code: "FA", retired: false, next: 1 }]);
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
      restoreFromArtifact(
        makeRestoreDeps({ modules: withHooks({ core: a, "fiscal-verifactu": b }) }),
      ),
    ).rejects.toMatchObject({
      code: "restore.series_conflict",
      params: { modules: "core,fiscal-verifactu" },
    });
    const empty: RestoreHook = async () => ({ report: "a", series: [] });
    await expect(
      restoreFromArtifact(makeRestoreDeps({ modules: withHooks({ "fiscal-verifactu": empty }) })),
    ).rejects.toMatchObject({
      code: "restore.hook_failed",
      params: { module: "fiscal-verifactu", code: "series.no_standard_for_node" },
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
      const migrate = vi.fn(async () => {});
      const restoreDeps = makeRestoreDeps({
        artifact: buildArtifact(entries),
        migrate,
      });
      const error = {
        code: "restore.identity_incomplete",
        params: { missing: missing === "key" ? "WAITRON_TILL_NODE_ID" : "trading.env" },
      };

      await expect(restoreFromArtifact(restoreDeps)).rejects.toMatchObject(error);
      await expectVenueUntouched();
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
        makeRestoreDeps({
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
      restoreFromArtifact(makeRestoreDeps({ artifact: buildArtifact(base) })),
    ).rejects.toMatchObject({
      code: "restore.identity_incomplete",
      params: { missing: "trading.env" },
    });
    await expect(
      restoreFromArtifact(
        makeRestoreDeps({
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

// Task 5: the sweep captures `backup.env` + `modules.json` as `secrets/<name>` entries; the restore
// needs NO change (it writes back every `secrets/*` entry via `restoreSecrets`/`unpackBundleToDir`).
// These pin that round-trip and the two exceptions that matter: `skipSecrets` (rejoin) restores
// neither, and a restore that MISSES `modules.json` makes the box REFUSE TO BOOT rather than silently
// flip regime. The two files are disk-only config, so this suite never opens what the restore
// placed — `migrate` and `openDb` are both injected.
describe("optional state (backup.env + modules.json) round-trip", () => {
  useTempDirs("waitron-optstate-");
  beforeEach(resetSeries); // the round-trips run the identity phase; re-arm the node's one live series

  const BACKUP_ENV = "WAITRON_BACKUP_DIR=/mnt/usb\nWAITRON_BACKUP_RETAIN=7\n";
  // A modules.json that disables the second fiscal-slot member, so exactly one regime is enabled.
  const MODULES_JSON = `${JSON.stringify({ modules: { "fiscal-none": false } }, null, 2)}\n`;
  const OPTIONAL_ENTRIES: ArchiveEntry[] = [
    { name: "secrets/backup.env", bytes: Buffer.from(BACKUP_ENV) },
    { name: "secrets/modules.json", bytes: Buffer.from(MODULES_JSON) },
  ];

  it("restores both onto a FRESH state dir, leaving the box's OWN recovery.json untouched", async () => {
    // `recovery.json` is this box's own escalation counter (`recovery-state.ts:48,:69`), written by
    // the entrypoint and deliberately NEVER captured — the restored box keeps its own. Write a
    // distinct one into the fresh target and prove the restore does not overwrite it.
    await writeFile(join(stateDir, "recovery.json"), '{"failures":2}\n');
    await restoreFromArtifact(
      makeRestoreDeps({ artifact: buildArtifact([...FULL_ENTRIES, ...OPTIONAL_ENTRIES]) }),
    );
    expect(await readFile(join(stateDir, "backup.env"), "utf8")).toBe(BACKUP_ENV);
    expect(await readFile(join(stateDir, "modules.json"), "utf8")).toBe(MODULES_JSON);
    // Per-box safety: recovery.json is not in the archive, so it is left exactly as it was.
    expect(await readFile(join(stateDir, "recovery.json"), "utf8")).toBe('{"failures":2}\n');
  });

  it("omits the old backup destination from a managed Cloud restore", async () => {
    await restoreFromArtifact(
      makeRestoreDeps({
        managedCloud: {
          requestId: "1ea4560a-77ac-4c4b-8abc-06d09fe8c60e",
          pointId: "252998c0-69eb-4bbc-a0f9-a8ba6451db42",
        },
        artifact: buildArtifact([...FULL_ENTRIES, ...OPTIONAL_ENTRIES]),
      }),
    );
    await expect(stat(join(stateDir, "backup.env"))).rejects.toMatchObject({ code: "ENOENT" });
    expect(await readFile(join(stateDir, "modules.json"), "utf8")).toBe(MODULES_JSON);
  });

  it("skipSecrets (rejoin) restores NEITHER file — a rejoining mirror keeps its own config", async () => {
    await restoreFromArtifact(
      makeRestoreDeps({
        skipSecrets: true,
        artifact: buildArtifact([...FULL_ENTRIES, ...OPTIONAL_ENTRIES]),
      }),
    );
    await expect(stat(join(stateDir, "backup.env"))).rejects.toMatchObject({ code: "ENOENT" });
    await expect(stat(join(stateDir, "modules.json"))).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("a restore that MISSES modules.json makes the box REFUSE TO BOOT (fiscal slot ambiguous), not a silent regime flip", async () => {
    // The enabled set is on-disk config, not a DB row. A restore WITHOUT modules.json leaves the box at
    // the all-enabled default, where BOTH fiscal-slot members (fiscal-verifactu + fiscal-none) are on —
    // and boot's fiscalSlot refuses that LOUD rather than silently picking a regime. That is exactly
    // what makes modules.json worth capturing. Asserted through the real boot path:
    // readModuleConfig → enabledModules → fiscalSlot.
    await restoreFromArtifact(makeRestoreDeps({ artifact: buildArtifact([...FULL_ENTRIES]) }));
    await expect(stat(join(stateDir, "modules.json"))).rejects.toMatchObject({ code: "ENOENT" });
    const missing = await readModuleConfig(stateDir);
    let ambiguous: unknown;
    try {
      fiscalSlot(enabledModules(ALL_MODULES, missing), null);
    } catch (err) {
      ambiguous = err;
    }
    expect(isAppError(ambiguous) && ambiguous.code).toBe("module.fiscal_slot_ambiguous");

    // Contrast: the SAME restore WITH modules.json (disabling fiscal-none) resolves the slot to the one
    // enabled regime, so boot proceeds.
    await restoreFromArtifact(
      makeRestoreDeps({ artifact: buildArtifact([...FULL_ENTRIES, ...OPTIONAL_ENTRIES]) }),
    );
    const present = await readModuleConfig(stateDir);
    expect(fiscalSlot(enabledModules(ALL_MODULES, present), null).id).toBe("verifactu");
  });
});

describe("restore steps — failures part-way", () => {
  useTempDirs("waitron-step-fail-");

  it("restoreDatabase removes its working file and rethrows when the old database cannot be removed", async () => {
    // A venue path that is a non-empty DIRECTORY cannot be removed by a plain file removal.
    await mkdir(join(venueFile(), "held"), { recursive: true });
    const logged: string[] = [];

    await expect(
      restoreDatabase({
        dumpBytes: VENUE_BYTES,
        venueDir,
        log: (_level, event) => logged.push(event),
      }),
    ).rejects.toMatchObject({ code: "ERR_FS_EISDIR" });

    await expect(stat(incomingFile())).rejects.toMatchObject({ code: "ENOENT" });
    expect((await stat(join(venueFile(), "held"))).isDirectory()).toBe(true);
    expect(logged).toEqual([]);
  });

  it("restoreDatabase keeps the OLD database when Litestream's folder cannot be removed", async () => {
    await mkdir(venueDir, { recursive: true });
    await writeFile(venueFile(), "THE-DATABASE-THAT-WAS-ALREADY-THERE");
    // A folder its owner cannot write: the recursive removal cannot unlink the file inside it.
    const locked = join(venueDir, ".venue.db-litestream", "ltx", "0");
    await mkdir(locked, { recursive: true });
    await writeFile(join(locked, "0000000000000005-0000000000000005.ltx"), "old");
    await chmod(locked, 0o500);
    try {
      await expect(
        restoreDatabase({ dumpBytes: VENUE_BYTES, venueDir, log: noopLog }),
      ).rejects.toMatchObject({ code: "EACCES" });
    } finally {
      await chmod(locked, 0o700);
    }
    expect(await readFile(venueFile(), "utf8")).toBe("THE-DATABASE-THAT-WAS-ALREADY-THERE");
    await expect(stat(incomingFile())).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("setAsideExistingIdentity rethrows a failure other than a missing identity, leaving the identity in place", async () => {
    await writeFile(join(stateDir, "trading.env"), TRADING_ENV);
    // A non-empty directory where the set-aside copy goes: the rename cannot replace it.
    await mkdir(join(stateDir, "trading.env.replaced", "held"), { recursive: true });
    const logged: string[] = [];

    await expect(
      setAsideExistingIdentity(stateDir, (_level, event) => logged.push(event)),
    ).rejects.toMatchObject({ code: "EISDIR" });

    expect(await readFile(join(stateDir, "trading.env"), "utf8")).toBe(TRADING_ENV);
    expect(logged).toEqual([]);
  });
});

/**
 * Whatever step of the placement fails, the venue folder ends with the OLD database or the NEW one,
 * never neither. The failures a real filesystem cannot be made to produce on demand are injected
 * through `restoreDatabase`'s `fs` argument.
 */
describe("restoreDatabase keeps one whole database whatever step fails", () => {
  useTempDirs("waitron-place-fail-");

  const OLD = { "": "OLD-MAIN", "-wal": "OLD-WAL", "-shm": "OLD-SHM" } as const;

  async function seedOldSet(): Promise<void> {
    await mkdir(venueDir, { recursive: true });
    for (const [suffix, bytes] of Object.entries(OLD)) {
      await writeFile(`${venueFile()}${suffix}`, bytes);
    }
  }

  async function asideFolders(): Promise<string[]> {
    return (await readdir(venueDir)).filter((name) => name.startsWith(".venue.db-replaced-"));
  }

  function injected(code: string): NodeJS.ErrnoException {
    return Object.assign(new Error(`injected ${code}`), { code });
  }

  /** The real calls, with `rename` refused for the moves `refuse` picks. */
  function renameRefusing(refuse: (from: string, to: string) => boolean) {
    return {
      rm,
      rmdir,
      rename: async (from: string, to: string) => {
        if (refuse(from, to)) throw injected("EIO");
        await rename(from, to);
      },
    };
  }

  it("puts the old database back when a side file is a directory, and says so with a code", async () => {
    await seedOldSet();
    await rm(`${venueFile()}-wal`);
    await mkdir(`${venueFile()}-wal`);

    await expect(
      restoreDatabase({ dumpBytes: VENUE_BYTES, venueDir, log: noopLog }),
    ).rejects.toMatchObject({ code: "restore.placement_failed", params: { kept: "previous" } });

    expect(await readFile(venueFile(), "utf8")).toBe(OLD[""]);
    expect(await readFile(`${venueFile()}-shm`, "utf8")).toBe(OLD["-shm"]);
    expect((await stat(`${venueFile()}-wal`)).isDirectory()).toBe(true);
    await expect(stat(incomingFile())).rejects.toMatchObject({ code: "ENOENT" });
    expect(await asideFolders()).toEqual([]);
  });

  it("puts the whole old set back when the incoming copy cannot be renamed into place", async () => {
    await seedOldSet();

    await expect(
      restoreDatabase({
        dumpBytes: VENUE_BYTES,
        venueDir,
        log: noopLog,
        fs: renameRefusing((from) => from === incomingFile()),
      }),
    ).rejects.toMatchObject({ code: "restore.placement_failed", params: { kept: "previous" } });

    for (const [suffix, bytes] of Object.entries(OLD)) {
      expect(await readFile(`${venueFile()}${suffix}`, "utf8")).toBe(bytes);
    }
    await expect(stat(incomingFile())).rejects.toMatchObject({ code: "ENOENT" });
    expect(await asideFolders()).toEqual([]);
  });

  it("still reports the old set kept when its emptied aside folder cannot be removed", async () => {
    await seedOldSet();

    await expect(
      restoreDatabase({
        dumpBytes: VENUE_BYTES,
        venueDir,
        log: noopLog,
        fs: {
          ...renameRefusing((from) => from === incomingFile()),
          rmdir: async () => {
            throw injected("EBUSY");
          },
        },
      }),
    ).rejects.toMatchObject({ code: "restore.placement_failed", params: { kept: "previous" } });

    for (const [suffix, bytes] of Object.entries(OLD)) {
      expect(await readFile(`${venueFile()}${suffix}`, "utf8")).toBe(bytes);
    }
  });

  it("names the aside folder holding the old database when putting it back fails", async () => {
    await seedOldSet();
    const failure = restoreDatabase({
      dumpBytes: VENUE_BYTES,
      venueDir,
      log: noopLog,
      fs: renameRefusing((from, to) => from === incomingFile() || to === `${venueFile()}-wal`),
    });
    await expect(failure).rejects.toMatchObject({
      code: "restore.placement_failed",
      params: { kept: "set_aside" },
    });

    const [folder] = await asideFolders();
    await expect(failure).rejects.toMatchObject({ params: { folder } });
    const aside = join(venueDir, folder!);
    // The main file stays with the side file that could not go back, never back without it.
    expect(await readFile(join(aside, "venue.db"), "utf8")).toBe(OLD[""]);
    expect(await readFile(join(aside, "venue.db-wal"), "utf8")).toBe(OLD["-wal"]);
    await expect(stat(venueFile())).rejects.toMatchObject({ code: "ENOENT" });
    await expect(stat(incomingFile())).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("keeps the placed database and logs the aside folder when the old copy cannot be removed", async () => {
    await seedOldSet();
    const logged: { level: string; event: string; fields: unknown }[] = [];

    await restoreDatabase({
      dumpBytes: VENUE_BYTES,
      venueDir,
      log: (level, event, fields) => logged.push({ level, event, fields }),
      fs: {
        rename,
        rmdir,
        rm: async (path, options) => {
          if (String(path).includes(".venue.db-replaced-")) throw injected("EACCES");
          await rm(path, options);
        },
      },
    });

    await expectVenueRestored();
    const [folder] = await asideFolders();
    expect(await readFile(join(venueDir, folder!, "venue.db"), "utf8")).toBe(OLD[""]);
    expect(logged).toContainEqual({
      level: "warn",
      event: "restore.db.aside_kept",
      fields: { folder },
    });
  });

  it("removes a symlink at a side-file path rather than moving it, and places the new database", async () => {
    await seedOldSet();
    const elsewhere = join(stagingDir, "not-the-venue");
    await writeFile(elsewhere, "NOT-DATABASE-CONTENT");
    await rm(`${venueFile()}-shm`);
    await symlink(elsewhere, `${venueFile()}-shm`);

    await restoreDatabase({ dumpBytes: VENUE_BYTES, venueDir, log: noopLog });

    await expectVenueRestored();
    await expect(stat(`${venueFile()}-shm`)).rejects.toMatchObject({ code: "ENOENT" });
    expect(await readFile(elsewhere, "utf8")).toBe("NOT-DATABASE-CONTENT");
    expect(await asideFolders()).toEqual([]);
  });

  it("leaves no aside folder once the new database is placed over an old set", async () => {
    await seedOldSet();
    await restoreDatabase({ dumpBytes: VENUE_BYTES, venueDir, log: noopLog });
    await expectVenueRestored();
    await expect(stat(`${venueFile()}-wal`)).rejects.toMatchObject({ code: "ENOENT" });
    await expect(stat(`${venueFile()}-shm`)).rejects.toMatchObject({ code: "ENOENT" });
    expect(await asideFolders()).toEqual([]);
  });
});
