import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { and, eq, isNotNull, isNull } from "drizzle-orm";
import type { Transaction } from "@waitron/db";
import { AppError } from "@waitron/shared";
import { recoveryCodes } from "./schema/recovery-codes.js";
import { persons } from "./schema/persons.js";

const PREFIX = "v1";
const RECOVERY_CODE_COUNT = 10;

export interface TotpKeyEntry {
  key: Buffer;
  version: number;
}

export interface TotpKeyRing {
  current: TotpKeyEntry;
  previous?: TotpKeyEntry;
}

export function encryptTotpSecret(secret: string, entry: TotpKeyEntry): string {
  if (entry.key.length !== 32) throw new Error("TOTP encryption key must contain 32 bytes");
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", entry.key, iv);
  const ciphertext = Buffer.concat([cipher.update(secret, "utf8"), cipher.final()]);
  return [
    PREFIX,
    String(entry.version),
    iv.toString("base64url"),
    cipher.getAuthTag().toString("base64url"),
    ciphertext.toString("base64url"),
  ].join(".");
}

export function decryptTotpSecret(
  stored: string,
  ring?: TotpKeyRing,
): { secret: string; keyVersion: number } | null {
  if (!stored.startsWith(`${PREFIX}.`) || ring === undefined) return null;
  const parts = stored.split(".");
  if (parts.length !== 5) return null;
  const keyVersion = Number(parts[1]);
  if (!Number.isInteger(keyVersion)) return null;
  const entry =
    ring.current.version === keyVersion
      ? ring.current
      : ring.previous?.version === keyVersion
        ? ring.previous
        : undefined;
  if (entry?.key.length !== 32) return null;
  try {
    const decipher = createDecipheriv(
      "aes-256-gcm",
      entry.key,
      Buffer.from(parts[2]!, "base64url"),
    );
    decipher.setAuthTag(Buffer.from(parts[3]!, "base64url"));
    const secret = Buffer.concat([
      decipher.update(Buffer.from(parts[4]!, "base64url")),
      decipher.final(),
    ]).toString("utf8");
    return { secret, keyVersion };
  } catch {
    return null;
  }
}

/** Re-seal every TOTP secret that still uses the previous credential key before it is retired. */
export async function rotateTotpSecrets(
  tx: Transaction,
  tenantId: string,
  ring: TotpKeyRing,
): Promise<number> {
  const rows = await tx
    .select({ id: persons.id, stored: persons.totpSecret })
    .from(persons)
    .where(and(eq(persons.tenantId, tenantId), isNotNull(persons.totpSecret)))
    .for("update");
  let rotated = 0;
  for (const row of rows) {
    const opened = decryptTotpSecret(row.stored!, ring);
    if (opened === null) throw new AppError("totp.key_unavailable", { personId: row.id });
    if (opened.keyVersion === ring.current.version) continue;
    await tx
      .update(persons)
      .set({ totpSecret: encryptTotpSecret(opened.secret, ring.current) })
      .where(and(eq(persons.tenantId, tenantId), eq(persons.id, row.id)));
    rotated += 1;
  }
  return rotated;
}

function recoveryHash(code: string): string {
  return createHash("sha256").update(code.replaceAll("-", "").toUpperCase(), "utf8").digest("hex");
}

export async function replaceRecoveryCodes(
  tx: Transaction,
  tenantId: string,
  personId: string,
): Promise<string[]> {
  const codes = Array.from({ length: RECOVERY_CODE_COUNT }, () => {
    const raw = randomBytes(8).toString("hex").toUpperCase();
    return `${raw.slice(0, 4)}-${raw.slice(4, 8)}-${raw.slice(8, 12)}-${raw.slice(12)}`;
  });
  await tx
    .delete(recoveryCodes)
    .where(and(eq(recoveryCodes.tenantId, tenantId), eq(recoveryCodes.personId, personId)));
  await tx
    .insert(recoveryCodes)
    .values(codes.map((code) => ({ tenantId, personId, codeHash: recoveryHash(code) })));
  return codes;
}

export async function consumeRecoveryCode(
  tx: Transaction,
  tenantId: string,
  personId: string,
  code: string,
): Promise<boolean> {
  const used = await tx
    .update(recoveryCodes)
    .set({ usedAt: new Date().toISOString() })
    .where(
      and(
        eq(recoveryCodes.tenantId, tenantId),
        eq(recoveryCodes.personId, personId),
        eq(recoveryCodes.codeHash, recoveryHash(code)),
        isNull(recoveryCodes.usedAt),
      ),
    )
    .returning({ id: recoveryCodes.id });
  return used.length === 1;
}
