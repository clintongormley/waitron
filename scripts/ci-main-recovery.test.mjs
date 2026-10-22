import { spawnSync } from "node:child_process";
import {
  chmodSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterAll, describe, expect, it } from "vitest";

const root = resolve(import.meta.dirname, "..");
const temporary = mkdtempSync(join(tmpdir(), "ci-main-recovery-"));
afterAll(() => rmSync(temporary, { recursive: true, force: true }));
const env = Object.fromEntries(
  Object.entries(process.env).filter(([key]) => !key.startsWith("GIT_")),
);
const fixture = join(temporary, "repo");
mkdirSync(fixture);
function git(...args) {
  const result = spawnSync("git", args, { cwd: fixture, env, encoding: "utf8", timeout: 10_000 });
  if (result.status !== 0) throw new Error(result.stderr);
  return result.stdout.trim();
}
git("init", "-b", "main");
git("config", "user.name", "CI fixture");
git("config", "user.email", "ci@example.test");
git("config", "commit.gpgsign", "false");
mkdirSync(join(fixture, "apps/server/src"), { recursive: true });
mkdirSync(join(fixture, "docs"));
writeFileSync(join(fixture, "package.json"), JSON.stringify({ name: "fixture", private: true }));
writeFileSync(join(fixture, "pnpm-workspace.yaml"), "packages:\n  - apps/*\n");
writeFileSync(
  join(fixture, "apps/server/package.json"),
  JSON.stringify({ name: "@waitron/server", private: true }),
);
writeFileSync(join(fixture, "apps/server/src/mail.ts"), "export const ready = false;\n");
git("add", ".");
git("commit", "-m", "successful baseline");
const baseline = git("rev-parse", "HEAD");
git("branch", "target", baseline);
writeFileSync(join(fixture, "apps/server/src/mail.ts"), "export const ready = true;\n");
git("add", ".");
git("commit", "-m", "code merge with no CI run");
const codeHead = git("rev-parse", "HEAD");
writeFileSync(join(fixture, "docs/note.md"), "A later docs push.\n");
git("add", ".");
git("commit", "-m", "later docs");
const docsHead = git("rev-parse", "HEAD");
git("remote", "add", "origin", fixture);
git("fetch", "origin", "main");
symlinkSync(join(root, "scripts"), join(fixture, "scripts"));
const bin = join(temporary, "bin");
mkdirSync(bin);
writeFileSync(
  join(bin, "gh"),
  '#!/usr/bin/env bash\nprintf "%s\\n" "$@" >> "$WT_GH_ARGS"\n[ "$WT_GH_STATUS" = 0 ] || exit "$WT_GH_STATUS"\nprintf "%s" "$WT_RUNS" | jq -r "$4"\n',
);
chmodSync(join(bin, "gh"), 0o755);

const workflow = readFileSync(join(root, ".github/workflows/ci.yml"), "utf8");
const classify = workflow
  .split("      - id: classify\n")[1]
  .split("        run: |\n")[1]
  .split("\n")
  .slice(0)
  .filter(
    (line, index, lines) =>
      index < lines.findIndex((entry) => entry !== "" && !entry.startsWith("          ")),
  )
  .map((line) => line.slice(10))
  .join("\n");
const successful = (head_sha, extra = {}) => ({
  head_sha,
  head_branch: "main",
  event: "push",
  status: "completed",
  conclusion: "success",
  ...extra,
});
let serial = 0;
function classifyRun({
  event = "push",
  ref = "refs/heads/main",
  sha = docsHead,
  before = codeHead,
  runs = [successful(baseline)],
  status = 0,
} = {}) {
  const output = join(temporary, `output-${serial++}`);
  const args = `${output}.args`;
  writeFileSync(output, "");
  writeFileSync(args, "");
  const result = spawnSync("bash", ["-c", classify], {
    cwd: fixture,
    env: {
      ...env,
      PATH: `${bin}:${env.PATH}`,
      EVENT: event,
      REF: ref,
      SHA: sha,
      BEFORE: before,
      BASE_REF: "target",
      REPOSITORY: "example/waitron",
      GITHUB_OUTPUT: output,
      WT_GH_ARGS: args,
      WT_GH_STATUS: String(status),
      WT_RUNS: JSON.stringify({ workflow_runs: runs }),
    },
    encoding: "utf8",
    timeout: 30_000,
  });
  expect(result.status, result.stderr).toBe(0);
  return {
    values: Object.fromEntries(
      readFileSync(output, "utf8")
        .trim()
        .split("\n")
        .map((line) => line.split("=")),
    ),
    args: readFileSync(args, "utf8"),
    stderr: result.stderr,
  };
}

describe("main CI recovery", () => {
  it("includes a code merge with no run when the next push changes only docs", () => {
    const result = classifyRun();
    expect(result.values).toMatchObject({ code: "true", scope: "global", packages: "" });
    expect(result.args).toContain(
      "actions/workflows/ci.yml/runs?branch=main&status=success&per_page=100",
    );
  });
  it("keeps a docs push cheap once its code ancestor has succeeded", () => {
    expect(classifyRun({ runs: [successful(codeHead)] }).values).toMatchObject({
      code: "false",
      scope: "global",
    });
  });
  it.each([
    ["API refusal", { status: 1 }],
    ["no completed baseline", { runs: [] }],
    ["unknown commit", { runs: [successful("a".repeat(40))] }],
    ["malformed commit", { runs: [successful("HEAD~1")] }],
    ["failed run", { runs: [successful(codeHead, { conclusion: "failure" })] }],
    ["pending run", { runs: [successful(codeHead, { status: "in_progress" })] }],
    ["pull request", { runs: [successful(codeHead, { event: "pull_request" })] }],
    ["different branch", { runs: [successful(codeHead, { head_branch: "feature" })] }],
    ["same commit", { runs: [successful(docsHead)] }],
    ["future successful commit", { sha: codeHead, before: baseline, runs: [successful(docsHead)] }],
  ])("runs everything on %s", (_name, options) => {
    expect(classifyRun(options).values).toMatchObject({
      code: "true",
      scope: "global",
      packages: "",
      deploy: "true",
    });
  });
  it("ignores newer non-ancestors and accepts a successful manual main recovery as baseline", () => {
    expect(
      classifyRun({
        sha: codeHead,
        runs: [successful(docsHead), successful(baseline, { event: "workflow_dispatch" })],
      }).values.code,
    ).toBe("true");
    expect(
      classifyRun({ runs: [successful(codeHead, { event: "workflow_dispatch" })] }).values.code,
    ).toBe("false");
  });
  it("runs the full suite and image on a manual dispatch without consulting a baseline", () => {
    const result = classifyRun({ event: "workflow_dispatch" });
    expect(result.values).toMatchObject({
      code: "true",
      scope: "global",
      packages: "",
      deploy: "true",
    });
    expect(result.args).toBe("");
  });
  it("keeps pull requests scoped to their merge base without consulting main runs", () => {
    const result = classifyRun({ event: "pull_request" });
    expect(result.values).toMatchObject({
      code: "true",
      scope: "packages",
      packages: "@waitron/server",
    });
    expect(result.args).toBe("");
  });
  it("keeps release tags on the full-suite path without consulting main runs", () => {
    const result = classifyRun({ ref: "refs/tags/v1.0.0", before: "0".repeat(40) });
    expect(result.values).toMatchObject({ code: "true", scope: "global", deploy: "true" });
    expect(result.args).toBe("");
  });
  it("exposes manual recovery while retaining push-only publishing and the main tag guard", () => {
    expect(workflow.split("\nconcurrency:")[0]).toMatch(/^  workflow_dispatch:/m);
    const changes = workflow.split("\n  changes:\n")[1].split(/^  [a-z]/m)[0];
    expect(changes).toContain("      actions: read");
    expect(changes).toContain("GH_TOKEN: ${{ github.token }}");
    expect(changes).toContain("REF: ${{ github.ref }}");
    expect(changes).toContain("REPOSITORY: ${{ github.repository }}");
    const publishing = workflow.split("\n  publish:\n")[1];
    expect(publishing).toMatch(
      /if: github.event_name == 'push' && needs.changes.outputs.code == 'true' && needs.ci.result == 'success'/,
    );
    expect(publishing).toContain("scripts/main-tag-guard.sh");
  });
});
