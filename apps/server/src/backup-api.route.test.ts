// The backup admin routes under the manager-login gate, plus the supervisor's real enable/rotate
// lifecycle. The supervisor is pointed at a throwaway venue directory because these tests exercise
// the ROUTES, not what a backup contains; the supervisor's own lifecycle is covered in
// `backup-supervisor.test.ts`.
//
// Nothing here establishes what the deployment role, which no longer exists, may read or write.
import { mkdtempSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
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
import { mountBackupApi } from "./backup-api.js";
import { createTurns, type Turns } from "./backup-turns.js";
import { deleteCredential, loadKeyRing } from "@waitron/credentials";
import { mountStreamApi } from "./stream-api.js";
import { loadBackupConfig, loadRecoveryKey, type BackupConfig } from "./backup-config.js";
import { writeBackupEnv, writeRecoveryKey } from "./backup-env-writer.js";
import { BackupSupervisor, keyFingerprint } from "./backup-supervisor.js";
import { loadBoxEnv } from "./box-env.js";
import { parseEnvFile } from "./env-file.js";
import type { SealedStateRefresher } from "./sealed-state.js";
import { isUnset } from "./env-value.js";
import { mountManagementApi } from "./management-api.js";
import { ALL_MODULES } from "./modules.js";
import { RECOVERY_FILES } from "./state-secrets.js";

const LOCALE = "es-ES";
const PASSWORD = "correct horse"; // the seeded manager's dashboard password
const MANAGER_EMAIL = "manager@x.com";
// Every backup env var provenance keys on — the wizard's `isManagedByEnvironment` mirror.
const BACKUP_KEYS = [
  "WAITRON_BACKUP_DIR",
  "WAITRON_BACKUP_DESTINATIONS",
  "WAITRON_BACKUP_RECOVERY_KEY",
  "WAITRON_BACKUP_SCHEDULE_DAYS",
  "WAITRON_BACKUP_AT",
  "WAITRON_BACKUP_INTERVAL_MS",
  "WAITRON_BACKUP_RETAIN",
  "WAITRON_BACKUP_RETAIN_DAYS",
];
// ≥ MIN_PASSPHRASE_LENGTH (12) and base64url-safe (survives the env-file round-trip).
const KEY_1 = "recovery-key-one-strong";
const KEY_2 = "recovery-key-two-different";

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
}

function makeSupervisor(sc: Scenario): BackupSupervisor {
  const sup = new BackupSupervisor({
    buildConfig: async () => loadBackupConfig(await loadBoxEnv(sc.base, sc.stateDir)),
    isManagedByEnvironment: () => BACKUP_KEYS.some((k) => !isUnset(sc.base[k])),
    readSingletonRole: () => sc.role,
    venueDir,
    modules: ALL_MODULES,
    environment: "production",
    stateDir: sc.stateDir,
    jitterSeed: "seed",
    readClock: async () => ({ timeZone: "UTC", dayCutover: "00:00" }),
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
    },
    () => {},
  );
  mountBackupApi(
    app,
    {
      supervisor: sup,
      db: suite.db,
      stateDir,
      readRecoveryKey,
      sealedState,
      readStream,
      turns,
    },
    () => {},
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
        tillName: "Caja 1",
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
    // Through drizzle rather than the raw `insert into persons` this seeded on PostgreSQL, and not
    // for tidiness: `persons.id` and `persons.created_at` used to be filled by the COLUMN and are
    // now filled by drizzle's `$defaultFn` instead, so a statement that names neither is refused.
    // Measured on this tree — `NOT NULL constraint failed: persons.id`, then, once an id is
    // supplied, `NOT NULL constraint failed: persons.created_at`. The two sides, each read inside
    // the `persons` block rather than grepped file-wide:
    // `aabdde6a8^:packages/identity/drizzle/0000_identity_baseline.sql:44,:60` carried
    // `DEFAULT gen_random_uuid()` and `DEFAULT now()`;
    // `packages/identity/drizzle/0000_baseline.sql:46,:62` carry a bare `NOT NULL`, because the
    // defaults moved to `packages/identity/src/schema/persons.ts:27,:67`. The insert the PRODUCT
    // uses is this one, so the fixture now takes the same route — the shape the converted siblings
    // use (`catalogue-api.test.ts`, `till-api.test.ts`).
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
        destinationDir: makeDestDir(),
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
        destinationDir: dest,
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
    // The apply RESPONSE is the COMPLETE status the dashboard reads (not the sync snapshot): it
    // carries `backupStatus` and `archiveUnderCurrentKey`, or the screen has no `backupStatus` after a
    // successful save. `configured` is true (a destination is now wired); the freshness of the very
    // first dump is not asserted here (the poll below covers it) — only that the fields are present.
    expect(body.backupStatus.configured).toBe(true);
    expect(typeof body.archiveUnderCurrentKey).toBe("boolean");
    // `apply` wrote backup.env verbatim (no restart needed) and the effective config picked it up.
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
        destinationDir: makeDestDir(),
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
        destinationDir: makeDestDir(),
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
        destinationDir: makeDestDir(),
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
    await writeBackupEnv(stateDir, {
      destinationDir: dest,
      recoveryKey: KEY_2,
      schedule: DAILY_AT_0330,
      retention: RETENTION,
      keyRotatedAt: undefined,
    });
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
    const app = buildApp(sup, stateDir);
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
        destinationDir: dest,
        recoveryKey: KEY_1,
        schedule: DAILY_AT_0330,
        retention: RETENTION,
      }),
    });
    expect(applied.status).toBe(200);
    expect((await applied.json()).keyRotatedAt ?? null).toBeNull(); // apply does not stamp a rotation

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
          destinationDir: makeDestDir(),
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
      destinations: [{ kind: "local-fs", id: "primary", dir: dest }],
      recoveryKey: "effective-key-differs-from-request",
      schedule: DAILY_AT_0330,
      retain: 7,
      retainDays: 30,
      staleAfterMs: 2 * 24 * 60 * 60 * 1000,
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
      readClock: async () => ({ timeZone: "UTC", dayCutover: "00:00" }),
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
        destinationDir: dest,
        recoveryKey: KEY_1,
        schedule: DAILY_AT_0330,
        retention: RETENTION,
      }),
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: { code: "backup.effective_mismatch" } });
    // backup.env was written before the refusal, so the row was re-locked from it.
    expect(recorder.seen).toEqual([KEY_1]);
  }, 60_000);

  it("rotate fails loud when the reloaded key is not the one requested", async () => {
    const dest = makeDestDir();
    const stateDir = await makeStateDir();
    const pinned: BackupConfig = {
      destinations: [{ kind: "local-fs", id: "primary", dir: dest }],
      recoveryKey: KEY_1,
      schedule: DAILY_AT_0330,
      retain: 7,
      retainDays: 30,
      staleAfterMs: 2 * 24 * 60 * 60 * 1000,
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
      readClock: async () => ({ timeZone: "UTC", dayCutover: "00:00" }),
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
          destinationDir: dest,
          recoveryKey: KEY_1,
          schedule: DAILY_AT_0330,
          retention: RETENTION,
        })
      ).status,
    ).toBe(200);
    expect(refresh).toHaveBeenCalledTimes(1);
    expect((await post("/api/backup/rotate", { recoveryKey: KEY_2 })).status).toBe(200);
    expect(refresh).toHaveBeenCalledTimes(2);
    expect(recorder.seen).toEqual([KEY_1, KEY_2]);
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
        destinationDir: makeDestDir(),
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
        destinationDir: makeDestDir(),
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
    expect(await rot.json()).toMatchObject({ enabled: false, recoveryKeySet: true });
    const file = parseEnvFile(await readFile(join(stateDir, "backup.env"), "utf8"));
    expect(file.WAITRON_BACKUP_RECOVERY_KEY).toBe(KEY_2);
    expect(file.WAITRON_BACKUP_DIR).toBeUndefined();
    const rk = await app.request("/api/backup/recovery-key", { headers: { cookie } });
    expect((await rk.json()).key).toBe(KEY_2);
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
          destinationDir: makeDestDir(),
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
          destinationDir: makeDestDir(),
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
    expect(file.WAITRON_BACKUP_RETAIN).toBe("3");
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
    const good = { destinationDir: dest, recoveryKey: KEY_1, retention: RETENTION };
    // Every malformed apply body → 400 backup.request_invalid, rejected before any write.
    const bad: unknown[] = [
      {}, // destinationDir missing
      { destinationDir: dest, schedule: DAILY_AT_0330, retention: RETENTION }, // recoveryKey missing
      { ...good, schedule: "nope" }, // schedule not an object
      { ...good, schedule: { kind: "bogus" } }, // unknown schedule kind
      { ...good, schedule: { kind: "interval", ms: 0 } }, // interval ms not positive
      { ...good, schedule: { kind: "wall-clock", days: [9], at: "auto" } }, // weekday out of range
      { ...good, schedule: { kind: "wall-clock", days: "daily", at: { hour: "x" } } }, // bad time
      { destinationDir: dest, recoveryKey: KEY_1, schedule: DAILY_AT_0330, retention: "nope" }, // retention not object
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
        destinationDir: makeDestDir(),
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

  it("an apply while another reload is in flight → 409 backup.reload_in_progress", async () => {
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
        return loadBackupConfig(await loadBoxEnv(base, stateDir));
      },
      isManagedByEnvironment: () => false,
      readSingletonRole: () => "primary",
      venueDir,
      modules: ALL_MODULES,
      environment: "production",
      stateDir,
      jitterSeed: "seed",
      readClock: async () => ({ timeZone: "UTC", dayCutover: "00:00" }),
      log: () => {},
    });
    cleanup.push(() => sup.stop());
    const recorder = recordingRefresher(stateDir);
    const app = buildApp(sup, stateDir, {}, undefined, recorder);
    const cookie = await login(app);
    const body = JSON.stringify({
      destinationDir: dest,
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
    expect(second.status).toBe(409);
    expect(await second.json()).toMatchObject({ error: { code: "backup.reload_in_progress" } });
    // backup.env was written before the reload was refused, so the row was re-locked from it.
    expect(recorder.seen).toEqual([KEY_1]);
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
          destinationDir: makeDestDir(),
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
        destinationDir: makeDestDir(),
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
    expect(env.WAITRON_BACKUP_DIR).toBeUndefined();
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
        destinationDir: makeDestDir(),
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
        ring: loadKeyRing({
          WAITRON_CREDENTIALS_KEY: Buffer.alloc(32, 7).toString("base64"),
          WAITRON_CREDENTIALS_KEY_VERSION: "1",
        }),
        stream: { reload: async () => {}, status: () => ({ state: "off" }) },
        nodeId: "00000000-0000-0000-0000-000000000000",
        venueId: "c0000000-0000-4000-8000-000000000002",
        isPrimary: () => true,
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
        destinationDir: dest,
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
      expect(env.WAITRON_BACKUP_DIR).toBe(dest);
    } finally {
      release();
      await Promise.allSettled([apply, save]);
      await withTransaction(suite.db, (tx) => deleteCredential(tx, { purpose: "backup.stream" }));
    }
  }, 60_000);
});
