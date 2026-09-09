import type { AgentConfig, AgentStatus, Host } from "../host.js";
import { FakeSink, type Transport } from "../transport.js";

/** An in-memory Host: config/token live in fields, `sleep` resolves at once and records the ms,
 * `status` and the log are captured for assertions. The default `fetch` rejects (unreachable). */
export function fakeHost(
  overrides: Partial<{
    config: AgentConfig | null;
    token: string | null;
    transport: Transport;
    fetch: typeof fetch;
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
  };
}
