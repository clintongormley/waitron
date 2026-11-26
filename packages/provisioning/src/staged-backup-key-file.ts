import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { masterKeyId } from "@waitron/credentials";
import { isAppError } from "@waitron/shared";
import { BACKUP_ENV_FILE, parseEnvFile } from "@waitron/store";
import { errnoOf } from "./errno.js";
import { removeAndSync } from "./folder-sync.js";
import { readSetupFlowRecord } from "./setup-flow-record.js";

async function stagedMasterKeyId(stateDir: string): Promise<string | null> {
  try {
    const nodeKey = (await readSetupFlowRecord(stateDir))?.nodeKey;
    const publicKey =
      typeof nodeKey === "object" && nodeKey !== null
        ? (nodeKey as { masterKeyPublicKey?: unknown }).masterKeyPublicKey
        : undefined;
    return typeof publicKey === "string"
      ? masterKeyId(Buffer.from(publicKey, "base64")).toString("hex")
      : null;
  } catch (error) {
    if (isAppError(error) && error.code === "setup.attempt_invalid") return null;
    throw error;
  }
}

/**
 * Live setup writes `backup.env` from the master key it stages, which Start again throws away.
 * Deletes the file and syncs the state folder only while it names that staged key; a file from any
 * other master key, or one naming none, stays. Runs before the setup record goes.
 */
export async function deleteStagedBackupKey(stateDir: string): Promise<void> {
  const staged = await stagedMasterKeyId(stateDir);
  if (staged === null) return;
  const path = join(stateDir, BACKUP_ENV_FILE);
  let text: string;
  try {
    text = await readFile(path, "utf8");
  } catch (error) {
    if (errnoOf(error) === "ENOENT") return;
    throw error;
  }
  if (parseEnvFile(text).WAITRON_BACKUP_MASTER_KEY_ID !== staged) return;
  await removeAndSync(path, "file");
}
