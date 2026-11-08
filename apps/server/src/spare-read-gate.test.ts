import { Hono } from "hono";
import { expect, it } from "vitest";
import { spareReadGate } from "./spare-read-gate.js";
import { SPARE_WORDS } from "./i18n/spare.js";
import { readOnlyGate } from "./read-only-gate.js";
import { isReadOnlyExempt } from "./read-only-exemptions.js";

function fixture() {
  const mode = { mirror: true };
  const app = new Hono();
  app.use(
    "*",
    readOnlyGate(
      () => mode.mirror,
      (c) => isReadOnlyExempt(c.req, { mirror: mode.mirror, fenced: false }),
    ),
  );
  app.use("*", spareReadGate());
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
      "/management-api/catalogues",
      "/management-api/staff/person/personal-data/export",
      "/media/images/image",
      "/api/working-orders",
      "/management-api/live",
      "/management-api/reports/sales",
    ]) {
      const response = await fixture().request(path, {
        method,
        headers: { cookie: "waitron_management=kept" },
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
  expect((await app.request("/management-api/catalogues")).status).toBe(403);
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
  for (const path of ["/api/box/retire", "/api/sales", "/management-api/catalogues"]) {
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
    const response = await app.request("/management-api/catalogues", {
      headers: { "accept-language": locale },
    });
    expect((await response.json()).error.message).toContain(SPARE_WORDS[locale].body);
  },
);
