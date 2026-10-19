import { and, eq, isNotNull, sql } from "drizzle-orm";
import { withTransaction, type Database } from "@waitron/db";
import type { FiscalCertificateSeat } from "@waitron/fiscal";
import { persons, roleHasPermission } from "@waitron/identity";
import type {
  CertificateReminderOutcome,
  CertificateReminderSender,
} from "./certificate-reminder-email.js";
import type { EmailDelivery } from "./email-delivery.js";
import { realSleep } from "./loop.js";

export interface CertificateReminderPassDeps {
  db: Database;
  seat: Pick<FiscalCertificateSeat, "reminders">;
  nodeId: string;
  locationId: string;
  venueLanguage: "en" | "es";
  now(): Date;
  isPrimary(): boolean;
  signal: AbortSignal;
  resolveDelivery(): Promise<EmailDelivery>;
  send: CertificateReminderSender;
}

export async function runCertificateReminderLoop(
  deps: CertificateReminderPassDeps & {
    onError(error: unknown): void;
    sleep?: (ms: number, signal: AbortSignal) => Promise<void>;
  },
): Promise<void> {
  const sleep = deps.sleep ?? realSleep;
  while (!deps.signal.aborted) {
    // A failed pass waits the idle hour, so a lasting fault is not retried twice a second.
    let processed = false;
    try {
      processed = (await runCertificateReminderPass(deps)).processed;
    } catch (error) {
      deps.onError(error);
    }
    if (deps.signal.aborted) break;
    try {
      await sleep(processed ? 500 : 3_600_000, deps.signal);
    } catch (error) {
      deps.onError(error);
    }
  }
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
      const people = await tx
        .select({
          id: persons.id,
          email: persons.email,
          locale: persons.locale,
          role: persons.role,
        })
        .from(persons)
        .where(
          and(
            eq(persons.status, "active"),
            isNotNull(persons.email),
            sql`length(trim(${persons.email})) > 0`,
          ),
        );
      const recipients = people
        .filter((person) => roleHasPermission(person.role, "system.manage"))
        .map((person) => ({
          personId: person.id,
          email: person.email!.trim(),
          language:
            person.locale === "es-ES"
              ? ("es" as const)
              : person.locale === "en-GB"
                ? ("en" as const)
                : deps.venueLanguage,
        }));
      return deps.seat.reminders.claim(
        tx,
        { nodeId: deps.nodeId, locationId: deps.locationId },
        recipients,
        deps.now(),
      );
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
