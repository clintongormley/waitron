import type { BackupQuery, BackupRow } from "@waitron/store";
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

const SOURCE_ROW = {
  role: "select node_id from box where node_id=? and mode is not null",
  signing:
    "select signing_key_ciphertext as ciphertext, signing_key_iv as iv, signing_key_auth_tag as auth_tag, signing_key_version as key_version from box where node_id=? and signing_key_ciphertext is not null",
} as const;

async function hasTable(copy: BackupQuery, table: string): Promise<boolean> {
  let present = false;
  for await (const row of copy.rows(
    "select name from sqlite_schema where type='table' and name=?",
    [table],
  ))
    present = row.name === table;
  return present;
}

async function sourceRow(
  copy: BackupQuery,
  group: keyof typeof SOURCE_ROW,
  nodeId: string,
): Promise<BackupRow | undefined> {
  if (!(await hasTable(copy, "box"))) return undefined;
  for await (const row of copy.rows(SOURCE_ROW[group], [nodeId])) return row;
  return undefined;
}

async function holdsMasterKey(copy: BackupQuery): Promise<boolean> {
  if (!(await hasTable(copy, "master_keys"))) return false;
  for await (const _row of copy.rows("select 1 from master_keys limit 1", [])) return true;
  return false;
}

function codeOf(error: unknown): unknown {
  return error instanceof Error && "code" in error ? error.code : undefined;
}

/** Opens the source's sealed key with the archive's own key ring; `null` when the copy holds none. */
async function sourcePrivateKey(
  copy: BackupQuery,
  keyInputs: Readonly<Record<string, string>>,
  nodeId: string,
): Promise<string | null | "invalid"> {
  const row = await sourceRow(copy, "signing", nodeId);
  if (row === undefined) return null;
  if (
    typeof row.key_version === "bigint" &&
    (row.key_version > BigInt(Number.MAX_SAFE_INTEGER) ||
      row.key_version < BigInt(Number.MIN_SAFE_INTEGER))
  )
    throw new RangeError("Node signing key version is outside the safe integer range");
  const keyVersion =
    typeof row.key_version === "bigint" ? Number(row.key_version) : row.key_version;
  if (
    !(row.ciphertext instanceof Uint8Array) ||
    !(row.iv instanceof Uint8Array) ||
    !(row.auth_tag instanceof Uint8Array) ||
    typeof keyVersion !== "number"
  )
    return "invalid";
  try {
    return openNodeSigningKeyRow(
      {
        ciphertext: row.ciphertext,
        iv: row.iv,
        authTag: row.auth_tag,
        keyVersion,
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
 * key may hold no role in the node copy, and its venue copies no master key.
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
    const copy = context.nodeCopy ?? null;
    const data: BackupModuleStatus =
      copy === null || (await holdsAny(context.before)) || (await holdsAny(context.after))
        ? "invalid"
        : "passed";
    let secret: BackupModuleStatus = "invalid";
    if (copy !== null) {
      const nodeId = context.source.nodeId;
      const privateKey = await sourcePrivateKey(copy, keyInputs, nodeId);
      if (privateKey !== "invalid")
        secret = (await verifyBackupMembershipIdentity({
          before: context.before,
          after: context.after,
          nodeId,
          privateKey,
          nodeCopyHoldsSource:
            (await sourceRow(copy, "role", nodeId)) !== undefined ||
            (await holdsMasterKey(context.before)) ||
            (await holdsMasterKey(context.after)),
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
  },
};
