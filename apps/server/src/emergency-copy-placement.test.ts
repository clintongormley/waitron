import { existsSync, readFileSync } from "node:fs";
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, expect, it } from "vitest";
import {
  KEY_RING_VARIABLES,
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
import { writeCredentialsRing } from "./box-secrets.js";
import { readPlacedEmergencyCopy } from "./emergency-copy-check.js";
import { placeEmergencyCopy } from "./emergency-copy-placement.js";
import { parseEnvFile } from "./env-file.js";
import { writeTradingEnv } from "./trading-config.js";
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
let venueDir: string;
let stateDir: string;
let venuePath: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "emergency-copy-placement-"));
  venueDir = join(root, "venue");
  stateDir = join(root, "state");
  await mkdir(venueDir);
  await mkdir(stateDir);
  venuePath = join(venueDir, "venue.db");
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
  const connection = openImmutable(join(venueDir, "node.db"));
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

const listing = async (dir: string) => (await readdir(dir)).sort();

/** `node.db` beside the venue file, the env files in the state folder, and no scratch left over. */
async function expectPlacedLayout() {
  expect(await listing(venueDir)).toEqual(["node.db", "venue.db", "venue.lock"]);
  expect(await listing(stateDir)).toEqual(["scratch", "secrets.env", "trading.env"]);
  expect(await readdir(join(stateDir, "scratch"))).toEqual([]);
}

const writtenRing = () =>
  loadKeyRing(parseEnvFile(readFileSync(join(stateDir, "secrets.env"), "utf8")));

const beforeExpiry = () => new Date("2026-11-17T10:10:00.000Z");

function place(
  binding: EmergencyCopyBinding,
  processEnv: NodeJS.ProcessEnv = {},
  extra: Partial<Parameters<typeof placeEmergencyCopy>[0]> = {},
) {
  return placeEmergencyCopy({
    binding,
    venueDir,
    stateDir,
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
  await expectPlacedLayout();
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
  expect(parseEnvFile(await readFile(join(stateDir, "trading.env"), "utf8"))).toMatchObject({
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
  expect(await listing(venueDir)).toEqual(["venue.db", "venue.lock"]);
  expect(await listing(stateDir)).toEqual([]);
  expect(sha(venuePath)).toBe(binding.selectedStream.databaseSha256);
});

it("leaves no node.db beside the venue file when a write before the move fails", async () => {
  const binding = await placedBinding();
  await mkdir(join(stateDir, "secrets.env", "in-the-way"), { recursive: true });
  await expect(place(binding)).rejects.toThrow();
  expect(existsSync(join(venueDir, "node.db"))).toBe(false);
  expect(await readdir(join(stateDir, "scratch"))).toEqual([]);
  expect(sha(venuePath)).toBe(binding.selectedStream.databaseSha256);
});

it("refuses a trading.env naming another node, writing nothing", async () => {
  const binding = await placedBinding();
  const other = "WAITRON_NODE_ID=e7000000-0000-4000-8000-0000000000ff\n";
  await writeFile(join(stateDir, "trading.env"), other);
  await expect(place(binding)).rejects.toMatchObject({
    code: "emergency_copy.trading_node_differs",
  });
  expect(await listing(venueDir)).toEqual(["venue.db", "venue.lock"]);
  expect(await listing(stateDir)).toEqual(["trading.env"]);
  expect(await readFile(join(stateDir, "trading.env"), "utf8")).toBe(other);
});

it("keeps a trading.env that already names the copy as it is", async () => {
  const binding = await placedBinding();
  const own = `WAITRON_NODE_ID=${copyId}\nWAITRON_ACCOUNT_KEY=kept\n`;
  await writeFile(join(stateDir, "trading.env"), own);
  await place(binding);
  expect(await readFile(join(stateDir, "trading.env"), "utf8")).toBe(own);
  expect(existsSync(join(venueDir, "node.db"))).toBe(true);
});

const keptTrading = (lines: string) => `WAITRON_NODE_ID=${copyId}\n${lines}`;

it.each(["WAITRON_ENV=production\n", "WAITRON_ENV=staging\n"])(
  "refuses a kept trading.env naming another environment (%j), writing nothing",
  async (line) => {
    const binding = await placedBinding();
    await writeFile(join(stateDir, "trading.env"), keptTrading(line));
    await expect(place(binding)).rejects.toMatchObject({
      code: "emergency_copy.trading_environment_differs",
    });
    expect(await listing(venueDir)).toEqual(["venue.db", "venue.lock"]);
    expect(await listing(stateDir)).toEqual(["trading.env"]);
    expect(await readFile(join(stateDir, "trading.env"), "utf8")).toBe(keptTrading(line));
  },
);

it.each(["WAITRON_ENV=preproduction\n", "WAITRON_ENV=\n", "WAITRON_ENV=dev\n"])(
  "keeps a trading.env whose environment (%j) is the binding's",
  async (line) => {
    const binding = await placedBinding();
    await writeFile(join(stateDir, "trading.env"), keptTrading(line));
    await place(binding);
    expect(await readFile(join(stateDir, "trading.env"), "utf8")).toBe(keptTrading(line));
    await expectPlacedLayout();
  },
);

it("reads a kept trading.env with no WAITRON_ENV as preproduction, so a production binding refuses it", async () => {
  const binding = { ...(await placedBinding()), environment: "production" as const };
  await writeFile(join(stateDir, "trading.env"), keptTrading(""));
  await expect(place(binding, {}, { environment: "production" })).rejects.toMatchObject({
    code: "emergency_copy.trading_environment_differs",
  });
  // Control: naming production, the same trading.env passes, and the check refuses the
  // preproduction venue file instead.
  await writeFile(join(stateDir, "trading.env"), keptTrading("WAITRON_ENV=production\n"));
  await expect(place(binding, {}, { environment: "production" })).rejects.toMatchObject({
    code: "emergency_copy.environment_mismatch",
  });
});

it.each([
  ...KEY_RING_VARIABLES.map((name) => [name, `${name}=1\n`] as const),
  ["WAITRON_CREDENTIALS_KEY", "WAITRON_CREDENTIALS_KEY=\n"] as const,
])(
  "refuses a kept trading.env setting %s, which the next start reads after secrets.env (%j)",
  async (name, line) => {
    const binding = await placedBinding();
    await writeFile(join(stateDir, "trading.env"), keptTrading(line));
    await expect(place(binding)).rejects.toMatchObject({
      code: "emergency_copy.vault_key_in_trading_env",
      params: { variables: [name] },
    });
    expect(await listing(venueDir)).toEqual(["venue.db", "venue.lock"]);
    expect(await listing(stateDir)).toEqual(["trading.env"]);
    expect(await readFile(join(stateDir, "trading.env"), "utf8")).toBe(keptTrading(line));
  },
);

it("refuses when this process's environment sets the vault key, which would win over the copy's ring", async () => {
  const binding = await placedBinding();
  await expect(
    place(binding, { WAITRON_CREDENTIALS_KEY: generateKeyRing().key, WAITRON_ACCOUNT_KEY: "a" }),
  ).rejects.toMatchObject({
    code: "emergency_copy.vault_key_in_environment",
    params: { variables: ["WAITRON_CREDENTIALS_KEY"] },
  });
  expect(await listing(venueDir)).toEqual(["venue.db", "venue.lock"]);
  expect(await listing(stateDir)).toEqual([]);
});

const placedFiles = async () => ({
  secrets: await readFile(join(stateDir, "secrets.env")),
  trading: await readFile(join(stateDir, "trading.env")),
  node: await readFile(join(venueDir, "node.db")),
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
  await expectPlacedLayout();
  expect(sha(venuePath)).toBe(binding.selectedStream.databaseSha256);
});

/** Every file in both folders, by name and bytes, and what the scratch folder holds. */
async function bothFolders() {
  const read = async (dir: string) =>
    Object.fromEntries(
      await Promise.all(
        (await listing(dir))
          .filter((name) => name !== "scratch")
          .map(async (name) => [name, await readFile(join(dir, name))] as const),
      ),
    );
  return {
    venue: await read(venueDir),
    state: await read(stateDir),
    scratch: await listing(join(stateDir, "scratch")),
  };
}

const anotherRing = () => {
  const ring = generateKeyRing();
  return `WAITRON_CREDENTIALS_KEY=${ring.key}\nWAITRON_CREDENTIALS_KEY_VERSION=${ring.version}\n`;
};

it.each([
  {
    change: "secrets.env holds another ring",
    apply: () => writeFile(join(stateDir, "secrets.env"), anotherRing()),
    code: "emergency_copy.placed_key_unopenable",
  },
  {
    change: "secrets.env is gone",
    apply: () => rm(join(stateDir, "secrets.env")),
    code: "emergency_copy.placed_key_unopenable",
  },
  {
    change: "trading.env is gone",
    apply: () => rm(join(stateDir, "trading.env")),
    code: "emergency_copy.trading_env_missing",
  },
  {
    change: "trading.env names another environment",
    apply: () => writeFile(join(stateDir, "trading.env"), keptTrading("WAITRON_ENV=production\n")),
    code: "emergency_copy.trading_environment_differs",
  },
  {
    change: "trading.env sets the vault key",
    apply: () => writeFile(join(stateDir, "trading.env"), keptTrading(anotherRing())),
    code: "emergency_copy.vault_key_in_trading_env",
  },
])("refuses a repeat once $change, writing nothing", async ({ apply, code }) => {
  const binding = await placedBinding();
  await place(binding);
  await apply();
  const before = await bothFolders();
  await expect(place(binding)).rejects.toMatchObject({ code });
  expect(await bothFolders()).toEqual(before);
});

it("a retry after a stop between writing the env files and the move places the copy", async () => {
  const binding = await placedBinding();
  // As the stopped placement left them: its ring and trading.env saved, its node.db half made.
  const stoppedRing = generateKeyRing();
  await writeCredentialsRing(stateDir, { key: stoppedRing.key, version: stoppedRing.version });
  await writeTradingEnv(stateDir, { nodeId: copyId, environment: "preproduction" });
  const stale = join(stateDir, "scratch", "emergency-copy-stale");
  await mkdir(stale, { recursive: true });
  await writeFile(join(stale, "node.db"), "half made");
  const trading = await readFile(join(stateDir, "trading.env"));

  await place(binding);

  const key = await readPlacedNode((node) => readNodeSigningKey(node, writtenRing(), copyId));
  expect(key).toEqual(expect.any(String));
  expect(await readFile(join(stateDir, "trading.env"))).toEqual(trading);
  expect(await listing(venueDir)).toEqual(["node.db", "venue.db", "venue.lock"]);
  expect(await listing(join(stateDir, "scratch"))).toEqual(["emergency-copy-stale"]);
  expect(sha(venuePath)).toBe(binding.selectedStream.databaseSha256);
  await expect(place(binding)).resolves.toBeUndefined();
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
  expect(await listing(venueDir)).toEqual(["venue.db", "venue.lock"]);
  expect(await listing(stateDir)).toEqual([]);
});

it("places a binding the checks finish a moment before it expires", async () => {
  const binding = await placedBinding();
  await place(binding, {}, clockMovedByTheCheck("2026-11-17T10:29:59.999Z"));
  expect(existsSync(join(venueDir, "node.db"))).toBe(true);
});
