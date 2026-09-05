import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * The coverage bar is split in two (owner decision 2026-09-05, Track A item 1): the packages whose
 * defects are fiscally or structurally unrecoverable hold 98/98/98/95, and every other package holds
 * the 90/90/85/85 floor. Which package holds which bar is a decision, not a property of its config,
 * so this guard pins the list — a new package that copies a sibling's `vitest.config.ts` gets whichever
 * bar the sibling had, and a fiscal package's bar could otherwise be lowered in a one-line diff that
 * no per-package suite would notice (a package cannot test its own thresholds; its config is what
 * decides whether its tests run at all).
 *
 * Root project because it reads every `vitest.config.ts` in the tree (CLAUDE.md §4). It reads the
 * configs as TEXT, never importing them — the browser packages' configs pull in Playwright. A config
 * whose `thresholds:` block is built dynamically would not match `THRESHOLDS_BLOCK` and fails the
 * `exactly one thresholds block` assertion, so the limitation surfaces rather than hides.
 */

const ROOT = join(import.meta.dirname, "..");

const HIGH_BAR = { statements: 98, lines: 98, functions: 98, branches: 95 };
const FLOOR = { statements: 90, lines: 90, functions: 85, branches: 85 };

/** Workspace-relative directories that hold the high bar. Everything else holds `FLOOR`. */
const HIGH_BAR_PACKAGES = [
  "packages/verifactu",
  "packages/fiscal-verifactu",
  "packages/core",
  "packages/db",
  "packages/sync",
  "packages/payments",
];

/** A `thresholds: { … }` literal at the start of a code line — a comment line starts with `//`. */
const THRESHOLDS_BLOCK = /^\s*thresholds:\s*\{([^}]*)\}/gm;

function workspaceMembers(): string[] {
  return ["packages", "apps"].flatMap((group) =>
    readdirSync(join(ROOT, group), { withFileTypes: true })
      .filter(
        (entry) => entry.isDirectory() && existsSync(join(ROOT, group, entry.name, "package.json")),
      )
      .map((entry) => `${group}/${entry.name}`),
  );
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
  const members = workspaceMembers();

  it("every workspace member ships a vitest.config.ts of its own", () => {
    const missing = members.filter((dir) => !existsSync(join(ROOT, dir, "vitest.config.ts")));
    expect(missing).toEqual([]);
  });

  it("every high-bar package exists", () => {
    expect(HIGH_BAR_PACKAGES.filter((dir) => !members.includes(dir))).toEqual([]);
  });

  it.each(["vitest.config.ts", ...members.map((dir) => `${dir}/vitest.config.ts`)])(
    "%s holds the bar its package was assigned",
    (configPath) => {
      const dir = configPath.replace(/\/?vitest\.config\.ts$/, "");
      expect(readThresholds(configPath)).toEqual(
        HIGH_BAR_PACKAGES.includes(dir) ? HIGH_BAR : FLOOR,
      );
    },
  );
});
