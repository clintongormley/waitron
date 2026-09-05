import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { workspacePackages } from "./changed-packages.mjs";
import { PACKAGES_WITHOUT_TESTS } from "./changed-scope.mjs";

/**
 * The coverage bar is split in two (owner decision 2026-09-05, Track A item 1): six packages — the
 * fiscal core and the data-layer foundations everything else builds on — hold 98/98/98/95, and
 * every other package holds the 90/90/85/85 floor. The six are the owner's list, not a rule that
 * derives them (`apps/server` holds the AEAT transport and sits at the floor). The root project
 * holds the high bar too: its coverage table is the root `scripts/*.mjs` plus the vocabulary
 * module, and two of those scripts are the classifiers that decide what CI and the pre-push hook
 * run, whose failure mode is a scoped run that selects nothing and reports success (CLAUDE.md §2).
 *
 * Which package holds which bar is a decision no per-package suite can check — a package's own
 * config decides whether its tests run at all — so this guard pins it from the root project
 * (CLAUDE.md §4): a new package that copies a sibling's `vitest.config.ts` inherits whichever bar
 * the sibling had, and a one-line diff could lower a fiscal package's bar unnoticed. The list is
 * hardcoded, which CLAUDE.md §2 warns goes stale under scoped CI; it is safe here because the root
 * project is the one gate never narrowed away.
 *
 * Members come from `pnpm ls` through `workspacePackages` (scripts/changed-packages.mjs), the same
 * source the hook and CI scope from, minus `PACKAGES_WITHOUT_TESTS`. Like the other guards here it
 * reads the configs as TEXT and never imports them. What the text parse can and cannot see is pinned
 * by `describe("the detector itself")` below: a `//` comment line never matches; a block-comment
 * interior line would, and the exactly-one check then fails the config rather than reading the
 * comment's numbers; a spread, a computed value or an extra key such as `perFile` is left over and
 * fails the equality instead of being read around.
 */

const REPO_ROOT = join(import.meta.dirname, "..");

// Two bounds for the one `pnpm ls` spawn, for the reasons scripts/ci-workflow.test.mjs records above
// its own pair: the kernel-level kill for a hung child (Vitest's timer cannot interrupt a blocked
// `spawnSync`) and the larger per-test bound for a slow-but-completing cold CI runner.
const PNPM_LS_SPAWN_TIMEOUT_MS = 30_000;
const PNPM_LS_TEST_TIMEOUT_MS = 60_000;

const HIGH_BAR = { statements: 98, lines: 98, functions: 98, branches: 95 };
const FLOOR = { statements: 90, lines: 90, functions: 85, branches: 85 };

const HIGH_BAR_PACKAGES = [
  "@waitron/verifactu",
  "@waitron/fiscal-verifactu",
  "@waitron/core",
  "@waitron/db",
  "@waitron/sync",
  "@waitron/payments",
];

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

type Spawn = (
  command: string,
  args: string[],
  options: { cwd: string; encoding: "utf8"; timeout: number },
) => { error?: Error; status: number | null; stdout: string; stderr: string };

/**
 * Every workspace member that declares tests, as `pnpm ls` lists them. `spawn` is injected only so
 * a test can assert the kill timeout is passed — deleting it here would otherwise leave the suite
 * green (CLAUDE.md §4).
 */
function testedMembers(spawn: Spawn = spawnSync): { name: string; dir: string }[] {
  const args = ["ls", "-r", "--depth", "-1", "--json"];
  const result = spawn("pnpm", args, {
    cwd: REPO_ROOT,
    encoding: "utf8",
    timeout: PNPM_LS_SPAWN_TIMEOUT_MS,
  });
  if (result.error !== undefined) {
    throw new Error(
      `\`pnpm ${args.join(" ")}\` failed to run (killed after ${PNPM_LS_SPAWN_TIMEOUT_MS}ms?): ${result.error.message}`,
    );
  }
  if (result.status !== 0) {
    throw new Error(`\`pnpm ${args.join(" ")}\` exited ${result.status}: ${result.stderr}`);
  }
  const members = workspacePackages(result.stdout, REPO_ROOT);
  if (members === null) throw new Error("`pnpm ls` returned no parsable workspace listing");
  return members.filter(({ name }) => !PACKAGES_WITHOUT_TESTS.includes(name));
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

    it("passes the spawn kill timeout, so a hung `pnpm ls` cannot stall the gate", () => {
      const options: unknown[] = [];
      const fake: Spawn = (_command, _args, opts) => {
        options.push(opts);
        return {
          status: 0,
          stdout: JSON.stringify([{ name: "@waitron/x", path: join(REPO_ROOT, "packages/x") }]),
          stderr: "",
        };
      };
      expect(testedMembers(fake)).toEqual([{ name: "@waitron/x", dir: "packages/x" }]);
      expect(options).toEqual([expect.objectContaining({ timeout: PNPM_LS_SPAWN_TIMEOUT_MS })]);
    });
  });
});
