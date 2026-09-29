import {
  BLUETOOTH_COMMAND_LIMIT,
  createClient,
  describeRejection,
  withholdPin,
  type AgentClient,
  type BluetoothCommand,
  type BluetoothCommandOutcome,
  type Failure,
  type JobOutcome,
  type WireJob,
} from "./client.js";
import type {
  AgentConfig,
  AgentStatus,
  DiscoveredDevice,
  Host,
  NetworkProbe,
  PairedBluetoothDevice,
} from "./host.js";
import { Router } from "./router.js";

/** A non-empty batch re-polls at once; only an empty pull sleeps, and a finished Bluetooth command
 * cuts the sleep short so its outcome goes out at once. */
export const POLL_INTERVAL_MS = 2_000;
const RESET_WINDOW_MS = 5 * 60_000;

export interface AgentOptions {
  host: Host;
  client?: AgentClient;
  intervalMs?: number;
}

export interface AgentSetupSnapshot {
  status: AgentStatus;
  config: AgentConfig | null;
  joined: boolean;
  outOfTouch: boolean;
  resetAt?: number;
}

export interface Agent {
  runOnce(): Promise<void>;
  start(): Promise<void>;
  stop(): void;
  configure(input: { serverUrl: string; name: string }): Promise<boolean>;
  beginNetworkReset(): Promise<boolean>;
  cancelNetworkReset(): Promise<boolean>;
  setupSnapshot(): Promise<AgentSetupSnapshot>;
  readonly status: AgentStatus;
}

function describe(failure: Failure): string {
  return "detail" in failure ? `${failure.kind}: ${failure.detail}` : failure.kind;
}

/**
 * `runOnce` turns whatever a tick throws into a status the host renders; a throw from that
 * handling itself (the host's logger or `status` callback, or a thrown value that cannot be turned
 * into a string) still escapes. An agent never pulls with an unapproved token (that reads as
 * `unauthorized` and halts it until setup supplies a new configuration).
 */
export function createAgent(opts: AgentOptions): Agent {
  const host = opts.host;
  const client = opts.client ?? createClient({ fetch: host.fetch });
  const intervalMs = opts.intervalMs ?? POLL_INTERVAL_MS;
  let router: Router | undefined;
  let approved = false;
  let halted = false;
  let running = false;
  let outOfTouch = false;
  let resetAt: number | undefined;
  let operation = Promise.resolve();
  let wakePromise: Promise<void>;
  let wakeResolve: () => void;
  // 0 means no discovery window.
  let discoveryUntil = 0;
  let networkProbes: { target: NetworkProbe; expiresAt: number }[] = [];
  let probeServer: string | undefined;
  let status: AgentStatus = { phase: "unconfigured", serverUrl: null, current: null };
  let lastPhaseLine = "";
  // In memory only: a restart forgets all of it, so a command the server sends again after one runs
  // again.
  let bluetoothOutcomes: BluetoothCommandOutcome[] = [];
  const executedBluetoothCommands = new Set<string>();
  let bluetoothQueue: BluetoothCommand[] = [];
  let bluetoothWorking = false;
  // A setup reset moves it on, so a command already running then has its outcome dropped.
  let bluetoothGeneration = 0;
  let lastPairedFailure: string | undefined;

  function replaceWakeSignal(): void {
    wakePromise = new Promise((resolve) => {
      wakeResolve = resolve;
    });
  }

  function wake(): void {
    wakeResolve();
  }

  function exclusive<T>(body: () => Promise<T>): Promise<T> {
    const result = operation.then(body, body);
    operation = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  function isJoined(config: AgentConfig | null, token: string | null): boolean {
    return config !== null && token !== null && config.pendingVerificationNumber === undefined;
  }

  function resetRuntimeState(): void {
    router = undefined;
    approved = false;
    halted = false;
    outOfTouch = false;
    resetAt = undefined;
    discoveryUntil = 0;
    networkProbes = [];
    probeServer = undefined;
    bluetoothOutcomes = [];
    executedBluetoothCommands.clear();
    bluetoothQueue = [];
    bluetoothGeneration += 1;
  }

  replaceWakeSignal();

  function report(next: Partial<AgentStatus> & { phase: AgentStatus["phase"] }): void {
    status = { ...status, ...next };
    const line = `${status.phase}@${status.current ?? "-"}`;
    if (line !== lastPhaseLine) {
      lastPhaseLine = line;
      host.log.info("phase", {
        phase: status.phase,
        current: status.current,
        error: status.lastError,
      });
    }
    host.status(status);
  }

  function routerFor(config: AgentConfig): Router {
    if (router === undefined || router.servers()[0]!.url !== new URL(config.serverUrl).origin) {
      router = new Router({
        configuredUrl: config.serverUrl,
        environment: config.environment,
        initialServers: config.servers,
        probe: client.probeNode,
      });
    }
    return router;
  }

  async function halt(config: AgentConfig, current: string): Promise<void> {
    halted = true;
    approved = false;
    outOfTouch = false;
    resetAt = undefined;
    await host.saveToken(null);
    if (config.pendingVerificationNumber !== undefined) {
      await host.saveConfig({ ...config, pendingVerificationNumber: undefined });
    }
    report({
      phase: "unauthorized",
      serverUrl: config.serverUrl,
      current,
      verificationCode: undefined,
    });
  }

  /** True if the SEND failed (not the report delivery). */
  async function push(job: WireJob, token: string, current: string): Promise<boolean> {
    let outcome: JobOutcome;
    let failed = false;
    try {
      const target = await host.resolve(job);
      await host.transport.send(target, job.payload);
      outcome = { status: "done" };
      status = { ...status, lastJobAt: host.now() };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      outcome = { status: "failed", error: message };
      status = { ...status, lastError: message };
      failed = true;
    }
    const sent = await client.report(current, token, job.id, outcome);
    if (!sent.ok) {
      // Dropped on purpose: the server's claim lease reclaims an unreported job (at-least-once).
      host.log.warn("report dropped", { job: job.id, failure: sent.failure });
    }
    return failed;
  }

  async function listPairedBluetooth(): Promise<PairedBluetoothDevice[]> {
    try {
      const paired = await host.pairedBluetooth();
      lastPairedFailure = undefined;
      return paired;
    } catch (error) {
      const message = describeRejection(error);
      if (message !== lastPairedFailure) {
        host.log.warn("paired bluetooth listing failed", { error: message });
      }
      lastPairedFailure = message;
      return [];
    }
  }

  async function runBluetoothCommand(command: BluetoothCommand): Promise<BluetoothCommandOutcome> {
    let ok = false;
    let error: string | undefined;
    try {
      const result =
        command.kind === "pair"
          ? await host.pair(command.address, command.pin)
          : await host.forgetBluetooth(command.address);
      ok = result.ok === true;
      if (!ok && result.error !== undefined) error = describeRejection(result.error);
    } catch (thrown) {
      error = describeRejection(thrown);
    }
    if (error !== undefined) error = withholdPin(error, command.pin);
    return { id: command.id, ok, ...(error === undefined ? {} : { error }) };
  }

  /** The one background worker: runs queued commands one at a time, in arrival order, outside the
   * poll loop's lock, so a Pair never holds up a pull. */
  async function drainBluetoothCommands(): Promise<void> {
    bluetoothWorking = true;
    for (
      let command = bluetoothQueue.shift();
      command !== undefined;
      command = bluetoothQueue.shift()
    ) {
      const generation = bluetoothGeneration;
      const outcome = await runBluetoothCommand(command);
      if (generation === bluetoothGeneration) {
        bluetoothOutcomes = [...bluetoothOutcomes, outcome];
        wake();
      }
      if (!outcome.ok) {
        try {
          host.log.warn("bluetooth command failed", {
            id: command.id,
            kind: command.kind,
            address: command.address,
            error: outcome.error,
          });
        } catch {
          // Nothing awaits this worker, so a throw here would be an unhandled rejection.
        }
      }
    }
    bluetoothWorking = false;
  }

  /** An id is remembered before its command starts, so a resent id does not run again while it is
   * among the last `BLUETOOTH_COMMAND_LIMIT` taken since the last setup reset. A command arriving
   * while that many are already held (queued, running, or with an unsent outcome) is not remembered,
   * so the server's next resend of it is taken instead. */
  function acceptBluetoothCommands(commands: BluetoothCommand[]): void {
    for (const command of commands) {
      if (executedBluetoothCommands.has(command.id)) continue;
      const held = bluetoothQueue.length + (bluetoothWorking ? 1 : 0) + bluetoothOutcomes.length;
      if (held >= BLUETOOTH_COMMAND_LIMIT) break;
      executedBluetoothCommands.add(command.id);
      if (executedBluetoothCommands.size > BLUETOOTH_COMMAND_LIMIT) {
        executedBluetoothCommands.delete(executedBluetoothCommands.values().next().value!);
      }
      bluetoothQueue.push(command);
    }
    if (!bluetoothWorking && bluetoothQueue.length > 0) void drainBluetoothCommands();
  }

  /** Returns true when the tick did work (a non-empty batch), so `start` re-polls at once. */
  async function tick(): Promise<boolean> {
    // The loop, not the host, holds the live config, so a later merge never clobbers an earlier
    // one.
    let config = await host.config();
    if (config === null) {
      report({ phase: "unconfigured", serverUrl: null, current: null });
      return false;
    }
    if (resetAt !== undefined && outOfTouch && host.now() >= resetAt) {
      await host.saveToken(null);
      config = { ...config, servers: undefined };
      await host.saveConfig(config);
      resetRuntimeState();
      report({
        phase: "unconfigured",
        serverUrl: config.serverUrl,
        current: null,
        verificationCode: undefined,
        lastError: undefined,
      });
      return false;
    }
    if (halted) {
      report({ phase: "unauthorized", serverUrl: config.serverUrl });
      return false;
    }

    // Self-enrol sits BEFORE the `anyAccepting` gate ON PURPOSE: an agent on the primary box must
    // enrol even when its configured server is momentarily not an accepting primary. A LITERAL
    // loopback origin, not config.serverUrl; anywhere but the primary box it falls through below.
    if ((await host.token()) === null) {
      const loopback = new URL(config.serverUrl);
      loopback.hostname = "127.0.0.1";
      const self = await client.enrolSelf(loopback.origin, config.name);
      if (self.ok) {
        await host.saveToken(self.value.token);
        approved = true;
        outOfTouch = false;
        resetAt = undefined;
        report({ phase: "running", serverUrl: config.serverUrl, current: loopback.origin });
        return false;
      }
    }

    const r = routerFor(config);
    const round = await r.probe();
    if (config.environment === undefined && r.environment !== undefined) {
      config = { ...config, environment: r.environment };
      await host.saveConfig(config);
    }
    const current = r.current;

    // A server in a DIFFERENT environment must never be sent the token (CLAUDE.md §5).
    if (!round.anyAccepting) {
      outOfTouch = true;
      report({
        phase: "unreachable",
        serverUrl: config.serverUrl,
        current,
        lastError: `no accepting primary in environment ${r.environment ?? "unknown"}`,
      });
      return false;
    }

    let token = await host.token();
    if (token === null) {
      const joined = await client.join(current, config.name);
      if (!joined.ok) {
        if (joined.failure.kind === "pairing_closed") {
          report({ phase: "pairing_closed", serverUrl: config.serverUrl, current });
        } else {
          report({
            phase: "unreachable",
            serverUrl: config.serverUrl,
            current,
            lastError: describe(joined.failure),
          });
        }
        return false;
      }
      // The only surviving copy, after a restart, of the code the admin must match.
      config = { ...config, pendingVerificationNumber: joined.value.verificationNumber };
      await host.saveConfig(config);
      token = joined.value.token;
      await host.saveToken(token);
      approved = false;
      report({
        phase: "pending",
        serverUrl: config.serverUrl,
        current,
        verificationCode: joined.value.verificationNumber,
      });
      return false;
    }

    if (!approved) {
      const s = await client.joinStatus(current, token);
      if (!s.ok) {
        report({
          phase: "unreachable",
          serverUrl: config.serverUrl,
          current,
          lastError: describe(s.failure),
        });
        return false;
      }
      if (s.value === "pending") {
        report({
          phase: "pending",
          serverUrl: config.serverUrl,
          current,
          verificationCode: config.pendingVerificationNumber,
        });
        return false;
      }
      if (s.value === "not_approved") {
        await halt(config, current);
        return false;
      }
      approved = true;
      if (config.pendingVerificationNumber !== undefined) {
        config = { ...config, pendingVerificationNumber: undefined };
        await host.saveConfig(config);
      }
    }

    // Started before `visibleDevices`, and awaited after it, so the host's paired-device listing is
    // already running when the visible-device read wants one and can be shared.
    const pairedListing = listPairedBluetooth();
    const visible = await host.visibleDevices();
    const pairedBluetooth = await pairedListing;
    // A throwing scan (a box with no Bluetooth adapter, say) must NEVER stop the job pull.
    let scanned: DiscoveredDevice[] = [];
    if (host.now() < discoveryUntil) {
      try {
        scanned = await host.scan();
      } catch (error) {
        host.log.warn("scan failed", {
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
    const targets =
      current === probeServer
        ? networkProbes.filter((probe) => host.now() < probe.expiresAt).map((probe) => probe.target)
        : [];
    if (targets.length) {
      try {
        const reachable = await host.probeNetwork(targets);
        scanned.push(
          ...reachable.filter(
            (target) =>
              !scanned.some(
                (device) =>
                  device.transport === "network_tcp" &&
                  device.host === target.host &&
                  device.port === target.port,
              ),
          ),
        );
      } catch (error) {
        host.log.warn("address probe failed", {
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
    // Classified after the merge, so a probe target the scan also found keeps its mark and each host
    // is asked once per pull. A failure reports the devices unmarked and never stops the pull.
    if (host.markPagePrinters && scanned.some((device) => device.transport === "network_tcp")) {
      try {
        scanned = await host.markPagePrinters(scanned);
      } catch (error) {
        host.log.warn("office-printer check failed", {
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
    const hostname = host.hostname?.();
    const setupUrl = host.setupUrl?.();
    const setupPort = host.setupPort?.();
    const sentOutcomes = bluetoothOutcomes;
    const pulled = await client.pullJobs(current, token, {
      visible,
      scanned,
      pairedBluetooth,
      bluetoothOutcomes: sentOutcomes,
      ...(hostname === undefined ? {} : { host: hostname }),
      ...(setupUrl === undefined ? {} : { setupUrl }),
      ...(setupPort === undefined ? {} : { setupPort }),
    });
    if (!pulled.ok) {
      if (pulled.failure.kind === "unauthorized") {
        await halt(config, current);
      } else {
        outOfTouch = true;
        report({
          phase: "unreachable",
          serverUrl: config.serverUrl,
          current,
          lastError: describe(pulled.failure),
        });
      }
      return false;
    }
    outOfTouch = false;
    resetAt = undefined;
    bluetoothOutcomes = bluetoothOutcomes.filter((outcome) => !sentOutcomes.includes(outcome));
    r.merge(pulled.value.servers);
    const servers = r
      .servers()
      .slice(1)
      .map(({ url, nodeId }) => (nodeId === undefined ? { url } : { url, nodeId }));
    if (JSON.stringify(servers) !== JSON.stringify(config.servers ?? [])) {
      config = { ...config, servers };
      await host.saveConfig(config);
    }
    discoveryUntil = pulled.value.discoveryUntil ?? 0;
    // A remote server's epoch deadline cannot be compared with this host's clock.
    const receivedAt = host.now();
    networkProbes = (pulled.value.networkProbes ?? []).map((target) => ({
      target,
      expiresAt: receivedAt + target.expiresInMs,
    }));
    probeServer = current;
    let anyFailed = false;
    for (const job of pulled.value.jobs) if (await push(job, token, current)) anyFailed = true;
    // `lastError` is cleared only by a fully clean tick, so a partial-failure batch keeps it
    // visible.
    report({
      phase: "running",
      serverUrl: config.serverUrl,
      current,
      verificationCode: undefined,
      ...(anyFailed ? {} : { lastError: undefined }),
    });
    acceptBluetoothCommands(pulled.value.bluetoothCommands ?? []);
    return pulled.value.jobs.length > 0;
  }

  async function runOnce(): Promise<boolean> {
    try {
      return await tick();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      host.log.error("tick failed", { error: message });
      report({ phase: "unreachable", lastError: message });
      return false;
    }
  }

  const runSerialized = () => exclusive(runOnce);

  return {
    get status() {
      return status;
    },
    async runOnce() {
      await runSerialized();
    },
    async start() {
      running = true;
      while (running) {
        const busy = await runSerialized();
        if (!running) break;
        if (!busy) {
          await Promise.race([host.sleep(intervalMs), wakePromise]);
          replaceWakeSignal();
        }
      }
    },
    stop() {
      running = false;
      wake();
    },
    configure(input) {
      return exclusive(async () => {
        const config = await host.config();
        const token = await host.token();
        if (isJoined(config, token)) return false;
        await host.saveToken(null);
        await host.saveConfig({ serverUrl: input.serverUrl, name: input.name });
        resetRuntimeState();
        report({
          phase: "unconfigured",
          serverUrl: input.serverUrl,
          current: null,
          verificationCode: undefined,
          lastError: undefined,
        });
        wake();
        return true;
      });
    },
    beginNetworkReset() {
      return exclusive(async () => {
        const config = await host.config();
        const token = await host.token();
        if (!isJoined(config, token) || !outOfTouch) return false;
        resetAt ??= host.now() + RESET_WINDOW_MS;
        wake();
        return true;
      });
    },
    cancelNetworkReset() {
      return exclusive(async () => {
        const config = await host.config();
        const token = await host.token();
        if (!isJoined(config, token) || resetAt === undefined) return false;
        resetAt = undefined;
        return true;
      });
    },
    async setupSnapshot() {
      const config = await host.config();
      const token = await host.token();
      return {
        status: { ...status },
        config,
        joined: isJoined(config, token),
        outOfTouch,
        ...(resetAt === undefined ? {} : { resetAt }),
      };
    },
  };
}
