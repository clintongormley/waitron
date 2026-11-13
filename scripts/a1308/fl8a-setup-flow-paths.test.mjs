import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { expect, it, vi } from "vitest";

it("moves setup path literals in tests and named helpers once, leaving other sources and prose alone", async () => {
  const originalCwd = process.cwd();
  const root = mkdtempSync(join(tmpdir(), "fl8a-paths-"));
  for (const key of Object.keys(process.env))
    if (key.startsWith("GIT_")) vi.stubEnv(key, undefined);
  const paths = [
    ["first-setup.json", "flows/setup/record.json"],
    ["first-setup-node-key.json", "flows/setup/node-key.json"],
    ["module-operation-public.json", "flows/setup/public-evidence.json"],
    ["fiscal-readiness.json", "flows/setup/readiness.json"],
    ["setup-operation.json", "flows/setup/operation.json"],
    ["first-fiscal-documents", "flows/setup/documents"],
    ["configuration-import.json", "flows/setup/import/marker.json"],
    ["configuration-import.artifact", "flows/setup/import/artifact"],
    ["configuration-import.key", "flows/setup/import/key"],
    ["first-setup-start-again-guesses.json", "flows/setup/start-again-guesses.json"],
  ];
  const unchanged = '// "first-setup.json" stays in this comment\nconst count = 1;\n';
  const input =
    unchanged +
    paths.map(([oldPath]) => `use("${oldPath}");`).join("\n") +
    "\nuse(`first-setup.json/${part}/configuration-import.key/${last}/fiscal-readiness.json`);";
  const expected =
    unchanged +
    paths.map(([, newPath]) => `use("${newPath}");`).join("\n") +
    "\nuse(`flows/setup/record.json/${part}/flows/setup/import/key/${last}/flows/setup/readiness.json`);";
  const selected = [
    "apps/example.test.ts",
    "packages/example.test.ts",
    "apps/server/test/start-again-deleted.ts",
    "apps/server/test/start-again-held-fixture.ts",
    "apps/server/test/stop-route-server.ts",
    "packages/provisioning/test/start-again-attempt.ts",
    "packages/provisioning/test/recovery-document-file.ts",
    "scripts/waitron-sh.test.mjs",
  ];
  const skipped = ["apps/example.ts", "scripts/other.test.ts", "docs/example.md"];
  const write = (path, text) => {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), text);
  };
  try {
    execFileSync("git", ["init", "-q", root]);
    for (const path of [...selected, ...skipped]) write(path, input);
    write("apps/unchanged.test.ts", unchanged);
    execFileSync("git", ["-C", root, "add", "."]);
    process.chdir(root);
    await import("./fl8a-setup-flow-paths.mjs");
    for (const path of selected) expect(readFileSync(path, "utf8"), path).toBe(expected);
    for (const path of skipped) expect(readFileSync(path, "utf8"), path).toBe(input);
    expect(readFileSync("apps/unchanged.test.ts", "utf8")).toBe(unchanged);
    execFileSync("git", ["add", "."]);
    vi.resetModules();
    await import("./fl8a-setup-flow-paths.mjs");
    expect(execFileSync("git", ["diff", "--name-only"], { encoding: "utf8" })).toBe("");
  } finally {
    process.chdir(originalCwd);
    vi.unstubAllEnvs();
    vi.resetModules();
    rmSync(root, { recursive: true, force: true });
  }
});
