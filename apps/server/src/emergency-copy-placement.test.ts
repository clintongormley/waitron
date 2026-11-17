import { existsSync, readFileSync } from "node:fs";
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, expect, it } from "vitest";
import {
  loadKeyRing,
  nodeSigningPublicKey,
  openNodeSigningKeyRow,
  readNodeSigningKey,
} from "@waitron/credentials";
import { CORE_MIGRATIONS, type NodeDatabase } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { box, NODE_MIGRATIONS, nodeHandoverEvents, readNodeMode } from "@waitron/node-db";
import { fakeSetlessModule } from "@waitron/module/src/testing/fake-module.js";
import { generateKeyRing, openImmutable } from "@waitron/provisioning";
import { connectionPair, drizzleNodeSqlite } from "@waitron/store";
import type { EmergencyCopyBinding } from "./emergency-copy-binding.js";
import { readPlacedEmergencyCopy } from "./emergency-copy-check.js";
import { placeEmergencyCopy } from "./emergency-copy-placement.js";
import { parseEnvFile } from "./env-file.js";
import {
  bindingFor,
  copyId,
  seedEmergencyCopySource,
  source,
  sourceId,
} from "./testing/emergency-copy-source.js";
import { sha } from "./testing/place-copy-box.js";

const suite = useVenueDb({ migrations: [CORE_MIGRATIONS, NODE_MIGRATIONS] });
let root: string;
let venuePath: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "emergency-copy-placement-"));
  venuePath = join(root, "venue.db");
  await seedEmergencyCopySource(suite.db);
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

async function placedBinding(): Promise<EmergencyCopyBinding> {
  await suite.db.archiveTo(venuePath);
  return bindingFor(sha(venuePath));
}

/** Immutable, so the probe sees only what reached node.db itself, never a `-wal` beside it. */
async function readPlacedNode<T>(read: (node: NodeDatabase) => Promise<T>): Promise<T> {
  const connection = openImmutable(join(root, "node.db"));
  try {
    return await read(
      drizzleNodeSqlite(connectionPair(connection, connection), {
        schema: {},
      }) as unknown as NodeDatabase,
    );
  } finally {
    connection.close();
  }
}

const writtenRing = () =>
  loadKeyRing(parseEnvFile(readFileSync(join(root, "secrets.env"), "utf8")));

const beforeExpiry = () => new Date("2026-11-17T10:10:00.000Z");

function place(
  binding: EmergencyCopyBinding,
  processEnv: NodeJS.ProcessEnv = {},
  extra: Partial<Parameters<typeof placeEmergencyCopy>[0]> = {},
) {
  return placeEmergencyCopy({
    binding,
    venueDir: root,
    stateDir: root,
    environment: "preproduction",
    processEnv,
    migrationsRoot: null,
    modules: [],
    now: beforeExpiry,
    ...extra,
  });
}

it("a placed copy has its own key and the venue file is byte for byte the one Cloud chose", async () => {
  const binding = await placedBinding();
  await place(binding);
  expect(sha(venuePath)).toBe(binding.selectedStream.databaseSha256);
  const key = await readPlacedNode((node) => readNodeSigningKey(node, writtenRing(), copyId));
  expect(key).toEqual(expect.any(String));
});

it("seals the key so it opens only under the copy's id and on the copy's own ring", async () => {
  await place(await placedBinding());
  const ring = writtenRing();
  const [row] = await readPlacedNode((node) =>
    node
      .select({
        ciphertext: box.signingKeyCiphertext,
        iv: box.signingKeyIv,
        authTag: box.signingKeyAuthTag,
        keyVersion: box.signingKeyVersion,
      })
      .from(box)
      .where(eq(box.nodeId, copyId)),
  );
  const sealed = {
    ciphertext: row!.ciphertext!,
    iv: row!.iv!,
    authTag: row!.authTag!,
    keyVersion: row!.keyVersion!,
  };
  const key = openNodeSigningKeyRow(sealed, ring, copyId);
  expect(nodeSigningPublicKey(key)).not.toBe(source.publicKey);
  expect(() => openNodeSigningKeyRow(sealed, ring, sourceId)).toThrow(
    expect.objectContaining({ code: "credentials.decrypt_failed" }),
  );
  const otherRing = generateKeyRing();
  expect(() =>
    openNodeSigningKeyRow(
      sealed,
      loadKeyRing({
        WAITRON_CREDENTIALS_KEY: otherRing.key,
        WAITRON_CREDENTIALS_KEY_VERSION: String(otherRing.version),
      }),
      copyId,
    ),
  ).toThrow(expect.objectContaining({ code: "credentials.decrypt_failed" }));
});

it("holds no row for the source box", async () => {
  await place(await placedBinding());
  const boxes = await readPlacedNode((node) => node.select({ nodeId: box.nodeId }).from(box));
  const events = await readPlacedNode((node) =>
    node.select({ nodeId: nodeHandoverEvents.nodeId }).from(nodeHandoverEvents),
  );
  expect(boxes).toEqual([{ nodeId: copyId }]);
  expect(events.every((event) => event.nodeId === copyId)).toBe(true);
});

it("records the copy as a mirror, so no reader sees a box that sells", async () => {
  await place(await placedBinding());
  expect(await readPlacedNode((node) => readNodeMode(node, copyId))).toEqual({
    mode: "mirror",
    singletonRole: "secondary",
  });
});

it("names the copy in trading.env", async () => {
  const binding = await placedBinding();
  await place(binding);
  expect(parseEnvFile(await readFile(join(root, "trading.env"), "utf8"))).toMatchObject({
    WAITRON_NODE_ID: copyId,
    WAITRON_ENV: "preproduction",
  });
});

it("reads back the binding it recorded, with no operation id", async () => {
  const binding = await placedBinding();
  await place(binding);
  expect(await readPlacedNode((node) => readPlacedEmergencyCopy(node))).toEqual(binding);
  const [placed] = await readPlacedNode((node) =>
    node
      .select({ operationId: nodeHandoverEvents.operationId })
      .from(nodeHandoverEvents)
      .where(eq(nodeHandoverEvents.kind, "emergency_copy.placed")),
  );
  expect(placed).toEqual({ operationId: null });
});

it("reads null from a node.db holding no placed copy", async () => {
  expect(await readPlacedEmergencyCopy(suite.node)).toBeNull();
});

it("leaves nothing beside the venue file when the check refuses it", async () => {
  const binding = await placedBinding();
  await expect(place(bindingFor("0".repeat(64)))).rejects.toMatchObject({
    code: "emergency_copy.hash_mismatch",
  });
  expect((await readdir(root)).sort()).toEqual(["venue.db", "venue.lock"]);
  expect(sha(venuePath)).toBe(binding.selectedStream.databaseSha256);
});

it("leaves no node.db beside the venue file when a write before the move fails", async () => {
  const binding = await placedBinding();
  await mkdir(join(root, "secrets.env", "in-the-way"), { recursive: true });
  await expect(place(binding)).rejects.toThrow();
  expect(existsSync(join(root, "node.db"))).toBe(false);
  expect(await readdir(join(root, "scratch"))).toEqual([]);
  expect(sha(venuePath)).toBe(binding.selectedStream.databaseSha256);
});

it("refuses a trading.env naming another node, writing nothing", async () => {
  const binding = await placedBinding();
  const other = "WAITRON_NODE_ID=e7000000-0000-4000-8000-0000000000ff\n";
  await writeFile(join(root, "trading.env"), other);
  await expect(place(binding)).rejects.toMatchObject({
    code: "emergency_copy.trading_node_differs",
  });
  expect((await readdir(root)).sort()).toEqual(["trading.env", "venue.db", "venue.lock"]);
  expect(await readFile(join(root, "trading.env"), "utf8")).toBe(other);
});

it("keeps a trading.env that already names the copy as it is", async () => {
  const binding = await placedBinding();
  const own = `WAITRON_NODE_ID=${copyId}\nWAITRON_ACCOUNT_KEY=kept\n`;
  await writeFile(join(root, "trading.env"), own);
  await place(binding);
  expect(await readFile(join(root, "trading.env"), "utf8")).toBe(own);
  expect(existsSync(join(root, "node.db"))).toBe(true);
});

it("refuses when this process's environment sets the vault key, which would win over the copy's ring", async () => {
  const binding = await placedBinding();
  await expect(
    place(binding, { WAITRON_CREDENTIALS_KEY: generateKeyRing().key, WAITRON_ACCOUNT_KEY: "a" }),
  ).rejects.toMatchObject({
    code: "emergency_copy.vault_key_in_environment",
    params: { variables: ["WAITRON_CREDENTIALS_KEY"] },
  });
  expect((await readdir(root)).sort()).toEqual(["venue.db", "venue.lock"]);
});

const placedFiles = async () => ({
  secrets: await readFile(join(root, "secrets.env")),
  trading: await readFile(join(root, "trading.env")),
  node: await readFile(join(root, "node.db")),
});

it("a repeat with the same binding makes no new key and rewrites nothing", async () => {
  const binding = await placedBinding();
  await place(binding);
  const before = await placedFiles();
  const publicKey = async () => {
    const key = await readPlacedNode((node) => readNodeSigningKey(node, writtenRing(), copyId));
    expect(key).toEqual(expect.any(String));
    return nodeSigningPublicKey(key!);
  };
  const keyBefore = await publicKey();
  await expect(place(binding)).resolves.toBeUndefined();
  expect(await placedFiles()).toEqual(before);
  expect(await publicKey()).toBe(keyBefore);
  expect(sha(venuePath)).toBe(binding.selectedStream.databaseSha256);
});

it("refuses another binding once a copy is placed, writing nothing", async () => {
  const binding = await placedBinding();
  await place(binding);
  const before = await placedFiles();
  await expect(
    place({ ...binding, copyOperationId: "e7000000-0000-4000-8000-0000000000ee" }),
  ).rejects.toMatchObject({ code: "emergency_copy.other_binding_placed" });
  expect(await placedFiles()).toEqual(before);
});

/** A clock that reads `at` once the copy's chain check, the check's last step, has run. */
function clockMovedByTheCheck(at: string) {
  let time = beforeExpiry();
  const module = {
    ...fakeSetlessModule("test-chain", "core"),
    handover: {
      summarise: async () => null,
      checkCopy: async () => {
        time = new Date(at);
        return "ok" as const;
      },
    },
  };
  return { modules: [module], now: () => time };
}

it("refuses a binding that expires while the checks run, writing nothing", async () => {
  const binding = await placedBinding();
  await expect(place(binding, {}, clockMovedByTheCheck(binding.expiresAt))).rejects.toMatchObject({
    code: "emergency_copy.binding_expired",
    params: { expiresAt: binding.expiresAt },
  });
  expect((await readdir(root)).sort()).toEqual(["venue.db", "venue.lock"]);
});

it("places a binding the checks finish a moment before it expires", async () => {
  const binding = await placedBinding();
  await place(binding, {}, clockMovedByTheCheck("2026-11-17T10:29:59.999Z"));
  expect(existsSync(join(root, "node.db"))).toBe(true);
});
