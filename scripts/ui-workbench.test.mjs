import { spawnSync } from "node:child_process";
import { fileURLToPath, URL } from "node:url";
import { expect, test } from "vitest";

test("the documented UI workbench command reaches Vite", { timeout: 35000 }, () => {
  // Asking for help exercises the package script without opening a development server.
  const result = spawnSync("pnpm", ["--filter", "@waitron/ui", "run", "dev", "--help"], {
    cwd: fileURLToPath(new URL("..", import.meta.url)),
    encoding: "utf8",
    timeout: 30000,
  });
  expect(result.error).toBeUndefined();
  expect(result.status, result.stderr).toBe(0);
  expect(result.stdout).toMatch(/vite\/\d/);
});
