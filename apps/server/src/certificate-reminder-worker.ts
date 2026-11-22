import { randomUUID } from "node:crypto";
import { readVenue, withTransaction, type Database, type Transaction } from "@waitron/db";
import type { FiscalCertificateSeat } from "@waitron/fiscal";
import type {
  CertificateReminderOutcome,
  CertificateReminderSender,
} from "./certificate-reminder-email.js";
import {
  cloudEmailLocale,
  type CloudEmail,
  type CloudEmailGrant,
  type CloudEmailOutcome,
} from "./cloud-email.js";
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
  send: CertificateReminderSender;
  cloud?: {
    enabled(): Promise<boolean>;
    resolveGrant(signal: AbortSignal): Promise<CloudEmailGrant | null>;
    send(
      grant: CloudEmailGrant,
      id: string,
      message: CloudEmail,
      signal: AbortSignal,
    ): Promise<CloudEmailOutcome>;
  };
}

export async function runCertificateReminderPass(
  deps: CertificateReminderPassDeps,
): Promise<{ processed: boolean; waitForHour?: true }> {
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
  let processed = false;
  while (active()) {
    // Commit the claim before sending so a crash mid-send cannot repeat the message.
    const claimed = await withTransaction(deps.db, async (tx) => {
      if ((cloud && !(await cloudAllowed(tx))) || !active()) return null;
      const recipients = await readManagerEmailRecipients(tx, deps.venueLanguage);
      const reminder = await deps.seat.reminders.claim(
        tx,
        { nodeId: deps.nodeId },
        recipients,
        deps.now(),
      );
      return reminder && { reminder, venue: cloud ? (await readVenue(tx)).name : "" };
    });
    if (claimed === null) break;
    const { reminder, venue } = claimed;
    processed = true;
    let outcome: CertificateReminderOutcome = "unknown";
    try {
      if (cloud && grant) {
        const { language, timeZone, expiresAt, facts } = reminder.notice;
        outcome = (
          await cloud.send(
            grant,
            randomUUID(),
            {
              class: "certificate_reminder",
              displayName: venue,
              locale: cloudEmailLocale(language),
              timeZone,
              expiresAt,
              facts,
              recipient: reminder.recipient,
            },
            deps.signal,
          )
        ).status;
      } else if (delivery.mode !== "unconfigured") {
        outcome = await deps.send({
          smtp: delivery.smtp,
          recipient: reminder.recipient,
          subject: reminder.subject,
          text: reminder.text,
        });
      }
    } catch {
      outcome = "unknown";
    }
    await withTransaction(deps.db, (tx) =>
      deps.seat.reminders.report(tx, { nodeId: deps.nodeId }, reminder.id, outcome, deps.now()),
    );
    if (cloud && outcome !== "sent") return { processed, waitForHour: true };
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
      const result = await runCertificateReminderPass({ ...deps, signal });
      return { nextDueAt: result.processed && !result.waitForHour ? now : null };
    },
  };
}
