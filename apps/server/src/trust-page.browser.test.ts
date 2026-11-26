import { afterAll, beforeAll, expect, it } from "vitest";
import { chromium, type Browser, type BrowserContextOptions, type Page } from "playwright";
import { renderTrustPage, type TrustPageInput } from "./trust-page.js";
import { DEVICE_HELP, type DeviceId } from "./trust-page-devices.js";
import { CONNECTION_DEVICE_ES } from "./connection-bootstrap-strings.js";
import { TRUST_PAGE_WORDS } from "./i18n/trust-page.js";

let browser: Browser | undefined;
beforeAll(async () => {
  browser = await chromium.launch({ headless: true });
});
afterAll(async () => {
  await browser?.close();
});

const base: TrustPageInput = {
  reachUrls: ["https://waitron.local"],
  caAvailable: true,
  caDownloadPath: "/ca.crt",
  httpsUrl: "https://waitron.local",
  device: "linux",
};
const TOUCH: BrowserContextOptions = { hasTouch: true, isMobile: true };
const DESKTOP: BrowserContextOptions = { hasTouch: false, isMobile: false };

async function withPage(
  options: BrowserContextOptions,
  input: TrustPageInput,
  check: (page: Page) => Promise<void>,
  init?: () => void,
): Promise<void> {
  const context = await browser!.newContext(options);
  try {
    if (init) await context.addInitScript(init);
    const page = await context.newPage();
    await page.route("http://waitron.local/**", (route) =>
      route.fulfill({ contentType: "text/html", body: renderTrustPage(input) }),
    );
    await page.goto("http://waitron.local/setup/trust");
    await check(page);
  } finally {
    await context.close();
  }
}

async function expectStepsFor(page: Page, device: DeviceId, other: DeviceId): Promise<void> {
  const help = DEVICE_HELP[device];
  expect(await page.locator("h2").allTextContents()).toEqual([
    "1. Remove any old Waitron certificate",
    "2. Get the certificate",
    `3. ${help.heading}`,
    "4. Open Waitron",
  ]);
  for (const [section, lines] of [
    ["1. Remove", help.removal],
    ["3. Install", help.install],
  ] as const)
    expect(
      await page
        .locator("section", { hasText: section })
        .locator("li")
        .evaluateAll((items) => items.map((item) => item.innerHTML)),
    ).toEqual(lines);
  const summaries = await page.locator("details.others details summary").allTextContents();
  expect(summaries).toContain(DEVICE_HELP[other].summary);
  expect(summaries).not.toContain(help.summary);
  expect(await page.getByRole("link", { name: "Download the certificate" }).isVisible()).toBe(true);
}

it("shows a touch device guessed as Linux the Android steps as its own", () =>
  withPage(TOUCH, base, (page) => expectStepsFor(page, "android", "linux")));

it("replaces the Spanish Linux guide with Spanish Android steps on a touch device", () =>
  withPage(TOUCH, { ...base, locale: "es" }, async (page) => {
    const android = CONNECTION_DEVICE_ES.android;
    expect(await page.locator("#steps h2").allTextContents()).toContain(`3. ${android.heading}`);
    expect(await page.locator("#steps section").first().textContent()).toContain(
      android.removal[0],
    );
    expect(await page.getByRole("link", { name: TRUST_PAGE_WORDS.es.download }).isVisible()).toBe(
      true,
    );
  }));

it("leaves a Linux PC its own steps", () =>
  withPage(DESKTOP, base, (page) => expectStepsFor(page, "linux", "android")));

it("leaves the guessed steps in place when the page's script cannot run", () =>
  withPage({ ...TOUCH, javaScriptEnabled: false }, base, (page) =>
    expectStepsFor(page, "linux", "android"),
  ));

it("leaves a Linux laptop with a touchscreen and a mouse its own steps", () =>
  withPage(
    DESKTOP,
    base,
    async (page) => {
      expect(await page.evaluate("navigator.maxTouchPoints")).toBe(10);
      expect(await page.evaluate("matchMedia('(pointer: coarse)').matches")).toBe(false);
      await expectStepsFor(page, "linux", "android");
    },
    () => Object.defineProperty(navigator, "maxTouchPoints", { get: () => 10 }),
  ));

it("leaves a coarse pointer with no touchscreen the Linux steps", () =>
  withPage(
    TOUCH,
    base,
    async (page) => {
      expect(await page.evaluate("matchMedia('(pointer: coarse)').matches")).toBe(true);
      await expectStepsFor(page, "linux", "android");
    },
    () => Object.defineProperty(navigator, "maxTouchPoints", { get: () => 0 }),
  ));

it("leaves a touch device guessed as Firefox on Linux those steps", () =>
  withPage(TOUCH, { ...base, device: "firefox-linux" }, (page) =>
    expectStepsFor(page, "firefox-linux", "android"),
  ));
