import { createCipheriv, randomBytes } from "node:crypto";
import { eq } from "drizzle-orm";
import { getCredential, tenantCredentials, type KeyRing } from "@waitron/credentials";
import { withTransaction, type Database } from "@waitron/db";

export async function omitStoredStreamField(
  db: Database,
  ring: KeyRing,
  field: string,
): Promise<void> {
  await withTransaction(db, async (tx) => {
    const value = await getCredential(tx, ring, { purpose: "backup.stream" });
    delete value[field];
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", ring.current.key, iv);
    cipher.setAAD(Buffer.from("backup.stream"));
    const ciphertext = Buffer.concat([cipher.update(JSON.stringify(value)), cipher.final()]);
    await tx
      .update(tenantCredentials)
      .set({ ciphertext, iv, authTag: cipher.getAuthTag(), keyVersion: ring.current.version })
      .where(eq(tenantCredentials.purpose, "backup.stream"));
  });
}
