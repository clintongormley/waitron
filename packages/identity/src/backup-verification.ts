import { createHmac, createPublicKey } from "node:crypto";
import { decodeCredentialPublicKey } from "@simplewebauthn/server/helpers";
import { compareBackupTables } from "@waitron/db";
import { loadKeyRing, resolveBackupKeyInputs } from "@waitron/credentials";
import { isAppError } from "@waitron/shared";
import {
  BackupCheckUnavailable,
  type BackupModuleStatus,
  type BackupVerificationContribution,
} from "@waitron/module";
import type { BackupQuery, BackupRow, BackupValue } from "@waitron/store";
import { decryptTotpSecret, type TotpKeyRing } from "./mfa.js";
import { IDENTITY_CLASSIFICATION } from "./classification.js";

export const IDENTITY_BACKUP_VERIFICATION: BackupVerificationContribution = {
  version: 1,
  publicEvidenceDigest: null,
  data: {
    kind: "custom",
    tables: IDENTITY_CLASSIFICATION.map((c) => c.table),
    immutableTables: [],
    checks: ["data", "secret"],
  },
  secrets: ["account:totp", "authenticator:representations"],
  entries: [
    { name: "secrets/secrets.env", presence: "required" },
    { name: "secrets/trading.env", presence: "required" },
    { name: "secrets/backup.env", presence: "optional" },
  ],
  effects: [],
  zeroSchema: "absent_tables_and_entries",
  targetOnly: "empty_after_migration",
  async verifyRestoredData(context) {
    const secretsEnv = await context.entries.read("secrets/secrets.env");
    const tradingEnv = await context.entries.read("secrets/trading.env");
    const backupEnv = await context.entries.read("secrets/backup.env");
    if (secretsEnv === null || tradingEnv === null)
      throw new BackupCheckUnavailable("secret_unavailable");
    const ring = totpRing(resolveBackupKeyInputs({ secretsEnv, tradingEnv, backupEnv }));
    const equal = await compareBackupTables({
      before: context.before,
      after: context.after,
      policies: IDENTITY_CLASSIFICATION.map(({ table }) => ({
        table,
        immutable: false,
        addedColumns: {},
      })),
    });
    const before = await checkIdentity(context.before, ring);
    const after = await checkIdentity(context.after, ring);
    const data = merge(equal ? "passed" : "invalid", before.data, after.data);
    const secret = merge(before.secret, after.secret);
    return {
      status: merge(data, secret),
      checks: [
        { code: "data", status: data },
        { code: "secret", status: secret },
      ],
    };
  },
};

function merge(...statuses: BackupModuleStatus[]): BackupModuleStatus {
  if (statuses.includes("unsupported")) return "unsupported";
  return statuses.includes("invalid") ? "invalid" : "passed";
}

function totpRing(inputs: Readonly<Record<string, string>>): TotpKeyRing {
  const encoded = inputs.WAITRON_ACCOUNT_KEY;
  let account: Buffer;
  if (encoded === undefined || encoded === "") {
    try {
      account = createHmac("sha256", loadKeyRing(inputs).current.key)
        .update("waitron.account-key.v1")
        .digest();
    } catch (error) {
      if (!isAppError(error)) throw error;
      throw new BackupCheckUnavailable("decryption_unavailable");
    }
  } else {
    account = Buffer.from(encoded, "base64");
    if (account.length !== 32 || account.toString("base64") !== encoded)
      throw new BackupCheckUnavailable("decryption_unavailable");
  }
  return {
    current: { version: 1, key: createHmac("sha256", account).update("waitron.totp.v1").digest() },
  };
}

function base64url(value: BackupValue | undefined): Buffer | null {
  if (typeof value !== "string" || !/^[A-Za-z0-9_-]+$/.test(value)) return null;
  const bytes = Buffer.from(value, "base64url");
  return bytes.toString("base64url") === value ? bytes : null;
}
function digest(value: BackupValue | undefined): boolean {
  return typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
}
function password(value: BackupValue | undefined): BackupModuleStatus {
  if (value === null) return "passed";
  if (typeof value !== "string") return "invalid";
  if (!value.startsWith("scrypt$") && value.includes("$")) return "unsupported";
  return /^scrypt\$[a-f0-9]{32}\$[a-f0-9]{64}$/.test(value) ? "passed" : "invalid";
}
function totp(value: BackupValue | undefined, ring: TotpKeyRing): BackupModuleStatus {
  if (value === null) return "passed";
  if (typeof value !== "string") return "invalid";
  const [format, version, iv, tag, ciphertext, ...extra] = value.split(".");
  if (format !== "v1" || version !== "1") return "unsupported";
  if (
    extra.length !== 0 ||
    base64url(iv)?.length !== 12 ||
    base64url(tag)?.length !== 16 ||
    ciphertext === undefined ||
    (ciphertext !== "" && base64url(ciphertext) === null)
  )
    return "invalid";
  const decrypted = decryptTotpSecret(value, ring);
  if (decrypted === null) throw new BackupCheckUnavailable("decryption_unavailable");
  const base32 =
    /^(?:[A-Z2-7]{8})*(?:[A-Z2-7][AEIMQUY4]|[A-Z2-7]{3}[AQ]|[A-Z2-7]{4}[ACEGIKMOQSUWY246]|[A-Z2-7]{6}[AIQY])?$/;
  return decrypted.secret !== "" && base32.test(decrypted.secret) ? "passed" : "invalid";
}
function passkey(row: BackupRow): BackupModuleStatus {
  if (
    base64url(row.credential_id) === null ||
    (typeof row.counter !== "number" && typeof row.counter !== "bigint") ||
    !Number.isSafeInteger(Number(row.counter)) ||
    Number(row.counter) < 0
  )
    return "invalid";
  if (row.transports !== null) {
    if (typeof row.transports !== "string") return "invalid";
    try {
      const transports: unknown = JSON.parse(row.transports);
      if (!Array.isArray(transports) || transports.some((t) => typeof t !== "string" || t === ""))
        return "invalid";
    } catch {
      return "invalid";
    }
  }
  const bytes = base64url(row.public_key);
  if (bytes === null) return "invalid";
  try {
    const key: unknown = decodeCredentialPublicKey(new Uint8Array(bytes));
    if (!(key instanceof Map)) return "invalid";
    const algorithm: unknown = key.get(3);
    const type: unknown = key.get(1);
    const curve: unknown = key.get(-1);
    const encoded = (index: number) => {
      const field: unknown = key.get(index);
      if (!(field instanceof Uint8Array) || field.length === 0)
        throw new Error("Invalid public key field");
      return Buffer.from(field).toString("base64url");
    };
    if (algorithm === -8 && type === 1 && curve === 6) {
      createPublicKey({ format: "jwk", key: { kty: "OKP", crv: "Ed25519", x: encoded(-2) } });
    } else if (algorithm === -7 && type === 2 && curve === 1) {
      createPublicKey({
        format: "jwk",
        key: { kty: "EC", crv: "P-256", x: encoded(-2), y: encoded(-3) },
      });
    } else if (algorithm === -257 && type === 3) {
      createPublicKey({ format: "jwk", key: { kty: "RSA", n: encoded(-1), e: encoded(-2) } });
    } else if (![-8, -7, -257].includes(algorithm as number)) {
      return typeof algorithm === "number" ? "unsupported" : "invalid";
    } else return "invalid";
  } catch {
    return "invalid";
  }
  return "passed";
}

async function checkIdentity(query: BackupQuery, ring: TotpKeyRing) {
  const tables = new Set<string>();
  for await (const row of query.rows("select name from sqlite_schema where type='table'"))
    tables.add(String(row.name));
  const persons = new Set<string>();
  let data: BackupModuleStatus = "passed",
    secret: BackupModuleStatus = "passed";
  if (tables.has("persons")) {
    for await (const row of query.rows("select * from persons")) {
      persons.add(String(row.id));
      data = merge(data, password(row.password_hash), password(row.pin_hash));
      secret = merge(secret, totp(row.totp_secret, ring));
    }
  }
  for (const { table } of IDENTITY_CLASSIFICATION) {
    if (table === "persons" || !tables.has(table)) continue;
    const identifier = '"' + table.replaceAll('"', '""') + '"';
    for await (const row of query.rows(`select * from ${identifier}`)) {
      if (
        Object.hasOwn(row, "person_id") &&
        row.person_id !== null &&
        !persons.has(String(row.person_id))
      )
        data = merge(data, "invalid");
      switch (table) {
        case "totp_enrollments":
          secret = merge(secret, totp(row.encrypted_secret, ring));
          break;
        case "webauthn_credentials":
          data = merge(data, passkey(row));
          break;
        case "sessions":
        case "management_sessions":
          if (!digest(row.token_hash)) data = merge(data, "invalid");
          break;
        case "recovery_codes":
          if (!digest(row.code_hash)) data = merge(data, "invalid");
          break;
        case "management_account_actions":
          if (!digest(row.token_hash) || (row.code_hash !== null && !digest(row.code_hash)))
            data = merge(data, "invalid");
          break;
        case "webauthn_challenges":
          if (base64url(row.challenge) === null) data = merge(data, "invalid");
          break;
        case "google_oidc_states":
          if (
            !digest(row.state_hash) ||
            base64url(row.nonce)?.length !== 32 ||
            base64url(row.verifier)?.length !== 48 ||
            (row.mode === "link" ? row.person_id === null : row.person_id !== null)
          )
            data = merge(data, "invalid");
          break;
      }
    }
  }
  return { data, secret };
}
