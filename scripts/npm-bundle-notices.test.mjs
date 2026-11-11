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

it("walks past a manifest that only sets the module type to the package's own manifest", () => {
  const dir = mkdtempSync(join(tmpdir(), "waitron-notice-typed-"));
  try {
    const pkg = join(dir, "node_modules/typed-package");
    mkdirSync(join(pkg, "cjs"), { recursive: true });
    writeFileSync(join(pkg, "package.json"), '{"name":"typed-package","version":"4.5.6"}');
    writeFileSync(join(pkg, "LICENSE"), "Typed package licence text\n");
    writeFileSync(join(pkg, "cjs/package.json"), '{"type":"commonjs"}');
    writeFileSync(join(pkg, "cjs/index.js"), "exports.value = 1;\n");
    const content = notices.bundledNpmNotices([join(pkg, "cjs/index.js")]);
    expect(content).toContain("===== typed-package 4.5.6 — LICENSE =====");
    expect(content).toContain("Typed package licence text\n");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

it.each([
  ["stripe 23.1.0", "stripe", ["cjs/stripe.cjs.node.js", "esm/stripe.esm.node.js"]],
  ["nodemailer 10.3.1", "nodemailer", ["dist/cjs/nodemailer.js", "dist/esm/nodemailer.js"]],
])("emits %s's licence for its CommonJS and ESM entries", (label, name, entries) => {
  const pkg = realpathSync(join(ROOT, "apps/server/node_modules", name));
  for (const entry of entries) {
    const content = notices.bundledNpmNotices([join(pkg, entry)]);
    expect(
      content.match(new RegExp(`===== ${label.replaceAll(".", "\\.")} — LICENSE =====`, "g")),
    ).toHaveLength(1);
    expect(content).toContain(readFileSync(join(pkg, "LICENSE"), "utf8"));
  }
});

it("still leaves out a workspace source below a manifest that only sets the module type", () => {
  const dir = mkdtempSync(join(tmpdir(), "waitron-notice-workspace-typed-"));
  try {
    const pkg = join(dir, "node_modules/x");
    mkdirSync(join(pkg, "src"), { recursive: true });
    writeFileSync(join(pkg, "package.json"), '{"name":"@waitron/x","version":"0.0.0"}');
    writeFileSync(join(pkg, "LICENSE"), "Workspace licence text\n");
    writeFileSync(join(pkg, "src/package.json"), '{"type":"module"}');
    writeFileSync(join(pkg, "src/index.js"), "export const value = 1;\n");
    const content = notices.bundledNpmNotices([join(pkg, "src/index.js")]);
    expect(content).toContain("No bundled npm packages.");
    expect(content).not.toContain("@waitron/x");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
