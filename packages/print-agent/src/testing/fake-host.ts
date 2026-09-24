import type {
  AgentConfig,
  AgentStatus,
  DiscoveredDevice,
  Host,
  NetworkProbe,
  PairResult,
  TransportKind,
  VisibleDevice,
} from "../host.js";
import type { WireJob } from "../client.js";
import { FakeSink, type PrinterTarget, type Transport } from "../transport.js";

/** The default `fetch` rejects (unreachable); `resolve` maps a job's `localKey` straight to a device
 * path. */
export function fakeHost(
  overrides: Partial<{
    config: AgentConfig | null;
    token: string | null;
    transport: Transport;
    fetch: typeof fetch;
    visibleDevices: () => Promise<VisibleDevice[]>;
    scan: (kinds?: TransportKind[]) => Promise<DiscoveredDevice[]>;
    probeNetwork: (targets: NetworkProbe[]) => Promise<DiscoveredDevice[]>;
    markPagePrinters: (devices: DiscoveredDevice[]) => Promise<DiscoveredDevice[]>;
    resolve: (job: WireJob) => Promise<PrinterTarget>;
    pair: (mac: string) => Promise<PairResult>;
  }> = {},
): Host & {
  statuses: AgentStatus[];
  logs: string[];
  sleeps: number[];
} {
  let config = overrides.config === undefined ? null : overrides.config;
  let token = overrides.token ?? null;
  let clock = 1_000;
  const statuses: AgentStatus[] = [];
  const logs: string[] = [];
  const sleeps: number[] = [];
  const line = (level: string) => (msg: string, fields?: Record<string, unknown>) => {
    logs.push(`${level} ${msg}${fields ? " " + JSON.stringify(fields) : ""}`);
  };
  return {
    statuses,
    logs,
    sleeps,
    config: async () => config,
    saveConfig: async (c) => {
      config = c;
    },
    token: async () => token,
    saveToken: async (t) => {
      token = t;
    },
    transport: overrides.transport ?? new FakeSink(),
    fetch:
      overrides.fetch ??
      (async () => {
        throw new Error("ECONNREFUSED");
      }),
    now: () => (clock += 1),
    sleep: async (ms) => {
      sleeps.push(ms);
    },
    log: { info: line("info"), warn: line("warn"), error: line("error") },
    status: (s) => {
      statuses.push(s);
    },
    visibleDevices: overrides.visibleDevices ?? (async () => []),
    scan: overrides.scan ?? (async () => []),
    probeNetwork: overrides.probeNetwork ?? (async () => []),
    ...(overrides.markPagePrinters === undefined
      ? {}
      : { markPagePrinters: overrides.markPagePrinters }),
    resolve:
      overrides.resolve ??
      (async (job) => ({
        id: job.printerId,
        transport: job.transport,
        host: job.host,
        port: job.port,
        devicePath: job.localKey,
      })),
    pair: overrides.pair ?? (async () => ({ ok: false, error: "not implemented in fake host" })),
  };
}
