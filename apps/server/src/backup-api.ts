import { join } from "node:path";
import { SCRATCH_DIR } from "@waitron/store";
import { inScratch } from "./scratch.js";
import { randomUUID } from "node:crypto";
import { stat } from "node:fs/promises";
import type { Context, Hono } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { masterKeyMatches, type KeyRing } from "@waitron/credentials";
import { readCurrentMasterKey, withTransaction, type Database } from "@waitron/db";
import { authorizeManager, requireFreshManagementSignIn } from "@waitron/identity";
import type { StreamView } from "@waitron/stream";
import { AppError, decodeMasterKeyCode, hasCode, isAppError } from "@waitron/shared";
import {
  codeOf,
  createErrorBoundary,
  readJsonBody,
  requireManagementSession,
} from "@waitron/server-kit";
import {
  BUCKET_CHOICES,
  hasExactKeys,
  isRecord,
  isAtLeastDaily,
  archiveRecord,
  parseSchedule,
  readHeldArchiveSettings,
  requestInvalid,
  resolveArchiveChoices,
  checkArchiveChoiceList,
  writeArchiveSettings,
  type ArchiveSettings,
} from "./archive-settings.js";
import { buildBackupBackend } from "./backup-backends.js";
import {
  DEFAULT_DESTINATION_TIMEOUT_MS,
  MAX_DESTINATION_TIMEOUT_MS,
  MIN_DESTINATION_TIMEOUT_MS,
  loadKeyRotatedAt,
  loadRecoveryKey,
  readHeldKey,
  resolveBackupConfig,
  type BackupSchedule,
} from "./backup-config.js";
import { backupKeyRecord, changeBackupKey, heldBackupKeyNumber } from "./backup-key-record.js";
import { readSettingsEvidence, recoveryKeyFacts } from "./backup-settings-evidence.js";
import { UNREADABLE_CREDENTIAL } from "./credentials.js";
import { MIN_RECOVERY_KEY_LENGTH } from "./backup-config.js";
import {
  keyFingerprint,
  type BackupRuntimeStatus,
  type BackupSupervisor,
} from "./backup-supervisor.js";
import type { Logger } from "./logger.js";
import type { SealedStateRefresher } from "./sealed-state.js";
import type { BackupDestination, StorageBackend } from "./storage-backend.js";
import { readStreamSettings, type StreamSettings } from "./stream-host.js";
import type { StreamHost } from "./stream-host.js";
import type { Turns } from "./backup-turns.js";
import { cloudArchiveAvailable } from "./cloud-archive-target.js";
import type { CloudConnectionStatus } from "./cloud-client.js";
import { requireNodeOperationHttps } from "./node-operation-https.js";
import "./errors.js";

/** Everything the authenticated backup admin routes need. `stateDir` is where `backup.env`, which
 * holds the recovery key, is written. */
export interface BackupApiDeps {
  supervisor: BackupSupervisor;
  db: Database;
  /** Seals the archive settings, and opens the stream's for a `stream-bucket` choice. */
  ring: KeyRing;
  stateDir: string;
  /** The recovery key from the box env, read afresh each call. Answers with no archive destination
   * configured, which the supervisor's `current()` cannot. */
  readRecoveryKey: () => Promise<string | undefined>;
  /** The box env as a reload reads it: status reads the held key and its rotation time from it. */
  readBoxEnv: () => Promise<Record<string, string | undefined>>;
  /** Rewrites this node's sealed state row, which carries `backup.env` and is locked with the recovery
   * key. */
  sealedState: Pick<SealedStateRefresher, "refresh">;
  readStream: () => StreamView;
  readCloudStatus?: () => Promise<CloudConnectionStatus>;
  stream: Pick<StreamHost, "reload">;
  /** Shared with the stream settings routes, which also read and then write the key in
   * `backup.env`. */
  turns: Turns;
  /** Builds the backend Save tests an archive bucket through. */
  buildBackend?: (dest: BackupDestination) => StorageBackend;
  archiveProbeTimeoutMs?: number;
  /** How the settings evidence looks at a saved folder; `stat` by default. */
  statFolder?: (dir: string) => Promise<{ isDirectory(): boolean }>;
}

const STATUS: Record<string, ContentfulStatusCode> = {
  "management_session.required": 401,
  "management_session.expired": 401,
  "person.suspended": 403,
  "authorization.not_permitted": 403,
  "backup.not_primary": 409,
  "backup.not_enabled": 409,
  "backup.run_in_progress": 409,
  "backup.reload_in_progress": 409,
  "backup.recovery_key_too_short": 409,
  "master_key.wrong": 403,
  "node.operation_page_required": 403,
  "backup.destinations_invalid": 400,
  "backup.request_invalid": 400,
  "backup.cloud_needs_daily": 400,
  "backup.cloud_unavailable": 400,
  "backup.effective_mismatch": 500,
  "backup.not_configured": 409,
  "backup.archive_namespace_overlap": 400,
  "backup.stream_not_configured": 409,
  "backup.recovery_key_missing": 409,
  "backup.key_number_unknown": 409,
  "backup.archive_test_failed": 422,
  "backup.archive_settings_invalid": 500,
  "backup.rotation_metadata_failed": 500,
  "backup.archive_settings_unreadable": 500,
  "backup.stream_settings_unreadable": 500,
};

const ARCHIVE_PROBE_TIMEOUT_MS = 30 * 1000;
const PROBE_CLEANUP_TIMEOUT_MS = 10 * 1000;
const PROBE_BYTES = Buffer.from("waitron archive test\n");

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

function onlyKeys(value: Record<string, unknown>, keys: readonly string[], field: string): void {
  if (!hasExactKeys(value, [], keys)) throw requestInvalid(field);
}

function isWhole(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value);
}

/** A request may list wall-clock days in any order, and more than once. */
function readSchedule(raw: unknown): BackupSchedule {
  const days =
    isRecord(raw) && Array.isArray(raw.days) && raw.days.every((d) => typeof d === "number")
      ? [...new Set(raw.days as number[])].sort((a, b) => a - b)
      : undefined;
  return parseSchedule(days === undefined ? raw : { ...(raw as object), days }, () =>
    requestInvalid("schedule"),
  );
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
  cloud: boolean | undefined;
  /** Resolved inside the write's turn, against the settings held then. */
  destinations: Record<string, unknown>[];
  schedule: BackupSchedule;
  retention: { count: number; days: number };
  destinationTimeoutMs: number | undefined;
}

const APPLY_FIELDS = ["cloud", "destinations", "schedule", "retention", "destinationTimeoutMs"];

async function readBucketCopySettings(db: Database, ring: KeyRing): Promise<StreamSettings | null> {
  try {
    return await readStreamSettings(db, ring);
  } catch (error) {
    if (isAppError(error) && UNREADABLE_CREDENTIAL.has(error.code)) {
      throw new AppError("backup.stream_settings_unreadable", { reason: error.code });
    }
    throw error;
  }
}

/** A refusal names the offending field, never its value — it could be the key or a secret. An
 * unknown field is answered as `body`: its name is the caller's text, and could be a secret too. */
async function readApplyBody(c: Context): Promise<ApplyBody> {
  const body = await readJsonBody<unknown>(c);
  if (!isRecord(body)) throw requestInvalid("body");
  onlyKeys(body, APPLY_FIELDS, "body");
  const { cloud } = body;
  if ("cloud" in body && typeof cloud !== "boolean") throw requestInvalid("cloud");
  const destinations = checkArchiveChoiceList(body.destinations, cloud !== false);
  const { destinationTimeoutMs } = body;
  if (
    "destinationTimeoutMs" in body &&
    (!isWhole(destinationTimeoutMs) ||
      destinationTimeoutMs < MIN_DESTINATION_TIMEOUT_MS ||
      destinationTimeoutMs > MAX_DESTINATION_TIMEOUT_MS)
  ) {
    throw requestInvalid("destinationTimeoutMs");
  }
  return {
    cloud: typeof cloud === "boolean" ? cloud : undefined,
    destinations,
    schedule: readSchedule(body.schedule),
    retention: readRetention(body.retention),
    destinationTimeoutMs: destinationTimeoutMs as number | undefined,
  };
}

async function readRotateBody(c: Context): Promise<{ masterKey: string }> {
  const body = await readJsonBody<{ masterKey?: unknown }>(c);
  if (typeof body.masterKey !== "string" || body.masterKey === "") {
    throw requestInvalid("masterKey");
  }
  return { masterKey: body.masterKey };
}

/** The venue's current master key's bytes and row, or `master_key.wrong` naming that key. */
async function checkedMasterKey(db: Database, typed: string) {
  const current = await readCurrentMasterKey(db);
  let bytes: Uint8Array | null = null;
  try {
    bytes = decodeMasterKeyCode(typed);
  } catch (error) {
    if (!isAppError(error)) throw error;
  }
  if (current === null || bytes === null || !masterKeyMatches(bytes, current.checkValue)) {
    throw new AppError("master_key.wrong", current === null ? {} : { keyName: current.name });
  }
  return { bytes, current };
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
 * `apply` checks what it will store the way boot would read it before writing anything. After a
 * reload that loads the settings, `apply` and `rotate` assert the EFFECTIVE key equals the one they
 * wrote. A reload that throws after `apply`, `disable` or `rotate` committed, or that leaves
 * `apply`'s or `rotate`'s stored settings unusable, is reported as `reloadErrorCode`: the write
 * stands.
 */
export function mountBackupApi(app: Hono, deps: BackupApiDeps, log: Logger): void {
  const run = createErrorBoundary(STATUS, "backup.failed");
  const buildBackend = deps.buildBackend ?? buildBackupBackend;

  const authorize = async (c: Context): Promise<string> => {
    const sessionId = requireManagementSession(c);
    return withTransaction(deps.db, async (tx) => {
      const { authorizedBy } = await authorizeManager(tx, {
        managementSessionId: sessionId,
        permission: "system.manage",
      });
      return authorizedBy;
    });
  };

  // Refuse a write the box would silently override or that would never take effect here.
  const guardWritable = (): void => {
    const s = deps.supervisor.current();
    if (!s.isPrimary) throw new AppError("backup.not_primary", {});
  };

  // The refresh follows each write straight away, before anything that can refuse the request: what
  // is stored has changed whatever the request answers.
  const persist = async (write: () => Promise<void>): Promise<void> => {
    await write();
    await deps.sealedState.refresh();
  };

  const storeSettings = (
    settings: Omit<ArchiveSettings, "revision">,
    personId: string,
  ): Promise<void> =>
    persist(async () => {
      await withTransaction(deps.db, (tx) =>
        writeArchiveSettings(tx, deps.ring, settings, personId),
      );
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

  /** A reload's own failure, or else the code of settings it loaded but cannot use. */
  const reloadOutcome = async (): Promise<string | undefined> =>
    (await reloadAfterWrite()) ?? deps.supervisor.current().loadErrorCode ?? undefined;

  // The effective key is what the box will actually encrypt under. If a partial env override (or
  // any merge) made it differ from the written key, fail LOUD rather than orphan archives.
  const assertEffectiveKey = (reloadErrorCode: string | undefined, recoveryKey: string): void => {
    if (reloadErrorCode === undefined && deps.supervisor.current().recoveryKey !== recoveryKey) {
      throw new AppError("backup.effective_mismatch", {});
    }
  };

  const readHeldSettings = () => readHeldArchiveSettings(deps.db, deps.ring);

  // One read of the box env gives the held key, its fingerprint and its rotation time. With no
  // usable key there, the fingerprint and rotation time are the supervisor's; with none at all, so
  // is the held key.
  const statusBody = async () => {
    const env = await deps.readBoxEnv();
    const key = await recoveryKeyFacts(env, () => deps.supervisor.current().recoveryKey);
    const stream: StreamView & { pruneBlockedSince?: string } = { ...deps.readStream() };
    delete stream.pruneBlockedSince;
    const cloud = await deps.readCloudStatus?.().catch(() => undefined);
    return {
      cloudBackups: cloudArchiveAvailable(cloud) ? "available" : "unavailable",
      ...projectStatus(await deps.supervisor.status()),
      ...(key.fileKey === undefined
        ? {}
        : { keyFingerprint: keyFingerprint(key.fileKey), keyRotatedAt: loadKeyRotatedAt(env) }),
      recoveryKeySet: key.held,
      recoveryKeyTooShort: key.tooShort,
      stream,
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

  // Like status, it takes no backup turn.
  app.get("/api/backup/settings-evidence", (c) =>
    run(c, log, async () => {
      await authorize(c);
      const { supervisor } = deps;
      return c.json(
        await readSettingsEvidence({
          db: deps.db,
          ring: deps.ring,
          current: () => supervisor.current(),
          loadHistory: () => supervisor.loadHistory(),
          readBoxEnv: deps.readBoxEnv,
          now: () => supervisor.now(),
          statFolder: deps.statFolder ?? stat,
          lookTimeoutMs: supervisor.statusReadTimeoutMs,
        }),
      );
    }),
  );

  app.post("/api/backup/apply", (c) =>
    run(c, log, async () => {
      const personId = await authorize(c);
      guardWritable();
      await requireFreshManagementSignIn(deps.db, requireManagementSession(c));
      const body = await readApplyBody(c);
      return deps.turns(async () => {
        guardWritable(); // Again: role or env ownership may have changed while this write waited.
        // A record that cannot be read is replaced, as if none were held, so nothing in it is
        // reused; otherwise the owner could never repair it from the dashboard.
        const read = await readHeldSettings();
        if ("unreadable" in read) {
          log("warn", "backup.archive_settings_unreadable", { reason: read.unreadable });
        }
        const heldSettings = "unreadable" in read ? null : read.settings;
        const cloud = body.cloud ?? heldSettings?.cloud ?? false;
        if (!cloud && body.destinations.length === 0) throw requestInvalid("destinations");
        if (cloud && !isAtLeastDaily(body.schedule)) {
          throw new AppError("backup.cloud_needs_daily", { field: "schedule" });
        }
        if (body.cloud === true && (await deps.readCloudStatus?.())?.environment !== "test") {
          throw new AppError("backup.cloud_unavailable", { field: "cloud" });
        }
        // Archives are locked with the key the box env holds (`backup.env` under the raw
        // environment, as a reload reads it); this route never writes one.
        const env = await deps.readBoxEnv();
        const held = await readHeldKey(async () => loadRecoveryKey(env));
        const recoveryKey = held.key;
        if (recoveryKey === undefined) {
          throw held.held
            ? new AppError("backup.recovery_key_too_short", { min: MIN_RECOVERY_KEY_LENGTH })
            : new AppError("backup.recovery_key_missing", {});
        }

        // Only a bucket choice reads the bucket copy's settings, and an unreadable one refuses the
        // whole Save, a folder listed beside it included: one Save is one decision.
        const stream = body.destinations.some((d) => BUCKET_CHOICES.has(d.kind))
          ? await readBucketCopySettings(deps.db, deps.ring)
          : null;
        const destinations = resolveArchiveChoices(body.destinations, {
          stream,
          held: heldSettings,
          cloud,
        });
        for (const destination of destinations) {
          if (destination.kind !== "local-fs") continue;
          let forbidden: boolean;
          try {
            forbidden = await inScratch(deps.stateDir, destination.dir);
          } catch {
            throw new AppError("backup.request_invalid", { field: "dir", reason: "unreadable" });
          }
          if (forbidden)
            throw new AppError("backup.request_invalid", {
              field: "dir",
              reason: "scratch",
              scratchRoot: join(deps.stateDir, SCRATCH_DIR),
            });
        }
        const settings: Omit<ArchiveSettings, "revision"> = {
          enabled: true,
          cloud,
          destinations,
          schedule: body.schedule,
          retention: body.retention,
          destinationTimeoutMs:
            body.destinationTimeoutMs ??
            heldSettings?.destinationTimeoutMs ??
            DEFAULT_DESTINATION_TIMEOUT_MS,
        };
        const sealed = archiveRecord(settings).stored;
        // Refuse exactly what boot would, before anything is written.
        resolveBackupConfig({ env: { ...env, WAITRON_BACKUP_RECOVERY_KEY: recoveryKey }, sealed });
        const bucketDestination = destinations.find((d) => d.kind === "s3");
        if (bucketDestination !== undefined) {
          await probeArchive(
            buildBackend(bucketDestination),
            deps.archiveProbeTimeoutMs ?? ARCHIVE_PROBE_TIMEOUT_MS,
            PROBE_CLEANUP_TIMEOUT_MS,
          );
        }

        await storeSettings(settings, personId);
        const reloadErrorCode = await reloadOutcome();
        assertEffectiveKey(reloadErrorCode, recoveryKey);
        return writeAnswer(c, reloadErrorCode);
      });
    }),
  );

  app.post("/api/backup/run-now", (c) =>
    run(c, log, async () => {
      await authorize(c);
      await requireFreshManagementSignIn(deps.db, requireManagementSession(c));
      void deps.supervisor.runNow();
      return c.json({}, 202);
    }),
  );

  app.post("/api/backup/disable", (c) =>
    run(c, log, async () => {
      const personId = await authorize(c);
      guardWritable();
      await requireFreshManagementSignIn(deps.db, requireManagementSession(c));
      return deps.turns(async () => {
        guardWritable();
        const read = await readHeldSettings();
        if ("unreadable" in read) {
          throw new AppError("backup.archive_settings_unreadable", { reason: read.unreadable });
        }
        const held = read.settings;
        if (held === null) throw new AppError("backup.not_configured", {});
        await storeSettings({ ...withoutRevision(held), enabled: false }, personId);
        return writeAnswer(c, await reloadAfterWrite());
      });
    }),
  );

  // A key change writes backup key N+1 of the venue's master key (1 when `backup.env` names no
  // number; refused when the number it names is not a key number) to `backup.env`, then stores the held settings unchanged
  // under a new revision and reloads. With no readable record and nothing loaded, only the key file
  // changes.
  app.post("/api/backup/rotate", (c) =>
    run(c, log, async () => {
      const personId = await authorize(c);
      guardWritable();
      requireNodeOperationHttps(c);
      await requireFreshManagementSignIn(deps.db, requireManagementSession(c));
      const { masterKey } = await readRotateBody(c);
      return deps.turns(async () => {
        guardWritable(); // Again: role or env ownership may have changed while this write waited.
        const { bytes, current } = await checkedMasterKey(deps.db, masterKey);
        const heldNumber = heldBackupKeyNumber(await deps.readBoxEnv());
        if (heldNumber === undefined) throw new AppError("backup.key_number_unknown", {});
        const record = backupKeyRecord(bytes, heldNumber + 1, current.publicKey, current.name);
        const recoveryKey = record.key;
        const keyRotatedAt = new Date().toISOString();
        const read = await readHeldSettings();
        const held = "unreadable" in read ? null : read.settings;
        const unreadableCode = "unreadable" in read ? read.unreadable : undefined;
        // An unreadable record is never rewritten, so its key changes the key-only way.
        if (held === null && deps.supervisor.current().destinations.length === 0) {
          await changeBackupKey(deps, record, keyRotatedAt);
          if ((await deps.readRecoveryKey()) !== recoveryKey) {
            throw new AppError("backup.effective_mismatch", {});
          }
          return c.json({
            ...(await statusBody()),
            ...(unreadableCode === undefined
              ? {}
              : { loadErrorCode: unreadableCode, reloadErrorCode: unreadableCode }),
          });
        }
        await changeBackupKey(deps, record, keyRotatedAt);
        // The key file is authoritative from here: a failure below never puts the old key back.
        if (held !== null) {
          try {
            await withTransaction(deps.db, (tx) =>
              writeArchiveSettings(tx, deps.ring, withoutRevision(held), personId),
            );
          } catch (error) {
            log("warn", "backup.rotation_metadata_failed", { errorCode: codeOf(error) });
            const sealedState = await deps.sealedState.refresh();
            const reloadErrorCode = await reloadOutcome();
            assertEffectiveKey(reloadErrorCode, recoveryKey);
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
        const reloadErrorCode = await reloadOutcome();
        assertEffectiveKey(reloadErrorCode, recoveryKey);
        return writeAnswer(c, reloadErrorCode);
      });
    }),
  );
}
