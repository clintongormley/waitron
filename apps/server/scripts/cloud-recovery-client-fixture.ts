import assert from "node:assert/strict";
import { readFile, realpath, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { locations, openVenueDatabase } from "@waitron/db";
import { createCloudRecoveryClient } from "../src/cloud-recovery.js";
import { stageRestoreRequest, runStagedRestore } from "../src/restore-request.js";
import { validateArtifact } from "../src/restore.js";
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
  command: "start" | "status" | "stage" | "restore" | "report";
  origin: string;
  storageCaBase64?: string;
  expectedPointId?: string;
  expectedVenue?: string;
  expectedSourceNodeId?: string;
  expectedModules?: Record<string, number>;
};
assert(typeof request.origin === "string" && new URL(request.origin).origin === request.origin);
const stateDir = join(root, "state");
const venueDir = join(root, "venue");
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
  stagingDir: join(stateDir, "restore-staging"),
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
    if (request.expectedModules)
      assert.deepEqual(checked.manifest.modules, request.expectedModules);
    const trading = checked.secretEntries.find((entry) => entry.name === "secrets/trading.env");
    assert(trading);
    if (request.expectedSourceNodeId)
      assert.equal(
        parseEnvFile(Buffer.from(trading.bytes).toString()).WAITRON_TILL_NODE_ID,
        request.expectedSourceNodeId,
      );
    assert(
      !checked.secretEntries.some(
        (entry) => entry.name.includes("cloud-connection") || entry.name.includes("cloud-staff"),
      ),
    );
    await stageRestoreRequest(stateDir, candidate);
  }, request.expectedPointId);
  result = {
    restoreStaged: true,
    requestId: (await client.status().catch(() => null))?.requestId ?? null,
  };
} else if (request.command === "restore") {
  assert(request.expectedVenue && request.expectedSourceNodeId && request.expectedModules);
  const marker = JSON.parse(await readFile(join(stateDir, "restore-request.json"), "utf8"));
  if (request.expectedPointId) assert.equal(marker.managedCloud.pointId, request.expectedPointId);
  assert.equal(await exists(join(venueDir, "venue.db")), false);
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
    const venue = await store.venue.select({ name: locations.name }).from(locations);
    assert.deepEqual(
      venue.map((row) => row.name),
      [request.expectedVenue],
    );
  } finally {
    await store.close();
  }
  assert.equal(
    parseEnvFile(await readFile(join(stateDir, "trading.env"), "utf8")).WAITRON_TILL_NODE_ID,
    request.expectedSourceNodeId,
  );
  assert.equal(await exists(join(stateDir, "backup.env")), false);
  assert.equal(await exists(join(stateDir, "cloud-connection.json")), false);
  assert.equal(await exists(join(stateDir, "cloud-staff.key")), false);
  assert.equal(await exists(join(stateDir, "cloud-staff.crt")), false);
  result = {
    restored: true,
    venue: request.expectedVenue,
    sourceNodeId: request.expectedSourceNodeId,
    hooks,
  };
} else if (request.command === "report") {
  await client.reportRestored();
  result = { reported: true };
} else throw Error("Unknown recovery command");
console.log(JSON.stringify(result));
