import { describe, expect, it } from "vitest";
import { isAppError } from "@waitron/shared";
import { assertSafePrimaryUrl, isBlockedIpLiteral, isLoopbackHost } from "./primary-url.js";

/**
 * SSRF guard for the operator-supplied `primaryUrl` on the UNAUTHENTICATED `POST /setup-api/adopt`.
 * Ruling 2 (resolved in the task brief's "Decision needed"):
 *   1. reject any scheme other than http/https;
 *   2. reject any literal IP in the private/link-local/CGNAT/metadata/0.0.0.0/8 ranges (BOTH schemes),
 *      except loopback;
 *   3. loopback host (localhost / 127.0.0.0/8 / ::1) — allow over http or https;
 *   4. non-loopback DNS hostname — allow over https, reject over http;
 *   5. public literal IP — allow over https, reject over http.
 */

function reason(raw: string): string {
  try {
    assertSafePrimaryUrl(raw);
    return "ALLOWED";
  } catch (error) {
    if (isAppError(error)) return error.code;
    throw error;
  }
}

describe("assertSafePrimaryUrl", () => {
  const allowed: Array<[string, string]> = [
    ["https to a public DNS host", "https://primary.example"],
    ["https to a public DNS host with a path", "https://primary.example/path/here"],
    ["https to a public literal IP", "https://93.184.216.34"],
    ["http to an IPv4 loopback literal with a port", "http://127.0.0.1:3000"],
    ["http to another 127.0.0.0/8 literal", "http://127.5.6.7"],
    ["http to localhost", "http://localhost"],
    ["https to localhost", "https://localhost"],
    ["http to the IPv6 loopback ::1", "http://[::1]:8080"],
  ];

  const rejected: Array<[string, string]> = [
    ["http to the cloud metadata endpoint", "http://169.254.169.254/latest/meta-data"],
    ["https to the cloud metadata endpoint", "https://169.254.169.254/latest"],
    ["http to a 10.0.0.0/8 literal", "http://10.0.0.5"],
    ["https to a 10.0.0.0/8 literal (private, both schemes)", "https://10.0.0.5"],
    ["http to a 192.168.0.0/16 literal", "http://192.168.1.1"],
    ["https to a 172.16.0.0/12 literal", "https://172.16.0.1"],
    ["https to a 100.64.0.0/10 CGNAT literal", "https://100.64.0.1"],
    ["https to a 0.0.0.0/8 literal", "https://0.0.0.0"],
    ["https to an IPv6 ULA (fc00::/7)", "https://[fc00::1]"],
    ["https to an IPv6 link-local (fe80::/10)", "https://[fe80::1]"],
    ["https to an IPv4-mapped IPv6 private literal", "https://[::ffff:10.0.0.5]"],
    ["https to an IPv4-compatible IPv6 metadata literal (::/96)", "https://[::169.254.169.254]"],
    ["https to an IPv4-compatible IPv6 private literal (::/96)", "https://[::10.0.0.5]"],
    ["http to a non-loopback DNS host", "http://primary.example"],
    ["a file: URL", "file:///etc/passwd"],
    ["an ftp: URL", "ftp://x"],
    ["a data: URL", "data:text/plain,hi"],
    ["an unparseable string", "not-a-url"],
    ["an empty string", ""],
  ];

  for (const [label, raw] of allowed) {
    it(`allows ${label} (${raw})`, () => {
      expect(reason(raw)).toBe("ALLOWED");
      // returns the parsed URL, not the raw string
      expect(assertSafePrimaryUrl(raw)).toBeInstanceOf(URL);
    });
  }

  for (const [label, raw] of rejected) {
    it(`rejects ${label} (${raw}) with mirror.primary_url_invalid`, () => {
      expect(reason(raw)).toBe("mirror.primary_url_invalid");
    });
  }
});

describe("isLoopbackHost", () => {
  it("recognises localhost, 127.0.0.0/8 and ::1", () => {
    expect(isLoopbackHost("localhost")).toBe(true);
    expect(isLoopbackHost("LocalHost")).toBe(true);
    expect(isLoopbackHost("127.0.0.1")).toBe(true);
    expect(isLoopbackHost("127.255.255.254")).toBe(true);
    expect(isLoopbackHost("::1")).toBe(true);
    expect(isLoopbackHost("[::1]")).toBe(true);
  });

  it("rejects non-loopback hosts", () => {
    expect(isLoopbackHost("primary.example")).toBe(false);
    expect(isLoopbackHost("10.0.0.5")).toBe(false);
    expect(isLoopbackHost("169.254.169.254")).toBe(false);
    expect(isLoopbackHost("128.0.0.1")).toBe(false);
  });
});

describe("isBlockedIpLiteral", () => {
  it("blocks private/link-local/CGNAT/metadata/0.0.0.0-8 literals", () => {
    for (const host of [
      "10.0.0.5",
      "172.16.0.1",
      "172.31.255.255",
      "192.168.1.1",
      "169.254.169.254",
      "100.64.0.1",
      "0.0.0.0",
      "fc00::1",
      "fd00::1",
      "fe80::1",
      "::ffff:10.0.0.5",
      "::169.254.169.254", // IPv4-compatible IPv6 (::/96) — deprecated but must not slip through
      "::10.0.0.5",
      "::", // the unspecified address, also inside ::/96
    ]) {
      expect(isBlockedIpLiteral(host)).toBe(true);
    }
  });

  it("does not block public literals, loopback, or DNS names", () => {
    // `::1` is inside the ::/96 block but is explicitly re-allowed as loopback (kept out of the blocked set).
    for (const host of ["93.184.216.34", "172.32.0.1", "127.0.0.1", "::1", "primary.example"]) {
      expect(isBlockedIpLiteral(host)).toBe(false);
    }
  });

  it("parses varied IPv6 forms without misclassifying public or malformed input", () => {
    // Public IPv6 in both the `::`-compressed and the full 8-group form → not blocked.
    expect(isBlockedIpLiteral("2001:db8::1")).toBe(false);
    expect(isBlockedIpLiteral("2001:0db8:0000:0000:0000:0000:0000:0001")).toBe(false);
    // A public IPv4-mapped literal → not blocked (the private-mapped case is blocked above).
    expect(isBlockedIpLiteral("::ffff:93.184.216.34")).toBe(false);
    // A %zone suffix on a link-local literal is stripped before classification → still blocked.
    expect(isBlockedIpLiteral("fe80::1%eth0")).toBe(true);
    // Malformed literals parse to null (not a literal IP), so they are not "blocked" — a non-loopback
    // DNS-name-shaped host is instead gated by the http/https rule in assertSafePrimaryUrl.
    for (const host of [
      "1:2:3", // too few groups, no `::`
      "1:2:3:4:5:6:7:8::", // `::` with no room for an all-zero group
      "1::2::3", // more than one `::`
      "gggg::1", // non-hex hextet
      "999.1.1.1", // octet out of range
      "::ffff:999.1.1.1", // embedded IPv4 group out of range
      "1.2.3.4:5", // a dot before any colon — not a valid embedded-IPv4 IPv6
    ]) {
      expect(isBlockedIpLiteral(host)).toBe(false);
    }
  });

  it("classifies a full public IPv6 literal by scheme via assertSafePrimaryUrl", () => {
    expect(reason("https://[2001:db8::1]")).toBe("ALLOWED");
    expect(reason("http://[2001:db8::1]")).toBe("mirror.primary_url_invalid");
  });
});
