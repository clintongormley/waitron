import { seedPersons } from "@waitron/identity/test/person-rows.js";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import {
  billEditStates,
  CORE_MIGRATIONS,
  orderDrafts,
  parties,
  withTransaction,
  workingOrders,
  type Transaction,
} from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { seedVenue, seedWorkingOrder } from "@waitron/db/testing/seed.js";

import { AppError } from "@waitron/shared";
import { readBillEditState, requireBillEditor } from "./bill-editing.js";
import type { BillEditExpected } from "./order-drafts.js";

const suite = useVenueDb({ migrations: [CORE_MIGRATIONS] });
const inTx = <T>(fn: (tx: Transaction) => Promise<T>) => withTransaction(suite.db, fn);

async function fixture() {
  return inTx(async (tx) => {
    await seedVenue(tx, {
      name: "Dining room",
      invoiceLocales: ["en"],
      operationDescription: "Restaurant",
    });
    const [anna] = await seedPersons(tx, { displayName: "Anna" });
    const [lewis] = await seedPersons(tx, { displayName: "Lewis" });
    const [party] = await tx.insert(parties).values({ openedBy: anna!.id }).returning();
    const bill = await seedWorkingOrder(tx, {
      source: "dashboard",
      orderNumber: 1,
      partyId: party!.id,
    });
    const other = await seedWorkingOrder(tx, {
      source: "dashboard",
      orderNumber: 2,
      partyId: party!.id,
    });
    return { bill: bill!, other: other!, party: party!, anna: anna!, lewis: lewis! };
  });
}

const read = (billId: string) => inTx((tx) => readBillEditState(tx, billId));

async function ownedBill() {
  const data = await fixture();
  const draft = await inTx(async (tx) => {
    await tx
      .insert(billEditStates)
      .values({ billId: data.bill.id, editorId: data.anna.id, editorVersion: 2 });
    const [row] = await tx
      .insert(orderDrafts)
      .values({ billId: data.bill.id, partyId: data.party.id, ownerId: data.anna.id, revision: 5 })
      .returning();
    return row!;
  });
  const expected: BillEditExpected = {
    billId: data.bill.id,
    editorVersion: 2,
    draftId: draft.id,
    draftRevision: 5,
  };
  return { ...data, draft, expected };
}

async function snapshot() {
  return {
    states: await suite.db.select().from(billEditStates),
    drafts: await suite.db.select().from(orderDrafts),
    bills: await suite.db.select().from(workingOrders),
  };
}

async function refusedWith(run: () => Promise<unknown>, code: string, params: unknown) {
  const before = await snapshot();
  const error = await run().then(
    () => null,
    (error: unknown) => error,
  );
  expect(error).toBeInstanceOf(AppError);
  expect((error as AppError).code).toBe(code);
  expect((error as AppError).params).toEqual(params);
  expect(await snapshot()).toEqual(before);
}

describe("validating a bill's editor", () => {
  it("allows an unowned bill without acquiring it or allocating a draft", async () => {
    const { bill, anna } = await fixture();
    const before = await snapshot();
    expect(
      await inTx((tx) =>
        requireBillEditor(tx, bill.id, anna.id, {
          billId: bill.id,
          editorVersion: 0,
          draftId: null,
          draftRevision: null,
        }),
      ),
    ).toEqual({
      billId: bill.id,
      editorId: null,
      editorName: null,
      editorVersion: 0,
      draftId: null,
      draftRevision: null,
    });
    expect(await snapshot()).toEqual(before);
  });

  it("allows the editor's current expectation without changing versions or drafts", async () => {
    const { bill, anna, draft, expected } = await ownedBill();
    const before = await snapshot();
    expect(await inTx((tx) => requireBillEditor(tx, bill.id, anna.id, expected))).toEqual({
      billId: bill.id,
      editorId: anna.id,
      editorName: "Anna",
      editorVersion: 2,
      draftId: draft.id,
      draftRevision: 5,
    });
    expect(await snapshot()).toEqual(before);
  });

  it("does not require taking over an editor's other bill", async () => {
    const { other, lewis } = await ownedBill();
    const before = await snapshot();
    expect(
      await inTx((tx) =>
        requireBillEditor(tx, other.id, lewis.id, {
          billId: other.id,
          editorVersion: 0,
          draftId: null,
          draftRevision: null,
        }),
      ),
    ).toEqual({
      billId: other.id,
      editorId: null,
      editorName: null,
      editorVersion: 0,
      draftId: null,
      draftRevision: null,
    });
    expect(await snapshot()).toEqual(before);
  });

  it.each([false, true])(
    "refuses another editor before a stale-version comparison (stale=%s)",
    async (stale) => {
      const { bill, anna, lewis, draft, expected } = await ownedBill();
      const edit = {
        billId: bill.id,
        editorId: anna.id,
        editorName: "Anna",
        editorVersion: 2,
        draftId: draft.id,
        draftRevision: 5,
      };
      await refusedWith(
        () =>
          inTx((tx) =>
            requireBillEditor(tx, bill.id, lewis.id, {
              ...expected,
              editorVersion: stale ? 0 : 2,
            }),
          ),
        "draft.taken_over",
        { billId: bill.id, draftId: draft.id, ownerId: anna.id, ownerName: "Anna", edit },
      );
    },
  );

  it.each([
    { editorVersion: 1 },
    { draftId: randomUUID() },
    { draftRevision: 4 },
    { draftId: null, draftRevision: null },
  ])("refuses the same editor's mismatched expectation %j", async (change) => {
    const { bill, anna, draft, expected } = await ownedBill();
    const edit = {
      billId: bill.id,
      editorId: anna.id,
      editorName: "Anna",
      editorVersion: 2,
      draftId: draft.id,
      draftRevision: 5,
    };
    await refusedWith(
      () => inTx((tx) => requireBillEditor(tx, bill.id, anna.id, { ...expected, ...change })),
      "draft.out_of_date",
      { billId: bill.id, draftId: draft.id, revision: 5, edit },
    );
  });

  it("refuses an expectation for another bill as an invalid field", async () => {
    const { bill, other, anna, expected } = await ownedBill();
    await refusedWith(
      () =>
        inTx((tx) => requireBillEditor(tx, bill.id, anna.id, { ...expected, billId: other.id })),
      "management.request_invalid",
      { field: "expectedEdit.billId" },
    );
  });

  it("refuses a pre-release request with nullable current draft facts", async () => {
    const { bill, anna, draft, expected } = await ownedBill();
    await inTx(async (tx) => {
      await tx.update(orderDrafts).set({ state: "submitted" }).where(eq(orderDrafts.id, draft.id));
      await tx
        .update(billEditStates)
        .set({ editorId: null, editorVersion: 3 })
        .where(eq(billEditStates.billId, bill.id));
    });
    const edit = {
      billId: bill.id,
      editorId: null,
      editorName: null,
      editorVersion: 3,
      draftId: null,
      draftRevision: null,
    };
    await refusedWith(
      () => inTx((tx) => requireBillEditor(tx, bill.id, anna.id, expected)),
      "draft.out_of_date",
      { billId: bill.id, draftId: null, revision: null, edit },
    );
    expect(
      await inTx((tx) =>
        requireBillEditor(tx, bill.id, anna.id, {
          billId: bill.id,
          editorVersion: 3,
          draftId: null,
          draftRevision: null,
        }),
      ),
    ).toEqual(edit);
  });

  it("compares the version even when the original person owns the bill again", async () => {
    const { bill, anna, draft, expected } = await ownedBill();
    await inTx((tx) =>
      tx.update(billEditStates).set({ editorVersion: 6 }).where(eq(billEditStates.billId, bill.id)),
    );
    await refusedWith(
      () => inTx((tx) => requireBillEditor(tx, bill.id, anna.id, expected)),
      "draft.out_of_date",
      {
        billId: bill.id,
        draftId: draft.id,
        revision: 5,
        edit: {
          billId: bill.id,
          editorId: anna.id,
          editorName: "Anna",
          editorVersion: 6,
          draftId: draft.id,
          draftRevision: 5,
        },
      },
    );
  });
});

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
    const { bill, other, party, anna, lewis } = await fixture();
    const drafts = await inTx(async (tx) => {
      await tx.insert(billEditStates).values([
        { billId: bill.id, editorId: anna.id, editorVersion: 3 },
        { billId: other.id, editorId: lewis.id, editorVersion: 8 },
      ]);
      return tx
        .insert(orderDrafts)
        .values([
          { billId: bill.id, partyId: party.id, ownerId: anna.id, revision: 4 },
          { billId: other.id, partyId: party.id, ownerId: lewis.id, revision: 9 },
        ])
        .returning();
    });
    expect(await read(bill.id)).toEqual({
      billId: bill.id,
      editorId: anna.id,
      editorName: "Anna",
      editorVersion: 3,
      draftId: drafts[0]!.id,
      draftRevision: 4,
    });
    expect(await read(other.id)).toEqual({
      billId: other.id,
      editorId: lewis.id,
      editorName: "Lewis",
      editorVersion: 8,
      draftId: drafts[1]!.id,
      draftRevision: 9,
    });
  });

  it.each(["submitted", "discarded"] as const)(
    "retains the released version and ignores a %s draft",
    async (state) => {
      const { bill, party, anna } = await fixture();
      await inTx(async (tx) => {
        await tx.insert(billEditStates).values({ billId: bill.id, editorVersion: 12 });
        await tx
          .insert(orderDrafts)
          .values({ billId: bill.id, partyId: party.id, ownerId: anna.id, revision: 7, state });
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
    const { bill, party, anna, lewis } = await fixture();
    const draft = await inTx(async (tx) => {
      await tx
        .insert(billEditStates)
        .values({ billId: bill.id, editorId: anna.id, editorVersion: 2 });
      const [row] = await tx
        .insert(orderDrafts)
        .values({ billId: bill.id, partyId: party.id, ownerId: anna.id, revision: 5 })
        .returning();
      return row!;
    });
    await inTx(async (tx) => {
      await tx
        .update(billEditStates)
        .set({ editorId: lewis.id, editorVersion: 3 })
        .where(eq(billEditStates.billId, bill.id));
      await tx
        .update(orderDrafts)
        .set({ ownerId: lewis.id, revision: 6 })
        .where(eq(orderDrafts.id, draft.id));
    });
    expect(await read(bill.id)).toEqual({
      billId: bill.id,
      editorId: lewis.id,
      editorName: "Lewis",
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
    const { bill, anna } = await fixture();
    const stop = new Error("roll back test state");
    await expect(
      inTx(async (tx) => {
        await tx
          .insert(billEditStates)
          .values({ billId: bill.id, editorId: anna.id, editorVersion: 11 });
        expect(await readBillEditState(tx, bill.id)).toEqual({
          billId: bill.id,
          editorId: anna.id,
          editorName: "Anna",
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
