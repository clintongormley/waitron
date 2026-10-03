import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { URL, fileURLToPath } from "node:url";
import { expect, it } from "vitest";
import * as notices from "./npm-bundle-notices.mjs";

const ROOT = fileURLToPath(new URL("..", import.meta.url));

it("emits the licence of a package that Vite put in a JavaScript chunk", () => {
  const lit = realpathSync(join(ROOT, "apps/till/node_modules/lit/index.js"));
  const emitted = [];
  const plugin = notices.viteNpmNotices?.();
  plugin?.generateBundle?.call(
    { emitFile: (asset) => emitted.push(asset) },
    {},
    { "assets/index.js": { type: "chunk", modules: { [lit]: {} } } },
  );
  expect(emitted).toHaveLength(1);
  expect(emitted[0].source).toContain("lit 3.3.3");
  expect(emitted[0].source).toContain(
    readFileSync(join(ROOT, "apps/till/node_modules/lit/LICENSE"), "utf8"),
  );
});

it("leaves workspace sources and virtual modules out of the npm notice", () => {
  const content = notices.bundledNpmNotices([
    join(ROOT, "apps/till/src/till-app.ts"),
    "\0vite/runtime",
  ]);
  expect(content).toContain("No bundled npm packages.");
  expect(content).not.toContain("@waitron/till");
});

it("copies the pinned upstream licence when a published package has none", () => {
  const qrcode = realpathSync(
    join(ROOT, "apps/till/node_modules/qrcode-generator/dist/qrcode.mjs"),
  );
  const content = notices.bundledNpmNotices([qrcode]);
  expect(content).toContain("qrcode-generator 2.0.4 — upstream licence");
  expect(content).toContain(
    readFileSync(join(ROOT, "deploy/third-party/npm-fallback/qrcode-generator@2.0.4.txt"), "utf8"),
  );
});

it("refuses a bundled package with no local or pinned licence", () => {
  const dir = mkdtempSync(join(tmpdir(), "waitron-notice-missing-"));
  try {
    const pkg = join(dir, "node_modules/unknown-package");
    mkdirSync(pkg, { recursive: true });
    writeFileSync(join(pkg, "package.json"), '{"name":"unknown-package","version":"1.2.3"}');
    writeFileSync(join(pkg, "index.js"), "export const value = 1;\n");
    expect(() => notices.bundledNpmNotices([join(pkg, "index.js")])).toThrow(
      "No licence notices found for: unknown-package@1.2.3",
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

it("lists a bundled package only once when several modules use it", () => {
  const lit = realpathSync(join(ROOT, "apps/till/node_modules/lit/index.js"));
  const content = notices.bundledNpmNotices([lit, lit]);
  expect(content.match(/===== lit 3\.3\.3 — LICENSE =====/g)).toHaveLength(1);
});
