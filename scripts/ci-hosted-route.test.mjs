import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { runInNewContext } from "node:vm";
import { URL } from "node:url";
import { describe, expect, it } from "vitest";
import { healthCommand, main, serverRoute } from "./ci-server-health.mjs";

const workflow = readFileSync(new URL("../.github/workflows/ci.yml", import.meta.url), "utf8");
function workflowEnvironment(capacity) {
  const step = workflow.match(/ {6}- id: server-route\n([\s\S]*?)(?=\n {6}(?:- |#))/)?.[1];
  const condition = step.match(/^ {8}if: (.+)$/m)?.[1] ?? "true";
  expect(runInNewContext(condition, { vars: { DISPOSABLE_TESTS_MODE: "hosted" } })).toBe(true);
  const expression = workflow.match(/^ {10}CAPACITY: \$\{\{ (.+) \}\}$/m)?.[1];
  expect(expression).toBe("vars.DISPOSABLE_TESTS_CAPACITY");
  return {
    CAPACITY: runInNewContext(expression, { vars: { DISPOSABLE_TESTS_CAPACITY: capacity } }),
  };
}

function fixture(running = 0, queued = 0) {
  const run = {
    id: 50,
    run_attempt: 2,
    head_sha: "b".repeat(40),
    repository: { id: 42 },
    head_repository: { id: 99 },
    event: "pull_request",
  };
  const jobs = Array.from({ length: running + queued }, (_, index) => ({
    id: index + 1,
    run_id: 50,
    run_attempt: 2,
    head_sha: run.head_sha,
    status: index < running ? "in_progress" : "queued",
    runner_id: index < running ? index + 1 : 0,
    labels: ["ubuntu-latest"],
  }));
  const calls = [];
  const options = {
    repository: "fixture/waitron",
    repositoryId: 42,
    runId: 51,
    attempt: 1,
    capacity: { observedAt: 1, slots: 6, serverRunning: 6, serverWaiting: 0 },
    request: async (path, requestOptions) => {
      calls.push([path, requestOptions]);
      if (path.includes("/workflows/ci.yml/runs?")) return { total_count: 0, workflow_runs: [] };
      if (path.includes("/actions/runs?"))
        return {
          total_count: path.includes("status=in_progress") ? 1 : 0,
          workflow_runs: path.includes("status=in_progress") ? [run] : [],
        };
      if (path.includes("/runs/50/attempts/2/jobs?")) {
        const params = new URL("https://fixture.test" + path).searchParams;
        const page = Number(params.get("page")),
          size = Number(params.get("per_page"));
        return { total_count: jobs.length, jobs: jobs.slice((page - 1) * size, page * size) };
      }
      throw new Error("Unexpected request " + path);
    },
  };
  return { options, jobs, run, calls };
}

describe("queue-pressure routing", () => {
  it.each([
    [0, 0, 6, 0, 0, "server"],
    [6, 0, 6, 19, 0, "hosted"],
    [1, 5, 6, 20, 0, "server"],
    [6, 12, 6, 0, 1, "hosted"],
    [0, 3, 6, 20, 43, "server"],
    [0, 0, 0, 20, 0, "hosted"],
  ])(
    "compares server %i + %i over %i with hosted %i + %i",
    async (serverRunning, serverWaiting, slots, running, waiting, route) => {
      const f = fixture(running, waiting);
      f.options.capacity = { observedAt: 1, slots, serverRunning, serverWaiting };
      expect((await serverRoute(f.options)).route).toBe(route);
      expect(f.calls.every(([, options]) => !options?.method)).toBe(true);
    },
  );

  it("includes its own running changes job when resolving a tie", async () => {
    const f = fixture(19),
      request = f.options.request;
    const own = { ...f.run, id: 51, head_repository: { id: 42 } };
    f.options.request = async (path, options) => {
      if (path.includes("/actions/runs?status=in_progress"))
        return { total_count: 2, workflow_runs: [f.run, own] };
      if (path.includes("/runs/51/attempts/2/jobs?"))
        return { total_count: 1, jobs: [{ ...f.jobs[0], id: 99, run_id: 51, name: "changes" }] };
      return request(path, options);
    };
    expect((await serverRoute(f.options)).route).toBe("server");
  });
  it.each([
    [0, 0, "hosted"],
    [19, 0, "hosted"],
    [20, 0, "server"],
    [21, 0, "server"],
    [0, 1, "hosted"],
    [19, 1, "server"],
  ])("routes %i running and %i queued hosted jobs to %s", async (running, queued, expected) => {
    const f = fixture(running, queued);
    const answer = await serverRoute(f.options);
    expect(answer.route).toBe(expected);
    expect(answer.reason).toContain(`${running} running`);
    expect(answer.reason).toContain(`${queued} queued`);
    expect(f.calls.every(([, options]) => !options?.method)).toBe(true);
  });

  it.each(["pending", "waiting", "requested"])("counts hosted %s work", async (status) => {
    const f = fixture(19, 1);
    f.jobs[19].status = status;
    expect((await serverRoute(f.options)).route).toBe("server");
  });
  it("names the chosen side in its summary", async () => {
    const f = fixture(20),
      reports = [];
    await healthCommand("route", f.options, {
      output: () => {},
      report: (line) => reports.push(line),
    });
    expect(reports.join("\n")).toContain("CI route: server");
  });
  it.each([
    "not JSON",
    "{}",
    "null",
    JSON.stringify({ observedAt: 1, slots: -1, serverRunning: 0, serverWaiting: 0 }),
    JSON.stringify({ slots: 6, serverRunning: 1, serverWaiting: 5 }),
    JSON.stringify({ observedAt: 1, slots: 6, serverRunning: 1, serverWaiting: 5 }),
  ])("reads the workflow capacity variable: %s", async (capacity) => {
    const f = fixture(20),
      directory = mkdtempSync(tmpdir() + "/route-capacity-");
    try {
      await main(
        "route",
        {
          GITHUB_REPOSITORY: "fixture/waitron",
          GITHUB_REPOSITORY_ID: "42",
          GITHUB_RUN_ID: "51",
          GITHUB_RUN_ATTEMPT: "1",
          GITHUB_OUTPUT: directory + "/output",
          GITHUB_STEP_SUMMARY: directory + "/summary",
          ...workflowEnvironment(capacity),
        },
        f.options.request,
      );
      expect(readFileSync(directory + "/output", "utf8")).toBe("server_route=server\n");
      expect(readFileSync(directory + "/summary", "utf8")).toContain(
        capacity.startsWith('{"observedAt":1,"slots":6') ? "snapshot age" : "could not be verified",
      );
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("counts all hosted jobs when GitHub refuses job pages over 30 records", async () => {
    const f = fixture(61),
      request = f.options.request;
    f.options.request = async (path, options) => {
      if (
        path.includes("/jobs?") &&
        Number(new URL("https://fixture.test" + path).searchParams.get("per_page")) > 30
      )
        throw new Error("HTTP 502 oversized job page");
      return request(path, options);
    };
    const answer = await serverRoute(f.options);
    expect(answer.route).toBe("server");
    expect(answer.reason).toContain("61 running, 0 queued");
    expect(f.calls.filter(([path]) => path.includes("/jobs?"))).toHaveLength(3);
  });

  it("skips the hosted capacity scan after health inventory becomes uncertain", async () => {
    const f = fixture(),
      request = f.options.request;
    f.options.request = async (path, options) => {
      if (path.includes("/workflows/ci.yml/runs?")) throw new Error("HTTP 502 health inventory");
      return request(path, options);
    };
    expect((await serverRoute(f.options)).route).toBe("server");
    expect(f.calls.filter(([path]) => path.includes("/actions/runs?"))).toHaveLength(0);
  });

  it("counts hosted work in a run visible only in the queued run list", async () => {
    const f = fixture(0, 1),
      request = f.options.request;
    f.options.request = async (path, options) =>
      path.includes("/actions/runs?")
        ? {
            total_count: path.includes("status=queued") ? 1 : 0,
            workflow_runs: path.includes("status=queued") ? [f.run] : [],
          }
        : request(path, options);
    expect((await serverRoute(f.options)).route).toBe("hosted");
  });

  it("counts a run only once when it moves between active run lists", async () => {
    const f = fixture(19),
      request = f.options.request;
    f.options.request = async (path, options) =>
      path.includes("/actions/runs?")
        ? { total_count: 1, workflow_runs: [f.run] }
        : request(path, options);
    const answer = await serverRoute(f.options);
    expect(answer.route).toBe("hosted");
    expect(answer.reason).toContain("19 running, 0 queued");
  });

  it("uses the server when hosted capacity names a different repository", async () => {
    const f = fixture(20),
      outputs = [],
      reports = [];
    f.run.repository.id = 99;
    await healthCommand("route", f.options, {
      output: (line) => outputs.push(line),
      report: (line) => reports.push(line),
    });
    expect(outputs).toEqual(["server_route=server"]);
    expect(reports[0]).toContain("Foreign hosted run inventory");
  });

  it("ignores self-hosted, completed and jobs without assigned runner labels", async () => {
    const f = fixture(19);
    for (const job of [
      { status: "queued", labels: ["self-hosted", "custom"] },
      { status: "in_progress", labels: ["self-hosted", "custom"] },
      { status: "completed", labels: ["ubuntu-latest"] },
      { status: "queued", labels: [] },
    ])
      f.jobs.push({ ...f.jobs[0], id: f.jobs.length + 1, ...job });
    expect((await serverRoute(f.options)).route).toBe("hosted");
  });

  it("reads later job pages before deciding that GitHub has room", async () => {
    const f = fixture();
    f.jobs.push(
      ...Array.from({ length: 100 }, (_, index) => ({
        id: index + 1,
        run_id: 50,
        run_attempt: 2,
        head_sha: f.run.head_sha,
        status: "completed",
        runner_id: 1,
        labels: ["ubuntu-latest"],
      })),
      ...Array.from({ length: 20 }, (_, index) => ({
        ...f.jobs[0],
        id: 101 + index,
        run_id: 50,
        run_attempt: 2,
        head_sha: f.run.head_sha,
        status: "queued",
        runner_id: 0,
        labels: ["ubuntu-latest"],
      })),
    );
    expect((await serverRoute(f.options)).route).toBe("server");
  });

  it.each(["HTTP 502", "empty page"])(
    "isolates one run's %s and still checks readable server work",
    async (fault) => {
      const f = fixture(),
        request = f.options.request;
      f.run.head_repository.id = 42;
      const readable = { ...f.run, id: 60, run_attempt: 1 };
      let stalled = false;
      f.options.request = async (path, options) => {
        if (path.includes("/workflows/ci.yml/runs?"))
          return {
            total_count: path.includes("status=in_progress") ? 2 : 0,
            workflow_runs: path.includes("status=in_progress") ? [f.run, readable] : [],
          };
        if (path.includes("/runs/50/attempts/2/jobs?")) {
          if (fault === "HTTP 502") throw new Error(fault);
          return { total_count: 1, jobs: [] };
        }
        if (path.includes("/runs/60/attempts/1/jobs?")) {
          f.calls.push([path, options]);
          return {
            total_count: stalled ? 1 : 0,
            jobs: stalled
              ? [
                  {
                    id: 600,
                    run_id: 60,
                    run_attempt: 1,
                    head_sha: readable.head_sha,
                    status: "queued",
                    runner_id: 0,
                    labels: ["self-hosted", "dt-42-60-1-lint-1"],
                    started_at: "2026-01-01T00:00:00Z",
                  },
                ]
              : [],
          };
        }
        return request(path, options);
      };
      const answer = await serverRoute(f.options);
      expect(answer.route).toBe("server");
      expect(answer.reason).toMatch(/could not be verified|unavailable/i);
      expect(f.calls.some(([path]) => path.includes("/runs/60/attempts/1/jobs?"))).toBe(true);
      stalled = true;
      const knownStall = await serverRoute(f.options);
      expect(knownStall.route).toBe("hosted");
      expect(knownStall.reason).toContain("could not be verified");
      expect(f.calls.every(([, options]) => !options?.method)).toBe(true);
    },
  );

  it.each(["own run", "previous attempt"])(
    "still checks readable stalls after a retry's %s read fails",
    async (fault) => {
      const f = fixture(),
        request = f.options.request;
      f.run.head_repository.id = 42;
      let stalled = false;
      f.options.runId = 50;
      f.options.attempt = 3;
      f.options.request = async (path, options) => {
        if (path.endsWith("/runs/50")) {
          if (fault === "own run") throw new Error("HTTP 502 own run");
          return f.run;
        }
        if (path.includes("/runs/50/attempts/2/jobs?"))
          throw new Error("HTTP 502 previous attempt");
        if (path.includes("/workflows/ci.yml/runs?"))
          return {
            total_count: path.includes("status=in_progress") ? 1 : 0,
            workflow_runs: path.includes("status=in_progress")
              ? [{ ...f.run, id: 60, run_attempt: 1 }]
              : [],
          };
        if (path.includes("/runs/60/attempts/1/jobs?"))
          return {
            total_count: stalled ? 1 : 0,
            jobs: stalled
              ? [
                  {
                    id: 600,
                    run_id: 60,
                    run_attempt: 1,
                    head_sha: f.run.head_sha,
                    status: "queued",
                    runner_id: 0,
                    labels: ["self-hosted", "dt-42-60-1-lint-1"],
                    started_at: "2026-01-01T00:00:00Z",
                  },
                ]
              : [],
          };
        return request(path, options);
      };
      for (const expected of ["server", "hosted"]) {
        const outputs = [],
          reports = [];
        await healthCommand("route", f.options, {
          output: (line) => outputs.push(line),
          report: (line) => reports.push(line),
        });
        expect(outputs).toEqual([`server_route=${expected}`]);
        expect(reports[0]).toContain("could not be verified");
        stalled = true;
      }
    },
  );

  it("uses the server when the active run list shrinks between pages", async () => {
    const f = fixture(),
      request = f.options.request;
    f.options.request = async (path, options) =>
      path.includes("/workflows/ci.yml/runs?") && path.includes("status=queued")
        ? { total_count: 1, workflow_runs: [] }
        : request(path, options);
    expect((await serverRoute(f.options)).route).toBe("server");
  });

  it.each(["unavailable", "duplicate", "foreign"])(
    "uses the server on %s unreadable capacity inventory",
    async (fault) => {
      const f = fixture(20),
        request = f.options.request,
        outputs = [],
        reports = [];
      f.options.request = async (path, options) => {
        if (path.includes("/runs/50/attempts/2/jobs?")) {
          if (fault === "unavailable") throw new Error("HTTP 503");
          if (fault === "duplicate") return { total_count: 2, jobs: [f.jobs[0], f.jobs[0]] };
          return { total_count: 1, jobs: [{ ...f.jobs[0], run_attempt: 1 }] };
        }
        return request(path, options);
      };
      await healthCommand("route", f.options, {
        output: (line) => outputs.push(line),
        report: (line) => reports.push(line),
      });
      expect(outputs).toEqual(["server_route=server"]);
      expect(reports[0]).toContain("could not be verified");
    },
  );
});
