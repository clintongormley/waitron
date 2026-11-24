import { enqueueMail, type Transaction } from "@waitron/db";
import type { FiscalCertificateReminder } from "@waitron/fiscal";
import {
  calendarDaysLeft,
  localDate,
  nextLocalMidnight,
  reminderPeriod,
  type CertificateStage,
} from "./certificate-dates.js";
import { venueTimeZone } from "./certificate-install.js";
import { latestInstall } from "./certificate-record.js";

type Language = "en" | "es";

const DAY_MS = 86_400_000;
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

export async function queueReminders(
  tx: Transaction,
  { nodeId }: { nodeId: string },
  personIds: readonly string[],
  now: Date,
): Promise<number> {
  const install = await latestInstall(tx, nodeId);
  if (install === null) return 0;
  const timeZone = await venueTimeZone(tx);
  const schedule = reminderPeriod(install.kind, now, install.validUntil, timeZone);
  if (schedule === null) return 0;

  const { stage, period, endsAt } = schedule;
  const params = { stage, validUntil: install.validUntil.toISOString(), timeZone };
  const notAfter = new Date(endsAt);
  let queued = 0;
  for (const personId of [...personIds].sort()) {
    const result = await enqueueMail(tx, {
      kind: "certificate_reminder",
      dedupeKey: `certificate:${install.id}:${period}:${personId}`,
      subjectId: install.id,
      personId,
      params,
      notAfter,
      now,
    });
    if (result.queued) queued++;
  }
  return queued;
}

export async function currentReminderInstall(
  tx: Transaction,
  nodeId: string,
): Promise<string | null> {
  return (await latestInstall(tx, nodeId))?.id ?? null;
}

export function wordReminder({
  params,
  language,
  now,
}: {
  params: Readonly<Record<string, unknown>>;
  language: Language;
  now: Date;
}): FiscalCertificateReminder {
  const {
    stage,
    validUntil: expiry,
    timeZone,
  } = params as {
    stage: CertificateStage;
    validUntil: string;
    timeZone: string;
  };
  const validUntil = new Date(expiry);
  const date = localDate(validUntil, timeZone);
  const days = calendarDaysLeft(now, validUntil, timeZone);
  const expired = stage === "expired";
  const deadline = expired
    ? now.getTime() + DAY_MS
    : Math.min(validUntil.getTime(), Date.parse(nextLocalMidnight(now, timeZone)));
  return {
    ...wording(language, expired, formatDay(date, language), days),
    notice: {
      language,
      timeZone,
      expiresAt: new Date(deadline).toISOString(),
      facts: expired ? { stage: "expired", date } : { stage: "due", date, daysLeft: days },
    },
  };
}
