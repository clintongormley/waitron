import { describe, expect, it } from "vitest";
import { CORE_MIGRATIONS, withTransaction } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { decimal } from "@waitron/shared";
import { PAYMENTS_MIGRATIONS } from "./migrations.js";
import {
  associatePaymentWithSale,
  captureAttempting,
  findCapturedPaymentForWorkingOrder,
  findCapturedPaymentForWorkingOrderAnyProvider,
  insertAttempting,
  insertCapturedPayment,
} from "./store.js";
import { freshNif, seedSale, seedWorkingOrder } from "../test/seed.js";

const suite = useVenueDb({ migrations: [CORE_MIGRATIONS, PAYMENTS_MIGRATIONS] });

const SETTLED = new Date("2026-07-22T10:00:00Z");

describe("findCapturedPaymentForWorkingOrder", () => {
  it("returns saleId once associated — the replay branch, not just the resume (saleId null) one", async () => {
    const tenant = await seedWorkingOrder(suite.db, "B77777777");
    const saleId = await seedSale(suite.db, tenant);

    const orderKey = {
      provider: "stripe",
      workingOrderId: tenant.workingOrderId,
    };
    const paymentKey = { provider: "stripe", paymentRef: "replay-1" };

    await withTransaction(suite.db, (tx) =>
      insertCapturedPayment(tx, {
        workingOrderId: tenant.workingOrderId,
        provider: "stripe",
        paymentRef: "replay-1",
        amount: decimal("10.00"),
        settledAt: SETTLED,
      }),
    );

    // Before association: the RESUME branch — captured but P3 never ran, saleId null.
    const beforeAssoc = await withTransaction(suite.db, (tx) =>
      findCapturedPaymentForWorkingOrder(tx, orderKey),
    );
    expect(beforeAssoc?.saleId).toBeNull();

    await withTransaction(suite.db, (tx) =>
      associatePaymentWithSale(tx, { ...paymentKey, saleId }),
    );

    // After association: the REPLAY branch — the sale is already filed, saleId populated.
    const afterAssoc = await withTransaction(suite.db, (tx) =>
      findCapturedPaymentForWorkingOrder(tx, orderKey),
    );
    expect(afterAssoc?.saleId).toBe(saleId);
    expect(afterAssoc?.paymentRef).toBe("replay-1");
    expect(afterAssoc?.state).toBe("captured");
  });
});

describe("payments card columns", () => {
  it("persists and reads back a captured payment's card facts", async () => {
    const tenant = await seedWorkingOrder(suite.db, freshNif());
    const row = await withTransaction(suite.db, async (tx) => {
      await insertAttempting(tx, {
        workingOrderId: tenant.workingOrderId,
        provider: "sumup_cloud",
        paymentRef: "card-ref-1",
        amount: decimal("1.00"),
      });
      return captureAttempting(tx, {
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
  });

  it("rejects a card_last4 that is not four characters", async () => {
    const tenant = await seedWorkingOrder(suite.db, freshNif());
    await expect(
      withTransaction(suite.db, async (tx) => {
        await insertAttempting(tx, {
          workingOrderId: tenant.workingOrderId,
          provider: "sumup_cloud",
          paymentRef: "card-ref-2",
          amount: decimal("1.00"),
        });
        await captureAttempting(tx, {
          provider: "sumup_cloud",
          paymentRef: "card-ref-2",
          settledAt: new Date(),
          externalRef: "txn_2",
          card: { scheme: "VISA", last4: "58380", entryMode: "chip", authCode: null },
        });
      }),
    ).rejects.toThrow(/card_last4|check/i);
  });

  it("rejects an out-of-range card_entry_mode", async () => {
    const tenant = await seedWorkingOrder(suite.db, freshNif());
    await expect(
      withTransaction(suite.db, async (tx) => {
        await insertAttempting(tx, {
          workingOrderId: tenant.workingOrderId,
          provider: "sumup_cloud",
          paymentRef: "card-ref-3",
          amount: decimal("1.00"),
        });
        await captureAttempting(tx, {
          provider: "sumup_cloud",
          paymentRef: "card-ref-3",
          settledAt: new Date(),
          externalRef: "txn_3",
          card: { scheme: "VISA", last4: "5838", entryMode: "tap" as never, authCode: null },
        });
      }),
    ).rejects.toThrow(/card_entry_mode|check/i);
  });
});

describe("findCapturedPaymentForWorkingOrderAnyProvider", () => {
  it("returns the captured row with provider and card columns, regardless of provider", async () => {
    const tenant = await seedWorkingOrder(suite.db, freshNif());
    await withTransaction(suite.db, async (tx) => {
      await insertAttempting(tx, {
        workingOrderId: tenant.workingOrderId,
        provider: "sumup_cloud",
        paymentRef: "any-ref-1",
        amount: decimal("1.00"),
      });
      await captureAttempting(tx, {
        provider: "sumup_cloud",
        paymentRef: "any-ref-1",
        settledAt: SETTLED,
        externalRef: "txn_any_1",
        card: { scheme: "MASTERCARD", last4: "4242", entryMode: "chip", authCode: null },
      });
    });

    const row = await withTransaction(suite.db, (tx) =>
      findCapturedPaymentForWorkingOrderAnyProvider(tx, {
        workingOrderId: tenant.workingOrderId,
      }),
    );
    expect(row?.provider).toBe("sumup_cloud");
    expect(row?.state).toBe("captured");
    expect(row?.cardScheme).toBe("MASTERCARD");
    expect(row?.cardLast4).toBe("4242");
    expect(row?.cardEntryMode).toBe("chip");
    expect(row?.cardAuthCode).toBeNull();
  });

  it("returns null for a working order with no payment row (a cash sale)", async () => {
    const tenant = await seedWorkingOrder(suite.db, freshNif());
    const row = await withTransaction(suite.db, (tx) =>
      findCapturedPaymentForWorkingOrderAnyProvider(tx, {
        workingOrderId: tenant.workingOrderId,
      }),
    );
    expect(row).toBeNull();
  });
});
