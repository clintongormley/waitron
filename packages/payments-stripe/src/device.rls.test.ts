import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { withTenant } from "@waitron/db";
import type { Database } from "@waitron/db";
import { decimal } from "@waitron/shared";
import { getPaymentByRef, insertAcceptedOffline, listAcceptedOffline } from "@waitron/payments";
import { startRealPostgres, type RealPostgres } from "./testing/postgres.js";
import { seedWorkingOrder } from "@waitron/payments/test/seed.js";

const PROBE_ROLE = "rls_probe_device";
const PROBE_PASSWORD = "probe";

let pg: RealPostgres;
let admin: Database;

beforeAll(async () => {
  pg = await startRealPostgres();
  admin = await pg.connect();
  await admin.execute(
    `create role ${PROBE_ROLE} login password '${PROBE_PASSWORD}' in role app_user`,
  );
});
afterAll(async () => {
  await admin.close();
  await pg.stop();
});

const SETTLED = new Date("2026-07-24T10:00:00Z");

describe("on-device accepted_offline lifecycle under real row-level security", () => {
  it("lists and reads its own tenant's offline payment, and only its own", async () => {
    const tenantA = await seedWorkingOrder(admin, "B41111111");
    const tenantB = await seedWorkingOrder(admin, "B42222222");

    const probe = await pg.connectAs(PROBE_ROLE, PROBE_PASSWORD);
    try {
      const key = { tenantId: tenantA.tenantId, provider: "stripe", paymentRef: "dev-off-1" };

      await withTenant(probe, tenantA.tenantId, (tx) =>
        insertAcceptedOffline(tx, {
          tenantId: tenantA.tenantId,
          workingOrderId: tenantA.workingOrderId,
          provider: "stripe",
          paymentRef: "dev-off-1",
          amount: decimal("10.00"),
          settledAt: SETTLED,
          externalRef: "pi_dev_rls",
        }),
      );

      // listAcceptedOffline under tenant A sees the row.
      const listedA = await withTenant(probe, tenantA.tenantId, (tx) =>
        listAcceptedOffline(tx, "stripe"),
      );
      expect(listedA.map((r) => r.paymentRef)).toContain("dev-off-1");

      const seen = await withTenant(probe, tenantA.tenantId, (tx) => getPaymentByRef(tx, key));
      expect(seen?.state).toBe("accepted_offline");
      expect(seen?.externalRef).toBe("pi_dev_rls");

      // Under tenant B the isolation policy hides A's row from both the read and the list.
      const listedB = await withTenant(probe, tenantB.tenantId, (tx) =>
        listAcceptedOffline(tx, "stripe"),
      );
      expect(listedB.map((r) => r.paymentRef)).not.toContain("dev-off-1");
      const hidden = await withTenant(probe, tenantB.tenantId, (tx) => getPaymentByRef(tx, key));
      expect(hidden).toBeUndefined();
    } finally {
      await probe.close();
    }
  });
});
