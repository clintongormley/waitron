// A job that asks GitHub's setup-node action for a package-manager cache has to have pnpm on the
// runner already.
//
// `actions/setup-node@v5` caches the package manager by DEFAULT — `package-manager-cache` is true
// unless a job says otherwise — and this repository declares `packageManager: pnpm` in its root
// manifest, so the action shells out to pnpm to find the store. A job that has not run
// `pnpm/action-setup` first fails there with `Unable to locate executable file: pnpm`, before any
// of its own steps run. Cost: the `mutation-db-aggregate` job, which runs one plain `node` script
// and installs nothing, failed that way on its first real run (2026-09-20).
//
// So each setup-node step must do ONE of two things: come after `pnpm/action-setup` in the same
// job, or turn the cache off. Weaker than its name in two ways: it reads the workflows as TEXT
// rather than parsing YAML, so a step reached through a composite action or a reusable workflow is
// invisible to it; and it splits jobs and steps by INDENTATION, so a file written with different
// indentation than this repository's would not be read correctly.
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

/** One entry per `actions/setup-node` step: which job it is in, and whether it is safe. */
function setupNodeSteps(text) {
  const lines = text.split("\n");
  const found = [];
  let job = "(before any job)";
  let pnpmSeenInJob = false;
  for (let at = 0; at < lines.length; at += 1) {
    const line = lines[at];
    const jobHeader = /^ {2}([A-Za-z0-9_-]+):\s*$/.exec(line);
    if (jobHeader !== null) {
      job = jobHeader[1];
      pnpmSeenInJob = false;
      continue;
    }
    if (line.includes("pnpm/action-setup")) pnpmSeenInJob = true;
    if (!line.includes("actions/setup-node")) continue;
    // The step's own body: everything up to the next step at the same indentation, or the next job.
    const body = [];
    for (let then = at + 1; then < lines.length; then += 1) {
      if (/^ {2,}- /.test(lines[then]) || /^ {2}[A-Za-z0-9_-]+:\s*$/.test(lines[then])) break;
      body.push(lines[then]);
    }
    found.push({
      job,
      line: at + 1,
      afterPnpm: pnpmSeenInJob,
      cacheOff: body.join("\n").includes("package-manager-cache: false"),
    });
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
      .filter((step) => !step.afterPnpm && !step.cacheOff)
      .map((step) => `${name}:${step.line} in job ${step.job}`);
    expect(unsafe).toEqual([]);
  });
});
