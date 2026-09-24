import type { networkInterfaces } from "node:os";
import type { DiscoveredDevice } from "@waitron/print-agent";
import { forEachBounded } from "./pool.js";

/**
 * A /22. Anything wider, such as a Docker bridge's /16, is skipped: that is a flood, not a LAN
 * scan.
 */
export const MAX_SWEEP_HOSTS = 1024;
export const SWEEP_PORT = 9100;
const DEFAULT_CONCURRENCY = 64;
const DEFAULT_TIMEOUT_MS = 500;

function parseIpv4(s: string): number | undefined {
  const parts = s.split(".");
  if (parts.length !== 4) return undefined;
  let n = 0;
  for (const p of parts) {
    if (!/^\d{1,3}$/.test(p)) return undefined;
    const v = Number(p);
    if (v > 255) return undefined;
    n = n * 256 + v;
  }
  return n;
}

function formatIpv4(n: number): string {
  return [n >>> 24, (n >>> 16) & 255, (n >>> 8) & 255, n & 255].join(".");
}

/** Every usable address of the interface's IPv4 network — the network and broadcast addresses and the
 * interface's own address dropped — or `[]` when the cidr is malformed or the network exceeds
 * {@link MAX_SWEEP_HOSTS}. */
export function hostsInSubnet(cidr: string): string[] {
  const m = /^(\d+\.\d+\.\d+\.\d+)\/(\d+)$/.exec(cidr);
  if (m === null) return [];
  const self = parseIpv4(m[1]!);
  const prefix = Number(m[2]);
  if (self === undefined || prefix < 0 || prefix > 32) return [];
  const size = 2 ** (32 - prefix);
  if (size > MAX_SWEEP_HOSTS) return [];
  const network = prefix === 0 ? 0 : (self & (0xffffffff << (32 - prefix))) >>> 0;
  const broadcast = network + size - 1;
  const hosts: string[] = [];
  for (let a = network + 1; a < broadcast; a++) {
    if (a !== self) hosts.push(formatIpv4(a));
  }
  return hosts;
}

export interface SweepCandidateDeps {
  interfaces: typeof networkInterfaces;
}

/** Docker's bridges are not filtered by name: their /16 falls to {@link hostsInSubnet}'s cap, and a
 * venue legitimately on a 172.x /24 is kept. */
export function sweepCandidates(deps: SweepCandidateDeps): string[] {
  const own = new Set<string>();
  const cidrs: string[] = [];
  for (const entries of Object.values(deps.interfaces())) {
    for (const e of entries ?? []) {
      if (e.family !== "IPv4" || e.internal) continue;
      own.add(e.address);
      if (e.cidr !== null) cidrs.push(e.cidr);
    }
  }
  const seen = new Set<string>();
  const hosts: string[] = [];
  for (const cidr of cidrs) {
    for (const h of hostsInSubnet(cidr)) {
      if (own.has(h) || seen.has(h)) continue;
      seen.add(h);
      hosts.push(h);
    }
  }
  return hosts;
}

export interface SweepOptions {
  hosts: string[];
  port: number;
  /** `false` or a throw both mean closed. */
  connect: (host: string, port: number, timeoutMs: number) => Promise<boolean>;
  concurrency?: number;
  timeoutMs?: number;
}

export async function sweepPort(opts: SweepOptions): Promise<DiscoveredDevice[]> {
  const concurrency = opts.concurrency ?? DEFAULT_CONCURRENCY;
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const open: boolean[] = new Array<boolean>(opts.hosts.length).fill(false);
  await forEachBounded(opts.hosts, concurrency, async (host, i) => {
    try {
      open[i] = await opts.connect(host, opts.port, timeoutMs);
    } catch {
      open[i] = false;
    }
  });
  return opts.hosts
    .filter((_, i) => open[i])
    .map((host) => ({ transport: "network_tcp", host, port: opts.port }));
}

/** The announced (mDNS) entries win: they carry the printer's own name, make and model. */
export function mergeDiscovered(
  announced: DiscoveredDevice[],
  swept: DiscoveredDevice[],
): DiscoveredDevice[] {
  const seen = new Set(announced.map((d) => `${d.host}:${d.port}`));
  return [...announced, ...swept.filter((d) => !seen.has(`${d.host}:${d.port}`))];
}
