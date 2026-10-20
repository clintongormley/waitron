import { expect, it } from "vitest";
import { parseEmailSettings } from "./email-settings.js";

const settings = {
  server: "smtp.example.test",
  port: 587,
  encryption: "starttls",
  user: "elena",
  password: "SYNTHETIC-password",
  from: "elena@example.test",
};
it.each([
  ["server", null],
  ["server", []],
  ["server", ""],
  ["server", "bad server.test"],
  ["server", "smtp://private:secret@example.test"],
  ["server", "[broken"],
  ["server", "example.test:9999"],
  ["server", "[0:0:0:0:0:0:0:1]"],
  ["port", null],
  ["port", "587"],
  ["port", 0],
  ["port", 65536],
  ["port", 587.5],
  ["encryption", null],
  ["encryption", ["tls"]],
  ["encryption", "none"],
  ["user", null],
  ["user", []],
  ["user", ""],
  ["password", null],
  ["password", []],
  ["password", ""],
  ["from", null],
  ["from", []],
  ["from", "bad"],
] as const)("refuses invalid SMTP %s without returning the supplied value %#", (field, value) => {
  expect(() => parseEmailSettings({ ...settings, [field]: value })).toThrowError(
    expect.objectContaining({ code: "email.settings_invalid", params: { field } }),
  );
});

it("keeps optional SMTP authentication absent and trims an IPv6 host and sender", () => {
  expect(
    parseEmailSettings({
      server: " [::1] ",
      port: 465,
      encryption: "tls",
      from: " owner@example.test ",
    }),
  ).toEqual({ url: "smtps://[::1]:465", from: "owner@example.test" });
});

it("preserves reserved characters in SMTP credentials through the URL boundary", () => {
  const result = parseEmailSettings({ ...settings, user: "elena:@+%", password: " p:@ ?#%" });
  const url = new URL(result.url);
  expect(decodeURIComponent(url.username)).toBe("elena:@+%");
  expect(decodeURIComponent(url.password)).toBe(" p:@ ?#%");
  expect(url.searchParams.get("requireTLS")).toBe("true");
  expect(result.from).toBe("elena@example.test");
});
