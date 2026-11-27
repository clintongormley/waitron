import { isSecure } from "./encrypted-connection.js";
import { inArray } from "drizzle-orm";
import type { Context, Hono } from "hono";
import { credentialRevision, type KeyRing } from "@waitron/credentials";
import {
  insertRecoveryPack,
  markRecoveryPackReceived,
  nextMasterKeyNumber,
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
import { AppError, decodeMasterKeyCode, encodeMasterKeyCode, isAppError } from "@waitron/shared";
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
  buildArchivesPart,
  buildBucketPart,
  type PartsContext,
} from "./backup-recovery-pack-parts.js";
import {
  drawRecoveryPack,
  masterKeyHolders,
  type PackMasterKey,
} from "./backup-recovery-pack-output.js";
import {
  keepOldPackUntil,
  namedMasterKeyPack,
  packStatus,
  type CurrentChecks,
} from "./backup-recovery-pack-status.js";
import type { BackupRuntimeStatus } from "./backup-supervisor.js";
import type { Turns } from "./backup-turns.js";
import type { Logger } from "./logger.js";
import { createLiveOperationRateLimit } from "./live-operation-rate-limit.js";
import { checkTypedMasterKey, insertNewMasterKey } from "./master-key-record.js";
import { STREAM_PURPOSE } from "./stream-host.js";
import { knownZone } from "./venue-time-zone.js";
import { sentFromThisOrigin } from "./own-page.js";
import type { CloudConnection } from "./cloud-client.js";
import "./errors.js";

export interface BackupRecoveryPackMakeDeps extends BackupKeyChangeDeps {
  cloud?: {
    connection: Pick<CloudConnection, "status" | "emergency">;
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
    "master_key.wrong": 403,
    "recovery.rate_limited": 429,
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

/** Print a new copy with the current master key, or make a new master key, which needs no old one. */
type MakeRequest = { locale: PackLocale } & ({ masterKey: string } | { newMasterKey: true });

function makeRequest(body: unknown): MakeRequest {
  if (body === null || typeof body !== "object" || Array.isArray(body)) invalid("shape");
  const fields = body as Record<string, unknown>;
  const keys = Object.keys(fields).sort().join(",");
  if (
    (fields.locale !== "en" && fields.locale !== "es") ||
    !(
      (keys === "locale,masterKey" && typeof fields.masterKey === "string") ||
      (keys === "locale,newMasterKey" && fields.newMasterKey === true)
    )
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

/**
 * The venue's Cloud start address, from a fresh read that says emergency start is open; `null` for
 * a closed, stale or unreadable one, of which the pack and its status say nothing.
 */
async function readCloudAddress(
  deps: BackupRecoveryPackMakeDeps,
  signal: AbortSignal,
): Promise<string | null> {
  const cloud = deps.cloud;
  if (!cloud?.isPrimary()) return null;
  try {
    if ((await cloud.connection.status()).state !== "complete") return null;
    const read = await cloud.connection.emergency(
      cloud.managementOrigin,
      AbortSignal.any([signal, AbortSignal.timeout(8000)]),
    );
    const facts = read.emergency;
    return !read.stale && facts.status === "ready" && facts.open ? facts.address : null;
  } catch {
    return null;
  }
}

/** The typed key, refused unless it is the venue's current master key, as the pack prints it. */
async function printedMasterKey(tx: Transaction, typed: string): Promise<PackMasterKey> {
  const { bytes, current } = await checkTypedMasterKey(tx, typed);
  return {
    masterKey: encodeMasterKeyCode(bytes),
    masterKeyName: current.name,
    number: current.number,
  };
}

type MakeInput = {
  cloudAddress: string | null;
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
  /** For the log: each recorded part, and the code a failed one failed with. */
  parts: { part: string; state: string; failedWith: string | undefined }[];
}> {
  const { request, madeAt, newMasterKey } = input;
  const nodeId = deps.node.nodeId;
  await authorizeManager(tx, { managementSessionId: input.token, permission: "system.manage" });
  await requireFreshManagementSignIn(tx, input.token);
  const masterKey: PackMasterKey =
    newMasterKey === undefined
      ? await printedMasterKey(tx, (request as { masterKey: string }).masterKey)
      : { ...newMasterKey.made, number: await nextMasterKeyNumber(tx) };
  const venue = await readVenue(tx);
  const number = await nextRecoveryPackNumber(tx, nodeId);
  const context: PartsContext = {
    locale: request.locale,
    timeZone: venue.timeZone,
    madeAt,
    nodeId,
    ring: deps.ring,
    env: input.env,
  };
  const bucket = await buildBucketPart(tx, context);
  const archives = await buildArchivesPart(tx, context);
  const parts = [bucket, archives];
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
      cloudAddress: deps.cloud?.isPrimary() ? input.cloudAddress : null,
      masterKey,
    },
  );
  await insertRecoveryPack(tx, record);
  if (newMasterKey !== undefined) {
    // A person who has gone away would never see the master key the box moves its backups onto.
    input.signal.throwIfAborted();
    await insertNewMasterKey(tx, newMasterKey, new Date(madeAt), input.personId);
  }
  const failedWith = new Map(parts.map((part) => [part.record.part, part.failedWith]));
  return {
    number,
    madeAt,
    pdf,
    parts: record.parts.map(({ part, state }) => ({
      part,
      state,
      failedWith: failedWith.get(part),
    })),
  };
}

export function mountBackupRecoveryPackMakeApi(
  app: Hono,
  deps: BackupRecoveryPackMakeDeps,
  log: Logger,
): void {
  const nodeId = deps.node.nodeId;
  const typedKeyAdmission = createLiveOperationRateLimit();

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
      const cloudAddress = await readCloudAddress(deps, c.req.raw.signal);
      c.req.raw.signal.throwIfAborted();
      const turn = <T>(body: () => Promise<T>) =>
        "masterKey" in request
          ? typedKeyAdmission.withAdmission(() => deps.turns(body))
          : deps.turns(body);
      const made = await turn(async () => {
        const result = await inTurn(deps.db, `recovery-document:${nodeId}`, async () => {
          const held = await deps.readBoxEnv();
          const madeAt = deps.now().toISOString();
          const newMasterKey =
            "newMasterKey" in request ? makeNewMasterKey(madeAt.slice(0, 10)) : undefined;
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
              cloudAddress,
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
        parts: made.parts.map(({ part, state, failedWith }) => ({
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
      const cloudAddress = await readCloudAddress(deps, c.req.raw.signal);
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
        const holders =
          currentMasterKey === null ? [] : masterKeyHolders(currentMasterKey, records);
        const status = packStatus({
          records: records.map((r) => ({
            ...r,
            madeByName: r.madeBy === null ? null : (names.get(r.madeBy) ?? null),
          })),
          current: {
            ...(await currentChecks(tx, deps, env)),
            cloudOpen: deps.cloud?.isPrimary() === true && cloudAddress !== null,
          },
          retention: loaded.retention,
          schedule: loaded.schedule,
          backupsUseOlderKey:
            loaded.recoveryKey !== undefined &&
            fileKey !== undefined &&
            loaded.recoveryKey !== fileKey,
          masterKeyPacks: holders,
          now,
        });
        return {
          ...status,
          masterKey:
            currentMasterKey === null
              ? null
              : { name: currentMasterKey.name, pack: namedMasterKeyPack(records, holders) },
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
