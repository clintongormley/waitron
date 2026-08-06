import { describe, expect, it } from "vitest";
import { asAppUser, withTenant } from "@waitron/db";
import type { Database } from "@waitron/db";
import { useRealPostgres } from "@waitron/db/testing/lifecycle.js";
import type { FiscalBackend, TrustedClock } from "@waitron/fiscal";
import type { NodeId, SaleId, SeriesId, TenantId, TillId } from "@waitron/shared";
import { recordSubstitution } from "./record-substitution.js";
import type { RecordSubstitutionInput } from "./record-substitution.js";
import { seedBareSale, seedTenant } from "../test/fixtures.js";
import { startRealPostgres } from "./testing/postgres.js";

// Real Postgres, not PGlite, for the whole suite — mandatory here (design §7, CLAUDE.md §4). The
// substituted-ticket and series lookups either carry no tenant predicate (the ticket lookup,
// RLS-scoped exactly as record-void.ts) or an explicit one AND RLS (the series), so a cross-tenant
// row is hidden by `FORCE ROW LEVEL SECURITY` alone. As a superuser (PGlite) the same SELECTs would
// return the row and the "not_found" answers would be wrong — which is the point.
const postgres = useRealPostgres({
  start: startRealPostgres,
  // The container image may be pulled cold on a fresh CI runner; the package's other real-PG suites
  // set the same 180s for the same reason.
  timeoutMs: 180_000,
});

const BASE = new Date("2026-03-01T13:05:00+01:00");

const steadyClock: TrustedClock = {
  now: () => ({
    instant: BASE,
    offsetMinutes: 60,
    confident: true,
    confidence: "anchored",
    anchorAgeSeconds: 0,
  }),
  anchor: () => {
    throw new Error("anchor() is not used by recordSubstitution");
  },
  currentAnchor: () => null,
};

/**
 * A backend that throws on every call — these tests must reject at a guard BEFORE the backend is
 * ever consulted (both `sale.not_found` and `sale.series_not_found` are raised ahead of
 * `checkIntegrity`). If `recordSubstitution` reached the backend, the test would fail with this
 * error rather than the expected code, which is exactly the regression worth catching.
 */
const unreachableBackend: FiscalBackend = {
  registerNode: () => {
    throw new Error("backend must not be reached");
  },
  recordSale: () => {
    throw new Error("backend must not be reached");
  },
  filedReceiptFor: () => {
    throw new Error("backend must not be reached");
  },
  recordVoid: () => {
    throw new Error("backend must not be reached");
  },
  recordCorrection: () => {
    throw new Error("backend must not be reached");
  },
  recordSubstitution: () => {
    throw new Error("backend must not be reached");
  },
  checkIntegrity: () => {
    throw new Error("backend must not be reached");
  },
  pendingCount: () => {
    throw new Error("backend must not be reached");
  },
  drain: () => {
    throw new Error("backend must not be reached");
  },
  reconcile: () => {
    throw new Error("backend must not be reached");
  },
};

function substitutionInput(
  seed: { tenantId: TenantId; tillId: TillId; nodeId: NodeId },
  seriesId: SeriesId,
  substitutedSaleIds: SaleId[],
): RecordSubstitutionInput {
  return {
    tenantId: seed.tenantId,
    tillId: seed.tillId,
    nodeId: seed.nodeId,
    seriesId,
    substitutedSaleIds,
    counterparty: { taxId: "B12345678", legalName: "Acme Corp SL", countryCode: "ES" },
    total: "1.00",
    lines: [
      {
        lineNo: 1,
        descriptions: { "es-ES": "Item" },
        quantity: "1",
        unitPrice: "1.00",
        vatRate: "0.00",
        lineTotal: "1.00",
      },
    ],
    locale: "es-ES",
    invoiceLocales: ["es-ES"],
    fiscalBackend: "fake",
    clock: steadyClock,
  };
}

/** Runs `recordSubstitution` as the non-superuser app role, inside a tenant-scoped transaction —
 * both matter: `withTenant` sets `app.tenant_id`, `asAppUser` switches off the superuser bypass, so
 * a cross-tenant row is genuinely hidden by RLS rather than merely filtered by a predicate a
 * superuser would ignore. */
function substitute(
  db: Database,
  tenantId: TenantId,
  input: RecordSubstitutionInput,
): Promise<unknown> {
  return withTenant(db, tenantId, async (tx) => {
    await asAppUser(tx);
    return recordSubstitution(tx, unreachableBackend, input);
  });
}

describe("recordSubstitution — cross-tenant isolation (RLS)", () => {
  it("throws sale.not_found for a cross-tenant substituted ticket (RLS-hidden, not forbidden)", async () => {
    // The load-bearing RLS test, and why this suite is real-PG. The ticket is real, but belongs to
    // another tenant; the substituted-ticket lookup has no tenant predicate, so under FORCE ROW
    // LEVEL SECURITY as `app_user` it reads back zero rows — genuinely not-found rather than
    // forbidden.
    const other = await seedTenant(postgres.admin);
    const foreignTicket = await seedBareSale(postgres.admin, other);
    const seed = await seedTenant(postgres.admin);

    await expect(
      substitute(
        postgres.admin,
        seed.tenantId,
        substitutionInput(seed, seed.seriesId, [foreignTicket]),
      ),
    ).rejects.toMatchObject({ code: "sale.not_found", params: { saleId: foreignTicket } });
  });

  it("throws sale.series_not_found for a cross-tenant series", async () => {
    // The ticket is visible (this tenant's own), but the series belongs to another tenant.
    // Belt-and-suspenders: the series lookup carries an explicit tenant predicate AND is RLS-scoped,
    // so the foreign series reads as not-found under either — exercised here on real PG for the same
    // reason as above.
    const seed = await seedTenant(postgres.admin);
    const ticket = await seedBareSale(postgres.admin, seed);
    const other = await seedTenant(postgres.admin);

    await expect(
      substitute(postgres.admin, seed.tenantId, substitutionInput(seed, other.seriesId, [ticket])),
    ).rejects.toMatchObject({ code: "sale.series_not_found" });
  });
});
