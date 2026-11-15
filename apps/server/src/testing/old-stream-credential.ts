import { createCipheriv, randomBytes } from "node:crypto";
import { eq } from "drizzle-orm";
import { getCredential, venueCredentials, type KeyRing } from "@waitron/credentials";
import { readSettings, saveSettings, withTransaction, type Database } from "@waitron/db";

import { BACKUP_SETTINGS, type StoredStream } from "../backup-settings-document.js";

export async function omitStoredStreamField(
  db: Database,
  ring: KeyRing,
  field: string,
): Promise<void> {
  await withTransaction(db, async (tx) => {
    if (["endpoint", "region", "bucket", "prefix"].includes(field)) {
      const saved = await readSettings(tx, BACKUP_SETTINGS);
      const stream: Record<string, unknown> = { ...saved.doc.stream };
      delete stream[field];
      await saveSettings(tx, BACKUP_SETTINGS, {
        doc: { ...saved.doc, stream: stream as unknown as StoredStream },
        expectedRevision: saved.revision,
        personId: null,
      });
      return;
    }
    const value = await getCredential(tx, ring, { purpose: "backup.stream" });
    delete value[field];
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", ring.current.key, iv);
    cipher.setAAD(Buffer.from("backup.stream"));
    const ciphertext = Buffer.concat([cipher.update(JSON.stringify(value)), cipher.final()]);
    await tx
      .update(venueCredentials)
      .set({ ciphertext, iv, authTag: cipher.getAuthTag(), keyVersion: ring.current.version })
      .where(eq(venueCredentials.purpose, "backup.stream"));
  });
}
