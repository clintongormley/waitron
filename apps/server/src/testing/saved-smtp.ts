import type { KeyRing } from "@waitron/credentials";
import type { Transaction } from "@waitron/db";
import { saveSmtpSettings } from "../mail-settings.js";

export function saveSmtpForTest(
  tx: Transaction,
  ring: KeyRing,
  value: { url: string; from: string },
): Promise<void> {
  return saveSmtpSettings(tx, ring, value, null);
}
