import { isSecure } from "./encrypted-connection.js";
import { inArray } from "drizzle-orm";
import type { Context, Hono } from "hono";
import { credentialRevision, type KeyRing } from "@waitron/credentials";
import {
  insertRecoveryPack,
  markRecoveryPackReceived,
  nextRecoveryPackNumber,
  readRecoveryPack,
  readCurrentMasterKey,
  readRecoveryPacks,
  readVenue,
  withTransaction,
  type Database,
  type Transaction,
} from "@waitron/db";
import { authorizeManager, requireFreshManagementSignIn, persons } from "@waitron/identity";
import type { ProvisionedNode } from "@waitron/module";
import { makeNewMasterKey, type NewMasterKey } from "@waitron/provisioning";
import type { PackLocale } from "@waitron/recovery-pack";
import {
  createErrorBoundary,
  readRawJsonBody,
  requireManagementSession,
} from "@waitron/server-kit";
import { AppError, decodeMasterKeyCode, isAppError } from "@waitron/shared";
import { readHeldArchiveSettingsIn } from "./archive-settings.js";
import { errnoOf } from "./errno.js";
import { inTurn } from "./attempt-turns.js";
import { loadKeyRotatedAt, loadRecoveryKey, readHeldKey } from "./backup-config.js";
import { backupKeyEnv } from "./backup-env-writer.js";
import {
  backupKeyFacts,
  backupKeyRecord,
  changeBackupKey,
  heldBackupKeyNumber,
  type BackupKeyChangeDeps,
} from "./backup-key-record.js";
import {
  buildEmergencyPart,
  type EmergencyPartInput,
  buildArchivesPart,
  buildBucketPart,
  type BuiltPart,
  type PartsContext,
} from "./backup-recovery-pack-parts.js";
import {
  currentMasterKeyElsewhere,
  masterKeyElsewhere,
  drawRecoveryPack,
  shownMasterKey,
} from "./backup-recovery-pack-output.js";
import { keepOldPackUntil, packStatus, type CurrentChecks } from "./backup-recovery-pack-status.js";
import type { BackupRuntimeStatus } from "./backup-supervisor.js";
import type { Turns } from "./backup-turns.js";
import type { Logger } from "./logger.js";
import { insertNewMasterKey } from "./master-key-record.js";
import { STREAM_PURPOSE } from "./stream-host.js";
import { knownZone } from "./venue-time-zone.js";
import { sentFromThisOrigin } from "./own-page.js";
import type { CloudConnection } from "./cloud-client.js";
import { readEmergencyPeople } from "./cloud-emergency-people.js";
import "./errors.js";

export interface BackupRecoveryPackMakeDeps extends BackupKeyChangeDeps {
  cloud?: {
    connection: Pick<CloudConnection, "status" | "emergencyCode" | "emergency">;
    managementOrigin: string;
    isPrimary: () => boolean;
  };
  db: Database;
  ring: KeyRing;
  node: ProvisionedNode;
  /** The backup API's own turns, so a Save or a key change waits for a pack being made. */
  turns: Turns;
  readBoxEnv: () => Promise<Readonly<Record<string, string | undefined>>>;
  /** What the backup supervisor holds now; the key never leaves the server. */
  backups: () => Pick<BackupRuntimeStatus, "schedule" | "retention" | "recoveryKey">;
  loadFonts: () => Promise<{ regular: Uint8Array; mono: Uint8Array }>;
  now: () => Date;
  reloadBackups: () => Promise<void>;
}

const makeRun = createErrorBoundary(
  {
    "management_session.required": 401,
    "management_session.expired": 401,
    "person.suspended": 403,
    "authorization.not_permitted": 403,
    "recovery.pack_connection_insecure": 403,
    "recovery.pack_origin_refused": 403,
    "recovery.pack_invalid": 400,
    "management.request_invalid": 400,
    "password.invalid": 401,
    "password.throttled": 429,
    "totp.invalid": 401,
    "totp.required": 401,
    "passkey.not_registered": 401,
    "passkey.verification_failed": 401,
    "passkey.challenge_expired": 400,
  },
  "backup.failed",
);

/** An error's code, or a file-system error's errno; never its message. */
function failure(error: unknown): string {
  return isAppError(error) ? error.code : (errnoOf(error) ?? "unknown");
}

function invalid(reason: "shape" | "unknown_pack"): never {
  throw new AppError("recovery.pack_invalid", { reason });
}

function requireSecurePackRequest(c: Context): void {
  if (!isSecure(c)) {
    throw new AppError("recovery.pack_connection_insecure", {});
  }
  if (!sentFromThisOrigin(c)) {
    throw new AppError("recovery.pack_origin_refused", {});
  }
  if (c.req.header("Content-Type")?.split(";")[0]?.trim().toLowerCase() !== "application/json") {
    invalid("shape");
  }
}

type MakeRequest = { locale: PackLocale; newMasterKey: boolean };

function makeRequest(body: unknown): MakeRequest {
  if (body === null || typeof body !== "object" || Array.isArray(body)) invalid("shape");
  const fields = body as Record<string, unknown>;
  const keys = Object.keys(fields).sort();
  if (
    keys.join(",") !== "locale,newMasterKey" ||
    (fields.locale !== "en" && fields.locale !== "es") ||
    typeof fields.newMasterKey !== "boolean"
  ) {
    invalid("shape");
  }
  return fields as MakeRequest;
}

async function currentArchives(
  tx: Transaction,
  deps: BackupRecoveryPackMakeDeps,
): Promise<CurrentChecks["archives"]> {
  const read = await readHeldArchiveSettingsIn(tx, deps.ring);
  if ("unreadable" in read) return "unreadable";
  return read.settings === null ? null : { revision: read.settings.revision };
}

async function currentChecks(
  tx: Transaction,
  deps: BackupRecoveryPackMakeDeps,
  env: Readonly<Record<string, string | undefined>>,
): Promise<CurrentChecks> {
  const streamRevision = await credentialRevision(tx, { purpose: STREAM_PURPOSE });
  return {
    keyChangedAt: loadKeyRotatedAt(env),
    bucket: streamRevision === null ? null : { revision: streamRevision },
    archives: await currentArchives(tx, deps),
  };
}

async function mayPrintEmergency(db: Database | Transaction, token: string): Promise<boolean> {
  try {
    await authorizeManager(db, {
      managementSessionId: token,
      permission: "node.manage",
      touch: false,
    });
    return true;
  } catch (error) {
    if (isAppError(error) && error.code === "authorization.not_permitted") return false;
    throw error;
  }
}

async function readPackEmergency(
  deps: BackupRecoveryPackMakeDeps,
  token: string,
  signal: AbortSignal,
): Promise<EmergencyPartInput> {
  const cloud = deps.cloud;
  if (!cloud) return { state: "absent", reason: "not_connected" };
  if (!cloud.isPrimary()) return { state: "absent", reason: "not_primary" };
  if (!(await mayPrintEmergency(deps.db, token))) return { state: "absent", reason: "permission" };
  try {
    if ((await cloud.connection.status()).state !== "complete")
      return { state: "absent", reason: "not_connected" };
    return {
      state: "included",
      code: await cloud.connection.emergencyCode(cloud.managementOrigin, signal),
    };
  } catch (error) {
    if (isAppError(error) && error.code === "cloud.emergency_hosting_closed") {
      const reason = (error.params as Record<string, unknown>).reason;
      if (
        reason === "setting_off" ||
        reason === "level_inactive" ||
        reason === "no_payment_method" ||
        reason === "not_provisioned"
      )
        return { state: "absent", reason };
    }
    return { state: "failed", failedWith: isAppError(error) ? error.code : "unexpected" };
  }
}

async function readEmergencyCheck(
  deps: BackupRecoveryPackMakeDeps,
  signal: AbortSignal,
): Promise<CurrentChecks["emergency"]> {
  const cloud = deps.cloud;
  if (!cloud?.isPrimary()) return undefined;
  try {
    if ((await cloud.connection.status()).state !== "complete") return undefined;
    const read = await cloud.connection.emergency(
      cloud.managementOrigin,
      AbortSignal.any([signal, AbortSignal.timeout(8000)]),
    );
    if (read.stale || read.emergency.status !== "ready") return null;
    return {
      asOf: read.asOf,
      open: read.emergency.open,
      codeIssuedAt: read.emergency.codeIssuedAt,
    };
  } catch {
    return null;
  }
}

type MakeInput = {
  emergency: EmergencyPartInput;
  token: string;
  personId: string;
  request: MakeRequest;
  env: Readonly<Record<string, string | undefined>>;
  madeAt: string;
  newMasterKey: NewMasterKey | undefined;
  signal: AbortSignal;
};

/**
 * Builds, renders and records one pack, and the new master key's row when it shows one, inside the
 * caller's venue transaction, so a refusal of either leaves neither.
 */
async function makePack(
  tx: Transaction,
  deps: BackupRecoveryPackMakeDeps,
  input: MakeInput,
): Promise<{
  number: number;
  madeAt: string;
  pdf: Uint8Array<ArrayBuffer>;
  parts: BuiltPart[];
}> {
  const { request, madeAt, newMasterKey } = input;
  const nodeId = deps.node.nodeId;
  await authorizeManager(tx, { managementSessionId: input.token, permission: "system.manage" });
  await requireFreshManagementSignIn(tx, input.token);
  const venue = await readVenue(tx);
  const number = await nextRecoveryPackNumber(tx, nodeId);
  const records = await readRecoveryPacks(tx, nodeId);
  const context: PartsContext = {
    locale: request.locale,
    timeZone: venue.timeZone,
    madeAt,
    nodeId,
    ring: deps.ring,
    env: input.env,
  };
  let emergency = input.emergency;
  if (emergency.state === "included") {
    if (!deps.cloud?.isPrimary()) emergency = { state: "absent", reason: "not_primary" };
    else if (!(await mayPrintEmergency(tx, input.token)))
      emergency = { state: "absent", reason: "permission" };
  }
  const emergencyPart = buildEmergencyPart(
    context,
    emergency,
    emergency.state === "included" ? await readEmergencyPeople(tx) : [],
  );
  const bucket = await buildBucketPart(tx, context);
  const archives = await buildArchivesPart(tx, context);
  const parts = [emergencyPart, bucket, archives];
  const { pdf, record } = await drawRecoveryPack(
    {
      locale: request.locale,
      timeZone: venue.timeZone,
      loadFonts: deps.loadFonts,
      pack: { venueName: venue.name, madeAt, number },
    },
    {
      nodeId,
      madeBy: input.personId,
      parts,
      masterKey:
        newMasterKey === undefined
          ? await currentMasterKeyElsewhere(tx, records)
          : shownMasterKey(newMasterKey.made),
    },
  );
  await insertRecoveryPack(tx, record);
  if (newMasterKey !== undefined) {
    // A person who has gone away would never see the master key the box moves its backups onto.
    input.signal.throwIfAborted();
    await insertNewMasterKey(tx, newMasterKey, new Date(madeAt), input.personId);
  }
  return { number, madeAt, pdf, parts };
}

export function mountBackupRecoveryPackMakeApi(
  app: Hono,
  deps: BackupRecoveryPackMakeDeps,
  log: Logger,
): void {
  const nodeId = deps.node.nodeId;

  app.post("/api/backup/recovery-pack", (c) => {
    c.header("Cache-Control", "no-store");
    return makeRun(c, log, async () => {
      requireSecurePackRequest(c);
      const token = requireManagementSession(c);
      await authorizeManager(deps.db, {
        managementSessionId: token,
        permission: "system.manage",
        touch: false,
      });
      const { personId } = await requireFreshManagementSignIn(deps.db, token);
      const request = makeRequest(await readRawJsonBody<unknown>(c));
      const emergency = await readPackEmergency(deps, token, c.req.raw.signal);
      c.req.raw.signal.throwIfAborted();
      const made = await deps.turns(async () => {
        const result = await inTurn(deps.db, `recovery-document:${nodeId}`, async () => {
          const held = await deps.readBoxEnv();
          const madeAt = deps.now().toISOString();
          const newMasterKey = request.newMasterKey
            ? makeNewMasterKey(madeAt.slice(0, 10))
            : undefined;
          const nextKey =
            newMasterKey === undefined
              ? undefined
              : backupKeyRecord(
                  decodeMasterKeyCode(newMasterKey.made.masterKey),
                  // Any number is a fresh key under a new master key, so an unknown one is 0.
                  (heldBackupKeyNumber(held) ?? 0) + 1,
                  newMasterKey.publicKey,
                  newMasterKey.made.masterKeyName,
                );
          // `backup.env` as it will be once the new key is written, for a pack made before it is.
          const env =
            nextKey === undefined
              ? held
              : { ...held, ...backupKeyEnv(nextKey), WAITRON_BACKUP_KEY_ROTATED_AT: madeAt };
          const pack = await withTransaction(deps.db, (tx) =>
            makePack(tx, deps, {
              emergency,
              token,
              personId,
              request,
              env,
              madeAt,
              newMasterKey,
              signal: c.req.raw.signal,
            }),
          );
          return { ...pack, masterKey: newMasterKey?.made, nextKey };
        });
        // After the commit: a failure here still answers the pack, the only time its master key is
        // shown, and the status then says the backup key is not from the current master key.
        if (result.nextKey !== undefined) {
          try {
            await changeBackupKey(deps, result.nextKey, result.madeAt);
          } catch (error) {
            log("warn", "backup.key_change_after_master_key_failed", { errorCode: failure(error) });
          }
          // Also after a failure: the key file may have been replaced before a later step threw.
          try {
            await deps.reloadBackups();
          } catch (error) {
            log("warn", "backup.reload_after_write_failed", { errorCode: failure(error) });
          }
        }
        return result;
      });
      log("info", "recovery.pack_made", {
        personId,
        number: made.number,
        parts: made.parts.map(({ record: { part, state }, failedWith }) => ({
          part,
          state,
          ...(failedWith === undefined ? {} : { failedWith }),
        })),
      });
      return c.body(made.pdf, 200, {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="waitron-recovery-pack-${made.number}.pdf"`,
        "X-Waitron-Recovery-Pack": String(made.number),
        "X-Waitron-Recovery-Pack-Made-At": made.madeAt,
        ...(made.masterKey === undefined
          ? {}
          : {
              "X-Waitron-Master-Key": made.masterKey.masterKey,
              "X-Waitron-Master-Key-Name": encodeURIComponent(made.masterKey.masterKeyName),
            }),
      });
    });
  });

  app.get("/api/backup/recovery-pack", (c) => {
    c.header("Cache-Control", "no-store");
    return makeRun(c, log, async () => {
      const token = requireManagementSession(c);
      await authorizeManager(deps.db, {
        managementSessionId: token,
        permission: "system.manage",
        touch: false,
      });
      const emergency = await readEmergencyCheck(deps, c.req.raw.signal);
      const env = await deps.readBoxEnv();
      const { key: fileKey } = await readHeldKey(async () => loadRecoveryKey(env));
      const status = await withTransaction(deps.db, async (tx) => {
        await authorizeManager(tx, {
          managementSessionId: token,
          permission: "system.manage",
          touch: false,
        });
        const records = await readRecoveryPacks(tx, nodeId);
        const makers = [...new Set(records.flatMap((r) => (r.madeBy === null ? [] : [r.madeBy])))];
        const names = new Map(
          makers.length === 0
            ? []
            : (
                await tx
                  .select({ id: persons.id, name: persons.displayName })
                  .from(persons)
                  .where(inArray(persons.id, makers))
              ).map((p) => [p.id, p.name] as const),
        );
        const loaded = deps.backups();
        const now = deps.now();
        const currentMasterKey = await readCurrentMasterKey(tx);
        const master = masterKeyElsewhere(currentMasterKey, records);
        const status = packStatus({
          records: records.map((r) => ({
            ...r,
            madeByName: r.madeBy === null ? null : (names.get(r.madeBy) ?? null),
          })),
          current: {
            ...(await currentChecks(tx, deps, env)),
            emergency: deps.cloud?.isPrimary() ? emergency : undefined,
          },
          retention: loaded.retention,
          schedule: loaded.schedule,
          backupsUseOlderKey:
            loaded.recoveryKey !== undefined &&
            fileKey !== undefined &&
            loaded.recoveryKey !== fileKey,
          masterKeyPack: master.masterKeyHeldBy,
          now,
        });
        return {
          ...status,
          masterKey:
            master.masterKeyName === null
              ? null
              : { name: master.masterKeyName, pack: master.masterKeyHeldBy },
          keepOldPackUntil: keepOldPackUntil({
            retention: loaded.retention,
            schedule: loaded.schedule,
            now,
          }),
          timeZone: knownZone((await readVenue(tx)).timeZone),
          backupKey: backupKeyFacts(env, currentMasterKey?.publicKey ?? null),
        };
      });
      return c.json(status);
    });
  });

  app.post("/api/backup/recovery-pack/:number/received", (c) => {
    c.header("Cache-Control", "no-store");
    return makeRun(c, log, async () => {
      requireSecurePackRequest(c);
      const token = requireManagementSession(c);
      await authorizeManager(deps.db, {
        managementSessionId: token,
        permission: "system.manage",
        touch: false,
      });
      // Read outside the write lock, which a slow client would otherwise hold against every sale.
      const body = await readRawJsonBody<unknown>(c);
      await withTransaction(deps.db, async (tx) => {
        const { authorizedBy } = await authorizeManager(tx, {
          managementSessionId: token,
          permission: "system.manage",
        });
        if (body === null || typeof body !== "object" || Object.keys(body).length > 0) {
          invalid("shape");
        }
        const number = Number(c.req.param("number"));
        const pack = Number.isSafeInteger(number)
          ? await readRecoveryPack(tx, nodeId, number)
          : null;
        // Another person's pack answers as an unknown one: only the person who asked for a
        // pack can have received it, and the answer does not say whether the number exists.
        if (pack === null || pack.madeBy !== authorizedBy) invalid("unknown_pack");
        await markRecoveryPackReceived(tx, nodeId, number, deps.now());
      });
      return c.body(null, 204);
    });
  });
}
