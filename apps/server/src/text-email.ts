import { sendSmtpMessage, type SmtpConnection } from "./smtp-send.js";
import type { SmtpTestCode } from "./smtp-failure.js";

export type TextEmailOutcome = "sent" | "rejected" | "unknown";
export type TextEmailSender = (message: {
  smtp: SmtpConnection;
  recipient: string;
  subject: string;
  text: string;
}) => Promise<TextEmailOutcome>;

export function createTextEmailSender(
  options: { onFailure?: (reason: SmtpTestCode) => void } = {},
): TextEmailSender {
  return async ({ smtp, recipient, subject, text }) => {
    const outcome = await sendSmtpMessage(smtp, { to: recipient, subject, text });
    if (outcome.status !== "sent") {
      try {
        options.onFailure?.(outcome.reason);
      } catch {
        // Diagnostics must not change whether a worker may retry this message.
      }
    }
    return outcome.status;
  };
}
