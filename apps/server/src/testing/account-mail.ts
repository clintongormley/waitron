import { sql } from "drizzle-orm";
import { composeAccountEmail, type AccountEmail } from "../account-email.js";
import { accountActionMail } from "../account-mail.js";
import { runMailPass, type MailSenderDeps, type MailTransport } from "../mail-sender.js";
import { sendSmtpMessage, type SmtpConnection, type SmtpTransport } from "../smtp-send.js";

export function messageSender(
  config: SmtpConnection & { timeZone: string; privacyNoticeUrl?: string },
  transport: SmtpTransport,
) {
  return (message: AccountEmail) =>
    sendSmtpMessage(
      config,
      { to: message.email, ...composeAccountEmail(message, config) },
      { transport },
    );
}

export async function flushAccountMail(
  db: MailSenderDeps["db"],
  options: {
    codeKey?: Buffer;
    timeZone?: string;
    log?: MailSenderDeps["log"];
    smtp?: SmtpConnection;
    send?: MailTransport;
    onMessage?: (message: AccountEmail) => Promise<"sent" | "captured">;
  } = {},
) {
  const owner = accountActionMail({
    codeKey: options.codeKey,
    emailChangeUrl: "/",
    venueLocale: "en-GB",
    readTimeZone: async () => options.timeZone ?? "UTC",
    readPrivacyNoticeUrl: async () => null,
  });
  let delivered: AccountEmail;
  if (options.onMessage) {
    const compose = owner.compose.bind(owner);
    owner.compose = async (prepared, mail) => {
      const message = await compose(prepared, mail);
      delivered = {
        ...prepared.issued,
        locale: prepared.issued.locale ?? "en-GB",
        actionUrl: message.text.split("\n").find((line) => /^https?:/.test(line)) ?? "/",
      };
      return message;
    };
  }
  const count = db.all(sql`select id from outgoing_mail`).length;
  for (let i = 0; i <= count; i++) {
    const result = await runMailPass({
      db,
      owners: [owner],
      now: () => new Date(),
      isPrimary: () => true,
      signal: new AbortController().signal,
      log: options.log ?? (() => {}),
      resolveDelivery: async () => ({
        mode: "smtp",
        smtp: options.smtp ?? { url: "smtp://test", from: "test@example.test" },
      }),
      send:
        options.send ??
        (options.onMessage
          ? async () => {
              await options.onMessage!(delivered);
              return { status: "sent" };
            }
          : undefined),
    });
    if (!result.processed) break;
  }
}
