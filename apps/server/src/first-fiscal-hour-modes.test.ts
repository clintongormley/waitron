import { mkdtemp, mkdir, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { Hono } from "hono";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ALL_MODULES } from "@waitron/composition";
import { loadKeyRing } from "@waitron/credentials";
import { invoiceSeries, tenants } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { TEST_MIGRATIONS } from "@waitron/fiscal-verifactu/test/migrations.js";
import { parseModuleConfig } from "@waitron/module";
import { mountSetup } from "./setup-api.js";
import { createFirstSetupModuleHost } from "./module-operation-host.js";
import { provisionVenue, recoverProvisionedVenue, venueModuleConfig } from "./provision.js";
import { request, PASSWORD } from "../test/first-fiscal.js";
import { ownedHourSetup } from "../test/owned-hour-setup.js";
import { establishNodeIdentity } from "./node-identity.js";
import { seedTermZeroMembership } from "./membership-seed.js";
vi.mock("@waitron/fiscal-verifactu/src/hour-clock-internet.js", () => ({
  observeInternetHourClock: async () => {
    const mono = performance.now(),
      now = Date.now();
    return {
      source: "internet",
      result: "usable",
      instantMs: now,
      uncertaintyMs: 500,
      wallStartedMs: now,
      wallFinishedMs: now,
      monotonicStartedMs: mono,
      monotonicFinishedMs: mono,
    };
  },
}));
vi.mock("@waitron/fiscal-verifactu/src/hour-release.js", () => ({
  readHourRelease: () => ({ instantMs: Date.parse("2026-10-15T00:00:00Z") }),
}));
beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-16T11:40:00Z"));
});
afterEach(() => vi.useRealTimers());

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
  const app = new Hono();
  mountSetup(
    app,
    {
      environment: "preproduction",
      devMode: true,
      firstFiscal: host,
      db: venue.db,
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
              req.venue.location.fiscalTerritory,
            ),
          },
          req,
          host.modules,
        ),
      recoverProvision: (req) => recoverProvisionedVenue(venue.db, req, host.modules),
      seedDemo: async () => {},
      establishIdentity: (id) => establishNodeIdentity({ ownerDb: venue.db, ring }, id),
      seedMembership: (id) =>
        seedTermZeroMembership({ db: venue.db, ring }, id, "https://test.example"),
      persistTrading: async () => {},
      requestRestart: () => {},
    },
    () => {},
  );
  return { app, stateDir };
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
    expect(await venue.db.select().from(tenants)).toEqual([]);
    expect(await venue.db.select().from(invoiceSeries)).toEqual([]);
  },
);

it.each(["demo", "prepare"])(
  "%s still prepares automatically without ownership or a recovery document",
  async (mode) => {
    const { app, stateDir } = await fixture();
    const response = await app.request("/setup-api/provision", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mode, venue: request }),
    });
    expect({ status: response.status, body: await response.json() }).toMatchObject({
      status: 200,
      body: { provisioned: true, restarting: true },
    });
    expect((await venue.db.select().from(tenants)).map(({ taxId }) => taxId)).toEqual([
      "50000000R",
    ]);
    expect(
      (await venue.db.select().from(invoiceSeries)).map(({ code, purpose, nextNumber }) => ({
        code,
        purpose,
        nextNumber,
      })),
    ).toEqual([
      { code: "A-06RB", purpose: "standard", nextNumber: 1 },
      { code: "FF-06RB", purpose: "full", nextNumber: 1 },
      { code: "R-06RB", purpose: "rectificative", nextNumber: 1 },
    ]);
    await expect(readFile(join(stateDir, "first-setup.json"))).rejects.toMatchObject({
      code: "ENOENT",
    });
    await expect(readFile(join(stateDir, "module-preparation-state.json"))).rejects.toMatchObject({
      code: "ENOENT",
    });
  },
);

it("owned development Live consumes its durable hour through publication without production credentials", async () => {
  const { app, stateDir } = await fixture();
  const owned = await ownedHourSetup(
    async (input, init) => app.request(String(input), init),
    "https://box.test",
    request,
    PASSWORD,
  );
  const before = await readFile(join(stateDir, "module-preparation-state.json"), "utf8");
  const response = await app.request("https://box.test/setup-api/provision", {
    method: "POST",
    headers: owned.headers,
    body: JSON.stringify({ mode: "live" }),
  });
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
    { code: "A-06RB", nextNumber: 1 },
    { code: "FF-06RB", nextNumber: 1 },
    { code: "R-06RB", nextNumber: 1 },
  ]);
  expect(await readFile(join(stateDir, "module-preparation-state.json"), "utf8")).toBe(before);
});
