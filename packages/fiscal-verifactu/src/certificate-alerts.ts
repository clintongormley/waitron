import { credentialRevision } from "@waitron/credentials";
import type { Transaction } from "@waitron/db";
import type { OngoingAlert } from "@waitron/module";
import { calendarDaysLeft, certificateStage, localDate, stageSince } from "./certificate-dates.js";
import { venueTimeZone } from "./certificate-install.js";
import { latestInstall } from "./certificate-record.js";
import { certificateRefusedAt } from "./certificate-refusal.js";
import "./errors.js";

const SCREEN = "venue-settings";

type CertificateAlert = OngoingAlert & { severity: "warning" | "error" };

/** AEAT's refusal of the vault's certificate, and the expiry alerts for the certificate
 * `latestInstall` finds. Only dates and a day count leave here: nothing that names the
 * certificate's holder or serial. */
export async function certificateAlerts(
  tx: Transaction,
  deps: { nodeId: string },
  now: Date,
): Promise<CertificateAlert[]> {
  const timeZone = await venueTimeZone(tx);
  const refusedAt = await certificateRefusedAt(
    tx,
    await credentialRevision(tx, { purpose: "fiscal.aeat" }),
  );
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
  return [...refused, ...(await expiryAlerts(tx, deps.nodeId, now, timeZone))];
}

async function expiryAlerts(
  tx: Transaction,
  nodeId: string,
  now: Date,
  timeZone: string,
): Promise<CertificateAlert[]> {
  const row = await latestInstall(tx, nodeId);
  if (row === null) return [];
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
