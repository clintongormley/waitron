import { readBillEditState } from "./bill-editing.js";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import {
  orderDraftRecalledLines,
  orderDraftLines,
  orderDrafts,
  parties,
  printJobs,
  serviceCommands,
  ticketItems,
  workingOrderLines,
  workingOrders,
} from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { adjustments, createAdjustmentReason } from "@waitron/adjustments";
import { persons } from "@waitron/identity";
import { kitchenNotices } from "@waitron/venue-service";
import { readPartyAllergy, savePartyAllergy, setAllergyLineTicks } from "@waitron/venue-service";
import type { Draft, BillEditExpected, BillDraftSnapshot } from "./order-drafts.js";
import { discardPartyDrafts } from "./order-drafts.js";
import { send } from "./testing/bill-venue.js";
import {
  billWith,
  inTx,
  PINS,
  provisionAdjustmentVenue,
  rowsOf,
  type AdjustmentVenue,
} from "./testing/adjustment-venue.js";

let venue: AdjustmentVenue;
useVenueDb({
  resetPerTest: false,
  migrations: migrationOptionsFor(manifestSets(), null),
  timeoutMs: 60_000,
  setup: async (db) => {
    venue = await provisionAdjustmentVenue(db);
  },
});

async function call(method: string, path: string, body?: unknown, cookie = venue.cookie.staff) {
  if (body !== null && typeof body === "object" && !Array.isArray(body)) {
    const ask = body as Record<string, unknown>;
    let billId: string | undefined;
    const recall = /\/lines\/([^/]+)\/recall$/.exec(path);
    const takeover = /\/drafts\/([^/]+)\/take-over$/.exec(path);
    if (recall !== null) {
      const [line] = await venue.db
        .select()
        .from(workingOrderLines)
        .where(eq(workingOrderLines.id, recall[1]!));
      billId = line?.workingOrderId;
    } else if (takeover !== null) {
      const [draft] = await venue.db
        .select()
        .from(orderDrafts)
        .where(eq(orderDrafts.id, takeover[1]!));
      billId = draft?.billId ?? undefined;
    } else if (method === "PUT" && path.endsWith("/drafts") && typeof ask.billId === "string") {
      billId = ask.billId;
    }
    if (billId !== undefined && !Object.hasOwn(ask, "expectedEdit")) {
      const edit = await readBillEditState(venue.db, billId);
      body = {
        ...ask,
        expectedEdit:
          method === "PUT"
            ? {
                billId,
                editorVersion: edit.editorVersion,
                draftId: ask.draftId,
                draftRevision: ask.draftId === null ? null : ask.revision,
              }
            : edit,
        ...(takeover === null ? {} : { submissionId: randomUUID() }),
      };
    }
  }
  return send(venue.app, cookie, method, path, body);
}
async function billRevision(billId: string) {
  const [bill] = await venue.db.select().from(workingOrders).where(eq(workingOrders.id, billId));
  return bill!.revision;
}
async function draftOn(partyId: string, draftId: string) {
  const read = await call("GET", `/api/parties/${partyId}/drafts`);
  expect(read.status).toBe(200);
  return (read.json as unknown as { drafts: Draft[] }).drafts.find((d) => d.id === draftId)!;
}
async function setup(release: "hold" | "fire" = "hold") {
  const p = await billWith(
    venue,
    [{ name: "Pizza", quantity: "3", olives: 2 }, { name: "Water" }],
    { release },
  );
  const [line, extra] = await rowsOf(venue, p.billId);
  const [party] = await venue.db.select().from(parties).where(eq(parties.id, p.partyId));
  const answer = await call("POST", `/api/parties/${p.partyId}/lines/${line!.id}/recall`, {
    submissionId: randomUUID(),
    expectedPartyRevision: party!.revision,
  });
  expect(answer.status, JSON.stringify(answer.json)).toBe(200);
  return {
    ...p,
    line: line!,
    extra: extra!,
    draft: (answer.json as unknown as { draft: Draft }).draft,
  };
}
const observedAdjustments = new Map<
  string,
  { expectedEdit: BillEditExpected; sourceDraftId?: string }
>();
async function post(billId: string, body: Record<string, unknown>, cookie = venue.cookie.staff) {
  const submissionId = typeof body.submissionId === "string" ? body.submissionId : randomUUID();
  let observed = observedAdjustments.get(submissionId);
  if (observed === undefined) {
    const expectedEdit = await readBillEditState(venue.db, billId);
    observed = {
      expectedEdit,
      ...(expectedEdit.draftId === null ? {} : { sourceDraftId: expectedEdit.draftId }),
    };
    observedAdjustments.set(submissionId, observed);
  }
  return call(
    "POST",
    `/api/working-orders/${billId}/adjustments`,
    {
      ...observed,
      submissionId,
      expectedRevision: await billRevision(billId),
      lineId: null,
      reasonId: body.action === "cancel" ? venue.reasonId.houseVoid : venue.reasonId.house,
      note: null,
      ...body,
    },
    cookie,
  );
}
async function frozen() {
  return {
    bills: await venue.db.select().from(workingOrders).orderBy(workingOrders.id),
    lines: await venue.db.select().from(workingOrderLines).orderBy(workingOrderLines.id),
    drafts: await venue.db.select().from(orderDrafts).orderBy(orderDrafts.id),
    fresh: await venue.db.select().from(orderDraftLines).orderBy(orderDraftLines.id),
    sources: await venue.db
      .select()
      .from(orderDraftRecalledLines)
      .orderBy(orderDraftRecalledLines.id),
    adjustments: await venue.db.select().from(adjustments).orderBy(adjustments.id),
    commands: await venue.db.select().from(serviceCommands).orderBy(serviceCommands.id),
    items: await venue.db.select().from(ticketItems).orderBy(ticketItems.id),
    jobs: await venue.db.select().from(printJobs).orderBy(printJobs.id),
    notices: await venue.db.select().from(kitchenNotices).orderBy(kitchenNotices.id),
  };
}

describe("adjusting an owned recalled family", () => {
  it("cancels at the recorded discounted family prices while keeping the earlier adjustment intact", async () => {
    const p = await setup();
    expect((await post(p.billId, { action: "discount_percent", percentBp: 1000 })).status).toBe(
      200,
    );
    const before = await frozen();
    const draft = await draftOn(p.partyId, p.draft.id);
    const answer = await post(p.billId, { action: "cancel", lineId: p.line.id, quantity: "1" });
    expect(answer.status, JSON.stringify(answer.json)).toBe(200);
    expect(await rowsOf(venue, p.billId)).toEqual([
      {
        ...p.line,
        quantity: "2.000",
        unitPriceGross: "8.10",
        listUnitPriceGross: "9.00",
        lineTotal: "16.20",
      },
      {
        ...p.extra,
        quantity: "4.000",
        unitPriceGross: "1.35",
        listUnitPriceGross: "1.50",
        lineTotal: "5.40",
      },
      expect.objectContaining({ name: "Water", unitPriceGross: "1.80", lineTotal: "1.80" }),
    ]);
    const after = await frozen();
    expect(
      after.adjustments.filter((row) => before.adjustments.some((old) => old.id === row.id)),
    ).toEqual(before.adjustments);
    expect(
      after.adjustments.filter((row) => row.workingOrderId === p.billId && row.action === "cancel"),
    ).toMatchObject([
      {
        lineId: p.line.id,
        quantity: 1000,
        beforeAmount: 1080,
        afterAmount: 0,
        reduction: 1080,
        nominalValue: 1200,
      },
    ]);
    expect(await draftOn(p.partyId, p.draft.id)).toMatchObject({
      revision: draft.revision + 1,
      lines: [{ sourceLineId: p.line.id, quantity: "2.000", source: { netAmount: "21.60" } }],
    });
  });

  it("follows a source reservation's current owner after a takeover", async () => {
    const p = await setup();
    const taken = await call(
      "POST",
      `/api/parties/${p.partyId}/drafts/${p.draft.id}/take-over`,
      {
        revision: p.draft.revision,
      },
      venue.cookie.manager,
    );
    expect(taken.status, JSON.stringify(taken.json)).toBe(200);
    const before = await frozen();
    const refused = await post(p.billId, { action: "cancel", lineId: p.line.id, quantity: "1" });
    expect(refused.json).toMatchObject({
      code: "draft.taken_over",
      params: { draftId: p.draft.id, ownerId: venue.managerId },
    });
    expect(await frozen()).toEqual(before);
    const answer = await post(
      p.billId,
      { action: "cancel", lineId: p.line.id, quantity: "1" },
      venue.cookie.manager,
    );
    expect(answer.status, JSON.stringify(answer.json)).toBe(200);
    expect(await draftOn(p.partyId, p.draft.id)).toMatchObject({
      ownerId: venue.managerId,
      revision: p.draft.revision + 2,
      lines: [{ id: p.draft.lines[0]!.id, sourceLineId: p.line.id, quantity: "2.000" }],
    });
  });

  it("places a split source next to its original without colliding with fresh or recalled draft rows", async () => {
    const p = await setup();
    const saved = await call("PUT", `/api/parties/${p.partyId}/drafts`, {
      billId: p.billId,
      draftId: p.draft.id,
      revision: p.draft.revision,
      lines: [
        p.draft.lines[0],
        {
          menuItemId: venue.item("Bread"),
          variantId: null,
          menuVersionId: null,
          quantity: "1",
          options: [],
          extras: [],
          note: null,
          courseId: null,
          makeAt: null,
          noMerge: false,
        },
      ],
    });
    expect(saved.status, JSON.stringify(saved.json)).toBe(200);
    const savedDraft = (saved.json as unknown as BillDraftSnapshot).draft!;
    const water = (await rowsOf(venue, p.billId))[2]!;
    const [party] = await venue.db.select().from(parties).where(eq(parties.id, p.partyId));
    const recalled = await call("POST", `/api/parties/${p.partyId}/lines/${water.id}/recall`, {
      submissionId: randomUUID(),
      expectedPartyRevision: party!.revision,
    });
    expect(recalled.status, JSON.stringify(recalled.json)).toBe(200);
    const { draft } = recalled.json as unknown as { draft: Draft };
    expect(draft.lines[1]).toEqual(savedDraft.lines[1]);
    expect(
      (await post(p.billId, { action: "comp", lineId: p.line.id, quantity: "1" })).status,
    ).toBe(200);
    const read = await draftOn(p.partyId, draft.id);
    expect(read.lines).toHaveLength(4);
    expect(read.lines[0]).toMatchObject({ id: draft.lines[0]!.id, quantity: "2.000" });
    expect(read.lines[1]).toMatchObject({ sourceLineId: expect.any(String), quantity: "1.000" });
    expect(read.lines[2]).toEqual(draft.lines[1]);
    expect(read.lines[3]).toEqual(draft.lines[2]);
    const refs = await venue.db
      .select()
      .from(orderDraftRecalledLines)
      .where(eq(orderDraftRecalledLines.draftId, draft.id))
      .orderBy(orderDraftRecalledLines.position);
    expect(refs.map((row) => row.position)).toEqual([1, 2, 4]);
    const [fresh] = await venue.db
      .select()
      .from(orderDraftLines)
      .where(eq(orderDraftLines.draftId, draft.id));
    expect(fresh).toMatchObject({ id: draft.lines[1]!.id, position: 3 });
  });

  it("advances a draft only once when an own bill discount changes two recalled families", async () => {
    const p = await setup();
    const water = (await rowsOf(venue, p.billId))[2]!;
    const [party] = await venue.db.select().from(parties).where(eq(parties.id, p.partyId));
    const recalled = await call("POST", `/api/parties/${p.partyId}/lines/${water.id}/recall`, {
      submissionId: randomUUID(),
      expectedPartyRevision: party!.revision,
    });
    expect(recalled.status, JSON.stringify(recalled.json)).toBe(200);
    const { draft } = recalled.json as unknown as { draft: Draft };
    const refs = await venue.db
      .select()
      .from(orderDraftRecalledLines)
      .where(eq(orderDraftRecalledLines.draftId, draft.id));
    const answer = await post(p.billId, { action: "discount_percent", percentBp: 1000 });
    expect(answer.status, JSON.stringify(answer.json)).toBe(200);
    const read = await draftOn(p.partyId, draft.id);
    expect(read.revision).toBe(draft.revision + 1);
    expect(read.lines).toMatchObject([
      { sourceLineId: p.line.id, quantity: "3.000", source: { netAmount: "32.40" } },
      { sourceLineId: water.id, quantity: "1.000", source: { netAmount: "1.80" } },
    ]);
    expect(
      await venue.db
        .select()
        .from(orderDraftRecalledLines)
        .where(eq(orderDraftRecalledLines.draftId, draft.id)),
    ).toEqual(refs);
  });

  it("requires takeover before another person adjusts a sent sibling, without changing recalled dishes", async () => {
    const p = await setup();
    const water = (await rowsOf(venue, p.billId))[2]!;
    const before = await frozen();
    const refused = await post(
      p.billId,
      { action: "comp", lineId: water.id },
      venue.cookie.manager,
    );
    expect(refused.json).toMatchObject({ code: "draft.taken_over" });
    expect(await frozen()).toEqual(before);
    const taken = await call(
      "POST",
      `/api/parties/${p.partyId}/drafts/${p.draft.id}/take-over`,
      { revision: p.draft.revision },
      venue.cookie.manager,
    );
    expect(taken.status, JSON.stringify(taken.json)).toBe(200);
    const afterTakeover = await draftOn(p.partyId, p.draft.id);
    const answer = await post(p.billId, { action: "comp", lineId: water.id }, venue.cookie.manager);
    expect(answer.status, JSON.stringify(answer.json)).toBe(200);
    expect(await draftOn(p.partyId, p.draft.id)).toEqual(afterTakeover);
    expect((await rowsOf(venue, p.billId))[2]).toMatchObject({
      id: water.id,
      unitPriceGross: "0.00",
      lineTotal: "0.00",
    });
  });

  it("keeps both parts of a partially comped recalled family unsent with their allergy assignment", async () => {
    const p = await setup();
    const allergy = await inTx(venue, async (tx) => {
      const [party] = await tx.select().from(parties).where(eq(parties.id, p.partyId));
      const snapshot = await savePartyAllergy(
        tx,
        p.partyId,
        party!.revision,
        {
          answer: "allergies",
          guests: [{ who: "Guest with peanut allergy", allergens: { peanuts: {} }, note: null }],
        },
        venue.staffId,
      );
      await setAllergyLineTicks(tx, p.partyId, [
        { workingLineId: p.line.id, guestId: snapshot.guests[0]!.id },
      ]);
      return snapshot;
    });
    const before = await frozen();
    const answer = await post(p.billId, { action: "comp", lineId: p.line.id, quantity: "1" });
    expect(answer.status, JSON.stringify(answer.json)).toBe(200);
    const read = await draftOn(p.partyId, p.draft.id);
    expect(read.revision).toBe(p.draft.revision + 1);
    expect(read.lines).toHaveLength(2);
    expect(read.lines[0]).toMatchObject({
      id: p.draft.lines[0]!.id,
      sourceLineId: p.line.id,
      quantity: "2.000",
      source: {
        netAmount: "24.00",
        line: { id: p.line.id },
        extras: [{ id: p.extra.id, quantity: "4.000" }],
      },
    });
    expect(read.lines[1]).toMatchObject({
      quantity: "1.000",
      slot: p.draft.lines[0]!.slot,
      joinGroupId: p.draft.lines[0]!.joinGroupId,
      afterGroupId: p.draft.lines[0]!.afterGroupId,
      source: {
        netAmount: "0.00",
        line: { unitPriceGross: "0.00", listUnitPriceGross: "9.00" },
        extras: [{ quantity: "2.000", unitPriceGross: "0.00", listUnitPriceGross: "1.50" }],
      },
    });
    expect(read.lines[1]!.id).not.toBe(read.lines[0]!.id);
    expect(read.lines[1]!.sourceLineId).not.toBe(p.line.id);
    const after = await frozen();
    expect(after.sources.filter((row) => row.draftId === p.draft.id)).toHaveLength(2);
    expect(after.items).toEqual(before.items);
    expect(after.notices).toEqual(before.notices);
    expect(after.jobs).toEqual(before.jobs);
    const ticks = await inTx(venue, (tx) => readPartyAllergy(tx, p.partyId));
    expect(ticks.guests).toEqual(allergy.guests);
    expect(ticks.ticks).toEqual(
      expect.arrayContaining([
        { workingLineId: p.line.id, draftLineId: null, guestId: allergy.guests[0]!.id },
        {
          workingLineId: read.lines[1]!.sourceLineId,
          draftLineId: null,
          guestId: allergy.guests[0]!.id,
        },
      ]),
    );
    expect(ticks.ticks).toHaveLength(2);
    expect(after.adjustments.filter((row) => row.workingOrderId === p.billId)).toMatchObject([
      {
        action: "comp",
        reduction: 1200,
        splits: expect.arrayContaining([{ from: p.line.id, to: read.lines[1]!.sourceLineId }]),
      },
    ]);
    const sent = await call("GET", `/api/parties/${p.partyId}/groups?billId=${p.billId}`);
    expect(sent.status).toBe(200);
    expect(JSON.stringify(sent.json)).not.toContain(read.lines[1]!.sourceLineId);
  });

  it.each(["hold", "fire"] as const)(
    "cancels one recalled dish from %s with its extras and rejects a save from before that cancellation",
    async (release) => {
      const p = await setup(release);
      const before = await frozen();
      const body = {
        action: "cancel",
        lineId: p.line.id,
        quantity: "1",
        submissionId: randomUUID(),
        expectedRevision: await billRevision(p.billId),
        ...(release === "fire"
          ? { approver: { personId: venue.supervisorId, pin: PINS.supervisor } }
          : {}),
      };
      const answer = await post(p.billId, body);
      expect(answer.status, JSON.stringify(answer.json)).toBe(200);
      expect(await rowsOf(venue, p.billId)).toEqual([
        { ...p.line, quantity: "2.000", lineTotal: "18.00" },
        { ...p.extra, quantity: "4.000", lineTotal: "6.00" },
        expect.objectContaining({ name: "Water", quantity: "1.000", lineTotal: "2.00" }),
      ]);
      const reduced = await rowsOf(venue, p.billId);
      const read = await draftOn(p.partyId, p.draft.id);
      expect(read.revision).toBe(p.draft.revision + 1);
      expect(read.lines).toMatchObject([
        {
          id: p.draft.lines[0]!.id,
          sourceLineId: p.line.id,
          quantity: "2.000",
          source: { netAmount: "24.00", extras: [{ id: p.extra.id, quantity: "4.000" }] },
        },
      ]);
      const after = await frozen();
      expect(after.sources).toEqual(before.sources);
      expect(after.items).toEqual(before.items);
      expect(after.jobs).toEqual(before.jobs);
      expect(after.notices).toEqual(before.notices);
      const ledger = after.adjustments.filter((row) => row.workingOrderId === p.billId);
      expect(ledger).toMatchObject([
        {
          action: "cancel",
          lineId: p.line.id,
          quantity: 1000,
          reduction: 1200,
          requestedBy: venue.staffId,
        },
      ]);
      expect((await post(p.billId, body)).json).toEqual(answer.json);
      expect(await frozen()).toEqual(after);
      const stale = await call("PUT", `/api/parties/${p.partyId}/drafts`, {
        billId: p.billId,
        draftId: p.draft.id,
        revision: p.draft.revision,
        lines: p.draft.lines,
      });
      expect(stale.json).toMatchObject({ code: "draft.out_of_date" });
      expect(await frozen()).toEqual(after);
      const saved = await call("PUT", `/api/parties/${p.partyId}/drafts`, {
        billId: p.billId,
        draftId: read.id,
        revision: read.revision,
        lines: read.lines,
      });
      expect(saved.status, JSON.stringify(saved.json)).toBe(200);
      expect(await rowsOf(venue, p.billId)).toEqual(reduced);
    },
  );

  it("removes a whole recalled family once and closes its draft before releasing the editor", async () => {
    const p = await setup();
    const before = await frozen();
    const body = {
      action: "cancel",
      lineId: p.line.id,
      submissionId: randomUUID(),
      expectedRevision: await billRevision(p.billId),
    };
    const answer = await post(p.billId, body);
    expect(answer.status, JSON.stringify(answer.json)).toBe(200);
    expect(await rowsOf(venue, p.billId)).toEqual([
      expect.objectContaining({ name: "Water", quantity: "1.000", lineTotal: "2.00" }),
    ]);
    const remaining = await call("GET", `/api/parties/${p.partyId}/drafts`);
    expect((remaining.json as unknown as { drafts: Draft[] }).drafts).not.toContainEqual(
      expect.objectContaining({ id: p.draft.id }),
    );
    const [closed] = await venue.db
      .select()
      .from(orderDrafts)
      .where(eq(orderDrafts.id, p.draft.id));
    expect(closed).toMatchObject({ state: "discarded", revision: p.draft.revision + 1 });
    expect(await readBillEditState(venue.db, p.billId)).toMatchObject({
      editorId: null,
      editorVersion: 2,
      draftId: null,
      draftRevision: null,
    });
    const after = await frozen();
    expect(after.sources.filter((row) => row.draftId === p.draft.id)).toEqual([]);
    expect(after.adjustments.filter((row) => row.workingOrderId === p.billId)).toMatchObject([
      {
        action: "cancel",
        quantity: 3000,
        reduction: 3600,
      },
    ]);
    expect(after.jobs).toEqual(before.jobs);
    expect(after.notices).toEqual(before.notices);
    expect((await post(p.billId, body)).json).toEqual(answer.json);
    expect(await frozen()).toEqual(after);
    await inTx(venue, (tx) => discardPartyDrafts(tx, p.partyId, venue.staffId));
    const [draft] = await venue.db.select().from(orderDrafts).where(eq(orderDrafts.id, p.draft.id));
    expect(draft).toMatchObject({ state: "discarded", revision: p.draft.revision + 1 });
  });

  it.each([
    { action: "cancel", target: "parent" },
    { action: "cancel", target: "extra" },
    { action: "comp", target: "parent" },
    { action: "discount_percent", target: "extra", percentBp: 1000 },
    { action: "discount_percent", target: "bill", percentBp: 1000 },
  ])("refuses another person's $action on the recalled $target", async ({ target, ...action }) => {
    const p = await setup();
    const before = await frozen();
    const answer = await post(
      p.billId,
      {
        ...action,
        lineId: target === "bill" ? null : target === "parent" ? p.line.id : p.extra.id,
      },
      venue.cookie.manager,
    );
    expect(answer.json).toMatchObject({
      code: "draft.taken_over",
      params: { draftId: p.draft.id, ownerId: venue.staffId, ownerName: p.draft.ownerName },
    });
    expect(await frozen()).toEqual(before);
  });

  it("retains the ordinary required note and manager approval before cancelling a recalled source", async () => {
    const p = await setup("fire");
    const [owner] = await venue.db.select().from(persons).where(eq(persons.id, venue.staffId));
    const reason = await inTx(venue, (tx) =>
      createAdjustmentReason(tx, {
        name: `Recall-${randomUUID()}`,
        names: {},
        kind: "void",
        actions: ["cancel"],
        maxPercentBp: null,
        maxAmount: null,
        applyRoles: [],
        approverRoles: [],
        noteRequired: true,
      }),
    );
    const before = await frozen();
    const ask = { action: "cancel", lineId: p.line.id, quantity: "1", reasonId: reason.id };
    expect((await post(p.billId, ask)).json).toMatchObject({ code: "adjustment.note_required" });
    expect(await frozen()).toEqual(before);
    expect((await post(p.billId, { ...ask, note: "Duplicate dish" })).json).toMatchObject({
      code: "adjustment.approval_required",
    });
    expect(await frozen()).toEqual(before);
    const answer = await post(p.billId, {
      ...ask,
      note: "Duplicate dish",
      approver: { personId: venue.managerId, pin: PINS.manager },
    });
    expect(answer.status, JSON.stringify(answer.json)).toBe(200);
    expect((await draftOn(p.partyId, p.draft.id)).revision).toBe(p.draft.revision + 1);
    const ledger = await venue.db
      .select()
      .from(adjustments)
      .where(eq(adjustments.workingOrderId, p.billId));
    expect(ledger).toMatchObject([
      {
        action: "cancel",
        note: "Duplicate dish",
        requestedBy: owner!.id,
        approvedBy: venue.managerId,
        reduction: 1200,
      },
    ]);
  });
});
