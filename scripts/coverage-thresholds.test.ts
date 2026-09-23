import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { PACKAGES_WITHOUT_TESTS } from "./changed-scope.mjs";
import { workspaceMembers } from "./workspace-members.mjs";

/**
 * Every package is to hold 98/98/98/95 (owner decision 2026-09-23, retiring the 2026-09-05 split
 * that reserved it for the fiscal core and the data layer). Until each gets there it sits at the
 * 90/90/85/85 floor; `HIGH_BAR_PACKAGES` below is the list of those that have been promoted, and a
 * package joins it in the same change that brings it to the bar. The root project holds the high
 * bar too: its coverage table is the root `scripts/*.mjs` plus the vocabulary module, and two of
 * those scripts are the classifiers that decide what CI and the pre-push hook run, whose failure
 * mode is a scoped run that selects nothing and reports success (CLAUDE.md §2).
 *
 * Which package holds which bar is a decision no per-package suite can check — a package's own
 * config decides whether its tests run at all — so this guard pins it from the root project
 * (CLAUDE.md §4): a new package that copies a sibling's `vitest.config.ts` inherits whichever bar
 * the sibling had, and a one-line diff could lower a fiscal package's bar unnoticed. The list is
 * hardcoded, which CLAUDE.md §2 warns goes stale under scoped CI; it is safe here because the root
 * project is the one gate never narrowed away.
 *
 * Members come from `pnpm ls` through `workspaceMembers` (scripts/workspace-members.mjs), the same
 * source the hook and CI scope from, minus `PACKAGES_WITHOUT_TESTS`. Like the other guards here it
 * reads the configs as TEXT and never imports them. What the text parse can and cannot see is pinned
 * by `describe("the detector itself")` below: a `//` comment line never matches; a block-comment
 * interior line would, and the exactly-one check then fails the config rather than reading the
 * comment's numbers; a spread, a computed value or an extra key such as `perFile` is left over and
 * fails the equality instead of being read around.
 */

const REPO_ROOT = join(import.meta.dirname, "..");

// The per-test bound for the one `pnpm ls` spawn, larger than workspace-members.mjs's kill for a
// slow-but-completing cold CI runner (scripts/ci-workflow.test.mjs records the pair).
const PNPM_LS_TEST_TIMEOUT_MS = 60_000;

const HIGH_BAR = { statements: 98, lines: 98, functions: 98, branches: 95 };
const FLOOR = { statements: 90, lines: 90, functions: 85, branches: 85 };

const HIGH_BAR_PACKAGES = [
  "@waitron/fiscal-verifactu",
  "@waitron/core",
  "@waitron/db",
  "@waitron/payments",
  "@waitron/store",
  "@waitron/bookings",
  "@waitron/composition",
  "@waitron/country",
  "@waitron/country-es",
  "@waitron/country-gb",
  "@waitron/country-packs",
  "@waitron/credentials",
  "@waitron/dashboard-modules",
  "@waitron/diagnostics",
  "@waitron/fiscal",
  "@waitron/layouts",
  "@waitron/membership",
  "@waitron/migrations",
  "@waitron/module",
  "@waitron/payments-stripe",
  "@waitron/payments-sumup",
  "@waitron/print-agent-app",
  "@waitron/printing",
  "@waitron/provisioning",
  "@waitron/purchasing",
  "@waitron/recipes",
  "@waitron/reporting",
  "@waitron/scheduler",
  "@waitron/server-kit",
  "@waitron/shared",
  "@waitron/sync-enrolment",
  "@waitron/tunnel",
  "@waitron/ui",
  "@waitron/ui-core",
  "@waitron/workforce",
  "@waitron/workforce-es",
];

/** The `coverage.include` every package config declares. Read as text, like the thresholds below:
 *  a test file's own `include` never collides with it because those name `*.test.ts` patterns. */
const COVERAGE_INCLUDE = 'include: ["src/**/*.ts"]';

/** A `thresholds: { … }` literal at the start of a line (so a `//` comment line never matches). */
const THRESHOLDS_BLOCK = /^\s*thresholds:\s*\{([^}]*)\}/gm;
const METRIC_PAIR = /(\w+):\s*(\d+)/g;

type Thresholds = Record<string, number | string>;

/**
 * The numeric metrics of the one `thresholds:` literal in `source`. Anything else inside the braces
 * comes back under `unparsed`, so it fails an equality against a bar rather than being skipped.
 */
function parseThresholds(source: string, label: string): Thresholds {
  const blocks = [...source.matchAll(THRESHOLDS_BLOCK)];
  expect(blocks, `${label} must declare exactly one thresholds literal`).toHaveLength(1);
  const interior = blocks[0]![1]!;
  const thresholds: Thresholds = {};
  for (const [, metric, value] of interior.matchAll(METRIC_PAIR)) {
    thresholds[metric!] = Number(value);
  }
  const leftover = interior.replace(METRIC_PAIR, "").replace(/[\s,]/g, "");
  if (leftover !== "") thresholds.unparsed = leftover;
  return thresholds;
}

/** Every workspace member that declares tests, as `pnpm ls` lists them. */
function testedMembers(): { name: string; dir: string }[] {
  return workspaceMembers().filter(({ name }) => !PACKAGES_WITHOUT_TESTS.includes(name));
}

describe("every vitest config holds the coverage bar its package was assigned", () => {
  it(
    "across the root project and every workspace member pnpm lists",
    () => {
      const members = testedMembers();
      const names = members.map(({ name }) => name);
      expect(
        HIGH_BAR_PACKAGES.filter((name) => !names.includes(name)),
        "every high-bar package must be a workspace member (guards against a vacuous pass)",
      ).toEqual([]);

      const configs = [
        { label: "the root project", path: "vitest.config.ts", bar: HIGH_BAR },
        ...members.map(({ name, dir }) => ({
          label: name,
          path: `${dir}/vitest.config.ts`,
          bar: HIGH_BAR_PACKAGES.includes(name) ? HIGH_BAR : FLOOR,
        })),
      ];
      const actual = configs.map(({ label, path }) => ({
        label,
        thresholds: parseThresholds(readFileSync(join(REPO_ROOT, path), "utf8"), path),
      }));
      expect(actual).toEqual(configs.map(({ label, bar }) => ({ label, thresholds: bar })));
    },
    PNPM_LS_TEST_TIMEOUT_MS,
  );

  it(
    "and every member measures its whole src tree, not only the files a test happened to load",
    () => {
      // Vitest 4 counts a file only when a test loaded it, where Vitest 3's `all: true` counted
      // every source file. An untested file is therefore invisible rather than a zero in the
      // denominator: it cannot pull the percentage down, so the gate reads HIGHER for the same
      // code, which is the wrong direction for a gate to move. Naming the tree in `coverage.include` puts the untested file back in the
      // table. Deleting that line from a config is a one-word diff nothing else would catch, so
      // this case pins it for every member. The root project is not here: its own coverage table
      // is `scripts/`, not a `src` tree.
      const members = testedMembers();
      const names = members.map(({ name }) => name);
      expect(
        HIGH_BAR_PACKAGES.filter((name) => !names.includes(name)),
        "every high-bar package must be a workspace member (guards against a vacuous pass)",
      ).toEqual([]);

      const missing = members.filter(
        ({ dir }) =>
          !readFileSync(join(REPO_ROOT, dir, "vitest.config.ts"), "utf8").includes(
            COVERAGE_INCLUDE,
          ),
      );
      expect(missing.map(({ name }) => name)).toEqual([]);
    },
    PNPM_LS_TEST_TIMEOUT_MS,
  );

  describe("the detector itself", () => {
    const literal = "  thresholds: { statements: 98, lines: 98, functions: 98, branches: 95 },\n";

    it("reads the one-line and the multi-line literal alike", () => {
      expect(parseThresholds(literal, "x")).toEqual(HIGH_BAR);
      expect(
        parseThresholds(
          "  thresholds: {\n    statements: 90,\n    lines: 90,\n    functions: 85,\n    branches: 85,\n  },\n",
          "x",
        ),
      ).toEqual(FLOOR);
    });

    it("ignores a `//` comment line but counts a block-comment interior line as a second literal", () => {
      expect(parseThresholds(`  // thresholds: { statements: 1 },\n${literal}`, "x")).toEqual(
        HIGH_BAR,
      );
      expect(() =>
        parseThresholds(`  /*\n  thresholds: { statements: 1 },\n  */\n${literal}`, "x"),
      ).toThrow(/exactly one thresholds literal/);
    });

    it("fails a spread or an extra key rather than reading around it", () => {
      expect(parseThresholds("  thresholds: { ...HIGH_BAR },\n", "x")).toEqual({
        unparsed: "...HIGH_BAR",
      });
      expect(
        parseThresholds(
          "  thresholds: { perFile: true, statements: 90, lines: 90, functions: 85, branches: 85 },\n",
          "x",
        ),
      ).toEqual({ ...FLOOR, unparsed: "perFile:true" });
    });
  });
});
