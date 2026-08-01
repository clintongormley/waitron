import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

// The sign-off (DCO) predicate, and the walk over a push's commits, in ONE place both gates call:
// `.husky/pre-push`'s `check_signoff` and licence.yml's `dco` job. They kept byte-identical copies
// of `grep -qiE '^Signed-off-by: .+ <.+@.+>'` and of the loop around it, and "the way to keep them
// agreeing is one script both call" is docs/backlog.md's own conclusion about that.
//
// Shell rather than `.mjs`, decided on how the two callers invoke it rather than on taste:
//
//   * The hook runs this step FIRST, before `pnpm install` and before the classifier, and it is
//     documented as working with no node on PATH — .husky/pre-push carries the run where the
//     interpreter was taken away (`env -i HOME=$HOME PATH=/usr/bin:/bin:...`), the classifier
//     printed `node: command not found`, and the sign-off step still named the offending commit
//     and still exited 1. A node script would retire that property for the cheapest step in the
//     gate.
//   * licence.yml's `dco` job is `actions/checkout` plus one `run:` step — no pnpm, no setup-node,
//     nothing installed. A `.mjs` script would make a REQUIRED status check ("Every commit is
//     signed off", ruleset 19899160) depend either on whatever node the runner image happens to
//     ship or on a setup step added to the fastest job in the file.
//
// So it is exercised the way both callers exercise it: spawned as a program, against throwaway git
// repositories built here. Nothing measures its coverage — v8 sees JavaScript in this process, and
// this is `sh` in a child — so these assertions are the whole of the evidence, and deleting them
// deletes it.
const script = join(import.meta.dirname, "check-signoff.sh");

/**
 * Git's own environment overrides. Every one of these outranks the `cwd` a child process is spawned
 * in, so any that survive into a fixture's `git commit` send it to whatever repository the variable
 * names — not the temporary one this suite built.
 *
 * `GIT_DIR` is the one that bites, and it bites in exactly one situation: **git sets it for every
 * hook it runs**, and `.husky/pre-push` runs this suite on every push. Measured on this branch, same
 * command, the only difference being the variable:
 *
 *   $ pnpm vitest run scripts/check-signoff.test.mjs                  # HEAD unchanged
 *   $ GIT_DIR=$(git rev-parse --absolute-git-dir) pnpm vitest run …   # HEAD moved by 7 commits,
 *                                                                     # named signed, unsigned,
 *                                                                     # lowercase, indented, …
 *
 * That is not hypothetical: it put those seven fixtures on this branch and pushed them three times
 * before the mechanism was found, and five of them fail the DCO check the script exists to enforce —
 * so a suite testing the sign-off gate was breaking it. The failure is invisible when the suite is
 * run by hand, which is the only way it had been run.
 */
const GIT_LOCATION_OVERRIDES = [
  "GIT_DIR",
  "GIT_WORK_TREE",
  "GIT_INDEX_FILE",
  "GIT_COMMON_DIR",
  "GIT_OBJECT_DIRECTORY",
  "GIT_ALTERNATE_OBJECT_DIRECTORIES",
  "GIT_NAMESPACE",
];

/** The environment a fixture's `git` runs in: the caller's, minus anything that relocates the repo. */
function isolatedGitEnv() {
  const env = { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_SYSTEM: "/dev/null" };
  for (const name of GIT_LOCATION_OVERRIDES) delete env[name];
  return env;
}

/**
 * Runs `git` in `cwd`, isolated from whoever is running the suite. `GIT_CONFIG_GLOBAL` and
 * `GIT_CONFIG_SYSTEM` point at /dev/null so a developer's `commit.gpgsign = true` (or their name, or
 * a `format.signoff = true` that would make every fixture pass) cannot reach these fixtures, and the
 * location overrides above are dropped so `cwd` is what decides which repository is written.
 * Throws on failure rather than returning a status nobody reads.
 */
function git(cwd, ...args) {
  const result = spawnSync("git", args, { cwd, encoding: "utf8", env: isolatedGitEnv() });
  if (result.status !== 0) {
    throw new Error(`git ${args.join(" ")} failed (${result.status}): ${result.stderr}`);
  }
  return result.stdout.trim();
}

/**
 * Runs the script under test with `input` on stdin, from `cwd`. Same environment isolation as
 * `git()`: the script shells out to `git log`, so an inherited `GIT_DIR` would point it at the
 * caller's repository and it would report on commits the fixtures never made.
 */
function checkSignoff(cwd, input) {
  return spawnSync(script, [], { cwd, encoding: "utf8", input, env: isolatedGitEnv() });
}

describe("check-signoff.sh", () => {
  let repo;
  /** Commit subject → sha, for the fixtures built once below. */
  const sha = {};

  beforeAll(() => {
    repo = mkdtempSync(join(tmpdir(), "waitron-signoff-"));
    git(repo, "init", "-q", "-b", "main");
    git(repo, "config", "user.name", "Fixture Author");
    git(repo, "config", "user.email", "fixture@example.com");

    // Written as messages rather than as `git commit -s` where the trailer's SHAPE is the point,
    // because that is the only way to reach the near-misses. The one commit that does use `-s` is
    // there so the suite also pins what the command a developer actually runs produces.
    const commits = [
      ["signed", null],
      ["unsigned", "unsigned\n\nno trailer here at all\n"],
      ["lowercase", "lowercase\n\nsigned-off-by: Fixture Author <fixture@example.com>\n"],
      ["indented", "indented\n\n  Signed-off-by: Fixture Author <fixture@example.com>\n"],
      ["no-email", "no-email\n\nSigned-off-by: Fixture Author\n"],
      ["empty-angles", "empty-angles\n\nSigned-off-by: Fixture Author <>\n"],
      ["mid-line", "mid-line\n\nsee Signed-off-by: Fixture Author <fixture@example.com>\n"],
    ];

    for (const [name, message] of commits) {
      if (message === null) git(repo, "commit", "-s", "--allow-empty", "-q", "-m", name);
      else git(repo, "commit", "--allow-empty", "-q", "-m", message);
      sha[name] = git(repo, "rev-parse", "HEAD");
    }
  });

  afterAll(() => {
    // Guarded because a `mkdtempSync` that threw leaves `repo` undefined, and an unguarded teardown
    // then reports a second, spurious failure on top of the real one (CLAUDE.md §4).
    if (repo !== undefined) rmSync(repo, { recursive: true, force: true });
  });

  it("accepts what `git commit -s` writes", () => {
    const result = checkSignoff(repo, `${sha.signed}\n`);
    expect(result.stdout).toBe("");
    expect(result.status).toBe(0);
  });

  it("accepts a lowercase trailer, as both callers' `grep -i` did", () => {
    expect(checkSignoff(repo, `${sha.lowercase}\n`).status).toBe(0);
  });

  it("reports a commit with no trailer, naming it as `git log --oneline` does", () => {
    const result = checkSignoff(repo, `${sha.unsigned}\n`);
    expect(result.status).toBe(1);
    expect(result.stdout.trim()).toBe(git(repo, "log", "-1", "--oneline", sha.unsigned));
    expect(result.stdout).toContain("unsigned");
  });

  // The near-misses — count them off the list rather than from this sentence, which is why it does
  // not carry a number (CLAUDE.md §2 records the same trap on its own list). Each is a message that
  // CONTAINS the words and is still not a sign-off, and each pins one property of the regex: `^`
  // against leading whitespace, `<.+@.+>` against a missing address and again against empty angle
  // brackets, and `^` from the other side against the words mid-line. A guard that passed any of
  // them would accept a commit GitHub's own DCO app rejects.
  it.each([
    ["an indented trailer", "indented"],
    ["a trailer with no email", "no-email"],
    ["a trailer with empty angle brackets", "empty-angles"],
    ["the words in the middle of a line", "mid-line"],
  ])("rejects %s", (_label, name) => {
    const result = checkSignoff(repo, `${sha[name]}\n`);
    expect(result.status).toBe(1);
    expect(result.stdout).toContain(name);
  });

  it("walks every commit it is given and reports all the failures, not the first", () => {
    const result = checkSignoff(
      repo,
      [sha.signed, sha.unsigned, sha.lowercase, sha["no-email"]].join("\n") + "\n",
    );
    expect(result.status).toBe(1);
    const reported = result.stdout.trim().split("\n");
    expect(reported).toHaveLength(2);
    expect(reported[0]).toContain("unsigned");
    expect(reported[1]).toContain("no-email");
  });

  it("passes on empty input, which is what an empty range gives both callers", () => {
    expect(checkSignoff(repo, "").status).toBe(0);
    expect(checkSignoff(repo, "\n").status).toBe(0);
    expect(checkSignoff(repo, "\n\n\n").stdout).toBe("");
  });

  // The one branch in the script that no other assertion here reaches: `read` returns non-zero at
  // EOF but has ALREADY assigned what it read, so a final line with no trailing newline is only
  // processed because of the loop's `|| [ -n "$sha" ]`. Proven by deletion on 2026-08-01 — with
  // that guard removed and this exact input, the script printed nothing and exited **0**, a silent
  // pass on an unsigned commit; with it, the two assertions below. Every other fixture in this file
  // ends in `\n`, and both callers build their list with `printf '%s\n'`, so nothing else here
  // would fail if the guard were dropped.
  it("processes a final sha with no trailing newline", () => {
    const result = checkSignoff(repo, `${sha.signed}\n${sha.unsigned}`);
    expect(result.status).toBe(1);
    expect(result.stdout.trim()).toBe(git(repo, "log", "-1", "--oneline", sha.unsigned));
  });

  it("skips blank lines between shas rather than reporting them", () => {
    const result = checkSignoff(repo, `\n${sha.signed}\n\n${sha.lowercase}\n\n`);
    expect(result.stdout).toBe("");
    expect(result.status).toBe(0);
  });

  // The hook feeds this the commits it accumulated from `git rev-list`; a sha this checkout does
  // not have means the range was wrong, and reporting it as SIGNED would be the silent direction.
  it("reports a sha this repository does not have, by name", () => {
    const bogus = "deadbeefdeadbeefdeadbeefdeadbeefdeadbeef";
    const result = checkSignoff(repo, `${bogus}\n`);
    expect(result.status).toBe(1);
    expect(result.stdout.trim()).toBe(bogus);
  });

  // Both callers read the failing commits off STDOUT and wrap them in their own reporting —
  // licence.yml in `::error::` annotations, the hook in an indented list — so anything the script
  // wants to say to a human has to go to stderr or the annotations come out malformed.
  it("puts nothing but the failing commits on stdout", () => {
    const result = checkSignoff(repo, `${sha.signed}\n${sha.unsigned}\n`);
    expect(result.stdout.trim().split("\n")).toHaveLength(1);
  });

  // The CI half, run rather than read. The step's shell is EXTRACTED FROM licence.yml rather than
  // transcribed here — a transcription tests this file's copy of a workflow, which is the shape of
  // duplication this whole change exists to remove. What cannot be run locally is the `${{ }}`
  // interpolation, so the extraction refuses a block that has any: both shas reach that step as
  // environment variables, and this asserts they still do.
  describe("licence.yml's dco step", () => {
    let step;

    beforeAll(() => {
      const workflow = readFileSync(
        join(import.meta.dirname, "..", ".github", "workflows", "licence.yml"),
        "utf8",
      );
      // Anchored on the STEP NAME, not on the first `run: |` in the file — that one belongs to the
      // licence-integrity job, and taking it would run a `sha256sum` check against three shas and
      // report whatever it felt like.
      const lines = workflow.split("\n");
      const named = lines.findIndex((line) => line.includes("name: Check Signed-off-by trailers"));
      expect(named).toBeGreaterThan(-1);
      const start = lines.findIndex((line, index) => index > named && line.trim() === "run: |");
      expect(start).toBeGreaterThan(named);

      const indent = " ".repeat(lines[start].indexOf("run:") + 2);
      const body = [];
      for (const line of lines.slice(start + 1)) {
        if (line.trim() !== "" && !line.startsWith(indent)) break;
        body.push(line.slice(indent.length));
      }
      step = body.join("\n");

      // A silently-empty extraction would make every assertion below pass against nothing.
      expect(step).toContain("check-signoff.sh");
      expect(step).toContain("BASE_SHA");
      expect(step).not.toContain("${{");

      // The step runs `scripts/check-signoff.sh` relative to its working directory, which on the
      // runner is the checkout root. A symlink rather than a copy, so this exercises the real file
      // and cannot drift from it.
      mkdirSync(join(repo, "scripts"));
      symlinkSync(script, join(repo, "scripts", "check-signoff.sh"));
    });

    /**
     * Runs the extracted step in the fixture repository, as CI runs it: the shas in the
     * environment, and `bash -e <file>`. That is GitHub's default shell for a `run:` step with no
     * `shell:` key of its own — not `sh -c`, and not the `-o pipefail` that an explicit
     * `shell: bash` would add. `-e` is the part that matters here: a command failing outside a
     * conditional would end the step early, which is how a `run:` block quietly stops half way.
     */
    const runStep = (base, head) => {
      const file = join(repo, "dco-step.sh");
      writeFileSync(file, step);
      // `isolatedGitEnv()` rather than `process.env` for the same reason as `git()` — this step
      // shells out to `git rev-list`, so an inherited `GIT_DIR` sends it to the caller's repository,
      // where the fixture shas do not exist and it reports "Could not enumerate" instead of what it
      // was asked about. Measured: with `GIT_DIR` set and this spread left as `process.env`, both
      // tests in this block fail that way while the rest of the suite passes.
      return spawnSync("bash", ["-e", file], {
        cwd: repo,
        encoding: "utf8",
        env: { ...isolatedGitEnv(), BASE_SHA: base, HEAD_SHA: head },
      });
    };

    it("passes a range whose every commit is signed off", () => {
      const result = runStep(sha.unsigned, sha.lowercase);
      expect(result.stdout).toContain("All commits signed off.");
      expect(result.stdout).not.toContain("::error::");
      expect(result.status).toBe(0);
    });

    it("annotates each unsigned commit and fails", () => {
      const result = runStep(sha.signed, sha["no-email"]);
      const annotations = result.stdout
        .split("\n")
        .filter((line) => line.startsWith("::error::Missing Signed-off-by: "));
      expect(annotations).toHaveLength(3); // unsigned, indented, no-email
      expect(annotations.some((line) => line.includes("unsigned"))).toBe(true);
      expect(result.stdout).toContain("Sign off with: git commit -s");
      expect(result.status).toBe(1);
    });

    it("fails with its own annotation when the range cannot be enumerated", () => {
      const result = runStep("deadbeefdeadbeefdeadbeefdeadbeefdeadbeef", sha.signed);
      expect(result.stdout).toContain("::error::Could not enumerate the pull request's commits");
      expect(result.status).toBe(1);
    });
  });

  // The regression this suite caused. `.husky/pre-push` runs it on every push, and git sets `GIT_DIR`
  // for every hook it runs; `GIT_DIR` outranks a child's `cwd`, so before `isolatedGitEnv` the
  // fixtures below were committed to the REAL repository — seven of them, pushed three times, five
  // failing the very check this script enforces.
  //
  // Asserted against a second throwaway repository rather than the developer's own, so a failure
  // reports rather than damages: the bug writes to whatever `GIT_DIR` names, so pointing it at a
  // sacrificial repo reproduces the mechanism exactly without risking the checkout the suite runs in.
  describe("isolation from the caller's repository", () => {
    it("writes to cwd even when GIT_DIR names another repository", () => {
      const bystander = mkdtempSync(join(tmpdir(), "waitron-signoff-bystander-"));
      const fixtures = mkdtempSync(join(tmpdir(), "waitron-signoff-fixtures-"));
      try {
        for (const dir of [bystander, fixtures]) {
          git(dir, "init", "-q", "-b", "main");
          git(dir, "commit", "--allow-empty", "-q", "-m", "base");
        }
        const before = git(bystander, "rev-parse", "HEAD");

        // Exactly what git does when it invokes a hook.
        process.env.GIT_DIR = join(bystander, ".git");
        try {
          git(fixtures, "commit", "--allow-empty", "-q", "-m", "written by a fixture");
        } finally {
          delete process.env.GIT_DIR;
        }

        expect(git(bystander, "rev-parse", "HEAD")).toBe(before);
        expect(git(fixtures, "log", "-1", "--format=%s")).toBe("written by a fixture");
      } finally {
        if (bystander !== undefined) rmSync(bystander, { recursive: true, force: true });
        if (fixtures !== undefined) rmSync(fixtures, { recursive: true, force: true });
      }
    });
  });
});
