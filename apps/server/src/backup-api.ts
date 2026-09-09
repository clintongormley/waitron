import { randomBytes } from "node:crypto";
import type { Context, Hono } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { asAppUser, withTenant, type Database } from "@waitron/db";
import { authorizeManager } from "@waitron/identity";
import { AppError } from "@waitron/shared";
import { createErrorBoundary, readJsonBody, requireManagementSession } from "@waitron/server-kit";
import { loadBackupConfig, type BackupSchedule } from "./backup-config.js";
import { backupEnvRecord, writeBackupEnv, type BackupEnvInput } from "./backup-env-writer.js";
import { formatEnvFile, parseEnvFile } from "./env-file.js";
import type { BackupRuntimeStatus, BackupSupervisor } from "./backup-supervisor.js";
import type { Logger } from "./logger.js";
// This file THROWS the `backup.*` admin codes, so it imports the host error registry directly, the
// "every file that throws one of these imports ./errors.js" convention errors.ts states.
import "./errors.js";

/** Everything the authenticated backup admin routes need. `db` + `cfg.tenantId` scope the management
 * gate (mirroring `RecoveryBundleDeps`/`DiagnosticsApiDeps`); `supervisor` is the live backup duty the
 * routes read and hot-reload; `stateDir` is where `backup.env` is written. */
export interface BackupApiDeps {
  supervisor: BackupSupervisor;
  db: Database;
  cfg: { tenantId: string };
  stateDir: string;
}

/**
 * Code→HTTP status for the backup admin surface. The management gate's codes (401/403) match
 * box-status/recovery-bundle exactly. `managed_by_environment`/`not_primary` are 409 CONFLICTS (the
 * box's config-ownership or role state forbids the write); the request-shape and config-validation
 * faults are 400. `effective_mismatch` is mapped explicitly at 400 rather than left to the boundary's
 * `?? 400` default — an unmapped code silently 400ing is the footgun errors.ts warns of.
 */
const STATUS: Record<string, ContentfulStatusCode> = {
  "management_session.required": 401,
  "management_session.expired": 401,
  "person.suspended": 403,
  "authorization.not_permitted": 403,
  "backup.managed_by_environment": 409,
  "backup.not_primary": 409,
  "backup.recovery_key_unstorable": 400,
  "backup.recovery_key_too_short": 400,
  "backup.destinations_invalid": 400,
  "backup.schedule_invalid": 400,
  "backup.request_invalid": 400,
  "backup.effective_mismatch": 400,
};

/**
 * Refuse a recovery key that cannot be stored VERBATIM in the `KEY=value` `backup.env` file. A key
 * carrying a newline/control char or surrounding whitespace, or one that does not survive the env-file
 * round-trip byte-for-byte, would have the box encrypt archives under a DIFFERENT string than the
 * operator recorded — unrecoverable (CLAUDE.md §5). Refused before any write; `reason` never carries
 * the key.
 */
export function assertStorableKey(key: string): void {
  // `[\r\n\t]` is redundant with `[\x00-\x1f]` (which covers all C0 controls) but is kept explicit —
  // newlines and tabs are the ways a pasted key most often breaks an env file.
  // eslint-disable-next-line no-control-regex
  if (/[\r\n\t]/.test(key) || /[\x00-\x1f]/.test(key) || key.trim() !== key) {
    throw new AppError("backup.recovery_key_unstorable", { reason: "whitespace_or_control" });
  }
  // Defensive: the value must survive the env-file round-trip byte-for-byte, or the box would encrypt
  // under a string the operator never recorded.
  if (parseEnvFile(formatEnvFile({ K: key })).K !== key) {
    throw new AppError("backup.recovery_key_unstorable", { reason: "round_trip" });
  }
}

/** Strip the effective recovery KEY (a secret) from a runtime-status snapshot before it leaves over
 * the wire. `GET /api/backup/recovery-key` is the ONLY route that returns the key, and it does so
 * deliberately (authenticated admin, TLS); every other projection omits it. */
function projectStatus<T extends BackupRuntimeStatus>(s: T): Omit<T, "recoveryKey"> {
  const rest: Omit<T, "recoveryKey"> & { recoveryKey?: string } = { ...s };
  delete rest.recoveryKey;
  return rest;
}

/** Validate a `schedule` wire value into a `BackupSchedule`. Structural validation only — the
 * semantic checks (a bad weekday/time, interval-and-wall-clock both set) are `loadBackupConfig`'s job
 * on the dry-validate below, so the route rejects exactly what boot would (`backup.schedule_invalid`). */
function readSchedule(raw: unknown): BackupSchedule {
  if (typeof raw !== "object" || raw === null) {
    throw new AppError("backup.request_invalid", { field: "schedule" });
  }
  const s = raw as { kind?: unknown; ms?: unknown; days?: unknown; at?: unknown };
  if (s.kind === "interval") {
    if (typeof s.ms !== "number" || !Number.isInteger(s.ms) || s.ms <= 0) {
      throw new AppError("backup.request_invalid", { field: "schedule" });
    }
    return { kind: "interval", ms: s.ms };
  }
  if (s.kind === "wall-clock") {
    let days: "daily" | number[];
    if (s.days === "daily") days = "daily";
    else if (
      Array.isArray(s.days) &&
      s.days.every((n) => typeof n === "number" && Number.isInteger(n) && n >= 0 && n <= 6)
    ) {
      days = s.days as number[];
    } else throw new AppError("backup.request_invalid", { field: "schedule" });

    let at: { hour: number; minute: number } | "auto";
    if (s.at === "auto") at = "auto";
    else if (
      typeof s.at === "object" &&
      s.at !== null &&
      typeof (s.at as { hour?: unknown }).hour === "number" &&
      typeof (s.at as { minute?: unknown }).minute === "number"
    ) {
      const a = s.at as { hour: number; minute: number };
      at = { hour: a.hour, minute: a.minute };
    } else throw new AppError("backup.request_invalid", { field: "schedule" });
    return { kind: "wall-clock", days, at };
  }
  throw new AppError("backup.request_invalid", { field: "schedule" });
}

/** Validate a `retention` wire value into `{ count, days }` — both positive integers. */
function readRetention(raw: unknown): { count: number; days: number } {
  if (typeof raw !== "object" || raw === null) {
    throw new AppError("backup.request_invalid", { field: "retention" });
  }
  const r = raw as { count?: unknown; days?: unknown };
  if (typeof r.count !== "number" || !Number.isInteger(r.count) || r.count <= 0) {
    throw new AppError("backup.request_invalid", { field: "retention" });
  }
  if (typeof r.days !== "number" || !Number.isInteger(r.days) || r.days <= 0) {
    throw new AppError("backup.request_invalid", { field: "retention" });
  }
  return { count: r.count, days: r.days };
}

/** The `apply` body → a `BackupEnvInput` with `keyRotatedAt` unset (apply is the initial enable, not a
 * rotation — `rotate` is what stamps the rotation timestamp). The client is never the gate: every
 * field is validated on the server, naming the offending field (never its value — it could be the key). */
async function readApplyBody(c: Context): Promise<BackupEnvInput> {
  const body = await readJsonBody<{
    destinationDir?: unknown;
    recoveryKey?: unknown;
    schedule?: unknown;
    retention?: unknown;
  }>(c);
  if (typeof body.destinationDir !== "string" || body.destinationDir.trim() === "") {
    throw new AppError("backup.request_invalid", { field: "destinationDir" });
  }
  if (typeof body.recoveryKey !== "string" || body.recoveryKey === "") {
    throw new AppError("backup.request_invalid", { field: "recoveryKey" });
  }
  return {
    destinationDir: body.destinationDir,
    recoveryKey: body.recoveryKey,
    schedule: readSchedule(body.schedule),
    retention: readRetention(body.retention),
    keyRotatedAt: undefined,
  };
}

/** The `rotate` body carries ONLY the new recovery key; the destination, schedule and retention are
 * reused from the running config (`fromCurrent`). */
async function readRotateBody(c: Context): Promise<{ recoveryKey: string }> {
  const body = await readJsonBody<{ recoveryKey?: unknown }>(c);
  if (typeof body.recoveryKey !== "string" || body.recoveryKey === "") {
    throw new AppError("backup.request_invalid", { field: "recoveryKey" });
  }
  return { recoveryKey: body.recoveryKey };
}

/** The destination + schedule + retention `rotate` reuses from the running config. Refuses when the
 * box has no backup configured at all — there is nothing to rotate the key OF. */
function fromCurrent(
  cur: BackupRuntimeStatus,
): Omit<BackupEnvInput, "recoveryKey" | "keyRotatedAt"> {
  const dir = cur.destinations[0]?.dir;
  if (dir === undefined || cur.schedule === undefined || cur.retention === undefined) {
    throw new AppError("backup.request_invalid", { field: "config" });
  }
  return {
    destinationDir: dir,
    schedule: cur.schedule,
    retention: { count: cur.retention.count, days: cur.retention.days },
  };
}

/**
 * Mount the authenticated backup admin routes. Every route runs the SAME management gate first
 * (`requireManagementSession` → 401, then `authorizeManager("till.configure")` under
 * `withTenant`+`asAppUser` → 403), mirroring `recovery-bundle-api.ts`. The write routes (`apply`,
 * `rotate`) additionally run `guardWritable` — refuse if the ENV owns the config (409) or this node is
 * not the primary (409) — BEFORE any file write, then dry-validate the exact record they will write
 * through `loadBackupConfig` (so the route rejects exactly what boot would), write `backup.env`,
 * hot-reload the supervisor, and assert the EFFECTIVE key equals the requested one (the guard against a
 * partial env override silently orphaning archives).
 */
export function mountBackupApi(app: Hono, deps: BackupApiDeps, log: Logger): void {
  const run = createErrorBoundary(STATUS, "backup-api.failed");

  const authorize = async (c: Context): Promise<void> => {
    const sessionId = requireManagementSession(c); // throws 401 if absent/forged
    await withTenant(deps.db, deps.cfg.tenantId, async (tx) => {
      await asAppUser(tx);
      await authorizeManager(tx, { managementSessionId: sessionId, permission: "till.configure" });
    });
  };

  // Refuse a write the box would silently override or that would never take effect here. Runs BEFORE
  // any `writeBackupEnv`, so a refused write leaves `backup.env` untouched (I5).
  const guardWritable = (): void => {
    const s = deps.supervisor.current(); // sync snapshot; reads the live singleton role
    if (s.managedByEnvironment) throw new AppError("backup.managed_by_environment", {});
    if (!s.isPrimary) throw new AppError("backup.not_primary", {});
  };

  // Read the live backup status (async freshness read folded in). Never carries the recovery key.
  app.get("/api/backup/status", (c) =>
    run(c, log, async () => {
      await authorize(c);
      return c.json(projectStatus(await deps.supervisor.status()));
    }),
  );

  // Mint a strong recovery key for the operator to record. Stateless — mints and returns, stores
  // nothing; `apply` is what persists a chosen key.
  app.post("/api/backup/mint-key", (c) =>
    run(c, log, async () => {
      await authorize(c);
      return c.json({ key: randomBytes(32).toString("base64url") });
    }),
  );

  // Configure + enable backups from the wizard. Guards, validates, writes `backup.env`, hot-reloads,
  // and confirms the effective key is the one the operator supplied.
  app.post("/api/backup/apply", (c) =>
    run(c, log, async () => {
      await authorize(c);
      guardWritable();
      const input = await readApplyBody(c);
      assertStorableKey(input.recoveryKey);
      // Dry-validate the EXACT record we are about to write, so the route rejects exactly what boot
      // would (`recovery_key_too_short`/`destinations_invalid`/`schedule_invalid`) BEFORE touching disk.
      loadBackupConfig(backupEnvRecord(input));
      await writeBackupEnv(deps.stateDir, input);
      await deps.supervisor.reload();
      const s = deps.supervisor.current();
      // The effective key is what the box will actually encrypt under. If a partial env override (or
      // any merge) made it differ from the requested key, fail LOUD rather than orphan archives.
      if (s.recoveryKey !== input.recoveryKey) throw new AppError("backup.effective_mismatch", {});
      return c.json(projectStatus(s));
    }),
  );

  // Return the EFFECTIVE recovery key (`current().recoveryKey`, what the box encrypts under — NOT the
  // file), so an operator can re-record it. Authenticated admin only, served over TLS; the body is
  // never logged (the boundary logs codes/params, never response bodies — and this route logs nothing).
  app.get("/api/backup/recovery-key", (c) =>
    run(c, log, async () => {
      await authorize(c);
      return c.json({ key: deps.supervisor.current().recoveryKey ?? null });
    }),
  );

  // Rotate the recovery key: reuse the running destination/schedule/retention, change only the key and
  // stamp `keyRotatedAt`. Same guards + effective-key assertion as `apply`; the supervisor's immediate
  // first tick after reload takes a fresh dump under the new key.
  app.post("/api/backup/rotate", (c) =>
    run(c, log, async () => {
      await authorize(c);
      guardWritable();
      const { recoveryKey } = await readRotateBody(c);
      assertStorableKey(recoveryKey);
      const input: BackupEnvInput = {
        ...fromCurrent(deps.supervisor.current()),
        recoveryKey,
        keyRotatedAt: new Date().toISOString(),
      };
      loadBackupConfig(backupEnvRecord(input));
      await writeBackupEnv(deps.stateDir, input);
      await deps.supervisor.reload();
      const s = deps.supervisor.current();
      if (s.recoveryKey !== recoveryKey) throw new AppError("backup.effective_mismatch", {});
      return c.json(projectStatus(s));
    }),
  );
}
