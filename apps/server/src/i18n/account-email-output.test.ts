import { describe, expect, it } from "vitest";
import { createAccountEmailSender } from "../account-email.js";
import { ACCOUNT_EMAIL_OUTPUTS } from "../../test/account-email-output.js";

describe("account email output", () => {
  it.each(ACCOUNT_EMAIL_OUTPUTS)(
    "keeps the complete $locale $purpose message",
    async ({ purpose, locale, message }) => {
      const sent: unknown[] = [];
      const sender = createAccountEmailSender(
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

      expect(sent).toEqual([message]);
    },
  );
});
