import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { sql } from "drizzle-orm";
import { afterEach, beforeEach, expect, it } from "vitest";
import { CORE_MIGRATIONS, openVenueDatabase, stampDeployment } from "@waitron/db";
import { NODE_MIGRATIONS, readRecoveryKeyName } from "@waitron/node-db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { mintBreakGlassSecret, verifyBreakGlass } from "./break-glass.js";
import { withRecoveryKeyOperation } from "./operation-authentication.js";

const suite = useVenueDb({
  migrations: [CORE_MIGRATIONS, NODE_MIGRATIONS],
});
const NODE = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const OTHER = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const dirs: string[] = [];
const binding = {
  module: "test-regime",
  action: "restore",
  eventId: "restore-1",
  sourceId: "backup-1",
  targetNodeId: NODE,
};

beforeEach(() => stampDeployment(suite.db, "preproduction"));
afterEach(async () => {
  for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true });
});

async function readName(node = suite.node, nodeId = NODE): Promise<unknown> {
  const rows = await node.execute<Record<string, unknown>>(
    sql`select * from node_recovery_key where node_id = ${nodeId}`,
  );
  return rows.rows[0]?.key_name;
}

it("stores a non-secret name beside each newly minted verifier", async () => {
  const secret = await mintBreakGlassSecret({ venue: suite.db, node: suite.node }, NODE);
  const name = await readName();
  expect(name).toEqual(
    expect.stringMatching(/^\d{4}-\d{2}-\d{2} · [34679ACDEFHJKMNPQRTUVWXY]{4}$/),
  );
  expect(name).not.toContain(secret);
  expect(await verifyBreakGlass(suite.node, NODE, secret)).toBe(true);
  expect(await readName(suite.node, OTHER)).toBeUndefined();
});

it("replacing a key changes its name while keeping another node's key and name", async () => {
  const original = await mintBreakGlassSecret({ venue: suite.db, node: suite.node }, NODE);
  const oldName = await readName();
  const other = await mintBreakGlassSecret({ venue: suite.db, node: suite.node }, OTHER);
  const otherName = await readName(suite.node, OTHER);
  const replacement = await mintBreakGlassSecret({ venue: suite.db, node: suite.node }, NODE);
  expect(await readName()).toEqual(expect.any(String));
  expect(await readName()).not.toBe(oldName);
  expect(await readName(suite.node, OTHER)).toBe(otherName);
  expect(await verifyBreakGlass(suite.node, NODE, original)).toBe(false);
  expect(await verifyBreakGlass(suite.node, NODE, replacement)).toBe(true);
  expect(await verifyBreakGlass(suite.node, OTHER, other)).toBe(true);
});

it("an archived database names and authenticates the key from its own snapshot", async () => {
  const original = await mintBreakGlassSecret({ venue: suite.db, node: suite.node }, NODE);
  const oldName = await readName();
  const root = await mkdtemp(join(tmpdir(), "recovery-key-name-"));
  dirs.push(root);
  const backupDir = join(root, "backup");
  await mkdir(backupDir);
  await suite.db.archiveTo(join(backupDir, "venue.db"));
  await suite.node.archiveTo(join(backupDir, "node.db"));
  const replacement = await mintBreakGlassSecret({ venue: suite.db, node: suite.node }, NODE);
  const newName = await readName();
  const copy = await openVenueDatabase(backupDir);
  try {
    expect(oldName).toEqual(expect.any(String));
    expect(newName).not.toBe(oldName);
    expect(await readName(copy.node)).toBe(oldName);
    await expect(
      withRecoveryKeyOperation(
        { db: copy.venue, node: copy.node, nodeId: NODE },
        binding,
        original,
        async () => "accepted",
      ),
    ).resolves.toBe("accepted");
    await expect(
      withRecoveryKeyOperation(
        { db: copy.venue, node: copy.node, nodeId: NODE },
        binding,
        replacement,
        async () => "accepted",
      ),
    ).rejects.toMatchObject({ code: "promotion.break_glass_invalid" });
    await expect(
      withRecoveryKeyOperation(
        { db: suite.db, node: suite.node, nodeId: NODE },
        binding,
        original,
        async () => "accepted",
      ),
    ).rejects.toMatchObject({ code: "promotion.break_glass_invalid" });
    await expect(
      withRecoveryKeyOperation(
        { db: suite.db, node: suite.node, nodeId: NODE },
        binding,
        replacement,
        async () => "accepted",
      ),
    ).resolves.toBe("accepted");
  } finally {
    await copy.close();
  }
});

it("a refused replacement leaves both the paper name and the original verifier", async () => {
  const original = await mintBreakGlassSecret({ venue: suite.db, node: suite.node }, NODE);
  const oldName = await readRecoveryKeyName(suite.node, NODE);
  await suite.node.execute(
    sql`create trigger refuse_recovery_key_update before update on node_recovery_key begin select raise(abort, 'key replacement refused'); end`,
  );
  try {
    await expect(mintBreakGlassSecret({ venue: suite.db, node: suite.node }, NODE)).rejects.toThrow(
      "key replacement refused",
    );
  } finally {
    await suite.node.execute(sql`drop trigger refuse_recovery_key_update`);
  }
  expect(await readRecoveryKeyName(suite.node, NODE)).toBe(oldName);
  expect(await verifyBreakGlass(suite.node, NODE, original)).toBe(true);
});

it("a paper name is not a credential, and the name reader is scoped to its node", async () => {
  const secret = await mintBreakGlassSecret({ venue: suite.db, node: suite.node }, NODE);
  const name = await readRecoveryKeyName(suite.node, NODE);
  expect(name).toEqual(expect.any(String));
  expect(await readRecoveryKeyName(suite.node, OTHER)).toBeNull();
  expect(await verifyBreakGlass(suite.node, NODE, name!)).toBe(false);
  const rows = await suite.node.execute(sql`select * from node_recovery_key`);
  expect(JSON.stringify(rows)).not.toContain(secret);
});
