// SSRF guard for the `primaryUrl` the unauthenticated `POST /setup-api/adopt` fetches a mirror
// bundle from. The policy:
//   1. only http and https;
//   2. a private, link-local, CGNAT, metadata or 0.0.0.0/8 literal IP is refused over either scheme;
//   3. a loopback host is allowed over either scheme;
//   4. any other host (DNS name or public literal IP) is allowed over https only.
// It stops literal-IP SSRF only; DNS rebinding is not defended (no resolve-time IP pinning).
import { BlockList, isIP } from "node:net";
import { AppError } from "@waitron/shared";
import "./errors.js";

// Rule 2. `::/96` covers the IPv4-compatible `::a.b.c.d` form; `check(addr, "ipv6")` decodes an
// IPv4-mapped `::ffff:a.b.c.d` against the IPv4 rules itself. `::1` falls inside `::/96`, so
// `isBlockedIpLiteral` excludes it explicitly.
const BLOCKED = new BlockList();
BLOCKED.addSubnet("10.0.0.0", 8, "ipv4");
BLOCKED.addSubnet("172.16.0.0", 12, "ipv4");
BLOCKED.addSubnet("192.168.0.0", 16, "ipv4");
BLOCKED.addSubnet("169.254.0.0", 16, "ipv4");
BLOCKED.addSubnet("100.64.0.0", 10, "ipv4");
BLOCKED.addSubnet("0.0.0.0", 8, "ipv4");
BLOCKED.addSubnet("fc00::", 7, "ipv6");
BLOCKED.addSubnet("fe80::", 10, "ipv6");
BLOCKED.addSubnet("::", 96, "ipv6");

// Two family-scoped lists, so an IPv4-mapped `::ffff:127.x` is NOT treated as loopback: one mixed
// list would decode it against the 127/8 rule.
const LOOPBACK_V4 = new BlockList();
LOOPBACK_V4.addSubnet("127.0.0.0", 8, "ipv4");
const LOOPBACK_V6 = new BlockList();
LOOPBACK_V6.addAddress("::1", "ipv6");

/**
 * Returns the parsed `URL`, or throws `mirror.primary_url_invalid` on anything the policy refuses or
 * cannot parse. The offending value is never echoed into the error: it is attacker-controlled.
 */
export function assertSafePrimaryUrl(raw: string): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw invalid();
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") throw invalid();

  const host = url.hostname.toLowerCase();

  if (isLoopbackHost(host)) return url;

  if (isBlockedIpLiteral(host)) throw invalid();

  if (url.protocol !== "https:") throw invalid();

  return url;
}

function invalid(): AppError {
  return new AppError("mirror.primary_url_invalid", {});
}

function stripLiteral(host: string): string {
  let h = host;
  if (h.startsWith("[") && h.endsWith("]")) h = h.slice(1, -1);
  const zone = h.indexOf("%");
  if (zone !== -1) h = h.slice(0, zone);
  return h;
}

/**
 * `localhost`, 127.0.0.0/8 or `::1`. Fail-closed for the mirror-bind guard, which passes the raw
 * `WAITRON_HTTP_HOST`: any spelling not recognised as loopback returns `false`.
 */
export function isLoopbackHost(host: string): boolean {
  const h = stripLiteral(host.toLowerCase());
  if (h === "localhost") return true;
  const kind = isIP(h);
  if (kind === 0) return false;
  return kind === 4 ? LOOPBACK_V4.check(h, "ipv4") : LOOPBACK_V6.check(h, "ipv6");
}

// True only for a literal IP in a rule-2 range; a DNS name returns false.
export function isBlockedIpLiteral(host: string): boolean {
  const h = stripLiteral(host.toLowerCase());
  const kind = isIP(h);
  if (kind === 0) return false;
  if (kind === 6 && LOOPBACK_V6.check(h, "ipv6")) return false;
  return BLOCKED.check(h, kind === 4 ? "ipv4" : "ipv6");
}
