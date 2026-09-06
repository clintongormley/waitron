import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { CORE_MIGRATIONS } from "@waitron/db";
import { usePgliteDb } from "@waitron/db/testing/lifecycle.js";
import { seedTenant } from "@waitron/db/testing/seed.js";
import { readVenueLocale } from "./venue-locale.js";

// PGlite, not real Postgres: `readVenueLocale` is a plain two-row read (tenant country + location
// province) feeding the shared `resolveVenueLocale` chain, the same LOGIC shape the till/me route
// mechanics prove on PGlite. It reads under `withTenant` + `asAppUser` exactly as production
// does; the app_user privilege matrix in @waitron/fiscal-verifactu checks the table grants on
// real PostgreSQL (`app_user` already holds SELECT on both — `GET /api/till` reads them the same
// way). CORE_MIGRATIONS alone: both `tenants.country` and `locations.province` live in core, so
// no identity/workforce schema is needed.
let tenantId: string;
let locationId: string;

const suite = usePgliteDb({
  migrations: [CORE_MIGRATIONS],
  timeoutMs: 60_000,
  setup: async (db) => {
    // `seedTenant` sets country 'ES' (and legal_name 'Test SL', a generated tax_id).
    tenantId = await seedTenant(db);
    // A location with province 'Barcelona' — a Catalan province, so once a Catalan catalogue ships the
    // province step would fire; today `PROVINCE_DEFAULT_LOCALE` is empty (deferred), so it falls
    // through to the country default.
    const loc = await db.execute<{ id: string }>(sql`
      insert into locations (tenant_id, name, province, invoice_locales, operation_description)
      values (${tenantId}, 'Counter', 'Barcelona', array['es-ES'], 'Retail') returning id`);
    locationId = loc.rows[0]!.id;
  },
});

describe("readVenueLocale", () => {
  it("derives the country default when no override and no regional catalogue", async () => {
    // province 'Barcelona' → Catalan deferred (empty PROVINCE_DEFAULT_LOCALE) → country 'ES' → es-ES.
    const got = await readVenueLocale(suite.db, { tenantId, locationId, override: undefined });
    expect(got).toBe("es-ES");
  });

  it("honours a supported override", async () => {
    const got = await readVenueLocale(suite.db, { tenantId, locationId, override: "en-GB" });
    expect(got).toBe("en-GB");
  });

  it("ignores an unsupported override, falls to country", async () => {
    // 'ca-ES' has no catalogue (not in SUPPORTED_LOCALES), so the override is dropped and the country
    // default 'ES' → es-ES wins — the same result as no override at all.
    const got = await readVenueLocale(suite.db, { tenantId, locationId, override: "ca-ES" });
    expect(got).toBe("es-ES");
  });

  it("falls to the English floor when neither tenant nor location row is found", async () => {
    // Absent rows (ids naming nothing) leave both `country` and `province` null, so `resolveVenueLocale`
    // reaches its `en-GB` floor. Not a production shape (provisioning stamps the till's own tenant +
    // location), but the graceful `?? null` path exists rather than a throw — this pins it.
    const got = await readVenueLocale(suite.db, {
      tenantId: randomUUID(),
      locationId: randomUUID(),
      override: undefined,
    });
    expect(got).toBe("en-GB");
  });
});
