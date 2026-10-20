import { createHash } from "node:crypto";
import { copyFile, mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it } from "vitest";
import { locations, nodes, stampDeployment, tenants } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { generateNodeKeyPair } from "@waitron/membership";
import { signPointer, writePointer } from "@waitron/stream";
import { createMemoryObjectStore } from "@waitron/stream/testing/memory-store.js";
import { ALL_MODULES } from "./modules.js";
import { buildManifest } from "./backup-manifest.js";
import { packArchive } from "./backup-archive.js";
import { encryptArtifact } from "./artifact-cipher.js";
import { previewRecoveryArchive, previewRecoveryStream } from "./recovery-backup-preview.js";
import { mintBreakGlassSecret } from "./break-glass.js";
import { sealNodeState, writeSealedStateRow } from "./sealed-state.js";
import { createCloudRecoveryClient } from "./cloud-recovery.js";
import { eq } from "drizzle-orm";

const moduleNames = ["core", "fiscal-verifactu", "fiscal-none"];
const modules = ALL_MODULES.filter((module) => moduleNames.includes(module.name));
const suite = useVenueDb({
  migrations: migrationOptionsFor(
    manifestSets().filter((set) => moduleNames.includes(set.name)),
    null,
  ),
});
const NODE = "d0000000-0000-4000-8000-000000000001";
const LOCATION = "d0000000-0000-4000-8000-000000000002";
const POINT = "047bacd4-df70-4881-a835-c6dd75ae7ecf";
const createdAt = "2026-10-16T11:40:00.000Z";
const archiveKey = "separate-archive-password";
let scratch: string;

beforeEach(async () => {
  scratch = await mkdtemp(join(tmpdir(), "hour-recovery-"));
  await stampDeployment(suite.db, "preproduction");
  await suite.db
    .insert(tenants)
    .values({ id: 1, country: "ES", taxId: "89890001K", legalName: "Selected business" });
  await suite.db.insert(locations).values({
    id: LOCATION,
    name: "Selected venue",
    invoiceLocales: ["es"],
    operationDescription: "Restaurant",
    fiscalTerritory: "ES-common",
    timeZone: "Europe/Madrid",
  });
  await suite.db.insert(nodes).values({ id: NODE, locationId: LOCATION, name: "Selected box" });
  await mintBreakGlassSecret(suite.db, NODE);
});
afterEach(async () => {
  if (scratch) await rm(scratch, { recursive: true, force: true });
});

async function archive(
  config: unknown = { modules: { "fiscal-verifactu": true, "fiscal-none": false } },
) {
  const manifest = await buildManifest({
    db: suite.db,
    modules,
    environment: "preproduction",
    now: new Date(createdAt),
  });
  const entries = [
    { name: "manifest.json", bytes: Buffer.from(JSON.stringify(manifest)) },
    {
      name: "secrets/trading.env",
      bytes: Buffer.from(`WAITRON_TILL_NODE_ID=${NODE}\nWAITRON_TILL_LOCATION_ID=${LOCATION}\n`),
    },
    { name: "secrets/node-key.enc", bytes: Buffer.from("sealed") },
    { name: "secrets/cluster-id", bytes: Buffer.from("cluster") },
    { name: "secrets/credentials.key", bytes: Buffer.from(Buffer.alloc(32, 7).toString("base64")) },
    ...(config === null
      ? []
      : [{ name: "secrets/modules.json", bytes: Buffer.from(JSON.stringify(config)) }]),
  ];
  const database = join(scratch, "selected.db");
  await suite.db.archiveTo(database);
  const artifact = encryptArtifact(
    packArchive([...entries, { name: "db.dump", bytes: await readFile(database) }]),
    archiveKey,
  );
  return { manifest, entries, database, artifact };
}
const expectedSelection = {
  country: "ES",
  fiscalTerritory: "ES-common",
  timeZone: "Europe/Madrid",
  module: "fiscal-verifactu",
};
function deps(artifact: Uint8Array) {
  return {
    artifact,
    recoveryKey: archiveKey,
    stateDir: scratch,
    stagingDir: scratch,
    modules,
    migrationsRoot: null,
    environment: "preproduction" as const,
  };
}

it("binds archive preview to its validated snapshot when the caller changes the request buffer", async () => {
  const f = await archive();
  const expected = createHash("sha256").update(f.artifact).digest("hex");
  const reading = previewRecoveryArchive(deps(f.artifact));
  f.artifact.fill(0);
  expect((await reading).sourceId).toBe(expected);
});

it("derives archive recovery geography and filing selection from the selected database and module evidence", async () => {
  const f = await archive();
  const original = await readFile(f.database);
  const preview = await previewRecoveryArchive(deps(f.artifact));
  expect(preview).toHaveProperty("fiscalSelection", expectedSelection);
  expect(preview.sourceId).toBe(createHash("sha256").update(f.artifact).digest("hex"));
  expect(await readFile(f.database)).toEqual(original);
  expect(await readdir(scratch)).toEqual(["selected.db"]);
});

it("derives the bucket selection from the sealed point rather than the replacement box", async () => {
  const f = await archive();
  await writeSealedStateRow(
    suite.db,
    NODE,
    await sealNodeState(f.entries, "bucket-password"),
    new Date(createdAt),
  );
  await suite.db.archiveTo(f.database);
  const signer = generateNodeKeyPair();
  const store = createMemoryObjectStore();
  const generation = `gen-0-${NODE}-20261016T114000Z`;
  await writePointer(
    store,
    LOCATION,
    signPointer(
      { venueId: LOCATION, term: 0, nodeId: NODE, generation, writtenAt: createdAt },
      signer.privateKey,
    ),
    null,
  );
  const preview = await previewRecoveryStream({
    ...deps(f.artifact),
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
      recoveryKey: "bucket-password",
      pointerSignerPublicKey: signer.publicKey,
    },
    litestreamBin: "/unused",
    oldBoxGone: true,
    now: () => new Date("2026-10-17T12:00:00Z"),
    log: () => {},
    openStore: () => store,
    restoreGeneration: async ({ outPath }) => {
      await copyFile(f.database, outPath);
    },
  });
  expect(preview).toHaveProperty("fiscalSelection", expectedSelection);
  expect(preview.sourceId).toBe(`stream:${LOCATION}:${generation}`);
  expect(preview.activationSourceId).toMatch(/^stream-sha256:[0-9a-f]{64}$/);
});

it.each([
  ["missing configuration", null],
  ["both filing modules enabled", { modules: {} }],
  ["wrong filing module", { modules: { "fiscal-verifactu": false, "fiscal-none": true } }],
  ["no filing module", { modules: { "fiscal-verifactu": false, "fiscal-none": false } }],
  ["unknown filing module", { modules: { "unknown-filing": true } }],
  ["malformed configuration", { modules: { "fiscal-verifactu": "true" } }],
] as const)("grants no filing selection for %s in the selected archive", async (_name, config) => {
  const f = await archive(config);
  const preview = await previewRecoveryArchive(deps(f.artifact));
  expect(preview.fiscalSelection).toBeUndefined();
  expect(preview.taxpayer.taxId).toBe("89890001K");
});

it.each([
  ["foreign country", "GB", "ES-common", "Europe/Madrid"],
  ["unknown country", "XX", "ES-common", "Europe/Madrid"],
  ["unknown territory", "ES", "ES-unknown", "Europe/Madrid"],
  ["unsupported territory", "ES", "ES-canary", "Atlantic/Canary"],
  ["unreadable zone", "ES", "ES-common", "Invalid/Zone"],
] as const)(
  "grants no filing selection for %s",
  async (_name, country, fiscalTerritory, timeZone) => {
    await suite.db.update(tenants).set({ country });
    await suite.db
      .update(locations)
      .set({ fiscalTerritory, timeZone })
      .where(eq(locations.id, LOCATION));
    const f = await archive();
    expect((await previewRecoveryArchive(deps(f.artifact))).fiscalSelection).toBeUndefined();
  },
);

it("uses the recorded non-filing module for a supported non-fiscal territory", async () => {
  await suite.db.update(tenants).set({ country: "GB" });
  await suite.db.update(locations).set({ fiscalTerritory: "GB-vat", timeZone: "Europe/London" });
  const f = await archive({ modules: { "fiscal-verifactu": false, "fiscal-none": true } });
  expect((await previewRecoveryArchive(deps(f.artifact))).fiscalSelection).toEqual({
    country: "GB",
    fiscalTerritory: "GB-vat",
    timeZone: "Europe/London",
    module: "fiscal-none",
  });
});

it("does not infer recorded filing authority from migrations applied only while previewing", async () => {
  const f = await archive();
  const artifact = encryptArtifact(
    packArchive([
      ...f.entries.filter((entry) => entry.name !== "manifest.json"),
      {
        name: "manifest.json",
        bytes: Buffer.from(
          JSON.stringify({
            ...f.manifest,
            modules: { ...f.manifest.modules, "fiscal-verifactu": 0 },
          }),
        ),
      },
      { name: "db.dump", bytes: await readFile(f.database) },
    ]),
    archiveKey,
  );
  expect((await previewRecoveryArchive(deps(artifact))).fiscalSelection).toBeUndefined();
});

it("derives managed Cloud selection only after the exact approved point is downloaded and validated", async () => {
  const f = await archive();
  const deadline = new Date(Date.now() + 3600000).toISOString();
  const point = {
    id: POINT,
    venueId: LOCATION,
    capturedAt: createdAt,
    modules: f.manifest.modules,
    digest: createHash("sha256").update(f.artifact).digest("hex"),
    size: f.artifact.length,
    objectKey: `snapshots/${POINT}`,
    verification: "verified",
    kind: "snapshot",
    deleting: false,
    deletedAt: null,
  };
  const client = createCloudRecoveryClient({
    stateDir: join(scratch, "cloud"),
    origin: "https://cloud.example.test",
    environment: "preproduction",
    download: async () => f.artifact,
    fetch: (async (url, init) => {
      const action = new URL(String(url)).pathname.split("/").at(-1);
      const body = JSON.parse(String(init?.body)) as { payload: string };
      const requestId = JSON.parse(Buffer.from(body.payload, "base64url").toString())[2] as string;
      if (action === "start" || action === "status")
        return Response.json({
          requestId,
          state: action === "start" ? "awaiting_owner" : "approved",
          expiresAt: deadline,
          operationId: action === "start" ? null : requestId,
        });
      if (action === "info") return Response.json({ point, operationExpiresAt: deadline });
      if (action === "read")
        return Response.json({
          point,
          operationExpiresAt: deadline,
          expiresAt: deadline,
          recoveryKey: archiveKey,
          location: { endpoint: "https://store.example.test", bucket: "backup", region: "local" },
          credentials: {
            accessKeyId: "access",
            secretAccessKey: "secret",
            sessionToken: "session",
          },
        });
      throw new Error(String(action));
    }) as typeof fetch,
  });
  await client.start();
  const preview = await client.preview(
    (request) =>
      previewRecoveryArchive({ ...deps(request.artifact), recoveryKey: request.recoveryKey }),
    POINT,
  );
  expect(preview).toHaveProperty("fiscalSelection", expectedSelection);
  expect(preview.sourceId).toBe(point.digest);
  await expect(
    client.preview((request) => previewRecoveryArchive(deps(request.artifact)), LOCATION),
  ).rejects.toThrow("Cloud recovery is unavailable");
});

const hourEvidenceName = "secrets/module-evidence/fiscal-verifactu/hour-history.json";
const publicHourEvidence = {
  reference: "prepared-hours",
  complete: true,
  records: [
    {
      reference: "intent/fiscal-verifactu/abandoned",
      kind: "intent",
      taxpayerNif: "89890001K",
      environment: "preproduction",
      softwareId: "another-software",
      nodeId: NODE,
      identity: "06RC",
      recordedAtMs: 1792152060000,
    },
  ],
};
async function hourEvidenceArchive(value: unknown = publicHourEvidence) {
  const f = await archive();
  const entries = [
    ...f.entries,
    { name: hourEvidenceName, bytes: Buffer.from(JSON.stringify(value)) },
  ];
  const artifact = encryptArtifact(
    packArchive([...entries, { name: "db.dump", bytes: await readFile(f.database) }]),
    archiveKey,
  );
  return { ...f, entries, artifact };
}
it("binds public spent-hour evidence to the validated archive without exposing setup material", async () => {
  const f = await hourEvidenceArchive();
  const preview = await previewRecoveryArchive(deps(f.artifact));
  expect(preview).toHaveProperty("moduleEvidence", {
    "fiscal-verifactu": { "hour-history": publicHourEvidence },
  });
  expect(preview.sourceId).toBe(createHash("sha256").update(f.artifact).digest("hex"));
});
it("refuses corrupt public hour history in the selected copy rather than lowering its floor", async () => {
  const f = await hourEvidenceArchive({
    ...publicHourEvidence,
    records: [{ ...publicHourEvidence.records[0], identity: "bad!" }],
  });
  await expect(previewRecoveryArchive(deps(f.artifact))).rejects.toMatchObject({
    code: "sif.allocation_invalid",
    params: { reason: "history_invalid" },
  });
});
it("reads public hour evidence from the exact sealed bucket point", async () => {
  const f = await hourEvidenceArchive();
  await writeSealedStateRow(
    suite.db,
    NODE,
    await sealNodeState(f.entries, "bucket-password"),
    new Date(createdAt),
  );
  await suite.db.archiveTo(f.database);
  const signer = generateNodeKeyPair(),
    store = createMemoryObjectStore();
  const generation = `gen-0-${NODE}-20261016T114000Z`;
  await writePointer(
    store,
    LOCATION,
    signPointer(
      { venueId: LOCATION, term: 0, nodeId: NODE, generation, writtenAt: createdAt },
      signer.privateKey,
    ),
    null,
  );
  const preview = await previewRecoveryStream({
    ...deps(f.artifact),
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
      recoveryKey: "bucket-password",
      pointerSignerPublicKey: signer.publicKey,
    },
    litestreamBin: "/unused",
    oldBoxGone: true,
    now: () => new Date("2026-10-17T12:00:00Z"),
    log: () => {},
    openStore: () => store,
    restoreGeneration: async ({ outPath }) => {
      await copyFile(f.database, outPath);
    },
  });
  expect(preview).toHaveProperty("moduleEvidence", {
    "fiscal-verifactu": { "hour-history": publicHourEvidence },
  });
  expect(preview.activationSourceId).toMatch(/^stream-sha256:[0-9a-f]{64}$/);
});
it("reads public hour evidence only from the approved managed-Cloud artifact", async () => {
  const f = await hourEvidenceArchive();
  const deadline = new Date(Date.now() + 3600000).toISOString();
  const point = {
    id: POINT,
    venueId: LOCATION,
    capturedAt: createdAt,
    modules: f.manifest.modules,
    digest: createHash("sha256").update(f.artifact).digest("hex"),
    size: f.artifact.length,
    objectKey: `snapshots/${POINT}`,
    verification: "verified",
    kind: "snapshot",
    deleting: false,
    deletedAt: null,
  };
  const client = createCloudRecoveryClient({
    stateDir: join(scratch, "cloud-evidence"),
    origin: "https://cloud.example.test",
    environment: "preproduction",
    download: async () => f.artifact,
    fetch: (async (url, init) => {
      const action = new URL(String(url)).pathname.split("/").at(-1);
      const body = JSON.parse(String(init?.body)) as { payload: string };
      const requestId = JSON.parse(Buffer.from(body.payload, "base64url").toString())[2] as string;
      if (action === "start" || action === "status")
        return Response.json({
          requestId,
          state: action === "start" ? "awaiting_owner" : "approved",
          expiresAt: deadline,
          operationId: action === "start" ? null : requestId,
        });
      if (action === "info") return Response.json({ point, operationExpiresAt: deadline });
      if (action === "read")
        return Response.json({
          point,
          operationExpiresAt: deadline,
          expiresAt: deadline,
          recoveryKey: archiveKey,
          location: { endpoint: "https://store.example.test", bucket: "backup", region: "local" },
          credentials: {
            accessKeyId: "access",
            secretAccessKey: "secret",
            sessionToken: "session",
          },
        });
      throw new Error(String(action));
    }) as typeof fetch,
  });
  await client.start();
  const preview = await client.preview(
    (request) =>
      previewRecoveryArchive({ ...deps(request.artifact), recoveryKey: request.recoveryKey }),
    POINT,
  );
  expect(preview).toHaveProperty("moduleEvidence", {
    "fiscal-verifactu": { "hour-history": publicHourEvidence },
  });
  expect(preview.sourceId).toBe(point.digest);
});
