import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { withTenant } from "@waitron/db";
import type { Database } from "@waitron/db";
import {
  decimal,
  tenantId as brandTenantId,
  workingOrderId as brandWorkingOrderId,
} from "@waitron/shared";
import { getPaymentByRef, insertInitiated, resolvePaymentTenant } from "@waitron/payments";
import { freshNif, seedWorkingOrder } from "@waitron/payments/test/seed.js";
import { startRealPostgres, type RealPostgres } from "./testing/postgres.js";
import { FakeStripeHosted } from "./testing/fake-stripe-hosted.js";
import { StripeHostedProvider } from "./hosted-provider.js";

const PROBE_ROLE = "rls_probe_hosted";
const PROBE_PASSWORD = "probe";

let pg: RealPostgres;
let admin: Database;

beforeAll(async () => {
  pg = await startRealPostgres();
  admin = await pg.connect();
  // `execute(string)` runs verbatim (drizzle wraps a plain string in sql.raw internally), so this
  // needs no drizzle-orm import — payments-stripe does not depend on it. Mirrors stripe.rls.test.ts.
  await admin.execute(
    `create role ${PROBE_ROLE} login password '${PROBE_PASSWORD}' in role app_user`,
  );
}, 180_000);

afterAll(async () => {
  if (admin !== undefined) await admin.close();
  if (pg !== undefined) await pg.stop();
});

describe("hosted initiated rows under real row-level security", () => {
  it("isolates an initiated stripe row by tenant and resolves it untenanted by session id", async () => {
    const a = await seedWorkingOrder(admin, "B31111111");
    const b = await seedWorkingOrder(admin, "B32222222");
    const key = { tenantId: a.tenantId, provider: "stripe", paymentRef: "hosted-r1" };
    const sessionId = "cs_rls_hosted";

    const probe = await pg.connectAs(PROBE_ROLE, PROBE_PASSWORD);
    try {
      // The store call initiate makes — written as rls_probe, scoped to tenant A via withTenant.
      // `insertInitiated`'s NewPayment fields are plain strings (no branding needed here).
      await withTenant(probe, a.tenantId, (tx) =>
        insertInitiated(tx, {
          tenantId: a.tenantId,
          workingOrderId: a.workingOrderId,
          provider: "stripe",
          paymentRef: "hosted-r1",
          externalRef: sessionId,
          amount: decimal("12.10"),
        }),
      );

      // Tenant A sees it; tenant B (SAME key) does not — isolation holds under a real RLS role.
      const seen = await withTenant(probe, a.tenantId, (tx) => getPaymentByRef(tx, key));
      expect(seen?.state).toBe("initiated");
      expect(seen?.externalRef).toBe(sessionId);
      const hidden = await withTenant(probe, b.tenantId, (tx) => getPaymentByRef(tx, key));
      expect(hidden).toBeUndefined();

      // The inbound-webhook case: resolve the tenant from (provider, session id) with NO GUC set. A
      // plain unscoped read returns nothing (isolation fails closed); the SECURITY DEFINER seam
      // crosses and returns ONLY the tenant id.
      const resolved = await resolvePaymentTenant(probe, "stripe", sessionId);
      expect(resolved).toBe(a.tenantId);
    } finally {
      await probe.close();
    }
  });

  // The third adapter that carried the same impossible "TENANT-SCOPED `Database` handle"
  // requirement. It scopes from `params.tenantId` now — `initiate` is its only database method.
  it("initiate() writes its initiated row when handed the only Database handle the API can build", async () => {
    const t = await seedWorkingOrder(admin, freshNif());
    const probe = await pg.connectAs(PROBE_ROLE, PROBE_PASSWORD);
    try {
      const provider = new StripeHostedProvider({ client: new FakeStripeHosted(), db: probe });
      const res = await provider.initiate({
        tenantId: brandTenantId(t.tenantId),
        workingOrderId: brandWorkingOrderId(t.workingOrderId),
        amount: decimal("12.10"),
        paymentRef: "hosted-rls-1",
      });
      expect(res.externalRef).toBeTruthy();
    } finally {
      await probe.close();
    }
  });
});
