import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";
import { CORE_MIGRATIONS, withTransaction } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { decimal, deviceOrigin, workingOrderId } from "@waitron/shared";
import { PAYMENTS_MIGRATIONS, insertAttempting, payments } from "@waitron/payments";
import { seedWorkingOrder } from "@waitron/payments/test/seed.js";
import { StripeTerminalProvider } from "./provider.js";
import { FakeStripe } from "./testing/fake-stripe.js";

const suite = useVenueDb({ migrations: [CORE_MIGRATIONS, PAYMENTS_MIGRATIONS] });
const now = new Date("2026-10-17T00:00:00Z");
const manager = { personId: "22222222-2222-4222-8222-222222222222" };

function barrier() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function provider(client: FakeStripe) {
  return new StripeTerminalProvider({
    db: suite.db,
    client,
    poll: { maxAttempts: 1, intervalMs: 0, sleep: () => Promise.resolve() },
  });
}

async function params() {
  const seeded = await seedWorkingOrder(suite.db);
  return {
    origin: deviceOrigin(seeded.deviceId),
    workingOrderId: workingOrderId(seeded.workingOrderId),
    amount: decimal("12.10"),
    readerRef: "reader_activity",
  };
}

async function stored(order: string) {
  const [row] = await suite.db.select().from(payments).where(eq(payments.workingOrderId, order));
  return row!;
}

async function audits(ref: string) {
  const { rows } = await suite.db.execute(sql`
    select r.person_id, r.outcome from payment_resolutions r
    join payments p on p.id = r.payment_id where p.payment_ref = ${ref}`);
  return rows;
}

describe("Stripe resolution ownership", () => {
  it.each(["before stamp", "after stamp"] as const)(
    "leaves a live collection alone %s across instances",
    async (phase) => {
      const client = new FakeStripe();
      const entered = barrier();
      const release = barrier();
      const p = await params();
      const cancel = vi.spyOn(client, "cancelPaymentIntent");
      if (phase === "before stamp") {
        const create = client.createPaymentIntent.bind(client);
        vi.spyOn(client, "createPaymentIntent").mockImplementation(async (input) => {
          const result = await create(input);
          entered.resolve();
          await release.promise;
          return result;
        });
      } else {
        const process = client.processPaymentIntent.bind(client);
        vi.spyOn(client, "processPaymentIntent").mockImplementation(async (reader, intent) => {
          entered.resolve();
          await release.promise;
          return process(reader, intent);
        });
      }
      const collecting = provider(client)
        .collect(p)
        .catch(() => undefined);
      try {
        await entered.promise;
        const before = await stored(p.workingOrderId);
        expect(before.state).toBe("attempting");
        expect(
          phase === "before stamp" ? before.externalRef === null : /^pi_/.test(before.externalRef!),
        ).toBe(true);
        expect(
          await provider(client).resolveAbandonedAttempt(before.paymentRef, now, manager),
        ).toEqual({ outcome: "unknown", reason: "ambiguous" });
        expect((await stored(p.workingOrderId)).state).toBe("attempting");
        expect((await stored(p.workingOrderId)).externalRef).toBe(before.externalRef);
        expect(cancel).not.toHaveBeenCalled();
        expect(await audits(before.paymentRef)).toEqual([]);
      } finally {
        release.resolve();
        await collecting;
      }
      expect((await collecting)?.state).toBe("captured");
    },
  );

  it.each([null, "pi_inactive"])(
    "still resolves an inactive row with reference %s",
    async (externalRef) => {
      const client = new FakeStripe();
      const p = await params();
      const paymentRef = randomUUID();
      if (externalRef !== null)
        client.setIntent(externalRef, { status: "requires_payment_method", amount: 1210 });
      await withTransaction(suite.db, (tx) =>
        insertAttempting(tx, {
          ...p,
          provider: "stripe",
          paymentRef,
          ...(externalRef === null ? {} : { externalRef }),
        }),
      );
      expect(await provider(client).resolveAbandonedAttempt(paymentRef, now, manager)).toEqual({
        outcome: "failed",
        cancelledAtProvider: externalRef !== null,
      });
      expect((await stored(p.workingOrderId)).state).toBe("failed");
      expect(client.cancelledIntents).toEqual(externalRef === null ? [] : [externalRef]);
      expect(await audits(paymentRef)).toEqual([
        { person_id: manager.personId, outcome: "failed" },
      ]);
    },
  );

  it("keeps overlapping resolvers from driving the same PaymentIntent", async () => {
    const client = new FakeStripe();
    const p = await params();
    const paymentRef = randomUUID();
    client.setIntent("pi_owned", { status: "requires_payment_method", amount: 1210 });
    await withTransaction(suite.db, (tx) =>
      insertAttempting(tx, { ...p, provider: "stripe", paymentRef, externalRef: "pi_owned" }),
    );
    const entered = barrier();
    const release = barrier();
    const retrieve = client.retrievePaymentIntent.bind(client);
    let reads = 0;
    const read = vi.spyOn(client, "retrievePaymentIntent").mockImplementation(async (id) => {
      if (++reads === 1) {
        entered.resolve();
        await release.promise;
      }
      return retrieve(id);
    });
    const first = provider(client)
      .resolveAbandonedAttempt(paymentRef, now, manager)
      .catch(() => undefined);
    try {
      await entered.promise;
      expect(await provider(client).resolveAbandonedAttempt(paymentRef, now, manager)).toEqual({
        outcome: "unknown",
        reason: "ambiguous",
      });
      expect(read).toHaveBeenCalledTimes(1);
    } finally {
      release.resolve();
      await first;
    }
    expect(await first).toEqual({ outcome: "failed", cancelledAtProvider: true });
    expect(client.cancelledIntents).toEqual(["pi_owned"]);
    expect(await audits(paymentRef)).toEqual([{ person_id: manager.personId, outcome: "failed" }]);
  });
});
