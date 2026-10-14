import { Hono } from "hono";
import { describe, expect, it, vi } from "vitest";
import { AppError } from "@waitron/shared";
import type { VenueResult } from "@waitron/provisioning";
import type { Database } from "@waitron/db";
import type { KeyRing } from "@waitron/credentials";
import type { DeploymentEnvironment } from "./config.js";
import type { ProvisionRequest } from "./provision.js";
import type { Logger, LogLevel } from "./logger.js";
import { mountSetup, type SetupDeps } from "./setup-api.js";

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
