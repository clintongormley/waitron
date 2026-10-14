// The backup admin routes under the manager-login gate, plus the supervisor's real enable/rotate
// lifecycle. The supervisor is pointed at a throwaway venue directory because these tests exercise
// the ROUTES, not what a backup contains; the supervisor's own lifecycle is covered in
// `backup-supervisor.test.ts`.
import { createCipheriv, randomBytes } from "node:crypto";
import { mkdtempSync } from "node:fs";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Hono } from "hono";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { SingletonRole } from "@waitron/db";
import { withTransaction } from "@waitron/db";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { hashPassword, hashPin, persons } from "@waitron/identity";
import { applyVenue, planVenue } from "@waitron/provisioning";
import type { StreamView } from "@waitron/stream";
import { decodeArchiveRecoveryPack } from "./archive-recovery-pack.js";
import { mountBackupApi, type BackupApiDeps } from "./backup-api.js";
import { eq, sql } from "drizzle-orm";
import { AppError } from "@waitron/shared";
import { backupArchiveKey, parseBackupArchiveKey } from "./backup-keys.js";
import { readStreamSettings, streamSettingsPayload } from "./stream-host.js";
import { createTurns, type Turns } from "./backup-turns.js";
import {
  deleteCredential,
  loadKeyRing,
  putCredential,
  tenantCredentials,
  tryGetCredential,
  type KeyRing,
} from "@waitron/credentials";
import { mountStreamApi } from "./stream-api.js";
import {
  isBackupManagedByEnvironment,
  loadBackupSettings,
  loadRecoveryKey,
  resolveBackupConfig,
  type BackupConfig,
} from "./backup-config.js";
import { ARCHIVE_PURPOSE, readArchiveSettings, type ArchiveSettings } from "./archive-settings.js";
import type {
  BackupDestination,
  StorageBackend,
  StorageCall,
  StoredObject,
} from "./storage-backend.js";
import { buildBackupBackend } from "./backup-backends.js";
import { writeRecoveryKey } from "./backup-env-writer.js";
import { BackupSupervisor, keyFingerprint } from "./backup-supervisor.js";
import { loadBoxEnv } from "./box-env.js";
import { parseEnvFile } from "./env-file.js";
import type { Logger } from "./logger.js";
import type { SealedStateRefresher } from "./sealed-state.js";
import { mountManagementApi } from "./management-api.js";
import { ALL_MODULES } from "./modules.js";
import { RECOVERY_FILES } from "./state-secrets.js";
import { TOTP_KEY_RING } from "./testing/authenticator.js";
import { omitStoredStreamField } from "./testing/old-stream-credential.js";

const LOCALE = "es-ES";
const PASSWORD = "correct horse"; // the seeded manager's dashboard password
const MANAGER_EMAIL = "manager@x.com";
// ≥ MIN_PASSPHRASE_LENGTH (12) and base64url-safe (survives the env-file round-trip).
const KEY_1 = "recovery-key-one-strong";
const KEY_2 = "recovery-key-two-different";
const VENUE = "c0000000-0000-4000-8000-000000000002";
const RING_KEY = Buffer.alloc(32, 7);
const RING = loadKeyRing({
  WAITRON_CREDENTIALS_KEY: RING_KEY.toString("base64"),
  WAITRON_CREDENTIALS_KEY_VERSION: "1",
});

const suite = useVenueDb({
  migrations: migrationOptionsFor(manifestSets(), null),
  resetPerTest: false,
  timeoutMs: 60_000,
});

let nifCounter = 0;
function nextNif(): string {
  nifCounter += 1;
  return `${String(76_000_000 + nifCounter).padStart(8, "0")}K`;
}

// The venue the supervisor opens. Unmigrated, so every module's applied schema version reads 0 and
// the manifest is a valid one describing an empty box — enough for routes that never look inside an
// archive.
const venueDir = mkdtempSync(join(tmpdir(), "backup-api-venue-"));

const cleanup: (() => Promise<void>)[] = [];

async function makeStateDir(): Promise<string> {
  const dir = mkdtempSync(join(tmpdir(), "backup-api-state-"));
  await mkdir(join(dir, "tls"), { recursive: true });
  // The sweep's `collectStateSecrets` fails a tick unless every RECOVERY_FILES path exists.
  for (const rel of RECOVERY_FILES) await writeFile(join(dir, rel), `dummy ${rel}`);
  return dir;
}
/** A refresher that records, each time it runs, the recovery key the state folder's env files hold. */
function recordingRefresher(stateDir: string): {
  refresh: () => Promise<"sealed">;
  seen: (string | undefined)[];
} {
  const seen: (string | undefined)[] = [];
  return {
    seen,
    refresh: async () => {
      seen.push(loadRecoveryKey(await loadBoxEnv({}, stateDir)));
      return "sealed";
    },
  };
}

function makeDestDir(): string {
  return mkdtempSync(join(tmpdir(), "backup-api-dest-"));
}

interface Scenario {
  stateDir: string;
  base: NodeJS.ProcessEnv;
  role: SingletonRole;
  /** How the supervisor reads the dashboard record, read at each reload; `readSealed` by default. */
  readRecord?: () => Promise<ArchiveSettings | null>;
}

/** One in-memory bucket per test: every S3 destination built while it is set reaches it. */
class FakeBucket implements StorageBackend {
  readonly id = "bucket";
  objects = new Map<string, Buffer>();
  calls: string[] = [];
  deleted: string[][] = [];
  failGet = false;
  hangPut = false;
  async put(key: string, bytes: Uint8Array, call: StorageCall) {
    this.calls.push(`put ${key}`);
    if (this.hangPut) {
      await new Promise((_resolve, reject) => {
        call.signal.addEventListener("abort", () => reject(call.signal.reason));
      });
    }
    this.objects.set(key, Buffer.from(bytes));
  }
  async putFile(key: string, path: string) {
    this.calls.push(`putFile ${key}`);
    this.objects.set(key, await readFile(path));
  }
  async getFile(key: string, path: string) {
    await writeFile(path, await this.get(key));
  }
  async get(key: string) {
    this.calls.push(`get ${key}`);
    if (this.failGet) throw new Error("get failed");
    const bytes = this.objects.get(key);
    if (bytes === undefined) throw new Error("missing");
    return bytes;
  }
  async list(prefix: string): Promise<StoredObject[]> {
    this.calls.push(`list ${prefix}`);
    return [...this.objects.keys()]
      .filter((k) => k.startsWith(prefix))
      .map((k) => ({ key: k, size: this.objects.get(k)!.length, mtimeMs: 0 }));
  }
  async delete(key: string) {
    this.calls.push(`delete ${key}`);
    this.objects.delete(key);
  }
  async deleteMany(keys: string[]) {
    this.calls.push(`deleteMany ${keys.join(",")}`);
    this.deleted.push([...keys]);
    for (const key of keys) this.objects.delete(key);
  }
  close() {}
}

let bucket = new FakeBucket();

function buildBackend(dest: BackupDestination): StorageBackend {
  return dest.kind === "s3" ? bucket : buildBackupBackend(dest);
}

const readSealed = () => readArchiveSettings(suite.db, RING);

function makeSupervisor(sc: Scenario): BackupSupervisor {
  const sup = new BackupSupervisor({
    // As boot builds it.
    buildConfig: async () =>
      loadBackupSettings({
        managedByEnvironment: isBackupManagedByEnvironment(sc.base),
        env: await loadBoxEnv(sc.base, sc.stateDir),
        readSealed: () => (sc.readRecord ?? readSealed)(),
        venueId: VENUE,
      }),
    buildBackend,
    isManagedByEnvironment: () => isBackupManagedByEnvironment(sc.base),
    readSingletonRole: () => sc.role,
    venueDir,
    modules: ALL_MODULES,
    environment: "production",
    stateDir: sc.stateDir,
    jitterSeed: "seed",
    readClock: async () => ({ timeZone: "UTC", dayCutover: "00:00", cutoverChanges: [] }),
    log: () => {},
  });
  cleanup.push(() => sup.stop());
  return sup;
}

function buildApp(
  sup: BackupSupervisor,
  stateDir: string,
  base: NodeJS.ProcessEnv = {},
  readRecoveryKey = async (): Promise<string | undefined> =>
    loadRecoveryKey(await loadBoxEnv(base, stateDir)),
  sealedState: SealedStateRefresher = { refresh: async () => "sealed" },
  readStream: () => StreamView = () => ({ state: "off" }),
  turns: Turns = createTurns(),
  extra: Partial<BackupApiDeps> = {},
  log: Logger = () => {},
): Hono {
  const app = new Hono();
  mountManagementApi(
    app,
    {
      db: suite.db,
      cfg: { nodeId: "00000000-0000-0000-0000-000000000000" },
      secureCookies: false,
      rpId: "localhost",
      origin: "http://localhost",
      credentialKeyRing: TOTP_KEY_RING,
    },
    () => {},
  );
  mountBackupApi(
    app,
    {
      supervisor: sup,
      db: suite.db,
      ring: RING,
      buildBackend,
      venueId: VENUE,
      stateDir,
      readRecoveryKey,
      readBoxEnv: () => loadBoxEnv(base, stateDir),
      sealedState,
      readStream,
      turns,
      ...extra,
    },
    log,
  );
  return app;
}

async function setupTenant(): Promise<void> {
  await applyVenue(
    planVenue(
      {
        country: "ES",
        taxId: nextNif(),
        legalName: "Deli Test SL",
        location: {
          name: "Sala principal",
          fiscalTerritory: "ES-common",
          invoiceLocales: [LOCALE],
          operationDescription: "Venta en establecimiento",
          addressLine1: "Calle Mayor 1",
          addressLine2: null,
          postalCode: "28013",
          city: "Madrid",
          province: "Madrid",
          timeZone: "Europe/Madrid",
          dayCutover: "05:00",
        },
        seriesCode: "A",
        rectificativeSeriesCode: "R",
        admin: {
          displayName: "Administradora",
          pinHash: hashPin("1234"),
          passwordHash: hashPassword("dashPass123"),
          email: "admin@x.com",
        },
      },
      ALL_MODULES,
    ),
    { db: suite.db, modules: ALL_MODULES },
  );
  await withTransaction(suite.db, async (tx) => {
    // Through drizzle, not raw SQL: `persons.id` and `persons.created_at` are filled by drizzle's
    // `$defaultFn`, so a statement that names neither is refused.
    await tx.insert(persons).values({
      displayName: "The Manager",
      email: MANAGER_EMAIL,
      pinHash: hashPin("1234"),
      passwordHash: hashPassword(PASSWORD),
      role: "manager",
    });
  });
}

async function login(app: Hono): Promise<string> {
  const res = await app.request("/management-api/session", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: MANAGER_EMAIL, password: PASSWORD }),
  });
  expect(res.status).toBe(200);
  return res.headers.get("set-cookie")!.split(";")[0];
}

const DAILY_AT_0330 = { kind: "wall-clock", days: "daily", at: { hour: 3, minute: 30 } } as const;
const RETENTION = { count: 7, days: 30 } as const;

async function poll<T>(fn: () => Promise<T | undefined>, timeoutMs = 20_000): Promise<T> {
  const end = Date.now() + timeoutMs;
  for (;;) {
    const v = await fn();
    if (v !== undefined) return v;
    if (Date.now() >= end) throw new Error("poll timed out");
    await new Promise((r) => setTimeout(r, 100));
  }
}

afterEach(async () => {
  for (const stop of cleanup.splice(0)) await stop().catch(() => {});
  // The suite shares one database, and both records are one per venue.
  await withTransaction(suite.db, async (tx) => {
    await deleteCredential(tx, { purpose: ARCHIVE_PURPOSE });
    await deleteCredential(tx, { purpose: "backup.stream" });
  });
  bucket = new FakeBucket();
});

describe("backup admin routes", () => {
  beforeAll(async () => {
    await setupTenant();
  }, 180_000);

  it("unauthenticated requests 401", async () => {
    const sc: Scenario = { stateDir: await makeStateDir(), base: {}, role: "primary" };
    const app = buildApp(makeSupervisor(sc), sc.stateDir);
    for (const path of ["/api/backup/status", "/api/backup/recovery-key"]) {
      const res = await app.request(path);
      expect(res.status).toBe(401);
      expect(await res.json()).toMatchObject({ error: { code: "management_session.required" } });
    }
    const mint = await app.request("/api/backup/mint-key", { method: "POST" });
    expect(mint.status).toBe(401);
  });

  it("mint-key returns a strong key and stores nothing", async () => {
    const sc: Scenario = { stateDir: await makeStateDir(), base: {}, role: "primary" };
    const sup = makeSupervisor(sc);
    const app = buildApp(sup, sc.stateDir);
    const cookie = await login(app);
    const res = await app.request("/api/backup/mint-key", { method: "POST", headers: { cookie } });
    expect(res.status).toBe(200);
    const { key } = (await res.json()) as { key: string };
    // randomBytes(32).toString("base64url") → 43 chars, no padding.
    expect(key).toHaveLength(43);
    expect(key).toMatch(/^[A-Za-z0-9_-]+$/);
    // Minting stored nothing: backups are still off.
    const status = await app.request("/api/backup/status", { headers: { cookie } });
    expect((await status.json()).enabled).toBe(false);
  });

  it("status carries the bucket copy's state beside the archive's, off when no reader is given", async () => {
    const sc: Scenario = { stateDir: await makeStateDir(), base: {}, role: "primary" };
    const sup = makeSupervisor(sc);
    const stream: StreamView = {
      state: "off",
      reason: "start_failed",
      stateSince: "2026-09-15T11:00:00.000Z",
    };
    const app = buildApp(sup, sc.stateDir, {}, undefined, undefined, () => stream);
    const cookie = await login(app);
    const res = await app.request("/api/backup/status", { headers: { cookie } });
    expect(res.status).toBe(200);
    expect((await res.json()).stream).toEqual(stream);
    const without = buildApp(sup, sc.stateDir);
    const plain = await without.request("/api/backup/status", { headers: { cookie } });
    expect((await plain.json()).stream).toEqual({ state: "off" });
  });

  it("status reads the box env once, and a Save's answer once after the read its key check needs", async () => {
    const sc: Scenario = { stateDir: await makeStateDir(), base: {}, role: "primary" };
    const reads: string[] = [];
    const app = buildApp(
      makeSupervisor(sc),
      sc.stateDir,
      {},
      async () => {
        reads.push("recovery-key");
        return loadRecoveryKey(await loadBoxEnv({}, sc.stateDir));
      },
      undefined,
      undefined,
      undefined,
      {
        readBoxEnv: () => {
          reads.push("box-env");
          return loadBoxEnv({}, sc.stateDir);
        },
      },
    );
    const cookie = await login(app);
    const status = await app.request("/api/backup/status", { headers: { cookie } });
    expect(status.status).toBe(200);
    expect(reads).toHaveLength(1);
    reads.length = 0;
    const res = await app.request("/api/backup/apply", {
      method: "POST",
      headers: { cookie, "content-type": "application/json" },
      body: JSON.stringify({
        destinations: [{ kind: "local-fs", dir: makeDestDir() }],
        recoveryKey: KEY_1,
        schedule: DAILY_AT_0330,
        retention: RETENTION,
      }),
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      recoveryKeySet: true,
      keyFingerprint: keyFingerprint(KEY_1),
    });
    expect(reads).toHaveLength(2);
  }, 60_000);

  // The dashboard replaces its status with a write's answer, so that answer carries the copy too.
  it("apply's answer carries the bucket copy's state", async () => {
    const sc: Scenario = { stateDir: await makeStateDir(), base: {}, role: "primary" };
    const sup = makeSupervisor(sc);
    const stream: StreamView = {
      state: "off",
      reason: "no_membership",
      stateSince: "2026-09-15T11:00:00.000Z",
    };
    const app = buildApp(sup, sc.stateDir, {}, undefined, undefined, () => stream);
    const cookie = await login(app);
    const res = await app.request("/api/backup/apply", {
      method: "POST",
      headers: { cookie, "content-type": "application/json" },
      body: JSON.stringify({
        destinations: [{ kind: "local-fs", dir: makeDestDir() }],
        recoveryKey: KEY_1,
        schedule: DAILY_AT_0330,
        retention: RETENTION,
      }),
    });
    expect(res.status).toBe(200);
    expect((await res.json()).stream).toEqual(stream);
  });

  it("apply enables backups and hot-reloads (no restart), then reports enabled", async () => {
    const dest = makeDestDir();
    const sc: Scenario = { stateDir: await makeStateDir(), base: {}, role: "primary" };
    const sup = makeSupervisor(sc);
    const app = buildApp(sup, sc.stateDir);
    const cookie = await login(app);
    const res = await app.request("/api/backup/apply", {
      method: "POST",
      headers: { cookie, "content-type": "application/json" },
      body: JSON.stringify({
        destinations: [{ kind: "local-fs", dir: dest }],
        recoveryKey: KEY_1,
        schedule: DAILY_AT_0330,
        retention: RETENTION,
      }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.enabled).toBe(true);
    expect(body.keyFingerprint).toBe(keyFingerprint(KEY_1));
    expect(body.recoveryKey).toBeUndefined(); // the status projection NEVER carries the key
    // The apply RESPONSE is the COMPLETE status the dashboard reads (not the sync snapshot). Only the
    // fields' presence is asserted here; the poll below covers the first dump.
    expect(body.backupStatus.configured).toBe(true);
    expect(typeof body.archiveUnderCurrentKey).toBe("boolean");
    // `apply` stored the settings and reloaded (no restart needed), and the effective config picked them up.
    expect(sup.current().recoveryKey).toBe(KEY_1);
    // The immediate first tick stores an archive under the current key.
    await poll(async () => {
      const s = await app.request("/api/backup/status", { headers: { cookie } });
      return (await s.json()).archiveUnderCurrentKey === true ? true : undefined;
    });
  }, 60_000);

  it("apply refuses a non-storable key (trailing space) before any write", async () => {
    const sc: Scenario = { stateDir: await makeStateDir(), base: {}, role: "primary" };
    const app = buildApp(makeSupervisor(sc), sc.stateDir);
    const cookie = await login(app);
    const res = await app.request("/api/backup/apply", {
      method: "POST",
      headers: { cookie, "content-type": "application/json" },
      body: JSON.stringify({
        destinations: [{ kind: "local-fs", dir: makeDestDir() }],
        recoveryKey: "trailing space key ",
        schedule: DAILY_AT_0330,
        retention: RETENTION,
      }),
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({
      error: { code: "backup.recovery_key_unstorable" },
    });
  });

  it("apply refuses when the environment owns the config", async () => {
    const sc: Scenario = {
      stateDir: await makeStateDir(),
      base: { WAITRON_BACKUP_DIR: makeDestDir() }, // an env var set → managed by environment
      role: "primary",
    };
    const app = buildApp(makeSupervisor(sc), sc.stateDir);
    const cookie = await login(app);
    const res = await app.request("/api/backup/apply", {
      method: "POST",
      headers: { cookie, "content-type": "application/json" },
      body: JSON.stringify({
        destinations: [{ kind: "local-fs", dir: makeDestDir() }],
        recoveryKey: KEY_1,
        schedule: DAILY_AT_0330,
        retention: RETENTION,
      }),
    });
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ error: { code: "backup.managed_by_environment" } });
  });

  it("apply refuses on a non-primary node", async () => {
    const sc: Scenario = { stateDir: await makeStateDir(), base: {}, role: "secondary" };
    const app = buildApp(makeSupervisor(sc), sc.stateDir);
    const cookie = await login(app);
    const res = await app.request("/api/backup/apply", {
      method: "POST",
      headers: { cookie, "content-type": "application/json" },
      body: JSON.stringify({
        destinations: [{ kind: "local-fs", dir: makeDestDir() }],
        recoveryKey: KEY_1,
        schedule: DAILY_AT_0330,
        retention: RETENTION,
      }),
    });
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ error: { code: "backup.not_primary" } });
  });

  it("recovery-key returns the EFFECTIVE key, not the file, under a partial env override", async () => {
    const dest = makeDestDir();
    const stateDir = await makeStateDir();
    // The FILE holds KEY_2 (a prior wizard apply)…
    await writeRecoveryKey(stateDir, { recoveryKey: KEY_2, keyRotatedAt: undefined });
    // …but the ENV injects KEY_1 (and the rest), which wins on merge — so the box encrypts under KEY_1.
    const sc: Scenario = {
      stateDir,
      base: {
        WAITRON_BACKUP_DIR: dest,
        WAITRON_BACKUP_RECOVERY_KEY: KEY_1,
        WAITRON_BACKUP_SCHEDULE_DAYS: "daily",
        WAITRON_BACKUP_AT: "03:30",
        WAITRON_BACKUP_RETAIN: "7",
        WAITRON_BACKUP_RETAIN_DAYS: "30",
      },
      role: "primary",
    };
    const sup = makeSupervisor(sc);
    await sup.reload();
    // The key reader merges the raw environment over the file, as boot's does.
    const app = buildApp(sup, stateDir, sc.base);
    const cookie = await login(app);

    const res = await app.request("/api/backup/recovery-key", { headers: { cookie } });
    expect(res.status).toBe(200);
    expect((await res.json()).key).toBe(KEY_1); // the EFFECTIVE key, not the file's KEY_2

    // And a rotate cannot silently orphan archives: the env owns the config, so it is refused.
    const rot = await app.request("/api/backup/rotate", {
      method: "POST",
      headers: { cookie, "content-type": "application/json" },
      body: JSON.stringify({ recoveryKey: "a-third-strong-key" }),
    });
    expect(rot.status).toBe(409);
    expect(await rot.json()).toMatchObject({ error: { code: "backup.managed_by_environment" } });
    // The file still holds KEY_2 — nothing was written by the refused rotate.
    expect(await readFile(join(stateDir, "backup.env"), "utf8")).toContain(KEY_2);
  }, 60_000);

  it("rotate takes an immediate dump under the new key and bumps keyRotatedAt", async () => {
    const dest = makeDestDir();
    const sc: Scenario = { stateDir: await makeStateDir(), base: {}, role: "primary" };
    const sup = makeSupervisor(sc);
    const app = buildApp(sup, sc.stateDir);
    const cookie = await login(app);
    // Enable first (KEY_1), then rotate to KEY_2.
    const applied = await app.request("/api/backup/apply", {
      method: "POST",
      headers: { cookie, "content-type": "application/json" },
      body: JSON.stringify({
        destinations: [{ kind: "local-fs", dir: dest }],
        recoveryKey: KEY_1,
        schedule: DAILY_AT_0330,
        retention: RETENTION,
      }),
    });
    expect(applied.status).toBe(200);
    expect((await applied.json()).keyRotatedAt ?? null).toBeNull();

    const rot = await app.request("/api/backup/rotate", {
      method: "POST",
      headers: { cookie, "content-type": "application/json" },
      body: JSON.stringify({ recoveryKey: KEY_2 }),
    });
    expect(rot.status).toBe(200);
    const body = await rot.json();
    expect(body.keyFingerprint).toBe(keyFingerprint(KEY_2));
    expect(typeof body.keyRotatedAt).toBe("string"); // rotation stamped
    // Rotate, like apply, returns the COMPLETE status (backupStatus + archiveUnderCurrentKey present).
    expect(body.backupStatus.configured).toBe(true);
    expect(typeof body.archiveUnderCurrentKey).toBe("boolean");
    expect(sup.current().recoveryKey).toBe(KEY_2);
    // GET recovery-key now returns KEY_2, and a fresh archive lands under it.
    const rk = await app.request("/api/backup/recovery-key", { headers: { cookie } });
    expect((await rk.json()).key).toBe(KEY_2);
    await poll(async () => {
      const s = await app.request("/api/backup/status", { headers: { cookie } });
      return (await s.json()).archiveUnderCurrentKey === true ? true : undefined;
    });
  }, 60_000);

  it("apply keeps the date of a key rotated before archives were enabled", async () => {
    const stateDir = await makeStateDir();
    await writeRecoveryKey(stateDir, { recoveryKey: KEY_1, keyRotatedAt: undefined });
    const sc: Scenario = { stateDir, base: {}, role: "primary" };
    const sup = makeSupervisor(sc);
    await sup.reload();
    const app = buildApp(sup, stateDir);
    const cookie = await login(app);

    const rotated = await app.request("/api/backup/rotate", {
      method: "POST",
      headers: { cookie, "content-type": "application/json" },
      body: JSON.stringify({ recoveryKey: KEY_2 }),
    });
    expect(rotated.status).toBe(200);
    const rotatedFile = parseEnvFile(await readFile(join(stateDir, "backup.env"), "utf8"));
    const rotatedAt = rotatedFile.WAITRON_BACKUP_KEY_ROTATED_AT;
    expect(typeof rotatedAt).toBe("string");

    const applied = await app.request("/api/backup/apply", {
      method: "POST",
      headers: { cookie, "content-type": "application/json" },
      body: JSON.stringify({
        destinations: [{ kind: "local-fs", dir: makeDestDir() }],
        schedule: DAILY_AT_0330,
        retention: RETENTION,
      }),
    });
    expect(applied.status).toBe(200);
    expect((await applied.json()).keyRotatedAt).toBe(rotatedAt);
    const status = await app.request("/api/backup/status", { headers: { cookie } });
    expect(status.status).toBe(200);
    expect((await status.json()).keyRotatedAt).toBe(rotatedAt);
    expect(
      parseEnvFile(await readFile(join(stateDir, "backup.env"), "utf8"))
        .WAITRON_BACKUP_KEY_ROTATED_AT,
    ).toBe(rotatedAt);
  }, 60_000);

  it("apply accepts an interval schedule and a weekday-array + auto time", async () => {
    for (const schedule of [
      { kind: "interval", ms: 3_600_000 },
      { kind: "wall-clock", days: [1, 3, 5], at: "auto" },
    ] as const) {
      const sc: Scenario = { stateDir: await makeStateDir(), base: {}, role: "primary" };
      const app = buildApp(makeSupervisor(sc), sc.stateDir);
      const cookie = await login(app);
      const res = await app.request("/api/backup/apply", {
        method: "POST",
        headers: { cookie, "content-type": "application/json" },
        body: JSON.stringify({
          destinations: [{ kind: "local-fs", dir: makeDestDir() }],
          recoveryKey: KEY_1,
          schedule,
          retention: RETENTION,
        }),
      });
      expect(res.status).toBe(200);
      expect((await res.json()).enabled).toBe(true);
    }
  }, 60_000);

  it("apply fails loud when the effective key differs from the requested one", async () => {
    // The orphan-prevention guard: a supervisor whose reloaded config resolves a DIFFERENT recovery
    // key than the operator asked for (here forced via buildConfig) must be refused, not silently
    // encrypt future archives under a key the operator never recorded.
    const dest = makeDestDir();
    const stateDir = await makeStateDir();
    const mismatch: BackupConfig = {
      source: "environment",
      revision: undefined,
      enabled: true,
      destinations: [{ kind: "local-fs", id: "primary", dir: dest }],
      recoveryKey: "effective-key-differs-from-request",
      schedule: DAILY_AT_0330,
      retain: 7,
      retainDays: 30,
      staleAfterMs: 2 * 24 * 60 * 60 * 1000,
      destinationTimeoutMs: 15 * 60 * 1000,
      keyRotatedAt: undefined,
    };
    const sup = new BackupSupervisor({
      buildConfig: async () => mismatch, // ignores the file the route writes
      isManagedByEnvironment: () => false,
      readSingletonRole: () => "primary",
      venueDir,
      modules: ALL_MODULES,
      environment: "production",
      stateDir,
      jitterSeed: "seed",
      readClock: async () => ({ timeZone: "UTC", dayCutover: "00:00", cutoverChanges: [] }),
      log: () => {},
    });
    cleanup.push(() => sup.stop());
    const recorder = recordingRefresher(stateDir);
    const app = buildApp(sup, stateDir, {}, undefined, recorder);
    const cookie = await login(app);
    const res = await app.request("/api/backup/apply", {
      method: "POST",
      headers: { cookie, "content-type": "application/json" },
      body: JSON.stringify({
        destinations: [{ kind: "local-fs", dir: dest }],
        recoveryKey: KEY_1,
        schedule: DAILY_AT_0330,
        retention: RETENTION,
      }),
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: { code: "backup.effective_mismatch" } });
    // The key file and then the settings were written before the refusal, and the row was re-locked
    // after each.
    expect(recorder.seen).toEqual([KEY_1, KEY_1]);
  }, 60_000);

  it("rotate fails loud when the reloaded key is not the one requested", async () => {
    const dest = makeDestDir();
    const stateDir = await makeStateDir();
    const pinned: BackupConfig = {
      source: "environment",
      revision: undefined,
      enabled: true,
      destinations: [{ kind: "local-fs", id: "primary", dir: dest }],
      recoveryKey: KEY_1,
      schedule: DAILY_AT_0330,
      retain: 7,
      retainDays: 30,
      staleAfterMs: 2 * 24 * 60 * 60 * 1000,
      destinationTimeoutMs: 15 * 60 * 1000,
      keyRotatedAt: undefined,
    };
    const sup = new BackupSupervisor({
      buildConfig: async () => pinned, // ignores the file the route writes, so KEY_1 stays effective
      isManagedByEnvironment: () => false,
      readSingletonRole: () => "primary",
      venueDir,
      modules: ALL_MODULES,
      environment: "production",
      stateDir,
      jitterSeed: "seed",
      readClock: async () => ({ timeZone: "UTC", dayCutover: "00:00", cutoverChanges: [] }),
      log: () => {},
    });
    cleanup.push(() => sup.stop());
    await sup.reload();
    const recorder = recordingRefresher(stateDir);
    const app = buildApp(sup, stateDir, {}, undefined, recorder);
    const cookie = await login(app);
    const res = await app.request("/api/backup/rotate", {
      method: "POST",
      headers: { cookie, "content-type": "application/json" },
      body: JSON.stringify({ recoveryKey: KEY_2 }),
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: { code: "backup.effective_mismatch" } });
    expect(sup.current().recoveryKey).toBe(KEY_1);
    expect(recorder.seen).toEqual([KEY_2]);
  }, 60_000);

  it("re-locks this node's state row after apply and after rotate", async () => {
    const dest = makeDestDir();
    const sc: Scenario = { stateDir: await makeStateDir(), base: {}, role: "primary" };
    const recorder = recordingRefresher(sc.stateDir);
    const refresh = vi.fn(recorder.refresh);
    const app = buildApp(makeSupervisor(sc), sc.stateDir, {}, undefined, { refresh });
    const cookie = await login(app);
    const post = (path: string, body: unknown) =>
      app.request(path, {
        method: "POST",
        headers: { cookie, "content-type": "application/json" },
        body: JSON.stringify(body),
      });
    expect(
      (
        await post("/api/backup/apply", {
          destinations: [{ kind: "local-fs", dir: dest }],
          recoveryKey: KEY_1,
          schedule: DAILY_AT_0330,
          retention: RETENTION,
        })
      ).status,
    ).toBe(200);
    // Once after the key file is written, once after the settings are.
    expect(refresh).toHaveBeenCalledTimes(2);
    expect((await post("/api/backup/rotate", { recoveryKey: KEY_2 })).status).toBe(200);
    // Rotation too: after the key file, and after the settings' new revision.
    expect(refresh).toHaveBeenCalledTimes(4);
    expect(recorder.seen).toEqual([KEY_1, KEY_1, KEY_2, KEY_2]);
  }, 60_000);

  it("reads and rotates a recovery key that has no archive destination", async () => {
    const stateDir = await makeStateDir();
    await writeRecoveryKey(stateDir, { recoveryKey: KEY_1, keyRotatedAt: undefined });
    const sc: Scenario = { stateDir, base: {}, role: "primary" };
    const sup = makeSupervisor(sc);
    await sup.reload(); // no destination, so the archive duty stays off
    const recorder = recordingRefresher(stateDir);
    const refresh = vi.fn(recorder.refresh);
    const app = buildApp(sup, stateDir, {}, undefined, { refresh });
    const cookie = await login(app);

    const before = await app.request("/api/backup/recovery-key", { headers: { cookie } });
    expect((await before.json()).key).toBe(KEY_1);

    const rot = await app.request("/api/backup/rotate", {
      method: "POST",
      headers: { cookie, "content-type": "application/json" },
      body: JSON.stringify({ recoveryKey: KEY_2 }),
    });
    expect(rot.status).toBe(200);
    expect(await rot.json()).toMatchObject({ enabled: false, recoveryKeySet: true });
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(recorder.seen).toEqual([KEY_2]);
    const file = parseEnvFile(await readFile(join(stateDir, "backup.env"), "utf8"));
    expect(file.WAITRON_BACKUP_RECOVERY_KEY).toBe(KEY_2);
    expect(typeof file.WAITRON_BACKUP_KEY_ROTATED_AT).toBe("string");
    // Rotating the key did not invent an archive destination.
    expect(file.WAITRON_BACKUP_DIR).toBeUndefined();
    expect(sup.current().enabled).toBe(false);

    const after = await app.request("/api/backup/recovery-key", { headers: { cookie } });
    expect((await after.json()).key).toBe(KEY_2);
  }, 60_000);

  it("re-locks the state row even when a destination-less rotate fails loud", async () => {
    const stateDir = await makeStateDir();
    await writeRecoveryKey(stateDir, { recoveryKey: KEY_1, keyRotatedAt: undefined });
    const sup = makeSupervisor({ stateDir, base: {}, role: "primary" });
    await sup.reload();
    const recorder = recordingRefresher(stateDir);
    // The box env keeps answering the old key, as an override would, so the rotate is refused.
    const app = buildApp(sup, stateDir, {}, async () => KEY_1, recorder);
    const cookie = await login(app);
    const res = await app.request("/api/backup/rotate", {
      method: "POST",
      headers: { cookie, "content-type": "application/json" },
      body: JSON.stringify({ recoveryKey: KEY_2 }),
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: { code: "backup.effective_mismatch" } });
    expect(recorder.seen).toEqual([KEY_2]);
  }, 60_000);

  it("refuses a too-short key on a destination-less rotate before writing", async () => {
    const stateDir = await makeStateDir();
    await writeRecoveryKey(stateDir, { recoveryKey: KEY_1, keyRotatedAt: undefined });
    const sc: Scenario = { stateDir, base: {}, role: "primary" };
    const app = buildApp(makeSupervisor(sc), stateDir);
    const cookie = await login(app);
    const rot = await app.request("/api/backup/rotate", {
      method: "POST",
      headers: { cookie, "content-type": "application/json" },
      body: JSON.stringify({ recoveryKey: "short" }),
    });
    expect(rot.status).toBe(400);
    expect(await rot.json()).toMatchObject({ error: { code: "backup.recovery_key_too_short" } });
    expect(parseEnvFile(await readFile(join(stateDir, "backup.env"), "utf8"))).toEqual({
      WAITRON_BACKUP_RECOVERY_KEY: KEY_1,
    });
  }, 60_000);

  it("turning archives on reuses the key the box already holds, and reports that one is set", async () => {
    const stateDir = await makeStateDir();
    await writeRecoveryKey(stateDir, { recoveryKey: KEY_1, keyRotatedAt: undefined });
    const sc: Scenario = { stateDir, base: {}, role: "primary" };
    const sup = makeSupervisor(sc);
    await sup.reload();
    const app = buildApp(sup, stateDir);
    const cookie = await login(app);

    const before = await app.request("/api/backup/status", { headers: { cookie } });
    expect(await before.json()).toMatchObject({ enabled: false, recoveryKeySet: true });

    const res = await app.request("/api/backup/apply", {
      method: "POST",
      headers: { cookie, "content-type": "application/json" },
      // No key in the body: the box's own is the one archives are locked with.
      body: JSON.stringify({
        destinations: [{ kind: "local-fs", dir: makeDestDir() }],
        schedule: DAILY_AT_0330,
        retention: RETENTION,
      }),
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ enabled: true, recoveryKeySet: true });
    const file = parseEnvFile(await readFile(join(stateDir, "backup.env"), "utf8"));
    expect(file.WAITRON_BACKUP_RECOVERY_KEY).toBe(KEY_1);
    expect(sup.current().recoveryKey).toBe(KEY_1);
  }, 60_000);

  it("refuses a different key while one is held, before writing anything", async () => {
    const stateDir = await makeStateDir();
    await writeRecoveryKey(stateDir, { recoveryKey: KEY_1, keyRotatedAt: undefined });
    const sc: Scenario = { stateDir, base: {}, role: "primary" };
    const app = buildApp(makeSupervisor(sc), stateDir);
    const cookie = await login(app);
    const res = await app.request("/api/backup/apply", {
      method: "POST",
      headers: { cookie, "content-type": "application/json" },
      body: JSON.stringify({
        destinations: [{ kind: "local-fs", dir: makeDestDir() }],
        recoveryKey: KEY_2,
        schedule: DAILY_AT_0330,
        retention: RETENTION,
      }),
    });
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ error: { code: "backup.recovery_key_exists" } });
    expect(parseEnvFile(await readFile(join(stateDir, "backup.env"), "utf8"))).toEqual({
      WAITRON_BACKUP_RECOVERY_KEY: KEY_1,
    });
  }, 60_000);

  it("reports a too-short key in backup.env as set, and still answers status, with no destination", async () => {
    const stateDir = await makeStateDir();
    await writeFile(join(stateDir, "backup.env"), "WAITRON_BACKUP_RECOVERY_KEY=short\n");
    const sc: Scenario = { stateDir, base: {}, role: "primary" };
    const sup = makeSupervisor(sc);
    await sup.reload();
    const app = buildApp(sup, stateDir, sc.base);
    const cookie = await login(app);
    const st = await app.request("/api/backup/status", { headers: { cookie } });
    expect(st.status).toBe(200);
    expect(await st.json()).toMatchObject({ enabled: false, recoveryKeySet: true });
    // A key no archive would accept is not handed out to be recorded.
    const rk = await app.request("/api/backup/recovery-key", { headers: { cookie } });
    expect(rk.status).toBe(400);
    expect(await rk.json()).toMatchObject({ error: { code: "backup.recovery_key_too_short" } });
  }, 60_000);

  it("rotate replaces a too-short key held with no destination", async () => {
    const stateDir = await makeStateDir();
    await writeFile(join(stateDir, "backup.env"), "WAITRON_BACKUP_RECOVERY_KEY=short\n");
    const sc: Scenario = { stateDir, base: {}, role: "primary" };
    const sup = makeSupervisor(sc);
    await sup.reload();
    const app = buildApp(sup, stateDir, sc.base);
    const cookie = await login(app);
    const rot = await app.request("/api/backup/rotate", {
      method: "POST",
      headers: { cookie, "content-type": "application/json" },
      body: JSON.stringify({ recoveryKey: KEY_2 }),
    });
    expect(rot.status).toBe(200);
    const rotated = await rot.json();
    expect(rotated).toMatchObject({ enabled: false, recoveryKeySet: true });
    expect(rotated.recoveryKeyTooShort).toBe(false);
    const file = parseEnvFile(await readFile(join(stateDir, "backup.env"), "utf8"));
    expect(file.WAITRON_BACKUP_RECOVERY_KEY).toBe(KEY_2);
    expect(file.WAITRON_BACKUP_DIR).toBeUndefined();
    const rk = await app.request("/api/backup/recovery-key", { headers: { cookie } });
    expect((await rk.json()).key).toBe(KEY_2);
  }, 60_000);

  it("turning archives on replaces a too-short held key with the one sent", async () => {
    const stateDir = await makeStateDir();
    await writeFile(join(stateDir, "backup.env"), "WAITRON_BACKUP_RECOVERY_KEY=short\n");
    const sc: Scenario = { stateDir, base: {}, role: "primary" };
    const sup = makeSupervisor(sc);
    await sup.reload();
    const app = buildApp(sup, stateDir, sc.base);
    const cookie = await login(app);

    const before = await app.request("/api/backup/status", { headers: { cookie } });
    expect(await before.json()).toMatchObject({ recoveryKeySet: true, recoveryKeyTooShort: true });

    const res = await app.request("/api/backup/apply", {
      method: "POST",
      headers: { cookie, "content-type": "application/json" },
      body: JSON.stringify({
        destinations: [{ kind: "local-fs", dir: makeDestDir() }],
        recoveryKey: KEY_1,
        schedule: DAILY_AT_0330,
        retention: RETENTION,
      }),
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      enabled: true,
      recoveryKeySet: true,
      recoveryKeyTooShort: false,
    });
    const file = parseEnvFile(await readFile(join(stateDir, "backup.env"), "utf8"));
    expect(file.WAITRON_BACKUP_RECOVERY_KEY).toBe(KEY_1);
    expect(sup.current().recoveryKey).toBe(KEY_1);
  }, 60_000);

  it("still refuses to turn archives on with a too-short held key when no key is sent", async () => {
    const stateDir = await makeStateDir();
    await writeFile(join(stateDir, "backup.env"), "WAITRON_BACKUP_RECOVERY_KEY=short\n");
    const sc: Scenario = { stateDir, base: {}, role: "primary" };
    const sup = makeSupervisor(sc);
    await sup.reload();
    const app = buildApp(sup, stateDir, sc.base);
    const cookie = await login(app);
    const res = await app.request("/api/backup/apply", {
      method: "POST",
      headers: { cookie, "content-type": "application/json" },
      body: JSON.stringify({
        destinations: [{ kind: "local-fs", dir: makeDestDir() }],
        schedule: DAILY_AT_0330,
        retention: RETENTION,
      }),
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: { code: "backup.recovery_key_too_short" } });
    expect(await readFile(join(stateDir, "backup.env"), "utf8")).toBe(
      "WAITRON_BACKUP_RECOVERY_KEY=short\n",
    );
  }, 60_000);

  it("does not report a held key long enough to use as too short", async () => {
    const stateDir = await makeStateDir();
    await writeRecoveryKey(stateDir, { recoveryKey: KEY_1, keyRotatedAt: undefined });
    const sc: Scenario = { stateDir, base: {}, role: "primary" };
    const sup = makeSupervisor(sc);
    await sup.reload();
    const app = buildApp(sup, stateDir, sc.base);
    const cookie = await login(app);
    const st = await app.request("/api/backup/status", { headers: { cookie } });
    expect(await st.json()).toMatchObject({ recoveryKeySet: true, recoveryKeyTooShort: false });
  }, 60_000);

  it("reports a too-short key from the process env as set, and still answers status, with no destination", async () => {
    const stateDir = await makeStateDir();
    const sc: Scenario = {
      stateDir,
      base: { WAITRON_BACKUP_RECOVERY_KEY: "short" },
      role: "primary",
    };
    const sup = makeSupervisor(sc);
    await sup.reload();
    const app = buildApp(sup, stateDir, sc.base);
    const cookie = await login(app);
    const st = await app.request("/api/backup/status", { headers: { cookie } });
    expect(st.status).toBe(200);
    expect(await st.json()).toMatchObject({
      enabled: false,
      managedByEnvironment: true,
      recoveryKeySet: true,
      recoveryKeyTooShort: true,
    });
    // The environment owns this key, so rotate refuses before writing anything.
    const rot = await app.request("/api/backup/rotate", {
      method: "POST",
      headers: { cookie, "content-type": "application/json" },
      body: JSON.stringify({ recoveryKey: KEY_2 }),
    });
    expect(rot.status).toBe(409);
    expect(await rot.json()).toMatchObject({ error: { code: "backup.managed_by_environment" } });
    await expect(readFile(join(stateDir, "backup.env"), "utf8")).rejects.toThrow();
  }, 60_000);

  it("refuses a different key when the held key comes from the supervisor's own loaded settings (archives already on)", async () => {
    const stateDir = await makeStateDir();
    const sc: Scenario = { stateDir, base: {}, role: "primary" };
    const sup = makeSupervisor(sc);
    // The box-env reader answers nothing, so only the supervisor's loaded settings hold the key.
    const app = buildApp(sup, stateDir, sc.base, async () => undefined);
    const cookie = await login(app);
    const apply = (recoveryKey: string) =>
      app.request("/api/backup/apply", {
        method: "POST",
        headers: { cookie, "content-type": "application/json" },
        body: JSON.stringify({
          destinations: [{ kind: "local-fs", dir: makeDestDir() }],
          recoveryKey,
          schedule: DAILY_AT_0330,
          retention: RETENTION,
        }),
      });
    expect((await apply(KEY_1)).status).toBe(200);
    expect(sup.current().recoveryKey).toBe(KEY_1);
    const before = await readFile(join(stateDir, "backup.env"), "utf8");

    const res = await apply(KEY_2);
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ error: { code: "backup.recovery_key_exists" } });
    expect(await readFile(join(stateDir, "backup.env"), "utf8")).toBe(before);
  }, 60_000);

  it("accepts the SAME key again while archives are on", async () => {
    const stateDir = await makeStateDir();
    const sc: Scenario = { stateDir, base: {}, role: "primary" };
    const sup = makeSupervisor(sc);
    const app = buildApp(sup, stateDir);
    const cookie = await login(app);
    const apply = (retention: { count: number; days: number }) =>
      app.request("/api/backup/apply", {
        method: "POST",
        headers: { cookie, "content-type": "application/json" },
        body: JSON.stringify({
          destinations: [{ kind: "local-fs", dir: makeDestDir() }],
          recoveryKey: KEY_1,
          schedule: DAILY_AT_0330,
          retention,
        }),
      });
    expect((await apply(RETENTION)).status).toBe(200);

    const res = await apply({ count: 3, days: 10 });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ enabled: true, recoveryKeySet: true });
    const file = parseEnvFile(await readFile(join(stateDir, "backup.env"), "utf8"));
    expect(file.WAITRON_BACKUP_RECOVERY_KEY).toBe(KEY_1);
    expect((await readSealed())?.retention).toEqual({ count: 3, days: 10 });
    expect(sup.current().recoveryKey).toBe(KEY_1);
  }, 60_000);

  it("rejects malformed apply/rotate bodies and unconfigured rotate without touching disk", async () => {
    const sc: Scenario = { stateDir: await makeStateDir(), base: {}, role: "primary" };
    const app = buildApp(makeSupervisor(sc), sc.stateDir); // never reloaded → no config
    const cookie = await login(app);
    const post = (path: string, body: unknown) =>
      app.request(path, {
        method: "POST",
        headers: { cookie, "content-type": "application/json" },
        body: JSON.stringify(body),
      });
    const dest = makeDestDir();
    const good = {
      destinations: [{ kind: "local-fs", dir: dest }],
      recoveryKey: KEY_1,
      retention: RETENTION,
    };
    // Every malformed apply body → 400 backup.request_invalid, rejected before any write.
    const bad: unknown[] = [
      {}, // destinations missing
      {
        destinations: [{ kind: "local-fs", dir: dest }],
        schedule: DAILY_AT_0330,
        retention: RETENTION,
      }, // recoveryKey missing
      { ...good, schedule: "nope" }, // schedule not an object
      { ...good, schedule: { kind: "bogus" } }, // unknown schedule kind
      { ...good, schedule: { kind: "interval", ms: 0 } }, // interval ms not positive
      { ...good, schedule: { kind: "wall-clock", days: [9], at: "auto" } }, // weekday out of range
      { ...good, schedule: { kind: "wall-clock", days: "daily", at: { hour: "x" } } }, // bad time
      {
        destinations: [{ kind: "local-fs", dir: dest }],
        recoveryKey: KEY_1,
        schedule: DAILY_AT_0330,
        retention: "nope",
      }, // retention not object
      { ...good, schedule: DAILY_AT_0330, retention: { count: 0, days: 30 } }, // count not positive
      { ...good, schedule: DAILY_AT_0330, retention: { count: 7, days: -1 } }, // days not positive
    ];
    for (const body of bad) {
      const res = await post("/api/backup/apply", body);
      expect(res.status).toBe(400);
      expect(await res.json()).toMatchObject({ error: { code: "backup.request_invalid" } });
    }
    expect(
      (await (await app.request("/api/backup/status", { headers: { cookie } })).json())
        .recoveryKeySet,
    ).toBe(false);
    // rotate with no key → request_invalid; with a bad key → unstorable; with a good key but nothing
    // configured to rotate → request_invalid (field "config"). All before any write.
    expect((await post("/api/backup/rotate", {})).status).toBe(400);
    const badKey = await post("/api/backup/rotate", { recoveryKey: "bad key " });
    expect(await badKey.json()).toMatchObject({
      error: { code: "backup.recovery_key_unstorable" },
    });
    const noConfig = await post("/api/backup/rotate", { recoveryKey: KEY_1 });
    expect(await noConfig.json()).toMatchObject({ error: { code: "backup.request_invalid" } });
    // recovery-key on an unconfigured box → null, not a throw.
    const rk = await app.request("/api/backup/recovery-key", { headers: { cookie } });
    expect((await rk.json()).key).toBeNull();
    await expect(readFile(join(sc.stateDir, "backup.env"), "utf8")).rejects.toThrow();
  }, 60_000);

  it("apply rejects a config the boot loader would reject (too-short key) before writing", async () => {
    const stateDir = await makeStateDir();
    const sc: Scenario = { stateDir, base: {}, role: "primary" };
    const app = buildApp(makeSupervisor(sc), stateDir);
    const cookie = await login(app);
    const res = await app.request("/api/backup/apply", {
      method: "POST",
      headers: { cookie, "content-type": "application/json" },
      body: JSON.stringify({
        destinations: [{ kind: "local-fs", dir: makeDestDir() }],
        recoveryKey: "short", // storable, but under MIN_PASSPHRASE_LENGTH
        schedule: DAILY_AT_0330,
        retention: RETENTION,
      }),
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: { code: "backup.recovery_key_too_short" } });
    // The dry-validate ran BEFORE any write — no backup.env was created.
    await expect(readFile(join(stateDir, "backup.env"), "utf8")).rejects.toThrow();
  });

  it("an apply while another reload is in flight saves, and answers the reload's code", async () => {
    // The routes wait for each other, so the reload holding the latch is one started on the
    // supervisor directly. A gated `buildConfig` parks it inside its critical section, so the apply
    // hits the latch deterministically. It must map to 409, NOT the boundary's default 400.
    const dest = makeDestDir();
    const stateDir = await makeStateDir();
    let release!: () => void;
    const gate = new Promise<void>((r) => {
      release = r;
    });
    let entered!: () => void;
    const enteredOnce = new Promise<void>((r) => {
      entered = r;
    });
    let buildCalls = 0;
    const base: NodeJS.ProcessEnv = {};
    const sup = new BackupSupervisor({
      buildConfig: async () => {
        buildCalls += 1;
        if (buildCalls === 1) {
          entered(); // the first reload is now inside its critical section, holding the latch…
          await gate; // …and parked here until we release it
        }
        return resolveBackupConfig({
          managedByEnvironment: false,
          env: await loadBoxEnv(base, stateDir),
          sealed: await readSealed(),
          venueId: VENUE,
        });
      },
      isManagedByEnvironment: () => false,
      readSingletonRole: () => "primary",
      venueDir,
      modules: ALL_MODULES,
      environment: "production",
      stateDir,
      jitterSeed: "seed",
      readClock: async () => ({ timeZone: "UTC", dayCutover: "00:00", cutoverChanges: [] }),
      log: () => {},
    });
    cleanup.push(() => sup.stop());
    const recorder = recordingRefresher(stateDir);
    const app = buildApp(sup, stateDir, {}, undefined, recorder);
    const cookie = await login(app);
    const body = JSON.stringify({
      destinations: [{ kind: "local-fs", dir: dest }],
      recoveryKey: KEY_1,
      schedule: DAILY_AT_0330,
      retention: RETENTION,
    });
    const first = sup.reload(); // parks inside reload() → holds the latch
    await enteredOnce;
    const second = await app.request("/api/backup/apply", {
      method: "POST",
      headers: { cookie, "content-type": "application/json" },
      body,
    });
    // The settings committed before the reload was refused: a load failure, not a failed save.
    expect(second.status).toBe(200);
    expect(await second.json()).toMatchObject({ reloadErrorCode: "backup.reload_in_progress" });
    expect((await readSealed())?.destinations).toEqual([
      { kind: "local-fs", id: "primary", dir: dest },
    ]);
    expect(recorder.seen).toEqual([KEY_1, KEY_1]);
    release();
    await first; // the parked reload completes normally once released
  }, 60_000);

  // One route is parked right after its first read of the held key; the other is sent while it waits.
  // Unserialised, the second runs to completion inside that window and the first then writes (or
  // leaves loaded) the key it read beforehand.
  async function raceKeyWrites(parked: "apply" | "rotate") {
    const stateDir = await makeStateDir();
    await writeRecoveryKey(stateDir, { recoveryKey: KEY_1, keyRotatedAt: undefined });
    const sup = makeSupervisor({ stateDir, base: {}, role: "primary" });
    let release!: () => void;
    const gate = new Promise<void>((r) => {
      release = r;
    });
    let entered!: () => void;
    const paused = new Promise<void>((r) => {
      entered = r;
    });
    let first = true;
    const app = buildApp(sup, stateDir, {}, async () => {
      const key = loadRecoveryKey(await loadBoxEnv({}, stateDir));
      if (first) {
        first = false;
        entered();
        await gate;
      }
      return key;
    });
    const cookie = await login(app);
    const headers = { cookie, "content-type": "application/json" };
    const apply = () =>
      app.request("/api/backup/apply", {
        method: "POST",
        headers,
        body: JSON.stringify({
          destinations: [{ kind: "local-fs", dir: makeDestDir() }],
          schedule: DAILY_AT_0330,
          retention: RETENTION,
        }),
      });
    const rotate = () =>
      app.request("/api/backup/rotate", {
        method: "POST",
        headers,
        body: JSON.stringify({ recoveryKey: KEY_2 }),
      });

    const firstReq = parked === "apply" ? apply() : rotate();
    await paused;
    const secondReq = parked === "apply" ? rotate() : apply();
    // Queued, the second request cannot settle, so the timer releases the parked one; unqueued, the
    // test relies on the second request finishing within that second.
    await Promise.race([secondReq, new Promise((r) => setTimeout(r, 1_000))]);
    release();
    const [firstRes, secondRes] = await Promise.all([firstReq, secondReq]);
    const [applied, rotated] = parked === "apply" ? [firstRes, secondRes] : [secondRes, firstRes];
    return { applied, rotated, sup, stateDir, app, cookie };
  }

  for (const parked of ["apply", "rotate"] as const) {
    it(`a rotate that succeeds leaves its key in effect when ${parked} is parked mid-request`, async () => {
      const { applied, rotated, sup, stateDir, app, cookie } = await raceKeyWrites(parked);
      expect(rotated.status).toBe(200);
      expect(applied.status).toBe(200);
      expect(loadRecoveryKey(await loadBoxEnv({}, stateDir))).toBe(KEY_2);
      expect(sup.current().recoveryKey).toBe(KEY_2);
      const rk = await app.request("/api/backup/recovery-key", { headers: { cookie } });
      expect((await rk.json()).key).toBe(KEY_2);
    }, 60_000);
  }

  it("a write queued behind another is refused if the node stopped being primary while it waited", async () => {
    const stateDir = await makeStateDir();
    await writeRecoveryKey(stateDir, { recoveryKey: KEY_1, keyRotatedAt: undefined });
    const sc: Scenario = { stateDir, base: {}, role: "primary" };
    const sup = makeSupervisor(sc);
    let release!: () => void;
    const gate = new Promise<void>((r) => {
      release = r;
    });
    let entered!: () => void;
    const paused = new Promise<void>((r) => {
      entered = r;
    });
    let first = true;
    const app = buildApp(sup, stateDir, {}, async () => {
      const key = loadRecoveryKey(await loadBoxEnv({}, stateDir));
      if (first) {
        first = false;
        entered();
        await gate;
      }
      return key;
    });
    const cookie = await login(app);
    const headers = { cookie, "content-type": "application/json" };

    const rotateReq = app.request("/api/backup/rotate", {
      method: "POST",
      headers,
      body: JSON.stringify({ recoveryKey: KEY_2 }),
    });
    await paused;
    const applyReq = app.request("/api/backup/apply", {
      method: "POST",
      headers,
      body: JSON.stringify({
        destinations: [{ kind: "local-fs", dir: makeDestDir() }],
        schedule: DAILY_AT_0330,
        retention: RETENTION,
      }),
    });
    // Let the apply pass its arrival check and join the queue while the node is still primary.
    await Promise.race([applyReq, new Promise((r) => setTimeout(r, 1_000))]);
    sc.role = "secondary";
    release();
    const [rotated, applied] = await Promise.all([rotateReq, applyReq]);

    expect(rotated.status).toBe(200);
    expect(applied.status).toBe(409);
    expect(await applied.json()).toMatchObject({ error: { code: "backup.not_primary" } });
    const env = parseEnvFile(await readFile(join(stateDir, "backup.env"), "utf8"));
    expect(await readSealed()).toBeNull();
    expect(env.WAITRON_BACKUP_RECOVERY_KEY).toBe(KEY_2);
    expect(sup.current().destinations).toEqual([]);
  }, 60_000);

  it("a refused write does not hold up the next one", async () => {
    const stateDir = await makeStateDir();
    await writeRecoveryKey(stateDir, { recoveryKey: KEY_1, keyRotatedAt: undefined });
    const app = buildApp(makeSupervisor({ stateDir, base: {}, role: "primary" }), stateDir);
    const cookie = await login(app);
    const headers = { cookie, "content-type": "application/json" };
    const refused = await app.request("/api/backup/apply", {
      method: "POST",
      headers,
      body: JSON.stringify({
        destinations: [{ kind: "local-fs", dir: makeDestDir() }],
        recoveryKey: KEY_2,
        schedule: DAILY_AT_0330,
        retention: RETENTION,
      }),
    });
    expect(refused.status).toBe(409);
    expect(await refused.json()).toMatchObject({
      error: { code: "backup.recovery_key_exists" },
    });
    const rotated = await app.request("/api/backup/rotate", {
      method: "POST",
      headers,
      body: JSON.stringify({ recoveryKey: KEY_2 }),
    });
    expect(rotated.status).toBe(200);
    expect(loadRecoveryKey(await loadBoxEnv({}, stateDir))).toBe(KEY_2);
  }, 60_000);
  // Both write backup.env after reading the key it holds, so they take turns with each other.
  it("a stream Save sent while apply holds its turn keeps apply's key and settings", async () => {
    const dest = makeDestDir();
    const sc: Scenario = { stateDir: await makeStateDir(), base: {}, role: "primary" };
    const readKey = async (): Promise<string | undefined> =>
      loadRecoveryKey(await loadBoxEnv({}, sc.stateDir));
    let release!: () => void;
    const held = new Promise<void>((resolve) => (release = resolve));
    let applyReached!: () => void;
    const applyReading = new Promise<void>((resolve) => (applyReached = resolve));
    let firstRead = true;
    const turns = createTurns();
    const app = buildApp(
      makeSupervisor(sc),
      sc.stateDir,
      {},
      async () => {
        if (firstRead) {
          firstRead = false;
          applyReached();
          await held;
        }
        return readKey();
      },
      undefined,
      undefined,
      turns,
    );
    mountStreamApi(
      app,
      {
        db: suite.db,
        ring: RING,
        stream: { reload: async () => {}, status: () => ({ state: "off" }) },
        nodeId: "00000000-0000-0000-0000-000000000000",
        venueId: "c0000000-0000-4000-8000-000000000002",
        isPrimary: () => true,
        isManagedByEnvironment: () => false,
        loadedArchives: () => [],
        readRecoveryKey: readKey,
        writeRecoveryKey: (recoveryKey) =>
          writeRecoveryKey(sc.stateDir, { recoveryKey, keyRotatedAt: undefined }),
        sealedState: { refresh: async () => "sealed" },
        probe: async () => ({ ok: true }),
        turns,
      },
      () => {},
    );
    const cookie = await login(app);
    const apply = app.request("/api/backup/apply", {
      method: "POST",
      headers: { cookie, "content-type": "application/json" },
      body: JSON.stringify({
        destinations: [{ kind: "local-fs", dir: dest }],
        recoveryKey: KEY_1,
        schedule: DAILY_AT_0330,
        retention: RETENTION,
      }),
    });
    await applyReading;
    const save = app.request("/api/backup/stream", {
      method: "PUT",
      headers: { cookie, "content-type": "application/json" },
      body: JSON.stringify({
        region: "eu-west-1",
        bucket: "venue-copy",
        accessKeyId: "AKIAEXAMPLE",
        secretAccessKey: "not-a-real-secret-0123456789",
      }),
    });
    // Long enough for a Save that does not wait its turn to finish.
    try {
      await Promise.race([save, new Promise((resolve) => setTimeout(resolve, 500))]);
      release();
      const [applied, saved] = await Promise.all([apply, save]);
      expect(await applied.json()).toMatchObject({ enabled: true });
      expect(saved.status).toBe(200);
      expect((await saved.json()).keyFingerprint).toBe(keyFingerprint(KEY_1));
      const env = parseEnvFile(await readFile(join(sc.stateDir, "backup.env"), "utf8"));
      expect(env.WAITRON_BACKUP_RECOVERY_KEY).toBe(KEY_1);
      expect((await readSealed())?.destinations).toEqual([
        { kind: "local-fs", id: "primary", dir: dest },
      ]);
    } finally {
      release();
      await Promise.allSettled([apply, save]);
      await withTransaction(suite.db, (tx) => deleteCredential(tx, { purpose: "backup.stream" }));
    }
  }, 60_000);

  describe("archive settings", () => {
    const STREAM_SECRET = "stream-secret-0123456789abcdef";
    const CUSTOM_SECRET = "custom-secret-0123456789abcdef";
    const STREAM_BUCKET = {
      region: "eu-west-1",
      bucket: "venue-copy",
      prefix: "",
      accessKeyId: "AKIASTREAM",
      secretAccessKey: STREAM_SECRET,
    };
    const CUSTOM = {
      kind: "custom-s3",
      region: "eu-west-1",
      bucket: "archive-bucket",
      accessKeyId: "AKIACUSTOM",
    } as const;

    async function storeStream(): Promise<void> {
      await withTransaction(suite.db, (tx) =>
        putCredential(tx, RING, {
          purpose: "backup.stream",
          value: streamSettingsPayload({ venueId: VENUE, bucket: STREAM_BUCKET }),
        }),
      );
    }

    async function primaryApp(
      extra: Partial<BackupApiDeps> = {},
      mount: (app: Hono, sc: Scenario) => void = () => {},
      log?: Logger,
    ) {
      const sc: Scenario = { stateDir: await makeStateDir(), base: {}, role: "primary" };
      const sup = makeSupervisor(sc);
      const app = buildApp(
        sup,
        sc.stateDir,
        {},
        undefined,
        undefined,
        undefined,
        undefined,
        extra,
        log,
      );
      mount(app, sc);
      const cookie = await login(app);
      const post = (path: string, body?: unknown) =>
        app.request(path, {
          method: "POST",
          headers: { cookie, "content-type": "application/json" },
          ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        });
      const status = async () =>
        (await app.request("/api/backup/status", { headers: { cookie } })).json();
      return { sc, sup, app, cookie, post, status };
    }

    const applyBody = (destination: unknown, recoveryKey: string | undefined = KEY_1) => ({
      destinations: [destination],
      ...(recoveryKey === undefined ? {} : { recoveryKey }),
      schedule: DAILY_AT_0330,
      retention: RETENTION,
    });

    const probeCalls = () => {
      const key = bucket.calls.find((c) => c.startsWith("put waitron-probe-"))?.slice(4);
      expect(key).toBeDefined();
      return { key: key!, calls: bucket.calls.filter((c) => c.includes(key!)) };
    };

    async function backupEnvKeys(stateDir: string): Promise<string[]> {
      return Object.keys(parseEnvFile(await readFile(join(stateDir, "backup.env"), "utf8")));
    }

    it("a local folder is stored sealed, starts archives, and leaves only the key in backup.env", async () => {
      const { sc, sup, post } = await primaryApp();
      const dir = makeDestDir();
      const res = await post("/api/backup/apply", applyBody({ kind: "local-fs", dir }));
      expect(res.status).toBe(200);
      const body = await res.json();
      const sealed = await readSealed();
      expect(sealed).toMatchObject({
        enabled: true,
        destinations: [{ kind: "local-fs", id: "primary", dir }],
        schedule: DAILY_AT_0330,
        retention: RETENTION,
        destinationTimeoutMs: 15 * 60 * 1000,
      });
      expect(body).toMatchObject({
        enabled: true,
        source: "dashboard",
        revision: sealed!.revision,
      });
      expect(body.reloadErrorCode).toBeUndefined();
      expect(sup.current().enabled).toBe(true);
      expect(await backupEnvKeys(sc.stateDir)).toEqual(["WAITRON_BACKUP_RECOVERY_KEY"]);
    }, 60_000);

    it("the stream's bucket is copied with its secret, which no status shows", async () => {
      await storeStream();
      const { post, status } = await primaryApp();
      const res = await post("/api/backup/apply", applyBody({ kind: "stream-bucket" }));
      expect(res.status).toBe(200);
      const answered = await res.text();
      const savedS3 = (await readSealed())!.destinations[0] as Extract<
        BackupDestination,
        { kind: "s3" }
      >;
      expect(savedS3.bucket.secretAccessKey).toBe(STREAM_SECRET);
      expect(savedS3).toMatchObject({
        kind: "s3",
        venueId: VENUE,
        bucket: { bucket: "venue-copy" },
      });
      expect(answered).not.toContain(STREAM_SECRET);
      expect(JSON.stringify(await status())).not.toContain(STREAM_SECRET);
    }, 60_000);

    it("removing the stream leaves the archive's copied bucket alone", async () => {
      await storeStream();
      const { app, cookie, post, status } = await primaryApp({}, (app, sc) =>
        mountStreamApi(
          app,
          {
            db: suite.db,
            ring: RING,
            stream: { reload: async () => {}, status: () => ({ state: "off" }) },
            nodeId: "00000000-0000-0000-0000-000000000000",
            venueId: VENUE,
            isPrimary: () => true,
            isManagedByEnvironment: () => false,
            loadedArchives: () => [],
            readRecoveryKey: async () => loadRecoveryKey(await loadBoxEnv({}, sc.stateDir)),
            writeRecoveryKey: async () => {},
            sealedState: { refresh: async () => "sealed" },
            probe: async () => ({ ok: true }),
            turns: createTurns(),
          },
          () => {},
        ),
      );
      expect((await post("/api/backup/apply", applyBody({ kind: "stream-bucket" }))).status).toBe(
        200,
      );
      const saved = await status();
      const sealedBefore = await readSealed();
      const removed = await app.request("/api/backup/stream", {
        method: "DELETE",
        headers: { cookie },
      });
      expect(removed.status).toBe(200);
      expect(await readStreamSettings(suite.db, RING)).toBeNull();
      const afterStreamRemoval = await status();
      expect(afterStreamRemoval.destinations).toEqual(saved.destinations);
      const sealedAfter = await readSealed();
      expect(sealedAfter).toEqual(sealedBefore);
      expect(
        (sealedAfter!.destinations[0] as Extract<BackupDestination, { kind: "s3" }>).bucket
          .secretAccessKey,
      ).toBe(STREAM_SECRET);
    }, 60_000);

    it("a custom bucket's first Save with no secret is refused before anything is written", async () => {
      const { sc, post } = await primaryApp();
      const res = await post("/api/backup/apply", applyBody({ ...CUSTOM, secretAccessKey: "" }));
      expect(res.status).toBe(400);
      expect(await res.json()).toMatchObject({
        error: { code: "backup.request_invalid", params: { field: "secretAccessKey" } },
      });
      expect(await readSealed()).toBeNull();
      expect(bucket.calls).toEqual([]);
      await expect(readFile(join(sc.stateDir, "backup.env"), "utf8")).rejects.toThrow();
    }, 60_000);

    it("an unchanged custom bucket sent with no secret keeps the stored one, under a new revision", async () => {
      const { post } = await primaryApp();
      const first = await post(
        "/api/backup/apply",
        applyBody({ ...CUSTOM, secretAccessKey: CUSTOM_SECRET }),
      );
      expect(first.status).toBe(200);
      const oldRevision = (await readSealed())!.revision;
      const second = await post("/api/backup/apply", {
        ...applyBody({ ...CUSTOM, secretAccessKey: "" }, undefined),
        retention: { count: 3, days: 10 },
      });
      expect(second.status).toBe(200);
      const stored = (await readSealed())!;
      const newRevision = stored.revision;
      expect(newRevision).not.toBe(oldRevision);
      expect(stored.retention).toEqual({ count: 3, days: 10 });
      expect(
        (stored.destinations[0] as Extract<BackupDestination, { kind: "s3" }>).bucket
          .secretAccessKey,
      ).toBe(CUSTOM_SECRET);
    }, 60_000);

    it("status names a bucket destination's access key id and chosen folder, never its secret", async () => {
      const { post, status } = await primaryApp();
      const res = await post(
        "/api/backup/apply",
        applyBody({ ...CUSTOM, prefix: "chosen", secretAccessKey: CUSTOM_SECRET }),
      );
      expect(res.status).toBe(200);
      const stored = (await readSealed())!.destinations[0] as Extract<
        BackupDestination,
        { kind: "s3" }
      >;
      const answered = await status();
      expect(answered.destinations).toEqual([
        expect.objectContaining({
          kind: "s3",
          prefix: stored.bucket.prefix,
          accessKeyId: "AKIACUSTOM",
        }),
      ]);
      expect(stored.bucket.prefix).toContain("chosen");
      expect(JSON.stringify(answered)).not.toContain(CUSTOM_SECRET);
    }, 60_000);

    it("status carries the venue id", async () => {
      const { status } = await primaryApp();
      expect((await status()).venueId).toBe(VENUE);
    }, 60_000);

    it("an archive folder overlapping the stream's venue folder is refused with nothing written", async () => {
      await storeStream();
      const { sc, post } = await primaryApp();
      const res = await post(
        "/api/backup/apply",
        applyBody({
          ...CUSTOM,
          bucket: "venue-copy",
          prefix: `venues/${VENUE}`,
          secretAccessKey: CUSTOM_SECRET,
        }),
      );
      expect(res.status).toBe(400);
      expect(await res.json()).toMatchObject({
        error: { code: "backup.archive_namespace_overlap" },
      });
      expect(await readSealed()).toBeNull();
      expect(bucket.calls).toEqual([]);
      await expect(readFile(join(sc.stateDir, "backup.env"), "utf8")).rejects.toThrow();
    }, 60_000);

    it("Save tests the bucket with one object it then deletes alone", async () => {
      const archive = backupArchiveKey(new Date());
      const seeded = [archive, "waitron-probe-other", "notes.txt"];
      for (const key of seeded) bucket.objects.set(key, Buffer.from(key));
      // A real listing under the probe's name also returns any longer key that starts with it.
      const put = bucket.put.bind(bucket);
      bucket.put = async (key, bytes, call) => {
        await put(key, bytes, call);
        if (key.startsWith("waitron-probe-"))
          bucket.objects.set(`${key}-neighbour`, Buffer.from(""));
      };
      const { post } = await primaryApp();
      const res = await post(
        "/api/backup/apply",
        applyBody({ ...CUSTOM, secretAccessKey: CUSTOM_SECRET }),
      );
      expect(res.status).toBe(200);
      const { key, calls } = probeCalls();
      expect(parseBackupArchiveKey(key)).toBeNull();
      expect(parseBackupArchiveKey(archive)).not.toBeNull();
      expect(calls).toEqual([`put ${key}`, `get ${key}`, `list ${key}`, `deleteMany ${key}`]);
      expect(bucket.deleted.filter((keys) => keys.includes(key))).toEqual([[key]]);
      expect(bucket.deleted).toEqual([[key]]);
      expect(bucket.objects.has(key)).toBe(false);
      expect([...bucket.objects.keys()].sort()).toEqual([...seeded, `${key}-neighbour`].sort());
    }, 60_000);

    it("Save's bucket test closes the bucket it built, whether the test passes or fails", async () => {
      let closed = 0;
      // The route's own handle on the bucket, so the supervisor's handles are not counted.
      const probed: StorageBackend = Object.create(bucket);
      probed.close = () => {
        closed += 1;
      };
      const { post } = await primaryApp({ buildBackend: () => probed });
      const save = () =>
        post("/api/backup/apply", applyBody({ ...CUSTOM, secretAccessKey: CUSTOM_SECRET }));
      expect((await save()).status).toBe(200);
      expect(closed).toBe(1);
      bucket.failGet = true;
      expect((await save()).status).toBe(422);
      expect(closed).toBe(2);
    }, 60_000);

    it("a bucket that answers the test object with other bytes is refused", async () => {
      bucket.get = async (key) => {
        bucket.calls.push(`get ${key}`);
        return Buffer.from("something else");
      };
      const { post } = await primaryApp();
      const res = await post(
        "/api/backup/apply",
        applyBody({ ...CUSTOM, secretAccessKey: CUSTOM_SECRET }),
      );
      expect(res.status).toBe(422);
      expect(await res.json()).toMatchObject({
        error: { code: "backup.archive_test_failed", params: { reason: "read_mismatch" } },
      });
      const { key, calls } = probeCalls();
      expect(calls).toEqual([`put ${key}`, `get ${key}`, `deleteMany ${key}`]);
      expect(await readSealed()).toBeNull();
    }, 60_000);

    it("a bucket whose listing leaves out the test object is refused", async () => {
      bucket.list = async (prefix) => {
        bucket.calls.push(`list ${prefix}`);
        return [];
      };
      const { post } = await primaryApp();
      const res = await post(
        "/api/backup/apply",
        applyBody({ ...CUSTOM, secretAccessKey: CUSTOM_SECRET }),
      );
      expect(res.status).toBe(422);
      expect(await res.json()).toMatchObject({
        error: { code: "backup.archive_test_failed", params: { reason: "not_listed" } },
      });
      const { key, calls } = probeCalls();
      expect(calls).toEqual([`put ${key}`, `get ${key}`, `list ${key}`, `deleteMany ${key}`]);
      expect(await readSealed()).toBeNull();
    }, 60_000);

    it("a bucket that fails the test is refused, with the test object still deleted", async () => {
      bucket.failGet = true;
      const { sc, post } = await primaryApp();
      const res = await post(
        "/api/backup/apply",
        applyBody({ ...CUSTOM, secretAccessKey: CUSTOM_SECRET }),
      );
      expect(res.status).toBe(422);
      expect(await res.json()).toMatchObject({
        error: { code: "backup.archive_test_failed", params: { reason: "unknown" } },
      });
      const { key, calls } = probeCalls();
      expect(calls).toEqual([`put ${key}`, `get ${key}`, `deleteMany ${key}`]);
      expect(bucket.deleted).toEqual([[key]]);
      expect(await readSealed()).toBeNull();
      await expect(readFile(join(sc.stateDir, "backup.env"), "utf8")).rejects.toThrow();
    }, 60_000);

    it("a bucket that does not answer within the test's time limit is refused", async () => {
      bucket.hangPut = true;
      const { post } = await primaryApp({ archiveProbeTimeoutMs: 50 });
      const res = await post(
        "/api/backup/apply",
        applyBody({ ...CUSTOM, secretAccessKey: CUSTOM_SECRET }),
      );
      expect(res.status).toBe(422);
      expect(await res.json()).toMatchObject({
        error: { code: "backup.archive_test_failed", params: { reason: "timed_out" } },
      });
      const { key } = probeCalls();
      expect(bucket.deleted).toEqual([[key]]);
      expect(await readSealed()).toBeNull();
    }, 60_000);

    it("a write that commits but whose reload fails answers 200 with the reload's code", async () => {
      const { sup, post } = await primaryApp();
      vi.spyOn(sup, "reload").mockRejectedValueOnce(
        new AppError("backup.destinations_invalid", { reason: "bad_entry" }),
      );
      const res = await post(
        "/api/backup/apply",
        applyBody({ kind: "local-fs", dir: makeDestDir() }),
      );
      expect(res.status).toBe(200);
      expect(await res.json()).toMatchObject({ reloadErrorCode: "backup.destinations_invalid" });
      expect((await readSealed())?.enabled).toBe(true);
    }, 60_000);

    it("a write that commits but whose reload finds the stored settings unusable answers 200 with that code", async () => {
      const { sc, post } = await primaryApp();
      sc.readRecord = async () => {
        throw new AppError("backup.archive_settings_invalid", { reason: "fields" });
      };
      const res = await post(
        "/api/backup/apply",
        applyBody({ kind: "local-fs", dir: makeDestDir() }),
      );
      expect(res.status).toBe(200);
      expect(await res.json()).toMatchObject({
        reloadErrorCode: "backup.archive_settings_invalid",
        loadErrorCode: "backup.archive_settings_invalid",
        recoveryKeySet: true,
      });
      expect((await readSealed())?.enabled).toBe(true);
    }, 60_000);

    it("disable stores the settings switched off under a new revision, and runs no sweep", async () => {
      const { post, sup } = await primaryApp();
      const dir = makeDestDir();
      // None of these is what a Save without them would store.
      const saved = await post("/api/backup/apply", {
        ...applyBody({ kind: "local-fs", dir }),
        schedule: { kind: "wall-clock", days: [1, 4], at: { hour: 2, minute: 15 } },
        retention: { count: 3, days: 10 },
        destinationTimeoutMs: 60_000,
      });
      expect(saved.status).toBe(200);
      const before = (await readSealed())!;
      expect(before.enabled).toBe(true);
      const res = await post("/api/backup/disable");
      expect(res.status).toBe(200);
      expect(await res.json()).toMatchObject({ enabled: false, storedDisabled: true });
      const after = (await readSealed())!;
      expect(after.enabled).toBe(false);
      expect(after.revision).not.toBe(before.revision);
      expect(after.destinations).toEqual(before.destinations);
      expect({ ...after, revision: before.revision, enabled: true }).toEqual(before);
      expect(sup.current().enabled).toBe(false);
    }, 60_000);

    it("a disable queued behind another write is refused if the node stopped being primary while it waited", async () => {
      const inner = createTurns();
      let joined: (() => void) | undefined;
      const turns: Turns = (body) => {
        joined?.();
        return inner(body);
      };
      const { sc, post } = await primaryApp({ turns });
      expect(
        (await post("/api/backup/apply", applyBody({ kind: "local-fs", dir: makeDestDir() })))
          .status,
      ).toBe(200);
      const before = await readSealed();
      let release!: () => void;
      const holding = inner(
        () =>
          new Promise<void>((r) => {
            release = r;
          }),
      );
      const queued = new Promise<void>((r) => {
        joined = r;
      });
      const disabled = post("/api/backup/disable");
      // Past its arrival check, which passed while the node was still primary.
      await queued;
      sc.role = "secondary";
      release();
      await holding;
      const res = await disabled;
      expect(res.status).toBe(409);
      expect(await res.json()).toMatchObject({ error: { code: "backup.not_primary" } });
      expect(await readSealed()).toEqual(before);
    }, 60_000);

    /** Seals `plaintext` as the whole archive record under the ring's own key, as no writer here
     * would: `putCredential` refuses a payload that is not the purpose's fields. */
    async function storeRawArchive(plaintext: string): Promise<void> {
      await withTransaction(suite.db, (tx) =>
        putCredential(tx, RING, { purpose: ARCHIVE_PURPOSE, value: { settings: "{}" } }),
      );
      const iv = randomBytes(12);
      const cipher = createCipheriv("aes-256-gcm", RING_KEY, iv);
      cipher.setAAD(Buffer.from(ARCHIVE_PURPOSE, "utf8"));
      const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
      await withTransaction(suite.db, (tx) =>
        tx
          .update(tenantCredentials)
          .set({ ciphertext, iv, authTag: cipher.getAuthTag() })
          .where(eq(tenantCredentials.purpose, ARCHIVE_PURPOSE)),
      );
    }

    const sealedUnder = (version: string) => async () => {
      const other = loadKeyRing({
        WAITRON_CREDENTIALS_KEY: Buffer.alloc(32, 9).toString("base64"),
        WAITRON_CREDENTIALS_KEY_VERSION: version,
      });
      await withTransaction(suite.db, (tx) =>
        putCredential(tx, other, { purpose: ARCHIVE_PURPOSE, value: { settings: "{}" } }),
      );
    };

    // Each stored archive record this server cannot read, and the code a read of it answers.
    const UNREADABLE: [string, () => Promise<void>][] = [
      [
        "backup.archive_settings_invalid",
        () =>
          withTransaction(suite.db, (tx) =>
            putCredential(tx, RING, { purpose: ARCHIVE_PURPOSE, value: { settings: "{}" } }),
          ),
      ],
      ["credentials.decrypt_failed", sealedUnder("1")],
      ["credentials.key_version_unknown", sealedUnder("2")],
      ["credentials.malformed_payload", () => storeRawArchive("not json")],
      ["server.credential_unusable", () => storeRawArchive("{}")],
    ];

    for (const [code, store] of UNREADABLE) {
      it(`Save replaces a stored record it cannot read (${code})`, async () => {
        await store();
        await expect(readSealed()).rejects.toMatchObject({ code });
        const lines: string[] = [];
        const { post } = await primaryApp({}, undefined, (level, event, fields) => {
          lines.push(JSON.stringify({ level, event, fields }));
        });
        const dir = makeDestDir();
        const res = await post("/api/backup/apply", applyBody({ kind: "local-fs", dir }));
        expect(res.status).toBe(200);
        expect(await readSealed()).toMatchObject({
          enabled: true,
          destinations: [{ kind: "local-fs", dir }],
        });
        expect(lines).toContainEqual(
          JSON.stringify({
            level: "warn",
            event: "backup.archive_settings_unreadable",
            fields: { reason: code },
          }),
        );
      }, 60_000);

      it(`disable refuses a stored record it cannot read, and leaves it (${code})`, async () => {
        await store();
        const { post } = await primaryApp();
        const res = await post("/api/backup/disable");
        expect(res.status).toBe(409);
        expect(await res.json()).toMatchObject({
          error: { code: "backup.archive_settings_unreadable", params: { reason: code } },
        });
        await expect(readSealed()).rejects.toMatchObject({ code });
      }, 60_000);
    }

    it("Save over a stored record it cannot read reuses none of its secret", async () => {
      const { post } = await primaryApp();
      expect(
        (await post("/api/backup/apply", applyBody({ ...CUSTOM, secretAccessKey: CUSTOM_SECRET })))
          .status,
      ).toBe(200);
      const held = (await readSealed())!;
      // Readable as a sealed payload, but refused as settings because of its time limit alone.
      await withTransaction(suite.db, (tx) =>
        putCredential(tx, RING, {
          purpose: ARCHIVE_PURPOSE,
          value: { settings: JSON.stringify({ ...held, destinationTimeoutMs: 1 }) },
        }),
      );
      await expect(readSealed()).rejects.toMatchObject({
        code: "backup.archive_settings_invalid",
      });
      const res = await post(
        "/api/backup/apply",
        applyBody({ ...CUSTOM, secretAccessKey: "" }, undefined),
      );
      expect(res.status).toBe(400);
      expect(await res.json()).toMatchObject({
        error: { code: "backup.request_invalid", params: { field: "secretAccessKey" } },
      });
    }, 60_000);

    /** Stores the bucket copy's settings, then breaks their authentication tag, so a read of them
     * answers `credentials.decrypt_failed`. */
    async function storeUnreadableStream(): Promise<void> {
      await storeStream();
      await withTransaction(suite.db, (tx) =>
        tx
          .update(tenantCredentials)
          .set({ authTag: randomBytes(16) })
          .where(eq(tenantCredentials.purpose, "backup.stream")),
      );
      await expect(readStreamSettings(suite.db, RING)).rejects.toMatchObject({
        code: "credentials.decrypt_failed",
      });
    }

    it("a local-folder Save does not read the bucket copy's settings, so an unreadable one does not block it", async () => {
      await storeUnreadableStream();
      const { post } = await primaryApp();
      const dir = makeDestDir();
      const res = await post("/api/backup/apply", applyBody({ kind: "local-fs", dir }));
      expect(res.status).toBe(200);
      expect(await res.json()).toMatchObject({ enabled: true });
      expect(await readSealed()).toMatchObject({
        enabled: true,
        destinations: [{ kind: "local-fs", dir }],
      });
    }, 60_000);

    for (const destination of [
      { kind: "stream-bucket" },
      { ...CUSTOM, secretAccessKey: CUSTOM_SECRET },
    ]) {
      it(`a ${destination.kind} Save is refused while the bucket copy's settings cannot be read, with nothing written`, async () => {
        await storeUnreadableStream();
        const { sc, post } = await primaryApp();
        const res = await post("/api/backup/apply", applyBody(destination));
        expect(res.status).toBe(409);
        expect(await res.json()).toMatchObject({
          error: {
            code: "backup.stream_settings_unreadable",
            params: { reason: "credentials.decrypt_failed" },
          },
        });
        expect(await readSealed()).toBeNull();
        expect(bucket.calls).toEqual([]);
        await expect(readFile(join(sc.stateDir, "backup.env"), "utf8")).rejects.toThrow();
      }, 60_000);
    }

    const applyList = (destinations: unknown) => ({ ...applyBody(undefined), destinations });

    it("a folder and the bucket copy's bucket are both stored, folder first, with only the bucket tested, and a sweep writes to each", async () => {
      await storeStream();
      const probed: string[] = [];
      const { post, status } = await primaryApp({
        buildBackend: (dest) => {
          probed.push(dest.kind);
          return buildBackend(dest);
        },
      });
      const dir = makeDestDir();
      const res = await post(
        "/api/backup/apply",
        applyList([{ kind: "stream-bucket" }, { kind: "local-fs", dir }]),
      );
      expect(res.status).toBe(200);
      expect(probed).toEqual(["s3"]);
      expect(bucket.calls.filter((c) => c.startsWith("put waitron-probe-"))).toHaveLength(1);
      expect((await readdir(dir)).filter((f) => f.startsWith("waitron-probe-"))).toEqual([]);
      expect((await readSealed())!.destinations).toEqual([
        { kind: "local-fs", id: "primary", dir },
        expect.objectContaining({ kind: "s3", id: "bucket", venueId: VENUE }),
      ]);
      const answered = await status();
      expect(answered.destinations.map((d: { id: string }) => d.id)).toEqual(["primary", "bucket"]);
      const swept = await poll(async () => {
        const { backupStatus } = await status();
        const ds: { id: string; storedUnderCurrentKey: boolean }[] =
          backupStatus.destinations ?? [];
        return ds.length === 2 && ds.every((d) => d.storedUnderCurrentKey) ? ds : undefined;
      });
      expect(swept).toEqual([
        expect.objectContaining({ id: "primary", uploadErrorCode: null, readErrorCode: null }),
        expect.objectContaining({ id: "bucket", uploadErrorCode: null, readErrorCode: null }),
      ]);
      expect(await readdir(dir)).not.toEqual([]);
      expect([...bucket.objects.keys()].filter((k) => !k.startsWith("waitron-probe-"))).not.toEqual(
        [],
      );
    }, 60_000);

    it("a folder beside a custom bucket re-saved with no secret keeps the held secret", async () => {
      const { post } = await primaryApp();
      const dir = makeDestDir();
      expect(
        (
          await post(
            "/api/backup/apply",
            applyList([
              { kind: "local-fs", dir },
              { ...CUSTOM, secretAccessKey: CUSTOM_SECRET },
            ]),
          )
        ).status,
      ).toBe(200);
      const res = await post(
        "/api/backup/apply",
        applyList([
          { kind: "local-fs", dir },
          { ...CUSTOM, secretAccessKey: "" },
        ]),
      );
      expect(res.status).toBe(200);
      const [folder, held] = (await readSealed())!.destinations;
      expect(folder).toEqual({ kind: "local-fs", id: "primary", dir });
      expect((held as Extract<BackupDestination, { kind: "s3" }>).bucket.secretAccessKey).toBe(
        CUSTOM_SECRET,
      );
    }, 60_000);

    it("rotation after a folder and bucket Save keeps both, under a new revision", async () => {
      const { post } = await primaryApp();
      const dir = makeDestDir();
      expect(
        (
          await post(
            "/api/backup/apply",
            applyList([
              { kind: "local-fs", dir },
              { ...CUSTOM, secretAccessKey: CUSTOM_SECRET },
            ]),
          )
        ).status,
      ).toBe(200);
      const sealed = (await readSealed())!;
      expect(sealed.destinations).toHaveLength(2);
      expect((await post("/api/backup/rotate", { recoveryKey: KEY_2 })).status).toBe(200);
      const after = (await readSealed())!;
      expect(after.revision).not.toBe(sealed.revision);
      expect({ ...after, revision: sealed.revision }).toEqual(sealed);
    }, 60_000);

    it("a Save with a folder and a bucket after disable stores both, switched on", async () => {
      const { post } = await primaryApp();
      const dir = makeDestDir();
      const both = [
        { kind: "local-fs", dir },
        { ...CUSTOM, secretAccessKey: CUSTOM_SECRET },
      ];
      expect((await post("/api/backup/apply", applyList(both))).status).toBe(200);
      expect((await post("/api/backup/disable")).status).toBe(200);
      expect((await readSealed())!.enabled).toBe(false);
      expect((await post("/api/backup/apply", applyList(both))).status).toBe(200);
      const after = (await readSealed())!;
      expect(after.enabled).toBe(true);
      expect(after.destinations).toEqual([
        { kind: "local-fs", id: "primary", dir },
        expect.objectContaining({ kind: "s3", id: "bucket" }),
      ]);
    }, 60_000);

    it("the archive recovery pack names the bucket when the folder is listed first", async () => {
      const { app, cookie, post } = await primaryApp();
      expect(
        (
          await post(
            "/api/backup/apply",
            applyList([
              { kind: "local-fs", dir: makeDestDir() },
              { ...CUSTOM, secretAccessKey: CUSTOM_SECRET },
            ]),
          )
        ).status,
      ).toBe(200);
      const res = await app.request("/api/backup/archive-recovery-pack", { headers: { cookie } });
      expect(res.status).toBe(200);
      expect(decodeArchiveRecoveryPack((await res.json()).pack)).toMatchObject({
        venueId: VENUE,
        bucket: { bucket: "archive-bucket", secretAccessKey: CUSTOM_SECRET },
      });
    }, 60_000);

    // Each refused Save beside a held folder record, and what it answers.
    const REFUSED_LISTS: [string, () => Promise<unknown[]>, number, Record<string, unknown>][] = [
      [
        "two buckets",
        async () => {
          await storeStream();
          return [{ kind: "stream-bucket" }, { ...CUSTOM, secretAccessKey: CUSTOM_SECRET }];
        },
        400,
        { code: "backup.request_invalid", params: { field: "destinations" } },
      ],
      [
        "a bucket that fails its test beside a good folder",
        async () => {
          bucket.failGet = true;
          return [
            { kind: "local-fs", dir: makeDestDir() },
            { ...CUSTOM, secretAccessKey: CUSTOM_SECRET },
          ];
        },
        422,
        { code: "backup.archive_test_failed" },
      ],
      [
        "a folder beside the bucket copy's bucket while its settings cannot be read",
        async () => {
          await storeUnreadableStream();
          return [{ kind: "local-fs", dir: makeDestDir() }, { kind: "stream-bucket" }];
        },
        409,
        {
          code: "backup.stream_settings_unreadable",
          params: { reason: "credentials.decrypt_failed" },
        },
      ],
    ];

    for (const [name, arrange, code, error] of REFUSED_LISTS) {
      it(`a Save of ${name} is refused, leaving the held record and key file unchanged`, async () => {
        const { sc, post } = await primaryApp();
        expect(
          (await post("/api/backup/apply", applyBody({ kind: "local-fs", dir: makeDestDir() })))
            .status,
        ).toBe(200);
        const held = await readSealed();
        const keyFile = await readFile(join(sc.stateDir, "backup.env"), "utf8");
        const res = await post("/api/backup/apply", applyList(await arrange()));
        expect(res.status).toBe(code);
        expect(await res.json()).toMatchObject({ error });
        expect(await readSealed()).toEqual(held);
        expect(await readFile(join(sc.stateDir, "backup.env"), "utf8")).toBe(keyFile);
      }, 60_000);
    }

    it("a malformed destination list is refused as the list, before the key is checked", async () => {
      const { sc, post } = await primaryApp();
      const dir = makeDestDir();
      const folder = { kind: "local-fs", dir };
      // With no key held and none sent, a well-formed list is refused as `recoveryKey`.
      const noKey = (destinations: unknown) => ({
        destinations,
        schedule: DAILY_AT_0330,
        retention: RETENTION,
      });
      for (const destinations of [null, "nope", folder, [], [folder, folder, folder], [1]]) {
        const res = await post("/api/backup/apply", noKey(destinations));
        expect(res.status, JSON.stringify(destinations)).toBe(400);
        expect(await res.json(), JSON.stringify(destinations)).toMatchObject({
          error: { code: "backup.request_invalid", params: { field: "destinations" } },
        });
      }
      const control = await post("/api/backup/apply", noKey([folder]));
      expect(await control.json()).toMatchObject({
        error: { code: "backup.request_invalid", params: { field: "recoveryKey" } },
      });
      expect(await readSealed()).toBeNull();
      await expect(readFile(join(sc.stateDir, "backup.env"), "utf8")).rejects.toThrow();
    }, 60_000);

    it("a body with the old single destination field is refused as an unknown field", async () => {
      const { post } = await primaryApp();
      const res = await post("/api/backup/apply", {
        destination: { kind: "local-fs", dir: makeDestDir() },
        recoveryKey: KEY_1,
        schedule: DAILY_AT_0330,
        retention: RETENTION,
      });
      expect(res.status).toBe(400);
      expect(await res.json()).toMatchObject({
        error: { code: "backup.request_invalid", params: { field: "body" } },
      });
      expect(await readSealed()).toBeNull();
    }, 60_000);

    // The other stored bucket-copy records this server cannot read, and the code a read answers.
    const UNREADABLE_STREAM: [string, () => Promise<void>][] = [
      [
        "credentials.key_version_unknown",
        async () => {
          const other = loadKeyRing({
            WAITRON_CREDENTIALS_KEY: Buffer.alloc(32, 9).toString("base64"),
            WAITRON_CREDENTIALS_KEY_VERSION: "2",
          });
          await withTransaction(suite.db, (tx) =>
            putCredential(tx, other, {
              purpose: "backup.stream",
              value: streamSettingsPayload({ venueId: VENUE, bucket: STREAM_BUCKET }),
            }),
          );
        },
      ],
      [
        "credentials.malformed_payload",
        async () => {
          await storeStream();
          const iv = randomBytes(12);
          const cipher = createCipheriv("aes-256-gcm", RING_KEY, iv);
          cipher.setAAD(Buffer.from("backup.stream", "utf8"));
          const ciphertext = Buffer.concat([cipher.update("not json", "utf8"), cipher.final()]);
          await withTransaction(suite.db, (tx) =>
            tx
              .update(tenantCredentials)
              .set({ ciphertext, iv, authTag: cipher.getAuthTag() })
              .where(eq(tenantCredentials.purpose, "backup.stream")),
          );
        },
      ],
      [
        "server.credential_unusable",
        async () => {
          await storeStream();
          await omitStoredStreamField(suite.db, RING, "endpoint");
        },
      ],
    ];

    for (const [code, store] of UNREADABLE_STREAM) {
      it(`a stream-bucket Save is refused while the bucket copy's settings cannot be read (${code})`, async () => {
        await store();
        await expect(readStreamSettings(suite.db, RING)).rejects.toMatchObject({ code });
        const { post } = await primaryApp();
        const res = await post("/api/backup/apply", applyBody({ kind: "stream-bucket" }));
        expect(res.status).toBe(409);
        expect(await res.json()).toMatchObject({
          error: { code: "backup.stream_settings_unreadable", params: { reason: code } },
        });
        expect(await readSealed()).toBeNull();
        expect(bucket.calls).toEqual([]);
      }, 60_000);
    }

    it("Save stores a wall-clock schedule's days in order, once each", async () => {
      const { post } = await primaryApp();
      const res = await post("/api/backup/apply", {
        ...applyBody({ kind: "local-fs", dir: makeDestDir() }),
        schedule: { kind: "wall-clock", days: [5, 1, 5], at: "auto" },
      });
      expect(res.status).toBe(200);
      expect((await readSealed())!.schedule).toEqual({
        kind: "wall-clock",
        days: [1, 5],
        at: "auto",
      });
    }, 60_000);

    it("disable with nothing stored is refused", async () => {
      const { post } = await primaryApp();
      const res = await post("/api/backup/disable");
      expect(res.status).toBe(400);
      expect(await res.json()).toMatchObject({
        error: { code: "backup.request_invalid", params: { field: "config" } },
      });
    }, 60_000);

    it("disable refuses when the environment owns the settings", async () => {
      const sc: Scenario = {
        stateDir: await makeStateDir(),
        base: { WAITRON_BACKUP_DIR: makeDestDir() },
        role: "primary",
      };
      const app = buildApp(makeSupervisor(sc), sc.stateDir);
      const cookie = await login(app);
      const res = await app.request("/api/backup/disable", { method: "POST", headers: { cookie } });
      expect(res.status).toBe(409);
      expect(await res.json()).toMatchObject({ error: { code: "backup.managed_by_environment" } });
    }, 60_000);

    it("refuses unknown, null and mistyped fields by name", async () => {
      const { post } = await primaryApp();
      const good = applyBody({ kind: "local-fs", dir: makeDestDir() });
      for (const [body, field] of [
        [{ ...good, destinationDir: "/mnt/x" }, "body"],
        [{ ...good, recoveryKey: null }, "recoveryKey"],
        [{ ...good, destinations: null }, "destinations"],
        [{ ...good, destinationTimeoutMs: "900000" }, "destinationTimeoutMs"],
        [{ ...good, destinationTimeoutMs: null }, "destinationTimeoutMs"],
        [{ ...good, destinationTimeoutMs: 1_000 }, "destinationTimeoutMs"],
        [{ ...good, schedule: { ...DAILY_AT_0330, extra: 1 } }, "schedule"],
        [{ ...good, retention: { ...RETENTION, extra: 1 } }, "retention"],
      ] as const) {
        const res = await post("/api/backup/apply", body);
        expect(res.status, field).toBe(400);
        expect(await res.json(), field).toMatchObject({
          error: { code: "backup.request_invalid", params: { field } },
        });
      }
      expect(await readSealed()).toBeNull();
    }, 60_000);

    it("a folder path holding a control character is refused as the folder, with nothing written", async () => {
      const { sc, post } = await primaryApp();
      for (const control of ["\u0001", "\u007f", "\u0085"]) {
        const dir = `${makeDestDir()}/a${control}b`;
        const res = await post("/api/backup/apply", applyBody({ kind: "local-fs", dir }));
        expect(res.status, JSON.stringify(control)).toBe(400);
        expect(await res.json(), JSON.stringify(control)).toMatchObject({
          error: { code: "backup.request_invalid", params: { field: "dir" } },
        });
      }
      expect(await readSealed()).toBeNull();
      await expect(readFile(join(sc.stateDir, "backup.env"), "utf8")).rejects.toThrow();
    }, 60_000);

    it("an unknown field is refused without its name, which could be a secret", async () => {
      const lines: string[] = [];
      const { post } = await primaryApp({}, undefined, (level, event, fields) => {
        lines.push(JSON.stringify({ level, event, fields }));
      });
      const res = await post("/api/backup/apply", {
        ...applyBody({ kind: "local-fs", dir: makeDestDir() }),
        [CUSTOM_SECRET]: "x",
      });
      expect(res.status).toBe(400);
      const answered = await res.text();
      expect(JSON.parse(answered)).toMatchObject({
        error: { code: "backup.request_invalid", params: { field: "body" } },
      });
      expect(lines.some((line) => line.includes("backup.request_invalid"))).toBe(true);
      expect(answered).not.toContain(CUSTOM_SECRET);
      expect(lines.join("\n")).not.toContain(CUSTOM_SECRET);
      expect(await readSealed()).toBeNull();
    }, 60_000);

    it("a sent time limit is stored, and a later Save without one keeps it", async () => {
      const { post } = await primaryApp();
      const dir = makeDestDir();
      expect(
        (
          await post("/api/backup/apply", {
            ...applyBody({ kind: "local-fs", dir }),
            destinationTimeoutMs: 60_000,
          })
        ).status,
      ).toBe(200);
      expect((await readSealed())?.destinationTimeoutMs).toBe(60_000);
      expect((await post("/api/backup/apply", applyBody({ kind: "local-fs", dir }))).status).toBe(
        200,
      );
      expect((await readSealed())?.destinationTimeoutMs).toBe(60_000);
    }, 60_000);

    it("settings refused after the key is written leave a usable key and archives off", async () => {
      // The key each re-lock of this node's state row saw, read from the state folder at the time.
      const relocked: (string | undefined)[] = [];
      let stateDir = "";
      const sealedState: SealedStateRefresher = {
        refresh: async () => {
          relocked.push(loadRecoveryKey(await loadBoxEnv({}, stateDir)));
          return "sealed";
        },
      };
      const { sc, sup, post, status } = await primaryApp({ sealedState });
      stateDir = sc.stateDir;
      suite.db.run(
        sql.raw(`create trigger refuse_archive_settings before insert on tenant_credentials
          when new.purpose = '${ARCHIVE_PURPOSE}' begin select raise(abort, 'refused'); end`),
      );
      try {
        const res = await post(
          "/api/backup/apply",
          applyBody({ kind: "local-fs", dir: makeDestDir() }),
        );
        expect(res.status).not.toBe(200);
        expect(res.status).toBe(500);
        expect(await res.json()).toEqual({ error: { code: "server.internal" } });
      } finally {
        suite.db.run(sql.raw("drop trigger refuse_archive_settings"));
      }
      expect(relocked).toEqual([KEY_1]);
      expect(loadRecoveryKey(await loadBoxEnv({}, sc.stateDir))).toBe(KEY_1);
      expect(await readSealed()).toBeNull();
      expect(sup.current().enabled).toBe(false);
      expect(await status()).toMatchObject({
        enabled: false,
        recoveryKeySet: true,
        recoveryKeyTooShort: false,
      });
    }, 60_000);

    describe("rotation", () => {
      const triggers = ["insert", "update"] as const;

      function refuseArchiveWrites(): () => void {
        for (const on of triggers) {
          suite.db.run(
            sql.raw(`create trigger refuse_archive_${on} before ${on} on tenant_credentials
              when new.purpose = '${ARCHIVE_PURPOSE}' begin select raise(abort, 'refused'); end`),
          );
        }
        return () => {
          for (const on of triggers) suite.db.run(sql.raw(`drop trigger refuse_archive_${on}`));
        };
      }

      /** Archives on in a custom bucket under KEY_1, with every key the refresher locked under. */
      async function savedInBucket() {
        const seen: (string | undefined)[] = [];
        const dir = { stateDir: "" };
        const relock: { outcome: "sealed" | "failed" } = { outcome: "sealed" };
        const app = await primaryApp({
          sealedState: {
            refresh: async () => {
              seen.push(loadRecoveryKey(await loadBoxEnv({}, dir.stateDir)));
              return relock.outcome;
            },
          },
        });
        dir.stateDir = app.sc.stateDir;
        const res = await app.post(
          "/api/backup/apply",
          applyBody({ ...CUSTOM, secretAccessKey: CUSTOM_SECRET }),
        );
        expect(res.status).toBe(200);
        return { ...app, seen, relock, saved: await app.status(), sealed: (await readSealed())! };
      }

      const fileKey = async (stateDir: string) => loadRecoveryKey(await loadBoxEnv({}, stateDir));

      it("keeps a bucket destination, schedule, retention and time limit, under a new revision", async () => {
        const { post, status, saved, sealed } = await savedInBucket();
        const res = await post("/api/backup/rotate", { recoveryKey: KEY_2 });
        expect(res.status).toBe(200);
        const rotated = await res.json();
        expect(rotated.destinations).toEqual(saved.destinations);
        expect(rotated.keyFingerprint).toBe(keyFingerprint(KEY_2));
        const after = (await readSealed())!;
        expect(after.revision).not.toBe(sealed.revision);
        expect({ ...after, revision: sealed.revision }).toEqual(sealed);
        expect((await status()).revision).toBe(after.revision);
      }, 60_000);

      it("keeps a local folder switched off, switched off", async () => {
        const { post } = await primaryApp();
        const dir = makeDestDir();
        expect((await post("/api/backup/apply", applyBody({ kind: "local-fs", dir }))).status).toBe(
          200,
        );
        expect((await post("/api/backup/disable")).status).toBe(200);
        const sealed = (await readSealed())!;
        expect((await post("/api/backup/rotate", { recoveryKey: KEY_2 })).status).toBe(200);
        const after = (await readSealed())!;
        expect(after.revision).not.toBe(sealed.revision);
        expect({ ...after, revision: sealed.revision }).toEqual(sealed);
      }, 60_000);

      it("a revision that cannot be stored after the key file was written reports the new key in effect", async () => {
        const { sc, sup, app, cookie, post, status, seen, saved, sealed } = await savedInBucket();
        const restore = refuseArchiveWrites();
        let res: Response;
        try {
          res = await post("/api/backup/rotate", { recoveryKey: KEY_2 });
        } finally {
          restore();
        }
        expect(res.status).toBe(500);
        const { error } = await res.json();
        expect(error.code).toBe("backup.rotation_metadata_failed");
        expect(error.params).toEqual({
          effectiveKeyChanged: true,
          keyFingerprint: keyFingerprint(KEY_2),
          keyRotatedAt: expect.any(String),
        });
        expect(JSON.stringify(error)).not.toContain(KEY_2);

        expect(await fileKey(sc.stateDir)).toBe(KEY_2);
        expect(sup.current().keyFingerprint).toBe(keyFingerprint(KEY_2));
        const rk = await app.request("/api/backup/recovery-key", { headers: { cookie } });
        expect((await rk.json()).key).toBe(KEY_2);
        // Locked under the new key after the key file, and again after the failure.
        expect(seen).toEqual([KEY_1, KEY_1, KEY_2, KEY_2]);

        const after = await status();
        expect(after.revision).toBe(saved.revision);
        expect(after.keyFingerprint).not.toBe(saved.keyFingerprint);
        expect(after.keyRotatedAt).toBe(error.params.keyRotatedAt);
        expect(after.keyRotatedAt).not.toBe(saved.keyRotatedAt);
        expect(after.destinations).toEqual(saved.destinations);
        expect(await readSealed()).toEqual(sealed);
      }, 60_000);

      it("names a reload and a re-lock that also failed beside the changed key", async () => {
        const { sc, sup, post, relock, sealed } = await savedInBucket();
        relock.outcome = "failed";
        vi.spyOn(sup, "reload").mockRejectedValueOnce(
          new AppError("backup.destinations_invalid", { reason: "bad_entry" }),
        );
        const restore = refuseArchiveWrites();
        let res: Response;
        try {
          res = await post("/api/backup/rotate", { recoveryKey: KEY_2 });
        } finally {
          restore();
        }
        expect(res.status).toBe(500);
        expect((await res.json()).error).toMatchObject({
          code: "backup.rotation_metadata_failed",
          params: {
            effectiveKeyChanged: true,
            keyFingerprint: keyFingerprint(KEY_2),
            reloadErrorCode: "backup.destinations_invalid",
            sealedState: "failed",
          },
        });
        expect(await fileKey(sc.stateDir)).toBe(KEY_2);
        expect(await readSealed()).toEqual(sealed);
      }, 60_000);

      it("after a revision and a reload that both failed, the recovery key read is the new key", async () => {
        const { sup, app, cookie, post } = await savedInBucket();
        vi.spyOn(sup, "reload").mockRejectedValueOnce(
          new AppError("backup.destinations_invalid", { reason: "bad_entry" }),
        );
        const restore = refuseArchiveWrites();
        let res: Response;
        try {
          res = await post("/api/backup/rotate", { recoveryKey: KEY_2 });
        } finally {
          restore();
        }
        expect((await res.json()).error.code).toBe("backup.rotation_metadata_failed");
        expect(sup.current().recoveryKey).toBe(KEY_1);
        const rk = await app.request("/api/backup/recovery-key", { headers: { cookie } });
        expect((await rk.json()).key).toBe(KEY_2);
      }, 60_000);

      it("a reload that fails after the key and revision were written answers 200 with its code", async () => {
        const { sc, sup, post, sealed } = await savedInBucket();
        vi.spyOn(sup, "reload").mockRejectedValueOnce(
          new AppError("backup.destinations_invalid", { reason: "bad_entry" }),
        );
        const res = await post("/api/backup/rotate", { recoveryKey: KEY_2 });
        expect(res.status).toBe(200);
        expect(await res.json()).toMatchObject({ reloadErrorCode: "backup.destinations_invalid" });
        expect(await fileKey(sc.stateDir)).toBe(KEY_2);
        expect((await readSealed())!.revision).not.toBe(sealed.revision);
      }, 60_000);

      it("a reload that finds the stored settings unusable answers 200 with that code", async () => {
        const { sc, post, sealed } = await savedInBucket();
        sc.readRecord = async () => {
          throw new AppError("backup.archive_settings_invalid", { reason: "fields" });
        };
        const res = await post("/api/backup/rotate", { recoveryKey: KEY_2 });
        expect(res.status).toBe(200);
        expect(await res.json()).toMatchObject({
          loadErrorCode: "backup.archive_settings_invalid",
        });
        expect(await fileKey(sc.stateDir)).toBe(KEY_2);
        expect((await readSealed())!.revision).not.toBe(sealed.revision);
      }, 60_000);

      const failedReloads: [string, (sc: Scenario, sup: BackupSupervisor) => void][] = [
        [
          "throws",
          (_sc, sup) => {
            vi.spyOn(sup, "reload").mockRejectedValueOnce(
              new AppError("backup.destinations_invalid", { reason: "bad_entry" }),
            );
          },
        ],
        [
          "finds the stored settings unusable",
          (sc) => {
            sc.readRecord = async () => {
              throw new AppError("backup.archive_settings_invalid", { reason: "fields" });
            };
          },
        ],
      ];

      for (const [outcome, failReload] of failedReloads) {
        it(`after a reload that ${outcome}, the answer and the next status read show the key file's key and rotation time`, async () => {
          const { sc, sup, post, status } = await savedInBucket();
          failReload(sc, sup);
          const res = await post("/api/backup/rotate", { recoveryKey: KEY_2 });
          expect(res.status).toBe(200);
          const rotatedAt = parseEnvFile(
            await readFile(join(sc.stateDir, "backup.env"), "utf8"),
          ).WAITRON_BACKUP_KEY_ROTATED_AT;
          expect(typeof rotatedAt).toBe("string");
          expect(sup.current().keyFingerprint).not.toBe(keyFingerprint(KEY_2));
          for (const shown of [await res.json(), await status()]) {
            expect(shown.keyFingerprint).toBe(keyFingerprint(KEY_2));
            expect(shown.keyRotatedAt).toBe(rotatedAt);
          }
        }, 60_000);
      }

      it("with no key in the key file, status reports the key the supervisor loaded", async () => {
        const { sc, sup, status, saved } = await savedInBucket();
        await writeFile(join(sc.stateDir, "backup.env"), "");
        expect(sup.current().keyFingerprint).toBe(keyFingerprint(KEY_1));
        expect(await status()).toMatchObject({
          keyFingerprint: saved.keyFingerprint,
          recoveryKeySet: true,
          recoveryKeyTooShort: false,
        });
      }, 60_000);

      it("a record stored while nothing is loaded still gets a new revision and a reload", async () => {
        const { sup, post } = await primaryApp();
        const reload = vi
          .spyOn(sup, "reload")
          .mockRejectedValueOnce(
            new AppError("backup.destinations_invalid", { reason: "bad_entry" }),
          );
        const applied = await post(
          "/api/backup/apply",
          applyBody({ kind: "local-fs", dir: makeDestDir() }),
        );
        expect(await applied.json()).toMatchObject({
          reloadErrorCode: "backup.destinations_invalid",
        });
        expect(sup.current().destinations).toEqual([]);
        const sealed = (await readSealed())!;
        const res = await post("/api/backup/rotate", { recoveryKey: KEY_2 });
        expect(res.status).toBe(200);
        const after = (await readSealed())!;
        expect(after.revision).not.toBe(sealed.revision);
        expect({ ...after, revision: sealed.revision }).toEqual(sealed);
        expect(reload).toHaveBeenCalledTimes(2);
        expect(sup.current().recoveryKey).toBe(KEY_2);
      }, 60_000);

      it("a record read that fails for an unlisted reason stops the rotation before the key file", async () => {
        const broken = { on: false };
        const ring: KeyRing = {
          get current() {
            if (broken.on) throw new Error("ring unavailable");
            return RING.current;
          },
          get previous() {
            if (broken.on) throw new Error("ring unavailable");
            return RING.previous;
          },
        };
        const { sc, sup, post } = await primaryApp({ ring });
        expect(
          (await post("/api/backup/apply", applyBody({ kind: "local-fs", dir: makeDestDir() })))
            .status,
        ).toBe(200);
        const sealed = (await readSealed())!;
        broken.on = true;
        const res = await post("/api/backup/rotate", { recoveryKey: KEY_2 });
        expect(res.status).toBe(500);
        expect(await res.json()).toEqual({ error: { code: "server.internal" } });
        expect(await fileKey(sc.stateDir)).toBe(KEY_1);
        expect(sup.current().recoveryKey).toBe(KEY_1);
        expect(await readSealed()).toEqual(sealed);
      }, 60_000);

      it("an unreadable record is left as it is, and its code is reported beside the new key", async () => {
        const { sc, post } = await primaryApp();
        await writeRecoveryKey(sc.stateDir, { recoveryKey: KEY_1, keyRotatedAt: undefined });
        await withTransaction(suite.db, (tx) =>
          putCredential(tx, RING, { purpose: ARCHIVE_PURPOSE, value: { settings: "{}" } }),
        );
        const stored = () =>
          withTransaction(suite.db, (tx) =>
            tryGetCredential(tx, RING, { purpose: ARCHIVE_PURPOSE }),
          );
        const before = await stored();
        const res = await post("/api/backup/rotate", { recoveryKey: KEY_2 });
        expect(res.status).toBe(200);
        expect(await res.json()).toMatchObject({
          loadErrorCode: "backup.archive_settings_invalid",
          recoveryKeySet: true,
        });
        expect(await fileKey(sc.stateDir)).toBe(KEY_2);
        expect(await stored()).toEqual(before);
      }, 60_000);

      it("a key file that cannot be written changes nothing, and says no key changed", async () => {
        const { sc, sup, post, status, seen, saved, sealed } = await savedInBucket();
        // A directory where the key file's working copy goes refuses the write before it starts.
        await mkdir(join(sc.stateDir, "backup.env.tmp"));
        await writeFile(join(sc.stateDir, "backup.env.tmp", "x"), "x");
        const res = await post("/api/backup/rotate", { recoveryKey: KEY_2 });
        expect(res.status).toBe(500);
        const { error } = await res.json();
        expect(error.code).not.toBe("backup.rotation_metadata_failed");
        expect(error.params ?? {}).not.toHaveProperty("effectiveKeyChanged");
        expect(await fileKey(sc.stateDir)).toBe(KEY_1);
        expect(sup.current().keyFingerprint).toBe(keyFingerprint(KEY_1));
        expect(seen).toEqual([KEY_1, KEY_1]);
        const after = await status();
        expect([after.revision, after.keyFingerprint, after.keyRotatedAt]).toEqual([
          saved.revision,
          saved.keyFingerprint,
          saved.keyRotatedAt,
        ]);
        expect(await readSealed()).toEqual(sealed);
      }, 60_000);

      it("a second tab's next status read shows another tab's rotation", async () => {
        const { app, status, saved } = await savedInBucket();
        const tabA = saved;
        const cookieB = await login(app);
        const rotated = await app.request("/api/backup/rotate", {
          method: "POST",
          headers: { cookie: cookieB, "content-type": "application/json" },
          body: JSON.stringify({ recoveryKey: KEY_2 }),
        });
        expect(rotated.status).toBe(200);
        const tabANext = await status();
        expect(tabANext.keyFingerprint).not.toBe(tabA.keyFingerprint);
        expect(tabANext.keyRotatedAt).not.toBe(tabA.keyRotatedAt);
        expect(tabANext.revision).not.toBe(tabA.revision);
        expect(tabANext.destinations).toEqual(tabA.destinations);
      }, 60_000);

      it("still refuses when the environment owns the settings", async () => {
        const sc: Scenario = {
          stateDir: await makeStateDir(),
          base: { WAITRON_BACKUP_DIR: makeDestDir(), WAITRON_BACKUP_RECOVERY_KEY: KEY_1 },
          role: "primary",
        };
        const app = buildApp(makeSupervisor(sc), sc.stateDir, sc.base);
        const cookie = await login(app);
        const res = await app.request("/api/backup/rotate", {
          method: "POST",
          headers: { cookie, "content-type": "application/json" },
          body: JSON.stringify({ recoveryKey: KEY_2 }),
        });
        expect(res.status).toBe(409);
        expect(await res.json()).toMatchObject({
          error: { code: "backup.managed_by_environment" },
        });
      }, 60_000);
    });
  });
});
