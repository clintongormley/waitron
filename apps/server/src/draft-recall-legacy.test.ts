import { readBillEditState } from "./bill-editing.js";
import { takeOverDraft } from "./order-drafts.js";
import { observedGroupCompositionBody } from "./testing/group-composition-fixture.js";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import {
  orderDrafts,
  orderDraftLines,
  orderDraftRecalledLines,
  orderDraftEvents,
  orderGroups,
  parties,
  printJobs,
  serviceCommands,
  ticketItems,
  workingOrderLines,
  workingOrders,
} from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { adjustments } from "@waitron/adjustments";
import { kitchenNotices } from "@waitron/venue-service";
import { inTx, provisionBillVenue, send, type BillVenue } from "./testing/bill-venue.js";
import { createTable } from "./testing/live-table.js";
import type { Draft } from "./order-drafts.js";

let venue: BillVenue;
useVenueDb({
  resetPerTest: false,
  migrations: migrationOptionsFor(manifestSets(), null),
  timeoutMs: 60_000,
  setup: async (db) => {
    venue = await provisionBillVenue(db);
  },
});

async function call(method: string, path: string, body?: unknown) {
  return send(
    venue.app,
    venue.cookie,
    method,
    path,
    await observedGroupCompositionBody(venue.db, path, body),
  );
}
async function command(partyId: string) {
  const [party] = await venue.db.select().from(parties).where(eq(parties.id, partyId));
  return { submissionId: randomUUID(), expectedPartyRevision: party!.revision };
}
async function setup(recalled: boolean, release: "hold" | "fire" = "hold") {
  const table = await inTx(venue, (tx) =>
    createTable(tx, venue.cfg, {
      label: `Legacy-${randomUUID()}`,
      zoneId: venue.zoneId,
    }),
  );
  const seated = await call("POST", `/api/tables/${table.id}/seat`, {});
  expect(seated.status).toBe(200);
  const { partyId, tabId } = seated.json as unknown as { partyId: string; tabId: string };
  expect(
    (
      await call("POST", `/api/parties/${partyId}/groups`, {
        ...(await command(partyId)),
        groups: [{ release, lines: [{ menuItemId: venue.offerFor("Tarta"), quantity: "2" }] }],
      })
    ).status,
  ).toBe(200);
  const [line] = await venue.db
    .select()
    .from(workingOrderLines)
    .where(eq(workingOrderLines.workingOrderId, tabId));
  let draft: Draft | undefined;
  if (recalled) {
    const answer = await call("POST", `/api/parties/${partyId}/lines/${line!.id}/recall`, {
      ...(await command(partyId)),
      expectedEdit: await inTx(venue, (tx) => readBillEditState(tx, tabId)),
    });
    expect(answer.status).toBe(200);
    draft = (answer.json as unknown as { draft: Draft }).draft;
  }
  const [bill] = await venue.db.select().from(workingOrders).where(eq(workingOrders.id, tabId));
  return { partyId, tabId, line: line!, draft, revision: bill!.revision };
}
type Fixture = Awaited<ReturnType<typeof setup>>;
async function frozen() {
  return {
    bills: await venue.db.select().from(workingOrders).orderBy(workingOrders.id),
    lines: await venue.db.select().from(workingOrderLines).orderBy(workingOrderLines.id),
    groups: await venue.db.select().from(orderGroups).orderBy(orderGroups.id),
    parties: await venue.db.select().from(parties).orderBy(parties.id),
    drafts: await venue.db.select().from(orderDrafts).orderBy(orderDrafts.id),
    fresh: await venue.db.select().from(orderDraftLines).orderBy(orderDraftLines.id),
    sources: await venue.db
      .select()
      .from(orderDraftRecalledLines)
      .orderBy(orderDraftRecalledLines.id),
    events: await venue.db.select().from(orderDraftEvents).orderBy(orderDraftEvents.id),
    commands: await venue.db.select().from(serviceCommands).orderBy(serviceCommands.id),
    items: await venue.db.select().from(ticketItems).orderBy(ticketItems.id),
    jobs: await venue.db.select().from(printJobs).orderBy(printJobs.id),
    notices: await venue.db.select().from(kitchenNotices).orderBy(kitchenNotices.id),
    adjustments: await venue.db.select().from(adjustments).orderBy(adjustments.id),
  };
}
const edits = {
  "line edit": (p: Fixture) =>
    call("PUT", `/api/working-orders/${p.tabId}/lines/${p.line.lineNo}`, {
      revision: p.revision,
      note: "Bypass",
    }),
  "basket edit": (p: Fixture) =>
    call("PUT", `/api/working-orders/${p.tabId}`, {
      revision: p.revision,
      lines: [
        { workingOrderLineId: p.line.id, menuItemId: venue.offerFor("Tarta"), quantity: "3" },
      ],
    }),
  "basket omission": (p: Fixture) =>
    call("PUT", `/api/working-orders/${p.tabId}`, {
      revision: p.revision,
      lines: [{ menuItemId: venue.offerFor("Croquetas"), quantity: "1" }],
    }),
  "course edit": (p: Fixture) =>
    call("PATCH", `/api/working-orders/${p.tabId}/lines/${p.line.lineNo}/course`, {
      courseId: null,
    }),
  "legacy recall": (p: Fixture) =>
    call("POST", `/api/working-orders/${p.tabId}/lines/recall`, { lineNos: [p.line.lineNo] }),
  "named send": (p: Fixture) =>
    call("POST", `/api/working-orders/${p.tabId}/lines/send`, { lineNos: [p.line.lineNo] }),
  "abandon bill": (p: Fixture) => call("DELETE", `/api/working-orders/${p.tabId}`),
  "place bill": (p: Fixture) => call("POST", `/api/working-orders/${p.tabId}/place`, {}),
  "group move": async (p: Fixture) =>
    call("POST", `/api/parties/${p.partyId}/groups/move`, {
      ...(await command(p.partyId)),
      moves: [{ lineId: p.line.id, quantity: "2" }],
      target: "new",
    }),
};

describe("recalled sources cannot bypass their draft through legacy writes", () => {
  it.each(Object.keys(edits) as (keyof typeof edits)[])(
    "refuses %s for both current and other owners without writes",
    async (operation) => {
      for (const ownerId of [venue.operatorId, venue.adminId]) {
        const p = await setup(true, operation === "named send" ? "fire" : "hold");
        if (ownerId !== venue.operatorId)
          await inTx(venue, async (tx) =>
            takeOverDraft(tx, venue.cfg, p.partyId, p.draft!.id, ownerId, {
              revision: p.draft!.revision,
              expectedEdit: await readBillEditState(tx, p.tabId),
              submissionId: randomUUID(),
            }),
          );
        const edit = await inTx(venue, (tx) => readBillEditState(tx, p.tabId));
        const before = await frozen();
        const answer = await edits[operation](p);
        expect(answer.json).toMatchObject({
          code:
            operation === "group move" && ownerId !== venue.operatorId
              ? "draft.taken_over"
              : "draft.out_of_date",
          params:
            operation === "group move" && ownerId !== venue.operatorId
              ? {
                  billId: p.tabId,
                  draftId: p.draft!.id,
                  ownerId,
                  ownerName: edit.editorName,
                  edit,
                  conflicts: [edit],
                }
              : { billId: p.tabId, draftId: p.draft!.id, revision: edit.draftRevision, edit },
        });
        expect(answer.status).toBe(409);
        expect(await frozen()).toEqual(before);
      }
    },
  );

  it.each(
    Object.keys(edits).filter(
      (key) => key !== "basket omission" && key !== "named send",
    ) as (keyof typeof edits)[],
  )("still serves %s on a bill without a recalled source", async (operation) => {
    const p = await setup(false);
    const answer = await edits[operation](p);
    expect(answer.status, JSON.stringify(answer.json)).toBe(200);
    if (operation === "line edit") {
      const [line] = await venue.db
        .select()
        .from(workingOrderLines)
        .where(eq(workingOrderLines.id, p.line.id));
      expect(line!.note).toBe("Bypass");
    }
    if (operation === "abandon bill") {
      const [bill] = await venue.db
        .select()
        .from(workingOrders)
        .where(eq(workingOrders.id, p.tabId));
      expect(bill!.status).toBe("abandoned");
    }
    if (operation === "place bill") {
      const [bill] = await venue.db
        .select()
        .from(workingOrders)
        .where(eq(workingOrders.id, p.tabId));
      expect(bill!.status).toBe("placed");
      expect(answer.json).toEqual({ id: p.tabId, status: "placed" });
    }
  });

  it("keeps another party's recalled identity outside the group-move lookup", async () => {
    const source = await setup(true);
    const other = await setup(false);
    const before = await frozen();
    const answer = await call("POST", `/api/parties/${other.partyId}/groups/move`, {
      ...(await command(other.partyId)),
      moves: [{ lineId: source.line.id, quantity: "2" }],
      target: "new",
    });
    expect(answer.json).toMatchObject({ code: "group.not_found" });
    expect(await frozen()).toEqual(before);
  });

  it("does not resend a recalled family through an unqualified legacy send", async () => {
    const p = await setup(true, "fire");
    const before = await frozen();
    expect((await call("POST", `/api/working-orders/${p.tabId}/lines/send`, {})).status).toBe(200);
    expect(await frozen()).toEqual(before);
  });

  it("keeps a recalled source off the station move path", async () => {
    const p = await setup(true);
    const before = await frozen();
    const other = await setup(false);
    const [item] = await venue.db
      .select()
      .from(ticketItems)
      .where(eq(ticketItems.workingOrderLineId, other.line.id));
    const unchanged = await frozen();
    const answer = await call("POST", `/api/working-orders/${p.tabId}/lines/move-station`, {
      submissionId: randomUUID(),
      lineIds: [p.line.id],
      stationId: item!.stationId,
    });
    expect(answer.json).toMatchObject({ code: "ticket.not_sent" });
    expect(await frozen()).toEqual(unchanged);
    expect(unchanged.sources).toEqual(before.sources);
  });

  it("allows editing another sent line of the same bill without touching the recalled draft", async () => {
    const p = await setup(true);
    expect(
      (
        await call("POST", `/api/parties/${p.partyId}/groups`, {
          ...(await command(p.partyId)),
          groups: [
            {
              release: "hold",
              lines: [{ menuItemId: venue.offerFor("Croquetas"), quantity: "1" }],
            },
          ],
        })
      ).status,
    ).toBe(200);
    const lines = await venue.db
      .select()
      .from(workingOrderLines)
      .where(eq(workingOrderLines.workingOrderId, p.tabId));
    const sibling = lines.find((line) => line.id !== p.line.id)!;
    const [bill] = await venue.db.select().from(workingOrders).where(eq(workingOrders.id, p.tabId));
    const before = await frozen();
    expect(
      (
        await call("PUT", `/api/working-orders/${p.tabId}/lines/${sibling.lineNo}`, {
          revision: bill!.revision,
          note: "Sibling only",
        })
      ).status,
    ).toBe(200);
    const after = await frozen();
    expect(after.lines.find((line) => line.id === sibling.id)!.note).toBe("Sibling only");
    expect(after.lines.find((line) => line.id === p.line.id)).toEqual(
      before.lines.find((line) => line.id === p.line.id),
    );
    expect(after.sources).toEqual(before.sources);
    expect(after.drafts).toEqual(before.drafts);
  });
});
