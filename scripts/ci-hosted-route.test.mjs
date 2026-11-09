import { describe, expect, it } from "vitest";
import { healthCommand, serverRoute } from "./ci-server-health.mjs";

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
    request: async (path, requestOptions) => {
      calls.push([path, requestOptions]);
      if (path.includes("/workflows/ci.yml/runs?")) return { total_count: 0, workflow_runs: [] };
      if (path.includes("/actions/runs?"))
        return {
          total_count: path.includes("status=in_progress") ? 1 : 0,
          workflow_runs: path.includes("status=in_progress") ? [run] : [],
        };
      if (path.includes("/runs/50/attempts/2/jobs?")) {
        const page = Number(new URL("https://fixture.test" + path).searchParams.get("page"));
        return { total_count: jobs.length, jobs: jobs.slice((page - 1) * 100, page * 100) };
      }
      throw new Error("Unexpected request " + path);
    },
  };
  return { options, jobs, run, calls };
}

describe("GitHub-first routing", () => {
  it.each([
    [0, 0, "hosted"],
    [19, 0, "hosted"],
    [20, 0, "server"],
    [21, 0, "server"],
    [0, 1, "server"],
    [19, 1, "server"],
  ])("routes %i running and %i queued hosted jobs to %s", async (running, queued, expected) => {
    const f = fixture(running, queued);
    const answer = await serverRoute(f.options);
    expect(answer.route).toBe(expected);
    expect(answer.reason).toContain(`${running} running`);
    expect(answer.reason).toContain(`${queued} queued`);
    expect(f.calls.every(([, options]) => !options?.method)).toBe(true);
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
    expect((await serverRoute(f.options)).route).toBe("server");
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

  it("defaults to hosted when the run inventory names a different repository", async () => {
    const f = fixture(20),
      outputs = [],
      reports = [];
    f.run.repository.id = 99;
    await healthCommand("route", f.options, {
      output: (line) => outputs.push(line),
      report: (line) => reports.push(line),
    });
    expect(outputs).toEqual(["server_route=hosted"]);
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
      {
        id: 101,
        run_id: 50,
        run_attempt: 2,
        head_sha: f.run.head_sha,
        status: "queued",
        runner_id: 0,
        labels: ["ubuntu-latest"],
      },
    );
    expect((await serverRoute(f.options)).route).toBe("server");
  });

  it.each(["unavailable", "duplicate", "foreign"])(
    "defaults to hosted on %s capacity inventory",
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
      expect(outputs).toEqual(["server_route=hosted"]);
      expect(reports[0]).toContain("could not be verified");
    },
  );
});
