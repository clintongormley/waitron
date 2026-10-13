import { randomUUID } from "node:crypto";
import type { Context, Hono } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import type { KeyRing } from "@waitron/credentials";
import { withTransaction, type Database } from "@waitron/db";
import { authorizeManager } from "@waitron/identity";
import type { StreamView } from "@waitron/stream";
import { AppError, hasCode, isAppError } from "@waitron/shared";
import {
  codeOf,
  createErrorBoundary,
  readJsonBody,
  requireManagementSession,
} from "@waitron/server-kit";
import {
  parseArchiveSettings,
  readArchiveSettings,
  resolveArchiveChoice,
  writeArchiveSettings,
  type ArchiveSettings,
} from "./archive-settings.js";
import { buildBackupBackend } from "./backup-backends.js";
import {
  DEFAULT_DESTINATION_TIMEOUT_MS,
  MAX_DESTINATION_TIMEOUT_MS,
  MIN_DESTINATION_TIMEOUT_MS,
  loadRecoveryKey,
  mintRecoveryKey,
  readHeldKey,
  resolveBackupConfig,
  type BackupSchedule,
} from "./backup-config.js";
import { writeRecoveryKey } from "./backup-env-writer.js";
import { formatEnvFile, parseEnvFile } from "./env-file.js";
import { MIN_PASSPHRASE_LENGTH } from "./recovery-bundle.js";
import {
  keyFingerprint,
  type BackupRuntimeStatus,
  type BackupSupervisor,
} from "./backup-supervisor.js";
import type { Logger } from "./logger.js";
import type { SealedStateRefresher } from "./sealed-state.js";
import type { BackupDestination, StorageBackend } from "./storage-backend.js";
import { readStreamSettings } from "./stream-host.js";
import type { Turns } from "./backup-turns.js";
import "./errors.js";

/** Everything the authenticated backup admin routes need. `stateDir` is where `backup.env`, which
 * holds the recovery key, is written. */
export interface BackupApiDeps {
  supervisor: BackupSupervisor;
  db: Database;
  /** Seals the archive settings, and opens the stream's for a `stream-bucket` choice. */
  ring: KeyRing;
  venueId: string;
  stateDir: string;
  /** The recovery key from the box env, read afresh each call. Answers with no archive destination
   * configured, which the supervisor's `current()` cannot. */
  readRecoveryKey: () => Promise<string | undefined>;
  /** Rewrites this node's sealed state row, which carries `backup.env` and is locked with the recovery
   * key. */
  sealedState: SealedStateRefresher;
  readStream: () => StreamView;
  /** Shared with the stream settings routes, which also read and then write the key in
   * `backup.env`. */
  turns: Turns;
  /** Builds the backend Save tests an archive bucket through. */
  buildBackend?: (dest: BackupDestination) => StorageBackend;
  archiveProbeTimeoutMs?: number;
}

const STATUS: Record<string, ContentfulStatusCode> = {
  "management_session.required": 401,
  "management_session.expired": 401,
  "person.suspended": 403,
  "authorization.not_permitted": 403,
  "backup.managed_by_environment": 409,
  "backup.not_primary": 409,
  "backup.reload_in_progress": 409,
  "backup.recovery_key_exists": 409,
  "backup.recovery_key_unstorable": 400,
  "backup.recovery_key_too_short": 400,
  "backup.destinations_invalid": 400,
  "backup.schedule_invalid": 400,
  "backup.request_invalid": 400,
  "backup.effective_mismatch": 400,
  "backup.archive_namespace_overlap": 400,
  "backup.stream_not_configured": 409,
  "backup.archive_test_failed": 422,
  "backup.archive_settings_invalid": 500,
  "backup.rotation_metadata_failed": 500,
  "backup.archive_settings_unreadable": 409,
};

/** What reading a stored archive record answers when the record itself cannot be read. */
const UNREADABLE_SETTINGS = new Set([
  "backup.archive_settings_invalid",
  "credentials.decrypt_failed",
  "credentials.malformed_payload",
  "credentials.key_version_unknown",
  "server.credential_unusable",
]);

const ARCHIVE_PROBE_TIMEOUT_MS = 30 * 1000;
const PROBE_CLEANUP_TIMEOUT_MS = 10 * 1000;
const PROBE_BYTES = Buffer.from("waitron archive test\n");

/**
 * Refuse a recovery key that cannot be stored VERBATIM in `backup.env`: the box would encrypt archives
 * under a DIFFERENT string than the operator recorded. `reason` never carries the key.
 */
export function assertStorableKey(key: string): void {
  // `[\r\n\t]` is redundant with `[\x00-\x1f]` (which covers all C0 controls) but is kept explicit —
  // newlines and tabs are the ways a pasted key most often breaks an env file.
  // eslint-disable-next-line no-control-regex
  if (/[\r\n\t]/.test(key) || /[\x00-\x1f]/.test(key) || key.trim() !== key) {
    throw new AppError("backup.recovery_key_unstorable", { reason: "whitespace_or_control" });
  }
  if (parseEnvFile(formatEnvFile({ K: key })).K !== key) {
    throw new AppError("backup.recovery_key_unstorable", { reason: "round_trip" });
  }
}

function projectStatus<T extends BackupRuntimeStatus>(s: T): Omit<T, "recoveryKey"> {
  const rest: Omit<T, "recoveryKey"> & { recoveryKey?: string } = { ...s };
  delete rest.recoveryKey;
  return rest;
}

function withoutRevision(settings: ArchiveSettings): Omit<ArchiveSettings, "revision"> {
  const rest: Omit<ArchiveSettings, "revision"> & { revision?: string } = { ...settings };
  delete rest.revision;
  return rest;
}

function requestInvalid(field: string): AppError {
  return new AppError("backup.request_invalid", { field });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function onlyKeys(value: Record<string, unknown>, keys: readonly string[], field: string): void {
  if (!Object.keys(value).every((key) => keys.includes(key))) throw requestInvalid(field);
}

function isWhole(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value);
}

function readSchedule(raw: unknown): BackupSchedule {
  const invalid = () => requestInvalid("schedule");
  if (!isRecord(raw)) throw invalid();
  if (raw.kind === "interval") {
    onlyKeys(raw, ["kind", "ms"], "schedule");
    if (!isWhole(raw.ms) || raw.ms <= 0) throw invalid();
    return { kind: "interval", ms: raw.ms };
  }
  if (raw.kind !== "wall-clock") throw invalid();
  onlyKeys(raw, ["kind", "days", "at"], "schedule");
  let days: "daily" | number[];
  if (raw.days === "daily") days = "daily";
  else if (
    Array.isArray(raw.days) &&
    raw.days.length > 0 &&
    raw.days.every((n) => isWhole(n) && n >= 0 && n <= 6)
  ) {
    days = [...new Set(raw.days as number[])].sort((a, b) => a - b);
  } else throw invalid();

  let at: { hour: number; minute: number } | "auto";
  if (raw.at === "auto") at = "auto";
  else if (isRecord(raw.at)) {
    onlyKeys(raw.at, ["hour", "minute"], "schedule");
    const { hour, minute } = raw.at;
    if (!isWhole(hour) || !isWhole(minute) || hour < 0 || hour > 23 || minute < 0 || minute > 59) {
      throw invalid();
    }
    at = { hour, minute };
  } else throw invalid();
  return { kind: "wall-clock", days, at };
}

function readRetention(raw: unknown): { count: number; days: number } {
  if (!isRecord(raw)) throw requestInvalid("retention");
  onlyKeys(raw, ["count", "days"], "retention");
  const { count, days } = raw;
  if (!isWhole(count) || count <= 0 || !isWhole(days) || days <= 0) {
    throw requestInvalid("retention");
  }
  return { count, days };
}

interface ApplyBody {
  /** Resolved inside the write's turn, against the settings held then. */
  destination: Record<string, unknown>;
  /** `undefined` when absent, because a box that already holds a key reuses it. */
  recoveryKey: string | undefined;
  schedule: BackupSchedule;
  retention: { count: number; days: number };
  destinationTimeoutMs: number | undefined;
}

const APPLY_FIELDS = [
  "destination",
  "recoveryKey",
  "schedule",
  "retention",
  "destinationTimeoutMs",
];

/** A refusal names the offending field, never its value — it could be the key or a secret. An
 * unknown field is answered as `body`: its name is the caller's text, and could be a secret too. */
async function readApplyBody(c: Context): Promise<ApplyBody> {
  const body = await readJsonBody<unknown>(c);
  if (!isRecord(body)) throw requestInvalid("body");
  if (!Object.keys(body).every((key) => APPLY_FIELDS.includes(key))) throw requestInvalid("body");
  if (!isRecord(body.destination)) throw requestInvalid("destination");
  const { recoveryKey, destinationTimeoutMs } = body;
  if ("recoveryKey" in body && (typeof recoveryKey !== "string" || recoveryKey === "")) {
    throw requestInvalid("recoveryKey");
  }
  if (
    "destinationTimeoutMs" in body &&
    (!isWhole(destinationTimeoutMs) ||
      destinationTimeoutMs < MIN_DESTINATION_TIMEOUT_MS ||
      destinationTimeoutMs > MAX_DESTINATION_TIMEOUT_MS)
  ) {
    throw requestInvalid("destinationTimeoutMs");
  }
  return {
    destination: body.destination,
    recoveryKey: recoveryKey as string | undefined,
    schedule: readSchedule(body.schedule),
    retention: readRetention(body.retention),
    destinationTimeoutMs: destinationTimeoutMs as number | undefined,
  };
}

async function readRotateBody(c: Context): Promise<{ recoveryKey: string }> {
  const body = await readJsonBody<{ recoveryKey?: unknown }>(c);
  if (typeof body.recoveryKey !== "string" || body.recoveryKey === "") {
    throw requestInvalid("recoveryKey");
  }
  return { recoveryKey: body.recoveryKey };
}

function testFailed(reason: string): AppError {
  return new AppError("backup.archive_test_failed", { reason });
}

/**
 * Writes, reads back and lists one object under the archive folder, then deletes only that object.
 * Passing says the bucket answered these four calls now, not that later archives will fit or be
 * kept. The delete gets its own time limit, so it is still attempted after the test ran out of time.
 */
async function probeArchive(
  backend: StorageBackend,
  timeoutMs: number,
  cleanupTimeoutMs: number,
): Promise<void> {
  const probeKey = `waitron-probe-${randomUUID()}`;
  const signal = AbortSignal.timeout(timeoutMs);
  const reason = (error: unknown) => (signal.aborted ? "timed_out" : codeOf(error));
  let failure: AppError | undefined;
  try {
    await backend.put(probeKey, PROBE_BYTES, { signal });
    const read = await backend.get(probeKey, { signal });
    if (!PROBE_BYTES.equals(read)) throw testFailed("read_mismatch");
    const listed = await backend.list(probeKey, { signal });
    if (!listed.some((o) => o.key === probeKey)) throw testFailed("not_listed");
  } catch (error) {
    failure =
      isAppError(error) && hasCode(error, "backup.archive_test_failed")
        ? error
        : testFailed(reason(error));
  }
  try {
    await backend.deleteMany([probeKey], { signal: AbortSignal.timeout(cleanupTimeoutMs) });
  } catch (error) {
    failure ??= testFailed(codeOf(error));
  } finally {
    backend.close();
  }
  if (failure !== undefined) throw failure;
}

/**
 * `apply` checks what it will store the way boot would read it before writing anything, and after
 * a reload that succeeds asserts the EFFECTIVE key equals the one it chose (the guard against a
 * partial env override silently orphaning archives). A reload that fails after `apply` or `disable` committed
 * is answered 200 with `reloadErrorCode`: the write stands.
 */
export function mountBackupApi(app: Hono, deps: BackupApiDeps, log: Logger): void {
  const run = createErrorBoundary(STATUS, "backup.failed");
  const buildBackend = deps.buildBackend ?? buildBackupBackend;

  const authorize = async (c: Context): Promise<void> => {
    const sessionId = requireManagementSession(c);
    await withTransaction(deps.db, async (tx) => {
      await authorizeManager(tx, { managementSessionId: sessionId, permission: "system.manage" });
    });
  };

  // Refuse a write the box would silently override or that would never take effect here.
  const guardWritable = (): void => {
    const s = deps.supervisor.current();
    if (s.managedByEnvironment) throw new AppError("backup.managed_by_environment", {});
    if (!s.isPrimary) throw new AppError("backup.not_primary", {});
  };

  // The refresh follows each write straight away, before anything that can refuse the request: what
  // is stored has changed whatever the request answers.
  const persist = async (write: () => Promise<void>): Promise<void> => {
    await write();
    await deps.sealedState.refresh();
  };

  const storeSettings = (settings: Omit<ArchiveSettings, "revision">): Promise<void> =>
    persist(async () => {
      await withTransaction(deps.db, (tx) => writeArchiveSettings(tx, deps.ring, settings));
    });

  /** Runs outside every transaction; a failure is reported, not thrown, because the write stands. */
  const reloadAfterWrite = async (): Promise<string | undefined> => {
    try {
      await deps.supervisor.reload();
      return undefined;
    } catch (error) {
      const errorCode = codeOf(error);
      log("warn", "backup.reload_after_write_failed", { errorCode });
      return errorCode;
    }
  };

  const readRecord = async (): Promise<{
    held: ArchiveSettings | null;
    unreadableCode: string | undefined;
  }> => {
    try {
      return { held: await readArchiveSettings(deps.db, deps.ring), unreadableCode: undefined };
    } catch (error) {
      return { held: null, unreadableCode: codeOf(error) };
    }
  };

  // The box env (`backup.env` under the raw environment, as a reload reads it) is authoritative: after
  // a failed reload the supervisor still holds the key it loaded before the key file changed.
  /** The stored archive settings, or the code that says the stored record cannot be read. */
  const readHeldSettings = async (): Promise<
    { settings: ArchiveSettings | null } | { unreadable: string }
  > => {
    try {
      return { settings: await readArchiveSettings(deps.db, deps.ring) };
    } catch (error) {
      if (isAppError(error) && UNREADABLE_SETTINGS.has(error.code)) {
        return { unreadable: error.code };
      }
      throw error;
    }
  };

  const heldKey = async (): Promise<string | undefined> =>
    (await deps.readRecoveryKey()) ?? deps.supervisor.current().recoveryKey;

  // Presence, not validity: a key under the length floor still counts as held, so `rotate` can
  // replace it. `GET recovery-key` keeps refusing such a key.
  const keyPresent = async (): Promise<boolean> => (await readHeldKey(heldKey)).held;

  const statusBody = async (known?: { held: boolean; key: string | undefined }) => {
    const { held, key } = known ?? (await readHeldKey(heldKey));
    return {
      ...projectStatus(await deps.supervisor.status()),
      recoveryKeySet: held,
      recoveryKeyTooShort: held && key === undefined,
      stream: deps.readStream(),
    };
  };

  /** The complete status, as `GET /api/backup/status` answers, plus a failed reload's code. */
  const writeAnswer = async (c: Context, reloadErrorCode: string | undefined) =>
    c.json({
      ...(await statusBody()),
      ...(reloadErrorCode === undefined ? {} : { reloadErrorCode }),
    });

  // Never carries the recovery key.
  app.get("/api/backup/status", (c) =>
    run(c, log, async () => {
      await authorize(c);
      return c.json(await statusBody());
    }),
  );

  app.post("/api/backup/mint-key", (c) =>
    run(c, log, async () => {
      await authorize(c);
      return c.json({ key: mintRecoveryKey() });
    }),
  );

  app.post("/api/backup/apply", (c) =>
    run(c, log, async () => {
      await authorize(c);
      guardWritable();
      const body = await readApplyBody(c);
      return deps.turns(async () => {
        guardWritable(); // Again: role or env ownership may have changed while this write waited.
        const held = await readHeldKey(heldKey);
        // A held key under the length floor is replaced, not kept: archives, the bucket copy and
        // sealed state all read the key through `loadRecoveryKey`, which refuses one this short.
        if (held.held && held.key === undefined && body.recoveryKey === undefined) {
          throw new AppError("backup.recovery_key_too_short", { min: MIN_PASSPHRASE_LENGTH });
        }
        // One recovery key per venue: a box holding a key long enough to use keeps it; only `rotate`
        // changes it.
        if (
          held.key !== undefined &&
          body.recoveryKey !== undefined &&
          body.recoveryKey !== held.key
        ) {
          throw new AppError("backup.recovery_key_exists", {});
        }
        const recoveryKey = held.key ?? body.recoveryKey;
        if (recoveryKey === undefined) throw requestInvalid("recoveryKey");
        assertStorableKey(recoveryKey);

        // A record that cannot be read is replaced, as if none were held, so nothing in it is
        // reused; otherwise the owner could never repair it from the dashboard.
        const read = await readHeldSettings();
        if ("unreadable" in read) {
          log("warn", "backup.archive_settings_unreadable", { reason: read.unreadable });
        }
        const heldSettings = "unreadable" in read ? null : read.settings;
        const stream = await readStreamSettings(deps.db, deps.ring);
        const destination = resolveArchiveChoice(body.destination, {
          venueId: deps.venueId,
          stream,
          held: heldSettings,
        });
        const settings: Omit<ArchiveSettings, "revision"> = {
          enabled: true,
          destinations: [destination],
          schedule: body.schedule,
          retention: body.retention,
          destinationTimeoutMs:
            body.destinationTimeoutMs ??
            heldSettings?.destinationTimeoutMs ??
            DEFAULT_DESTINATION_TIMEOUT_MS,
        };
        // Refuse exactly what boot would, before anything is written.
        resolveBackupConfig({
          managedByEnvironment: false,
          env: { WAITRON_BACKUP_RECOVERY_KEY: recoveryKey },
          sealed: parseArchiveSettings(JSON.stringify({ ...settings, revision: randomUUID() })),
          venueId: deps.venueId,
        });
        if (destination.kind === "s3") {
          await probeArchive(
            buildBackend(destination),
            deps.archiveProbeTimeoutMs ?? ARCHIVE_PROBE_TIMEOUT_MS,
            PROBE_CLEANUP_TIMEOUT_MS,
          );
        }

        // Deliberate split: the key file cannot join the transaction; refused settings leave a key.
        if (held.key === undefined) {
          await persist(() =>
            writeRecoveryKey(deps.stateDir, { recoveryKey, keyRotatedAt: undefined }),
          );
        }
        await storeSettings(settings);
        const reloadErrorCode = await reloadAfterWrite();
        // The effective key is what the box will actually encrypt under. If a partial env override (or
        // any merge) made it differ from the key chosen above, fail LOUD rather than orphan archives.
        if (
          reloadErrorCode === undefined &&
          deps.supervisor.current().recoveryKey !== recoveryKey
        ) {
          throw new AppError("backup.effective_mismatch", {});
        }
        return writeAnswer(c, reloadErrorCode);
      });
    }),
  );

  app.post("/api/backup/disable", (c) =>
    run(c, log, async () => {
      await authorize(c);
      guardWritable();
      return deps.turns(async () => {
        guardWritable();
        const read = await readHeldSettings();
        if ("unreadable" in read) {
          throw new AppError("backup.archive_settings_unreadable", { reason: read.unreadable });
        }
        const held = read.settings;
        if (held === null) throw requestInvalid("config");
        await storeSettings({
          enabled: false,
          destinations: held.destinations,
          schedule: held.schedule,
          retention: held.retention,
          destinationTimeoutMs: held.destinationTimeoutMs,
        });
        return writeAnswer(c, await reloadAfterWrite());
      });
    }),
  );

  // The key the box env holds, which the next archive is locked with, so an operator can re-record
  // it. The body is never logged: the error boundary logs codes and params, never response bodies,
  // and this route logs nothing.
  app.get("/api/backup/recovery-key", (c) =>
    run(c, log, async () => {
      await authorize(c);
      const key = (await heldKey()) ?? null;
      return c.json({ key });
    }),
  );

  // Rotation writes the key to `backup.env`, then stores the held settings unchanged under a new
  // revision and reloads. With no readable record and nothing loaded, only the key file changes.
  app.post("/api/backup/rotate", (c) =>
    run(c, log, async () => {
      await authorize(c);
      guardWritable();
      const { recoveryKey } = await readRotateBody(c);
      assertStorableKey(recoveryKey);
      return deps.turns(async () => {
        guardWritable(); // Again: role or env ownership may have changed while this write waited.
        const keyRotatedAt = new Date().toISOString();
        loadRecoveryKey({ WAITRON_BACKUP_RECOVERY_KEY: recoveryKey });
        const { held, unreadableCode } = await readRecord();
        // An unreadable record is never rewritten, so its key changes the key-only way.
        if (held === null && deps.supervisor.current().destinations.length === 0) {
          if (!(await keyPresent())) throw requestInvalid("config");
          await persist(() => writeRecoveryKey(deps.stateDir, { recoveryKey, keyRotatedAt }));
          if ((await deps.readRecoveryKey()) !== recoveryKey) {
            throw new AppError("backup.effective_mismatch", {});
          }
          return c.json({
            ...(await statusBody({ held: true, key: recoveryKey })),
            ...(unreadableCode === undefined ? {} : { loadErrorCode: unreadableCode }),
          });
        }
        await persist(() => writeRecoveryKey(deps.stateDir, { recoveryKey, keyRotatedAt }));
        // The key file is authoritative from here: a failure below never puts the old key back.
        if (held !== null) {
          try {
            await withTransaction(deps.db, (tx) =>
              writeArchiveSettings(tx, deps.ring, withoutRevision(held)),
            );
          } catch (error) {
            log("warn", "backup.rotation_metadata_failed", { errorCode: codeOf(error) });
            const sealedState = await deps.sealedState.refresh();
            const reloadErrorCode = await reloadAfterWrite();
            throw new AppError("backup.rotation_metadata_failed", {
              effectiveKeyChanged: true,
              keyFingerprint: keyFingerprint(recoveryKey),
              keyRotatedAt,
              ...(reloadErrorCode === undefined ? {} : { reloadErrorCode }),
              ...(sealedState === "sealed" ? {} : { sealedState }),
            });
          }
          await deps.sealedState.refresh();
        }
        const reloadErrorCode = await reloadAfterWrite();
        const loaded = deps.supervisor.current();
        if (
          reloadErrorCode === undefined &&
          loaded.loadErrorCode === null &&
          loaded.recoveryKey !== recoveryKey
        ) {
          throw new AppError("backup.effective_mismatch", {});
        }
        return writeAnswer(c, reloadErrorCode);
      });
    }),
  );
}
