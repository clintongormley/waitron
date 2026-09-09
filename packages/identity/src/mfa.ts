import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { and, eq, isNull } from "drizzle-orm";
import type { Transaction } from "@waitron/db";
import { recoveryCodes } from "./schema/recovery-codes.js";

const PREFIX = "v1";
const RECOVERY_CODE_COUNT = 10;

export function encryptTotpSecret(secret: string, key: Buffer): string {
  if (key.length !== 32) throw new Error("TOTP encryption key must contain 32 bytes");
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(secret, "utf8"), cipher.final()]);
  return [
    PREFIX,
    iv.toString("base64url"),
    cipher.getAuthTag().toString("base64url"),
    ciphertext.toString("base64url"),
  ].join(".");
}

export function decryptTotpSecret(stored: string, key?: Buffer): string | null {
  if (!stored.startsWith(`${PREFIX}.`)) return stored;
  if (key?.length !== 32) return null;
  const parts = stored.split(".");
  if (parts.length !== 4) return null;
  try {
    const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(parts[1]!, "base64url"));
    decipher.setAuthTag(Buffer.from(parts[2]!, "base64url"));
    return Buffer.concat([
      decipher.update(Buffer.from(parts[3]!, "base64url")),
      decipher.final(),
    ]).toString("utf8");
  } catch {
    return null;
  }
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
