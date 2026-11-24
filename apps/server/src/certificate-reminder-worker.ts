import { withTransaction, type Database, type Transaction } from "@waitron/db";
import type { FiscalCertificateSeat } from "@waitron/fiscal";
import type { CloudEmailGrant } from "./cloud-email.js";
import { hasSavedSmtp, type EmailDelivery } from "./email-delivery.js";
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
  cloud?: {
    enabled(): Promise<boolean>;
    resolveGrant(signal: AbortSignal): Promise<CloudEmailGrant | null>;
  };
}

export async function runCertificateReminderPass(
  deps: CertificateReminderPassDeps,
): Promise<{ processed: boolean }> {
  const active = () => !deps.signal.aborted && deps.isPrimary();
  if (!active()) return { processed: false };
  const delivery = await deps.resolveDelivery();
  const cloud = delivery.mode === "unconfigured" ? deps.cloud : undefined;
  const cloudAllowed = async (tx: Transaction) =>
    cloud !== undefined && !(await hasSavedSmtp(tx)) && (await cloud.enabled());
  const grant =
    cloud && (await cloudAllowed(deps.db))
      ? await cloud.resolveGrant(deps.signal).catch(() => null)
      : null;
  if (delivery.mode === "unconfigured" && !grant) return { processed: false };
  const queued = await withTransaction(deps.db, async (tx) => {
    if ((cloud && !(await cloudAllowed(tx))) || !active()) return 0;
    const recipients = await readManagerEmailRecipients(tx, deps.venueLanguage);
    return deps.seat.reminders.queue(
      tx,
      { nodeId: deps.nodeId },
      recipients.map(({ personId }) => personId),
      deps.now(),
    );
  });
  return { processed: queued > 0 };
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
      const result = await runCertificateReminderPass({ ...deps, signal });
      return { nextDueAt: result.processed ? now : null };
    },
  };
}
