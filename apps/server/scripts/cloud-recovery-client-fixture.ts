import {
  VENUE_DIR_NAME,
  TRADING_ENV_FILE,
  BACKUP_ENV_FILE,
  CLOUD_CONNECTION_FILE,
  CLOUD_STAFF_KEY_FILE,
  CLOUD_STAFF_CERT_FILE,
  VENUE_FILE,
} from "@waitron/store";

import assert from "node:assert/strict";
import { readFile, realpath, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import {
  nodes,
  openVenueDatabase,
  readVenue,
  readCloudVenueId,
  saveCloudVenueId,
  withTransaction,
} from "@waitron/db";
import { createCloudRecoveryClient } from "../src/cloud-recovery.js";
import { createCloudConnection } from "../src/cloud-client.js";
import { createCloudReplacement } from "../src/cloud-replacement.js";
import { stageRestoreRequest, runStagedRestore } from "../src/restore-request.js";
import { validateArtifact } from "../src/restore.js";
import { RESTORE_STAGING_DIR } from "../src/restore-staging-dirs.js";
import { ALL_MODULES } from "../src/modules.js";
import { parseEnvFile } from "../src/env-file.js";

const root = await realpath(resolve(process.env.CLOUD_TEST_ROOT ?? ""));
assert(
  root.startsWith((await realpath(tmpdir())) + sep) && root.includes("cloud-integration-backup-"),
);
let input = "";
for await (const chunk of process.stdin) {
  input += String(chunk);
  assert(input.length < 8192);
}
const request = JSON.parse(input) as {
  command:
    | "start"
    | "status"
    | "stage"
    | "restore"
    | "report"
    | "prepareReplacement"
    | "statusReplacement";
  origin: string;
  storageCaBase64?: string;
  expectedPointId?: string;
  expectedVenue?: string;
  expectedSourceNodeId?: string;
  expectedModules?: Record<string, number>;
};
assert(typeof request.origin === "string" && new URL(request.origin).origin === request.origin);
const stateDir = join(root, "state");
const venueDir = join(root, VENUE_DIR_NAME);
const client = createCloudRecoveryClient({
  stateDir,
  origin: request.origin,
  environment: "preproduction",
  ...(request.storageCaBase64
    ? { storageCa: Buffer.from(request.storageCaBase64, "base64").toString() }
    : {}),
});
const validation = {
  stateDir,
  stagingDir: join(stateDir, RESTORE_STAGING_DIR),
  migrationsRoot: null,
  modules: ALL_MODULES,
  environment: "preproduction" as const,
};
async function exists(path: string) {
  try {
    await stat(path);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}
let result: unknown;
if (request.command === "start") result = await client.start();
else if (request.command === "status") result = await client.status();
else if (request.command === "stage") {
  assert(request.expectedPointId);
  await client.restore(async (candidate) => {
    const checked = await validateArtifact({
      ...validation,
      artifact: candidate.artifact,
      recoveryKey: candidate.recoveryKey,
    });
    try {
      if (request.expectedModules)
        assert.deepEqual(checked.manifest.modules, request.expectedModules);
      const trading = checked.secretEntries.find((entry) => entry.name === "secrets/trading.env");
      assert(trading);
      if (request.expectedSourceNodeId)
        assert.equal(
          parseEnvFile(Buffer.from(trading.bytes).toString()).WAITRON_NODE_ID,
          request.expectedSourceNodeId,
        );
      assert(!checked.secretEntries.some((entry) => entry.name.startsWith("secrets/cloud/")));
      await stageRestoreRequest(stateDir, candidate);
    } finally {
      await checked.discard();
    }
  }, request.expectedPointId);
  result = {
    restoreStaged: true,
    requestId: (await client.status().catch(() => null))?.requestId ?? null,
  };
} else if (request.command === "restore") {
  assert(request.expectedVenue && request.expectedSourceNodeId && request.expectedModules);
  const marker = JSON.parse(
    await readFile(join(stateDir, "flows/restore/record.json"), "utf8"),
  ).request;
  if (request.expectedPointId) assert.equal(marker.managedCloud.pointId, request.expectedPointId);
  assert.equal(await exists(join(venueDir, VENUE_FILE)), false);
  const hooks: string[] = [];
  const restored = await runStagedRestore({
    stateDir,
    venueDir,
    migrationsRoot: null,
    log: (_level, event, params) => {
      if (event === "restore.hook.done") hooks.push(String(params?.module));
    },
  });
  assert.equal(restored, true);
  await client.markRestored(marker.managedCloud);
  const store = await openVenueDatabase(venueDir);
  try {
    const venue = await readVenue(store.venue);
    assert.equal(venue.name, request.expectedVenue);
  } finally {
    await store.close();
  }
  assert.equal(
    parseEnvFile(await readFile(join(stateDir, TRADING_ENV_FILE), "utf8")).WAITRON_NODE_ID,
    request.expectedSourceNodeId,
  );
  assert.equal(await exists(join(stateDir, BACKUP_ENV_FILE)), false);
  assert.equal(await exists(join(stateDir, CLOUD_CONNECTION_FILE)), false);
  assert.equal(await exists(join(stateDir, CLOUD_STAFF_KEY_FILE)), false);
  assert.equal(await exists(join(stateDir, CLOUD_STAFF_CERT_FILE)), false);
  result = {
    restored: true,
    venue: request.expectedVenue,
    sourceNodeId: request.expectedSourceNodeId,
    hooks,
  };
} else if (request.command === "report") {
  await client.reportRestored();
  result = { reported: true };
} else if (request.command === "prepareReplacement" || request.command === "statusReplacement") {
  const nodeId = parseEnvFile(
    await readFile(join(stateDir, TRADING_ENV_FILE), "utf8"),
  ).WAITRON_NODE_ID;
  assert(nodeId);
  if (request.expectedSourceNodeId) assert.equal(nodeId, request.expectedSourceNodeId);
  const store = await openVenueDatabase(venueDir);
  try {
    const source = await store.venue.select({ id: nodes.id }).from(nodes);
    assert(source.some((row) => row.id === nodeId));
    const connection = createCloudConnection({
      stateDir,
      origin: request.origin,
      readVenueId: () => readCloudVenueId(store.venue),
      recordVenueId: (id) => withTransaction(store.venue, (tx) => saveCloudVenueId(tx, id)),
      environment: "test",
    });
    const replacement = createCloudReplacement({
      stateDir,
      origin: request.origin,
      nodeId,
      connection,
    });
    const view =
      request.command === "prepareReplacement"
        ? await replacement.prepare()
        : await replacement.check();
    result = { ...view, cloudConnection: await connection.status() };
  } finally {
    await store.close();
  }
} else throw Error("Unknown recovery command");
console.log(JSON.stringify(result));
