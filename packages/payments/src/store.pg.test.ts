import { describe, expect, it } from "vitest";
import { withTenant } from "@waitron/db";
import { useTemplateDb } from "@waitron/db/testing/lifecycle.js";
import { decimal } from "@waitron/shared";
import {
  associatePaymentWithSale,
  captureAttempting,
  findCapturedPaymentForWorkingOrder,
  findCapturedPaymentForWorkingOrderAnyProvider,
  insertAttempting,
  insertCapturedPayment,
} from "./store.js";
import { freshNif, seedSale, seedWorkingOrder } from "../test/seed.js";

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

describe("payments card columns", () => {
  it("persists and reads back a captured payment's card facts", async () => {
    const tenant = await seedWorkingOrder(postgres.admin, freshNif());
    const probe = await postgres.pg.connectAs(PROBE_ROLE, PROBE_PASSWORD);
    try {
      const row = await withTenant(probe, tenant.tenantId, async (tx) => {
        await insertAttempting(tx, {
          tenantId: tenant.tenantId,
          workingOrderId: tenant.workingOrderId,
          provider: "sumup_cloud",
          paymentRef: "card-ref-1",
          amount: decimal("1.00"),
        });
        return captureAttempting(tx, {
          tenantId: tenant.tenantId,
          provider: "sumup_cloud",
          paymentRef: "card-ref-1",
          settledAt: new Date("2026-09-11T10:53:58Z"),
          externalRef: "txn_1",
          card: { scheme: "VISA", last4: "5838", entryMode: "contactless", authCode: "328600" },
        });
      });
      expect(row.cardScheme).toBe("VISA");
      expect(row.cardLast4).toBe("5838");
      expect(row.cardEntryMode).toBe("contactless");
      expect(row.cardAuthCode).toBe("328600");
    } finally {
      await probe.close();
    }
  });

  it("rejects a card_last4 that is not four characters", async () => {
    const tenant = await seedWorkingOrder(postgres.admin, freshNif());
    const probe = await postgres.pg.connectAs(PROBE_ROLE, PROBE_PASSWORD);
    try {
      await expect(
        withTenant(probe, tenant.tenantId, async (tx) => {
          await insertAttempting(tx, {
            tenantId: tenant.tenantId,
            workingOrderId: tenant.workingOrderId,
            provider: "sumup_cloud",
            paymentRef: "card-ref-2",
            amount: decimal("1.00"),
          });
          await captureAttempting(tx, {
            tenantId: tenant.tenantId,
            provider: "sumup_cloud",
            paymentRef: "card-ref-2",
            settledAt: new Date(),
            externalRef: "txn_2",
            card: { scheme: "VISA", last4: "58380", entryMode: "chip", authCode: null },
          });
        }),
      ).rejects.toThrow(/card_last4|check/i);
    } finally {
      await probe.close();
    }
  });

  it("rejects an out-of-range card_entry_mode", async () => {
    const tenant = await seedWorkingOrder(postgres.admin, freshNif());
    const probe = await postgres.pg.connectAs(PROBE_ROLE, PROBE_PASSWORD);
    try {
      await expect(
        withTenant(probe, tenant.tenantId, async (tx) => {
          await insertAttempting(tx, {
            tenantId: tenant.tenantId,
            workingOrderId: tenant.workingOrderId,
            provider: "sumup_cloud",
            paymentRef: "card-ref-3",
            amount: decimal("1.00"),
          });
          await captureAttempting(tx, {
            tenantId: tenant.tenantId,
            provider: "sumup_cloud",
            paymentRef: "card-ref-3",
            settledAt: new Date(),
            externalRef: "txn_3",
            card: { scheme: "VISA", last4: "5838", entryMode: "tap" as never, authCode: null },
          });
        }),
      ).rejects.toThrow(/card_entry_mode|check/i);
    } finally {
      await probe.close();
    }
  });
});

describe("findCapturedPaymentForWorkingOrderAnyProvider", () => {
  it("returns the captured row with provider and card columns, regardless of provider", async () => {
    const tenant = await seedWorkingOrder(postgres.admin, freshNif());
    const probe = await postgres.pg.connectAs(PROBE_ROLE, PROBE_PASSWORD);
    try {
      await withTenant(probe, tenant.tenantId, async (tx) => {
        await insertAttempting(tx, {
          tenantId: tenant.tenantId,
          workingOrderId: tenant.workingOrderId,
          provider: "sumup_cloud",
          paymentRef: "any-ref-1",
          amount: decimal("1.00"),
        });
        await captureAttempting(tx, {
          tenantId: tenant.tenantId,
          provider: "sumup_cloud",
          paymentRef: "any-ref-1",
          settledAt: SETTLED,
          externalRef: "txn_any_1",
          card: { scheme: "MASTERCARD", last4: "4242", entryMode: "chip", authCode: null },
        });
      });

      const row = await withTenant(probe, tenant.tenantId, (tx) =>
        findCapturedPaymentForWorkingOrderAnyProvider(tx, {
          tenantId: tenant.tenantId,
          workingOrderId: tenant.workingOrderId,
        }),
      );
      expect(row?.provider).toBe("sumup_cloud");
      expect(row?.state).toBe("captured");
      expect(row?.cardScheme).toBe("MASTERCARD");
      expect(row?.cardLast4).toBe("4242");
      expect(row?.cardEntryMode).toBe("chip");
      expect(row?.cardAuthCode).toBeNull();
    } finally {
      await probe.close();
    }
  });

  it("returns null for a working order with no payment row (a cash sale)", async () => {
    const tenant = await seedWorkingOrder(postgres.admin, freshNif());
    const probe = await postgres.pg.connectAs(PROBE_ROLE, PROBE_PASSWORD);
    try {
      const row = await withTenant(probe, tenant.tenantId, (tx) =>
        findCapturedPaymentForWorkingOrderAnyProvider(tx, {
          tenantId: tenant.tenantId,
          workingOrderId: tenant.workingOrderId,
        }),
      );
      expect(row).toBeNull();
    } finally {
      await probe.close();
    }
  });
});
