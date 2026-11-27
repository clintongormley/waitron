import { createPrivateKey } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { posix } from "node:path";
import { loadKeyRing, resolveBackupKeyInputs } from "@waitron/credentials";
import { isAppError, readVariable } from "@waitron/shared";
import { decryptArtifactAsync } from "./artifact-cipher.js";
import { unpackArchive, type ArchiveEntry } from "./backup-archive.js";
import { loadRecoveryKey } from "./backup-config.js";
import type { BackupVerificationReason } from "./backup-verification-protocol.js";
import { loadBoxEnv } from "./box-env.js";
import { parseEnvFile } from "./env-file.js";
import { errnoOf } from "./errno.js";
import { readArtifactIdentity } from "./restore.js";
import { boxCertCurrent, boxLeafChain, boxRoot, boxSigner } from "./self-signed-cert.js";
import { RECOVERY_FILES } from "./state-secrets.js";

type StateResult = {
  status: "passed" | "invalid" | "unsupported" | "unavailable";
  reason: BackupVerificationReason;
};
const PASSED: StateResult = { status: "passed", reason: "none" };
const INVALID: StateResult = { status: "invalid", reason: "secret_invalid" };
const UNSUPPORTED: StateResult = { status: "unsupported", reason: "secret_format_unsupported" };
const UNAVAILABLE: StateResult = { status: "unavailable", reason: "secret_unavailable" };

function inputs(entries: readonly ArchiveEntry[]) {
  const read = (name: string) => entries.find((entry) => entry.name === "secrets/" + name)?.bytes;
  const required = resolveBackupKeyInputs({
    secretsEnv: read("secrets.env") ?? new Uint8Array(),
    tradingEnv: read("trading.env") ?? new Uint8Array(),
    backupEnv: null,
  });
  const backup = parseEnvFile(Buffer.from(read("backup.env") ?? []).toString("utf8"));
  return {
    env: { ...required, ...backup },
    hasSavedRecoveryKey: readVariable(backup, "WAITRON_BACKUP_RECOVERY_KEY") !== undefined,
  };
}
function keys(env: Readonly<Record<string, string | undefined>>) {
  return loadKeyRing(env);
}

export async function verifyBackupKeyPlacement(
  captured: readonly ArchiveEntry[],
  placedStateDir: string,
): Promise<"passed" | "unsupported" | "unavailable"> {
  try {
    const original = keys(inputs(captured).env);
    const placedEnv = await loadBoxEnv({}, placedStateDir);
    const retained = inputs(captured.filter((entry) => entry.name !== "secrets/backup.env")).env;
    if (
      !readVariable(retained, "WAITRON_CREDENTIALS_KEY") &&
      !readVariable(placedEnv, "WAITRON_CREDENTIALS_KEY")
    )
      return "unsupported";
    const placed = keys(placedEnv);
    return isDeepStrictEqual(original, placed) ? "passed" : "unsupported";
  } catch (error) {
    if (!isAppError(error)) throw error;
    return "unavailable";
  }
}

export async function verifyBackupStateSecrets(
  entries: readonly ArchiveEntry[],
  source: { nodeId: string },
  now: Date,
  sealedState?: { sealed: Uint8Array; archiveKey: string },
): Promise<StateResult> {
  if (!Number.isFinite(now.getTime())) return UNAVAILABLE;
  const byName = new Map<string, ArchiveEntry>();
  for (const entry of entries) {
    const name = posix.normalize(entry.name);
    if (byName.has(name)) return INVALID;
    if (name.startsWith("secrets/cloud/")) return UNSUPPORTED;
    byName.set(name, entry);
  }
  for (const name of RECOVERY_FILES) {
    const entry = byName.get("secrets/" + name);
    if (entry === undefined || entry.bytes.length === 0) return UNAVAILABLE;
  }
  try {
    const { node } = readArtifactIdentity(entries);
    if (node.nodeId !== source.nodeId) return { status: "invalid", reason: "binding_mismatch" };
  } catch (error) {
    if (!isAppError(error)) throw error;
    return INVALID;
  }
  const { env, hasSavedRecoveryKey } = inputs(entries);
  try {
    keys(env);
  } catch (error) {
    if (!isAppError(error)) throw error;
    return UNAVAILABLE;
  }
  let boxRecoveryKey: string | undefined;
  try {
    const recoveryKey = loadRecoveryKey(env);
    boxRecoveryKey = hasSavedRecoveryKey ? recoveryKey : undefined;
  } catch (error) {
    if (!isAppError(error) && !(error instanceof SyntaxError)) throw error;
    return UNSUPPORTED;
  }
  try {
    const read = (name: string) =>
      Buffer.from(byName.get("secrets/tls/" + name)!.bytes).toString("utf8");
    const root = boxRoot(read("ca.crt"));
    if (!root) return INVALID;
    const serverPem = read("server.pem");
    const server = boxLeafChain(serverPem, root, "server");
    const signer = boxSigner(read("ca.key"), root);
    if (
      !signer ||
      !server ||
      signer.cert.fingerprint256 !== server.signer.fingerprint256 ||
      !server.leaf.checkPrivateKey(createPrivateKey(serverPem))
    )
      return INVALID;
    if (![root, signer.cert, server.leaf].every((cert) => boxCertCurrent(cert, now)))
      return UNAVAILABLE;
  } catch (error) {
    if (errnoOf(error)?.startsWith("ERR_OSSL_")) return INVALID;
    throw error;
  }
  if (sealedState !== undefined) {
    let plaintext: Uint8Array;
    try {
      plaintext = await decryptArtifactAsync(
        sealedState.sealed,
        boxRecoveryKey ?? sealedState.archiveKey,
      );
    } catch (error) {
      if (!isAppError(error)) throw error;
      return error.code === "recovery.passphrase_invalid"
        ? { status: "unavailable", reason: "decryption_unavailable" }
        : INVALID;
    }
    let sealedEntries: ArchiveEntry[];
    try {
      sealedEntries = unpackArchive(plaintext);
    } catch (error) {
      if (!isAppError(error)) throw error;
      return INVALID;
    }
    return verifyBackupStateSecrets(sealedEntries, source, now);
  }
  return PASSED;
}
