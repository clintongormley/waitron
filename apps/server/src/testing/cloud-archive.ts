import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { Database, NodeDatabase } from "@waitron/db";
import type { WaitronModule } from "@waitron/module";
import type { StagingTurn } from "../backup-staging-turn.js";
import { runOnce } from "../backup-sweep.js";
import { createCloudArchiveTarget } from "../cloud-archive-target.js";
import type { CloudCaptureGrant, CloudCaptureMetadata } from "../cloud-backup.js";

interface CloudArchiveFixture {
  db: Database;
  node: NodeDatabase;
  modules: readonly WaitronModule[];
  environment: "preproduction" | "production";
  stateDir: string;
  stagingDir?: string;
  stagingTurn?: StagingTurn;
}

export async function captureCloudArchive(
  deps: CloudArchiveFixture,
  recoveryKey: string,
  at: Date,
  signal: AbortSignal,
) {
  let bytes!: Buffer;
  const { modules } = await runCloudArchive(deps, recoveryKey, at, signal, async (_, file) => {
    bytes = await readFile(file);
  });
  return { bytes, modules };
}

export async function runCloudArchive(
  deps: CloudArchiveFixture,
  recoveryKey: string,
  at: Date,
  signal: AbortSignal,
  upload: (grant: CloudCaptureGrant, file: string, metadata: CloudCaptureMetadata) => Promise<void>,
) {
  const nodeId = randomUUID();
  const registration = {
    installationId: randomUUID(),
    venueId: randomUUID(),
    organisationId: randomUUID(),
    legalBusinessId: randomUUID(),
  };
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
        incomingKey: "incoming/" + id,
        location: { endpoint: "https://storage.example", bucket: "backup", region: "test" },
        credentials: {
          accessKeyId: "fixture",
          secretAccessKey: "fixture",
          sessionToken: "fixture",
        },
        expiresAt: new Date(Date.now() + 900_000).toISOString(),
      }),
      publishCapture: async (id, metadata) => ({
        id,
        ...registration,
        ...metadata,
        keyVersion: 1,
        verification: "pending",
      }),
    },
    upload: async (grant, file, uploaded) => {
      await upload(grant, file, uploaded);
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
    stagingDir: deps.stagingDir ?? join(deps.stateDir, "staging"),
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
  if (!metadata || errorCode !== null) {
    throw Object.assign(new Error(`Cloud archive was not stored (${errorCode})`), {
      code: errorCode,
    });
  }
  return metadata;
}
