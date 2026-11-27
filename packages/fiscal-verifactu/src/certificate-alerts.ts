import type { Transaction } from "@waitron/db";
import type { OngoingAlert } from "@waitron/module";
import { calendarDaysLeft, certificateStage, localDate, stageSince } from "./certificate-dates.js";
import { venueTimeZone } from "./certificate-install.js";
import { latestInstall, type InstallRow } from "./certificate-record.js";
import { certificateRefusedAt } from "./certificate-refusal.js";
import "./errors.js";

const SCREEN = "venue-settings";

type CertificateAlert = OngoingAlert & { severity: "warning" | "error" };

/** AEAT's refusal of, and the expiry alerts for, the certificate `latestInstall` finds. Only dates
 * and a day count leave here: nothing that names the certificate's holder or serial. */
export async function certificateAlerts(
  tx: Transaction,
  deps: { nodeId: string },
  now: Date,
): Promise<CertificateAlert[]> {
  const row = await latestInstall(tx, deps.nodeId);
  if (row === null) return [];
  const refusedAt = await certificateRefusedAt(tx, row.fingerprint);
  const timeZone = await venueTimeZone(tx);
  const refused: CertificateAlert[] =
    refusedAt === null
      ? []
      : [
          {
            key: "fiscal.certificate_not_accepted",
            code: "fiscal.certificate_not_accepted",
            params: { date: localDate(refusedAt, timeZone) },
            severity: "error",
            since: refusedAt.toISOString(),
            screen: SCREEN,
          },
        ];
  return [...refused, ...expiryAlerts(row, now, timeZone)];
}

function expiryAlerts(row: InstallRow, now: Date, timeZone: string): CertificateAlert[] {
  const stage = certificateStage(row.kind, now, row.validUntil, timeZone);
  if (stage === null) return [];
  const date = localDate(row.validUntil, timeZone);
  if (stage === "expired") {
    return [
      {
        key: "fiscal.certificate_expired",
        code: "fiscal.certificate_expired",
        params: { date },
        severity: "error",
        since: row.validUntil.toISOString(),
        screen: SCREEN,
      },
    ];
  }
  return [
    {
      key: "fiscal.certificate_expiring",
      code: "fiscal.certificate_expiring",
      params: { days: calendarDaysLeft(now, row.validUntil, timeZone), date },
      severity: stage === "urgent" ? "error" : "warning",
      since: stageSince(row.kind, stage, row.validUntil, timeZone),
      screen: SCREEN,
    },
  ];
}
