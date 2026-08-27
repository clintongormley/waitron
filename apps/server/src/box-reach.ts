import { networkInterfaces } from "node:os";

/**
 * Pure helpers describing how a device on the LAN reaches this box: its non-internal IPv4
 * addresses, the URLs built from them plus the `.local` hostname, and the single URL the IP-QR
 * encodes. The discovery API (slice 3) and boot wiring consume this; nothing here does I/O beyond
 * enumerating the interfaces, and even that is injectable so it never runs in a unit test.
 *
 * `listBoxIpv4` intentionally mirrors the private `defaultListIpv4` in `box-secrets.ts` (slice 2a's
 * cert-SAN source). The duplication is deliberate: 2a's module is a landed, tested slice, so it is
 * left untouched rather than widened to export this ~4-line reader.
 */

export interface ReachInfo {
  hostname: string; // "waitron.local"
  scheme: "https" | "http";
  port: number;
  addresses: string[]; // non-internal IPv4s
  hostnameUrl: string; // e.g. "https://waitron.local:8080" (":443"/":80" omitted)
  ipUrls: string[]; // one per address, same port rule
  /** The URL the IP-QR encodes — the FIRST ip URL, since `.local` is unreliable on iOS (spec §7);
   *  null when the box has no non-internal IPv4 (e.g. a container with only loopback). */
  qrTarget: string | null;
}

export interface BuildReachOptions {
  hostname: string;
  port: number;
  /** true → https, false → http. Setup mode always serves TLS (2a), so this is normally true. */
  secure: boolean;
  /** Injected for tests; default enumerates the real interfaces. */
  listIpv4?: () => string[];
}

/**
 * Non-internal IPv4 addresses of this host. `internal` drops loopback and the `IPv4` filter drops
 * the IPv6 entries `networkInterfaces` returns for the same interface.
 *
 * Only ever runs on the real-`os` default path — every unit test injects `listIpv4` — so it is left
 * to the `apps/server` coverage aggregate rather than pinned by a real-interface test (the same
 * real-only-path posture `boot.ts` and `vitest.config.ts` record).
 */
export function listBoxIpv4(): string[] {
  return Object.values(networkInterfaces())
    .flat()
    .filter((n): n is NonNullable<typeof n> => !!n && n.family === "IPv4" && !n.internal)
    .map((n) => n.address);
}

/** Build `scheme://host`, appending `:port` only when it is not the scheme default (443/80). */
function urlFor(scheme: "https" | "http", host: string, port: number): string {
  const isDefault = (scheme === "https" && port === 443) || (scheme === "http" && port === 80);
  return isDefault ? `${scheme}://${host}` : `${scheme}://${host}:${port}`;
}

/** Compose the reachable URLs for `hostname` + every detected IPv4, and the IP-QR target. */
export function buildReachInfo(opts: BuildReachOptions): ReachInfo {
  const scheme: "https" | "http" = opts.secure ? "https" : "http";
  const addresses = (opts.listIpv4 ?? listBoxIpv4)();
  const ipUrls = addresses.map((addr) => urlFor(scheme, addr, opts.port));
  return {
    hostname: opts.hostname,
    scheme,
    port: opts.port,
    addresses,
    hostnameUrl: urlFor(scheme, opts.hostname, opts.port),
    ipUrls,
    qrTarget: ipUrls[0] ?? null,
  };
}
