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
import { visits } from "./visits.js";

const ALEX = "cccccccc-2222-4000-8000-000000000001";
const SAM = "cccccccc-2222-4000-8000-000000000002";
const MENU_ITEM = "cccccccc-4444-4000-8000-000000000001";
const MISSING = "cccccccc-3333-4000-8000-0000000000ff";

const OPEN_DRAFT_KEY = { table: "order_drafts", columns: ["visit_id", "owner_id"] };

describe("order_drafts, order_draft_lines and order_draft_events", () => {
  const suite = useVenueDb({ migrations: [CORE_MIGRATIONS], resetPerTest: false });

  const inTx = <T>(fn: (tx: Transaction) => Promise<T>): Promise<T> =>
    withTransaction(suite.db, fn);

  async function visit(): Promise<string> {
    return inTx(async (tx) => {
      const [row] = await tx.insert(visits).values({ openedBy: ALEX }).returning({ id: visits.id });
      return row!.id;
    });
  }

  async function draft(
    values: Partial<typeof orderDrafts.$inferInsert> & { visitId: string; ownerId: string },
  ): Promise<string> {
    return inTx(async (tx) => {
      const [row] = await tx.insert(orderDrafts).values(values).returning({ id: orderDrafts.id });
      return row!.id;
    });
  }

  async function setState(id: string, state: "open" | "submitted" | "discarded"): Promise<void> {
    await inTx(async (tx) => {
      await tx.update(orderDrafts).set({ state }).where(eq(orderDrafts.id, id));
    });
  }

  it("starts a draft open at revision 0", async () => {
    const id = await draft({ visitId: await visit(), ownerId: ALEX });
    const [row] = await inTx((tx) => tx.select().from(orderDrafts).where(eq(orderDrafts.id, id)));
    expect(row).toMatchObject({ ownerId: ALEX, state: "open", revision: 0 });
  });

  it("refuses a second open draft for one person on one visit", async () => {
    const onVisit = await visit();
    await draft({ visitId: onVisit, ownerId: ALEX });
    const error = await captureError(() => draft({ visitId: onVisit, ownerId: ALEX }));
    expect(refusalOn(error, UNIQUE_VIOLATION, OPEN_DRAFT_KEY)).toBe(true);
  });

  it("allows another person's open draft on the same visit", async () => {
    const onVisit = await visit();
    await draft({ visitId: onVisit, ownerId: ALEX });
    await draft({ visitId: onVisit, ownerId: SAM });
    const rows = await inTx((tx) =>
      tx.select().from(orderDrafts).where(eq(orderDrafts.visitId, onVisit)),
    );
    expect(rows.map((row) => row.ownerId).sort()).toEqual([ALEX, SAM].sort());
  });

  it.each(["submitted", "discarded"] as const)(
    "allows a new open draft once the person's first is %s",
    async (state) => {
      const onVisit = await visit();
      const first = await draft({ visitId: onVisit, ownerId: ALEX });
      await setState(first, state);
      const second = await draft({ visitId: onVisit, ownerId: ALEX });
      // Reopening the first would make two open drafts again.
      const error = await captureError(() => setState(first, "open"));
      expect(refusalOn(error, UNIQUE_VIOLATION, OPEN_DRAFT_KEY)).toBe(true);
      expect(second).not.toBe(first);
    },
  );

  it("refuses a state outside the vocabulary", async () => {
    const id = await draft({ visitId: await visit(), ownerId: ALEX });
    const error = await captureError(() =>
      inTx(async (tx) => {
        await tx.execute(sql`update order_drafts set state = 'sent' where id = ${id}`);
      }),
    );
    expect(checkFailed(error, "order_drafts_state_ck")).toBe(true);
  });

  it("refuses a draft naming no visit", async () => {
    const error = await captureError(() => draft({ visitId: MISSING, ownerId: ALEX }));
    expect(isRefusal(error, FOREIGN_KEY_VIOLATION)).toBe(true);
  });

  it("stores a line's options, extras and flags as written, and refuses one naming no draft", async () => {
    const draftId = await draft({ visitId: await visit(), ownerId: ALEX });
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
    const draftId = await draft({ visitId: await visit(), ownerId: ALEX });
    const line = { draftId, position: 1, menuItemId: MENU_ITEM, options: [], extras: [] };
    for (const quantity of [0, -1000]) {
      const error = await captureError(() =>
        inTx((tx) => tx.insert(orderDraftLines).values({ ...line, quantity })),
      );
      expect(checkFailed(error, "order_draft_lines_quantity_ck")).toBe(true);
    }
  });

  it("refuses a line naming no kitchen course", async () => {
    const draftId = await draft({ visitId: await visit(), ownerId: ALEX });
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

  describe("order_draft_events", () => {
    async function event(): Promise<string> {
      const draftId = await draft({ visitId: await visit(), ownerId: ALEX });
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
