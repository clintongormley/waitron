import { networkInterfaces } from "node:os";
import { AppError } from "@waitron/shared";
import "./errors.js";

/**
 * Pure helpers describing how a device on the LAN reaches this box: its non-internal IPv4
 * addresses, the URLs built from them plus the `.local` hostname, and the single URL the IP-QR
 * encodes. The discovery API (slice 3) and boot wiring consume this; nothing here does I/O beyond
 * enumerating the interfaces, and even that is injectable so it never runs in a unit test.
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

const IPV4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;

/**
 * The operator-supplied override for the addresses this box advertises — its certificate SANs, its
 * IP-QR and its mDNS answers. Unset, the interfaces are enumerated instead (`listBoxIpv4`).
 *
 * It exists because a container does not necessarily sit on the venue's network: under bridge
 * networking `listBoxIpv4` returns the container's own address, which is non-internal and
 * unreachable, so the box would mint a certificate for and advertise an address no device can
 * reach. Loopback is refused for the same reason it would be wrong to advertise.
 */
export function parseBoxAddresses(raw: string | undefined): string[] | undefined {
  if (raw === undefined || raw.trim() === "") return undefined;
  const entries = raw.split(",").map((entry) => entry.trim());
  for (const entry of entries) {
    const match = IPV4.exec(entry);
    const octetsValid =
      match !== null && match.slice(1).every((octet) => Number(octet) >= 0 && Number(octet) <= 255);
    if (!octetsValid || entry.startsWith("127.")) {
      throw new AppError("server.config_invalid", {
        variable: "WAITRON_BOX_ADDRESSES",
        reason: "box_addresses_invalid",
      });
    }
  }
  return entries;
}
