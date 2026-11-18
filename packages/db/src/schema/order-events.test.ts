import { sql } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { checkFailed } from "../constraint-target.js";
import { CORE_MIGRATIONS } from "../migrations.js";
import { FOREIGN_KEY_VIOLATION } from "../sql-state.js";
import { captureError } from "../testing/errors.js";
import { seedPerson, seedVenue, seedWorkingOrder } from "../testing/seed.js";
import { useVenueDb } from "../testing/venue-db.js";
import { isRefusal } from "../unique-violation.js";
import { newId } from "./columns.js";
import { orderDrafts } from "./order-drafts.js";
import { parties } from "./parties.js";

const AT = "2026-10-27T12:00:00.000Z";
const ACTOR = "bbbbbbbb-2222-4000-8000-000000000001";
const MISSING = "bbbbbbbb-2222-4000-8000-0000000000ff";

describe("order events", () => {
  const suite = useVenueDb({ migrations: [CORE_MIGRATIONS], resetPerTest: false });
  let partyId: string;
  let draftId: string;

  beforeAll(async () => {
    const db = suite.db;
    await seedVenue(db, { name: "Dining room", invoiceLocales: ["en"] });
    await seedPerson(db, { id: ACTOR });
    partyId = newId();
    draftId = newId();
    await db.insert(parties).values({ id: partyId, openedBy: ACTOR });
    const bill = await seedWorkingOrder(db, { source: "dashboard", partyId });
    await db.insert(orderDrafts).values({ id: draftId, billId: bill.id, partyId, ownerId: ACTOR });
  });

  it("keeps a cancelled dish's identity and refuses a dish event without that identity or order", async () => {
    const insert = (lineId: string | null, orderId: string | null) =>
      suite.db.get<{ line_id: string; detail: string }>(sql`
        insert into order_events (id, kind, at, line_id, from_order_id)
        values (${newId()}, 'dish.cancelled', ${AT}, ${lineId}, ${orderId})
        returning line_id, detail
      `);
    expect(insert("removed-dish", "removed-order")).toEqual({
      line_id: "removed-dish",
      detail: "{}",
    });
    for (const [lineId, orderId] of [
      [null, "removed-order"],
      ["removed-dish", null],
    ] as const) {
      expect(
        checkFailed(await captureError(() => insert(lineId, orderId)), "order_events_dish_ck"),
      ).toBe(true);
    }
  });

  it("keeps a reorder without a group and refuses one without a party", async () => {
    const insert = (party: string | null) =>
      suite.db.get<{ group_id: string | null }>(sql`
        insert into order_events (id, kind, at, party_id, actor_id)
        values (${newId()}, 'group.reordered', ${AT}, ${party}, ${ACTOR})
        returning group_id
      `);
    expect(insert(partyId)).toEqual({ group_id: null });
    expect(checkFailed(await captureError(() => insert(null)), "order_events_group_ck")).toBe(true);
  });

  it("requires a draft, actor and new owner on a draft event", async () => {
    const insert = (draft: string | null, actor: string | null, owner: string | null) =>
      suite.db.get<{ to_person: string }>(sql`
        insert into order_events (id, kind, at, draft_id, actor_id, to_person)
        values (${newId()}, 'draft.created', ${AT}, ${draft}, ${actor}, ${owner})
        returning to_person
      `);
    expect(insert(draftId, ACTOR, ACTOR)).toEqual({ to_person: ACTOR });
    for (const [draft, actor, owner] of [
      [null, ACTOR, ACTOR],
      [draftId, null, ACTOR],
      [draftId, ACTOR, null],
    ] as const) {
      const error = await captureError(() => insert(draft, actor, owner));
      expect(checkFailed(error, "order_events_draft_ck")).toBe(true);
    }
  });

  it("refuses to credit a dish event to a person who does not exist", async () => {
    const insert = (actor: string) =>
      suite.db.get<{ actor_id: string }>(sql`
        insert into order_events (id, kind, at, line_id, from_order_id, actor_id)
        values (${newId()}, 'dish.cancelled', ${AT}, 'dish', 'order', ${actor})
        returning actor_id
      `);
    expect(insert(ACTOR)).toEqual({ actor_id: ACTOR });
    expect(isRefusal(await captureError(() => insert(MISSING)), FOREIGN_KEY_VIOLATION)).toBe(true);
  });
});
