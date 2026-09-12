import { spawnSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";

const root = join(import.meta.dirname, "..");
const zero = "0".repeat(40);

// Exercise the real shell and classifiers; pnpm records requests without launching nested suites.
function fixture(path, run, { signed = true, fail = "", emptySelection = false } = {}) {
  const dir = mkdtempSync(join(tmpdir(), "waitron-push-"));
  const env = { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_SYSTEM: "/dev/null" };
  for (const key of [
    "GIT_DIR",
    "GIT_WORK_TREE",
    "GIT_INDEX_FILE",
    "GIT_COMMON_DIR",
    "GIT_OBJECT_DIRECTORY",
    "GIT_ALTERNATE_OBJECT_DIRECTORIES",
    "GIT_NAMESPACE",
  ])
    delete env[key];
  function git(...args) {
    const result = spawnSync("git", args, { cwd: dir, env, encoding: "utf8" });
    if (result.status !== 0) throw new Error(result.stderr);
    return result.stdout.trim();
  }
  const log = join(dir, "calls.jsonl");
  try {
    for (const file of [
      ".husky/pre-push",
      "scripts/check-signoff.sh",
      "scripts/changed-packages.mjs",
      "scripts/changed-scope.mjs",
      "scripts/run-with-deadline.mjs",
    ]) {
      mkdirSync(dirname(join(dir, file)), { recursive: true });
      cpSync(join(root, file), join(dir, file));
    }
    for (const name of ["source", "consumer"]) {
      mkdirSync(join(dir, "packages", name), { recursive: true });
      writeFileSync(
        join(dir, "packages", name, "package.json"),
        JSON.stringify({
          name: `@waitron/${name}`,
          scripts: { typecheck: "tsc --noEmit", "test:coverage": "vitest" },
          ...(name === "consumer" ? { dependencies: { "@waitron/source": "workspace:*" } } : {}),
        }),
      );
    }
    mkdirSync(join(dir, "bin"));
    writeFileSync(
      join(dir, "bin", "pnpm"),
      `#!${process.execPath}
const fs = require("node:fs");
const path = require("node:path");
const args = process.argv.slice(2);
fs.appendFileSync(process.env.PUSH_LOG, JSON.stringify(args) + "\\n");
const kind = args.includes("ls") ? "ls" : args.includes("vitest") ? "root-tests" : args.at(-1);
if (process.env.PUSH_FAIL === kind) process.exit(17);
if (kind === "ls") {
  const selected = process.env.PUSH_EMPTY === "1" && args.includes("--filter") ? [] :
    ["source", "consumer"].map(name => ({ name: "@waitron/" + name, path: path.join(process.cwd(), "packages", name) }));
  console.log(JSON.stringify(selected));
}
`,
      { mode: 0o755 },
    );
    writeFileSync(log, "");
    git("init", "-q");
    git("config", "user.name", "Hook fixture");
    git("config", "user.email", "hook@example.test");
    git("config", "commit.gpgsign", "false");
    git("config", "core.hooksPath", "/dev/null");
    git("add", ".");
    git("commit", "-qs", "-m", "Fixture base");
    const base = git("rev-parse", "HEAD");
    git("update-ref", "refs/remotes/origin/main", base);
    mkdirSync(dirname(join(dir, path)), { recursive: true });
    writeFileSync(join(dir, path), "changed\n");
    git("add", path);
    git("commit", signed ? "-qs" : "-q", "-m", "Fixture change");
    const head = git("rev-parse", "HEAD");
    const ref = (local = head, remote = base) =>
      `refs/heads/feature ${local} refs/heads/feature ${remote}\n`;
    const invoke = (input = ref()) => {
      writeFileSync(log, "");
      const result = spawnSync("sh", ["-e", ".husky/pre-push"], {
        cwd: dir,
        input,
        encoding: "utf8",
        timeout: 15000,
        env: {
          ...env,
          PATH: `${join(dir, "bin")}:${env.PATH}`,
          PUSH_LOG: log,
          PUSH_FAIL: fail,
          PUSH_EMPTY: emptySelection ? "1" : "0",
        },
      });
      const calls = readFileSync(log, "utf8").trim().split("\n").filter(Boolean).map(JSON.parse);
      return { ...result, calls, checks: calls.filter((args) => !args.includes("ls")) };
    };
    run({ invoke, ref, base, head });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const cheap = [
  ["install", "--frozen-lockfile"],
  ["format:check"],
  ["lint"],
  ["vitest", "run", "--coverage"],
];

describe("pre-push fast checks", () => {
  it("runs guards and dependent typechecks, leaving package tests to CI", () => {
    fixture("packages/source/src/index.ts", ({ invoke }) => {
      const result = invoke();
      expect(result.status, result.stdout + result.stderr).toBe(0);
      expect(result.checks).toEqual([...cheap, ["--filter", "...@waitron/source", "typecheck"]]);
    });
  });
  it("uses the main merge base for a new branch", () => {
    fixture("packages/source/src/index.ts", ({ invoke, ref, head }) => {
      const result = invoke(ref(head, zero));
      expect(result.status, result.stderr).toBe(0);
      expect(result.checks).toEqual([...cheap, ["--filter", "...@waitron/source", "typecheck"]]);
    });
  });
  it("runs root guards but no package work for repository machinery", () => {
    fixture("scripts/helper.mjs", ({ invoke }) => {
      const result = invoke();
      expect(result.status, result.stderr).toBe(0);
      expect(result.checks).toEqual(cheap);
    });
  });
  it("checks the install and formatting for documentation", () => {
    fixture("docs/guide.md", ({ invoke }) => {
      const result = invoke();
      expect(result.status, result.stderr).toBe(0);
      expect(result.checks).toEqual(cheap.slice(0, 2));
    });
  });
  it("skips deletion-only pushes and still checks an update beside a deletion", () => {
    fixture("packages/source/src/index.ts", ({ invoke, ref }) => {
      const deleted = ref(zero);
      expect(invoke(deleted).calls).toEqual([]);
      expect(invoke(deleted).status).toBe(0);
      expect(invoke(deleted + ref()).checks).toEqual([
        ...cheap,
        ["--filter", "...@waitron/source", "typecheck"],
      ]);
    });
  });
  it.each(["empty", "unknown", "global"])(
    "keeps whole-workspace typechecking for %s ranges",
    (kind) => {
      fixture(
        kind === "global" ? "tsconfig.base.json" : "packages/source/src/index.ts",
        ({ invoke, ref, head }) => {
          const result = invoke(
            kind === "empty" ? "" : kind === "unknown" ? ref(head, "f".repeat(40)) : ref(),
          );
          expect(result.status, result.stdout + result.stderr).toBe(0);
          expect(result.checks).toEqual([...cheap, ["typecheck"]]);
        },
      );
    },
  );
  it("blocks unsigned commits before running pnpm", () => {
    fixture(
      "packages/source/src/index.ts",
      ({ invoke }) => {
        const result = invoke();
        expect(result.status).not.toBe(0);
        expect(result.stdout).toContain("sign-off (DCO)");
        expect(result.calls).toEqual([]);
      },
      { signed: false },
    );
  });
  it.each(["--frozen-lockfile", "format:check", "lint", "root-tests", "typecheck"])(
    "blocks a failed %s check",
    (fail) => {
      fixture(
        "packages/source/src/index.ts",
        ({ invoke }) => {
          const result = invoke();
          expect(result.status).not.toBe(0);
          expect(result.stdout).toContain("pre-push BLOCKED");
          const index = [
            "--frozen-lockfile",
            "format:check",
            "lint",
            "root-tests",
            "typecheck",
          ].indexOf(fail);
          expect(result.checks).toEqual(
            [...cheap, ["--filter", "...@waitron/source", "typecheck"]].slice(0, index + 1),
          );
        },
        { fail },
      );
    },
  );
  it("refuses an empty scoped selection before claiming typechecks passed", () => {
    fixture(
      "packages/source/src/index.ts",
      ({ invoke }) => {
        const result = invoke();
        expect(result.status).not.toBe(0);
        expect(result.stdout + result.stderr).toContain("no workspace member was selected");
        expect(result.checks).toEqual(cheap);
      },
      { emptySelection: true },
    );
  });
});
