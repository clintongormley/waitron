import { readFileSync } from "node:fs";
import { networkInterfaces } from "node:os";
import { AppError } from "@waitron/shared";
import { isPermittedLeafIpv4 } from "./self-signed-cert.js";
import "./errors.js";

/**
 * Pure helpers describing how a device on the LAN reaches this box: its LAN IPv4 addresses (the
 * default-route interface's — see `listBoxIpv4`), the URLs built from them plus the `.local`
 * hostname, and the single URL the IP-QR encodes. The discovery API, the boot wiring and
 * `box-secrets.ts` (the leaf's iPAddress SANs) consume this; the only I/O is enumerating the
 * interfaces and reading the default route, and both are injectable.
 */

export interface ReachInfo {
  hostname: string; // "waitron.local"
  scheme: "https" | "http";
  port: number;
  addresses: string[]; // non-internal, cert-coverable IPv4s (filtered to the CA's permitted subtrees)
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

/** Interface-name prefixes for the virtual/container bridges a box's host carries. Used ONLY on the
 *  fallback path (no default route resolvable): the box always runs under Docker, so `docker0`,
 *  `br-<hash>` and `docker_gwbridge` sit beside the real NIC, and their 172.x addresses are
 *  non-internal — advertising them makes `waitron.local` resolve to an address no device can reach.
 *  A denylist is brittle, which is why it is only the fallback; the default-route interface is the
 *  primary signal and needs no name knowledge. VPN interfaces (tun/tap/wireguard) are deliberately
 *  NOT listed: on a box reachable only over a VPN with no default route, that address may be its
 *  only reach, so the fallback must keep it. */
const VIRTUAL_IFACE_PREFIXES = ["docker", "br-", "veth", "virbr", "cni", "flannel", "cali"];

/**
 * The interface carrying the default route (0.0.0.0/0), read from Linux's `/proc/net/route`, or
 * undefined when there is none or it cannot be read (a non-Linux dev host, an isolated LAN with no
 * gateway). The columns are `Iface Destination Gateway Flags RefCnt Use Metric Mask …`; the default
 * route is the one whose Destination AND Mask are both all-zero (a `0.0.0.0/1` route has a zero
 * destination but a non-zero mask, and is NOT it), and when several exist the lowest Metric wins (so
 * a wired NIC beats a higher-metric Wi-Fi or VPN). The reader is injected so the parse is testable.
 *
 * `/proc/net/route` is a procfs (in-memory) file and this is read on the low-frequency mDNS/discovery
 * paths, so the synchronous read is cheap; it is not memoized deliberately, to keep the helper pure.
 */
export function defaultRouteIface(
  readRoute: () => string = () => readFileSync("/proc/net/route", "utf8"),
): string | undefined {
  let text: string;
  try {
    text = readRoute();
  } catch {
    return undefined;
  }
  let best: { iface: string; metric: number } | undefined;
  for (const line of text.split("\n").slice(1)) {
    const cols = line.trim().split(/\s+/);
    if (cols.length < 8 || cols[1] !== "00000000" || cols[7] !== "00000000") continue;
    const parsed = Number.parseInt(cols[6], 10);
    const metric = Number.isNaN(parsed) ? Infinity : parsed;
    if (best === undefined || metric < best.metric) best = { iface: cols[0], metric };
  }
  return best?.iface;
}

export interface ListBoxIpv4Deps {
  /** Injected for tests; default enumerates the real interfaces. */
  interfaces?: typeof networkInterfaces;
  /** Injected for tests; default reads the host's default-route interface. */
  defaultRouteIface?: () => string | undefined;
}

/**
 * The box's own LAN IPv4 addresses — the ones it advertises over mDNS, in its leaf's iPAddress SANs
 * and in its reach URLs. It returns ONLY the default-route interface's addresses: that is the box's
 * real uplink, and Docker's bridges (docker0/br-*) carry no default route, so they are excluded
 * without a name denylist and a venue legitimately on a 172.x LAN is kept (its NIC holds the route).
 * When no default route is resolvable it falls back to every non-internal IPv4 except those on a
 * known virtual/bridge interface, so a box with a gateway is never left unreachable.
 *
 * `internal` drops loopback; the `IPv4` filter drops the IPv6 entries `networkInterfaces` returns.
 */
export function listBoxIpv4(deps: ListBoxIpv4Deps = {}): string[] {
  const ifaces = (deps.interfaces ?? networkInterfaces)();
  const ipv4Of = (entries: (typeof ifaces)[string]): string[] =>
    (entries ?? [])
      .filter((n): n is NonNullable<typeof n> => !!n && n.family === "IPv4" && !n.internal)
      .map((n) => n.address);

  const uplink = (deps.defaultRouteIface ?? defaultRouteIface)();
  if (uplink !== undefined) {
    const addrs = ipv4Of(ifaces[uplink]);
    if (addrs.length > 0) return addrs;
  }

  return Object.entries(ifaces)
    .filter(([name]) => !VIRTUAL_IFACE_PREFIXES.some((p) => name.startsWith(p)))
    .flatMap(([, entries]) => ipv4Of(entries));
}

/** Build `scheme://host`, appending `:port` only when it is not the scheme default (443/80). */
function urlFor(scheme: "https" | "http", host: string, port: number): string {
  const isDefault = (scheme === "https" && port === 443) || (scheme === "http" && port === 80);
  return isDefault ? `${scheme}://${host}` : `${scheme}://${host}:${port}`;
}

/** Compose the reachable URLs for `hostname` + every cert-coverable IPv4, and the IP-QR target. Only
 * cert-coverable IPs are advertised: the box leaf's iPAddress SANs are filtered to the CA's permitted
 * subtrees (`isPermittedLeafIpv4`), so an out-of-set address (Tailscale 100.64/10, 169.254/16
 * link-local, a public IP) would yield an `https://<ip>/` the leaf's cert cannot vouch for — a TLS
 * name mismatch on dial. The `waitron.local` hostname URL is unaffected: the cert covers the NAME, and
 * mDNS (a separate path in boot) still resolves it to the box's real address even when that IP is
 * out-of-set. When no IP is permitted the box still advertises the hostname URL and a null IP-QR. */
export function buildReachInfo(opts: BuildReachOptions): ReachInfo {
  const scheme: "https" | "http" = opts.secure ? "https" : "http";
  const addresses = (opts.listIpv4 ?? listBoxIpv4)().filter(isPermittedLeafIpv4);
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
 * reach. Loopback and the unspecified address are refused for that same reason: neither is an
 * address a device on the venue network can dial.
 */
export function parseBoxAddresses(raw: string | undefined): string[] | undefined {
  if (raw === undefined || raw.trim() === "") return undefined;
  const entries = raw.split(",").map((entry) => entry.trim());
  for (const entry of entries) {
    const match = IPV4.exec(entry);
    const octetsValid =
      match !== null && match.slice(1).every((octet) => Number(octet) >= 0 && Number(octet) <= 255);
    if (!octetsValid || entry.startsWith("127.") || entry === "0.0.0.0") {
      throw new AppError("server.config_invalid", {
        variable: "WAITRON_BOX_ADDRESSES",
        reason: "box_addresses_invalid",
      });
    }
  }
  return entries;
}
