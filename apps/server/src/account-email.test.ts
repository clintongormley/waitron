import { describe, expect, it, vi } from "vitest";

import { composeAccountEmail } from "./account-email.js";
import { messageSender } from "./testing/account-mail.js";

describe("account email", () => {
  it.each([
    ["2026-03-29T00:30:00.000Z", "01:30 CET"],
    ["2026-03-29T01:30:00.000Z", "03:30 CEST"],
  ])("formats expiry %s in the venue time zone", async (expiresAt, expected) => {
    const sendMail = vi.fn().mockResolvedValue({ messageId: "m1" });
    const sender = messageSender(
      {
        url: "smtp://mail.example.test:587",
        from: "hello@example.test",
        timeZone: "Europe/Madrid",
      },
      { sendMail, close() {} },
    );
    const outcome = await sender({
      purpose: "email_change",
      email: "bea@example.test",
      displayName: "Bea",
      actionUrl: "https://dashboard.example.test/manage/profile",
      code: "123456",
      expiresAt,
      codeExpiresAt: expiresAt,
      locale: "en-GB",
    });
    expect(outcome).toEqual({ status: "sent" });
    const message = sendMail.mock.calls[0]![0] as { text: string; html: string };
    expect(message.text).toContain(`link expires at 29 Mar 2026, ${expected}`);
    expect(message.text).toContain(`code expires at 29 Mar 2026, ${expected}`);
    expect(message.html).toContain(expected);
    expect(message.text).not.toContain("UTC");
  });

  it("sends an invitation without putting the bearer URL in the subject", async () => {
    const sendMail = vi.fn().mockResolvedValue({ messageId: "m1" });
    const sender = messageSender(
      {
        url: "smtp://mail.example.test:587",
        from: "Waitron <hello@example.test>",
        timeZone: "UTC",
        privacyNoticeUrl: "https://restaurant.example/privacy",
      },
      { sendMail, close() {} },
    );
    await sender({
      purpose: "invitation",
      email: "bea@example.test",
      displayName: "Bea",
      actionUrl: "https://dashboard.example.test/manage/account?token=secret-token",
      expiresAt: "2026-09-09T12:00:00.000Z",
      locale: "en-GB",
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

  it("sends an invitation with no privacy notice when the settings hold no privacy page", async () => {
    const sendMail = vi.fn().mockResolvedValue({ messageId: "m1" });
    const sender = messageSender(
      {
        url: "smtp://mail.example.test:587",
        from: "Waitron <hello@example.test>",
        timeZone: "UTC",
      },
      { sendMail, close() {} },
    );
    await sender({
      purpose: "invitation",
      email: "bea@example.test",
      displayName: "Bea",
      actionUrl: "https://dashboard.example.test/manage/account?token=secret-token",
      expiresAt: "2026-09-09T12:00:00.000Z",
      locale: "en-GB",
    });
    const message = sendMail.mock.calls[0]![0] as { text: string; html: string };
    expect(message.text).not.toContain("Privacy notice");
    expect(message.html.match(/<a href/g)).toEqual(["<a href"]);
    expect(message.html).toContain(
      '<a href="https://dashboard.example.test/manage/account?token=secret-token">',
    );
  });

  it("uses password-reset wording for a reset action", async () => {
    const sendMail = vi.fn().mockResolvedValue({ messageId: "m1" });
    const sender = messageSender(
      { url: "smtp://mail.example.test:587", from: "hello@example.test", timeZone: "UTC" },
      { sendMail, close() {} },
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
      const sender = messageSender(
        { url: "smtp://mail.example.test:587", from: "hello@example.test", timeZone: "UTC" },
        { sendMail, close() {} },
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
    const sender = messageSender(
      { url: "smtp://mail.example.test:587", from: "hello@example.test", timeZone: "UTC" },
      { sendMail, close() {} },
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
    const sender = messageSender(
      { url: "smtp://mail.example.test:587", from: "hello@example.test", timeZone: "UTC" },
      { sendMail, close() {} },
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

  it("gives a Spanish recipient the code for a replacement email in Spanish", async () => {
    const sendMail = vi.fn().mockResolvedValue({ messageId: "m1" });
    const sender = messageSender(
      { url: "smtp://mail.example.test:587", from: "hello@example.test", timeZone: "UTC" },
      { sendMail, close() {} },
    );
    await sender({
      purpose: "email_change",
      email: "nuevo@example.test",
      displayName: "Bea",
      actionUrl: "https://dashboard.example.test/",
      code: "654321",
      codeExpiresAt: "2026-09-08T12:10:00.000Z",
      expiresAt: "2026-09-08T12:30:00.000Z",
      locale: "es-ES",
    });
    const message = sendMail.mock.calls[0]![0] as { subject: string; text: string; html: string };
    expect(message.subject).toBe("Confirma tu nuevo correo de Waitron");
    expect(message.text).toContain(
      "Introduce 654321 en tu perfil de Waitron. Este código caduca el 8 sept 2026, 12:10 UTC.",
    );
    expect(message.html).toContain(">Abre tu perfil de Waitron</a>");
  });
});

it("preserves a structured sender name in the account envelope", async () => {
  const sendMail = vi.fn().mockResolvedValue({});
  const from = { name: "Harbour Kitchen", address: "venue@example.test" };
  await messageSender(
    { url: "smtp://localhost", from, timeZone: "UTC" },
    { sendMail, close() {} },
  )({
    purpose: "invitation",
    email: "admin@example.test",
    displayName: "Admin",
    actionUrl: "https://venue.example.test/account",
    expiresAt: "2026-10-23T12:00:00Z",
    locale: "en-GB",
  });
  expect(sendMail).toHaveBeenCalledWith(expect.objectContaining({ from }));
});

describe("invitation roles", () => {
  const invitation = {
    purpose: "invitation" as const,
    email: "ana@example.test",
    displayName: "Ana",
    actionUrl: "https://dashboard.example.test/manage/account?token=secret-token",
    expiresAt: "2026-09-09T12:00:00.000Z",
  };
  const roles = [
    { builtInKey: "staff" as const, name: null },
    { builtInKey: null, name: "Bar <&" },
  ];

  it.each([
    ["en-GB", "Your roles: Staff, Bar <&.", "Your roles: Staff, Bar &lt;&amp;."],
    ["es-ES", "Tus roles: Empleado, Bar <&.", "Tus roles: Empleado, Bar &lt;&amp;."],
  ])("lists the roles an invitation gives in %s", (locale, text, html) => {
    const message = composeAccountEmail({ ...invitation, locale, roles }, { timeZone: "UTC" });
    const lines = message.text.split("\n");
    expect(lines.slice(0, 4)).toEqual([lines[0], "", text, ""]);
    expect(lines[4]).toMatch(/:$/);
    expect(message.html).toContain(`</p>\n<p>${html}</p>\n<p><a href=`);
  });

  it.each([[[]], [undefined]])("has no roles line for a person holding none (%j)", (held) => {
    const message = composeAccountEmail(
      { ...invitation, locale: "en-GB", ...(held === undefined ? {} : { roles: held }) },
      { timeZone: "UTC" },
    );
    expect(message.text).not.toContain("roles");
    expect(message.html).not.toContain("roles");
  });
});
