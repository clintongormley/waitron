import {
  enqueueMail,
  MAIL_LIFETIME_MS,
  readMail,
  withTransaction,
  type Database,
} from "@waitron/db";
import { businessDayAt, businessDayBoundaryAt } from "@waitron/shared";
import { countMonthlyHoursIssues } from "@waitron/workforce";
import { MONTHLY_HOURS_EMAIL_WORDS } from "./i18n/monthly-hours-email.js";
import type { MailKindOwner } from "./mail-sender.js";
import { readStaffEmailRecipients } from "./manager-email-recipients.js";
import { nextMonthlyHoursClose } from "./monthly-hours-close.js";

type MonthlyClose = NonNullable<Awaited<ReturnType<typeof nextMonthlyHoursClose>>>;

export function monthlyHoursReminderAt({ clock, scheduledCloseAt }: MonthlyClose): Date {
  const day = businessDayAt(clock, new Date(Date.parse(scheduledCloseAt) - 1));
  return new Date(businessDayBoundaryAt(clock, day));
}

const mailKey = (close: MonthlyClose, personId: string) =>
  `monthly-hours-reminder:${close.period.start}:${close.scheduledCloseAt}:${personId}`;

export async function queueMonthlyHoursReminder(
  db: Database,
  close: MonthlyClose,
  now: () => Date,
  allowed: () => boolean,
): Promise<void> {
  const recipients = await readStaffEmailRecipients(db, "en", "workforce.correct");
  const pending: string[] = [];
  for (const { personId } of recipients) {
    if (!(await readMail(db, mailKey(close, personId)))) pending.push(personId);
  }
  if (pending.length === 0 || !(await countMonthlyHoursIssues(db, close.period))) return;

  await withTransaction(db, async (tx) => {
    if (!allowed()) return;
    const current = await nextMonthlyHoursClose(tx);
    if (
      current?.scheduledCloseAt !== close.scheduledCloseAt ||
      current.period.start !== close.period.start
    )
      return;
    const at = now();
    const closeAt = Date.parse(current.scheduledCloseAt);
    if (at < monthlyHoursReminderAt(current) || at.getTime() >= closeAt) return;
    for (const personId of pending) {
      await enqueueMail(tx, {
        kind: "monthly_hours_reminder",
        dedupeKey: mailKey(current, personId),
        personId,
        params: { periodStart: current.period.start, scheduledCloseAt: current.scheduledCloseAt },
        now: at,
        notAfter: new Date(
          Math.min(closeAt, at.getTime() + MAIL_LIFETIME_MS.monthly_hours_reminder),
        ),
      });
    }
  });
}

interface PreparedReminder {
  language: "en" | "es";
  close: MonthlyClose;
  count: number;
}

export function monthlyHoursReminderMail(deps: {
  managementOrigin: string;
  venueLanguage: "en" | "es";
}): MailKindOwner<PreparedReminder> {
  const hoursUrl = new URL("/hours", deps.managementOrigin).href;
  return {
    kind: "monthly_hours_reminder",
    deliveryRule: "venue_smtp",
    retryDelaysMs: [60_000, 120_000, 240_000, 600_000],
    longestWaitMs: 600_000,
    async claim(tx, { personId, params }, now) {
      if (personId === null) return null;
      const [recipient] = await readStaffEmailRecipients(
        tx,
        deps.venueLanguage,
        "workforce.correct",
        personId,
      );
      if (recipient === undefined) return null;
      const close = await nextMonthlyHoursClose(tx);
      if (
        close === null ||
        close.period.start !== params.periodStart ||
        close.scheduledCloseAt !== params.scheduledCloseAt ||
        now >= new Date(close.scheduledCloseAt) ||
        now < monthlyHoursReminderAt(close)
      )
        return null;
      const count = await countMonthlyHoursIssues(tx, close.period);
      if (count === 0) return null;
      return {
        recipient: recipient.email,
        prepared: { close, count, language: recipient.language },
      };
    },
    async compose({ close, count, language }) {
      const locale = language === "en" ? "en-GB" : "es-ES";
      const month = new Intl.DateTimeFormat(locale, {
        month: "long",
        year: "numeric",
        timeZone: "UTC",
      }).format(new Date(close.period.start));
      const date = new Intl.DateTimeFormat(locale, {
        dateStyle: "long",
        timeStyle: "short",
        hourCycle: "h23",
        timeZone: close.clock.timeZone,
      }).format(new Date(close.scheduledCloseAt));
      const words = MONTHLY_HOURS_EMAIL_WORDS[language];
      return { subject: words.subject(month), text: words.text(count, month, date, hoursUrl) };
    },
    async settle() {},
  };
}
