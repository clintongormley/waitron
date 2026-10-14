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
  type PageHold,
  type PageJob,
  type PageJobOutcome,
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
 * or a discovery pass that found devices cuts the sleep short so what it produced goes out at once. */
export const POLL_INTERVAL_MS = 2_000;
const RESET_WINDOW_MS = 5 * 60_000;
/** A third of the server's 60 s claim lease (`INVOICE_DELIVERY_LEASE_MS`,
 * `apps/server/src/invoice-delivery.ts`), so one renewal that does not get through leaves the claim
 * alive. */
export const PAGE_RENEW_INTERVAL_MS = 20_000;
/** How long a finished job waits for a renewal still out before reporting: above the client's
 * 3 s bound on one request (`DEFAULT_TIMEOUT_MS`). */
export const PAGE_RENEW_SETTLE_MS = 5_000;
/** Twice the 60 s lease, counted from the claim or its last renewal that got through: by then the
 * server has ended the claim as uncertain, so a report it never received is dropped. */
export const PAGE_REPORT_GIVE_UP_MS = 120_000;
const DOCUMENT_UNAVAILABLE: PageJobOutcome = {
  status: "failed",
  failureCode: "document_unavailable",
};
const UNCERTAIN: PageJobOutcome = { status: "unknown", failureCode: "timeout" };
/** Failures in which the report may never have reached the server. */
const REPORT_RETRIED = new Set<Failure["kind"]>(["unreachable", "rate_limited", "pairing_closed"]);

/** `aliveAt`: when the claim was taken or last renewed. `hold`: the printer's last reported hold,
 * sent with the next renewal. */
interface HeldClaim {
  job: PageJob;
  aliveAt: number;
  hold: PageHold | null;
}

type PageReport = HeldClaim & { outcome: PageJobOutcome };

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
  // Set by stop() and cleared by start(): a job still out then reports, but nothing new is claimed.
  // Not `running`, which is false before start(), when runOnce() must still claim.
  let stopped = false;
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
  // At most one discovery pass at a time, even across a setup reset, which only drops its devices.
  let scanning = false;
  let scanGeneration = 0;
  let scanFound: DiscoveredDevice[] = [];
  let nextScanAt = 0;
  // One claim loop at a time, with any number of A4 jobs out: the server hands out at most one job
  // per printer, so the agent keeps no lock of its own.
  let pageServer: { url: string; token: string } | undefined;
  let claiming = false;
  let claimAgain = false;
  let unsentPageReports: PageReport[] = [];

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
    scanFound = [];
    scanGeneration += 1;
    nextScanAt = 0;
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
      const message =
        job.invoiceClaim === undefined
          ? error instanceof Error
            ? error.message
            : String(error)
          : "transport_failed";
      outcome = { status: "failed", error: message };
      status = { ...status, lastError: message };
      failed = true;
    }
    if (job.invoiceClaim !== undefined) outcome = { ...outcome, invoiceClaim: job.invoiceClaim };
    const sent = await client.report(current, token, job.id, outcome);
    if (!sent.ok) {
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

  /** Runs outside the poll loop's lock, so a pass never holds up a pull; its devices ride the next
   * pull. A throwing pass reports nothing. */
  async function discover(): Promise<void> {
    scanning = true;
    const generation = scanGeneration;
    let found: DiscoveredDevice[] = [];
    try {
      // A delivery wake may run the next tick early, but passes stay at least one interval apart.
      nextScanAt = host.now() + intervalMs;
      found = await host.scan();
    } catch (error) {
      try {
        host.log.warn("scan failed", { error: describeRejection(error) });
      } catch {
        // Nothing awaits this pass, so a throw here would be an unhandled rejection.
      }
    }
    scanning = false;
    if (generation === scanGeneration) {
      if (found.length > 0) {
        scanFound = found;
        wake();
      }
    }
  }

  // A page job's log line carries at most the job's id and a failure's `kind`: a failure's `detail`
  // and a thrown message can carry a server's or a socket's own words.

  /** Renews until `ended` is set; a lost claim aborts `lost`. */
  async function keepClaim(
    url: string,
    token: string,
    held: HeldClaim,
    ended: { now: boolean; signal: Promise<void> },
    lost: AbortController,
  ): Promise<void> {
    for (;;) {
      await Promise.race([host.sleep(PAGE_RENEW_INTERVAL_MS), ended.signal]);
      if (ended.now) return;
      const renewed = await client.renewPageJob(url, token, held.job, held.hold);
      if (renewed.ok) {
        held.aliveAt = host.now();
      } else {
        if (renewed.failure.kind === "claim_lost") {
          lost.abort();
          return;
        }
        host.log.warn("page job renewal failed", {
          job: held.job.id,
          failure: renewed.failure.kind,
        });
      }
    }
  }

  async function printClaimed(
    url: string,
    token: string,
    held: HeldClaim,
    printPage: NonNullable<typeof host.printPage>,
  ): Promise<PageJobOutcome> {
    const { job } = held;
    const lost = new AbortController();
    let end!: () => void;
    const ended = { now: false, signal: new Promise<void>((resolve) => (end = resolve)) };
    const renewing = keepClaim(url, token, held, ended, lost).catch(() => {
      try {
        host.log.warn("page job renewal stopped", { job: job.id });
      } catch {
        // A throw here would skip the report.
      }
    });
    try {
      const document = await client.fetchPageDocument(url, token, job);
      // A claim lost before printing prints nothing, so the printer was never sent anything.
      if (!document.ok || lost.signal.aborted) return DOCUMENT_UNAVAILABLE;
      const { host: printerHost, port, resourcePath } = job.printer;
      try {
        return await printPage(
          { host: printerHost, port, resourcePath },
          document.value,
          job.printer.documentFormat,
          job.printer.media,
          lost.signal,
          (hold) => {
            held.hold = hold;
          },
        );
      } catch {
        return UNCERTAIN;
      }
    } finally {
      ended.now = true;
      end();
      await Promise.race([renewing, host.sleep(PAGE_RENEW_SETTLE_MS).catch(() => undefined)]);
    }
  }

  /** A report that may not have reached the server is kept, to be resent on the next pull. */
  async function sendPageReport(url: string, token: string, report: PageReport): Promise<void> {
    const sent = await client.reportPageJob(url, token, report.job, report.outcome);
    if (!sent.ok && REPORT_RETRIED.has(sent.failure.kind)) {
      if (!unsentPageReports.includes(report)) unsentPageReports = [...unsentPageReports, report];
      host.log.warn("page job report dropped", { job: report.job.id, failure: sent.failure.kind });
      return;
    }
    unsentPageReports = unsentPageReports.filter((kept) => kept !== report);
    if (!sent.ok) {
      host.log.warn("page job report refused", { job: report.job.id, failure: sent.failure.kind });
    }
  }

  async function resendPageReports(url: string, token: string): Promise<void> {
    for (const report of unsentPageReports) {
      if (host.now() - report.aliveAt > PAGE_REPORT_GIVE_UP_MS) {
        host.log.warn("page job report abandoned", { delivery: report.job.id });
        unsentPageReports = unsentPageReports.filter((kept) => kept !== report);
      } else {
        await sendPageReport(url, token, report);
      }
    }
  }

  /** Nothing awaits a job, so it ends by waking the claim loop, whatever happened to it. */
  async function runPageJob(
    url: string,
    token: string,
    held: HeldClaim,
    printPage: NonNullable<typeof host.printPage>,
  ): Promise<void> {
    try {
      const outcome = await printClaimed(url, token, held, printPage);
      await sendPageReport(url, token, { ...held, outcome });
    } catch {
      try {
        host.log.error("page job failed", { job: held.job.id });
      } catch {
        // A throw here would be an unhandled rejection.
      }
    } finally {
      void claimPageJobs(false);
    }
  }

  /** Claims until the server has none, starting each job without waiting for it. A call while the
   * loop runs makes it claim once more after the server's "none", unless the call is a pull's,
   * whose job the running loop is already doing. */
  async function claimPageJobs(fromPull: boolean): Promise<void> {
    const printPage = host.printPage?.bind(host);
    if (printPage === undefined || pageServer === undefined) return;
    if (claiming) {
      if (!fromPull) claimAgain = true;
      return;
    }
    claiming = true;
    const { url, token } = pageServer;
    try {
      if (fromPull) await resendPageReports(url, token);
      do {
        claimAgain = false;
        while (!stopped) {
          const claimed = await client.claimPageJob(url, token);
          if (!claimed.ok || claimed.value === null) break;
          void runPageJob(
            url,
            token,
            { job: claimed.value, aliveAt: host.now(), hold: null },
            printPage,
          );
        }
      } while (claimAgain);
    } catch {
      try {
        host.log.error("page job runner failed");
      } catch {
        // Nothing awaits this runner, so a throw here would be an unhandled rejection.
      }
    } finally {
      claiming = false;
    }
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
    // A copy, so the merges below never touch the pending list; it is dropped only once a pull
    // carrying it succeeds, and only if no newer pass or reset has replaced it meanwhile.
    const sentScan = scanFound;
    let scanned = [...sentScan];
    if (host.now() < discoveryUntil && !scanning && (!running || host.now() >= nextScanAt)) {
      void discover();
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
    // Classifying the merged list keeps an announced queue when a raw address probe also finds it.
    if (host.markPagePrinters && scanned.some((device) => device.transport === "network_tcp")) {
      try {
        scanned = await host.markPagePrinters(scanned);
      } catch (error) {
        host.log.warn("office-printer check failed", {
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
    // Without an unambiguous raw counterpart, an unanswered queue cannot become a receipt printer.
    scanned = scanned.map((device) =>
      device.ippOnly === true && device.ipp !== undefined && device.office === undefined
        ? {
            ...device,
            office: {
              ...device.ipp,
              printable: false,
              reason: "invalid_reply",
              supportedFormats: [],
            },
          }
        : device,
    );
    const hostname = host.hostname?.();
    const setupUrl = host.setupUrl?.();
    const setupPort = host.setupPort?.();
    const bluetoothPrinting = host.bluetoothPrinting?.();
    const sentOutcomes = bluetoothOutcomes;
    const pulled = await client.pullJobs(current, token, {
      visible,
      scanned,
      pairedBluetooth,
      bluetoothOutcomes: sentOutcomes,
      ...(hostname === undefined ? {} : { host: hostname }),
      ...(setupUrl === undefined ? {} : { setupUrl }),
      ...(setupPort === undefined ? {} : { setupPort }),
      ...(bluetoothPrinting === undefined ? {} : { bluetoothPrinting }),
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
    if (scanFound === sentScan) scanFound = [];
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
    pageServer = { url: current, token };
    void claimPageJobs(true);
    let anyFailed = false;
    for (const job of pulled.value.jobs) if (await push(job, token, current)) anyFailed = true;
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
      stopped = false;
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
      stopped = true;
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
