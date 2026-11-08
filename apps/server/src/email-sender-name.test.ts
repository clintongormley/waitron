import { describe, expect, it } from "vitest";
import nodemailer from "nodemailer";
import addressparser from "nodemailer/lib/addressparser/index.js";
import { venueSmtpFrom } from "./email-sender-name.js";

describe("venue SMTP sender", () => {
  it.each(["venue@example.test", "Old Name <venue@example.test>"])(
    "replaces the display name of %s while retaining the mailbox",
    (stored) => {
      expect(venueSmtpFrom(stored, "Bar & Kitchen")).toEqual({
        name: "Bar & Kitchen",
        address: "venue@example.test",
      });
    },
  );
  it.each([
    "",
    "not-an-email",
    "one@example.test, two@example.test",
    "Team: venue@example.test;",
    "venue@example.test\r\nBcc: other@example.test",
    "venue@example.test\n",
    "venue@example.test\r",
  ])("refuses unusable stored sender %j", (stored) => {
    expect(() => venueSmtpFrom(stored, "Venue")).toThrowError(
      expect.objectContaining({
        code: "server.credential_unusable",
        params: { purpose: "email.smtp", field: "from" },
      }),
    );
  });
  it.each([
    ['Cafe, "North" <room>; @ Hall', 'Cafe, "North" <room>; @ Hall'],
    ["Café — 東京", "Café — 東京"],
    ["Hall\r\nBcc: other@example.test", "Hall\r\nBcc: other@example.test"],
  ])(
    "serializes the venue name %j as one sender without injecting headers",
    async (name, expectedName) => {
      const transport = nodemailer.createTransport({ streamTransport: true, buffer: true });
      const mail = await transport.sendMail({
        from: venueSmtpFrom("old@example.test", name),
        to: "guest@example.test",
        subject: "Test",
        text: "Body",
      });
      const raw = (mail.message as Buffer).toString();
      const headers = raw.split("\r\n\r\n")[0]!;
      expect(headers).not.toMatch(/^Bcc:/im);
      const from = /^From: (.*(?:\r\n[ \t].*)*)/m.exec(headers)![1]!.replace(/\r\n[ \t]+/g, " ");
      const parsed = addressparser(from);
      const decodedName = parsed[0]!.name.replace(
        /=\?UTF-8\?([BQ])\?([^?]+)\?=/gi,
        (_word, encoding: string, encoded: string) =>
          encoding.toUpperCase() === "B"
            ? Buffer.from(encoded, "base64").toString("utf8")
            : Buffer.from(
                encoded
                  .replaceAll("_", " ")
                  .replace(/=([0-9a-f]{2})/gi, (_escape, hex: string) =>
                    String.fromCharCode(Number.parseInt(hex, 16)),
                  ),
                "binary",
              ).toString("utf8"),
      );
      expect(parsed).toHaveLength(1);
      expect(parsed[0]).toMatchObject({ address: "old@example.test" });
      expect(mail.envelope.from).toBe("old@example.test");
      expect(decodedName).toBe(expectedName);
    },
  );
});
