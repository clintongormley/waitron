import { describe, it, expect } from "vitest";
import * as health from "./ci-server-health.mjs";

const now = Date.parse("2026-11-08T17:00:00Z");
const date = (minutes) => new Date(now - minutes * 60_000).toISOString();
function fixture() {
  const run = {
    id: 12,
    run_attempt: 1,
    head_sha: "a".repeat(40),
    repository: { id: 42 },
    head_repository: { id: 42 },
    event: "push",
    status: "in_progress",
    created_at: date(6),
    run_started_at: date(6),
  };
  const job = {
    id: 123,
    run_id: 12,
    run_attempt: 1,
    head_sha: run.head_sha,
    status: "queued",
    runner_id: 0,
    labels: ["self-hosted", "dt-42-12-1-lint-1"],
    started_at: date(6),
  };
  const calls = [];
  const request = async (path, options = {}) => {
    calls.push([path, options]);
    if (path.includes("/actions/runs?"))
      return {
        total_count: path.includes("status=in_progress") ? 1 : 0,
        workflow_runs: path.includes("status=in_progress") ? [run] : [],
      };
    if (path.endsWith("/runs/12")) return { ...run };
    if (path.includes("/attempts/1/jobs?")) return { total_count: 1, jobs: [{ ...job }] };
    if (path.endsWith("/force-cancel")) {
      run.status = "completed";
      run.conclusion = "cancelled";
      job.status = "completed";
      job.conclusion = "cancelled";
      return null;
    }
    if (path.endsWith("/rerun-failed-jobs")) {
      run.run_attempt++;
      return null;
    }
    throw new Error("Unexpected request " + path);
  };
  return {
    run,
    job,
    calls,
    request,
    options: { request, repository: "fixture/waitron", repositoryId: 42, now },
  };
}

describe("server health recovery", () => {
  it("moves a five-minute unassigned queue to a completed cancellation before requesting its retry", async () => {
    const f = fixture();
    const result = await health.recoverServer(f.options);
    expect(result.retried).toEqual([12]);
    expect(
      f.calls.filter(([, options]) => options.method === "POST").map(([path]) => path),
    ).toEqual([
      "/repos/fixture/waitron/actions/runs/12/force-cancel",
      "/repos/fixture/waitron/actions/runs/12/rerun-failed-jobs",
    ]);
    expect(f.run.status).toBe("completed");
  });

  it.each(["running", "assigned", "young", "foreign-label", "fork", "hosted"])(
    "leaves a %s job alone",
    async (kind) => {
      const f = fixture();
      if (kind === "running") {
        f.job.status = "in_progress";
        f.job.runner_id = 7;
      }
      if (kind === "assigned") f.job.runner_id = 7;
      if (kind === "young") f.job.started_at = date(4);
      if (kind === "foreign-label") f.job.labels[1] = "dt-99-12-1-lint-1";
      if (kind === "fork") f.run.head_repository.id = 99;
      if (kind === "hosted") f.job.labels = ["ubuntu-latest"];
      expect((await health.recoverServer(f.options)).retried).toEqual([]);
      expect(f.calls.filter(([, options]) => options.method === "POST")).toEqual([]);
    },
  );

  it("keeps the retry hosted after its cancelled server queue has disappeared", async () => {
    const f = fixture();
    f.run.status = "completed";
    f.run.conclusion = "cancelled";
    f.job.status = "completed";
    f.job.conclusion = "cancelled";
    expect(await health.serverRoute({ ...f.options, runId: 12, attempt: 2 })).toMatchObject({
      route: "hosted",
      reason: expect.stringContaining("previous"),
    });
  });

  it("does not call a partial inventory a stalled server", async () => {
    const f = fixture(),
      request = f.request;
    f.options.request = async (path, options) =>
      path.includes("/jobs?") ? { total_count: 2, jobs: [f.job] } : request(path, options);
    await expect(health.recoverServer(f.options)).rejects.toThrow(/inventory/);
    expect(f.calls.filter(([, options]) => options.method === "POST")).toEqual([]);
  });
});
