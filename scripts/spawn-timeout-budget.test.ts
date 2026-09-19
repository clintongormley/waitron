import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, relative } from "node:path";
import { describe, expect, it } from "vitest";

// A test may wait only as long as its per-test timeout allows, whatever the wait's own limit says.
//
// The name of this file says `spawn`, which is where the lesson was paid for, but the rule is about
// WAITS generally: `spawnSync`'s `timeout` under `scripts/`, and `expect.poll` / `vi.waitFor` under
// `packages/` and `apps/`, where nothing spawns at all. All three are bounded by the same clock.
//
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
// …except in browser mode, where it is three times larger. From Vitest's own resolver:
// `resolved.testTimeout ??= resolved.browser.enabled ? 15e3 : 5e3`. Taking 5000 for a browser
// project would hand four packages here a bound a third of their real one and accuse a correct file
// the first time anyone wrote a 5-15s wait in one.
const VITEST_DEFAULT_BROWSER_TEST_TIMEOUT_MS = 15_000;

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
 *     that come from the fixture sources below, and this suite performs no wait at all. Ordinary
 *     code counts too: `packages/db/src/testing/harness.docker.test.ts` has a `timeout: 10_000`
 *     inside a `toHaveBeenCalledExactlyOnceWith(…)` — an assertion ABOUT a mocked call, waiting for
 *     nothing — and this reads it as a wait.
 *  3. It is per FILE, not per test. It takes the LARGEST bound anywhere in the file, so a suite that
 *     raises the bound on its slow cases and waits a long time in an untouched one still passes.
 *  4. A bound it cannot evaluate makes it DECLINE to judge the file rather than accuse it, because a
 *     false accusation stops every push. So an unreadable bound is a hole, deliberately.
 *  5. Under `packages/` and `apps/` it must ask the package's Vitest configuration for the bound,
 *     because a file there rarely sets one; where that configuration cannot be resolved — two
 *     matching projects disagreeing, an `include` glob this guard does not model — it declines, so
 *     those files are unchecked.
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

const SKIPPED_DIRECTORIES = new Set(["node_modules", "dist", "coverage", "drizzle", ".turbo"]);

/** Every suite under a directory, nested ones included. */
function suitesUnder(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    // A failing browser run leaves a screenshot DIRECTORY named `*.test.ts`; reading one throws
    // EISDIR and this guard would look broken rather than report a finding (CLAUDE.md §4).
    if (entry.isDirectory()) return SKIPPED_DIRECTORIES.has(entry.name) ? [] : suitesUnder(path);
    return entry.isFile() && /\.test\.(mjs|ts)$/.test(entry.name) ? [path] : [];
  });
}

const REPO = join(SCRIPTS, "..");

/**
 * A GLOB, restricted on purpose. It models a literal path, `*` (within one segment) and `**`
 * (across segments) — the shapes this repository's Vitest configs actually use — and returns
 * undefined for anything else, including `?`, a character class, a brace list and a negation.
 * Undefined means the caller cannot resolve the file and must decline, never that the glob failed
 * to match: a matcher that quietly guesses would accuse a correct file.
 */
function globToRegExp(glob: string): RegExp | undefined {
  if (/[?[\]!()+@]/.test(glob)) return undefined;
  const literal = (text: string) => text.replace(/[.^$+|\\]/g, "\\$&");
  let pattern = "";
  let index = 0;
  while (index < glob.length) {
    if (glob.startsWith("**/", index)) {
      pattern += "(?:.*/)?";
      index += 3;
    } else if (glob.startsWith("**", index)) {
      pattern += ".*";
      index += 2;
    } else if (glob[index] === "*") {
      pattern += "[^/]*";
      index += 1;
    } else if (glob[index] === "{") {
      // A brace list, which Vitest's own `configDefaults.exclude` is full of — every project that
      // spreads it would otherwise be unresolvable, and that was 60 files.
      const close = glob.indexOf("}", index);
      if (close === -1) return undefined;
      const alternatives = glob.slice(index + 1, close).split(",");
      if (alternatives.some((alternative) => /[*{}]/.test(alternative))) return undefined;
      pattern += `(?:${alternatives.map(literal).join("|")})`;
      index = close + 1;
    } else {
      pattern += literal(glob[index]!);
      index += 1;
    }
  }
  return new RegExp(`^${pattern}$`);
}

/** True / false / undefined, where undefined means "cannot tell" and the caller declines. */
function globsMatch(globs: unknown, path: string): boolean | undefined {
  if (globs === undefined) return undefined;
  const list = Array.isArray(globs) ? globs : [globs];
  let matched = false;
  for (const glob of list) {
    if (typeof glob !== "string") return undefined;
    const expression = globToRegExp(glob);
    if (expression === undefined) return undefined;
    if (expression.test(path)) matched = true;
  }
  return matched;
}

/**
 * The per-test bound a package's Vitest configuration gives one of its test files, or undefined when
 * that cannot be established — a project whose `include` uses a glob shape `globToRegExp` does not
 * model, two projects matching the same file with different bounds, or no project matching it at all.
 *
 * The configs are IMPORTED rather than read as text, which is how `scripts/fiscal-test-budget.test.ts`
 * reads its own. Note a trap: a `testTimeout` sitting beside `projects` at the top level is INERT for
 * a project run unless the project sets `extends: true` — `packages/media/vitest.config.ts` has one,
 * and taking it would report 30000 for a browser project that actually runs at Vitest's default.
 */
function boundFromConfig(config: unknown, relativePath: string): number | undefined {
  const test = (config as { test?: Record<string, unknown> } | undefined)?.test;
  if (test === undefined) return undefined;
  const browserOf = (settings: Record<string, unknown> | undefined) =>
    (settings?.browser as { enabled?: boolean } | undefined)?.enabled === true;
  const fallback = (settings: Record<string, unknown> | undefined) =>
    browserOf(settings) ? VITEST_DEFAULT_BROWSER_TEST_TIMEOUT_MS : VITEST_DEFAULT_TEST_TIMEOUT_MS;

  const projects = test.projects as
    { extends?: unknown; test?: Record<string, unknown> }[] | undefined;
  if (projects === undefined) {
    return typeof test.testTimeout === "number" ? test.testTimeout : fallback(test);
  }
  const bounds = new Set<number>();
  for (const project of projects) {
    const settings = project?.test;
    if (settings === undefined) return undefined;
    // No `include` means Vitest's default one, which matches every `*.test.*` — and every path this
    // guard asks about is a test file, so such a project matches.
    const included =
      settings.include === undefined ? true : globsMatch(settings.include, relativePath);
    if (included === undefined) return undefined;
    if (!included) continue;
    const excluded =
      settings.exclude === undefined ? false : globsMatch(settings.exclude, relativePath);
    if (excluded === undefined) return undefined;
    if (excluded) continue;
    // `extends: true` is the other half of the top-level rule: without it the top-level
    // `testTimeout` is inert for the project, with it the project inherits it.
    const inherits = project.extends === true;
    if (typeof settings.testTimeout === "number") bounds.add(settings.testTimeout);
    else if (inherits && typeof test.testTimeout === "number") bounds.add(test.testTimeout);
    else
      bounds.add(
        browserOf(settings) || (inherits && browserOf(test))
          ? VITEST_DEFAULT_BROWSER_TEST_TIMEOUT_MS
          : VITEST_DEFAULT_TEST_TIMEOUT_MS,
      );
  }
  return bounds.size === 1 ? [...bounds][0] : undefined;
}

/**
 * The Vitest configuration that runs a given test file, and the package it belongs to.
 *
 * A package usually has one `vitest.config.ts`. Three have a SECOND config for suites their main one
 * excludes, and each is keyed by a filename suffix rather than a directory — `vitest.preprod.config.ts`
 * runs `*.preprod.test.ts`, `vitest.sandbox.config.ts` runs `*.sandbox.test.ts`. So the suffix picks
 * the config; a file whose suffix names a config that does not exist belongs to the main one.
 */
function configFor(file: string): { root: string; config: string } | undefined {
  let directory = dirname(file);
  while (directory.startsWith(REPO) && directory !== REPO) {
    const main = join(directory, "vitest.config.ts");
    if (existsSync(main)) {
      const suffix = basename(file).match(/\.(\w+)\.test\.[cm]?[jt]sx?$/)?.[1];
      const special =
        suffix === undefined ? undefined : join(directory, `vitest.${suffix}.config.ts`);
      return {
        root: directory,
        config: special !== undefined && existsSync(special) ? special : main,
      };
    }
    directory = dirname(directory);
  }
  return undefined;
}

const scriptSuites = suitesUnder(SCRIPTS).map((path) => relative(SCRIPTS, path));
const packageSuites = ["packages", "apps"]
  .map((area) => join(REPO, area))
  .filter((area) => existsSync(area))
  .flatMap((area) => suitesUnder(area))
  .map((path) => relative(REPO, path));
const suites = scriptSuites;

/**
 * One read and one parse per package suite, shared by the two cases below that walk the whole set.
 * They asked the same question of the same ~1100 files twice, and the file's own rule is what that
 * cost: the non-vacuity case timed out at Vitest's 5000ms default during a full root run under load
 * (`pnpm vitest run --coverage`, 46 files in parallel), while measuring 1.4s for the whole FILE run
 * on its own — the exact shape this suite exists to catch, in this suite. Reading once is the part
 * that removes work; the bounds the two cases now declare are the part that makes a slow machine
 * survivable.
 */
const budgetCache = new Map<string, ReturnType<typeof budgets>>();
const packageBudgets = (name: string) => {
  const held = budgetCache.get(name);
  if (held !== undefined) return held;
  const read = budgets(readFileSync(join(REPO, name), "utf8"));
  budgetCache.set(name, read);
  return read;
};

/**
 * Above the longest a healthy walk of every package and app suite can take, not above the time it
 * takes on an idle machine. Measured on this tree: the whole file runs in 1.4s of test time idle,
 * and the non-vacuity case alone exceeded 5000ms inside a loaded full root run. Thirty seconds is
 * the bound the root guard suites already use for their own spawning cases.
 */
const SCAN_BOUND_MS = 30_000;

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

// Suites under `packages/` and `apps/`. These are a different shape from the root guards: none of
// them spawns anything, so every wait here is an `expect.poll` or a `vi.waitFor`, bounded by the
// same per-test clock. And a file rarely carries its own bound — it inherits one from its package's
// `vitest.config.ts`, which is why that config has to be read. Without it this check would invent
// failures for every package suite that relies on its config, which is most of them.
describe("the package and app suites", () => {
  const configCache = new Map<string, Promise<unknown>>();
  // A config that throws on import — one needing an env var, one importing something unbuilt —
  // must not take the whole gate down with a module-resolution error. Decline that package instead.
  const loadConfig = (path: string) => {
    if (!configCache.has(path)) {
      configCache.set(
        path,
        import(/* @vite-ignore */ path).catch(() => undefined),
      );
    }
    return configCache.get(path)!;
  };

  /**
   * The per-test bound a file's own package configuration gives it, with the config it came from —
   * or undefined when no bound can be established: no vitest config above the file, a config that
   * fails to import, a configuration the resolver declines to read (two projects disagreeing, an
   * `include` glob it does not model, no project matching at all). They differ in cause and not in
   * consequence, so they arrive as one value, and it means: do not judge this file.
   *
   * ONE copy, called by the scan below AND by the anchored cases after it, because an anchor with
   * its own copy of these steps proves only that ITS copy works. On the draft where each anchor
   * repeated the lookup, dropping the `.default` unwrap from the scan's copy left the scan comparing
   * no file and every case in this file green. Against the shared shape it does not: delete
   * `?.default` here and the scan's non-empty `compared` assertion fails AND both anchors fail with
   * it (measured 2026-09-19).
   */
  const resolvedBound = async (
    file: string,
  ): Promise<{ config: string; bound: number } | undefined> => {
    const located = configFor(file);
    if (located === undefined) return undefined;
    const bound = boundFromConfig(
      ((await loadConfig(located.config)) as { default?: unknown } | undefined)?.default,
      relative(located.root, file),
    );
    return bound === undefined ? undefined : { config: located.config, bound };
  };

  it("finds them", () => {
    expect(packageSuites.length).toBeGreaterThan(500);
  });

  it(
    "finds one that waits longer than Vitest's default, so this is not vacuous",
    () => {
      const longest = packageSuites.map((name) => packageBudgets(name).declared);
      expect(Math.max(...longest)).toBeGreaterThanOrEqual(VITEST_DEFAULT_TEST_TIMEOUT_MS);
    },
    SCAN_BOUND_MS,
  );

  // ONE case over ~1100 files rather than `it.each` over them, and NOT for speed: a review measured
  // the two shapes 0.23s apart in a full root run, so the earlier claim here that a case per file
  // cost 20 seconds was wrong — it compared two different trees under load. The reason is what the
  // check is: one uniform question asked of every file, which names at most a handful, against 1100
  // test records that would name every file whether or not it was even judged.
  // `scripts/guarded-teardowns.test.ts` aggregates its scan for the same reason. The cost is real —
  // `it.each` would give a per-file test name and a per-file failure for free — so the violation
  // message below names every file it accuses, and the case records what it compared so that an
  // aggregate which judged nothing fails instead of reporting an empty violation list.
  it(
    "every package and app suite can use the timeout it declares",
    async () => {
      const violations: string[] = [];
      // The files this scan actually compared a bound against, so the case can assert on its own
      // work rather than on a second resolution done beside it.
      const compared: string[] = [];
      for (const name of packageSuites) {
        const file = join(REPO, name);
        const { declared, bound, unreadable } = packageBudgets(name);
        if (declared < VITEST_DEFAULT_TEST_TIMEOUT_MS) continue;

        // Undefined is every decline at once: no config governs the file, its config would not
        // import, or the resolver will not read that configuration. None of those is a missing
        // bound, and accusing a file on one of them would fail a gate every push runs.
        const resolution = await resolvedBound(file);
        if (resolution === undefined) continue;
        compared.push(name);
        const configured = resolution.bound;

        // The LARGEST bound that could reach any case in the file — the config's, or a bigger one the
        // file sets on a case. Not "the file's if it has one": an `it(name, fn, ms)` on some other
        // case can be SMALLER than the config's value, and taking it would report a bound that
        // governs a different test entirely. Weakness 3 again, staying on the permissive side.
        const effective = Math.max(bound, configured);
        // The config's value is readable even where the in-file reader gave up, so it clears the
        // unreadable decline rather than being defeated by it. That matters here: the files that wait
        // longest carry a `beforeAll(fn, ms)` hook timeout, which is exactly what trips that net.
        // The policy, stated once and applied here: never accuse a file whose bound this reader could
        // not evaluate. `unreadable` means the in-file reader gave up, so the only number left is the
        // config's — and if that does not clear the wait, the honest answer is "cannot tell", not
        // "too small". 48 package files are already unreadable, because a `beforeAll(fn, ms)` hook
        // timeout trips the sign-of-bound net.
        if (unreadable && effective <= declared) continue;
        if (effective > declared) continue;

        violations.push(
          `${name} waits up to ${declared}ms, but the largest per-test bound that reaches it is ` +
            `${effective}ms (${bound > configured ? "set in the file" : `from ${relative(REPO, resolution.config)}`}).`,
        );
      }
      // Non-vacuity, asserted from THIS case's own results: an empty list means the loop resolved a
      // bound for no file at all, so it reported no violations because it judged nothing, not because
      // every file is fine. Non-emptiness rather than a floor — a floor would fall, and have to be
      // re-cut, whenever an unrelated suite that happened to declare a long wait was deleted.
      expect(
        compared,
        "The scan compared a bound for NO file. Either no package suite declares a wait at or above " +
          "Vitest's default any more, or the config lookup broke and every file declined. In that " +
          "state this case passes with an empty violation list however wrong the bounds are, which " +
          "is exactly what it is here to refuse.",
      ).not.toEqual([]);
      expect(
        violations,
        "A run that legitimately takes longer than its bound is failed although it completed " +
          "normally. Raise the bound above the wait — on the waiting case with it(name, fn, ms), or " +
          "for the whole package in its vitest config:\n  " +
          violations.join("\n  "),
      ).toEqual([]);
    },
    SCAN_BOUND_MS,
  );

  // The other half of non-vacuity, covering a break the case above cannot see. `configFor` walks up
  // from the file it is given, so a lookup can stop resolving under `packages/` while still
  // resolving under `apps/` — and the scan's list stays non-empty on the root that still works, so
  // it passes. Hence ONE ANCHOR PER ROOT. Both files are guards CLAUDE.md §3 names, so neither is
  // deleted casually. `packages/ui` does run in browser mode, and its anchor resolves through
  // `fallback()`'s browser arm — but it proves nothing about that arm's VALUE, because it asserts
  // only that a number came back. Measured 2026-09-19: make that arm return
  // VITEST_DEFAULT_TEST_TIMEOUT_MS and the `packages/ui` anchor still passes, with "gives a BROWSER
  // project Vitest's larger default, not 5s" the ONLY failing case. The constant has a second read
  // site in the project branch below `fallback()`, so setting the CONSTANT to 5000 instead fails
  // that case AND "lets a project with extends: true inherit the top level"; both anchors stay green
  // either way. The value is pinned by those resolver cases, never by an anchor.
  //
  // These run the SAME `resolvedBound` the scan runs, not a second copy of it: an anchor with its
  // own copy of the lookup stays green while the scan's copy is broken.
  //
  // Neither anchor is itself judged by the scan — measured, neither declares a wait at or above
  // Vitest's default — so neither appears in the list the scan compared, and nothing here asserts
  // that it does.
  //
  // WHAT NEITHER HALF COVERS: a lookup that breaks for ONE package other than these two. The
  // scan's list stays non-empty while any other package still resolves, and both anchors sit
  // elsewhere, so such a break passes unseen.
  it.each(["apps/server/src/working-order.test.ts", "packages/ui/src/no-hardcoded-chrome.test.ts"])(
    "resolves a bound for %s, so the scan above is not declining everything",
    async (name) => {
      const file = join(REPO, name);
      expect(existsSync(file), `${name} is gone — this case needs a file that still exists`).toBe(
        true,
      );

      const resolution = await resolvedBound(file);
      expect(
        resolution?.bound,
        `no per-test bound resolved for ${name}: either no vitest config sits above it, its ` +
          `config would not import, or the configuration is one this guard declines to read. ` +
          `Every file under that config would decline, and the scan above would report no ` +
          `violations having compared nothing.`,
      ).toBeTypeOf("number");
    },
  );
});

// The configuration resolver's own cases. Everything above decides whether ~1100 package suites
// pass a check that runs on every push, so a resolver that silently returned the wrong number — or
// the right number for the wrong reason — would be invisible without these.
describe("the configuration resolver", () => {
  const cfg = (test: unknown) => ({ test });

  it("reads a plain testTimeout", () => {
    expect(boundFromConfig(cfg({ testTimeout: 30_000 }), "src/a.test.ts")).toBe(30_000);
  });

  it("treats a config that sets none as Vitest's default", () => {
    expect(boundFromConfig(cfg({}), "src/a.test.ts")).toBe(VITEST_DEFAULT_TEST_TIMEOUT_MS);
  });

  it("takes the value of the ONE project whose include matches", () => {
    const config = cfg({
      projects: [
        {
          test: {
            include: ["src/**/*.test.ts"],
            exclude: ["src/dashboard/**"],
            testTimeout: 30_000,
          },
        },
        { test: { include: ["src/dashboard/**/*.test.ts"] } },
      ],
    });
    expect(boundFromConfig(config, "src/thing.test.ts")).toBe(30_000);
    // The browser project sets none, so that file runs at the default — NOT at the other project's
    // 30s. Getting this backwards would hand a dashboard suite a bound it does not have.
    expect(boundFromConfig(config, "src/dashboard/thing.test.ts")).toBe(
      VITEST_DEFAULT_TEST_TIMEOUT_MS,
    );
  });

  it("IGNORES a testTimeout sitting beside projects, which Vitest does not apply to them", () => {
    // `packages/media/vitest.config.ts` has exactly this shape. Reading the top-level value would
    // report 30s for a browser project that actually runs at Vitest's default.
    const config = cfg({
      testTimeout: 30_000,
      projects: [{ test: { include: ["src/dashboard/**/*.test.ts"] } }],
    });
    expect(boundFromConfig(config, "src/dashboard/a.test.ts")).toBe(VITEST_DEFAULT_TEST_TIMEOUT_MS);
  });

  it("declines when two matching projects disagree, rather than picking one", () => {
    const config = cfg({
      projects: [
        { test: { include: ["src/**/*.test.ts"], testTimeout: 30_000 } },
        { test: { include: ["src/**/*.test.ts"], testTimeout: 120_000 } },
      ],
    });
    expect(boundFromConfig(config, "src/a.test.ts")).toBeUndefined();
  });

  it("declines when no project matches, and when an include uses a glob it does not model", () => {
    expect(
      boundFromConfig(
        cfg({ projects: [{ test: { include: ["src/dashboard/**"] } }] }),
        "src/a.test.ts",
      ),
    ).toBeUndefined();
    expect(
      boundFromConfig(
        cfg({ projects: [{ test: { include: ["src/?.test.ts"] } }] }),
        "src/a.test.ts",
      ),
    ).toBeUndefined();
  });

  it("gives a BROWSER project Vitest's larger default, not 5s", () => {
    // `resolved.testTimeout ??= resolved.browser.enabled ? 15e3 : 5e3`. Reading 5000 here would
    // accuse a correct browser suite the moment one waited between 5 and 15 seconds.
    expect(boundFromConfig(cfg({ browser: { enabled: true } }), "src/a.test.ts")).toBe(15_000);
    expect(
      boundFromConfig(
        cfg({ projects: [{ test: { browser: { enabled: true } } }] }),
        "src/a.test.ts",
      ),
    ).toBe(15_000);
    // An explicit value still wins over the default.
    expect(
      boundFromConfig(
        cfg({ projects: [{ test: { browser: { enabled: true }, testTimeout: 40_000 } }] }),
        "src/a.test.ts",
      ),
    ).toBe(40_000);
  });

  it("lets a project with extends: true inherit the top level, which is the other half of the rule", () => {
    const config = cfg({ testTimeout: 30_000, projects: [{ extends: true, test: {} }] });
    expect(boundFromConfig(config, "src/a.test.ts")).toBe(30_000);
    // Without `extends`, the same top-level value is inert — the case above this one.
    expect(
      boundFromConfig(cfg({ testTimeout: 30_000, projects: [{ test: {} }] }), "src/a.test.ts"),
    ).toBe(VITEST_DEFAULT_TEST_TIMEOUT_MS);
    // Inherited browser mode raises the DEFAULT too, where no explicit value is set either side.
    expect(
      boundFromConfig(
        cfg({ browser: { enabled: true }, projects: [{ extends: true, test: {} }] }),
        "src/a.test.ts",
      ),
    ).toBe(15_000);
  });

  it("treats a project with no include as matching, because Vitest's default include does", () => {
    expect(
      boundFromConfig(cfg({ projects: [{ test: { testTimeout: 20_000 } }] }), "src/a.test.ts"),
    ).toBe(20_000);
  });

  it("models the brace lists Vitest's own configDefaults.exclude is full of", () => {
    // Every project spreading `configDefaults.exclude` carries `**/.{idea,git,…}/**` and
    // `**/{karma,rollup,…}.config.*`. Rejecting braces made 60 real files unresolvable.
    expect(globsMatch(["**/.{idea,git,cache}/**"], ".git/x.test.ts")).toBe(true);
    expect(globsMatch(["**/.{idea,git,cache}/**"], "src/x.test.ts")).toBe(false);
    expect(globsMatch(["**/{karma,vitest}.config.*"], "vitest.config.ts")).toBe(true);
    expect(globsMatch(["**/{karma,vitest}.config.*"], "src/a.test.ts")).toBe(false);
    // Still undefined for a brace it cannot expand safely.
    expect(globsMatch(["src/{a,*b}/x.test.ts"], "src/a/x.test.ts")).toBeUndefined();
  });

  it("models only the glob shapes it claims to", () => {
    expect(globsMatch(["src/**/*.test.ts"], "src/deep/nested/a.test.ts")).toBe(true);
    expect(globsMatch(["src/**/*.test.ts"], "src/a.test.ts")).toBe(true);
    expect(globsMatch(["src/*.test.ts"], "src/deep/a.test.ts")).toBe(false);
    expect(globsMatch(["src/dashboard/**/*.test.ts"], "src/other/a.test.ts")).toBe(false);
    // Unsupported shapes are UNDEFINED — "cannot tell" — never a false `false`, which would read as
    // "no project matches" and silently change the answer.
    expect(globsMatch(["src/?.test.ts"], "src/a.test.ts")).toBeUndefined();
    expect(globsMatch(["!src/a.test.ts"], "src/a.test.ts")).toBeUndefined();
    expect(globsMatch(undefined, "src/a.test.ts")).toBeUndefined();
    expect(globsMatch([42], "src/a.test.ts")).toBeUndefined();
  });

  it("routes a suffixed suite to the config named for that suffix", () => {
    // `apps/server/vitest.preprod.config.ts` runs `*.preprod.test.ts`; the main config excludes it.
    const preprod = configFor(join(REPO, "apps/server/src/aeat.preprod.test.ts"));
    expect(preprod?.config).toBe(join(REPO, "apps/server/vitest.preprod.config.ts"));
    const ordinary = configFor(join(REPO, "apps/server/src/working-order.test.ts"));
    expect(ordinary?.config).toBe(join(REPO, "apps/server/vitest.config.ts"));
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
