import { setFreshManagementSignIn } from "./testing/fresh-management-sign-in.js";
import { execFileSync } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createServer as createHttpsServer } from "node:https";
import { sql } from "drizzle-orm";
import { generateSync } from "otplib";
import { once } from "node:events";
import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { chromium, type Browser } from "playwright";
import { afterAll, afterEach, beforeAll, expect, it, vi } from "vitest";
import {
  openVenueDatabase,
  readNodeMembership,
  withTransaction,
  writeNodeMembership,
} from "@waitron/db";
import { signDocumentBody } from "@waitron/membership";
import { startManagementSession } from "@waitron/identity";
import { MANAGEMENT_COOKIE } from "@waitron/server-kit";
import { createFirstSetupCoordinator } from "@waitron/provisioning";
import { CORE_MIGRATIONS } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { readOpenHandoverOperation } from "@waitron/node-db";
import {
  ADMIN,
  ADMIN_EMAIL,
  PASSWORD,
  ring,
  fiscalModules,
  placedSpareFixture,
  primary,
  standby,
} from "./testing/handover-placed-copy.js";
import { NODE_MIGRATIONS } from "@waitron/node-db";
import { beginHandover } from "./handover-store.js";
import { mountHandoverPage } from "./handover-page-mount.js";
import { createHandoverGate } from "./handover-gate.js";
import { stepDown } from "./handover-stepdown.js";
import { mountPeerStatusApi } from "./peer-status-api.js";
import { mountHandoverStatusApi } from "./handover-status-api.js";
import { mountHandoverSourceStartApi } from "./handover-source-start-api.js";
import { mountHandoverDestinationApi } from "./handover-destination-api.js";
import { mountHandoverSourceApi } from "./handover-source-api.js";
import { startHandoverDestinationDuty } from "./handover-destination-duty.js";
import { compareFinalCopy } from "./handover-compare.js";
import { placeAcceptedCopyAtStart, recordCopyPlaced } from "./handover-place-copy.js";
import { createNodeOperationPreparation } from "./node-operation-preparation.js";
import { mountHandoverPreparationApi } from "./handover-preparation.js";
import { mountHandoverActivationApi } from "./handover-activation.js";
import { createPasswordThrottle } from "./password-throttle.js";
import { createDeploymentHolders } from "./deployment-holders.js";
import { promoteMirrorToPrimary } from "./promote.js";
import { mintSelfSignedServerCert } from "./self-signed-cert.js";
import { mountSpa } from "./spa-api.js";
import { freePorts } from "./testing/free-ports.js";
import { startServer, type StartedServer } from "./boot.js";
import { httpsVia, copyMigrationsRoot } from "./testing/boot-harness.js";
import { enrolAuthenticator, TOTP_KEY_RING } from "./testing/authenticator.js";
import { writeMirrorLink, readNodeMode } from "@waitron/node-db";
vi.mock("@waitron/fiscal-verifactu/src/hour-release.js", () => ({
  readHourRelease: () => ({ instantMs: Date.parse("2026-10-15T00:00:00Z") }),
}));
vi.mock("@waitron/fiscal-verifactu/src/hour-clock-internet.js", () => ({
  observeInternetHourClock: async () => ({
    source: "internet",
    result: "usable",
    instantMs: Date.now(),
    uncertaintyMs: 0,
    wallStartedMs: Date.now(),
    wallFinishedMs: Date.now(),
    monotonicStartedMs: performance.now(),
    monotonicFinishedMs: performance.now(),
  }),
}));
const OP = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const NODE = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const SOURCE = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const store = useVenueDb({ migrations: [CORE_MIGRATIONS, NODE_MIGRATIONS] });
const mainBox = useVenueDb({ migrations: migrationOptionsFor(manifestSets(), null) });
const spareBefore = useVenueDb({ migrations: migrationOptionsFor(manifestSets(), null) });
afterEach(() => vi.useRealTimers());
let root: string | undefined;
let browser: Browser | undefined;
beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), "handover-built-browser-"));
  await copyMigrationsRoot(join(root, "migrations"));
  execFileSync(
    "pnpm",
    ["--filter", "@waitron/setup", "exec", "vite", "build", "--outDir", join(root, "setup")],
    { cwd: resolve("../.."), stdio: "pipe", timeout: 90_000 },
  );
  const sourceEntry = `
import {LitElement,html} from ${JSON.stringify(resolve("../dashboard/node_modules/lit/index.js"))};
import {applyTokens,LeaveController} from ${JSON.stringify(resolve("../../packages/ui/src/index.ts"))};
import {DashboardApi} from ${JSON.stringify(resolve("../dashboard/src/api/client.ts"))};
import ${JSON.stringify(resolve("../dashboard/src/screens/servers-screen.ts"))};
import {setLocale,t} from ${JSON.stringify(resolve("../dashboard/src/i18n/t.ts"))};
applyTokens(document.documentElement);setLocale("en-GB");
class App extends LitElement { leave=new LeaveController(this); api=new DashboardApi(); render(){return html\`<dashboard-servers-screen .api=\${this.api} .canPromote=\${true} @handover-open=\${event=>{location.href=event.detail.url}}></dashboard-servers-screen>\${this.leave.render({heading:t("unsaved.heading"),message:t("unsaved.message"),keepLabel:t("unsaved.keep"),discardLabel:t("unsaved.discard")})}\`;}}
customElements.define("handover-browser-app",App);
`;
  await writeFile(join(root, "source.js"), sourceEntry);
  await writeFile(
    join(root, "index.html"),
    '<!doctype html><html lang="en"><head><title>Servers qualification</title></head><body><handover-browser-app></handover-browser-app><script type="module" src="/source.js"></script></body></html>',
  );
  await writeFile(
    join(root, "vite.config.mjs"),
    `export default ${JSON.stringify({ root, base: "./", publicDir: false, build: { outDir: join(root, "dashboard"), emptyOutDir: true } })}`,
  );
  execFileSync(
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
    { cwd: resolve("../.."), stdio: "pipe", timeout: 90_000 },
  );
  browser = await chromium.launch({ headless: true });
}, 120_000);
afterAll(async () => {
  await browser?.close();
  if (root) await rm(root, { recursive: true, force: true });
});
it("opens the built handover page and its relative assets, including after a reload", async () => {
  await beginHandover(
    { node: store.node, nodeId: NODE },
    {
      operationId: OP,
      scenario: "controlled",
      venue: { country: "ES", taxId: "B12345678", environment: "preproduction" },
      sourceNodeId: SOURCE,
      destinationNodeId: NODE,
      membership: { term: 1, digest: "a".repeat(64) },
    },
    "destination",
  );
  const app = new Hono();
  app.get(`/api/node/handover/${OP}`, (c) =>
    c.json({
      body: {
        operationId: OP,
        role: "destination",
        state: "prepared",
        scenario: "controlled",
        sourceNodeId: SOURCE,
        destinationNodeId: NODE,
        waitingReason: null,
      },
    }),
  );
  mountHandoverPage(app, { root: join(root!, "setup"), node: store.node, nodeId: NODE }, () => {});
  const listener = serve({ fetch: app.fetch, hostname: "127.0.0.1", port: 0 });
  const page = await browser!.newPage({ locale: "en-GB" });
  page.setDefaultTimeout(5000);
  try {
    if (!listener.listening) await once(listener, "listening");
    const address = listener.address() as { port: number };
    const origin = `http://127.0.0.1:${address.port}`;
    const failures: string[] = [];
    page.on("response", (response) => {
      if (response.status() >= 400) failures.push(response.url());
    });
    await page.goto(`${origin}/handover/${OP}`, { waitUntil: "networkidle", timeout: 10_000 });
    expect(failures).toEqual([]);
    await page.getByRole("heading", { name: "Hand over the venue" }).waitFor();
    await page.getByText("Preparing the final copy", { exact: false }).waitFor();
    expect(failures).toEqual([]);
    await page.reload();
    await page.getByRole("heading", { name: "Hand over the venue" }).waitFor();
  } finally {
    await page.close();
    await new Promise<void>((done, reject) =>
      listener.close((error) => (error ? reject(error) : done())),
    );
  }
}, 30_000);

it("shares two fresh boxes without stopping the source before the browser starts handover", async () => {
  vi.useFakeTimers({ toFake: ["Date", "performance"] });
  vi.setSystemTime(new Date("2026-10-16T11:40:00Z"));
  const directory = await mkdtemp(join(root!, "two-box-seed-"));
  const fixture = placedSpareFixture({
    mainBox,
    spareBefore,
    dirs: () => ({
      mainState: join(directory, "main-state"),
      spareState: join(directory, "spare-state"),
      spareVenue: join(directory, "spare-venue"),
    }),
  });
  await fixture.setupBoxes();
  expect(await readOpenHandoverOperation(mainBox.node, primary.nodeId)).toBeNull();
  expect(await readOpenHandoverOperation(spareBefore.node, standby.nodeId)).toBeNull();
});

it("hands over from built Servers through a real copy, placement restart and clock activation on the spare", async () => {
  vi.useFakeTimers({ toFake: ["Date", "performance"] });
  vi.setSystemTime(new Date("2026-10-16T11:40:00Z"));
  const directory = await mkdtemp(join(root!, "full-flow-"));
  const dirs = {
    mainState: join(directory, "main-state"),
    spareState: join(directory, "spare-state"),
    spareVenue: join(directory, "spare-venue"),
  };
  const fixture = placedSpareFixture({ mainBox, spareBefore, dirs: () => dirs });
  const seeded = await fixture.setupBoxes();
  for (const stateDir of [dirs.mainState, dirs.spareState])
    await writeFile(
      join(stateDir, "modules.json"),
      JSON.stringify({ modules: { "fiscal-none": false } }),
    );
  const [bootPort] = await freePorts(1);
  vi.setSystemTime(new Date("2026-10-16T12:40:00Z"));
  const secret = await enrolAuthenticator(mainBox.db, ADMIN, TOTP_KEY_RING);
  const session = await withTransaction(mainBox.db, (tx) =>
    startManagementSession(tx, { personId: ADMIN }),
  );
  await withTransaction(mainBox.db, (tx) => setFreshManagementSignIn(tx, session.token));
  const material = mintSelfSignedServerCert({
    hostnames: ["localhost"],
    ipAddresses: ["127.0.0.1"],
    now: new Date(),
  });
  let source = new Hono(),
    destination = new Hono();
  const sourceListener = serve({
    createServer: createHttpsServer,
    serverOptions: { key: material.serverKeyPem, cert: material.serverCertPem },
    hostname: "127.0.0.1",
    port: 0,
    fetch: (request, env) => source.fetch(request, env),
  });
  const destinationListener = serve({
    createServer: createHttpsServer,
    serverOptions: { key: material.serverKeyPem, cert: material.serverCertPem },
    hostname: "127.0.0.1",
    port: 0,
    fetch: (request, env) => destination.fetch(request, env),
  });
  const context = await browser!.newContext({ ignoreHTTPSErrors: true, locale: "en-GB" });
  const page = await context.newPage();
  page.setDefaultTimeout(10_000);
  const trust = httpsVia(material.caCertPem);
  let duty: Awaited<ReturnType<typeof startHandoverDestinationDuty>>;
  let placed: Awaited<ReturnType<typeof openVenueDatabase>> | undefined;
  let booted: StartedServer | undefined;
  const notes: unknown[] = [];
  page.on("pageerror", (error) => {
    notes.push(["browser", error.message]);
  });
  page.on("console", (message) => {
    if (message.type() === "error") notes.push(["console", message.text()]);
  });
  const log = (...args: unknown[]) => {
    notes.push(args);
  };
  try {
    if (!sourceListener.listening) await once(sourceListener, "listening");
    if (!destinationListener.listening) await once(destinationListener, "listening");
    const sourceUrl = `https://127.0.0.1:${(sourceListener.address() as { port: number }).port}`;
    const destinationUrl = `https://127.0.0.1:${(destinationListener.address() as { port: number }).port}`;
    const body = {
      ...seeded.chart.body,
      nodes: seeded.chart.body.nodes.map((node) => ({
        ...node,
        contactUrl: node.nodeId === primary.nodeId ? sourceUrl : destinationUrl,
      })),
    };
    const chart = { ...seeded.chart, body, signature: signDocumentBody(body, seeded.mainKey) };
    await writeNodeMembership(mainBox.db, chart);
    await writeNodeMembership(spareBefore.db, chart);
    await writeMirrorLink(spareBefore.node, standby.nodeId, {
      originUrl: sourceUrl,
      boxHostname: "localhost",
      boxCaPem: material.caCertPem,
      originNodeId: primary.nodeId,
    });
    const mainDeps = { db: mainBox.db, node: mainBox.node, nodeId: primary.nodeId, ring };
    const spareDeps = {
      db: spareBefore.db,
      node: spareBefore.node,
      nodeId: standby.nodeId,
      ring,
      ...{ stateDir: dirs.spareState },
    };
    mountPeerStatusApi(destination, spareDeps, log);
    mountHandoverStatusApi(destination, spareDeps, log);
    mountHandoverDestinationApi(destination, { ...spareDeps, migrationsRoot: null }, log);
    mountHandoverPage(destination, { ...spareDeps, root: join(root!, "setup") }, log);
    const gate = createHandoverGate();
    source.use("*", gate.middleware);
    const listing = {
      term: 1,
      authorityFingerprint: null,
      nodes: body.nodes.map((node) => ({
        ...node,
        isSelf: node.nodeId === primary.nodeId,
        removable: false,
        canClear: false,
      })),
    };
    source.get("/management-api/servers", (c) => c.json(listing));
    source.get("/management-api/session/me/profile", (c) =>
      c.json({
        displayName: "Administrator",
        firstNames: null,
        lastNames: null,
        telephone: null,
        email: ADMIN_EMAIL,
        pendingEmail: null,
        locale: "en",
        hasPassword: true,
        hasTotp: true,
        hasGoogle: false,
        passkeys: [],
      }),
    );
    mountPeerStatusApi(source, mainDeps, log);
    mountHandoverStatusApi(source, mainDeps, log);
    let sourceRestarted!: () => void;
    const restarted = new Promise<void>((resolve) => {
      sourceRestarted = resolve;
    });
    mountHandoverSourceStartApi(
      source,
      {
        ...mainDeps,
        stateDir: dirs.mainState,
        migrationsRoot: null,
        advertisedOrigin: sourceUrl,
        venueCanPromote: true,
        gate,
        fetch: (url, init) => fetch(url, { ...init, ...trust.via }),
        stepDownAfterOffer: async (self, binding) => {
          await stepDown(
            {
              node: mainBox.node,
              nodeId: primary.nodeId,
              gate,
              duties: { aborts: [], closers: [] },
              log,
              close: async () => {
                const app = new Hono();
                mountPeerStatusApi(app, mainDeps, log);
                mountHandoverStatusApi(app, mainDeps, log);
                mountHandoverSourceApi(
                  app,
                  {
                    venue: mainBox.db,
                    node: mainBox.node,
                    ring,
                    nodeId: primary.nodeId,
                    stateDir: dirs.mainState,
                    modules: fiscalModules,
                  },
                  log,
                );
                source = app;
              },
              restart: sourceRestarted,
            },
            { binding, kind: "handed-over", self },
          );
        },
      },
      log,
    );
    mountSpa(
      source,
      { root: join(root!, "dashboard"), basePath: "/manage", navigationPath: "/manage" },
      log,
    );
    await context.addCookies([
      { name: MANAGEMENT_COOKIE, value: session.token, url: sourceUrl, secure: true },
    ]);
    await page.clock.install({ time: Date.now() });
    await page.clock.setFixedTime(Date.now());
    await page.goto(`${sourceUrl}/manage/`);
    await page
      .getByRole("button", { name: /Actions|Acciones/ })
      .first()
      .click();
    await page.getByRole("button", { name: "Hand over the venue", exact: true }).click();
    await page.getByRole("button", { name: "Hand over the venue", exact: true }).click();
    await page.waitForURL(`${destinationUrl}/handover/*`);
    await restarted;
    const operationId = new URL(page.url()).pathname.split("/").at(-1)!;
    let wantsPlacement!: () => void;
    const placement = new Promise<void>((resolve) => {
      wantsPlacement = resolve;
    });
    duty = await startHandoverDestinationDuty({
      ...spareDeps,
      venueDir: dirs.spareVenue,
      log,
      tickMs: 25,
      compareRetryMs: 25,
      restart: wantsPlacement,
      compare: (operation, indicator, path, options) =>
        compareFinalCopy(
          { ...spareDeps, modules: fiscalModules, migrationsRoot: null },
          operation,
          indicator,
          path,
          options,
        ),
    });
    let placementTimer: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        placement,
        new Promise<never>((_, reject) => {
          placementTimer = setTimeout(() => reject(new Error(JSON.stringify(notes))), 20_000);
        }),
      ]);
    } finally {
      clearTimeout(placementTimer);
    }
    await duty!.stop();
    duty = undefined;
    await spareBefore.db.run(sql`vacuum into ${join(dirs.spareVenue, "venue.db")}`);
    await spareBefore.node.run(sql`vacuum into ${join(dirs.spareVenue, "node.db")}`);
    expect(
      await placeAcceptedCopyAtStart({
        ...dirs,
        venueDir: dirs.spareVenue,
        stateDir: dirs.spareState,
        nodeId: standby.nodeId,
        log,
      }),
    ).toMatchObject({ kind: "copy_placed_owed", swapped: true });
    placed = await openVenueDatabase(dirs.spareVenue);
    await recordCopyPlaced({
      node: placed.node,
      nodeId: standby.nodeId,
      stateDir: dirs.spareState,
      operationId,
      log,
    });
    const service = createNodeOperationPreparation({
      stateDir: dirs.spareState,
      venueDir: dirs.spareVenue,
      db: placed.venue,
      nodeDb: placed.node,
      node: standby,
      modules: fiscalModules,
      credentialKeyRing: TOTP_KEY_RING,
      coordinator: createFirstSetupCoordinator(),
      environment: {},
    });
    const common = {
      node: placed.node,
      nodeId: standby.nodeId,
      appDb: placed.venue,
      nodePreparation: service,
      passwordThrottle: createPasswordThrottle(),
    };
    const app = new Hono();
    mountHandoverStatusApi(
      app,
      { db: placed.venue, node: placed.node, nodeId: standby.nodeId, ring },
      log,
    );
    mountHandoverPreparationApi(app, { ...common, requestFromBox: () => false }, log);
    mountHandoverActivationApi(
      app,
      {
        ...common,
        run: async (attestation, runner, beforeRestart) => {
          const result = await promoteMirrorToPrimary(
            {
              db: placed!.venue,
              node: placed!.node,
              nodeId: standby.nodeId,
              ring,
              modules: fiscalModules,
              holders: createDeploymentHolders("mirror", "secondary"),
              log,
              persistTradingEnv: async () => {},
              withModuleOperations: runner,
            },
            attestation,
          );
          await beforeRestart?.();
          return { alreadyPrimary: result.alreadyPrimary, restarting: !result.alreadyPrimary };
        },
      },
      log,
    );
    mountHandoverPage(
      app,
      { root: join(root!, "setup"), node: placed.node, nodeId: standby.nodeId },
      log,
    );
    destination = app;
    await page.reload();
    await page.locator('input[name="handover-email"]').fill(ADMIN_EMAIL);
    await page.locator('input[name="handover-password"]').fill(PASSWORD);
    await page.locator('input[name="handover-code"]').fill(generateSync({ secret }));
    await page.getByRole("button", { name: "Continue to clock check" }).click();
    expect(Math.abs((await page.evaluate(() => Date.now())) - Date.now())).toBeLessThan(10_000);
    let activationRequest: unknown;
    page.on("request", (request) => {
      if (request.url().endsWith("/preparation"))
        notes.push(["proposal", request.postDataJSON().proposal]);
      if (request.url().endsWith("/activate")) activationRequest = request.postDataJSON();
    });
    page.on("response", (response) => {
      if (response.url().endsWith("/preparation"))
        void response.json().then((result) => notes.push(["preparation", result]));
    });
    await page.locator('input[name="recovery-details-confirmed"]').check();
    await page.getByRole("button", { name: "Proceed", exact: true }).click();
    await page.getByText("This box has taken over the venue.", { exact: true }).waitFor();
    expect((await readNodeMode(placed.node, standby.nodeId)).mode).toBe("primary");
    expect(
      (await readNodeMembership(placed.venue))!.body.nodes.find(
        (node) => node.nodeId === standby.nodeId,
      )!.standing,
    ).toBe("serving-primary");
    await page.reload();
    await page.getByText("This box has taken over the venue.", { exact: true }).waitFor();
    await placed.close();
    placed = undefined;
    const bootUrl = `https://127.0.0.1:${bootPort}`;
    const bootCert = join(root!, "boot.crt");
    const bootKey = join(root!, "boot.key");
    await writeFile(bootCert, material.serverCertPem);
    await writeFile(bootKey, material.serverKeyPem);
    const bootEnv = {
      WAITRON_MIGRATIONS_DIR: join(root!, "migrations"),
      WAITRON_ENV: "preproduction",
      WAITRON_STATE_DIR: dirs.spareState,
      WAITRON_VENUE_DIR: dirs.spareVenue,
      WAITRON_NODE_ID: standby.nodeId,
      WAITRON_CREDENTIALS_KEY: Buffer.alloc(32, 7).toString("base64"),
      WAITRON_CREDENTIALS_KEY_VERSION: "1",
      WAITRON_HTTP_HOST: "127.0.0.1",
      WAITRON_HTTP_PORT: String(bootPort),
      WAITRON_HTTP_LANDING_PORT: "0",
      WAITRON_SETUP_APP_DIR: join(root!, "setup"),
      WAITRON_MANAGEMENT_ORIGIN: bootUrl,
      WAITRON_MANAGEMENT_RP_ID: "localhost",
      WAITRON_TLS_CERT_FILE: bootCert,
      WAITRON_TLS_KEY_FILE: bootKey,
      WAITRON_LOG_DIR: join(directory, "boot-logs"),
    };
    const bootSeams = {
      spareBytes: 0,
      // The old box is kept silent to qualify the post-activation waiting boot.
      peerCheck: async () => ({
        result: "wait" as const,
        successorNodeId: null,
        waitingOn: [primary.nodeId],
      }),
      waitingStart: { intervalMs: 60_000 },
    };
    booted = await startServer(bootEnv, {}, bootSeams);
    await page.goto(`${bootUrl}/handover/${operationId}`);
    await page.getByText("This box has taken over the venue.", { exact: true }).waitFor();
    await page.getByRole("link", { name: "Continue to this box" }).click();
    await page.getByRole("heading", { name: /This box is waiting/ }).waitFor();
    const waitingActivation = await page.request.post(
      `${bootUrl}/api/node/handover/${operationId}/activate`,
      { data: activationRequest, headers: { origin: bootUrl } },
    );
    expect(activationRequest).toBeDefined();
    expect(waitingActivation.status()).toBe(404);
    await waitingActivation.dispose();
    await booted.close();
    booted = undefined;
    const copied = await openVenueDatabase(dirs.spareVenue);
    try {
      const held = (await readNodeMembership(copied.venue))!;
      const next = {
        ...held.body,
        term: held.body.term + 1,
        nodes: held.body.nodes.map((node) => ({
          ...node,
          standing:
            node.nodeId === standby.nodeId ? ("evicted" as const) : ("serving-primary" as const),
        })),
      };
      await writeNodeMembership(copied.venue, {
        ...held,
        body: next,
        signerNodeId: standby.nodeId,
        signature: signDocumentBody(next, seeded.spareKey),
      });
    } finally {
      await copied.close();
    }
    booted = await startServer(bootEnv, {}, bootSeams);
    for (const path of [`/handover/${operationId}`, "/handover/assets/anything.js"]) {
      const answer = await page.request.get(bootUrl + path, { headers: { Accept: "text/html" } });
      expect(answer.status()).toBe(404);
      await answer.dispose();
    }
  } catch (error) {
    console.error(JSON.stringify({ notes, error: String(error) }));
    throw error;
  } finally {
    await booted?.close();
    await duty?.stop();
    await context.close();
    await trust.close();
    await Promise.all(
      [sourceListener, destinationListener].map(
        (listener) =>
          new Promise<void>((done, reject) =>
            listener.close((error) => (error ? reject(error) : done())),
          ),
      ),
    );
    await placed?.close();
  }
}, 90_000);
