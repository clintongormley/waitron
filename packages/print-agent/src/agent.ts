import {
  createClient,
  type AgentClient,
  type Failure,
  type JobOutcome,
  type WireJob,
} from "./client.js";
import type { AgentConfig, AgentStatus, DiscoveredDevice, Host } from "./host.js";
import { Router } from "./router.js";

/** The idle poll interval (base spec §4 step 6). A non-empty batch re-polls at once; only an empty pull sleeps. */
export const POLL_INTERVAL_MS = 2_000;

export interface AgentOptions {
  host: Host;
  client?: AgentClient;
  intervalMs?: number;
}

export interface Agent {
  runOnce(): Promise<void>;
  start(): Promise<void>;
  stop(): void;
  readonly status: AgentStatus;
}

function describe(failure: Failure): string {
  return "detail" in failure ? `${failure.kind}: ${failure.detail}` : failure.kind;
}

/**
 * The loop (base spec §4, as amended by device-join §7). `runOnce` is one tick and NEVER throws —
 * every failure becomes a status the host renders. Enrolment is join-and-accept: a knocking agent
 * JOINS (creating a shared join-request), then POLLS its status until an admin accepts, and only THEN
 * pulls. It never pulls with an unapproved token (that reads as `unauthorized` and would halt it).
 *
 * Cross-tick state: the router (server list + current), `approved` (set once the status poll first
 * says so, so later ticks skip the poll and pull straight away — a restart re-confirms it in one
 * poll), and `halted` (set on `not_approved`/`unauthorized` — the token is dead and re-joining on our
 * own would put a denied agent straight back into the admin's list, so only a restart asks again).
 */
export function createAgent(opts: AgentOptions): Agent {
  const host = opts.host;
  const client = opts.client ?? createClient({ fetch: host.fetch });
  const intervalMs = opts.intervalMs ?? POLL_INTERVAL_MS;
  let router: Router | undefined;
  let approved = false;
  let halted = false;
  let running = false;
  // Cross-tick: the epoch-ms instant the server's last reply said discovery is open until. The NEXT
  // tick actively scans (and posts the results) only while `host.now()` is still under it; 0 means no
  // window, so an initial tick and a closed window both skip the scan.
  let discoveryUntil = 0;
  let status: AgentStatus = { phase: "unconfigured", serverUrl: null, current: null };
  let lastPhaseLine = "";

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
        probe: client.probeNode,
      });
    }
    return router;
  }

  async function halt(config: AgentConfig, current: string): Promise<void> {
    halted = true;
    approved = false;
    await host.saveToken(null);
    // The join request is dead; drop the persisted verification number so a restart shows no stale code.
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

  /** Sends one job and reports its outcome. Returns true if the send FAILED (not the report delivery),
   * so the caller knows whether this tick was clean. `lastError` is set on a failed send and left
   * alone on a successful one — a same-batch failure stays visible; the end-of-tick running report is
   * the only place that clears it, and only for a fully clean tick. */
  async function push(job: WireJob, token: string, current: string): Promise<boolean> {
    let outcome: JobOutcome;
    let failed = false;
    try {
      // Resolve the job's connection facts to a concrete target on THIS box (a localKey → device
      // path) before sending. A device that is gone throws here and lands in the catch → `failed`.
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

  /** Returns true when the tick did work (a non-empty batch), so `start` re-polls at once. */
  async function tick(): Promise<boolean> {
    // Tracked across the tick's own `saveConfig` calls so a later merge (the pinned environment, the
    // pending number) never clobbers an earlier one — the loop, not the host, holds the live config.
    let config = await host.config();
    if (config === null) {
      report({ phase: "unconfigured", serverUrl: null, current: null });
      return false;
    }
    if (halted) {
      report({ phase: "unauthorized", serverUrl: config.serverUrl });
      return false;
    }
    const r = routerFor(config);
    const round = await r.probe();
    if (config.environment === undefined && r.environment !== undefined) {
      config = { ...config, environment: r.environment };
      await host.saveConfig(config);
    }
    const current = r.current;

    // The round found no accepting primary in the agent's own environment — a server answering a
    // DIFFERENT environment is `standby`, not `primary`, and its token must never be sent there
    // (CLAUDE.md §5). End the tick with NO network write; only an eligible in-env primary proceeds.
    if (!round.anyAccepting) {
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
      token = joined.value.token;
      await host.saveToken(token);
      approved = false;
      // Persist the number so a restart-while-pending still shows it: the reloaded token keeps polling
      // the SAME join request, so this is the only surviving copy of the code the admin must match.
      config = { ...config, pendingVerificationNumber: joined.value.verificationNumber };
      await host.saveConfig(config);
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
        // Sourced from the persisted config, so it survives a restart (the join reply is long gone).
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
      // Approved: the number has served its purpose, so drop it from the persisted config.
      if (config.pendingVerificationNumber !== undefined) {
        config = { ...config, pendingVerificationNumber: undefined };
        await host.saveConfig(config);
      }
    }

    // Report the box's device inventory on every pull. `visible` is always gathered; `scanned` is an
    // active discovery pass, run only while the previous reply's window is still open (cross-tick).
    const visible = await host.visibleDevices();
    // Discovery is isolated from the pull: a throwing scan (e.g. the box has no Bluetooth adapter, so
    // `scan(["bluetooth"])` throws `spawn bluetoothctl ENOENT`) must NEVER stop the job pull. Catch it,
    // log it, and pull with whatever inventory we have — repeated scan failures must not suppress printing.
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
    const pulled = await client.pullJobs(current, token, { visible, scanned });
    if (!pulled.ok) {
      if (pulled.failure.kind === "unauthorized") {
        await halt(config, current);
      } else {
        report({
          phase: "unreachable",
          serverUrl: config.serverUrl,
          current,
          lastError: describe(pulled.failure),
        });
      }
      return false;
    }
    r.merge(pulled.value.servers);
    // Carry the window forward so the NEXT tick knows whether to scan; a null reply closes it (0).
    discoveryUntil = pulled.value.discoveryUntil ?? 0;
    // Tick-local, reset every tick (never `lastError` itself mid-loop): did ANY send fail this tick?
    let anyFailed = false;
    for (const job of pulled.value.jobs) if (await push(job, token, current)) anyFailed = true;
    // `lastError` is overwritten only by a later failed send and cleared only by a fully clean running
    // tick — an all-success batch or an empty pull. A partial-failure batch keeps the failure visible.
    report({
      phase: "running",
      serverUrl: config.serverUrl,
      current,
      verificationCode: undefined,
      ...(anyFailed ? {} : { lastError: undefined }),
    });
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

  return {
    get status() {
      return status;
    },
    async runOnce() {
      await runOnce();
    },
    async start() {
      running = true;
      while (running) {
        const busy = await runOnce();
        if (!running) break;
        if (!busy) await host.sleep(intervalMs);
      }
    },
    stop() {
      running = false;
    },
  };
}
