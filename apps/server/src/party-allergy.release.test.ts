import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import { workingOrderLines, workingOrders, products } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import type { AllergyCommand, AllergyPatch } from "@waitron/module";
import { createCourse, setProductCourse } from "./kitchen.js";
import { readBillEditState } from "./bill-editing.js";
import { fireGroup, fireHeldLine } from "./order-groups.js";
import { addTabRound, fireCourse, fireLines, fireOrderLines, sendLines } from "./working-order.js";
import { VENUE_SERVICE } from "./modules.js";
import { placeGroups } from "./testing/group-submit-fixture.js";
import {
  OPERATOR,
  counterOrder,
  inTx,
  revisionOf,
  seat,
  setupPartyVenue,
  split,
  type PartyVenue,
} from "./testing/party-venue.js";

let v: PartyVenue;
let mains: string;
useVenueDb({
  migrations: migrationOptionsFor(manifestSets(), null),
  resetPerTest: false,
  setup: async (db) => {
    v = await setupPartyVenue(db);
    await inTx(v, async (tx) => {
      await createCourse(tx, v.cfg, { name: "Starters", displayOrder: 0 });
      mains = (await createCourse(tx, v.cfg, { name: "Mains", displayOrder: 1 })).id;
      await setProductCourse(tx, v.cfg, v.productId("Burger"), mains);
      await setProductCourse(tx, v.cfg, v.productId("Flan"), mains);
    });
  },
});

const none: AllergyPatch = { party: { answer: "none", guests: [] }, ticks: [] };
async function fixture(ungrouped = false, multiBill = false) {
  const p = await seat(v, await v.table(`Release ${randomUUID().slice(0, 8)}`));
  await inTx(v, (tx) =>
    VENUE_SERVICE.writePartyAllergy(tx, p.partyId, { answer: "none", guests: [] }, OPERATOR),
  );
  const placed = await inTx(v, (tx) =>
    placeGroups(tx, v.cfg, p.partyId, {
      operatorId: OPERATOR,
      billId: p.tabId,
      groups: [
        {
          release: "hold",
          lines: [
            { menuItemId: v.item("Flan"), quantity: "1" },
            { menuItemId: v.item("Burger"), quantity: "1" },
          ],
        },
      ],
    }),
  );
  const lines = await v.db
    .select()
    .from(workingOrderLines)
    .where(eq(workingOrderLines.workingOrderId, p.tabId));
  const otherBill = multiBill ? await split(v, p.partyId, p.tabId, [lines[1]!.lineNo]) : null;
  if (ungrouped)
    await v.db
      .update(workingOrderLines)
      .set({ groupId: null })
      .where(eq(workingOrderLines.workingOrderId, p.tabId));
  await v.db.run(sql`delete from party_allergy where party_id = ${p.partyId}`);
  return {
    ...p,
    groupId: placed.groups[0]!.id,
    lineId: lines[0]!.id,
    otherLineId: lines[1]!.id,
    otherBill,
  };
}
type Fixture = Awaited<ReturnType<typeof fixture>>;
async function command(p: Fixture, allergy?: AllergyPatch) {
  return {
    submissionId: randomUUID(),
    expectedPartyRevision: await revisionOf(v, p.partyId),
    operatorId: OPERATOR,
    ...(allergy === undefined ? {} : { allergy }),
  };
}
function frozen() {
  return Object.fromEntries(
    v.db
      .all<{ name: string }>(sql`select name from sqlite_master where type='table' order by name`)
      .map(({ name }) => [
        name,
        v.db.all(sql`select * from ${sql.identifier(name)} order by rowid`),
      ]),
  );
}
async function run(p: Fixture, path: string, ask?: AllergyCommand) {
  const groupAsk = { ...(ask ?? (await command(p))), operatorId: OPERATOR };
  return inTx(v, async (tx) => {
    const authority = { operatorId: OPERATOR, expectedEdit: await readBillEditState(tx, p.tabId) };
    if (path === "group") return fireGroup(tx, v.cfg, p.partyId, p.groupId, groupAsk);
    if (path === "held-line") return fireHeldLine(tx, v.cfg, p.partyId, p.lineId, groupAsk);
    if (path === "course")
      return fireCourse(tx, v.cfg, p.tabId, mains, { personId: OPERATOR }, undefined, ask);
    if (path === "lower") return fireOrderLines(tx, v.cfg, p.tabId, [p.lineId]);
    return sendLines(
      tx,
      v.cfg,
      p.tabId,
      path === "all" ? [] : path === "missing" ? [999] : [1],
      authority,
      undefined,
      ask,
    );
  });
}

describe("A669 release matrix", () => {
  it("a missing named line is a no-op without an answer, while a mixed selection still checks real work", async () => {
    const p = await fixture(true);
    const before = frozen();
    await run(p, "missing");
    expect(frozen()).toEqual(before);
    const authority = {
      operatorId: OPERATOR,
      expectedEdit: await inTx(v, (tx) => readBillEditState(tx, p.tabId)),
    };
    await expect(
      inTx(v, (tx) => sendLines(tx, v.cfg, p.tabId, [999, 1], authority)),
    ).rejects.toMatchObject({ code: "allergy.unanswered" });
    expect(frozen()).toEqual(before);
  });
  it("the raw round writer refuses an unanswered party before any kitchen write", async () => {
    const p = await seat(v, await v.table(`Raw round ${randomUUID().slice(0, 8)}`));
    const expectedEdit = await inTx(v, (tx) => readBillEditState(tx, p.tabId));
    const before = frozen();
    await expect(
      inTx(v, (tx) =>
        addTabRound(tx, v.cfg, p.tabId, [{ menuItemId: v.item("Burger"), quantity: "1" }], {
          operatorId: OPERATOR,
          expectedEdit,
        }),
      ),
    ).rejects.toMatchObject({ code: "allergy.unanswered" });
    expect(frozen()).toEqual(before);
  });

  it("the lowest kitchen writer refuses an unanswered party with no partial output", async () => {
    const p = await seat(v, await v.table(`Low writer ${randomUUID().slice(0, 8)}`));
    const billId = await counterOrder(v, "Burger");
    await v.db
      .update(workingOrders)
      .set({ partyId: p.partyId })
      .where(eq(workingOrders.id, billId));
    const lines = await v.db
      .select()
      .from(workingOrderLines)
      .where(eq(workingOrderLines.workingOrderId, billId));
    const before = frozen();
    await expect(inTx(v, (tx) => fireLines(tx, v.cfg, billId, lines))).rejects.toMatchObject({
      code: "allergy.unanswered",
    });
    expect(frozen()).toEqual(before);
  });

  it("the lowest kitchen writer still accepts a counter dish with no allergy state", async () => {
    const billId = await counterOrder(v, "Burger");
    const lines = await v.db
      .select()
      .from(workingOrderLines)
      .where(eq(workingOrderLines.workingOrderId, billId));
    expect(await inTx(v, (tx) => fireLines(tx, v.cfg, billId, lines))).toEqual([]);
    const [stored] = await v.db
      .select()
      .from(workingOrderLines)
      .where(eq(workingOrderLines.id, lines[0]!.id));
    expect(stored!.sentAt).not.toBeNull();
  });

  it("an empty kitchen write needs no answer and changes no rows", async () => {
    const p = await seat(v, await v.table(`Empty round ${randomUUID().slice(0, 8)}`));
    const before = frozen();
    expect(await inTx(v, (tx) => fireLines(tx, v.cfg, p.tabId, []))).toEqual([]);
    expect(frozen()).toEqual(before);
  });

  for (const path of ["line", "all", "group", "course", "held-line", "lower"]) {
    it(`${path} refuses unanswered with no database writes`, async () => {
      const p = await fixture(["line", "all", "lower"].includes(path), path === "group");
      const before = frozen();
      await expect(run(p, path)).rejects.toMatchObject({ code: "allergy.unanswered" });
      expect(frozen()).toEqual(before);
    });
  }
  for (const path of ["line", "all", "group", "held-line", "course"]) {
    it(`${path} saves answer and ticks atomically and exact replay writes nothing`, async () => {
      const p = await fixture(path === "line" || path === "all");
      const ask = await command(p, {
        party: {
          answer: "allergies",
          guests: [{ who: "Alex", allergens: { milk: {} }, note: "Guest note" }],
        },
        ticks: [{ line: { kind: "working", id: p.lineId }, guestIndex: 0 }],
      });
      await run(p, path, ask);
      const snapshot = await inTx(v, (tx) => VENUE_SERVICE.readPartyAllergy(tx, p.partyId));
      expect(snapshot.answer).toBe("allergies");
      expect(snapshot.ticks).toEqual([
        { draftLineId: null, workingLineId: p.lineId, guestId: snapshot.guests[0]!.id },
      ]);
      expect(await revisionOf(v, p.partyId)).toBe(ask.expectedPartyRevision + 1);
      const after = frozen();
      await run(p, path, ask);
      expect(frozen()).toEqual(after);
      await expect(run(p, path, { ...ask, allergy: none })).rejects.toMatchObject({
        code: "submission.id_reused",
      });
      expect(frozen()).toEqual(after);
    });
  }
  for (const shape of ["grouped", "ungrouped", "mixed"]) {
    it(`course owns exactly one party revision for ${shape} work`, async () => {
      const p = await fixture(shape === "ungrouped");
      if (shape === "mixed")
        await v.db
          .update(workingOrderLines)
          .set({ groupId: null })
          .where(eq(workingOrderLines.id, p.otherLineId));
      const ask = await command(p, none);
      await run(p, "course", ask);
      expect(await revisionOf(v, p.partyId)).toBe(ask.expectedPartyRevision + 1);
      const after = frozen();
      await run(p, "course", ask);
      expect(frozen()).toEqual(after);
    });
  }
  it.each(["group", "course"])(
    "rejects a tick outside the complete %s action and rolls back its answer",
    async (path) => {
      const p = await fixture(false, true);
      const other = await fixture();
      const ask = await command(p, {
        ...none,
        ticks: [{ line: { kind: "working", id: other.lineId }, guestIndex: null }],
      });
      const before = frozen();
      await expect(run(p, path, ask)).rejects.toMatchObject({ code: "allergy.invalid" });
      expect(frozen()).toEqual(before);
    },
  );
  it("a stale party refuses before changing answer, ticks or kitchen work", async () => {
    const p = await fixture();
    const ask = await command(p, none);
    ask.expectedPartyRevision--;
    const before = frozen();
    await expect(run(p, "course", ask)).rejects.toMatchObject({ code: "party.out_of_date" });
    expect(frozen()).toEqual(before);
  });
  it("sold-out work on a later bill rolls back the whole group and allergy patch", async () => {
    const p = await fixture(false, true);
    const ask = await command(p, {
      party: {
        answer: "allergies",
        guests: [{ who: "Alex", allergens: { milk: {} }, note: null }],
      },
      ticks: [{ line: { kind: "working", id: p.lineId }, guestIndex: 0 }],
    });
    expect(
      (
        await v.db.select().from(workingOrderLines).where(eq(workingOrderLines.id, p.otherLineId))
      )[0]!.workingOrderId,
    ).toBe(p.otherBill);
    await v.db
      .update(products)
      .set({ available: false })
      .where(eq(products.id, v.productId("Burger")));
    const before = frozen();
    try {
      await expect(run(p, "group", ask)).rejects.toMatchObject({ code: "product.unavailable" });
      expect(frozen()).toEqual(before);
    } finally {
      await v.db
        .update(products)
        .set({ available: true })
        .where(eq(products.id, v.productId("Burger")));
    }
  });
  it("course preflight accepts ticks across both bills and multiple qualifying groups before release", async () => {
    const p = await fixture(false, true);
    await inTx(v, (tx) =>
      VENUE_SERVICE.writePartyAllergy(tx, p.partyId, { answer: "none", guests: [] }, OPERATOR),
    );
    const second = await inTx(v, (tx) =>
      placeGroups(tx, v.cfg, p.partyId, {
        operatorId: OPERATOR,
        billId: p.tabId,
        groups: [{ release: "hold", lines: [{ menuItemId: v.item("Burger"), quantity: "1" }] }],
      }),
    );
    const secondId = second.groups[0]!.lineIds[0]!;
    await v.db.run(sql`delete from party_allergy where party_id = ${p.partyId}`);
    const allergy: AllergyPatch = {
      party: {
        answer: "allergies",
        guests: [{ who: "Alex", allergens: { milk: {} }, note: null }],
      },
      ticks: [p.lineId, p.otherLineId, secondId].map((id) => ({
        line: { kind: "working", id },
        guestIndex: 0,
      })),
    };
    const ask = await command(p, allergy);
    await run(p, "course", ask);
    const snapshot = await inTx(v, (tx) => VENUE_SERVICE.readPartyAllergy(tx, p.partyId));
    expect(snapshot.ticks.map((tick) => tick.workingLineId).sort()).toEqual(
      [p.lineId, p.otherLineId, secondId].sort(),
    );
    expect(await revisionOf(v, p.partyId)).toBe(ask.expectedPartyRevision + 1);
    const after = frozen();
    await run(p, "course", ask);
    expect(frozen()).toEqual(after);
  });
  it("a stale bill editor rolls back the line send without saving its allergy answer", async () => {
    const p = await fixture(true);
    const ask = await command(p, none);
    const expectedEdit = await inTx(v, (tx) => readBillEditState(tx, p.tabId));
    expectedEdit.editorVersion++;
    const before = frozen();
    await expect(
      inTx(v, (tx) =>
        sendLines(tx, v.cfg, p.tabId, [], { operatorId: OPERATOR, expectedEdit }, undefined, ask),
      ),
    ).rejects.toMatchObject({ code: "draft.out_of_date" });
    expect(frozen()).toEqual(before);
  });
  it("legacy no-work repeats neither ask nor write", async () => {
    const p = await fixture(true);
    await inTx(v, (tx) => VENUE_SERVICE.writePartyAllergy(tx, p.partyId, none.party, OPERATOR));
    await run(p, "all");
    await v.db.run(sql`delete from party_allergy where party_id = ${p.partyId}`);
    const after = frozen();
    await run(p, "all");
    expect(frozen()).toEqual(after);
  });
  it("counter course needs no party answer and line send preserves its table-only refusal", async () => {
    const id = await counterOrder(v, "Burger");
    await inTx(v, (tx) => fireCourse(tx, v.cfg, id, mains, { personId: OPERATOR }));
    await expect(
      inTx(v, (tx) => sendLines(tx, v.cfg, id, [], { operatorId: OPERATOR, expectedEdit: null })),
    ).rejects.toMatchObject({ code: "tab.not_open" });
    expect(
      (await v.db.select().from(workingOrders).where(eq(workingOrders.id, id)))[0]!.partyId,
    ).toBeNull();
  });
});
