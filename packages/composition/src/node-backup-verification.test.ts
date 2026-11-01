import { createCipheriv, generateKeyPairSync } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { sql } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { withNodeTransaction } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { openBackupQuery } from "@waitron/store";
import { NODE_CLASSIFICATION, NODE_MIGRATIONS } from "@waitron/node-db";
import { loadKeyRing, sealNodeSigningKeyTx } from "@waitron/credentials";
import {
  BackupCheckUnavailable,
  validateBackupModuleResult,
  validateBackupVerificationContribution,
  type BackupVerificationContext,
} from "@waitron/module";
import { NODE_BACKUP_VERIFICATION } from "./node-backup-verification.js";
import { ALL_MODULES } from "./modules.js";

const SOURCE = "20000000-0000-4000-8000-000000000002";
const OTHER = "30000000-0000-4000-8000-000000000003";
const vaultKey = Buffer.alloc(32, 2).toString("base64");
const ring = loadKeyRing({ WAITRON_CREDENTIALS_KEY: vaultKey });
const keyEnv = `WAITRON_CREDENTIALS_KEY=${vaultKey}\nWAITRON_CREDENTIALS_KEY_VERSION=1\n`;
const pair = generateKeyPairSync("ed25519");
const publicKey = pair.publicKey.export({ format: "der", type: "spki" }).toString("base64");
const privateKey = pair.privateKey.export({ format: "der", type: "pkcs8" }).toString("base64");
const tables = NODE_CLASSIFICATION.map((entry) => entry.table);

const before = useVenueDb({ migrations: [] });
const after = useVenueDb({ migrations: [] });
/** Its node handle stands for the source box's node.db; node.dump is a copy of it. */
const source = useVenueDb({ migrations: [NODE_MIGRATIONS] });

function seedVenue(key: string | null) {
  for (const suite of [before, after])
    suite.db.run(
      sql`insert into nodes (id, public_key, endorsement) values (${SOURCE}, ${key}, null)`,
    );
}

beforeEach(() => {
  for (const suite of [before, after]) {
    for (const table of tables) suite.db.run(sql.raw(`drop table if exists ${table}`));
    suite.db.run(sql`drop table if exists nodes`);
    suite.db.run(sql`create table nodes (id text, public_key text, endorsement text)`);
  }
});

async function sourceCopy(): Promise<Uint8Array> {
  const scratch = await mkdtemp(join(tmpdir(), "a947-node-backup-"));
  try {
    await source.node.archiveTo(join(scratch, "node.db"));
    return await readFile(join(scratch, "node.db"));
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
}

async function sealKey(nodeId: string, key: string) {
  await withNodeTransaction(source.node, (tx) => sealNodeSigningKeyTx(tx, ring, nodeId, key));
}

const secretEntries: Record<string, Uint8Array | null> = {
  "secrets/secrets.env": Buffer.from(keyEnv),
  "secrets/trading.env": Buffer.from(""),
};

async function run(
  nodeDump: Uint8Array | null | undefined = undefined,
  entries: Record<string, Uint8Array | null> = secretEntries,
) {
  const dump = nodeDump === undefined ? await sourceCopy() : nodeDump;
  const path = (s: typeof before) =>
    s.db.all<{ file: string }>(sql`pragma database_list`).find((r) => r.file.endsWith("venue.db"))!
      .file;
  const a = await openBackupQuery(path(before));
  try {
    const b = await openBackupQuery(path(after));
    try {
      const context: BackupVerificationContext = {
        before: a.query,
        after: b.query,
        entries: {
          read: async (name) => (name === "node.dump" ? dump : (entries[name] ?? null)),
        },
        source: {
          nodeId: SOURCE,
          locationId: "10000000-0000-4000-8000-000000000001",
          environment: "preproduction",
          createdAt: "2026-10-31T08:00:00.000Z",
        },
        sourceSchema: 1,
        targetSchema: 1,
        signal: new AbortController().signal,
      };
      return validateBackupModuleResult(
        await NODE_BACKUP_VERIFICATION.verifyRestoredData(context),
        NODE_BACKUP_VERIFICATION,
        false,
      );
    } finally {
      await b.close();
    }
  } finally {
    await a.close();
  }
}

const result = (data: "passed" | "invalid", secret: "passed" | "invalid") => ({
  status: data === "invalid" || secret === "invalid" ? "invalid" : "passed",
  checks: [
    { code: "data", status: data },
    { code: "secret", status: secret },
  ],
});

describe("node.db's backup verification", () => {
  it("is the node module's contribution and claims exactly node.db's tables", () => {
    const owner = validateBackupVerificationContribution(NODE_BACKUP_VERIFICATION);
    expect(ALL_MODULES.find((m) => m.name === "node")?.backup?.verification).toBe(
      NODE_BACKUP_VERIFICATION,
    );
    expect([...owner.data.tables].sort()).toEqual([...tables].sort());
    expect(owner.entries).toEqual([
      { name: "node.dump", presence: "required" },
      { name: "secrets/secrets.env", presence: "required" },
      { name: "secrets/trading.env", presence: "required" },
      { name: "secrets/backup.env", presence: "optional" },
    ]);
    expect(owner.secrets).toEqual([]);
  });

  it("is refused when the backup's manifest does not name it", () => {
    expect(NODE_BACKUP_VERIFICATION.targetOnly).toBe("unsupported");
  });

  it.each([
    ["missing", null],
    ["not a database", Buffer.from("this is not a database file, only some words")],
  ])("marks invalid a node.dump that is %s", async (_name, nodeDump) => {
    seedVenue(null);
    await expect(run(nodeDump)).resolves.toEqual(result("invalid", "invalid"));
  });

  it("passes a key-less source whose node copy holds nothing for it", async () => {
    seedVenue(null);
    await expect(run()).resolves.toEqual(result("passed", "passed"));
  });

  it.each(
    tables.flatMap((table) => [
      ["original", table, before] as const,
      ["restored", table, after] as const,
    ]),
  )("marks invalid a %s venue copy that holds %s", async (_name, table, suite) => {
    seedVenue(null);
    suite.db.run(sql.raw(`create table ${table} (node_id text primary key)`));
    await expect(run()).resolves.toEqual(result("invalid", "passed"));
  });

  it("passes a backup whose node copy's key pairs with the venue's public key", async () => {
    seedVenue(publicKey);
    await sealKey(SOURCE, privateKey);
    await expect(run()).resolves.toEqual(result("passed", "passed"));
  });

  it("marks invalid a backup whose node copy holds another key", async () => {
    seedVenue(publicKey);
    await sealKey(
      SOURCE,
      generateKeyPairSync("ed25519")
        .privateKey.export({ format: "der", type: "pkcs8" })
        .toString("base64"),
    );
    await expect(run()).resolves.toEqual(result("passed", "invalid"));
  });

  it("marks invalid a node copy's key when the venue records no public key", async () => {
    seedVenue(null);
    await sealKey(SOURCE, privateKey);
    await expect(run()).resolves.toEqual(result("passed", "invalid"));
  });

  it("marks invalid a keyed source whose node copy holds no key for it", async () => {
    seedVenue(publicKey);
    await sealKey(OTHER, privateKey);
    await expect(run()).resolves.toEqual(result("passed", "invalid"));
  });

  it("reads only the source's own key row", async () => {
    seedVenue(null);
    await sealKey(OTHER, privateKey);
    await expect(run()).resolves.toEqual(result("passed", "passed"));
  });

  it("marks invalid a key-less source whose node copy still holds its recovery key", async () => {
    seedVenue(null);
    source.node.run(
      sql`insert into node_recovery_key (node_id, verifier, key_name, updated_at) values (${SOURCE}, 'verifier', 'Key 1', '2026-10-31T08:00:00Z')`,
    );
    await expect(run()).resolves.toEqual(result("passed", "invalid"));
  });

  it("marks invalid a key-less source whose node copy still holds its role", async () => {
    seedVenue(null);
    source.node.run(
      sql`insert into node_mode (node_id, mode, singleton_role, updated_at) values (${SOURCE}, 'primary', 'primary', '2026-10-31T08:00:00Z')`,
    );
    await expect(run()).resolves.toEqual(result("passed", "invalid"));
  });

  it("passes a key-less source when only another node's role is in the node copy", async () => {
    seedVenue(null);
    source.node.run(
      sql`insert into node_mode (node_id, mode, singleton_role, updated_at) values (${OTHER}, 'primary', 'primary', '2026-10-31T08:00:00Z')`,
    );
    source.node.run(
      sql`insert into node_recovery_key (node_id, verifier, key_name, updated_at) values (${OTHER}, 'verifier', 'Key 1', '2026-10-31T08:00:00Z')`,
    );
    await expect(run()).resolves.toEqual(result("passed", "passed"));
  });

  it("marks invalid an opened key row whose contents are not a key payload", async () => {
    seedVenue(publicKey);
    await sealKey(SOURCE, privateKey);
    const cipher = createCipheriv("aes-256-gcm", Buffer.alloc(32, 2), Buffer.alloc(12, 3));
    cipher.setAAD(Buffer.from(`membership.node_key/${SOURCE}`));
    const ciphertext = Buffer.concat([cipher.update("null"), cipher.final()]);
    source.node.run(
      sql`update node_signing_key set ciphertext=${ciphertext}, iv=${Buffer.alloc(12, 3)}, auth_tag=${cipher.getAuthTag()}`,
    );
    await expect(run()).resolves.toEqual(result("passed", "invalid"));
  });

  it.each(["ciphertext", "iv", "auth_tag", "key_version"])(
    "marks invalid a key row whose %s is not shaped as a sealed row's",
    async (column) => {
      seedVenue(publicKey);
      const copy = new DatabaseSync(":memory:");
      try {
        copy.exec(
          "create table node_signing_key (node_id text primary key, ciphertext blob, iv blob, auth_tag blob, key_version integer)",
        );
        copy
          .prepare("insert into node_signing_key values (?, ?, ?, ?, 1)")
          .run(SOURCE, Buffer.alloc(8), Buffer.alloc(12), Buffer.alloc(16));
        copy.exec(`update node_signing_key set ${column} = 'not a sealed value'`);
        await expect(run(copy.serialize())).resolves.toEqual(result("passed", "invalid"));
      } finally {
        copy.close();
      }
    },
  );

  it("passes a key-less source whose node copy has none of node.db's tables", async () => {
    seedVenue(null);
    const copy = new DatabaseSync(":memory:");
    try {
      copy.exec("create table unrelated (id text)");
      await expect(run(copy.serialize())).resolves.toEqual(result("passed", "passed"));
    } finally {
      copy.close();
    }
  });

  it.each([
    ["a key version the archive's ring lacks", `WAITRON_CREDENTIALS_KEY=${vaultKey}\n`, 2],
    [
      "a ring that does not open it",
      `WAITRON_CREDENTIALS_KEY=${Buffer.alloc(32, 1).toString("base64")}\n`,
      1,
    ],
    ["no ring at all", "", 1],
  ])("cannot decide when the key row meets %s", async (_name, env, version) => {
    seedVenue(publicKey);
    await sealKey(SOURCE, privateKey);
    source.node.run(sql`update node_signing_key set key_version=${version}`);
    const attempt = run(undefined, { ...secretEntries, "secrets/secrets.env": Buffer.from(env) });
    await expect(attempt).rejects.toBeInstanceOf(BackupCheckUnavailable);
    await expect(attempt).rejects.toMatchObject({ reason: "decryption_unavailable" });
  });

  it.each(["secrets/secrets.env", "secrets/trading.env"])(
    "cannot decide without %s",
    async (name) => {
      seedVenue(publicKey);
      await sealKey(SOURCE, privateKey);
      await expect(run(undefined, { ...secretEntries, [name]: null })).rejects.toMatchObject({
        reason: "secret_unavailable",
      });
    },
  );
});
