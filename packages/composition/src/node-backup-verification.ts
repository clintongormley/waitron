import { DatabaseSync } from "node:sqlite";
import { NODE_CLASSIFICATION } from "@waitron/node-db";
import { verifyBackupMembershipIdentity } from "@waitron/db";
import { loadKeyRing, openNodeSigningKeyRow, resolveBackupKeyInputs } from "@waitron/credentials";
import {
  BackupCheckUnavailable,
  type BackupModuleStatus,
  type BackupVerificationContext,
  type BackupVerificationContribution,
} from "@waitron/module";

const tables = NODE_CLASSIFICATION.map((entry) => entry.table);

async function holdsAny(query: BackupVerificationContext["before"]): Promise<boolean> {
  for (const table of tables) {
    for await (const row of query.rows(
      "select name from sqlite_schema where type='table' and name=?",
      [table],
    )) {
      if (row.name === table) return true;
    }
  }
  return false;
}

function openCopy(bytes: Uint8Array | null): DatabaseSync | null {
  if (bytes === null) return null;
  const database = new DatabaseSync(":memory:");
  try {
    database.deserialize(bytes);
    database.prepare("select count(*) from sqlite_schema").get();
    return database;
  } catch {
    database.close();
    return null;
  }
}

const SOURCE_ROW = {
  node_mode: "select node_id from node_mode where node_id=?",
  node_recovery_key: "select node_id from node_recovery_key where node_id=?",
  node_signing_key:
    "select ciphertext, iv, auth_tag, key_version from node_signing_key where node_id=?",
} as const;

function sourceRow(copy: DatabaseSync, table: keyof typeof SOURCE_ROW, nodeId: string) {
  const present = copy
    .prepare("select 1 from sqlite_schema where type='table' and name=?")
    .get(table);
  if (present === undefined) return undefined;
  return copy.prepare(SOURCE_ROW[table]).get(nodeId);
}

function codeOf(error: unknown): unknown {
  return error instanceof Error && "code" in error ? error.code : undefined;
}

/** Opens the source's sealed key with the archive's own key ring; `null` when the copy holds none. */
function sourcePrivateKey(
  copy: DatabaseSync,
  keyInputs: Readonly<Record<string, string>>,
  nodeId: string,
): string | null | "invalid" {
  const row = sourceRow(copy, "node_signing_key", nodeId);
  if (row === undefined) return null;
  if (
    !(row.ciphertext instanceof Uint8Array) ||
    !(row.iv instanceof Uint8Array) ||
    !(row.auth_tag instanceof Uint8Array) ||
    typeof row.key_version !== "number"
  )
    return "invalid";
  try {
    return openNodeSigningKeyRow(
      {
        ciphertext: row.ciphertext,
        iv: row.iv,
        authTag: row.auth_tag,
        keyVersion: row.key_version,
      },
      loadKeyRing(keyInputs),
      nodeId,
    );
  } catch (error) {
    // A row that opened but holds no key is damaged; anything else means the archive's own key
    // ring cannot open it, which says nothing about the row.
    if (codeOf(error) === "credentials.malformed_payload") return "invalid";
    throw new BackupCheckUnavailable("decryption_unavailable");
  }
}

/**
 * The archive's node.dump must open as a database, and neither venue copy may hold one of
 * node.db's tables: they belong to the box, never to the venue. The source's signing key, sealed
 * in its node copy, must pair with the public key the venue copies record for it; a source with no
 * key may hold no role or recovery key there either.
 */
export const NODE_BACKUP_VERIFICATION: BackupVerificationContribution = {
  version: 1,
  publicEvidenceDigest: null,
  data: { kind: "custom", tables, immutableTables: [], checks: ["data", "secret"] },
  secrets: [],
  entries: [
    { name: "node.dump", presence: "required" },
    { name: "secrets/secrets.env", presence: "required" },
    { name: "secrets/trading.env", presence: "required" },
    { name: "secrets/backup.env", presence: "optional" },
  ],
  effects: [],
  zeroSchema: "absent_tables_and_entries",
  targetOnly: "unsupported",
  async verifyRestoredData(context) {
    const secretsEnv = await context.entries.read("secrets/secrets.env");
    const tradingEnv = await context.entries.read("secrets/trading.env");
    const backupEnv = await context.entries.read("secrets/backup.env");
    if (secretsEnv === null || tradingEnv === null)
      throw new BackupCheckUnavailable("secret_unavailable");
    const keyInputs = resolveBackupKeyInputs({ secretsEnv, tradingEnv, backupEnv });
    const copy = openCopy(await context.entries.read("node.dump"));
    try {
      const data: BackupModuleStatus =
        copy === null || (await holdsAny(context.before)) || (await holdsAny(context.after))
          ? "invalid"
          : "passed";
      let secret: BackupModuleStatus = "invalid";
      if (copy !== null) {
        const nodeId = context.source.nodeId;
        const privateKey = sourcePrivateKey(copy, keyInputs, nodeId);
        if (privateKey !== "invalid")
          secret = (await verifyBackupMembershipIdentity({
            before: context.before,
            after: context.after,
            nodeId,
            privateKey,
            nodeCopyHoldsSource:
              sourceRow(copy, "node_mode", nodeId) !== undefined ||
              sourceRow(copy, "node_recovery_key", nodeId) !== undefined,
          }))
            ? "passed"
            : "invalid";
      }
      return {
        status: data === "invalid" || secret === "invalid" ? "invalid" : "passed",
        checks: [
          { code: "data", status: data },
          { code: "secret", status: secret },
        ],
      };
    } finally {
      copy?.close();
    }
  },
};
