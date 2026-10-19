import { eq, sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import type { Transaction } from "../client.js";
import { checkFailed, refusalOn, triggerRaised } from "../constraint-target.js";
import { CORE_MIGRATIONS } from "../migrations.js";
import { FOREIGN_KEY_VIOLATION, UNIQUE_VIOLATION } from "../sql-state.js";
import { captureError } from "../testing/errors.js";
import { useVenueDb } from "../testing/venue-db.js";
import { withTransaction } from "../tenancy.js";
import { isRefusal } from "../unique-violation.js";
import { orderDraftEvents, orderDraftLines, orderDrafts } from "./order-drafts.js";
import { orderGroups } from "./order-groups.js";
import { workingOrders } from "./orders.js";
import { parties } from "./parties.js";
import { locations } from "./tenants.js";

const ALEX = "cccccccc-2222-4000-8000-000000000001";
const SAM = "cccccccc-2222-4000-8000-000000000002";
const MENU_ITEM = "cccccccc-4444-4000-8000-000000000001";
const MISSING = "cccccccc-3333-4000-8000-0000000000ff";

const OPEN_DRAFT_KEY = { table: "order_drafts", columns: ["bill_id"] };

describe("order_drafts, order_draft_lines and order_draft_events", () => {
  const suite = useVenueDb({ migrations: [CORE_MIGRATIONS], resetPerTest: false });

  const inTx = <T>(fn: (tx: Transaction) => Promise<T>): Promise<T> =>
    withTransaction(suite.db, fn);

  const defaultBills = new Map<string, string>();
  async function bill(partyId: string): Promise<string> {
    return inTx(async (tx) => {
      const [location] = await tx
        .insert(locations)
        .values({
          name: "Dining room",
          invoiceLocales: ["en"],
          operationDescription: "Restaurant",
        })
        .returning();
      const [row] = await tx
        .insert(workingOrders)
        .values({
          source: "dashboard",
          locationId: location!.id,
          orderNumber: 1,
          partyId,
        })
        .returning();
      return row!.id;
    });
  }

  async function party(): Promise<string> {
    return inTx(async (tx) => {
      const [row] = await tx
        .insert(parties)
        .values({ openedBy: ALEX })
        .returning({ id: parties.id });
      return row!.id;
    });
  }

  async function draft(
    values: Partial<typeof orderDrafts.$inferInsert> & {
      partyId: string;
      ownerId: string;
      billId?: string;
    },
  ): Promise<string> {
    let billId = values.billId ?? defaultBills.get(values.partyId);
    if (billId === undefined && values.partyId !== MISSING) {
      billId = await bill(values.partyId);
      defaultBills.set(values.partyId, billId);
    }
    return inTx(async (tx) => {
      const [row] = await tx
        .insert(orderDrafts)
        .values({ ...values, billId })
        .returning({ id: orderDrafts.id });
      return row!.id;
    });
  }

  async function setState(id: string, state: "open" | "submitted" | "discarded"): Promise<void> {
    await inTx(async (tx) => {
      await tx.update(orderDrafts).set({ state }).where(eq(orderDrafts.id, id));
    });
  }

  it("starts a draft open at revision 0", async () => {
    const id = await draft({ partyId: await party(), ownerId: ALEX });
    const [row] = await inTx((tx) => tx.select().from(orderDrafts).where(eq(orderDrafts.id, id)));
    expect(row).toMatchObject({ ownerId: ALEX, state: "open", revision: 0 });
  });

  it("keeps the draft's explicit bill identity", async () => {
    const partyId = await party();
    const billId = await bill(partyId);
    const id = await draft({ partyId, ownerId: ALEX, billId });
    const [row] = await inTx((tx) => tx.select().from(orderDrafts).where(eq(orderDrafts.id, id)));
    expect(row).toMatchObject({ billId });
  });

  it("allows one person's open drafts on two different bills of the same party", async () => {
    const partyId = await party();
    const billId = await bill(partyId),
      otherBillId = await bill(partyId);
    await draft({ partyId, ownerId: ALEX, billId });
    await expect(draft({ partyId, ownerId: ALEX, billId: otherBillId })).resolves.toEqual(
      expect.any(String),
    );
    const rows = await inTx((tx) =>
      tx.select().from(orderDrafts).where(eq(orderDrafts.partyId, partyId)),
    );
    expect(rows.map((row) => row.billId).sort()).toEqual([billId, otherBillId].sort());
  });

  it("refuses a draft naming no stored bill", async () => {
    const partyId = await party();
    const error = await captureError(() => draft({ partyId, ownerId: ALEX, billId: MISSING }));
    expect(isRefusal(error, FOREIGN_KEY_VIOLATION)).toBe(true);
  });

  it("refuses a second open draft for one person on one bill", async () => {
    const onParty = await party();
    const billId = await bill(onParty);
    await draft({ partyId: onParty, ownerId: ALEX, billId });
    const error = await captureError(() => draft({ partyId: onParty, ownerId: ALEX, billId }));
    expect(refusalOn(error, UNIQUE_VIOLATION, OPEN_DRAFT_KEY)).toBe(true);
  });

  it("refuses another person's open draft on the same bill", async () => {
    const onParty = await party();
    const billId = await bill(onParty);
    await draft({ partyId: onParty, ownerId: ALEX, billId });
    const error = await captureError(() => draft({ partyId: onParty, ownerId: SAM, billId }));
    expect(refusalOn(error, UNIQUE_VIOLATION, OPEN_DRAFT_KEY)).toBe(true);
    const rows = await inTx((tx) =>
      tx.select().from(orderDrafts).where(eq(orderDrafts.partyId, onParty)),
    );
    expect(rows.map((row) => row.ownerId)).toEqual([ALEX]);
  });

  it("does not allow a different party to bypass the bill's single open draft", async () => {
    const partyId = await party(),
      otherPartyId = await party();
    const billId = await bill(partyId);
    const first = await draft({ partyId, ownerId: ALEX, billId });
    const error = await captureError(() => draft({ partyId: otherPartyId, ownerId: SAM, billId }));
    expect(refusalOn(error, UNIQUE_VIOLATION, OPEN_DRAFT_KEY)).toBe(true);
    expect(
      (await inTx((tx) => tx.select().from(orderDrafts).where(eq(orderDrafts.billId, billId)))).map(
        (row) => row.id,
      ),
    ).toEqual([first]);
  });

  it("allows different editors on different bills at the same party", async () => {
    const partyId = await party();
    const firstBill = await bill(partyId),
      secondBill = await bill(partyId);
    const first = await draft({ partyId, ownerId: ALEX, billId: firstBill });
    const second = await draft({ partyId, ownerId: SAM, billId: secondBill });
    const rows = await inTx((tx) =>
      tx.select().from(orderDrafts).where(eq(orderDrafts.partyId, partyId)),
    );
    expect(rows.map((row) => [row.id, row.billId, row.ownerId]).sort()).toEqual(
      [
        [first, firstBill, ALEX],
        [second, secondBill, SAM],
      ].sort(),
    );
  });

  it("refuses moving an open draft into a bill with another editor's open draft", async () => {
    const partyId = await party();
    const firstBill = await bill(partyId),
      secondBill = await bill(partyId);
    await draft({ partyId, ownerId: ALEX, billId: firstBill });
    const second = await draft({ partyId, ownerId: SAM, billId: secondBill });
    const before = await inTx((tx) =>
      tx.select().from(orderDrafts).where(eq(orderDrafts.partyId, partyId)),
    );
    const error = await captureError(() =>
      inTx((tx) =>
        tx.update(orderDrafts).set({ billId: firstBill }).where(eq(orderDrafts.id, second)),
      ),
    );
    expect(refusalOn(error, UNIQUE_VIOLATION, OPEN_DRAFT_KEY)).toBe(true);
    expect(
      await inTx((tx) => tx.select().from(orderDrafts).where(eq(orderDrafts.partyId, partyId))),
    ).toEqual(before);
  });

  it.each(["submitted", "discarded"] as const)(
    "allows another editor after %s, but refuses reopening the old draft",
    async (state) => {
      const partyId = await party(),
        billId = await bill(partyId);
      const first = await draft({ partyId, ownerId: ALEX, billId });
      await setState(first, state);
      const second = await draft({ partyId, ownerId: SAM, billId });
      const before = await inTx((tx) =>
        tx.select().from(orderDrafts).where(eq(orderDrafts.billId, billId)),
      );
      const error = await captureError(() => setState(first, "open"));
      expect(refusalOn(error, UNIQUE_VIOLATION, OPEN_DRAFT_KEY)).toBe(true);
      expect(
        await inTx((tx) => tx.select().from(orderDrafts).where(eq(orderDrafts.billId, billId))),
      ).toEqual(before);
      expect(before.map((row) => [row.id, row.state, row.ownerId]).sort()).toEqual(
        [
          [first, state, ALEX],
          [second, "open", SAM],
        ].sort(),
      );
    },
  );

  it.each(["submitted", "discarded"] as const)(
    "allows a new open draft once the person's first is %s",
    async (state) => {
      const onParty = await party();
      const billId = await bill(onParty);
      const first = await draft({ partyId: onParty, ownerId: ALEX, billId });
      await setState(first, state);
      const second = await draft({ partyId: onParty, ownerId: ALEX, billId });
      // Reopening the first would make two open drafts again.
      const error = await captureError(() => setState(first, "open"));
      expect(refusalOn(error, UNIQUE_VIOLATION, OPEN_DRAFT_KEY)).toBe(true);
      expect(second).not.toBe(first);
    },
  );

  it("refuses a state outside the vocabulary", async () => {
    const id = await draft({ partyId: await party(), ownerId: ALEX });
    const error = await captureError(() =>
      inTx(async (tx) => {
        await tx.execute(sql`update order_drafts set state = 'sent' where id = ${id}`);
      }),
    );
    expect(checkFailed(error, "order_drafts_state_ck")).toBe(true);
  });

  it("refuses a draft naming no party", async () => {
    const error = await captureError(() => draft({ partyId: MISSING, ownerId: ALEX }));
    expect(isRefusal(error, FOREIGN_KEY_VIOLATION)).toBe(true);
  });

  it("stores a line's options, extras and flags as written, and refuses one naming no draft", async () => {
    const draftId = await draft({ partyId: await party(), ownerId: ALEX });
    const line = {
      position: 1,
      menuItemId: MENU_ITEM,
      options: [{ listId: "l1", labelId: "rare" }],
      extras: [{ listId: "toppings", picks: [{ productId: "cheese", quantity: 2 }] }],
      quantity: 3000,
    };
    await inTx((tx) => tx.insert(orderDraftLines).values({ ...line, draftId }));
    const [row] = await inTx((tx) =>
      tx.select().from(orderDraftLines).where(eq(orderDraftLines.draftId, draftId)),
    );
    expect(row).toMatchObject({
      ...line,
      variantId: null,
      menuVersionId: null,
      note: null,
      courseId: null,
      noMerge: false,
    });
    const error = await captureError(() =>
      inTx((tx) => tx.insert(orderDraftLines).values({ ...line, draftId: MISSING })),
    );
    expect(isRefusal(error, FOREIGN_KEY_VIOLATION)).toBe(true);
  });

  it("refuses a line with a quantity of zero or less", async () => {
    const draftId = await draft({ partyId: await party(), ownerId: ALEX });
    const line = { draftId, position: 1, menuItemId: MENU_ITEM, options: [], extras: [] };
    for (const quantity of [0, -1000]) {
      const error = await captureError(() =>
        inTx((tx) => tx.insert(orderDraftLines).values({ ...line, quantity })),
      );
      expect(checkFailed(error, "order_draft_lines_quantity_ck")).toBe(true);
    }
  });

  it("refuses a line naming no kitchen course", async () => {
    const draftId = await draft({ partyId: await party(), ownerId: ALEX });
    const error = await captureError(() =>
      inTx((tx) =>
        tx.insert(orderDraftLines).values({
          draftId,
          position: 1,
          menuItemId: MENU_ITEM,
          options: [],
          extras: [],
          quantity: 1000,
          courseId: MISSING,
        }),
      ),
    );
    expect(isRefusal(error, FOREIGN_KEY_VIOLATION)).toBe(true);
  });

  describe("draft line placement", () => {
    async function lineOnParty() {
      const partyId = await party();
      const draftId = await draft({ partyId, ownerId: ALEX });
      const [group] = await inTx((tx) =>
        tx
          .insert(orderGroups)
          .values({ partyId, position: 1, state: "held", submittedBy: ALEX })
          .returning({ id: orderGroups.id }),
      );
      return {
        groupId: group!.id,
        line: {
          draftId,
          position: 1,
          menuItemId: MENU_ITEM,
          options: [],
          extras: [],
          quantity: 1000,
        },
      };
    }

    it("defaults a line to Fire now without a held-group destination", async () => {
      const { line } = await lineOnParty();
      const [row] = await inTx((tx) => tx.insert(orderDraftLines).values(line).returning());
      expect(row).toMatchObject({ slot: 0, joinGroupId: null, afterGroupId: null });
    });

    it.each(["join", "after", "new"] as const)("stores a line's %s placement", async (place) => {
      const { line, groupId } = await lineOnParty();
      const destination = {
        slot: place === "join" ? 0 : 2,
        joinGroupId: place === "join" ? groupId : null,
        afterGroupId: place === "after" ? groupId : null,
      };
      const [inserted] = await inTx((tx) =>
        tx
          .insert(orderDraftLines)
          .values({ ...line, ...destination })
          .returning(),
      );
      const [row] = await inTx((tx) =>
        tx.select().from(orderDraftLines).where(eq(orderDraftLines.id, inserted!.id)),
      );
      expect(row).toMatchObject(destination);
    });

    it.each(["joinGroupId", "afterGroupId"] as const)(
      "refuses a %s naming no stored group",
      async (field) => {
        const { line } = await lineOnParty();
        const error = await captureError(() =>
          inTx((tx) =>
            tx.insert(orderDraftLines).values({
              ...line,
              slot: field === "afterGroupId" ? 1 : 0,
              [field]: MISSING,
            }),
          ),
        );
        expect(isRefusal(error, FOREIGN_KEY_VIOLATION)).toBe(true);
      },
    );

    it.each([
      { slot: -1, join: false, after: false, check: "order_draft_lines_slot_ck" },
      { slot: 1, join: true, after: false, check: "order_draft_lines_place_ck" },
      { slot: 0, join: false, after: true, check: "order_draft_lines_after_ck" },
    ])("refuses a destination breaking $check", async ({ slot, join, after, check }) => {
      const { line, groupId } = await lineOnParty();
      const error = await captureError(() =>
        inTx((tx) =>
          tx.insert(orderDraftLines).values({
            ...line,
            slot,
            joinGroupId: join ? groupId : null,
            afterGroupId: after ? groupId : null,
          }),
        ),
      );
      expect(checkFailed(error, check)).toBe(true);
    });
  });

  describe("order_draft_events", () => {
    async function event(): Promise<string> {
      const draftId = await draft({ partyId: await party(), ownerId: ALEX });
      return inTx(async (tx) => {
        const [row] = await tx
          .insert(orderDraftEvents)
          .values({
            draftId,
            kind: "taken_over",
            fromPerson: ALEX,
            toPerson: SAM,
            actorId: SAM,
            detail: {},
          })
          .returning({ id: orderDraftEvents.id });
        return row!.id;
      });
    }

    it("refuses an UPDATE and leaves the row as written", async () => {
      const id = await event();
      const error = await captureError(() =>
        inTx(async (tx) => {
          await tx
            .update(orderDraftEvents)
            .set({ toPerson: ALEX })
            .where(eq(orderDraftEvents.id, id));
        }),
      );
      expect(triggerRaised(error, "order_draft_events is append-only")).toBe(true);
      const [row] = await inTx((tx) =>
        tx.select().from(orderDraftEvents).where(eq(orderDraftEvents.id, id)),
      );
      expect(row).toMatchObject({ kind: "taken_over", fromPerson: ALEX, toPerson: SAM });
    });

    it("refuses a DELETE and leaves the row in place", async () => {
      const id = await event();
      const error = await captureError(() =>
        inTx(async (tx) => {
          await tx.delete(orderDraftEvents).where(eq(orderDraftEvents.id, id));
        }),
      );
      expect(triggerRaised(error, "order_draft_events is append-only")).toBe(true);
      const rows = await inTx((tx) =>
        tx.select().from(orderDraftEvents).where(eq(orderDraftEvents.id, id)),
      );
      expect(rows).toHaveLength(1);
    });

    it("refuses a kind outside the vocabulary, and an event naming no draft", async () => {
      const kindError = await captureError(() =>
        inTx(async (tx) => {
          await tx.execute(sql`
            insert into order_draft_events (id, draft_id, kind, to_person, actor_id, detail, created_at)
            values (${MISSING}, ${MISSING}, 'renamed', ${ALEX}, ${ALEX}, '{}', ${new Date().toISOString()})
          `);
        }),
      );
      expect(checkFailed(kindError, "order_draft_events_kind_ck")).toBe(true);
      const keyError = await captureError(() =>
        inTx((tx) =>
          tx.insert(orderDraftEvents).values({
            draftId: MISSING,
            kind: "created",
            toPerson: ALEX,
            actorId: ALEX,
            detail: {},
          }),
        ),
      );
      expect(isRefusal(keyError, FOREIGN_KEY_VIOLATION)).toBe(true);
    });
  });
});
