import { readFileSync, mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { runInNewContext } from "node:vm";
import { URL } from "node:url";
import { describe, it, expect } from "vitest";

const yaml = readFileSync(new URL("../.github/workflows/ci.yml", import.meta.url), "utf8");
const jobs = [...yaml.matchAll(/^ {2}([\w-]+):\n([\s\S]*?)(?=^ {2}[\w-]+:|$(?![\s\S]))/gm)]
  .map(([, id, body]) => ({ id, body, route: body.match(/^ {4}runs-on: (.+)$/m)?.[1] }))
  .filter((job) => job.route && job.id !== "server-probe");
jobs.push({
  id: "image-smoke",
  route: readFileSync(
    new URL("../.github/workflows/image-smoke.yml", import.meta.url),
    "utf8",
  ).match(/^ {4}runs-on: (.+)$/m)[1],
});
function route(
  expression,
  {
    event = "push",
    attempt = 1,
    mode = "server",
    hosted = "{}",
    fork = false,
    health = "server",
    probe = false,
  } = {},
) {
  const context = {
    inputs: { server_probe: probe, server_route: health },
    vars: new Proxy(
      {
        DISPOSABLE_TESTS_MODE: mode,
        DISPOSABLE_TESTS_HEAD: "",
        DISPOSABLE_TESTS_LABEL_PREFIX: "dt",
        DISPOSABLE_TESTS_HOSTED_ATTEMPTS: hosted,
      },
      { get: (value, key) => (key in value ? value[key] : key.endsWith("_JOBS") ? "100" : "") },
    ),
    github: {
      workflow: "CI",
      event_name: event,
      run_attempt: attempt,
      repository_id: 42,
      repository: "fixture/waitron",
      run_id: 1234,
      sha: "a".repeat(40),
      event: {
        pull_request: {
          head: {
            sha: "a".repeat(40),
            repo: { id: fork ? 99 : 42, full_name: fork ? "foreign/repo" : "fixture/waitron" },
          },
        },
      },
    },
    matrix: { shard: 1 },
    needs: { changes: { outputs: { server_route: health } } },
    fromJSON: JSON.parse,
    toJSON: JSON.stringify,
    format: (template, ...values) =>
      template.replace(/\{(\d+)\}/g, (_, index) => values[Number(index)]),
  };
  return expression.startsWith("${{")
    ? JSON.parse(JSON.stringify(runInNewContext(expression.slice(3, -2), context)))
    : expression;
}
describe("server-first workflow routing", () => {
  it("keeps image smoke on GitHub until disposable guests are qualified", () => {
    expect(jobs.find((job) => job.id === "image-smoke").route).toBe("ubuntu-latest");
  });
  it("runs only an explicitly dispatched probe and gives its retry a hosted route", () => {
    const body = yaml.match(/^ {2}server-probe:\n([\s\S]*?)(?=^ {2}[\w-]+:)/m)[1];
    const condition = body.match(/^ {4}if: (.+)$/m)[1];
    const selected = body.match(/^ {4}runs-on: (.+)$/m)[1];
    expect(route(condition, { event: "workflow_dispatch", probe: true })).toBe(true);
    expect(route(condition, { event: "pull_request", probe: true })).toBe(false);
    expect(route(condition, { event: "workflow_dispatch", probe: false })).toBe(false);
    expect(route(selected, { attempt: 1 })).toEqual(["self-hosted", "dt-42-1234-1-server-probe-1"]);
    expect(route(selected, { attempt: 2 })).toBe("ubuntu-latest");
  });
  it("runs the recovery workflow only from trusted main", () => {
    const workflow = readFileSync(
      new URL("../.github/workflows/server-health.yml", import.meta.url),
      "utf8",
    );
    const expression = workflow.match(/^ {4}if: \$\{\{ (.+) \}\}$/m)[1];
    for (const event_name of ["schedule", "workflow_dispatch", "pull_request"]) {
      for (const ref of ["refs/heads/main", "refs/heads/feature"]) {
        expect(runInNewContext(expression, { github: { event_name, ref } })).toBe(
          ref === "refs/heads/main" && event_name !== "pull_request",
        );
      }
    }
  });
  it("keeps new work on GitHub while the routing job observes a stalled server", () => {
    for (const job of jobs.filter(
      (job) => !["changes", "server-queue-watchdog", "ci", "publish"].includes(job.id),
    )) {
      expect(route(job.route, { health: "hosted" }), job.id).toBe("ubuntu-latest");
    }
  });
  it("retains the declared image routing input without using it for placement", () => {
    const image = yaml.match(/^ {2}image:\n([\s\S]*?)(?=^ {2}[\w-]+:)/m)[1];
    const input = image.match(/^ {6}server_route: (.+)$/m)?.[1];
    expect(input).toBeDefined();
    for (const health of ["server", "hosted", ""]) expect(route(input, { health })).toBe(health);
  });
  it("keeps a timed-out route read from failing changes and defaults every job to hosted", () => {
    const step = yaml.match(/ {6}- id: server-route\n([\s\S]*?)(?=\n {6}- )/)[1];
    expect(step).toMatch(/^ {8}continue-on-error: true$/m);
    for (const job of jobs) expect(route(job.route, { health: "" }), job.id).toBe("ubuntu-latest");
  });
  it.each(["pull_request", "push", "schedule", "workflow_dispatch"])(
    "sends every direct %s job to a server on first and later attempts",
    (event) => {
      expect(jobs.length).toBeGreaterThan(30);
      for (const attempt of [1, 2, 7])
        for (const job of jobs) {
          const selected = route(job.route, { event, attempt });
          if (
            ["changes", "server-queue-watchdog", "publish", "ci", "image-smoke"].includes(job.id)
          ) {
            expect(selected).toBe("ubuntu-latest");
            continue;
          }
          expect(selected, `${job.id}, attempt ${attempt}`).toEqual([
            "self-hosted",
            `dt-42-1234-${attempt}-${job.id}-1`,
          ]);
        }
    },
  );
  it("keeps an explicitly selected overflow attempt hosted while ordinary reruns remain server-first", () => {
    for (const job of jobs.filter(
      (job) =>
        !["changes", "server-queue-watchdog", "publish", "ci", "image-smoke"].includes(job.id),
    )) {
      expect(route(job.route, { attempt: 2, hosted: '{"1234":2}' }), job.id).toBe("ubuntu-latest");
      expect(route(job.route, { attempt: 3, hosted: '{"1234":2}' }), job.id).toEqual([
        "self-hosted",
        `dt-42-1234-3-${job.id}-1`,
      ]);
    }
  });
  it("keeps the same-repository boundary and the explicit hosted maintenance mode", () => {
    for (const job of jobs) {
      expect(route(job.route, { event: "pull_request", fork: true }), job.id).toBe("ubuntu-latest");
      expect(route(job.route, { mode: "hosted" }), job.id).toBe("ubuntu-latest");
    }
  });
});

it("runs the workflow's router beside an older candidate checkout", () => {
  const root = mkdtempSync(join(tmpdir(), "workflow-router-"));
  try {
    mkdirSync(join(root, "scripts"));
    writeFileSync(
      join(root, "scripts/ci-server-health.mjs"),
      'console.log("old candidate router");',
    );
    const fresh = join(root, "workflow.mjs");
    writeFileSync(fresh, 'console.log("workflow router", process.argv[2], process.env.CAPACITY);');
    writeFileSync(
      join(root, "gh"),
      `#!/bin/sh
[ "$1" = api ] && [ "$2" = 'repos/fixture/waitron/contents/scripts/ci-server-health.mjs?ref=bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb' ] || exit 41
[ "$3" = -H ] && [ "$4" = 'Accept: application/vnd.github.raw+json' ] || exit 42
cat "$FIXTURE_ROUTER"
`,
      { mode: 0o755 },
    );
    const step = yaml.match(/ {6}- id: server-route\n([\s\S]*?)(?=\n {6}(?:- |#))/)[1];
    const body =
      step.match(/^ {8}run: \|\n([\s\S]*)$/m)?.[1].replace(/^ {10}/gm, "") ??
      step.match(/^ {8}run: (.+)$/m)[1];
    const result = spawnSync("bash", ["-e", "-c", body], {
      cwd: root,
      encoding: "utf8",
      timeout: 5000,
      env: {
        ...process.env,
        PATH: root + ":" + process.env.PATH,
        RUNNER_TEMP: root,
        GITHUB_REPOSITORY: "fixture/waitron",
        GITHUB_WORKFLOW_SHA: "b".repeat(40),
        FIXTURE_ROUTER: fresh,
        CAPACITY: '{"slots":6}',
      },
    });
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout.trim()).toBe('workflow router route {"slots":6}');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
