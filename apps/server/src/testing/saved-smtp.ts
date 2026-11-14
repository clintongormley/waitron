import { putCredential, type KeyRing } from "@waitron/credentials";
import { readSettings, saveSettings, type Transaction } from "@waitron/db";
import { MAIL_SETTINGS } from "../mail-settings.js";

export async function saveSmtpForTest(
  tx: Transaction,
  ring: KeyRing,
  value: { url: string; from: string },
): Promise<void> {
  await putCredential(tx, ring, { purpose: "email.smtp", value: { url: value.url } });
  const { revision } = await readSettings(tx, MAIL_SETTINGS);
  await saveSettings(tx, MAIL_SETTINGS, {
    doc: { from: value.from },
    expectedRevision: revision,
    personId: null,
  });
}
