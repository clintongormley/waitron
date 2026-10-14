import { spawnSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import process from "node:process";
import { afterAll, describe, expect, it, vi } from "vitest";

vi.setConfig({ testTimeout: 15_000 });

const REPO_ROOT = join(import.meta.dirname, "..");
const scratch = mkdtempSync(join(tmpdir(), "waitron-brand-build-"));
const inkscape = join(scratch, "inkscape.mjs");
writeFileSync(
  inkscape,
  `#!/usr/bin/env node
import { writeFileSync } from "node:fs";
if (process.argv.includes("--version")) console.log("test raster renderer");
else writeFileSync(process.argv[process.argv.indexOf("-o") + 1], "raster stub");
`,
  { mode: 0o755 },
);
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

function generate(css: string) {
  const fixture = mkdtempSync(join(scratch, "fixture-"));
  const brand = join(fixture, "packages", "ui", "brand");
  cpSync(join(REPO_ROOT, "packages", "ui", "brand"), brand, { recursive: true });
  const tokens = join(fixture, "packages", "ui-core", "src", "tokens");
  mkdirSync(tokens, { recursive: true });
  writeFileSync(join(tokens, "colors.css"), css);
  const result = spawnSync(process.execPath, [join(brand, "build-icons.mjs")], {
    cwd: fixture,
    env: { ...process.env, INKSCAPE: inkscape },
    encoding: "utf8",
    timeout: 10_000,
  });
  return { brand, result };
}

describe("brand generation reads the dark theme at run time", () => {
  it.each([
    { primary: "#123456", text: "#eceef2" },
    { primary: "#4c8dff", text: "#abcdef" },
  ])("uses $primary and $text from the media block", ({ primary, text }) => {
    const { brand, result } = generate(`:root {
  --wt-color-primary: #112233;
  --wt-color-text: #445566;
}
@media (prefers-color-scheme: dark) {
  :where([data-wt-theme-root]) {
    --wt-color-primary: ${primary};
    --wt-color-text: ${text};
  }
}
:where([data-theme="dark"]) {
  --wt-color-primary: #778899;
  --wt-color-text: #aabbcc;
}
`);
    expect({ status: result.status, stderr: result.stderr }).toEqual({ status: 0, stderr: "" });
    const dark = readFileSync(join(brand, "waitron-lockup-dark.svg"), "utf8");
    expect([...dark.matchAll(/<g fill="([^"]+)"/g)].map((m) => m[1])).toEqual([primary, text]);
    expect(readFileSync(join(brand, "public", "favicon.svg"), "utf8")).toContain(
      `@media (prefers-color-scheme: dark){.m{fill:${primary}}}`,
    );
    expect(readFileSync(join(brand, "waitron-lockup.svg"), "utf8")).toBe(
      readFileSync(join(REPO_ROOT, "packages", "ui", "brand", "waitron-lockup.svg"), "utf8"),
    );
  });

  it.each(["primary", "text"])("refuses a missing dark %s token before writing", (missing) => {
    const css = `@media (prefers-color-scheme: dark) {
  --wt-color-${missing === "primary" ? "text" : "primary"}: #123456;
}
`;
    const { brand, result } = generate(css);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain(`colors.css declares no dark --wt-color-${missing}`);
    expect(readFileSync(join(brand, "waitron-lockup-dark.svg"), "utf8")).toBe(
      readFileSync(join(REPO_ROOT, "packages", "ui", "brand", "waitron-lockup-dark.svg"), "utf8"),
    );
  });

  it("refuses a missing dark media block before writing", () => {
    const { brand, result } = generate(`:root {
  --wt-color-primary: #123456;
  --wt-color-text: #abcdef;
}
`);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("colors.css has no dark media block");
    expect(readFileSync(join(brand, "waitron-lockup-dark.svg"), "utf8")).toBe(
      readFileSync(join(REPO_ROOT, "packages", "ui", "brand", "waitron-lockup-dark.svg"), "utf8"),
    );
  });
});
