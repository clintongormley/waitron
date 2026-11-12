import { readBillEditState } from "./bill-editing.js";
import { observedDraftCommandBody } from "./testing/draft-command-fixture.js";
import { createOpenOrder } from "./working-order.js";
import { firstOpenBillOf } from "./testing/party-bill-of.js";
import { observedGroupSender } from "./testing/group-composition-fixture.js";
import { randomUUID } from "node:crypto";
import { asc, eq, sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import {
  billEditStates,
  billPayments,
  devices,
  kitchenStations,
  orderDraftLines,
  orderDrafts,
  orderGroups,
  parties,
  products,
  serviceCommands,
  ticketItems,
  withTransaction,
  workingOrderLines,
  workingOrders,
} from "@waitron/db";
import { clearRoutingCell, setRoutingCell, setStationToday } from "@waitron/venue-service";
import { PERSON_HEADER } from "@waitron/shared";
import { loginWithPin } from "@waitron/identity";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { seedWorkingOrder, seedActivityActor } from "@waitron/db/testing/seed.js";
import { createTable } from "./testing/live-table.js";
import {
  fiscalRecordCount,
  inTx,
  provisionBillVenue,
  send as rawGroupSend,
  type BillVenue,
} from "./testing/bill-venue.js";
import { SESSION_COOKIE } from "./till-session.js";
import "./errors.js";
import { splitBill } from "./testing/bill-action-fixture.js";

// The HTTP layer of the draft routes: body parsing, the operator taken from the session, the draft
// scoped to the party in the path, and the status each refusal maps to. What the commands do is
// pinned in `order-drafts.db.test.ts`.
let venue: BillVenue;
/** A second person's session: the provisioned administrator's. */
let adminCookie: string;

useVenueDb({
  resetPerTest: false,
  migrations: migrationOptionsFor(manifestSets(), null),
  timeoutMs: 60_000,
  setup: async (db) => {
    venue = await provisionBillVenue(db);
    const session = await withTransaction(db, (tx) =>
      loginWithPin(tx, { deviceId: venue.deviceId, personId: venue.adminId, pin: "1234" }),
    );
    adminCookie = `${SESSION_COOKIE}=${session.token}; ${venue.cookie.split("; ").slice(1).join("; ")}`;
  },
});

interface Seated {
  partyId: string;
  tabId: string;
  revision: number;
}

interface DraftAnswer {
  id: string;
  partyId: string;
  billId: string;
  ownerId: string;
  ownerName: string;
  revision: number;
  lines: { id: string; menuItemId: string; quantity: string }[];
}

async function seated(): Promise<Seated> {
  const { id: tableId } = await inTx(venue, (tx) =>
    createTable(tx, venue.cfg, { label: `D-${randomUUID().slice(0, 8)}`, zoneId: venue.zoneId }),
  );
  const seat = await send(venue.app, venue.cookie, "POST", `/api/tables/${tableId}/seat`, {});
  expect(seat.status).toBe(200);
  return seat.json as unknown as Seated;
}

/** Anna, the venue's staff session. */
async function ana(method: string, path: string, body?: unknown) {
  return send(venue.app, venue.cookie, method, path, await draftBody(method, path, body));
}

async function admin(method: string, path: string, body?: unknown) {
  return send(venue.app, adminCookie, method, path, await draftBody(method, path, body));
}

async function draftBody(method: string, path: string, body: unknown) {
  if (
    path.endsWith("/take-over") &&
    body !== null &&
    typeof body === "object" &&
    !Array.isArray(body)
  )
    body = { submissionId: randomUUID(), ...body };
  return observedDraftCommandBody(venue.db, method, path, body);
}
async function anotherBill(partyId: string): Promise<string> {
  const billId = randomUUID();
  await inTx(venue, (tx) =>
    createOpenOrder(tx, venue.cfg, billId, [], "", { partyId, existingService: true }),
  );
  return billId;
}
const dish = (name: string, quantity = "1") => ({ menuItemId: venue.offerFor(name), quantity });

/** A new draft of the caller's on the party, holding the lines. */
async function newDraft(
  caller: typeof ana,
  partyId: string,
  lines: ReturnType<typeof dish>[],
  billId?: string,
): Promise<DraftAnswer> {
  const saved = await caller("PUT", `/api/parties/${partyId}/drafts`, {
    billId: billId ?? (await openBillOf(partyId)),
    draftId: null,
    revision: 0,
    lines,
  });
  expect(saved.status).toBe(200);
  return saved.json.draft as unknown as DraftAnswer;
}

async function revisionOf(partyId: string): Promise<number> {
  const [row] = await inTx(venue, (tx) =>
    tx.select({ revision: parties.revision }).from(parties).where(eq(parties.id, partyId)),
  );
  return row!.revision;
}

async function submitBody(partyId: string, draft: DraftAnswer, lineIds = draft.lines) {
  return {
    submissionId: randomUUID(),
    draftRevision: draft.revision,
    expectedPartyRevision: await revisionOf(partyId),
    allergy: { party: { answer: "none", guests: [] }, ticks: [] },
    groups: [{ lineIds: lineIds.map((line) => line.id), release: "fire" }],
  };
}

/** Every row of every table in the venue database, so a refusal can be shown to write none. */
async function snapshot() {
  return inTx(venue, async (tx) => {
    const tables = await tx.all<{ name: string }>(
      sql`select name from sqlite_master where type = 'table' order by name`,
    );
    const rows: Record<string, unknown[]> = {};
    for (const { name } of tables) {
      rows[name] = await tx.all(sql`select * from ${sql.identifier(name)} order by rowid`);
    }
    return rows;
  });
}

async function lineNames(billId: string): Promise<string[]> {
  const rows = await inTx(venue, (tx) =>
    tx
      .select({ name: workingOrderLines.name })
      .from(workingOrderLines)
      .where(eq(workingOrderLines.workingOrderId, billId))
      .orderBy(asc(workingOrderLines.lineNo)),
  );
  return rows.map((row) => row.name);
}

async function openBillOf(partyId: string): Promise<string | null> {
  return inTx(venue, (tx) => firstOpenBillOf(tx, partyId));
}

function refusal(code: string, params?: Record<string, unknown>) {
  return params === undefined ? expect.objectContaining({ code }) : { code, params };
}

describe("draft metadata for closing a joined party", () => {
  it("includes retained bill versions from its closed family without acquiring an editor", async () => {
    const current = await seated();
    const historical = await seated();
    const unrelated = await seated();
    await inTx(venue, async (tx) => {
      await tx
        .update(workingOrders)
        .set({ status: "abandoned" })
        .where(eq(workingOrders.id, historical.tabId));
      await tx
        .update(parties)
        .set({
          state: "closed",
          closedAt: "2026-10-18T00:00:00.000Z",
          mergedIntoPartyId: current.partyId,
        })
        .where(eq(parties.id, historical.partyId));
      await tx
        .insert(billEditStates)
        .values({ billId: historical.tabId, editorId: null, editorVersion: 6 });
    });
    const before = await snapshot();
    const read = await ana("GET", `/api/parties/${current.partyId}/drafts`);
    expect(read.status).toBe(200);
    expect(read.json).toEqual({
      drafts: [],
      billEdits: expect.arrayContaining([
        {
          billId: current.tabId,
          editorId: null,
          editorName: null,
          editorVersion: 0,
          draftId: null,
          draftRevision: null,
        },
        {
          billId: historical.tabId,
          editorId: null,
          editorName: null,
          editorVersion: 6,
          draftId: null,
          draftRevision: null,
        },
      ]),
    });
    const edits = read.json.billEdits as unknown as { billId: string }[];
    expect(edits).toHaveLength(2);
    expect(edits.map((edit) => edit.billId)).not.toContain(unrelated.tabId);
    expect(await snapshot()).toEqual(before);
  });
});

describe("GET /api/parties/:id/drafts", () => {
  it("returns the empty bill's editing state without acquiring it or recording activity", async () => {
    const party = await seated();
    await inTx(venue, (tx) =>
      tx
        .update(devices)
        .set({ lastSeenAt: "2020-01-01T00:00:00.000Z" })
        .where(eq(devices.id, venue.deviceId)),
    );
    const before = await snapshot();
    const read = await ana("GET", `/api/parties/${party.partyId}/drafts`);
    expect(read.status).toBe(200);
    expect(await snapshot()).toEqual(before);
    expect(read.json).toEqual({
      drafts: [],
      billEdits: [
        {
          billId: party.tabId,
          editorId: null,
          editorName: null,
          editorVersion: 0,
          draftId: null,
          draftRevision: null,
        },
      ],
    });
    expect((await ana("GET", `/api/parties/${party.partyId.toUpperCase()}/drafts`)).json).toEqual(
      read.json,
    );
    expect(await snapshot()).toEqual(before);
  });

  it("returns separate editors and empty bills in bill order, excluding another party", async () => {
    const party = await seated();
    const foreign = await seated();
    const [main] = await inTx(venue, (tx) =>
      tx.select().from(workingOrders).where(eq(workingOrders.id, party.tabId)),
    );
    const secondId = "eeeeeeee-0000-4000-8000-000000000002";
    const emptyId = "dddddddd-0000-4000-8000-000000000003";
    await inTx(venue, async (tx) => {
      await seedWorkingOrder(tx, {
        id: emptyId,
        source: "dashboard",
        partyId: party.partyId,
        orderNumber: main!.orderNumber + 2,
        openedAt: main!.openedAt,
      });
      await seedWorkingOrder(tx, {
        id: secondId,
        source: "dashboard",
        partyId: party.partyId,
        orderNumber: main!.orderNumber + 1,
        openedAt: main!.openedAt,
      });
    });
    const first = await newDraft(ana, party.partyId, [dish("Caña")]);
    const saved = await admin("PUT", `/api/parties/${party.partyId}/drafts`, {
      billId: secondId,
      draftId: null,
      revision: 0,
      lines: [dish("Octopus")],
    });
    expect(saved.status).toBe(200);
    const second = saved.json.draft as unknown as DraftAnswer;
    await newDraft(admin, foreign.partyId, [dish("Caña")]);
    await inTx(venue, async (tx) => {
      for (const row of [
        { billId: secondId, editorId: venue.adminId, editorVersion: 8 },
        { billId: party.tabId, editorId: venue.operatorId, editorVersion: 3 },
        { billId: foreign.tabId, editorId: venue.adminId, editorVersion: 12 },
      ])
        await tx.update(billEditStates).set(row).where(eq(billEditStates.billId, row.billId));
    });
    const before = await snapshot();
    const read = await ana("GET", `/api/parties/${party.partyId}/drafts`);
    expect(read.status).toBe(200);
    const { drafts, billEdits } = read.json as unknown as {
      drafts: DraftAnswer[];
      billEdits: unknown[];
    };
    expect([...drafts].sort((a, b) => a.id.localeCompare(b.id))).toEqual(
      [first, second].sort((a, b) => a.id.localeCompare(b.id)),
    );
    expect(billEdits).toEqual([
      {
        billId: party.tabId,
        editorId: venue.operatorId,
        editorName: "Anna",
        editorVersion: 3,
        draftId: first.id,
        draftRevision: first.revision,
      },
      {
        billId: secondId,
        editorId: venue.adminId,
        editorName: "Administrator",
        editorVersion: 8,
        draftId: second.id,
        draftRevision: second.revision,
      },
      {
        billId: emptyId,
        editorId: null,
        editorName: null,
        editorVersion: 0,
        draftId: null,
        draftRevision: null,
      },
    ]);
    expect(await snapshot()).toEqual(before);
  });

  it("retains a released version without creating rows", async () => {
    const party = await seated();
    await inTx(venue, (tx) =>
      tx.insert(billEditStates).values({ billId: party.tabId, editorVersion: 9 }),
    );
    const before = await snapshot();
    const read = await ana("GET", `/api/parties/${party.partyId}/drafts`);
    expect(read.status).toBe(200);
    expect(read.json).toEqual({
      drafts: [],
      billEdits: [
        {
          billId: party.tabId,
          editorId: null,
          editorName: null,
          editorVersion: 9,
          draftId: null,
          draftRevision: null,
        },
      ],
    });
    expect(await snapshot()).toEqual(before);
  });

  it("requires the current session before revealing bill editor facts", async () => {
    const party = await seated();
    const read = await send(venue.app, "", "GET", `/api/parties/${party.partyId}/drafts`);
    expect(read.status).toBe(401);
    expect(read.json).toEqual({ code: "session.required", params: {} });
  });

  it("answers every open draft on the party, each person's, with the owner's name", async () => {
    const party = await seated();
    const anas = await newDraft(ana, party.partyId, [dish("Caña", "2")]);
    const admins = await newDraft(
      admin,
      party.partyId,
      [dish("Octopus")],
      await anotherBill(party.partyId),
    );

    const read = await ana("GET", `/api/parties/${party.partyId}/drafts`);
    const upper = await ana("GET", `/api/parties/${party.partyId.toUpperCase()}/drafts`);

    expect(read.status).toBe(200);
    const { drafts } = read.json as unknown as { drafts: DraftAnswer[] };
    expect([...drafts].sort((a, b) => a.ownerName.localeCompare(b.ownerName))).toEqual([
      admins,
      anas,
    ]);
    expect(anas).toMatchObject({ ownerId: venue.operatorId, ownerName: "Anna" });
    expect(admins).toMatchObject({ ownerId: venue.adminId, ownerName: "Administrator" });
    expect(upper).toEqual(read);
  });

  it("refuses 409 party.not_open for an id that is not one", async () => {
    const refused = await ana("GET", "/api/parties/not-a-uuid/drafts");

    expect(refused.status).toBe(409);
    expect(refused.json).toEqual(refusal("party.not_open", { partyId: "not-a-uuid" }));
  });
});

describe("PUT /api/parties/:id/drafts", () => {
  it("returns the bill supplied by the till and refuses another party's bill", async () => {
    const party = await seated();
    const other = await seated();
    const first = await ana("PUT", `/api/parties/${party.partyId}/drafts`, {
      billId: party.tabId.toUpperCase(),
      draftId: null,
      revision: 0,
      lines: [dish("Caña")],
    });
    expect(first.status).toBe(200);
    expect(first.json.draft).toMatchObject({ partyId: party.partyId, billId: party.tabId });
    const foreign = await ana("PUT", `/api/parties/${party.partyId}/drafts`, {
      billId: other.tabId,
      draftId: null,
      revision: 0,
      lines: [dish("Octopus")],
    });
    expect(foreign.status).toBe(409);
    expect(foreign.json).toEqual(refusal("bill.other_party", { workingOrderId: other.tabId }));
    const read = await ana("GET", `/api/parties/${party.partyId}/drafts`);
    expect(read.json).toEqual({ drafts: [first.json.draft], billEdits: expect.any(Array) });
  });

  describe.each(["joinGroupId", "afterGroupId"] as const)("stored %s target", (field) => {
    it.each(["foreign", "missing", "fired", "removed"] as const)(
      "refuses %s without changing any venue row",
      async (state) => {
        const party = await seated();
        const foreign = await seated();
        const groupId = randomUUID();
        if (state !== "missing") {
          await inTx(venue, (tx) =>
            tx.insert(orderGroups).values({
              id: groupId,
              partyId: state === "foreign" ? foreign.partyId : party.partyId,
              position: 1,
              state: state === "foreign" ? "held" : state,
              firedAt: state === "fired" ? "2026-10-17T00:00:00.000Z" : null,
              submittedBy: venue.operatorId,
            }),
          );
        }
        const draft = await newDraft(ana, party.partyId, [dish("Octopus")]);
        const before = await snapshot();
        const answer = await ana("PUT", `/api/parties/${party.partyId}/drafts`, {
          billId: await openBillOf(party.partyId),
          draftId: draft.id,
          revision: draft.revision,
          lines: [{ ...dish("Caña"), slot: field === "afterGroupId" ? 1 : 0, [field]: groupId }],
        });
        expect(answer.status).toBe(state === "foreign" || state === "missing" ? 400 : 409);
        expect(answer.json).toEqual(
          refusal(
            state === "foreign" || state === "missing" ? "group.not_found" : "group.not_held",
            { groupId },
          ),
        );
        expect(await snapshot()).toEqual(before);
      },
    );
  });

  it("returns saved placement on every line through PUT, GET, resave and takeover", async () => {
    const party = await seated();
    const groupId = randomUUID();
    await inTx(venue, (tx) =>
      tx.insert(orderGroups).values({
        id: groupId,
        partyId: party.partyId,
        position: 1,
        state: "held",
        submittedBy: venue.operatorId,
      }),
    );
    const places = [
      { slot: 0, joinGroupId: null, afterGroupId: null },
      { slot: 2, joinGroupId: null, afterGroupId: null },
      { slot: 0, joinGroupId: groupId, afterGroupId: null },
      { slot: 3, joinGroupId: null, afterGroupId: groupId },
    ];
    const saved = await ana("PUT", `/api/parties/${party.partyId}/drafts`, {
      billId: await openBillOf(party.partyId),
      draftId: null,
      revision: 0,
      lines: places.map((place, index) => ({
        ...dish("Caña"),
        quantity: ["2", "0.375", "1", "1"][index],
        ...place,
      })),
    });
    expect(saved.status).toBe(200);
    const draft = saved.json.draft as unknown as DraftAnswer;
    expect(draft.lines).toMatchObject(places);
    expect(draft.lines).toHaveLength(4);
    expect(draft.lines.map((line) => line.quantity)).toEqual(["2.000", "0.375", "1.000", "1.000"]);
    const again = await ana("PUT", `/api/parties/${party.partyId}/drafts`, {
      billId: await openBillOf(party.partyId),
      draftId: draft.id,
      revision: draft.revision,
      lines: draft.lines,
    });
    expect(again.status).toBe(200);
    const reread = await ana("GET", `/api/parties/${party.partyId}/drafts`);
    expect(reread.status).toBe(200);
    expect(reread.json).toEqual({ drafts: [again.json.draft], billEdits: expect.any(Array) });
    expect((again.json.draft as unknown as DraftAnswer).lines).toMatchObject(places);
    const taken = await admin(
      "POST",
      `/api/parties/${party.partyId}/drafts/${draft.id}/take-over`,
      {
        revision: (again.json.draft as unknown as DraftAnswer).revision,
      },
    );
    expect(taken.status).toBe(200);
    expect((taken.json.draft as unknown as DraftAnswer).lines).toMatchObject(places);
  });

  it.each([
    [{ slot: null }, "lines.0.slot"],
    [{ slot: -1 }, "lines.0.slot"],
    [{ joinGroupId: "held" }, "lines.0.joinGroupId"],
    [{ slot: 1, joinGroupId: "aaaaaaaa-0000-4000-8000-000000000001" }, "lines.0.slot"],
    [{ afterGroupId: "aaaaaaaa-0000-4000-8000-000000000001" }, "lines.0.afterGroupId"],
  ] as const)("refuses malformed placement %j as 400 naming %s", async (place, field) => {
    const party = await seated();
    const draft = await newDraft(ana, party.partyId, [dish("Octopus")]);
    const before = await snapshot();
    const answer = await ana("PUT", `/api/parties/${party.partyId}/drafts`, {
      billId: await openBillOf(party.partyId),
      draftId: draft.id,
      revision: draft.revision,
      lines: [{ ...dish("Caña"), ...place }],
    });
    expect(answer.status).toBe(400);
    expect(answer.json).toEqual(refusal("management.request_invalid", { field }));
    expect(await snapshot()).toEqual(before);
  });

  it("keeps a chosen station through re-minting and keeps identical dishes at different stations apart", async () => {
    const party = await seated();
    const [bar] = await inTx(venue, (tx) =>
      tx
        .insert(kitchenStations)
        .values({
          name: `Upstairs bar ${randomUUID()}`,
        })
        .returning({ id: kitchenStations.id }),
    );
    const saved = await ana("PUT", `/api/parties/${party.partyId}/drafts`, {
      billId: await openBillOf(party.partyId),
      draftId: null,
      revision: 0,
      lines: [{ ...dish("Caña"), makeAt: bar!.id }, dish("Caña")],
    });
    expect(saved.status).toBe(200);
    const answer = saved.json.draft as { id: string; lines: { makeAt: string | null }[] };
    expect(answer.lines.map((line) => line.makeAt)).toEqual([bar!.id, null]);
    const stored = await inTx(venue, (tx) =>
      tx
        .select({ makeAt: orderDraftLines.makeAtStationId })
        .from(orderDraftLines)
        .where(eq(orderDraftLines.draftId, answer.id)),
    );
    expect(stored.map((line) => line.makeAt)).toEqual([bar!.id, null]);
  });

  it("keeps a draft saveable after its already chosen station is switched off", async () => {
    const party = await seated();
    const [bar] = await inTx(venue, (tx) =>
      tx
        .insert(kitchenStations)
        .values({
          name: `Closing bar ${randomUUID()}`,
        })
        .returning({ id: kitchenStations.id }),
    );
    const first = await ana("PUT", `/api/parties/${party.partyId}/drafts`, {
      billId: await openBillOf(party.partyId),
      draftId: null,
      revision: 0,
      lines: [{ ...dish("Caña"), makeAt: bar!.id }],
    });
    expect(first.status).toBe(200);
    const draft = first.json.draft as unknown as DraftAnswer;
    await inTx(venue, (tx) =>
      tx.update(kitchenStations).set({ active: false }).where(eq(kitchenStations.id, bar!.id)),
    );
    const second = await ana("PUT", `/api/parties/${party.partyId}/drafts`, {
      billId: await openBillOf(party.partyId),
      draftId: draft.id,
      revision: draft.revision,
      lines: [{ ...dish("Caña"), quantity: "2", makeAt: bar!.id }],
    });
    expect(second.status).toBe(200);
    expect(second.json.draft).toMatchObject({ lines: [{ quantity: "2.000", makeAt: bar!.id }] });
    const updated = second.json.draft as unknown as DraftAnswer;
    const newChoice = await ana("PUT", `/api/parties/${party.partyId}/drafts`, {
      billId: await openBillOf(party.partyId),
      draftId: draft.id,
      revision: updated.revision,
      lines: [
        { ...dish("Caña"), quantity: "2", makeAt: bar!.id },
        { ...dish("Tarta"), makeAt: bar!.id },
      ],
    });
    expect(newChoice.status).toBe(409);
    expect(newChoice.json).toMatchObject({
      code: "route.station_inactive",
      params: { stationId: bar!.id },
    });
  });

  it("refuses 409 session.person_not_signed_in for a new order saved for someone else, writing nothing", async () => {
    const party = await seated();
    const billId = (await openBillOf(party.partyId))!;
    const before = await snapshot();

    const refused = await send(
      venue.app,
      adminCookie,
      "PUT",
      `/api/parties/${party.partyId}/drafts`,
      {
        billId,
        draftId: null,
        revision: 0,
        lines: [dish("Octopus")],
        expectedEdit: { billId, editorVersion: 0, draftId: null, draftRevision: null },
      },
      { [PERSON_HEADER]: venue.operatorId },
    );

    expect(refused.status).toBe(409);
    expect(refused.json).toEqual(
      refusal("session.person_not_signed_in", { personId: venue.operatorId }),
    );
    expect(await snapshot()).toEqual(before);
  });

  it("refuses 409 session.person_not_signed_in for an empty save for someone else", async () => {
    const party = await seated();
    const billId = (await openBillOf(party.partyId))!;
    const before = await snapshot();

    const refused = await send(
      venue.app,
      adminCookie,
      "PUT",
      `/api/parties/${party.partyId}/drafts`,
      {
        billId,
        draftId: null,
        revision: 0,
        lines: [],
        expectedEdit: { billId, editorVersion: 0, draftId: null, draftRevision: null },
      },
      { [PERSON_HEADER]: venue.operatorId },
    );

    expect(refused.status).toBe(409);
    expect(refused.json).toEqual(
      refusal("session.person_not_signed_in", { personId: venue.operatorId }),
    );
    expect(await snapshot()).toEqual(before);
  });

  it("still saves the signed-in person's own new order, whatever case the id is written in", async () => {
    const party = await seated();
    const billId = (await openBillOf(party.partyId))!;

    const saved = await send(
      venue.app,
      venue.cookie,
      "PUT",
      `/api/parties/${party.partyId}/drafts`,
      {
        billId,
        draftId: null,
        revision: 0,
        lines: [dish("Octopus")],
        expectedEdit: { billId, editorVersion: 0, draftId: null, draftRevision: null },
      },
      { [PERSON_HEADER]: venue.operatorId.toUpperCase() },
    );

    expect(saved.status).toBe(200);
    expect(saved.json.draft).toMatchObject({ ownerId: venue.operatorId });
  });

  it("saves a draft whose body names nobody when the header names the session's person", async () => {
    const party = await seated();
    const billId = (await openBillOf(party.partyId))!;

    const saved = await send(
      venue.app,
      venue.cookie,
      "PUT",
      `/api/parties/${party.partyId}/drafts`,
      {
        billId,
        draftId: null,
        revision: 0,
        lines: [dish("Octopus")],
        expectedEdit: { billId, editorVersion: 0, draftId: null, draftRevision: null },
      },
      { [PERSON_HEADER]: venue.operatorId },
    );

    expect(saved.status).toBe(200);
    expect(saved.json.draft).toMatchObject({ ownerId: venue.operatorId });
  });

  it("saves the session's person's draft, whatever operatorId the body carries", async () => {
    const party = await seated();

    const saved = await ana("PUT", `/api/parties/${party.partyId}/drafts`, {
      billId: await openBillOf(party.partyId),
      draftId: null,
      revision: 0,
      operatorId: venue.adminId,
      lines: [dish("Tarta")],
    });

    expect(saved.status).toBe(200);
    expect(saved.json.draft).toMatchObject({
      partyId: party.partyId,
      ownerId: venue.operatorId,
      revision: 0,
      lines: [{ menuItemId: venue.offerFor("Tarta"), quantity: "1.000", unavailable: false }],
    });
  });

  it("refuses 409 draft.taken_over for a save or a submit by someone other than the owner, writing nothing", async () => {
    const party = await seated();
    const anas = await newDraft(ana, party.partyId, [dish("Caña")]);
    const before = await snapshot();
    const taken = refusal("draft.taken_over", {
      billId: party.tabId,
      edit: await inTx(venue, (tx) => readBillEditState(tx, party.tabId)),
      draftId: anas.id,
      ownerId: venue.operatorId,
      ownerName: "Anna",
    });

    const saved = await admin("PUT", `/api/parties/${party.partyId}/drafts`, {
      billId: await openBillOf(party.partyId),
      draftId: anas.id,
      revision: anas.revision,
      operatorId: venue.operatorId,
      lines: [dish("Octopus")],
    });
    const submitted = await admin(
      "POST",
      `/api/parties/${party.partyId}/drafts/${anas.id}/submit`,
      {
        ...(await submitBody(party.partyId, anas)),
        operatorId: venue.operatorId,
      },
    );

    expect(saved.status).toBe(409);
    expect(saved.json).toEqual(taken);
    expect(submitted.status).toBe(409);
    expect(submitted.json).toEqual(taken);
    expect(await snapshot()).toEqual(before);
  });
});

describe("POST /api/dead-ends/draft", () => {
  it("answers a selected draft line with the closed station and current station choices", async () => {
    const party = await seated();
    const draft = await newDraft(ana, party.partyId, [dish("Caña")]);
    const [bar] = await inTx(venue, (tx) =>
      tx
        .insert(kitchenStations)
        .values({
          name: `Upstairs bar ${randomUUID()}`,
        })
        .returning({ id: kitchenStations.id, name: kitchenStations.name }),
    );
    const [beer] = await inTx(venue, (tx) =>
      tx.select({ id: products.id }).from(products).where(eq(products.name, "Caña")),
    );
    await inTx(venue, async (tx) => {
      await setRoutingCell(
        tx,
        { row: { kind: "product", productId: beer!.id }, zoneId: null },
        { kind: "station", stationId: bar!.id },
      );
      await setStationToday(tx, bar!.id, "closed", new Date(), await seedActivityActor(tx));
    });
    const [defaultStation] = await inTx(venue, (tx) =>
      tx
        .select({ id: kitchenStations.id })
        .from(kitchenStations)
        .where(eq(kitchenStations.isDefault, true)),
    );
    await inTx(venue, (tx) =>
      tx
        .update(kitchenStations)
        .set({ active: false })
        .where(eq(kitchenStations.id, defaultStation!.id)),
    );
    try {
      const response = await ana("POST", "/api/dead-ends/draft", {
        partyId: party.partyId,
        draftId: draft.id,
        lineIds: [draft.lines[0]!.id],
      });
      expect(response.status).toBe(200);
      expect(response.json).toMatchObject({
        sends: true,
        deadEnds: [
          {
            key: draft.lines[0]!.id,
            name: "Caña",
            quantity: "1.000",
            stationId: bar!.id,
            stationName: bar!.name,
            why: "closed",
          },
        ],
        stations: expect.arrayContaining([{ id: bar!.id, name: bar!.name, open: false }]),
      });
    } finally {
      await inTx(venue, async (tx) => {
        await clearRoutingCell(tx, {
          row: { kind: "product", productId: beer!.id },
          zoneId: null,
        });
        await setStationToday(tx, bar!.id, null, new Date(), await seedActivityActor(tx));
      });
      await inTx(venue, (tx) =>
        tx
          .update(kitchenStations)
          .set({ active: true })
          .where(eq(kitchenStations.id, defaultStation!.id)),
      );
    }
  });
});

describe("a draft's chosen station at submission", () => {
  it("sends a dish to its chosen active station after that station closes, and refuses it without a choice", async () => {
    const party = await seated();
    const [bar] = await inTx(venue, (tx) =>
      tx
        .insert(kitchenStations)
        .values({
          name: `Draft bar ${randomUUID()}`,
        })
        .returning({ id: kitchenStations.id }),
    );
    const [beer] = await inTx(venue, (tx) =>
      tx.select({ id: products.id }).from(products).where(eq(products.name, "Caña")),
    );
    await inTx(venue, async (tx) => {
      await setRoutingCell(
        tx,
        { row: { kind: "product", productId: beer!.id }, zoneId: null },
        { kind: "station", stationId: bar!.id },
      );
      await setStationToday(tx, bar!.id, "closed", new Date(), await seedActivityActor(tx));
    });
    const chosen = await ana("PUT", `/api/parties/${party.partyId}/drafts`, {
      billId: await openBillOf(party.partyId),
      draftId: null,
      revision: 0,
      lines: [{ ...dish("Caña"), makeAt: bar!.id }],
    });
    expect(chosen.status).toBe(200);
    const draft = chosen.json.draft as unknown as DraftAnswer;
    const sent = await ana(
      "POST",
      `/api/parties/${party.partyId}/drafts/${draft.id}/submit`,
      await submitBody(party.partyId, draft),
    );
    expect(sent.status).toBe(200);
    const items = await inTx(venue, (tx) =>
      tx
        .select({ stationId: ticketItems.stationId })
        .from(ticketItems)
        .where(eq(ticketItems.workingOrderId, party.tabId)),
    );
    expect(items.map((item) => item.stationId)).toContain(bar!.id);
    const [defaultStation] = await inTx(venue, (tx) =>
      tx
        .select({ id: kitchenStations.id })
        .from(kitchenStations)
        .where(eq(kitchenStations.isDefault, true)),
    );
    await inTx(venue, (tx) =>
      tx
        .update(kitchenStations)
        .set({ active: false })
        .where(eq(kitchenStations.id, defaultStation!.id)),
    );
    try {
      const another = await newDraft(ana, party.partyId, [dish("Caña")]);
      const before = await snapshot();
      const refused = await ana(
        "POST",
        `/api/parties/${party.partyId}/drafts/${another.id}/submit`,
        await submitBody(party.partyId, another),
      );
      expect(refused.status).toBe(409);
      expect(refused.json).toMatchObject({ code: "station.no_replacement" });
      expect(await snapshot()).toEqual(before);
    } finally {
      await inTx(venue, async (tx) => {
        await clearRoutingCell(tx, {
          row: { kind: "product", productId: beer!.id },
          zoneId: null,
        });
        await setStationToday(tx, bar!.id, null, new Date(), await seedActivityActor(tx));
      });
      await inTx(venue, (tx) =>
        tx
          .update(kitchenStations)
          .set({ active: true })
          .where(eq(kitchenStations.id, defaultStation!.id)),
      );
    }
  });
});

describe("POST /api/parties/:id/drafts/:did/take-over", () => {
  it("transfers a chosen station in place while retaining the taker's other bill draft", async () => {
    const party = await seated();
    const [bar] = await inTx(venue, (tx) =>
      tx
        .insert(kitchenStations)
        .values({
          name: `Taken bar ${randomUUID()}`,
        })
        .returning({ id: kitchenStations.id }),
    );
    const own = await newDraft(
      ana,
      party.partyId,
      [dish("Tarta")],
      await anotherBill(party.partyId),
    );
    const other = await admin("PUT", `/api/parties/${party.partyId}/drafts`, {
      billId: await openBillOf(party.partyId),
      draftId: null,
      revision: 0,
      lines: [{ ...dish("Caña"), makeAt: bar!.id }],
    });
    expect(other.status).toBe(200);
    const otherDraft = other.json.draft as unknown as DraftAnswer;
    const taken = await ana(
      "POST",
      `/api/parties/${party.partyId}/drafts/${otherDraft.id}/take-over`,
      { revision: otherDraft.revision },
    );
    expect(taken.status).toBe(200);
    expect(taken.json.draft).toMatchObject({
      id: otherDraft.id,
      billId: otherDraft.billId,
      ownerId: venue.operatorId,
      lines: [{ id: otherDraft.lines[0]!.id, menuItemId: venue.offerFor("Caña"), makeAt: bar!.id }],
    });
    const read = await ana("GET", `/api/parties/${party.partyId}/drafts`);
    expect((read.json.drafts as DraftAnswer[]).find((d) => d.id === own.id)).toEqual(own);
  });

  it("makes the session's person the owner, and refuses 409 draft.out_of_date for a stale revision and current released facts for a sent draft", async () => {
    const party = await seated();
    const anas = await newDraft(ana, party.partyId, [dish("Croquettes")]);

    const taken = await admin("POST", `/api/parties/${party.partyId}/drafts/${anas.id}/take-over`, {
      revision: anas.revision,
    });

    expect(taken.status).toBe(200);
    const admins = taken.json.draft as unknown as DraftAnswer;
    expect(admins).toMatchObject({
      id: anas.id,
      ownerId: venue.adminId,
      revision: anas.revision + 1,
    });
    const before = await snapshot();
    const stale = await ana("POST", `/api/parties/${party.partyId}/drafts/${anas.id}/take-over`, {
      revision: anas.revision,
    });
    expect(stale.status).toBe(409);
    expect(stale.json).toEqual(
      refusal("draft.out_of_date", {
        billId: party.tabId,
        edit: await inTx(venue, (tx) => readBillEditState(tx, party.tabId)),
        draftId: anas.id,
        revision: admins.revision,
      }),
    );
    expect(await snapshot()).toEqual(before);

    const sent = await admin(
      "POST",
      `/api/parties/${party.partyId}/drafts/${anas.id}/submit`,
      await submitBody(party.partyId, admins),
    );
    expect(sent.status).toBe(200);
    const afterSending = await snapshot();
    const late = await ana("POST", `/api/parties/${party.partyId}/drafts/${anas.id}/take-over`, {
      revision: admins.revision + 1,
    });
    expect(late.status).toBe(409);
    expect(late.json).toEqual(
      refusal("draft.out_of_date", {
        billId: party.tabId,
        draftId: null,
        revision: null,
        edit: await inTx(venue, (tx) => readBillEditState(tx, party.tabId)),
      }),
    );
    expect(await snapshot()).toEqual(afterSending);
  });

  it("refuses 409 session.person_not_signed_in for a take-over naming someone else, changing nothing, and goes through once it names the session's person", async () => {
    const party = await seated();
    const anas = await newDraft(ana, party.partyId, [dish("Croquettes")]);
    const path = `/api/parties/${party.partyId}/drafts/${anas.id}/take-over`;
    const owner = async () => {
      const [row] = await inTx(venue, (tx) =>
        tx
          .select({ ownerId: orderDrafts.ownerId })
          .from(orderDrafts)
          .where(eq(orderDrafts.id, anas.id)),
      );
      return row!.ownerId;
    };
    const editor = async () =>
      (await inTx(venue, (tx) => readBillEditState(tx, party.tabId))).editorId;
    const takeOverNaming = async (personId: string) =>
      send(
        venue.app,
        adminCookie,
        "POST",
        path,
        await draftBody("POST", path, { revision: anas.revision }),
        { [PERSON_HEADER]: personId },
      );
    const recorded = async () =>
      (await inTx(venue, (tx) => tx.select().from(serviceCommands))).length;
    const before = await snapshot();
    const recordedBefore = await recorded();

    for (const named of [venue.operatorId, venue.operatorId.toUpperCase()]) {
      const refused = await takeOverNaming(named);
      expect(refused.status).toBe(409);
      expect(refused.json).toEqual(
        refusal("session.person_not_signed_in", { personId: venue.operatorId }),
      );
    }
    expect(await owner()).toBe(venue.operatorId);
    expect(await editor()).toBe(venue.operatorId);
    expect(await snapshot()).toEqual(before);

    const taken = await takeOverNaming(venue.adminId);
    expect(taken.status).toBe(200);
    expect(await owner()).toBe(venue.adminId);
    expect(await editor()).toBe(venue.adminId);
    expect(await recorded()).toBe(recordedBefore + 1);
  });

  it("goes through when the session's person is named with a capitalised id", async () => {
    const party = await seated();
    const anas = await newDraft(ana, party.partyId, [dish("Croquettes")]);
    const path = `/api/parties/${party.partyId}/drafts/${anas.id}/take-over`;

    const taken = await send(
      venue.app,
      adminCookie,
      "POST",
      path,
      await draftBody("POST", path, { revision: anas.revision }),
      { [PERSON_HEADER]: venue.adminId.toUpperCase() },
    );

    expect(taken.status).toBe(200);
    expect(taken.json.draft).toMatchObject({ id: anas.id, ownerId: venue.adminId });
  });
});

describe("POST /api/parties/:id/drafts/:did/submit", () => {
  it("sends the named lines as groups, answers the groups and the draft left, and replays a retry with the first answer", async () => {
    const party = await seated();
    const anas = await newDraft(ana, party.partyId, [dish("Caña"), dish("Octopus")]);
    const body = await submitBody(party.partyId, anas, [anas.lines[0]!]);

    const first = await ana("POST", `/api/parties/${party.partyId}/drafts/${anas.id}/submit`, body);

    expect(first.status).toBe(200);
    expect(first.json).toMatchObject({
      tabId: party.tabId,
      revision: party.revision + 1,
      groups: [{ state: "fired", summary: "1 × Caña" }],
      draft: { id: anas.id, revision: anas.revision + 1, lines: [anas.lines[1]] },
    });
    const before = await snapshot();
    // The retry spells both ids in upper case: the path's party is folded as it is stored.
    const again = await ana(
      "POST",
      `/api/parties/${party.partyId.toUpperCase()}/drafts/${anas.id.toUpperCase()}/submit`,
      body,
    );
    expect(again.status).toBe(200);
    expect(again.json).toEqual(first.json);
    expect(await snapshot()).toEqual(before);
  });

  it("adds the lines to the held group joinGroupId names", async () => {
    const party = await seated();
    const anas = await newDraft(ana, party.partyId, [dish("Tarta"), dish("Croquettes")]);
    const held = await ana("POST", `/api/parties/${party.partyId}/drafts/${anas.id}/submit`, {
      ...(await submitBody(party.partyId, anas, [anas.lines[0]!])),
      groups: [{ lineIds: [anas.lines[0]!.id], release: "hold" }],
    });
    const heldAnswer = held.json as unknown as { groups: { id: string }[]; draft: DraftAnswer };

    const joined = await ana("POST", `/api/parties/${party.partyId}/drafts/${anas.id}/submit`, {
      ...(await submitBody(party.partyId, heldAnswer.draft)),
      groups: [{ lineIds: [anas.lines[1]!.id], release: "hold" }],
      joinGroupId: heldAnswer.groups[0]!.id,
    });

    expect(joined.status).toBe(200);
    expect(joined.json).toMatchObject({
      groups: [{ id: heldAnswer.groups[0]!.id, summary: "1 × Tarta, 1 × Croquettes" }],
      draft: null,
    });
  });
});

describe("POST /api/parties/:id/drafts/:did/submit uses its saved bill", () => {
  it("ignores a body bill override and replays the same submission without that extra field", async () => {
    const party = await seated();
    const anas = await newDraft(ana, party.partyId, [dish("Caña"), dish("Octopus")]);
    const first = await ana(
      "POST",
      `/api/parties/${party.partyId}/drafts/${anas.id}/submit`,
      await submitBody(party.partyId, anas, [anas.lines[0]!]),
    );
    expect(first.status).toBe(200);
    const left = (first.json as unknown as { draft: DraftAnswer }).draft;
    const command = {
      expectedPartyRevision: await revisionOf(party.partyId),
      operatorId: venue.operatorId,
    };
    const { billId: checkId } = await inTx(venue, (tx) =>
      splitBill(tx, venue.cfg, party.tabId, [{ lineNo: 1 }], command),
    );
    const body = {
      ...(await submitBody(party.partyId, left)),
      billId: checkId.toUpperCase(),
    };

    const named = await ana("POST", `/api/parties/${party.partyId}/drafts/${anas.id}/submit`, body);

    expect(named.status).toBe(200);
    expect(named.json).toMatchObject({ tabId: party.tabId });
    expect(await lineNames(checkId)).toEqual(["Caña"]);
    expect(await lineNames(party.tabId)).toEqual(["Octopus"]);
    expect(await openBillOf(party.partyId)).toBe(party.tabId);
    const before = await snapshot();

    // `undefined` leaves the key out of the JSON body.
    const reused = await ana("POST", `/api/parties/${party.partyId}/drafts/${anas.id}/submit`, {
      ...body,
      billId: undefined,
    });

    expect(reused.status).toBe(200);
    expect(reused.json).toEqual(named.json);
    expect(await snapshot()).toEqual(before);
  });
});

describe("a draft named on another party", () => {
  it("is refused 404 draft.not_found by the save, the take-over and the submit, as is an id that is not one", async () => {
    const firstParty = await seated();
    const secondParty = await seated();
    const anas = await newDraft(ana, firstParty.partyId, [dish("Caña")]);
    const before = await snapshot();

    const answers = [
      await ana("PUT", `/api/parties/${secondParty.partyId}/drafts`, {
        billId: await openBillOf(secondParty.partyId),
        draftId: anas.id,
        revision: anas.revision,
        lines: [],
      }),
      await admin("POST", `/api/parties/${secondParty.partyId}/drafts/${anas.id}/take-over`, {
        revision: anas.revision,
      }),
      await ana(
        "POST",
        `/api/parties/${secondParty.partyId}/drafts/${anas.id}/submit`,
        await submitBody(secondParty.partyId, anas),
      ),
    ];
    const notAnId = await admin(
      "POST",
      `/api/parties/${firstParty.partyId}/drafts/draft-1/take-over`,
      {
        revision: 0,
      },
    );

    for (const answer of answers) {
      expect(answer.status).toBe(404);
      expect(answer.json).toEqual(refusal("draft.not_found", { draftId: anas.id }));
    }
    expect(notAnId.status).toBe(404);
    expect(notAnId.json).toEqual(refusal("draft.not_found", { draftId: "draft-1" }));
    expect(await snapshot()).toEqual(before);
  });

  it("refuses 404 draft.not_found for a submit to an id that is not one, even under a submission id the party has used", async () => {
    const party = await seated();
    const anas = await newDraft(ana, party.partyId, [dish("Caña"), dish("Octopus")]);
    const body = await submitBody(party.partyId, anas, [anas.lines[0]!]);
    const sent = await ana("POST", `/api/parties/${party.partyId}/drafts/${anas.id}/submit`, body);
    expect(sent.status).toBe(200);
    const before = await snapshot();

    const refused = await ana("POST", `/api/parties/${party.partyId}/drafts/draft-1/submit`, body);

    expect(refused.status).toBe(404);
    expect(refused.json).toEqual(refusal("draft.not_found", { draftId: "draft-1" }));
    expect(await snapshot()).toEqual(before);
  });
});

const ID = "cccccccc-0000-4000-8000-000000000001";

describe("a malformed body", () => {
  it.each([
    ["body", []],
    ["draftId", { revision: 0, lines: [] }],
    ["draftId", { draftId: 42, revision: 0, lines: [] }],
    ["draftId", { draftId: "draft-1", revision: 0, lines: [] }],
    ["revision", { draftId: null, lines: [] }],
    ["revision", { draftId: null, revision: 1.5, lines: [] }],
    ["revision", { draftId: null, revision: "0", lines: [] }],
    ["lines", { draftId: null, revision: 0, lines: {} }],
    ["billId", { draftId: null, revision: 0, lines: [], billId: null }],
    ["billId", { draftId: null, revision: 0, lines: [], billId: "bill-1" }],
    ["billId", { draftId: null, revision: 0, lines: [] }],
    ["lines.0.quantity", { draftId: null, revision: 0, lines: [{ menuItemId: ID, quantity: 1 }] }],
  ] as const)(
    "refuses a save 400 management.request_invalid naming %s for %j",
    async (field, body) => {
      const party = await seated();
      await newDraft(ana, party.partyId, [dish("Caña")]);
      const before = await snapshot();

      const refused = await admin("PUT", `/api/parties/${party.partyId}/drafts`, body);

      expect(refused.status).toBe(400);
      expect(refused.json).toEqual(refusal("management.request_invalid", { field }));
      expect(await snapshot()).toEqual(before);
    },
  );

  it.each([
    ["body", "revision"],
    ["revision", {}],
    ["revision", { revision: -1 }],
    ["revision", { revision: 0.5 }],
  ] as const)(
    "refuses a take-over 400 management.request_invalid naming %s for %j",
    async (field, body) => {
      const party = await seated();
      const anas = await newDraft(ana, party.partyId, [dish("Caña")]);
      const before = await snapshot();

      const refused = await admin(
        "POST",
        `/api/parties/${party.partyId}/drafts/${anas.id}/take-over`,
        body,
      );

      expect(refused.status).toBe(400);
      expect(refused.json).toEqual(refusal("management.request_invalid", { field }));
      expect(await snapshot()).toEqual(before);
    },
  );

  const valid = { submissionId: "s", draftRevision: 0, expectedPartyRevision: 0 };
  it.each([
    ["body", null],
    ["submissionId", { ...valid, submissionId: undefined, groups: [] }],
    ["draftRevision", { ...valid, draftRevision: 0.5, groups: [] }],
    ["draftRevision", { ...valid, draftRevision: undefined, groups: [] }],
    ["expectedPartyRevision", { ...valid, expectedPartyRevision: "0", groups: [] }],
    ["groups", { ...valid, groups: {} }],
    ["groups", { ...valid, groups: [null] }],
    ["lineIds", { ...valid, groups: [{ release: "fire" }] }],
    ["lineIds", { ...valid, groups: [{ lineIds: "all", release: "fire" }] }],
    ["lineIds", { ...valid, groups: [{ lineIds: [3], release: "fire" }] }],
    ["release", { ...valid, groups: [{ lineIds: [] }] }],
    ["release", { ...valid, groups: [{ lineIds: [], release: "later" }] }],
    ["joinGroupId", { ...valid, groups: [{ lineIds: [], release: "hold" }], joinGroupId: 4 }],
  ] as const)(
    "refuses a submit 400 management.request_invalid naming %s for %j",
    async (field, body) => {
      const party = await seated();
      const anas = await newDraft(ana, party.partyId, [dish("Caña")]);
      const before = await snapshot();

      const refused = await ana(
        "POST",
        `/api/parties/${party.partyId}/drafts/${anas.id}/submit`,
        body,
      );

      expect(refused.status).toBe(400);
      expect(refused.json).toEqual(refusal("management.request_invalid", { field }));
      expect(await snapshot()).toEqual(before);
    },
  );
});

describe("a line's answers of the wrong shape", () => {
  it.each([
    ["options.invalid", "optionSelections", { options: {} }],
    [
      "options.invalid",
      "optionSelections.colour",
      { options: [{ listId: ID, labelId: ID, colour: "red" }] },
    ],
    ["extras.invalid", "extraSelections", { extras: "all" }],
    [
      "extras.invalid",
      "extraSelections.price",
      { extras: [{ listId: ID, picks: [], price: "1" }] },
    ],
  ] as const)(
    "refuses a save 400 %s naming %s, as a group submission pricing the same line does",
    async (code, field, answers) => {
      const party = await seated();
      await newDraft(ana, party.partyId, [dish("Caña")]);
      const before = await snapshot();
      const line = { ...dish("Caña"), ...answers };

      const saved = await admin("PUT", `/api/parties/${party.partyId}/drafts`, {
        billId: await openBillOf(party.partyId),
        draftId: null,
        revision: 0,
        lines: [line],
      });
      const priced = await ana("POST", `/api/parties/${party.partyId}/groups`, {
        submissionId: randomUUID(),
        expectedPartyRevision: await revisionOf(party.partyId),
        groups: [{ lines: [line], release: "fire" }],
      });

      expect(saved.status).toBe(400);
      expect(saved.json).toEqual(refusal(code, { field }));
      expect(priced.status).toBe(400);
      expect(priced.json).toEqual(saved.json);
      expect(await snapshot()).toEqual(before);
    },
  );
});

describe("source-backed draft HTTP boundary", () => {
  it.each(["save", "submit"] as const)(
    "returns the invoice when a draft %s settles the bill",
    async (operation) => {
      const party = await seated();
      if (operation === "save") {
        const sent = await ana("POST", `/api/parties/${party.partyId}/groups`, {
          submissionId: randomUUID(),
          expectedPartyRevision: await revisionOf(party.partyId),
          allergy: { party: { answer: "none", guests: [] }, ticks: [] },
          groups: [{ release: "fire", lines: [dish("Caña")] }],
        });
        expect(sent.status).toBe(200);
      }
      const draft = await newDraft(ana, party.partyId, [dish("Caña")]);
      await venue.db.insert(billPayments).values({
        workingOrderId: party.tabId,
        submissionId: randomUUID(),
        fingerprint: "fixture",
        kind: "contribution",
        method: "cash",
        applied: 300,
        tendered: 300,
        state: "received",
        requestedBy: venue.operatorId,
        source: "device",
        deviceId: venue.deviceId,
        receivedAt: new Date().toISOString(),
      });
      const method = operation === "save" ? "PUT" : "POST";
      const path = `/api/parties/${party.partyId}/drafts${operation === "save" ? "" : `/${draft.id}/submit`}`;
      const body =
        operation === "save"
          ? { billId: party.tabId, draftId: draft.id, revision: draft.revision, lines: [] }
          : await submitBody(party.partyId, draft);
      const answer = await ana(method, path, body);
      expect(answer.status, JSON.stringify(answer.json)).toBe(200);
      expect(answer.json).toMatchObject({ invoice: { total: "3.00", invoiceType: "F2" } });
      if (operation === "submit") {
        const before = await snapshot();
        const records = fiscalRecordCount(venue);
        expect(await ana(method, path, body)).toEqual(answer);
        expect(fiscalRecordCount(venue)).toEqual(records);
        expect(await snapshot()).toEqual(before);
      }
    },
  );
});

describe("per-group HTTP destinations draft", () => {
  async function prepared() {
    const party = await seated();
    const initial = await ana("POST", `/api/parties/${party.partyId}/groups`, {
      submissionId: randomUUID(),
      expectedPartyRevision: party.revision,
      allergy: { party: { answer: "none", guests: [] }, ticks: [] },
      groups: [
        { release: "hold", lines: [dish("Tarta")] },
        { release: "hold", lines: [dish("Croquettes")] },
      ],
    });
    expect(initial.status).toBe(200);
    const [first, second] = (initial.json as unknown as { groups: { id: string }[] }).groups;
    return { party, first: first!.id, second: second!.id };
  }

  it("preserves joins and insert-after through the real request", async () => {
    const { party, first, second } = await prepared();
    const draft = await newDraft(ana, party.partyId, [
      dish("Caña"),
      dish("Octopus"),
      dish("Croquettes"),
      dish("Tarta"),
    ]);
    const groups = [
      { release: "fire", lineIds: [draft.lines[0]!.id] },
      { release: "hold", joinGroupId: first.toUpperCase(), lineIds: [draft.lines[1]!.id] },
      { release: "hold", joinGroupId: second, lineIds: [draft.lines[2]!.id] },
      { release: "hold", afterGroupId: first.toUpperCase(), lineIds: [draft.lines[3]!.id] },
    ];
    const body = {
      submissionId: randomUUID(),
      expectedPartyRevision: (await submitBody(party.partyId, draft)).expectedPartyRevision,
      groups,
      draftRevision: draft.revision,
    };
    const response = await ana(
      "POST",
      `/api/parties/${party.partyId}/drafts/${draft.id}/submit`,
      body,
    );
    expect(response.status).toBe(200);
    expect(response.json).toMatchObject({
      groups: [
        { state: "fired", displayNumber: 3 },
        { id: first, state: "held", displayNumber: 1 },
        { id: second, state: "held", displayNumber: 2, position: 3 },
        { state: "held", displayNumber: 4, position: 2 },
      ],
      draft: null,
    });
    const before = await snapshot();
    expect(
      await ana("POST", `/api/parties/${party.partyId}/drafts/${draft.id}/submit`, body),
    ).toEqual(response);
    expect(await snapshot()).toEqual(before);
  });

  it("keeps the entire draft and all stored rows when a later join target is missing", async () => {
    const { party, first } = await prepared();
    const draft = await newDraft(ana, party.partyId, [dish("Caña"), dish("Octopus")]);
    const before = await snapshot();
    const refused = await ana("POST", `/api/parties/${party.partyId}/drafts/${draft.id}/submit`, {
      ...(await submitBody(party.partyId, draft)),
      groups: [
        { release: "hold", joinGroupId: first, lineIds: [draft.lines[0]!.id] },
        { release: "hold", joinGroupId: randomUUID(), lineIds: [draft.lines[1]!.id] },
      ],
    });
    expect(refused.status).toBe(404);
    expect(refused.json).toMatchObject({ code: "group.not_found" });
    expect(await snapshot()).toEqual(before);
  });

  it.each(["joinGroupId", "afterGroupId"] as const)(
    "refuses malformed %s values instead of ignoring them",
    async (field) => {
      const { party } = await prepared();
      const draft = await newDraft(ana, party.partyId, [
        dish("Caña"),
        dish("Octopus"),
        dish("Croquettes"),
        dish("Tarta"),
      ]);
      for (const value of [null, 2, [], {}, "", "missing"]) {
        const before = await snapshot();
        const refused = await ana(
          "POST",
          `/api/parties/${party.partyId}/drafts/${draft.id}/submit`,
          {
            submissionId: randomUUID(),
            expectedPartyRevision: (await submitBody(party.partyId, draft)).expectedPartyRevision,
            draftRevision: draft.revision,
            groups: [{ release: "hold", [field]: value, lineIds: [draft.lines[0]!.id] }],
          },
        );
        expect(refused.status).toBe(400);
        expect(refused.json).toMatchObject({
          code: "management.request_invalid",
          params: { field },
        });
        expect(await snapshot()).toEqual(before);
      }
    },
  );
});

const send = observedGroupSender(() => venue.db, rawGroupSend);
