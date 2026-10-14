import { sql } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";
import { CORE_MIGRATIONS, withTransaction } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { decimal, deviceOrigin, workingOrderId } from "@waitron/shared";
import { freshNif, seedPaymentPolicy, seedWorkingOrder } from "../test/seed.js";
import { PAYMENTS_MIGRATIONS } from "./migrations.js";
import { SimulatorPaymentProvider } from "./simulator.js";
import { FakeAsyncProvider } from "./testing/fake-async-provider.js";
import { FakePaymentProvider } from "./testing/fake-provider.js";

const suite = useVenueDb({ migrations: [CORE_MIGRATIONS, PAYMENTS_MIGRATIONS] });

function barrier() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

async function behindRollback(operation: () => Promise<unknown>) {
  const entered = barrier();
  const release = barrier();
  const requested = barrier();
  const rollback = new Error("unrelated request rolled back");
  const first = withTransaction(suite.db, async (tx) => {
    await tx.execute(
      sql`insert into change_log (id, payload) values ('queue-probe', '{"resource":"queue-probe"}')`,
    );
    entered.resolve();
    await release.promise;
    throw rollback;
  });
  const firstOutcome = first.catch((error: unknown) => error);
  await Promise.race([
    entered.promise,
    first.then(() => {
      throw new Error("holder ended before the barrier");
    }),
  ]);
  const realLock = suite.db.withWriteLock.bind(suite.db);
  const lock = vi
    .spyOn(suite.db, "withWriteLock")
    .mockImplementation(<T>(body: () => Promise<T>) => {
      const pending = realLock(body);
      requested.resolve();
      return pending;
    });
  let finished = false;
  const result = operation().then(
    (value) => {
      finished = true;
      return { value };
    },
    (error: unknown) => {
      finished = true;
      return { error };
    },
  );
  try {
    await Promise.race([requested.promise, result]);
    expect(finished, "the reader write must wait behind the unrelated transaction").toBe(false);
  } finally {
    release.resolve();
    lock.mockRestore();
    expect(await firstOutcome).toBe(rollback);
    await result;
  }
  const outcome = await result;
  if ("error" in outcome) throw outcome.error;
  expect(
    (await suite.db.execute(sql`select * from change_log where id = 'queue-probe'`)).rows,
  ).toEqual([]);
  return outcome.value;
}

describe("simulator writes behind an unrelated rollback", () => {
  it.each([
    { action: "captured", state: "captured", refunded: 0 },
    { action: "declined", state: "failed", refunded: 0 },
    { action: "void", state: "voided", refunded: 0 },
    { action: "refund", state: "refunded", refunded: 1000 },
    { action: "partialRefund", state: "partially_refunded", refunded: 400 },
  ] as const)("retains $action", async ({ action, state, refunded }) => {
    const seed = await seedWorkingOrder(suite.db, freshNif());
    const params = {
      origin: deviceOrigin(seed.deviceId),
      workingOrderId: workingOrderId(seed.workingOrderId),
      amount: decimal("10.00"),
    };
    const provider = new SimulatorPaymentProvider(suite.db);
    const captured =
      action === "captured" || action === "declined" ? undefined : await provider.collect(params);
    await behindRollback(() => {
      if (action === "captured" || action === "declined")
        return provider.collect({ ...params, simulationOutcome: action });
      if (action === "partialRefund")
        return provider.partialRefund(captured!.paymentRef, decimal("4.00"));
      return provider[action](captured!.paymentRef);
    });
    expect(
      (
        await suite.db.execute(
          sql`select state, amount from payments where working_order_id = ${seed.workingOrderId}`,
        )
      ).rows,
    ).toEqual([{ state, amount: 1000 }]);
    expect(
      (
        await suite.db.execute(
          sql`select coalesce(sum(amount), 0) as refunded from payment_refunds`,
        )
      ).rows,
    ).toEqual([{ refunded }]);
  });
});

describe("fake reader writes behind an unrelated rollback", () => {
  it.each([
    { action: "captured", state: "captured", refunded: 0 },
    { action: "failed", state: "failed", refunded: 0 },
    { action: "attempting", state: "attempting", refunded: 0 },
    { action: "crash-captured", state: "captured", refunded: 0 },
    { action: "crash-attempting", state: "attempting", refunded: 0 },
    { action: "offline", state: "accepted_offline", refunded: 0 },
    { action: "void", state: "voided", refunded: 0 },
    { action: "refund", state: "refunded", refunded: 1000 },
    { action: "partialRefund", state: "partially_refunded", refunded: 400 },
    { action: "forward-settled", state: "settled", refunded: 0 },
    { action: "forward-declined", state: "declined", refunded: 0 },
    { action: "resolve-captured", state: "captured", refunded: 0 },
    { action: "resolve-failed", state: "failed", refunded: 0 },
  ] as const)("retains $action", async ({ action, state, refunded }) => {
    const seed = await seedWorkingOrder(suite.db, freshNif());
    const params = {
      origin: deviceOrigin(seed.deviceId),
      workingOrderId: workingOrderId(seed.workingOrderId),
      amount: decimal("10.00"),
      allowOffline: true,
    };
    const provider = new FakePaymentProvider(suite.db);
    let paymentRef: string | undefined;
    if (action === "offline" || action.startsWith("forward-")) {
      await seedPaymentPolicy(suite.db, "accept_offline", "50.00");
      provider.offlineNextCollect();
      if (action !== "offline") paymentRef = (await provider.collect(params)).paymentRef;
    } else if (action.startsWith("resolve-")) {
      provider.stallNextCollect();
      paymentRef = (await provider.collect(params)).paymentRef;
      provider.scriptAbandonedAttempt(
        action === "resolve-captured"
          ? { outcome: "captured" }
          : { outcome: "failed", cancelledAtProvider: true },
      );
    } else if (action === "void" || action === "refund" || action === "partialRefund") {
      paymentRef = (await provider.collect(params)).paymentRef;
    } else if (action === "failed") provider.failNextCollect();
    else if (action === "attempting") provider.stallNextCollect();
    else if (action === "crash-captured") provider.crashNextCollect("captured");
    else if (action === "crash-attempting") provider.crashNextCollect("attempting");
    if (action === "forward-declined") provider.declineForwardFor(paymentRef!);
    const now = new Date("2026-10-14T12:00:00Z");
    const manager = "00000000-0000-4000-8000-000000000001";
    await behindRollback(() => {
      if (action.startsWith("forward-")) return provider.forward(now);
      if (action.startsWith("resolve-"))
        return provider.resolveAbandonedAttempt(paymentRef!, now, { personId: manager });
      if (action === "partialRefund") return provider.partialRefund(paymentRef!, decimal("4.00"));
      if (action === "void" || action === "refund") return provider[action](paymentRef!);
      if (action.startsWith("crash-"))
        return expect(provider.collect(params)).rejects.toThrow(
          `fake provider: the process stopped after writing a ${state} row`,
        );
      return provider.collect(params);
    });
    expect(
      (
        await suite.db.execute(
          sql`select state, amount from payments where working_order_id = ${seed.workingOrderId}`,
        )
      ).rows,
    ).toEqual([{ state, amount: 1000 }]);
    expect(
      (
        await suite.db.execute(
          sql`select coalesce(sum(amount), 0) as refunded from payment_refunds`,
        )
      ).rows,
    ).toEqual([{ refunded }]);
    expect(
      (
        await suite.db.execute(
          sql`select person_id, outcome, cancelled_at_provider from payment_resolutions`,
        )
      ).rows,
    ).toEqual(
      action.startsWith("resolve-")
        ? [
            {
              person_id: manager,
              outcome: action === "resolve-captured" ? "captured" : "failed",
              cancelled_at_provider: action === "resolve-failed" ? 1 : 0,
            },
          ]
        : [],
    );
    expect((await suite.db.execute(sql`select code from incidents`)).rows).toEqual(
      action === "forward-declined" ? [{ code: "payment.offline_forward_declined" }] : [],
    );
  });
});

describe("hosted fake writes behind an unrelated rollback", () => {
  it("retains the initiated payment", async () => {
    const seed = await seedWorkingOrder(suite.db, freshNif());
    const provider = new FakeAsyncProvider(suite.db);
    await behindRollback(() =>
      provider.initiate({
        origin: deviceOrigin(seed.deviceId),
        workingOrderId: workingOrderId(seed.workingOrderId),
        amount: decimal("10.00"),
        paymentRef: "queued-hosted",
      }),
    );
    expect(
      (
        await suite.db.execute(
          sql`select state, amount, payment_ref from payments where working_order_id = ${seed.workingOrderId}`,
        )
      ).rows,
    ).toEqual([{ state: "initiated", amount: 1000, payment_ref: "queued-hosted" }]);
  });
});
