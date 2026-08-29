import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { asAppUser, withTenant } from "@waitron/db";
import { useTemplateDb } from "@waitron/db/testing/lifecycle.js";
import { hashPassword, hashPin } from "@waitron/identity";
import { applyVenue, planVenue } from "@waitron/provisioning";
import { readChainHeight } from "./chain-height.js";

// Real Postgres, not PGlite: `cadenas` is RLS + FORCE ROW LEVEL SECURITY, and the reader relies on
// the caller's tenant context + `app_user` role to scope the row. PGlite runs every connection as a
// superuser, which bypasses FORCE RLS, so the tenant scope would be a false pass there (CLAUDE.md §4).
const LOCALE = "es-ES";

const suite = useTemplateDb({ template: "manifest" });

// Tenants accumulate for the life of the shared container and `tenants_country_tax_id_key` is unique,
// so the provisioned venue needs its own NIF — the same per-suite counter the sibling suites use.
let nifCounter = 0;
function nextNif(): string {
  nifCounter += 1;
  return `${String(72_000_000 + nifCounter).padStart(8, "0")}K`;
}

/** Provision one venue as the owner; the fixture mirrors `management-api.status.test.ts`'s `setupTenant()`. */
async function setupVenue(): Promise<{ tenantId: string; nodeId: string }> {
  const venue = await applyVenue(
    planVenue({
      country: "ES",
      taxId: nextNif(),
      legalName: "Deli Test SL",
      location: {
        name: "Sala principal",
        fiscalTerritory: "ES-common",
        invoiceLocales: [LOCALE],
        operationDescription: "Venta en establecimiento",
        addressLine1: "Calle Mayor 1",
        addressLine2: null,
        postalCode: "28013",
        city: "Madrid",
        province: "Madrid",
        timeZone: "Europe/Madrid",
        dayCutover: "05:00",
      },
      tillName: "Caja 1",
      seriesCode: "A",
      rectificativeSeriesCode: "R",
      admin: {
        displayName: "Administradora",
        pinHash: hashPin("1234"),
        passwordHash: hashPassword("dashPass123"),
      },
    }),
    { db: suite.admin },
  );
  return { tenantId: venue.tenantId, nodeId: venue.nodeId };
}

describe("readChainHeight (real postgres)", () => {
  let tenantId: string;
  let nodeId: string;

  beforeAll(async () => {
    ({ tenantId, nodeId } = await setupVenue());
  });

  it("returns 0 / null for a node with no cadenas row", async () => {
    // Provisioning seeds this venue's own chain head at `secuencia = 0` (verified 2026-08-29 against
    // the manifest template: applyVenue leaves a `cadenas` row with a non-null `actualizado_en`), so
    // the "absent row" branch is NOT reached by a freshly provisioned node — it is reached by a
    // node_id that has no chain row under this tenant. A random uuid is exactly that: RLS scopes the
    // read to the tenant, the `node_id` predicate then matches nothing, and the reader falls back to
    // `{ height: 0, lastAt: null }`.
    const result = await withTenant(suite.admin, tenantId, async (tx) => {
      await asAppUser(tx);
      return readChainHeight(tx, randomUUID());
    });
    expect(result).toEqual({ height: 0, lastAt: null });
  });

  it("returns the cadenas secuencia + actualizado_en once a chain row exists", async () => {
    // Seed the chain head as OWNER: `app_user` holds SELECT on `cadenas`, not this arbitrary write.
    await suite.admin.execute(sql`
      insert into cadenas (tenant_id, node_id, secuencia, actualizado_en)
      values (${tenantId}, ${nodeId}, 7, '2026-08-29T10:00:00Z')
      on conflict (tenant_id, node_id) do update set secuencia = 7, actualizado_en = '2026-08-29T10:00:00Z'`);

    const result = await withTenant(suite.admin, tenantId, async (tx) => {
      await asAppUser(tx);
      return readChainHeight(tx, nodeId);
    });
    expect(result.height).toBe(7);
    expect(result.lastAt).toBe("2026-08-29T10:00:00.000Z");
  });
});
