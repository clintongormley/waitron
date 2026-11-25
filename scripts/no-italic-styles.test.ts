import { globSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, it } from "vitest";

const root = join(import.meta.dirname, "..");

it("keeps app and package styles upright", () => {
  const files = globSync("{apps,packages}/**/*.{css,ts,js,html}", {
    cwd: root,
    exclude: ["**/{node_modules,dist,build,coverage,test-results}/**", "**/*.test.*"],
    withFileTypes: true,
  });
  const offenders = files.filter((file) => {
    if (!file.isFile()) return false;
    const source = readFileSync(join(file.parentPath, file.name), "utf8");
    return (
      /\bfont-style\s*:\s*(?:italic|oblique)\b/i.test(source) ||
      /\bfont\s*:\s*(?:[\w-]+\s+)*(?:italic|oblique)\b/i.test(source)
    );
  });
  expect(offenders.map((file) => join(file.parentPath, file.name))).toEqual([]);
});
