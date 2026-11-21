import { randomBytes, randomUUID } from "node:crypto";
import { mkdtemp, mkdir, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { Socket } from "node:net";
import { TLSSocket } from "node:tls";
import { tmpdir } from "node:os";
import { Hono } from "hono";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ALL_MODULES } from "@waitron/composition";
import { loadKeyRing } from "@waitron/credentials";
import { invoiceSeries, taxpayer } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { TEST_MIGRATIONS } from "@waitron/fiscal-verifactu/test/migrations.js";
import { parseModuleConfig } from "@waitron/module";
import { mountSetup, type SetupDeps } from "./setup-api.js";
import { createSetupOperationStore } from "./setup-operation.js";
import { createFirstSetupModuleHost } from "./module-operation-host.js";
import { provisionVenue, recoverProvisionedVenue, venueModuleConfig } from "./provision.js";
import { request, PASSWORD } from "../test/first-fiscal.js";
import { ownedHourSetup } from "../test/owned-hour-setup.js";
import { establishNodeIdentity } from "./node-identity.js";
import { seedTermZeroMembership } from "./membership-seed.js";
import { createFakeTimersHourClock, type HourTestClock } from "./testing/hour-test-clock.js";
const time = vi.hoisted(() => ({ clock: undefined as unknown as HourTestClock }));
let socket: TLSSocket;
vi.mock("@waitron/fiscal-verifactu/src/hour-clock-time-service.js", () => ({
  observeTimeServiceHourClock: async () => ({
    source: "internet",
    result: "usable",
    instantMs: time.clock.wall(),
    uncertaintyMs: 500,
    wallStartedMs: time.clock.wall(),
    wallFinishedMs: time.clock.wall(),
    monotonicStartedMs: time.clock.monotonic(),
    monotonicFinishedMs: time.clock.monotonic(),
  }),
}));
vi.mock("@waitron/fiscal-verifactu/src/hour-release.js", () => ({
  readHourRelease: () => ({ instantMs: Date.parse("2026-10-15T00:00:00Z") }),
}));
beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date", "performance"] });
  vi.setSystemTime(new Date("2026-10-16T11:40:00Z"));
  time.clock = createFakeTimersHourClock();
  socket = new TLSSocket(new Socket());
});
afterEach(() => {
  socket.destroy();
  vi.useRealTimers();
});

const venue = useVenueDb({ migrations: TEST_MIGRATIONS });
const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "owned-mode-"));
  roots.push(root);
  const stateDir = join(root, "state");
  await mkdir(stateDir);
  const host = createFirstSetupModuleHost({
    stateDir,
    venueDir: join(root, "venue"),
    modules: ALL_MODULES,
    environment: {},
    database: () => venue.db,
  });
  const ring = loadKeyRing({ WAITRON_CREDENTIALS_KEY: Buffer.alloc(32, 29).toString("base64") });
  const mount = (overrides: Partial<SetupDeps> = {}) => {
    const app = new Hono();
    mountSetup(
      app,
      {
        environment: "preproduction",
        devMode: true,
        firstFiscal: host,
        db: venue.db,
        node: venue.node,
        ring,
        provision: (req, beforeTransaction) =>
          provisionVenue(
            {
              ownerDb: venue.db,
              beforeTransaction,
              stateDir,
              database: "owned-mode",
              moduleConfig: venueModuleConfig(
                parseModuleConfig({}, host.modules),
                req.venue.fiscalTerritory,
              ),
            },
            req,
            host.modules,
          ),
        recoverProvision: (req) => recoverProvisionedVenue(venue.db, req, host.modules),
        seedDemo: async () => {},
        establishIdentity: (id) =>
          establishNodeIdentity({ ownerDb: venue.db, node: venue.node, ring }, id),
        seedMembership: (id) =>
          seedTermZeroMembership(
            { db: venue.db, node: venue.node, ring },
            id,
            "https://test.example",
          ),
        persistTrading: async () => {},
        requestRestart: () => {},
        ...overrides,
      },
      () => {},
    );
    return app;
  };
  return { app: mount(), stateDir, mount };
}

it.each([false, true])(
  "development Live requires owned hour selection (configuration import: %s)",
  async (configurationImport) => {
    const { app } = await fixture();
    const response = await app.request("/setup-api/provision", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mode: "live", venue: request, configurationImport }),
    });
    const body = await response.json();
    expect({ status: response.status, body }).toEqual({
      status: 403,
      body: { error: { code: "setup.owner_required", params: {} } },
    });
    expect(await venue.db.select().from(taxpayer)).toEqual([]);
    expect(await venue.db.select().from(invoiceSeries)).toEqual([]);
  },
);

it.each(["demo", "prepare"])(
  "%s still prepares automatically without ownership or a recovery document",
  async (mode) => {
    const { app, stateDir } = await fixture();
    const response = await app.request(
      "https://box.test/setup-api/provision",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode, venue: request }),
      },
      { incoming: { socket } },
    );
    expect({ status: response.status, body: await response.json() }).toMatchObject({
      status: 200,
      body: { provisioned: true, restarting: true },
    });
    expect((await venue.db.select().from(taxpayer)).map(({ taxId }) => taxId)).toEqual([
      "50000000R",
    ]);
    expect(
      (await venue.db.select().from(invoiceSeries)).map(({ code, purpose, nextNumber }) => ({
        code,
        purpose,
        nextNumber,
      })),
    ).toEqual([
      { code: "A-0CNNW", purpose: "standard", nextNumber: 1 },
      { code: "FF-0CNNW", purpose: "full", nextNumber: 1 },
      { code: "R-0CNNW", purpose: "rectificative", nextNumber: 1 },
    ]);
    await expect(readFile(join(stateDir, "flows/setup/record.json"))).rejects.toMatchObject({
      code: "ENOENT",
    });
    await expect(
      readFile(join(stateDir, "module-records/fiscal-verifactu.json")),
    ).rejects.toMatchObject({
      code: "ENOENT",
    });
  },
);

it("owned development Live saves its durable hour and marks the matching Cloud sign-in only after publication", async () => {
  const { mount, stateDir } = await fixture();
  const tab = randomUUID();
  const session = randomBytes(32).toString("base64url");
  const persistTrading = vi.fn<NonNullable<SetupDeps["persistTrading"]>>(async () => {});
  const publishSetupSignIn = vi.fn(async () => {
    expect(persistTrading).toHaveBeenCalledOnce();
  });
  const app = mount({
    persistTrading,
    cloudSignIn: {
      origin: "https://box.test",
      connection: {
        setupSignInAvailable: async () => true,
        startSignIn: async () => ({}),
        returnSignIn: async () => {},
        publishSetupSignIn,
      },
    },
  });
  const owned = await ownedHourSetup(
    async (input, init) => app.request(String(input), init),
    "https://box.test",
    request,
    PASSWORD,
    undefined,
    time.clock,
  );
  const before = await readFile(join(stateDir, "module-records/fiscal-verifactu.json"), "utf8");
  const response = await app.request(
    "https://box.test/setup-api/provision",
    {
      method: "POST",
      headers: {
        ...owned.headers,
        origin: "https://box.test",
        cookie: "__Host-waitron-setup-cloud=" + session,
        "x-waitron-setup-cloud-tab": tab,
      },
      body: JSON.stringify({ mode: "live" }),
    },
    { incoming: { socket } },
  );
  expect(publishSetupSignIn).toHaveBeenCalledExactlyOnceWith(
    { tab, session, kind: "setup" },
    persistTrading.mock.calls[0]?.[0].nodeId,
  );
  expect({ status: response.status, body: await response.json() }).toMatchObject({
    status: 200,
    body: { provisioned: true, restarting: true },
  });
  expect(
    (await venue.db.select().from(invoiceSeries)).map(({ code, nextNumber }) => ({
      code,
      nextNumber,
    })),
  ).toEqual([
    { code: "A-0CNNY", nextNumber: 1 },
    { code: "FF-0CNNY", nextNumber: 1 },
    { code: "R-0CNNY", nextNumber: 1 },
  ]);
  expect(await readFile(join(stateDir, "module-records/fiscal-verifactu.json"), "utf8")).toBe(
    before,
  );
});

it("a Demo stopped after its venue committed is not resumed by a Prepare request, so the demo tax ID never becomes a Prepare venue's", async () => {
  const { mount, stateDir } = await fixture();
  const demo = JSON.stringify({ mode: "demo", venue: { ...request, taxId: "B00000000" } });
  const post = (app: Hono, body: string) =>
    app.request(
      "https://box.test/setup-api/provision",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body,
      },
      { incoming: { socket } },
    );
  const stopped = mount({
    operations: createSetupOperationStore(stateDir),
    persistTrading: async () => {
      throw new Error("disk unavailable");
    },
  });
  expect((await post(stopped, demo)).status).toBe(500);
  expect((await createSetupOperationStore(stateDir).read())?.phase).toBe("secret_sealed");

  const persistTrading = vi.fn<NonNullable<SetupDeps["persistTrading"]>>(async () => {});
  const restarted = mount({ operations: createSetupOperationStore(stateDir), persistTrading });
  const prepare = await post(restarted, JSON.stringify({ mode: "prepare", venue: request }));
  expect({ status: prepare.status, body: await prepare.json() }).toEqual({
    status: 409,
    body: { error: { code: "setup.operation_conflict", params: {} } },
  });
  expect(persistTrading).not.toHaveBeenCalled();
  expect((await venue.db.select().from(taxpayer)).map(({ taxId }) => taxId)).toEqual(["B00000000"]);

  expect((await post(restarted, demo)).status).toBe(200);
  expect(persistTrading).toHaveBeenCalledOnce();
  expect(persistTrading.mock.calls[0]![0].onboardingIntent).toBe("demo");
});
