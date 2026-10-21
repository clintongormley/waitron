import { afterAll, beforeAll, expect, it } from "vitest";
import { chromium, type Browser, type Page } from "playwright";
import { renderTrustPage, type TrustPageInput } from "./trust-page.js";
import { connectionLocale } from "./connection-bootstrap-page.js";
import type { BoxTlsInspection } from "./box-tls-repair.js";

let browser: Browser | undefined;
beforeAll(async () => {
  browser = await chromium.launch({ headless: true });
});
afterAll(async () => {
  await browser?.close();
});
const retained: BoxTlsInspection = {
  state: "repair-required",
  trust: "retained",
  caAvailable: true,
};
const base: TrustPageInput = {
  reachUrls: ["https://waitron.local:8443", "https://192.168.1.50:8443"],
  httpsUrl: "https://waitron.local:8443",
  caDownloadPath: "/ca.crt",
  caAvailable: true,
  device: "macos",
};
async function open(
  page: Page,
  status = retained,
  reply: (
    request: import("playwright").Request,
  ) => Promise<{ status: number; body: unknown }> = async () => ({
    status: 200,
    body: { ...status, state: "healthy" },
  }),
  extra = {},
) {
  const html = renderTrustPage({ ...base, connection: status, ...extra });
  await page.route("http://waitron.local:8080/**", async (route) => {
    if (route.request().method() === "POST") {
      const answer = await reply(route.request());
      await route.fulfill({ status: answer.status, json: answer.body });
    } else await route.fulfill({ contentType: "text/html", body: html });
  });
  await page.goto("http://waitron.local:8080/setup/connection");
}

it("repairs by a credential-free empty request and keeps the retained certificate instructions", async () => {
  const page = await browser!.newPage();
  try {
    const calls: import("playwright").Request[] = [];
    await page
      .context()
      .addCookies([{ name: "private", value: "owner", url: "http://waitron.local:8080" }]);
    await open(page, retained, async (request) => {
      calls.push(request);
      return { status: 200, body: { ...retained, state: "healthy" } };
    });
    expect(await page.locator("#connection-repair").count()).toBe(1);
    await page.locator("#connection-repair").press("Enter");
    await expect
      .poll(() => page.locator("#connection-status").textContent())
      .toBe("Your secure connection is ready.");
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url()).toBe("http://waitron.local:8080/setup-api/connection/repair");
    expect(calls[0]!.postData()).toBeNull();
    expect(calls[0]!.headers()).not.toHaveProperty("cookie");
    expect(calls[0]!.headers()).not.toHaveProperty("authorization");
    expect(await page.locator("#connection-repair").isVisible()).toBe(false);
    expect(await page.locator("#connection-continue").isVisible()).toBe(true);
    expect(await page.locator("#connection-continue").getAttribute("href")).toBe(base.httpsUrl);
    expect(await page.locator("#trust-retained").isVisible()).toBe(true);
    expect(await page.locator("#trust-new").isVisible()).toBe(false);
    expect(await page.locator("input,form,textarea,select").count()).toBe(0);
  } finally {
    await page.close();
  }
});

it.each([403, 503])(
  "a %s refusal stays retryable and never displays server details",
  async (status) => {
    const page = await browser!.newPage();
    try {
      let attempts = 0;
      await open(page, retained, async () =>
        ++attempts === 1
          ? { status, body: { error: "private filesystem details" } }
          : { status: 200, body: { ...retained, state: "healthy" } },
      );
      expect(await page.locator("#connection-repair").count()).toBe(1);
      await page.locator("#connection-repair").click();
      await expect
        .poll(() => page.locator("#connection-error").textContent())
        .toBe("The connection could not be set up. Try again.");
      expect(await page.locator("body").textContent()).not.toContain("private filesystem details");
      expect(await page.locator("#connection-repair").isEnabled()).toBe(true);
      await page.locator("#connection-repair").click();
      await expect
        .poll(() => page.locator("#connection-status").textContent())
        .toBe("Your secure connection is ready.");
      expect(attempts).toBe(2);
      expect(await page.locator("#connection-error").textContent()).toBe("");
    } finally {
      await page.close();
    }
  },
);

it("holds the action while its request is pending then explains a new trust installation", async () => {
  const page = await browser!.newPage();
  let release: () => void = () => {};
  const pending = new Promise<void>((resolve) => {
    release = resolve;
  });
  try {
    await open(
      page,
      { state: "repair-required", trust: "new-required", caAvailable: false },
      async () => {
        await pending;
        return {
          status: 200,
          body: {
            state: "healthy",
            trust: "new-required",
            caAvailable: true,
            fingerprint: "AA:BB",
          },
        };
      },
    );
    expect(await page.locator("#connection-repair").count()).toBe(1);
    await page.locator("#connection-repair").click();
    await expect.poll(() => page.locator("#connection-repair").isDisabled()).toBe(true);
    expect(await page.locator("#connection-status").textContent()).toBe(
      "Setting up the connection…",
    );
    expect(await page.locator("#connection-continue").isVisible()).toBe(false);
    release();
    await expect.poll(() => page.locator("#connection-continue").isVisible()).toBe(true);
    expect(await page.locator("#trust-new").isVisible()).toBe(true);
    expect(await page.locator("#trust-retained").isVisible()).toBe(false);
    expect(await page.locator("#connection-download").isVisible()).toBe(true);
    expect(await page.locator("#connection-fingerprint").textContent()).toBe("AA:BB");
  } finally {
    release();
    await page.close();
  }
});

it("does not call a nonhealthy reply a completed connection", async () => {
  const page = await browser!.newPage();
  try {
    await open(page, retained, async () => ({
      status: 200,
      body: { state: "refused", trust: "retained", caAvailable: false },
    }));
    expect(await page.locator("#connection-repair").count()).toBe(1);
    await page.locator("#connection-repair").click();
    await expect
      .poll(() => page.locator("#connection-error").textContent())
      .toBe("The connection could not be set up. Try again.");
    expect(await page.locator("#connection-continue").isVisible()).toBe(false);
    expect(await page.locator("#connection-repair").isEnabled()).toBe(true);
  } finally {
    await page.close();
  }
});

it.each([
  [undefined, "en"],
  ["fr-FR", "en"],
  ["en;q=0.4,es-ES;q=0.9", "es"],
  ["es;q=0,en-GB;q=0.8", "en"],
  ["es-ES", "es"],
])("uses installed-language preferences for %s", (header, want) => {
  expect(connectionLocale(header)).toBe(want);
});
