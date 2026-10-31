import { execFileSync } from "node:child_process";
import { appendFileSync, readFileSync } from "node:fs";
import { URL, pathToFileURL } from "node:url";

const shaPattern = /^[a-f0-9]{40}$/;
const positiveInteger = (value) => Number.isSafeInteger(value) && value > 0;

export function findReuse(context, api, workflow) {
  const { event, ref, sha, repository, runId } = context;
  if (
    event !== "push" ||
    ref !== "refs/heads/main" ||
    !shaPattern.test(sha) ||
    !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository) ||
    !/^[1-9][0-9]*$/.test(runId)
  )
    return null;
  try {
    const prefix = `repos/${repository}`;
    const current = api(`${prefix}/actions/runs/${runId}`);
    if (
      current.id !== Number(runId) ||
      !positiveInteger(current.workflow_id) ||
      current.head_sha !== sha ||
      current.event !== "push" ||
      current.path !== ".github/workflows/ci.yml" ||
      current.repository.full_name !== repository
    )
      return null;
    const prs = api(`${prefix}/commits/${sha}/pulls?per_page=100`);
    if (!Array.isArray(prs) || prs.length !== 1) return null;
    const pr = prs[0];
    if (
      pr.state !== "closed" ||
      !pr.merged_at ||
      pr.merge_commit_sha !== sha ||
      pr.base.ref !== "main" ||
      pr.base.repo.full_name !== repository ||
      pr.head.repo.full_name !== repository ||
      !shaPattern.test(pr.head.sha)
    )
      return null;

    const pushed = api(`${prefix}/git/commits/${sha}`);
    const head = api(`${prefix}/git/commits/${pr.head.sha}`);
    if (
      pushed.sha !== sha ||
      head.sha !== pr.head.sha ||
      !shaPattern.test(pushed.tree.sha) ||
      pushed.tree.sha !== head.tree.sha
    )
      return null;

    const listing = api(
      `${prefix}/actions/workflows/${current.workflow_id}/runs?head_sha=${pr.head.sha}&event=pull_request&per_page=100`,
    );
    if (
      !Array.isArray(listing.workflow_runs) ||
      !listing.workflow_runs.length ||
      listing.total_count !== listing.workflow_runs.length
    )
      return null;
    const run = [...listing.workflow_runs].sort((a, b) => b.id - a.id)[0];
    const admitted = (candidate) =>
      candidate.id === run.id &&
      positiveInteger(candidate.id) &&
      candidate.workflow_id === current.workflow_id &&
      candidate.path === ".github/workflows/ci.yml" &&
      candidate.event === "pull_request" &&
      candidate.head_sha === pr.head.sha &&
      candidate.head_branch === pr.head.ref &&
      candidate.repository.full_name === repository &&
      candidate.head_repository.full_name === repository &&
      candidate.status === "completed" &&
      candidate.conclusion === "success" &&
      positiveInteger(candidate.run_attempt) &&
      candidate.run_attempt === run.run_attempt &&
      candidate.head_commit.tree_id === head.tree.sha;
    if (!admitted(run)) return null;

    const evidence = api(
      `${prefix}/actions/runs/${run.id}/attempts/${run.run_attempt}/jobs?per_page=100`,
    );
    const { jobs, total_count: count } = evidence;
    if (
      !Array.isArray(jobs) ||
      !jobs.length ||
      jobs.length !== count ||
      new Set(jobs.map((job) => job.name)).size !== jobs.length ||
      jobs.some(
        (job) =>
          job.run_id !== run.id ||
          job.run_attempt !== run.run_attempt ||
          job.head_sha !== pr.head.sha ||
          job.status !== "completed" ||
          !["success", "skipped"].includes(job.conclusion),
      )
    )
      return null;

    const jobsBlock = workflow.split(/^jobs:\s*$/m)[1] ?? "";
    const ids = [...jobsBlock.matchAll(/^ {2}([A-Za-z0-9_-]+):\s*$/gm)].map((match) => match[1]);
    if (!["changes", "lint", "root-guards", "ci", "publish"].every((id) => ids.includes(id)))
      return null;
    const matches = (name, id) =>
      name === id || name.startsWith(`${id} (`) || name.startsWith(`${id} / `);
    if (
      ids.some((id) => !jobs.some((job) => matches(job.name, id))) ||
      jobs.some((job) => !ids.some((id) => matches(job.name, id))) ||
      ["changes", "lint", "root-guards", "ci"].some(
        (name) =>
          jobs.filter((job) => job.name === name && job.conclusion === "success").length !== 1,
      )
    )
      return null;

    // A rerun can replace the latest attempt between the run and jobs reads.
    if (!admitted(api(`${prefix}/actions/runs/${run.id}`))) return null;
    return { sha: pr.head.sha, runId: run.id, attempt: run.run_attempt, tree: head.tree.sha };
  } catch {
    return null;
  }
}

function githubApi(path) {
  return JSON.parse(
    execFileSync("gh", ["api", path], {
      encoding: "utf8",
      timeout: 15_000,
      maxBuffer: 8 * 1024 * 1024,
      stdio: ["ignore", "pipe", "pipe"],
    }),
  );
}

export function runReuse(
  env = process.env,
  api = githubApi,
  workflow = readFileSync(new URL("../.github/workflows/ci.yml", import.meta.url), "utf8"),
) {
  const result = findReuse(
    {
      event: env.GITHUB_EVENT_NAME,
      ref: env.GITHUB_REF,
      sha: env.GITHUB_SHA,
      repository: env.GITHUB_REPOSITORY,
      runId: env.GITHUB_RUN_ID,
    },
    api,
    workflow,
  );
  appendFileSync(
    env.GITHUB_OUTPUT,
    `reuse=${Boolean(result)}\nreuse_run=${result?.runId ?? ""}\nreuse_sha=${result?.sha ?? ""}\n`,
  );
  const summary = result
    ? `Reusing successful PR CI [run ${result.runId}](https://github.com/${env.GITHUB_REPOSITORY}/actions/runs/${result.runId}) (attempt ${result.attempt}).\n\nPR head: \`${result.sha}\`; identical Git tree: \`${result.tree}\`.\n`
    : "No verified equal-tree PR CI result. Running the normal CI selection.\n";
  appendFileSync(env.GITHUB_STEP_SUMMARY, summary);
  return result;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) runReuse();
