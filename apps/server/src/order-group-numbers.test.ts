import { asc, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { orderGroups, parties, withTransaction } from "@waitron/db";
import type { Transaction } from "@waitron/db";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import {
  listOrderGroups,
  moveGroupsToParty,
  readCurrentOrders,
  reorderHeldGroups,
  startGroup,
} from "./order-groups.js";

const OPERATOR = "cccccccc-0000-4000-8000-00000000000a";
const suite = useVenueDb({ migrations: migrationOptionsFor(manifestSets(), null) });
const inTx = <T>(fn: (tx: Transaction) => Promise<T>): Promise<T> => withTransaction(suite.db, fn);

async function party(): Promise<string> {
  const [row] = await inTx((tx) =>
    tx.insert(parties).values({ openedBy: OPERATOR }).returning({ id: parties.id }),
  );
  return row!.id;
}

async function groups(partyId: string) {
  return inTx((tx) =>
    tx
      .select()
      .from(orderGroups)
      .where(eq(orderGroups.partyId, partyId))
      .orderBy(asc(orderGroups.position)),
  );
}

describe("a group's permanent number", () => {
  it("counts fired and removed batches and keeps its number when held groups reorder", async () => {
    const partyId = await party();
    const [fire, mains, dessert] = await inTx(async (tx) => [
      await startGroup(tx, partyId, "fire", OPERATOR),
      await startGroup(tx, partyId, "hold", OPERATOR),
      await startGroup(tx, partyId, "hold", OPERATOR),
    ]);
    await inTx((tx) =>
      reorderHeldGroups(tx, partyId, [dessert!, mains!], {
        submissionId: "reverse-held",
        expectedPartyRevision: 0,
        operatorId: OPERATOR,
      }),
    );
    expect(await groups(partyId)).toMatchObject([
      { id: fire, position: 1, displayNumber: 1, numberPartyId: partyId },
      { id: dessert, position: 2, displayNumber: 3, numberPartyId: partyId },
      { id: mains, position: 3, displayNumber: 2, numberPartyId: partyId },
    ]);
    await inTx((tx) =>
      tx.update(orderGroups).set({ state: "removed" }).where(eq(orderGroups.id, dessert!)),
    );
    const next = await inTx((tx) => startGroup(tx, partyId, "hold", OPERATOR));
    expect((await groups(partyId)).find((row) => row.id === next)).toMatchObject({
      position: 4,
      displayNumber: 4,
      numberPartyId: partyId,
    });
  });

  it("preserves duplicate numbers and origins on a join and allocates above both sets", async () => {
    const from = await party();
    const into = await party();
    const [source1, source2, target1] = await inTx(async (tx) => [
      await startGroup(tx, from, "hold", OPERATOR),
      await startGroup(tx, from, "hold", OPERATOR),
      await startGroup(tx, into, "hold", OPERATOR),
    ]);
    await inTx((tx) => moveGroupsToParty(tx, from, into));
    expect(await groups(into)).toMatchObject([
      { id: target1, position: 1, displayNumber: 1, numberPartyId: into },
      { id: source1, position: 2, displayNumber: 1, numberPartyId: from },
      { id: source2, position: 3, displayNumber: 2, numberPartyId: from },
    ]);
    const next = await inTx((tx) => startGroup(tx, into, "fire", OPERATOR));
    expect((await groups(into)).find((row) => row.id === next)).toMatchObject({
      position: 4,
      displayNumber: 3,
      numberPartyId: into,
    });
  });

  it("does not reuse an origin's numbers after every group has moved away", async () => {
    const from = await party();
    const into = await party();
    await inTx(async (tx) => {
      await startGroup(tx, from, "hold", OPERATOR);
      await startGroup(tx, from, "fire", OPERATOR);
      await moveGroupsToParty(tx, from, into);
    });
    const next = await inTx((tx) => startGroup(tx, from, "hold", OPERATOR));
    expect(await groups(from)).toMatchObject([
      { id: next, position: 1, displayNumber: 3, numberPartyId: from },
    ]);
  });

  it("rolls back an allocation with its enclosing send transaction", async () => {
    const partyId = await party();
    await expect(
      inTx(async (tx) => {
        await startGroup(tx, partyId, "hold", OPERATOR);
        throw new Error("send refused");
      }),
    ).rejects.toThrow("send refused");
    const next = await inTx((tx) => startGroup(tx, partyId, "hold", OPERATOR));
    expect(await groups(partyId)).toMatchObject([
      { id: next, position: 1, displayNumber: 1, numberPartyId: partyId },
    ]);
  });
});

describe("group numbers returned to the till", () => {
  it("returns permanent identities in firing order through both group reads", async () => {
    const partyId = await party();
    const [first, second] = await inTx(async (tx) => [
      await startGroup(tx, partyId, "hold", OPERATOR),
      await startGroup(tx, partyId, "hold", OPERATOR),
    ]);
    await inTx((tx) =>
      reorderHeldGroups(tx, partyId, [second!, first!], {
        submissionId: "reverse-read",
        expectedPartyRevision: 0,
        operatorId: OPERATOR,
      }),
    );
    const expected = [
      { id: second, position: 1, displayNumber: 2, numberPartyId: partyId },
      { id: first, position: 2, displayNumber: 1, numberPartyId: partyId },
    ];
    expect((await inTx((tx) => listOrderGroups(tx, partyId))).groups).toMatchObject(expected);
    expect(await inTx((tx) => readCurrentOrders(tx, partyId))).toMatchObject({
      hasGroups: true,
      nextDisplayNumber: 3,
      groups: expected,
    });
  });

  it("counts removed and moved-away origins when no visible group remains", async () => {
    const from = await party();
    const into = await party();
    const removed = await inTx((tx) => startGroup(tx, from, "hold", OPERATOR));
    await inTx(async (tx) => {
      await startGroup(tx, from, "fire", OPERATOR);
      await tx.update(orderGroups).set({ state: "removed" }).where(eq(orderGroups.id, removed));
      await moveGroupsToParty(tx, from, into);
    });
    expect(await inTx((tx) => readCurrentOrders(tx, from))).toMatchObject({
      hasGroups: true,
      nextDisplayNumber: 3,
      groups: [],
    });
    const empty = await party();
    expect(await inTx((tx) => readCurrentOrders(tx, empty))).toMatchObject({
      hasGroups: false,
      nextDisplayNumber: 1,
      groups: [],
    });
  });
});

describe("pre-live groups without a number identity", () => {
  it.each([
    { displayNumber: 0, origin: true },
    { displayNumber: 1, origin: false },
  ])(
    "refuses reads and new allocations for $displayNumber / $origin",
    async ({ displayNumber, origin }) => {
      const partyId = await party();
      const [legacy] = await inTx((tx) =>
        tx
          .insert(orderGroups)
          .values({
            partyId,
            position: 1,
            state: "held",
            submittedBy: OPERATOR,
            displayNumber,
            numberPartyId: origin ? partyId : null,
          })
          .returning({ id: orderGroups.id }),
      );
      const refusal = { code: "management.request_invalid", params: { field: "groupId" } };
      await expect(inTx((tx) => listOrderGroups(tx, partyId))).rejects.toMatchObject(refusal);
      await expect(inTx((tx) => readCurrentOrders(tx, partyId))).rejects.toMatchObject(refusal);
      await expect(inTx((tx) => startGroup(tx, partyId, "hold", OPERATOR))).rejects.toMatchObject(
        refusal,
      );
      expect((await groups(partyId)).map((row) => row.id)).toEqual([legacy!.id]);
    },
  );
});
