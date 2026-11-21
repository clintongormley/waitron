import {
  enqueueMail,
  MAIL_LIFETIME_MS,
  readHistoryNodes,
  readSettings,
  readVenue,
  type Transaction,
} from "@waitron/db";
import { resolveVenueClock } from "@waitron/reporting";
import { formatMoney, nodeId } from "@waitron/shared";
import { DAILY_REPORT_MAIL_SETTINGS } from "./daily-report-mail-settings.js";
import { readStaffEmailRecipients } from "./manager-email-recipients.js";
import { readDailySalesFigures } from "./daily-sales-figures.js";
import { DAILY_REPORT_EMAIL_WORDS } from "./i18n/daily-report-email.js";
import type { MailKindOwner } from "./mail-sender.js";

export async function queueDailyReportMail(tx: Transaction, businessDay: string, now: Date) {
  const { doc } = await readSettings(tx, DAILY_REPORT_MAIL_SETTINGS);
  if (!doc.enabled) return;
  const recipients = await readStaffEmailRecipients(tx, "en", "report.view");
  for (const { personId } of recipients) {
    if (!doc.recipientIds.includes(personId)) continue;
    await enqueueMail(tx, {
      kind: "daily_report",
      dedupeKey: `daily-report:${businessDay}:${personId}`,
      personId,
      params: { businessDay },
      now,
      notAfter: new Date(now.getTime() + MAIL_LIFETIME_MS.daily_report),
    });
  }
}

interface PreparedReport {
  language: "en" | "es";
  venue: string;
  businessDay: string;
  figures: Awaited<ReturnType<typeof readDailySalesFigures>>;
}

export function dailyReportMail(deps: {
  venueLanguage: "en" | "es";
  nodeId: string;
}): MailKindOwner<PreparedReport> {
  return {
    kind: "daily_report",
    deliveryRule: "venue_smtp",
    retryDelaysMs: [60_000, 120_000, 240_000, 600_000],
    longestWaitMs: 600_000,
    async claim(tx, { personId, params: { businessDay } }) {
      if (personId === null || typeof businessDay !== "string") return null;
      const { doc } = await readSettings(tx, DAILY_REPORT_MAIL_SETTINGS);
      if (!doc.enabled || !doc.recipientIds.includes(personId)) return null;
      const [recipient] = await readStaffEmailRecipients(
        tx,
        deps.venueLanguage,
        "report.view",
        personId,
      );
      if (!recipient) return null;
      const clock = await resolveVenueClock(tx, deps.nodeId);
      const nodeIds = await readHistoryNodes(tx, nodeId(deps.nodeId));
      const figures = await readDailySalesFigures(tx, { ...clock, nodeIds, businessDay });
      return {
        recipient: recipient.email,
        prepared: {
          businessDay,
          figures,
          language: recipient.language,
          venue: (await readVenue(tx)).name,
        },
      };
    },
    async compose({ language, venue, businessDay, figures }) {
      const copy = DAILY_REPORT_EMAIL_WORDS[language];
      const {
        close: { vat, counts, departmentTakings },
        cash,
        closureSummary,
        topSellers,
        outsidePayments,
      } = figures;
      const money = (amount: string) => formatMoney(amount, language);
      const tender = ({
        method,
        amount,
        tip,
      }: (typeof cash.byOrigin)[number]["byMethod"][number]) =>
        `${copy.methods[method]}  ${money(amount)}  (${copy.tips} ${money(tip)})`;
      const subject = `${copy.title} · ${businessDay}`;
      return {
        subject,
        text: [
          venue,
          subject,
          "",
          `${copy.received}  ${money(closureSummary.received)}`,
          `${copy.deferred}  ${money(closureSummary.deferredPayments)}`,
          `${copy.tips}  ${money(cash.tipTotal)}`,
          `${copy.billsClosed}  ${closureSummary.billsClosed.count} · ${money(closureSummary.billsClosed.total)}`,
          `${copy.sales}  ${counts.sales}  |  ${copy.corrections}  ${counts.corrections}  |  ${copy.voids}  ${counts.voids}`,
          ...cash.byOrigin.flatMap((origin) => [
            "",
            origin.deviceName ?? copy.otherOrigin,
            ...origin.byMethod.map(tender),
          ]),
          ...(outsidePayments.length === 0
            ? []
            : [
                "",
                copy.outside,
                ...outsidePayments.map(
                  (payment) =>
                    `#${payment.orderNumber}  ${money(payment.amount)}  (${copy.refunded} ${money(payment.refunded)})`,
                ),
              ]),
          "",
          copy.vat,
          `${copy.rate}  ${copy.base}  ${copy.tax}`,
          ...vat.byRate.map(({ rate, base, tax }) => `${rate}%  ${money(base)}  ${money(tax)}`),
          `${copy.base}  ${money(vat.baseTotal)}  |  ${copy.tax}  ${money(vat.taxTotal)}`,
          `${copy.gross}  ${money(vat.grossTotal)}`,
          ...departmentTakings.flatMap((row) => [
            "",
            row.departmentName ?? copy.noDepartment,
            `${copy.billsClosed}  ${row.billsClosed.count} · ${money(row.billsClosed.total)}`,
            ...row.byMethod.map(tender),
          ]),
          "",
          copy.topSellers,
          ...topSellers.flatMap((row) => [
            `${row.name}  ${row.quantity}  ${money(row.total)}`,
            ...row.variants.map(
              (variant) => `  ${variant.name}  ${variant.quantity}  ${money(variant.total)}`,
            ),
          ]),
        ].join("\n"),
      };
    },
    async settle() {},
  };
}
