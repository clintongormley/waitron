import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import {
  billEditStates,
  CORE_MIGRATIONS,
  locations,
  orderDrafts,
  parties,
  withTransaction,
  workingOrders,
  type Transaction,
} from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { IDENTITY_MIGRATIONS, persons } from "@waitron/identity";
import { readBillEditState } from "./bill-editing.js";

const suite = useVenueDb({ migrations: [CORE_MIGRATIONS, IDENTITY_MIGRATIONS] });
const inTx = <T>(fn: (tx: Transaction) => Promise<T>) => withTransaction(suite.db, fn);

async function fixture() {
  return inTx(async (tx) => {
    const [location] = await tx
      .insert(locations)
      .values({ name: "Dining room", invoiceLocales: ["en"], operationDescription: "Restaurant" })
      .returning();
    const [ana] = await tx.insert(persons).values({ displayName: "Ana" }).returning();
    const [luis] = await tx.insert(persons).values({ displayName: "Luis" }).returning();
    const [party] = await tx.insert(parties).values({ openedBy: ana!.id }).returning();
    const [bill] = await tx
      .insert(workingOrders)
      .values({ source: "dashboard", locationId: location!.id, orderNumber: 1, partyId: party!.id })
      .returning();
    const [other] = await tx
      .insert(workingOrders)
      .values({ source: "dashboard", locationId: location!.id, orderNumber: 2, partyId: party!.id })
      .returning();
    return { bill: bill!, other: other!, party: party!, ana: ana!, luis: luis! };
  });
}

const read = (billId: string) => inTx((tx) => readBillEditState(tx, billId));

describe("reading a bill's editing state", () => {
  it("reads a missing version row as unowned without creating one", async () => {
    const { bill } = await fixture();
    expect(await read(bill.id)).toEqual({
      billId: bill.id,
      editorId: null,
      editorName: null,
      editorVersion: 0,
      draftId: null,
      draftRevision: null,
    });
    expect(
      await suite.db.select().from(billEditStates).where(eq(billEditStates.billId, bill.id)),
    ).toEqual([]);
  });

  it("reads independent editors and open draft revisions for two bills at one table", async () => {
    const { bill, other, party, ana, luis } = await fixture();
    const drafts = await inTx(async (tx) => {
      await tx.insert(billEditStates).values([
        { billId: bill.id, editorId: ana.id, editorVersion: 3 },
        { billId: other.id, editorId: luis.id, editorVersion: 8 },
      ]);
      return tx
        .insert(orderDrafts)
        .values([
          { billId: bill.id, partyId: party.id, ownerId: ana.id, revision: 4 },
          { billId: other.id, partyId: party.id, ownerId: luis.id, revision: 9 },
        ])
        .returning();
    });
    expect(await read(bill.id)).toEqual({
      billId: bill.id,
      editorId: ana.id,
      editorName: "Ana",
      editorVersion: 3,
      draftId: drafts[0]!.id,
      draftRevision: 4,
    });
    expect(await read(other.id)).toEqual({
      billId: other.id,
      editorId: luis.id,
      editorName: "Luis",
      editorVersion: 8,
      draftId: drafts[1]!.id,
      draftRevision: 9,
    });
  });

  it.each(["submitted", "discarded"] as const)(
    "retains the released version and ignores a %s draft",
    async (state) => {
      const { bill, party, ana } = await fixture();
      await inTx(async (tx) => {
        await tx.insert(billEditStates).values({ billId: bill.id, editorVersion: 12 });
        await tx
          .insert(orderDrafts)
          .values({ billId: bill.id, partyId: party.id, ownerId: ana.id, revision: 7, state });
      });
      expect(await read(bill.id)).toEqual({
        billId: bill.id,
        editorId: null,
        editorName: null,
        editorVersion: 12,
        draftId: null,
        draftRevision: null,
      });
    },
  );

  it("returns the current editor after an in-place transfer without changing draft identity", async () => {
    const { bill, party, ana, luis } = await fixture();
    const draft = await inTx(async (tx) => {
      await tx
        .insert(billEditStates)
        .values({ billId: bill.id, editorId: ana.id, editorVersion: 2 });
      const [row] = await tx
        .insert(orderDrafts)
        .values({ billId: bill.id, partyId: party.id, ownerId: ana.id, revision: 5 })
        .returning();
      return row!;
    });
    await inTx(async (tx) => {
      await tx
        .update(billEditStates)
        .set({ editorId: luis.id, editorVersion: 3 })
        .where(eq(billEditStates.billId, bill.id));
      await tx
        .update(orderDrafts)
        .set({ ownerId: luis.id, revision: 6 })
        .where(eq(orderDrafts.id, draft.id));
    });
    expect(await read(bill.id)).toEqual({
      billId: bill.id,
      editorId: luis.id,
      editorName: "Luis",
      editorVersion: 3,
      draftId: draft.id,
      draftRevision: 6,
    });
  });

  it("keeps the editor id and version when the identity module has no matching person", async () => {
    const { bill } = await fixture();
    const editorId = randomUUID();
    await inTx((tx) =>
      tx.insert(billEditStates).values({ billId: bill.id, editorId, editorVersion: 6 }),
    );
    expect(await read(bill.id)).toEqual({
      billId: bill.id,
      editorId,
      editorName: null,
      editorVersion: 6,
      draftId: null,
      draftRevision: null,
    });
  });

  it("observes the caller's transaction without writing a version or draft", async () => {
    const { bill, ana } = await fixture();
    const stop = new Error("roll back test state");
    await expect(
      inTx(async (tx) => {
        await tx
          .insert(billEditStates)
          .values({ billId: bill.id, editorId: ana.id, editorVersion: 11 });
        expect(await readBillEditState(tx, bill.id)).toEqual({
          billId: bill.id,
          editorId: ana.id,
          editorName: "Ana",
          editorVersion: 11,
          draftId: null,
          draftRevision: null,
        });
        throw stop;
      }),
    ).rejects.toBe(stop);
    expect(await read(bill.id)).toEqual({
      billId: bill.id,
      editorId: null,
      editorName: null,
      editorVersion: 0,
      draftId: null,
      draftRevision: null,
    });
  });
});
