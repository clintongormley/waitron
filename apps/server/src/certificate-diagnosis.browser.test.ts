import { once } from "node:events";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { AddressInfo } from "node:net";
import type { TLSSocket } from "node:tls";
import { promisify } from "node:util";
import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { chromium, type Browser } from "playwright";
import { afterAll, beforeAll, expect, it } from "vitest";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { FISCAL_SLOT } from "@waitron/fiscal-verifactu/src/slot.js";
import {
  authority,
  candidate,
  installed,
  NOW,
  parentFixture,
} from "@waitron/fiscal-verifactu/test/certificate-diagnosis-parent-fixtures.js";
import { TEST_MIGRATIONS } from "@waitron/fiscal-verifactu/test/migrations.js";
import { SIN_DATOS_BODY } from "@waitron/fiscal-verifactu/test/certificate-fixtures.js";
import { startDiagnosticServer } from "@waitron/fiscal-verifactu/test/certificate-diagnosis-fixtures.js";
import { MANAGEMENT_COOKIE } from "@waitron/server-kit";
import { mountFiscalCertificateApi } from "./fiscal-certificate-api.js";
import { createCertificateDiagnosisRunner } from "./fiscal-certificate-diagnosis-runner.js";
import { mountGuidePages } from "./guide-pages.js";
import {
  diagnosisChildFixture,
  diagnosisSnapshot,
} from "./testing/certificate-diagnosis-snapshot.js";

const suite = useVenueDb({ migrations: TEST_MIGRATIONS });
let root: string | undefined;
let child: Awaited<ReturnType<typeof diagnosisChildFixture>> | undefined;
let browser: Browser | undefined;
beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), "diagnosis-browser-"));
  child = await diagnosisChildFixture();
  const repo = resolve("../..");
  const path = (file: string) => JSON.stringify(join(repo, file));
  await writeFile(
    join(root, "index.html"),
    '<!doctype html><html lang="en"><head><title>Certificate diagnosis qualification</title></head><body><main><h1>Certificate</h1><div id="panel"></div></main><script type="module" src="/entry.ts"></script></body></html>',
  );
  await writeFile(
    join(root, "entry.ts"),
    `
import {render} from ${path("apps/dashboard/node_modules/lit/index.js")};
import {applyTokens} from ${path("packages/ui/src/index.ts")};
import {createRequest,setLocale} from ${path("packages/dashboard-kit/src/index.ts")};
import {VERIFACTU_DASHBOARD} from ${path("packages/fiscal-verifactu/src/dashboard/index.ts")};
applyTokens(document.documentElement);
const language=new URL(location.href).searchParams.get("lang")||"en";
document.documentElement.lang=language;setLocale(language);
document.documentElement.dataset.theme=new URL(location.href).searchParams.get("theme")||"light";
const permissionContinuation={snapshot:()=>({accountGeneration:1,authenticated:true,permissions:["system.manage","fiscal.view"]}),subscribe:()=>()=>{},signIn:async()=>"stopped"};
const panel=VERIFACTU_DASHBOARD.settingsPanels[0].create({request:createRequest(),permissionContinuation});
render(panel.render(false),document.querySelector("#panel"));
`,
  );
  await writeFile(
    join(root, "vite.config.mjs"),
    `export default ${JSON.stringify({ root, publicDir: false, build: { target: "esnext", outDir: join(root, "dist"), emptyOutDir: true } })}`,
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
      join(root, "vite.config.mjs"),
    ],
    { timeout: 90_000, maxBuffer: 2_000_000 },
  );
  browser = await chromium.launch({ headless: true, timeout: 15_000 });
}, 120_000);
afterAll(async () => {
  await browser?.close();
  await child?.close();
  if (root) await rm(root, { recursive: true, force: true });
});

it.each(["installed", "candidate"] as const)(
  "built module and real HTTP/native child inspect and query %s without any database writes",
  async (source) => {
    const f = await parentFixture(suite.db);
    const peers: string[] = [];
    const endpoint = await startDiagnosticServer(authority, (request, response) => {
      peers.push((request.socket as TLSSocket).getPeerCertificate().fingerprint256!);
      response.writeHead(200);
      response.end(SIN_DATOS_BODY);
    });
    const marker = join(child!.root, `browser-${source}`);
    const runner = createCertificateDiagnosisRunner({ fiscalId: "fixture", entry: child!.entry });
    const logs: unknown[][] = [];
    const requests: string[] = [];
    const app = new Hono();
    app.use("*", async (c, next) => {
      requests.push(`${c.req.method} ${c.req.path}`);
      await next();
    });
    mountFiscalCertificateApi(
      app,
      {
        db: suite.db,
        ring: f.deps.ring,
        seat: FISCAL_SLOT.certificate!,
        nodeId: f.deps.nodeId,
        locationId: f.deps.locationId,
        environment: "preproduction",
        filing: () => true,
        now: () => NOW,
        diagnosisRunner: {
          stop: runner.stop,
          attempt: (work, signal) =>
            runner.attempt(
              (runChild, childSignal) =>
                work(
                  (data, abort) =>
                    runChild(
                      { data, endpoint: endpoint.origin, ca: authority.caPem, marker },
                      abort,
                    ),
                  childSignal,
                ),
              signal,
            ),
        },
      },
      (...args) => {
        logs.push(args);
      },
    );
    mountGuidePages(app, {}, (...args) => {
      logs.push(args);
    });
    app.get("*", async (c) => {
      const asset = c.req.path.startsWith("/assets/") ? c.req.path.slice(1) : "index.html";
      c.header(
        "Content-Type",
        asset.endsWith(".js")
          ? "text/javascript"
          : asset.endsWith(".css")
            ? "text/css"
            : "text/html",
      );
      return c.body(await readFile(join(root!, "dist", asset)));
    });
    const listener = serve({ hostname: "127.0.0.1", port: 0, fetch: app.fetch });
    if (!listener.listening) await once(listener, "listening");
    const origin = `http://127.0.0.1:${(listener.address() as AddressInfo).port}`;
    const context = await browser!.newContext({
      permissions: ["clipboard-read", "clipboard-write"],
    });
    const page = await context.newPage();
    page.setDefaultTimeout(5_000);
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    try {
      await context.addCookies([{ name: MANAGEMENT_COOKIE, value: f.session.token, url: origin }]);
      await page.goto(origin);
      await page.locator("[data-test=certificate-diagnose] button").click();
      const panel = page.locator("dashboard-aeat-certificate-diagnosis");
      if (source === "candidate") {
        await panel.locator("wt-combobox[name=diagnosis-source] .trigger").click();
        await page.keyboard.press("End");
        await page.keyboard.press("Enter");
        await panel.locator("wt-file-input input[type=file]").setInputFiles({
          name: "private-candidate.p12",
          mimeType: "application/x-pkcs12",
          buffer: candidate.pfx,
        });
        await panel
          .locator("wt-input[name=diagnosis-certificate-passphrase] input")
          .fill(candidate.passphrase);
        await panel.locator("wt-combobox[name=diagnosis-certificate-kind] .trigger").click();
        await page.keyboard.press("End");
        await page.keyboard.press("Enter");
      }
      const before = await diagnosisSnapshot(suite.db);
      await panel.locator("[data-test=diagnosis-confirm] button").click();
      await panel.locator("[data-test=diagnosis-inspect] button").click();
      await expect
        .poll(() => panel.locator("[data-test=diagnosis-check] button").isEnabled())
        .toBe(true);
      expect(peers).toEqual([]);
      expect(await diagnosisSnapshot(suite.db)).toEqual(before);
      await panel.locator("[data-test=diagnosis-check] button").click();
      await expect
        .poll(() => panel.locator("section[aria-labelledby=diagnosis-observed] p").innerText())
        .toContain("This query completed");
      expect(peers).toEqual([(source === "installed" ? installed : candidate).fingerprint]);
      expect(await diagnosisSnapshot(suite.db)).toEqual(before);
      const pid = Number(await readFile(marker, "utf8"));
      expect(() => process.kill(pid, 0)).toThrowError(expect.objectContaining({ code: "ESRCH" }));
      await panel.locator("[data-test=diagnosis-copy] button").click();
      const copied = await page.evaluate(() => navigator.clipboard.readText());
      expect(JSON.parse(copied)).toMatchObject({
        category: "query-completed",
        source,
        kind: source === "installed" ? "sello" : "representante",
      });
      expect(copied).not.toMatch(/binding|revision|passphrase|pfx|private|89890001K/i);
      expect(JSON.stringify(logs)).not.toMatch(/passphrase|pfxBase64|private|89890001K/i);
      expect(
        await page.evaluate(() =>
          JSON.stringify({ local: { ...localStorage }, session: { ...sessionStorage } }),
        ),
      ).not.toContain(candidate.passphrase);
      await panel.locator("[data-test=diagnosis-stop] button").click();
      await expect.poll(() => panel.count()).toBe(0);
      expect(await diagnosisSnapshot(suite.db)).toEqual(before);
      expect(requests.filter((request) => request.startsWith("POST "))).toEqual([
        "POST /management-api/fiscal-certificate/diagnose",
        "POST /management-api/fiscal-certificate/diagnose",
      ]);
      expect(errors).toEqual([]);
    } finally {
      await context.close();
      await runner.stop();
      if ("closeAllConnections" in listener) listener.closeAllConnections();
      await new Promise<void>((done, reject) =>
        listener.close((error) => (error ? reject(error) : done())),
      );
      await endpoint.close();
    }
  },
  60_000,
);
