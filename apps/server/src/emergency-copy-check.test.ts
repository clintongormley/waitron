import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { sql } from "drizzle-orm";
import { afterEach, beforeEach, expect, it } from "vitest";
import {
  CORE_MIGRATIONS,
  deployment,
  nodes,
  saveVenueFields,
  withTransaction,
  writeNodeMembership,
} from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { seedVenue } from "@waitron/db/testing/seed.js";
import { generateNodeKeyPair, signDocumentBody } from "@waitron/membership";
import { fakeSetlessModule } from "@waitron/module/src/testing/fake-module.js";
import { generationName } from "@waitron/stream";
import type { EmergencyCopyBinding } from "./emergency-copy-binding.js";
import { checkEmergencyCopy } from "./emergency-copy-check.js";

const suite = useVenueDb({ migrations: [CORE_MIGRATIONS] });
const source = generateNodeKeyPair();
const sourceId = "e7000000-0000-4000-8000-000000000001";
const copyId = "e7000000-0000-4000-8000-000000000002";
const venueId = "e7000000-0000-4000-8000-000000000003";
const streamId = "e7000000-0000-4000-8000-000000000004";
let root: string;
let venuePath: string;

const chartBody = (primary: string) => ({
  term: 1,
  nodes: [{ nodeId: primary, standing: "serving-primary" as const, contactUrl: "" }],
});

async function writeChart(primary: string) {
  await writeNodeMembership(suite.db, {
    body: chartBody(primary),
    signerNodeId: sourceId,
    signature: signDocumentBody(chartBody(primary), source.privateKey),
    endorsements: [],
  });
}

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "emergency-copy-check-"));
  venuePath = join(root, "venue.db");
  await seedVenue(suite.db, { invoiceLocales: ["en"] });
  await suite.db.insert(deployment).values({ id: 1, environment: "preproduction" });
  await withTransaction(suite.db, (tx) =>
    saveVenueFields(tx, { cloudVenueId: venueId, streamId }, null),
  );
  await suite.db.insert(nodes).values({ id: sourceId, name: "Main", publicKey: source.publicKey });
  await writeChart(sourceId);
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

async function place(): Promise<string> {
  await suite.db.archiveTo(venuePath);
  return sha256(venuePath);
}

async function sha256(path: string): Promise<string> {
  return createHash("sha256")
    .update(await readFile(path))
    .digest("hex");
}

function bindingFor(
  databaseSha256: string,
  overrides: Partial<EmergencyCopyBinding> = {},
  stream: Partial<EmergencyCopyBinding["selectedStream"]> = {},
): EmergencyCopyBinding {
  return {
    copyOperationId: "e7000000-0000-4000-8000-000000000009",
    venueId,
    environment: "preproduction",
    sourceNodeId: sourceId,
    sourceInstallationId: "source-installation",
    copyNodeId: copyId,
    installationId: "copy-installation",
    selectedStream: {
      streamId,
      generation: generationName(3, sourceId, new Date("2026-11-17T10:00:00Z")),
      databaseSha256,
      ...stream,
    },
    startedAt: "2026-11-17T10:00:00.000Z",
    expiresAt: "2026-11-17T10:30:00.000Z",
    ...overrides,
  };
}

function check(
  binding: EmergencyCopyBinding,
  extra: Partial<Parameters<typeof checkEmergencyCopy>[0]> = {},
) {
  return checkEmergencyCopy({
    binding,
    venuePath,
    environment: "preproduction",
    migrationsRoot: null,
    modules: [],
    ...extra,
  });
}

it("accepts a copy whose binding matches", async () => {
  const hash = await place();
  await expect(check(bindingFor(hash))).resolves.toBeUndefined();
  expect(await sha256(venuePath)).toBe(hash);
});

it("refuses a write-ahead log beside the copy, which the hash would not cover", async () => {
  const hash = await place();
  await writeFile(`${venuePath}-wal`, "");
  await expect(check(bindingFor(hash))).rejects.toMatchObject({
    code: "emergency_copy.wal_present",
  });
});

it("refuses a node.db already beside the copy, so the source's is never adopted", async () => {
  const hash = await place();
  await writeFile(join(root, "node.db"), "the source's node dump");
  await expect(check(bindingFor(hash))).rejects.toMatchObject({
    code: "emergency_copy.node_db_present",
  });
});

it("refuses a file whose hash is not the one Cloud chose", async () => {
  const hash = await place();
  const other = `${hash.slice(0, 63)}${hash.endsWith("0") ? "1" : "0"}`;
  await expect(check(bindingFor(other))).rejects.toMatchObject({
    code: "emergency_copy.hash_mismatch",
  });
  expect(await sha256(venuePath)).toBe(hash);
});

it("refuses a file that fails the integrity check", async () => {
  await writeFile(venuePath, "damaged");
  await expect(check(bindingFor(await sha256(venuePath)))).rejects.toMatchObject({
    code: "emergency_copy.integrity_failed",
  });
});

it("refuses a copy made by newer software with the existing code", async () => {
  await suite.db.run(
    sql`insert into __drizzle_migrations_db (hash, created_at) values ('from-later', 1)`,
  );
  let hash: string;
  try {
    hash = await place();
  } finally {
    await suite.db.run(sql`delete from __drizzle_migrations_db where hash = 'from-later'`);
  }
  await expect(check(bindingFor(hash))).rejects.toMatchObject({
    code: "provisioning.database_ahead",
  });
});

it("refuses a copy stamped for another environment than the binding's", async () => {
  await suite.db.run(sql`update deployment set environment = 'production' where id = 1`);
  const hash = await place();
  await expect(check(bindingFor(hash))).rejects.toMatchObject({
    code: "emergency_copy.environment_mismatch",
    params: { copy: "production", binding: "preproduction", process: "preproduction" },
  });
});

it("refuses a copy stamped for no environment", async () => {
  await suite.db.delete(deployment);
  const hash = await place();
  await expect(check(bindingFor(hash))).rejects.toMatchObject({
    code: "emergency_copy.environment_mismatch",
    params: { copy: null },
  });
});

it("refuses a binding for another environment than this process's", async () => {
  const hash = await place();
  await expect(check(bindingFor(hash), { environment: "production" })).rejects.toMatchObject({
    code: "emergency_copy.environment_mismatch",
    params: { copy: "preproduction", binding: "preproduction", process: "production" },
  });
});

it("refuses a copy of another Cloud venue", async () => {
  const hash = await place();
  await expect(
    check(bindingFor(hash, { venueId: "e7000000-0000-4000-8000-0000000000ff" })),
  ).rejects.toMatchObject({ code: "emergency_copy.venue_mismatch" });
});

it("refuses a copy holding no venue settings", async () => {
  await suite.db.run(sql`delete from settings where module = 'venue'`);
  const hash = await place();
  await expect(check(bindingFor(hash))).rejects.toMatchObject({
    code: "emergency_copy.venue_mismatch",
  });
});

it("refuses a copy of another stream", async () => {
  const hash = await place();
  await expect(
    check(bindingFor(hash, {}, { streamId: "e7000000-0000-4000-8000-0000000000ff" })),
  ).rejects.toMatchObject({ code: "emergency_copy.stream_mismatch" });
});

it("refuses a generation another machine wrote", async () => {
  const hash = await place();
  const generation = generationName(3, copyId, new Date("2026-11-17T10:00:00Z"));
  await expect(check(bindingFor(hash, {}, { generation }))).rejects.toMatchObject({
    code: "emergency_copy.generation_mismatch",
  });
});

it("refuses a source the copy holds no machine row for", async () => {
  await suite.db.delete(nodes).where(sql`id = ${sourceId}`);
  const hash = await place();
  await expect(check(bindingFor(hash))).rejects.toMatchObject({
    code: "emergency_copy.source_not_primary",
  });
});

it("refuses a source the copy's chart does not name its main box", async () => {
  await suite.db.insert(nodes).values({
    id: "e7000000-0000-4000-8000-000000000005",
    name: "Other",
    publicKey: generateNodeKeyPair().publicKey,
  });
  await writeChart("e7000000-0000-4000-8000-000000000005");
  const hash = await place();
  await expect(check(bindingFor(hash))).rejects.toMatchObject({
    code: "emergency_copy.source_not_primary",
  });
});

it("refuses a copy holding no chart", async () => {
  await suite.db.run(sql`delete from node_membership`);
  const hash = await place();
  await expect(check(bindingFor(hash))).rejects.toMatchObject({
    code: "emergency_copy.source_not_primary",
  });
});

it("refuses a copy whose chart cannot be read", async () => {
  await suite.db.run(sql`update node_membership set document = 'null' where id = 1`);
  const hash = await place();
  await expect(check(bindingFor(hash))).rejects.toMatchObject({
    code: "emergency_copy.source_not_primary",
  });
});

it("refuses a copy that already knows the new machine", async () => {
  await suite.db
    .insert(nodes)
    .values({ id: copyId, name: "Copy", publicKey: generateNodeKeyPair().publicKey });
  const hash = await place();
  await expect(check(bindingFor(hash))).rejects.toMatchObject({
    code: "emergency_copy.copy_node_known",
  });
});

it("refuses a module's broken chain, naming the module", async () => {
  const hash = await place();
  const module = {
    ...fakeSetlessModule("test-chain", "core"),
    handover: { summarise: async () => null, checkCopy: async () => "broken" as const },
  };
  await expect(check(bindingFor(hash), { modules: [module] })).rejects.toMatchObject({
    code: "emergency_copy.chain_broken",
    params: { module: "test-chain" },
  });
  expect(await sha256(venuePath)).toBe(hash);
});

it("keeps today's code for a chain check that fails to run", async () => {
  const hash = await place();
  const module = {
    ...fakeSetlessModule("test-chain", "core"),
    handover: {
      summarise: async () => null,
      checkCopy: async (): Promise<"ok"> => {
        throw new Error("unreadable");
      },
    },
  };
  await expect(check(bindingFor(hash), { modules: [module] })).rejects.toMatchObject({
    code: "handover.copy_check_failed",
  });
});
