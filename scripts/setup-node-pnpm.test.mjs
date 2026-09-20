// A job that lets GitHub's setup-node action cache the package manager has to have pnpm on the
// runner AND a populated pnpm store.
//
// `actions/setup-node@v5` caches the package manager by DEFAULT — `package-manager-cache` is true
// unless a job says otherwise — and this repository declares `packageManager: pnpm` in its root
// manifest, so the action goes looking for pnpm. Two different jobs have been broken by it, at
// opposite ends of the job:
//
//   - RESTORE, at the start: a job that never ran `pnpm/action-setup` dies with `Unable to locate
//     executable file: pnpm` before any of its own steps run. That is what `mutation-db-aggregate`
//     did on its first real run, 35504169506 (2026-09-20).
//   - SAVE, in the post-job step: a job that HAS pnpm but never runs `pnpm install` has no store
//     to save, and the post step fails with `Path Validation Error`. That is the `changes` job in
//     `ci.yml`, whose own comment carries both run ids (30651421691 passed on a warm cache,
//     30652021468 failed cold) — so it fires only sometimes, which is worse.
//
// So a setup-node step is safe in exactly two shapes: the cache is turned off, or the job both
// installs pnpm and runs `pnpm install`. Weaker than its name in two ways: it reads the workflows
// as TEXT rather than parsing YAML, so a step reached through a composite action or a reusable
// workflow is invisible to it; and it splits jobs and steps by INDENTATION, so a file written with
// different indentation than this repository's would not be read correctly.
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const workflowDir = join(root, ".github", "workflows");

/** Every workflow file, by name. */
function workflowFiles() {
  return readdirSync(workflowDir)
    .filter((name) => name.endsWith(".yml") || name.endsWith(".yaml"))
    .sort();
}

/** The lines of each job, keyed by the job's name, split on the two-space job headers. */
function jobsIn(text) {
  const jobs = new Map();
  let current;
  for (const line of text.split("\n")) {
    const header = /^ {2}([A-Za-z0-9_-]+):\s*$/.exec(line);
    if (header !== null) {
      current = [];
      jobs.set(header[1], current);
      continue;
    }
    current?.push(line);
  }
  return jobs;
}

/** One entry per `actions/setup-node` step: which job it is in, and whether it is safe. */
function setupNodeSteps(text) {
  const found = [];
  for (const [job, lines] of jobsIn(text)) {
    const pnpmAt = lines.findIndex((line) => /^\s*-?\s*uses:\s*pnpm\/action-setup/.test(line));
    const hasInstall = lines.some((line) => /^\s*-?\s*run:\s.*pnpm install/.test(line));
    for (let at = 0; at < lines.length; at += 1) {
      // A `uses:` line, never a comment that merely names the action — `ci.yml`'s `changes` job
      // explains this very trap in prose above its own step.
      if (!/^\s*-?\s*uses:\s*actions\/setup-node/.test(lines[at])) continue;
      // The step's own body: everything up to the next step at the same indentation.
      const body = [];
      for (let then = at + 1; then < lines.length; then += 1) {
        if (/^ {2,}- /.test(lines[then])) break;
        body.push(lines[then]);
      }
      found.push({
        job,
        line: at + 1,
        // pnpm must be installed BEFORE this step, because the cache restore runs inside it; the
        // install may come after, because the cache save runs once the job's steps are done.
        withStore: pnpmAt !== -1 && pnpmAt < at && hasInstall,
        cacheOff: body.join("\n").includes("package-manager-cache: false"),
      });
    }
  }
  return found;
}

describe("every setup-node step can reach the package manager it caches", () => {
  it("finds setup-node steps to check", () => {
    // Read, not written down, so a new workflow arrives here on its own — and asserted non-empty
    // because an empty list would make every case below vacuous.
    const total = workflowFiles().reduce(
      (count, name) => count + setupNodeSteps(readFileSync(join(workflowDir, name), "utf8")).length,
      0,
    );
    expect(total).toBeGreaterThan(0);
  });

  it.each(workflowFiles())("%s", (name) => {
    const steps = setupNodeSteps(readFileSync(join(workflowDir, name), "utf8"));
    const unsafe = steps
      .filter((step) => !step.withStore && !step.cacheOff)
      .map((step) => `${name}, job ${step.job}, line ${step.line} of that job`);
    expect(unsafe).toEqual([]);
  });
});
