import assert from "node:assert/strict";
import { createConnection } from "node:net";
import { mkdir, readFile, realpath, rm, stat, writeFile } from "node:fs/promises";
import { join, resolve, sep } from "node:path";
import { tmpdir } from "node:os";
import { DatabaseSync } from "node:sqlite";
import { locations, openVenueDatabase } from "@waitron/db";
import { runOnce } from "../src/backup-sweep.js";
import { validateArtifact, writeValidated } from "../src/restore.js";
import { ALL_MODULES } from "../src/modules.js";
import { parseEnvFile } from "../src/env-file.js";

// This process handles only disposable integration roots and never starts a server or workers.
const root = await realpath(resolve(process.env.CLOUD_TEST_ROOT ?? ""));
const temporary = await realpath(tmpdir());
assert(root.startsWith(temporary + sep) && root.includes("cloud-integration-backup-"));
const networkDenied = await new Promise<boolean>((done) => {
  try {
    const socket = createConnection({ host: "127.0.0.1", port: 9 });
    socket.once("error", (error) =>
      done((error as NodeJS.ErrnoException).code === "ERR_ACCESS_DENIED"),
    );
    socket.once("connect", () => {
      socket.destroy();
      done(false);
    });
  } catch (error) {
    done((error as NodeJS.ErrnoException).code === "ERR_ACCESS_DENIED");
  }
});
assert(networkDenied, "Run this fixture with Node network permission denied");
let input = "";
for await (const chunk of process.stdin) {
  input += String(chunk);
  assert(input.length < 65536);
}
const request = JSON.parse(input) as {
  command: "capture" | "restore";
  recoveryKey: string;
  sourceNodeId?: string;
  modules?: Record<string, number>;
  expectedVenue?: string;
  stateSubdir?: "state";
};
assert(/^[A-Za-z0-9_-]{43}$/.test(request.recoveryKey));
assert(request.stateSubdir === undefined || request.stateSubdir === "state");
const stateDir = request.stateSubdir === "state" ? join(root, "state") : root;
const validation = {
  recoveryKey: request.recoveryKey,
  stateDir,
  stagingDir: join(stateDir, "backup-staging"),
  modules: ALL_MODULES,
  migrationsRoot: null,
  environment: "preproduction" as const,
};
const exists = async (name: string, directory = root) => {
  try {
    await stat(join(directory, name));
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    return false;
  }
};
if (request.command === "capture") {
  // No lock: Cloud's runner captures while the fixture server on this folder is still running.
  const store = await openVenueDatabase(join(root, "venue"), { exclusive: false });
  try {
    let artifact: Uint8Array | undefined;
    await runOnce({
      backends: [
        {
          id: "cloud-test-capture",
          async put(_key, bytes) {
            artifact = bytes;
          },
          async get() {
            throw new Error("Capture does not read from its destination");
          },
          async list() {
            return [];
          },
          async delete() {
            throw new Error("Capture does not prune Cloud retention");
          },
        },
      ],
      db: store.venue,
      modules: ALL_MODULES,
      environment: "preproduction",
      resolvers: {},
      stateDir,
      recoveryKey: request.recoveryKey,
      stagingDir: validation.stagingDir,
      retain: 100,
      retainDays: 3650,
      signal: new AbortController().signal,
      log: () => {},
      archive: (file) => store.venue.archiveTo(file),
    });
    assert(artifact, "Waitron did not capture an archive");
    const checked = await validateArtifact({ ...validation, artifact });
    const trading = checked.secretEntries.find((entry) => entry.name === "secrets/trading.env");
    assert(trading);
    const identity = parseEnvFile(Buffer.from(trading.bytes).toString());
    const venue = await store.venue.select({ name: locations.name }).from(locations);
    assert.equal(venue.length, 1);
    await writeFile(join(root, "captured.backup.enc"), artifact, { mode: 0o600 });
    console.log(
      JSON.stringify({
        networkDenied,
        manifest: checked.manifest,
        sourceNodeId: identity.WAITRON_TILL_NODE_ID,
        venueName: venue[0]!.name,
        entries: checked.secretEntries.map((entry) => entry.name),
      }),
    );
  } finally {
    await store.close();
  }
} else if (request.command === "restore") {
  assert.equal(await exists("venue/venue.db"), false, "Restore target must be fresh");
  const artifact = await readFile(join(root, "input.backup.enc"));
  const checked = await validateArtifact({ ...validation, artifact });
  assert.deepEqual(checked.manifest.modules, request.modules);
  const trading = checked.secretEntries.find((entry) => entry.name === "secrets/trading.env");
  assert(trading);
  assert.equal(
    parseEnvFile(Buffer.from(trading.bytes).toString()).WAITRON_TILL_NODE_ID,
    request.sourceNodeId,
  );
  assert(
    !checked.secretEntries.some(
      (entry) => entry.name.includes("cloud-connection") || entry.name.includes("cloud-staff"),
    ),
  );
  const sideFile = join(root, "integrity.db");
  await writeFile(sideFile, checked.dumpEntry.bytes, { mode: 0o600 });
  try {
    const db = new DatabaseSync(sideFile, { readOnly: true });
    try {
      assert.deepEqual(
        db
          .prepare("PRAGMA integrity_check")
          .all()
          .map((row) => row.integrity_check),
        ["ok"],
      );
    } finally {
      db.close();
    }
  } finally {
    await rm(sideFile);
  }
  // A replacement receives fresh destination credentials; it must not reuse captured backup.env.
  const managed = {
    ...checked,
    secretEntries: checked.secretEntries.filter((entry) => entry.name !== "secrets/backup.env"),
  };
  const hooks: string[] = [];
  await mkdir(join(root, "venue"), { mode: 0o700 });
  await writeValidated(managed, {
    ...validation,
    venueDir: join(root, "venue"),
    log: (_level, code, params) => {
      if (code === "restore.hook.done") hooks.push(String(params?.module));
    },
  });
  const store = await openVenueDatabase(join(root, "venue"));
  try {
    const venue = await store.venue.select({ name: locations.name }).from(locations);
    assert.deepEqual(
      venue.map((row) => row.name),
      [request.expectedVenue],
    );
  } finally {
    await store.close();
  }
  assert.equal(await exists("backup.env", stateDir), false);
  console.log(
    JSON.stringify({
      networkDenied,
      integrityOk: true,
      hooks,
      cloudCredentialPresent: await exists("cloud-connection.json", stateDir),
      staffKeyPresent: await exists("cloud-staff.key", stateDir),
    }),
  );
} else {
  throw new Error("Unknown backup fixture command");
}
