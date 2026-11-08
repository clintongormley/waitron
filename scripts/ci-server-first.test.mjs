import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { describe, it, expect } from "vitest";

const yaml = readFileSync(new URL("../.github/workflows/ci.yml", import.meta.url), "utf8");
const jobs = [...yaml.matchAll(/^  ([\w-]+):\n([\s\S]*?)(?=^  [\w-]+:|$(?![\s\S]))/gm)]
  .map(([, id, body]) => ({ id, body, route: body.match(/^    runs-on: (.+)$/m)?.[1] }))
  .filter((job) => job.route);
jobs.push({
  id: "image-smoke",
  route: readFileSync(
    new URL("../.github/workflows/image-smoke.yml", import.meta.url),
    "utf8",
  ).match(/^    runs-on: (.+)$/m)[1],
});
function route(
  expression,
  { event = "push", attempt = 1, mode = "server", hosted = "{}", fork = false } = {},
) {
  const context = {
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
  it.each(["pull_request", "push", "schedule", "workflow_dispatch"])(
    "sends every direct %s job to a server on first and later attempts",
    (event) => {
      expect(jobs.length).toBeGreaterThan(30);
      for (const attempt of [1, 2, 7])
        for (const job of jobs) {
          const selected = route(job.route, { event, attempt });
          if (["changes", "server-queue-watchdog"].includes(job.id)) {
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
      (job) => !["changes", "server-queue-watchdog"].includes(job.id),
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
