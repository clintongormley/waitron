import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { stampDeployment } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { createAllocationPreparation } from "@waitron/fiscal-verifactu";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { applyVenue, planVenue, type VenueRequest } from "@waitron/provisioning";
import { ALL_MODULES } from "../../src/modules.js";
import { createDevelopmentKey, signDevelopmentAllocation } from "./sign.js";

const suite = useVenueDb({ migrations: migrationOptionsFor(manifestSets(), null) });

function request(): VenueRequest {
  return {
    country: "ES",
    taxId: "B12345674",
    legalName: "Real Restaurant S.L.",
    location: {
      name: "Casa Real",
      fiscalTerritory: "ES-common",
      invoiceLocales: ["es-ES"],
      operationDescription: "Venta en establecimiento",
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
      displayName: "Admin",
      pinHash: "pin-hash",
      passwordHash: "password-hash",
      email: "admin@example.test",
    },
  };
}

const environment = { WAITRON_ENV: "dev" };

async function offerSigned(stamp: "preproduction" | "production") {
  const actions = planVenue(request(), ALL_MODULES);
  const bases = actions
    .filter((action) => action.kind === "create-series")
    .map(({ code, purpose }) => ({ code, purpose }));
  const nodeId = randomUUID();
  const administratorId = randomUUID();
  const eventId = randomUUID();
  const sourceId = "developer-custodian";
  const signed = signDevelopmentAllocation(
    {
      key: createDevelopmentKey(environment),
      taxpayerNif: "B12345674",
      bases,
      nodeId,
      administratorId,
      eventId,
      sourceId,
      now: new Date(),
    },
    environment,
  );
  const preparation = createAllocationPreparation(async (scope) => ({
    ...scope,
    evidence: signed.evidence,
  }));
  await stampDeployment(suite.db, stamp);
  return applyVenue(actions, {
    db: suite.db,
    initialNodeId: nodeId,
    initialAdministratorId: administratorId,
    moduleInputs: new Map([["fiscal-verifactu", { eventId, sourceId, input: signed.input }]]),
    modules: ALL_MODULES.map((module) =>
      module.name === "fiscal-verifactu" ? { ...module, operations: preparation } : module,
    ),
  });
}

function signFor(env: NodeJS.ProcessEnv) {
  return signDevelopmentAllocation(
    {
      key: createDevelopmentKey({}),
      taxpayerNif: "B12345674",
      bases: [{ code: "A", purpose: "standard" }],
      nodeId: randomUUID(),
      administratorId: randomUUID(),
      eventId: randomUUID(),
      sourceId: "developer-custodian",
      now: new Date(),
    },
    env,
  );
}

describe("development custodian signer", () => {
  it("signs a preproduction allocation any taxpayer can activate", async () => {
    const venue = await offerSigned("preproduction");
    expect(suite.db.all(sql`select numero_instalacion, node_id from registro_sif`)).toEqual([
      { numero_instalacion: "S000001", node_id: venue.nodeId },
    ]);
    expect(suite.db.all(sql`select taxpayer_nif, environment from fiscal_allocations`)).toEqual([
      { taxpayer_nif: "B12345674", environment: "preproduction" },
    ]);
    expect(suite.db.all(sql`select code, purpose from invoice_series order by code`)).toEqual([
      { code: "A-S000001", purpose: "standard" },
      { code: "FF-S000001", purpose: "full" },
      { code: "R-S000001", purpose: "rectificative" },
    ]);
  });

  it.each([
    ["signDevelopmentAllocation", () => signFor({ WAITRON_ENV: "production" })],
    ["createDevelopmentKey", () => createDevelopmentKey({ WAITRON_ENV: "production" })],
  ])("refuses production before signing: %s", (_name, call) => {
    expect(call).toThrow(
      expect.objectContaining({
        code: "deployment.development_custodian_refused",
        params: { environment: "production" },
      }),
    );
  });

  it.each([{}, { WAITRON_ENV: "" }, { WAITRON_ENV: "dev" }, { WAITRON_ENV: "preproduction" }])(
    "accepts %j",
    (env) => {
      expect(signFor(env).input.allocation.environment).toBe("preproduction");
    },
  );

  it("a misspelt environment is a configuration error", () => {
    expect(() => signFor({ WAITRON_ENV: "prod" })).toThrow(
      expect.objectContaining({ code: "server.config_invalid" }),
    );
  });

  it("a production-stamped database refuses what it signs", async () => {
    await expect(offerSigned("production")).rejects.toMatchObject({
      code: "sif.allocation_invalid",
      params: { reason: "environment_mismatch" },
    });
    expect(suite.db.all(sql`select * from registro_sif`)).toEqual([]);
  });
});
