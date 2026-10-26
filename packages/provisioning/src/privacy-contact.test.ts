import { describe, expect, it } from "vitest";
import { isAppError, type PrivacyContactField } from "@waitron/shared";
import { privacyContactChecked } from "./privacy-contact.js";

describe("privacyContactChecked", () => {
  it.each<[PrivacyContactField, string, string | null]>([
    ["privacyNoticeUrl", "  https://example.com/privacy  ", "https://example.com/privacy"],
    ["privacyNoticeUrl", "HTTPS://EXAMPLE.COM/Privacy", "HTTPS://EXAMPLE.COM/Privacy"],
    ["privacyNoticeUrl", "", null],
    ["privacyEmail", "   ", null],
    [
      "privacyEmail",
      `jose${String.fromCodePoint(0x301)}@example.com`,
      `jos${String.fromCodePoint(0xe9)}@example.com`,
    ],
  ])("accepts %s %j as %j", (field, raw, value) => {
    expect(privacyContactChecked(field, raw)).toBe(value);
  });

  it.each<[PrivacyContactField, string, string]>([
    ["privacyNoticeUrl", "example.com/privacy", "web_address"],
    ["privacyNoticeUrl", "https://user:pw@example.com/p", "web_address"],
    ["privacyNoticeUrl", "https://example.com/" + "a".repeat(481), "length"],
    ["privacyEmail", "privacy@example", "email"],
    ["privacyEmail", "a@" + "b".repeat(250) + ".es", "length"],
  ])("refuses %s %j as %s", (field, raw, reason) => {
    let caught: unknown;
    try {
      privacyContactChecked(field, raw);
    } catch (error) {
      caught = error;
    }
    expect(isAppError(caught)).toBe(true);
    expect(caught).toMatchObject({ code: "venue.detail_invalid" });
    expect((caught as { params: unknown }).params).toEqual({ field, reason });
  });
});
