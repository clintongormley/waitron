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
    head = "",
    capacity = '{"slots":12,"serverRunning":0,"serverWaiting":0}',
    headRepoName,
  } = {},
) {
  const context = {
    inputs: { server_probe: probe, server_route: health },
    vars: new Proxy(
      {
        DISPOSABLE_TESTS_MODE: mode,
        DISPOSABLE_TESTS_HEAD: head,
        DISPOSABLE_TESTS_CAPACITY: capacity,
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
            repo: {
              id: fork ? 99 : 42,
              full_name: headRepoName ?? (fork ? "foreign/repo" : "fixture/waitron"),
            },
          },
        },
      },
    },
    matrix: { shard: 1 },
    needs: { changes: { outputs: { server_route: health } } },
    fromJSON: (text) => {
      const value = JSON.parse(text);
      if (!value || typeof value !== "object" || Array.isArray(value)) return value;
      // GitHub's missing JSON properties compare numerically as zero and serialize as null.
      const missing = { valueOf: () => 0, toJSON: () => null };
      return new Proxy(value, { get: (object, key) => (key in object ? object[key] : missing) });
    },
    toJSON: JSON.stringify,
    format: (template, ...values) =>
      template.replace(/\{(\d+)\}/g, (_, index) => values[Number(index)]),
  };
  return expression.startsWith("${{")
    ? JSON.parse(JSON.stringify(runInNewContext(expression.slice(3, -2), context)))
    : expression;
}
describe("server-first workflow routing", () => {
  it("uses GitHub's missing JSON numeric comparison and serialization", () => {
    expect(route("${{ fromJSON('{}').missing == 0 }}")).toBe(true);
    expect(route("${{ toJSON(fromJSON('{}').missing) }}")).toBe("null");
  });
  it.each([
    [{ mode: "hosted" }, "hosted"],
    [{ headRepoName: "foreign/waitron" }, "hosted"],
    [{ hosted: '{"1234":1}' }, "hosted"],
    [{ head: "b".repeat(40) }, "hosted"],
    [{ head: "a".repeat(40) }, "server"],
    [{ capacity: "" }, "hosted"],
    [{ capacity: '{"slots":12}' }, "hosted"],
    [{ capacity: '{"slots":12,"serverRunning":3}' }, "hosted"],
    [{ capacity: '{"slots":12,"serverRunning":null,"serverWaiting":0}' }, "hosted"],
    [{ capacity: '{"slots":12,"serverRunning":0,"serverWaiting":false}' }, "hosted"],
    [{ capacity: '{"slots":12,"serverRunning":-1,"serverWaiting":0}' }, "hosted"],
    [{ capacity: '{"slots":0,"serverRunning":0,"serverWaiting":0}' }, "hosted"],
    [{ capacity: '{"slots":12,"serverRunning":3,"serverWaiting":1}' }, "hosted"],
    [{ capacity: '{"slots":12,"serverRunning":12,"serverWaiting":0}' }, "hosted"],
    [{ capacity: '{"slots":12,"serverRunning":11,"serverWaiting":0}' }, "server"],
  ])("places PR planning by existing gates and unused capacity: %j", (options, expected) => {
    const selected = route(jobs.find((job) => job.id === "changes").route, {
      event: "pull_request",
      ...options,
    });
    expect(selected).toEqual(
      expected === "server" ? ["self-hosted", "dt-42-1234-1-changes-1"] : "ubuntu-latest",
    );
  });
  it("places a planner without its own output or workflow arithmetic", () => {
    const expression = jobs.find((job) => job.id === "changes").route;
    expect(expression).toContain(".serverWaiting) == '0'");
    expect(expression).toContain("serverRunning <");
    expect(expression).not.toContain("needs.");
    expect(expression).not.toContain("+");
  });
  it("sets up gh only in a server planning job", () => {
    const body = jobs.find((job) => job.id === "changes").body;
    const setup = body.match(/ {6}- name: Set up gh on the server\n([\s\S]*?)(?=\n {6}- )/)[1];
    const condition = setup.match(/^ {8}if: (.+)$/m)[1];
    for (const environment of ["self-hosted", "github-hosted"])
      expect(runInNewContext(condition, { runner: { environment } })).toBe(
        environment === "self-hosted",
      );
    for (const job of jobs.filter((job) => job.id !== "changes"))
      expect(job.body ?? "").not.toContain("Set up gh on the server");
  });
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
  it("runs independent planner recovery only from trusted main", () => {
    const workflow = readFileSync(
      new URL("../.github/workflows/server-health.yml", import.meta.url),
      "utf8",
    );
    expect(workflow).toContain("node scripts/ci-server-health.mjs check");
    expect(workflow).toContain("node scripts/ci-server-health.mjs recover-planners");
    expect(workflow).toContain("HOSTED_ATTEMPTS: ${{ vars.DISPOSABLE_TESTS_HOSTED_ATTEMPTS }}");
    expect(workflow).toContain("pull-requests: read");
    expect(workflow.indexOf("mjs recover-planners")).toBeLessThan(workflow.indexOf("mjs check"));
    expect(workflow).not.toContain("needs:");
    expect(workflow).not.toMatch(/mjs recover\s*$/m);
    expect(workflow).toContain("if: ${{ !cancelled() }}");
    expect(workflow).toContain("if: ${{ !cancelled() && github.event_name");
    expect(workflow).toContain("CAPACITY: ${{ vars.DISPOSABLE_TESTS_CAPACITY }}");
    expect(workflow).toContain("node scripts/ci-server-health.mjs probe");
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
    expect(step).toMatch(/^ {8}timeout-minutes: 2$/m);
    for (const job of jobs) expect(route(job.route, { health: "" }), job.id).toBe("ubuntu-latest");
  });
  it.each(["pull_request", "push", "schedule", "workflow_dispatch"])(
    "sends every direct %s job to a server on first and later attempts",
    (event) => {
      expect(jobs.length).toBeGreaterThan(30);
      for (const attempt of [1, 2, 7])
        for (const job of jobs) {
          const selected = route(job.route, { event, attempt });
          if (job.id === "changes") {
            expect(selected).toEqual(
              event === "pull_request" && attempt === 1
                ? ["self-hosted", "dt-42-1234-1-changes-1"]
                : "ubuntu-latest",
            );
            continue;
          }
          if (
            ["server-queue-watchdog", "publish", "release", "ci", "image-smoke"].includes(job.id)
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
        !["changes", "server-queue-watchdog", "publish", "release", "ci", "image-smoke"].includes(
          job.id,
        ),
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

it.each([false, true, "transient", "setup-refused"])(
  "keeps the workflow router beside an old checkout (fetch refused: %s)",
  (refused) => {
    const root = mkdtempSync(join(tmpdir(), "workflow-router-"));
    try {
      mkdirSync(join(root, "scripts"));
      writeFileSync(
        join(root, "scripts/ci-server-health.mjs"),
        'console.log("old candidate router");',
      );
      const fresh = join(root, "workflow.mjs");
      writeFileSync(
        fresh,
        'console.log("workflow router", process.argv[2], process.env.CAPACITY);',
      );
      writeFileSync(
        join(root, "gh"),
        `#!/bin/sh
[ "$1" = api ] && [ "$2" = 'repos/fixture/waitron/contents/scripts/ci-server-health.mjs?ref=bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb' ] || exit 41
[ "$3" = -H ] && [ "$4" = 'Accept: application/vnd.github.raw+json' ] || exit 42
[ "$GH_TOKEN" = fixture ] || exit 43
echo request >> "$FETCH_CALLS"
if [ "$FETCH_REFUSED" = true ] || { [ "$FETCH_REFUSED" = transient ] && [ "$(wc -l < "$FETCH_CALLS")" -eq 1 ]; }; then echo "HTTP 502" >&2; exit 22; fi
cat "$FIXTURE_ROUTER"
`,
        { mode: 0o755 },
      );
      const step = yaml.match(/ {6}- id: server-route\n([\s\S]*?)(?=\n {6}(?:- |#))/)[1];
      const token = step.match(/^ {10}GH_TOKEN: \$\{\{ (.+) \}\}$/m)?.[1];
      expect(token).toBeDefined();
      const body =
        step.match(/^ {8}run: \|\n([\s\S]*)$/m)?.[1].replace(/^ {10}/gm, "") ??
        step.match(/^ {8}run: (.+)$/m)[1];
      let script = body;
      if (refused === "setup-refused") {
        const setup = yaml.match(/ {6}- name: Set up gh on the server\n([\s\S]*?)(?=\n {6}- )/)[1];
        const setupBody = setup.match(/^ {8}run: \|\n([\s\S]*)$/m)[1].replace(/^ {10}/gm, "");
        for (const [name, contents] of Object.entries({
          timeout: '#!/bin/sh\nshift\nexec "$@"\n',
          sudo: '#!/bin/sh\necho refused >> "$SETUP_CALLS"\nexit 100\n',
          sleep: "#!/bin/sh\nexit 0\n",
        }))
          writeFileSync(join(root, name), contents, { mode: 0o755 });
        // Keep gh unavailable through setup and the routing fetch, without touching installed tools.
        writeFileSync(join(root, "gh"), "#!/bin/sh\nexit 127\n", { mode: 0o755 });
        const continueOnError = /^ {8}continue-on-error: true$/m.test(setup);
        script =
          `command() { if [ "$1" = -v ] && [ "$2" = gh ]; then return 1; else builtin command "$@"; fi; }\n` +
          `set +e\n( set -e\n${setupBody}\n)\nsetup_status=$?\nset -e\n` +
          (continueOnError ? "" : 'if [ "$setup_status" -ne 0 ]; then exit "$setup_status"; fi\n') +
          body;
      }
      const result = spawnSync("bash", ["-e", "-c", script], {
        cwd: root,
        encoding: "utf8",
        timeout: 5000,
        env: {
          ...process.env,
          PATH: root + ":" + process.env.PATH,
          RUNNER_TEMP: root,
          GITHUB_OUTPUT: join(root, "outputs"),
          GITHUB_STEP_SUMMARY: join(root, "summary"),
          GH_TOKEN: runInNewContext(token, { github: { token: "fixture" } }),
          FETCH_REFUSED: String(refused),
          FETCH_CALLS: join(root, "fetch-calls"),
          SETUP_CALLS: join(root, "setup-calls"),
          GITHUB_RUN_ID: "1234",
          GITHUB_RUN_ATTEMPT: "1",
          GITHUB_REPOSITORY: "fixture/waitron",
          GITHUB_WORKFLOW_SHA: "b".repeat(40),
          FIXTURE_ROUTER: fresh,
          CAPACITY: '{"slots":6}',
        },
      });
      expect(result.status, result.stderr).toBe(0);
      expect(result.stdout.trim()).toBe(
        refused === true || refused === "setup-refused"
          ? "CI_ROUTE_BLIND run=1234 attempt=1"
          : 'workflow router route {"slots":6}',
      );
      if (refused === "setup-refused") {
        expect(readFileSync(join(root, "setup-calls"), "utf8").trim().split("\n")).toHaveLength(3);
      } else {
        expect(readFileSync(join(root, "fetch-calls"), "utf8").trim().split("\n")).toHaveLength(
          refused === false ? 1 : 2,
        );
      }
      if (refused === true || refused === "setup-refused") {
        expect(readFileSync(join(root, "outputs"), "utf8")).toBe("server_route=hosted\n");
        expect(readFileSync(join(root, "summary"), "utf8")).toContain(
          "CI routing script could not be read; using GitHub.",
        );
      }
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  },
  10_000,
);
