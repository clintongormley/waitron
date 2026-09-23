/* global document, customElements, getComputedStyle, KeyboardEvent */
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createServer } from "node:http";
import { mkdtemp, cp, readFile, writeFile, rm, realpath } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import process from "node:process";
import { promisify } from "node:util";
import { test } from "node:test";
import { build } from "esbuild";
import { chromium } from "playwright";
import axe from "axe-core";

const run = promisify(execFile);
const root = dirname(import.meta.dirname);
const command = (args, cwd = root) =>
  run("pnpm", args, { cwd, timeout: 90000, maxBuffer: 4 * 1024 * 1024 });

test("a packed release works in an independent browser consumer", { timeout: 170000 }, async () => {
  const dir = await mkdtemp(join(tmpdir(), "waitron-ui-consumer-"));
  let browser;
  let server;
  try {
    const source = JSON.parse(await readFile(join(root, "package.json"), "utf8"));
    await command(["pack", "--pack-destination", dir]);
    const tarball = `waitron-ui-core-${source.version}.tgz`;
    const { stdout } = await run("tar", ["-xOf", join(dir, tarball), "package/package.json"], {
      timeout: 10000,
    });
    const packed = JSON.parse(stdout);
    assert.equal(
      packed.exports["."].import,
      "./dist/index.js",
      "tarball must expose built JavaScript",
    );
    assert.equal(packed.exports["."].types, "./dist/types/index.d.ts");
    assert.deepEqual(packed.dependencies ?? {}, {});
    assert.deepEqual(packed.peerDependencies, { lit: "^3.2.0" });
    const files = (await run("tar", ["-tf", join(dir, tarball)], { timeout: 10000 })).stdout
      .split("\n")
      .filter(Boolean);
    assert(
      files.every((name) => /^(package\/(dist\/|package.json$|README.md$))/.test(name)),
      files.join("\n"),
    );
    assert(
      !files.some((name) => /\.test\.|test-helpers|\.ts$/.test(name) && !name.endsWith(".d.ts")),
    );
    await cp(join(root, "test/consumer"), dir, { recursive: true });
    const lit = JSON.parse(await readFile(join(root, "node_modules/lit/package.json"), "utf8"));
    await writeFile(
      join(dir, "package.json"),
      JSON.stringify({
        private: true,
        type: "module",
        dependencies: { "@waitron/ui-core": `file:./${tarball}`, lit: lit.version },
      }),
    );
    await command(
      ["install", "--ignore-workspace", "--no-frozen-lockfile", "--ignore-scripts"],
      dir,
    );
    const installed = join(dir, "node_modules/@waitron/ui-core");
    assert(
      (await realpath(installed)).startsWith(await realpath(dir)),
      "package must not link back to the workspace",
    );
    for (const notice of ["LICENSE", "LICENSE-GRANTS.md"]) {
      assert.equal(
        await readFile(join(installed, "dist", notice), "utf8"),
        await readFile(join(root, "../..", notice), "utf8"),
      );
    }
    for (const name of ["colors", "structure"]) {
      assert.equal(
        await readFile(join(installed, `dist/tokens/${name}.css`), "utf8"),
        await readFile(join(root, `src/tokens/${name}.css`), "utf8"),
      );
    }
    await command(["exec", "tsc", "-p", join(dir, "tsconfig.json")]);
    const options = {
      absWorkingDir: dir,
      entryPoints: ["main.ts", "input-only.ts"],
      outdir: join(dir, "out"),
      bundle: true,
      format: "esm",
      platform: "browser",
      metafile: true,
      logLevel: "silent",
    };
    const result = await build(options);
    for (const path of Object.keys(result.metafile.inputs))
      assert(!path.includes(root), `workspace import: ${path}`);
    const assets = new Map([
      ["/", ["text/html", await readFile(join(dir, "index.html"))]],
      [
        "/input-only",
        [
          "text/html",
          (await readFile(join(dir, "index.html"), "utf8")).replace("/main.js", "/input-only.js"),
        ],
      ],
      ["/main.js", ["text/javascript", await readFile(join(dir, "out/main.js"))]],
      ["/input-only.js", ["text/javascript", await readFile(join(dir, "out/input-only.js"))]],
    ]);
    server = createServer((req, res) => {
      const asset = assets.get(req.url);
      res.writeHead(asset ? 200 : 404, { "Content-Type": asset?.[0] ?? "text/plain" });
      res.end(asset?.[1] ?? "Not found");
    });
    await new Promise((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", resolve);
    });
    const origin = `http://127.0.0.1:${server.address().port}`;
    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const page = await context.newPage();
    page.setDefaultTimeout(10000);
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(origin);
    await page.waitForSelector('body[data-ready="true"]');
    const email = page.locator("#email input");
    const password = page.locator("#password input");
    assert.equal(await email.getAttribute("name"), "email");
    assert.equal(await email.getAttribute("autocomplete"), "email");
    assert.equal(await password.getAttribute("name"), "password");
    assert.equal(await password.getAttribute("autocomplete"), "current-password");
    await page.locator("#submit button").click();
    await page.waitForSelector('wt-form-error-summary [role="alert"]');
    assert.equal(await page.locator("wt-form-error-summary li").count(), 2);
    assert.equal(await email.getAttribute("aria-invalid"), "true");
    assert.equal(await password.getAttribute("aria-invalid"), "true");
    assert(await email.evaluate((el) => el.getRootNode().activeElement === el));
    await email.fill("owner@venue.example");
    await password.fill("example password");
    await page.locator("#reveal button").click();
    assert.equal(await password.getAttribute("type"), "text");
    assert.equal(await password.inputValue(), "example password");
    assert.equal(await page.locator("#reveal button").getAttribute("aria-label"), "Hide password");
    await password.press("Enter");
    await page.waitForFunction(() => document.querySelector("#submissions").textContent === "1");
    assert.equal(await page.locator('wt-form-error-summary [role="alert"]').count(), 0);
    for (const modifier of ["Shift", "Alt", "Control", "Meta"])
      await password.press(`${modifier}+Enter`);
    await password.evaluate((el) =>
      el.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "Enter",
          isComposing: true,
          bubbles: true,
          composed: true,
        }),
      ),
    );
    assert.equal(await page.locator("#submissions").textContent(), "1");
    await page.addScriptTag({ content: axe.source });
    assert.deepEqual(await page.evaluate(async () => (await globalThis.axe.run()).violations), []);
    await password.fill("");
    await page.locator("#submit button").click();
    await page.waitForSelector('wt-form-error-summary [role="alert"]');
    const colours = [];
    for (const theme of ["light", "dark"]) {
      await page.locator("#app").evaluate((el, theme) => {
        el.dataset.theme = theme;
      }, theme);
      await page.mouse.move(-1, -1);
      colours.push(
        await page.locator("#app").evaluate((el) => getComputedStyle(el).backgroundColor),
      );
      await page.locator("#nested-theme").evaluate((el, theme) => {
        el.dataset.theme = theme === "light" ? "dark" : "light";
      }, theme);
      const nestedColour = await page
        .locator("#nested-theme")
        .evaluate((el) => getComputedStyle(el).color);
      assert.notEqual(
        nestedColour,
        await page.locator("#app").evaluate((el) => getComputedStyle(el).color),
        "shadow-root tokens resolve independently of the outer theme",
      );
      const violations = await page.evaluate(async () => (await globalThis.axe.run()).violations);
      assert.deepEqual(violations, []);
      if (process.env.UI_PACKAGE_SCREENSHOTS)
        await page.screenshot({
          path: join(process.env.UI_PACKAGE_SCREENSHOTS, `${theme}.png`),
          fullPage: true,
        });
    }
    assert.notEqual(colours[0], colours[1]);
    assert(!colours.includes("rgba(0, 0, 0, 0)"));
    assert.deepEqual(errors, []);
    await context.close();
    const isolated = await browser.newContext();
    const single = await isolated.newPage();
    await single.goto(`${origin}/input-only`);
    await single.waitForSelector('body[data-ready="true"]');
    assert.equal(await single.evaluate(() => !!customElements.get("wt-input")), true);
    assert.equal(await single.evaluate(() => !!customElements.get("wt-card")), false);
    assert.equal(await single.evaluate(() => !!customElements.get("wt-button")), false);
    await isolated.close();
    await rm(join(installed, "dist/components/wt-input.js"));
    await assert.rejects(build(options), /Could not resolve/);
  } finally {
    try {
      await browser?.close();
    } finally {
      if (server) {
        server.closeAllConnections();
        await new Promise((resolve) => server.close(resolve));
      }
      await rm(dir, { recursive: true, force: true });
    }
  }
});
