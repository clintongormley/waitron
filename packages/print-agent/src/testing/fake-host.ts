import type {
  AgentConfig,
  AgentStatus,
  DiscoveredDevice,
  Host,
  PairResult,
  VisibleDevice,
} from "../host.js";
import type { WireJob } from "../client.js";
import { FakeSink, type PrinterTarget, type Transport } from "../transport.js";

/** An in-memory Host: config/token live in fields, `sleep` resolves at once and records the ms,
 * `status` and the log are captured for assertions. The default `fetch` rejects (unreachable). The
 * device seam defaults to an empty box (no visible devices, no scan results) and a passthrough
 * `resolve` that maps a job's `localKey` straight to a device path — the shape a suite overrides per
 * test to drive discovery, resolution and pairing. */
export function fakeHost(
  overrides: Partial<{
    config: AgentConfig | null;
    token: string | null;
    transport: Transport;
    fetch: typeof fetch;
    visibleDevices: () => Promise<VisibleDevice[]>;
    scan: (kinds?: ("usb" | "network_tcp" | "bluetooth")[]) => Promise<DiscoveredDevice[]>;
    resolve: (job: WireJob) => Promise<PrinterTarget>;
    pair: (mac: string) => Promise<PairResult>;
  }> = {},
): Host & {
  statuses: AgentStatus[];
  logs: string[];
  sleeps: number[];
  setToken(t: string | null): void;
  setConfig(c: AgentConfig | null): void;
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
    setToken: (t) => {
      token = t;
    },
    setConfig: (c) => {
      config = c;
    },
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
