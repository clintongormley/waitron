import { randomUUID } from "node:crypto";
import { asc, eq, sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import {
  kitchenStations,
  orderDraftLines,
  parties,
  products,
  ticketItems,
  withTransaction,
  workingOrderLines,
} from "@waitron/db";
import { createException, routeExceptions, setStationToday } from "@waitron/venue-service";
import { loginWithPin } from "@waitron/identity";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { createTable } from "./tables.js";
import { inTx, provisionBillVenue, send, type BillVenue } from "./testing/bill-venue.js";
import { SESSION_COOKIE } from "./till-session.js";
import "./errors.js";
import { splitBill } from "./bill-actions.js";

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
      loginWithPin(tx, { tillId: venue.cfg.tillId, personId: venue.adminId, pin: "1234" }),
    );
    adminCookie = `${SESSION_COOKIE}=${session.token}`;
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

/** Ana, the venue's staff session. */
function ana(method: string, path: string, body?: unknown) {
  return send(venue.app, venue.cookie, method, path, body);
}

function admin(method: string, path: string, body?: unknown) {
  return send(venue.app, adminCookie, method, path, body);
}

const dish = (name: string, quantity = "1") => ({ menuItemId: venue.offerFor(name), quantity });

/** A new draft of the caller's on the party, holding the lines. */
async function newDraft(
  caller: typeof ana,
  partyId: string,
  lines: ReturnType<typeof dish>[],
): Promise<DraftAnswer> {
  const saved = await caller("PUT", `/api/parties/${partyId}/drafts`, {
    draftId: null,
    revision: 0,
    lines,
  });
  expect(saved.status).toBe(200);
  return saved.json as unknown as DraftAnswer;
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

async function mainBillOf(partyId: string): Promise<string | null> {
  const [row] = await inTx(venue, (tx) =>
    tx.select({ mainBillId: parties.mainBillId }).from(parties).where(eq(parties.id, partyId)),
  );
  return row!.mainBillId;
}

function refusal(code: string, params?: Record<string, unknown>) {
  return params === undefined ? expect.objectContaining({ code }) : { code, params };
}

describe("GET /api/parties/:id/drafts", () => {
  it("answers every open draft on the party, each person's, with the owner's name", async () => {
    const party = await seated();
    const anas = await newDraft(ana, party.partyId, [dish("Caña", "2")]);
    const admins = await newDraft(admin, party.partyId, [dish("Pulpo")]);

    const read = await ana("GET", `/api/parties/${party.partyId}/drafts`);
    const upper = await ana("GET", `/api/parties/${party.partyId.toUpperCase()}/drafts`);

    expect(read.status).toBe(200);
    const { drafts } = read.json as unknown as { drafts: DraftAnswer[] };
    expect([...drafts].sort((a, b) => a.ownerName.localeCompare(b.ownerName))).toEqual([
      admins,
      anas,
    ]);
    expect(anas).toMatchObject({ ownerId: venue.operatorId, ownerName: "Ana" });
    expect(admins).toMatchObject({ ownerId: venue.adminId, ownerName: "Administradora" });
    expect(upper).toEqual(read);
  });

  it("refuses 409 party.not_open for an id that is not one", async () => {
    const refused = await ana("GET", "/api/parties/not-a-uuid/drafts");

    expect(refused.status).toBe(409);
    expect(refused.json).toEqual(refusal("party.not_open", { partyId: "not-a-uuid" }));
  });
});

describe("PUT /api/parties/:id/drafts", () => {
  it("keeps a chosen station through re-minting and keeps identical dishes at different stations apart", async () => {
    const party = await seated();
    const [bar] = await inTx(venue, (tx) =>
      tx
        .insert(kitchenStations)
        .values({
          locationId: venue.cfg.locationId,
          name: `Upstairs bar ${randomUUID()}`,
        })
        .returning({ id: kitchenStations.id }),
    );
    const saved = await ana("PUT", `/api/parties/${party.partyId}/drafts`, {
      draftId: null,
      revision: 0,
      lines: [{ ...dish("Caña"), makeAt: bar!.id }, dish("Caña")],
    });
    expect(saved.status).toBe(200);
    const answer = saved.json as { id: string; lines: { makeAt: string | null }[] };
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
          locationId: venue.cfg.locationId,
          name: `Closing bar ${randomUUID()}`,
        })
        .returning({ id: kitchenStations.id }),
    );
    const first = await ana("PUT", `/api/parties/${party.partyId}/drafts`, {
      draftId: null,
      revision: 0,
      lines: [{ ...dish("Caña"), makeAt: bar!.id }],
    });
    expect(first.status).toBe(200);
    const draft = first.json as unknown as DraftAnswer;
    await inTx(venue, (tx) =>
      tx.update(kitchenStations).set({ active: false }).where(eq(kitchenStations.id, bar!.id)),
    );
    const second = await ana("PUT", `/api/parties/${party.partyId}/drafts`, {
      draftId: draft.id,
      revision: draft.revision,
      lines: [{ ...dish("Caña"), quantity: "2", makeAt: bar!.id }],
    });
    expect(second.status).toBe(200);
    expect(second.json).toMatchObject({ lines: [{ quantity: "2.000", makeAt: bar!.id }] });
    const updated = second.json as unknown as DraftAnswer;
    const newChoice = await ana("PUT", `/api/parties/${party.partyId}/drafts`, {
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

  it("saves the session's person's draft, whatever operator the body names", async () => {
    const party = await seated();

    const saved = await ana("PUT", `/api/parties/${party.partyId}/drafts`, {
      draftId: null,
      revision: 0,
      operatorId: venue.adminId,
      lines: [dish("Tarta")],
    });

    expect(saved.status).toBe(200);
    expect(saved.json).toMatchObject({
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
      draftId: anas.id,
      ownerId: venue.operatorId,
      ownerName: "Ana",
    });

    const saved = await admin("PUT", `/api/parties/${party.partyId}/drafts`, {
      draftId: anas.id,
      revision: anas.revision,
      operatorId: venue.operatorId,
      lines: [dish("Pulpo")],
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
          locationId: venue.cfg.locationId,
          name: `Upstairs bar ${randomUUID()}`,
        })
        .returning({ id: kitchenStations.id, name: kitchenStations.name }),
    );
    const [beer] = await inTx(venue, (tx) =>
      tx.select({ id: products.id }).from(products).where(eq(products.name, "Caña")),
    );
    await inTx(venue, async (tx) => {
      await createException(tx, venue.cfg, {
        productId: beer!.id,
        zoneId: null,
        categoryId: null,
        target: { kind: "station", stationId: bar!.id },
      });
      await setStationToday(tx, venue.cfg, bar!.id, "closed", new Date());
    });
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
    await inTx(venue, async (tx) => {
      await tx.delete(routeExceptions).where(eq(routeExceptions.productId, beer!.id));
      await setStationToday(tx, venue.cfg, bar!.id, null, new Date());
    });
  });
});

describe("a draft's chosen station at submission", () => {
  it("sends a dish to its chosen active station after that station closes, and refuses it without a choice", async () => {
    const party = await seated();
    const [bar] = await inTx(venue, (tx) =>
      tx
        .insert(kitchenStations)
        .values({
          locationId: venue.cfg.locationId,
          name: `Draft bar ${randomUUID()}`,
        })
        .returning({ id: kitchenStations.id }),
    );
    const [beer] = await inTx(venue, (tx) =>
      tx.select({ id: products.id }).from(products).where(eq(products.name, "Caña")),
    );
    await inTx(venue, async (tx) => {
      await createException(tx, venue.cfg, {
        productId: beer!.id,
        zoneId: null,
        categoryId: null,
        target: { kind: "station", stationId: bar!.id },
      });
      await setStationToday(tx, venue.cfg, bar!.id, "closed", new Date());
    });
    const chosen = await ana("PUT", `/api/parties/${party.partyId}/drafts`, {
      draftId: null,
      revision: 0,
      lines: [{ ...dish("Caña"), makeAt: bar!.id }],
    });
    expect(chosen.status).toBe(200);
    const draft = chosen.json as unknown as DraftAnswer;
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
    const another = await newDraft(ana, party.partyId, [dish("Caña")]);
    const refused = await ana(
      "POST",
      `/api/parties/${party.partyId}/drafts/${another.id}/submit`,
      await submitBody(party.partyId, another),
    );
    expect(refused.status).toBe(409);
    expect(refused.json).toMatchObject({ code: "station.no_replacement" });
    await inTx(venue, async (tx) => {
      await tx.delete(routeExceptions).where(eq(routeExceptions.productId, beer!.id));
      await setStationToday(tx, venue.cfg, bar!.id, null, new Date());
    });
  });
});

describe("POST /api/parties/:id/drafts/:did/take-over", () => {
  it("carries a chosen station when a taken draft is discarded into the owner's draft", async () => {
    const party = await seated();
    const [bar] = await inTx(venue, (tx) =>
      tx
        .insert(kitchenStations)
        .values({
          locationId: venue.cfg.locationId,
          name: `Taken bar ${randomUUID()}`,
        })
        .returning({ id: kitchenStations.id }),
    );
    const own = await newDraft(ana, party.partyId, [dish("Tarta")]);
    const other = await admin("PUT", `/api/parties/${party.partyId}/drafts`, {
      draftId: null,
      revision: 0,
      lines: [{ ...dish("Caña"), makeAt: bar!.id }],
    });
    expect(other.status).toBe(200);
    const otherDraft = other.json as unknown as DraftAnswer;
    const taken = await ana(
      "POST",
      `/api/parties/${party.partyId}/drafts/${otherDraft.id}/take-over`,
      { revision: otherDraft.revision },
    );
    expect(taken.status).toBe(200);
    expect(taken.json).toMatchObject({
      id: own.id,
      lines: [
        { menuItemId: venue.offerFor("Tarta"), makeAt: null },
        { menuItemId: venue.offerFor("Caña"), makeAt: bar!.id },
      ],
    });
  });

  it("makes the session's person the owner, and refuses 409 draft.out_of_date for a stale revision and draft.already_submitted for a sent draft", async () => {
    const party = await seated();
    const anas = await newDraft(ana, party.partyId, [dish("Croquetas")]);

    const taken = await admin("POST", `/api/parties/${party.partyId}/drafts/${anas.id}/take-over`, {
      revision: anas.revision,
    });

    expect(taken.status).toBe(200);
    const admins = taken.json as unknown as DraftAnswer;
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
      refusal("draft.out_of_date", { draftId: anas.id, revision: admins.revision }),
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
    expect(late.json).toEqual(refusal("draft.already_submitted", { draftId: anas.id }));
    expect(await snapshot()).toEqual(afterSending);
  });
});

describe("POST /api/parties/:id/drafts/:did/submit", () => {
  it("sends the named lines as groups, answers the groups and the draft left, and replays a retry with the first answer", async () => {
    const party = await seated();
    const anas = await newDraft(ana, party.partyId, [dish("Caña"), dish("Pulpo")]);
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
    const anas = await newDraft(ana, party.partyId, [dish("Tarta"), dish("Croquetas")]);
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
      groups: [{ id: heldAnswer.groups[0]!.id, summary: "1 × Tarta, 1 × Croquetas" }],
      draft: null,
    });
  });
});

describe("POST /api/parties/:id/drafts/:did/submit naming a bill", () => {
  it("puts the lines on the split bill billId names, leaving the main bill main, and refuses the same id without it 409 submission.id_reused", async () => {
    const party = await seated();
    const anas = await newDraft(ana, party.partyId, [dish("Caña"), dish("Pulpo")]);
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
    expect(named.json).toMatchObject({ tabId: checkId });
    expect(await lineNames(checkId)).toEqual(["Caña", "Pulpo"]);
    expect(await lineNames(party.tabId)).toEqual([]);
    expect(await mainBillOf(party.partyId)).toBe(party.tabId);
    const before = await snapshot();

    // `undefined` leaves the key out of the JSON body.
    const reused = await ana("POST", `/api/parties/${party.partyId}/drafts/${anas.id}/submit`, {
      ...body,
      billId: undefined,
    });

    expect(reused.status).toBe(409);
    expect(reused.json).toEqual(
      refusal("submission.id_reused", { submissionId: body.submissionId }),
    );
    expect(await snapshot()).toEqual(before);
  });
});

describe("a draft named on another party", () => {
  it("is refused 404 draft.not_found by the save, the take-over and the submit, as is an id that is not one", async () => {
    const mesa4 = await seated();
    const mesa5 = await seated();
    const anas = await newDraft(ana, mesa4.partyId, [dish("Caña")]);
    const before = await snapshot();

    const answers = [
      await ana("PUT", `/api/parties/${mesa5.partyId}/drafts`, {
        draftId: anas.id,
        revision: anas.revision,
        lines: [],
      }),
      await admin("POST", `/api/parties/${mesa5.partyId}/drafts/${anas.id}/take-over`, {
        revision: anas.revision,
      }),
      await ana(
        "POST",
        `/api/parties/${mesa5.partyId}/drafts/${anas.id}/submit`,
        await submitBody(mesa5.partyId, anas),
      ),
    ];
    const notAnId = await admin("POST", `/api/parties/${mesa4.partyId}/drafts/draft-1/take-over`, {
      revision: 0,
    });

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
    const anas = await newDraft(ana, party.partyId, [dish("Caña"), dish("Pulpo")]);
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
    ["billId", { ...valid, groups: [], billId: null }],
    ["billId", { ...valid, groups: [], billId: "bill-1" }],
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
