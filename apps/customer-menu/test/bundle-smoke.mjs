import assert from "node:assert/strict";
import { log } from "node:console";
import { once } from "node:events";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { fileURLToPath, URL } from "node:url";
import { chromium } from "playwright";
import "tsx";
import { menuAppearances, photoReference, published } from "./published-menu.ts";

const { readDefaults } = await import("@waitron/ui-core/theme");
const { prepareMenuAppearance } = await import("../src/customer-menu-appearance.ts");
const defaults = readDefaults(
  await readFile(new URL(import.meta.resolve("@waitron/ui-core/tokens/colors.css")), "utf8"),
  await readFile(new URL(import.meta.resolve("@waitron/ui-core/tokens/structure.css")), "utf8"),
);
const { createCustomerMenuApp } = await import("../../server/src/customer-menu-public.ts");
const { samplePreparedImage } = await import("../../../packages/media/src/testing/sample-image.ts");
const path = "/lunch/en";
const icons = ["favicon.ico", "favicon.svg", "apple-touch-icon.png"].map(
  (name) => `/_customer-menu/${name}`,
);
const photoUrl = `/_customer-menu/photos/v1/${photoReference}/display/5000-5000-100.webp`;
const snapshot = {
  address: "lunch",
  defaultLanguage: "en",
  photos: "large",
  appearance: prepareMenuAppearance(defaults, menuAppearances.dark),
  menu: published().menu,
  photoUrls: { [photoReference]: photoUrl },
};
const releasePhoto = Promise.withResolvers();
const photoBytes = (await samplePreparedImage({ width: 24 })).bytes;
const app = createCustomerMenuApp(
  fileURLToPath(new URL("../dist", import.meta.url)),
  {
    read: async () => ({ menus: new Map([["lunch", new Map([["en", snapshot]])]]) }),
    readPhoto: async (path) => {
      if (path !== photoUrl) return null;
      await releasePhoto.promise;
      return photoBytes;
    },
  },
  async () => true,
  () => {},
);
const server = createServer(async (req, res) => {
  const response = await app.request(req.url, { method: req.method });
  res.writeHead(response.status, Object.fromEntries(response.headers));
  res.end(Buffer.from(await response.arrayBuffer()));
});
server.listen(0, "127.0.0.1");
await once(server, "listening");
const origin = `http://127.0.0.1:${server.address().port}`;
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
    if (request.method() === "GET" && url.origin === origin && url.search === "")
      return route.continue();
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
    await new Promise((resolve) => server.close(resolve));
  }
}
