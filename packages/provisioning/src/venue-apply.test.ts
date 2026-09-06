import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { ALL_MODULES } from "@waitron/composition";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { fakeModule } from "@waitron/module/src/testing/fake-module.js";
import type { CapabilityFlag } from "@waitron/layouts";
import { usePgliteDb } from "@waitron/db/testing/lifecycle.js";
import { planVenue, type VenueAction, type VenueRequest } from "./venue-plan.js";
import { obligadoTenantId } from "./tenant-id.js";
import { applyVenue } from "./venue-apply.js";

// PGlite's default connection is a SUPERUSER holding every grant, so a privilege or trigger
// assertion here would be a false pass (CLAUDE.md §4). That is fine: this suite exercises the wiring
// and idempotency logic, and the run as the non-superuser owner against a real, migrated database is
// `venue-apply.pg.test.ts`.
//
// The full manifest is migrated (identity before fiscal; sync before fiscal, which fiscal's SP-3a
// 0014 capture migration needs): applyVenue
// now seeds an admin `persons` row, and persons carries a foreign key onto `tenants`.
const suite = usePgliteDb({
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
    admin: { displayName: "Owner", pinHash: "scrypt$00$00", passwordHash: "scrypt$00$00" },
  };
}

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
    }>(sql`
      select
        (select count(*) from tenants where id = ${result.tenantId})::int as tenants,
        (select count(*) from nodes where id = ${result.nodeId})::int as nodes,
        (select count(*) from invoice_series where node_id = ${result.nodeId})::int as series,
        (select count(*) from registro_sif where node_id = ${result.nodeId} and revocado_en is null)::int as sif,
        (select count(*) from kitchen_stations
           where location_id = ${result.locationId} and is_default and active)::int as default_stations`);
    // KDS-1: applyVenue seeds exactly one active default kitchen station for the location, so a fresh
    // venue can fire the moment it exists (fireLines' fallback). Proven by deletion — dropping the
    // create-location station insert makes default_stations 0.
    expect(counts.rows[0]).toEqual({
      tenants: 1,
      nodes: 1,
      series: 2,
      sif: 1,
      default_stations: 1,
    });

    const series = await suite.db.execute<{ purpose: string }>(sql`
      select purpose from invoice_series where node_id = ${result.nodeId} order by purpose`);
    expect(series.rows.map((r) => r.purpose)).toEqual(["rectificative", "standard"]);

    // The node carries the resolved modules.
    const node = await suite.db.execute<{ filing_module: string; tax_module: string }>(sql`
      select filing_module, tax_module from nodes where id = ${result.nodeId}`);
    expect(node.rows[0]).toEqual({ filing_module: "verifactu", tax_module: "iva" });

    // registro_sif.nif came from the tenant's tax_id, never an argument. Read by NODE: the SIF row is
    // the fiscal module's seed's doing now, and `seeded` carries only its one-line report.
    const sif = await suite.db.execute<{ nif: string; numero_instalacion: number }>(sql`
      select nif, numero_instalacion from registro_sif where node_id = ${result.nodeId} and revocado_en is null`);
    expect(sif.rows[0]?.nif).toBe("B12345678");
    expect(sif.rows[0]?.numero_instalacion).toBeGreaterThanOrEqual(1);
    expect(result.seeded).toEqual([
      { module: "fiscal", report: expect.stringMatching(/^SIF .* \(installation \d+\)$/) },
    ]);
  });

  it("seeds exactly one admin person carrying the display name, role, and pin hash", async () => {
    // A freshly provisioned venue must have someone who can log in and authorize privileged actions.
    // A distinct obligado so the person count is this run's alone (the suite shares one database).
    const seedRequest = request("B55555555");
    seedRequest.admin = {
      displayName: "Alicia",
      pinHash: "scrypt$abc$def",
      passwordHash: "scrypt$pwd$hash",
    };
    const result = await applyVenue(planVenue(seedRequest, ALL_MODULES), {
      db: suite.db,
      modules: ALL_MODULES,
    });

    const people = await suite.db.execute<{
      display_name: string;
      role: string;
      pin_hash: string;
      password_hash: string;
    }>(sql`
      select display_name, role, pin_hash, password_hash
      from persons where tenant_id = ${result.tenantId}`);
    expect(people.rows).toHaveLength(1);
    expect(people.rows[0]).toEqual({
      display_name: "Alicia",
      role: "admin",
      pin_hash: "scrypt$abc$def",
      password_hash: "scrypt$pwd$hash",
    });
  });

  it("seeds exactly the three starter device profiles (names per the venue locale, no canvas, form-factor caps)", async () => {
    // task-3 follow-on b: every new tenant is seeded Counter/Kitchen/Handheld at provisioning. es-ES
    // venue → the Spanish names; each binds canvasId NULL (→ form-factor default canvas at runtime) and
    // carries the form-factor default capabilities. A distinct obligado so the profile set is this
    // run's alone (the suite shares one database). Proven by deletion: drop the seed-device-profiles
    // handler in applyVenue and this reads zero rows.
    const result = await applyVenue(planVenue(request("B10101010"), ALL_MODULES), {
      db: suite.db,
      modules: ALL_MODULES,
    });

    const profiles = await suite.db.execute<{
      name: string;
      canvas_id: string | null;
      capabilities: CapabilityFlag[];
    }>(sql`
      select name, canvas_id, capabilities from device_profiles
      where tenant_id = ${result.tenantId} order by name`);
    expect(profiles.rows).toEqual([
      { name: "Cocina", canvas_id: null, capabilities: ["act-as-kds"] },
      {
        name: "Mostrador",
        canvas_id: null,
        capabilities: ["integrated-card-payment", "open-cash-drawer"],
      },
      { name: "Móvil", canvas_id: null, capabilities: [] },
    ]);
  });

  it("seeds the starter profiles only once across re-runs (idempotent find-or-create by name)", async () => {
    // The profiles belong to the TENANT, not a shop, so a D8 second-shop re-run must not duplicate
    // them. applyVenue find-or-creates by name. Proven by deletion: drop the existing-name filter and
    // the second run throws device_profile.name_taken (the per-tenant name unique).
    const first = await applyVenue(planVenue(request("B20202020"), ALL_MODULES), {
      db: suite.db,
      modules: ALL_MODULES,
    });
    await applyVenue(planVenue(request("B20202020"), ALL_MODULES), {
      db: suite.db,
      modules: ALL_MODULES,
    });
    const count = await suite.db.execute<{ n: number }>(sql`
      select count(*)::int as n from device_profiles where tenant_id = ${first.tenantId}`);
    expect(count.rows[0]?.n).toBe(3); // three, not six
  });

  it("writes the admin's dashboard email when the request carries one, and NULL when it omits it", async () => {
    // Onboarding captures the admin's dashboard-login email; provisioning threads it into the seeded
    // `persons` row so the email-based dashboard login can resolve the address. It is OPTIONAL — the
    // CLI/dev-setup/e2e paths seed an admin with no email — so an absent email must write NULL, not a
    // throw or an empty string. Two distinct obligados so each admin is this run's alone.
    const withEmail = request("B66666666");
    withEmail.admin = {
      displayName: "Owner",
      pinHash: "scrypt$abc$def",
      passwordHash: "scrypt$pwd$hash",
      email: "owner@x.com",
    };
    const withEmailResult = await applyVenue(planVenue(withEmail, ALL_MODULES), {
      db: suite.db,
      modules: ALL_MODULES,
    });

    const seeded = await suite.db.execute<{ email: string | null }>(sql`
      select email from persons where tenant_id = ${withEmailResult.tenantId} and role = 'admin'`);
    expect(seeded.rows[0]?.email).toBe("owner@x.com");

    // Omitted email → NULL. request() builds an admin with no `email` key.
    const withoutEmailResult = await applyVenue(planVenue(request("B67676767"), ALL_MODULES), {
      db: suite.db,
      modules: ALL_MODULES,
    });
    const emailless = await suite.db.execute<{ email: string | null }>(sql`
      select email from persons where tenant_id = ${withoutEmailResult.tenantId} and role = 'admin'`);
    expect(emailless.rows[0]?.email).toBeNull();
  });

  it("reuses the obligado on a re-run rather than duplicating it (idempotent tenant, spec D8)", async () => {
    const first = await applyVenue(planVenue(request("B99999999"), ALL_MODULES), {
      db: suite.db,
      modules: ALL_MODULES,
    });
    const second = await applyVenue(planVenue(request("B99999999"), ALL_MODULES), {
      db: suite.db,
      modules: ALL_MODULES,
    });
    expect(second.tenantId).toBe(first.tenantId); // same deterministic id, reused

    const tenants = await suite.db.execute<{ n: number }>(sql`
      select count(*)::int as n from tenants where country = 'ES' and tax_id = 'B99999999'`);
    expect(tenants.rows[0]?.n).toBe(1); // exactly one obligado, not two
  });

  it("collapses country/taxId case + surrounding-whitespace variants to ONE obligado on re-run (no duplicate, no PK error, §5)", async () => {
    // The fiscal footgun: es/ES (or a taxId differing only in letter case or leading/trailing
    // whitespace) for the SAME business must never mint two permanent, unmergeable obligados (§5).
    // Internal whitespace is NOT normalized (a distinct identity). planVenue canonicalizes, so both runs
    // carry the SAME derived id AND the SAME (country, tax_id) unique-index row → the second run's
    // `on conflict (country, tax_id) do nothing` fires. Proven by DELETION: strip planVenue's
    // normalization and the second run inserts a distinct row (different id AND different unique-index
    // key) → the equality reads false and the count reads 2.
    const first = await applyVenue(planVenue(request("B88888888"), ALL_MODULES), {
      db: suite.db,
      modules: ALL_MODULES,
    });
    const second = await applyVenue(
      planVenue({ ...request("b88888888"), country: "es" }, ALL_MODULES),
      {
        db: suite.db,
        modules: ALL_MODULES,
      },
    );
    expect(second.tenantId).toBe(first.tenantId); // same canonical obligado, reused
    expect(first.tenantId).toBe(obligadoTenantId("ES", "B88888888"));

    const tenants = await suite.db.execute<{ n: number }>(sql`
      select count(*)::int as n from tenants
      where upper(country) = 'ES' and upper(tax_id) = 'B88888888'`);
    expect(tenants.rows[0]?.n).toBe(1); // exactly one obligado across both casings, not two
  });

  it("seeds the admin only once across re-runs — the D8 second-shop path adds no duplicate", async () => {
    // create-location/create-till/create-node deliberately ADD a shop on a re-run (a tenant has many
    // shops), but the admin belongs to the TENANT, not a shop. A plain `insert into persons` would
    // add a second role='admin' person every run; the conditional seed (insert-where-not-exists)
    // makes the re-run a no-op, mirroring ensure-tenant. Proven by DELETION: revert seed-admin to a
    // plain insert and this assertion reads 2.
    const first = await applyVenue(planVenue(request("B77777777"), ALL_MODULES), {
      db: suite.db,
      modules: ALL_MODULES,
    });
    await applyVenue(planVenue(request("B77777777"), ALL_MODULES), {
      db: suite.db,
      modules: ALL_MODULES,
    });
    expect(first.tenantId).toBe(obligadoTenantId("ES", "B77777777"));

    const admins = await suite.db.execute<{ n: number }>(sql`
      select count(*)::int as n from persons
      where tenant_id = ${first.tenantId} and role = 'admin'`);
    expect(admins.rows[0]?.n).toBe(1); // exactly one admin, not one per run
  });

  it("mints a distinct installation number per node under one obligado", async () => {
    const a = await applyVenue(planVenue(request("B11111111"), ALL_MODULES), {
      db: suite.db,
      modules: ALL_MODULES,
    });
    const b = await applyVenue(planVenue(request("B11111111"), ALL_MODULES), {
      db: suite.db,
      modules: ALL_MODULES,
    });
    expect(a.tenantId).toBe(b.tenantId);
    const installs = await suite.db.execute<{ numero_instalacion: number }>(sql`
      select numero_instalacion from registro_sif
      where node_id in (${a.nodeId}, ${b.nodeId}) and revocado_en is null`);
    expect(installs.rows).toHaveLength(2);
    // fresh node ⇒ fresh install #, new chain
    expect(installs.rows[0]?.numero_instalacion).not.toBe(installs.rows[1]?.numero_instalacion);
  });

  it("refuses a plan with no ensure-tenant — the scope it adopts must be present", async () => {
    // The tenant scope every WITH CHECK is satisfied against comes from the ensure-tenant action;
    // a plan lacking it has no scope to adopt, so applyVenue throws before opening a transaction.
    const withoutTenant = planVenue(request(), ALL_MODULES).filter(
      (a) => a.kind !== "ensure-tenant",
    );
    await expect(applyVenue(withoutTenant, { db: suite.db, modules: ALL_MODULES })).rejects.toThrow(
      "applyVenue: plan is missing ensure-tenant",
    );
  });

  it("refuses a plan with no create-node — a venue that files nothing is not complete", async () => {
    // create-node's own id is only checked by the actions that DEPEND on it (seed-module,
    // create-series), so dropping all three together clears every ordering guard and used to return
    // a "complete" VenueResult with `nodeId === ""`. The post-loop completeness guard names the
    // missing step instead.
    const withoutNode = planVenue(request("B48484848"), ALL_MODULES).filter(
      (a) => a.kind !== "create-node" && a.kind !== "seed-module" && a.kind !== "create-series",
    );
    await expect(applyVenue(withoutNode, { db: suite.db, modules: ALL_MODULES })).rejects.toThrow(
      "applyVenue: plan is missing create-node",
    );
  });

  it("never returns a phantom series id when ON CONFLICT drops a colliding series", async () => {
    // planVenue rejects equal codes, so this hand-builds the colliding plan directly to prove the
    // apply-side gate: two create-series sharing (tenant, node, code), the second dropped by
    // ON CONFLICT DO NOTHING. Its id must NOT reach the result, and the venue must end with exactly
    // one series row — the honest reflection of what was written.
    const taxId = "B22222222";
    const tenantId = obligadoTenantId("ES", taxId);
    const collidingPlan: VenueAction[] = [
      { kind: "ensure-tenant", tenantId, country: "ES", taxId, legalName: "Deli SL" },
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
      { kind: "create-node", name: "Mostrador", filingModule: "verifactu", taxModule: "iva" },
      { kind: "seed-module", module: "fiscal", summary: "s" },
      { kind: "create-series", code: "A", purpose: "standard" },
      { kind: "create-series", code: "A", purpose: "rectificative" }, // same code ⇒ dropped
    ];

    const result = await applyVenue(collidingPlan, { db: suite.db, modules: ALL_MODULES });
    expect(result.seriesIds).toHaveLength(1); // the dropped series' id is not returned

    const series = await suite.db.execute<{ n: number }>(sql`
      select count(*)::int as n from invoice_series where node_id = ${result.nodeId}`);
    expect(series.rows[0]?.n).toBe(1); // only one series row exists
  });

  it("refuses a plan that omits create-till rather than returning an empty till id", async () => {
    // The ordering guards check the ids a LATER action depends on (a till's location, a node's
    // location, a seed/series' node). Nothing downstream depends on `tillId`, so an OMITTED create-till
    // slips past every ordering guard, and the run used to return a "complete"
    // VenueResult with `tillId === ""` — a venue with no real till, which fails confusingly later
    // (recordSale needs one). A post-loop completeness guard names the missing step instead.
    const taxId = "B44444444";
    const tenantId = obligadoTenantId("ES", taxId);
    const planWithoutTill: VenueAction[] = [
      { kind: "ensure-tenant", tenantId, country: "ES", taxId, legalName: "Deli SL" },
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
      { kind: "create-node", name: "Mostrador", filingModule: "verifactu", taxModule: "iva" },
      { kind: "seed-module", module: "fiscal", summary: "s" },
      { kind: "create-series", code: "A", purpose: "standard" },
    ];

    await expect(
      applyVenue(planWithoutTill, { db: suite.db, modules: ALL_MODULES }),
    ).rejects.toThrow("applyVenue: plan is missing create-till");
  });

  describe("guards a malformed plan whose actions arrive out of order", () => {
    // planVenue always emits create-location before create-till/create-node, and create-node before
    // create-series/seed-module, so these orderings are unreachable from it. A hand-built (or a
    // future-planner) plan that runs a step early would otherwise hit the DB with an EMPTY uuid — a
    // low-signal 22P02 — or run a module seed against an empty node id (fiscally load-bearing). Each
    // guard turns that into a clear plan-integrity Error BEFORE any such write, not an operator-facing
    // AppError: a malformed plan is a programming bug, not operator input.
    const taxId = "B33333333";
    const tenantId = obligadoTenantId("ES", taxId);
    const ensure: VenueAction = {
      kind: "ensure-tenant",
      tenantId,
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
            profiles: [{ name: "Counter", capabilities: [] }],
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
            taxModule: "iva",
          } as VenueAction,
        ],
        message: "applyVenue: create-node before create-location",
      },
      {
        name: "seed-module before create-node",
        plan: [
          ensure,
          createLocation,
          { kind: "seed-module", module: "fiscal", summary: "s" } as VenueAction,
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
      // Its own obligado: the suite shares one database, and B44444444 belongs to the create-till
      // completeness case above.
      const modules = [...ALL_MODULES, recorder];
      const result = await applyVenue(planVenue(request("B47474747"), modules), {
        db: suite.db,
        modules,
      });
      expect(seeded).toContain(result.nodeId);
      expect(result.seeded.map((s) => s.module)).toEqual(["fiscal", "probe"]);
      expect(result.seeded[1]).toEqual({ module: "probe", report: `recorded ${result.nodeId}` });
    });

    it("a throwing seed rolls the whole venue back — no tenant row survives", async () => {
      // The reason the seed runs INSIDE the venue transaction (CLAUDE.md §5): a module that cannot
      // establish its state must leave no half-built venue behind, least of all a fiscal chain.
      // A tax id no other test in this file provisions, so an absent tenant row is this run's answer.
      const modules = [...ALL_MODULES, exploding];
      const taxId = "B51515151";
      await expect(
        applyVenue(planVenue(request(taxId), modules), { db: suite.db, modules }),
      ).rejects.toThrow("seed failed");
      const tenant = await suite.db.execute(
        sql`select 1 from tenants where id = ${obligadoTenantId("ES", taxId)}`,
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
      // The guard's other half: the module IS held, but carries no seed to run. Only `deps.modules`
      // is consulted, so a same-named descriptor without the seat is refused exactly as an absent
      // one is — the plan alone never decides what runs.
      const seedless = fakeModule(recorder.name);
      await expect(
        applyVenue(plan, { db: suite.db, modules: [...ALL_MODULES, seedless] }),
      ).rejects.toThrow(refusal);
    });
  });
});
