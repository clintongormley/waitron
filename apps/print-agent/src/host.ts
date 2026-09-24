import { hostname } from "node:os";
import { type MediaQuery, createPagePrinterMarker, queryMediaSupported } from "./ipp-probe.js";
import { probeNetwork } from "./tcp-probe.js";
import {
  BluetoothTransport,
  NetworkTcpTransport,
  RoutingTransport,
  UsbTransport,
  type AgentConfig,
  type AgentStatus,
  type Host,
  type HostLog,
} from "@waitron/print-agent";
import type { EnvConfig } from "./config.js";
import { type LinuxDevices, createLinuxDevices } from "./linux-devices.js";
import type { FileState } from "./state.js";

/** `console` satisfies it. */
export interface LineSink {
  info(line: string): void;
  warn(line: string): void;
  error(line: string): void;
}

export interface ContainerHostOptions {
  env: EnvConfig;
  state: FileState;
  /** Injected in tests; defaults to the global `fetch`. */
  fetch?: typeof fetch;
  /** Injected in tests; defaults to `console`. */
  log?: LineSink;
  /** The loop calls this on every status change; the setup page reads the latest value. */
  onStatus: (status: AgentStatus) => void;
  devices?: LinuxDevices;
  /** The IPP paper-size query behind `markPagePrinters`; defaults to the live query. */
  mediaQuery?: MediaQuery;
  /** Injected in tests; defaults to `Date.now`. */
  now?: () => number;
}

const FALLBACK_NAME = "print-agent";

function structuredLog(sink: LineSink): HostLog {
  const emit =
    (level: "info" | "warn" | "error") =>
    (msg: string, fields?: Record<string, unknown>): void => {
      sink[level](JSON.stringify({ level, msg, ...fields }));
    };
  return { info: emit("info"), warn: emit("warn"), error: emit("error") };
}

export function createContainerHost(opts: ContainerHostOptions): Host {
  const transport = new RoutingTransport({
    network_tcp: new NetworkTcpTransport(),
    usb: new UsbTransport(),
    bluetooth: new BluetoothTransport(),
  });
  const devices = opts.devices ?? createLinuxDevices();
  const now = opts.now ?? (() => Date.now());
  return {
    hostname,
    config: async (): Promise<AgentConfig | null> => {
      // Env pins only the url; the saved name and environment still ride along.
      if (opts.env.serverUrl !== undefined) {
        const saved = await opts.state.readConfig();
        return {
          serverUrl: opts.env.serverUrl,
          name: opts.env.name ?? saved?.name ?? FALLBACK_NAME,
          environment: saved?.environment,
        };
      }
      return opts.state.readConfig();
    },
    saveConfig: (config) => opts.state.writeConfig(config),
    token: () => opts.state.readToken(),
    saveToken: (token) => opts.state.writeToken(token),
    transport,
    fetch: opts.fetch ?? fetch,
    now,
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    log: structuredLog(opts.log ?? console),
    status: opts.onStatus,
    probeNetwork,
    markPagePrinters: createPagePrinterMarker({
      query: opts.mediaQuery ?? queryMediaSupported,
      now,
    }),
    visibleDevices: devices.visibleDevices,
    scan: devices.scan,
    pair: devices.pair,
    resolve: devices.resolve,
  };
}
