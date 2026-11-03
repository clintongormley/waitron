import { sql } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { CORE_MIGRATIONS, withTransaction } from "@waitron/db";
import { seedNode } from "@waitron/db/testing/seed.js";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { decimal, deviceOrigin } from "@waitron/shared";
import type { NodeId } from "@waitron/shared";
import { PAYMENTS_MIGRATIONS } from "./migrations.js";
import type { CollectionOwners, ForwardResult } from "./provider.js";
import { insertAttempting, listAttempting } from "./store.js";
import { freshNif, seedWorkingOrder } from "../test/seed.js";
import type { Seeded } from "../test/seed.js";

const suite = useVenueDb({ migrations: [CORE_MIGRATIONS, PAYMENTS_MIGRATIONS] });

beforeEach(async () => {
  await suite.db.execute(sql`delete from payments`);
});

/** Reads the sweep's rows the way the Stripe and SumUp adapters do, and records every payment it
 * is asked about instead of polling a processor. */
class RecordingSweepProvider {
  readonly asked: string[] = [];

  async resolvePending(_now: Date, owners: CollectionOwners): Promise<ForwardResult> {
    const rows = await withTransaction(suite.db, (tx) => listAttempting(tx, "fake", owners));
    this.asked.push(...rows.map((row) => row.paymentRef));
    return { nextDueAt: null, forwarded: 0, declined: 0, incidentsRaised: 0 };
  }
}

interface Boxes {
  seeded: Seeded;
  boxA: NodeId;
  boxB: NodeId;
}

async function seedBoxes(): Promise<Boxes> {
  const seeded = await seedWorkingOrder(suite.db, freshNif());
  return { seeded, boxA: seeded.nodeId, boxB: await seedNode(suite.db) };
}

async function attempting(seeded: Seeded, paymentRef: string, owner: NodeId | null): Promise<void> {
  await withTransaction(suite.db, (tx) =>
    insertAttempting(tx, {
      origin: deviceOrigin(seeded.deviceId),
      workingOrderId: seeded.workingOrderId,
      nodeId: owner ?? seeded.nodeId,
      provider: "fake",
      paymentRef,
      amount: decimal("10.00"),
    }),
  );
  if (owner === null) {
    await suite.db.execute(
      sql`update payments set node_id = null where payment_ref = ${paymentRef}`,
    );
  }
}

function ownersFor(nodeId: NodeId, overrides: Partial<CollectionOwners> = {}): CollectionOwners {
  return { nodeId, takenOverFrom: [], unowned: false, ...overrides };
}

describe("a box's card sweep acts only on payments it owns", () => {
  it("a sweep on box B leaves box A's attempting payment alone", async () => {
    const { seeded, boxA, boxB } = await seedBoxes();
    await attempting(seeded, "owned-by-a", boxA);

    const provider = new RecordingSweepProvider();
    await provider.resolvePending(new Date(), ownersFor(boxB, { unowned: true }));

    expect(provider.asked).toEqual([]);
  });

  it("it sweeps its own", async () => {
    const { seeded, boxA, boxB } = await seedBoxes();
    await attempting(seeded, "owned-by-a", boxA);
    await attempting(seeded, "owned-by-b", boxB);

    const provider = new RecordingSweepProvider();
    await provider.resolvePending(new Date(), ownersFor(boxB));

    expect(provider.asked).toEqual(["owned-by-b"]);
  });

  it("a null owner is swept by the primary only", async () => {
    const { seeded, boxB } = await seedBoxes();
    await attempting(seeded, "owned-by-nobody", null);

    const secondary = new RecordingSweepProvider();
    await secondary.resolvePending(new Date(), ownersFor(boxB, { unowned: false }));
    expect(secondary.asked).toEqual([]);

    const primary = new RecordingSweepProvider();
    await primary.resolvePending(new Date(), ownersFor(boxB, { unowned: true }));
    expect(primary.asked).toEqual(["owned-by-nobody"]);
  });

  it("a payment owned by a box this box has taken over from is swept", async () => {
    const { seeded, boxA, boxB } = await seedBoxes();
    await attempting(seeded, "owned-by-a", boxA);

    const provider = new RecordingSweepProvider();
    await provider.resolvePending(new Date(), ownersFor(boxB, { takenOverFrom: [boxA] }));

    expect(provider.asked).toEqual(["owned-by-a"]);
  });
});
