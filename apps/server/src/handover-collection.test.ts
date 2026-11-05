import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";
import { withTransaction } from "@waitron/db";
import { seedNode } from "@waitron/db/testing/seed.js";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { insertHandoverActivationTx } from "@waitron/handover";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import {
  captureAttempting,
  insertAttempting,
  listAttempting,
  payments,
  type CollectionOwners,
  type ForwardResult,
  type PaymentProvider,
} from "@waitron/payments";
import { freshNif, seedWorkingOrder, type Seeded } from "@waitron/payments/test/seed.js";
import { decimal, deviceOrigin, type NodeId } from "@waitron/shared";
import { sweepOwners, withPendingSweep } from "./boot.js";
import { readTakenOverFrom } from "./handover-collection.js";

const suite = useVenueDb({ migrations: migrationOptionsFor(manifestSets(), null) });

const PROVIDER = "fake";

/** Resolves what the real store lists for the owners it is given, and counts every payment it asks
 * the processor about. */
class CountingProvider {
  readonly provider = PROVIDER;
  readonly calls = new Map<string, number>();

  async resolvePending(now: Date, owners: CollectionOwners): Promise<ForwardResult> {
    const rows = await withTransaction(suite.db, (tx) => listAttempting(tx, PROVIDER, owners));
    for (const { paymentRef } of rows) {
      this.calls.set(paymentRef, (this.calls.get(paymentRef) ?? 0) + 1);
      await withTransaction(suite.db, (tx) =>
        captureAttempting(tx, {
          provider: PROVIDER,
          paymentRef,
          settledAt: now,
          externalRef: `ext-${paymentRef}`,
        }),
      );
    }
    return { nextDueAt: null, forwarded: rows.length, declined: 0, incidentsRaised: 0 };
  }

  callCounts(): Record<string, number> {
    return Object.fromEntries(this.calls);
  }
}

async function seedSeller(): Promise<Seeded> {
  return seedWorkingOrder(suite.db, freshNif());
}

async function openPayment(seller: Seeded, paymentRef: string, owner: NodeId): Promise<void> {
  await withTransaction(suite.db, (tx) =>
    insertAttempting(tx, {
      origin: deviceOrigin(seller.deviceId),
      workingOrderId: seller.workingOrderId,
      nodeId: owner,
      provider: PROVIDER,
      paymentRef,
      amount: decimal("10.00"),
    }),
  );
}

async function activation(
  source: NodeId,
  destination: NodeId,
  scenario: "controlled" | "emergency" = "controlled",
): Promise<void> {
  await withTransaction(suite.db, (tx) =>
    insertHandoverActivationTx(tx, {
      operationId: randomUUID(),
      scenario,
      sourceNodeId: source,
      destinationNodeId: destination,
      evidence: {} as never,
      personId: randomUUID(),
      activatedAt: new Date().toISOString(),
    }),
  );
}

async function sweepTwice(box: NodeId, provider: CountingProvider): Promise<void> {
  const takenOverFrom = await readTakenOverFrom(suite.db, box);
  const log = vi.fn();
  const pass = withPendingSweep(
    async () => ({ duties: [], nextDueAt: null }),
    async () => [provider as unknown as PaymentProvider],
    () => sweepOwners(box, "primary", takenOverFrom),
    log,
  );
  await pass(new Date());
  await pass(new Date());
  expect(log.mock.calls.filter(([level]) => level === "warn")).toEqual([]);
}

async function stateOf(paymentRef: string): Promise<string | undefined> {
  const [row] = await suite.db
    .select({ state: payments.state })
    .from(payments)
    .where(eq(payments.paymentRef, paymentRef));
  return row?.state;
}

describe("the new main box's card sweep", () => {
  it("after activation, resolves the old box's attempting payment once", async () => {
    const seller = await seedSeller();
    const [oldBox, newBox] = [await seedNode(suite.db), await seedNode(suite.db)];
    await openPayment(seller, "old-box", oldBox);
    await activation(oldBox, newBox);

    const provider = new CountingProvider();
    await sweepTwice(newBox, provider);

    expect(provider.callCounts()).toEqual({ "old-box": 1 });
    expect(await stateOf("old-box")).toBe("captured");
  });

  it("before activation, leaves the old box's attempting payment alone", async () => {
    const seller = await seedSeller();
    const [oldBox, newBox] = [await seedNode(suite.db), await seedNode(suite.db)];
    await openPayment(seller, "old-box", oldBox);

    const provider = new CountingProvider();
    await sweepTwice(newBox, provider);

    expect(provider.callCounts()).toEqual({});
    expect(await stateOf("old-box")).toBe("attempting");
  });

  it("a box that took over from nobody sweeps only its own", async () => {
    const seller = await seedSeller();
    const [other, box] = [await seedNode(suite.db), await seedNode(suite.db)];
    await openPayment(seller, "other-box", other);
    await openPayment(seller, "own", box);

    const provider = new CountingProvider();
    await sweepTwice(box, provider);

    expect(provider.callCounts()).toEqual({ own: 1 });
    expect(await stateOf("other-box")).toBe("attempting");
  });

  it("a box that took over from a box which took over from another resolves all three's, once each", async () => {
    const seller = await seedSeller();
    const [first, second, third, bystander] = [
      await seedNode(suite.db),
      await seedNode(suite.db),
      await seedNode(suite.db),
      await seedNode(suite.db),
    ];
    await openPayment(seller, "first-box", first);
    await openPayment(seller, "second-box", second);
    await openPayment(seller, "third-box", third);
    await openPayment(seller, "bystander", bystander);
    await activation(first, second, "emergency");
    await activation(second, third);

    const provider = new CountingProvider();
    await sweepTwice(third, provider);

    expect(provider.callCounts()).toEqual({
      "first-box": 1,
      "second-box": 1,
      "third-box": 1,
    });
    expect(await stateOf("bystander")).toBe("attempting");
  });
});

describe("readTakenOverFrom", () => {
  it("names only the boxes behind this one: not the box it handed to, nor a bystander", async () => {
    await seedSeller();
    const [first, second, third, bystander] = [
      await seedNode(suite.db),
      await seedNode(suite.db),
      await seedNode(suite.db),
      await seedNode(suite.db),
    ];
    await activation(first, second);
    await activation(second, third);

    expect(await readTakenOverFrom(suite.db, first)).toEqual([]);
    expect(await readTakenOverFrom(suite.db, second)).toEqual([first]);
    expect(await readTakenOverFrom(suite.db, bystander)).toEqual([]);
  });

  it("a box that handed over and took back never names itself, and the walk ends", async () => {
    await seedSeller();
    const [first, second] = [await seedNode(suite.db), await seedNode(suite.db)];
    await activation(first, second);
    await activation(second, first);

    expect(await readTakenOverFrom(suite.db, first)).toEqual([second]);
    expect(await readTakenOverFrom(suite.db, second)).toEqual([first]);
  });

  it("a box reached twice is named once", async () => {
    await seedSeller();
    const [first, second, third] = [
      await seedNode(suite.db),
      await seedNode(suite.db),
      await seedNode(suite.db),
    ];
    await activation(first, second);
    await activation(second, first);
    await activation(first, third);
    await activation(second, third);

    const named = await readTakenOverFrom(suite.db, third);
    expect([...named].sort()).toEqual([first, second].sort());
  });
});
