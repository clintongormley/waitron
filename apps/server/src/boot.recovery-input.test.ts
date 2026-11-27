import { seedPersons } from "@waitron/identity/test/person-rows.js";
import { hashPassword } from "@waitron/identity";
import { seedVenueSettings, seedBusinessDay } from "@waitron/db/testing/seed.js";
import { nodeDumpEntry } from "./testing/node-copy.js";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { CORE_MIGRATIONS, nodes, stampDeployment, taxpayer } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { encodeRecoveryKit } from "@waitron/stream";
import { authorityKey, makeMasterKey } from "@waitron/credentials";
import { decodeMasterKeyCode, encodeMasterKeyCode } from "@waitron/shared";
import { masterKeyArchiveBytes } from "./testing/master-key-archive.js";
import { mintMasterKey } from "./testing/master-key.js";
import { heldBackupKey } from "./testing/backup-key.js";
import { packArchive } from "./backup-archive.js";
import { recoveryArchiveSourceId, recoveryStreamSourceId } from "./recovery-source.js";
import type { StartedServer } from "./boot.js";
import { ephemeralServerFixture } from "./testing/ephemeral-server-fixture.js";
import { awaitListening, copyMigrationsRoot, httpsVia } from "./testing/boot-harness.js";
import { freePorts } from "./testing/free-ports.js";

const PAPER_KEY = encodeMasterKeyCode(makeMasterKey());
/** The master key that sealed the file; `PAPER_KEY` is sent separately as the authorisation. */
const ARCHIVE_MASTER_KEY = makeMasterKey();
const ARCHIVE_KEY_TEXT = encodeMasterKeyCode(ARCHIVE_MASTER_KEY);

vi.mock("@hono/node-server", async () => {
  const { ephemeralHttpMock } = await import("./testing/ephemeral-listener.js");
  return ephemeralHttpMock();
});

const { startServer, httpPort } = ephemeralServerFixture();

const download = vi.hoisted(() => vi.fn());
vi.mock("./restore-stream.js", async (original) => ({
  ...(await original<typeof import("./restore-stream.js")>()),
  prepareStreamRestore: download,
}));
const suite = useVenueDb({ migrations: [CORE_MIGRATIONS] });
const NODE = "d0000000-0000-4000-8000-000000000001";
const LOCATION = "d0000000-0000-4000-8000-000000000002";
let scratch: string;
beforeEach(async () => {
  await seedPersons(suite.db, {
    displayName: "Backup administrator",
    role: "admin",
    passwordHash: hashPassword("fixture-restore-password"),
  });
  await stampDeployment(suite.db, "preproduction");
  await suite.db
    .insert(taxpayer)
    .values({ id: 1, country: "ES", taxId: "89890001K", legalName: "Old venue" });
  await seedVenueSettings(suite.db, {
    name: "Old venue",
    invoiceLocales: ["es-ES"],
  });
  await seedBusinessDay(suite.db, {});
  await suite.db.insert(nodes).values({ id: NODE, name: "Old node" });
  scratch = await mkdtemp(join(tmpdir(), "w41s6-public-boot-"));
});
afterEach(async () => {
  if (scratch) await rm(scratch, { recursive: true, force: true });
});

it.each(["archive", "bucket"])(
  "the real setup listener stages %s credentials outside its public marker and logs",
  async (kind) => {
    const stateDir = join(scratch, "replacement");
    const database = join(scratch, "selected.db");
    await mintMasterKey(suite.db, { bytes: decodeMasterKeyCode(PAPER_KEY) });
    await suite.db.archiveTo(database);
    const entries = [
      await nodeDumpEntry(suite.node, scratch),
      {
        name: "manifest.json",
        bytes: Buffer.from(
          JSON.stringify({
            manifestVersion: 1,
            createdAt: "2026-10-01T08:00:00.000Z",
            environment: "preproduction",
            modules: { core: 0 },
          }),
        ),
      },
      {
        name: "secrets/trading.env",
        bytes: Buffer.from(`WAITRON_NODE_ID=${NODE}\n`),
      },
      { name: "secrets/node-key.enc", bytes: Buffer.from("sealed") },
      { name: "secrets/cluster-id", bytes: Buffer.from("cluster") },
      {
        name: "secrets/credentials.key",
        bytes: Buffer.from(Buffer.alloc(32, 7).toString("base64")),
      },
    ];
    const artifact = masterKeyArchiveBytes(
      packArchive([...entries, { name: "db.dump", bytes: await readFile(database) }]),
      ARCHIVE_MASTER_KEY,
    );
    download.mockResolvedValue({
      databasePath: database,
      entries,
      nodeId: NODE,
      generation: "generation",
      venue: { legalName: "Old venue", taxId: "89890001K", venueName: "Old venue" },
      discard: async () => {},
    });
    const operation = {
      binding: {
        module: "test-regime",
        action: "restore",
        eventId: "paper-42",
        targetNodeId: NODE,
        sourceId:
          kind === "archive"
            ? recoveryArchiveSourceId(artifact)
            : await recoveryStreamSourceId(database, entries),
      },
      input: { publicEnvelope: "signed-outside" },
    };
    await copyMigrationsRoot(join(scratch, "migrations"));
    const [port] = await freePorts(1);
    let server: StartedServer | undefined;
    let closeClient: (() => Promise<void>) | undefined;
    const kill = vi.spyOn(process, "kill").mockReturnValue(true);
    try {
      server = await startServer({
        WAITRON_STATE_DIR: stateDir,
        WAITRON_VENUE_DIR: join(scratch, "empty"),
        WAITRON_MIGRATIONS_DIR: join(scratch, "migrations"),
        WAITRON_LOG_DIR: join(scratch, "logs"),
        WAITRON_HTTP_PORT: String(port),
        WAITRON_HTTP_LANDING_PORT: "0",
        WAITRON_ENV: "dev",
      });
      await awaitListening(httpPort());
      const client = httpsVia(await readFile(join(stateDir, "tls/ca.crt")));
      closeClient = client.close;
      const form = new FormData();
      form.set("artifact", new Blob([new Uint8Array(artifact)]), "copy.waitron");
      form.set("masterKey", ARCHIVE_KEY_TEXT);
      form.set("environment", "preproduction");
      form.set("oldBoxGone", "1");
      form.set("recoveryOperation", JSON.stringify(operation));
      form.set("nodeRecoverySecret", PAPER_KEY);
      const kit = encodeRecoveryKit({
        version: 2 as const,
        streamId: LOCATION,
        recoveryKey: "archive-key",
        pointerSignerPublicKey: "MCowBQYDK2VwAyEA0000000000000000000000000000000000000000000=",
        bucket: {
          region: "local",
          bucket: "copy",
          prefix: "",
          accessKeyId: "unused",
          secretAccessKey: "unused",
        },
      });
      const response = await fetch(
        `https://127.0.0.1:${httpPort()}/setup-api/${kind === "archive" ? "restore" : "restore-bucket"}`,
        {
          ...client.via,
          method: "POST",
          ...(kind === "bucket" ? { headers: { "content-type": "application/json" } } : {}),
          body:
            kind === "archive"
              ? form
              : JSON.stringify({
                  kit,
                  environment: "preproduction",
                  oldBoxGone: true,
                  venueConfirmed: "89890001K",
                  recoveryOperation: operation,
                  nodeRecoverySecret: PAPER_KEY,
                }),
        },
      );
      expect(response.status, await response.text()).toBe(202);
      if (kind === "bucket")
        expect(download).toHaveBeenCalledWith(
          expect.objectContaining({ signal: expect.any(AbortSignal) }),
        );
      await vi.waitFor(() => expect(kill).toHaveBeenCalledWith(process.pid, "SIGTERM"));
      const marker = await readFile(join(stateDir, "flows/restore/record.json"), "utf8");
      expect(JSON.parse(marker).request).toMatchObject({
        recoveryOperation: operation,
        nodeRecoveryKey: true,
      });
      expect(marker).not.toContain(PAPER_KEY);
      expect(marker).not.toContain(ARCHIVE_KEY_TEXT);
      expect(marker).not.toContain(heldBackupKey(ARCHIVE_MASTER_KEY).key);
      expect(await readFile(join(stateDir, "flows/restore/node-key"), "utf8")).toBe(
        authorityKey(decodeMasterKeyCode(PAPER_KEY)).toString("hex"),
      );
      const logs = await readFile(join(scratch, "logs/waitron.log"), "utf8");
      expect(logs).not.toContain(PAPER_KEY);
      expect(logs).not.toContain("archive-key");
      expect(logs).not.toContain(ARCHIVE_KEY_TEXT);
      expect(logs).not.toContain(heldBackupKey(ARCHIVE_MASTER_KEY).key);
      await vi.waitFor(() => expect(kill).toHaveBeenCalledWith(process.pid, "SIGTERM"));
    } finally {
      await closeClient?.();
      await server?.close();
      kill.mockRestore();
    }
  },
  60_000,
);

/** Every file under `dir`, folders left out. */
async function filesIn(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { recursive: true, withFileTypes: true });
  return entries
    .filter((entry) => !entry.isDirectory())
    .map((entry) => relative(dir, join(entry.parentPath, entry.name)))
    .sort();
}

/** A backup file sealed under `ARCHIVE_MASTER_KEY` whose copy's current master key is `current`,
 * posted to the real setup listener's `/setup-api/restore` with `fields`. */
async function restoreFile(current: Uint8Array, fields: Record<string, string>) {
  const stateDir = join(scratch, "replacement");
  const database = join(scratch, "selected.db");
  const minted = await mintMasterKey(suite.db, { bytes: current });
  await suite.db.archiveTo(database);
  const artifact = masterKeyArchiveBytes(
    packArchive([
      await nodeDumpEntry(suite.node, scratch),
      {
        name: "manifest.json",
        bytes: Buffer.from(
          JSON.stringify({
            manifestVersion: 1,
            createdAt: "2026-10-01T08:00:00.000Z",
            environment: "preproduction",
            modules: { core: 0 },
          }),
        ),
      },
      { name: "secrets/trading.env", bytes: Buffer.from(`WAITRON_NODE_ID=${NODE}\n`) },
      { name: "secrets/node-key.enc", bytes: Buffer.from("sealed") },
      { name: "secrets/cluster-id", bytes: Buffer.from("cluster") },
      {
        name: "secrets/credentials.key",
        bytes: Buffer.from(Buffer.alloc(32, 7).toString("base64")),
      },
      { name: "db.dump", bytes: await readFile(database) },
    ]),
    ARCHIVE_MASTER_KEY,
  );
  const operation = {
    binding: {
      module: "test-regime",
      action: "restore",
      eventId: "paper-42",
      targetNodeId: NODE,
      sourceId: recoveryArchiveSourceId(artifact),
    },
    input: { publicEnvelope: "signed-outside" },
  };
  await copyMigrationsRoot(join(scratch, "migrations"));
  const [port] = await freePorts(1);
  let server: StartedServer | undefined;
  let closeClient: (() => Promise<void>) | undefined;
  const kill = vi.spyOn(process, "kill").mockReturnValue(true);
  try {
    server = await startServer({
      WAITRON_STATE_DIR: stateDir,
      WAITRON_VENUE_DIR: join(scratch, "empty"),
      WAITRON_MIGRATIONS_DIR: join(scratch, "migrations"),
      WAITRON_LOG_DIR: join(scratch, "logs"),
      WAITRON_HTTP_PORT: String(port),
      WAITRON_HTTP_LANDING_PORT: "0",
      WAITRON_ENV: "dev",
    });
    await awaitListening(httpPort());
    const client = httpsVia(await readFile(join(stateDir, "tls/ca.crt")));
    closeClient = client.close;
    const before = await filesIn(stateDir);
    const form = new FormData();
    form.set("artifact", new Blob([new Uint8Array(artifact)]), "copy.waitron");
    form.set("environment", "preproduction");
    form.set("oldBoxGone", "1");
    form.set("recoveryOperation", JSON.stringify(operation));
    for (const [name, value] of Object.entries(fields)) form.set(name, value);
    const response = await fetch(`https://127.0.0.1:${httpPort()}/setup-api/restore`, {
      ...client.via,
      method: "POST",
      body: form,
    });
    const answer = {
      status: response.status,
      body: (await response.json()) as Record<string, unknown>,
    };
    if (answer.status === 202)
      await vi.waitFor(() => expect(kill).toHaveBeenCalledWith(process.pid, "SIGTERM"));
    return {
      ...answer,
      name: minted.name,
      before,
      after: await filesIn(stateDir),
      stateDir,
      restarted: kill.mock.calls.some(
        ([pid, signal]) => pid === process.pid && signal === "SIGTERM",
      ),
    };
  } finally {
    await closeClient?.();
    await server?.close();
    kill.mockRestore();
  }
}

describe("a backup file whose key is not the copy's current master key", () => {
  const current = makeMasterKey();

  it("is refused before staging, naming the copy's current key, when no other key is sent", async () => {
    const answer = await restoreFile(current, { masterKey: ARCHIVE_KEY_TEXT });
    expect(answer.status, JSON.stringify(answer.body)).toBe(400);
    expect(answer.body).toEqual({
      error: { code: "promotion.break_glass_invalid", params: { keyName: answer.name } },
    });
    expect(answer.after).toEqual(answer.before);
    expect(answer.restarted).toBe(false);
  }, 60_000);

  it("is staged when the copy's current master key is sent as the authorisation beside it", async () => {
    const answer = await restoreFile(current, {
      masterKey: ARCHIVE_KEY_TEXT,
      nodeRecoverySecret: encodeMasterKeyCode(current),
    });
    expect(answer.status, JSON.stringify(answer.body)).toBe(202);
    expect(answer.restarted).toBe(true);
    // The refusals' unchanged file lists would show a staged restore's files.
    expect(answer.after.filter((file) => !answer.before.includes(file))).toEqual(
      expect.arrayContaining([join("flows", "restore", "record.json")]),
    );
    expect(await readFile(join(answer.stateDir, "flows/restore/node-key"), "utf8")).toBe(
      authorityKey(current).toString("hex"),
    );
  }, 60_000);

  it("is refused when the key sent as the authorisation is not the copy's current one either", async () => {
    const answer = await restoreFile(current, {
      masterKey: ARCHIVE_KEY_TEXT,
      nodeRecoverySecret: PAPER_KEY,
    });
    expect(answer.status, JSON.stringify(answer.body)).toBe(400);
    expect(answer.body).toEqual({
      error: { code: "promotion.break_glass_invalid", params: { keyName: answer.name } },
    });
    expect(answer.after).toEqual(answer.before);
    expect(answer.restarted).toBe(false);
  }, 60_000);
});

it("stages a backup file whose key is the copy's current master key, sent alone", async () => {
  const answer = await restoreFile(ARCHIVE_MASTER_KEY, { masterKey: ARCHIVE_KEY_TEXT });
  expect(answer.status, JSON.stringify(answer.body)).toBe(202);
  expect(answer.restarted).toBe(true);
  expect(await readFile(join(answer.stateDir, "flows/restore/node-key"), "utf8")).toBe(
    authorityKey(ARCHIVE_MASTER_KEY).toString("hex"),
  );
}, 60_000);
