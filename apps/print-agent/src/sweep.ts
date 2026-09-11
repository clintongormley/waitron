import net from "node:net";
import { networkInterfaces } from "node:os";
import type { DiscoveredDevice } from "@waitron/print-agent";

/**
 * The port-9100 sweep — the discovery fallback for IP printers that announce nothing over mDNS
 * (provisioning design §2c). A receipt printer's network card typically runs a raw ESC/POS listener on
 * TCP 9100 and no mDNS responder at all (an Epson TM-T88III on the owner's LAN, 2026-09-11), so the
 * mDNS pass alone never lists it. The sweep opens a TCP connection to every address on the box's own
 * IPv4 subnets and reports each one that accepts; it sends NO bytes, because a page printer on 9100
 * prints whatever it receives. It runs only inside a dashboard-opened discovery window, like the mDNS
 * pass. The pure pieces (subnet enumeration, the bounded fan-out, the merge) are unit-tested; only the
 * `net.connect` seam is live.
 */

/** The widest network the sweep will cover — a /22. Anything wider (a Docker bridge's /16, a wide
 * corporate range) is skipped: sixty-five thousand connects is not a LAN scan, it is a flood. */
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

/** The cidr of each non-internal IPv4 interface. Docker's bridges are NOT filtered by name here: their
 * /16 falls to {@link hostsInSubnet}'s cap, and a venue legitimately on a 172.x /24 is kept. */
export function subnetsToSweep(interfaces: typeof networkInterfaces = networkInterfaces): string[] {
  const out: string[] = [];
  for (const entries of Object.values(interfaces())) {
    for (const e of entries ?? []) {
      if (e.family === "IPv4" && !e.internal && e.cidr !== null) out.push(e.cidr);
    }
  }
  return out;
}

export interface SweepOptions {
  hosts: string[];
  port: number;
  /** Resolves `true` when a TCP connection to `host:port` is accepted within `timeoutMs`; `false` or a
   * throw both mean closed. */
  connect: (host: string, port: number, timeoutMs: number) => Promise<boolean>;
  concurrency?: number;
  timeoutMs?: number;
}

/** Try every host with at most `concurrency` connects in flight; report the accepting ones in the
 * order given. */
export async function sweepPort(opts: SweepOptions): Promise<DiscoveredDevice[]> {
  const concurrency = opts.concurrency ?? DEFAULT_CONCURRENCY;
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const open: boolean[] = new Array<boolean>(opts.hosts.length).fill(false);
  let next = 0;
  const worker = async (): Promise<void> => {
    while (next < opts.hosts.length) {
      const i = next++;
      try {
        open[i] = await opts.connect(opts.hosts[i]!, opts.port, timeoutMs);
      } catch {
        open[i] = false;
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, opts.hosts.length) }, worker));
  return opts.hosts
    .filter((_, i) => open[i])
    .map((host) => ({ transport: "network_tcp", host, port: opts.port }));
}

/** The announced (mDNS) list first — it carries the printer's own name, make and model — then every
 * swept device whose `host:port` the announced list did not already name. */
export function mergeDiscovered(
  announced: DiscoveredDevice[],
  swept: DiscoveredDevice[],
): DiscoveredDevice[] {
  const seen = new Set(announced.map((d) => `${d.host}:${d.port}`));
  return [...announced, ...swept.filter((d) => !seen.has(`${d.host}:${d.port}`))];
}

/* v8 ignore start -- opens real sockets; covered by the box receipt, not unit tests. */
/** The live connect seam: accepted within `timeoutMs` → `true`; refused, unreachable or silent → `false`. */
export function tcpConnectProbe(host: string, port: number, timeoutMs: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.connect({ host, port });
    const finish = (ok: boolean): void => {
      socket.destroy();
      resolve(ok);
    };
    socket.setTimeout(timeoutMs, () => finish(false));
    socket.once("connect", () => finish(true));
    socket.once("error", () => finish(false));
  });
}

/** The live sweep over every subnet the box sits on. */
export async function liveSweep(): Promise<DiscoveredDevice[]> {
  const hosts = subnetsToSweep().flatMap(hostsInSubnet);
  return sweepPort({ hosts, port: SWEEP_PORT, connect: tcpConnectProbe });
}
/* v8 ignore stop */
