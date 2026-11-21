import { describe, expect, it } from "vitest";
import { CORE_MIGRATIONS, withTransaction } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { eq } from "drizzle-orm";
import { decimal, deviceOrigin } from "@waitron/shared";
import { payments } from "./schema/payments.js";
import { PAYMENTS_MIGRATIONS } from "./migrations.js";
import {
  associatePaymentWithSale,
  captureAttempting,
  findCapturedPaymentForWorkingOrder,
  findCapturedPaymentForWorkingOrderAnyProvider,
  insertAttempting,
  insertCapturedPayment,
  insertFailedPayment,
  listCapturesMissingCard,
  fillCapturedCard,
} from "./store.js";
import { freshNif, seedHeldReader, seedSale, seedWorkingOrder } from "../test/seed.js";

const suite = useVenueDb({ migrations: [CORE_MIGRATIONS, PAYMENTS_MIGRATIONS] });

const SETTLED = new Date("2026-07-22T10:00:00Z");

describe("findCapturedPaymentForWorkingOrder", () => {
  it("returns saleId once associated — the replay branch, not just the resume (saleId null) one", async () => {
    const taxpayer = await seedWorkingOrder(suite.db, "B77777777");
    const saleId = await seedSale(suite.db, taxpayer);

    const orderKey = {
      provider: "stripe",
      workingOrderId: taxpayer.workingOrderId,
    };
    const paymentKey = { provider: "stripe", paymentRef: "replay-1" };

    await withTransaction(suite.db, (tx) =>
      insertCapturedPayment(tx, {
        origin: deviceOrigin(taxpayer.deviceId),
        workingOrderId: taxpayer.workingOrderId,
        nodeId: taxpayer.nodeId,
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
    const taxpayer = await seedWorkingOrder(suite.db, freshNif());
    const row = await withTransaction(suite.db, async (tx) => {
      await insertAttempting(tx, {
        origin: deviceOrigin(taxpayer.deviceId),
        workingOrderId: taxpayer.workingOrderId,
        nodeId: taxpayer.nodeId,
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
    const taxpayer = await seedWorkingOrder(suite.db, freshNif());
    await expect(
      withTransaction(suite.db, async (tx) => {
        await insertAttempting(tx, {
          origin: deviceOrigin(taxpayer.deviceId),
          workingOrderId: taxpayer.workingOrderId,
          nodeId: taxpayer.nodeId,
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
    const taxpayer = await seedWorkingOrder(suite.db, freshNif());
    await expect(
      withTransaction(suite.db, async (tx) => {
        await insertAttempting(tx, {
          origin: deviceOrigin(taxpayer.deviceId),
          workingOrderId: taxpayer.workingOrderId,
          nodeId: taxpayer.nodeId,
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
    const taxpayer = await seedWorkingOrder(suite.db, freshNif());
    await withTransaction(suite.db, async (tx) => {
      await insertAttempting(tx, {
        origin: deviceOrigin(taxpayer.deviceId),
        workingOrderId: taxpayer.workingOrderId,
        nodeId: taxpayer.nodeId,
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
        workingOrderId: taxpayer.workingOrderId,
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
    const taxpayer = await seedWorkingOrder(suite.db, freshNif());
    const row = await withTransaction(suite.db, (tx) =>
      findCapturedPaymentForWorkingOrderAnyProvider(tx, {
        workingOrderId: taxpayer.workingOrderId,
      }),
    );
    expect(row).toBeNull();
  });
});

describe("the provider's start of the checkout", () => {
  async function captured(paymentRef: string, checkoutStartedAt?: Date) {
    const taxpayer = await seedWorkingOrder(suite.db, freshNif());
    await withTransaction(suite.db, async (tx) => {
      await insertAttempting(tx, {
        origin: deviceOrigin(taxpayer.deviceId),
        workingOrderId: taxpayer.workingOrderId,
        nodeId: taxpayer.nodeId,
        provider: "sumup",
        paymentRef,
        amount: decimal("1.00"),
      });
      await captureAttempting(tx, {
        provider: "sumup",
        paymentRef,
        settledAt: SETTLED,
        externalRef: `txn-${paymentRef}`,
        ...(checkoutStartedAt === undefined ? {} : { checkoutStartedAt }),
      });
    });
    const [row] = await suite.db
      .select({
        checkoutStartedAt: payments.providerCheckoutStartedAt,
        settledAt: payments.settledAt,
      })
      .from(payments)
      .where(eq(payments.paymentRef, paymentRef));
    return row!;
  }

  it("stores the time a capture names, beside the box's settled time", async () => {
    expect(await captured("started-1", new Date("2026-03-31T21:58:01Z"))).toEqual({
      checkoutStartedAt: "2026-03-31T21:58:01.000Z",
      settledAt: SETTLED.toISOString(),
    });
  });

  it("leaves it empty when the capture names none", async () => {
    expect((await captured("started-2")).checkoutStartedAt).toBeNull();
  });
});

describe("late card details", () => {
  it("finds only recent captured reader payments with an empty block that this box owns", async () => {
    const own = await seedWorkingOrder(suite.db);
    const previous = await seedWorkingOrder(suite.db);
    const other = await seedWorkingOrder(suite.db);
    const readerId = await seedHeldReader(suite.db, own.deviceId);
    const base = {
      origin: deviceOrigin(own.deviceId),
      workingOrderId: own.workingOrderId,
      provider: "sumup",
      readerId,
      amount: decimal("10.00"),
      settledAt: SETTLED,
    };
    await withTransaction(suite.db, async (tx) => {
      for (const [paymentRef, change] of [
        ["own", {}],
        ["taken-over", { nodeId: previous.nodeId }],
        ["other-box", { nodeId: other.nodeId }],
        ["other-provider", { provider: "stripe" }],
        ["old", { settledAt: new Date("2026-07-22T09:57:59Z") }],
        ["without-reader", { readerId: undefined }],
        ["without-ref", { externalRef: undefined }],
        ["with-card", {}],
      ] as const) {
        await insertCapturedPayment(tx, {
          ...base,
          nodeId: own.nodeId,
          paymentRef,
          externalRef: `txn-${paymentRef}`,
          ...change,
        });
      }
      await tx
        .update(payments)
        .set({ cardLast4: "1234" })
        .where(eq(payments.paymentRef, "with-card"));
      await insertFailedPayment(tx, { ...base, nodeId: own.nodeId, paymentRef: "failed" });
    });

    const candidates = await listCapturesMissingCard(
      suite.db,
      "sumup",
      {
        nodeId: own.nodeId,
        takenOverFrom: [previous.nodeId],
        unowned: false,
      },
      new Date("2026-07-22T09:58:00Z"),
    );
    expect(candidates.map((p) => p.paymentRef).sort()).toEqual(["own", "taken-over"]);
    expect(candidates.find((p) => p.paymentRef === "own")).toMatchObject({
      externalRef: "txn-own",
      amount: "10.00",
      settledAt: "2026-07-22T10:00:00.000Z",
    });
  });

  it("fills a captured payment once without changing its financial facts or links", async () => {
    const own = await seedWorkingOrder(suite.db);
    const readerId = await seedHeldReader(suite.db, own.deviceId);
    const saleId = await seedSale(suite.db, own);
    const key = { provider: "sumup", paymentRef: "captured", externalRef: "txn-captured" };
    await withTransaction(suite.db, async (tx) => {
      await insertCapturedPayment(tx, {
        ...key,
        origin: deviceOrigin(own.deviceId),
        workingOrderId: own.workingOrderId,
        nodeId: own.nodeId,
        amount: decimal("10.00"),
        readerId,
        settledAt: SETTLED,
      });
      await associatePaymentWithSale(tx, { ...key, saleId });
    });
    const [before] = await suite.db.select().from(payments);
    const card = { scheme: "VISA", last4: "1234", entryMode: "chip", authCode: "A123" } as const;
    const fill = (externalRef: string, last4: string) =>
      withTransaction(suite.db, (tx) =>
        fillCapturedCard(tx, { ...key, externalRef }, { ...card, last4 }),
      );
    expect(await fill("other-txn", "9999")).toBe(false);
    expect(await fill(key.externalRef, "1234")).toBe(true);
    expect(await fill(key.externalRef, "9999")).toBe(false);
    const [after] = await suite.db.select().from(payments);
    expect(after).toEqual({
      ...before,
      cardScheme: "VISA",
      cardLast4: "1234",
      cardEntryMode: "chip",
      cardAuthCode: "A123",
    });
  });
});
