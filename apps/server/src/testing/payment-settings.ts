import { saveSettings, withTransaction, type Database } from "@waitron/db";
import { PAYMENTS_SETTINGS, readPaymentsSettings } from "@waitron/payments";

export function setTipsForTest(db: Database, tipsEnabled: boolean) {
  return withTransaction(db, async (tx) => {
    const { doc, revision } = await readPaymentsSettings(tx);
    await saveSettings(tx, PAYMENTS_SETTINGS, {
      doc: { ...doc, tipsEnabled },
      expectedRevision: revision,
      personId: null,
    });
  });
}
