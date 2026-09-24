import assert from "node:assert/strict";
import { readFile, realpath } from "node:fs/promises";
import { join, resolve, sep } from "node:path";
import { tmpdir } from "node:os";
import { createCloudConnection } from "../src/cloud-client.js";
import { openVenueDatabase } from "@waitron/db";
import { createCloudSnapshotWorker } from "../src/cloud-snapshot-worker.js";
import { createCloudSnapshotArchive } from "../src/cloud-snapshot-archive.js";
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
const request = JSON.parse(input);
const saved = JSON.parse(await readFile(join(root, "cloud-connection.json"), "utf8"));
const client = createCloudConnection({
  stateDir: root,
  origin: saved.origin,
  localVenueId: saved.localVenueId,
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
  const store = await openVenueDatabase(join(root, "venue"));
  try {
    await client.refresh();
    const identity = parseEnvFile(await readFile(join(root, "trading.env"), "utf8"));
    let created = 0;
    let point: CloudCapturePoint | undefined;
    const scheduler = createCloudSnapshotWorker({
      stateDir: root,
      sourceNodeId: identity.WAITRON_TILL_NODE_ID!,
      connection: {
        ...client,
        async publishCapture(...args) {
          point = await client.publishCapture(...args);
          return point;
        },
      },
      isPrimary: () => true,
      readClock: async () => ({ timeZone: "Europe/Madrid", dayCutover: "04:00" }),
      createArchive: async (grant, at, signal) => {
        created++;
        return createCloudSnapshotArchive(
          { db: store.venue, modules: ALL_MODULES, environment: "preproduction", stateDir: root },
          grant.recoveryKey,
          at,
          signal,
        );
      },
      upload: async (grant, file, metadata, signal) => {
        await uploadCloudCaptureFile(grant, file, metadata, { ca: request.ca, signal });
        if (request.crashAfterUpload) process.exit(17);
      },
    });
    await scheduler.tick(new AbortController().signal);
    result = { created, point };
  } finally {
    await store.close();
  }
} else throw Error("Unknown capture command");
console.log(JSON.stringify(result));
