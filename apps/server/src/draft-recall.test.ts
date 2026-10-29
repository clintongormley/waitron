import { kitchenTicketWords } from "./i18n/kitchen-ticket.js";
import { createOpenOrder } from "./working-order.js";
import { observedDraftCommandBody } from "./testing/draft-command-fixture.js";
import { readBillEditState } from "./bill-editing.js";
import { observedGroupSubmitBody } from "./testing/group-submit-fixture.js";
import { randomUUID } from "node:crypto";
import { and, asc, eq, inArray } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";
import {
  kitchenStations,
  kitchenCourses,
  orderDraftRecalledLines,
  orderDraftLines,
  orderDraftEvents,
  orderDrafts,
  orderGroups,
  workingOrders,
  parties,
  printJobs,
  products,
  serviceCommands,
  ticketItems,
  workingOrderLines,
} from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import {
  clearRoutingCell,
  kitchenNotices,
  workingLineContexts,
  writePartyAllergy,
} from "@waitron/venue-service";
import { placeGrouped } from "./testing/adjustment-venue.js";
import { inTx, provisionBillVenue, send, type BillVenue } from "./testing/bill-venue.js";
import { createTable } from "./testing/live-table.js";
import type { BillDraftSnapshot, Draft } from "./order-drafts.js";
import { createCourse, createStation } from "./kitchen.js";
import { routeProductTo } from "./testing/zone-offers.js";
import { setStationPrinting } from "./testing/station-printing.js";
import { readReleaseReminders, recordHeldPaper } from "./order-groups.js";
import { adjustments, createAdjustmentReason } from "@waitron/adjustments";
import { applyAdjustment } from "./adjustments-apply.js";
import { attachPrinterToStation } from "./station-printers.js";
import { createPrinter } from "@waitron/printing";
import { printedLines } from "./testing/decode-ticket.js";
import { VENUE_SERVICE } from "./modules.js";
import { setChangesAfterSending } from "./testing/changes-after-sending.js";
import * as orderWrites from "./working-order.js";

let venue: BillVenue;
let stationId: string;
useVenueDb({
  resetPerTest: false,
  migrations: migrationOptionsFor(manifestSets(), null),
  timeoutMs: 60_000,
  setup: async (db) => {
    venue = await provisionBillVenue(db);
    const [station] = await db
      .select()
      .from(kitchenStations)
      .where(eq(kitchenStations.locationId, venue.cfg.locationId));
    stationId = station!.id;
  },
});

async function call(method: string, path: string, body?: unknown) {
  return send(
    venue.app,
    venue.cookie,
    method,
    path,
    await observedDraftCommandBody(
      venue.db,
      method,
      path,
      await observedGroupSubmitBody(venue.db, path, body),
      venue.operatorId,
    ),
  );
}
async function revision(partyId: string) {
  const [party] = await venue.db.select().from(parties).where(eq(parties.id, partyId));
  return party!.revision;
}
async function command(partyId: string) {
  return { submissionId: randomUUID(), expectedPartyRevision: await revision(partyId) };
}
async function setup(release: "hold" | "fire", count = 1, shape?: "grouped") {
  const tableLabel = `R-${randomUUID().slice(0, 8)}`;
  const { id: tableId } = await inTx(venue, (tx) =>
    createTable(tx, venue.cfg, { label: tableLabel, zoneId: venue.zoneId }),
  );
  const seated = await call("POST", `/api/tables/${tableId}/seat`, {});
  expect(seated.status).toBe(200);
  const { partyId, tabId } = seated.json as unknown as { partyId: string; tabId: string };
  const placed = Array.from({ length: count }, (_, i) => ({
    menuItemId: venue.offerFor(i === 0 ? "Tarta" : "Croquetas"),
    quantity: "2",
  }));
  let groupId: string;
  if (shape === "grouped") {
    groupId = await inTx(venue, async (tx) => {
      await writePartyAllergy(tx, partyId, { answer: "none", guests: [] }, venue.operatorId);
      const seat = { partyId, tabId };
      return placeGrouped(tx, venue.cfg, seat, placed, release, venue.operatorId);
    });
  } else {
    const answer = await call("POST", `/api/parties/${partyId}/groups`, {
      allergy: { party: { answer: "none", guests: [] }, ticks: [] },
      ...(await command(partyId)),
      groups: [{ release, lines: placed }],
    });
    expect(answer.status).toBe(200);
    groupId = (answer.json as unknown as { groups: { id: string }[] }).groups[0]!.id;
  }
  const lines = await venue.db
    .select()
    .from(workingOrderLines)
    .where(eq(workingOrderLines.workingOrderId, tabId))
    .orderBy(asc(workingOrderLines.lineNo));
  return { partyId, tabId, tableLabel, groupId, line: lines[0]!, lines };
}
async function recall(partyId: string, lineId: string, body?: unknown) {
  return call(
    "POST",
    `/api/parties/${partyId}/lines/${lineId}/recall`,
    body ?? (await command(partyId)),
  );
}
async function frozen(partyId: string) {
  return {
    revision: await revision(partyId),
    bills: await venue.db.select().from(workingOrders).orderBy(workingOrders.id),
    groups: await venue.db.select().from(orderGroups).orderBy(orderGroups.id),
    lines: await venue.db.select().from(workingOrderLines).orderBy(workingOrderLines.id),
    items: await venue.db.select().from(ticketItems).orderBy(ticketItems.id),
    drafts: await venue.db.select().from(orderDrafts).orderBy(orderDrafts.id),
    fresh: await venue.db.select().from(orderDraftLines).orderBy(orderDraftLines.id),
    sources: await venue.db
      .select()
      .from(orderDraftRecalledLines)
      .orderBy(orderDraftRecalledLines.id),
    commands: await venue.db.select().from(serviceCommands).orderBy(serviceCommands.id),
    draftEvents: await venue.db.select().from(orderDraftEvents).orderBy(orderDraftEvents.id),
    notices: await venue.db.select().from(kitchenNotices).orderBy(kitchenNotices.id),
    jobs: await venue.db.select().from(printJobs).orderBy(printJobs.id),
    adjustments: await venue.db.select().from(adjustments).orderBy(adjustments.id),
  };
}

describe("party Recall to draft", () => {
  it.each(["retained context", "no retained context"] as const)(
    "saves recalled note, course and station edits with %s without changing the charged family",
    async (context) => {
      const p = await setup("fire");
      if (context === "no retained context")
        await venue.db
          .delete(workingLineContexts)
          .where(eq(workingLineContexts.workingOrderLineId, p.line.id));
      const course = await inTx(venue, (tx) =>
        createCourse(tx, venue.cfg, { name: `Edited-${randomUUID()}` }),
      );
      const answer = await recall(p.partyId, p.line.id);
      expect(answer.status).toBe(200);
      const { draft } = answer.json as unknown as { draft: Draft };
      const before = await frozen(p.partyId);
      const input = { ...draft.lines[0]!, note: "No salt", courseId: course.id, makeAt: stationId };
      const read = vi
        .spyOn(VENUE_SERVICE, "listZoneOffers")
        .mockRejectedValue(new Error("stored edits must not read a live offer"));
      try {
        const saved = await call("PUT", `/api/parties/${p.partyId}/drafts`, {
          billId: p.tabId,
          draftId: draft.id,
          revision: draft.revision,
          lines: [input],
        });
        expect(saved.status).toBe(200);
        expect((saved.json as unknown as BillDraftSnapshot).draft).toMatchObject({
          id: draft.id,
          revision: draft.revision + 1,
          lines: [
            {
              id: draft.lines[0]!.id,
              sourceLineId: p.line.id,
              note: "No salt",
              courseId: course.id,
              makeAt: stationId,
              source: { line: { id: p.line.id, note: "No salt", courseId: course.id } },
            },
          ],
        });
        const after = await frozen(p.partyId);
        expect(after.lines).toEqual(
          before.lines.map((line) =>
            line.id === p.line.id
              ? { ...line, note: "No salt", courseId: course.id, makeAtStationId: stationId }
              : line,
          ),
        );
        expect(after.items).toEqual(before.items);
        expect(after.jobs).toEqual(before.jobs);
        expect(after.adjustments).toEqual(before.adjustments);
        expect(after.sources).toEqual(before.sources);
        expect(after.bills.find((bill) => bill.id === p.tabId)!.revision).toBe(
          before.bills.find((bill) => bill.id === p.tabId)!.revision + 1,
        );
        expect(after.revision).toBe(before.revision + 1);
        const loaded = await call("GET", `/api/parties/${p.partyId}/drafts`);
        expect(loaded.status).toBe(200);
        expect(loaded.json).toEqual({
          drafts: [(saved.json as unknown as BillDraftSnapshot).draft],
          billEdits: expect.any(Array),
        });
      } finally {
        read.mockRestore();
      }
    },
  );

  it("clears a recalled course and station without repricing or changing its group destination", async () => {
    const p = await setup("hold");
    const course = await inTx(venue, (tx) =>
      createCourse(tx, venue.cfg, { name: `Clear-${randomUUID()}` }),
    );
    await venue.db
      .update(workingOrderLines)
      .set({ courseId: course.id, makeAtStationId: stationId })
      .where(eq(workingOrderLines.id, p.line.id));
    const answer = await recall(p.partyId, p.line.id);
    expect(answer.status).toBe(200);
    const { draft } = answer.json as unknown as { draft: Draft };
    const saved = await call("PUT", `/api/parties/${p.partyId}/drafts`, {
      billId: p.tabId,
      draftId: draft.id,
      revision: draft.revision,
      lines: [{ ...draft.lines[0]!, note: null, courseId: null, makeAt: null }],
    });
    expect(saved.status).toBe(200);
    expect((saved.json as unknown as BillDraftSnapshot).draft!.lines[0]).toMatchObject({
      courseId: null,
      makeAt: null,
      joinGroupId: p.groupId,
      source: { line: { id: p.line.id, courseId: null, unitPriceGross: "18.00" } },
    });
    expect((saved.json as unknown as BillDraftSnapshot).draft!.lines[0]).not.toHaveProperty(
      "course",
    );
    const [stored] = await venue.db
      .select()
      .from(workingOrderLines)
      .where(eq(workingOrderLines.id, p.line.id));
    expect(stored).toMatchObject({ courseId: null, makeAtStationId: null, groupId: p.groupId });
  });

  it("keeps an unchanged retired course and disabled station while editing only a recalled note", async () => {
    const p = await setup("hold");
    const course = await inTx(venue, (tx) =>
      createCourse(tx, venue.cfg, { name: `Retired-${randomUUID()}` }),
    );
    await venue.db
      .update(workingOrderLines)
      .set({ courseId: course.id, makeAtStationId: stationId })
      .where(eq(workingOrderLines.id, p.line.id));
    const answer = await recall(p.partyId, p.line.id);
    expect(answer.status).toBe(200);
    const { draft } = answer.json as unknown as { draft: Draft };
    await venue.db
      .update(kitchenCourses)
      .set({ active: false })
      .where(eq(kitchenCourses.id, course.id));
    await venue.db
      .update(kitchenStations)
      .set({ active: false })
      .where(eq(kitchenStations.id, stationId));
    try {
      const saved = await call("PUT", `/api/parties/${p.partyId}/drafts`, {
        billId: p.tabId,
        draftId: draft.id,
        revision: draft.revision,
        lines: [{ ...draft.lines[0]!, note: "Retain recorded choices" }],
      });
      expect(saved.status).toBe(200);
      expect((saved.json as unknown as BillDraftSnapshot).draft!.lines[0]).toMatchObject({
        note: "Retain recorded choices",
        courseId: course.id,
        makeAt: stationId,
      });
    } finally {
      await venue.db
        .update(kitchenStations)
        .set({ active: true })
        .where(eq(kitchenStations.id, stationId));
    }
  });

  it.each(["missing course", "retired course", "missing station", "disabled station"] as const)(
    "refuses a new %s on a recalled line without writing anything",
    async (kind) => {
      const p = await setup("hold");
      const answer = await recall(p.partyId, p.line.id);
      expect(answer.status).toBe(200);
      const { draft } = answer.json as unknown as { draft: Draft };
      let targetId: string = randomUUID();
      if (kind === "retired course") {
        const course = await inTx(venue, (tx) =>
          createCourse(tx, venue.cfg, { name: `Refused-${randomUUID()}` }),
        );
        await venue.db
          .update(kitchenCourses)
          .set({ active: false })
          .where(eq(kitchenCourses.id, course.id));
        targetId = course.id;
      } else if (kind === "disabled station") {
        targetId = stationId;
        await venue.db
          .update(kitchenStations)
          .set({ active: false })
          .where(eq(kitchenStations.id, stationId));
      }
      try {
        const before = await frozen(p.partyId);
        const isCourse = kind.endsWith("course");
        const saved = await call("PUT", `/api/parties/${p.partyId}/drafts`, {
          billId: p.tabId,
          draftId: draft.id,
          revision: draft.revision,
          lines: [
            {
              ...draft.lines[0]!,
              note: "Must roll back",
              [isCourse ? "courseId" : "makeAt"]: targetId,
            },
          ],
        });
        expect(saved.json).toMatchObject({
          code: isCourse ? "course.not_found" : "route.station_inactive",
        });
        expect(saved.status).toBe(isCourse ? 404 : 409);
        expect(await frozen(p.partyId)).toEqual(before);
      } finally {
        if (kind === "disabled station")
          await venue.db
            .update(kitchenStations)
            .set({ active: true })
            .where(eq(kitchenStations.id, stationId));
      }
    },
  );

  it("does not advance bill or party revisions for an unchanged recalled save", async () => {
    const p = await setup("fire");
    const answer = await recall(p.partyId, p.line.id);
    expect(answer.status).toBe(200);
    const { draft } = answer.json as unknown as { draft: Draft };
    const before = await frozen(p.partyId);
    const saved = await call("PUT", `/api/parties/${p.partyId}/drafts`, {
      billId: p.tabId,
      draftId: draft.id,
      revision: draft.revision,
      lines: draft.lines,
    });
    expect(saved.status).toBe(200);
    const after = await frozen(p.partyId);
    expect(after.bills).toEqual(before.bills);
    expect(after.revision).toBe(before.revision);
    expect(after.lines).toEqual(before.lines);
  });

  it("increases an actually discounted recalled line without repricing it or rewriting its adjustment", async () => {
    // Grouped, as an order stored before portions.
    const p = await setup("hold", 1, "grouped");
    await inTx(venue, async (tx) => {
      const reason = await createAdjustmentReason(tx, {
        name: `Keep-discount-${randomUUID()}`,
        names: {},
        kind: "comp",
        actions: ["discount_percent"],
        maxPercentBp: null,
        maxAmount: null,
        applyRoles: ["staff", "supervisor", "manager", "admin"],
        approverRoles: ["staff", "supervisor", "manager", "admin"],
        noteRequired: false,
      });
      const [bill] = await tx.select().from(workingOrders).where(eq(workingOrders.id, p.tabId));
      await applyAdjustment(
        tx,
        venue.cfg,
        {
          expectedEdit: await readBillEditState(tx, p.tabId),
          orderId: p.tabId,
          expectedRevision: bill!.revision,
          submissionId: randomUUID(),
          lineId: p.line.id,
          reasonId: reason.id,
          action: "discount_percent",
          percentBp: 2500,
          note: null,
          operatorId: venue.adminId,
        },
        venue.cfg.locale,
      );
    });
    const answer = await recall(p.partyId, p.line.id);
    expect(answer.status).toBe(200);
    const { draft } = answer.json as unknown as { draft: Draft };
    const before = await frozen(p.partyId);
    const list = vi
      .spyOn(VENUE_SERVICE, "listZoneOffers")
      .mockRejectedValue(new Error("recalled increases keep stored prices"));
    try {
      const saved = await call("PUT", `/api/parties/${p.partyId}/drafts`, {
        billId: p.tabId,
        draftId: draft.id,
        revision: draft.revision,
        lines: [{ ...draft.lines[0]!, quantity: "3" }],
      });
      expect(saved.status).toBe(200);
      expect((saved.json as unknown as BillDraftSnapshot).draft!.lines[0]).toMatchObject({
        quantity: "3.000",
        source: { netAmount: "40.50", line: { id: p.line.id, unitPriceGross: "13.50" } },
      });
      const after = await frozen(p.partyId);
      expect(after.lines).toEqual(
        before.lines.map((line) =>
          line.id === p.line.id ? { ...line, quantity: 3000, lineTotal: 4050 } : line,
        ),
      );
      expect(after.adjustments).toEqual(before.adjustments);
      expect(after.sources).toEqual(before.sources);
      expect(after.jobs).toEqual(before.jobs);
    } finally {
      list.mockRestore();
    }
  });

  it("refuses a fractional increase of a whole-unit recalled dish without writing anything", async () => {
    const p = await setup("hold");
    const answer = await recall(p.partyId, p.line.id);
    expect(answer.status).toBe(200);
    const { draft } = answer.json as unknown as { draft: Draft };
    const before = await frozen(p.partyId);
    const saved = await call("PUT", `/api/parties/${p.partyId}/drafts`, {
      billId: p.tabId,
      draftId: draft.id,
      revision: draft.revision,
      lines: [{ ...draft.lines[0]!, quantity: "2.5" }],
    });
    expect(saved.json).toMatchObject({ code: "quantity.invalid", params: { reason: "precision" } });
    expect(saved.status).toBe(400);
    expect(await frozen(p.partyId)).toEqual(before);
  });

  it.each(["note", "quantity"] as const)(
    "refuses a recalled %s edit after an item payment",
    async (field) => {
      const p = await setup("hold", 2);
      const paid = await call("POST", `/api/working-orders/${p.tabId}/payments`, {
        submissionId: randomUUID(),
        kind: "items",
        lines: [{ lineNo: p.line.lineNo, quantity: "1" }],
        method: "cash",
        tendered: "18.00",
        applied: "18.00",
        tip: "0.00",
      });
      expect(paid.status).toBe(200);
      const answer = await recall(p.partyId, p.line.id);
      expect(answer.status).toBe(200);
      const { draft } = answer.json as unknown as { draft: Draft };
      const before = await frozen(p.partyId);
      const saved = await call("PUT", `/api/parties/${p.partyId}/drafts`, {
        billId: p.tabId,
        draftId: draft.id,
        revision: draft.revision,
        lines: [{ ...draft.lines[0]!, [field]: field === "note" ? "No salt" : "3" }],
      });
      expect(saved.status).toBe(409);
      expect(saved.json).toMatchObject({
        code: "bill.line_paid",
        params: { workingOrderId: p.tabId, lineNo: p.line.lineNo },
      });
      expect(await frozen(p.partyId)).toEqual(before);
    },
  );

  it("rolls back a recalled metadata edit when hydration of a retained fresh line fails", async () => {
    const p = await setup("hold");
    const answer = await recall(p.partyId, p.line.id);
    expect(answer.status).toBe(200);
    const { draft } = answer.json as unknown as { draft: Draft };
    const fresh = await venue.db
      .insert(orderDraftLines)
      .values({
        draftId: draft.id,
        position: 2,
        menuItemId: venue.offerFor("Croquetas"),
        quantity: 1000,
        options: [],
        extras: [],
      })
      .returning();
    const lines = [
      { ...draft.lines[0]!, note: "Must roll back" },
      { id: fresh[0]!.id, menuItemId: venue.offerFor("Croquetas"), quantity: "1" },
    ];
    const before = await frozen(p.partyId);
    const readLines = orderWrites.readTabLines;
    let calls = 0;
    const read = vi.spyOn(orderWrites, "readTabLines").mockImplementation(async (...args) => {
      if (++calls === 2) throw new Error("injected final hydration failure");
      return readLines(...args);
    });
    try {
      const saved = await call("PUT", `/api/parties/${p.partyId}/drafts`, {
        billId: p.tabId,
        draftId: draft.id,
        revision: draft.revision,
        lines,
      });
      expect(saved.status).toBe(500);
      expect(await frozen(p.partyId)).toEqual(before);
    } finally {
      read.mockRestore();
    }
    expect(
      (
        await call("PUT", `/api/parties/${p.partyId}/drafts`, {
          billId: p.tabId,
          draftId: draft.id,
          revision: draft.revision,
          lines,
        })
      ).status,
    ).toBe(200);
  });

  it("rolls back kitchen corrections, source ownership and revisions if the final draft read fails", async () => {
    const p = await setup("fire");
    const [draft] = await venue.db
      .insert(orderDrafts)
      .values({ partyId: p.partyId, billId: p.tabId, ownerId: venue.operatorId })
      .returning();
    await venue.db.insert(orderDraftLines).values({
      draftId: draft!.id,
      position: 1,
      menuItemId: venue.offerFor("Croquetas"),
      quantity: 1000,
      options: [],
      extras: [],
    });
    const before = await frozen(p.partyId);
    const body = await command(p.partyId);
    const read = vi
      .spyOn(VENUE_SERVICE, "listZoneOffers")
      .mockRejectedValueOnce(new Error("injected final draft read failure"));
    try {
      expect((await recall(p.partyId, p.line.id, body)).status).toBe(500);
      expect(await frozen(p.partyId)).toEqual(before);
    } finally {
      read.mockRestore();
    }
    expect((await recall(p.partyId, p.line.id, body)).status).toBe(200);
  });

  it("hydrates and saves a source with no retained offer without asking the live menu for it", async () => {
    const p = await setup("hold");
    await venue.db
      .delete(workingLineContexts)
      .where(eq(workingLineContexts.workingOrderLineId, p.line.id));
    const read = vi
      .spyOn(VENUE_SERVICE, "listZoneOffers")
      .mockRejectedValue(new Error("a source must not read live offers"));
    try {
      const answer = await recall(p.partyId, p.line.id);
      expect(answer.status).toBe(200);
      const { draft } = answer.json as unknown as { draft: Draft };
      const saved = await call("PUT", `/api/parties/${p.partyId}/drafts`, {
        billId: p.tabId,
        draftId: draft.id,
        revision: draft.revision,
        lines: draft.lines,
      });
      expect(saved.status).toBe(200);
      expect((saved.json as unknown as BillDraftSnapshot).draft!.lines).toEqual(draft.lines);
      expect(read).not.toHaveBeenCalled();
    } finally {
      read.mockRestore();
    }
  });

  it.each(["own group", "anchored group", "own join", "late course", "immediate course"] as const)(
    "arranges a recalled fired dish by its %s",
    async (kind) => {
      const p = await setup("fire");
      const [earlier, course] = await inTx(venue, async (tx) => [
        await createCourse(tx, venue.cfg, { name: `First-${randomUUID()}`, displayOrder: 1 }),
        await createCourse(tx, venue.cfg, {
          name: `Next-${randomUUID()}`,
          displayOrder: 2,
          heldUntilFired: kind !== "immediate course",
        }),
      ]);
      await venue.db
        .update(workingOrderLines)
        .set({ courseId: course!.id })
        .where(eq(workingOrderLines.id, p.line.id));
      const held = await call("POST", `/api/parties/${p.partyId}/groups`, {
        ...(await command(p.partyId)),
        groups: [
          {
            release: "hold",
            lines: [
              {
                menuItemId: venue.offerFor("Croquetas"),
                quantity: "1",
                courseId: kind === "immediate course" ? course!.id : earlier!.id,
              },
            ],
          },
        ],
      });
      expect(held.status).toBe(200);
      const [{ id: anchorId }] = (held.json as unknown as { groups: { id: string }[] }).groups;
      if (kind === "anchored group") {
        const later = await call("POST", `/api/parties/${p.partyId}/groups`, {
          ...(await command(p.partyId)),
          groups: [
            {
              release: "hold",
              lines: [
                { menuItemId: venue.offerFor("Croquetas"), quantity: "1", courseId: course!.id },
              ],
            },
          ],
        });
        expect(later.status).toBe(200);
      }
      const [own] = await venue.db
        .insert(orderDrafts)
        .values({ partyId: p.partyId, billId: p.tabId, ownerId: venue.operatorId })
        .returning();
      await venue.db.insert(orderDraftLines).values({
        draftId: own!.id,
        position: 1,
        menuItemId: venue.offerFor("Croquetas"),
        quantity: 1000,
        options: [],
        extras: [],
        slot: kind === "own join" ? 0 : 4,
        courseId: ["own group", "anchored group", "own join"].includes(kind)
          ? course!.id
          : earlier!.id,
        joinGroupId: kind === "own join" ? anchorId : null,
        afterGroupId: kind === "anchored group" ? anchorId : null,
      });
      const answer = await recall(p.partyId, p.line.id);
      expect(answer.status).toBe(200);
      const { draft } = answer.json as unknown as { draft: Draft };
      const expected = {
        "own group": { slot: 4, joinGroupId: null, afterGroupId: null },
        "anchored group": { slot: 4, joinGroupId: null, afterGroupId: anchorId },
        "own join": { slot: 0, joinGroupId: anchorId, afterGroupId: null },
        "late course": { slot: 5, joinGroupId: null, afterGroupId: null },
        "immediate course": { slot: 0, joinGroupId: null, afterGroupId: null },
      }[kind];
      expect(draft.lines[1]).toMatchObject({ sourceLineId: p.line.id, ...expected });
    },
  );

  it.each(["placed", "settled"] as const)(
    "refuses a %s bill without changing any draft or kitchen work",
    async (status) => {
      const p = await setup("hold");
      await venue.db
        .update(workingOrders)
        .set({ status, ...(status === "settled" ? { settledAt: new Date().toISOString() } : {}) })
        .where(eq(workingOrders.id, p.tabId));
      const before = await frozen(p.partyId);
      expect((await recall(p.partyId, p.line.id)).json).toMatchObject({
        code: status === "placed" ? "bill.presented" : "bill.paid",
      });
      expect(await frozen(p.partyId)).toEqual(before);
    },
  );

  it("an extra's started work refuses its parent's Recall", async () => {
    // Grouped, as an order stored before portions.
    const p = await setup("fire", 1, "grouped");
    const extraId = randomUUID();
    await venue.db.insert(workingOrderLines).values({
      id: extraId,
      workingOrderId: p.tabId,
      lineNo: 2,
      parentLineId: p.line.id,
      name: "Frozen extra",
      descriptions: { "es-ES": "Customer extra" },
      quantity: 1000,
      unitPriceGross: 100,
      lineTotal: 100,
      vatClass: "general",
      groupId: p.groupId,
    });
    await venue.db.insert(ticketItems).values({
      nodeId: venue.cfg.nodeId,
      workingOrderId: p.tabId,
      workingOrderLineId: extraId,
      stationId,
      state: "preparing",
      firedAt: new Date().toISOString(),
    });
    const before = await frozen(p.partyId);
    expect((await recall(p.partyId, p.line.id)).json).toMatchObject({
      code: "ticket.already_started",
    });
    expect(await frozen(p.partyId)).toEqual(before);
    expect((await recall(p.partyId, extraId)).json).toMatchObject({
      code: "management.request_invalid",
      params: { field: "lineId" },
    });
    expect(await frozen(p.partyId)).toEqual(before);
  });

  it("keeps the existing draft rows and appends after their greatest shared position", async () => {
    const p = await setup("hold");
    const [draft] = await venue.db
      .insert(orderDrafts)
      .values({ partyId: p.partyId, billId: p.tabId, ownerId: venue.operatorId })
      .returning();
    const [line] = await venue.db
      .insert(orderDraftLines)
      .values({
        draftId: draft!.id,
        position: 8,
        menuItemId: venue.offerFor("Croquetas"),
        quantity: 1000,
        options: [],
        extras: [],
        slot: 2,
      })
      .returning();
    const answer = await recall(p.partyId, p.line.id);
    expect(answer.status).toBe(200);
    expect((answer.json as unknown as { draft: Draft }).draft.lines.map((line) => line.id)).toEqual(
      [line!.id, expect.any(String)],
    );
    expect(
      await venue.db.select().from(orderDraftLines).where(eq(orderDraftLines.id, line!.id)),
    ).toEqual([line]);
    expect(
      await venue.db
        .select()
        .from(orderDraftRecalledLines)
        .where(eq(orderDraftRecalledLines.sourceLineId, p.line.id)),
    ).toEqual([expect.objectContaining({ draftId: draft!.id, position: 9 })]);
  });

  it.each([false, true])(
    "prints HOLD CANCELLED with permanent identity and quantity (colliding origins: %s)",
    async (collision) => {
      const printer = await inTx(venue, (tx) =>
        createPrinter(
          tx,
          { locationId: venue.cfg.locationId },
          {
            name: `Recall-${randomUUID()}`,
            transport: "cloud_poll",
            pollId: randomUUID(),
          },
        ),
      );
      await inTx(venue, (tx) =>
        attachPrinterToStation(tx, {
          locationId: venue.cfg.locationId,
          stationId,
          printerId: printer.id,
        }),
      );
      // Grouped, as an order stored before portions.
      const p = await setup("hold", 1, "grouped");
      await venue.db
        .update(orderGroups)
        .set({ holdPrintedAt: new Date().toISOString(), displayNumber: 7 })
        .where(eq(orderGroups.id, p.groupId));
      await inTx(venue, async (tx) => {
        const held = await tx
          .selectDistinct({ stationId: ticketItems.stationId })
          .from(ticketItems)
          .innerJoin(workingOrderLines, eq(workingOrderLines.id, ticketItems.workingOrderLineId))
          .where(eq(workingOrderLines.groupId, p.groupId));
        await recordHeldPaper(tx, p.groupId, new Set(held.map((row) => row.stationId)));
      });
      if (collision) {
        const other = await setup("hold");
        await venue.db.insert(orderGroups).values({
          partyId: p.partyId,
          numberPartyId: other.partyId,
          displayNumber: 7,
          position: 2,
          state: "held",
          submittedBy: venue.operatorId,
        });
      }
      const before = await venue.db
        .select()
        .from(printJobs)
        .where(eq(printJobs.printerId, printer.id));
      expect((await recall(p.partyId, p.line.id)).status).toBe(200);
      const after = await venue.db
        .select()
        .from(printJobs)
        .where(eq(printJobs.printerId, printer.id));
      expect(after.length).toBe(before.length + 1);
      const text = after.flatMap((job) => printedLines(job.payload));
      expect(text).toContain(`*** ${kitchenTicketWords("es").holdCancelled} ***`);
      expect(text).toContain(
        collision
          ? `${kitchenTicketWords("es").group} 7 · ${p.tableLabel}`
          : `${kitchenTicketWords("es").group} 7`,
      );
      expect(text.some((line) => line.includes("2") && line.includes("TARTA"))).toBe(true);
      expect(
        await venue.db.select().from(ticketItems).where(eq(ticketItems.workingOrderId, p.tabId)),
      ).toEqual([]);
    },
  );

  it("never serves a recalled fired source through the direct serving route", async () => {
    const p = await setup("fire");
    expect((await recall(p.partyId, p.line.id)).status).toBe(200);
    const before = await frozen(p.partyId);
    const served = await call("POST", `/api/parties/${p.partyId}/served`, {
      ...(await command(p.partyId)),
      items: [{ lineId: p.line.id, quantity: "1" }],
    });
    expect(served.json).toMatchObject({ code: "group.not_found" });
    expect(await frozen(p.partyId)).toEqual(before);
  });

  it("keeps recalled course identity for placement but omits the work from summaries and reminders", async () => {
    // Grouped, as an order stored before portions.
    const p = await setup("hold", 1, "grouped");
    const course = await inTx(venue, (tx) =>
      createCourse(tx, venue.cfg, { name: `M-${randomUUID()}`, displayOrder: 7 }),
    );
    await venue.db
      .update(workingOrderLines)
      .set({ courseId: course.id })
      .where(eq(workingOrderLines.id, p.line.id));
    expect((await recall(p.partyId, p.line.id)).status).toBe(200);
    const groups = await call("GET", `/api/parties/${p.partyId}/groups`);
    expect(groups.json).toMatchObject({
      groups: [{ id: p.groupId, lineIds: [], courseIds: [course.id], summary: "" }],
    });
    const current = await call("GET", `/api/parties/${p.partyId}/current-orders`);
    expect(current.json).toMatchObject({ reminder: null, retainedCourses: [{ id: course.id }] });
    expect(await inTx(venue, (tx) => readReleaseReminders(tx, [p.partyId]))).toEqual(
      new Map([[p.partyId, null]]),
    );
  });

  it("places a fired source with the matching held course instead of blindly choosing Fire now", async () => {
    const p = await setup("fire");
    const course = await inTx(venue, (tx) =>
      createCourse(tx, venue.cfg, { name: `C-${randomUUID()}`, displayOrder: 3 }),
    );
    await venue.db
      .update(workingOrderLines)
      .set({ courseId: course.id })
      .where(eq(workingOrderLines.id, p.line.id));
    const held = await call("POST", `/api/parties/${p.partyId}/groups`, {
      ...(await command(p.partyId)),
      groups: [
        {
          release: "hold",
          lines: [{ menuItemId: venue.offerFor("Croquetas"), quantity: "1", courseId: course.id }],
        },
      ],
    });
    expect(held.status).toBe(200);
    const [{ id: heldId }] = (held.json as unknown as { groups: { id: string }[] }).groups;
    const answer = await recall(p.partyId, p.line.id);
    expect(answer.status).toBe(200);
    expect(answer.json).toMatchObject({ draft: { lines: [{ joinGroupId: heldId, slot: 0 }] } });
  });

  it("recalls and resends a discounted parent and its priced extra without changing either charge or adjustment", async () => {
    // Grouped, as an order stored before portions.
    const p = await setup("fire", 1, "grouped");
    const extraId = randomUUID();
    await venue.db.insert(workingOrderLines).values({
      id: extraId,
      workingOrderId: p.tabId,
      lineNo: 2,
      parentLineId: p.line.id,
      name: "Frozen sauce",
      descriptions: { "es-ES": "Frozen sauce customer" },
      quantity: 4000,
      unitPriceGross: 125,
      listUnitPriceGross: 175,
      lineTotal: 500,
      vatClass: "reduced",
      groupId: p.groupId,
    });
    const [item] = await venue.db
      .select()
      .from(ticketItems)
      .where(eq(ticketItems.workingOrderLineId, p.line.id));
    await venue.db.insert(ticketItems).values({
      nodeId: venue.cfg.nodeId,
      workingOrderId: p.tabId,
      workingOrderLineId: extraId,
      stationId,
      quantity: 4000,
      firedAt: item!.firedAt,
    });
    await inTx(venue, async (tx) => {
      const reason = await createAdjustmentReason(tx, {
        name: `Discount-${randomUUID()}`,
        names: {},
        kind: "comp",
        actions: ["discount_percent"],
        maxPercentBp: null,
        maxAmount: null,
        applyRoles: ["staff", "supervisor", "manager", "admin"],
        approverRoles: ["staff", "supervisor", "manager", "admin"],
        noteRequired: false,
      });
      const [bill] = await tx.select().from(workingOrders).where(eq(workingOrders.id, p.tabId));
      await applyAdjustment(
        tx,
        venue.cfg,
        {
          expectedEdit: await readBillEditState(tx, p.tabId),
          orderId: p.tabId,
          expectedRevision: bill!.revision,
          submissionId: randomUUID(),
          lineId: p.line.id,
          reasonId: reason.id,
          action: "discount_percent",
          percentBp: 2500,
          note: null,
          operatorId: venue.adminId,
        },
        venue.cfg.locale,
      );
    });
    const beforeLines = await venue.db
      .select()
      .from(workingOrderLines)
      .where(eq(workingOrderLines.workingOrderId, p.tabId));
    const beforeAdjustments = await venue.db.select().from(adjustments);
    const answer = await recall(p.partyId, p.line.id);
    expect(answer.status).toBe(200);
    const { draft } = answer.json as unknown as { draft: Draft };
    expect(draft.lines[0]).toMatchObject({
      sourceLineId: p.line.id,
      source: { netAmount: "30.76", extras: [{ id: extraId }] },
    });
    expect(
      await venue.db
        .select()
        .from(workingOrderLines)
        .where(eq(workingOrderLines.workingOrderId, p.tabId)),
    ).toEqual(beforeLines);
    expect(await venue.db.select().from(adjustments)).toEqual(beforeAdjustments);
    const resend = await call("POST", `/api/parties/${p.partyId}/drafts/${draft.id}/submit`, {
      ...(await command(p.partyId)),
      draftRevision: draft.revision,
      groups: [{ release: "fire", lineIds: [draft.lines[0]!.id] }],
    });
    expect(resend.status).toBe(200);
    expect(await venue.db.select().from(adjustments)).toEqual(beforeAdjustments);
    expect(
      (
        await venue.db
          .select()
          .from(workingOrderLines)
          .where(eq(workingOrderLines.workingOrderId, p.tabId))
      ).map((row) => ({ ...row, groupId: null, sentAt: null })),
    ).toEqual(beforeLines.map((row) => ({ ...row, groupId: null, sentAt: null })));
    expect((await recall(p.partyId, p.line.id)).status).toBe(200);
    expect(await venue.db.select().from(adjustments)).toEqual(beforeAdjustments);
  });

  it.each(["hold", "fire"] as const)(
    "recalls %s work to the acting owner's bill draft and replays without writes",
    async (release) => {
      // Grouped, as an order stored before portions.
      const p = await setup(release, 1, "grouped");
      const beforeLines = await venue.db
        .select()
        .from(workingOrderLines)
        .where(eq(workingOrderLines.workingOrderId, p.tabId));
      const body = { ...(await command(p.partyId)), operatorId: venue.adminId };
      const answer = await recall(p.partyId, p.line.id, body);
      expect(answer.status).toBe(200);
      const result = answer.json as unknown as { revision: number; draft: Draft };
      expect(result.revision).toBe(body.expectedPartyRevision + 1);
      expect(result.draft).toMatchObject({
        partyId: p.partyId,
        billId: p.tabId,
        ownerId: venue.operatorId,
        lines: [
          {
            sourceLineId: p.line.id,
            quantity: "2.000",
            slot: 0,
            joinGroupId: release === "hold" ? p.groupId : null,
            afterGroupId: null,
            noMerge: true,
            unavailable: false,
            source: { netAmount: "36.00" },
          },
        ],
      });
      expect(
        await venue.db
          .select()
          .from(workingOrderLines)
          .where(eq(workingOrderLines.workingOrderId, p.tabId)),
      ).toEqual(beforeLines);
      expect(
        await venue.db.select().from(ticketItems).where(eq(ticketItems.workingOrderId, p.tabId)),
      ).toEqual([]);
      const read = await call("GET", `/api/parties/${p.partyId}/drafts`);
      expect(read.json).toEqual({ drafts: [result.draft], billEdits: expect.any(Array) });
      const current = await call("GET", `/api/parties/${p.partyId}/current-orders`);
      expect(
        (current.json as unknown as { groups: { rows: unknown[] }[] }).groups.flatMap(
          (g) => g.rows,
        ),
      ).toEqual([]);
      const state = await frozen(p.partyId);
      expect(await recall(p.partyId, p.line.id, body)).toEqual(answer);
      expect(await frozen(p.partyId)).toEqual(state);
    },
  );

  it("appends to the own bill draft while preserving another person's draft and its revision", async () => {
    const p = await setup("hold");
    const otherBillId = randomUUID();
    await inTx(venue, (tx) =>
      createOpenOrder(tx, venue.cfg, otherBillId, [], p.tableLabel, {
        partyId: p.partyId,
        existingService: true,
        copyServiceContextFrom: p.tabId,
      }),
    );
    for (const ownerId of [venue.adminId, venue.operatorId])
      await venue.db.insert(orderDrafts).values({
        partyId: p.partyId,
        billId: ownerId === venue.adminId ? otherBillId : p.tabId,
        ownerId,
        revision: 7,
      });
    const before = await venue.db
      .select()
      .from(orderDrafts)
      .where(eq(orderDrafts.partyId, p.partyId));
    const answer = await recall(p.partyId, p.line.id);
    expect(answer.status).toBe(200);
    expect((answer.json as unknown as { draft: Draft }).draft).toMatchObject({
      id: before.find((d) => d.ownerId === venue.operatorId)!.id,
      revision: 8,
    });
    expect(
      (await venue.db.select().from(orderDrafts).where(eq(orderDrafts.partyId, p.partyId))).find(
        (d) => d.ownerId === venue.adminId,
      ),
    ).toEqual(before.find((d) => d.ownerId === venue.adminId));
  });

  it("fires only the other active dish, leaving the recalled reservation unsent", async () => {
    // Grouped, as an order stored before portions.
    const p = await setup("hold", 2, "grouped");
    const answer = await recall(p.partyId, p.line.id);
    expect(answer.status).toBe(200);
    const before = await venue.db.select().from(orderDraftRecalledLines);
    const fire = await call(
      "POST",
      `/api/parties/${p.partyId}/groups/${p.groupId}/fire`,
      await command(p.partyId),
    );
    expect(fire.status).toBe(200);
    expect(await venue.db.select().from(orderDraftRecalledLines)).toEqual(before);
    const items = await venue.db
      .select()
      .from(ticketItems)
      .where(eq(ticketItems.workingOrderId, p.tabId));
    expect(items.map((i) => i.workingOrderLineId)).toEqual([p.lines[1]!.id]);
    expect(items[0]!.firedAt).not.toBeNull();
  });

  it("retains an empty held group but a direct Fire cannot release its sole recalled dish", async () => {
    // Grouped, as an order stored before portions.
    const p = await setup("hold", 1, "grouped");
    expect((await recall(p.partyId, p.line.id)).status).toBe(200);
    const [group] = await venue.db.select().from(orderGroups).where(eq(orderGroups.id, p.groupId));
    expect(group).toMatchObject({ state: "held", displayNumber: 1 });
    const before = await frozen(p.partyId);
    const fire = await call(
      "POST",
      `/api/parties/${p.partyId}/groups/${p.groupId}/fire`,
      await command(p.partyId),
    );
    expect(fire.json).toMatchObject({
      code: "management.request_invalid",
      params: { field: "groupId" },
    });
    expect(await frozen(p.partyId)).toEqual(before);
  });

  it.each(["preparing", "ready"] as const)(
    "refuses %s work and retains every row",
    async (state) => {
      const p = await setup("fire");
      await venue.db
        .update(ticketItems)
        .set({ state })
        .where(eq(ticketItems.workingOrderId, p.tabId));
      const before = await frozen(p.partyId);
      expect((await recall(p.partyId, p.line.id)).json).toMatchObject({
        code: "ticket.already_started",
      });
      expect(await frozen(p.partyId)).toEqual(before);
    },
  );

  it("a sent dish no station makes can be recalled whatever the stations allow", async () => {
    const p = await setup("fire");
    await venue.db.delete(ticketItems).where(eq(ticketItems.workingOrderId, p.tabId));
    await inTx(venue, (tx) => setChangesAfterSending(tx, "never"));
    try {
      expect((await recall(p.partyId, p.line.id)).status).toBe(200);
      expect(
        await venue.db
          .select({ id: orderDraftRecalledLines.id })
          .from(orderDraftRecalledLines)
          .where(eq(orderDraftRecalledLines.sourceLineId, p.line.id)),
      ).toHaveLength(1);
    } finally {
      await inTx(venue, (tx) => setChangesAfterSending(tx, "held-or-waiting"));
    }
  });

  it("a held dish at a While held station is recalled; a waiting one is refused, changing nothing", async () => {
    await inTx(venue, (tx) => setChangesAfterSending(tx, "held"));
    try {
      const held = await setup("hold");
      expect((await recall(held.partyId, held.line.id)).status).toBe(200);
      const waiting = await setup("fire");
      const before = await frozen(waiting.partyId);
      expect((await recall(waiting.partyId, waiting.line.id)).json).toMatchObject({
        code: "ticket.already_fired",
        params: { workingOrderId: waiting.tabId },
      });
      expect(await frozen(waiting.partyId)).toEqual(before);
    } finally {
      await inTx(venue, (tx) => setChangesAfterSending(tx, "held-or-waiting"));
    }
  });

  it("a dish at a Not allowed station is refused even while held, changing nothing", async () => {
    try {
      const p = await setup("hold");
      const [item] = await venue.db
        .select({ stationId: ticketItems.stationId })
        .from(ticketItems)
        .where(eq(ticketItems.workingOrderLineId, p.line.id));
      await inTx(venue, (tx) => setChangesAfterSending(tx, "never", [item!.stationId]));
      const before = await frozen(p.partyId);
      expect((await recall(p.partyId, p.line.id)).json).toMatchObject({
        code: "ticket.already_fired",
        params: { workingOrderId: p.tabId },
      });
      expect(await frozen(p.partyId)).toEqual(before);
    } finally {
      await inTx(venue, (tx) => setChangesAfterSending(tx, "held-or-waiting"));
    }
  });

  it("a split-off extra's station can refuse its dish's Recall", async () => {
    // Grouped, as an order stored before portions.
    const p = await setup("hold", 1, "grouped");
    const sideId = (
      await inTx(venue, (tx) => createStation(tx, venue.cfg, { name: `Side-${randomUUID()}` }))
    ).id;
    const extraId = randomUUID();
    await venue.db.insert(workingOrderLines).values({
      id: extraId,
      workingOrderId: p.tabId,
      lineNo: 2,
      parentLineId: p.line.id,
      name: "Side extra",
      descriptions: { "es-ES": "Customer extra" },
      quantity: 1000,
      unitPriceGross: 100,
      lineTotal: 100,
      vatClass: "general",
      groupId: p.groupId,
    });
    await venue.db.insert(ticketItems).values({
      nodeId: venue.cfg.nodeId,
      workingOrderId: p.tabId,
      workingOrderLineId: extraId,
      stationId: sideId,
      state: "queued",
      firedAt: null,
    });
    await inTx(venue, (tx) => setChangesAfterSending(tx, "never", [sideId]));
    try {
      const before = await frozen(p.partyId);
      expect((await recall(p.partyId, p.line.id)).json).toMatchObject({
        code: "ticket.already_fired",
        params: { workingOrderId: p.tabId },
      });
      expect(await frozen(p.partyId)).toEqual(before);
      await inTx(venue, (tx) => setChangesAfterSending(tx, "held-or-waiting", [sideId]));
      expect((await recall(p.partyId, p.line.id)).status).toBe(200);
    } finally {
      await inTx(venue, (tx) => setChangesAfterSending(tx, "held-or-waiting"));
    }
  });

  it("a started dish is refused as started at a While held station and at a Not allowed station", async () => {
    try {
      for (const value of ["held", "never"] as const) {
        const p = await setup("fire");
        await venue.db
          .update(ticketItems)
          .set({ state: "preparing" })
          .where(eq(ticketItems.workingOrderId, p.tabId));
        await inTx(venue, (tx) => setChangesAfterSending(tx, value));
        const before = await frozen(p.partyId);
        expect((await recall(p.partyId, p.line.id)).json).toMatchObject({
          code: "ticket.already_started",
        });
        expect(await frozen(p.partyId)).toEqual(before);
      }
    } finally {
      await inTx(venue, (tx) => setChangesAfterSending(tx, "held-or-waiting"));
    }
  });

  it("refuses a served source and a line belonging to another party", async () => {
    const p = await setup("fire");
    await venue.db
      .update(workingOrderLines)
      .set({ servedQuantity: 1000 })
      .where(eq(workingOrderLines.id, p.line.id));
    expect((await recall(p.partyId, p.line.id)).json).toMatchObject({
      code: "management.request_invalid",
      params: { field: "lineId" },
    });
    const other = await setup("hold");
    const before = await frozen(other.partyId);
    expect((await recall(other.partyId, p.line.id)).json).toMatchObject({
      code: "bill.other_party",
    });
    expect(await frozen(other.partyId)).toEqual(before);
  });

  it("refuses a new command attempting to claim an already recalled source", async () => {
    const p = await setup("hold");
    expect((await recall(p.partyId, p.line.id)).status).toBe(200);
    const before = await frozen(p.partyId);
    expect((await recall(p.partyId, p.line.id)).json).toMatchObject({
      code: "management.request_invalid",
    });
    expect(await frozen(p.partyId)).toEqual(before);
  });

  it("records a RECALLED notice before removing the fired kitchen work", async () => {
    // Grouped, as an order stored before portions.
    const p = await setup("fire", 1, "grouped");
    expect((await recall(p.partyId, p.line.id)).status).toBe(200);
    const notices = await venue.db
      .select()
      .from(kitchenNotices)
      .where(
        and(eq(kitchenNotices.workingOrderId, p.tabId), eq(kitchenNotices.stationId, stationId)),
      );
    expect(notices).toEqual([
      expect.objectContaining({ lineName: "TARTA", kind: "recalled", quantity: 2000 }),
    ]);
    expect(
      await venue.db
        .select()
        .from(ticketItems)
        .where(inArray(ticketItems.workingOrderLineId, [p.line.id])),
    ).toEqual([]);
  });
  it("recalling a held dish cancels it on paper only at a station recorded for the group, and every screen is told", async () => {
    const kitchenPrinter = `Kitchen-${randomUUID()}`;
    const barPrinterName = `Bar-${randomUUID()}`;
    const { barId, screenId, printerIds, routed } = await inTx(venue, async (tx) => {
      const barId = (await createStation(tx, venue.cfg, { name: `Bar-${randomUUID()}` })).id;
      const screenId = (await createStation(tx, venue.cfg, { name: `Screen-${randomUUID()}` })).id;
      const printerIds: string[] = [];
      const routed: string[] = [];
      for (const [name, station] of [
        [kitchenPrinter, stationId],
        [barPrinterName, barId],
      ] as const) {
        const printer = await createPrinter(
          tx,
          { locationId: venue.cfg.locationId },
          { name, transport: "cloud_poll", pollId: randomUUID() },
        );
        await attachPrinterToStation(tx, {
          locationId: venue.cfg.locationId,
          stationId: station,
          printerId: printer.id,
        });
        printerIds.push(printer.id);
      }
      for (const [name, station] of [
        ["Paella", barId],
        ["Pulpo", screenId],
      ] as const) {
        const [product] = await tx
          .select({ id: products.id })
          .from(products)
          .where(eq(products.name, name));
        await routeProductTo(tx, venue.cfg, product!.id, station);
        routed.push(product!.id);
      }
      await setStationPrinting(tx, { printHeldWork: true }, [stationId, screenId]);
      await setStationPrinting(tx, { printHeldWork: false }, [barId]);
      return { barId, screenId, printerIds, routed };
    });
    const [kitchenPrinterId, barPrinterId] = printerIds as [string, string];
    const paperAt = async (printerId: string) =>
      (await venue.db.select().from(printJobs).where(eq(printJobs.printerId, printerId))).map(
        (job) => printedLines(job.payload).filter((line) => line.trim() !== ""),
      );
    try {
      const tableLabel = `R-${randomUUID().slice(0, 8)}`;
      const { id: tableId } = await inTx(venue, (tx) =>
        createTable(tx, venue.cfg, { label: tableLabel, zoneId: venue.zoneId }),
      );
      const seated = await call("POST", `/api/tables/${tableId}/seat`, {});
      const { partyId, tabId } = seated.json as unknown as { partyId: string; tabId: string };
      const answer = await call("POST", `/api/parties/${partyId}/groups`, {
        allergy: { party: { answer: "none", guests: [] }, ticks: [] },
        ...(await command(partyId)),
        groups: [
          {
            release: "hold",
            lines: ["Tarta", "Paella", "Pulpo"].map((name) => ({
              menuItemId: venue.offerFor(name),
              quantity: "1",
            })),
          },
        ],
      });
      expect(answer.status).toBe(200);
      const kitchenBefore = (await paperAt(kitchenPrinterId)).length;
      expect(kitchenBefore).toBe(1);
      expect(await paperAt(barPrinterId)).toEqual([]);
      const lines = await venue.db
        .select()
        .from(workingOrderLines)
        .where(eq(workingOrderLines.workingOrderId, tabId))
        .orderBy(asc(workingOrderLines.lineNo));

      for (const line of lines) expect((await recall(partyId, line.id)).status).toBe(200);

      const cancelled = (await paperAt(kitchenPrinterId)).slice(kitchenBefore);
      expect(cancelled).toHaveLength(1);
      expect(cancelled[0]![0]).toBe(`*** ${kitchenTicketWords("es").holdCancelled} ***`);
      expect(cancelled[0]!.at(-1)).toBe("1.000 x TARTA");
      expect(await paperAt(barPrinterId)).toEqual([]);
      const told = async (station: string) =>
        (
          await venue.db
            .select({ kind: kitchenNotices.kind, lineName: kitchenNotices.lineName })
            .from(kitchenNotices)
            .where(
              and(eq(kitchenNotices.workingOrderId, tabId), eq(kitchenNotices.stationId, station)),
            )
        ).map((notice) => ({ ...notice }));
      expect(await told(stationId)).toEqual([{ kind: "void", lineName: "TARTA" }]);
      expect(await told(barId)).toEqual([{ kind: "void", lineName: "PAELLA" }]);
      expect(await told(screenId)).toEqual([{ kind: "void", lineName: "PULPO" }]);
    } finally {
      await inTx(venue, async (tx) => {
        for (const productId of routed)
          await clearRoutingCell(tx, venue.cfg, {
            row: { kind: "product", productId },
            zoneId: null,
          });
        await setStationPrinting(tx, { printHeldWork: false }, [stationId]);
        await tx
          .update(kitchenStations)
          .set({ active: false })
          .where(inArray(kitchenStations.id, [barId, screenId]));
      });
    }
  });
});
