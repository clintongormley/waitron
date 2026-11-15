import { createRequire } from "node:module";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { expect, it } from "vitest";

const require = createRequire(new URL("../apps/till/package.json", import.meta.url));
const browserRequire = createRequire(require.resolve("@vitest/browser-playwright"));
const { resolveScreenshotPath } = await import(browserRequire.resolve("@vitest/browser"));

it("writes distinct screenshots for long names sharing a prefix and retains explicit paths", () => {
  const root = mkdtempSync(join(tmpdir(), "waitron-screenshot-"));
  try {
    const config = { root, browser: {} };
    const file = join(root, "example.test.ts");
    const paths = ["first", "second"].map((suffix) =>
      resolveScreenshotPath(file, "waiting-".repeat(60) + suffix + ".png", config),
    );
    for (const [index, path] of paths.entries()) {
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, String(index));
    }
    expect(paths.map((path) => readFileSync(path, "utf8"))).toEqual(["0", "1"]);
    expect(resolveScreenshotPath(file, "small.png", config)).toBe(
      join(root, "__screenshots__", "example.test.ts", "small.png"),
    );
    expect(resolveScreenshotPath(file, "waiting-".repeat(60), config, "chosen.png")).toBe(
      join(root, "chosen.png"),
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
