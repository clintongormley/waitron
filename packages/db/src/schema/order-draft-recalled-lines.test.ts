import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import type { Transaction } from "../client.js";
import { checkFailed, refusalOn } from "../constraint-target.js";
import { CORE_MIGRATIONS } from "../migrations.js";
import { FOREIGN_KEY_VIOLATION, UNIQUE_VIOLATION } from "../sql-state.js";
import { captureError } from "../testing/errors.js";
import { useVenueDb } from "../testing/venue-db.js";
import { withTransaction } from "../tenancy.js";
import { isRefusal } from "../unique-violation.js";
import { orderDrafts } from "./order-drafts.js";
import { orderGroups } from "./order-groups.js";
import { workingOrderLines, workingOrders } from "./orders.js";
import { parties } from "./parties.js";
import { locations } from "./tenants.js";

const OWNER = "cccccccc-2222-4000-8000-000000000001";
const COLLEAGUE = "cccccccc-2222-4000-8000-000000000002";
const MISSING = "cccccccc-3333-4000-8000-0000000000ff";

interface Reservation {
  id: string;
  draftId: string;
  sourceLineId: string;
  position: number;
  slot?: number;
  joinGroupId?: string | null;
  afterGroupId?: string | null;
}

describe("recalled draft line reservations", () => {
  const suite = useVenueDb({ migrations: [CORE_MIGRATIONS], resetPerTest: false });
  const inTx = <T>(fn: (tx: Transaction) => Promise<T> | T): Promise<T> =>
    withTransaction(suite.db, async (tx) => await fn(tx));

  async function fixture() {
    return inTx(async (tx) => {
      const [location] = await tx
        .insert(locations)
        .values({
          name: "Dining room",
          invoiceLocales: ["en"],
          operationDescription: "Restaurant",
        })
        .returning();
      const [party] = await tx.insert(parties).values({ openedBy: OWNER }).returning();
      const [bill] = await tx
        .insert(workingOrders)
        .values({
          source: "dashboard",
          locationId: location!.id,
          orderNumber: 1,
          partyId: party!.id,
        })
        .returning();
      const [source] = await tx
        .insert(workingOrderLines)
        .values({
          workingOrderId: bill!.id,
          lineNo: 1,
          name: "Recorded dish",
          descriptions: { en: "Recorded dish" },
          quantity: 2000,
          priceQuantity: 1000,
          unitPriceGross: 750,
          listUnitPriceGross: 1000,
          vatClass: "reduced",
          lineTotal: 1500,
          note: "Recorded note",
          optionSnapshots: [],
        })
        .returning();
      const [draft] = await tx
        .insert(orderDrafts)
        .values({
          partyId: party!.id,
          billId: bill!.id,
          ownerId: OWNER,
        })
        .returning();
      const [otherBill] = await tx
        .insert(workingOrders)
        .values({
          source: "dashboard",
          locationId: location!.id,
          orderNumber: 2,
          partyId: party!.id,
        })
        .returning();
      const [otherDraft] = await tx
        .insert(orderDrafts)
        .values({
          partyId: party!.id,
          billId: otherBill!.id,
          ownerId: COLLEAGUE,
        })
        .returning();
      const [group] = await tx
        .insert(orderGroups)
        .values({
          partyId: party!.id,
          position: 1,
          state: "held",
          submittedBy: OWNER,
        })
        .returning();
      return {
        source: source!,
        otherDraftId: otherDraft!.id,
        groupId: group!.id,
        reservation: {
          id: randomUUID(),
          draftId: draft!.id,
          sourceLineId: source!.id,
          position: 2,
        },
      };
    });
  }

  async function reserve(line: Reservation) {
    return inTx((tx) =>
      tx.execute(sql`
      insert into order_draft_recalled_lines
        (id, draft_id, source_line_id, position, slot, join_group_id, after_group_id)
      values (${line.id}, ${line.draftId}, ${line.sourceLineId}, ${line.position},
        ${line.slot ?? 0}, ${line.joinGroupId ?? null}, ${line.afterGroupId ?? null})
      returning *
    `),
    );
  }

  async function references(sourceId: string) {
    return (
      await suite.db.execute(sql`
      select * from order_draft_recalled_lines where source_line_id = ${sourceId}
    `)
    ).rows;
  }

  it("stores a source identity and position without menu context or a second bill charge", async () => {
    const { reservation, source } = await fixture();
    await expect(reserve(reservation)).resolves.toMatchObject({
      rows: [
        {
          id: reservation.id,
          draft_id: reservation.draftId,
          source_line_id: source.id,
          position: 2,
          slot: 0,
          join_group_id: null,
          after_group_id: null,
        },
      ],
    });
    expect(await references(source.id)).toHaveLength(1);
    expect(
      await suite.db
        .select()
        .from(workingOrderLines)
        .where(eq(workingOrderLines.workingOrderId, source.workingOrderId)),
    ).toEqual([source]);
  });

  it("defaults a reservation to Fire now", async () => {
    const { reservation } = await fixture();
    await expect(
      inTx((tx) =>
        tx.execute(sql`
      insert into order_draft_recalled_lines (id, draft_id, source_line_id, position)
      values (${reservation.id}, ${reservation.draftId}, ${reservation.sourceLineId}, 0)
      returning slot, join_group_id, after_group_id
    `),
      ),
    ).resolves.toMatchObject({ rows: [{ slot: 0, join_group_id: null, after_group_id: null }] });
  });

  it.each(["join", "new", "after"] as const)("retains a %s destination", async (place) => {
    const { reservation, groupId } = await fixture();
    const destination = {
      slot: place === "join" ? 0 : 3,
      joinGroupId: place === "join" ? groupId : null,
      afterGroupId: place === "after" ? groupId : null,
    };
    await expect(reserve({ ...reservation, ...destination })).resolves.toMatchObject({
      rows: [
        {
          slot: destination.slot,
          join_group_id: destination.joinGroupId,
          after_group_id: destination.afterGroupId,
        },
      ],
    });
  });

  it.each(["draftId", "sourceLineId", "joinGroupId", "afterGroupId"] as const)(
    "refuses a missing %s",
    async (field) => {
      const { reservation } = await fixture();
      const error = await captureError(() =>
        reserve({
          ...reservation,
          slot: field === "afterGroupId" ? 1 : 0,
          [field]: MISSING,
        }),
      );
      expect(isRefusal(error, FOREIGN_KEY_VIOLATION)).toBe(true);
      expect(await references(reservation.sourceLineId)).toEqual([]);
    },
  );

  it.each([
    { slot: -1, join: false, after: false, check: "order_draft_recalled_lines_slot_ck" },
    { slot: 1, join: true, after: false, check: "order_draft_recalled_lines_place_ck" },
    { slot: 0, join: false, after: true, check: "order_draft_recalled_lines_after_ck" },
  ])("refuses a destination breaking $check", async ({ slot, join, after, check }) => {
    const { reservation, groupId } = await fixture();
    const error = await captureError(() =>
      reserve({
        ...reservation,
        slot,
        joinGroupId: join ? groupId : null,
        afterGroupId: after ? groupId : null,
      }),
    );
    expect(checkFailed(error, check)).toBe(true);
    expect(await references(reservation.sourceLineId)).toEqual([]);
  });

  it.each([false, true])(
    "reserves a source only once, including another owner: %s",
    async (otherOwner) => {
      const { reservation, otherDraftId } = await fixture();
      await expect(reserve(reservation)).resolves.toMatchObject({ rows: [{ id: reservation.id }] });
      const error = await captureError(() =>
        reserve({
          ...reservation,
          id: randomUUID(),
          draftId: otherOwner ? otherDraftId : reservation.draftId,
        }),
      );
      expect(
        refusalOn(error, UNIQUE_VIOLATION, {
          table: "order_draft_recalled_lines",
          columns: ["source_line_id"],
        }),
      ).toBe(true);
      expect(await references(reservation.sourceLineId)).toHaveLength(1);
    },
  );

  it("moves the reservation in place and releases it without changing the priced source", async () => {
    const { reservation, otherDraftId, source, groupId } = await fixture();
    await expect(
      reserve({ ...reservation, slot: 3, afterGroupId: groupId }),
    ).resolves.toMatchObject({ rows: [{ id: reservation.id }] });
    await inTx((tx) =>
      tx.execute(sql`
      update order_draft_recalled_lines set draft_id = ${otherDraftId} where id = ${reservation.id}
    `),
    );
    expect(await references(source.id)).toEqual([
      {
        id: reservation.id,
        draft_id: otherDraftId,
        source_line_id: source.id,
        position: 2,
        slot: 3,
        join_group_id: null,
        after_group_id: groupId,
      },
    ]);
    await inTx((tx) =>
      tx.execute(sql`
      delete from order_draft_recalled_lines where id = ${reservation.id}
    `),
    );
    expect(await references(source.id)).toEqual([]);
    expect(
      await suite.db
        .select()
        .from(workingOrderLines)
        .where(eq(workingOrderLines.workingOrderId, source.workingOrderId)),
    ).toEqual([source]);
    await expect(
      reserve({ ...reservation, id: randomUUID(), draftId: otherDraftId }),
    ).resolves.toMatchObject({ rows: [{ draft_id: otherDraftId, source_line_id: source.id }] });
  });

  it("removes the reservation when its original bill line is deleted", async () => {
    const { reservation } = await fixture();
    await expect(reserve(reservation)).resolves.toMatchObject({ rows: [{ id: reservation.id }] });
    await inTx((tx) =>
      tx.delete(workingOrderLines).where(eq(workingOrderLines.id, reservation.sourceLineId)),
    );
    expect(await references(reservation.sourceLineId)).toEqual([]);
  });
});
