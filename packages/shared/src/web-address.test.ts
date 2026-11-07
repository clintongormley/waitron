import { describe, expect, it } from "vitest";
import { isPlainWebAddress } from "./web-address.js";

describe("isPlainWebAddress", () => {
  it.each([
    ["a user name and password", "https://user:secret@h.test"],
    ["a user name", "https://user@h.test"],
    ["a password", "https://:secret@h.test"],
    ["a query", "https://h.test/?x"],
    ["a fragment", "https://h.test/#x"],
    ["a bare ?", "https://h.test?"],
    ["a bare #", "https://h.test#"],
    ["a bare ? after a path", "https://h.test/path?"],
    ["no scheme", "h.test"],
    ["another scheme", "ftp://h.test"],
    ["text before the scheme", "xhttps://h.test"],
    ["no slashes", "https:h.test"],
    ["one slash", "https:/h.test"],
    ["backslashes", "https:\\\\h.test"],
    ["a third slash", "https:///h.test"],
    ["a backslash after the slashes", "https://\\h.test"],
    ["a tab, which URL drops", "https://h.te\tst"],
    ["a NUL in the path", "https://h.test/\x00"],
    ["a unit separator in the path", "https://h.test/\x1f"],
    ["a DEL in the path", "https://h.test/\x7f"],
    ["a host URL cannot read", "https://h test"],
  ])("refuses an address with %s", (_case, value) => {
    expect(isPlainWebAddress(value)).toBe(false);
  });

  // `https://@host` names no user or password, so it carries nothing that could be a secret.
  it.each([
    "https://h.test",
    "http://h.test",
    "HTTPS://H.TEST",
    "Http://h.test",
    "https://h.test:9000/path",
    "https://@h.test",
  ])("accepts %s", (value) => {
    expect(isPlainWebAddress(value)).toBe(true);
  });
});
