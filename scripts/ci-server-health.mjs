import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { appendFileSync, realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";

class InventoryUnavailable extends Error {}

async function inventory(request, path, key, limit, pageSize = 100, reread = true) {
  const entries = [];
  let total;
  for (let page = 1; ; page++) {
    const answer = await request(
      `${path}${path.includes("?") ? "&" : "?"}per_page=${pageSize}&page=${page}`,
    );
    assert.ok(
      Number.isSafeInteger(answer.total_count) &&
        answer.total_count >= 0 &&
        (limit !== undefined || answer.total_count <= 1000) &&
        Array.isArray(answer[key]),
      new InventoryUnavailable("Incomplete server inventory"),
    );
    total ??= answer.total_count;
    entries.push(...answer[key]);
    assert.ok(
      entries.length <= answer.total_count,
      new InventoryUnavailable("Incomplete server inventory"),
    );
    assert.ok(
      new Set(entries.map((entry) => entry.id)).size === entries.length,
      new InventoryUnavailable("Duplicate server inventory"),
    );
    if (answer.total_count !== total && reread)
      return inventory(request, path, key, limit, pageSize, false);
    assert.equal(
      answer.total_count,
      total,
      new InventoryUnavailable("Incomplete server inventory"),
    );
    if (entries.length >= Math.min(total, limit ?? total))
      return entries.slice(0, limit ?? entries.length);
    if (!answer[key].length && reread) return inventory(request, path, key, limit, pageSize, false);
    assert.ok(
      answer[key].length > 0,
      new InventoryUnavailable(
        `Incomplete server inventory: empty page after ${entries.length} of ${total} entries`,
      ),
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
  return (await runJobs(options, run, attempt)).filter(
    (job) =>
      job.labels.includes("self-hosted") &&
      job.labels.some((label) =>
        label.startsWith(`${prefix}-${repositoryId}-${run.id}-${attempt}-`),
      ),
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

export async function serverHealth(options, unavailable) {
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
        ),
      unavailable,
    )) {
      if (owned(run, repositoryId)) runs.set(run.id, run);
    }
  }
  const stuck = [];
  let running = 0,
    progressing = false,
    recent = false;
  for (const run of runs.values()) {
    if (
      options.plannersOnly &&
      (run.event !== "pull_request" ||
        run.run_attempt !== 1 ||
        Object.hasOwn(options.hostedAttempts ?? {}, run.id))
    )
      continue;
    const jobs = await readInventory(() => serverJobs(options, run), unavailable);
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
    if (
      jobs.some(
        (job) =>
          job.status === "queued" &&
          !job.runner_id &&
          old(job, now) &&
          (!options.plannersOnly ||
            (job.name === "changes" &&
              job.labels.includes(
                `${options.prefix || "dt"}-${repositoryId}-${run.id}-${run.run_attempt}-changes-1`,
              ))),
      )
    )
      stuck.push(run);
  }
  return { stuck: !options.plannersOnly && (running || progressing) ? [] : stuck, running, recent };
}

export async function serverRoute(options) {
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
      const jobs = await serverJobs(recent, run, attempt - 1);
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
  const state = await serverHealth(recent, unavailable);
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
  assert.ok(
    capacity &&
      ["observedAt", "slots", "serverRunning", "serverWaiting"].every(
        (key) => Number.isSafeInteger(capacity[key]) && capacity[key] >= 0,
      ),
    "Unknown server capacity",
  );
  if (capacity.slots > 0 && capacity.serverRunning === 0 && capacity.serverWaiting === 0)
    return {
      route: "server",
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
    for (const job of await runJobs(recent, run)) {
      if (!job.labels.length || job.labels.includes("self-hosted")) continue;
      if (job.status === "in_progress") running++;
      if (["queued", "pending", "waiting", "requested"].includes(job.status)) queued++;
    }
  }
  return {
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
    return { retried: [] };
  }
  const retried = [],
    preserved = [],
    state = await serverHealth(options);
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
      if (
        current.id !== run.id ||
        current.run_attempt !== run.run_attempt ||
        current.head_sha !== run.head_sha ||
        (!cancelled && current.status === "completed")
      )
        return;
      if (plannersOnly) {
        if (
          !owned(current, options.repositoryId) ||
          current.workflow_id !== run.workflow_id ||
          current.event !== "pull_request" ||
          current.pull_requests?.length !== 1 ||
          current.pull_requests[0].number !== run.pull_requests?.[0]?.number
        )
          return;
        const pull = await request(`/repos/${repository}/pulls/${current.pull_requests[0].number}`);
        if (
          pull.number !== current.pull_requests[0].number ||
          pull.state !== "open" ||
          pull.head?.sha !== run.head_sha ||
          pull.head.repo?.id !== options.repositoryId ||
          pull.base?.repo?.id !== options.repositoryId
        )
          return;
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
      )
        return;
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
        answer = await serverRoute(options);
      } catch (error) {
        answer = {
          route: "hosted",
          blind: true,
          reason: `CI routing inputs could not be verified; using GitHub: ${error.message}`,
        };
      }
      output(`server_route=${answer.route}`);
      report(`CI route: ${answer.route}; ${answer.reason}`);
      if (answer.blind) report(`CI_ROUTE_BLIND run=${options.runId} attempt=${options.attempt}`);
    } else if (command === "check") {
      const state = await serverHealth(options);
      assert.ok(
        !state.stuck.length || serverFull(options) || (await completedServerTraffic(options)),
        `SERVER STUCK: runs ${state.stuck.map((run) => run.id).join(", ")} have waited five minutes without server progress.`,
      );
      report("No stalled server queue needs attention.");
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

export function githubRequest(path, { method = "GET", body } = {}, execute = execFileSync) {
  const args = ["api", path, "--method", method];
  if (body !== undefined) args.push("--input", "-");
  const options = {
    encoding: "utf8",
    timeout: 15000,
    maxBuffer: 2 * 1024 * 1024,
    input: body === undefined ? undefined : JSON.stringify(body),
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
  await healthCommand(
    command,
    {
      request,
      repository: env.GITHUB_REPOSITORY,
      repositoryId: Number(env.GITHUB_REPOSITORY_ID),
      runId: Number(env.GITHUB_RUN_ID),
      attempt: Number(env.GITHUB_RUN_ATTEMPT),
      capacity: () => JSON.parse(env.CAPACITY),
      hostedAttempts:
        command === "recover-planners" && env.HOSTED_ATTEMPTS
          ? JSON.parse(env.HOSTED_ATTEMPTS)
          : {},
      prefix: env.LABEL_PREFIX || "dt",
      ref: "main",
    },
    {
      output: (line) => appendFileSync(env.GITHUB_OUTPUT, line + "\n"),
      report: (line) => {
        console.log(line);
        appendFileSync(env.GITHUB_STEP_SUMMARY, line + "\n");
      },
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
