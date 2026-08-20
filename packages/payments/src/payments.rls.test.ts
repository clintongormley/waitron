import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { withTenant } from "@waitron/db";
import { useTemplateDb } from "@waitron/db/testing/lifecycle.js";
import { decimal } from "@waitron/shared";
import {
  associatePaymentWithSale,
  findCapturedPaymentForWorkingOrder,
  getPaymentByRef,
  insertCapturedPayment,
  insertInitiated,
  resolvePaymentTenant,
} from "./store.js";
import { seedSale, seedWorkingOrder } from "../test/seed.js";

// A non-superuser LOGIN role that inherits app_user's grants. Being non-superuser is what makes
// RLS apply to it at all (a superuser bypasses FORCE ROW LEVEL SECURITY, which is exactly why
// PGlite — which always connects as superuser — cannot prove any of this; see this suite's whole
// reason for existing). The app_user membership is what lets it SELECT/INSERT/UPDATE `payments`
// in the first place (0001_payments_rls.sql's REVOKE ALL + targeted GRANT). current_tenant_id()
// then reads `app.tenant_id`, so with no GUC set the tenant-isolation policy matches zero rows.
const PROBE_ROLE = "rls_probe";
const PROBE_PASSWORD = "probe";

// A clone of the `core_payments` template (CORE + PAYMENTS); the probe connections below authenticate as
// `rls_probe`, a cluster-wide role the package globalSetup creates in place of the per-file
// `probeRole` this suite passed before the shared container.
const postgres = useTemplateDb({ template: "core_payments" });

const SETTLED = new Date("2026-07-22T10:00:00Z");

describe("payments under real row-level security", () => {
  it("an app_user-role connection inserts and reads its own tenant's payment, and only its own", async () => {
    // Seeded as the superuser (admin) — RLS is bypassed for this setup, which is fine: the
    // working_order chain being seeded isn't the thing under test, the payment insert below is.
    const tenantA = await seedWorkingOrder(postgres.admin, "B11111111");
    const tenantB = await seedWorkingOrder(postgres.admin, "B22222222");

    const probe = await postgres.pg.connectAs(PROBE_ROLE, PROBE_PASSWORD);
    try {
      const key = { tenantId: tenantA.tenantId, provider: "fake", paymentRef: "r1" };

      // INSERT as rls_probe, scoped to tenant A via withTenant. Succeeding here proves both the
      // INSERT grant (0001_payments_rls.sql's `GRANT INSERT ... TO app_user`) and the WITH CHECK
      // half of the tenant-isolation policy (tenant_id = current_tenant_id()).
      await withTenant(probe, tenantA.tenantId, (tx) =>
        insertCapturedPayment(tx, {
          tenantId: tenantA.tenantId,
          workingOrderId: tenantA.workingOrderId,
          provider: "fake",
          paymentRef: "r1",
          amount: decimal("10.00"),
          settledAt: SETTLED,
        }),
      );

      // Read back as rls_probe, still scoped to tenant A. Proves the SELECT grant plus the USING
      // half of the policy — a non-superuser role with no special privilege on this row sees it
      // because it owns the tenant scope the policy checks against.
      const seen = await withTenant(probe, tenantA.tenantId, (tx) => getPaymentByRef(tx, key));
      expect(seen?.state).toBe("captured");
      expect(seen?.amount).toBe("10.00");

      // Same query, same row, but scoped to tenant B instead. The row indisputably exists (just
      // proven above) and rls_probe indisputably holds SELECT on the table (also just proven
      // above) — the only thing standing between this query and that row is the isolation
      // policy's USING clause evaluating tenant_id = current_tenant_id() against B's GUC. It
      // returns nothing, which is the isolation guarantee actually holding under a real
      // RLS-subject role rather than being assumed from the migration text.
      const hidden = await withTenant(probe, tenantB.tenantId, (tx) => getPaymentByRef(tx, key));
      expect(hidden).toBeUndefined();
    } finally {
      await probe.close();
    }
  });
});

describe("findCapturedPaymentForWorkingOrder under real row-level security", () => {
  it("finds only the caller-tenant's captured payment, with BOTH tenants non-empty in the same state", async () => {
    // Seeded as the superuser (admin) — RLS bypassed for setup, same as above.
    const tenantA = await seedWorkingOrder(postgres.admin, "B55555555");
    const tenantB = await seedWorkingOrder(postgres.admin, "B66666666");

    const probe = await postgres.pg.connectAs(PROBE_ROLE, PROBE_PASSWORD);
    try {
      const keyA = {
        tenantId: tenantA.tenantId,
        provider: "stripe",
        workingOrderId: tenantA.workingOrderId,
      };
      const keyB = {
        tenantId: tenantB.tenantId,
        provider: "stripe",
        workingOrderId: tenantB.workingOrderId,
      };

      // Both tenants get a CAPTURED payment, in the same state — deliberately, so "invisible"
      // below cannot be the trivial "there was nothing there to find" answer (CLAUDE.md §1: a
      // measurement where both answers look alike measures nothing). If tenant B were left empty,
      // querying under B's scope would return undefined whether or not RLS does anything at all.
      await withTenant(probe, tenantA.tenantId, (tx) =>
        insertCapturedPayment(tx, {
          tenantId: tenantA.tenantId,
          workingOrderId: tenantA.workingOrderId,
          provider: "stripe",
          paymentRef: "rls-a",
          amount: decimal("10.00"),
          settledAt: SETTLED,
        }),
      );
      await withTenant(probe, tenantB.tenantId, (tx) =>
        insertCapturedPayment(tx, {
          tenantId: tenantB.tenantId,
          workingOrderId: tenantB.workingOrderId,
          provider: "stripe",
          paymentRef: "rls-b",
          amount: decimal("20.00"),
          settledAt: SETTLED,
        }),
      );

      // Each tenant finds its OWN captured payment under its own scope — proves both rows really
      // exist and are independently reachable (not just "everything returns undefined").
      const seenA = await withTenant(probe, tenantA.tenantId, (tx) =>
        findCapturedPaymentForWorkingOrder(tx, keyA),
      );
      expect(seenA?.paymentRef).toBe("rls-a");
      const seenB = await withTenant(probe, tenantB.tenantId, (tx) =>
        findCapturedPaymentForWorkingOrder(tx, keyB),
      );
      expect(seenB?.paymentRef).toBe("rls-b");

      // Same query, same key (tenantId = tenantA.tenantId, so the app-level explicit tenant_id
      // predicate in the query STILL matches tenant A's row) — but scoped to tenant B instead. The
      // row indisputably exists and the explicit predicate indisputably agrees with it (both just
      // proven above); the ONLY thing standing between this query and that row is the isolation
      // policy's USING clause evaluating tenant_id = current_tenant_id() against B's GUC.
      const hidden = await withTenant(probe, tenantB.tenantId, (tx) =>
        findCapturedPaymentForWorkingOrder(tx, keyA),
      );
      expect(hidden).toBeUndefined();
    } finally {
      await probe.close();
    }
  });

  it("returns saleId once associated — the replay branch, not just the resume (saleId null) one", async () => {
    // Seeded as the superuser (admin) — RLS bypassed for setup. seedSale plants a real committed
    // sale + covering tender under this tenant, the minimal thing associatePaymentWithSale needs
    // to point a payment at (no need to go through @waitron/core's full recordSale here).
    const tenant = await seedWorkingOrder(postgres.admin, "B77777777");
    const saleId = await seedSale(postgres.admin, tenant);

    const probe = await postgres.pg.connectAs(PROBE_ROLE, PROBE_PASSWORD);
    try {
      const orderKey = {
        tenantId: tenant.tenantId,
        provider: "stripe",
        workingOrderId: tenant.workingOrderId,
      };
      const paymentKey = { tenantId: tenant.tenantId, provider: "stripe", paymentRef: "replay-1" };

      await withTenant(probe, tenant.tenantId, (tx) =>
        insertCapturedPayment(tx, {
          tenantId: tenant.tenantId,
          workingOrderId: tenant.workingOrderId,
          provider: "stripe",
          paymentRef: "replay-1",
          amount: decimal("10.00"),
          settledAt: SETTLED,
        }),
      );

      // Before association: the RESUME branch — captured but P3 never ran, saleId null.
      const beforeAssoc = await withTenant(probe, tenant.tenantId, (tx) =>
        findCapturedPaymentForWorkingOrder(tx, orderKey),
      );
      expect(beforeAssoc?.saleId).toBeNull();

      await withTenant(probe, tenant.tenantId, (tx) =>
        associatePaymentWithSale(tx, { ...paymentKey, saleId }),
      );

      // After association: the REPLAY branch — the sale is already filed, saleId populated. This
      // is the branch the whole return shape exists for and the one the resume-only test above
      // never exercises.
      const afterAssoc = await withTenant(probe, tenant.tenantId, (tx) =>
        findCapturedPaymentForWorkingOrder(tx, orderKey),
      );
      expect(afterAssoc?.saleId).toBe(saleId);
      expect(afterAssoc?.paymentRef).toBe("replay-1");
      expect(afterAssoc?.state).toBe("captured");
    } finally {
      await probe.close();
    }
  });
});

describe("the untenanted webhook resolver under real row-level security", () => {
  it("resolves (provider, external_ref) -> tenant_id across tenants, but leaks no wider row", async () => {
    const tenantA = await seedWorkingOrder(postgres.admin, "B33333333");
    const tenantB = await seedWorkingOrder(postgres.admin, "B44444444");

    // Seed one `initiated` hosted payment for each tenant, as the superuser (RLS bypassed for setup).
    await withTenant(postgres.admin, tenantA.tenantId, (tx) =>
      insertInitiated(tx, {
        tenantId: tenantA.tenantId,
        workingOrderId: tenantA.workingOrderId,
        provider: "fake",
        paymentRef: "pa",
        externalRef: "hosted-A",
        amount: decimal("10.00"),
      }),
    );
    await withTenant(postgres.admin, tenantB.tenantId, (tx) =>
      insertInitiated(tx, {
        tenantId: tenantB.tenantId,
        workingOrderId: tenantB.workingOrderId,
        provider: "fake",
        paymentRef: "pb",
        externalRef: "hosted-B",
        amount: decimal("20.00"),
      }),
    );

    const probe = await postgres.pg.connectAs(PROBE_ROLE, PROBE_PASSWORD);
    try {
      // The resolver runs with NO tenant GUC set — the genuine webhook case. It must still return
      // tenant A's id for hosted-A, proving the SECURITY DEFINER function crosses tenants for this
      // one lookup even under a real RLS-subject role.
      const resolvedA = await resolvePaymentTenant(probe, "fake", "hosted-A");
      expect(resolvedA).toBe(tenantA.tenantId);
      const resolvedB = await resolvePaymentTenant(probe, "fake", "hosted-B");
      expect(resolvedB).toBe(tenantB.tenantId);

      // An unknown ref resolves to null (the missingLocal case the app acks + reconcile audits).
      expect(await resolvePaymentTenant(probe, "fake", "nope")).toBeNull();

      // The bypass is confined to the function: a PLAIN select by the same probe, with no tenant
      // GUC set, still sees nothing (the permissive policy is scoped TO payments_webhook_resolver,
      // not to app_user). This is what proves the resolver leaks only tenant_id, nothing wider.
      const direct = await probe.execute<{ tenant_id: string }>(
        sql`select tenant_id from payments where provider = 'fake' and external_ref = 'hosted-A'`,
      );
      expect(direct.rows).toHaveLength(0);
    } finally {
      await probe.close();
    }
  });
});
