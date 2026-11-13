import type { Context, Hono } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import {
  withNodeTransaction,
  withTransaction,
  type Database,
  type NodeDatabase,
  type NodeTransaction,
} from "@waitron/db";
import {
  credentialRevision,
  deleteCredential,
  putCredential,
  type KeyRing,
} from "@waitron/credentials";
import { authorizeManager, requireFreshManagementSignIn } from "@waitron/identity";
import { readPairLink } from "@waitron/node-db";
import { AppError, hasCode, isAppError } from "@waitron/shared";
import { createErrorBoundary, readJsonBody, requireManagementSession } from "@waitron/server-kit";
import {
  readBucketConfig,
  type BucketConfig,
  type ProbeResult,
  type StreamView,
} from "@waitron/stream";
import {
  archivePlace,
  readHeldArchiveSettings,
  refuseStreamOverlap,
  type ArchivePlace,
} from "./archive-settings.js";
import { mintRecoveryKey, readHeldKey } from "./backup-config.js";
import { keyFingerprint } from "./backup-supervisor.js";
import type { Logger } from "./logger.js";
import type { SealedStateRefresher } from "./sealed-state.js";
import type { Turns } from "./backup-turns.js";
import {
  STREAM_PURPOSE,
  readStreamSettingsIn,
  streamSettingsPayload,
  type StreamHost,
} from "./stream-host.js";
import "./errors.js";

export interface StreamApiDeps {
  db: Database;
  node: NodeDatabase;
  /** This box; Save is refused while its pair link exists. */
  nodeId: string;
  ring: KeyRing;
  stream: Pick<StreamHost, "reload" | "status">;
  /** The venue the stream writes under; Save stores it with the settings. */
  venueId: string;
  isPrimary: () => boolean;

  readRecoveryKey: () => Promise<string | undefined>;
  writeRecoveryKey: (key: string) => Promise<void>;
  /** Re-locks this node's secrets row under the current recovery key. Never throws. */
  sealedState: Pick<SealedStateRefresher, "refresh">;
  /** Throws when the bucket gives no answer at all, a cancelled `signal` included. */
  probe: (bucket: BucketConfig, signal: AbortSignal) => Promise<ProbeResult>;
  /** Replaces {@link PROBE_LIMIT_MS}. Tests only. */
  probeLimitMs?: number;
  /**
   * Throws when the bucket gives no answer at all, or when `signal` ends before the check has its
   * answer.
   */
  prepareEncryption: (bucket: BucketConfig, signal: AbortSignal) => Promise<ProbeResult>;
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
  /** Changes on every stored change, a secret-only one included; null when nothing is stored. */
  revision: string | null;
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
  "backup.stream_held_by_another_box": 409,
  "backup.spare_stream_active": 409,
  "backup.stream_test_failed": 422,
  "backup.stream_not_configured": 409,
  "backup.archive_namespace_overlap": 400,
  "backup.archive_settings_unreadable": 409,
  // The bucket gave no answer at all: not a refusal of the owner's settings, so not 422.
  "backup.stream_request_failed": 502,
};

// The dashboard sets no time limit on a POST or PUT (`READ_TIME_LIMIT_MS` in
// `packages/dashboard-kit/src/request.ts` covers GETs only), so nothing else ends a check whose
// answer stalls after its headers. The minute was not measured.
const PROBE_LIMIT_MS = 60_000;

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
  const readBucketBody = async (c: Context): Promise<BucketConfig> => {
    const bucket = readBucketConfig(await readJsonBody<unknown>(c), (field) => {
      throw new AppError("backup.request_invalid", { field });
    });
    streamSettingsPayload({ venueId: deps.venueId, bucket });
    return bucket;
  };
  const bucketWait = (c: Context): AbortSignal =>
    AbortSignal.any([c.req.raw.signal, AbortSignal.timeout(deps.probeLimitMs ?? PROBE_LIMIT_MS)]);
  const probeOrRefuse = async (bucket: BucketConfig, signal: AbortSignal): Promise<void> => {
    const result = await deps.probe(bucket, signal);
    if (!result.ok) throw new AppError("backup.stream_test_failed", { reason: result.reason });
  };

  const archivePlaces = async (): Promise<ArchivePlace[]> => {
    // An unreadable record refuses Save: read as none held, it would skip the overlap check.
    const read = await readHeldArchiveSettings(deps.db, deps.ring);
    if ("unreadable" in read) {
      throw new AppError("backup.archive_settings_unreadable", { reason: read.unreadable });
    }
    return (read.settings?.destinations ?? []).flatMap((d) =>
      d.kind === "s3" ? [archivePlace(d.bucket)] : [],
    );
  };

  const refuseArchiveOverlap = async (bucket: BucketConfig): Promise<void> => {
    for (const place of await archivePlaces()) {
      refuseStreamOverlap(place, { venueId: deps.venueId, bucket });
    }
  };

  const refuseWhilePaired = async (node: NodeDatabase | NodeTransaction): Promise<void> => {
    if ((await readPairLink(node, deps.nodeId)) !== null) {
      throw new AppError("backup.spare_stream_active", {});
    }
  };

  // One transaction, so the revision is the one of the settings shown.
  const readStored = (): Promise<{
    bucket: BucketConfig | null;
    configured: boolean;
    revision: string | null;
  }> =>
    withTransaction(deps.db, async (tx) => {
      let bucket: BucketConfig | null;
      let configured: boolean;
      try {
        bucket = (await readStreamSettingsIn(tx, deps.ring))?.bucket ?? null;
        configured = bucket !== null;
      } catch (error) {
        if (!isAppError(error) || !hasCode(error, "server.credential_unusable")) throw error;
        bucket = null;
        configured = true;
      }
      const revision = await credentialRevision(tx, { purpose: STREAM_PURPOSE });
      return { bucket, configured, revision };
    });

  const view = async (): Promise<StreamSettingsView> => {
    const { bucket, configured, revision } = await readStored();
    const { held: recoveryKeySet, key } = await readHeldKey(deps.readRecoveryKey);
    return {
      isPrimary: deps.isPrimary(),
      configured,
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
      revision,
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
      await probeOrRefuse(bucket, bucketWait(c));
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
      await requireFreshManagementSignIn(deps.db, requireManagementSession(c));
      await refuseWhilePaired(deps.node);
      await deps.readRecoveryKey();
      const bucket = await readBucketBody(c);
      await refuseArchiveOverlap(bucket);
      const signal = bucketWait(c);
      await probeOrRefuse(bucket, signal);
      const encryption = await deps.prepareEncryption(bucket, signal);
      if (!encryption.ok) {
        throw new AppError("backup.stream_test_failed", { reason: encryption.reason });
      }
      return deps.turns(async () => {
        guardPrimary();
        await refuseArchiveOverlap(bucket); // Again: archive settings may have changed meanwhile.
        if ((await deps.readRecoveryKey()) === undefined) {
          await deps.writeRecoveryKey(mintRecoveryKey());
        }
        await deps.sealedState.refresh();
        // Again, under node.db's lock: a join checks for these settings and writes its pair link
        // under the same lock (`mirror-bundle-api.ts`), so one of the two sees the other.
        await withNodeTransaction(deps.node, async (nodeTx) => {
          await refuseWhilePaired(nodeTx);
          await withTransaction(deps.db, (tx) =>
            putCredential(tx, deps.ring, {
              purpose: STREAM_PURPOSE,
              value: streamSettingsPayload({ venueId: deps.venueId, bucket }),
            }),
          );
        });
        await deps.stream.reload();
        return c.json(await view());
      });
    }),
  );

  // Not a settings change, so no fresh sign-in.
  app.post("/api/backup/stream/restart", (c) =>
    run(c, log, async () => {
      await authorize(c);
      guardPrimary();
      return deps.turns(async () => {
        guardPrimary();
        // No stored row is what `view()` answers as `configured: false`.
        const revision = await withTransaction(deps.db, (tx) =>
          credentialRevision(tx, { purpose: STREAM_PURPOSE }),
        );
        if (revision === null) throw new AppError("backup.stream_not_configured", {});
        const status = deps.stream.status();
        if (
          status.state === "refused" &&
          (status.reason === "pointer_changed" || status.reason === "pointer_newer_term")
        ) {
          throw new AppError("backup.stream_held_by_another_box", {});
        }
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
      await requireFreshManagementSignIn(deps.db, requireManagementSession(c));
      return deps.turns(async () => {
        guardPrimary();
        await withTransaction(deps.db, (tx) => deleteCredential(tx, { purpose: STREAM_PURPOSE }));
        await deps.stream.reload();
        return c.json(await view());
      });
    }),
  );
}
