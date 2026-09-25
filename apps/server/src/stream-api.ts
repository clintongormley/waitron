import type { Context, Hono } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { readMembershipTrustSet, withTransaction, type Database } from "@waitron/db";
import { deleteCredential, putCredential, type KeyRing } from "@waitron/credentials";
import { authorizeManager } from "@waitron/identity";
import { AppError } from "@waitron/shared";
import { createErrorBoundary, readJsonBody, requireManagementSession } from "@waitron/server-kit";
import {
  encodeRecoveryKit,
  readBucketConfig,
  type BucketConfig,
  type ProbeResult,
  type StreamView,
} from "@waitron/stream";
import { mintRecoveryKey, readHeldKey } from "./backup-config.js";
import { keyFingerprint } from "./backup-supervisor.js";
import type { Logger } from "./logger.js";
import type { SealedStateRefresher } from "./sealed-state.js";
import type { Turns } from "./backup-turns.js";
import {
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
  /** True when the environment sets a variable `BACKUP_ENV_KEYS` (`boot.ts`) lists. */
  isManagedByEnvironment: () => boolean;
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
  "backup.managed_by_environment": 409,
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
  // The payload is built and discarded for its refusals, so Test refuses what Save would.
  const readBucketBody = async (c: Context): Promise<BucketConfig> => {
    const bucket = readBucketConfig(await readJsonBody<unknown>(c), (field) => {
      throw new AppError("backup.request_invalid", { field });
    });
    streamSettingsPayload({ venueId: deps.venueId, bucket });
    return bucket;
  };
  const probeOrRefuse = async (bucket: BucketConfig): Promise<void> => {
    const result = await deps.probe(bucket);
    if (!result.ok) throw new AppError("backup.stream_test_failed", { reason: result.reason });
  };

  const heldKeyOrRefuse = async (): Promise<string | undefined> => {
    const held = await deps.readRecoveryKey();
    if (held === undefined && deps.isManagedByEnvironment()) {
      throw new AppError("backup.managed_by_environment", {});
    }
    return held;
  };

  const view = async (): Promise<StreamSettingsView> => {
    const bucket = (await readStreamSettings(deps.db, deps.ring))?.bucket ?? null;
    const { held: recoveryKeySet, key } = await readHeldKey(deps.readRecoveryKey);
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

  // A key is ensured and the sealed-state refresh attempted before the settings are stored and the
  // copy reloaded. A failed refresh does not block Save; it surfaces as the sealed-state alert. The
  // reload runs after the credential has committed: inside the transaction, the write lock refuses
  // the host's own read of the settings.
  app.put("/api/backup/stream", (c) =>
    run(c, log, async () => {
      await authorize(c);
      guardPrimary();
      await heldKeyOrRefuse();
      const bucket = await readBucketBody(c);
      await probeOrRefuse(bucket);
      return deps.turns(async () => {
        guardPrimary();
        if ((await heldKeyOrRefuse()) === undefined) {
          await deps.writeRecoveryKey(mintRecoveryKey());
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
      return deps.turns(async () => {
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
      c.header("Cache-Control", "no-store");
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
