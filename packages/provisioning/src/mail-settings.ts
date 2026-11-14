import { putCredential, type KeyRing } from "@waitron/credentials";
import { defineSettingsDocument, readSettings, saveSettings, type Transaction } from "@waitron/db";

export interface MailDocument {
  from: string | null;
}

export const MAIL_SETTINGS = defineSettingsDocument<MailDocument>({
  module: "mail",
  version: 1,
  transfers: false,
  defaults: () => ({ from: null }),
  parse(value) {
    if (
      value === null ||
      typeof value !== "object" ||
      !("from" in value) ||
      (value.from !== null && typeof value.from !== "string")
    )
      return { ok: false, field: "from" };
    return { ok: true, doc: { from: value.from } };
  },
});

export async function saveSmtpSettings(
  tx: Transaction,
  ring: KeyRing,
  value: { url: string; from: string },
  personId: string | null,
): Promise<void> {
  await putCredential(tx, ring, { purpose: "email.smtp", value: { url: value.url } });
  const { revision } = await readSettings(tx, MAIL_SETTINGS);
  await saveSettings(tx, MAIL_SETTINGS, {
    doc: { from: value.from },
    expectedRevision: revision,
    personId,
  });
}
