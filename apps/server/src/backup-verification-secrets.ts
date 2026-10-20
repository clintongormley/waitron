import { createPrivateKey, X509Certificate } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { posix } from "node:path";
import { loadKeyRing, resolveBackupKeyInputs } from "@waitron/credentials";
import { parseModuleConfig } from "@waitron/module";
import { isAppError } from "@waitron/shared";
import { resolveAccountKey } from "./account-key.js";
import { decryptArtifact } from "./artifact-cipher.js";
import { unpackArchive, type ArchiveEntry } from "./backup-archive.js";
import { loadBackupConfig, loadRecoveryKey } from "./backup-config.js";
import type { BackupVerificationReason } from "./backup-verification-protocol.js";
import { loadBoxEnv } from "./box-env.js";
import { errnoOf } from "./errno.js";
import { ALL_MODULES } from "./modules.js";
import { readArtifactIdentity } from "./restore.js";
import { RECOVERY_FILES } from "./state-secrets.js";

type StateResult = {
  status: "passed" | "invalid" | "unsupported" | "unavailable";
  reason: BackupVerificationReason;
};
const PASSED: StateResult = { status: "passed", reason: "none" };
const INVALID: StateResult = { status: "invalid", reason: "secret_invalid" };
const UNSUPPORTED: StateResult = { status: "unsupported", reason: "secret_format_unsupported" };
const UNAVAILABLE: StateResult = { status: "unavailable", reason: "secret_unavailable" };

function inputs(entries: readonly ArchiveEntry[]): Readonly<Record<string, string>> {
  const read = (name: string) => entries.find((entry) => entry.name === "secrets/" + name)?.bytes;
  return resolveBackupKeyInputs({
    secretsEnv: read("secrets.env") ?? new Uint8Array(),
    tradingEnv: read("trading.env") ?? new Uint8Array(),
    backupEnv: read("backup.env") ?? null,
  });
}
function keys(env: Readonly<Record<string, string | undefined>>) {
  const ring = loadKeyRing(env);
  return { ring, account: resolveAccountKey(env, ring) };
}

export async function verifyBackupKeyPlacement(
  captured: readonly ArchiveEntry[],
  placedStateDir: string,
): Promise<"passed" | "unsupported" | "unavailable"> {
  try {
    const original = keys(inputs(captured));
    const placedEnv = await loadBoxEnv({}, placedStateDir);
    const retained = inputs(captured.filter((entry) => entry.name !== "secrets/backup.env"));
    if (!retained.WAITRON_CREDENTIALS_KEY && !placedEnv.WAITRON_CREDENTIALS_KEY)
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
  source: { nodeId: string; locationId: string },
  now: Date,
  sealedState?: { sealed: Uint8Array; recoveryKey: string },
): Promise<StateResult> {
  if (!Number.isFinite(now.getTime())) return UNAVAILABLE;
  const byName = new Map<string, ArchiveEntry>();
  for (const entry of entries) {
    const name = posix.normalize(entry.name);
    if (byName.has(name)) return INVALID;
    if (name === "secrets/cloud-connection.json" || name.startsWith("secrets/cloud-staff."))
      return UNSUPPORTED;
    byName.set(name, entry);
  }
  for (const name of RECOVERY_FILES) {
    const entry = byName.get("secrets/" + name);
    if (entry === undefined || entry.bytes.length === 0) return UNAVAILABLE;
  }
  try {
    const { node } = readArtifactIdentity(entries);
    if (node.nodeId !== source.nodeId || node.locationId !== source.locationId)
      return { status: "invalid", reason: "binding_mismatch" };
  } catch (error) {
    if (!isAppError(error)) throw error;
    return INVALID;
  }
  const env = inputs(entries);
  try {
    keys(env);
  } catch (error) {
    if (!isAppError(error)) throw error;
    return UNAVAILABLE;
  }
  try {
    loadRecoveryKey(env);
    loadBackupConfig(env, source.locationId);
    const config = byName.get("secrets/modules.json");
    if (config !== undefined) {
      const text = Buffer.from(config.bytes).toString("utf8");
      const raw: unknown = JSON.parse(text);
      if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return UNSUPPORTED;
      const record = raw as Record<string, unknown>;
      if (Object.keys(record).length !== 1 || !Object.hasOwn(record, "modules")) return UNSUPPORTED;
      const overrides = record.modules;
      if (overrides === null || typeof overrides !== "object" || Array.isArray(overrides))
        return UNSUPPORTED;
      const keyCount = [...text.matchAll(/"(?:[^"\\]|\\.)*"\s*:/g)].length;
      if (keyCount !== Object.keys(overrides).length + 1) return UNSUPPORTED;
      parseModuleConfig(raw, ALL_MODULES);
    }
  } catch (error) {
    if (!isAppError(error) && !(error instanceof SyntaxError)) throw error;
    return UNSUPPORTED;
  }
  try {
    const read = (name: string) => Buffer.from(byName.get("secrets/tls/" + name)!.bytes);
    const ca = new X509Certificate(read("ca.crt"));
    const server = new X509Certificate(read("server.crt"));
    if (
      !ca.checkPrivateKey(createPrivateKey(read("ca.key"))) ||
      !server.checkPrivateKey(createPrivateKey(read("server.key"))) ||
      !ca.ca ||
      !ca.verify(ca.publicKey) ||
      !server.checkIssued(ca) ||
      !server.verify(ca.publicKey)
    )
      return INVALID;
    if (
      [ca, server].some(
        (cert) =>
          Date.parse(cert.validFrom) > now.getTime() || Date.parse(cert.validTo) <= now.getTime(),
      )
    )
      return UNAVAILABLE;
  } catch (error) {
    if (errnoOf(error)?.startsWith("ERR_OSSL_")) return INVALID;
    throw error;
  }
  if (sealedState !== undefined) {
    let plaintext: Uint8Array;
    try {
      plaintext = decryptArtifact(sealedState.sealed, sealedState.recoveryKey);
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
