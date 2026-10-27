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
import { afterAll, describe, expect, it, vi } from "vitest";

// One case invokes the classifier twice, each with a 30-second child deadline.
vi.setConfig({ testTimeout: 70_000 });

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
writeFileSync(join(fixture, "apps/server/src/mail.ts"), "export const ready = 'recovered';\n");
git("add", ".");
git("commit", "-m", "next code push");
const nextCodeHead = git("rev-parse", "HEAD");
git("remote", "add", "origin", fixture);
git("fetch", "origin", "main");
symlinkSync(join(root, "scripts"), join(fixture, "scripts"));
const bin = join(temporary, "bin");
mkdirSync(bin);
const realTimeout = spawnSync("bash", ["-c", "command -v gtimeout || command -v timeout"], {
  env,
  encoding: "utf8",
}).stdout.trim();
const realGit = spawnSync("bash", ["-c", "command -v git"], {
  env,
  encoding: "utf8",
}).stdout.trim();
for (const [name, source] of Object.entries({
  gtimeout: '#!/usr/bin/env bash\nexec "$WT_REAL_TIMEOUT" "$@"\n',
  timeout:
    '#!/usr/bin/env bash\n[ "$WT_GTIMEOUT_ONLY" != true ] || exit 127\nexec "$WT_REAL_TIMEOUT" "$@"\n',
  git: '#!/usr/bin/env bash\nif [ "$WT_DIFF_FAIL" = true ] && [ "$1" = diff ]; then printf "docs/note.md\\n"; exit 1; fi\nexec "$WT_REAL_GIT" "$@"\n',
})) {
  writeFileSync(join(bin, name), source);
  chmodSync(join(bin, name), 0o755);
}
writeFileSync(
  join(bin, "gh"),
  `#!/usr/bin/env bash
printf "%s\\n" "$@" >> "$WT_GH_ARGS"
[ "$WT_GH_STATUS" = 0 ] || exit "$WT_GH_STATUS"
printf "%s" "$WT_RUNS" | jq --arg endpoint "$2" 'if ($endpoint | contains("status=success")) then .workflow_runs |= map(select(.status == "completed" and .conclusion == "success")) else . end' | jq -r "$4"
`,
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
  gtimeoutOnly = false,
  diffFail = false,
  expectedStatus = 0,
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
      WT_REAL_TIMEOUT: realTimeout,
      WT_REAL_GIT: realGit,
      WT_GTIMEOUT_ONLY: String(gtimeoutOnly),
      WT_DIFF_FAIL: String(diffFail),
    },
    encoding: "utf8",
    timeout: 30_000,
  });
  expect(result.status, result.stderr).toBe(expectedStatus);
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
    expect(result.args).toContain("actions/workflows/ci.yml/runs?branch=main&per_page=100");
  });
  it("keeps a docs push cheap once its code ancestor has succeeded", () => {
    expect(classifyRun({ runs: [successful(codeHead)] }).values).toMatchObject({
      code: "false",
      scope: "global",
    });
  });
  it.each(["queued", "in_progress"])(
    "keeps a docs push cheap while its code ancestor's own run is %s",
    (status) => {
      const result = classifyRun({
        runs: [successful(codeHead, { status, conclusion: null }), successful(baseline)],
      });
      expect(result.values).toMatchObject({ code: "false", scope: "global", deploy: "false" });
      expect(result.stderr).toContain(`main CI baseline: ${codeHead}`);
    },
  );
  it("selects the nearest ancestor even when an older manual run appears first", () => {
    const result = classifyRun({
      runs: [
        successful(baseline, { event: "workflow_dispatch" }),
        successful(codeHead, { status: "queued", conclusion: null }),
      ],
    });
    expect(result.values.code).toBe("false");
    expect(result.stderr).toContain(`main CI baseline: ${codeHead}`);
  });
  it.each(["cancelled", "failure", "timed_out", "skipped", "neutral", "action_required"])(
    "includes earlier code when its only run completed with %s",
    (conclusion) => {
      expect(
        classifyRun({ runs: [successful(codeHead, { conclusion }), successful(baseline)] }).values,
      ).toMatchObject({ code: "true", scope: "global", deploy: "false" });
    },
  );
  it.each(["queued", "in_progress", "completed"])(
    "runs a code push in full behind a %s ancestor run",
    (status) => {
      expect(
        classifyRun({
          sha: codeHead,
          runs: [
            successful(baseline, { status, conclusion: status === "completed" ? "success" : null }),
          ],
        }).values,
      ).toMatchObject({ code: "true", scope: "global", packages: "", deploy: "false" });
    },
  );
  it("rechecks the full tree on the next code push after an earlier run fails and a docs run passes", () => {
    expect(
      classifyRun({
        sha: nextCodeHead,
        runs: [successful(docsHead), successful(codeHead, { conclusion: "failure" })],
      }).values,
    ).toMatchObject({ code: "true", scope: "global", packages: "", deploy: "false" });
  });
  it("can read the baseline when coreutils exposes only gtimeout", () => {
    expect(classifyRun({ gtimeoutOnly: true, runs: [successful(codeHead)] }).values.code).toBe(
      "false",
    );
  });
  it("fails classification rather than accepting partial paths from a failed diff", () => {
    const result = classifyRun({ diffFail: true, expectedStatus: 1 });
    expect(result.values).not.toHaveProperty("code");
    expect(result.stderr).toContain("cannot diff the main CI baseline");
  });
  it.each([
    ["API refusal", { status: 1 }],
    ["no completed baseline", { runs: [] }],
    ["unknown commit", { runs: [successful("a".repeat(40))] }],
    ["malformed commit", { runs: [successful("HEAD~1")] }],
    ["failed run", { runs: [successful(codeHead, { conclusion: "failure" })] }],
    [
      "inconsistent pending conclusion",
      { runs: [successful(codeHead, { status: "in_progress" })] },
    ],
    [
      "queued current commit",
      { runs: [successful(docsHead, { status: "queued", conclusion: null })] },
    ],
    [
      "queued PR",
      {
        runs: [successful(codeHead, { status: "queued", conclusion: null, event: "pull_request" })],
      },
    ],
    [
      "queued different branch",
      {
        runs: [
          successful(codeHead, { status: "queued", conclusion: null, head_branch: "feature" }),
        ],
      },
    ],
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
    expect(workflow.split("\nconcurrency:")[0]).toMatch(/^ {2}workflow_dispatch:/m);
    const changes = workflow.split("\n  changes:\n")[1].split(/^ {2}[a-z]/m)[0];
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
