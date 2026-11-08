import assert from "node:assert/strict";
import { setTimeout as delay } from "node:timers/promises";

async function inventory(request, path, key) {
  const entries = [];
  let total;
  for (let page = 1; page <= 10; page++) {
    const answer = await request(
      `${path}${path.includes("?") ? "&" : "?"}per_page=100&page=${page}`,
    );
    total ??= answer.total_count;
    assert.ok(
      Number.isSafeInteger(total) &&
        total >= 0 &&
        total <= 1000 &&
        answer.total_count === total &&
        Array.isArray(answer[key]),
      "Incomplete server inventory",
    );
    entries.push(...answer[key]);
    assert.ok(
      entries.length <= total && new Set(entries.map((entry) => entry.id)).size === entries.length,
      "Duplicate server inventory",
    );
    if (entries.length === total) return entries;
    assert.equal(answer[key].length, 100, "Incomplete server inventory page");
  }
  throw new Error("Server inventory page limit exceeded");
}

function owned(run, repositoryId) {
  return (
    run.repository?.id === repositoryId &&
    run.head_repository?.id === repositoryId &&
    ["push", "pull_request", "schedule", "workflow_dispatch"].includes(run.event)
  );
}
async function serverJobs(options, run, attempt = run.run_attempt) {
  const { request, repository, repositoryId, prefix = "dt" } = options;
  const jobs = await inventory(
    request,
    `/repos/${repository}/actions/runs/${run.id}/attempts/${attempt}/jobs`,
    "jobs",
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
  return jobs.filter(
    (job) =>
      job.labels.includes("self-hosted") &&
      job.labels.some((label) =>
        label.startsWith(`${prefix}-${repositoryId}-${run.id}-${attempt}-`),
      ),
  );
}
const assigned = (job) =>
  job.status !== "completed" && (job.status === "in_progress" || job.runner_id > 0);
const old = (job, run, now) =>
  now - Date.parse(job.started_at || run.run_started_at || run.created_at) >= 300_000;

export async function serverHealth(options) {
  const { request, repository, repositoryId, now = Date.now() } = options;
  assert.match(repository, /^[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+$/);
  const runs = new Map();
  for (const status of ["queued", "in_progress"]) {
    for (const run of await inventory(
      request,
      `/repos/${repository}/actions/runs?status=${status}`,
      "workflow_runs",
    )) {
      if (owned(run, repositoryId)) runs.set(run.id, run);
    }
  }
  const stuck = [];
  let running = 0,
    recent = false;
  for (const run of runs.values()) {
    const jobs = await serverJobs(options, run);
    running += jobs.filter(assigned).length;
    recent ||= jobs.some((job) => assigned(job) || now - Date.parse(job.completed_at) < 900_000);
    if (jobs.some((job) => job.status === "queued" && !job.runner_id && old(job, run, now)))
      stuck.push(run);
  }
  return { stuck: running ? [] : stuck, running, recent };
}

export async function serverRoute(options) {
  const { runId, attempt = 1, request, repository, repositoryId, now = Date.now() } = options;
  if (attempt > 1) {
    const run = await request(`/repos/${repository}/actions/runs/${runId}`);
    assert.ok(run.id === runId && owned(run, repositoryId), "Foreign retry run");
    const jobs = await serverJobs(options, run, attempt - 1);
    if (
      jobs.some(
        (job) =>
          job.status === "completed" &&
          job.conclusion === "cancelled" &&
          !job.runner_id &&
          old(job, run, now),
      )
    ) {
      return {
        route: "hosted",
        reason: "A previous attempt waited for the server and was cancelled.",
      };
    }
  }
  const state = await serverHealth(options);
  return state.stuck.length
    ? {
        route: "hosted",
        reason: `No server jobs are running; server work has waited five minutes in runs ${state.stuck.map((run) => run.id).join(", ")}.`,
      }
    : { route: "server", reason: "No stalled server queue was observed." };
}

export async function recoverServer(options) {
  const { request, repository, wait = delay } = options;
  const retried = [],
    state = await serverHealth(options);
  for (const run of state.stuck) {
    if (
      !(await serverHealth(options)).stuck.some(
        (current) => current.id === run.id && current.run_attempt === run.run_attempt,
      )
    )
      continue;
    const path = `/repos/${repository}/actions/runs/${run.id}`;
    let current = await request(path);
    if (
      current.id !== run.id ||
      current.run_attempt !== run.run_attempt ||
      current.head_sha !== run.head_sha ||
      current.status === "completed"
    )
      continue;
    await request(path + "/force-cancel", { method: "POST" });
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
      await request(path + "/rerun-failed-jobs", { method: "POST" });
      retried.push(run.id);
    }
  }
  return { retried };
}
