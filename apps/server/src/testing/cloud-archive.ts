import { BACKUP_STAGING_DIR } from "@waitron/store";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { Database, NodeDatabase } from "@waitron/db";
import type { WaitronModule } from "@waitron/module";
import { runOnce } from "../backup-sweep.js";
import { createCloudArchiveTarget } from "../cloud-archive-target.js";
import type { CloudCaptureMetadata } from "../cloud-backup.js";

export async function captureCloudArchive(
  deps: {
    db: Database;
    node: NodeDatabase;
    modules: readonly WaitronModule[];
    environment: "preproduction" | "production";
    stateDir: string;
  },
  recoveryKey: string,
  at: Date,
  signal: AbortSignal,
) {
  const nodeId = randomUUID();
  const registration = {
    installationId: randomUUID(),
    venueId: randomUUID(),
    organisationId: randomUUID(),
    legalBusinessId: randomUUID(),
  };
  let bytes: Buffer | undefined;
  let metadata: CloudCaptureMetadata | undefined;
  let errorCode: string | null | undefined;
  const target = createCloudArchiveTarget({
    stateDir: deps.stateDir,
    sourceNodeId: nodeId,
    isPrimary: () => true,
    now: () => at,
    connection: {
      status: async () => ({
        state: "complete",
        code: "",
        environment: "test",
        registration,
        installation: {
          state: "active",
          revision: 1,
          lastContactAt: null,
          leaseExpiresAt: null,
          services: [
            {
              service: "retained_snapshots",
              state: "ready",
              health: "unknown",
              observedAt: null,
              failure: null,
            },
          ],
        },
      }),
      reserveCapture: async (id) => ({
        id,
        ...registration,
        recoveryKey,
        keyVersion: 1,
        incomingKey: id,
        location: { endpoint: "https://storage.example", bucket: "backup", region: "test" },
        credentials: {
          accessKeyId: "fixture",
          secretAccessKey: "fixture",
          sessionToken: "fixture",
        },
        expiresAt: at.toISOString(),
      }),
      publishCapture: async (id, metadata) => ({
        id,
        ...registration,
        ...metadata,
        keyVersion: 1,
        verification: "pending",
      }),
    },
    upload: async (_grant, file, uploaded) => {
      bytes = await readFile(file);
      metadata = uploaded;
    },
  });
  await runOnce({
    ...deps,
    backends: [],
    cloud: {
      target,
      readClock: async () => ({ timeZone: "UTC", dayCutover: "00:00", cutoverChanges: [] }),
    },
    nodeId,
    resolvers: {},
    stagingDir: join(deps.stateDir, BACKUP_STAGING_DIR),
    recoveryKey,
    retain: 1,
    retainDays: 1,
    destinationTimeoutMs: 60_000,
    archive: (path) => deps.db.archiveTo(path),
    signal,
    now: () => at,
    log: () => {},
    onDestinationResult: (result) => {
      errorCode = result.uploadErrorCode;
    },
  });
  if (!bytes || !metadata || errorCode !== null) {
    throw Object.assign(new Error("Cloud archive was not stored"), { code: errorCode });
  }
  return { bytes, modules: metadata.modules };
}
