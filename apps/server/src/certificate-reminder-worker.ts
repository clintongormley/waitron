import { withTransaction, type Database } from "@waitron/db";
import type { FiscalCertificateSeat } from "@waitron/fiscal";
import type {
  CertificateReminderOutcome,
  CertificateReminderSender,
} from "./certificate-reminder-email.js";
import type { EmailDelivery } from "./email-delivery.js";
import type { JobDefinition } from "./job-runner.js";
import { readManagerEmailRecipients } from "./manager-email-recipients.js";

export interface CertificateReminderPassDeps {
  db: Database;
  seat: Pick<FiscalCertificateSeat, "reminders">;
  nodeId: string;
  venueLanguage: "en" | "es";
  now(): Date;
  isPrimary(): boolean;
  signal: AbortSignal;
  resolveDelivery(): Promise<EmailDelivery>;
  send: CertificateReminderSender;
}

export async function runCertificateReminderPass(
  deps: CertificateReminderPassDeps,
): Promise<{ processed: boolean }> {
  const active = () => !deps.signal.aborted && deps.isPrimary();
  if (!active()) return { processed: false };
  const delivery = await deps.resolveDelivery();
  if (delivery.mode === "unconfigured") return { processed: false };
  let processed = false;
  while (active()) {
    // The claim commits before SMTP starts, so a crash mid-send is never sent twice.
    const claimed = await withTransaction(deps.db, async (tx) => {
      if (!active()) return null;
      const recipients = await readManagerEmailRecipients(tx, deps.venueLanguage);
      return deps.seat.reminders.claim(tx, { nodeId: deps.nodeId }, recipients, deps.now());
    });
    if (claimed === null) break;
    processed = true;
    let outcome: CertificateReminderOutcome = "unknown";
    try {
      outcome = await deps.send({
        smtp: delivery.smtp,
        recipient: claimed.recipient,
        subject: claimed.subject,
        text: claimed.text,
      });
    } catch {
      outcome = "unknown";
    }
    await withTransaction(deps.db, (tx) =>
      deps.seat.reminders.report(tx, { nodeId: deps.nodeId }, claimed.id, outcome, deps.now()),
    );
  }
  return { processed };
}

export function certificateReminderJob(
  deps: Omit<CertificateReminderPassDeps, "signal">,
): JobDefinition {
  return {
    name: "fiscal.certificate_reminders",
    applies: deps.isPrimary,
    minSleepMs: 500,
    maxSleepMs: 3_600_000,
    backoff: { firstMs: 3_600_000, maxMs: 3_600_000 },
    async pass({ now, signal }) {
      return {
        nextDueAt: (await runCertificateReminderPass({ ...deps, signal })).processed ? now : null,
      };
    },
  };
}
