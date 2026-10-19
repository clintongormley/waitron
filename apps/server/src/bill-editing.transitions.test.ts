import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import {
  billEditStates,
  CORE_MIGRATIONS,
  locations,
  orderDraftLines,
  orderDraftRecalledLines,
  orderDrafts,
  parties,
  withTransaction,
  workingOrderLines,
  workingOrders,
  type Transaction,
} from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { IDENTITY_MIGRATIONS, persons } from "@waitron/identity";
import { AppError } from "@waitron/shared";
import * as editing from "./bill-editing.js";
import type { BillEditExpected } from "./order-drafts.js";

const suite = useVenueDb({ migrations: [CORE_MIGRATIONS, IDENTITY_MIGRATIONS] });
const inTx = <T>(body: (tx: Transaction) => Promise<T>) => withTransaction(suite.db, body);

async function fixture() {
  return inTx(async (tx) => {
    const [location] = await tx
      .insert(locations)
      .values({
        name: "Room",
        invoiceLocales: ["en"],
        operationDescription: "Restaurant",
      })
      .returning();
    const [ana, luis] = await tx
      .insert(persons)
      .values([{ displayName: "Ana" }, { displayName: "Luis" }])
      .returning();
    const [party] = await tx.insert(parties).values({ openedBy: ana!.id }).returning();
    const [bill, other] = await tx
      .insert(workingOrders)
      .values(
        [1, 2].map((orderNumber) => ({
          source: "dashboard" as const,
          locationId: location!.id,
          partyId: party!.id,
          orderNumber,
        })),
      )
      .returning();
    return { bill: bill!, other: other!, party: party!, ana: ana!, luis: luis! };
  });
}

const blank = (billId: string): BillEditExpected => ({
  billId,
  editorVersion: 0,
  draftId: null,
  draftRevision: null,
});

async function open(data: Awaited<ReturnType<typeof fixture>>, operatorId = data.ana.id) {
  return inTx(async (tx) => {
    await editing.acquireBillEditor(tx, data.bill.id, operatorId, blank(data.bill.id));
    const [draft] = await tx
      .insert(orderDrafts)
      .values({
        billId: data.bill.id,
        partyId: data.party.id,
        ownerId: operatorId,
      })
      .returning();
    const [line] = await tx
      .insert(orderDraftLines)
      .values({
        draftId: draft!.id,
        position: 1,
        menuItemId: "aaaaaaaa-0000-4000-8000-000000000001",
        options: [],
        extras: [],
        quantity: 1000,
      })
      .returning();
    return { draft: draft!, line: line!, edit: await editing.readBillEditState(tx, data.bill.id) };
  });
}

async function reserveSource(data: Awaited<ReturnType<typeof fixture>>, draftId: string) {
  return inTx(async (tx) => {
    const [source] = await tx
      .insert(workingOrderLines)
      .values({
        workingOrderId: data.bill.id,
        lineNo: 1,
        name: "Staff soup",
        quantity: 1000,
        descriptions: { en: "Soup" },
        kitchenName: "K-SOUP",
        unitPriceGross: 500,
        vatClass: "general",
        lineTotal: 500,
        note: "No pepper",
      })
      .returning();
    await tx
      .insert(orderDraftRecalledLines)
      .values({ draftId, sourceLineId: source!.id, position: 2 });
    return source!;
  });
}

async function rows() {
  return {
    states: await suite.db.select().from(billEditStates),
    drafts: await suite.db.select().from(orderDrafts),
    lines: await suite.db.select().from(orderDraftLines),
    sources: await suite.db.select().from(orderDraftRecalledLines),
    bills: await suite.db.select().from(workingOrders),
    charges: await suite.db.select().from(workingOrderLines),
  };
}

async function refused(body: (tx: Transaction) => Promise<unknown>, code: string, params: unknown) {
  const before = await rows();
  const error = await inTx(body).then(
    () => null,
    (error: unknown) => error,
  );
  expect(error).toBeInstanceOf(AppError);
  expect((error as AppError).code).toBe(code);
  expect((error as AppError).params).toEqual(params);
  expect(await rows()).toEqual(before);
}

describe("bill editor lifecycle", () => {
  it("acquires version one with the first outbox and leaves the other bill unowned", async () => {
    const data = await fixture();
    const { draft, edit } = await open(data);
    expect(edit).toEqual({
      billId: data.bill.id,
      editorId: data.ana.id,
      editorName: "Ana",
      editorVersion: 1,
      draftId: draft.id,
      draftRevision: 0,
    });
    expect(await inTx((tx) => editing.readBillEditState(tx, data.other.id))).toEqual({
      ...blank(data.other.id),
      editorId: null,
      editorName: null,
    });
    expect(await suite.db.select().from(billEditStates)).toEqual([
      { billId: data.bill.id, editorId: data.ana.id, editorVersion: 1 },
    ]);
  });

  it("allows a current same-person save without advancing the editor version", async () => {
    const data = await fixture();
    const { edit } = await open(data);
    const before = await rows();
    expect(
      await inTx((tx) => editing.acquireBillEditor(tx, data.bill.id, data.ana.id, edit)),
    ).toEqual(edit);
    expect(await rows()).toEqual(before);
  });

  it("refuses a rival's first save without allocating another outbox", async () => {
    const data = await fixture();
    const { draft, edit } = await open(data);
    await refused(
      (tx) => editing.acquireBillEditor(tx, data.bill.id, data.luis.id, blank(data.bill.id)),
      "draft.taken_over",
      { billId: data.bill.id, draftId: draft.id, ownerId: data.ana.id, ownerName: "Ana", edit },
    );
  });

  it("rolls acquisition back when the enclosing save fails", async () => {
    const data = await fixture();
    const stop = new Error("save failed after acquisition");
    const before = await rows();
    await expect(
      inTx(async (tx) => {
        await editing.acquireBillEditor(tx, data.bill.id, data.ana.id, blank(data.bill.id));
        throw stop;
      }),
    ).rejects.toBe(stop);
    expect(await rows()).toEqual(before);
  });

  it.each(["submitted", "discarded"] as const)(
    "closes an empty outbox as %s and retains its released version",
    async (state) => {
      const data = await fixture();
      const { draft, line, edit } = await open(data);
      const released = await inTx(async (tx) => {
        await tx.delete(orderDraftLines).where(eq(orderDraftLines.id, line.id));
        return editing.closeBillDraft(tx, data.bill.id, data.ana.id, edit, state);
      });
      expect(released).toEqual({
        billId: data.bill.id,
        editorId: null,
        editorName: null,
        editorVersion: 2,
        draftId: null,
        draftRevision: null,
      });
      const [closed] = await suite.db
        .select()
        .from(orderDrafts)
        .where(eq(orderDrafts.id, draft.id));
      expect(closed).toMatchObject({ id: draft.id, state, ownerId: data.ana.id, revision: 1 });
      expect(await suite.db.select().from(billEditStates)).toEqual([
        { billId: data.bill.id, editorId: null, editorVersion: 2 },
      ]);
    },
  );

  it("never releases an outbox that still has a fresh dish", async () => {
    const data = await fixture();
    const { edit } = await open(data);
    await refused(
      (tx) => editing.closeBillDraft(tx, data.bill.id, data.ana.id, edit, "discarded"),
      "management.request_invalid",
      { field: "lines" },
    );
  });

  it("never releases an outbox that still reserves a recalled source", async () => {
    const data = await fixture();
    const { draft, line, edit } = await open(data);
    await inTx((tx) => tx.delete(orderDraftLines).where(eq(orderDraftLines.id, line.id)));
    await reserveSource(data, draft.id);
    await refused(
      (tx) => editing.closeBillDraft(tx, data.bill.id, data.ana.id, edit, "submitted"),
      "management.request_invalid",
      { field: "lines" },
    );
  });

  it("reacquires a released bill without reopening the closed draft or reusing its version", async () => {
    const data = await fixture();
    const first = await open(data);
    const released = await inTx(async (tx) => {
      await tx.delete(orderDraftLines).where(eq(orderDraftLines.id, first.line.id));
      return editing.closeBillDraft(tx, data.bill.id, data.ana.id, first.edit, "discarded");
    });
    const next = await inTx(async (tx) => {
      await editing.acquireBillEditor(tx, data.bill.id, data.luis.id, released);
      const [draft] = await tx
        .insert(orderDrafts)
        .values({
          billId: data.bill.id,
          partyId: data.party.id,
          ownerId: data.luis.id,
        })
        .returning();
      return { draft: draft!, edit: await editing.readBillEditState(tx, data.bill.id) };
    });
    expect(next.draft.id).not.toBe(first.draft.id);
    expect(next.edit).toEqual({
      billId: data.bill.id,
      editorId: data.luis.id,
      editorName: "Luis",
      editorVersion: 3,
      draftId: next.draft.id,
      draftRevision: 0,
    });
    await refused(
      (tx) => editing.acquireBillEditor(tx, data.bill.id, data.luis.id, released),
      "draft.out_of_date",
      { billId: data.bill.id, draftId: next.draft.id, revision: 0, edit: next.edit },
    );
  });

  it("rolls the close and release back with a failed enclosing command", async () => {
    const data = await fixture();
    const { line, edit } = await open(data);
    const before = await rows();
    const stop = new Error("command failed after release");
    await expect(
      inTx(async (tx) => {
        await tx.delete(orderDraftLines).where(eq(orderDraftLines.id, line.id));
        await editing.closeBillDraft(tx, data.bill.id, data.ana.id, edit, "submitted");
        throw stop;
      }),
    ).rejects.toBe(stop);
    expect(await rows()).toEqual(before);
  });

  it("transfers the saved draft in place without moving lines or changing another bill", async () => {
    const data = await fixture();
    const { draft, edit } = await open(data);
    await reserveSource(data, draft.id);
    await open({ ...data, bill: data.other }, data.luis.id);
    const before = await rows();
    const transferred = await inTx((tx) =>
      editing.transferBillEditor(tx, data.bill.id, data.luis.id, edit),
    );
    expect(transferred).toEqual({
      billId: data.bill.id,
      editorId: data.luis.id,
      editorName: "Luis",
      editorVersion: 2,
      draftId: draft.id,
      draftRevision: 1,
    });
    const after = await rows();
    expect(after.lines).toEqual(before.lines);
    expect(after.sources).toEqual(before.sources);
    expect(after.bills).toEqual(before.bills);
    expect(after.charges).toEqual(before.charges);
    expect(after.states.filter((row) => row.billId === data.other.id)).toEqual(
      before.states.filter((row) => row.billId === data.other.id),
    );
    expect(after.drafts.filter((row) => row.billId === data.other.id)).toEqual(
      before.drafts.filter((row) => row.billId === data.other.id),
    );
    expect(after.drafts.filter((row) => row.billId === data.bill.id)).toMatchObject([
      { id: draft.id, ownerId: data.luis.id, state: "open", revision: 1 },
    ]);
  });

  it("compares a same-person takeover before returning a no-op", async () => {
    const data = await fixture();
    const { draft, edit } = await open(data);
    const before = await rows();
    expect(
      await inTx((tx) => editing.transferBillEditor(tx, data.bill.id, data.ana.id, edit)),
    ).toEqual(edit);
    expect(await rows()).toEqual(before);
    await refused(
      (tx) =>
        editing.transferBillEditor(tx, data.bill.id, data.ana.id, { ...edit, editorVersion: 0 }),
      "draft.out_of_date",
      { billId: data.bill.id, draftId: draft.id, revision: 0, edit },
    );
  });

  it.each([
    { editorVersion: 0 },
    { draftId: "aaaaaaaa-0000-4000-8000-000000000002" },
    { draftRevision: 4 },
  ])("refuses an unseen newer draft on takeover (%j)", async (change) => {
    const data = await fixture();
    const { draft, edit } = await open(data);
    await refused(
      (tx) => editing.transferBillEditor(tx, data.bill.id, data.luis.id, { ...edit, ...change }),
      "draft.out_of_date",
      { billId: data.bill.id, draftId: draft.id, revision: 0, edit },
    );
  });

  it("refuses a taken-over editor's close before closing any record", async () => {
    const data = await fixture();
    const { draft, line, edit } = await open(data);
    const current = await inTx(async (tx) => {
      await tx.delete(orderDraftLines).where(eq(orderDraftLines.id, line.id));
      return editing.transferBillEditor(tx, data.bill.id, data.luis.id, edit);
    });
    await refused(
      (tx) => editing.closeBillDraft(tx, data.bill.id, data.ana.id, edit, "discarded"),
      "draft.taken_over",
      {
        billId: data.bill.id,
        draftId: draft.id,
        ownerId: data.luis.id,
        ownerName: "Luis",
        edit: current,
      },
    );
  });

  it("retains ownership and invalidates the old scope when a bill relocates", async () => {
    const data = await fixture();
    const { draft, edit } = await open(data);
    const before = await rows();
    const moved = await inTx((tx) => editing.relocateBillEditor(tx, data.bill.id, edit));
    expect(moved).toEqual({ ...edit, editorVersion: 2, draftRevision: 1 });
    const after = await rows();
    expect(after.lines).toEqual(before.lines);
    expect(after.sources).toEqual(before.sources);
    expect(after.bills).toEqual(before.bills);
    expect(after.charges).toEqual(before.charges);
    expect(after.drafts).toMatchObject([
      { id: draft.id, ownerId: data.ana.id, state: "open", revision: 1 },
    ]);
    await refused(
      (tx) => editing.acquireBillEditor(tx, data.bill.id, data.ana.id, edit),
      "draft.out_of_date",
      { billId: data.bill.id, draftId: draft.id, revision: 1, edit: moved },
    );
  });

  it("versions an empty relocated bill without acquiring or creating an outbox", async () => {
    const data = await fixture();
    expect(
      await inTx((tx) => editing.relocateBillEditor(tx, data.bill.id, blank(data.bill.id))),
    ).toEqual({ ...blank(data.bill.id), editorId: null, editorName: null, editorVersion: 1 });
    expect(await suite.db.select().from(orderDrafts)).toEqual([]);
    expect(await suite.db.select().from(billEditStates)).toEqual([
      { billId: data.bill.id, editorId: null, editorVersion: 1 },
    ]);
  });

  it("rejects a relocation whose empty destination acquired an editor since the prompt", async () => {
    const data = await fixture();
    const { draft, edit } = await open(data);
    await refused(
      (tx) => editing.relocateBillEditor(tx, data.bill.id, blank(data.bill.id)),
      "draft.out_of_date",
      { billId: data.bill.id, draftId: draft.id, revision: 0, edit },
    );
  });

  it.each(["transfer", "relocate"] as const)(
    "rolls a %s back with its outer transaction",
    async (kind) => {
      const data = await fixture();
      const { edit } = await open(data);
      const before = await rows();
      const stop = new Error("move failed after changing ownership");
      await expect(
        inTx(async (tx) => {
          if (kind === "transfer")
            await editing.transferBillEditor(tx, data.bill.id, data.luis.id, edit);
          else await editing.relocateBillEditor(tx, data.bill.id, edit);
          throw stop;
        }),
      ).rejects.toBe(stop);
      expect(await rows()).toEqual(before);
    },
  );

  it.each(["ana", "luis"] as const)(
    "admits one acquisition transaction (%s submits first)",
    async (first) => {
      const data = await fixture();
      const second = first === "ana" ? "luis" : "ana";
      const results = await Promise.allSettled([
        open(data, data[first].id),
        open(data, data[second].id),
      ]);
      expect(results.map((result) => result.status)).toEqual(["fulfilled", "rejected"]);
      const accepted = (results[0] as PromiseFulfilledResult<Awaited<ReturnType<typeof open>>>)
        .value;
      const error: unknown = (results[1] as PromiseRejectedResult).reason;
      expect(error).toBeInstanceOf(AppError);
      expect((error as AppError).code).toBe("draft.taken_over");
      expect((error as AppError).params).toEqual({
        billId: data.bill.id,
        draftId: accepted.draft.id,
        ownerId: data[first].id,
        ownerName: first === "ana" ? "Ana" : "Luis",
        edit: accepted.edit,
      });
      expect(await suite.db.select().from(orderDrafts)).toEqual([accepted.draft]);
      expect(await suite.db.select().from(orderDraftLines)).toEqual([accepted.line]);
      expect(await suite.db.select().from(billEditStates)).toEqual([
        { billId: data.bill.id, editorId: data[first].id, editorVersion: 1 },
      ]);
    },
  );

  it("releases only the emptied bill while another editor still has unsent work", async () => {
    const data = await fixture();
    const first = await open(data);
    const second = await open({ ...data, bill: data.other }, data.luis.id);
    const before = await rows();
    await expect(
      inTx(async (tx) => {
        await tx.delete(orderDraftLines).where(eq(orderDraftLines.id, first.line.id));
        return editing.closeBillDraft(tx, data.bill.id, data.ana.id, first.edit, "submitted");
      }),
    ).resolves.toEqual({
      billId: data.bill.id,
      editorId: null,
      editorName: null,
      editorVersion: 2,
      draftId: null,
      draftRevision: null,
    });
    expect(await inTx((tx) => editing.readBillEditState(tx, data.other.id))).toEqual(second.edit);
    const after = await rows();
    expect(after.drafts.filter((row) => row.id === second.draft.id)).toEqual([second.draft]);
    expect(after.lines.filter((row) => row.draftId === second.draft.id)).toEqual([second.line]);
    expect(after.bills).toEqual(before.bills);
    expect(after.charges).toEqual(before.charges);
  });

  it.each(["acquire", "close", "transfer", "relocate"] as const)(
    "rejects an expectation for another bill before %s",
    async (kind) => {
      const data = await fixture();
      const { edit } = await open(data);
      const wrong = { ...edit, billId: data.other.id };
      await refused(
        (tx) => {
          if (kind === "acquire")
            return editing.acquireBillEditor(tx, data.bill.id, data.ana.id, wrong);
          if (kind === "close")
            return editing.closeBillDraft(tx, data.bill.id, data.ana.id, wrong, "discarded");
          if (kind === "transfer")
            return editing.transferBillEditor(tx, data.bill.id, data.luis.id, wrong);
          return editing.relocateBillEditor(tx, data.bill.id, wrong);
        },
        "management.request_invalid",
        { field: "expectedEdit.billId" },
      );
    },
  );

  it("does not take or close an already released bill", async () => {
    const data = await fixture();
    const { line, edit } = await open(data);
    const released = await inTx(async (tx) => {
      await tx.delete(orderDraftLines).where(eq(orderDraftLines.id, line.id));
      return editing.closeBillDraft(tx, data.bill.id, data.ana.id, edit, "submitted");
    });
    const before = await rows();
    expect(
      await inTx((tx) => editing.transferBillEditor(tx, data.bill.id, data.luis.id, released)),
    ).toEqual(released);
    expect(
      await inTx((tx) =>
        editing.closeBillDraft(tx, data.bill.id, data.luis.id, released, "discarded"),
      ),
    ).toEqual(released);
    expect(await rows()).toEqual(before);
  });
});
