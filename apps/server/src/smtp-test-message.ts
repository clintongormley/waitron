import { sendSmtpMessage, type SmtpConnection } from "./smtp-send.js";
import type { SmtpTestCode } from "./smtp-failure.js";

export type SmtpTestResult = { accepted: true } | { accepted: false; code: SmtpTestCode };

export async function sendSmtpTestMessage(
  config: SmtpConnection,
  recipient: string,
  options: { timeoutMs?: number; ca?: string } = {},
): Promise<SmtpTestResult> {
  const outcome = await sendSmtpMessage(
    config,
    {
      to: recipient,
      subject: "Waitron email test",
      text: "Waitron can send email through this mail server. Check that this test message arrived.",
    },
    options,
  );
  return outcome.status === "sent" ? { accepted: true } : { accepted: false, code: outcome.reason };
}
