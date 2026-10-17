import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import {
  billEditStates,
  CORE_MIGRATIONS,
  locations,
  orderDraftLines,
  orderDrafts,
  parties,
  withTransaction,
  workingOrders,
  type Transaction,
} from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { IDENTITY_MIGRATIONS, persons } from "@waitron/identity";
import { AppError } from "@waitron/shared";
import {
  parseBillEditExpecteds,
  requireBillEditors,
  requireRelocatableBillEditors,
} from "./bill-editing.js";
import type { BillEditExpected, BillEditState } from "./order-drafts.js";

const suite = useVenueDb({ migrations: [CORE_MIGRATIONS, IDENTITY_MIGRATIONS] });
const inTx = <T>(fn: (tx: Transaction) => Promise<T>) => withTransaction(suite.db, fn);
const ids = [
  "11111111-1111-4111-8111-111111111111",
  "22222222-2222-4222-8222-222222222222",
  "33333333-3333-4333-8333-333333333333",
];
const released = (billId: string, editorVersion = 0): BillEditExpected => ({
  billId,
  editorVersion,
  draftId: null,
  draftRevision: null,
});
const expectedOf = ({ billId, editorVersion, draftId, draftRevision }: BillEditState) => ({
  billId,
  editorVersion,
  draftId,
  draftRevision,
});

async function fixture(owners: ("Ana" | "Luis" | null)[]) {
  return inTx(async (tx) => {
    const [location] = await tx
      .insert(locations)
      .values({ name: "Dining room", invoiceLocales: ["en"], operationDescription: "Restaurant" })
      .returning();
    const [ana, luis, sam] = await tx
      .insert(persons)
      .values([{ displayName: "Ana" }, { displayName: "Luis" }, { displayName: "Sam" }])
      .returning();
    const [party] = await tx.insert(parties).values({ openedBy: ana!.id }).returning();
    const states: BillEditState[] = [];
    for (const [index, owner] of owners.entries()) {
      const billId = ids[index]!;
      await tx.insert(workingOrders).values({
        id: billId,
        source: "dashboard",
        locationId: location!.id,
        partyId: party!.id,
        orderNumber: index + 1,
      });
      const editorId = owner === null ? null : owner === "Ana" ? ana!.id : luis!.id;
      const state: BillEditState = {
        billId,
        editorId,
        editorName: owner,
        editorVersion: owner === null ? 0 : index + 1,
        draftId: null,
        draftRevision: null,
      };
      if (owner !== null) {
        await tx.insert(billEditStates).values({
          billId,
          editorId,
          editorVersion: state.editorVersion,
        });
        const [draft] = await tx
          .insert(orderDrafts)
          .values({ partyId: party!.id, billId, ownerId: editorId!, revision: index + 5 })
          .returning();
        await tx.insert(orderDraftLines).values({
          draftId: draft!.id,
          position: 1,
          menuItemId: randomUUID(),
          options: [],
          extras: [],
          quantity: 1000,
        });
        state.draftId = draft!.id;
        state.draftRevision = draft!.revision;
      }
      states.push(state);
    }
    return { ana: ana!, luis: luis!, sam: sam!, states, expected: states.map(expectedOf) };
  });
}

async function snapshot() {
  return {
    states: await suite.db.select().from(billEditStates),
    drafts: await suite.db.select().from(orderDrafts),
    lines: await suite.db.select().from(orderDraftLines),
    bills: await suite.db.select().from(workingOrders),
    parties: await suite.db.select().from(parties),
  };
}

async function refused(run: () => unknown, code: string, params: unknown) {
  const before = await snapshot();
  const error = await Promise.resolve()
    .then(run)
    .then(
      () => null,
      (error: unknown) => error,
    );
  expect(error).toBeInstanceOf(AppError);
  expect((error as AppError).code).toBe(code);
  expect((error as AppError).params).toEqual(params);
  expect(await snapshot()).toEqual(before);
}

function conflictParams(conflicts: BillEditState[]) {
  const edit = conflicts[0]!;
  return {
    billId: edit.billId,
    draftId: edit.draftId,
    ownerId: edit.editorId,
    ownerName: edit.editorName,
    edit,
    conflicts,
  };
}

function staleParams(edit: BillEditState) {
  return { billId: edit.billId, draftId: edit.draftId, revision: edit.draftRevision, edit };
}

describe("multi-bill expectation input", () => {
  it("keeps the complete sorted empty/owned expectations and strips body identities", () => {
    const owned = { ...released(ids[1]!, 7), draftId: randomUUID(), draftRevision: 9 };
    const input = [released(ids[0]!), { ...owned, ownerId: "not trusted" }];
    expect(parseBillEditExpecteds(input)).toEqual([released(ids[0]!), owned]);
    expect(input[1]).toHaveProperty("ownerId", "not trusted");
  });

  it("normalises UUIDs before comparing bill order without reordering the input", () => {
    const billId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    const draftId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
    expect(
      parseBillEditExpecteds([
        released(ids[0]!),
        {
          billId: billId.toUpperCase(),
          editorVersion: 2,
          draftId: draftId.toUpperCase(),
          draftRevision: 3,
        },
      ]),
    ).toEqual([released(ids[0]!), { billId, editorVersion: 2, draftId, draftRevision: 3 }]);
  });

  it("accepts an empty affected-set expectation", () => {
    expect(parseBillEditExpecteds([])).toEqual([]);
  });

  it.each([
    { input: Array<unknown>(1), field: "expectedEdits.0" },
    { input: Object.assign(Array<unknown>(2), { 0: released(ids[0]!) }), field: "expectedEdits.1" },
  ])("refuses an absent array entry at $field", async ({ input, field }) => {
    await refused(() => parseBillEditExpecteds(input), "management.request_invalid", { field });
  });

  it.each([undefined, null, {}, "", 0, true])("refuses a non-array %j", async (input) => {
    await refused(() => parseBillEditExpecteds(input), "management.request_invalid", {
      field: "expectedEdits",
    });
  });

  it.each([
    { value: null, field: "expectedEdits.1" },
    { value: [], field: "expectedEdits.1" },
    { value: { ...released(ids[1]!), billId: "bad" }, field: "expectedEdits.1.billId" },
    { value: { ...released(ids[1]!), editorVersion: -1 }, field: "expectedEdits.1.editorVersion" },
    { value: { ...released(ids[1]!), editorVersion: "0" }, field: "expectedEdits.1.editorVersion" },
    { value: { ...released(ids[1]!), draftId: undefined }, field: "expectedEdits.1.draftId" },
    {
      value: { ...released(ids[1]!), draftId: randomUUID() },
      field: "expectedEdits.1.draftRevision",
    },
    { value: { ...released(ids[1]!), draftRevision: 0 }, field: "expectedEdits.1.draftRevision" },
    { value: { ...released(ids[1]!), draftRevision: 0.5 }, field: "expectedEdits.1.draftRevision" },
  ])("refuses $field without coercion", async ({ value, field }) => {
    await refused(
      () => parseBillEditExpecteds([released(ids[0]!), value]),
      "management.request_invalid",
      { field },
    );
  });

  it.each([
    { input: [released(ids[0]!), released(ids[0]!)] },
    { input: [released(ids[1]!), released(ids[0]!)] },
    {
      input: [
        released("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"),
        released("AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA"),
      ],
    },
  ])("refuses duplicate or unsorted bill IDs: $input", async ({ input }) => {
    await refused(() => parseBillEditExpecteds(input), "management.request_invalid", {
      field: "expectedEdits.1.billId",
    });
  });
});

describe("validating every affected bill before composition", () => {
  it("accepts the editor's bills plus an empty destination, without acquiring or changing rows", async () => {
    const { ana, states, expected } = await fixture(["Ana", "Ana", null]);
    const before = await snapshot();
    expect(
      await inTx((tx) => requireBillEditors(tx, [ids[2]!, ids[0]!, ids[1]!], ana.id, expected)),
    ).toEqual(states);
    expect(await snapshot()).toEqual(before);
  });

  it("does not inspect or block on a bill outside the affected set", async () => {
    const { ana, states, expected } = await fixture(["Ana", "Luis"]);
    expect(await inTx((tx) => requireBillEditors(tx, [ids[0]!], ana.id, [expected[0]!]))).toEqual([
      states[0],
    ]);
  });

  it("treats overlapping internally collected scopes as one affected bill", async () => {
    const { ana, states, expected } = await fixture(["Ana"]);
    expect(
      await inTx((tx) => requireBillEditors(tx, [ids[0]!, ids[0]!], ana.id, expected)),
    ).toEqual(states);
  });

  it("accepts no affected bills without allocating any state", async () => {
    const before = await snapshot();
    expect(await inTx((tx) => requireBillEditors(tx, [], randomUUID(), []))).toEqual([]);
    expect(await snapshot()).toEqual(before);
  });

  it.each(["missing-empty", "missing-owned", "extra", "empty"])(
    "refuses an incomplete or excessive set: %s",
    async (change) => {
      const { ana, expected } = await fixture(["Ana", null]);
      const ask =
        change === "missing-empty"
          ? [expected[0]!]
          : change === "missing-owned"
            ? [expected[1]!]
            : change === "extra"
              ? [...expected, released(ids[2]!)]
              : [];
      await refused(
        () => inTx((tx) => requireBillEditors(tx, ids.slice(0, 2), ana.id, ask)),
        "management.request_invalid",
        { field: "expectedEdits" },
      );
    },
  );

  it("requires the full set before returning another person's ownership facts", async () => {
    const { ana, expected } = await fixture(["Luis", null]);
    await refused(
      () => inTx((tx) => requireBillEditors(tx, ids.slice(0, 2), ana.id, [expected[0]!])),
      "management.request_invalid",
      { field: "expectedEdits" },
    );
  });

  it.each([false, true])(
    "returns every conflicting bill in bill order before checking stale versions (stale=%s)",
    async (stale) => {
      const { ana, states, expected } = await fixture(["Luis", "Ana", "Luis"]);
      const ask = expected.map((edit) => ({
        ...edit,
        editorVersion: stale ? 0 : edit.editorVersion,
      }));
      await refused(
        () => inTx((tx) => requireBillEditors(tx, [ids[2]!, ids[1]!, ids[0]!], ana.id, ask)),
        "draft.taken_over",
        conflictParams([states[0]!, states[2]!]),
      );
    },
  );

  it.each([
    { editorVersion: 0 },
    { draftId: randomUUID() },
    { draftRevision: 0 },
    { draftId: null, draftRevision: null },
  ])("compares each bill's complete expectation: %j", async (change) => {
    const { ana, states, expected } = await fixture(["Ana", "Ana"]);
    await refused(
      () =>
        inTx((tx) =>
          requireBillEditors(tx, ids.slice(0, 2), ana.id, [
            expected[0]!,
            { ...expected[1]!, ...change },
          ]),
        ),
      "draft.out_of_date",
      staleParams(states[1]!),
    );
  });

  it("detects a destination acquired after an empty expectation was read", async () => {
    const { ana, states, expected } = await fixture(["Ana", "Ana"]);
    await refused(
      () =>
        inTx((tx) =>
          requireBillEditors(tx, ids.slice(0, 2), ana.id, [expected[0]!, released(ids[1]!)]),
        ),
      "draft.out_of_date",
      staleParams(states[1]!),
    );
  });

  it("compares a released destination's retained version even though it has no draft", async () => {
    const { ana, states, expected } = await fixture(["Ana", null]);
    await inTx((tx) => tx.insert(billEditStates).values({ billId: ids[1]!, editorVersion: 8 }));
    const edit = { ...states[1]!, editorVersion: 8 };
    await refused(
      () => inTx((tx) => requireBillEditors(tx, ids.slice(0, 2), ana.id, expected)),
      "draft.out_of_date",
      staleParams(edit),
    );
    expect(
      await inTx((tx) =>
        requireBillEditors(tx, ids.slice(0, 2), ana.id, [expected[0]!, released(ids[1]!, 8)]),
      ),
    ).toEqual([states[0], edit]);
  });
});

describe("validating bill relocation without changing the common editor", () => {
  it.each(["Ana", "Luis", "Sam"] as const)(
    "allows %s to retain one common editor and empty bills",
    async (actor) => {
      const { ana, luis, sam, states, expected } = await fixture(["Ana", "Ana", null]);
      const person = actor === "Ana" ? ana : actor === "Luis" ? luis : sam;
      const before = await snapshot();
      expect(
        await inTx((tx) =>
          requireRelocatableBillEditors(tx, [ids[2]!, ids[1]!, ids[0]!], person.id, expected),
        ),
      ).toEqual(states);
      expect(await snapshot()).toEqual(before);
    },
  );

  it("does not grant bill-content editing authority when relocation can retain a colleague", async () => {
    const { luis, states, expected } = await fixture(["Ana", null]);
    expect(
      await inTx((tx) => requireRelocatableBillEditors(tx, ids.slice(0, 2), luis.id, expected)),
    ).toEqual(states);
    await refused(
      () => inTx((tx) => requireBillEditors(tx, ids.slice(0, 2), luis.id, expected)),
      "draft.taken_over",
      conflictParams([states[0]!]),
    );
  });

  it.each(["Ana", "Luis", "Sam"] as const)(
    "returns all other editors when %s tries to relocate conflicting bills",
    async (actor) => {
      const { ana, luis, sam, states, expected } = await fixture(["Ana", "Luis", null]);
      const person = actor === "Ana" ? ana : actor === "Luis" ? luis : sam;
      const conflicts =
        actor === "Ana" ? [states[1]!] : actor === "Luis" ? [states[0]!] : [states[0]!, states[1]!];
      await refused(
        () =>
          inTx((tx) =>
            requireRelocatableBillEditors(tx, [ids[2]!, ids[1]!, ids[0]!], person.id, expected),
          ),
        "draft.taken_over",
        conflictParams(conflicts),
      );
    },
  );

  it("requires the empty destination in a relocation expectation too", async () => {
    const { ana, expected } = await fixture(["Ana", null]);
    await refused(
      () =>
        inTx((tx) => requireRelocatableBillEditors(tx, ids.slice(0, 2), ana.id, [expected[0]!])),
      "management.request_invalid",
      { field: "expectedEdits" },
    );
  });

  it("refuses a stale common foreign editor instead of implicitly taking it over", async () => {
    const { luis, states, expected } = await fixture(["Ana", "Ana"]);
    await refused(
      () =>
        inTx((tx) =>
          requireRelocatableBillEditors(tx, ids.slice(0, 2), luis.id, [
            expected[0]!,
            { ...expected[1]!, editorVersion: 0 },
          ]),
        ),
      "draft.out_of_date",
      staleParams(states[1]!),
    );
  });

  it("observes a conflicting editor written earlier in the same caller transaction", async () => {
    const { ana, luis, states, expected } = await fixture(["Ana", "Ana"]);
    const before = await snapshot();
    const error = await inTx(async (tx) => {
      await tx
        .update(billEditStates)
        .set({ editorId: luis.id, editorVersion: 4 })
        .where(eq(billEditStates.billId, ids[1]!));
      return requireRelocatableBillEditors(tx, ids.slice(0, 2), ana.id, expected);
    }).then(
      () => null,
      (error: unknown) => error,
    );
    const edit = { ...states[1]!, editorId: luis.id, editorName: "Luis", editorVersion: 4 };
    expect(error).toBeInstanceOf(AppError);
    expect((error as AppError).code).toBe("draft.taken_over");
    expect((error as AppError).params).toEqual(conflictParams([edit]));
    expect(await snapshot()).toEqual(before);
  });
});
