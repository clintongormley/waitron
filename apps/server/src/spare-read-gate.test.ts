import { MANAGEMENT_COOKIE } from "@waitron/server-kit";
import { escapeHtml } from "./html-page.js";
import { Hono } from "hono";
import { expect, it } from "vitest";
import { spareReadGate } from "./spare-read-gate.js";
import { formatDuration } from "@waitron/shared";
import { SPARE_WORDS } from "./i18n/spare.js";
import type { MainSilenceState } from "./main-silence-watch.js";
import { readOnlyGate } from "./read-only-gate.js";
import { isReadOnlyExempt } from "./read-only-exemptions.js";
import { TRUST_PAGE_LOGO_SVG } from "./trust-page-logo.js";

const NOW = 1_800_000_000_000;
const ANSWERING: MainSilenceState = { silentSinceMs: null, reached: true, silent: false };
const SILENT: MainSilenceState = { silentSinceMs: NOW, reached: true, silent: true };

const logged: { level: string; event: string; fields?: Record<string, unknown> }[] = [];

/** `null`: no watch runs. */
function fixture(
  main: MainSilenceState | null = ANSWERING,
  mainUrl: () => Promise<string | null> = () => Promise.resolve(null),
) {
  const mode = { mirror: true };
  const app = new Hono();
  app.use("*", async (c, next) => {
    c.set("requestId", "request-1");
    await next();
  });
  app.use(
    "*",
    readOnlyGate(
      () => mode.mirror,
      (c) => isReadOnlyExempt(c.req, { mirror: mode.mirror, fenced: false }),
    ),
  );
  app.use(
    "*",
    spareReadGate({
      main: () => main ?? undefined,
      mainUrl,
      log: (level, event, fields) => logged.push({ level, event, fields }),
      now: () => NOW,
    }),
  );
  app.post("/api/node/handover/operation-one/activate", (c) => {
    mode.mirror = false;
    return c.json({ restarting: true });
  });
  app.all("*", (c) => c.json({ reached: c.req.path }));
  return app;
}

it.each(["GET", "HEAD", "OPTIONS"])(
  "refuses every private %s even with a management cookie",
  async (method) => {
    for (const path of [
      "/management-api/menus",
      "/management-api/staff/person/personal-data/export",
      "/media/images/image",
      "/api/working-orders",
      "/management-api/live",
      "/management-api/reports/sales",
    ]) {
      const response = await fixture().request(path, {
        method,
        headers: { cookie: `${MANAGEMENT_COOKIE}=kept` },
      });
      expect(response.status).toBe(403);
      expect(response.headers.get("cache-control")).toBe("no-store");
      expect(response.headers.get("set-cookie")).toBeNull();
      if (method !== "HEAD")
        expect(await response.json()).toEqual({
          error: {
            code: "node.spare",
            params: {},
            message: SPARE_WORDS["en-GB"].refusal,
          },
        });
    }
  },
);

it("keeps public role and signed handover status reachable without opening sibling routes", async () => {
  const app = fixture();
  for (const path of ["/api/node", "/api/node/handover/operation-one"]) {
    const response = await app.request(path);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ reached: path });
  }
  for (const path of [
    "/api/node/other",
    "/api/node/handover",
    "/api/node/handover/operation-one/private",
  ]) {
    expect((await app.request(path)).status).toBe(403);
  }
});

it("keeps reads closed after promotion opens the original write gate until restart", async () => {
  const app = fixture();
  expect(
    (await app.request("/api/node/handover/operation-one/activate", { method: "POST" })).status,
  ).toBe(200);
  expect((await app.request("/management-api/menus", { method: "POST" })).status).toBe(200);
  expect((await app.request("/management-api/menus")).status).toBe(403);
});

it("preserves the read-only write refusals and the existing mirror POST exemptions", async () => {
  const app = fixture();
  for (const path of [
    "/api/node/peer-status",
    "/api/node/membership",
    "/api/node/handover/offer",
    "/api/node/handover/operation-one/preparation",
  ]) {
    expect((await app.request(path, { method: "POST" })).status).toBe(200);
  }
  for (const path of [
    "/api/box/retire",
    "/api/working-orders/bill-1/payments",
    "/management-api/menus",
  ]) {
    const response = await app.request(path, { method: "POST" });
    expect([response.status, await response.json()]).toEqual([
      403,
      { error: { code: "node.read_only", params: {} } },
    ]);
  }
  expect(
    (await app.request("/api/node/handover/operation-one/activate", { method: "POST" })).status,
  ).toBe(200);
});

it.each(["en-GB", "es-ES"] as const)(
  "shows %s spare status at dashboard addresses and in API refusals",
  async (locale) => {
    const app = fixture();
    for (const path of ["/", "/staff", "/assets/old.js", "/favicon.svg", "/till/"]) {
      const response = await app.request(path, { headers: { "accept-language": locale } });
      expect(response.status).toBe(200);
      expect(response.headers.get("cache-control")).toBe("no-store");
      expect(response.headers.get("content-type")).toContain("text/html");
      const body = await response.text();
      expect(body).toContain(`<html lang="${locale.slice(0, 2)}">`);
      expect(body).toContain(SPARE_WORDS[locale].title);
      expect(body).toContain(SPARE_WORDS[locale].body);
      expect(body).not.toContain(SPARE_WORDS[locale].mainBack);
      // The shell's inline theme script only; no application code.
      expect(body.match(/<script/g)).toHaveLength(1);
      expect(body).not.toMatch(/<script[^>]*src=/);
    }
    const response = await app.request("/management-api/menus", {
      headers: { "accept-language": locale },
    });
    expect((await response.json()).error.message).toBe(SPARE_WORDS[locale].refusal);
  },
);

it("serves the handover page and its built assets while private reads remain closed", async () => {
  const app = fixture();
  for (const path of [
    "/handover/operation-one",
    "/handover/assets/app-123.js",
    "/handover/favicon.svg",
    "/handover/favicon.ico",
    "/handover/apple-touch-icon.png",
  ]) {
    const response = await app.request(path);
    expect([response.status, await response.json()]).toEqual([200, { reached: path }]);
  }
  const otherPage = await app.request("/handover-other/operation-one");
  expect(otherPage.status).toBe(200);
  expect(await otherPage.text()).toContain(SPARE_WORDS["en-GB"].title);
  for (const path of ["/handover/operation-one/private"]) {
    expect((await app.request(path)).status).toBe(403);
  }
});

const VENUE = "https://waitron.local";
const OWN = "https://box-bbbb.waitron.local";

it("at the venue's name a silent main server's spare sends pages to the switch page", async () => {
  const app = fixture(SILENT);
  for (const [path, destination] of [
    ["/", "/handover/emergency"],
    ["/devices", "/handover/emergency"],
    ["/servers", "/handover/emergency"],
    [
      "/till/tabs/counter",
      "/handover/emergency?back=https%3A%2F%2Fwaitron.local%2Ftill%2Ftabs%2Fcounter",
    ],
  ]) {
    const response = await app.request(`${VENUE}${path}`, { headers: { accept: "text/html" } });
    expect([response.status, response.headers.get("location")]).toEqual([302, destination]);
    expect(response.headers.get("cache-control")).toBe("no-store");
  }
});

it.each(["en-GB", "es-ES"] as const)(
  "at the venue's name, with the main server answering, pages say it is back and reload: %s",
  async (locale) => {
    const app = fixture(ANSWERING);
    for (const path of ["/", "/devices", "/servers", "/till/tabs/counter"]) {
      const response = await app.request(`${VENUE}${path}`, {
        headers: { "accept-language": locale },
      });
      expect(response.status).toBe(200);
      expect(response.headers.get("location")).toBeNull();
      expect(response.headers.get("cache-control")).toBe("no-store");
      const body = await response.text();
      expect(body).toContain(`<html lang="${locale}">`);
      expect(body).toContain(SPARE_WORDS[locale].mainBack);
      expect(body).toContain('<meta http-equiv="refresh" content="5">');
      expect(body).not.toContain(SPARE_WORDS[locale].title);
      expect(body).not.toContain("box-aaaa");
      expect(body).not.toContain("<script");
    }
  },
);

it.each([
  ["answering", ANSWERING],
  ["silent", SILENT],
] as const)("other reads keep node.spare at the venue's name, main server %s", async (_, main) => {
  const app = fixture(main);
  for (const path of ["/management-api/menus", "/api/box/status", "/media/images/image"]) {
    const response = await app.request(`${VENUE}${path}`);
    expect(response.status).toBe(403);
    expect((await response.json()).error.code).toBe("node.spare");
  }
  for (const path of ["/api/node", "/api/node/main", "/handover/emergency"]) {
    const response = await app.request(`${VENUE}${path}`);
    expect([response.status, await response.json()]).toEqual([200, { reached: path }]);
  }
});

it.each(["en-GB", "es-ES"] as const)(
  "the closed page says for how long a silent main server has not answered and links to the switch: %s",
  async (locale) => {
    const app = fixture({ silentSinceMs: NOW - 65_000, reached: true, silent: true });
    for (const path of ["/", "/devices", "/servers", "/till/tabs/counter"]) {
      const body = await (
        await app.request(`${OWN}${path}`, { headers: { "accept-language": locale } })
      ).text();
      expect(body).toContain(
        SPARE_WORDS[locale].mainSilent.replace("{duration}", () => formatDuration(65_000, locale)),
      );
      expect(body).toContain(`<a href="/handover/emergency">${SPARE_WORDS[locale].openSwitch}</a>`);
      expect(body).not.toContain(SPARE_WORDS[locale].mainUnreached);
      expect(body).not.toContain(SPARE_WORDS[locale].mainBack);
      expect(body).toContain(SPARE_WORDS[locale].title);
    }
  },
);

it.each(["en-GB", "es-ES"] as const)(
  "the closed page says a main server this spare has not reached is out of its reach: %s",
  async (locale) => {
    const app = fixture({ silentSinceMs: null, reached: false, silent: false });
    const body = await (
      await app.request(`${OWN}/`, { headers: { "accept-language": locale } })
    ).text();
    expect(body).toContain(SPARE_WORDS[locale].mainUnreached);
    expect(body).not.toContain("/handover/emergency");
  },
);

it.each([
  ["answering", ANSWERING],
  ["not yet silent long enough", { silentSinceMs: NOW - 5_000, reached: true, silent: false }],
  ["watching nothing", null],
] as const)("the closed page says nothing of the main server while %s", async (_, main) => {
  const body = await (await fixture(main).request(`${OWN}/servers`)).text();
  expect(body).toContain(SPARE_WORDS["en-GB"].title);
  expect(body).not.toContain(SPARE_WORDS["en-GB"].mainBack);
  expect(body).not.toContain(SPARE_WORDS["en-GB"].mainUnreached);
  expect(body).not.toContain(SPARE_WORDS["en-GB"].openSwitch);
  expect(body).not.toContain("/handover/emergency");
});

it("the closed page's words pass through the page's escaping", async () => {
  const words = SPARE_WORDS["en-GB"];
  const original = { ...words };
  Object.assign(words, {
    title: "<b>title</b>",
    mainSilent: "<i>silent</i> {duration}",
    openSwitch: "<u>open</u>",
  });
  try {
    const body = await (
      await fixture({ silentSinceMs: NOW - 2_000, reached: true, silent: true }).request(`${OWN}/`)
    ).text();
    expect(body).toContain("&lt;b&gt;title&lt;/b&gt;");
    expect(body).toContain("&lt;i&gt;silent&lt;/i&gt; ");
    expect(body).toContain("&lt;u&gt;open&lt;/u&gt;");
    expect(body).not.toMatch(/<[biu]>/);
  } finally {
    Object.assign(words, original);
  }
});

const MAIN_URL = "https://box-aaaa.waitron.local";

it.each(["en-GB", "es-ES"] as const)(
  "the spare's page has the guides' look and the Waitron logo: %s",
  async (locale) => {
    const response = await fixture().request(`${OWN}/servers`, {
      headers: { "accept-language": locale },
    });
    expect(response.headers.get("content-security-policy")).toContain("default-src 'none'");
    const body = await response.text();
    expect(body).toContain(`<title>${escapeHtml(SPARE_WORDS[locale].title)} · Waitron</title>`);
    expect(body).toContain("font-family: var(--wt-font-family)");
    expect(body).toContain(`<div class="logo">${TRUST_PAGE_LOGO_SVG}</div>`);
    expect(body).toContain(`<h1>${escapeHtml(SPARE_WORDS[locale].title)}</h1>`);
    expect(body).toContain(".logo svg { display: block; }");
    expect(body).toContain("p, li { overflow-wrap: anywhere; }");
  },
);

it.each(["en-GB", "es-ES"] as const)(
  "the spare's page links to the main box at its https address: %s",
  async (locale) => {
    const body = await (
      await fixture(ANSWERING, () => Promise.resolve(MAIN_URL)).request(`${OWN}/`, {
        headers: { "accept-language": locale },
      })
    ).text();
    expect(body).toContain(`<a href="${MAIN_URL}">${escapeHtml(SPARE_WORDS[locale].openMain)}</a>`);
  },
);

it("escapes the main box's address", async () => {
  const url = `https://box.example/"><b>x</b>`;
  const body = await (
    await fixture(ANSWERING, () => Promise.resolve(url)).request(`${OWN}/`)
  ).text();
  expect(body).toContain(`href="${escapeHtml(url)}"`);
  expect(body).not.toContain("<b>x</b>");
});

it.each([
  ["a plain-http address", () => Promise.resolve("http://box-aaaa.waitron.local")],
  ["an empty address", () => Promise.resolve("")],
  ["no address", () => Promise.resolve(null)],
  ["a script address", () => Promise.resolve("javascript:alert(1)")],
  ["a bare https prefix", () => Promise.resolve("https://")],
  ["an address that does not parse", () => Promise.resolve("https://exa mple")],
  ["a chart that cannot be read", () => Promise.reject(new Error("unreadable"))],
] as const)("the spare's page offers no main-box link for %s", async (label, mainUrl) => {
  logged.length = 0;
  const response = await fixture(ANSWERING, mainUrl).request(`${OWN}/`);
  expect(response.status).toBe(200);
  const body = await response.text();
  expect(body).toContain(SPARE_WORDS["en-GB"].title);
  expect(body).not.toContain(SPARE_WORDS["en-GB"].openMain);
  expect(body).not.toContain("<a ");
  expect(logged).toEqual(
    label === "a chart that cannot be read"
      ? [
          {
            level: "warn",
            event: "spare_page.main_link_failed",
            fields: { errorCode: "unknown", requestId: "request-1" },
          },
        ]
      : [],
  );
});

it("puts a silent main box's switch line before the main-box link", async () => {
  const body = await (
    await fixture({ silentSinceMs: NOW - 65_000, reached: true, silent: true }, () =>
      Promise.resolve(MAIN_URL),
    ).request(`${OWN}/`)
  ).text();
  const silent = body.indexOf('<a href="/handover/emergency">');
  const link = body.indexOf(`<a href="${MAIN_URL}">`);
  expect(silent).toBeGreaterThan(0);
  expect(link).toBeGreaterThan(silent);
});
