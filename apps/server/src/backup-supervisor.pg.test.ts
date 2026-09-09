import { chmod, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { sql } from "drizzle-orm";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import type { SingletonRole } from "@waitron/db";
import { useTemplateDb } from "@waitron/db/testing/lifecycle.js";
import { idempotentRoleStatement } from "@waitron/db/testing/shared-container.js";
import { decryptArtifact } from "./artifact-cipher.js";
import { unpackArchive } from "./backup-archive.js";
import { assertBackupCanReadFiscal } from "./backup-probe.js";
import type { BackupConfig } from "./backup-config.js";
import { BackupSupervisor, keyFingerprint } from "./backup-supervisor.js";
import { ALL_MODULES } from "./modules.js";
import type { PgDumpRunner } from "./pg-dump.js";
import { RECOVERY_FILES } from "./state-secrets.js";
import { roleUrl } from "./testing/postgres.js";
import { createPostgresDb } from "@waitron/db";
import "./errors.js";

// Real Postgres: the supervisor's whole point is a DERIVED OWNER read connection that the boot probe
// (`assertBackupCanReadFiscal`) accepts — a privilege boundary PGlite (all-superuser) cannot test.
// `adminDatabaseUrl` therefore points at a non-superuser OWNER role, NOT the container superuser
// (CLAUDE.md §4: a superuser hides grant gaps).
const suite = useTemplateDb({ template: "manifest" });
const OWNER_ROLE = "backup_supervisor_owner";
const OWNER_PW = "owner";
let ownerUrl: string;
let badReaderUrl: string;

beforeAll(async () => {
  await suite.admin.execute(
    sql.raw(idempotentRoleStatement({ name: OWNER_ROLE, password: OWNER_PW })),
  );
  // Make the role OWN every public table (as the real migrator owns its tables) so the probe passes
  // as a non-superuser owner, and add the belt-and-braces SELECT grants the probe checks.
  await suite.admin.execute(
    sql.raw(`do $$ declare r record; begin
      for r in select tablename from pg_tables where schemaname = 'public' loop
        execute format('alter table public.%I owner to ${OWNER_ROLE}', r.tablename);
      end loop; end $$;`),
  );
  await suite.admin.execute(
    sql.raw(`grant select on all tables in schema public to ${OWNER_ROLE}`),
  );
  await suite.admin.execute(
    sql.raw(`grant select on all sequences in schema public to ${OWNER_ROLE}`),
  );
  ownerUrl = roleUrl(suite.pg.uri, OWNER_ROLE, OWNER_PW);
  // `app_login` (created cluster-wide by globalSetup) cannot read the migration journals, so it FAILS
  // the probe — the bad-connection control below.
  badReaderUrl = roleUrl(suite.pg.uri, "app_login", "app_pw");
}, 180_000);

// A hermetic pg_dump: writes a small placeholder so the archive assembles + encrypts + fans out
// WITHOUT a host `pg_dump` binary. The real DB pool (and thus the real probe + journal reads) is still
// exercised; only the dump SHELL-OUT is replaced (the pg-dump.ts smoke covers the real binary).
const fakeDump: PgDumpRunner = async ({ outFile }) => {
  await writeFile(outFile, "PGDMP-fake-dump");
};

const STRONG_KEY_1 = "recovery-key-one-strong";
const STRONG_KEY_2 = "recovery-key-two-different";

type LogLine = { level: string; event: string };

interface Refs {
  config: BackupConfig | undefined;
  role: SingletonRole;
  admin: string;
  logs: LogLine[];
  managed: boolean;
}

const stateDirs: string[] = [];

async function makeStateDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "waitron-bsup-state-"));
  stateDirs.push(dir);
  await mkdir(join(dir, "tls"), { recursive: true });
  // `collectStateSecrets` fails the tick unless every RECOVERY_FILES path exists.
  for (const rel of RECOVERY_FILES) await writeFile(join(dir, rel), `dummy ${rel}`);
  return dir;
}

async function makeMediaDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "waitron-bsup-media-"));
  stateDirs.push(dir);
  return dir;
}

async function makeDestDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "waitron-bsup-dest-"));
  stateDirs.push(dir);
  return dir;
}

function localFsConfig(dirs: string[], recoveryKey: string): BackupConfig {
  return {
    destinations: dirs.map((dir, i) => ({
      kind: "local-fs",
      id: i === 0 ? "primary" : `d${i}`,
      dir,
    })),
    recoveryKey,
    databaseUrl: undefined, // derive from adminDatabaseUrl (the OWNER connection)
    schedule: { kind: "interval", ms: 60 * 60 * 1000 }, // hourly: one immediate dump, then it sleeps
    retain: 7,
    retainDays: 30,
    staleAfterMs: 2 * 24 * 60 * 60 * 1000,
    keyRotatedAt: undefined,
  };
}

function makeSupervisor(refs: Refs, stateDir: string, mediaDir: string): BackupSupervisor {
  return new BackupSupervisor({
    buildConfig: async () => refs.config,
    isManagedByEnvironment: () => refs.managed,
    readSingletonRole: () => refs.role,
    adminDatabaseUrl: refs.admin,
    modules: ALL_MODULES,
    environment: "production",
    stateDir,
    mediaDir,
    jitterSeed: "seed",
    readClock: async () => ({ timeZone: "UTC", dayCutover: "00:00" }),
    log: (level, event) => refs.logs.push({ level, event }),
    runDump: fakeDump,
  });
}

async function listArchives(dir: string): Promise<string[]> {
  const names = await readdir(dir).catch(() => [] as string[]);
  return names.filter((n) => n.startsWith("waitron-") && n.endsWith(".backup.enc")).sort();
}

async function poll<T>(fn: () => Promise<T | undefined>, timeoutMs = 20_000): Promise<T> {
  const end = Date.now() + timeoutMs;
  for (;;) {
    const v = await fn();
    if (v !== undefined) return v;
    if (Date.now() >= end) throw new Error("poll timed out");
    await new Promise((r) => setTimeout(r, 100));
  }
}

async function waitForArchive(dir: string): Promise<string[]> {
  return poll(async () => {
    const arch = await listArchives(dir);
    return arch.length > 0 ? arch : undefined;
  });
}

async function waitForEvent(refs: Refs, event: string): Promise<void> {
  await poll(async () => (refs.logs.some((l) => l.event === event) ? true : undefined));
}

afterEach(async () => {
  for (const dir of stateDirs.splice(0)) await rm(dir, { recursive: true, force: true });
});

describe("BackupSupervisor lifecycle (real Postgres, owner read connection)", () => {
  it("the derived OWNER connection passes the fiscal-read probe as a non-superuser", async () => {
    // Ruling 3: the whole design rests on the owner connection reading the fiscal sources + journals.
    // Prove the probe accepts it AND that it is genuinely not a superuser.
    const ownerDb = await createPostgresDb(ownerUrl);
    try {
      const { rows } = await ownerDb.execute<{ rolsuper: boolean }>(
        sql`select rolsuper from pg_roles where rolname = current_user`,
      );
      expect(rows).toEqual([{ rolsuper: false }]);
      await expect(assertBackupCanReadFiscal(ownerDb)).resolves.toBeUndefined();
    } finally {
      await ownerDb.close();
    }
  });

  it("enable from off writes an archive and reports enabled", async () => {
    const dest = await makeDestDir();
    const refs: Refs = {
      config: localFsConfig([dest], STRONG_KEY_1),
      role: "primary",
      admin: ownerUrl,
      logs: [],
      managed: false,
    };
    const sup = makeSupervisor(refs, await makeStateDir(), await makeMediaDir());
    try {
      await sup.reload();
      await waitForArchive(dest);
      expect(sup.current().enabled).toBe(true);
      expect(sup.current().keyFingerprint).toBe(keyFingerprint(STRONG_KEY_1));
      expect((await sup.status()).archiveUnderCurrentKey).toBe(true);
    } finally {
      await sup.stop();
    }
  }, 60_000);

  it("change destination closes the old pool and writes to the new dir", async () => {
    const destA = await makeDestDir();
    const destB = await makeDestDir();
    const refs: Refs = {
      config: localFsConfig([destA], STRONG_KEY_1),
      role: "primary",
      admin: ownerUrl,
      logs: [],
      managed: false,
    };
    const sup = makeSupervisor(refs, await makeStateDir(), await makeMediaDir());
    try {
      await sup.reload();
      await waitForArchive(destA);
      const aCount = (await listArchives(destA)).length;

      refs.config = localFsConfig([destB], STRONG_KEY_1);
      await sup.reload();
      await waitForArchive(destB);
      // A stops receiving (its worker + pool were torn down on the reload); B now receives.
      expect((await listArchives(destA)).length).toBe(aCount);
      expect((await listArchives(destB)).length).toBeGreaterThan(0);
      expect(sup.current().destinations.map((d) => d.dir)).toEqual([destB]);
    } finally {
      await sup.stop();
    }
  }, 60_000);

  it("rotate takes an immediate dump under the new key and updates the fingerprint", async () => {
    const dest = await makeDestDir();
    const refs: Refs = {
      config: localFsConfig([dest], STRONG_KEY_1),
      role: "primary",
      admin: ownerUrl,
      logs: [],
      managed: false,
    };
    const sup = makeSupervisor(refs, await makeStateDir(), await makeMediaDir());
    try {
      await sup.reload();
      await waitForArchive(dest);
      expect(sup.current().keyFingerprint).toBe(keyFingerprint(STRONG_KEY_1));

      refs.config = localFsConfig([dest], STRONG_KEY_2);
      await sup.reload();
      // Poll until the NEWEST artifact decrypts under K2 — i.e. a fresh dump landed under the rotated
      // key (wrong-key decrypt throws `recovery.passphrase_invalid`).
      await poll(async () => {
        const arch = await listArchives(dest);
        const newest = arch[arch.length - 1];
        if (newest === undefined) return undefined;
        try {
          const plain = decryptArtifact(await readFile(join(dest, newest)), STRONG_KEY_2);
          return unpackArchive(plain).some((e) => e.name === "manifest.json") ? true : undefined;
        } catch {
          return undefined;
        }
      });
      expect(sup.current().keyFingerprint).toBe(keyFingerprint(STRONG_KEY_2));
      expect((await sup.status()).archiveUnderCurrentKey).toBe(true);
    } finally {
      await sup.stop();
    }
  }, 60_000);

  it("archiveUnderCurrentKey is false when every destination fails", async () => {
    // The Task 3 carry: a "a tick ran" flag would have lied here. An unwritable dest dir makes every
    // `put` fail (EACCES, swallowed as `backup.destination_failed`); nothing is stored, so the derived
    // flag stays FALSE even though a tick completed.
    const dest = await makeDestDir();
    await chmod(dest, 0o500); // read+execute, no write
    const refs: Refs = {
      config: localFsConfig([dest], STRONG_KEY_1),
      role: "primary",
      admin: ownerUrl,
      logs: [],
      managed: false,
    };
    const sup = makeSupervisor(refs, await makeStateDir(), await makeMediaDir());
    try {
      await sup.reload();
      // Wait for the fan-out to have RUN and failed (the measurement's control: false-because-failed,
      // not false-because-not-yet-run).
      await waitForEvent(refs, "backup.destination_failed");
      expect(await listArchives(dest)).toEqual([]);
      expect((await sup.status()).archiveUnderCurrentKey).toBe(false);
    } finally {
      await sup.stop();
      await chmod(dest, 0o700); // restore so afterEach can remove it
    }
  }, 60_000);

  it("a non-primary node runs no duty", async () => {
    const dest = await makeDestDir();
    const refs: Refs = {
      config: localFsConfig([dest], STRONG_KEY_1),
      role: "secondary",
      admin: ownerUrl,
      logs: [],
      managed: false,
    };
    const sup = makeSupervisor(refs, await makeStateDir(), await makeMediaDir());
    try {
      await sup.reload();
      expect(sup.current().enabled).toBe(false);
      expect(refs.logs.some((l) => l.event === "backup.disabled")).toBe(true);
      // No probe ran, no worker started — so no dump can ever land.
      await new Promise((r) => setTimeout(r, 300));
      expect(await listArchives(dest)).toEqual([]);
    } finally {
      await sup.stop();
    }
  }, 60_000);

  it("a concurrent reload is refused with backup.reload_in_progress (latched)", async () => {
    // No DB needed: a `buildConfig` that hangs holds the first reload inside its critical section, so
    // the second reload hits the `#reloading` latch and throws. Release the first to let it settle.
    let release!: () => void;
    const gate = new Promise<void>((r) => {
      release = r;
    });
    const sup = new BackupSupervisor({
      buildConfig: async () => {
        await gate;
        return undefined;
      },
      isManagedByEnvironment: () => false,
      readSingletonRole: () => "primary",
      adminDatabaseUrl: ownerUrl,
      modules: ALL_MODULES,
      environment: "production",
      stateDir: await makeStateDir(),
      mediaDir: await makeMediaDir(),
      jitterSeed: "seed",
      readClock: async () => ({ timeZone: "UTC", dayCutover: "00:00" }),
      log: () => {},
      runDump: fakeDump,
    });
    const first = sup.reload();
    await expect(sup.reload()).rejects.toMatchObject({ code: "backup.reload_in_progress" });
    release();
    await first;
    await sup.stop();
  });

  it("a stop() racing a reload() leaves no running worker and no open pool", async () => {
    // Step 8b: `apply`/`rotate` now call `reload()` on a live box, so a shutdown `stop()` can interleave
    // with an in-flight `reload()` at an await point. Without the `#stopped` guard, `stop()` tears down
    // BEFORE `reload()` opens its pool and starts its worker, so the reload would leave a sweep + pool
    // running after `stop()` returned. The invariant that catches that: every pool the supervisor opens
    // is also closed (opened === closed), and after settle no duty is enabled.
    const dest = await makeDestDir();
    let opened = 0;
    let closed = 0;
    const refs: Refs = {
      config: localFsConfig([dest], STRONG_KEY_1),
      role: "primary",
      admin: ownerUrl,
      logs: [],
      managed: false,
    };
    const sup = new BackupSupervisor({
      buildConfig: async () => refs.config,
      isManagedByEnvironment: () => refs.managed,
      readSingletonRole: () => refs.role,
      adminDatabaseUrl: refs.admin,
      modules: ALL_MODULES,
      environment: "production",
      stateDir: await makeStateDir(),
      mediaDir: await makeMediaDir(),
      jitterSeed: "seed",
      readClock: async () => ({ timeZone: "UTC", dayCutover: "00:00" }),
      log: (level, event) => refs.logs.push({ level, event }),
      runDump: fakeDump,
      // Count every pool the supervisor opens and closes — the leak-detector for the race.
      openDb: async (url) => {
        const db = await createPostgresDb(url);
        opened += 1;
        const orig = db.close.bind(db);
        db.close = async () => {
          closed += 1;
          await orig();
        };
        return db;
      },
    });
    // Fire the reload and, WITHOUT awaiting it, race a stop() against it — the two interleave at the
    // reload's await points (teardown → buildConfig → openDb → probe).
    const reloading = sup.reload();
    await sup.stop();
    await reloading.catch(() => {});
    // Let any leaked worker (there must be none) have a window to open/start.
    await new Promise((r) => setTimeout(r, 300));
    expect(sup.current().enabled).toBe(false); // no running duty (#db torn down / never assigned)
    expect(opened).toBe(closed); // every opened pool was closed — no leaked connection
  }, 60_000);

  it("the probe gates a bad connection: it is refused, backup stays off (control by inversion)", async () => {
    // The positive twin is `enable from off` above (a GOOD owner url → enabled + an artifact). Here the
    // SAME config with a reader that cannot read the journals is REFUSED by the probe: backup left off,
    // no artifact. Removing the `assertBackupCanReadFiscal` call would let this bad connection through
    // to the worker — the two directions together prove the probe is load-bearing (CLAUDE.md §4).
    const dest = await makeDestDir();
    const refs: Refs = {
      config: localFsConfig([dest], STRONG_KEY_1),
      role: "primary",
      admin: badReaderUrl,
      logs: [],
      managed: false,
    };
    const sup = makeSupervisor(refs, await makeStateDir(), await makeMediaDir());
    try {
      await sup.reload();
      expect(refs.logs.some((l) => l.event === "backup.disabled_probe_failed")).toBe(true);
      expect(sup.current().enabled).toBe(false);
      await new Promise((r) => setTimeout(r, 300));
      expect(await listArchives(dest)).toEqual([]);
    } finally {
      await sup.stop();
    }
  }, 60_000);
});
