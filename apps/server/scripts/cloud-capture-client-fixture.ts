import {
  BACKUP_STAGING_DIR,
  CLOUD_CONNECTION_FILE,
  VENUE_DIR_NAME,
  TRADING_ENV_FILE,
} from "@waitron/store";
import assert from "node:assert/strict";
import { readFile, realpath } from "node:fs/promises";
import { join, resolve, sep } from "node:path";
import { tmpdir } from "node:os";
import { createCloudConnection } from "../src/cloud-client.js";
import { openVenueDatabase, readCloudVenueId, withTransaction } from "@waitron/db";
import { createCloudArchiveTarget } from "../src/cloud-archive-target.js";
import { createBackupSchedule } from "../src/backup-sweep.js";
import { resolveVenueClock } from "../src/report-api.js";
import { ALL_MODULES } from "../src/modules.js";
import { parseEnvFile } from "../src/env-file.js";
import type { CloudCapturePoint } from "../src/cloud-backup.js";
import { uploadCloudCapture, uploadCloudCaptureFile } from "../src/cloud-backup-upload.js";
const root = await realpath(resolve(process.env.CLOUD_TEST_ROOT ?? ""));
assert(
  root.startsWith((await realpath(tmpdir())) + sep) && root.includes("cloud-integration-backup-"),
);
let input = "";
for await (const chunk of process.stdin) {
  input += String(chunk);
  assert(input.length < 65536);
}
const request = JSON.parse(input) as {
  command: "reserve" | "publish" | "upload" | "schedule";
  stateSubdir?: "state";
  id: string;
  metadata: Parameters<ReturnType<typeof createCloudConnection>["publishCapture"]>[1];
  grant: Parameters<typeof uploadCloudCapture>[0];
  ca?: string;
  crashAfterUpload?: boolean;
};
assert(request.stateSubdir === undefined || request.stateSubdir === "state");
const stateDir = request.stateSubdir === "state" ? join(root, "state") : root;
const saved = JSON.parse(await readFile(join(stateDir, CLOUD_CONNECTION_FILE), "utf8"));
const client = createCloudConnection({
  stateDir,
  origin: saved.origin,
  readVenueId: async () => {
    const store = await openVenueDatabase(join(root, "venue"), { exclusive: false });
    try {
      return await readCloudVenueId(store.venue);
    } finally {
      await store.close();
    }
  },
  readVenueName: async () => {
    throw new Error("The capture fixture does not pair");
  },
  recordVenueId: async () => {
    throw new Error("The capture fixture does not pair");
  },
  forgetVenueId: async () => {
    throw new Error("The capture fixture does not pair");
  },
  environment: saved.environment,
});
let result;
if (request.command === "reserve") result = await client.reserveCapture(request.id);
else if (request.command === "publish")
  result = await client.publishCapture(request.id, request.metadata);
else if (request.command === "upload")
  result = await uploadCloudCapture(
    request.grant,
    await readFile(join(root, "captured.backup.enc")),
    { ca: request.ca },
  );
else if (request.command === "schedule") {
  const store = await openVenueDatabase(join(root, VENUE_DIR_NAME));
  try {
    await client.refresh();
    const identity = parseEnvFile(await readFile(join(stateDir, TRADING_ENV_FILE), "utf8"));
    let created = 0;
    const points: CloudCapturePoint[] = [];
    const target = createCloudArchiveTarget({
      stateDir,
      sourceNodeId: identity.WAITRON_NODE_ID!,
      connection: {
        ...client,
        async publishCapture(...args) {
          const point = await client.publishCapture(...args);
          points.push(point);
          return point;
        },
      },
      isPrimary: () => true,
      upload: async (grant, file, metadata, signal) => {
        await uploadCloudCaptureFile(grant, file, metadata, { ca: request.ca, signal });
        if (request.crashAfterUpload) process.exit(17);
      },
    });
    const now = new Date();
    const signal = new AbortController().signal;
    const readClock = () =>
      withTransaction(store.venue, (tx) => resolveVenueClock(tx, identity.WAITRON_NODE_ID!));
    let uploadErrorCode: string | null | undefined;
    const schedule = createBackupSchedule({
      nodeId: identity.WAITRON_NODE_ID!,
      backends: [],
      cloud: {
        target: {
          ...target,
          store: (input) =>
            target.store({
              ...input,
              entries: () => {
                created++;
                return input.entries();
              },
            }),
        },
        readClock,
      },
      db: store.venue,
      node: store.node,
      modules: ALL_MODULES,
      environment: "preproduction",
      resolvers: {},
      stateDir,
      stagingDir: join(stateDir, BACKUP_STAGING_DIR),
      recoveryKey: "",
      schedule: { kind: "interval", ms: 86_400_000 },
      retain: 1,
      retainDays: 1,
      jitterSeed: identity.WAITRON_NODE_ID!,
      readClock,
      signal,
      destinationTimeoutMs: 15 * 60_000,
      onDestinationResult: (result) => {
        uploadErrorCode = result.uploadErrorCode;
      },
      archive: (path) => store.venue.archiveTo(path),
      log: (_level, event) => assert.notEqual(event, "backup.failed"),
      now: () => now,
    });
    await schedule.pass(now, signal);
    assert.equal(uploadErrorCode ?? null, null);
    const afterDue = created;
    await schedule.pass(now, signal);
    result = { created: afterDue, idleCreated: created - afterDue, points };
  } finally {
    await store.close();
  }
} else throw Error("Unknown capture command");
console.log(JSON.stringify(result));
