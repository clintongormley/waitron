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
import { AppError } from "@waitron/shared";
import "./errors.js";

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
  const h = host.toLowerCase();
  if (h === "localhost") return true;

  const v4 = parseIpv4(h);
  if (v4 !== null) return v4[0] === 127;

  const v6 = parseIpv6(h);
  if (v6 !== null) return isIpv6Loopback(v6);

  return false;
}

/**
 * True when `host` is a LITERAL IP (v4, v6, or IPv4-mapped v6) inside a private, link-local, CGNAT,
 * metadata, or `0.0.0.0/8` range: IPv4 10/8, 172.16/12, 192.168/16, 169.254/16, 100.64/10, 0/8; IPv6
 * fc00::/7 (ULA), fe80::/10 (link-local). Loopback (127/8, ::1) is NOT blocked here — it is allowed by
 * `isLoopbackHost` before this is consulted. A DNS hostname is not a literal, so returns false.
 * Exported so the private-range logic stays factored for reuse (Task 3).
 */
export function isBlockedIpLiteral(host: string): boolean {
  const h = host.toLowerCase();

  const v4 = parseIpv4(h);
  if (v4 !== null) return isBlockedIpv4(v4);

  const v6 = parseIpv6(h);
  if (v6 !== null) {
    const mapped = ipv4Mapped(v6);
    if (mapped !== null) return isBlockedIpv4(mapped);
    return isBlockedIpv6(v6);
  }

  return false;
}

// --- IPv4 --------------------------------------------------------------------------------------

/** Parse a dotted-quad into four octets, or null if `host` is not a well-formed IPv4 literal. */
function parseIpv4(host: string): [number, number, number, number] | null {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (m === null) return null;
  const octets = [Number(m[1]), Number(m[2]), Number(m[3]), Number(m[4])];
  if (octets.some((o) => o > 255)) return null;
  return octets as [number, number, number, number];
}

function isBlockedIpv4([a, b]: [number, number, number, number]): boolean {
  if (a === 10) return true; // 10.0.0.0/8
  if (a === 172 && b >= 16 && b <= 31) return true; // 172.16.0.0/12
  if (a === 192 && b === 168) return true; // 192.168.0.0/16
  if (a === 169 && b === 254) return true; // 169.254.0.0/16 (link-local + cloud metadata)
  if (a === 100 && b >= 64 && b <= 127) return true; // 100.64.0.0/10 (CGNAT)
  if (a === 0) return true; // 0.0.0.0/8
  return false;
}

// --- IPv6 --------------------------------------------------------------------------------------

/**
 * Parse an IPv6 literal (brackets and a %zone suffix tolerated, a trailing embedded IPv4 like
 * `::ffff:1.2.3.4` accepted) into 16 bytes, or null if it is not a well-formed IPv6 literal.
 */
function parseIpv6(raw: string): number[] | null {
  let host = raw;
  if (host.startsWith("[") && host.endsWith("]")) host = host.slice(1, -1);
  const zone = host.indexOf("%");
  if (zone !== -1) host = host.slice(0, zone);
  if (!host.includes(":")) return null;

  // Rewrite a trailing dotted IPv4 group (`::ffff:1.2.3.4`) as two hex hextets so the parse below is uniform.
  const dot = host.indexOf(".");
  if (dot !== -1) {
    const lastColon = host.lastIndexOf(":", dot);
    if (lastColon === -1) return null;
    const v4 = parseIpv4(host.slice(lastColon + 1));
    if (v4 === null) return null;
    const hi = ((v4[0] << 8) | v4[1]).toString(16);
    const lo = ((v4[2] << 8) | v4[3]).toString(16);
    host = `${host.slice(0, lastColon + 1)}${hi}:${lo}`;
  }

  if ((host.match(/::/g) ?? []).length > 1) return null;
  const hasDouble = host.includes("::");
  const [headStr, tailStr] = hasDouble ? host.split("::") : [host, undefined];
  const head = headStr === "" ? [] : headStr.split(":");
  const tail = tailStr === undefined || tailStr === "" ? [] : tailStr.split(":");

  const isHextet = (g: string): boolean => /^[0-9a-f]{1,4}$/.test(g);
  if (!head.every(isHextet) || !tail.every(isHextet)) return null;

  let groups: string[];
  if (hasDouble) {
    const fill = 8 - head.length - tail.length;
    if (fill < 1) return null; // `::` must stand for at least one all-zero group
    groups = [...head, ...Array<string>(fill).fill("0"), ...tail];
  } else {
    if (head.length !== 8) return null;
    groups = head;
  }

  const bytes: number[] = [];
  for (const g of groups) {
    const v = parseInt(g, 16);
    bytes.push((v >> 8) & 0xff, v & 0xff);
  }
  return bytes;
}

function isIpv6Loopback(bytes: number[]): boolean {
  return bytes.slice(0, 15).every((b) => b === 0) && bytes[15] === 1;
}

/** If `bytes` is an IPv4-mapped IPv6 address (`::ffff:a.b.c.d`), return the embedded IPv4 octets. */
function ipv4Mapped(bytes: number[]): [number, number, number, number] | null {
  const prefixIsZero = bytes.slice(0, 10).every((b) => b === 0);
  if (prefixIsZero && bytes[10] === 0xff && bytes[11] === 0xff) {
    return [bytes[12], bytes[13], bytes[14], bytes[15]];
  }
  return null;
}

function isBlockedIpv6(bytes: number[]): boolean {
  if ((bytes[0] & 0xfe) === 0xfc) return true; // fc00::/7 (unique local)
  if (bytes[0] === 0xfe && (bytes[1] & 0xc0) === 0x80) return true; // fe80::/10 (link-local)
  return false;
}
