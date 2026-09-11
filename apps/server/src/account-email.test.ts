import { describe, expect, it, vi } from "vitest";
import { createAccountEmailSender } from "./account-email.js";

describe("account email", () => {
  it.each([
    ["2026-03-29T00:30:00.000Z", "01:30 CET"],
    ["2026-03-29T01:30:00.000Z", "03:30 CEST"],
  ])("formats expiry %s in the venue time zone", async (expiresAt, expected) => {
    const sendMail = vi.fn().mockResolvedValue({ messageId: "m1" });
    const sender = createAccountEmailSender(
      {
        url: "smtp://mail.example.test:587",
        from: "hello@example.test",
        timeZone: "Europe/Madrid",
      },
      { sendMail },
    );
    await sender({
      purpose: "email_change",
      email: "bea@example.test",
      displayName: "Bea",
      actionUrl: "https://dashboard.example.test/manage/profile",
      code: "123456",
      expiresAt,
      codeExpiresAt: expiresAt,
      locale: "en-GB",
    });
    const message = sendMail.mock.calls[0]![0] as { text: string; html: string };
    expect(message.text).toContain(`link expires at 29 Mar 2026, ${expected}`);
    expect(message.text).toContain(`code expires at 29 Mar 2026, ${expected}`);
    expect(message.html).toContain(expected);
    expect(message.text).not.toContain("UTC");
  });

  it("sends an invitation without putting the bearer URL in the subject", async () => {
    const sendMail = vi.fn().mockResolvedValue({ messageId: "m1" });
    const sender = createAccountEmailSender(
      {
        url: "smtp://mail.example.test:587",
        from: "Waitron <hello@example.test>",
        timeZone: "UTC",
      },
      { sendMail },
    );
    await sender({
      purpose: "invitation",
      email: "bea@example.test",
      displayName: "Bea",
      actionUrl: "https://dashboard.example.test/manage/account?token=secret-token",
      expiresAt: "2026-09-09T12:00:00.000Z",
      locale: "en-GB",
      privacyNoticeUrl: "https://restaurant.example/privacy",
    });
    expect(sendMail).toHaveBeenCalledWith(
      expect.objectContaining({
        from: "Waitron <hello@example.test>",
        to: "bea@example.test",
        subject: "Set up your Waitron account",
      }),
    );
    const message = sendMail.mock.calls[0]![0] as { subject: string; text: string; html: string };
    expect(message.subject).not.toContain("secret-token");
    expect(message.text).toContain("secret-token");
    expect(message.html).toContain("secret-token");
    expect(message.html).toContain('href="https://restaurant.example/privacy"');
  });

  it("uses password-reset wording for a reset action", async () => {
    const sendMail = vi.fn().mockResolvedValue({ messageId: "m1" });
    const sender = createAccountEmailSender(
      { url: "smtp://mail.example.test:587", from: "hello@example.test", timeZone: "UTC" },
      { sendMail },
    );
    await sender({
      purpose: "password_reset",
      email: "bea@example.test",
      displayName: "Bea",
      actionUrl: "https://dashboard.example.test/manage/account?token=secret-token",
      expiresAt: "2026-09-08T12:30:00.000Z",
      locale: "en-GB",
    });
    expect(sendMail).toHaveBeenCalledWith(
      expect.objectContaining({ subject: "Reset your Waitron password" }),
    );
  });

  it.each(["en-GB", "es-ES"])(
    "omits invitation-code instructions from a %s setup link",
    async (locale) => {
      const sendMail = vi.fn().mockResolvedValue({ messageId: "m1" });
      const sender = createAccountEmailSender(
        { url: "smtp://mail.example.test:587", from: "hello@example.test", timeZone: "UTC" },
        { sendMail },
      );
      await sender({
        purpose: "invitation",
        email: "bea@example.test",
        displayName: "Bea",
        actionUrl: "https://dashboard.example.test/manage/account?token=secret-token",
        code: "123456",
        codeExpiresAt: "2026-09-08T12:10:00.000Z",
        expiresAt: "2026-09-09T12:00:00.000Z",
        locale,
      });
      const message = sendMail.mock.calls[0]![0] as { text: string; html: string };
      expect(message.text).not.toContain("123456");
      expect(message.text).not.toContain("login screen");
      expect(message.html).not.toContain("123456");
      expect(message.text).toContain("secret-token");
      expect(message.html).toContain("secret-token");
      expect(message.text).toContain("UTC");
    },
  );

  it("explains how to confirm a replacement email", async () => {
    const sendMail = vi.fn().mockResolvedValue({ messageId: "m1" });
    const sender = createAccountEmailSender(
      { url: "smtp://mail.example.test:587", from: "hello@example.test", timeZone: "UTC" },
      { sendMail },
    );
    await sender({
      purpose: "email_change",
      email: "new@example.test",
      displayName: "Bea",
      actionUrl: "https://dashboard.example.test/",
      code: "123456",
      codeExpiresAt: "2026-09-08T12:10:00.000Z",
      expiresAt: "2026-09-08T12:30:00.000Z",
      locale: "en-GB",
    });
    expect(sendMail).toHaveBeenCalledWith(
      expect.objectContaining({
        to: "new@example.test",
        subject: "Confirm your new Waitron email",
      }),
    );
    const message = sendMail.mock.calls[0]![0] as { text: string };
    expect(message.text).toContain("Enter 123456 in your Waitron profile");
    expect(message.text).toContain("code expires at 8 Sept 2026, 12:10 UTC");
    expect(message.text).toContain("link expires at 8 Sept 2026, 12:30 UTC");
  });

  it("localises a Spanish recipient's invitation and expiry", async () => {
    const sendMail = vi.fn().mockResolvedValue({ messageId: "m1" });
    const sender = createAccountEmailSender(
      { url: "smtp://mail.example.test:587", from: "hello@example.test", timeZone: "UTC" },
      { sendMail },
    );
    await sender({
      purpose: "invitation",
      email: "bea@example.test",
      displayName: "Bea",
      actionUrl: "https://dashboard.example.test/manage/account?token=secret-token",
      expiresAt: "2026-09-09T12:00:00.000Z",
      locale: "es-ES",
    });
    const message = sendMail.mock.calls[0]![0] as { subject: string; text: string; html: string };
    expect(message.subject).toBe("Configura tu cuenta de Waitron");
    expect(message.text).toContain("Hola Bea");
    expect(message.text).toContain("9 sept 2026");
    expect(message.text).toContain("UTC");
  });
});
