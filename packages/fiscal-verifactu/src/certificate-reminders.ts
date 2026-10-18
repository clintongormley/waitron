import { and, eq } from "drizzle-orm";
import type { Transaction } from "@waitron/db";
import { calendarDaysLeft, certificateStage, localDate } from "./certificate-dates.js";
import { venueTimeZone } from "./certificate-install.js";
import { latestInstall } from "./certificate-record.js";
import { fiscalCertificateReminders } from "./schema/certificate-reminders.js";

type Language = "en" | "es";
type Recipient = { personId: string; email: string; language: Language };
type Reminder = { id: string; recipient: string; subject: string; text: string };

const RETRY_AFTER_MS = 86_400_000;
const DAY_LOCALES: Record<Language, string> = { en: "en-GB", es: "es-ES" };

// The same options `@waitron/dashboard-kit`'s `{x:date}` uses, so the email and the alert write the
// day alike; its wording table lives in an app, which a module may not import.
function formatDay(day: string, language: Language): string {
  return new Intl.DateTimeFormat(DAY_LOCALES[language], {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${day}T00:00:00.000Z`));
}

function wording(
  language: Language,
  expired: boolean,
  date: string,
  days: number,
): { subject: string; text: string } {
  if (expired) {
    return language === "es"
      ? {
          subject: `El certificado de la AEAT caducó el ${date}`,
          text: `El certificado de la AEAT caducó el ${date}. Las ventas continúan, pero los registros fiscales esperan hasta que instales uno nuevo en Ajustes del local.`,
        }
      : {
          subject: `AEAT certificate expired on ${date}`,
          text: `The AEAT certificate expired on ${date}. Sales continue, but fiscal records wait until you install a new one in Venue settings.`,
        };
  }
  return language === "es"
    ? {
        subject: `El certificado de la AEAT caduca el ${date}`,
        text: `El certificado de la AEAT caduca el ${date}, dentro de ${days} día(s). Instala el nuevo en Ajustes del local antes de esa fecha o los registros fiscales quedarán en espera.`,
      }
    : {
        subject: `AEAT certificate expires on ${date}`,
        text: `The AEAT certificate expires on ${date}, in ${days} day(s). Install the new one in Venue settings before then, or fiscal records will wait.`,
      };
}

/** Claims the next expiry email due for the certificate `nodeId` installed last, or `null`. A
 * row left `claimed` or reported `unknown` is never claimed again, so a crashed send is not
 * repeated; a `failed` one is, once its report is more than a day old. */
export async function claimReminder(
  tx: Transaction,
  deps: { nodeId: string; locationId: string },
  recipients: readonly Recipient[],
  now: Date,
): Promise<Reminder | null> {
  const install = await latestInstall(tx, deps.nodeId);
  if (install === null) return null;
  const timeZone = await venueTimeZone(tx, deps.locationId);
  const stage = certificateStage(install.kind, now, install.validUntil, timeZone);
  if (stage === null) return null;
  const existing = await tx
    .select()
    .from(fiscalCertificateReminders)
    .where(
      and(
        eq(fiscalCertificateReminders.installId, install.id),
        eq(fiscalCertificateReminders.stage, stage),
      ),
    );
  const byPerson = new Map(existing.map((row) => [row.personId, row]));
  const ordered = [...recipients].sort((a, b) =>
    a.personId < b.personId ? -1 : a.personId > b.personId ? 1 : 0,
  );
  for (const recipient of ordered) {
    const row = byPerson.get(recipient.personId);
    let claimed: { id: string } | undefined;
    if (row === undefined) {
      [claimed] = await tx
        .insert(fiscalCertificateReminders)
        .values({
          nodeId: deps.nodeId,
          installId: install.id,
          stage,
          personId: recipient.personId,
          status: "claimed",
          claimedAt: now,
        })
        .onConflictDoNothing({
          target: [
            fiscalCertificateReminders.installId,
            fiscalCertificateReminders.stage,
            fiscalCertificateReminders.personId,
          ],
        })
        .returning({ id: fiscalCertificateReminders.id });
    } else if (
      row.status === "failed" &&
      row.reportedAt !== null &&
      now.getTime() - row.reportedAt.getTime() > RETRY_AFTER_MS
    ) {
      [claimed] = await tx
        .update(fiscalCertificateReminders)
        .set({ status: "claimed", claimedAt: now, reportedAt: null })
        .where(
          and(
            eq(fiscalCertificateReminders.id, row.id),
            eq(fiscalCertificateReminders.status, "failed"),
          ),
        )
        .returning({ id: fiscalCertificateReminders.id });
    }
    if (claimed === undefined) continue;
    const date = formatDay(localDate(install.validUntil, timeZone), recipient.language);
    const days = calendarDaysLeft(now, install.validUntil, timeZone);
    return {
      id: claimed.id,
      recipient: recipient.email,
      ...wording(recipient.language, stage === "expired", date, days),
    };
  }
  return null;
}

const STATUS = { sent: "sent", rejected: "failed", unknown: "unknown" } as const;

/** Records how a claimed send ended. A row no longer `claimed` is left as it is. */
export async function reportReminder(
  tx: Transaction,
  id: string,
  outcome: "sent" | "rejected" | "unknown",
  now: Date,
): Promise<void> {
  await tx
    .update(fiscalCertificateReminders)
    .set({ status: STATUS[outcome], reportedAt: now })
    .where(
      and(eq(fiscalCertificateReminders.id, id), eq(fiscalCertificateReminders.status, "claimed")),
    );
}
