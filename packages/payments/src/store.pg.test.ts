import { describe, expect, it } from "vitest";
import { withTenant } from "@waitron/db";
import { useTemplateDb } from "@waitron/db/testing/lifecycle.js";
import { decimal } from "@waitron/shared";
import {
  associatePaymentWithSale,
  findCapturedPaymentForWorkingOrder,
  insertCapturedPayment,
} from "./store.js";
import { seedSale, seedWorkingOrder } from "../test/seed.js";

// The real-Postgres companion to store.test.ts, which is PGlite. It connects as a non-superuser
// LOGIN role inheriting app_user's grants — what lets it SELECT/INSERT/UPDATE `payments` at all
// (0001_payments_baseline_sql.sql's REVOKE ALL + targeted GRANT). PGlite connects as a superuser holding
// every grant, so this is the only target on which a missing one shows up. The role is created once,
// cluster-wide, in the package's globalSetup (`src/testing/global-setup.ts`) — not per file, because
// a shared container is one cluster.
const PROBE_ROLE = "rls_probe";
const PROBE_PASSWORD = "probe";

// A clone of the `core_payments` template (CORE + PAYMENTS).
const postgres = useTemplateDb({ template: "core_payments" });

const SETTLED = new Date("2026-07-22T10:00:00Z");

describe("findCapturedPaymentForWorkingOrder", () => {
  it("returns saleId once associated — the replay branch, not just the resume (saleId null) one", async () => {
    // Seeded as the owner (admin) — setup, not the thing under test. seedSale plants a real committed
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

      // After association: the REPLAY branch — the sale is already filed, saleId populated. This is
      // the branch the whole return shape exists for, and the only assertion of it anywhere:
      // store.test.ts pins the resume branch (`saleId: null`) and reads the associated value back
      // through getPaymentByRef instead.
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
