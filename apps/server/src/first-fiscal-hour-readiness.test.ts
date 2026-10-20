import { randomBytes } from "node:crypto";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { Hono } from "hono";
import { ALL_MODULES } from "@waitron/composition";
import { loadKeyRing } from "@waitron/credentials";
import { tenants } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { TEST_MIGRATIONS } from "@waitron/fiscal-verifactu/test/migrations.js";
import { fiscalAllocations } from "@waitron/fiscal-verifactu/src/schema/allocations.js";
import { ownedHourSetup } from "../test/owned-hour-setup.js";
import { provisionVenue, recoverProvisionedVenue, venueModuleConfig } from "./provision.js";
import { establishNodeIdentity } from "./node-identity.js";
import { seedTermZeroMembership } from "./membership-seed.js";
import { activateFirstFiscal } from "./first-fiscal-activation.js";
import type { SetupDeps } from "./setup-api.js";
import { PASSWORD } from "../test/first-fiscal.js";
import { enabledModules, parseModuleConfig } from "@waitron/module";
import { venueFiscalSelection } from "@waitron/provisioning";
import { createFirstSetupModuleHost } from "./module-operation-host.js";
import { fiscalReadinessInput, submitFiscalReadiness } from "./fiscal-readiness-runner.js";
import { mountSetup } from "./setup-api.js";
import { request } from "../test/first-fiscal.js";

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
  vi.useFakeTimers({ toFake: ["Date", "performance"] });
  vi.setSystemTime(new Date("2026-10-16T11:40:00Z"));
});
afterEach(() => vi.useRealTimers());

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function fixture(environment: "production" | "preproduction") {
  const root = await mkdtemp(join(tmpdir(), "first-fiscal-mode-"));
  roots.push(root);
  const stateDir = join(root, "state");
  const host = createFirstSetupModuleHost({
    stateDir,
    venueDir: join(root, "venue"),
    environment: {},
    modules: ALL_MODULES,
  });
  const claim = await host.owner.claimFirstSetup(
    { environment, request },
    randomBytes(32).toString("base64url"),
  );
  const ring = loadKeyRing({
    WAITRON_CREDENTIALS_KEY: Buffer.alloc(32, 17).toString("base64"),
    WAITRON_CREDENTIALS_KEY_VERSION: "1",
  });
  const app = new Hono();
  mountSetup(
    app,
    {
      environment,
      devMode: environment === "preproduction",
      firstFiscal: host,
      runFiscalTest: async ({ request: req, contribution, secret }) => {
        const selected = venueFiscalSelection(ALL_MODULES, req.venue.location.fiscalTerritory);
        const modules = enabledModules(ALL_MODULES, selected.config);
        const input = fiscalReadinessInput({
          venue: req.venue,
          contribution,
          secret,
          moduleVersions: { "fiscal-verifactu": 1 },
          applicationVersion: "a679-mode-test",
        });
        return submitFiscalReadiness({
          stateDir,
          modules,
          venue: req.venue,
          contribution,
          secret,
          ring,
          readinessInput: input,
        });
      },
    },
    () => {},
  );
  const post = (body: unknown = { mode: "live" }) =>
    app.request("/setup-api/fiscal-test", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Waitron-Setup-Owner": claim.capability,
        "X-Waitron-Setup-Attempt": claim.state.attemptId,
        "X-Waitron-Setup-Revision": String(claim.state.revision),
        "X-Waitron-Setup-Generation": String(claim.state.ownerGeneration),
      },
      body: JSON.stringify(body),
    });
  return { root, stateDir, host, post };
}

function inspect(directory: string) {
  const db = new DatabaseSync(join(directory, "venue.db"), { readOnly: true });
  try {
    return {
      deployment: db.prepare("select environment from deployment").all(),
      records: db.prepare("select entorno from registros_facturacion").all(),
      credentials: db.prepare("select purpose from tenant_credentials").all(),
      series: db.prepare("select purpose, next_number from invoice_series order by purpose").all(),
    };
  } finally {
    db.close();
  }
}

it("owned development Live readiness runs the real certificate-free preproduction contribution", async () => {
  const f = await fixture("preproduction");
  const response = await f.post();
  const body = await response.json();
  expect({ status: response.status, body }).toEqual({ status: 200, body: { status: "uncertain" } });
  const [name] = (await readdir(f.stateDir)).filter((name) =>
    name.startsWith("fiscal-readiness-db-"),
  );
  expect(name).toBeDefined();
  const first = inspect(join(f.stateDir, name!));
  expect(first.deployment).toEqual([{ environment: "preproduction" }]);
  expect(first.records).toEqual([{ entorno: "preproduction" }]);
  expect(first.credentials).toEqual([]);
  expect(first.series).toEqual([
    { purpose: "full", next_number: 1 },
    { purpose: "rectificative", next_number: 1 },
    { purpose: "standard", next_number: 2 },
  ]);
  const second = await f.post();
  expect({ status: second.status, body: await second.json() }).toEqual({
    status: 200,
    body: { status: "uncertain" },
  });
  expect(inspect(join(f.stateDir, name!))).toEqual(first);
  expect((await f.host.store.read())!.status).toBe("claimed");
  await expect(readFile(join(f.root, "venue", "venue.db"))).rejects.toMatchObject({
    code: "ENOENT",
  });
});

it("owned production Live refuses a missing certificate before creating a readiness database", async () => {
  const f = await fixture("production");
  const response = await f.post();
  expect({ status: response.status, body: await response.json() }).toEqual({
    status: 400,
    body: {
      error: { code: "setup.provisioning_secret_required", params: { module: "verifactu" } },
    },
  });
  expect((await readdir(f.stateDir)).some((name) => name.startsWith("fiscal-readiness-db-"))).toBe(
    false,
  );
});

const venue = useVenueDb({ migrations: TEST_MIGRATIONS });
async function preparedActivation(environment: "production" | "preproduction") {
  const root = await mkdtemp(join(tmpdir(), "hour-readiness-activation-"));
  roots.push(root);
  const f = {
    root,
    stateDir: join(root, "state"),
    venueDir: join(root, "venue"),
    modules: ALL_MODULES.filter((module) =>
      ["core", "fiscal-verifactu", "fiscal-none"].includes(module.name),
    ),
  };
  const host = createFirstSetupModuleHost({ ...f, environment: {}, database: () => venue.db });
  const ring = loadKeyRing({ WAITRON_CREDENTIALS_KEY: Buffer.alloc(32, 29).toString("base64") });
  const published: unknown[] = [];
  const deps: SetupDeps = {
    environment,
    devMode: environment === "preproduction",
    db: venue.db,
    ring,
    firstFiscal: host,
    provision: (req, beforeTransaction) =>
      provisionVenue(
        {
          ownerDb: venue.db,
          stateDir: f.stateDir,
          database: "synthetic-hour-readiness",
          moduleConfig: venueModuleConfig(
            parseModuleConfig({}, f.modules),
            req.venue.location.fiscalTerritory,
          ),
          beforeTransaction,
        },
        req,
        host.modules,
      ),
    recoverProvision: (req) => recoverProvisionedVenue(venue.db, req, host.modules),
    establishIdentity: (id) => establishNodeIdentity({ ownerDb: venue.db, ring }, id),
    seedMembership: (id) =>
      seedTermZeroMembership({ db: venue.db, ring }, id, "https://test.example"),
    persistTrading: async (value) => {
      published.push(value);
    },
  };
  const body =
    environment === "preproduction"
      ? { mode: "live" }
      : {
          mode: "live",
          aeatCert: { pfxBase64: "Y2VydA==", passphrase: "synthetic", certKind: "sello" },
          email: {
            server: "smtp.example.test",
            port: 465,
            encryption: "tls",
            from: "owner@example.test",
          },
        };
  const app = new Hono();
  mountSetup(app, deps, () => {});
  const owned = await ownedHourSetup(
    async (input, init) => app.request(String(input), init),
    "https://box.test",
    request,
    PASSWORD,
  );
  const owner = { ...owned.state, capability: owned.headers["X-Waitron-Setup-Owner"]! };
  return {
    host,
    published,
    activate: () =>
      host.coordinator.run((hold) => activateFirstFiscal(host, deps, owner, body, hold)),
  };
}

it("owned preproduction Live can publish without an accepted authority submission or a certificate", async () => {
  const f = await preparedActivation("preproduction");
  const result = await f.activate();
  expect(result.nodeId).toEqual(expect.any(String));
  expect((await f.host.store.read())!.status).toBe("complete");
  expect(f.published).toEqual([
    expect.objectContaining({ environment: "preproduction", onboardingIntent: "live" }),
  ]);
  const rows = await venue.db.select().from(fiscalAllocations);
  expect(rows).toHaveLength(1);
  expect(rows[0]!.environment).toBe("preproduction");
});
it("owned production Live still refuses activation without accepted authority readiness after certificate validation", async () => {
  const f = await preparedActivation("production");
  await expect(f.activate()).rejects.toMatchObject({
    code: "setup.fiscal_test_required",
    params: { module: "verifactu" },
  });
  expect(f.published).toEqual([]);
  expect(await venue.db.select().from(tenants)).toEqual([]);
  expect(await venue.db.select().from(fiscalAllocations)).toEqual([]);
  expect((await f.host.store.read())!.status).toBe("consumption-intent");
});
