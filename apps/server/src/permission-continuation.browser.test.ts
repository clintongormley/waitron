import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { Hono } from "hono";
import { chromium, type Browser } from "playwright";
import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { withTransaction } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { hashPassword, hashPin, persons, webauthnCredentials } from "@waitron/identity";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { planVenue } from "@waitron/provisioning";
import { applyHistoricalTestVenue } from "@waitron/provisioning/testing/allocated-venue";
import { MANAGEMENT_COOKIE } from "@waitron/server-kit";
import { mountManagementApi } from "./management-api.js";
import { mountMeApi } from "./me-api.js";
import { ALL_MODULES } from "./modules.js";
import { TOTP_KEY_RING } from "./testing/authenticator.js";

// Only the authenticator's cryptographic answer is synthetic; routes, cookies and rights stay real.
vi.mock("@simplewebauthn/server", async (original) => ({
  ...(await original<typeof import("@simplewebauthn/server")>()),
  verifyAuthenticationResponse: vi.fn(),
}));
import { verifyAuthenticationResponse } from "@simplewebauthn/server";

const suite = useVenueDb({
  migrations: migrationOptionsFor(manifestSets(), null),
  timeoutMs: 120_000,
});
const origin = "http://localhost";
const password = "synthetic-owner-password-651";
let buildRoot: string | undefined;
let browser: Browser | undefined;

beforeAll(async () => {
  buildRoot = await mkdtemp(join(tmpdir(), "permission-browser-"));
  const repo = resolve("../..");
  await writeFile(
    join(buildRoot, "index.html"),
    '<!doctype html><html lang="en"><head><title>Permission continuation</title></head><body><div id="app"></div><script type="module" src="/entry.ts"></script></body></html>',
  );
  await writeFile(
    join(buildRoot, "entry.ts"),
    `
import { html } from ${JSON.stringify(join(repo, "apps/dashboard/node_modules/lit/index.js"))};
import { DASHBOARD_MODULES } from ${JSON.stringify(join(repo, "packages/dashboard-modules/src/index.ts"))};
DASHBOARD_MODULES.push({
  module: "test-continuation", strings: {en:{"nav.test-continuation":"Evidence"},es:{"nav.test-continuation":"Evidence"}},
  screen: {id:"test-continuation",navLabelKey:"nav.test-continuation",group:"service",requiresPermission:"system.manage",readPermission:"venue.view"},
  create(ctx) { window.testPermissionContinuation = ctx.permissionContinuation; return {render:()=>html\`<p data-test="test-evidence">Empty evidence</p><wt-button data-test="test-sign-in" @click=\${()=>{window.testSignIn = ctx.permissionContinuation.signIn({permission:"system.manage",signal:new AbortController().signal});}}>Sign in</wt-button>\`}; }
});
await import(${JSON.stringify(join(repo, "apps/dashboard/src/main.ts"))});
`,
  );
  await writeFile(
    join(buildRoot, "vite.config.mjs"),
    `export default ${JSON.stringify({ root: buildRoot, base: "/manage/", publicDir: false, build: { target: "esnext", outDir: join(buildRoot, "dist"), emptyOutDir: true } })}`,
  );
  await promisify(execFile)(
    "pnpm",
    [
      "--filter",
      "@waitron/dashboard",
      "exec",
      "vite",
      "build",
      "--config",
      join(buildRoot, "vite.config.mjs"),
    ],
    { timeout: 90_000, maxBuffer: 2_000_000 },
  );
  browser = await chromium.launch({ headless: true });
}, 120_000);
afterAll(async () => {
  await browser?.close();
  if (buildRoot) await rm(buildRoot, { recursive: true, force: true });
});

function held<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

async function fixture() {
  const venue = await applyHistoricalTestVenue(
    planVenue(
      {
        country: "ES",
        taxId: "89899101K",
        legalName: "Test venue",
        seriesCode: "A",
        rectificativeSeriesCode: "R",
        location: {
          name: "Main",
          fiscalTerritory: "ES-common",
          invoiceLocales: ["en-GB"],
          operationDescription: "Restaurant sales",
          addressLine1: "One Road",
          addressLine2: null,
          postalCode: "28013",
          city: "Madrid",
          province: "Madrid",
          timeZone: "Europe/Madrid",
          dayCutover: "05:00",
        },
        admin: {
          displayName: "Owner",
          pinHash: hashPin("1234"),
          passwordHash: hashPassword(password),
          email: "owner@example.test",
        },
      },
      ALL_MODULES,
    ),
    { db: suite.db, modules: ALL_MODULES },
  );
  await withTransaction(suite.db, async (tx) => {
    await tx.insert(persons).values({
      displayName: "Viewer",
      role: "supervisor",
      email: "viewer@example.test",
      pinHash: hashPin("2345"),
      passwordHash: hashPassword(password),
    });
    const [admin] = await tx
      .select({ id: persons.id })
      .from(persons)
      .where(eq(persons.role, "admin"));
    await tx.insert(webauthnCredentials).values({
      personId: admin!.id,
      credentialId: "AQ",
      publicKey: "AQID",
      transports: '["internal"]',
    });
  });
  vi.mocked(verifyAuthenticationResponse).mockResolvedValue({
    verified: true,
    authenticationInfo: {
      credentialID: "AQ",
      newCounter: 1,
      userVerified: true,
      credentialDeviceType: "singleDevice",
      credentialBackedUp: false,
      origin,
      rpID: "localhost",
    },
  });
  const app = new Hono();
  app.get("/api/content-languages", (c) => c.json({ defaultLanguage: "en", languages: ["en"] }));
  app.get("/api/theme", (c) => c.json({ hash: "waitron", css: "", logo: null }));
  app.get("/management-api/alerts", (c) => c.json({ visible: false, alerts: [] }));
  app.get("/management-api/disk-stop", (c) => c.json({ stopped: false, deleted: null }));
  mountManagementApi(
    app,
    {
      db: suite.db,
      cfg: venue,
      secureCookies: false,
      rpId: "localhost",
      origin,
      credentialKeyRing: TOTP_KEY_RING,
    },
    () => {},
  );
  mountMeApi(
    app,
    {
      db: suite.db,
      cfg: venue,
      venueLocale: "en-GB",
      modules: ["test-continuation"],
      credentialKeyRing: TOTP_KEY_RING,
    },
    () => {},
  );
  const login = await app.request("/management-api/session", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: "viewer@example.test", password }),
  });
  expect(login.status).toBe(200);
  const token = login.headers
    .get("set-cookie")!
    .split(";")[0]!
    .slice(MANAGEMENT_COOKIE.length + 1);
  return { app, token };
}

it.each(["password", "passkey"] as const)(
  "Stop before the real %s login response allows its cookie then reconciles the actual account",
  async (method) => {
    const { app, token } = await fixture();
    const context = await browser!.newContext({ locale: "en-GB" });
    const submitted = held<Response>();
    const release = held<void>();
    const requests: string[] = [];
    try {
      await context.addCookies([{ name: MANAGEMENT_COOKIE, value: token, url: origin }]);
      await context.addInitScript(() => {
        Object.defineProperty(window, "EventSource", {
          configurable: true,
          value: class extends EventTarget {
            close() {}
          },
        });
        Object.defineProperty(navigator.credentials, "get", {
          configurable: true,
          value: async () => ({
            id: "AQ",
            rawId: new Uint8Array([1]).buffer,
            type: "public-key",
            authenticatorAttachment: "platform",
            response: {
              clientDataJSON: new Uint8Array([2]).buffer,
              authenticatorData: new Uint8Array([3]).buffer,
              signature: new Uint8Array([4]).buffer,
              userHandle: new Uint8Array([5]).buffer,
            },
            getClientExtensionResults: () => ({}),
          }),
        });
        Object.defineProperty(PublicKeyCredential, "isConditionalMediationAvailable", {
          configurable: true,
          value: async () => false,
        });
      });
      await context.route("**/*", async (route) => {
        const request = route.request();
        const url = new URL(request.url());
        if (url.origin !== origin) {
          await route.abort();
          return;
        }
        requests.push(`${request.method()} ${url.pathname}`);
        if (url.pathname.startsWith("/management-api/") || url.pathname.startsWith("/api/")) {
          const response = await app.request(url.pathname + url.search, {
            method: request.method(),
            headers: await request.allHeaders(),
            ...(request.postData() === null ? {} : { body: request.postData()! }),
          });
          const heldPath =
            method === "password"
              ? "/management-api/session"
              : "/management-api/passkey/auth/verify";
          if (request.method() === "POST" && url.pathname === heldPath) {
            submitted.resolve(response);
            await release.promise;
          }
          await route.fulfill({
            status: response.status,
            headers: Object.fromEntries(response.headers),
            body: Buffer.from(await response.arrayBuffer()),
          });
          return;
        }
        const asset = url.pathname.startsWith("/manage/assets/")
          ? url.pathname.slice("/manage/".length)
          : "index.html";
        await route.fulfill({
          contentType: asset.endsWith(".js")
            ? "text/javascript"
            : asset.endsWith(".css")
              ? "text/css"
              : asset.endsWith(".woff2")
                ? "font/woff2"
                : "text/html",
          body: await readFile(join(buildRoot!, "dist", asset)),
        });
      });
      const page = await context.newPage();
      const errors: string[] = [];
      page.on("pageerror", (error) => errors.push(error.message));
      page.setDefaultTimeout(15_000);
      await page.goto(`${origin}/manage/test-continuation`);
      try {
        await page.locator("[data-test=test-sign-in] button").click();
      } catch (error) {
        throw new Error(
          JSON.stringify({ errors, requests, body: await page.locator("body").innerText() }),
          { cause: error },
        );
      }
      const login = page.locator("[data-test=permission-sign-in] dashboard-login-screen");
      let nativePassword: import("playwright").ElementHandle<HTMLElement | SVGElement> | null =
        null;
      await login.locator("wt-input[name=email] input").fill("owner@example.test");
      await login.locator("[data-test=continue] button").click();
      if (method === "password") {
        await login.locator("wt-input[name=password] input").fill(password);
        nativePassword = await login.locator("wt-input[name=password] input").elementHandle();
        await login.locator("[data-test=submit] button").click();
      } else await login.locator("[data-test=passkey-login] button").click();
      const response = await submitted.promise;
      expect(response.status).toBe(200);
      expect(response.headers.get("set-cookie")).toContain(MANAGEMENT_COOKIE);
      await page.locator("[data-test=permission-stop] button").click();
      await expect.poll(() => page.locator("[data-test=permission-sign-in]").count()).toBe(0);
      await expect.poll(() => page.locator("[data-test=test-evidence]").count()).toBe(0);
      if (nativePassword !== null)
        await expect
          .poll(() => nativePassword!.evaluate((input) => (input as HTMLInputElement).value))
          .toBe("");
      const before = await context.cookies();
      expect(before.find((cookie) => cookie.name === MANAGEMENT_COOKIE)!.value).toBe(token);
      release.resolve();
      await expect.poll(() => page.locator("[data-test=test-evidence]").count()).toBe(1);
      const cookies = await context.cookies();
      expect(cookies.find((cookie) => cookie.name === MANAGEMENT_COOKIE)!.value).not.toBe(token);
      const actual = await page.evaluate(async () => {
        const response = await fetch("/management-api/session/me", { credentials: "include" });
        return (await response.json()) as { email: string; permissions: string[] };
      });
      expect(actual.email).toBe("owner@example.test");
      expect(actual.permissions).toContain("system.manage");
      expect(requests.filter((request) => request.includes("fiscal-certificate"))).toEqual([]);
      expect(requests.filter((request) => request.startsWith("DELETE "))).toEqual([]);
      expect(await login.count()).toBe(0);
      expect(
        await page.evaluate(() =>
          JSON.stringify({ local: { ...localStorage }, session: { ...sessionStorage } }),
        ),
      ).not.toContain(password);
    } finally {
      release.resolve();
      await context.close();
    }
  },
  60_000,
);
