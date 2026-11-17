import { createHash, randomBytes } from "node:crypto";
import { and, eq, isNull } from "drizzle-orm";
import type { Transaction } from "@waitron/db";
import { recoveryCodes } from "@waitron/db";

const RECOVERY_CODE_COUNT = 10;

export function recoveryHash(code: string): string {
  return createHash("sha256").update(code.replaceAll("-", "").toUpperCase(), "utf8").digest("hex");
}

export async function replaceRecoveryCodes(tx: Transaction, personId: string): Promise<string[]> {
  const codes = Array.from({ length: RECOVERY_CODE_COUNT }, () => {
    const raw = randomBytes(8).toString("hex").toUpperCase();
    return `${raw.slice(0, 4)}-${raw.slice(4, 8)}-${raw.slice(8, 12)}-${raw.slice(12)}`;
  });
  await tx.delete(recoveryCodes).where(eq(recoveryCodes.personId, personId));
  await tx
    .insert(recoveryCodes)
    .values(codes.map((code) => ({ personId, codeHash: recoveryHash(code) })));
  return codes;
}

export async function consumeRecoveryCode(
  tx: Transaction,
  personId: string,
  code: string,
): Promise<boolean> {
  const used = await tx
    .update(recoveryCodes)
    .set({ usedAt: new Date().toISOString() })
    .where(
      and(
        eq(recoveryCodes.personId, personId),
        eq(recoveryCodes.codeHash, recoveryHash(code)),
        isNull(recoveryCodes.usedAt),
      ),
    )
    .returning({ id: recoveryCodes.id });
  return used.length === 1;
}
