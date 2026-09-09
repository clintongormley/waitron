import { withTenant, type Database } from "@waitron/db";
import { tryGetCredential, type KeyRing } from "@waitron/credentials";
import type { TenantId } from "@waitron/shared";

export type EmailDelivery =
  | { mode: "smtp" | "local_capture"; smtp: { url: string; from: string } }
  | { mode: "unconfigured" };

const LOCAL_CAPTURE_SMTP = {
  url: "smtp://127.0.0.1:1025",
  from: "Waitron <no-reply@waitron.test>",
} as const;

/** Resolve outbound email immediately before use so credential changes do not require a restart. */
export async function resolveEmailDelivery(
  db: Database,
  ring: KeyRing,
  tenantId: TenantId,
  practiceMode: boolean,
): Promise<EmailDelivery> {
  const configured = await withTenant(db, tenantId, (tx) =>
    tryGetCredential(tx, ring, { tenantId, purpose: "email.smtp" }),
  );
  if (configured !== null) {
    return { mode: "smtp", smtp: { url: configured.url!, from: configured.from! } };
  }
  if (practiceMode) return { mode: "local_capture", smtp: LOCAL_CAPTURE_SMTP };
  return { mode: "unconfigured" };
}
