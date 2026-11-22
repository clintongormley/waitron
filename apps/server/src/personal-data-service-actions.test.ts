import { setImmediate as turn } from "node:timers/promises";
import {
  CORE_MIGRATIONS,
  lineServiceCancellations,
  orderAmendments,
  orderDrafts,
  orderEvents,
  orderGroups,
  parties,
  ticketItemMoves,
  withTransaction,
  workingOrderLines,
} from "@waitron/db";
import {
  seedKitchenStation,
  seedNode,
  seedPerson,
  seedVenue,
  seedWorkingOrder,
} from "@waitron/db/testing/seed.js";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { preparePersonalData } from "@waitron/module";
import { eq, sql } from "drizzle-orm";
import { expect, it } from "vitest";
import { personalDataServerParts } from "./personal-data-export-api.js";

const suite = useVenueDb({ migrations: [CORE_MIGRATIONS] });
const AT = "2026-11-21T19:00:00.000Z";
const LATER = "2026-11-21T19:10:00.000Z";
const empty = {
  orderEvents: [],
  groups: [],
  parties: [],
  dishMoves: [],
  amendments: [],
  cancellations: [],
  lateConfirmations: [],
};

async function buildFor(personId: string) {
  const parts = personalDataServerParts([], suite.db).filter(({ part }) =>
    part.files.includes("service-actions.json"),
  );
  return suite.db.withWriteLock(() =>
    preparePersonalData(suite.db, parts, {
      personId,
      language: "en",
      at: new Date(LATER),
      timeZone: "UTC",
    }),
  );
}

async function entries(personId: string) {
  const files = await (await buildFor(personId))();
  expect(files.map((file) => file.name)).toEqual(["service-actions.json"]);
  return JSON.parse(files[0]!.content as string);
}

it("exports the subject’s recorded service actions and only their roles", async () => {
  const { order, fromStation, toStation } = await withTransaction(suite.db, async (tx) => {
    await seedPerson(tx, { id: "ana", displayName: "Ana Canary" });
    await seedPerson(tx, { id: "bea", displayName: "Bea Canary" });
    await seedPerson(tx, { id: "clara", displayName: "Clara Canary" });
    await seedVenue(tx, { invoiceLocales: ["en"] });
    const nodeId = await seedNode(tx);
    const order = await seedWorkingOrder(tx, { orderNumber: 42, label: "Private bill name" });
    const fromStation = await seedKitchenStation(tx, { name: "Private station A" });
    const toStation = await seedKitchenStation(tx, { name: "Private station B", isDefault: false });
    await tx.insert(parties).values({
      id: "party",
      state: "closed",
      openedAt: AT,
      openedBy: "bea",
      closedAt: LATER,
      closedBy: "bea",
      name: "Private party",
      tableNames: ["Private table"],
      allergyAnswer: "allergies",
      allergyAnsweredBy: "ana",
      allergyAnsweredAt: LATER,
    });
    await tx.insert(orderGroups).values({
      id: "group",
      partyId: "party",
      position: 1,
      state: "fired",
      submittedBy: "ana",
      createdAt: AT,
      firedBy: "bea",
      firedAt: LATER,
    });
    await tx.insert(orderDrafts).values({ id: "draft", partyId: "party", ownerId: "clara" });
    await tx.insert(orderEvents).values([
      {
        id: "event-a",
        kind: "group.submitted",
        actorId: "ana",
        at: AT,
        partyId: "party",
        groupId: "group",
      },
      {
        kind: "draft.taken_over",
        actorId: "bea",
        fromPerson: "ana",
        toPerson: "bea",
        at: LATER,
        draftId: "draft",
        detail: { note: "Private draft note" },
      },
      {
        id: "event-b",
        kind: "dish.moved",
        actorId: "ana",
        at: AT,
        lineId: "prior-line",
        fromOrderId: "removed-bill",
        toOrderId: order.id,
      },
    ]);
    const line = {
      workingOrderId: order.id,
      name: "Private line name",
      descriptions: { en: "Private line name" },
      quantity: 1000,
      unitPriceGross: 600,
      lineTotal: 600,
      vatClass: "reduced",
      takeawayVatClass: "reduced",
    };
    await tx.insert(workingOrderLines).values([
      { ...line, id: "served-line", lineNo: 1, lateConfirmedBy: "bea", sentAt: AT },
      { ...line, id: "held-line", lineNo: 2, lateConfirmedBy: "ana" },
    ]);
    await tx.insert(ticketItemMoves).values({
      workingOrderLineId: "served-line",
      fromStationId: fromStation,
      toStationId: toStation,
      movedAt: LATER,
      movedByPersonId: "ana",
    });
    await tx.insert(orderAmendments).values({
      workingOrderId: order.id,
      sequenceNo: 1,
      kind: "order_placed",
      actorId: "ana",
      capturedBySource: "dashboard",
      capturedByNodeId: nodeId,
      eventAt: AT,
      eventOffsetMinutes: 0,
      entryHash: "A".repeat(64),
      isFirstEntry: true,
    });
    await tx.insert(lineServiceCancellations).values({
      lineId: "held-line",
      quantity: 1000,
      cancelledAt: AT,
      wasStarted: false,
      actorId: "ana",
    });
    await tx
      .update(lineServiceCancellations)
      .set({ cancelledAt: LATER, actorId: "bea" })
      .where(eq(lineServiceCancellations.lineId, "held-line"));
    return { order, fromStation, toStation };
  });

  const draft = {
    kind: "draft.taken_over",
    at: LATER,
    partyId: null,
    groupId: null,
    draftId: "draft",
    lineId: null,
    fromOrderId: null,
    toOrderId: null,
    fromOrderNumber: null,
    toOrderNumber: null,
  };
  expect(await entries("ana")).toEqual({
    ...empty,
    orderEvents: [
      {
        kind: "group.submitted",
        at: AT,
        partyId: "party",
        groupId: "group",
        draftId: null,
        lineId: null,
        fromOrderId: null,
        toOrderId: null,
        fromOrderNumber: null,
        toOrderNumber: null,
        yourPart: ["actor"],
      },
      {
        kind: "dish.moved",
        at: AT,
        partyId: null,
        groupId: null,
        draftId: null,
        lineId: "prior-line",
        fromOrderId: "removed-bill",
        toOrderId: order.id,
        fromOrderNumber: null,
        toOrderNumber: 42,
        yourPart: ["actor"],
      },
      { ...draft, yourPart: ["from"] },
    ],
    groups: [{ groupId: "group", action: "submitted", at: AT }],
    parties: [{ partyId: "party", action: "answeredAllergyQuestion", at: LATER }],
    dishMoves: [
      {
        lineId: "served-line",
        order: 42,
        fromStationId: fromStation,
        toStationId: toStation,
        at: LATER,
      },
    ],
    amendments: [{ order: 42, kind: "order_placed", at: AT }],
    lateConfirmations: [{ lineId: "held-line", order: 42, sentAt: null }],
  });
  expect(await entries("bea")).toEqual({
    ...empty,
    orderEvents: [{ ...draft, yourPart: ["actor", "to"] }],
    groups: [{ groupId: "group", action: "fired", at: LATER }],
    parties: [
      { partyId: "party", action: "opened", at: AT },
      { partyId: "party", action: "closed", at: LATER },
    ],
    cancellations: [{ lineId: "held-line", order: 42, at: LATER }],
    lateConfirmations: [{ lineId: "served-line", order: 42, sentAt: AT }],
  });
  expect(await (await buildFor("clara"))()).toEqual([]);
});

it("reads later pages after a concurrent edit and leaves out rows above the captured boundary", async () => {
  await withTransaction(suite.db, async (tx) => {
    await seedPerson(tx, { id: "ana", displayName: "Ana" });
    await seedPerson(tx, { id: "bea", displayName: "Bea" });
    await tx.run(sql`
      with recursive history(n) as (select 1 union all select n + 1 from history where n < 202)
      insert into parties (id, opened_at, opened_by)
      select 'party-' || n, ${AT}, case when n in (1, 100) then 'ana' else 'bea' end
      from history
    `);
  });

  const build = await buildFor("ana");
  const write = turn().then(() =>
    withTransaction(suite.db, async (tx) => {
      await tx
        .update(parties)
        .set({ state: "closed", closedBy: "ana", closedAt: LATER })
        .where(eq(parties.id, "party-202"));
      await tx.insert(parties).values({ id: "new-party", openedAt: LATER, openedBy: "ana" });
    }),
  );
  const [files] = await Promise.all([build(), write]);
  expect(files.map((file) => file.name)).toEqual(["service-actions.json"]);
  expect(JSON.parse(files[0]!.content as string)).toEqual({
    ...empty,
    parties: [
      { partyId: "party-1", action: "opened", at: AT },
      { partyId: "party-100", action: "opened", at: AT },
      { partyId: "party-202", action: "closed", at: LATER },
    ],
  });
});
