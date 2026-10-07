import nodemailer from "nodemailer";
import { Socket } from "node:net";

export type SmtpTestResult =
  { accepted: true } | { accepted: false; code: "email.test_refused" | "email.test_timeout" };

export async function sendSmtpTestMessage(
  config: { url: string; from: string },
  recipient: string,
  options: { timeoutMs?: number; ca?: string } = {},
): Promise<SmtpTestResult> {
  // Owning the socket lets the deadline close an unanswered SMTP exchange.
  const socket = new Socket();
  const transport = nodemailer.createTransport({
    url: config.url,
    socket,
    ...(options.ca === undefined ? {} : { tls: { ca: options.ca } }),
  });
  let timer: ReturnType<typeof setTimeout>;
  const timeout = new Promise<SmtpTestResult>((resolve) => {
    timer = setTimeout(() => {
      resolve({ accepted: false, code: "email.test_timeout" });
      socket.destroy();
      transport.close();
    }, options.timeoutMs ?? 30_000);
  });
  const sending = transport
    .sendMail({
      from: config.from,
      to: recipient,
      subject: "Waitron email test",
      text: "Waitron can send email through this mail server. Check that this test message arrived.",
    })
    .then<SmtpTestResult, SmtpTestResult>(
      () => ({ accepted: true }),
      () => ({ accepted: false, code: "email.test_refused" }),
    );
  try {
    return await Promise.race([sending, timeout]);
  } finally {
    clearTimeout(timer!);
    socket.destroy();
    transport.close();
  }
}
