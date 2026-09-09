import {
  BluetoothTransport,
  NetworkTcpTransport,
  RoutingTransport,
  UsbTransport,
  type AgentConfig,
  type AgentStatus,
  type DiscoveredDevice,
  type Host,
  type HostLog,
  type PairResult,
  type PrinterTarget,
  type VisibleDevice,
  type WireJob,
} from "@waitron/print-agent";
import type { EnvConfig } from "./config.js";
import type { FileState } from "./state.js";

/** A one-line-per-call sink the structured logger writes to. `console` satisfies it. */
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
}

/** The name a config gets when neither env nor the saved file names one — env pins only the url. */
const FALLBACK_NAME = "print-agent";

function structuredLog(sink: LineSink): HostLog {
  const emit =
    (level: "info" | "warn" | "error") =>
    (msg: string, fields?: Record<string, unknown>): void => {
      sink[level](JSON.stringify({ level, msg, ...fields }));
    };
  return { info: emit("info"), warn: emit("warn"), error: emit("error") };
}

/**
 * Assembles the {@link Host} the agent loop runs on inside the container (base spec §2.2): config and
 * token from the state directory, the real hardware transports, the global clock/timer/fetch, and a
 * structured logger. The loop never touches any of these directly — only through this seam.
 */
export function createContainerHost(opts: ContainerHostOptions): Host {
  const transport = new RoutingTransport({
    network_tcp: new NetworkTcpTransport(),
    usb: new UsbTransport(),
    bluetooth: new BluetoothTransport(),
  });
  return {
    config: async (): Promise<AgentConfig | null> => {
      // Env wins over the file: a compose-supplied address is never overridden by the setup page.
      // The saved name and environment still ride along — env pins only the url.
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
    now: () => Date.now(),
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    log: structuredLog(opts.log ?? console),
    status: opts.onStatus,
    // TODO(Task 6): real Linux implementation of the device seam — enumerate USB/Bluetooth devices,
    // an active scan, MAC pairing, and localKey→device-path resolution. See the plan
    // (.superpowers/sdd/2026-09-09-central-printer-provisioning). These stubs keep the loop's new
    // contract satisfied meanwhile: no devices reported, no scan results, pairing unsupported, and a
    // passthrough resolve that maps a job's localKey straight to a device path.
    visibleDevices: async (): Promise<VisibleDevice[]> => [],
    scan: async (): Promise<DiscoveredDevice[]> => [],
    pair: async (): Promise<PairResult> => ({
      ok: false,
      error: "not implemented on this host yet",
    }),
    resolve: async (job: WireJob): Promise<PrinterTarget> => ({
      id: job.printerId,
      transport: job.transport,
      host: job.host,
      port: job.port,
      devicePath: job.localKey,
    }),
  };
}
