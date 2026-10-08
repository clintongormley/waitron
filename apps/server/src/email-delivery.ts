import { withTransaction, type Database } from "@waitron/db";
import { tryGetCredential, type KeyRing } from "@waitron/credentials";
import { credentialField } from "./credentials.js";
import type { OnboardingIntent } from "./trading-config.js";

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
  practiceMode: boolean,
): Promise<EmailDelivery> {
  const configured = await withTransaction(db, (tx) =>
    tryGetCredential(tx, ring, { purpose: "email.smtp" }),
  );
  if (configured !== null) {
    return {
      mode: "smtp",
      smtp: {
        url: credentialField(configured, "email.smtp", "url"),
        from: credentialField(configured, "email.smtp", "from"),
      },
    };
  }
  if (practiceMode) return { mode: "local_capture", smtp: LOCAL_CAPTURE_SMTP };
  return { mode: "unconfigured" };
}

export async function resolveInvoiceEmailDelivery(
  db: Database,
  ring: KeyRing,
  config: { onboardingIntent: OnboardingIntent | undefined; devMode: boolean },
): Promise<EmailDelivery> {
  if (config.devMode || config.onboardingIntent === "demo") {
    return { mode: "local_capture", smtp: LOCAL_CAPTURE_SMTP };
  }
  return resolveEmailDelivery(db, ring, config.onboardingIntent === "prepare");
}
