import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

// Vitest's per-test timeout when a suite sets none.
//
// WHAT GOES WRONG WITHOUT A RAISED BOUND, stated as the experiment shows it rather than as it is
// easy to assume: Vitest does NOT interrupt a blocking `spawnSync`, and it does not shorten the
// `timeout` handed to it. A child given a 9s spawn timeout under the 5s default is still killed at
// 9s, with `status: null`, `signal: "SIGTERM"` and `error.code: "ETIMEDOUT"` — measured 2026-09-18.
// What breaks is the HEALTHY case: a run that legitimately needs longer than the per-test bound
// completes normally and Vitest fails it anyway, reporting `Test timed out in 5000ms`.
//
// So what a suite's bound has to clear is the longest a HEALTHY TEST can take: the SUM of every wait
// it performs, plus whatever untimed work sits between them. The largest single wait is only one
// term of that sum. This guard checks the bound against that one term, which is NECESSARY and NOT
// SUFFICIENT — a test that waits twice can outlast a bound set above either wait alone (measured:
// two healthy 4s waits, each inside its own 6s spawn timeout, failed against a 7s bound). Setting a
// suite's bound is still a judgement about that suite; this only catches the bounds that cannot
// possibly be right.
const VITEST_DEFAULT_TEST_TIMEOUT_MS = 5000;

const SCRIPTS = import.meta.dirname;

/**
 * Line and block comments blanked, so commented-out code cannot satisfy a check.
 *
 * Scanned rather than regexed because a `//` inside a string (`it("strips // comments", …)`) would
 * otherwise delete the rest of the line, losing a real bound and accusing a correct file. Strings,
 * template literals and regex literals are stepped over. A `/` is read as starting a regex only
 * where a value cannot already have ended, which is the usual heuristic and is not exact.
 */
function withoutComments(source: string) {
  let out = "";
  let quote = "";
  let previous = "";
  for (let i = 0; i < source.length; i += 1) {
    const char = source[i];
    const next = source[i + 1];
    if (quote !== "") {
      out += char;
      if (char === "\\") {
        out += next ?? "";
        i += 1;
      } else if (char === quote) quote = "";
      continue;
    }
    if (char === '"' || char === "'" || char === "`") {
      quote = char;
      out += char;
      previous = char;
      continue;
    }
    if (char === "/" && next === "/") {
      while (i < source.length && source[i] !== "\n") i += 1;
      out += "\n";
      continue;
    }
    if (char === "/" && next === "*") {
      const end = source.indexOf("*/", i + 2);
      i = end === -1 ? source.length : end + 1;
      out += " ";
      continue;
    }
    if (char === "/" && "(,=:[!&|?{};+".includes(previous)) {
      // A regex literal: copy it whole so a quote or `//` inside it cannot derail the scan.
      let j = i + 1;
      while (j < source.length && source[j] !== "\n") {
        if (source[j] === "\\") j += 2;
        else if (source[j] === "/") break;
        else j += 1;
      }
      out += source.slice(i, j + 1);
      i = j;
      previous = "/";
      continue;
    }
    out += char;
    if (char.trim() !== "") previous = char;
  }
  return out;
}

/** `const NAME = <number>;` declarations, so a timeout written as a constant resolves. */
function constants(source: string) {
  const found = new Map<string, number>();
  const declaration = /const\s+(\w+)\s*(?::[^=;]+)?=\s*(\d[\d_]*)\s*;/g;
  for (const [, name, value] of source.matchAll(declaration)) {
    found.set(name, Number(value.replaceAll("_", "")));
  }
  return found;
}

/** A number, a known constant, or a sum of those. Anything else is unresolvable — and invisible. */
function resolve(expression: string, consts: Map<string, number>) {
  const terms = expression.trim().split("+");
  let total = 0;
  for (const term of terms.map((part) => part.trim())) {
    if (term === "") return undefined;
    const value = /^\d[\d_]*$/.test(term) ? Number(term.replaceAll("_", "")) : consts.get(term);
    if (value === undefined) return undefined;
    total += value;
  }
  return total;
}

/**
 * The top-level arguments of the call whose `(` is at `open`, split on commas that are not nested
 * inside brackets or a string. Written out rather than regexed because the argument this guard
 * wants is the THIRD one of `it(name, fn, ms)`, and a test body contains both commas and braces.
 */
function callArguments(source: string, open: number) {
  const args: string[] = [];
  let depth = 0;
  let start = open + 1;
  let quote = "";
  for (let i = open; i < source.length; i += 1) {
    const char = source[i];
    if (quote !== "") {
      if (char === "\\") i += 1;
      else if (char === quote) quote = "";
      continue;
    }
    if (char === '"' || char === "'" || char === "`") quote = char;
    else if ("([{".includes(char)) depth += 1;
    else if (")]}".includes(char)) {
      depth -= 1;
      if (depth === 0) {
        args.push(source.slice(start, i));
        return args;
      }
    } else if (char === "," && depth === 1) {
      args.push(source.slice(start, i));
      start = i + 1;
    }
  }
  return args;
}

/**
 * The two numbers that decide whether a suite can use the timeout it declares:
 *
 *   declared — the largest `timeout:` option in the file. Every wait a test performs counts, not
 *              only `spawnSync`'s: `expect.poll` and `vi.waitFor` take the same option and are
 *              bounded by the same per-test clock.
 *   bound    — the largest per-test timeout the file sets, file-wide via `vi.setConfig` or on one
 *              case via `it(name, fn, ms)`. Zero when it sets none.
 *
 * WEAKER THAN ITS NAME, in ways a reader would otherwise assume away:
 *
 *  1. It compares the bound against the LARGEST SINGLE wait, never the sum. See the note at the top
 *     of this file: passing here does not mean a suite's bound is big enough.
 *  2. It reads TEXT, and does not know code from strings. A timeout from an environment variable,
 *     imported, or computed in a helper resolves to nothing; a number inside a FIXTURE STRING counts
 *     as though it were code. This file is its own example — `budgets()` run over it reports numbers
 *     that come from the fixture sources below, and this suite performs no wait at all.
 *  3. It is per FILE, not per test. It takes the LARGEST bound anywhere in the file, so a suite that
 *     raises the bound on its slow cases and waits a long time in an untouched one still passes.
 *  4. A bound it cannot evaluate makes it DECLINE to judge the file rather than accuse it, because a
 *     false accusation stops every push. So an unreadable bound is a hole, deliberately.
 *  5. It reads only `scripts/`. A package suite's bound can come from its package's
 *     `vitest.config.ts`, which this never opens — and 22 of the 48 configs under `packages/` and
 *     `apps/` set no `testTimeout` at all (counted 2026-09-18), so that is a real gap and not a
 *     reasoned exemption.
 */
export function budgets(rawSource: string) {
  const source = withoutComments(rawSource);
  const consts = constants(source);
  const resolved = (expression: string) => resolve(expression, consts);

  const declared = [...source.matchAll(/(?<![\w$])timeout:\s*([^,}\n)]+)/g)]
    .map(([, expression]) => resolved(expression))
    .filter((value) => value !== undefined);

  const bounds: number[] = [];
  // A bound this reader cannot evaluate — `30 * SECONDS`, an imported constant — is NOT zero. The
  // file may be perfectly correct, and accusing it would fail a gate every push runs. Record that
  // the file is unreadable instead, and decline to judge it.
  let unreadable = false;
  for (const match of source.matchAll(/setConfig\s*\(/g)) {
    const [object = ""] = callArguments(source, match.index + match[0].length - 1);
    const property = object.match(/(?<![\w$])testTimeout:\s*([^,}\n]+)/);
    if (property === null) continue;
    const value = resolved(property[1]);
    if (value === undefined) unreadable = true;
    else bounds.push(value);
  }
  // `it`, `test` and their chained forms (`it.each(…)`, `it.skipIf(…)`, `test.only`), whose third
  // argument is the per-case timeout. Anchored on the test call itself, so an unrelated callback
  // that happens to take a number after a function cannot be mistaken for one.
  for (const match of source.matchAll(/(?<![\w$.])(?:it|test)(?:\.\w+(?:\([^)]*\))?)*\s*\(/g)) {
    const [, , third] = callArguments(source, match.index + match[0].length - 1);
    if (third === undefined || third.trim() === "") continue;
    const value = resolved(third);
    if (value === undefined) unreadable = true;
    else bounds.push(value);
  }

  // The safety net, and the reason this guard can be trusted in a gate. Everything above extracts a
  // NUMBER, and every extraction can fail silently on JavaScript it does not model — a regex literal
  // in a test body, a tagged-template `it.each`, a form nobody has thought of. A silent failure
  // reads as "no bound", which would fail a correct file on every push. So look, crudely and
  // separately, for any SIGN that a bound is there: the word `testTimeout`, or a number passed after
  // a callback. If a sign is present and precise extraction found nothing, say so and decline.
  const signOfBound =
    /(?<![\w$])testTimeout\s*:/.test(source) || /\}\s*,\s*[\d_]+\s*\)/.test(source);
  if (signOfBound && bounds.length === 0) unreadable = true;

  return { declared: Math.max(0, ...declared), bound: Math.max(0, ...bounds), unreadable };
}

/** Every suite the root Vitest project collects — which includes nested directories. */
function suitesUnder(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    // A failing browser run leaves a screenshot DIRECTORY named `*.test.ts`; reading one throws
    // EISDIR and this guard would look broken rather than report a finding (CLAUDE.md §4).
    if (entry.isDirectory()) return entry.name === "node_modules" ? [] : suitesUnder(path);
    return entry.isFile() && /\.test\.(mjs|ts)$/.test(entry.name) ? [path] : [];
  });
}

const suites = suitesUnder(SCRIPTS).map((path) => relative(SCRIPTS, path));

/** A readable verdict, for the detector cases below. */
const u = (declared: number, bound: number) => ({ declared, bound, unreadable: false });

describe("the root guard suites", () => {
  it("finds them, and finds one that declares a long timeout", () => {
    expect(suites.length).toBeGreaterThan(20);
    // Non-vacuity: if the `timeout:` reader stopped matching, every case below would return early
    // and this suite would pass green having checked nothing.
    const longest = suites.map(
      (name) => budgets(readFileSync(join(SCRIPTS, name), "utf8")).declared,
    );
    expect(Math.max(...longest)).toBeGreaterThanOrEqual(VITEST_DEFAULT_TEST_TIMEOUT_MS);
  });

  it.each(suites)("%s can use the timeout it declares", (name) => {
    const { declared, bound, unreadable } = budgets(readFileSync(join(SCRIPTS, name), "utf8"));
    if (declared < VITEST_DEFAULT_TEST_TIMEOUT_MS) return;
    // Weakness 4: a bound written in a form this reader cannot evaluate is not a missing bound.
    if (unreadable) return;
    const effective = bound === 0 ? VITEST_DEFAULT_TEST_TIMEOUT_MS : bound;
    expect(
      effective,
      `${name} waits up to ${declared}ms, but the largest per-test bound in the file is ` +
        `${effective}ms${bound === 0 ? " (Vitest's default — the file sets none)" : ""}. A run ` +
        `that legitimately takes longer than that is failed although it completed normally. Raise ` +
        `the bound above ${declared}ms — file-wide with vi.setConfig({ testTimeout }), or on the ` +
        `waiting case with it(name, fn, ms).`,
    ).toBeGreaterThan(declared);
  });
});

// The detector itself. Every scanner under `scripts/` carries these; without them a broken pattern
// leaves the suite green, because a guard that matches nothing accuses nobody. Each case below was
// taken from what the reader ACTUALLY returns, so the blind spots are recorded rather than wished
// away — the ones marked BLIND are the cost of reading text, and the ones marked DECLINES are the
// safety net choosing silence over a false accusation that would stop every push.
describe("the detector itself", () => {
  const reads: [string, string, ReturnType<typeof budgets>][] = [
    ["a plain number", `spawnSync(x, { timeout: 20000 });`, u(20000, 0)],
    [
      "a constant and a sum",
      `const RUN = 20_000;\nspawnSync(x, { timeout: RUN });\nvi.setConfig({ testTimeout: RUN + 10_000 });`,
      u(20000, 30000),
    ],
    [
      "a constant carrying a type annotation",
      `const RUN: number = 20_000;\nspawnSync(x, { timeout: RUN });\nvi.setConfig({ testTimeout: RUN + 10_000 });`,
      u(20000, 30000),
    ],
    [
      "another setting listed before testTimeout",
      `vi.setConfig({ hookTimeout: 7000, testTimeout: 9000 });`,
      u(0, 9000),
    ],
    ["a per-case bound on one line", `it("name", () => { go(); }, 9000);`, u(0, 9000)],
    ["a per-case bound spanning lines", `it("name", () => {\n  go();\n}, 9000);`, u(0, 9000)],
    [
      "a per-case bound on it.each",
      `it.each(rows)("%s", (row) => { go(row); }, 9000);`,
      u(0, 9000),
    ],
    [
      "a test name containing a comma and a brace",
      `it("a, b { c", () => { go(); }, 9000);`,
      u(0, 9000),
    ],
    [
      "a test name containing a comment marker",
      `it("strips // comments", () => { go(); }, 9000);\nspawnSync(x, { timeout: 6000 });`,
      u(6000, 9000),
    ],
    [
      "division, which is not the start of a regex",
      `const r = a / b;\nvi.setConfig({ testTimeout: 30000 });\nspawnSync(x, { timeout: 6000 });`,
      u(6000, 30000),
    ],
  ];
  it.each(reads)("reads %s", (_label, source, expected) => {
    expect(budgets(source)).toEqual(expected);
  });

  const accuses: [string, string, ReturnType<typeof budgets>][] = [
    [
      "a commented-out bound does not count",
      `// vi.setConfig({ testTimeout: 30000 });\nspawnSync(x, { timeout: 20000 });`,
      u(20000, 0),
    ],
    [
      "a bound inside a block comment does not count",
      `/* vi.setConfig({ testTimeout: 30000 }); */\nspawnSync(x, { timeout: 20000 });`,
      u(20000, 0),
    ],
    [
      "a property merely ending in `timeout` is not a wait",
      `const c = { query_timeout: 9000, statement_timeout: 9000 };`,
      u(0, 0),
    ],
    [
      "a wait it cannot evaluate is invisible, as weakness 2 says",
      `spawnSync(x, { timeout: Number(process.env.T) });`,
      u(0, 0),
    ],
  ];
  it.each(accuses)("%s", (_label, source, expected) => {
    expect(budgets(source)).toEqual(expected);
  });

  // Weakness 4 in practice. Each of these is a correct file the precise readers cannot evaluate; a
  // guard that accused them would fail a push over its own parser.
  const declines: [string, string][] = [
    [
      "a bound written as an expression",
      `spawnSync(x, { timeout: 20000 });\nvi.setConfig({ testTimeout: 30 * SECONDS });`,
    ],
    [
      "a per-case bound past a regex literal in the body",
      `it("n", () => { expect(s).toMatch(/won't/); }, 9000);\nspawnSync(x, { timeout: 6000 });`,
    ],
    [
      "a per-case bound on a template-table it.each",
      'it.each`\n  a\n  ${1}\n`("n", () => { go(); }, 9000);\nspawnSync(x, { timeout: 6000 });',
    ],
    [
      "a number after any other callback, which it cannot tell from a per-case bound",
      `register("name", () => {\n  go();\n}, 30000);\nspawnSync(x, { timeout: 20000 });`,
    ],
  ];
  it.each(declines)("declines to judge %s", (_label, source) => {
    const { unreadable, bound } = budgets(source);
    expect(bound).toBe(0);
    expect(unreadable).toBe(true);
  });

  it("is BLIND to a test call written inside a fixture string, and says so", () => {
    // Weakness 2. `scripts/waitron-sh.test.mjs` builds shell stubs out of template literals, so this
    // is not hypothetical — a number in such a string is read as though it were code.
    const source = 'const stub = `it("x", f, 90000)`;\nspawnSync(x, { timeout: 20000 });';
    expect(budgets(source).bound).toBe(90000);
  });

  it("accuses a file that waits long and raises nothing, and clears it once it does", () => {
    const unguarded = `const RUN = 20_000;\nspawnSync(x, { timeout: RUN });`;
    expect(budgets(unguarded)).toEqual(u(20000, 0));
    const guarded = `${unguarded}\nvi.setConfig({ testTimeout: RUN + 10_000 });`;
    expect(budgets(guarded).bound).toBeGreaterThan(budgets(guarded).declared);
  });

  it("is bounded at Vitest's default, not near it", () => {
    expect(budgets(`spawnSync(x, { timeout: 4999 });`).declared).toBeLessThan(
      VITEST_DEFAULT_TEST_TIMEOUT_MS,
    );
    expect(budgets(`spawnSync(x, { timeout: 5000 });`).declared).toBeGreaterThanOrEqual(
      VITEST_DEFAULT_TEST_TIMEOUT_MS,
    );
  });

  it("collects a nested suite, and steps over a directory named like one", () => {
    const fixture = mkdtempSync(join(tmpdir(), "spawn-budget-"));
    try {
      mkdirSync(join(fixture, "nested"), { recursive: true });
      // The root project's include is `scripts/**/*.test.mjs` AND `scripts/**/*.test.ts`, so a
      // suite one level down is collected and run — and must therefore be read here too.
      writeFileSync(join(fixture, "nested", "deep.test.mjs"), "spawnSync(x, { timeout: 20000 });");
      writeFileSync(join(fixture, "flat.test.ts"), "");
      // What a failing browser run leaves behind: a screenshot directory whose name ends `.test.ts`.
      mkdirSync(join(fixture, "shot.test.ts"), { recursive: true });
      const found = suitesUnder(fixture)
        .map((path) => relative(fixture, path))
        .sort();
      expect(found).toEqual(["flat.test.ts", join("nested", "deep.test.mjs")]);
    } finally {
      rmSync(fixture, { recursive: true, force: true });
    }
  });

  it("reads this very file, so the scan covers the directory it lives in", () => {
    expect(suites).toContain("spawn-timeout-budget.test.ts");
  });
});
