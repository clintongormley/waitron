import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { withTenant } from "@waitron/db";
import type { Database } from "@waitron/db";
import { decimal } from "@waitron/shared";
import { getPaymentByRef, insertCapturedPayment } from "./store.js";
import { startRealPostgres, type RealPostgres } from "./testing/postgres.js";
import { seedWorkingOrder } from "../test/seed.js";

// A non-superuser LOGIN role that inherits app_user's grants. Being non-superuser is what makes
// RLS apply to it at all (a superuser bypasses FORCE ROW LEVEL SECURITY, which is exactly why
// PGlite — which always connects as superuser — cannot prove any of this; see this suite's whole
// reason for existing). The app_user membership is what lets it SELECT/INSERT/UPDATE `payments`
// in the first place (0001_payments_rls.sql's REVOKE ALL + targeted GRANT). current_tenant_id()
// then reads `app.tenant_id`, so with no GUC set the tenant-isolation policy matches zero rows.
const PROBE_ROLE = "rls_probe";
const PROBE_PASSWORD = "probe";

let pg: RealPostgres;
let admin: Database;

beforeAll(async () => {
  pg = await startRealPostgres();
  admin = await pg.connect();
  await admin.execute(
    sql.raw(`create role ${PROBE_ROLE} login password '${PROBE_PASSWORD}' in role app_user`),
  );
});

afterAll(async () => {
  await admin.close();
  await pg.stop();
});

const SETTLED = new Date("2026-07-22T10:00:00Z");

describe("payments under real row-level security", () => {
  it("an app_user-role connection inserts and reads its own tenant's payment, and only its own", async () => {
    // Seeded as the superuser (admin) — RLS is bypassed for this setup, which is fine: the
    // working_order chain being seeded isn't the thing under test, the payment insert below is.
    const tenantA = await seedWorkingOrder(admin, "B11111111");
    const tenantB = await seedWorkingOrder(admin, "B22222222");

    const probe = await pg.connectAs(PROBE_ROLE, PROBE_PASSWORD);
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
