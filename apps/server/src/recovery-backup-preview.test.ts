import { sql } from "drizzle-orm";
import { nodeDumpEntry } from "./testing/node-copy.js";
import { stageStreamRestore } from "./restore-request.js";
import { recoveryStreamSourceId } from "./recovery-source.js";
import { createHash } from "node:crypto";
import { once } from "node:events";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { mkdir, mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  CORE_MIGRATIONS,
  openVenueDatabase,
  nodes,
  locations,
  tenants,
  stampDeployment,
} from "@waitron/db";
import { NODE_MIGRATIONS, readRecoveryKeyName } from "@waitron/node-db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { fakeModule } from "@waitron/module/src/testing/fake-module.js";
import { encryptArtifact } from "./artifact-cipher.js";
import { packArchive } from "./backup-archive.js";
import * as previewModule from "./recovery-backup-preview.js";
import { decryptArtifact } from "./artifact-cipher.js";
import { unpackArchive } from "./backup-archive.js";
import { sealNodeState, writeSealedStateRow } from "./sealed-state.js";
import { generateNodeKeyPair } from "@waitron/membership";
import { signPointer, writePointer } from "@waitron/stream";
import { createMemoryObjectStore } from "@waitron/stream/testing/memory-store.js";
import { copyFile } from "node:fs/promises";
import { mintBreakGlassSecret } from "./break-glass.js";
import { previewRecoveryArchive } from "./recovery-backup-preview.js";
import { validateArtifact } from "./restore.js";
import type { StartedServer } from "./boot.js";
import { awaitListening, copyMigrationsRoot, httpsVia } from "./testing/boot-harness.js";
import { ephemeralServerFixture } from "./testing/ephemeral-server-fixture.js";

vi.mock("@hono/node-server", async () => {
  const { ephemeralHttpMock } = await import("./testing/ephemeral-listener.js");
  return ephemeralHttpMock();
});

const { startServer, httpPort } = ephemeralServerFixture();

const suite = useVenueDb({
  migrations: [CORE_MIGRATIONS, { ...NODE_MIGRATIONS, database: "node" }],
});
const NODE = "d0000000-0000-4000-8000-000000000001";
const LOCATION = "d0000000-0000-4000-8000-000000000002";
let scratch: string;
let artifact: Uint8Array;
let oldName: string | null;
const occupied: Server[] = [];
async function occupiedPort(): Promise<number> {
  const server = createServer((_request, response) => {
    response.writeHead(503);
    response.end();
  });
  occupied.push(server);
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  return (server.address() as AddressInfo).port;
}
const modules = [
  {
    ...fakeModule("core"),
    migrations: { name: "core", table: "__drizzle_migrations_db", from: "../db/drizzle" },
  },
];
beforeEach(async () => {
  await stampDeployment(suite.db, "preproduction");
  scratch = await mkdtemp(join(tmpdir(), "recovery-preview-"));
  await suite.db
    .insert(tenants)
    .values({ id: 1, country: "ES", taxId: "89890001K", legalName: "Old venue" });
  await suite.db.insert(locations).values({
    id: LOCATION,
    name: "Old location",
    invoiceLocales: ["es-ES"],
    operationDescription: "Restaurant",
  });
  await suite.db.insert(nodes).values({ id: NODE, locationId: LOCATION, name: "Old node" });
  await mintBreakGlassSecret({ venue: suite.db, node: suite.node }, NODE);
  oldName = await readRecoveryKeyName(suite.node, NODE);
  artifact = await packSelected();
});

async function packSelected(): Promise<Uint8Array> {
  const database = join(scratch, "selected.db");
  await rm(database, { force: true });
  await suite.db.archiveTo(database);
  return encryptArtifact(
    packArchive([
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
      { name: "db.dump", bytes: await readFile(database) },
      await nodeDumpEntry(suite.node, scratch),
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
    ]),
    "archive-key-separate",
  );
}
afterEach(async () => {
  await Promise.all(
    occupied.splice(0).map(
      (server) =>
        new Promise<void>((resolve, reject) => {
          server.close((error) => (error ? reject(error) : resolve()));
        }),
    ),
  );
  if (scratch) await rm(scratch, { recursive: true, force: true });
});

function args(key = "archive-key-separate") {
  return {
    artifact,
    recoveryKey: key,
    environment: "preproduction" as const,
    stateDir: scratch,
    stagingDir: scratch,
    migrationsRoot: null,
    modules,
  };
}

it("reads the selected copy's node-key name after the live box has replaced its key", async () => {
  await mintBreakGlassSecret({ venue: suite.db, node: suite.node }, NODE);
  expect(await readRecoveryKeyName(suite.node, NODE)).not.toBe(oldName);
  expect(await previewRecoveryArchive(args())).toEqual({
    sourceId: createHash("sha256").update(artifact).digest("hex"),
    createdAt: "2026-10-01T08:00:00.000Z",
    environment: "preproduction",
    nodeId: NODE,
    nodeRecoveryKeyName: oldName,
    taxpayer: { legalName: "Old venue", taxId: "89890001K" },
    locationName: "Old location",
  });
  expect(await readdir(scratch)).toEqual(["selected.db"]);
});

it("names the key a backup's node copy holds, not one its venue copy could hold", async () => {
  suite.db.run(
    sql`create table node_recovery_key (node_id text primary key, verifier text not null, key_name text not null, updated_at text not null)`,
  );
  suite.db.run(
    sql`insert into node_recovery_key values (${NODE}, 'venue-held verifier', 'Venue-held name', '2026-10-01T08:00:00.000Z')`,
  );
  artifact = await packSelected();
  expect(oldName).not.toBeNull();
  expect(await previewRecoveryArchive(args())).toMatchObject({ nodeRecoveryKeyName: oldName });
});

it("a validated archive's staged folder holds its node copy beside its venue copy", async () => {
  const copy = await validateArtifact(args());
  try {
    expect(await readFile(join(dirname(copy.databasePath), "node.db"))).toEqual(
      Buffer.from(copy.nodeDump),
    );
  } finally {
    await copy.discard();
  }
});

it("a staged folder with no node.db is refused as incomplete, and no node.db is created", async () => {
  const copy = await validateArtifact(args());
  try {
    const folder = dirname(copy.databasePath);
    await rm(join(folder, "node.db"));
    await expect(
      previewModule.readRecoveryCopyPreview(copy, "source", { modules, migrationsRoot: null }),
    ).rejects.toMatchObject({
      code: "restore.archive_incomplete",
      params: { missing: "node.dump" },
    });
    expect(await readdir(folder)).not.toContain("node.db");
  } finally {
    await copy.discard();
  }
});

it("refuses a wrong archive encryption key without treating it as the node credential", async () => {
  await expect(previewRecoveryArchive(args("wrong-node-key"))).rejects.toMatchObject({
    code: "recovery.passphrase_invalid",
  });
});

it("the real setup listener previews the selected copy without restarting or publishing its identity", async () => {
  await mintBreakGlassSecret({ venue: suite.db, node: suite.node }, NODE);
  const stateDir = join(scratch, "replacement");
  await copyMigrationsRoot(join(scratch, "migrations"));
  const configuredPort = await occupiedPort();
  let server: StartedServer | undefined;
  let closeClient: (() => Promise<void>) | undefined;
  try {
    server = await startServer({
      WAITRON_STATE_DIR: stateDir,
      WAITRON_VENUE_DIR: join(scratch, "empty-venue"),
      WAITRON_MIGRATIONS_DIR: join(scratch, "migrations"),
      WAITRON_LOG_DIR: join(scratch, "logs"),
      WAITRON_HTTP_PORT: String(configuredPort),
      WAITRON_HTTP_LANDING_PORT: "0",
      WAITRON_ENV: "dev",
    });
    const port = httpPort();
    expect(port).not.toBe(configuredPort);
    await awaitListening(port);
    const client = httpsVia(await readFile(join(stateDir, "tls/ca.crt")));
    closeClient = client.close;
    const response = await fetch(`https://127.0.0.1:${port}/setup-api/restore/preview`, {
      ...client.via,
      method: "POST",
      headers: {
        "content-type": "application/octet-stream",
        "x-waitron-recovery-key": "archive-key-separate",
        "x-waitron-restore-environment": "preproduction",
      },
      body: new Uint8Array(artifact),
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      nodeId: NODE,
      nodeRecoveryKeyName: oldName,
      taxpayer: { legalName: "Old venue", taxId: "89890001K" },
    });
    const stateFiles = await readdir(stateDir);
    expect(stateFiles).not.toContain("restore-request.json");
    expect(stateFiles).not.toContain("trading.env");
    const status = await fetch(`https://127.0.0.1:${port}/setup-api/status`, client.via);
    expect(status.status).toBe(200);
    expect(await status.json()).toMatchObject({ provisioned: false, environment: "preproduction" });
    expect(await readFile(join(scratch, "logs/waitron.log"), "utf8")).not.toContain(
      "archive-key-separate",
    );
    expect((await fetch(`http://127.0.0.1:${configuredPort}`)).status).toBe(503);
  } finally {
    await closeClient?.();
    await server?.close();
  }
});

it("reviews the downloaded bucket key before explicitly staging its selected bytes and credential", async () => {
  const signer = generateNodeKeyPair();
  const store = createMemoryObjectStore();
  const generation = `gen-0-${NODE}-20261001T080000Z`;
  await writePointer(
    store,
    LOCATION,
    signPointer(
      {
        venueId: LOCATION,
        term: 0,
        nodeId: NODE,
        generation,
        writtenAt: "2026-10-01T08:00:00.000Z",
      },
      signer.privateKey,
    ),
    null,
  );
  const entries = unpackArchive(decryptArtifact(artifact, "archive-key-separate")).filter(
    (entry) => entry.name !== "db.dump",
  );
  await writeSealedStateRow(
    suite.db,
    NODE,
    await sealNodeState(entries, "bucket-key-separate"),
    new Date("2026-10-01T08:00:00.000Z"),
  );
  const database = join(scratch, "bucket-copy.db");
  await suite.db.archiveTo(database);
  await mintBreakGlassSecret({ venue: suite.db, node: suite.node }, NODE);
  const liveName = await readRecoveryKeyName(suite.node, NODE);
  const stateDir = join(scratch, "bucket-preview");
  const preview = (
    previewModule as unknown as { previewRecoveryStream: (deps: unknown) => Promise<unknown> }
  ).previewRecoveryStream;
  expect(typeof preview).toBe("function");
  const selection = {
    kit: {
      version: 1,
      venueId: LOCATION,
      bucket: {
        region: "local",
        bucket: "copy",
        prefix: "",
        accessKeyId: "unused",
        secretAccessKey: "unused",
      },
      recoveryKey: "bucket-key-separate",
      pointerSignerPublicKey: signer.publicKey,
    },
    stateDir,
    stagingDir: stateDir,
    migrationsRoot: null,
    modules,
    environment: "preproduction",
    litestreamBin: "/unused",
    oldBoxGone: true,
    now: () => new Date("2026-10-14T12:00:00Z"),
    log: () => {},
    openStore: () => store,
    restoreGeneration: async ({ outPath }: { outPath: string }) => {
      await copyFile(database, outPath);
    },
  } as const;
  const result = await preview(selection);
  const preparedDirectory = join(scratch, "prepared-baseline");
  await mkdir(preparedDirectory);
  const preparedDatabase = join(preparedDirectory, "venue.db");
  await copyFile(database, preparedDatabase);
  const beforeOpen = await readFile(preparedDatabase);
  const preparedStore = await openVenueDatabase(preparedDirectory);
  await preparedStore.close();
  const afterOpen = await readFile(preparedDatabase);
  expect([...beforeOpen.subarray(18, 20)]).toEqual([1, 1]);
  expect([...afterOpen.subarray(18, 20)]).toEqual([2, 2]);
  expect(result).toHaveProperty(
    "activationSourceId",
    await recoveryStreamSourceId(preparedDatabase, entries),
  );
  expect(result).toMatchObject({
    sourceId: `stream:${LOCATION}:${generation}`,
    createdAt: "2026-10-01T08:00:00.000Z",
    nodeId: NODE,
    nodeRecoveryKeyName: oldName,
    taxpayer: { legalName: "Old venue", taxId: "89890001K" },
  });
  expect(await readRecoveryKeyName(suite.node, NODE)).toBe(liveName);
  expect(await readdir(stateDir)).toEqual([]);
  const recoveryOperation = {
    binding: {
      module: "fiscal-verifactu",
      action: "restore",
      eventId: "bucket-event",
      targetNodeId: NODE,
      sourceId: await recoveryStreamSourceId(preparedDatabase, entries),
    },
    input: { allocation: "opaque", approval: "opaque" },
  };
  const credential = { recoveryOperation, nodeRecoverySecret: "synthetic staged node key" };
  await stageStreamRestore({ ...selection, ...credential, venueConfirmed: "89890001K" });
  expect(await readFile(join(stateDir, "restore-request.node-key"), "utf8")).toBe(
    "synthetic staged node key",
  );
  expect(JSON.parse(await readFile(join(stateDir, "restore-request.json"), "utf8"))).toMatchObject({
    recoveryOperation,
    nodeRecoveryKey: true,
  });
});

it("the real setup listener reaches both private download previews without staging a restore", async () => {
  const configuredPort = await occupiedPort();
  const stateDir = join(scratch, "remote-replacement");
  await copyMigrationsRoot(join(scratch, "remote-migrations"));
  let server: StartedServer | undefined;
  let closeClient: (() => Promise<void>) | undefined;
  try {
    server = await startServer({
      WAITRON_STATE_DIR: stateDir,
      WAITRON_MIGRATIONS_DIR: join(scratch, "remote-migrations"),
      WAITRON_VENUE_DIR: join(scratch, "remote-empty"),
      WAITRON_LOG_DIR: join(scratch, "remote-logs"),
      WAITRON_HTTP_PORT: String(configuredPort),
      WAITRON_HTTP_LANDING_PORT: "0",
      WAITRON_ENV: "dev",
      WAITRON_CLOUD_ORIGIN: "https://cloud.example.test",
    });
    const port = httpPort();
    expect(port).not.toBe(configuredPort);
    await awaitListening(port);
    const client = httpsVia(await readFile(join(stateDir, "tls/ca.crt")));
    closeClient = client.close;
    const bucket = await fetch(`https://127.0.0.1:${port}/setup-api/restore-bucket/preview`, {
      ...client.via,
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ kit: "synthetic-invalid-private-kit", environment: "preproduction" }),
    });
    expect(bucket.status).toBe(400);
    expect((await bucket.json()).error.code).toBe("backup.stream_kit_invalid");
    const cloud = await fetch(`https://127.0.0.1:${port}/setup-api/cloud-recovery/preview`, {
      ...client.via,
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ pointId: "047bacd4-df70-4881-a835-c6dd75ae7ecf" }),
    });
    expect(cloud.status).toBe(500);
    expect((await cloud.json()).error.code).toBe("server.internal");
    expect(await readdir(stateDir)).not.toContain("restore-request.json");
    expect(await readFile(join(scratch, "remote-logs/waitron.log"), "utf8")).not.toContain(
      "synthetic-invalid-private-kit",
    );
    expect((await fetch(`http://127.0.0.1:${configuredPort}`)).status).toBe(503);
  } finally {
    await closeClient?.();
    await server?.close();
  }
});
