import nodemailer from "nodemailer";
import { Socket } from "node:net";

export type CertificateReminderOutcome = "sent" | "rejected" | "unknown";
export type CertificateReminderSender = (message: {
  smtp: { url: string; from: string };
  recipient: string;
  subject: string;
  text: string;
}) => Promise<CertificateReminderOutcome>;

/** Only a 4xx or 5xx reply proves the server refused the message; anything else is `unknown`. */
export function createCertificateReminderSender(): CertificateReminderSender {
  return async ({ smtp, recipient, subject, text }) => {
    const socket = new Socket();
    const transport = nodemailer.createTransport({ url: smtp.url, socket });
    let timer: ReturnType<typeof setTimeout>;
    const timeout = new Promise<CertificateReminderOutcome>((resolve) => {
      timer = setTimeout(() => {
        resolve("unknown");
        socket.destroy();
        transport.close();
      }, 30_000);
    });
    try {
      const sending = transport
        .sendMail({ from: smtp.from, to: recipient, subject, text })
        .then<CertificateReminderOutcome, CertificateReminderOutcome>(
          () => "sent",
          (error: unknown) => {
            const code =
              typeof error === "object" && error !== null && "responseCode" in error
                ? error.responseCode
                : undefined;
            return typeof code === "number" && code >= 400 && code <= 599 ? "rejected" : "unknown";
          },
        );
      return await Promise.race([sending, timeout]);
    } finally {
      clearTimeout(timer!);
      socket.destroy();
      transport.close();
    }
  };
}
