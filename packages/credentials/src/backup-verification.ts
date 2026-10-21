import type { BackupQuery, BackupRow } from "@waitron/store";
import { isAppError } from "@waitron/shared";
import { aadFor, open } from "./cipher.js";
import { keyForVersion, loadKeyRing, type KeyRing } from "./keyring.js";
import { isPurpose, PURPOSES, validatePayload } from "./purposes.js";

type Refusal = "invalid" | "unsupported" | "unavailable";
export class BackupCredentialReadError extends Error {
  constructor(readonly status: Refusal) {
    super("Backup credential could not be checked");
    this.name = "BackupCredentialReadError";
  }
}

export const CREDENTIALS_BACKUP_POLICY = {
  version: 1,
  publicEvidenceDigest: null,
  data: {
    kind: "custom",
    tables: ["tenant_credentials"],
    immutableTables: [],
    checks: ["data", "secret"],
  },
  secrets: Object.keys(PURPOSES).map((purpose) => `vault:${purpose}`),
  entries: [
    { name: "secrets/secrets.env", presence: "required" },
    { name: "secrets/trading.env", presence: "required" },
    { name: "secrets/backup.env", presence: "optional" },
  ],
  effects: [],
  zeroSchema: "absent_tables_and_entries",
  targetOnly: "unsupported",
} as const;

function ringFor(inputs: Readonly<Record<string, string>>): KeyRing {
  try {
    return loadKeyRing(inputs);
  } catch (error) {
    if (!isAppError(error)) throw error;
    throw new BackupCredentialReadError("unavailable");
  }
}

function decrypt(
  row: BackupRow,
  keyInputs: Readonly<Record<string, string>>,
): Readonly<Record<string, string>> {
  if (
    typeof row.purpose !== "string" ||
    row.purpose === "" ||
    !(row.ciphertext instanceof Uint8Array) ||
    !(row.iv instanceof Uint8Array) ||
    !(row.auth_tag instanceof Uint8Array) ||
    row.iv.length !== 12 ||
    row.auth_tag.length !== 16 ||
    (typeof row.key_version !== "bigint" && typeof row.key_version !== "number") ||
    !Number.isSafeInteger(Number(row.key_version)) ||
    Number(row.key_version) < 1
  ) {
    throw new BackupCredentialReadError("invalid");
  }
  if (!isPurpose(row.purpose)) throw new BackupCredentialReadError("unsupported");
  const key = keyForVersion(ringFor(keyInputs), Number(row.key_version));
  if (key === null) throw new BackupCredentialReadError("unavailable");
  const plaintext = open(key, aadFor(row.purpose), {
    ciphertext: row.ciphertext,
    iv: row.iv,
    authTag: row.auth_tag,
  });
  if (plaintext === null) throw new BackupCredentialReadError("unavailable");
  let payload: unknown;
  try {
    payload = JSON.parse(plaintext);
  } catch {
    throw new BackupCredentialReadError("invalid");
  }
  if (payload === null || typeof payload !== "object" || Array.isArray(payload))
    throw new BackupCredentialReadError("invalid");
  try {
    validatePayload(row.purpose, payload as Record<string, unknown>);
  } catch (error) {
    if (!isAppError(error)) throw error;
    throw new BackupCredentialReadError("invalid");
  }
  return Object.freeze(payload as Record<string, string>);
}

export async function verifyBackupCredentials(
  query: BackupQuery,
  keyInputs: Readonly<Record<string, string>>,
): Promise<"passed" | Refusal> {
  let status: "passed" | Refusal = "passed";
  const priority = { passed: 0, invalid: 1, unsupported: 2, unavailable: 3 };
  for await (const row of query.rows(
    "select purpose, ciphertext, iv, auth_tag, key_version from tenant_credentials",
  )) {
    try {
      decrypt(row, keyInputs);
    } catch (error) {
      if (!(error instanceof BackupCredentialReadError)) throw error;
      if (priority[error.status] > priority[status]) status = error.status;
    }
  }
  return status;
}

export async function readBackupCredential(
  query: BackupQuery,
  keyInputs: Readonly<Record<string, string>>,
  purpose: string,
): Promise<Readonly<Record<string, string>> | null> {
  let result: Readonly<Record<string, string>> | null = null;
  for await (const row of query.rows(
    "select purpose, ciphertext, iv, auth_tag, key_version from tenant_credentials where purpose = ?",
    [purpose],
  )) {
    if (result !== null) throw new BackupCredentialReadError("invalid");
    result = decrypt(row, keyInputs);
  }
  return result;
}
