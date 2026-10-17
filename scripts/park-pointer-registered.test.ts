import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Every package whose test source runs the `parkPointer` browser command must register it in its
 * vitest config, or `commands.parkPointer()` throws `TypeError` at runtime, seen only when that
 * package's own browser job runs.
 *
 * Reads TEXT, not the module graph: it looks for an IMPORT of `a11y-helpers` or a literal
 * `commands.parkPointer` call in a package's source, and for the `...parkPointerCommands` spread in
 * its vitest config. A rename of the command or the shared fragment, or a helper reached under a
 * different spelling, would slip past. The same holds for `pointerGestureCommands`: a literal
 * `commands.mouseDrag`, `commands.mouseMove`, `commands.touchGesture` or `commands.parkTouch` call, and the `...pointerGestureCommands` spread.
 */

const repoRoot = join(import.meta.dirname, "..");
const ROOTS = ["packages", "apps"];

/** A source file imports the shared a11y helper (an import statement, not a prose mention). */
const IMPORTS_A11Y_HELPERS = /^\s*import\b[^\n]*\ba11y-helpers\b/m;
/** A source file calls the command directly (a local test-helpers copy of the hook). */
const CALLS_PARK_POINTER = /\bcommands\.parkPointer\b/;
/** A source file calls one of the commands in `pointerGestureCommands`. */
const CALLS_POINTER_GESTURE = /\bcommands\.(?:mouseDrag|mouseMove|touchGesture|parkTouch)\b/;

function sourceFilesIn(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry === "dist" || entry.startsWith(".")) continue;
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) out.push(...sourceFilesIn(full));
    else if (st.isFile() && full.endsWith(".ts")) out.push(full);
  }
  return out;
}

function packageDirsWithVitestConfig(): string[] {
  const dirs: string[] = [];
  for (const root of ROOTS) {
    const rootDir = join(repoRoot, root);
    for (const entry of readdirSync(rootDir)) {
      const dir = join(rootDir, entry);
      if (!statSync(dir).isDirectory()) continue;
      try {
        statSync(join(dir, "vitest.config.ts"));
      } catch {
        continue;
      }
      dirs.push(dir);
    }
  }
  return dirs;
}

type Uses = { parkPointer: boolean; pointerGesture: boolean };

/** What each package's source uses, from one read of its files; both blocks below share it. */
const usesByPackage = new Map<string, Uses>(
  packageDirsWithVitestConfig().map((dir) => {
    let files: string[];
    try {
      files = sourceFilesIn(join(dir, "src"));
    } catch {
      files = [];
    }
    const uses: Uses = { parkPointer: false, pointerGesture: false };
    for (const f of files) {
      const text = readFileSync(f, "utf8");
      uses.parkPointer ||= IMPORTS_A11Y_HELPERS.test(text) || CALLS_PARK_POINTER.test(text);
      uses.pointerGesture ||= CALLS_POINTER_GESTURE.test(text);
      if (uses.parkPointer && uses.pointerGesture) break;
    }
    return [dir, uses];
  }),
);

describe("parkPointer command registration", () => {
  const packages = [...usesByPackage.keys()];

  it("finds packages to check (the scan is not silently empty)", () => {
    expect(packages.length).toBeGreaterThan(0);
  });

  for (const dir of packages) {
    if (!usesByPackage.get(dir)!.parkPointer) continue;

    const rel = dir.slice(repoRoot.length + 1);
    it(`${rel} registers parkPointer in its vitest config`, () => {
      const config = readFileSync(join(dir, "vitest.config.ts"), "utf8");
      expect(
        config.includes("...parkPointerCommands"),
        `${rel}/src runs the parkPointer hook but ${rel}/vitest.config.ts does not spread ...parkPointerCommands into its browser commands`,
      ).toBe(true);
    });
  }
});

describe("pointer gesture command registration", () => {
  const callers = [...usesByPackage].filter(([, uses]) => uses.pointerGesture).map(([dir]) => dir);

  it("finds packages calling the commands (the scan is not silently empty)", () => {
    expect(callers.length).toBeGreaterThan(0);
  });

  for (const dir of callers) {
    const rel = dir.slice(repoRoot.length + 1);
    it(`${rel} registers pointerGestureCommands in its vitest config`, () => {
      const config = readFileSync(join(dir, "vitest.config.ts"), "utf8");
      expect(
        config.includes("...pointerGestureCommands"),
        `${rel}/src calls commands.mouseDrag, commands.mouseMove or commands.touchGesture but ${rel}/vitest.config.ts does not spread ...pointerGestureCommands into its browser commands`,
      ).toBe(true);
    });
  }
});
