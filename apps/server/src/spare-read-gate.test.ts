import { MANAGEMENT_COOKIE } from "@waitron/server-kit";
import { Hono } from "hono";
import { expect, it } from "vitest";
import { spareReadGate } from "./spare-read-gate.js";
import { formatDuration } from "@waitron/shared";
import { SPARE_WORDS } from "./i18n/spare.js";
import type { MainSilenceState } from "./main-silence-watch.js";
import { readOnlyGate } from "./read-only-gate.js";
import { isReadOnlyExempt } from "./read-only-exemptions.js";

const NOW = 1_800_000_000_000;
const ANSWERING: MainSilenceState = { silentSinceMs: null, reached: true, silent: false };
const SILENT: MainSilenceState = { silentSinceMs: NOW, reached: true, silent: true };

/** `null`: no watch runs. */
function fixture(main: MainSilenceState | null = ANSWERING) {
  const mode = { mirror: true };
  const app = new Hono();
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
      now: () => NOW,
    }),
  );
  app.post("/management-api/promote", (c) => {
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
            message: `${SPARE_WORDS["en-GB"].title}. ${SPARE_WORDS["en-GB"].body}`,
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
  expect((await app.request("/management-api/promote", { method: "POST" })).status).toBe(200);
  expect((await app.request("/management-api/menus")).status).toBe(403);
});

it("preserves the read-only write refusals and the existing mirror POST exemptions", async () => {
  const app = fixture();
  for (const path of [
    "/management-api/promote/preparation",
    "/api/node/peer-status",
    "/api/node/membership",
    "/api/node/handover/offer",
    "/api/node/handover/operation-one/preparation",
    "/api/node/handover/operation-one/activate",
  ]) {
    expect((await app.request(path, { method: "POST" })).status).toBe(200);
  }
  for (const path of ["/api/box/retire", "/api/sales", "/management-api/menus"]) {
    const response = await app.request(path, { method: "POST" });
    expect([response.status, await response.json()]).toEqual([
      403,
      { error: { code: "node.read_only", params: {} } },
    ]);
  }
});

it.each(["en-GB", "es-ES"] as const)(
  "shows %s spare status at dashboard addresses and in API refusals",
  async (locale) => {
    const app = fixture();
    for (const path of ["/", "/staff", "/assets/old.js", "/till/"]) {
      const response = await app.request(path, { headers: { "accept-language": locale } });
      expect(response.status).toBe(200);
      expect(response.headers.get("cache-control")).toBe("no-store");
      expect(response.headers.get("content-type")).toContain("text/html");
      const body = await response.text();
      expect(body).toContain(`<html lang="${locale}">`);
      expect(body).toContain(SPARE_WORDS[locale].title);
      expect(body).toContain(SPARE_WORDS[locale].status);
      expect(body).not.toContain(SPARE_WORDS[locale].mainBack);
      expect(body).not.toContain("<script");
    }
    const response = await app.request("/management-api/menus", {
      headers: { "accept-language": locale },
    });
    expect((await response.json()).error.message).toContain(SPARE_WORDS[locale].body);
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
    ["/", "/handover/emergency"],
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
