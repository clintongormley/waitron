import { MANAGEMENT_COOKIE } from "@waitron/server-kit";
import { Hono } from "hono";
import { expect, it } from "vitest";
import { spareReadGate } from "./spare-read-gate.js";
import { SPARE_WORDS } from "./i18n/spare.js";
import { readOnlyGate } from "./read-only-gate.js";
import { isReadOnlyExempt } from "./read-only-exemptions.js";

function fixture(watch = { silent: false }) {
  const mode = { mirror: true };
  const app = new Hono();
  app.use(
    "*",
    readOnlyGate(
      () => mode.mirror,
      (c) => isReadOnlyExempt(c.req, { mirror: mode.mirror, fenced: false }),
    ),
  );
  app.use("*", spareReadGate({ silent: () => watch.silent }));
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
    for (const path of ["/", "/manage", "/manage/staff", "/manage/assets/old.js"]) {
      const response = await app.request(path, { headers: { "accept-language": locale } });
      expect(response.status).toBe(200);
      expect(response.headers.get("cache-control")).toBe("no-store");
      expect(response.headers.get("content-type")).toContain("text/html");
      const body = await response.text();
      expect(body).toContain(`<html lang="${locale}">`);
      expect(body).toContain(SPARE_WORDS[locale].title);
      expect(body).toContain(SPARE_WORDS[locale].status);
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
  for (const path of ["/handover-other/operation-one", "/handover/operation-one/private"]) {
    expect((await app.request(path)).status).toBe(403);
  }
});

const VENUE = "https://waitron.local";
const OWN = "https://box-bbbb.waitron.local";

it("at the venue's name a silent main server's spare sends pages to the switch page", async () => {
  const app = fixture({ silent: true });
  for (const path of ["/", "/manage", "/manage/servers"]) {
    const response = await app.request(`${VENUE}${path}`, { headers: { accept: "text/html" } });
    expect([response.status, response.headers.get("location")]).toEqual([
      302,
      "/handover/emergency",
    ]);
    expect(response.headers.get("cache-control")).toBe("no-store");
  }
});

it.each(["en-GB", "es-ES"] as const)(
  "at the venue's name, with the main server answering, pages say it is back and reload: %s",
  async (locale) => {
    const app = fixture({ silent: false });
    for (const path of ["/", "/manage", "/manage/servers"]) {
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

it.each([true, false])(
  "at the box's own name the closed page is served as before, silent: %s",
  async (silent) => {
    const app = fixture({ silent });
    for (const path of ["/", "/manage", "/manage/servers"]) {
      const response = await app.request(`${OWN}${path}`);
      expect(response.status).toBe(200);
      const body = await response.text();
      expect(body).toContain(SPARE_WORDS["en-GB"].title);
      expect(body).not.toContain(SPARE_WORDS["en-GB"].mainBack);
    }
  },
);

it.each([true, false])(
  "other reads keep node.spare at the venue's name, silent: %s",
  async (silent) => {
    const app = fixture({ silent });
    for (const path of ["/management-api/menus", "/api/box/status", "/media/images/image"]) {
      const response = await app.request(`${VENUE}${path}`);
      expect(response.status).toBe(403);
      expect((await response.json()).error.code).toBe("node.spare");
    }
    for (const path of ["/api/node", "/api/node/main", "/handover/emergency"]) {
      const response = await app.request(`${VENUE}${path}`);
      expect([response.status, await response.json()]).toEqual([200, { reached: path }]);
    }
  },
);
