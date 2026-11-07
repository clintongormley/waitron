import assert from "node:assert/strict";
import { log } from "node:console";
import { access } from "node:fs/promises";
import { fileURLToPath, URL } from "node:url";
import { chromium } from "playwright";
import { preview } from "vite";

await access(new URL("../dist/index.html", import.meta.url));
const server = await preview({
  root: fileURLToPath(new URL("..", import.meta.url)),
  preview: { host: "127.0.0.1", port: 0, strictPort: true },
});
let browser;
try {
  browser = await chromium.launch({ timeout: 15_000 });
  const page = await browser.newPage({ locale: "en-GB" });
  page.setDefaultTimeout(10_000);
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("response", (response) => {
    if (response.status() >= 400) errors.push(`${response.status()} ${response.url()}`);
  });
  const answers = {
    "/setup-api/status": { provisioned: false, environment: "preproduction", needs: [] },
    "/setup-api/discovery": { caDownloadAvailable: true },
    "/setup-api/first-setup/status": { claimed: false },
  };
  await page.route("**/setup-api/**", async (route) => {
    const request = route.request();
    const answer = answers[new URL(request.url()).pathname];
    if (request.method() !== "GET" || answer === undefined) {
      errors.push(`Unexpected setup request: ${request.method()} ${request.url()}`);
      await route.abort();
    } else await route.fulfill({ json: answer });
  });
  await page.goto(server.resolvedUrls.local[0], { timeout: 15_000 });
  await page.getByRole("heading", { name: "Is this page secure?", exact: true }).waitFor();
  await page.getByRole("button", { name: "Continue to setup", exact: true }).click();
  await page.getByRole("heading", { name: "Set up this Waitron server", exact: true }).waitFor();
  assert.deepEqual(errors, []);
  log("Built setup bundle rendered and advanced to the setup choices.");
} finally {
  try {
    await browser?.close();
  } finally {
    await server.close();
  }
}
