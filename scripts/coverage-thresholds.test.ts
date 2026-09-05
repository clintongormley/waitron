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
 * holds the high bar too: it measures the two classifiers that decide what CI and the pre-push hook
 * run, whose failure mode is a scoped run that selects nothing and reports success (CLAUDE.md §2).
 *
 * Which package holds which bar is a decision no per-package suite can check — a package's own
 * config decides whether its tests run at all — so this guard pins it from the root project
 * (CLAUDE.md §4): a new package that copies a sibling's `vitest.config.ts` inherits whichever bar
 * the sibling had, and a one-line diff could lower a fiscal package's bar unnoticed.
 *
 * Members come from `pnpm ls` through `workspacePackages` (scripts/changed-packages.mjs), the same
 * source the hook and CI scope from, minus `PACKAGES_WITHOUT_TESTS`. Configs are read as TEXT, never
 * imported — the browser packages' configs pull in Playwright. A `thresholds:` block built
 * dynamically would not match `THRESHOLDS_BLOCK` and fails the exactly-one assertion, so the
 * limitation surfaces rather than hides.
 */

const ROOT = join(import.meta.dirname, "..");

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

/** A `thresholds: { … }` literal at the start of a code line — a comment line starts with `//`. */
const THRESHOLDS_BLOCK = /^\s*thresholds:\s*\{([^}]*)\}/gm;

function testedMembers(): { name: string; dir: string }[] {
  const result = spawnSync("pnpm", ["ls", "-r", "--depth", "-1", "--json"], {
    cwd: ROOT,
    encoding: "utf8",
    timeout: 60_000,
  });
  if (result.error !== undefined || result.status !== 0) {
    throw new Error(`pnpm ls failed: ${result.error?.message ?? result.stderr}`);
  }
  const members = workspacePackages(result.stdout, ROOT);
  if (members === null) throw new Error("pnpm ls returned no parsable workspace listing");
  return members.filter(({ name }) => !PACKAGES_WITHOUT_TESTS.includes(name));
}

function readThresholds(configPath: string): Record<string, number> {
  const source = readFileSync(join(ROOT, configPath), "utf8");
  const blocks = [...source.matchAll(THRESHOLDS_BLOCK)];
  expect(blocks, `${configPath} must declare exactly one thresholds block`).toHaveLength(1);
  const thresholds: Record<string, number> = {};
  for (const [, metric, value] of blocks[0]![1]!.matchAll(/(\w+):\s*(\d+)/g)) {
    thresholds[metric!] = Number(value);
  }
  return thresholds;
}

describe("coverage thresholds (CLAUDE.md §2)", () => {
  const members = testedMembers();
  const configs = [
    { label: "the root project", path: "vitest.config.ts", bar: HIGH_BAR },
    ...members.map(({ name, dir }) => ({
      label: name,
      path: `${dir}/vitest.config.ts`,
      bar: HIGH_BAR_PACKAGES.includes(name) ? HIGH_BAR : FLOOR,
    })),
  ];

  it("every high-bar package is a workspace member", () => {
    const names = members.map(({ name }) => name);
    expect(HIGH_BAR_PACKAGES.filter((name) => !names.includes(name))).toEqual([]);
  });

  it.each(configs)("$label holds the bar it was assigned", ({ path, bar }) => {
    expect(readThresholds(path)).toEqual(bar);
  });
});
