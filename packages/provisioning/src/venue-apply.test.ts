import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { ALL_MODULES } from "@waitron/composition";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { fakeModule } from "@waitron/module/src/testing/fake-module.js";
import { deviceProfiles } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { planVenue, type VenueAction, type VenueRequest } from "./venue-plan.js";
import { applyVenue } from "./venue-apply.js";

const suite = useVenueDb({
  migrations: migrationOptionsFor(manifestSets(), null),
});

function request(taxId = "B12345678"): VenueRequest {
  return {
    country: "ES",
    taxId,
    legalName: "Deli SL",
    location: {
      name: "Mostrador",
      fiscalTerritory: "ES-common",
      invoiceLocales: ["es-ES"],
      operationDescription: "venta en establecimiento",
      addressLine1: "Calle Mayor 1",
      addressLine2: null,
      postalCode: "28013",
      city: "Madrid",
      province: "Madrid",
      timeZone: "Europe/Madrid",
      dayCutover: "06:00:00",
    },
    tillName: "Caja 1",
    seriesCode: "A",
    rectificativeSeriesCode: "R",
    admin: {
      displayName: "Owner",
      pinHash: "scrypt$00$00",
      passwordHash: "scrypt$00$00",
      email: "owner@example.test",
    },
  };
}

describe("applyVenue: the one taxpayer row", () => {
  it("creates it with id 1 on a fresh database", async () => {
    await applyVenue(planVenue(request("B10000001"), ALL_MODULES), {
      db: suite.db,
      modules: ALL_MODULES,
    });

    const rows = await suite.db.execute<{ id: number; country: string; tax_id: string }>(
      sql`select id, country, tax_id from tenants`,
    );
    expect(rows.rows).toEqual([{ id: 1, country: "ES", tax_id: "B10000001" }]);
  });

  it("is an idempotent no-op when the same country and tax id are applied again", async () => {
    const plan = planVenue(request("B10000002"), ALL_MODULES);
    await applyVenue(plan, { db: suite.db, modules: ALL_MODULES });
    await applyVenue(plan, { db: suite.db, modules: ALL_MODULES });

    const rows = await suite.db.execute<{ id: number; country: string; tax_id: string }>(
      sql`select id, country, tax_id from tenants`,
    );
    expect(rows.rows).toEqual([{ id: 1, country: "ES", tax_id: "B10000002" }]);
  });

  it("refuses a re-run whose tax id differs, by name", async () => {
    await applyVenue(planVenue(request("B10000003"), ALL_MODULES), {
      db: suite.db,
      modules: ALL_MODULES,
    });

    await expect(
      applyVenue(planVenue(request("B10000004"), ALL_MODULES), {
        db: suite.db,
        modules: ALL_MODULES,
      }),
    ).rejects.toMatchObject({ code: "provisioning.tenant_identity_mismatch" });

    const rows = await suite.db.execute<{ tax_id: string }>(sql`select tax_id from tenants`);
    expect(rows.rows).toEqual([{ tax_id: "B10000003" }]);
  });
});

describe("applyVenue", () => {
  it("provisions a sellable venue: tenant, location, till, node, live SIF, two series", async () => {
    const result = await applyVenue(planVenue(request(), ALL_MODULES), {
      db: suite.db,
      modules: ALL_MODULES,
    });

    const counts = await suite.db.execute<{
      tenants: number;
      nodes: number;
      series: number;
      sif: number;
      default_stations: number;
      default_departments: number;
      counter_zones: number;
    }>(sql`
      select
        (select count(*) from tenants where id = 1) as tenants,
        (select count(*) from nodes where id = ${result.nodeId}) as nodes,
        (select count(*) from invoice_series where node_id = ${result.nodeId}) as series,
        (select count(*) from registro_sif where node_id = ${result.nodeId} and revocado_en is null) as sif,
        (select count(*) from kitchen_stations
           where location_id = ${result.locationId} and is_default and active) as default_stations,
        (select count(*) from departments
           where location_id = ${result.locationId} and is_default and active) as default_departments,
        (select count(*) from zone_service_policies
           where location_id = ${result.locationId} and is_counter_default) as counter_zones`);
    expect(counts.rows[0]).toEqual({
      tenants: 1,
      nodes: 1,
      series: 2,
      sif: 1,
      default_stations: 1,
      default_departments: 1,
      counter_zones: 1,
    });

    const series = await suite.db.execute<{ purpose: string }>(sql`
      select purpose from invoice_series where node_id = ${result.nodeId} order by purpose`);
    expect(series.rows.map((r) => r.purpose)).toEqual(["rectificative", "standard"]);

    const node = await suite.db.execute<{ filing_module: string; tax_module: string }>(sql`
      select filing_module, tax_module from nodes where id = ${result.nodeId}`);
    expect(node.rows[0]).toEqual({ filing_module: "verifactu", tax_module: "vat" });

    // registro_sif.nif came from the tenant's tax_id, never an argument.
    const sif = await suite.db.execute<{ nif: string; numero_instalacion: number }>(sql`
      select nif, numero_instalacion from registro_sif where node_id = ${result.nodeId} and revocado_en is null`);
    expect(sif.rows[0]?.nif).toBe("B12345678");
    expect(sif.rows[0]?.numero_instalacion).toBeGreaterThanOrEqual(1);
    expect(result.seeded).toEqual([
      {
        module: "catalogue",
        report: "initial menu ready",
      },
      {
        module: "venue-service",
        report: "default department and counter zone ready",
      },
      {
        module: "fiscal-verifactu",
        report: expect.stringMatching(/^SIF .* \(installation \d+\)$/),
      },
    ]);
  });

  it("seeds exactly one admin person carrying the display name, role, and pin hash", async () => {
    const seedRequest = request("B55555555");
    seedRequest.admin = {
      displayName: "Alicia",
      pinHash: "scrypt$abc$def",
      passwordHash: "scrypt$pwd$hash",
      email: "owner@example.test",
    };
    await applyVenue(planVenue(seedRequest, ALL_MODULES), {
      db: suite.db,
      modules: ALL_MODULES,
    });

    const people = await suite.db.execute<{
      display_name: string;
      role: string;
      first_names: string | null;
      last_names: string | null;
      locale: string | null;
      pin_hash: string;
      password_hash: string;
    }>(sql`
      select display_name, role, first_names, last_names, locale, pin_hash, password_hash
      from persons `);
    expect(people.rows).toHaveLength(1);
    expect(people.rows[0]).toEqual({
      display_name: "Alicia",
      role: "admin",
      first_names: null,
      last_names: null,
      locale: null,
      pin_hash: "scrypt$abc$def",
      password_hash: "scrypt$pwd$hash",
    });
  });

  it("writes the admin's real names and UI language onto the seeded person when the request carries them", async () => {
    const seedRequest = request("B31313131");
    seedRequest.admin = {
      displayName: "Clint",
      firstNames: "Clinton",
      lastNames: "Gormley",
      locale: "en-GB",
      pinHash: "scrypt$abc$def",
      passwordHash: "scrypt$pwd$hash",
      email: "clinton@example.test",
    };
    await applyVenue(planVenue(seedRequest, ALL_MODULES), {
      db: suite.db,
      modules: ALL_MODULES,
    });

    const people = await suite.db.execute<{
      display_name: string;
      first_names: string | null;
      last_names: string | null;
      locale: string | null;
    }>(sql`
      select display_name, first_names, last_names, locale
      from persons `);
    expect(people.rows).toEqual([
      { display_name: "Clint", first_names: "Clinton", last_names: "Gormley", locale: "en-GB" },
    ]);
  });

  it("seeds exactly the three starter device profiles (names per the venue locale, no canvas, form-factor caps)", async () => {
    await applyVenue(planVenue(request("B10101010"), ALL_MODULES), {
      db: suite.db,
      modules: ALL_MODULES,
    });

    // Through the table definition: a raw read of the JSON `capabilities` column returns the
    // encoded text.
    const profiles = await suite.db
      .select({
        name: deviceProfiles.name,
        canvas_id: deviceProfiles.canvasId,
        capabilities: deviceProfiles.capabilities,
        inactivity_timeout_seconds: deviceProfiles.inactivityTimeoutSeconds,
      })
      .from(deviceProfiles)
      .orderBy(deviceProfiles.name);
    expect(profiles).toEqual([
      {
        name: "Cocina",
        canvas_id: null,
        capabilities: ["act-as-kds"],
        inactivity_timeout_seconds: null,
      },
      {
        name: "Mostrador",
        canvas_id: null,
        capabilities: ["integrated-card-payment", "open-cash-drawer", "print-receipt"],
        inactivity_timeout_seconds: 300,
      },
      { name: "Móvil", canvas_id: null, capabilities: [], inactivity_timeout_seconds: 300 },
    ]);
  });

  it("seeds the starter profiles only once across re-runs (idempotent find-or-create by name)", async () => {
    await applyVenue(planVenue(request("B20202020"), ALL_MODULES), {
      db: suite.db,
      modules: ALL_MODULES,
    });
    await applyVenue(planVenue(request("B20202020"), ALL_MODULES), {
      db: suite.db,
      modules: ALL_MODULES,
    });
    const count = await suite.db.execute<{ n: number }>(sql`
      select count(*) as n from device_profiles `);
    expect(count.rows[0]?.n).toBe(3);
  });

  it("writes the admin's required dashboard email", async () => {
    const withEmail = request("B66666666");
    withEmail.admin = {
      displayName: "Owner",
      pinHash: "scrypt$abc$def",
      passwordHash: "scrypt$pwd$hash",
      email: "owner@x.com",
    };
    await applyVenue(planVenue(withEmail, ALL_MODULES), {
      db: suite.db,
      modules: ALL_MODULES,
    });

    const seeded = await suite.db.execute<{ email: string | null }>(sql`
      select email from persons where role = 'admin'`);
    expect(seeded.rows[0]?.email).toBe("owner@x.com");
  });

  it("reuses the taxpayer row on a re-run rather than duplicating it (spec D8)", async () => {
    const first = await applyVenue(planVenue(request("B99999999"), ALL_MODULES), {
      db: suite.db,
      modules: ALL_MODULES,
    });
    const second = await applyVenue(planVenue(request("B99999999"), ALL_MODULES), {
      db: suite.db,
      modules: ALL_MODULES,
    });

    const tenants = await suite.db.execute<{ n: number }>(sql`
      select count(*) as n from tenants where country = 'ES' and tax_id = 'B99999999'`);
    expect(tenants.rows[0]?.n).toBe(1);
    expect(second.locationId).toBe(first.locationId);
    expect(second.tillId).toBe(first.tillId);
    expect(second.nodeId).toBe(first.nodeId);
    const venueRows = await suite.db.execute<{
      locations: number;
      tills: number;
      nodes: number;
    }>(sql`
      select
        (select count(*) from locations ) as locations,
        (select count(*) from tills ) as tills,
        (select count(*) from nodes ) as nodes`);
    expect(venueRows.rows[0]).toEqual({ locations: 1, tills: 1, nodes: 1 });
  });

  it("refuses a different operational venue for the same tenant", async () => {
    const firstRequest = request("B12121212");
    await applyVenue(planVenue(firstRequest, ALL_MODULES), {
      db: suite.db,
      modules: ALL_MODULES,
    });
    const secondRequest = request("B12121212");
    secondRequest.location.name = "Another venue";

    await expect(
      applyVenue(planVenue(secondRequest, ALL_MODULES), {
        db: suite.db,
        modules: ALL_MODULES,
      }),
    ).rejects.toMatchObject({ code: "provisioning.second_venue" });

    const locations = await suite.db.execute<{ n: number }>(sql`
      select count(*) as n from locations
      `);
    expect(locations.rows[0]?.n).toBe(1);
  });

  describe("refuses a same-tenant re-run whose venue differs from the stored one", () => {
    async function provisionThenReapply(plan: VenueAction[]): Promise<void> {
      await applyVenue(planVenue(request("B13131313"), ALL_MODULES), {
        db: suite.db,
        modules: ALL_MODULES,
      });
      await expect(applyVenue(plan, { db: suite.db, modules: ALL_MODULES })).rejects.toMatchObject({
        code: "provisioning.second_venue",
      });
    }

    function withNode(change: Partial<Extract<VenueAction, { kind: "create-node" }>>) {
      return planVenue(request("B13131313"), ALL_MODULES).map((a) =>
        a.kind === "create-node" ? { ...a, ...change } : a,
      );
    }

    it("when the database already holds two venues, even if one matches the plan exactly", async () => {
      await applyVenue(planVenue(request("B13131313"), ALL_MODULES), {
        db: suite.db,
        modules: ALL_MODULES,
      });
      await suite.db.execute(sql`
        insert into locations (id, name, invoice_locales, operation_description)
        values ('00000000-0000-4000-8000-0000000000ff', 'Terraza', '["es-ES"]', 'venta')`);

      await expect(
        applyVenue(planVenue(request("B13131313"), ALL_MODULES), {
          db: suite.db,
          modules: ALL_MODULES,
        }),
      ).rejects.toMatchObject({ code: "provisioning.second_venue" });
    });

    it("when the till is named differently, and adds no till", async () => {
      const renamedTill = { ...request("B13131313"), tillName: "Caja 2" };
      await provisionThenReapply(planVenue(renamedTill, ALL_MODULES));

      const tills = await suite.db.execute<{ name: string }>(sql`select name from tills`);
      expect(tills.rows).toEqual([{ name: "Caja 1" }]);
    });

    it.each([
      ["name", { name: "Otro nodo" }],
      ["filing module", { filingModule: "none" }],
      ["tax module", { taxModule: "igic" }],
    ] as const)("when the node's %s differs, and adds no node", async (_field, change) => {
      await provisionThenReapply(withNode(change));

      const nodes = await suite.db.execute<{ n: number }>(sql`select count(*) as n from nodes`);
      expect(nodes.rows[0]?.n).toBe(1);
    });

    it("when the plan names a series the node does not have, and adds no series", async () => {
      const otherSeries = { ...request("B13131313"), seriesCode: "B" };
      await provisionThenReapply(planVenue(otherSeries, ALL_MODULES));

      const series = await suite.db.execute<{ code: string }>(
        sql`select code from invoice_series order by code`,
      );
      expect(series.rows).toEqual([{ code: "A" }, { code: "R" }]);
    });
  });

  it("collapses country/taxId case + surrounding-whitespace variants to ONE tenant on re-run (no duplicate, no PK error, §5)", async () => {
    // The count cannot exceed 1 (`tenants.id` is pinned to 1): what this catches is ensure-tenant's
    // identity comparison refusing the re-run.
    await applyVenue(planVenue(request("B88888888"), ALL_MODULES), {
      db: suite.db,
      modules: ALL_MODULES,
    });
    await applyVenue(planVenue({ ...request("b88888888"), country: "es" }, ALL_MODULES), {
      db: suite.db,
      modules: ALL_MODULES,
    });

    const tenants = await suite.db.execute<{ n: number }>(sql`
      select count(*) as n from tenants
      where upper(country) = 'ES' and upper(tax_id) = 'B88888888'`);
    expect(tenants.rows[0]?.n).toBe(1);
  });

  it("seeds the admin only once across same-venue re-runs", async () => {
    await applyVenue(planVenue(request("B77777777"), ALL_MODULES), {
      db: suite.db,
      modules: ALL_MODULES,
    });
    await applyVenue(planVenue(request("B77777777"), ALL_MODULES), {
      db: suite.db,
      modules: ALL_MODULES,
    });

    const admins = await suite.db.execute<{ n: number }>(sql`
      select count(*) as n from persons
      where role = 'admin'`);
    expect(admins.rows[0]?.n).toBe(1);
  });

  it("does not mint another node or installation on a same-venue re-run", async () => {
    const a = await applyVenue(planVenue(request("B11111111"), ALL_MODULES), {
      db: suite.db,
      modules: ALL_MODULES,
    });
    const b = await applyVenue(planVenue(request("B11111111"), ALL_MODULES), {
      db: suite.db,
      modules: ALL_MODULES,
    });
    expect(a.nodeId).toBe(b.nodeId);
    const installs = await suite.db.execute<{ numero_instalacion: number }>(sql`
      select numero_instalacion from registro_sif
      where node_id in (${a.nodeId}, ${b.nodeId}) and revocado_en is null`);
    expect(installs.rows).toHaveLength(1);
  });

  it("refuses a plan with no ensure-tenant — the scope it adopts must be present", async () => {
    const withoutTenant = planVenue(request(), ALL_MODULES).filter(
      (a) => a.kind !== "ensure-tenant",
    );
    await expect(applyVenue(withoutTenant, { db: suite.db, modules: ALL_MODULES })).rejects.toThrow(
      "applyVenue: plan is missing ensure-tenant",
    );
  });

  it("refuses a plan with no create-node — a venue that files nothing is not complete", async () => {
    // Dropping create-node with everything that depends on it clears every ordering guard.
    const withoutNode = planVenue(request("B48484848"), ALL_MODULES).filter(
      (a) => a.kind !== "create-node" && a.kind !== "seed-module" && a.kind !== "create-series",
    );
    await expect(applyVenue(withoutNode, { db: suite.db, modules: ALL_MODULES })).rejects.toThrow(
      "applyVenue: plan is missing create-node",
    );
  });

  it("never returns a phantom series id when ON CONFLICT drops a colliding series", async () => {
    // Hand-built, because planVenue rejects equal codes.
    const taxId = "B22222222";
    const collidingPlan: VenueAction[] = [
      { kind: "ensure-tenant", country: "ES", taxId, legalName: "Deli SL" },
      {
        kind: "create-location",
        name: "Mostrador",
        fiscalTerritory: "ES-common",
        invoiceLocales: ["es-ES"],
        operationDescription: "venta en establecimiento",
        addressLine1: "Calle Mayor 1",
        addressLine2: null,
        postalCode: "28013",
        city: "Madrid",
        province: "Madrid",
        timeZone: "Europe/Madrid",
        dayCutover: "06:00:00",
      },
      { kind: "create-till", name: "Caja 1" },
      { kind: "create-node", name: "Mostrador", filingModule: "verifactu", taxModule: "vat" },
      { kind: "seed-module", module: "fiscal-verifactu", summary: "s" },
      { kind: "create-series", code: "A", purpose: "standard" },
      { kind: "create-series", code: "A", purpose: "rectificative" },
    ];

    const result = await applyVenue(collidingPlan, { db: suite.db, modules: ALL_MODULES });
    expect(result.seriesIds).toHaveLength(1);

    const series = await suite.db.execute<{ n: number }>(sql`
      select count(*) as n from invoice_series where node_id = ${result.nodeId}`);
    expect(series.rows[0]?.n).toBe(1);
  });

  it("refuses a plan that omits create-till rather than returning an empty till id", async () => {
    // No later action depends on `tillId`, so an omitted create-till slips past every ordering guard.
    const taxId = "B44444444";
    const planWithoutTill: VenueAction[] = [
      { kind: "ensure-tenant", country: "ES", taxId, legalName: "Deli SL" },
      {
        kind: "create-location",
        name: "Mostrador",
        fiscalTerritory: "ES-common",
        invoiceLocales: ["es-ES"],
        operationDescription: "venta en establecimiento",
        addressLine1: "Calle Mayor 1",
        addressLine2: null,
        postalCode: "28013",
        city: "Madrid",
        province: "Madrid",
        timeZone: "Europe/Madrid",
        dayCutover: "06:00:00",
      },
      { kind: "create-node", name: "Mostrador", filingModule: "verifactu", taxModule: "vat" },
      { kind: "seed-module", module: "fiscal-verifactu", summary: "s" },
      { kind: "create-series", code: "A", purpose: "standard" },
    ];

    await expect(
      applyVenue(planWithoutTill, { db: suite.db, modules: ALL_MODULES }),
    ).rejects.toThrow("applyVenue: plan is missing create-till");
  });

  describe("guards a malformed plan whose actions arrive out of order", () => {
    // Unreachable from planVenue, so each plan is hand-built.
    const taxId = "B33333333";
    const ensure: VenueAction = {
      kind: "ensure-tenant",
      country: "ES",
      taxId,
      legalName: "Deli SL",
    };
    const createLocation: VenueAction = {
      kind: "create-location",
      name: "Mostrador",
      fiscalTerritory: "ES-common",
      invoiceLocales: ["es-ES"],
      operationDescription: "venta en establecimiento",
      addressLine1: "Calle Mayor 1",
      addressLine2: null,
      postalCode: "28013",
      city: "Madrid",
      province: "Madrid",
      timeZone: "Europe/Madrid",
      dayCutover: "06:00:00",
    };

    it.each([
      {
        name: "seed-device-profiles before seed-admin",
        plan: [
          ensure,
          {
            kind: "seed-device-profiles",
            profiles: [
              {
                name: "Counter",
                formFactor: "till",
                capabilities: [],
                inactivityTimeoutSeconds: null,
              },
            ],
          } as VenueAction,
        ],
        message: "applyVenue: seed-device-profiles before seed-admin",
      },
      {
        name: "create-till before create-location",
        plan: [ensure, { kind: "create-till", name: "Caja 1" } as VenueAction],
        message: "applyVenue: create-till before create-location",
      },
      {
        name: "create-node before create-location",
        plan: [
          ensure,
          {
            kind: "create-node",
            name: "Mostrador",
            filingModule: "verifactu",
            taxModule: "vat",
          } as VenueAction,
        ],
        message: "applyVenue: create-node before create-location",
      },
      {
        name: "seed-module before create-node",
        plan: [
          ensure,
          createLocation,
          { kind: "seed-module", module: "fiscal-verifactu", summary: "s" } as VenueAction,
        ],
        message: "applyVenue: seed-module before create-node",
      },
      {
        name: "create-series before create-node",
        plan: [
          ensure,
          createLocation,
          { kind: "create-series", code: "A", purpose: "standard" } as VenueAction,
        ],
        message: "applyVenue: create-series before create-node",
      },
    ])("throws a clear error for $name, not a raw SQL error", async ({ plan, message }) => {
      await expect(applyVenue(plan, { db: suite.db, modules: ALL_MODULES })).rejects.toThrow(
        message,
      );
    });
  });

  describe("seed-module runs the named module's seed inside the venue transaction", () => {
    const seeded: string[] = [];
    const recorder = fakeModule("probe", {
      provisioning: {
        seed: {
          summary: "record the node",
          run: async (_tx, node) => {
            seeded.push(node.nodeId);
            return `recorded ${node.nodeId}`;
          },
        },
      },
    });
    const exploding = fakeModule("boom", {
      provisioning: {
        seed: {
          summary: "explode",
          run: async () => {
            throw new Error("seed failed");
          },
        },
      },
    });

    it("runs the seed with the node it just created and reports its line", async () => {
      const modules = [...ALL_MODULES, recorder];
      const result = await applyVenue(planVenue(request("B47474747"), modules), {
        db: suite.db,
        modules,
      });
      expect(seeded).toContain(result.nodeId);
      expect(result.seeded.map((s) => s.module)).toEqual([
        "catalogue",
        "venue-service",
        "fiscal-verifactu",
        "probe",
      ]);
      expect(result.seeded[3]).toEqual({ module: "probe", report: `recorded ${result.nodeId}` });
    });

    it("a throwing seed rolls the whole venue back — no tenant row survives", async () => {
      // The reason the seed runs INSIDE the venue transaction: a module that cannot establish its
      // state must leave no half-built venue behind, least of all a fiscal chain.
      const modules = [...ALL_MODULES, exploding];
      const taxId = "B51515151";
      await expect(
        applyVenue(planVenue(request(taxId), modules), { db: suite.db, modules }),
      ).rejects.toThrow("seed failed");
      const tenant = await suite.db.execute(
        sql`select 1 from tenants where country = 'ES' and tax_id = ${taxId}`,
      );
      expect(tenant.rows).toEqual([]);
    });

    it("refuses a plan naming a module the deps do not hold, or one without a seed", async () => {
      const plan = planVenue(request("B66666666"), [...ALL_MODULES, recorder]);
      const refusal =
        "applyVenue: seed-module names probe, which is not in deps.modules or declares no seed";
      await expect(applyVenue(plan, { db: suite.db, modules: ALL_MODULES })).rejects.toThrow(
        refusal,
      );
      // Held, but with no seed: only `deps.modules` decides what runs, never the plan.
      const seedless = fakeModule(recorder.name);
      await expect(
        applyVenue(plan, { db: suite.db, modules: [...ALL_MODULES, seedless] }),
      ).rejects.toThrow(refusal);
    });
  });
});
