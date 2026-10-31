import * as fs from "node:fs/promises";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createHash, randomUUID } from "node:crypto";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { DatabaseSync } from "node:sqlite";
import { afterEach, expect, it } from "vitest";
import { openVenueDatabase, runMigrations, withNodeTransaction } from "@waitron/db";
import { NODE_CLASSIFICATION, NODE_MIGRATIONS, setRecoveryKeyTx } from "@waitron/node-db";
import {
  NODE_ROWS_A_FIRST_SETUP_WRITES,
  assertStartAgainAllowedOnDisk,
  deleteMarkedAttempt,
  startAgainMarkerFor,
  writeStartAgainMarker,
} from "./first-setup-start-again-deletion.js";

const dirs: string[] = [];
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});
const ATTEMPT = { attemptId: randomUUID(), frozenDigest: "a".repeat(64) };
const NODE_ID = randomUUID();
const notReady = (reason: string) => ({ code: "setup.not_ready", params: {}, reason });
const sha = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");

/** An attempt's folders whose node.db the node migration set has migrated, as a setup-mode start does. */
async function attemptWithMigratedNode() {
  const base = await mkdtemp(join(tmpdir(), "start-again-node-"));
  dirs.push(base);
  const roots = { venueDir: join(base, "venue"), stateDir: join(base, "state") };
  await mkdir(roots.venueDir);
  await mkdir(roots.stateDir);
  const store = await openVenueDatabase(roots.venueDir);
  await runMigrations(store.node, NODE_MIGRATIONS);
  await store.close();
  await writeFile(join(roots.venueDir, "first-setup-claim.json"), "{}");
  await writeFile(join(roots.stateDir, "first-setup.json"), "state");
  return roots;
}

async function withNode(roots: { venueDir: string }, sql: string) {
  const node = new DatabaseSync(join(roots.venueDir, "node.db"));
  try {
    node.exec(sql);
  } finally {
    node.close();
  }
}

async function recoveryKeyRow(roots: { venueDir: string }, nodeId = NODE_ID) {
  const store = await openVenueDatabase(roots.venueDir);
  try {
    await withNodeTransaction(store.node, (tx) =>
      setRecoveryKeyTx(tx, nodeId, "scrypt$verifier", "Olive"),
    );
  } finally {
    await store.close();
  }
}

const signingKeyRow = (nodeId: string) =>
  `insert into node_signing_key (node_id, ciphertext, iv, auth_tag, key_version, updated_at)
   values ('${nodeId}', x'00', zeroblob(12), zeroblob(16), 1, '2026-10-31T00:00:00.000Z')`;

async function files(dir: string) {
  const result: Record<string, string> = {};
  for (const name of (await fs.readdir(dir)).sort())
    if (!/^venue\.(lock|holder)/.test(name)) result[name] = sha(await readFile(join(dir, name)));
  return result;
}

it.each<[string, (roots: { venueDir: string }) => Promise<void>]>([
  ["only the node set's tables and its journal, as a setup-mode start leaves it", async () => {}],
  ["an attempt's recovery-key check", (roots) => recoveryKeyRow(roots)],
  ["an attempt's sealed signing key", (roots) => withNode(roots, signingKeyRow(NODE_ID))],
  [
    "an attempt's recovery-key check and signing key",
    async (roots) => {
      await recoveryKeyRow(roots);
      await withNode(roots, signingKeyRow(NODE_ID));
    },
  ],
])(
  "Start again accepts a node.db holding %s, names it in the marker and deletes it",
  async (_name, seed) => {
    const roots = await attemptWithMigratedNode();
    await seed(roots);
    const canonical = await assertStartAgainAllowedOnDisk(roots);
    const marker = await startAgainMarkerFor(canonical, ATTEMPT);
    expect(marker.files.map((entry) => `${entry.root}:${entry.name}`)).toContain("venue:node.db");
    await writeStartAgainMarker(canonical, marker);
    await deleteMarkedAttempt(canonical, marker);
    expect(Object.keys(await files(roots.venueDir))).toEqual(["first-setup-deleting.json"]);
  },
);

it.each<[string, string, string]>([
  ["a table outside the node set", "create table t(x)", "node.db holds a table"],
  [
    "an index of its own",
    "create index node_mode_extra on node_mode(updated_at)",
    "node.db holds a table",
  ],
  ["a view", "create view v as select 1", "node.db holds a table"],
  [
    "a trigger",
    "create trigger tr after insert on node_mode begin select 1; end",
    "node.db holds a table",
  ],
  ["only part of the node set", "drop table node_primary_key", "node.db holds a table"],
  [
    "another table in place of one of the node set's",
    "drop table node_primary_key; create table t(x)",
    "node.db holds a table",
  ],
  [
    "a view under a node set table's name",
    "drop table node_mode; create view node_mode as select 1",
    "node.db holds a table",
  ],
  [
    "the node set's tables without its journal",
    "drop table __drizzle_migrations_node",
    "node.db holds a table",
  ],
  [
    "a mirror link",
    `insert into node_mirror_link values ('${NODE_ID}', 'https://relay', 'box', 'pem', '${randomUUID()}', '2026-10-31T00:00:00.000Z')`,
    "node.db holds a row",
  ],
  [
    "a role",
    `insert into node_mode (node_id, updated_at) values ('${NODE_ID}', '2026-10-31T00:00:00.000Z')`,
    "node.db holds a row",
  ],
  [
    "a main box's key",
    `insert into node_primary_key values ('${NODE_ID}', '${randomUUID()}', 'key', '2026-10-31T00:00:00.000Z')`,
    "node.db holds a row",
  ],
  [
    "two recovery-key checks",
    `insert into node_recovery_key values ('${NODE_ID}', 'v', 'One', '2026-10-31T00:00:00.000Z'),
       ('${randomUUID()}', 'v', 'Two', '2026-10-31T00:00:00.000Z')`,
    "node.db holds a row",
  ],
  [
    "two signing keys",
    `${signingKeyRow(NODE_ID)}; ${signingKeyRow(randomUUID())}`,
    "node.db holds a row",
  ],
])(
  "Start again refuses a migrated node.db holding %s, and nothing changes",
  async (_name, sql, reason) => {
    const roots = await attemptWithMigratedNode();
    await withNode(roots, sql);
    const before = { venue: await files(roots.venueDir), state: await files(roots.stateDir) };
    await expect(assertStartAgainAllowedOnDisk(roots)).rejects.toMatchObject(notReady(reason));
    expect({ venue: await files(roots.venueDir), state: await files(roots.stateDir) }).toEqual(
      before,
    );
  },
);

it("every node.db table has a decision on how many rows a first setup may leave in it", () => {
  expect(Object.keys(NODE_ROWS_A_FIRST_SETUP_WRITES).sort()).toEqual(
    NODE_CLASSIFICATION.map((table) => table.table).sort(),
  );
});
