import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { sql } from "drizzle-orm";
import { Hono } from "hono";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AppError } from "@waitron/shared";
import type { VenueResult } from "@waitron/provisioning";
import type { Database } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { loadKeyRing, type KeyRing } from "@waitron/credentials";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { parseModuleConfig } from "@waitron/module";
import type { DeploymentEnvironment } from "./config.js";
import { createFiscalReadinessStore } from "./fiscal-readiness.js";
import { fiscalReadinessInput } from "./fiscal-readiness-runner.js";
import { ALL_MODULES } from "./modules.js";
import {
  provisionVenue,
  recoverProvisionedVenue,
  venueModuleConfig,
  type ProvisionRequest,
} from "./provision.js";
import type { Logger, LogLevel } from "./logger.js";
import { mountSetup, type SetupDeps } from "./setup-api.js";
import { createSetupOperationStore } from "./setup-operation.js";

type Mode = "demo" | "prepare" | "live";
type Box = { environment: DeploymentEnvironment; devMode: boolean };

const PRODUCTION_BOX: Box = { environment: "production", devMode: false };
const PREPRODUCTION_BOX: Box = { environment: "preproduction", devMode: false };
const DEV_BOX: Box = { environment: "preproduction", devMode: true };

const CERT = {
  pfxBase64: Buffer.from("fake-pfx-bytes").toString("base64"),
  passphrase: "cert-secret",
  certKind: "sello",
} as const;

const INITIAL_OPERATIONS = {
  nodeId: "44444444-4444-4444-4444-444444444444",
  administratorId: "88888888-8888-4888-8888-888888888888",
  inputs: [
    { module: "fiscal-verifactu", eventId: "event-1", sourceId: "source-1", input: { any: 1 } },
  ],
};

function venueResult(): VenueResult {
  return {
    locationId: "22222222-2222-2222-2222-222222222222",
    nodeId: "44444444-4444-4444-4444-444444444444",
    seriesIds: ["66666666-6666-6666-6666-666666666666"],
    seeded: [],
  };
}

function body(mode: Mode): Record<string, unknown> {
  return {
    mode,
    venue: {
      country: "ES",
      taxId: "50000000R",
      legalName: "Waitron Dev SL",
      taxpayerDomicile: "Calle Fiscal 8, 28013 Madrid",
      location: {
        name: "Sala principal",
        fiscalTerritory: "ES-common",
        invoiceLocales: ["es-ES"],
        operationDescription: "Retail counter sales",
        addressLine1: "Calle Mayor 1",
        addressLine2: null,
        postalCode: "28013",
        city: "Madrid",
        province: "Madrid",
        timeZone: "Europe/Madrid",
        dayCutover: "05:00",
      },
      seriesCode: "A",
      fullSeriesCode: "FF",
      rectificativeSeriesCode: "R",
      admin: {
        displayName: "Administradora",
        firstNames: "Ana Maria",
        lastNames: "Lopez Garcia",
        pin: "1357",
        password: "correct-horse-battery",
        email: "admin@waitron.dev",
      },
    },
    ...(mode === "live"
      ? {
          email: {
            server: "smtp.example.test",
            port: 587,
            encryption: "starttls",
            from: "venue@example.test",
          },
        }
      : {}),
  };
}

/** A Live body a production-stamped request accepts: it also needs the AEAT certificate. */
function liveProductionBody(): Record<string, unknown> {
  return { ...body("live"), aeatCert: CERT };
}

function harness(box: Box, provision?: (req: ProvisionRequest) => Promise<VenueResult>) {
  const received: ProvisionRequest[] = [];
  const lines: Array<{ level: LogLevel; event: string; fields?: Record<string, unknown> }> = [];
  const log: Logger = (level, event, fields) => {
    lines.push({ level, event, fields });
  };
  const deps: SetupDeps = {
    environment: box.environment,
    devMode: box.devMode,
    provision: vi.fn(async (req: ProvisionRequest) => {
      received.push(req);
      return provision === undefined ? venueResult() : provision(req);
    }),
    recoverProvision: vi.fn(async () => venueResult()),
    seedDemo: vi.fn(async () => {}),
    establishIdentity: vi.fn(async () => {}),
    seedMembership: vi.fn(async () => {}),
    db: { withWriteLock: async () => {} } as unknown as Database,
    ring: {} as unknown as KeyRing,
    persistTrading: vi.fn(async () => {}),
    requestRestart: vi.fn(),
    assertFiscalReady: vi.fn().mockResolvedValue(undefined),
  };
  const app = new Hono();
  mountSetup(app, deps, log);
  const post = (payload: unknown) =>
    app.request("/setup-api/provision", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
  const throwawayLines = () => lines.filter((line) => line.event === "setup.throwaway_allocation");
  return { post, received, throwawayLines };
}

describe("POST /setup-api/provision — which requests the route marks for a throwaway allocation", () => {
  it.each<[string, Mode]>([
    ["Demo", "demo"],
    ["Preparation", "prepare"],
  ])("marks %s on a non-production box, and logs the throwaway after success", async (_l, mode) => {
    const { post, received, throwawayLines } = harness(PREPRODUCTION_BOX);

    expect((await post(body(mode))).status).toBe(200);

    expect(received).toHaveLength(1);
    expect(received[0].environment).toBe("preproduction");
    expect(received[0].initialAllocation).toEqual({
      kind: "throwaway",
      hostEnvironment: "preproduction",
    });
    expect(received[0]).not.toHaveProperty("initialOperations");
    expect(throwawayLines()).toEqual([
      { level: "info", event: "setup.throwaway_allocation", fields: { mode } },
    ]);
  });

  it.each<[string, Mode]>([
    ["cell 1: Demo", "demo"],
    ["cell 2: Preparation", "prepare"],
  ])(
    "%s on a WAITRON_ENV=production box is marked with the box's environment, and the allocation's refusal reaches the client as 400",
    async (_l, mode) => {
      const { post, received, throwawayLines } = harness(PRODUCTION_BOX, async () => {
        throw new AppError("sif.throwaway_allocation_refused", { environment: "production" });
      });

      const res = await post(body(mode));

      expect(received[0].initialAllocation).toEqual({
        kind: "throwaway",
        hostEnvironment: "production",
      });
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({
        error: {
          code: "sif.throwaway_allocation_refused",
          params: { environment: "production" },
        },
      });
      expect(throwawayLines()).toEqual([]);
    },
  );

  it.each<[string, Box]>([
    ["cell 3: a WAITRON_ENV=production box", PRODUCTION_BOX],
    ["cell 4: a preproduction box that is not a dev box", PREPRODUCTION_BOX],
  ])("does not mark Live on %s; the request is stamped production", async (_l, box) => {
    const { post, received, throwawayLines } = harness(box);

    expect((await post(liveProductionBody())).status).toBe(200);

    expect(received).toHaveLength(1);
    expect(received[0].environment).toBe("production");
    expect(received[0]).not.toHaveProperty("initialAllocation");
    expect(throwawayLines()).toEqual([]);
  });

  it("cell 5: marks Live on a dev box, whose request is stamped preproduction", async () => {
    const { post, received, throwawayLines } = harness(DEV_BOX);

    expect((await post(body("live"))).status).toBe(200);

    expect(received[0].environment).toBe("preproduction");
    expect(received[0].initialAllocation).toEqual({
      kind: "throwaway",
      hostEnvironment: "preproduction",
    });
    expect(throwawayLines()).toEqual([
      { level: "info", event: "setup.throwaway_allocation", fields: { mode: "live" } },
    ]);
  });

  it.each<[string, Box, Mode]>([
    ["Demo on a preproduction box", PREPRODUCTION_BOX, "demo"],
    ["Preparation on a preproduction box", PREPRODUCTION_BOX, "prepare"],
    ["Demo on a dev box", DEV_BOX, "demo"],
    ["Preparation on a dev box", DEV_BOX, "prepare"],
    ["Live on a dev box", DEV_BOX, "live"],
  ])("cell 6: never marks a request that carries initialOperations (%s)", async (_l, box, mode) => {
    const { post, received, throwawayLines } = harness(box);

    expect((await post({ ...body(mode), initialOperations: INITIAL_OPERATIONS })).status).toBe(200);

    expect(received[0]).not.toHaveProperty("initialAllocation");
    expect(received[0].initialOperations).toEqual(INITIAL_OPERATIONS);
    expect(throwawayLines()).toEqual([]);
  });

  it("cell 6: never marks a production Live request that carries initialOperations", async () => {
    const { post, received } = harness(PREPRODUCTION_BOX);

    expect(
      (await post({ ...liveProductionBody(), initialOperations: INITIAL_OPERATIONS })).status,
    ).toBe(200);

    expect(received[0].environment).toBe("production");
    expect(received[0]).not.toHaveProperty("initialAllocation");
  });

  it("cell 14: ignores a forged initialAllocation field on a Live body from a non-dev box", async () => {
    const { post, received, throwawayLines } = harness(PREPRODUCTION_BOX);

    const forged = {
      ...liveProductionBody(),
      initialAllocation: { kind: "throwaway", hostEnvironment: "preproduction" },
    };
    expect((await post(forged)).status).toBe(200);

    expect(received[0].environment).toBe("production");
    expect(received[0]).not.toHaveProperty("initialAllocation");
    expect(throwawayLines()).toEqual([]);
  });

  it("cell 14: a forged initialAllocation field cannot replace the route's own marker", async () => {
    const { post, received } = harness(PREPRODUCTION_BOX);

    const forged = {
      ...body("demo"),
      initialAllocation: { kind: "throwaway", hostEnvironment: "production", extra: true },
    };
    expect((await post(forged)).status).toBe(200);

    expect(received[0].initialAllocation).toEqual({
      kind: "throwaway",
      hostEnvironment: "preproduction",
    });
  });
});

describe("POST /setup-api/provision with the real provisionVenue", () => {
  const venueDb = useVenueDb({ migrations: migrationOptionsFor(manifestSets(), null) });
  const moduleConfig = venueModuleConfig(parseModuleConfig({}, ALL_MODULES), "ES-common");
  const ring = loadKeyRing({
    WAITRON_CREDENTIALS_KEY: Buffer.alloc(32, 7).toString("base64"),
    WAITRON_CREDENTIALS_KEY_VERSION: "1",
  });
  let stateDir: string;
  beforeEach(async () => {
    stateDir = await mkdtemp(join(tmpdir(), "waitron-setup-throwaway-route-"));
  });
  afterEach(async () => {
    await rm(stateDir, { recursive: true, force: true });
  });

  function facts() {
    return {
      tenants: venueDb.db.all(sql`select tax_id from tenants`),
      deployment: venueDb.db.all(sql`select environment from deployment`),
      allocations: venueDb.db.all(sql`select taxpayer_nif, environment from fiscal_allocations`),
      sif: venueDb.db.all(sql`select numero_instalacion from registro_sif`),
      series: venueDb.db.all(sql`select code, purpose, next_number from invoice_series`),
    };
  }

  /** Cell 12's facts, for a venue stamped `environment`. */
  function expectThrowawayVenue(environment: string) {
    expect(venueDb.db.all(sql`select numero_instalacion from registro_sif`)).toEqual([
      { numero_instalacion: "S000001" },
    ]);
    expect(
      venueDb.db.all(sql`select taxpayer_nif, environment, allocation_key from fiscal_allocations`),
    ).toEqual([
      {
        taxpayer_nif: "50000000R",
        environment: "preproduction",
        allocation_key: expect.stringMatching(/^throwaway-/),
      },
    ]);
    expect(venueDb.db.all(sql`select code, purpose from invoice_series order by code`)).toEqual([
      { code: "A-S000001", purpose: "standard" },
      { code: "FF-S000001", purpose: "full" },
      { code: "R-S000001", purpose: "rectificative" },
    ]);
    expect(venueDb.db.all(sql`select environment from deployment`)).toEqual([{ environment }]);
  }

  function emptyVenue() {
    expect(facts()).toEqual({ tenants: [], deployment: [], allocations: [], sif: [], series: [] });
  }

  const provisionDeps = () => ({
    ownerDb: venueDb.db,
    moduleConfig,
    database: "waitron",
    stateDir,
  });

  /** `fiscalGate`: "box" refuses as a box with no accepted fiscal test does (the gate `boot.ts`
   * wires, with no evidence on disk); "passed" lets the request through as an accepted test would. */
  function realApp(
    box: Box,
    {
      fiscalGate = "box",
      provision = (req: ProvisionRequest) => provisionVenue(provisionDeps(), req),
    }: {
      fiscalGate?: "box" | "passed";
      provision?: (req: ProvisionRequest) => Promise<VenueResult>;
    } = {},
  ) {
    const app = new Hono();
    mountSetup(
      app,
      {
        environment: box.environment,
        devMode: box.devMode,
        db: venueDb.db,
        ring,
        operations: createSetupOperationStore(stateDir),
        provision,
        recoverProvision: (req) => recoverProvisionedVenue(venueDb.db, req),
        seedDemo: async () => {},
        establishIdentity: async () => {},
        seedMembership: async () => {},
        persistTrading: async () => {},
        requestRestart: () => {},
        assertFiscalReady:
          fiscalGate === "passed"
            ? async () => {}
            : async ({ request, contribution, secret }) =>
                createFiscalReadinessStore(
                  stateDir,
                  async () => ({ status: "uncertain" }),
                  ring.current.key,
                ).assertReady(
                  fiscalReadinessInput({
                    venue: request.venue,
                    contribution,
                    secret,
                    moduleVersions: {},
                    applicationVersion: "test",
                  }),
                ),
      },
      () => {},
    );
    return (payload: unknown) =>
      app.request("/setup-api/provision", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
  }

  it.each<[string, Mode]>([
    ["Demo", "demo"],
    ["Preparation", "prepare"],
  ])("cell 12: %s with no initialOperations makes a throwaway venue", async (_l, mode) => {
    const res = await realApp(PREPRODUCTION_BOX)(body(mode));

    expect(res.status, await res.clone().text()).toBe(200);
    expect(await res.json()).toEqual({ provisioned: true, restarting: true });
    expectThrowawayVenue("preproduction");
  });

  it("cell 5: Live on a dev box with no initialOperations makes a throwaway venue", async () => {
    const res = await realApp(DEV_BOX)(body("live"));

    expect(res.status, await res.clone().text()).toBe(200);
    expectThrowawayVenue("preproduction");
  });

  it.each<[string, Box]>([
    ["cell 3: a WAITRON_ENV=production box", PRODUCTION_BOX],
    ["cell 4: a preproduction box that is not a dev box", PREPRODUCTION_BOX],
  ])(
    "%s refuses Live with no initialOperations at the fiscal-test gate, writing nothing",
    async (_l, box) => {
      const res = await realApp(box)(liveProductionBody());

      expect(res.status).toBe(409);
      expect(await res.json()).toEqual({
        error: { code: "setup.fiscal_test_required", params: { module: "verifactu" } },
      });
      emptyVenue();
    },
  );

  it.each<[string, Box]>([
    ["cell 3: a WAITRON_ENV=production box", PRODUCTION_BOX],
    ["cell 4: a preproduction box that is not a dev box", PREPRODUCTION_BOX],
  ])(
    "%s, past the fiscal-test gate, has Live with no initialOperations refused by the allocation path, leaving only the production stamp",
    async (_l, box) => {
      const res = await realApp(box, { fiscalGate: "passed" })(liveProductionBody());

      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({
        error: {
          code: "sif.allocation_invalid",
          params: { reason: "reauthentication_required" },
        },
      });
      // provisionVenue stamps before applyVenue's transaction opens (its doc comment).
      expect(facts()).toEqual({
        tenants: [],
        deployment: [{ environment: "production" }],
        allocations: [],
        sif: [],
        series: [],
      });
    },
  );

  it("cell 13: a committed Demo whose first response was lost replays to 200 with the same venue", async () => {
    let first = true;
    const post = realApp(PREPRODUCTION_BOX, {
      provision: async (req) => {
        const result = await provisionVenue(provisionDeps(), req);
        if (first) {
          first = false;
          throw new Error("lost-response-after-commit");
        }
        return result;
      },
    });

    expect((await post(body("demo"))).status).toBe(500);
    expectThrowawayVenue("preproduction");
    const before = facts();
    const ledger = venueDb.db.all(sql`select * from fiscal_allocations`);

    const replayed = await post(body("demo"));

    expect(replayed.status, await replayed.clone().text()).toBe(200);
    expect(await replayed.json()).toEqual({ provisioned: true, restarting: true });
    expect(facts()).toEqual(before);
    expect(venueDb.db.all(sql`select * from fiscal_allocations`)).toEqual(ledger);
    expect((await createSetupOperationStore(stateDir).read())?.phase).toBe("complete");
  });
});
