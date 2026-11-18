import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { appendFileSync, realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { isDeepStrictEqual } from "node:util";
import { setTimeout as delay } from "node:timers/promises";

class InventoryUnavailable extends Error {}

async function inventory(
  request,
  path,
  key,
  limit,
  pageSize = 100,
  reread = true,
  staleCount,
  plannerShortfall,
) {
  const entries = [];
  let total;
  for (let page = 1; ; page++) {
    const requestPath = `${path}${path.includes("?") ? "&" : "?"}per_page=${pageSize}&page=${page}`;
    const answer = await request(requestPath);
    const unavailable = (message) => {
      const ids = (rows) =>
        Array.isArray(rows)
          ? rows
              .map((row) => row?.id)
              .filter(Number.isSafeInteger)
              .sort((a, b) => a - b)
              .join(",")
          : "invalid";
      return new InventoryUnavailable(
        `${message}; path=${requestPath}; page=${page}; read=${reread ? 1 : 2}; ` +
          `starting_total=${total ?? "none"}; ` +
          `reply_total=${Number.isSafeInteger(answer.total_count) ? answer.total_count : "invalid"}; ` +
          `rows=${entries.length}; ids=${ids(entries)}; page_ids=${ids(answer[key])}`,
      );
    };
    if (!(
      Number.isSafeInteger(answer.total_count) &&
      answer.total_count >= 0 &&
      (limit !== undefined || answer.total_count <= 1000) &&
      Array.isArray(answer[key])
    ))
      throw unavailable("Incomplete server inventory");
    total ??= answer.total_count;
    entries.push(...answer[key]);
    if (!(entries.length <= answer.total_count)) throw unavailable("Incomplete server inventory");
    assert.ok(
      new Set(entries.map((entry) => entry.id)).size === entries.length,
      new InventoryUnavailable("Duplicate server inventory"),
    );
    if (answer.total_count !== total && reread)
      return inventory(
        request,
        path,
        key,
        limit,
        pageSize,
        false,
        !answer[key].length && staleCount ? { ...staleCount, entries, total } : undefined,
        plannerShortfall,
      );
    if (answer.total_count !== total) throw unavailable("Incomplete server inventory");
    if (entries.length >= Math.min(total, limit ?? total))
      return entries.slice(0, limit ?? entries.length);
    if (!answer[key].length) {
      if (plannerShortfall && !reread) {
        plannerShortfall(unavailable("discovery count shortfall").message);
        return entries;
      }
      if (reread)
        return inventory(
          request,
          path,
          key,
          limit,
          pageSize,
          false,
          staleCount && { ...staleCount, entries, total },
          plannerShortfall,
        );
      const byId = (a, b) => a.id - b.id;
      if (
        staleCount?.entries &&
        isDeepStrictEqual([...entries].sort(byId), [...staleCount.entries].sort(byId))
      ) {
        staleCount.report?.(
          `Stale queued CI inventory count: ${path}; run ids=${entries
            .map((entry) => entry.id)
            .sort((a, b) => a - b)
            .join(",")}; rows=${entries.length}; counts=${staleCount.total},${total}`,
        );
        return entries;
      }
    }
    if (!(answer[key].length > 0))
      throw unavailable(
        `Incomplete server inventory: empty page after ${entries.length} of ${total} entries`,
      );
  }
}

function owned(run, repositoryId) {
  return (
    run.repository?.id === repositoryId &&
    run.head_repository?.id === repositoryId &&
    ["push", "pull_request", "schedule", "workflow_dispatch"].includes(run.event)
  );
}
async function runJobs(options, run, attempt = run.run_attempt) {
  const { request, repository } = options;
  const jobs = await inventory(
    request,
    `/repos/${repository}/actions/runs/${run.id}/attempts/${attempt}/jobs`,
    "jobs",
    undefined,
    30,
  );
  assert.ok(
    jobs.every(
      (job) =>
        job.run_id === run.id &&
        job.run_attempt === attempt &&
        job.head_sha === run.head_sha &&
        Array.isArray(job.labels),
    ),
    "Foreign server job inventory",
  );
  return jobs;
}
async function serverJobs(options, run, attempt = run.run_attempt) {
  const { repositoryId, prefix = "dt" } = options;
  return (await runJobs(options, run, attempt)).filter((job) =>
    serverLabel(job, repositoryId, prefix, run.id, attempt),
  );
}
const serverLabel = (job, repositoryId, prefix, runId, attempt) =>
  job.labels.includes("self-hosted") &&
  job.labels.some((label) => label.startsWith(`${prefix}-${repositoryId}-${runId}-${attempt}-`));
function plannerSkip(options, run, jobs, reason) {
  for (const job of jobs)
    options.report?.(
      `Planner rescue skipped: run=${run.id} attempt=${run.run_attempt} job=${job.id}; ${reason}.`,
    );
}
const assigned = (job) =>
  job.status !== "completed" && (job.status === "in_progress" || job.runner_id > 0);
const old = (job, now) => now - Date.parse(job.started_at || job.created_at) >= 300_000;

async function readInventory(read, unavailable) {
  try {
    return await read();
  } catch (error) {
    if (!unavailable) throw error;
    unavailable.push(error.message);
    return [];
  }
}

export async function serverHealth(options, unavailable, staleQueuedCount, plannerShortfall) {
  const { request, repository, repositoryId, now = Date.now() } = options;
  assert.match(repository, /^[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+$/);
  const runs = new Map();
  for (const status of ["queued", "in_progress"]) {
    for (const run of await readInventory(
      () =>
        inventory(
          request,
          `/repos/${repository}/actions/workflows/ci.yml/runs?status=${status}`,
          "workflow_runs",
          undefined,
          100,
          true,
          status === "queued" ? staleQueuedCount : undefined,
          options.plannersOnly || status === "queued" ? plannerShortfall : undefined,
        ),
      unavailable,
    )) {
      if (owned(run, repositoryId)) runs.set(run.id, run);
    }
  }
  const stuck = [],
    deferredPlanners = [];
  let running = 0,
    progressing = false,
    recent = false;
  for (const run of runs.values()) {
    if (options.plannersOnly && run.event !== "pull_request") continue;
    const excluded =
      options.plannersOnly &&
      (run.run_attempt !== 1 || Object.hasOwn(options.hostedAttempts ?? {}, run.id));
    if (excluded && !options.plannerSkipReason) {
      deferredPlanners.push(run);
      continue;
    }
    let jobs;
    try {
      jobs = await readInventory(
        () => (options.plannersOnly ? runJobs(options, run) : serverJobs(options, run)),
        unavailable,
      );
    } catch (error) {
      if (!options.plannerSkipReason) throw error;
      options.report?.(
        `Planner diagnostics unavailable: run=${run.id} attempt=${run.run_attempt}; ${error.message}`,
      );
      continue;
    }
    if (options.plannersOnly) {
      for (const job of jobs.filter(
        (job) =>
          job.name === "changes" &&
          job.status === "queued" &&
          !job.runner_id &&
          job.labels.includes("self-hosted"),
      )) {
        let reason;
        if (options.plannerSkipReason) {
          if (old(job, now)) reason = options.plannerSkipReason;
        } else if (
          !job.labels.includes(
            `${options.prefix || "dt"}-${repositoryId}-${run.id}-${run.run_attempt}-changes-1`,
          )
        ) {
          reason = "planning label mismatch";
        } else if (!old(job, now)) {
          const field = job.started_at ? "started_at" : "created_at";
          const age = now - Date.parse(job[field]);
          reason = Number.isFinite(age)
            ? `waiting ${age} ms from ${field}; five minutes required`
            : "job age unknown";
        }
        if (reason) plannerSkip(options, run, [job], reason);
      }
      if (options.plannerSkipReason) continue;
      jobs = jobs.filter((job) =>
        serverLabel(job, repositoryId, options.prefix || "dt", run.id, run.run_attempt),
      );
    }
    running += jobs.filter(assigned).length;
    progressing ||= jobs.some(
      (job) =>
        job.runner_id > 0 &&
        [job.started_at, job.completed_at].some((time) => now - Date.parse(time) < 300_000),
    );
    recent ||= jobs.some(
      (job) =>
        job.status === "queued" ||
        assigned(job) ||
        (job.runner_id > 0 && now - Date.parse(job.completed_at) < 300_000),
    );
    const waiting = jobs.filter(
      (job) =>
        job.status === "queued" &&
        !job.runner_id &&
        old(job, now) &&
        (!options.plannersOnly ||
          (job.name === "changes" &&
            job.labels.includes(
              `${options.prefix || "dt"}-${repositoryId}-${run.id}-${run.run_attempt}-changes-1`,
            ))),
    );
    if (waiting.length) stuck.push(options.plannersOnly ? { ...run, plannerJobs: waiting } : run);
  }
  return {
    stuck: !options.plannersOnly && (running || progressing) ? [] : stuck,
    running,
    recent,
    ...(options.plannersOnly ? { deferredPlanners } : {}),
  };
}

function validCapacity(capacity) {
  return (
    capacity &&
    ["observedAt", "slots", "serverRunning", "serverWaiting"].every(
      (key) => Number.isSafeInteger(capacity[key]) && capacity[key] >= 0,
    )
  );
}

export async function serverRoute(options) {
  // The run-created cutoff also omits queued retries of older runs.
  const since = new Date((options.now ?? Date.now()) - 86_400_000).toISOString();
  const recent = {
    ...options,
    request: (path, requestOptions) =>
      options.request(
        path.includes("/runs?status=queued")
          ? `${path}&created=${encodeURIComponent(">=" + since)}`
          : path,
        requestOptions,
      ),
  };
  const { runId, attempt = 1, request, repository, repositoryId } = recent;
  const unavailable = [];
  if (attempt > 1) {
    const cancelled = await readInventory(async () => {
      const run = await request(`/repos/${repository}/actions/runs/${runId}`);
      assert.ok(run.id === runId && owned(run, repositoryId), "Foreign retry run");
      const jobs = await serverJobs(options, run, attempt - 1);
      return jobs.filter(
        (job) =>
          job.status === "completed" &&
          job.conclusion === "cancelled" &&
          !job.runner_id &&
          old(job, Date.parse(job.completed_at)),
      );
    }, unavailable);
    if (cancelled.length) {
      return {
        route: "hosted",
        reason: "A previous attempt waited for the server and was cancelled.",
      };
    }
  }
  const state = await serverHealth(recent, unavailable, {
    report: (message) => options.report?.(`${message}; created>=${since}`),
  });
  if (state.stuck.length)
    return {
      route: "hosted",
      reason: `No running or recently progressing server work was observed in readable runs; server work has waited five minutes in runs ${state.stuck.map((run) => run.id).join(", ")}.${unavailable.length ? ` Other CI inventory could not be verified: ${unavailable.join("; ")}` : ""}`,
    };
  if (unavailable.length)
    return {
      route: "hosted",
      blind: true,
      reason: `CI inventory could not be verified; using GitHub: ${unavailable.join("; ")}`,
    };
  const capacity = typeof options.capacity === "function" ? options.capacity() : options.capacity;
  assert.ok(validCapacity(capacity), "Unknown server capacity");
  const freeSlots = Math.max(0, capacity.slots - capacity.serverRunning - capacity.serverWaiting);
  if (capacity.slots > 0 && capacity.serverRunning === 0 && capacity.serverWaiting === 0)
    return {
      route: "server",
      freeSlots,
      reason: `Server: 0 running, 0 queued / ${capacity.slots} slots; snapshot age ${Math.max(0, (options.now ?? Date.now()) - capacity.observedAt)} ms. Idle server capacity wins every hosted comparison.`,
    };
  const runs = new Map();
  for (const status of ["queued", "in_progress"]) {
    for (const run of await inventory(
      request,
      `/repos/${repository}/actions/runs?status=${status}`,
      "workflow_runs",
    )) {
      assert.equal(run.repository?.id, repositoryId, "Foreign hosted run inventory");
      runs.set(run.id, run);
    }
  }
  let running = 0,
    queued = 0;
  for (const run of runs.values()) {
    for (const job of await runJobs(options, run)) {
      if (!job.labels.length || job.labels.includes("self-hosted")) continue;
      if (job.status === "in_progress") running++;
      if (["queued", "pending", "waiting", "requested"].includes(job.status)) queued++;
    }
  }
  return {
    freeSlots,
    route:
      capacity.slots &&
      (capacity.serverRunning + capacity.serverWaiting) * 20 <= (running + queued) * capacity.slots
        ? "server"
        : "hosted",
    reason: `Server: ${capacity.serverRunning} running, ${capacity.serverWaiting} queued / ${capacity.slots} slots; snapshot age ${Math.max(0, (options.now ?? Date.now()) - capacity.observedAt)} ms. Waitron hosted jobs: ${running} running, ${queued} queued / 20 slots.`,
  };
}

function serverFull(options) {
  let capacity;
  try {
    capacity = typeof options.capacity === "function" ? options.capacity() : options.capacity;
  } catch {
    return false;
  }
  const age = (options.now ?? Date.now()) - capacity?.observedAt;
  return (
    Number.isSafeInteger(capacity?.slots) &&
    capacity.slots > 0 &&
    Number.isSafeInteger(capacity.serverRunning) &&
    capacity.serverRunning >= capacity.slots &&
    Number.isSafeInteger(capacity.observedAt) &&
    age >= 0 &&
    age < 300_000
  );
}

export async function recoverServer(options) {
  const { request, repository, wait = delay, plannersOnly = false } = options;
  if (plannersOnly && serverFull(options)) {
    options.report?.("Planner rescue skipped: server is full in a fresh capacity snapshot.");
    try {
      await serverHealth({ ...options, plannerSkipReason: "server full" });
    } catch (error) {
      options.report?.(`Planner diagnostics unavailable: ${error.message}`);
    }
    return { retried: [] };
  }
  const retried = [],
    preserved = [],
    state = await serverHealth(
      options,
      undefined,
      undefined,
      plannersOnly ? (message) => options.report?.(`Planner ${message}`) : undefined,
    );
  if (!plannersOnly && state.stuck.length && (await completedServerTraffic(options)))
    return { retried };
  const oldest = state.stuck.sort(
    (a, b) =>
      Date.parse(a.run_started_at || a.created_at) - Date.parse(b.run_started_at || b.created_at),
  );
  for (const run of oldest) {
    if (run.run_attempt > 1) {
      preserved.push(run.id);
      continue;
    }
    const path = `/repos/${repository}/actions/runs/${run.id}`;
    const eligible = async (cancelled = false) => {
      const current = await request(path);
      const skip = (reason) => {
        if (plannersOnly && !cancelled) plannerSkip(options, run, run.plannerJobs, reason);
      };
      if (
        current.id !== run.id ||
        current.run_attempt !== run.run_attempt ||
        current.head_sha !== run.head_sha ||
        (!cancelled && current.status === "completed")
      ) {
        skip("run identity changed or completed");
        return;
      }
      if (plannersOnly) {
        if (
          !owned(current, options.repositoryId) ||
          current.workflow_id !== run.workflow_id ||
          current.event !== "pull_request" ||
          current.pull_requests?.length !== 1 ||
          current.pull_requests[0].number !== run.pull_requests?.[0]?.number
        ) {
          skip("PR link missing or changed");
          return;
        }
        const pull = await request(`/repos/${repository}/pulls/${current.pull_requests[0].number}`);
        if (
          pull.number !== current.pull_requests[0].number ||
          pull.state !== "open" ||
          pull.head?.sha !== run.head_sha ||
          pull.head.repo?.id !== options.repositoryId ||
          pull.base?.repo?.id !== options.repositoryId
        ) {
          skip("PR head changed or identity is not an open owned PR");
          return;
        }
      }
      const jobs = await runJobs(options, current);
      if (
        plannersOnly &&
        !jobs.some(
          (job) =>
            job.name === "changes" &&
            job.labels.includes("self-hosted") &&
            job.labels.includes(
              `${options.prefix || "dt"}-${options.repositoryId}-${run.id}-1-changes-1`,
            ) &&
            (cancelled
              ? job.status === "completed" && job.conclusion === "cancelled"
              : job.status === "queued" && !job.runner_id) &&
            old(job, options.now ?? Date.now()),
        )
      ) {
        skip("planning job no longer queued unassigned and old");
        return;
      }
      if (
        jobs.some(
          (job) =>
            job.name !== "server-queue-watchdog" &&
            !(
              job.name === "changes" &&
              job.status === "completed" &&
              job.conclusion === "success"
            ) &&
            (assigned(job) ||
              job.runner_id > 0 ||
              (job.status === "completed" && !["skipped", "cancelled"].includes(job.conclusion))),
        )
      ) {
        skip("other work has started or completed");
        preserved.push(run.id);
        return;
      }
      return current;
    };
    if (!plannersOnly && !(await eligible())) continue;
    if (
      !plannersOnly &&
      !(await serverHealth(options)).stuck.some(
        (current) => current.id === run.id && current.run_attempt === run.run_attempt,
      )
    )
      continue;
    let current = await eligible();
    if (!current) continue;
    if (plannersOnly)
      options.report?.(
        `Recovering PR run ${run.id}; cancellation/retry pending. If this pass stops, intervention is needed.`,
      );
    try {
      await request(path + "/force-cancel", { method: "POST" });
    } catch (error) {
      throw new Error(
        `Stuck run ${run.id} force-cancel refused; intervention needed: ${error.message}`,
        { cause: error },
      );
    }
    for (let poll = 0; poll < 24; poll++) {
      current = await request(path);
      assert.ok(
        current.id === run.id &&
          current.run_attempt === run.run_attempt &&
          current.head_sha === run.head_sha,
        "Stuck run changed during cancellation",
      );
      if (current.status === "completed") break;
      await wait(5000);
    }
    assert.equal(current.status, "completed", "Stuck run cancellation did not finish");
    if (current.conclusion === "cancelled") {
      try {
        if (plannersOnly) {
          if (!(await eligible(true))) {
            const number = run.pull_requests[0].number;
            const pull = await request(`/repos/${repository}/pulls/${number}`);
            if (
              pull.number === number &&
              (pull.state === "closed" ||
                (typeof pull.head?.sha === "string" && pull.head.sha !== run.head_sha))
            ) {
              options.report?.(`Cancelled PR run ${run.id} is obsolete; not retried.`);
              continue;
            }
            throw new Error(
              "Current-head PR identity or work could not be verified after cancellation",
            );
          }
        }
        await request(path + "/rerun", { method: "POST" });
        retried.push(run.id);
        if (plannersOnly) options.report?.(`Retried PR run ${run.id} on GitHub.`);
      } catch (error) {
        if (!plannersOnly) throw error;
        throw new Error(`Cancelled PR run ${run.id}; intervention needed: ${error.message}`, {
          cause: error,
        });
      }
    }
    if (!plannersOnly) break;
  }
  for (const run of state.deferredPlanners ?? []) {
    try {
      const jobs = (await runJobs(options, run)).filter(
        (job) =>
          job.name === "changes" &&
          job.status === "queued" &&
          !job.runner_id &&
          job.labels.includes("self-hosted") &&
          old(job, options.now ?? Date.now()),
      );
      const reason = run.run_attempt !== 1 ? "retry run" : "run marked for hosted recovery";
      plannerSkip(options, run, jobs, reason);
    } catch (error) {
      options.report?.(
        `Planner diagnostics unavailable: run=${run.id} attempt=${run.run_attempt}; ${error.message}`,
      );
    }
  }
  return { retried, ...(preserved.length ? { preserved } : {}) };
}

async function completedServerTraffic(options) {
  const { request, repository, repositoryId, now = Date.now() } = options;
  const runs = await inventory(
    request,
    `/repos/${repository}/actions/workflows/ci.yml/runs?status=completed`,
    "workflow_runs",
    100,
  );
  for (const run of runs) {
    if (!owned(run, repositoryId) || now - Date.parse(run.updated_at) > 300_000) continue;
    if (
      (await serverJobs(options, run)).some(
        (job) => job.runner_id > 0 && now - Date.parse(job.completed_at) < 300_000,
      )
    )
      return true;
  }
  return false;
}

export async function needsServerProbe(options) {
  return !(await serverHealth(options)).recent && !(await completedServerTraffic(options));
}

export async function healthCommand(command, options, { report, output }) {
  try {
    if (command === "route") {
      let answer;
      try {
        answer = await serverRoute({ ...options, report });
      } catch (error) {
        answer = {
          route: "hosted",
          blind: true,
          reason: `CI routing inputs could not be verified; using GitHub: ${error.message}`,
        };
      }
      if (options.families) {
        const families = options.families.filter((family) => family.enabled);
        let freeSlots = answer.freeSlots ?? 0;
        const serverJobs = {};
        for (const { id, count } of families) {
          if (freeSlots === 0) break;
          const selected = Math.min(count, freeSlots);
          serverJobs[id] = selected;
          freeSlots -= selected;
        }
        output(`server_families=${JSON.stringify(families)}`);
        output(`server_jobs=${JSON.stringify(serverJobs)}`);
        report(`CI server job candidates: ${JSON.stringify(serverJobs)}`);
      }
      output(`server_route=${answer.route}`);
      report(`CI route: ${answer.route}; ${answer.reason}`);
      if (answer.blind) report(`CI_ROUTE_BLIND run=${options.runId} attempt=${options.attempt}`);
    } else if (command === "check") {
      let short = false;
      const state = await serverHealth(
        { ...options, plannersOnly: false },
        undefined,
        undefined,
        (message) => {
          short = true;
          report(`Queued workflow ${message}`);
        },
      );
      assert.ok(
        !state.stuck.length || serverFull(options) || (await completedServerTraffic(options)),
        `SERVER STUCK: runs ${state.stuck.map((run) => run.id).join(", ")} have waited five minutes without server progress.`,
      );
      report(
        short
          ? "Queued workflow inventory was short; unread runs may contain waiting work."
          : "No stalled server queue needs attention.",
      );
    } else if (command === "recover" || command === "recover-planners") {
      const { retried, preserved = [] } = await recoverServer({
        ...options,
        plannersOnly: command === "recover-planners",
        report,
      });
      if (preserved.length)
        report(
          `Preserved runs ${preserved.join(", ")} because work has started or completed, or this is already a retry.`,
        );
      if (retried.length || !preserved.length)
        report(
          retried.length
            ? `SERVER STUCK: cancelled and retried runs ${retried.join(", ")} after five minutes without assigned${command === "recover" ? " or recently progressing server" : ""} work.`
            : command === "recover-planners"
              ? "No planner was retried."
              : "No stalled server run needed recovery.",
        );
    } else {
      assert.equal(command, "probe", "Unknown server health command");
      if (await needsServerProbe(options)) {
        await options.request(`/repos/${options.repository}/actions/workflows/ci.yml/dispatches`, {
          method: "POST",
          body: { ref: options.ref, inputs: { server_probe: true } },
        });
        report("Dispatched one server pickup probe after no recent server traffic was observed.");
      } else report("Server traffic was observed; no idle probe is needed.");
    }
  } catch (error) {
    if (!(error instanceof InventoryUnavailable)) throw error;
    report(
      command === "recover-planners"
        ? `Server inventory unavailable; planner recovery stopped: ${error.message}`
        : `Server inventory unavailable; ${command} made no change: ${error.message}`,
    );
  }
}

export function githubRequest(path, { method = "GET", body, token } = {}, execute = execFileSync) {
  const args = ["api", path, "--method", method];
  if (body !== undefined) args.push("--input", "-");
  const options = {
    encoding: "utf8",
    timeout: 15000,
    maxBuffer: 2 * 1024 * 1024,
    input: body === undefined ? undefined : JSON.stringify(body),
    ...(token ? { env: { ...process.env, GH_TOKEN: token } } : {}),
  };
  let result;
  for (let attempt = 0; ; attempt++) {
    try {
      result = execute("gh", args, options);
      break;
    } catch (error) {
      if (
        method !== "GET" ||
        attempt ||
        !/\bHTTP 5\d\d\b/.test(String(error.stderr ?? error.message))
      )
        throw error;
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 1000);
    }
  }
  return result.trim() ? JSON.parse(result) : null;
}

export async function main(command, env = process.env, request = githubRequest) {
  const report = (line) => {
    console.log(line);
    appendFileSync(env.GITHUB_STEP_SUMMARY, line + "\n");
  };
  let capacity = () => JSON.parse(env.CAPACITY);
  if (command === "route") {
    let source = "snapshot (no read token)";
    if (env.CAPACITY_READ_TOKEN) {
      try {
        const response = await request(
          `/repos/${env.GITHUB_REPOSITORY}/actions/variables/DISPOSABLE_TESTS_CAPACITY`,
          { token: env.CAPACITY_READ_TOKEN },
        );
        const fresh = JSON.parse(response.value);
        assert.ok(validCapacity(fresh), "Unknown server capacity");
        capacity = fresh;
        source = "fresh";
      } catch {
        source = "snapshot (fresh read failed)";
      }
    }
    const readCapacity = capacity;
    capacity = () => {
      report(`CI capacity source: ${source}`);
      return typeof readCapacity === "function" ? readCapacity() : readCapacity;
    };
  }
  await healthCommand(
    command,
    {
      request,
      repository: env.GITHUB_REPOSITORY,
      repositoryId: Number(env.GITHUB_REPOSITORY_ID),
      runId: Number(env.GITHUB_RUN_ID),
      attempt: Number(env.GITHUB_RUN_ATTEMPT),
      capacity,
      families: env.FAMILIES ? JSON.parse(env.FAMILIES) : undefined,
      hostedAttempts:
        command === "recover-planners" && env.HOSTED_ATTEMPTS
          ? JSON.parse(env.HOSTED_ATTEMPTS)
          : {},
      prefix: env.LABEL_PREFIX || "dt",
      ref: "main",
    },
    {
      output: (line) => appendFileSync(env.GITHUB_OUTPUT, line + "\n"),
      report,
    },
  );
}
// Inline rather than scripts/is-main-script.mjs: CI downloads this file alone to $RUNNER_TEMP.
function isMainScript() {
  try {
    return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}
if (isMainScript()) await main(process.argv[2]);
