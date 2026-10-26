import { describe, expect, it } from "vitest";
import {
  PRIVACY_CONTACT_FIELDS,
  PRIVACY_CONTACT_MAX_LENGTH,
  privacyContactProblem,
  privacyContactValue,
  type PrivacyContactField,
  type PrivacyContactProblem,
} from "./privacy-contact.js";

describe("privacyContactValue", () => {
  it.each<[string, string | null]>([
    ["  https://example.com/privacy  ", "https://example.com/privacy"],
    ["", null],
    ["   ", null],
    ["\u00a0", null],
    ["jose\u0301@example.com", "jos\u00e9@example.com"],
  ])("reads %j as %j", (raw, value) => {
    expect(privacyContactValue(raw)).toBe(value);
  });
});

describe("privacyContactProblem", () => {
  it.each<[PrivacyContactField, string | null, PrivacyContactProblem | undefined]>([
    ["privacyNoticeUrl", "https://example.com/privacy", undefined],
    ["privacyNoticeUrl", "http://example.com", undefined],
    ["privacyNoticeUrl", "HTTPS://EXAMPLE.COM/Privacy", undefined],
    ["privacyNoticeUrl", "https://example.com/" + "a".repeat(480), undefined],
    ["privacyNoticeUrl", "https://example.com/" + "😀".repeat(480), undefined],
    ["privacyNoticeUrl", null, undefined],
    ["privacyNoticeUrl", "https://.", undefined],
    ["privacyNoticeUrl", "example.com/privacy", "web_address"],
    ["privacyNoticeUrl", "https:example.com", "web_address"],
    ["privacyNoticeUrl", "ftp://example.com", "web_address"],
    ["privacyNoticeUrl", "javascript:alert(1)", "web_address"],
    ["privacyNoticeUrl", "javascript:https://example.com", "web_address"],
    ["privacyNoticeUrl", "mailto:privacy@example.com", "web_address"],
    ["privacyNoticeUrl", "https://", "web_address"],
    ["privacyNoticeUrl", "https://example.com:99999/privacy", "web_address"],
    ["privacyNoticeUrl", "https:///example.com", "web_address"],
    ["privacyNoticeUrl", "https://\\example.com", "web_address"],
    ["privacyNoticeUrl", "https://user:pw@example.com/p", "web_address"],
    ["privacyNoticeUrl", "https://user@example.com/p", "web_address"],
    ["privacyNoticeUrl", "https://:pw@example.com/p", "web_address"],
    ["privacyNoticeUrl", "https://example.com/priv acy", "web_address"],
    ["privacyNoticeUrl", "https://example.com/a\u00a0b", "web_address"],
    ["privacyNoticeUrl", "https://example.com/a\tb", "web_address"],
    ["privacyNoticeUrl", "https://example.com/privacy\u200b", "web_address"],
    ["privacyNoticeUrl", "https://exam\u00adple.com/privacy", "web_address"],
    ["privacyNoticeUrl", "https://example.com/a\u200db", "web_address"],
    ["privacyNoticeUrl", "https://example.com/a\u2060b", "web_address"],
    ["privacyNoticeUrl", "https://example.com/a\ufeffb", "web_address"],
    ["privacyNoticeUrl", "https://example.com/" + "a".repeat(481), "length"],
    ["privacyNoticeUrl", "https://example.com/" + "😀".repeat(481), "length"],
    ["privacyEmail", "privacy@example.com", undefined],
    ["privacyEmail", "a@" + "b".repeat(249) + ".es", undefined],
    ["privacyEmail", null, undefined],
    ["privacyEmail", "privacy", "email"],
    ["privacyEmail", "privacy@example", "email"],
    ["privacyEmail", "a@b@example.com", "email"],
    ["privacyEmail", "pri vacy@example.com", "email"],
    ["privacyEmail", "privacy\u200b@example.com", "email"],
    ["privacyEmail", "a@" + "b".repeat(250) + ".es", "length"],
  ])("%s %j answers %j", (field, value, problem) => {
    expect(privacyContactProblem(field, value)).toBe(problem);
  });
});

it("names both fields and their limits", () => {
  expect(PRIVACY_CONTACT_MAX_LENGTH).toEqual({ privacyNoticeUrl: 500, privacyEmail: 254 });
  expect(PRIVACY_CONTACT_FIELDS).toEqual(["privacyNoticeUrl", "privacyEmail"]);
});
