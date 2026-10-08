import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";

/**
 * Contract: every `--wt-*` name a stylesheet reads with `var(…)` is declared somewhere. CSS does
 * not report an undeclared name: a property that reads one with no fallback silently takes its
 * inherited or initial value, so a label meant to be bold renders at the body weight and every
 * attribute assertion still passes; a read with a fallback gets the fallback for ever.
 *
 * Weaker than its name in five ways:
 *
 * 1. **It reads TEXT, not stylesheets.** It matches `var(--wt-…` and `--wt-…:` anywhere in a
 *    tracked `.ts`, `.css` or `.html` file under `apps/` and `packages/`, as it stands in the
 *    working tree, so one inside a comment counts as a read or a declaration. A name followed
 *    straight away by `${` is skipped, whether the interpolation builds the rest of the name
 *    (`var(--wt-font-weight-${x})`) or only its fallback
 *    (`` var(--wt-x${fb ? `, ${fb}` : ""}) ``), so an undeclared `--wt-x` read in that second shape
 *    passes. A read from script (`getPropertyValue("--wt-…")`) is not seen, and a name declared
 *    from script (`style.setProperty`, a quoted object key) is not seen as declared, so its `var()`
 *    reads fail. A backslash escape in a name is compared as spelled, not decoded, so `--wt-\36`
 *    and `--wt-6` are two names to it.
 * 2. **It compares names tree-wide, not per page.** A read is satisfied by a declaration in ANY
 *    file, including a stylesheet the page doing the reading never loads.
 * 3. **It ignores files ending `.test.ts`**, both their reads and their declarations, so a suite
 *    that declares a name for itself cannot make a production read of it pass. Test-support files
 *    not so named (`apps/dashboard/src/widgets/test-helpers.ts`,
 *    `packages/ui-core/src/a11y-helpers.ts`) ARE read, so a declaration in one can.
 * 4. **It reads only the files `git ls-files` lists**, so a new file is seen once it is added to
 *    the index, not before; what it reads is that file's working-tree copy.
 * 5. **A read with a fallback is still a read.** `var(--wt-x, 36rem)` renders the fallback for
 *    ever if `--wt-x` is declared nowhere, which is the same defect with a quieter symptom — so
 *    such a read is refused too, except for the entries in `FALLBACK_READS`.
 */

const repoRoot = join(import.meta.dirname, "..");

// A per-call kill timeout for a hung `git` (Vitest's timer cannot interrupt a blocking child), and
// a per-test bound above it for the cases that may be the first to list the tree.
const GIT_SPAWN_TIMEOUT_MS = 30_000;
const SPAWN_TEST_TIMEOUT_MS = 60_000;

// Git exports `GIT_DIR` to every hook and `.husky/pre-push` runs this suite; an inherited override
// would point `git ls-files` at another repository.
const GIT_LOCATION_OVERRIDES = [
  "GIT_DIR",
  "GIT_WORK_TREE",
  "GIT_INDEX_FILE",
  "GIT_COMMON_DIR",
  "GIT_OBJECT_DIRECTORY",
  "GIT_ALTERNATE_OBJECT_DIRECTORIES",
  "GIT_NAMESPACE",
];

function isolatedGitEnv(): NodeJS.ProcessEnv {
  const env = { ...process.env };
  for (const name of GIT_LOCATION_OVERRIDES) delete env[name];
  return env;
}

/**
 * Reads of undeclared names that carry a fallback, left as they are on purpose: the till's
 * caution and success text colours, which `docs/backlog.md`'s "Four till surfaces ask for a caution
 * colour" entry covers. Each entry is a file and a name, and holds only for a read WITH a fallback.
 * An entry that is no longer needed fails the guard; nothing stops one being added, so keeping the
 * list from growing is a job for review.
 */
const FALLBACK_READS: ReadonlyArray<{ readonly file: string; readonly name: string }> = [
  { file: "apps/till/src/screens/till-expo-screen.ts", name: "--wt-color-warning-text" },
  { file: "apps/till/src/widgets/basket.ts", name: "--wt-color-warning-text" },
  { file: "apps/till/src/widgets/diet-badges.ts", name: "--wt-color-success-text" },
  { file: "apps/till/src/widgets/diet-badges.ts", name: "--wt-color-warning-text" },
  { file: "apps/till/src/widgets/station-queue.ts", name: "--wt-color-warning-text" },
];

interface TokenRead {
  readonly name: string;
  readonly fallback: boolean;
}

// A custom property's whole identifier, so a name is never cut short at a declared prefix of it
// (`--wt-space-6Missing` is not `--wt-space-6`): ASCII letters, digits, `_` and `-`, any non-ASCII
// character except `…`, and a backslash escape, which is kept as spelled rather than decoded. At
// least one must follow `--wt-`, so prose naming the family as `--wt-…` is not a name.
const NAME = String.raw`--wt-(?:[A-Za-z0-9_-]|[^\x00-\x7F\u2026]|\\[0-9A-Fa-f]{1,6}[ \t\n\r\f]?|\\[^0-9A-Fa-f\n\r\f])+`;

function tokenReads(text: string): TokenRead[] {
  return [...text.matchAll(new RegExp(String.raw`var\(\s*(${NAME})(\$\{)?\s*(,)?`, "g"))]
    .filter((match) => match[2] === undefined)
    .map((match) => ({ name: match[1]!, fallback: match[3] !== undefined }));
}

function tokenDeclarations(text: string): string[] {
  return [...text.matchAll(new RegExp(String.raw`(${NAME})\s*:`, "g"))].map((match) => match[1]!);
}

function sourceFiles(): string[] {
  return execFileSync("git", ["ls-files", "-z", "--", "apps", "packages"], {
    cwd: repoRoot,
    encoding: "utf8",
    env: isolatedGitEnv(),
    timeout: GIT_SPAWN_TIMEOUT_MS,
    maxBuffer: 64 * 1024 * 1024,
  })
    .split("\0")
    .filter((file) => /\.(ts|css|html)$/.test(file) && !file.endsWith(".test.ts"));
}

interface Undeclared {
  readonly file: string;
  readonly name: string;
  readonly fallback: boolean;
}

function undeclaredReads(files: readonly string[]): Undeclared[] {
  const texts = files.map((file) => ({
    file,
    text: readFileSync(join(repoRoot, file), "utf8"),
  }));
  const declared = new Set(texts.flatMap(({ text }) => tokenDeclarations(text)));
  const found = new Map<string, Undeclared>();
  for (const { file, text } of texts)
    for (const read of tokenReads(text))
      if (!declared.has(read.name)) {
        const key = `${file} ${read.name} ${read.fallback}`;
        found.set(key, { file, name: read.name, fallback: read.fallback });
      }
  return [...found.values()];
}

let scanned: { readonly files: string[]; readonly undeclared: Undeclared[] } | undefined;

/** The tree is listed and read once per run, on first use, and every case shares the result. */
function scannedTree() {
  if (scanned === undefined) {
    const files = sourceFiles();
    scanned = { files, undeclared: undeclaredReads(files) };
  }
  return scanned;
}

const excused = (read: Undeclared) =>
  read.fallback &&
  FALLBACK_READS.some((entry) => entry.file === read.file && entry.name === read.name);

describe("style token names", () => {
  it("finds a read with and without a fallback, and ignores a declaration", () => {
    expect(
      tokenReads(
        "a { color: var(--wt-color-text); gap: var( --wt-space-2 , 4px); --wt-local: 1px; }",
      ),
    ).toEqual([
      { name: "--wt-color-text", fallback: false },
      { name: "--wt-space-2", fallback: true },
    ]);
  });

  it("reads the whole name, never a declared prefix of it", () => {
    expect(
      tokenReads(
        "a { font-weight: var(--wt-font-weight-bold_missing); gap: var(--wt-space-6Missing, 4px); }",
      ),
    ).toEqual([
      { name: "--wt-font-weight-bold_missing", fallback: false },
      { name: "--wt-space-6Missing", fallback: true },
    ]);
    expect(
      tokenDeclarations("a { --wt-font-weight-bold_missing: 600; --wt-space-6Missing : 4px; }"),
    ).toEqual(["--wt-font-weight-bold_missing", "--wt-space-6Missing"]);
  });

  it("keeps a non-ASCII character or a backslash escape in the name, as spelled", () => {
    expect(
      tokenReads(String.raw`a { color: var(--wt-colé); gap: var(--wt-space-\36 b); }`),
    ).toEqual([
      { name: "--wt-colé", fallback: false },
      { name: String.raw`--wt-space-\36 b`, fallback: false },
    ]);
    expect(tokenDeclarations(String.raw`a { --wt-colé: red; --wt-space-\36 b: 4px; }`)).toEqual([
      "--wt-colé",
      String.raw`--wt-space-\36 b`,
    ]);
  });

  it("does not read a token family written with an ellipsis as a name", () => {
    expect(tokenReads("// every var(--wt-…) read")).toEqual([]);
    expect(tokenDeclarations("// the --wt-…: family")).toEqual([]);
  });

  it("skips a name built in script, whether or not part of it is written out", () => {
    expect(
      tokenReads(
        "a { font-weight: var(--wt-font-weight-${weight}); color: var(--wt-${name}); gap: var(--wt-space-2); }",
      ),
    ).toEqual([{ name: "--wt-space-2", fallback: false }]);
  });

  it("finds a declaration and ignores a read", () => {
    expect(
      tokenDeclarations("a { --wt-space-1: 4px; --wt-gap : var(--wt-space-1); color: red; }"),
    ).toEqual(["--wt-space-1", "--wt-gap"]);
  });

  it(
    "finds the tokens declared in the shared stylesheets",
    () => {
      const structure = readFileSync(
        join(repoRoot, "packages/ui-core/src/tokens/structure.css"),
        "utf8",
      );
      expect(tokenDeclarations(structure)).toContain("--wt-font-weight-bold");
      const { files } = scannedTree();
      expect(files).toContain("packages/ui-core/src/tokens/structure.css");
      expect(files).not.toContain("apps/dashboard/src/screens/cloud-services-screen.test.ts");
    },
    SPAWN_TEST_TIMEOUT_MS,
  );

  it(
    "lists this repository even when the caller's environment points git elsewhere",
    () => {
      try {
        for (const name of GIT_LOCATION_OVERRIDES) vi.stubEnv(name, "/poisoned");
        expect(sourceFiles()).toContain("packages/ui-core/src/tokens/structure.css");
      } finally {
        vi.unstubAllEnvs();
      }
    },
    SPAWN_TEST_TIMEOUT_MS,
  );

  it("excuses a listed read only when it carries a fallback", () => {
    const listed = { file: "apps/till/src/widgets/basket.ts", name: "--wt-color-warning-text" };
    expect(excused({ ...listed, fallback: true })).toBe(true);
    expect(excused({ ...listed, fallback: false })).toBe(false);
    expect(excused({ ...listed, file: "apps/till/src/widgets/other.ts", fallback: true })).toBe(
      false,
    );
  });

  it(
    "every --wt-* name read is declared somewhere",
    () => {
      expect(scannedTree().undeclared.filter((read) => !excused(read))).toEqual([]);
    },
    SPAWN_TEST_TIMEOUT_MS,
  );

  it(
    "every FALLBACK_READS entry still names a read that needs it",
    () => {
      const needed = scannedTree().undeclared.filter(excused);
      for (const entry of FALLBACK_READS)
        expect(
          needed.some((read) => read.file === entry.file && read.name === entry.name),
          `${entry.file} ${entry.name}`,
        ).toBe(true);
    },
    SPAWN_TEST_TIMEOUT_MS,
  );
});
