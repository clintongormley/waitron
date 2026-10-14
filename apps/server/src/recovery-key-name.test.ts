import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { sql } from "drizzle-orm";
import { afterEach, beforeEach, expect, it } from "vitest";
import {
  CORE_MIGRATIONS,
  openVenueDatabase,
  readBreakGlassKeyName,
  stampDeployment,
} from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { mintBreakGlassSecret, verifyBreakGlass } from "./break-glass.js";
import { withRecoveryKeyOperation } from "./operation-authentication.js";

const suite = useVenueDb({ migrations: [CORE_MIGRATIONS] });
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

async function readName(db = suite.db, nodeId = NODE): Promise<unknown> {
  const rows = await db.execute<Record<string, unknown>>(
    sql`select * from node_roles where node_id = ${nodeId}`,
  );
  return rows.rows[0]?.break_glass_key_name;
}

it("stores a non-secret name beside each newly minted verifier", async () => {
  const secret = await mintBreakGlassSecret(suite.db, NODE);
  const name = await readName();
  expect(name).toEqual(
    expect.stringMatching(/^\d{4}-\d{2}-\d{2} · [34679ACDEFHJKMNPQRTUVWXY]{4}$/),
  );
  expect(name).not.toContain(secret);
  expect(await verifyBreakGlass(suite.db, NODE, secret)).toBe(true);
  expect(await readName(suite.db, OTHER)).toBeUndefined();
});

it("replacing a key changes its name while keeping another node's key and name", async () => {
  const original = await mintBreakGlassSecret(suite.db, NODE);
  const oldName = await readName();
  const other = await mintBreakGlassSecret(suite.db, OTHER);
  const otherName = await readName(suite.db, OTHER);
  const replacement = await mintBreakGlassSecret(suite.db, NODE);
  expect(await readName()).toEqual(expect.any(String));
  expect(await readName()).not.toBe(oldName);
  expect(await readName(suite.db, OTHER)).toBe(otherName);
  expect(await verifyBreakGlass(suite.db, NODE, original)).toBe(false);
  expect(await verifyBreakGlass(suite.db, NODE, replacement)).toBe(true);
  expect(await verifyBreakGlass(suite.db, OTHER, other)).toBe(true);
});

it("an archived database names and authenticates the key from its own snapshot", async () => {
  const original = await mintBreakGlassSecret(suite.db, NODE);
  const oldName = await readName();
  const root = await mkdtemp(join(tmpdir(), "recovery-key-name-"));
  dirs.push(root);
  const backupDir = join(root, "backup");
  await mkdir(backupDir);
  await suite.db.archiveTo(join(backupDir, "venue.db"));
  const replacement = await mintBreakGlassSecret(suite.db, NODE);
  const newName = await readName();
  const copy = await openVenueDatabase(backupDir);
  try {
    expect(oldName).toEqual(expect.any(String));
    expect(newName).not.toBe(oldName);
    expect(await readName(copy.venue)).toBe(oldName);
    await expect(
      withRecoveryKeyOperation(
        { db: copy.venue, nodeId: NODE },
        binding,
        original,
        async () => "accepted",
      ),
    ).resolves.toBe("accepted");
    await expect(
      withRecoveryKeyOperation(
        { db: copy.venue, nodeId: NODE },
        binding,
        replacement,
        async () => "accepted",
      ),
    ).rejects.toMatchObject({ code: "promotion.break_glass_invalid" });
    await expect(
      withRecoveryKeyOperation(
        { db: suite.db, nodeId: NODE },
        binding,
        original,
        async () => "accepted",
      ),
    ).rejects.toMatchObject({ code: "promotion.break_glass_invalid" });
    await expect(
      withRecoveryKeyOperation(
        { db: suite.db, nodeId: NODE },
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
  const original = await mintBreakGlassSecret(suite.db, NODE);
  const oldName = await readBreakGlassKeyName(suite.db, NODE);
  await suite.db.execute(
    sql`create trigger refuse_recovery_key_update before update on node_roles begin select raise(abort, 'key replacement refused'); end`,
  );
  try {
    await expect(mintBreakGlassSecret(suite.db, NODE)).rejects.toThrow("key replacement refused");
  } finally {
    await suite.db.execute(sql`drop trigger refuse_recovery_key_update`);
  }
  expect(await readBreakGlassKeyName(suite.db, NODE)).toBe(oldName);
  expect(await verifyBreakGlass(suite.db, NODE, original)).toBe(true);
});

it("a paper name is not a credential, and the name reader is scoped to its node", async () => {
  const secret = await mintBreakGlassSecret(suite.db, NODE);
  const name = await readBreakGlassKeyName(suite.db, NODE);
  expect(name).toEqual(expect.any(String));
  expect(await readBreakGlassKeyName(suite.db, OTHER)).toBeNull();
  expect(await verifyBreakGlass(suite.db, NODE, name!)).toBe(false);
  const rows = await suite.db.execute(sql`select * from node_roles`);
  expect(JSON.stringify(rows)).not.toContain(secret);
});
