import { sql } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { asAppUser, captureError, pgErrorCode, withTenant } from "@waitron/db";
import { useRealPostgres } from "@waitron/db/testing/lifecycle.js";
import { seedTenant } from "@waitron/db/testing/seed.js";
import type { Decimal, TenantId } from "@waitron/shared";
import {
  createPurchaseInvoice,
  deletePurchaseInvoice,
  getPurchaseInvoice,
  listPurchaseInvoices,
} from "./operations.js";
import { CONTAINER_SETUP_TIMEOUT_MS, startRealPostgres } from "./testing/postgres.js";

// A non-superuser LOGIN role that inherits app_user's grants, so it is a genuine RLS subject: the
// container's default user is a superuser and bypasses FORCE ROW LEVEL SECURITY, so a policy/grant
// assertion has to run under a role like this. The app_user membership grants it
// SELECT/INSERT/UPDATE/DELETE on both purchase tables (0042_purchase_invoices_rls.sql) — unlike the
// immutable sales/registros lane, DELETE IS granted here (these are mutable accounting records), which
// the "app_user may delete" test proves. current_tenant_id() reads `app.tenant_id`, so a query under
// tenant B's GUC matches none of tenant A's rows. This suite runs on REAL Postgres because PGlite
// connects as a superuser and bypasses FORCE ROW LEVEL SECURITY, which would make an RLS/grant
// assertion a false pass (CLAUDE.md §4). Mirrors packages/recipes/src/ingredients.rls.test.ts.
const PROBE_ROLE = "rls_probe";
const PROBE_PASSWORD = "probe";

const suite = useRealPostgres({
  start: startRealPostgres,
  probeRole: { name: PROBE_ROLE, password: PROBE_PASSWORD, inRole: "app_user" },
  timeoutMs: CONTAINER_SETUP_TIMEOUT_MS,
});

const d = (s: string): Decimal => s as Decimal;

function tenantAInvoice() {
  return {
    header: {
      supplierTaxId: "B12345678",
      supplierName: "Proveedor SL",
      supplierInvoiceNumber: "A-1",
      issuedOn: "2026-08-03",
      receivedOn: "2026-08-05",
      total: d("242.00"),
    },
    lines: [
      { rate: d("21.00"), base: d("200.00"), tax: d("42.00") },
      { rate: d("10.00"), base: d("20.00"), tax: d("2.00"), kind: "capital" as const },
    ],
  };
}

describe("purchase invoices under real row-level security", () => {
  let tenantA: TenantId;
  let tenantB: TenantId;
  let invoiceId: string;

  beforeAll(async () => {
    // Seed both tenants as the superuser (admin) — RLS is bypassed for seeding. The invoice below is
    // written as the RLS-subject probe role scoped to tenant A, so the INSERT exercises the grant and
    // the WITH CHECK half of the isolation policy on BOTH tables (header + VAT lines).
    tenantA = await seedTenant(suite.admin);
    tenantB = await seedTenant(suite.admin);
    const probe = await suite.pg.connectAs(PROBE_ROLE, PROBE_PASSWORD);
    try {
      invoiceId = await withTenant(probe, tenantA, async (tx) => {
        await asAppUser(tx);
        const created = await createPurchaseInvoice(tx, tenantAInvoice());
        return created.id;
      });
    } finally {
      await probe.close();
    }
  });

  it("runs as a non-superuser role without BYPASSRLS (so RLS actually applies)", async () => {
    // THE LOAD-BEARING GUARD. If the probe role were a superuser or held BYPASSRLS, the isolation
    // below would be enforced by nothing and the whole suite would be theatre.
    const probe = await suite.pg.connectAs(PROBE_ROLE, PROBE_PASSWORD);
    try {
      const facts = await withTenant(probe, tenantA, async (tx) => {
        await asAppUser(tx);
        const { rows } = await tx.execute<{ role: string; super: boolean; bypass: boolean }>(sql`
          select current_user as role,
                 (select rolsuper from pg_roles where rolname = current_user) as super,
                 (select rolbypassrls from pg_roles where rolname = current_user) as bypass`);
        return rows[0]!;
      });
      expect(facts.role).toBe("app_user");
      expect(facts.super).toBe(false);
      expect(facts.bypass).toBe(false);
    } finally {
      await probe.close();
    }
  });

  it("isolates one tenant's invoices (and VAT lines) from another", async () => {
    const probe = await suite.pg.connectAs(PROBE_ROLE, PROBE_PASSWORD);
    try {
      // Positive control — tenant A, the owner, sees its own invoice and both its VAT lines. Proves
      // the SELECT grant and the USING half of BOTH policies, and that the seed landed. This is the
      // read the prove-by-deletion RED/GREEN flips (weaken purchase_invoices_tenant_isolation's USING
      // to `true`).
      const ownInvoices = await withTenant(probe, tenantA, async (tx) => {
        await asAppUser(tx);
        return listPurchaseInvoices(tx);
      });
      expect(ownInvoices.map((i) => i.supplierInvoiceNumber)).toEqual(["A-1"]);
      expect(ownInvoices[0]?.lines).toHaveLength(2);

      // The isolation guarantee: the SAME probe role, holding the SAME grants, sees NONE of tenant A's
      // rows when scoped to tenant B — on the header table (listPurchaseInvoices) AND on the VAT-line
      // table read directly (proving purchase_invoice_vat's own policy, not just the header's).
      const seenByB = await withTenant(probe, tenantB, async (tx) => {
        await asAppUser(tx);
        const invoices = await listPurchaseInvoices(tx);
        const { rows } = await tx.execute<{ n: number }>(
          sql`select count(*)::int as n from purchase_invoice_vat`,
        );
        return { invoices, vatRows: rows[0]!.n };
      });
      expect(seenByB.invoices).toEqual([]);
      expect(seenByB.vatRows).toBe(0);

      // And tenant A, reading the VAT table directly, DOES see its two lines — the control that the
      // zero above is isolation, not an empty table.
      const vatSeenByA = await withTenant(probe, tenantA, async (tx) => {
        await asAppUser(tx);
        const { rows } = await tx.execute<{ n: number }>(
          sql`select count(*)::int as n from purchase_invoice_vat`,
        );
        return rows[0]!.n;
      });
      expect(vatSeenByA).toBe(2);
    } finally {
      await probe.close();
    }
  });

  it("denies a cross-tenant write to purchase_invoice_vat (WITH CHECK)", async () => {
    // The write half of the child policy: tenant B cannot insert a VAT row tagged as tenant A's — the
    // WITH CHECK (tenant_id = current_tenant_id()) rejects it with 42501. The invoice still exists
    // (this runs before the destructive DELETE test), so the composite FK (A, invoiceId) is satisfied
    // and the ONLY thing left to reject the row is the policy — not a 23503 FK failure.
    const probe = await suite.pg.connectAs(PROBE_ROLE, PROBE_PASSWORD);
    try {
      const error = await captureError(() =>
        withTenant(probe, tenantB, async (tx) => {
          await asAppUser(tx);
          await tx.execute(sql`
            insert into purchase_invoice_vat (tenant_id, purchase_invoice_id, rate, base, tax)
            values (${tenantA}, ${invoiceId}, '21.00', '1.00', '0.21')`);
        }),
      );
      expect(pgErrorCode(error)).toBe("42501");
    } finally {
      await probe.close();
    }
  });

  it("grants app_user DELETE (mutable records, unlike the immutable sales lane)", async () => {
    // The grant that distinguishes these tables from ingredients/sales: DELETE succeeds under the
    // non-superuser probe role (the FK cascade removes the VAT lines). Prove-by-deletion for the grant
    // itself is by-hand — dropping DELETE from 0042's GRANT makes this fail 42501 — done and restored.
    // Destructive (removes the seeded invoice), so it runs last.
    const probe = await suite.pg.connectAs(PROBE_ROLE, PROBE_PASSWORD);
    try {
      await withTenant(probe, tenantA, async (tx) => {
        await asAppUser(tx);
        await deletePurchaseInvoice(tx, invoiceId);
        expect(await getPurchaseInvoice(tx, invoiceId)).toBeNull();
        const { rows } = await tx.execute<{ n: number }>(
          sql`select count(*)::int as n from purchase_invoice_vat`,
        );
        expect(rows[0]!.n).toBe(0); // cascade removed the VAT lines
      });
    } finally {
      await probe.close();
    }
  });
});
