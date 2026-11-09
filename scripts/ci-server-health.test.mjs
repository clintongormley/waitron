import { describe, it, expect } from "vitest";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { URL } from "node:url";
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
        workflow_runs: path.includes("status=in_progress")
          ? [{ ...run, id: 13, run_attempt: 1 }]
          : [],
      };
    if (path.includes("/runs/13/attempts/1/jobs?"))
      return {
        total_count: 20,
        jobs: Array.from({ length: 20 }, (_, id) => ({
          ...job,
          id: 200 + id,
          run_id: 13,
          run_attempt: 1,
          status: "in_progress",
          runner_id: 200 + id,
          labels: ["ubuntu-latest"],
        })),
      };
    if (path.includes("/runs?"))
      return {
        total_count: path.includes("status=in_progress") ? 1 : 0,
        workflow_runs: path.includes("status=in_progress") ? [{ ...run }] : [],
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
    if (path.endsWith("/rerun")) {
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
  it.each(["in_progress", "queued"])(
    "preserves a hosted sibling with an assigned runner while it is %s",
    async (status) => {
      const f = fixture(),
        request = f.request;
      const sibling = {
        ...f.job,
        id: 124,
        name: "bundle-smoke",
        labels: ["ubuntu-latest"],
        status,
        runner_id: 7,
      };
      f.options.request = async (path, options) =>
        path.includes("/runs/12/attempts/1/jobs?")
          ? { total_count: 2, jobs: [f.job, sibling] }
          : request(path, options);
      expect((await health.recoverServer(f.options)).retried).toEqual([]);
      expect(f.calls.some(([, options]) => options.method)).toBe(false);
    },
  );

  it.each(["server-queue-watchdog", "server-queue-watchdog-copy"])(
    "exempts only the exact recovery control job: %s",
    async (name) => {
      const f = fixture(),
        request = f.request;
      const watchdog = {
        ...f.job,
        id: 124,
        name,
        labels: ["ubuntu-latest"],
        status: "in_progress",
        runner_id: 7,
      };
      f.options.request = async (path, options) =>
        path.includes("/runs/12/attempts/1/jobs?")
          ? { total_count: 2, jobs: [f.job, watchdog] }
          : request(path, options);
      expect((await health.recoverServer(f.options)).retried).toEqual(
        name === "server-queue-watchdog" ? [12] : [],
      );
    },
  );

  it("preserves a hosted assignment appearing in the final cancellation inventory", async () => {
    const f = fixture(),
      request = f.request;
    let reads = 0;
    f.options.request = async (path, options) => {
      if (path.includes("/runs/12/attempts/1/jobs?") && ++reads >= 3)
        return {
          total_count: 2,
          jobs: [
            f.job,
            { ...f.job, id: 124, labels: ["ubuntu-latest"], status: "queued", runner_id: 9 },
          ],
        };
      return request(path, options);
    };
    expect((await health.recoverServer(f.options)).retried).toEqual([]);
    expect(f.calls.some(([, options]) => options.method)).toBe(false);
  });

  it.each([date(1), undefined])(
    "does not date an unstarted job from an old workflow when created_at is %s",
    async (created_at) => {
      const f = fixture();
      Object.assign(f.job, { started_at: null, created_at });
      expect((await health.recoverServer(f.options)).retried).toEqual([]);
      expect(f.calls.some(([, options]) => options.method)).toBe(false);
    },
  );

  it("recovers an unstarted job whose own creation was more than five minutes ago", async () => {
    const f = fixture();
    Object.assign(f.job, { started_at: null, created_at: date(6) });
    expect((await health.recoverServer(f.options)).retried).toEqual([12]);
  });

  it.each(["started_at", "completed_at"])(
    "preserves queued work after recent server %s activity",
    async (field) => {
      const f = fixture(),
        request = f.request;
      const finished = {
        ...f.job,
        id: 124,
        status: "completed",
        conclusion: "success",
        runner_id: 7,
        started_at: date(7),
        completed_at: null,
        [field]: date(0.5),
      };
      f.options.request = async (path, options) =>
        path.includes("/jobs?")
          ? { total_count: 2, jobs: [f.job, finished] }
          : request(path, options);
      expect((await health.recoverServer(f.options)).retried).toEqual([]);
      expect(f.calls.some(([, options]) => options.method)).toBe(false);
      finished[field] = date(5.1);
      expect((await health.serverHealth(f.options)).stuck.map((run) => run.id)).toEqual([12]);
    },
  );
  it("writes the real workflow output and summary files", async () => {
    const directory = mkdtempSync(tmpdir() + "/health-output-");
    try {
      const f = fixture();
      f.job.started_at = new Date(Date.now() - 360_000).toISOString();
      await health.main(
        "route",
        {
          GITHUB_REPOSITORY: "fixture/waitron",
          GITHUB_REPOSITORY_ID: "42",
          GITHUB_RUN_ID: "13",
          GITHUB_RUN_ATTEMPT: "1",
          GITHUB_OUTPUT: directory + "/output",
          GITHUB_STEP_SUMMARY: directory + "/summary",
        },
        f.request,
      );
      expect(readFileSync(directory + "/output", "utf8")).toBe("server_route=hosted\n");
      expect(readFileSync(directory + "/summary", "utf8")).toContain("five minutes");
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("sends bounded GitHub requests with structured dispatch inputs", () => {
    const calls = [],
      execute = (...args) => (calls.push(args), "");
    expect(
      health.githubRequest(
        "/repos/o/r/dispatches",
        { method: "POST", body: { ref: "main" } },
        execute,
      ),
    ).toBeNull();
    expect(calls).toEqual([
      [
        "gh",
        ["api", "/repos/o/r/dispatches", "--method", "POST", "--input", "-"],
        { encoding: "utf8", timeout: 15000, maxBuffer: 2 * 1024 * 1024, input: '{"ref":"main"}' },
      ],
    ]);
    expect(health.githubRequest("/repos/o/r", undefined, () => '{"id":42}')).toEqual({ id: 42 });
  }, 20_000);

  it("uses the server when the health read fails and never changes shared settings", async () => {
    const outputs = [],
      reports = [];
    await health.healthCommand(
      "route",
      {
        ...fixture().options,
        request: async () => {
          throw new Error("HTTP 503");
        },
      },
      { report: (line) => reports.push(line), output: (line) => outputs.push(line) },
    );
    expect(outputs).toEqual(["server_route=server"]);
    expect(reports[0]).toContain("could not be verified");
  });

  it("rejects a changed run identity while waiting for cancellation", async () => {
    const f = fixture(),
      request = f.request;
    f.options.request = async (path, options) => {
      const result = await request(path, options);
      if (path.endsWith("/force-cancel")) f.run.run_attempt = 2;
      return result;
    };
    await expect(health.recoverServer(f.options)).rejects.toThrow(/changed during cancellation/);
    expect(f.calls.some(([path]) => path.endsWith("/rerun"))).toBe(false);
  });

  it.each(["id", "run_attempt", "head_sha", "status"])(
    "leaves a run alone when its %s changes before cancellation",
    async (field) => {
      const f = fixture(),
        request = f.request;
      f.options.request = async (path, options) =>
        path.endsWith("/runs/12")
          ? {
              ...f.run,
              [field]:
                field === "status" ? "completed" : field === "head_sha" ? "b".repeat(40) : 99,
            }
          : request(path, options);
      expect((await health.recoverServer(f.options)).retried).toEqual([]);
      expect(f.calls.some(([, options]) => options.method)).toBe(false);
    },
  );

  it("rejects duplicate and foreign job inventories before a cancellation", async () => {
    for (const jobs of [
      [fixture().job, fixture().job],
      [{ ...fixture().job, head_sha: "b".repeat(40) }],
    ]) {
      const f = fixture(),
        request = f.request;
      f.options.request = async (path, options) =>
        path.includes("/jobs?") ? { total_count: jobs.length, jobs } : request(path, options);
      await expect(health.recoverServer(f.options)).rejects.toThrow(/inventory/);
      expect(f.calls.some(([, options]) => options.method)).toBe(false);
    }
  });

  it("reports a routing refusal and the GitHub output without changing the human switch", async () => {
    const f = fixture(),
      reports = [],
      outputs = [];
    await health.healthCommand("route", f.options, {
      report: (line) => reports.push(line),
      output: (line) => outputs.push(line),
    });
    expect(outputs).toEqual(["server_route=hosted"]);
    expect(reports.join("\n")).toContain("five minutes");
    expect(f.calls.some(([, options]) => options.method)).toBe(false);
  });

  it("reports recovery and dispatches only an idle probe", async () => {
    const f = fixture(),
      request = f.request,
      reports = [];
    f.options.request = async (path, options) =>
      path.endsWith("/dispatches") ? (f.calls.push([path, options]), null) : request(path, options);
    await health.healthCommand(
      "recover",
      { ...f.options, ref: "main" },
      { report: (line) => reports.push(line) },
    );
    expect(reports.join("\n")).toContain("12");
    expect(f.calls.filter(([path]) => path.endsWith("/dispatches"))).toHaveLength(0);
    const probe = fixture(),
      probeRequest = probe.request;
    probe.job.labels = ["ubuntu-latest"];
    probe.options.request = async (path, options) =>
      path.endsWith("/dispatches")
        ? (probe.calls.push([path, options]), null)
        : probeRequest(path, options);
    await health.healthCommand(
      "probe",
      { ...probe.options, ref: "main" },
      { report: (line) => reports.push(line) },
    );
    expect(probe.calls.at(-1)).toEqual([
      "/repos/fixture/waitron/actions/workflows/ci.yml/dispatches",
      { method: "POST", body: { ref: "main", inputs: { server_probe: true } } },
    ]);
  });
  it("uses GitHub for a new run while an old server queue is stuck", async () => {
    const f = fixture();
    expect(await health.serverRoute(f.options)).toMatchObject({ route: "hosted" });
  });

  it("probes an idle server and suppresses another probe while its first job is queued", async () => {
    const f = fixture();
    f.job.labels = ["ubuntu-latest"];
    expect(await health.needsServerProbe(f.options)).toBe(true);
    f.job.labels = ["self-hosted", "dt-42-12-1-server-probe-1"];
    f.job.started_at = date(1);
    expect(await health.needsServerProbe(f.options)).toBe(false);
  });

  it("does not probe within five minutes of completed server traffic", async () => {
    const f = fixture(),
      request = f.request;
    f.job.status = "completed";
    f.job.completed_at = date(4);
    f.job.runner_id = 7;
    f.run.status = "completed";
    f.options.request = async (path, options) =>
      path.includes("/runs?")
        ? {
            total_count: path.includes("status=completed") ? 1 : 0,
            workflow_runs: path.includes("status=completed") ? [f.run] : [],
          }
        : request(path, options);
    expect(await health.needsServerProbe(f.options)).toBe(false);
    f.job.completed_at = date(6);
    expect(await health.needsServerProbe(f.options)).toBe(true);
  });

  it("probes at the next fifteen-minute tick after a two-minute idle probe", async () => {
    const f = fixture(),
      request = f.request;
    f.run.status = "completed";
    Object.assign(f.job, {
      status: "completed",
      runner_id: 7,
      started_at: date(15),
      completed_at: date(13),
      labels: ["self-hosted", "dt-42-12-1-server-probe-1"],
    });
    f.options.request = async (path, options) =>
      path.includes("/runs?")
        ? {
            total_count: path.includes("status=completed") ? 1 : 0,
            workflow_runs: path.includes("status=completed") ? [f.run] : [],
          }
        : request(path, options);
    expect(await health.needsServerProbe(f.options)).toBe(true);
  });

  it("does not treat a short cancelled wait as five minutes when retried later", async () => {
    const f = fixture();
    Object.assign(f.run, { status: "completed", conclusion: "cancelled" });
    Object.assign(f.job, {
      status: "completed",
      conclusion: "cancelled",
      started_at: date(10),
      completed_at: new Date(now - 595_000).toISOString(),
    });
    expect((await health.serverRoute({ ...f.options, runId: 12, attempt: 2 })).route).toBe(
      "server",
    );
  });

  it("does not count an unassigned cancellation or a hosted retry as server traffic", async () => {
    const f = fixture(),
      request = f.request;
    f.run.status = "completed";
    f.job.status = "completed";
    f.job.conclusion = "cancelled";
    f.job.completed_at = date(1);
    f.options.request = async (path, options) =>
      path.includes("/runs?")
        ? {
            total_count: path.includes("status=completed") ? 1 : 0,
            workflow_runs: path.includes("status=completed") ? [f.run] : [],
          }
        : request(path, options);
    expect(await health.needsServerProbe(f.options)).toBe(true);
    f.job.labels = ["ubuntu-latest"];
    f.job.runner_id = 8;
    f.job.conclusion = "success";
    expect(await health.needsServerProbe(f.options)).toBe(true);
  });

  it("recognises completed server traffic while the workflow's hosted summary still runs", async () => {
    const f = fixture();
    f.job.status = "completed";
    f.job.runner_id = 7;
    f.job.completed_at = date(1);
    expect(await health.needsServerProbe(f.options)).toBe(false);
  });

  it("does not retry before cancellation settles", async () => {
    const f = fixture(),
      request = f.request;
    f.options.request = async (path, options) =>
      path.endsWith("/force-cancel") ? null : request(path, options);
    let waits = 0;
    f.options.wait = async () => {
      waits++;
    };
    await expect(health.recoverServer(f.options)).rejects.toThrow(/cancellation did not finish/);
    expect(waits).toBe(24);
    expect(f.calls.some(([path]) => path.endsWith("/rerun"))).toBe(false);
  });

  it("does not cancel a job assigned during the final queue read", async () => {
    const f = fixture(),
      request = f.request;
    let reads = 0;
    f.options.request = async (path, options) => {
      if (path.includes("/jobs?") && ++reads === 2) f.job.runner_id = 7;
      return request(path, options);
    };
    expect((await health.recoverServer(f.options)).retried).toEqual([]);
  });

  it.each([false, true])(
    "recovers only the oldest run per invocation when rerun refusal is %s",
    async (refused) => {
      const f = fixture(),
        g = fixture();
      g.run.id = 13;
      f.run.run_started_at = date(7);
      Object.assign(g.job, { id: 124, run_id: 13, labels: ["self-hosted", "dt-42-13-1-lint-1"] });
      const writes = [];
      const request = async (path, options = {}) => {
        const target = path.includes("/runs/13") ? g : f;
        if (path.includes("/runs?")) {
          const runs = [g.run, f.run].filter((run) => path.includes("status=" + run.status));
          return { total_count: runs.length, workflow_runs: runs.map((run) => ({ ...run })) };
        }
        if (options.method) {
          writes.push(path);
          if (path.endsWith("/force-cancel")) {
            target.run.status = "completed";
            target.run.conclusion = "cancelled";
          }
          if (refused && path.endsWith("/12/rerun")) throw new Error("rerun refused");
          return null;
        }
        if (path.includes("/jobs?")) return { total_count: 1, jobs: [{ ...target.job }] };
        return { ...target.run };
      };
      if (refused)
        await expect(health.recoverServer({ ...f.options, request })).rejects.toThrow(
          /rerun refused/,
        );
      else expect((await health.recoverServer({ ...f.options, request })).retried).toEqual([12]);
      expect(writes).not.toContain("/repos/fixture/waitron/actions/runs/13/force-cancel");
      expect((await health.recoverServer({ ...f.options, request })).retried).toEqual([13]);
      expect(writes).toContain("/repos/fixture/waitron/actions/runs/13/rerun");
    },
  );

  it("reads CI workflow inventories without listing unrelated workflows", async () => {
    const f = fixture();
    f.options.request = async (path, options) => {
      if (path.includes("/actions/runs?")) throw new Error("Unrelated workflow inventory");
      return f.request(path, options);
    };
    expect((await health.serverHealth(f.options)).stuck.map((run) => run.id)).toEqual([12]);
  });

  it("ignores unassigned cancellations in an active run when deciding whether to probe", async () => {
    const f = fixture();
    Object.assign(f.job, { status: "completed", conclusion: "cancelled", completed_at: date(1) });
    expect(await health.needsServerProbe(f.options)).toBe(true);
  });

  it("refuses a changed head while cancellation is settling", async () => {
    const f = fixture(),
      request = f.request;
    f.options.request = async (path, options) => {
      const result = await request(path, options);
      if (path.endsWith("/force-cancel")) f.run.head_sha = "b".repeat(40);
      return result;
    };
    await expect(health.recoverServer(f.options)).rejects.toThrow(/changed during cancellation/);
    expect(f.calls.some(([path]) => path.endsWith("/rerun"))).toBe(false);
  });

  it("moves a five-minute unassigned queue to a completed cancellation before requesting its retry", async () => {
    const f = fixture();
    const result = await health.recoverServer(f.options);
    expect(result.retried).toEqual([12]);
    expect(
      f.calls.filter(([, options]) => options.method === "POST").map(([path]) => path),
    ).toEqual([
      "/repos/fixture/waitron/actions/runs/12/force-cancel",
      "/repos/fixture/waitron/actions/runs/12/rerun",
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
    f.job.completed_at = date(0);
    expect(await health.serverRoute({ ...f.options, runId: 12, attempt: 2 })).toMatchObject({
      route: "hosted",
      reason: expect.stringContaining("previous"),
    });
  });

  it("leaves healthy retries on the server and reports no recovery or idle probe", async () => {
    const f = fixture(),
      reports = [];
    f.job.started_at = date(1);
    expect(await health.serverRoute({ ...f.options, runId: 12, attempt: 2 })).toMatchObject({
      route: "server",
    });
    for (const command of ["recover", "probe"])
      await health.healthCommand(command, f.options, { report: (line) => reports.push(line) });
    expect(reports).toEqual([
      "No stalled server run needed recovery.",
      "Server traffic was observed; no idle probe is needed.",
    ]);
    expect(f.calls.filter(([, options]) => options.method)).toEqual([]);
  });

  it("does not rerun work that completed successfully during cancellation", async () => {
    const f = fixture(),
      request = f.request;
    f.options.request = async (path, options) => {
      const answer = await request(path, options);
      if (path.endsWith("/force-cancel")) f.run.conclusion = "success";
      return answer;
    };
    expect((await health.recoverServer(f.options)).retried).toEqual([]);
    expect(f.calls.some(([path]) => path.endsWith("/rerun"))).toBe(false);
  });

  it("reads later pages before deciding that the server is idle", async () => {
    const f = fixture(),
      request = f.request;
    const foreign = Array.from({ length: 100 }, (_, i) => ({
      ...f.run,
      id: i + 100,
      head_repository: { id: 99 },
    }));
    f.options.request = async (path, options) =>
      path.includes("status=in_progress")
        ? { total_count: 101, workflow_runs: path.endsWith("&page=1") ? foreign : [f.run] }
        : request(path, options);
    expect((await health.serverHealth(f.options)).stuck.map((run) => run.id)).toEqual([12]);
  });

  it("reads a later run page after GitHub returns a short non-final page", async () => {
    const f = fixture(),
      request = f.request;
    f.options.request = async (path, options) =>
      path.includes("status=in_progress")
        ? {
            total_count: 2,
            workflow_runs: path.endsWith("&page=1")
              ? [{ ...f.run, id: 99, head_repository: { id: 99 } }]
              : [f.run],
          }
        : request(path, options);
    expect((await health.serverHealth(f.options)).stuck.map((run) => run.id)).toEqual([12]);
  });

  it("finds recent server traffic after a short completed-run page", async () => {
    const f = fixture(),
      request = f.request;
    Object.assign(f.run, { status: "completed" });
    Object.assign(f.job, { status: "completed", runner_id: 7, completed_at: date(1) });
    f.options.request = async (path, options) => {
      if (path.includes("status=completed"))
        return {
          total_count: 2,
          workflow_runs: path.endsWith("&page=1")
            ? [{ ...f.run, id: 99, head_repository: { id: 99 } }]
            : [f.run],
        };
      if (path.includes("/runs?")) return { total_count: 0, workflow_runs: [] };
      return request(path, options);
    };
    expect(await health.needsServerProbe(f.options)).toBe(false);
  });

  it("preserves a waiting run after another workflow finished server work recently", async () => {
    const f = fixture(),
      request = f.request;
    f.options.request = async (path, options) => {
      if (path.includes("status=completed"))
        return { total_count: 1, workflow_runs: [{ ...f.run, id: 13, status: "completed" }] };
      if (path.includes("/runs/13/attempts/"))
        return {
          total_count: 1,
          jobs: [
            {
              ...f.job,
              id: 124,
              run_id: 13,
              labels: ["self-hosted", "dt-42-13-1-lint-1"],
              status: "completed",
              runner_id: 7,
              completed_at: date(0.5),
            },
          ],
        };
      return request(path, options);
    };
    expect((await health.recoverServer(f.options)).retried).toEqual([]);
    expect(f.calls.some(([, options]) => options.method)).toBe(false);
  });

  it("reads the later assigned job through small pages before allowing recovery", async () => {
    const f = fixture(),
      request = f.request;
    const jobs = Array.from({ length: 31 }, (_, index) => ({
      ...f.job,
      id: 1000 + index,
      runner_id: index === 30 ? 7 : 0,
    }));
    f.options.request = async (path, options) => {
      if (path.includes("/jobs?")) {
        const params = new URL("https://fixture.test" + path).searchParams;
        const size = Number(params.get("per_page")),
          page = Number(params.get("page"));
        if (size > 30) throw new Error("HTTP 502 oversized job page");
        return { total_count: jobs.length, jobs: jobs.slice((page - 1) * size, page * size) };
      }
      return request(path, options);
    };
    expect((await health.recoverServer(f.options)).retried).toEqual([]);
    expect(f.calls.some(([, options]) => options.method)).toBe(false);
  });

  it("finds assigned server work on a short later jobs page", async () => {
    const f = fixture(),
      request = f.request;
    f.options.request = async (path, options) =>
      path.includes("/jobs?")
        ? {
            total_count: 2,
            jobs: path.endsWith("&page=1")
              ? [f.job]
              : [{ ...f.job, id: 124, runner_id: 7, status: "in_progress" }],
          }
        : request(path, options);
    expect((await health.recoverServer(f.options)).retried).toEqual([]);
    expect(f.calls.some(([, options]) => options.method)).toBe(false);
  });

  it("refuses an empty page before the advertised inventory is complete", async () => {
    const f = fixture(),
      request = f.request;
    f.options.request = async (path, options) =>
      path.includes("/jobs?")
        ? { total_count: 2, jobs: path.endsWith("&page=1") ? [f.job] : [] }
        : request(path, options);
    await expect(health.recoverServer(f.options)).rejects.toThrow(/Incomplete.*empty.*1.*2/);
    expect(f.calls.some(([, options]) => options.method)).toBe(false);
  });

  it("does not cancel a waiting run while another run has server work", async () => {
    const f = fixture(),
      request = f.request;
    f.options.request = async (path, options) => {
      if (path.includes("status=in_progress"))
        return { total_count: 2, workflow_runs: [f.run, { ...f.run, id: 13 }] };
      if (path.includes("/runs/13/attempts/"))
        return {
          total_count: 1,
          jobs: [
            {
              ...f.job,
              id: 124,
              run_id: 13,
              runner_id: 9,
              labels: ["self-hosted", "dt-42-13-1-lint-1"],
            },
          ],
        };
      return request(path, options);
    };
    expect((await health.recoverServer(f.options)).retried).toEqual([]);
    expect(f.calls.some(([, options]) => options.method)).toBe(false);
  });

  it("does not call a partial inventory a stalled server", async () => {
    const f = fixture(),
      request = f.request;
    f.options.request = async (path, options) =>
      path.includes("/jobs?") ? { total_count: 2, jobs: [f.job] } : request(path, options);
    await expect(health.recoverServer(f.options)).rejects.toThrow(/inventory/);
    expect(f.calls.filter(([, options]) => options.method === "POST")).toEqual([]);
  });
  it.each(["recover", "probe"])(
    "reports an incomplete inventory without writes or a failed %s command",
    async (command) => {
      const f = fixture(),
        request = f.request,
        reports = [];
      f.options.request = async (path, options) =>
        path.includes("/jobs?")
          ? { total_count: 2, jobs: path.endsWith("&page=1") ? [f.job] : [] }
          : request(path, options);
      await health.healthCommand(command, f.options, {
        report: (line) => reports.push(line),
        output: () => {},
      });
      expect(reports.join("\n")).toMatch(/inventory.*unavailable/i);
      expect(f.calls.some(([, options]) => options.method)).toBe(false);
    },
  );

  it("keeps an API permission refusal visible during recovery", async () => {
    const f = fixture();
    f.options.request = async () => {
      throw new Error("HTTP 403 forbidden");
    };
    await expect(
      health.healthCommand("recover", f.options, { report: () => {}, output: () => {} }),
    ).rejects.toThrow("HTTP 403");
  });

  it("does not count a recently cancelled unassigned job as server progress", async () => {
    const f = fixture(),
      request = f.request;
    f.options.request = async (path, options) =>
      path.includes("/jobs?")
        ? {
            total_count: 2,
            jobs: [
              f.job,
              {
                ...f.job,
                id: 124,
                status: "completed",
                runner_id: 0,
                conclusion: "cancelled",
                started_at: date(0.5),
                completed_at: date(0.5),
              },
            ],
          }
        : request(path, options);
    expect((await health.recoverServer(f.options)).retried).toEqual([12]);
  });

  it("stops completed CI history at 100 even when more than 1000 runs exist", async () => {
    const f = fixture(),
      reads = [];
    f.options.request = async (path) => {
      reads.push(path);
      if (path.includes("status=completed")) {
        expect(path).toContain("/actions/workflows/ci.yml/runs?");
        expect(path).toMatch(/page=[12]$/);
        const second = path.endsWith("&page=2");
        return {
          total_count: 1500,
          workflow_runs: Array.from({ length: second ? 100 : 50 }, (_, i) => ({
            ...f.run,
            id: i + (second ? 150 : 100),
            head_repository: { id: second && i === 50 ? 42 : 99 },
          })),
        };
      }
      expect(path).toContain("/runs?");
      return { total_count: 0, workflow_runs: [] };
    };
    expect(await health.needsServerProbe(f.options)).toBe(true);
    expect(reads.filter((path) => path.includes("status=completed"))).toHaveLength(2);
  });
  it("does not read completed history when the active queue needs no recovery", async () => {
    const f = fixture(),
      request = f.request;
    f.job.runner_id = 7;
    f.options.request = async (path, options) => {
      if (path.includes("status=completed")) throw new Error("Unnecessary history request");
      return request(path, options);
    };
    expect((await health.recoverServer(f.options)).retried).toEqual([]);
  });

  it.each(["duplicate", "changed-count"])(
    "reports a moving completed history as unavailable: %s",
    async (change) => {
      const f = fixture(),
        request = f.request,
        reports = [];
      f.options.request = async (path, options) => {
        if (path.includes("status=completed"))
          return {
            total_count: change === "changed-count" && path.endsWith("&page=2") ? 3 : 2,
            workflow_runs: [
              {
                ...f.run,
                id: change === "duplicate" || path.endsWith("&page=1") ? 98 : 99,
                head_repository: { id: 99 },
              },
            ],
          };
        return request(path, options);
      };
      await health.healthCommand("recover", f.options, {
        report: (line) => reports.push(line),
        output: () => {},
      });
      expect(reports.join("\n")).toMatch(/inventory.*unavailable/i);
      expect(f.calls.some(([, options]) => options.method)).toBe(false);
    },
  );
  it.each(["old", "boundary", "recent", "missing", "invalid"])(
    "bounds completed-history job reads for an %s update",
    async (state) => {
      const f = fixture(),
        request = f.request,
        reads = [];
      f.options.request = async (path, options) => {
        if (path.includes("status=completed"))
          return {
            total_count: 1,
            workflow_runs: [
              {
                ...f.run,
                id: 13,
                status: "completed",
                updated_at: {
                  old: date(5.001),
                  boundary: date(5),
                  recent: date(1),
                  missing: undefined,
                  invalid: "invalid",
                }[state],
              },
            ],
          };
        if (path.includes("/runs/13/attempts/")) {
          reads.push(path);
          return {
            total_count: 1,
            jobs: [
              {
                ...f.job,
                id: 124,
                run_id: 13,
                labels: ["self-hosted", "dt-42-13-1-lint-1"],
                status: "completed",
                runner_id: 7,
                completed_at: state === "old" ? date(6) : date(1),
              },
            ],
          };
        }
        return request(path, options);
      };
      expect((await health.recoverServer(f.options)).retried).toEqual(state === "old" ? [12] : []);
      expect(reads).toHaveLength(state === "old" ? 0 : 1);
    },
  );

  it("names the stuck run when force-cancel needs intervention", async () => {
    const f = fixture(),
      request = f.request;
    f.options.request = async (path, options) => {
      if (path.endsWith("/force-cancel")) throw new Error("HTTP 403 forbidden");
      return request(path, options);
    };
    await expect(health.recoverServer(f.options)).rejects.toThrow(
      /Stuck run 12.*force-cancel.*HTTP 403/,
    );
    expect(f.calls.some(([path]) => path.endsWith("/rerun"))).toBe(false);
  });
});
