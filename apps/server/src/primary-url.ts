// SSRF guard for the operator-supplied `primaryUrl` that `POST /setup-api/adopt` (setup-api.ts) fetches
// a mirror bundle from. That route is UNAUTHENTICATED (mounted only in setup mode), so an attacker who can
// reach a mirror-in-setup would otherwise drive it to POST the admin credential body to ANY URL — the cloud
// metadata endpoint (169.254.169.254), an internal host, a non-http scheme. This validator is the single
// choke point: `assertSafePrimaryUrl` runs at the setup-api boundary BEFORE any fetch, and `fetchMirrorBundle`
// builds its request from the parsed `URL` this returns rather than re-concatenating the raw string.
//
// Ruling 2 (task brief "Decision needed", the controller's resolution):
//   1. reject any scheme other than http/https;
//   2. reject any literal IP in the private/link-local/CGNAT/metadata/0.0.0.0/8 ranges (BOTH schemes),
//      except loopback — an attacker controls the URL, so https to 169.254.169.254 is still SSRF;
//   3. loopback host (localhost / 127.0.0.0/8 / ::1) — allow over http OR https (the stand-in is localhost);
//   4. non-loopback DNS hostname — allow over https, reject over http (real hosting is https);
//   5. public literal IP — allow over https, reject over http.
//
// The IP CLASSIFICATION below is delegated to `node:net` (`isIP` + `BlockList`), the stdlib's own
// allow/deny-list IP machinery — no hand-rolled octet/hextet parsing. `BlockList.check(addr, 'ipv6')`
// matches an IPv4-mapped IPv6 literal (`::ffff:10.0.0.5`) against the IPv4 subnet rules automatically,
// which is exactly the mapped-decode the SSRF policy needs, so no extra code carries it.
import { BlockList, isIP } from "node:net";
import { AppError } from "@waitron/shared";
import "./errors.js";

// The blocked ranges (rule 2). One list, both families: IPv4 10/8, 172.16/12, 192.168/16, 169.254/16
// (link-local + cloud metadata), 100.64/10 (CGNAT), 0/8; IPv6 fc00::/7 (ULA), fe80::/10 (link-local).
// Loopback (127/8, ::1) is deliberately absent — it is allowed by `isLoopbackHost` before this is consulted.
const BLOCKED = new BlockList();
BLOCKED.addSubnet("10.0.0.0", 8, "ipv4");
BLOCKED.addSubnet("172.16.0.0", 12, "ipv4");
BLOCKED.addSubnet("192.168.0.0", 16, "ipv4");
BLOCKED.addSubnet("169.254.0.0", 16, "ipv4");
BLOCKED.addSubnet("100.64.0.0", 10, "ipv4");
BLOCKED.addSubnet("0.0.0.0", 8, "ipv4");
BLOCKED.addSubnet("fc00::", 7, "ipv6");
BLOCKED.addSubnet("fe80::", 10, "ipv6");

// Loopback (rule 3), kept in TWO family-scoped lists rather than one. A single mixed list would let
// `check(addr, 'ipv6')` match an IPv4-mapped literal (`::ffff:127.0.0.1`) against the 127/8 IPv4 rule via
// the mapped-decode above — which the hand-rolled predecessor did NOT treat as loopback. Splitting the
// families keeps a mapped `::ffff:127.x` out of the loopback set, preserving that exact behaviour.
const LOOPBACK_V4 = new BlockList();
LOOPBACK_V4.addSubnet("127.0.0.0", 8, "ipv4");
const LOOPBACK_V6 = new BlockList();
LOOPBACK_V6.addAddress("::1", "ipv6");

/**
 * Parse and validate an operator-supplied primary URL, returning the parsed `URL` on success.
 * Throws `mirror.primary_url_invalid` on anything the SSRF policy above refuses — a bad scheme, a
 * private/link-local/metadata literal IP, a non-loopback host over plain http, or unparseable input.
 * The offending value is NEVER echoed into the error (the `mirror.*` family's no-leak discipline): the
 * URL is attacker-controlled and could carry a credential in userinfo or an internal host in a log line.
 */
export function assertSafePrimaryUrl(raw: string): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw invalid();
  }

  // 1. scheme allowlist — everything but http/https is refused outright (file:, ftp:, data:, …).
  if (url.protocol !== "http:" && url.protocol !== "https:") throw invalid();

  const host = url.hostname.toLowerCase();

  // 3. loopback is allowed over either scheme (the stand-in primary is localhost).
  if (isLoopbackHost(host)) return url;

  // 2. a private/link-local/CGNAT/metadata literal IP is refused over BOTH schemes.
  if (isBlockedIpLiteral(host)) throw invalid();

  // 4 & 5. a non-loopback host (public literal IP or DNS name) is allowed only over https.
  if (url.protocol !== "https:") throw invalid();

  return url;
}

function invalid(): AppError {
  return new AppError("mirror.primary_url_invalid", {});
}

/**
 * Strip the surrounding `[...]` brackets and any trailing `%zone` from a URL hostname so `node:net`
 * (which accepts neither) can classify it. The WHATWG `url.hostname` for an IPv6 literal is bracketed
 * (`[::1]`), and a link-local literal may carry a `%eth0` zone id; both must go before `isIP`/`check`.
 */
function stripLiteral(host: string): string {
  let h = host;
  if (h.startsWith("[") && h.endsWith("]")) h = h.slice(1, -1);
  const zone = h.indexOf("%");
  if (zone !== -1) h = h.slice(0, zone);
  return h;
}

/**
 * True when `host` (a URL hostname, bracketed IPv6 accepted) is a loopback address: `localhost`, any
 * IPv4 in 127.0.0.0/8, or the IPv6 `::1`. Loopback is the one host the adopt policy allows over plain
 * http. Exported so the mirror-bind guard (`mirror-bind-guard.ts`) shares one definition of loopback.
 *
 * CONTRACT: the ideal input is a hostname already normalized by `new URL` (lowercased, no scheme, no
 * port, IPv6 without its `[...]` brackets — though a bracketed literal is tolerated). It is
 * deliberately FAIL-CLOSED for the mirror-bind caller, which feeds the RAW `WAITRON_HTTP_HOST` value:
 * any form NOT recognized as loopback returns `false` (treated as non-loopback). So the caller may
 * over-refuse an exotic loopback spelling but can NEVER wrongly accept a non-loopback host as
 * loopback — the safe direction for a bind guard.
 */
export function isLoopbackHost(host: string): boolean {
  const h = stripLiteral(host.toLowerCase());
  if (h === "localhost") return true;
  const kind = isIP(h);
  if (kind === 0) return false;
  return kind === 4 ? LOOPBACK_V4.check(h, "ipv4") : LOOPBACK_V6.check(h, "ipv6");
}

/**
 * True when `host` is a LITERAL IP (v4, v6, or IPv4-mapped v6) inside a private, link-local, CGNAT,
 * metadata, or `0.0.0.0/8` range: IPv4 10/8, 172.16/12, 192.168/16, 169.254/16, 100.64/10, 0/8; IPv6
 * fc00::/7 (ULA), fe80::/10 (link-local). Loopback (127/8, ::1) is NOT blocked here — it is allowed by
 * `isLoopbackHost` before this is consulted. A DNS hostname is not a literal, so returns false.
 * Exported for its own unit test (it is not consumed elsewhere — `mirror-bind-guard.ts` imports only
 * `isLoopbackHost`), kept beside `isLoopbackHost` as the sibling half of the literal-IP classification.
 */
export function isBlockedIpLiteral(host: string): boolean {
  const h = stripLiteral(host.toLowerCase());
  const kind = isIP(h);
  if (kind === 0) return false;
  return BLOCKED.check(h, kind === 4 ? "ipv4" : "ipv6");
}
