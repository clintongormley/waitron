import { sql } from "drizzle-orm";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { applyHistoricalTestVenue } from "@waitron/provisioning/testing/allocated-venue";
import { planVenue } from "@waitron/provisioning";
import { ALL_MODULES } from "@waitron/composition";
import { Hono } from "hono";
import { describe, expect, it, vi } from "vitest";
import type { CountryPack } from "@waitron/country";
import type { Database } from "@waitron/db";
import type { KeyRing } from "@waitron/credentials";
import type { VenueResult } from "@waitron/provisioning";
import type { ProvisionRequest } from "./provision.js";
import { mountSetup, type SetupDeps } from "./setup-api.js";

// Spain is the only pack installed for venue setup, and it has provinces, postcode and tax-id rules
// and a certificate-sealing regime. These cases make two other shapes available to setup: the
// installed United Kingdom pack (no provinces, no validators, a regime that files nothing), and a
// pack whose filing regime this build does not include.
const UNFILED: CountryPack = {
  countryCode: "ZZ",
  defaultLocale: "en-GB",
  defaultTimeZone: "Etc/UTC",
  timeZones: ["Etc/UTC"],
  invoiceLocales: ["en-GB"],
  moduleIds: [],
  availableForVenueSetup: true,
  administrativeAreas: [],
  defaultFiscalJurisdictionId: "ZZ-vat",
  fiscalJurisdictions: [
    { id: "ZZ-vat", areaCodes: [], supported: true, modules: { filing: "zz-filing", tax: "none" } },
  ],
};

vi.mock("@waitron/country-packs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@waitron/country-packs")>();
  return {
    ...actual,
    getVenueSetupCountryPack: (code: string) => {
      const normalized = code.trim().toUpperCase();
      if (normalized === "GB")
        return { ...actual.getCountryPack("GB")!, availableForVenueSetup: true };
      if (normalized === "ZZ") return UNFILED;
      return actual.getVenueSetupCountryPack(code);
    },
    findFiscalModules: (territory: string) =>
      territory === "ZZ-vat"
        ? UNFILED.fiscalJurisdictions[0]!.modules
        : actual.findFiscalModules(territory),
  };
});

const VENUE_RESULT: VenueResult = {
  locationId: "22222222-2222-2222-2222-222222222222",
  nodeId: "44444444-4444-4444-4444-444444444444",
  seriesIds: ["66666666-6666-6666-6666-666666666666", "77777777-7777-7777-7777-777777777777"],
  seeded: [],
};

function deps(): { deps: SetupDeps; requests: ProvisionRequest[] } {
  const requests: ProvisionRequest[] = [];
  return {
    requests,
    deps: {
      environment: "preproduction",
      provision: vi.fn(async (req: ProvisionRequest) => {
        requests.push(req);
        return VENUE_RESULT;
      }),
      seedDemo: vi.fn(async () => {}),
      establishIdentity: vi.fn(async () => {}),
      seedMembership: vi.fn(async () => {}),
      db: { withWriteLock: async () => {} } as unknown as Database,
      ring: {} as KeyRing,
      persistTrading: vi.fn(async () => {}),
      requestRestart: vi.fn(),
      assertFiscalReady: vi.fn(async () => {}),
    },
  };
}

function venue(country: string, overrides: Record<string, unknown> = {}) {
  return {
    country,
    taxId: "GB 123 456 789",
    legalName: "Readiness Ltd",
    taxpayerDomicile: "1 Fiscal Quay, SW1A 1AA London",
    location: {
      name: "Front of house",
      fiscalTerritory: country.toUpperCase() === "ZZ" ? "ZZ-vat" : "GB-vat",
      invoiceLocales: ["en-GB"],
      operationDescription: "Restaurant",
      addressLine1: "1 High Street",
      addressLine2: null,
      postalCode: "sw1a 1aa",
      city: "London",
      province: "Greater London",
      timeZone: country.toUpperCase() === "ZZ" ? "Etc/UTC" : "Europe/London",
      dayCutover: "05:00",
      ...overrides,
    },
    seriesCode: "A",
    fullSeriesCode: "FF",
    rectificativeSeriesCode: "R",
    admin: {
      displayName: "Admin",
      pin: "1357",
      password: "correct-horse-battery",
      email: "admin@example.test",
    },
  };
}

const post = (app: Hono, body: unknown) =>
  app.request("/setup-api/provision", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

describe("POST /setup-api/provision for country packs other than Spain", () => {
  it("keeps the typed tax id, postcode and province when the country has no rules for them", async () => {
    const app = new Hono();
    const { deps: setupDeps, requests } = deps();
    mountSetup(app, setupDeps, () => {});

    const res = await post(app, { mode: "demo", venue: venue("gb") });

    expect(res.status).toBe(200);
    expect(requests).toHaveLength(1);
    expect(requests[0]!.venue).toMatchObject({
      country: "GB",
      taxId: "GB 123 456 789",
      location: {
        fiscalTerritory: "GB-vat",
        postalCode: "sw1a 1aa",
        province: "Greater London",
        timeZone: "Europe/London",
      },
    });
  });

  it("refuses a time zone other than the country's own when the country has no provinces", async () => {
    const app = new Hono();
    const { deps: setupDeps, requests } = deps();
    mountSetup(app, setupDeps, () => {});

    const res = await post(app, {
      mode: "demo",
      venue: venue("gb", { timeZone: "Europe/Madrid" }),
    });

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({
      error: { code: "setup.request_invalid", params: { field: "location.timeZone" } },
    });
    expect(requests).toEqual([]);
  });

  it("activates a live venue without a signing certificate when its regime seals none", async () => {
    const app = new Hono();
    const { deps: setupDeps, requests } = deps();
    mountSetup(app, setupDeps, () => {});

    const res = await post(app, {
      mode: "live",
      venue: venue("gb"),
      email: {
        server: "smtp.example.test",
        port: 587,
        encryption: "starttls",
        from: "venue@example.test",
      },
    });

    expect(res.status).toBe(200);
    expect(requests[0]!.environment).toBe("production");
  });

  it("refuses a certificate sent for a regime that seals none", async () => {
    const app = new Hono();
    const { deps: setupDeps, requests } = deps();
    mountSetup(app, setupDeps, () => {});

    const res = await post(app, {
      mode: "live",
      venue: venue("gb"),
      aeatCert: { pfxBase64: "AA==" },
    });

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({
      error: { code: "setup.request_invalid", params: { field: "aeatCert" } },
    });
    expect(requests).toEqual([]);
  });

  it("refuses a territory whose filing regime is not installed in this build", async () => {
    const app = new Hono();
    const { deps: setupDeps, requests } = deps();
    mountSetup(app, setupDeps, () => {});

    const res = await post(app, { mode: "demo", venue: venue("zz") });

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({
      error: { code: "setup.request_invalid", params: { field: "location.fiscalTerritory" } },
    });
    expect(requests).toEqual([]);
  });
});

describe("Demo location-name ownership", () => {
  function spanishVenue(name: string) {
    const request = venue("ES", {
      name,
      fiscalTerritory: "ES-common",
      postalCode: "08001",
      city: "Barcelona",
      province: "08",
      timeZone: "Europe/Madrid",
      invoiceLocales: ["ca-ES"],
    });
    return { ...request, taxId: "B00000000", legalName: "Waitron Demo S.L." };
  }
  it.each([
    ["automatic", "Stale default", "Can Delgado"],
    ["custom", "Casa Delgado", "Casa Delgado"],
    [undefined, "Casa Delgado", "Casa Delgado"],
    ["custom", "My restaurant", "My restaurant"],
  ])("normalizes only explicit automatic names (%s)", async (source, name, want) => {
    const app = new Hono();
    const { deps: setupDeps, requests } = deps();
    mountSetup(app, setupDeps, () => {});
    const res = await post(app, {
      mode: "demo",
      demoLocationNameSource: source,
      venue: spanishVenue(name!),
    });
    expect(res.status).toBe(200);
    expect(requests[0]!.venue.location).toMatchObject({ name: want, province: "Barcelona" });
    expect(requests[0]).not.toHaveProperty("demoLocationNameSource");
  });
  it.each([null, 0, {}, [], true, "", "AUTOMATIC", "unknown"])(
    "refuses malformed ownership %j",
    async (source) => {
      const app = new Hono();
      const { deps: setupDeps, requests } = deps();
      mountSetup(app, setupDeps, () => {});
      const res = await post(app, {
        mode: "demo",
        demoLocationNameSource: source,
        venue: spanishVenue("Custom"),
      });
      expect(res.status).toBe(400);
      expect(await res.json()).toMatchObject({
        error: { code: "setup.request_invalid", params: { field: "demoLocationNameSource" } },
      });
      expect(requests).toHaveLength(0);
    },
  );
  it.each(["prepare", "live"])("refuses ownership outside Demo (%s)", async (mode) => {
    const app = new Hono();
    const { deps: setupDeps, requests } = deps();
    mountSetup(app, setupDeps, () => {});
    const res = await post(app, {
      mode,
      demoLocationNameSource: "automatic",
      venue: spanishVenue("Custom"),
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({
      error: { code: "setup.request_invalid", params: { field: "demoLocationNameSource" } },
    });
    expect(requests).toHaveLength(0);
  });
});

describe("persisted Demo name ownership", () => {
  const suite = useVenueDb({ migrations: migrationOptionsFor(manifestSets(), null) });
  it.each([
    ["automatic", "Stale default", "Can Delgado"],
    ["custom", "Casa Delgado", "Casa Delgado"],
    [undefined, "Casa Delgado", "Casa Delgado"],
    ["custom", "My restaurant", "My restaurant"],
  ])(
    "persists the normalized geography and %s name through real provisioning",
    async (source, name, want) => {
      const app = new Hono();
      const { deps: setupDeps } = deps();
      setupDeps.provision = async (request) =>
        applyHistoricalTestVenue(planVenue(request.venue, ALL_MODULES), {
          db: suite.db,
          modules: ALL_MODULES,
        });
      mountSetup(app, setupDeps, () => {});
      const body = venue("ES", {
        name,
        fiscalTerritory: "ES-common",
        postalCode: "08001",
        city: "Barcelona",
        province: "08",
        timeZone: "Europe/Madrid",
        invoiceLocales: ["ca-ES"],
      });
      const response = await post(app, {
        mode: "demo",
        demoLocationNameSource: source,
        venue: { ...body, taxId: "B00000000", legalName: "Waitron Demo S.L." },
      });
      expect(response.status).toBe(200);
      expect(suite.db.all(sql`select name,province from locations`)).toEqual([
        { name: want, province: "Barcelona" },
      ]);
      expect(suite.db.all(sql`select legal_name,tax_id from tenants`)).toEqual([
        { legal_name: "Waitron Demo S.L.", tax_id: "B00000000" },
      ]);
    },
  );
});

it("refuses an unknown country before deriving an automatic demo name", async () => {
  const app = new Hono();
  const { deps: setupDeps, requests } = deps();
  mountSetup(app, setupDeps, () => {});
  const response = await post(app, {
    mode: "demo",
    demoLocationNameSource: "automatic",
    venue: venue("XX"),
  });
  expect(response.status).toBe(400);
  expect(await response.json()).toMatchObject({
    error: { code: "setup.request_invalid", params: { field: "country" } },
  });
  expect(requests).toHaveLength(0);
});
