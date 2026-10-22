import { sendSmtpMessage, type SmtpConnection } from "./smtp-send.js";
import type { SmtpTestCode } from "./smtp-failure.js";

export type CertificateReminderOutcome = "sent" | "rejected" | "unknown";
export type CertificateReminderSender = (message: {
  smtp: SmtpConnection;
  recipient: string;
  subject: string;
  text: string;
}) => Promise<CertificateReminderOutcome>;

export function createCertificateReminderSender(
  options: { onFailure?: (reason: SmtpTestCode) => void } = {},
): CertificateReminderSender {
  return async ({ smtp, recipient, subject, text }) => {
    const outcome = await sendSmtpMessage(smtp, { to: recipient, subject, text });
    if (outcome.status !== "sent") options.onFailure?.(outcome.reason);
    return outcome.status;
  };
}
