import { randomUUID } from "node:crypto";
import { enqueueMail, MAIL_LIFETIME_MS, type Transaction } from "@waitron/db";

type SecurityChange =
  | "password_changed"
  | "passkey_added"
  | "passkey_removed"
  | "authenticator_set_up"
  | "authenticator_removed"
  | "recovery_codes_regenerated"
  | "email_changed"
  | "google_connected"
  | "google_disconnected";

export async function queueSecurityChangeMail(
  tx: Transaction,
  input: { personId: string; change: SecurityChange },
): Promise<void> {
  const now = new Date();
  await enqueueMail(tx, {
    kind: "security_change",
    dedupeKey: `security-change:${randomUUID()}`,
    personId: input.personId,
    params: { change: input.change },
    now,
    notAfter: new Date(now.getTime() + MAIL_LIFETIME_MS.security_change),
  });
}
