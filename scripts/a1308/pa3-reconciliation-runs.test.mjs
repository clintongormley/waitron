import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { expect, it, vi } from "vitest";

it("renames tracked reconciliation consumers once while preserving historical inputs and non-files", async () => {
  const originalCwd = process.cwd();
  const root = mkdtempSync(join(tmpdir(), "pa3-reconciliation-rename-"));
  for (const key of Object.keys(process.env))
    if (key.startsWith("GIT_")) vi.stubEnv(key, undefined);
  const input = "scheduled_runs scheduledRuns scheduled-runs";
  const renamed = "reconciliation_runs reconciliationRuns reconciliation-runs";
  const consumers = [
    "apps/server/src/consumer.ts",
    "packages/payments/src/schema/scheduled-runs.ts",
    "scripts/schema-inventory.test.ts",
    "eslint.config.js",
    "docs/developers/conventions-data.md",
  ];
  const preserved = [
    "packages/payments/drizzle/0000_baseline.sql",
    "packages/country-es/test-fixtures/demo.json",
    "scripts/a1308/older-rename.mjs",
    "apps/server/scripts/demo-seed/seed.madrid-baseline.test.ts",
    "docs/developers/grants-retirement-audit.md",
  ];
  const write = (path, value) => {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), value);
  };
  try {
    execFileSync("git", ["init", "-q", root]);
    for (const path of [...consumers, ...preserved]) write(path, input);
    write("apps/unchanged.ts", "unchanged");
    write("apps/deleted.ts", input);
    symlinkSync("server", join(root, "apps/directory-link"));
    execFileSync("git", ["-C", root, "add", "."]);
    rmSync(join(root, "apps/deleted.ts"));
    write("apps/untracked.ts", input);
    process.chdir(root);
    vi.stubEnv("GIT_DIR", "/missing/foreign-git-dir");
    await import("./pa3-reconciliation-runs.mjs");
    for (const path of consumers) {
      const target =
        path === "packages/payments/src/schema/scheduled-runs.ts"
          ? "packages/payments/src/schema/reconciliation-runs.ts"
          : path;
      expect(readFileSync(target, "utf8")).toBe(renamed);
    }
    expect(existsSync("packages/payments/src/schema/scheduled-runs.ts")).toBe(false);
    for (const path of preserved) expect(readFileSync(path, "utf8")).toBe(input);
    expect(readFileSync("apps/untracked.ts", "utf8")).toBe(input);
    expect(readFileSync("apps/unchanged.ts", "utf8")).toBe("unchanged");
    vi.stubEnv("GIT_DIR", undefined);
    execFileSync("git", ["add", "-u"]);
    execFileSync("git", ["add", "packages/payments/src/schema/reconciliation-runs.ts"]);
    vi.resetModules();
    await import("./pa3-reconciliation-runs.mjs");
    expect(execFileSync("git", ["diff", "--name-only"], { encoding: "utf8" })).toBe("");
  } finally {
    process.chdir(originalCwd);
    vi.unstubAllEnvs();
    vi.resetModules();
    rmSync(root, { recursive: true, force: true });
  }
});
