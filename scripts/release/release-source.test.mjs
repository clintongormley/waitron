import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { publishReleaseSource } from "./release-source.mjs";

const repo = mkdtempSync(join(tmpdir(), "release-source-"));
afterAll(() => rmSync(repo, { recursive: true, force: true }));
const env = {
  ...Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith("GIT_"))),
  GIT_CONFIG_NOSYSTEM: "1",
  GIT_CONFIG_GLOBAL: "/dev/null",
  GIT_AUTHOR_NAME: "Release Test",
  GIT_AUTHOR_EMAIL: "test@example.invalid",
  GIT_COMMITTER_NAME: "Release Test",
  GIT_COMMITTER_EMAIL: "test@example.invalid",
};
const git = (...args) =>
  execFileSync("git", ["-C", repo, ...args], { env, encoding: "utf8" }).trim();
const commit = (message) => {
  git("commit", "-q", "--allow-empty", "-m", message);
  return git("rev-parse", "HEAD");
};
const rules = [
  { type: "creation" },
  { type: "deletion" },
  { type: "non_fast_forward" },
  { type: "pull_request" },
  {
    type: "required_status_checks",
    parameters: {
      strict_required_status_checks_policy: true,
      required_status_checks: [{ context: "ci" }],
    },
  },
];

git("init", "-q", "-b", "main");
const fork = commit("1.2.0");
git("tag", "v1.2.0", fork);
const afterFork = commit("untagged");
git("tag", "v2.0.0", commit("2.0.0"));
const laterMain = commit("after 2.0.0");
git("update-ref", "refs/remotes/origin/main", laterMain);
git("checkout", "-qb", "maintenance/1.x", fork);
const patch = commit("1.2.1");
git("tag", "v1.2.1", patch);
const minor = commit("1.3.0");
git("tag", "v1.3.0", minor);
const minorPatch = commit("1.3.1");
git("tag", "v1.3.1", minorPatch);
git("update-ref", "refs/remotes/origin/maintenance/1.x", minorPatch);
git("checkout", "-qb", "maintenance/other", afterFork);
const untaggedFork = commit("on the wrong fork");
git("update-ref", "refs/remotes/origin/maintenance/other", untaggedFork);
git("checkout", "-qb", "maintenance/sibling", fork);
git("tag", "v1.2.2", commit("sibling patch tagged after 1.3.0"));

const source = (head, version) =>
  publishReleaseSource(
    (command, args) => {
      if (command === "git") return git(...args);
      expect(command).toBe("gh");
      return JSON.stringify(rules);
    },
    { head, version },
  );

describe("publishReleaseSource", () => {
  it.each([
    ["a patch", patch, "1.2.1"],
    ["a new minor after the sibling also cut a tag", minor, "1.3.0"],
    ["a patch to that minor", minorPatch, "1.3.1"],
  ])("admits %s on the older line", (_, head, version) => {
    expect(source(head, version)).toBe("maintenance");
  });

  it("refuses a lower version on main after a higher release", () => {
    expect(() => source(laterMain, "1.2.1")).toThrow("v1.2.1 contains release v2.0.0");
  });

  it("refuses a maintenance branch cut from an untagged commit", () => {
    expect(() => source(untaggedFork, "1.2.2")).toThrow(
      "must fork from main at a lower release tag",
    );
  });
});
