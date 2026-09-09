import { describe, expect, it, vi } from "vitest";
import { createAccountEmailSender } from "./account-email.js";

describe("account email", () => {
  it("sends an invitation without putting the bearer URL in the subject", async () => {
    const sendMail = vi.fn().mockResolvedValue({ messageId: "m1" });
    const sender = createAccountEmailSender(
      { url: "smtp://mail.example.test:587", from: "Waitron <hello@example.test>" },
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
      { url: "smtp://mail.example.test:587", from: "hello@example.test" },
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

  it("states the short code expiry separately from the link expiry", async () => {
    const sendMail = vi.fn().mockResolvedValue({ messageId: "m1" });
    const sender = createAccountEmailSender(
      { url: "smtp://mail.example.test:587", from: "hello@example.test" },
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
      locale: "en-GB",
    });
    const message = sendMail.mock.calls[0]![0] as { text: string };
    expect(message.text).toContain("code expires at 8 Sept 2026, 12:10 UTC");
    expect(message.text).toContain("link expires at 9 Sept 2026, 12:00 UTC");
    expect(message.text).toContain("At the restaurant, enter 123456 on the Waitron login screen");
  });

  it("localises a Spanish recipient's invitation and expiry", async () => {
    const sendMail = vi.fn().mockResolvedValue({ messageId: "m1" });
    const sender = createAccountEmailSender(
      { url: "smtp://mail.example.test:587", from: "hello@example.test" },
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
