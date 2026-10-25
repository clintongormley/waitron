import { readFile } from "node:fs/promises";
import { afterAll, beforeAll, expect, it } from "vitest";
import { chromium, type Browser, type Page } from "playwright";
import { renderTrustPage, type TrustPageInput } from "./trust-page.js";
import { connectionLocale } from "./connection-bootstrap-page.js";
import { CONNECTION_TEXT, CONNECTION_DEVICE_ES } from "./connection-bootstrap-strings.js";
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
      .toBe("Certificate ready.");
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
        .toBe(
          "The connection could not be set up. Retry to run the repair again. If it keeps failing, stop here: this page cannot fix every certificate problem.",
        );
      expect(await page.locator("body").textContent()).not.toContain("private filesystem details");
      expect(await page.locator("#connection-repair").isEnabled()).toBe(true);
      await page.locator("#connection-repair").click();
      await expect
        .poll(() => page.locator("#connection-status").textContent())
        .toBe("Certificate ready.");
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
      .toBe(
        "The connection could not be set up. Retry to run the repair again. If it keeps failing, stop here: this page cannot fix every certificate problem.",
      );
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

it("keeps a public certificate download across repair and explicitly reconnects before offering HTTPS", async () => {
  const page = await browser!.newPage();
  const publicPem =
    "-----BEGIN CERTIFICATE-----\nSYNTHETIC-PUBLIC-CERTIFICATE\n-----END CERTIFICATE-----\n";
  const calls: import("playwright").Request[] = [];
  try {
    await open(page, retained, async (request) => {
      calls.push(request);
      return {
        status: 200,
        body: request.url().endsWith("/continue")
          ? { restarting: true }
          : {
              ...retained,
              state: "healthy",
              caCertificate: publicPem,
              continuationRequired: true,
            },
      };
    });
    await page.locator("#connection-repair").click();
    await expect.poll(() => page.locator("#connection-reconnect").count()).toBe(1);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url()).toBe("http://waitron.local:8080/setup-api/connection/repair");
    expect(await page.locator("#connection-continue").isVisible()).toBe(false);
    expect(await page.locator("#connection-status").textContent()).toBe(
      "Certificate ready. Follow the instructions, then reconnect.",
    );
    expect(await page.locator("#connection-certificate").getAttribute("href")).toMatch(/^blob:/);
    const downloadBox = await page.locator("#connection-certificate").boundingBox();
    const reconnectBox = await page.locator("#connection-reconnect").boundingBox();
    expect(downloadBox!.y).toBeLessThan(reconnectBox!.y);
    const saved = page.waitForEvent("download");
    await page.locator("#connection-certificate").click();
    const download = await saved;
    expect(await readFile((await download.path())!, "utf8")).toBe(publicPem);
    await page.locator("#connection-reconnect").click();
    await expect.poll(() => page.locator("#connection-continue").isVisible()).toBe(true);
    expect(calls).toHaveLength(2);
    expect(calls[1]!.url()).toBe("http://waitron.local:8080/setup-api/connection/continue");
    expect(calls[1]!.postData()).toBeNull();
    expect(calls[1]!.headers()).not.toHaveProperty("cookie");
    expect(await page.locator("#connection-continue").getAttribute("target")).toBe("_blank");
    expect(await page.locator("#connection-continue").getAttribute("rel")).toBe(
      "noopener noreferrer",
    );
  } finally {
    await page.close();
  }
});

it("a reloaded healthy bootstrap retains its public certificate before reconnect", async () => {
  const page = await browser!.newPage();
  try {
    await open(page, { ...retained, state: "healthy" }, undefined, {
      connection: { ...retained, state: "healthy", continuationRequired: true },
      caCertificate: "public-certificate-on-reload",
    });
    expect(await page.locator("#connection-repair").count()).toBe(0);
    expect(await page.locator("#connection-reconnect").count()).toBe(1);
    expect(await page.locator("#connection-certificate").getAttribute("href")).toMatch(/^blob:/);
    expect(await page.locator("#connection-continue").isVisible()).toBe(false);
  } finally {
    await page.close();
  }
});

it.each(["en", "es"] as const)(
  "a refused layout explains the repair limit before and after another refusal (%s)",
  async (locale) => {
    const page = await browser!.newPage();
    try {
      const guidance =
        locale === "en"
          ? "The connection could not be set up. Retry to run the repair again. If it keeps failing, stop here: this page cannot fix every certificate problem."
          : CONNECTION_TEXT.es.failed;
      await open(
        page,
        { state: "refused", trust: "retained", caAvailable: false },
        async () => ({ status: 503, body: { error: "private filesystem details" } }),
        { locale },
      );
      expect(await page.locator("#connection-status").textContent()).toBe(guidance);
      expect(await page.locator("#connection-continue").isVisible()).toBe(false);
      await page.locator("#connection-repair").click();
      await expect.poll(() => page.locator("#connection-error").textContent()).toBe(guidance);
      expect(await page.locator("#connection-repair").isEnabled()).toBe(true);
      expect(await page.locator("#connection-continue").isVisible()).toBe(false);
      expect(await page.locator("body").textContent()).not.toContain("private filesystem details");
      expect(await page.locator("input,form,textarea,select").count()).toBe(0);
    } finally {
      await page.close();
    }
  },
);

it.each(["en", "es"] as const)(
  "a refused repair can be stopped and checked again without another repair (%s)",
  async (locale) => {
    const page = await browser!.newPage();
    try {
      let writes = 0;
      await open(
        page,
        { state: "refused", trust: "retained", caAvailable: false },
        async () => {
          writes++;
          return { status: 503, body: { error: "private filesystem details" } };
        },
        { locale },
      );
      await page.goto(`http://waitron.local:8080/setup/connection?lang=${locale}`);
      await page.locator("#connection-repair").click();
      await expect
        .poll(() => page.locator("#connection-error").textContent())
        .toBe(CONNECTION_TEXT[locale].failed);
      expect(await page.locator("#connection-choice-help").isVisible()).toBe(true);
      expect(await page.locator("#connection-check").count()).toBe(1);
      expect(await page.locator("#connection-stop").count()).toBe(1);
      await page.locator("#connection-stop").press("Enter");
      expect(await page.locator("#connection-work").isVisible()).toBe(false);
      expect(await page.locator("#connection-error").textContent()).toBe("");
      expect(await page.locator("#connection-status").textContent()).toBe(
        locale === "en"
          ? "Stopped. You can close this tab, or check the connection again."
          : CONNECTION_TEXT.es.stopped,
      );
      expect(
        await page
          .locator("#connection-status")
          .evaluate((node) => node === document.activeElement),
      ).toBe(true);
      expect(writes).toBe(1);
      await Promise.all([page.waitForEvent("load"), page.locator("#connection-check").click()]);
      expect(new URL(page.url()).searchParams.get("lang")).toBe(locale);
      expect(await page.locator("#connection-work").isVisible()).toBe(true);
      expect(await page.locator("#connection-status").textContent()).toBe(
        CONNECTION_TEXT[locale].failed,
      );
      expect(writes).toBe(1);
      expect(await page.locator("input,form,textarea,select").count()).toBe(0);
    } finally {
      await page.close();
    }
  },
);

it.each(["en", "es"] as const)(
  "a separately supplied certificate offers address checking and a local stop (%s)",
  async (locale) => {
    const page = await browser!.newPage();
    try {
      let writes = 0;
      await open(
        page,
        retained,
        async () => {
          writes++;
          return { status: 403, body: { error: "private" } };
        },
        { locale, connection: { ...retained, repairAllowed: false } },
      );
      expect(await page.locator("#connection-status").textContent()).toBe(
        locale === "en"
          ? "This server uses a separately installed certificate. Check the HTTPS address below. If it shows a certificate warning, stop; this page cannot replace that certificate."
          : CONNECTION_TEXT.es.operator,
      );
      expect(await page.locator("#connection-repair").count()).toBe(0);
      expect(await page.locator("#connection-continue").isVisible()).toBe(true);
      expect(await page.locator("#connection-continue").getAttribute("href")).toBe(base.httpsUrl);
      expect(await page.locator("#connection-stop").count()).toBe(1);
      await page.locator("#connection-stop").click();
      expect(await page.locator("#connection-continue").isVisible()).toBe(false);
      expect(await page.locator("#connection-check").isEnabled()).toBe(true);
      expect(writes).toBe(0);
      expect(await page.locator("input,form,textarea,select").count()).toBe(0);
    } finally {
      await page.close();
    }
  },
);

it("waits for a pending repair before allowing check or stop", async () => {
  const page = await browser!.newPage();
  let release: () => void = () => {};
  const pending = new Promise<void>((resolve) => {
    release = resolve;
  });
  try {
    await open(page, retained, async () => {
      await pending;
      return { status: 503, body: { error: "private" } };
    });
    expect(await page.locator("#connection-check").count()).toBe(1);
    expect(await page.locator("#connection-stop").count()).toBe(1);
    await page.locator("#connection-repair").click();
    await expect.poll(() => page.locator("#connection-repair").isDisabled()).toBe(true);
    expect(await page.locator("#connection-check").isDisabled()).toBe(true);
    expect(await page.locator("#connection-stop").isDisabled()).toBe(true);
    release();
    await expect
      .poll(() => page.locator("#connection-error").textContent())
      .toBe(CONNECTION_TEXT.en.failed);
    expect(await page.locator("#connection-check").isEnabled()).toBe(true);
    expect(await page.locator("#connection-stop").isEnabled()).toBe(true);
  } finally {
    release();
    await page.close();
  }
});

it.each(["en", "es"] as const)(
  "certificate installation help offers a venue-device alternative to restricted import (%s)",
  async (locale) => {
    const page = await browser!.newPage();
    try {
      await open(page, { ...retained, state: "healthy" }, undefined, { locale, device: "linux" });
      const help = await page.locator("#connection-help").textContent();
      expect(help).not.toMatch(/ask (them|your administrator)|pide ayuda|Un administrador debe/);
      expect(help).toContain(
        locale === "en"
          ? "If this device blocks certificate installation, use a venue device that allows it."
          : CONNECTION_TEXT.es.managed,
      );
      expect(help).toContain(
        locale === "en"
          ? "If importing or removing is blocked, use a venue device that permits it."
          : CONNECTION_DEVICE_ES.windows.removal[1]!,
      );
      expect(await page.locator("#connection-certificate").getAttribute("download")).toBe(
        "waitron-ca.crt",
      );
    } finally {
      await page.close();
    }
  },
);
