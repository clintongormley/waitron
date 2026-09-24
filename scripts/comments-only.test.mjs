import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { checkCommentsOnly, compareSources, main } from "./comments-only.mjs";

const SCRIPT = join(import.meta.dirname, "comments-only.mjs");

// Git sets GIT_DIR for every hook it runs, and it outranks `cwd`: without dropping these a fixture
// commit made under the pre-push hook lands in the real repository (scripts/check-signoff.test.mjs).
const GIT_LOCATION_OVERRIDES = [
  "GIT_DIR",
  "GIT_WORK_TREE",
  "GIT_INDEX_FILE",
  "GIT_COMMON_DIR",
  "GIT_OBJECT_DIRECTORY",
  "GIT_ALTERNATE_OBJECT_DIRECTORIES",
  "GIT_NAMESPACE",
];

function isolatedGitEnv() {
  const env = { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_SYSTEM: "/dev/null" };
  for (const name of GIT_LOCATION_OVERRIDES) delete env[name];
  return env;
}

describe("compareSources", () => {
  it("accepts a reworded line comment", () => {
    expect(compareSources("const a = 1; // one\n", "const a = 1; // the first\n", "a.ts")).toBe(
      null,
    );
  });

  it("accepts deleted block and doc comments", () => {
    const base = "/** Adds. */\nexport function add(a, b) {\n  /* sum */\n  return a + b;\n}\n";
    const head = "export function add(a, b) {\n  return a + b;\n}\n";
    expect(compareSources(base, head, "add.ts")).toBe(null);
  });

  it("accepts the trailing comma prettier drops when a deleted comment lets a call fit one line", () => {
    const base = "call(\n  first,\n  // why second\n  second,\n);\n";
    const head = "call(first, second);\n";
    expect(compareSources(base, head, "call.mjs")).toBe(null);
  });

  it("refuses a one-character code edit hidden beside a comment edit, naming the line", () => {
    const base = "const a = 1;\nconst b = 1; // one\n";
    const head = "const a = 1;\nconst b = 2; // uno\n";
    expect(compareSources(base, head, "b.ts")).toEqual({ line: 2, base: "1", head: "2" });
  });

  it("refuses a changed string literal", () => {
    expect(compareSources('log("a");\n', 'log("b");\n', "s.js")).toEqual({
      line: 1,
      base: '"a"',
      head: '"b"',
    });
  });

  it("refuses code commented out", () => {
    expect(compareSources("start();\nstop();\n", "start();\n// stop();\n", "c.ts")).not.toBe(null);
  });

  it("refuses an edit after `//` inside a template literal, which is text, not a comment", () => {
    const base = "const url = `${host}//path/${first}`;\n";
    const head = "const url = `${host}//path/${second}`;\n";
    expect(compareSources(base, head, "t.ts")).toEqual({ line: 1, base: "first", head: "second" });
  });

  it("refuses an edit after `/*` inside a regular expression, which is not a comment either", () => {
    const base = "const re = /[/*]/;\nconst n = 1;\n";
    const head = "const re = /[/*]/;\nconst n = 2;\n";
    expect(compareSources(base, head, "r.mjs")).toEqual({ line: 2, base: "1", head: "2" });
  });

  it("refuses deleting a comment whose line break made `return` return nothing", () => {
    const base = "function f(x) {\n  return /*\n  */ x;\n}\n";
    const head = "function f(x) {\n  return x;\n}\n";
    expect(compareSources(base, head, "asi.js")).not.toBe(null);
  });

  it("refuses a statement appended at the end of the file", () => {
    // The base's statement list closes where the head's carries on.
    expect(compareSources("start();\n", "start();\nstop();\n", "end.ts")).toEqual({
      line: 2,
      base: ")",
      head: "(ExpressionStatement",
    });
  });

  it("refuses the last statement deleted", () => {
    // Located where the head's statement list closes: the end of its last line.
    expect(compareSources("start();\nstop();\n", "start();\n", "end.ts")).toEqual({
      line: 1,
      base: "(ExpressionStatement",
      head: ")",
    });
  });

  it("refuses an array hole, which is not a trailing comma", () => {
    expect(compareSources("const a = [x,];\n", "const a = [x,,];\n", "h.ts")).not.toBe(null);
  });
});

describe("checkCommentsOnly against a git repository", () => {
  let repo;

  const git = (...args) => {
    const result = spawnSync("git", args, { cwd: repo, encoding: "utf8", env: isolatedGitEnv() });
    if (result.status !== 0) throw new Error(`git ${args.join(" ")}: ${result.stderr}`);
    return result.stdout.trim();
  };
  const write = (path, text) => {
    mkdirSync(dirname(join(repo, path)), { recursive: true });
    writeFileSync(join(repo, path), text);
  };
  const commit = (message) => {
    git("add", "-A");
    git("commit", "-q", "-m", message);
    return git("rev-parse", "HEAD");
  };
  const check = (base) => checkCommentsOnly(base, { cwd: repo, env: isolatedGitEnv() });

  beforeEach(() => {
    repo = mkdtempSync(join(tmpdir(), "waitron-comments-only-"));
    git("init", "-q", "-b", "main");
    git("config", "user.name", "Fixture Author");
    git("config", "user.email", "fixture@example.com");
    write("src/a.ts", "// a\nexport const a = 1;\n");
    write("src/b.mjs", "// b\nexport const b = 2;\n");
    write("README.md", "# readme\n");
    commit("base");
  });

  afterEach(() => {
    // Guarded: a `mkdtempSync` that threw leaves `repo` undefined (CLAUDE.md §4).
    if (repo !== undefined) rmSync(repo, { recursive: true, force: true });
  });

  it("passes a comment-only change and lists the code files it compared, not other files", () => {
    write("src/a.ts", "export const a = 1;\n");
    write("README.md", "# changed readme\n");
    commit("prune");
    expect(check("main~1")).toEqual({ checked: ["src/a.ts"], failure: null });
  });

  it("names the first changed file whose code differs", () => {
    write("src/a.ts", "export const a = 1;\n");
    write("src/b.mjs", "// b\nexport const b = 3;\n");
    commit("prune and edit");
    expect(check("main~1")).toEqual({
      checked: ["src/a.ts", "src/b.mjs"],
      failure: { file: "src/b.mjs", reason: 'line 2: code changed from "2" to "3"' },
    });
  });

  it("refuses an added code file", () => {
    write("src/c.ts", "export const c = 1;\n");
    commit("add");
    expect(check("main~1").failure).toEqual({ file: "src/c.ts", reason: "file added" });
  });

  it("refuses a deleted code file", () => {
    git("rm", "-q", "src/b.mjs");
    commit("delete");
    expect(check("main~1").failure).toEqual({ file: "src/b.mjs", reason: "file deleted" });
  });

  it("refuses a renamed file as a deletion and an addition", () => {
    git("mv", "src/b.mjs", "src/renamed.mjs");
    commit("rename");
    expect(check("main~1").failure).toEqual({ file: "src/b.mjs", reason: "file deleted" });
  });

  it("compares from where the branch left the base, so the base's own later code changes do not count", () => {
    git("checkout", "-q", "-b", "prune");
    write("src/a.ts", "export const a = 1;\n");
    commit("prune");
    git("checkout", "-q", "main");
    write("src/b.mjs", "// b\nexport const b = 99;\n");
    commit("main moves on");
    git("checkout", "-q", "prune");
    expect(check("main")).toEqual({ checked: ["src/a.ts"], failure: null });
  });

  it("throws on a base git cannot resolve", () => {
    expect(() => check("no-such-ref")).toThrow(/no-such-ref/);
  });

  describe("main", () => {
    const run = (argv) => {
      const out = [];
      const err = [];
      const code = main(argv, {
        cwd: repo,
        env: isolatedGitEnv(),
        stdout: (line) => out.push(line),
        stderr: (line) => err.push(line),
      });
      return { code, out, err };
    };

    it("exits 0 and states how many files it compared", () => {
      write("src/a.ts", "export const a = 1;\n");
      commit("prune");
      expect(run(["main~1"])).toEqual({
        code: 0,
        out: ["comments-only: 1 code file compared; no code changed"],
        err: [],
      });
    });

    it("exits 0 and says so when no code file changed at all", () => {
      write("README.md", "# changed\n");
      commit("docs");
      expect(run(["main~1"])).toEqual({
        code: 0,
        out: ["comments-only: 0 code files compared; no code changed"],
        err: [],
      });
    });

    it("exits 1 naming the file and line", () => {
      write("src/a.ts", "// a\nexport const a = 5;\n");
      commit("edit");
      expect(run(["main~1"])).toEqual({
        code: 1,
        out: [],
        err: ['comments-only: src/a.ts: line 2: code changed from "1" to "5"'],
      });
    });

    it("exits 2 with usage when the base is missing", () => {
      const { code, err } = run([]);
      expect(code).toBe(2);
      expect(err).toEqual(["usage: node scripts/comments-only.mjs <base>"]);
    });

    it("exits 2 when the base cannot be resolved", () => {
      const { code, err } = run(["no-such-ref"]);
      expect(code).toBe(2);
      expect(err[0]).toMatch(/^comments-only: .*no-such-ref/);
    });
  });

  it("runs as a command", () => {
    write("src/a.ts", "// a\nexport const a = 5;\n");
    commit("edit");
    const result = spawnSync("node", [SCRIPT, "main~1"], {
      cwd: repo,
      encoding: "utf8",
      env: isolatedGitEnv(),
    });
    expect(result.status).toBe(1);
    expect(result.stderr).toBe('comments-only: src/a.ts: line 2: code changed from "1" to "5"\n');
  });
});
