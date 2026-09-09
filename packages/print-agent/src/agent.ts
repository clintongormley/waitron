import { createClient, type AgentClient, type Failure, type WireJob } from "./client.js";
import type { AgentConfig, AgentStatus, Host } from "./host.js";
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
    let outcome: { status: "done" } | { status: "failed"; error: string };
    let failed = false;
    try {
      await host.transport.send(
        {
          id: job.printerId,
          transport: job.transport,
          host: job.host,
          port: job.port,
          usbPath: job.usbPath,
        },
        job.payload,
      );
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
    const config = await host.config();
    if (config === null) {
      report({ phase: "unconfigured", serverUrl: null, current: null });
      return false;
    }
    if (halted) {
      report({ phase: "unauthorized", serverUrl: config.serverUrl });
      return false;
    }
    const r = routerFor(config);
    await r.probe();
    if (config.environment === undefined && r.environment !== undefined) {
      await host.saveConfig({ ...config, environment: r.environment });
    }
    const current = r.current;

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
        report({ phase: "pending", serverUrl: config.serverUrl, current });
        return false;
      }
      if (s.value === "not_approved") {
        await halt(config, current);
        return false;
      }
      approved = true;
    }

    const pulled = await client.pullJobs(current, token);
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
