import { describe, expect, it } from "vitest";
import { composeAccountEmail, type AccountEmail } from "../account-email.js";
import { ACCOUNT_EMAIL_OUTPUTS } from "../../test/account-email-output.js";

import { sendSmtpMessage, type SmtpConnection, type SmtpTransport } from "../smtp-send.js";
function messageSender(
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

describe("account email output", () => {
  it.each(ACCOUNT_EMAIL_OUTPUTS)(
    "keeps the complete $locale $purpose message",
    async ({ purpose, locale, message }) => {
      const sent: unknown[] = [];
      const sender = messageSender(
        {
          url: "smtp://mail.example.test:587",
          from: "Waitron <hello@example.test>",
          timeZone: "UTC",
          privacyNoticeUrl: "https://restaurant.example/privacy?lang='en'&quote=\"x\"",
        },
        {
          sendMail(actual) {
            sent.push(actual);
            return Promise.resolve({ messageId: "fixture" });
          },
          close() {},
        },
      );

      await sender({
        purpose,
        locale,
        email: "ann@example.test",
        displayName: `Ann O'Brien <&> "Lewis"`,
        actionUrl: "https://dashboard.example.test/account?token=fixture&next='profile'",
        code: "123456",
        codeExpiresAt: "2026-09-08T12:10:00.000Z",
        expiresAt: "2026-09-08T12:30:00.000Z",
      });

      expect(sent).toStrictEqual([message]);
    },
  );
});
