import { createHash } from "node:crypto";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, beforeEach, expect, it } from "vitest";
import {
  CORE_MIGRATIONS,
  readBreakGlassKeyName,
  nodes,
  locations,
  tenants,
  stampDeployment,
} from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { fakeModule } from "@waitron/module/src/testing/fake-module.js";
import { encryptArtifact } from "./artifact-cipher.js";
import { packArchive } from "./backup-archive.js";
import { mintBreakGlassSecret } from "./break-glass.js";
import { previewRecoveryArchive } from "./recovery-backup-preview.js";

const suite = useVenueDb({ migrations: [CORE_MIGRATIONS] });
const NODE = "d0000000-0000-4000-8000-000000000001";
const LOCATION = "d0000000-0000-4000-8000-000000000002";
let scratch: string;
let artifact: Uint8Array;
let oldName: string | null;
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
  await mintBreakGlassSecret(suite.db, NODE);
  oldName = await readBreakGlassKeyName(suite.db, NODE);
  const database = join(scratch, "selected.db");
  await suite.db.archiveTo(database);
  artifact = encryptArtifact(
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
      {
        name: "secrets/trading.env",
        bytes: Buffer.from(`WAITRON_TILL_NODE_ID=${NODE}\nWAITRON_TILL_LOCATION_ID=${LOCATION}\n`),
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
});
afterEach(async () => {
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
  await mintBreakGlassSecret(suite.db, NODE);
  expect(await readBreakGlassKeyName(suite.db, NODE)).not.toBe(oldName);
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

it("refuses a wrong archive encryption key without treating it as the node credential", async () => {
  await expect(previewRecoveryArchive(args("wrong-node-key"))).rejects.toMatchObject({
    code: "recovery.passphrase_invalid",
  });
});
