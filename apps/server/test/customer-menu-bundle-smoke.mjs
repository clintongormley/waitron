import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { log } from "node:console";
import { once } from "node:events";
import { createServer } from "node:http";
import { fileURLToPath, URL } from "node:url";
import { chromium } from "playwright";
import "tsx";
const { menuAppearances, photoReference, published } =
  await import("@waitron/customer-menu/testing");
const { prepareMenuAppearance } = await import("@waitron/customer-menu/appearance");
const { samplePreparedImage } = await import("@waitron/media/testing/sample-image.js");
const { createCustomerMenuApp } = await import("../src/customer-menu-public.ts");
const { SERVER_THEME_DEFAULTS } = await import("../src/theme-defaults.ts");
const path = "/lunch/en";
const icons = ["favicon.ico", "favicon.svg", "apple-touch-icon.png"].map(
  (name) => `/_customer-menu/${name}`,
);
const photoUrl = `/_customer-menu/photos/v1/${photoReference}/display/5000-5000-100.webp`;
const snapshot = {
  address: "lunch",
  defaultLanguage: "en",
  photos: "large",
  appearance: prepareMenuAppearance(SERVER_THEME_DEFAULTS, menuAppearances.dark),
  menu: published().menu,
  photoUrls: { [photoReference]: photoUrl },
};
const releasePhoto = Promise.withResolvers();
const photoBytes = (await samplePreparedImage({ width: 24 })).bytes;
const app = createCustomerMenuApp(
  fileURLToPath(new URL("../../customer-menu/dist", import.meta.url)),
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
  page.on("requestfailed", (request) =>
    errors.push(`${request.url()} ${request.failure()?.errorText}`),
  );
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
