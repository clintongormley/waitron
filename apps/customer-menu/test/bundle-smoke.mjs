import assert from "node:assert/strict";
import { log } from "node:console";
import { readFile } from "node:fs/promises";
import { fileURLToPath, URL } from "node:url";
import { chromium } from "playwright";
import { preview } from "vite";
import "tsx";
import { menuAppearances, photoReference, published } from "./published-menu.ts";

const { readDefaults } = await import("@waitron/ui-core/theme");
const { prepareMenuAppearance } = await import("../src/customer-menu-appearance.ts");
const defaults = readDefaults(
  await readFile(new URL(import.meta.resolve("@waitron/ui-core/tokens/colors.css")), "utf8"),
  await readFile(new URL(import.meta.resolve("@waitron/ui-core/tokens/structure.css")), "utf8"),
);
const template = await readFile(new URL("../dist/index.html", import.meta.url), "utf8");
const slot = '<script type="application/json" id="customer-menu-data">';
assert.ok(template.includes(slot), "built menu must have a snapshot slot");
const path = "/lunch/en";
const icons = ["favicon.ico", "favicon.svg", "apple-touch-icon.png"].map(
  (name) => `/_customer-menu/${name}`,
);
const photoUrl = "/fixture/roast-pepper.svg";
const snapshot = {
  address: "lunch",
  defaultLanguage: "en",
  photos: "large",
  appearance: prepareMenuAppearance(defaults, menuAppearances.dark),
  menu: published().menu,
  photoUrls: { [photoReference]: photoUrl },
};
const html = template.replace(
  slot,
  () => slot + JSON.stringify(snapshot).replaceAll("<", "\\u003c"),
);
const server = await preview({
  root: fileURLToPath(new URL("..", import.meta.url)),
  preview: { host: "127.0.0.1", port: 0, strictPort: true },
});
const origin = new URL(server.resolvedUrls.local[0]).origin;
const releasePhoto = Promise.withResolvers();
let browser;
try {
  browser = await chromium.launch({ timeout: 15_000 });
  const page = await browser.newPage();
  page.setDefaultTimeout(10_000);
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("response", (response) => {
    if (response.status() >= 400) errors.push(`${response.status()} ${response.url()}`);
  });
  await page.route("**/*", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (request.method() === "GET" && url.origin === origin && url.search === "") {
      if (url.pathname === path) return route.fulfill({ contentType: "text/html", body: html });
      if (url.pathname.startsWith("/_customer-menu/assets/") || icons.includes(url.pathname))
        return route.continue();
      if (url.pathname === photoUrl) {
        await releasePhoto.promise;
        return route.fulfill({
          contentType: "image/svg+xml",
          body: '<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"/>',
        });
      }
    }
    errors.push(`Unexpected customer menu request: ${request.method()} ${url}`);
    return route.abort();
  });
  const photoRequest = page.waitForRequest(origin + photoUrl);
  await page.goto(origin + path, { waitUntil: "domcontentloaded", timeout: 15_000 });
  await page
    .getByRole("main")
    .getByRole("heading", { level: 1, name: "Lunch for guests" })
    .waitFor();
  await page.getByRole("button", { name: "Roast pepper" }).waitFor();
  const article = page.locator("customer-menu-page article");
  assert.equal(
    await article.evaluate(
      (node) => node.ownerDocument.defaultView.getComputedStyle(node).backgroundColor,
    ),
    "rgb(31, 41, 40)",
  );
  assert.deepEqual(
    await page
      .locator('link[rel="icon"], link[rel="apple-touch-icon"]')
      .evaluateAll((links) => links.map((link) => link.getAttribute("href"))),
    icons,
  );
  for (const icon of icons) {
    const response = await page.request.get(origin + icon);
    assert(response.ok(), icon);
    assert.match(response.headers()["content-type"], /^image\//, icon);
  }
  const photo = page.locator(`img[src="${photoUrl}"]`);
  await photo.waitFor();
  await photo.evaluate((image) => {
    if (image.complete) throw new Error("The photo loaded before it was released");
  });
  await photoRequest;
  releasePhoto.resolve();
  await photo.evaluate((image) => image.decode());
  assert.deepEqual(errors, []);
  log("Built customer menu rendered before its published photo was released.");
} finally {
  releasePhoto.resolve();
  try {
    await browser?.close();
  } finally {
    await server.close();
  }
}
