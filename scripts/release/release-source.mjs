import { execFileSync } from "node:child_process";
import {
  compareReleaseVersions,
  isNumberedVersion,
  isStableVersion,
} from "../box/release-list.mjs";
import { isMainScript } from "../is-main-script.mjs";

export const isMaintenanceBranch = (branch) => /^maintenance\/[^/]+$/.test(branch);

const git = (run, ...args) => run("git", args).trim();
const versions = (output) =>
  output
    .split("\n")
    .map((tag) => tag.slice(1))
    .filter(isNumberedVersion);

function releaseHistory(run, head, version, published) {
  if (git(run, "rev-parse", "--is-shallow-repository") !== "false")
    throw new Error("release source checks require full Git history");
  const merged = versions(git(run, "tag", "--merged", head, "--list", "v*")).filter(
    (tag) => published === undefined || published.includes(tag),
  );
  const later = merged.find(
    (tag) =>
      (published !== undefined || tag !== version) && compareReleaseVersions(tag, version) >= 0,
  );
  if (later !== undefined) throw new Error(`v${version} contains release v${later}`);
  return { merged, fork: git(run, "merge-base", "--all", head, "origin/main") };
}

function requireReleaseFork(run, fork, merged, version) {
  const forkVersions = fork.includes("\n")
    ? []
    : versions(git(run, "tag", "--points-at", fork, "--list", "v*")).filter((tag) =>
        merged.includes(tag),
      );
  if (forkVersions.length === 0)
    throw new Error("the maintenance branch must fork from main at a lower release tag");
  const [major] = version.split(".", 1);
  if (!forkVersions.some((tag) => tag.startsWith(`${major}.`)))
    throw new Error("a maintenance release must keep the major version of its release fork");
}

const namedRules = ["creation", "deletion", "non_fast_forward", "pull_request"];
function protectedBranch(run, branch) {
  const path = `repos/{owner}/{repo}/rules/branches/${encodeURIComponent(branch)}?per_page=100`;
  for (const attempt of [1, 2]) {
    try {
      const rules = JSON.parse(run("gh", ["api", path], { timeout: 90_000 }));
      return (
        namedRules.every((type) => rules.some((rule) => rule.type === type)) &&
        rules.some(
          ({ type, parameters }) =>
            type === "required_status_checks" &&
            parameters?.strict_required_status_checks_policy === true &&
            parameters.required_status_checks?.some(({ context }) => context === "ci"),
        )
      );
    } catch {
      process.stderr.write(
        `reading release branch rules for ${branch} failed (attempt ${attempt})\n`,
      );
    }
  }
  return false;
}

export function checkMaintenanceRelease(run, { head, branch, version, released, preparing }) {
  const { merged, fork } = releaseHistory(run, head, version, released);
  const predecessor = released.findLast(
    (tag) => isStableVersion(tag) && compareReleaseVersions(tag, version) < 0,
  );
  if (predecessor === undefined || !merged.includes(predecessor))
    throw new Error(
      `${branch} must contain the latest lower stable release${predecessor ? ` v${predecessor}` : ""}`,
    );
  if (fork === head && !preparing)
    throw new Error(`${branch} still points at a commit of main; use main to tag that commit`);
  requireReleaseFork(run, fork, merged, version);
  if (!protectedBranch(run, branch))
    throw new Error(`${branch} is not protected by the required maintenance branch rules`);
}

function publishReleaseSource(run, { head, version }) {
  if (!isNumberedVersion(version)) throw new Error(`v${version} is not a release version`);
  const { merged, fork } = releaseHistory(run, head, version);
  if (fork === head) return "main";
  requireReleaseFork(run, fork, merged, version);
  const branches = git(
    run,
    "for-each-ref",
    "--contains",
    head,
    "--format=%(refname:strip=3)",
    "refs/remotes/origin/maintenance/",
  )
    .split("\n")
    .filter(isMaintenanceBranch);
  if (branches.some((branch) => protectedBranch(run, branch))) return "maintenance";
  throw new Error(`the tag v${version} is not on main or a protected maintenance branch`);
}

const nodeRun = (file, args, { timeout = 90_000 } = {}) =>
  execFileSync(file, args, {
    encoding: "utf8",
    timeout,
    killSignal: "SIGKILL",
    stdio: ["ignore", "pipe", "inherit"],
  });

export function main(
  [head, version],
  { run = nodeRun, stdout = process.stdout, stderr = process.stderr } = {},
) {
  try {
    stdout.write(`${publishReleaseSource(run, { head, version })}\n`);
    return 0;
  } catch (error) {
    stderr.write(`${error.message}\n`);
    return 1;
  }
}

if (isMainScript(import.meta.url)) process.exitCode = main(process.argv.slice(2));
