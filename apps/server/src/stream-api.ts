import { randomBytes } from "node:crypto";
import type { Context, Hono } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { readMembershipTrustSet, withTransaction, type Database } from "@waitron/db";
import { deleteCredential, putCredential, type KeyRing } from "@waitron/credentials";
import { authorizeManager } from "@waitron/identity";
import { AppError, isAppError } from "@waitron/shared";
import { createErrorBoundary, readJsonBody, requireManagementSession } from "@waitron/server-kit";
import {
  CONTROL_CHARACTER,
  checkLitestreamSettings,
  encodeRecoveryKit,
  type BucketConfig,
  type ProbeResult,
  type StreamView,
} from "@waitron/stream";
import { keyFingerprint } from "./backup-supervisor.js";
import type { Logger } from "./logger.js";
import type { SealedStateRefresher } from "./sealed-state.js";
import type { Turns } from "./backup-turns.js";
import {
  ABSENT,
  STREAM_PURPOSE,
  readStreamSettings,
  streamSettingsPayload,
  type StreamHost,
} from "./stream-host.js";
import "./errors.js";

export interface StreamApiDeps {
  db: Database;
  ring: KeyRing;
  stream: Pick<StreamHost, "reload" | "status">;
  nodeId: string;
  /** The venue the stream writes under; Save stores it with the settings. */
  venueId: string;
  isPrimary: () => boolean;
  readRecoveryKey: () => Promise<string | undefined>;
  writeRecoveryKey: (key: string) => Promise<void>;
  /** Re-locks this node's secrets row under the current recovery key. Never throws. */
  sealedState: Pick<SealedStateRefresher, "refresh">;
  /** Throws when the bucket gives no answer at all. */
  probe: (bucket: BucketConfig) => Promise<ProbeResult>;
  /** Shared with the backup routes, which also read and then write the key in `backup.env`. */
  turns: Turns;
}

/** What `GET /api/backup/stream` answers. Never the secret access key. */
export interface StreamSettingsView {
  isPrimary: boolean;
  configured: boolean;
  bucket: {
    endpoint: string | null;
    region: string;
    bucket: string;
    prefix: string;
    accessKeyId: string;
  } | null;
  status: StreamView;
  /** True for a key under the length floor too, which has no fingerprint here. */
  recoveryKeySet: boolean;
  keyFingerprint: string | null;
}

const STATUS: Record<string, ContentfulStatusCode> = {
  "management_session.required": 401,
  "management_session.expired": 401,
  "person.suspended": 403,
  "authorization.not_permitted": 403,
  "backup.request_invalid": 400,
  "backup.stream_config_unsafe": 400,
  "backup.recovery_key_too_short": 400,
  "backup.not_primary": 409,
  "backup.reload_in_progress": 409,
  "backup.stream_test_failed": 422,
  "backup.stream_not_configured": 409,
  "backup.stream_signer_missing": 409,
  "backup.recovery_key_missing": 409,
  // The bucket gave no answer at all: not a refusal of the owner's settings, so not 422.
  "backup.stream_request_failed": 502,
};

/** A refusal names the field, never its value: one of them is the secret key. */
async function readBucketBody(c: Context): Promise<BucketConfig> {
  const body = await readJsonBody<Record<string, unknown>>(c);
  const field = (name: string, required: boolean): string => {
    const value = body[name];
    if (value === undefined || value === "") {
      if (required) throw new AppError("backup.request_invalid", { field: name });
      return "";
    }
    if (typeof value !== "string" || CONTROL_CHARACTER.test(value) || value.trim() !== value) {
      throw new AppError("backup.request_invalid", { field: name });
    }
    return value;
  };
  const endpoint = field("endpoint", false);
  if (endpoint !== "") {
    let protocol: string;
    try {
      protocol = new URL(endpoint).protocol;
    } catch {
      throw new AppError("backup.request_invalid", { field: "endpoint" });
    }
    if (protocol !== "https:" && protocol !== "http:") {
      throw new AppError("backup.request_invalid", { field: "endpoint" });
    }
  }
  const prefix = field("prefix", false);
  if (prefix === ABSENT) throw new AppError("backup.request_invalid", { field: "prefix" });
  const bucket: BucketConfig = {
    ...(endpoint === "" ? {} : { endpoint }),
    region: field("region", true),
    bucket: field("bucket", true),
    prefix,
    accessKeyId: field("accessKeyId", true),
    secretAccessKey: field("secretAccessKey", true),
  };
  checkLitestreamSettings(bucket);
  return bucket;
}

export function mountStreamApi(app: Hono, deps: StreamApiDeps, log: Logger): void {
  const run = createErrorBoundary(STATUS, "backup.stream_failed");

  const authorize = async (c: Context): Promise<void> => {
    const sessionId = requireManagementSession(c);
    await withTransaction(deps.db, async (tx) => {
      await authorizeManager(tx, { managementSessionId: sessionId, permission: "system.manage" });
    });
  };
  const guardPrimary = (): void => {
    if (!deps.isPrimary()) throw new AppError("backup.not_primary", {});
  };
  const probeOrRefuse = async (bucket: BucketConfig): Promise<void> => {
    const result = await deps.probe(bucket);
    if (!result.ok) throw new AppError("backup.stream_test_failed", { reason: result.reason });
  };

  // Two writers side by side would each find no recovery key and write a different one, and the
  // host refuses a reload while another runs.
  const oneWriteAtATime = deps.turns;

  const view = async (): Promise<StreamSettingsView> => {
    const bucket = (await readStreamSettings(deps.db, deps.ring))?.bucket ?? null;
    let key: string | undefined;
    let recoveryKeySet = true;
    try {
      key = await deps.readRecoveryKey();
      recoveryKeySet = key !== undefined;
    } catch (error) {
      if (!(isAppError(error) && error.code === "backup.recovery_key_too_short")) throw error;
    }
    return {
      isPrimary: deps.isPrimary(),
      configured: bucket !== null,
      bucket:
        bucket === null
          ? null
          : {
              endpoint: bucket.endpoint ?? null,
              region: bucket.region,
              bucket: bucket.bucket,
              prefix: bucket.prefix,
              accessKeyId: bucket.accessKeyId,
            },
      status: deps.stream.status(),
      recoveryKeySet,
      keyFingerprint: key === undefined ? null : keyFingerprint(key),
    };
  };

  app.get("/api/backup/stream", (c) =>
    run(c, log, async () => {
      await authorize(c);
      return c.json(await view());
    }),
  );

  app.post("/api/backup/stream/test", (c) =>
    run(c, log, async () => {
      await authorize(c);
      const bucket = await readBucketBody(c);
      await probeOrRefuse(bucket);
      return c.json({ ok: true });
    }),
  );

  // The order is the invariant: a key exists, the locked row is written under it, and only then
  // does a generation open, so the first generation already holds a row a rebuild can unlock. The
  // reload runs after the credential has committed: inside the transaction, the write lock refuses
  // the host's own read of the settings.
  app.put("/api/backup/stream", (c) =>
    run(c, log, async () => {
      await authorize(c);
      guardPrimary();
      const bucket = await readBucketBody(c);
      await probeOrRefuse(bucket);
      return oneWriteAtATime(async () => {
        guardPrimary();
        if ((await deps.readRecoveryKey()) === undefined) {
          await deps.writeRecoveryKey(randomBytes(32).toString("base64url"));
        }
        await deps.sealedState.refresh();
        await withTransaction(deps.db, (tx) =>
          putCredential(tx, deps.ring, {
            purpose: STREAM_PURPOSE,
            value: streamSettingsPayload({ venueId: deps.venueId, bucket }),
          }),
        );
        await deps.stream.reload();
        return c.json(await view());
      });
    }),
  );

  // What is already in the bucket stays there; the owner deletes it at the provider.
  app.delete("/api/backup/stream", (c) =>
    run(c, log, async () => {
      await authorize(c);
      guardPrimary();
      return oneWriteAtATime(async () => {
        guardPrimary();
        await withTransaction(deps.db, (tx) => deleteCredential(tx, { purpose: STREAM_PURPOSE }));
        await deps.stream.reload();
        return c.json(await view());
      });
    }),
  );

  app.get("/api/backup/stream/kit", (c) =>
    run(c, log, async () => {
      await authorize(c);
      const settings = await readStreamSettings(deps.db, deps.ring);
      if (settings === null) throw new AppError("backup.stream_not_configured", {});
      const recoveryKey = await deps.readRecoveryKey();
      if (recoveryKey === undefined) throw new AppError("backup.recovery_key_missing", {});
      const pointerSignerPublicKey = (await readMembershipTrustSet(deps.db))[deps.nodeId];
      if (pointerSignerPublicKey === undefined) {
        throw new AppError("backup.stream_signer_missing", {});
      }
      return c.json({
        kit: encodeRecoveryKit({
          version: 1,
          venueId: settings.venueId,
          bucket: settings.bucket,
          recoveryKey,
          pointerSignerPublicKey,
        }),
        keyFingerprint: keyFingerprint(recoveryKey),
      });
    }),
  );
}
