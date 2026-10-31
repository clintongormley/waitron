import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { URL } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

const modulePath = new URL("./ci-reuse.mjs", import.meta.url);
const repository = "clintongormley/waitron";
const sha = "a".repeat(40);
const head = "b".repeat(40);
const tree = "c".repeat(40);
const workflow =
  "on:\n  push:\n  pull_request:\npermissions:\n  contents: read\njobs:\n  changes:\n  lint:\n  root-guards:\n  test-server:\n  ci:\n  publish:\n";
const context = { event: "push", ref: "refs/heads/main", sha, repository, runId: "43" };

function fixture() {
  const pr = {
    state: "closed",
    merged_at: "2026-10-31T03:00:00Z",
    merge_commit_sha: sha,
    base: { ref: "main", repo: { full_name: repository } },
    head: { sha: head, ref: "feature", repo: { full_name: repository } },
  };
  const run = {
    id: 42,
    workflow_id: 10,
    path: ".github/workflows/ci.yml",
    event: "pull_request",
    head_sha: head,
    head_branch: "feature",
    head_repository: { full_name: repository },
    repository: { full_name: repository },
    status: "completed",
    conclusion: "success",
    run_attempt: 1,
    head_commit: { tree_id: tree },
  };
  const current = { ...run, id: 43, event: "push", head_sha: sha };
  const jobs = ["changes", "lint", "root-guards", "test-server (1)", "ci", "publish"].map(
    (name) => ({
      id: 100 + name.length,
      name,
      run_id: 42,
      run_attempt: 1,
      head_sha: head,
      status: "completed",
      conclusion: name === "publish" ? "skipped" : "success",
    }),
  );
  const data = {
    prs: [pr],
    run,
    current,
    runs: { total_count: 1, workflow_runs: [run] },
    jobs: { total_count: jobs.length, jobs },
    commits: { [sha]: { sha, tree: { sha: tree } }, [head]: { sha: head, tree: { sha: tree } } },
  };
  const api = (path) => {
    if (path === `repos/${repository}/actions/runs/43`) return data.current;
    if (path === `repos/${repository}/actions/runs/42`) return data.run;
    if (path === `repos/${repository}/commits/${sha}/pulls?per_page=100`) return data.prs;
    if (
      path ===
      `repos/${repository}/actions/workflows/10/runs?head_sha=${head}&event=pull_request&per_page=100`
    )
      return data.runs;
    if (path === `repos/${repository}/actions/runs/42/attempts/1/jobs?per_page=100`)
      return data.jobs;
    if (path.startsWith(`repos/${repository}/git/commits/`))
      return data.commits[path.split("/").at(-1)];
    throw new Error(`Unexpected API request: ${path}`);
  };
  return { data, api };
}

async function verifier() {
  const source = await import(modulePath.href).catch(() => ({}));
  expect(source.findReuse, "the CI reuse verifier must exist").toBeTypeOf("function");
  return source.findReuse;
}

describe("main CI reuse", () => {
  it("accepts a merged same-repository PR with equal API trees and a complete successful CI attempt", async () => {
    const findReuse = await verifier();
    const { api } = fixture();
    expect(findReuse(context, api, workflow)).toEqual({ sha: head, runId: 42, attempt: 1, tree });
  });

  it.each([
    [
      "different merge tree",
      (d) => {
        d.commits[sha].tree.sha = "d".repeat(40);
      },
    ],
    [
      "invalid tree",
      (d) => {
        d.commits[sha].tree.sha = "";
        d.commits[head].tree.sha = "";
      },
    ],
    [
      "wrong commit response",
      (d) => {
        d.commits[sha].sha = head;
      },
    ],
    [
      "direct push",
      (d) => {
        d.prs = [];
      },
    ],
    [
      "ambiguous associated PR",
      (d) => {
        d.prs.push(d.prs[0]);
      },
    ],
    [
      "unmerged PR",
      (d) => {
        d.prs[0].merged_at = null;
      },
    ],
    [
      "open PR",
      (d) => {
        d.prs[0].state = "open";
      },
    ],
    [
      "different merge commit",
      (d) => {
        d.prs[0].merge_commit_sha = head;
      },
    ],
    [
      "different target",
      (d) => {
        d.prs[0].base.ref = "release";
      },
    ],
    [
      "different base repository",
      (d) => {
        d.prs[0].base.repo.full_name = "other/repo";
      },
    ],
    [
      "fork head",
      (d) => {
        d.prs[0].head.repo.full_name = "other/repo";
      },
    ],
    [
      "malformed head",
      (d) => {
        d.prs[0].head.sha = "invalid";
      },
    ],
    [
      "no run",
      (d) => {
        d.runs.workflow_runs = [];
        d.runs.total_count = 0;
      },
    ],
    [
      "truncated runs",
      (d) => {
        d.runs.total_count = 101;
      },
    ],
    [
      "wrong workflow",
      (d) => {
        d.run.workflow_id = 11;
      },
    ],
    [
      "wrong workflow path",
      (d) => {
        d.run.path = ".github/workflows/other.yml";
      },
    ],
    [
      "wrong event",
      (d) => {
        d.run.event = "workflow_dispatch";
      },
    ],
    [
      "different run head",
      (d) => {
        d.run.head_sha = sha;
      },
    ],
    [
      "different branch",
      (d) => {
        d.run.head_branch = "other";
      },
    ],
    [
      "fork run",
      (d) => {
        d.run.head_repository.full_name = "other/repo";
      },
    ],
    [
      "foreign run",
      (d) => {
        d.run.repository.full_name = "other/repo";
      },
    ],
    [
      "run still active",
      (d) => {
        d.run.status = "in_progress";
      },
    ],
    [
      "failed run",
      (d) => {
        d.run.conclusion = "failure";
      },
    ],
    [
      "cancelled run",
      (d) => {
        d.run.conclusion = "cancelled";
      },
    ],
    [
      "invalid attempt",
      (d) => {
        d.run.run_attempt = 0;
      },
    ],
    [
      "run tree inconsistent",
      (d) => {
        d.run.head_commit.tree_id = "d".repeat(40);
      },
    ],
    [
      "later failed run",
      (d) => {
        d.runs.workflow_runs.push({ ...d.run, id: 44, conclusion: "failure" });
        d.runs.total_count++;
      },
    ],
    [
      "missing jobs page",
      (d) => {
        d.jobs.total_count++;
      },
    ],
    [
      "missing declared job",
      (d) => {
        d.jobs.jobs.splice(3, 1);
        d.jobs.total_count--;
      },
    ],
    [
      "failed job",
      (d) => {
        d.jobs.jobs[3].conclusion = "failure";
      },
    ],
    [
      "cancelled job",
      (d) => {
        d.jobs.jobs[3].conclusion = "cancelled";
      },
    ],
    [
      "unfinished job",
      (d) => {
        d.jobs.jobs[3].status = "queued";
      },
    ],
    [
      "skipped aggregate",
      (d) => {
        d.jobs.jobs[4].conclusion = "skipped";
      },
    ],
    [
      "skipped root guards",
      (d) => {
        d.jobs.jobs[2].conclusion = "skipped";
      },
    ],
    [
      "different job run",
      (d) => {
        d.jobs.jobs[3].run_id = 41;
      },
    ],
    [
      "different job attempt",
      (d) => {
        d.jobs.jobs[3].run_attempt = 2;
      },
    ],
    [
      "different job head",
      (d) => {
        d.jobs.jobs[3].head_sha = sha;
      },
    ],
    [
      "different current head",
      (d) => {
        d.current.head_sha = head;
      },
    ],
    [
      "different current workflow",
      (d) => {
        d.current.path = ".github/workflows/other.yml";
      },
    ],
    [
      "duplicate job names",
      (d) => {
        d.jobs.jobs.push(d.jobs.jobs[0]);
        d.jobs.total_count++;
      },
    ],
    [
      "unknown job",
      (d) => {
        d.jobs.jobs.push({ ...d.jobs.jobs[0], name: "unknown" });
        d.jobs.total_count++;
      },
    ],
    [
      "no jobs",
      (d) => {
        d.jobs = { total_count: 0, jobs: [] };
      },
    ],
    [
      "malformed API evidence",
      (d) => {
        d.current = null;
      },
    ],
  ])("retains normal CI for %s", async (_name, change) => {
    const findReuse = await verifier();
    const { data, api } = fixture();
    change(data);
    expect(findReuse(context, api, workflow)).toBeNull();
  });

  it.each([
    { event: "pull_request" },
    { event: "workflow_dispatch" },
    { ref: "refs/tags/v1" },
    { sha: "bad" },
    { repository: "bad" },
    { runId: "0" },
  ])("retains normal CI before API reads for %j", async (change) => {
    const findReuse = await verifier();
    expect(
      findReuse(
        { ...context, ...change },
        () => {
          throw new Error("unexpected API read");
        },
        workflow,
      ),
    ).toBeNull();
  });

  it("rejects a source attempt restarted after its jobs were read", async () => {
    const findReuse = await verifier();
    const { api } = fixture();
    expect(
      findReuse(
        context,
        (path) => (path.endsWith("/runs/42") ? { ...api(path), run_attempt: 2 } : api(path)),
        workflow,
      ),
    ).toBeNull();
  });

  it("falls back when any API evidence lookup fails", async () => {
    const findReuse = await verifier();
    const { api } = fixture();
    const paths = [];
    findReuse(
      context,
      (path) => {
        paths.push(path);
        return api(path);
      },
      workflow,
    );
    expect(paths.length).toBeGreaterThanOrEqual(7);
    for (const failed of paths) {
      expect(
        findReuse(
          context,
          (path) => {
            if (path === failed) throw new Error("unavailable");
            return api(path);
          },
          workflow,
        ),
        failed,
      ).toBeNull();
    }
  });
});

it("cannot reuse without the current workflow's full job inventory", async () => {
  const findReuse = await verifier();
  const { api } = fixture();
  expect(findReuse(context, api, "jobs:\n  ci:\n")).toBeNull();
});

it("records the source run and tree in outputs and the job summary, or an explicit fallback", async () => {
  const source = await import(modulePath.href);
  expect(source.runReuse, "the workflow output writer must exist").toBeTypeOf("function");
  const dir = mkdtempSync(join(tmpdir(), "waitron-a1242-output-"));
  scratch.push(dir);
  const env = {
    GITHUB_EVENT_NAME: context.event,
    GITHUB_REF: context.ref,
    GITHUB_SHA: sha,
    GITHUB_REPOSITORY: repository,
    GITHUB_RUN_ID: "43",
    GITHUB_OUTPUT: join(dir, "output"),
    GITHUB_STEP_SUMMARY: join(dir, "summary"),
  };
  const { api } = fixture();
  source.runReuse(env, api, workflow);
  expect(readFileSync(env.GITHUB_OUTPUT, "utf8")).toBe(
    `reuse=true\nreuse_run=42\nreuse_sha=${head}\n`,
  );
  expect(readFileSync(env.GITHUB_STEP_SUMMARY, "utf8")).toContain(
    `https://github.com/${repository}/actions/runs/42`,
  );
  expect(readFileSync(env.GITHUB_STEP_SUMMARY, "utf8")).toContain(tree);
  source.runReuse(
    env,
    () => {
      throw new Error("API unavailable");
    },
    workflow,
  );
  expect(readFileSync(env.GITHUB_OUTPUT, "utf8")).toContain(
    "reuse=false\nreuse_run=\nreuse_sha=\n",
  );
  expect(readFileSync(env.GITHUB_STEP_SUMMARY, "utf8")).toContain(
    "Running the normal CI selection.",
  );
});

const scratch = [];
afterEach(() => {
  for (const path of scratch.splice(0)) rmSync(path, { recursive: true, force: true });
});

it("an up-to-date local squash preserves the PR head tree and a behind squash does not", () => {
  const dir = mkdtempSync(join(tmpdir(), "waitron-a1242-squash-"));
  scratch.push(dir);
  const env = Object.fromEntries(
    Object.entries(process.env).filter(([key]) => !key.startsWith("GIT_")),
  );
  const git = (...args) =>
    execFileSync("git", args, {
      cwd: dir,
      env,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      timeout: 10_000,
    }).trim();
  git("init", "-b", "main");
  git("config", "user.name", "CI fixture");
  git("config", "user.email", "ci@example.test");
  git("config", "commit.gpgsign", "false");
  writeFileSync(join(dir, "base"), "base");
  git("add", ".");
  git("commit", "-sm", "base");
  git("switch", "-c", "feature");
  writeFileSync(join(dir, "feature"), "feature");
  git("add", ".");
  git("commit", "-sm", "feature");
  const headTree = git("rev-parse", "HEAD^{tree}");
  git("switch", "main");
  git("merge", "--squash", "feature");
  git("commit", "-sm", "squash");
  expect(git("rev-parse", "HEAD^{tree}")).toBe(headTree);
  git("reset", "--hard", "HEAD~1");
  writeFileSync(join(dir, "main-only"), "main");
  git("add", ".");
  git("commit", "-sm", "main advance");
  git("merge", "--squash", "feature");
  git("commit", "-sm", "behind squash");
  expect(git("rev-parse", "HEAD^{tree}")).not.toBe(headTree);
  expect(readFileSync(join(dir, "main-only"), "utf8")).toBe("main");
});
