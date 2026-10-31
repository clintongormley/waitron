import { nodeDumpEntry } from "./testing/node-copy.js";
import { createHash } from "node:crypto";
import { copyFile, mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { CORE_MIGRATIONS, locations, nodes, stampDeployment, tenants } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { fakeModule } from "@waitron/module/src/testing/fake-module.js";
import { generateNodeKeyPair } from "@waitron/membership";
import { generationPrefix, encodeRecoveryKit, signPointer, writePointer } from "@waitron/stream";
import { createMemoryObjectStore } from "@waitron/stream/testing/memory-store.js";
import { encryptArtifact } from "./artifact-cipher.js";
import { packArchive, type ArchiveEntry } from "./backup-archive.js";
import { sealNodeState, writeSealedStateRow } from "./sealed-state.js";
import { mintBreakGlassKey } from "./break-glass.js";
import { createCloudRecoveryClient } from "./cloud-recovery.js";
import * as adapter from "./first-setup-backup-source.js";

const proofNodeRows = vi.hoisted(() => ({ recording: false, seen: [] as unknown[][] }));
vi.mock("./recovery-backup-preview.js", async (original) => {
  const actual = await original<typeof import("./recovery-backup-preview.js")>();
  const path = await import("node:path");
  const { DatabaseSync } = await import("node:sqlite");
  return {
    ...actual,
    readRecoveryCopyPreview: async (...args: Parameters<typeof actual.readRecoveryCopyPreview>) => {
      if (!proofNodeRows.recording) return actual.readRecoveryCopyPreview(...args);
      const copy = new DatabaseSync(path.join(path.dirname(args[0].databasePath), "node.db"), {
        readOnly: true,
      });
      try {
        const marked = copy
          .prepare("select name from sqlite_master where name = 'backup_marker'")
          .all();
        proofNodeRows.seen.push(
          marked.length === 0
            ? []
            : copy
                .prepare("select v from backup_marker")
                .all()
                .map((row) => row.v),
        );
      } finally {
        copy.close();
      }
      return actual.readRecoveryCopyPreview(...args);
    },
  };
});

const suite = useVenueDb({ migrations: [CORE_MIGRATIONS] });
const NODE = "d0000000-0000-4000-8000-000000000001";
const LOCATION = "d0000000-0000-4000-8000-000000000002";
const POINT = "047bacd4-df70-4881-a835-c6dd75ae7ecf";
const modules = [
  {
    ...fakeModule("core"),
    migrations: { name: "core", table: "__drizzle_migrations_db", from: "../db/drizzle" },
  },
];
let scratch: string;
let entries: ArchiveEntry[];
let artifact: Uint8Array;
let database: string;
let key: { name: string; secret: string };

beforeEach(async () => {
  scratch = await mkdtemp(join(tmpdir(), "repair-backup-source-"));
  await stampDeployment(suite.db, "preproduction");
  await suite.db
    .insert(tenants)
    .values({ id: 1, country: "ES", taxId: "89890001K", legalName: "Selected business" });
  await suite.db.insert(locations).values({
    id: LOCATION,
    name: "Selected location",
    invoiceLocales: ["es-ES"],
    operationDescription: "Restaurant",
  });
  await suite.db.insert(nodes).values({ id: NODE, locationId: LOCATION, name: "Selected node" });
  key = await mintBreakGlassKey(suite.db, NODE);
  database = join(scratch, "selected.db");
  await suite.db.archiveTo(database);
  entries = [
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
    { name: "secrets/credentials.key", bytes: Buffer.from(Buffer.alloc(32, 7).toString("base64")) },
  ];
  artifact = encryptArtifact(
    packArchive([...entries, { name: "db.dump", bytes: await readFile(database) }]),
    "archive-key",
  );
});
afterEach(async () => {
  proofNodeRows.recording = false;
  if (scratch) await rm(scratch, { recursive: true, force: true });
});

function deps() {
  return {
    stateDir: join(scratch, "state"),
    stagingDir: join(scratch, "staging"),
    migrationsRoot: null,
    modules,
    bucket: {
      litestreamBin: "/unused",
      now: () => new Date("2026-10-14T12:00:00Z"),
      log: () => {},
    },
  };
}
const archive = () => ({
  kind: "archive" as const,
  artifact,
  recoveryKey: "archive-key",
  environment: "preproduction" as const,
});

it("owns a private validated archive copy until disposal, retaining the encrypted input and source DB", async () => {
  const original = await readFile(database);
  const encrypted = Uint8Array.from(artifact);
  const selected = await adapter.openFirstSetupBackupSource(archive(), deps());
  expect(selected.sourceId).toBe(createHash("sha256").update(encrypted).digest("hex"));
  expect(selected.copy.sourceId).toBe(selected.sourceId);
  expect(await readFile(selected.copy.databasePath)).toEqual(original);
  expect(selected.copy.databasePath).not.toBe(database);
  expect(selected).not.toHaveProperty("preview");
  expect(selected).not.toHaveProperty("cloudRequest");
  const owned = dirname(selected.copy.databasePath);
  await selected.copy.discard();
  await expect(readFile(selected.copy.databasePath)).rejects.toMatchObject({ code: "ENOENT" });
  expect(await readdir(dirname(owned))).not.toContain(owned.split("/").at(-1));
  expect(await readFile(database)).toEqual(original);
  expect(Buffer.from(artifact)).toEqual(Buffer.from(encrypted));
});

it("refuses an archive encryption key that does not open the selected copy", async () => {
  await expect(
    adapter.openFirstSetupBackupSource({ ...archive(), recoveryKey: "wrong-key" }, deps()),
  ).rejects.toMatchObject({ code: "recovery.passphrase_invalid" });
});
it("refuses cross-environment archives before handing a private copy to recovery", async () => {
  await expect(
    adapter.openFirstSetupBackupSource({ ...archive(), environment: "production" }, deps()),
  ).rejects.toMatchObject({ code: "restore.environment_mismatch" });
});

async function bucket() {
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
  await writeSealedStateRow(
    suite.db,
    NODE,
    await sealNodeState(entries, "bucket-key"),
    new Date("2026-10-01T08:00:00Z"),
  );
  await suite.db.archiveTo(database);
  const kit = {
    version: 1 as const,
    venueId: LOCATION,
    bucket: {
      region: "local",
      bucket: "copy",
      prefix: "",
      accessKeyId: "unused",
      secretAccessKey: "unused",
    },
    recoveryKey: "bucket-key",
    pointerSignerPublicKey: signer.publicKey,
  };
  const options = deps();
  return {
    kit,
    store,
    generation,
    options: {
      ...options,
      bucket: {
        ...options.bucket,
        openStore: () => store,
        restoreGeneration: async ({ outPath }: { outPath: string }) => {
          await copyFile(database, outPath);
        },
      },
    },
  };
}

it("keeps a bucket's generation label distinct from the exact activation bytes and owns disposal", async () => {
  const b = await bucket();
  const selected = await adapter.openFirstSetupBackupSource(
    { kind: "bucket", kit: encodeRecoveryKit(b.kit), environment: "preproduction" },
    b.options,
  );
  expect(selected.sourceId).toBe(`stream:${LOCATION}:${b.generation}`);
  expect(selected.copy.sourceId).toMatch(/^stream-sha256:[a-f0-9]{64}$/);
  expect(selected.copy.sourceId).not.toBe(selected.sourceId);
  expect((await readFile(selected.copy.databasePath)).length).toBeGreaterThan(0);
  await selected.copy.discard();
  await expect(readFile(selected.copy.databasePath)).rejects.toMatchObject({ code: "ENOENT" });
  expect((await readFile(database)).length).toBeGreaterThan(0);
});

it("cleans the downloaded private bucket copy when validation refuses its environment", async () => {
  const b = await bucket();
  await expect(
    adapter.openFirstSetupBackupSource(
      { kind: "bucket", kit: encodeRecoveryKit(b.kit), environment: "production" },
      b.options,
    ),
  ).rejects.toMatchObject({ code: "restore.environment_mismatch" });
  expect(await readdir(b.options.stateDir)).toEqual([]);
});
it("keeps the bucket pointer signature guard before any database download", async () => {
  const b = await bucket();
  b.kit.pointerSignerPublicKey = generateNodeKeyPair().publicKey;
  let downloaded = false;
  b.options.bucket.restoreGeneration = async () => {
    downloaded = true;
  };
  await expect(
    adapter.openFirstSetupBackupSource(
      { kind: "bucket", kit: encodeRecoveryKit(b.kit), environment: "preproduction" },
      b.options,
    ),
  ).rejects.toMatchObject({ code: "restore.stream_pointer_unverified" });
  expect(downloaded).toBe(false);
});

it("refuses Cloud when no private recovery client exists", async () => {
  await expect(
    adapter.openFirstSetupBackupSource({ kind: "cloud", pointId: POINT }, deps()),
  ).rejects.toMatchObject({ code: "setup.not_ready" });
});

it("retains the real Cloud client's bound request and validates its archive without staging", async () => {
  const stateDir = join(scratch, "cloud");
  const point = {
    id: POINT,
    venueId: LOCATION,
    capturedAt: "2026-10-01T08:00:00Z",
    modules: { core: 0 },
    digest: createHash("sha256").update(artifact).digest("hex"),
    size: artifact.length,
    objectKey: `snapshots/${POINT}`,
    verification: "verified",
    kind: "snapshot",
    deleting: false,
    deletedAt: null,
  };
  const expiry = new Date(Date.now() + 3600000).toISOString();
  const client = createCloudRecoveryClient({
    stateDir,
    origin: "https://cloud.example.test",
    environment: "preproduction",
    download: async () => artifact,
    fetch: async (_url, init) => {
      const body = JSON.parse(String(init?.body));
      const requestId = JSON.parse(Buffer.from(body.payload, "base64url").toString())[2];
      if (String(_url).endsWith("/start") || String(_url).endsWith("/status"))
        return Response.json({
          requestId,
          operationId: requestId,
          state: "approved",
          expiresAt: expiry,
        });
      if (String(_url).endsWith("/info"))
        return Response.json({ point, operationExpiresAt: expiry });
      if (String(_url).endsWith("/read"))
        return Response.json({
          point,
          location: { endpoint: "https://store.example.test", bucket: "copy", region: "local" },
          credentials: {
            accessKeyId: "access",
            secretAccessKey: "secret",
            sessionToken: "session",
          },
          recoveryKey: "archive-key",
          expiresAt: expiry,
          operationExpiresAt: expiry,
        });
      throw new Error("unexpected provider action");
    },
  });
  const view = await client.start();
  const selected = await adapter.openFirstSetupBackupSource(
    { kind: "cloud", pointId: POINT },
    { ...deps(), cloudRecovery: client },
  );
  try {
    expect(selected.cloudRequest).toEqual({
      artifact,
      recoveryKey: "archive-key",
      environment: "preproduction",
      managedCloud: { requestId: view.requestId, pointId: POINT },
    });
    expect(selected.sourceId).toBe(createHash("sha256").update(artifact).digest("hex"));
    const saved = JSON.parse(await readFile(join(stateDir, "cloud-recovery.json"), "utf8"));
    expect(saved.phase).toBeUndefined();
    expect(await readFile(selected.copy.databasePath)).toEqual(await readFile(database));
  } finally {
    await selected.copy.discard();
  }
});

it("authenticates the selected backup before revealing its private preview, retaining its original bytes", async () => {
  const selected = await adapter.openFirstSetupBackupSource(archive(), deps());
  try {
    const before = await readFile(selected.copy.databasePath);
    const replacement = await mintBreakGlassKey(suite.db, NODE);
    await expect(
      adapter.authenticatedFirstSetupBackupPreview(
        selected,
        {
          module: "core",
          action: "restore",
          eventId: "repair-proof",
          targetNodeId: NODE,
          sourceId: selected.copy.sourceId!,
        },
        replacement.secret,
        deps(),
      ),
    ).rejects.toMatchObject({ code: "promotion.break_glass_invalid" });
    const preview = await adapter.authenticatedFirstSetupBackupPreview(
      selected,
      {
        module: "core",
        action: "restore",
        eventId: "repair-proof",
        targetNodeId: NODE,
        sourceId: selected.copy.sourceId!,
      },
      key.secret,
      deps(),
    );
    expect(preview).toEqual({
      sourceId: selected.sourceId,
      createdAt: "2026-10-01T08:00:00.000Z",
      environment: "preproduction",
      nodeId: NODE,
      nodeRecoveryKeyName: key.name,
      taxpayer: { legalName: "Selected business", taxId: "89890001K" },
      locationName: "Selected location",
    });
    expect(await readFile(selected.copy.databasePath)).toEqual(before);
    expect(await readdir(dirname(selected.copy.databasePath))).toEqual(["node.db", "venue.db"]);
  } finally {
    await selected.copy.discard();
  }
});

it("the proof preview's folder holds the backup's node copy, not an empty node.db", async () => {
  const marker = join(scratch, "marker-node.db");
  const source = new DatabaseSync(marker);
  source.exec("create table backup_marker (v text); insert into backup_marker values ('backup')");
  source.close();
  artifact = encryptArtifact(
    packArchive([
      ...entries.filter((entry) => entry.name !== "node.dump"),
      { name: "node.dump", bytes: await readFile(marker) },
      { name: "db.dump", bytes: await readFile(database) },
    ]),
    "archive-key",
  );
  const selected = await adapter.openFirstSetupBackupSource(archive(), deps());
  try {
    proofNodeRows.seen = [];
    proofNodeRows.recording = true;
    await adapter.authenticatedFirstSetupBackupPreview(
      selected,
      {
        module: "core",
        action: "restore",
        eventId: "repair-proof",
        targetNodeId: NODE,
        sourceId: selected.copy.sourceId!,
      },
      key.secret,
      deps(),
    );
    expect(proofNodeRows.seen).toEqual([["backup"]]);
  } finally {
    await selected.copy.discard();
  }
});

it.each(["", "wrong-node-key"])(
  "does not return a preview for invalid selected-backup proof %j",
  async (secret) => {
    const selected = await adapter.openFirstSetupBackupSource(archive(), deps());
    try {
      await expect(
        adapter.authenticatedFirstSetupBackupPreview(
          selected,
          {
            module: "core",
            action: "restore",
            eventId: "repair-proof",
            targetNodeId: NODE,
            sourceId: selected.copy.sourceId!,
          },
          secret,
          deps(),
        ),
      ).rejects.toMatchObject({ code: "promotion.break_glass_invalid", params: {} });
      expect(await readdir(dirname(selected.copy.databasePath))).toEqual(["node.db", "venue.db"]);
    } finally {
      await selected.copy.discard();
    }
  },
);

it("does not accept an archive encryption key as the selected node's proof", async () => {
  const selected = await adapter.openFirstSetupBackupSource(archive(), deps());
  try {
    await expect(
      adapter.authenticatedFirstSetupBackupPreview(
        selected,
        {
          module: "core",
          action: "restore",
          eventId: "repair-proof",
          targetNodeId: NODE,
          sourceId: selected.copy.sourceId!,
        },
        "archive-key",
        deps(),
      ),
    ).rejects.toMatchObject({ code: "promotion.break_glass_invalid" });
  } finally {
    await selected.copy.discard();
  }
});

it("does not disclose a private preview when the selected database's node key has no name", async () => {
  const { setBreakGlassVerifierTx, readBreakGlassVerifier, withTransaction } =
    await import("@waitron/db");
  const verifier = await readBreakGlassVerifier(suite.db, NODE);
  await withTransaction(suite.db, (tx) => setBreakGlassVerifierTx(tx, NODE, verifier!, null));
  await suite.db.archiveTo(database);
  const bytes = encryptArtifact(
    packArchive([...entries, { name: "db.dump", bytes: await readFile(database) }]),
    "archive-key",
  );
  const selected = await adapter.openFirstSetupBackupSource(
    { ...archive(), artifact: bytes },
    deps(),
  );
  try {
    await expect(
      adapter.authenticatedFirstSetupBackupPreview(
        selected,
        {
          module: "core",
          action: "restore",
          eventId: "repair-proof",
          targetNodeId: NODE,
          sourceId: selected.copy.sourceId!,
        },
        key.secret,
        deps(),
      ),
    ).rejects.toMatchObject({ code: "promotion.break_glass_invalid" });
  } finally {
    await selected.copy.discard();
  }
});

it("passes only the selected copy's original node identity across asynchronous proof", async () => {
  const other = "d0000000-0000-4000-8000-000000000003";
  await suite.db.insert(nodes).values({ id: other, locationId: LOCATION, name: "Another node" });
  await mintBreakGlassKey(suite.db, other);
  await suite.db.archiveTo(database);
  const bytes = encryptArtifact(
    packArchive([...entries, { name: "db.dump", bytes: await readFile(database) }]),
    "archive-key",
  );
  const selected = await adapter.openFirstSetupBackupSource(
    { ...archive(), artifact: bytes },
    deps(),
  );
  const env = selected.copy.secretEntries.find((entry) => entry.name === "secrets/trading.env")!;
  const pending = adapter.authenticatedFirstSetupBackupPreview(
    selected,
    {
      module: "core",
      action: "restore",
      eventId: "repair-proof",
      targetNodeId: NODE,
      sourceId: selected.copy.sourceId!,
    },
    key.secret,
    deps(),
  );
  env.bytes.set(Buffer.from(`WAITRON_NODE_ID=${other}\n`));
  try {
    expect((await pending).nodeId).toBe(NODE);
  } finally {
    await selected.copy.discard();
  }
});

it("keeps the real bucket liveness refusal unless the old-box confirmation is supplied", async () => {
  const b = await bucket();
  b.options.bucket.now = () => new Date();
  await b.store.put(
    `${generationPrefix(LOCATION, b.generation)}ltx/0/0000000000000001.ltx`,
    new Uint8Array([1]),
  );
  const source = {
    kind: "bucket" as const,
    kit: encodeRecoveryKit(b.kit),
    environment: "preproduction" as const,
  };
  await expect(adapter.openFirstSetupBackupSource(source, b.options)).rejects.toMatchObject({
    code: "restore.stream_source_live",
  });
  const selected = await adapter.openFirstSetupBackupSource(source, b.options, {
    oldBoxGone: true,
  });
  try {
    const before = await readFile(selected.copy.databasePath);
    const preview = await adapter.authenticatedFirstSetupBackupPreview(
      selected,
      {
        module: "core",
        action: "restore",
        eventId: "repair-proof",
        targetNodeId: NODE,
        sourceId: selected.copy.sourceId!,
      },
      key.secret,
      deps(),
    );
    expect(preview.sourceId).toBe(`stream:${LOCATION}:${b.generation}`);
    expect(preview.activationSourceId).toBe(selected.copy.sourceId);
    expect(preview.nodeRecoveryKeyName).toBe(key.name);
    expect(await readFile(selected.copy.databasePath)).toEqual(before);
  } finally {
    await selected.copy.discard();
  }
});

it.each([
  { sourceId: "another-archive-digest" },
  { targetNodeId: "d0000000-0000-4000-8000-000000000003" },
  { action: "promote" as const },
])("refuses a proof binding that does not name this restore: %j", async (changed) => {
  const selected = await adapter.openFirstSetupBackupSource(archive(), deps());
  try {
    await expect(
      adapter.authenticatedFirstSetupBackupPreview(
        selected,
        {
          module: "core",
          action: "restore",
          eventId: "repair-proof",
          targetNodeId: NODE,
          sourceId: selected.copy.sourceId!,
          ...changed,
        },
        key.secret,
        deps(),
      ),
    ).rejects.toMatchObject({ code: "promotion.break_glass_invalid", params: {} });
    expect(await readdir(dirname(selected.copy.databasePath))).toEqual(["node.db", "venue.db"]);
  } finally {
    await selected.copy.discard();
  }
});

it("cleans the private proof copy when selected backup evidence cannot be parsed", async () => {
  const selected = await adapter.openFirstSetupBackupSource(archive(), deps());
  const badModule = {
    ...modules[0]!,
    backup: {
      nonDbState: [
        {
          kind: "preparation-history" as const,
          source: "test-history",
          project() {
            throw new Error("invalid history");
          },
        },
      ],
    },
  };
  const corrupt = {
    ...selected,
    copy: {
      ...selected.copy,
      secretEntries: [
        ...selected.copy.secretEntries,
        { name: "secrets/module-evidence/core/test-history.json", bytes: Buffer.from("{}") },
      ],
    },
  };
  try {
    await expect(
      adapter.authenticatedFirstSetupBackupPreview(
        corrupt,
        {
          module: "core",
          action: "restore",
          eventId: "repair-proof",
          targetNodeId: NODE,
          sourceId: selected.copy.sourceId!,
        },
        key.secret,
        { ...deps(), modules: [badModule] },
      ),
    ).rejects.toThrow("invalid history");
    expect(await readdir(dirname(selected.copy.databasePath))).toEqual(["node.db", "venue.db"]);
  } finally {
    await selected.copy.discard();
  }
});
