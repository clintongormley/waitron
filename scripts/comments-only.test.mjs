import { spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
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

  // Node refuses each `head` with a SyntaxError; the `base` beside it runs.
  it.each([
    ["a rest parameter", "function f(...a) {}\n", "function f(...a,) {}\n"],
    ["an arrow's rest parameter", "const f = (...a) => a;\n", "const f = (...a,) => a;\n"],
    ["a rest element in a binding pattern", "const [...a] = [];\n", "const [...a,] = [];\n"],
    ["a rest property in a binding pattern", "const { ...a } = {};\n", "const { ...a, } = {};\n"],
    ["a spread element as an assignment target", "[...a] = [];\n", "[...a,] = [];\n"],
    ["a spread property as an assignment target", "({ ...a } = {});\n", "({ ...a, } = {});\n"],
  ])("refuses a trailing comma added after %s", (_, base, head) => {
    expect(compareSources(base, head, "rest.js")).not.toBe(null);
  });

  it("still accepts a trailing comma after a tuple type's rest, which TypeScript accepts and erases", () => {
    // Prettier writes this comma when the tuple spans lines.
    const base =
      "type T = [\n  a: string, // why\n  ...rest: string[],\n];\n" +
      "type U = [\n  ...string[], // why\n];\n";
    const head = "type T = [a: string, ...rest: string[]];\ntype U = [...string[]];\n";
    expect(compareSources(base, head, "tuple.ts")).toBe(null);
  });

  it("refuses a dropped trailing comma after a spread argument, which could be a destructuring target", () => {
    // Fails safe: `f(...a,)` is valid, but `[...a,] = x` is not, and both are a SpreadElement.
    expect(compareSources("f(\n  ...a, // why\n);\n", "f(...a);\n", "s.ts")).not.toBe(null);
  });

  it("still accepts a dropped trailing comma after an ordinary parameter or element", () => {
    expect(compareSources("function f(\n  a,\n  // b\n) {}\n", "function f(a) {}\n", "p.ts")).toBe(
      null,
    );
    expect(compareSources("const [\n  a, // first\n] = x;\n", "const [a] = x;\n", "p.ts")).toBe(
      null,
    );
  });

  it("refuses a leading space added to JSX text, which changes the string it renders", () => {
    expect(
      compareSources("const x = <div>hello</div>;\n", "const x = <div> hello</div>;\n", "j.tsx"),
    ).toEqual({ line: 1, base: "hello", head: " hello" });
  });

  it("refuses deleting a JSX comment child, whose braces are an expression container", () => {
    const base = "const x = (\n  <div>\n    {/* why */}\n    hello\n  </div>\n);\n";
    const head = "const x = (\n  <div>\n    hello\n  </div>\n);\n";
    expect(compareSources(base, head, "j.tsx")).not.toBe(null);
  });

  it("still accepts a comment edit inside a JSX expression container", () => {
    const base = "const x = <div>{/* why */ name}</div>;\n";
    const head = "const x = <div>{/* the reason */ name}</div>;\n";
    expect(compareSources(base, head, "j.tsx")).toBe(null);
  });

  const TOOL_COMMENTS = [
    ["@ts-expect-error", "// @ts-expect-error a string is not a number\n", "t.ts"],
    ["@ts-ignore", "/* @ts-ignore */\n", "t.ts"],
    // TypeScript honours it on a multi-line block comment's last line, and not on a middle one.
    ["@ts-expect-error on a block comment's last line", "/* why\n * @ts-expect-error */\n", "t.ts"],
    ["@ts-nocheck", "// @ts-nocheck\n", "t.ts"],
    ["@ts-check", "// @ts-check\n", "t.js"],
    ["eslint-disable-next-line", "// eslint-disable-next-line no-control-regex -- why\n", "t.ts"],
    ["eslint-disable block", "/* eslint-disable no-console */\n", "t.ts"],
    ["eslint config", "/* eslint no-console: off */\n", "t.ts"],
    ["global", "/* global document, customElements */\n", "t.mjs"],
    ["exported", "/* exported helper */\n", "t.js"],
    ["prettier-ignore", "// prettier-ignore\n", "t.ts"],
    ["v8 ignore start", "/* v8 ignore start -- the real process wiring */\n", "t.ts"],
    ["v8 ignore stop", "/* v8 ignore stop */\n", "t.ts"],
    ["c8 ignore", "/* c8 ignore next */\n", "t.ts"],
    ["istanbul ignore", "/* istanbul ignore next */\n", "t.ts"],
    ["node:coverage ignore", "/* node:coverage ignore next */\n", "t.mjs"],
    ["node:coverage disable", "/* node:coverage disable */\n", "t.mjs"],
    ["node:coverage enable", "/* node:coverage enable */\n", "t.mjs"],
    ["Stryker disable", "// Stryker disable next-line all\n", "t.ts"],
    ["Stryker restore", "// Stryker restore all\n", "t.ts"],
    // Split, because Vitest reads the pragma anywhere in a test file, string literals included.
    ["@vitest-environment", "/** @vitest" + "-environment jsdom */\n", "t.ts"],
    ["@jest-environment", "/**\n * @jest" + "-environment node\n */\n", "t.ts"],
    ["triple-slash reference", '/// <reference types="vite/client" />\n', "t.ts"],
    ["triple-slash amd", '/// <amd-module name="x" />\n', "t.ts"],
    ["@jsxImportSource", "/** @jsxImportSource preact */\n", "t.tsx"],
    ["@jsx", "/* @jsx h */\n", "t.tsx"],
    ["@license", "/** @license MIT */\n", "t.ts"],
    ["@preserve", "/* @preserve kept */\n", "t.ts"],
    ["legal comment", "/*! kept by bundlers */\n", "t.ts"],
    ["sourceMappingURL", "//# sourceMappingURL=t.js.map\n", "t.js"],
    ["sourceURL in its older `@` form", "//@ sourceURL=t.js\n", "t.js"],
  ];

  it.each(TOOL_COMMENTS)("refuses deleting a %s comment", (_, comment, fileName) => {
    const code = "export const a = f();\n";
    expect(compareSources(comment + code, code, fileName)).not.toBe(null);
  });

  it.each(TOOL_COMMENTS)("refuses adding a %s comment", (_, comment, fileName) => {
    const code = "export const a = f();\n";
    expect(compareSources(code, comment + code, fileName)).not.toBe(null);
  });

  it.each(TOOL_COMMENTS)(
    "still accepts a prose comment edited beside a %s comment",
    (_, comment, fileName) => {
      const base = `// the first reason\n${comment}export const a = f(); // and more\n`;
      const head = `// a better reason\n${comment}export const a = f();\n`;
      expect(compareSources(base, head, fileName)).toBe(null);
    },
  );

  it.each([
    ["an esbuild pure annotation", "const a = /*#__PURE__*/ make();\n"],
    ["a rollup pure annotation", "const a = /* @__PURE__ */ make();\n"],
    ["a no-side-effects annotation", "/* @__NO_SIDE_EFFECTS__ */ function make() {}\n"],
    ["a webpack magic comment", 'const m = import(/* webpackChunkName: "m" */ "./m.js");\n'],
    ["a vite magic comment", "const m = import(/* @vite-ignore */ path);\n"],
  ])("refuses deleting %s written inside an expression", (_, base) => {
    const head = base.replace(/\/\*.*?\*\/ /, "");
    expect(head).not.toBe(base);
    expect(compareSources(base, head, "e.ts")).not.toBe(null);
  });

  it("refuses a tool comment's text edited", () => {
    const base = "// eslint-disable-next-line no-console\nconsole.log(1);\n";
    const head = "// eslint-disable-next-line no-alert\nconsole.log(1);\n";
    expect(compareSources(base, head, "t.ts")).toEqual({
      line: 1,
      base: "// eslint-disable-next-line no-console",
      head: "// eslint-disable-next-line no-alert",
    });
  });

  it("refuses a tool comment moved to a different place among the tokens", () => {
    const base = "/* v8 ignore start */\nconst a = 1;\nconst b = 2;\n/* v8 ignore stop */\n";
    const head = "/* v8 ignore start */\nconst a = 1;\n/* v8 ignore stop */\nconst b = 2;\n";
    expect(compareSources(base, head, "t.ts")).not.toBe(null);
  });

  it("still accepts a prose comment that merely mentions a directive mid-sentence", () => {
    const base = "// the `@ts-expect-error` below is the assertion; see `v8 ignore` too\nf();\n";
    const head = "// the directive below is the assertion\nf();\n";
    expect(compareSources(base, head, "t.ts")).toBe(null);
  });

  it("refuses deleting prose that names a directive matched anywhere in a comment", () => {
    expect(
      compareSources("// see the @license tag in the header\nf();\n", "f();\n", "t.ts"),
    ).toEqual({ line: 1, base: "// see the @license tag in the header", head: "f" });
  });

  it("still accepts a line-scoped ESLint directive moved to another line without crossing a token", () => {
    const moved = ["debugger; // eslint-disable-line\n", "debugger;\n// eslint-disable-line\n"];
    const spaced = [
      "// eslint-disable-next-line\ndebugger;\n",
      "// eslint-disable-next-line\n\ndebugger;\n",
    ];
    expect(compareSources(...moved, "t.ts")).toBe(null);
    expect(compareSources(...spaced, "t.ts")).toBe(null);
  });

  it("refuses a changed shebang, which decides what runs the file", () => {
    const base = "#!/usr/bin/env node\nmain();\n";
    const head = "#!/usr/bin/env false\nmain();\n";
    expect(compareSources(base, head, "bin.mjs")).toEqual({
      line: 1,
      base: "#!/usr/bin/env node",
      head: "#!/usr/bin/env false",
    });
  });

  it("refuses a deleted shebang", () => {
    expect(compareSources("#!/usr/bin/env node\nmain();\n", "main();\n", "bin.mjs")).not.toBe(null);
  });

  it("still accepts a prose comment edited in a file with a shebang", () => {
    const base = "#!/usr/bin/env node\n// Starts the thing.\nmain();\n";
    const head = "#!/usr/bin/env node\nmain();\n";
    expect(compareSources(base, head, "bin.mjs")).toBe(null);
  });

  // Node's verdict on each `base`: a SyntaxError, where `head` runs. The parser TypeScript uses
  // builds the same tree for both, so the line break before the token has to be compared itself.
  it.each([
    ["an arrow", "const f = (a) /*\n*/ => a;\n", "const f = (a) => a;\n"],
    ["an async arrow", "const f = async (a) /*\n*/ => a;\n", "const f = async (a) => a;\n"],
    ["`await using`", "{\n  await /*\n  */ using x = y;\n}\n", "{\n  await using x = y;\n}\n"],
  ])(
    "refuses a comment edit that adds or removes the only line break inside %s",
    (_, base, head) => {
      expect(compareSources(base, head, "lb.mjs")).not.toBe(null);
      expect(compareSources(head, base, "lb.mjs")).not.toBe(null);
    },
  );

  it("refuses a line break removed before a plain `using` too, though Node accepts both", () => {
    const base = "{\n  f(); /*\n  */ using x = y;\n}\n";
    const head = "{\n  f(); using x = y;\n}\n";
    expect(compareSources(base, head, "lb.mjs")).not.toBe(null);
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
    write("src/bin.mjs", "#!/usr/bin/env node\nmain();\n");
    chmodSync(join(repo, "src/bin.mjs"), 0o755);
    for (const path of ["README.md", "package.json", "db/0001.sql", "deploy/run.sh"]) {
      write(path, "original\n");
    }
    commit("base");
  });

  afterEach(() => {
    // Guarded: a `mkdtempSync` that threw leaves `repo` undefined (CLAUDE.md §4).
    if (repo !== undefined) rmSync(repo, { recursive: true, force: true });
  });

  it("passes a comment-only change and lists the code files it compared", () => {
    write("src/a.ts", "export const a = 1;\n");
    commit("prune");
    expect(check("main~1")).toEqual({ checked: ["src/a.ts"], skipped: [], failures: [] });
  });

  it.each(["package.json", "db/0001.sql", "deploy/run.sh"])(
    "refuses a changed %s, which is not a code file",
    (path) => {
      write("src/a.ts", "export const a = 1;\n");
      write(path, "changed\n");
      commit("prune and more");
      expect(check("main~1").failures).toEqual([
        { file: path, reason: "not a code file, so not compared" },
      ]);
    },
  );

  it("lists a changed Markdown file as not compared and still compares the code files", () => {
    write("README.md", "# changed\n");
    write("src/a.ts", "export const a = 1;\n");
    commit("prune and record it");
    expect(check("main~1")).toEqual({
      checked: ["src/a.ts"],
      skipped: ["README.md"],
      failures: [],
    });
  });

  it("lists an added or deleted Markdown file as not compared too", () => {
    git("rm", "-q", "README.md");
    write("docs/new.md", "new\n");
    commit("docs moved");
    expect(check("main~1")).toEqual({
      checked: [],
      skipped: ["README.md", "docs/new.md"],
      failures: [],
    });
  });

  it("refuses a code change in a file after a changed Markdown file", () => {
    write("README.md", "# changed\n");
    write("src/a.ts", "// a\nexport const a = 5;\n");
    commit("docs and code");
    expect(check("main~1")).toEqual({
      checked: ["src/a.ts"],
      skipped: ["README.md"],
      failures: [{ file: "src/a.ts", reason: 'line 2: code changed from "1" to "5"' }],
    });
  });

  it("keeps checking after a refused file and names every refused file", () => {
    write("package.json", "changed\n");
    write("src/a.ts", "export const a = 1;\n");
    write("src/b.mjs", "// b\nexport const b = 3;\n");
    commit("several");
    expect(check("main~1")).toEqual({
      checked: ["src/a.ts", "src/b.mjs"],
      skipped: [],
      failures: [
        { file: "package.json", reason: "not a code file, so not compared" },
        { file: "src/b.mjs", reason: 'line 2: code changed from "2" to "3"' },
      ],
    });
  });

  it("refuses a code file whose executable bit was removed", () => {
    chmodSync(join(repo, "src/bin.mjs"), 0o644);
    commit("chmod");
    expect(check("main~1").failures).toEqual([
      { file: "src/bin.mjs", reason: "mode changed 100755 → 100644" },
    ]);
  });

  it("refuses a code file replaced by a symlink whose target text parses the same", () => {
    // Git stores a link's target as its text, so `a//x` reads as `a` and then a comment.
    write("src/link.ts", "a//y");
    commit("a file");
    rmSync(join(repo, "src/link.ts"));
    symlinkSync("a//x", join(repo, "src/link.ts"));
    commit("a symlink");
    expect(check("main~1").failures).toEqual([
      { file: "src/link.ts", reason: "file type changed" },
    ]);
  });

  it("refuses a symlink whose target changed, since only a regular file is compared", () => {
    symlinkSync("a//x", join(repo, "src/link.ts"));
    commit("a symlink");
    rmSync(join(repo, "src/link.ts"));
    symlinkSync("a//y", join(repo, "src/link.ts"));
    commit("retarget");
    expect(check("main~1").failures).toEqual([
      { file: "src/link.ts", reason: "not a regular file (mode 120000)" },
    ]);
  });

  it("names the changed file whose code differs", () => {
    write("src/a.ts", "export const a = 1;\n");
    write("src/b.mjs", "// b\nexport const b = 3;\n");
    commit("prune and edit");
    expect(check("main~1")).toEqual({
      checked: ["src/a.ts", "src/b.mjs"],
      skipped: [],
      failures: [{ file: "src/b.mjs", reason: 'line 2: code changed from "2" to "3"' }],
    });
  });

  it("reports a code difference in every file, not only the first", () => {
    write("src/a.ts", "// a\nexport const a = 5;\n");
    write("src/b.mjs", "// b\nexport const b = 3;\n");
    commit("two edits");
    expect(check("main~1").failures).toEqual([
      { file: "src/a.ts", reason: 'line 2: code changed from "1" to "5"' },
      { file: "src/b.mjs", reason: 'line 2: code changed from "2" to "3"' },
    ]);
  });

  it("refuses an added code file", () => {
    write("src/c.ts", "export const c = 1;\n");
    commit("add");
    expect(check("main~1").failures).toEqual([{ file: "src/c.ts", reason: "file added" }]);
  });

  it("refuses a deleted code file", () => {
    git("rm", "-q", "src/b.mjs");
    commit("delete");
    expect(check("main~1").failures).toEqual([{ file: "src/b.mjs", reason: "file deleted" }]);
  });

  it("refuses a renamed file as a deletion and an addition", () => {
    git("mv", "src/b.mjs", "src/renamed.mjs");
    commit("rename");
    expect(check("main~1").failures).toEqual([
      { file: "src/b.mjs", reason: "file deleted" },
      { file: "src/renamed.mjs", reason: "file added" },
    ]);
  });

  it("compares from where the branch left the base, so the base's own later code changes do not count", () => {
    git("checkout", "-q", "-b", "prune");
    write("src/a.ts", "export const a = 1;\n");
    commit("prune");
    git("checkout", "-q", "main");
    write("src/b.mjs", "// b\nexport const b = 99;\n");
    commit("main moves on");
    git("checkout", "-q", "prune");
    expect(check("main")).toEqual({ checked: ["src/a.ts"], skipped: [], failures: [] });
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

    it("exits 0, naming each file it compared and how many", () => {
      write("src/a.ts", "export const a = 1;\n");
      commit("prune");
      expect(run(["main~1"])).toEqual({
        code: 0,
        out: [
          "comments-only: src/a.ts: compared",
          "comments-only: 1 code file compared; only comments changed in it",
        ],
        err: [],
      });
    });

    it("counts several compared files in the plural", () => {
      write("src/a.ts", "export const a = 1;\n");
      write("src/b.mjs", "export const b = 2;\n");
      commit("prune");
      expect(run(["main~1"]).out).toEqual([
        "comments-only: src/a.ts: compared",
        "comments-only: src/b.mjs: compared",
        "comments-only: 2 code files compared; only comments changed in them",
      ]);
    });

    it("exits 0 naming a Markdown file it did not compare beside the code it did", () => {
      write("README.md", "# changed\n");
      write("src/a.ts", "export const a = 1;\n");
      commit("prune and record it");
      expect(run(["main~1"])).toEqual({
        code: 0,
        out: [
          "comments-only: src/a.ts: compared",
          "comments-only: README.md: Markdown, so not compared",
          "comments-only: 1 code file compared; only comments changed in it",
        ],
        err: [],
      });
    });

    it("says it compared nothing when only Markdown changed", () => {
      write("README.md", "# changed\n");
      commit("docs");
      expect(run(["main~1"])).toEqual({
        code: 0,
        out: [
          "comments-only: README.md: Markdown, so not compared",
          "comments-only: no code file changed, so nothing was compared",
        ],
        err: [],
      });
    });

    it("exits 0 and says so when nothing changed at all", () => {
      git("commit", "-q", "--allow-empty", "-m", "nothing");
      expect(run(["main~1"])).toEqual({
        code: 0,
        out: ["comments-only: no files changed"],
        err: [],
      });
    });

    it("exits 1 naming a changed file that is not code", () => {
      write("package.json", "changed\n");
      commit("config");
      expect(run(["main~1"])).toEqual({
        code: 1,
        out: [],
        err: ["comments-only: package.json: not a code file, so not compared"],
      });
    });

    it("exits 1 naming the file and line", () => {
      write("src/a.ts", "// a\nexport const a = 5;\n");
      commit("edit");
      expect(run(["main~1"])).toEqual({
        code: 1,
        out: ["comments-only: src/a.ts: compared"],
        err: ['comments-only: src/a.ts: line 2: code changed from "1" to "5"'],
      });
    });

    it("exits 1 naming every refused file", () => {
      write("package.json", "changed\n");
      write("src/a.ts", "// a\nexport const a = 5;\n");
      commit("config and code");
      expect(run(["main~1"])).toEqual({
        code: 1,
        out: ["comments-only: src/a.ts: compared"],
        err: [
          "comments-only: package.json: not a code file, so not compared",
          'comments-only: src/a.ts: line 2: code changed from "1" to "5"',
        ],
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
