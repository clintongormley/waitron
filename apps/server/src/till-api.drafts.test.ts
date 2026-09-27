import { randomUUID } from "node:crypto";
import { asc, eq, inArray } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import {
  orderDraftEvents,
  orderDraftLines,
  orderDrafts,
  orderGroups,
  serviceCommands,
  visits,
  withTransaction,
} from "@waitron/db";
import { loginWithPin } from "@waitron/identity";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { createTable } from "./tables.js";
import { inTx, provisionBillVenue, send, type BillVenue } from "./testing/bill-venue.js";
import { SESSION_COOKIE } from "./till-session.js";
import "./errors.js";

// The HTTP layer of the draft routes: body parsing, the operator taken from the session, the draft
// scoped to the visit in the path, and the status each refusal maps to. What the commands do is
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
  visitId: string;
  tabId: string;
  revision: number;
}

interface DraftAnswer {
  id: string;
  visitId: string;
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

/** A new draft of the caller's on the visit, holding the lines. */
async function newDraft(
  caller: typeof ana,
  visitId: string,
  lines: ReturnType<typeof dish>[],
): Promise<DraftAnswer> {
  const saved = await caller("PUT", `/api/visits/${visitId}/drafts`, {
    draftId: null,
    revision: 0,
    lines,
  });
  expect(saved.status).toBe(200);
  return saved.json as unknown as DraftAnswer;
}

async function revisionOf(visitId: string): Promise<number> {
  const [row] = await inTx(venue, (tx) =>
    tx.select({ revision: visits.revision }).from(visits).where(eq(visits.id, visitId)),
  );
  return row!.revision;
}

async function submitBody(visitId: string, draft: DraftAnswer, lineIds = draft.lines) {
  return {
    submissionId: randomUUID(),
    draftRevision: draft.revision,
    expectedVisitRevision: await revisionOf(visitId),
    groups: [{ lineIds: lineIds.map((line) => line.id), release: "fire" }],
  };
}

/** Every row the draft routes can write for the visit, so a refusal can be shown to write none. */
async function snapshot(visitId: string) {
  return inTx(venue, async (tx) => {
    const drafts = await tx
      .select()
      .from(orderDrafts)
      .where(eq(orderDrafts.visitId, visitId))
      .orderBy(asc(orderDrafts.id));
    const draftIds = drafts.map((draft) => draft.id);
    return {
      visit: await tx.select().from(visits).where(eq(visits.id, visitId)),
      drafts,
      lines: await tx
        .select()
        .from(orderDraftLines)
        .where(inArray(orderDraftLines.draftId, draftIds))
        .orderBy(asc(orderDraftLines.id)),
      events: await tx
        .select()
        .from(orderDraftEvents)
        .where(inArray(orderDraftEvents.draftId, draftIds))
        .orderBy(asc(orderDraftEvents.id)),
      groups: await tx
        .select()
        .from(orderGroups)
        .where(eq(orderGroups.visitId, visitId))
        .orderBy(asc(orderGroups.id)),
      commands: await tx
        .select()
        .from(serviceCommands)
        .where(eq(serviceCommands.scopeId, visitId))
        .orderBy(asc(serviceCommands.id)),
    };
  });
}

function refusal(code: string, params?: Record<string, unknown>) {
  return params === undefined ? expect.objectContaining({ code }) : { code, params };
}

describe("GET /api/visits/:id/drafts", () => {
  it("answers every open draft on the party, each person's, with the owner's name", async () => {
    const visit = await seated();
    const anas = await newDraft(ana, visit.visitId, [dish("Caña", "2")]);
    const admins = await newDraft(admin, visit.visitId, [dish("Pulpo")]);

    const read = await ana("GET", `/api/visits/${visit.visitId}/drafts`);
    const upper = await ana("GET", `/api/visits/${visit.visitId.toUpperCase()}/drafts`);

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

  it("refuses 409 visit.not_open for an id that is not one", async () => {
    const refused = await ana("GET", "/api/visits/not-a-uuid/drafts");

    expect(refused.status).toBe(409);
    expect(refused.json).toEqual(refusal("visit.not_open", { visitId: "not-a-uuid" }));
  });
});

describe("PUT /api/visits/:id/drafts", () => {
  it("saves the session's person's draft, whatever operator the body names", async () => {
    const visit = await seated();

    const saved = await ana("PUT", `/api/visits/${visit.visitId}/drafts`, {
      draftId: null,
      revision: 0,
      operatorId: venue.adminId,
      lines: [dish("Tarta")],
    });

    expect(saved.status).toBe(200);
    expect(saved.json).toMatchObject({
      visitId: visit.visitId,
      ownerId: venue.operatorId,
      revision: 0,
      lines: [{ menuItemId: venue.offerFor("Tarta"), quantity: "1.000", unavailable: false }],
    });
  });

  it("refuses 409 draft.taken_over for a save or a submit by someone other than the owner, writing nothing", async () => {
    const visit = await seated();
    const anas = await newDraft(ana, visit.visitId, [dish("Caña")]);
    const before = await snapshot(visit.visitId);
    const taken = refusal("draft.taken_over", {
      draftId: anas.id,
      ownerId: venue.operatorId,
      ownerName: "Ana",
    });

    const saved = await admin("PUT", `/api/visits/${visit.visitId}/drafts`, {
      draftId: anas.id,
      revision: anas.revision,
      operatorId: venue.operatorId,
      lines: [dish("Pulpo")],
    });
    const submitted = await admin("POST", `/api/visits/${visit.visitId}/drafts/${anas.id}/submit`, {
      ...(await submitBody(visit.visitId, anas)),
      operatorId: venue.operatorId,
    });

    expect(saved.status).toBe(409);
    expect(saved.json).toEqual(taken);
    expect(submitted.status).toBe(409);
    expect(submitted.json).toEqual(taken);
    expect(await snapshot(visit.visitId)).toEqual(before);
  });
});

describe("POST /api/visits/:id/drafts/:did/take-over", () => {
  it("makes the session's person the owner, and refuses 409 draft.out_of_date for a stale revision and draft.already_submitted for a sent draft", async () => {
    const visit = await seated();
    const anas = await newDraft(ana, visit.visitId, [dish("Croquetas")]);

    const taken = await admin("POST", `/api/visits/${visit.visitId}/drafts/${anas.id}/take-over`, {
      revision: anas.revision,
    });

    expect(taken.status).toBe(200);
    const admins = taken.json as unknown as DraftAnswer;
    expect(admins).toMatchObject({
      id: anas.id,
      ownerId: venue.adminId,
      revision: anas.revision + 1,
    });
    const before = await snapshot(visit.visitId);
    const stale = await ana("POST", `/api/visits/${visit.visitId}/drafts/${anas.id}/take-over`, {
      revision: anas.revision,
    });
    expect(stale.status).toBe(409);
    expect(stale.json).toEqual(
      refusal("draft.out_of_date", { draftId: anas.id, revision: admins.revision }),
    );
    expect(await snapshot(visit.visitId)).toEqual(before);

    const sent = await admin(
      "POST",
      `/api/visits/${visit.visitId}/drafts/${anas.id}/submit`,
      await submitBody(visit.visitId, admins),
    );
    expect(sent.status).toBe(200);
    const afterSending = await snapshot(visit.visitId);
    const late = await ana("POST", `/api/visits/${visit.visitId}/drafts/${anas.id}/take-over`, {
      revision: admins.revision + 1,
    });
    expect(late.status).toBe(409);
    expect(late.json).toEqual(refusal("draft.already_submitted", { draftId: anas.id }));
    expect(await snapshot(visit.visitId)).toEqual(afterSending);
  });
});

describe("POST /api/visits/:id/drafts/:did/submit", () => {
  it("sends the named lines as groups, answers the groups and the draft left, and replays a retry with the first answer", async () => {
    const visit = await seated();
    const anas = await newDraft(ana, visit.visitId, [dish("Caña"), dish("Pulpo")]);
    const body = await submitBody(visit.visitId, anas, [anas.lines[0]!]);

    const first = await ana("POST", `/api/visits/${visit.visitId}/drafts/${anas.id}/submit`, body);

    expect(first.status).toBe(200);
    expect(first.json).toMatchObject({
      tabId: visit.tabId,
      revision: visit.revision + 1,
      groups: [{ state: "fired", summary: "1 × Caña" }],
      draft: { id: anas.id, revision: anas.revision + 1, lines: [anas.lines[1]] },
    });
    const before = await snapshot(visit.visitId);
    // The retry spells both ids in upper case: the path's visit is folded as it is stored.
    const again = await ana(
      "POST",
      `/api/visits/${visit.visitId.toUpperCase()}/drafts/${anas.id.toUpperCase()}/submit`,
      body,
    );
    expect(again.status).toBe(200);
    expect(again.json).toEqual(first.json);
    expect(await snapshot(visit.visitId)).toEqual(before);
  });

  it("adds the lines to the held group joinGroupId names", async () => {
    const visit = await seated();
    const anas = await newDraft(ana, visit.visitId, [dish("Tarta"), dish("Croquetas")]);
    const held = await ana("POST", `/api/visits/${visit.visitId}/drafts/${anas.id}/submit`, {
      ...(await submitBody(visit.visitId, anas, [anas.lines[0]!])),
      groups: [{ lineIds: [anas.lines[0]!.id], release: "hold" }],
    });
    const heldAnswer = held.json as unknown as { groups: { id: string }[]; draft: DraftAnswer };

    const joined = await ana("POST", `/api/visits/${visit.visitId}/drafts/${anas.id}/submit`, {
      ...(await submitBody(visit.visitId, heldAnswer.draft)),
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

describe("a draft named on another party", () => {
  it("is refused 404 draft.not_found by the save, the take-over and the submit, as is an id that is not one", async () => {
    const mesa4 = await seated();
    const mesa5 = await seated();
    const anas = await newDraft(ana, mesa4.visitId, [dish("Caña")]);
    const before = await snapshot(mesa4.visitId);

    const answers = [
      await ana("PUT", `/api/visits/${mesa5.visitId}/drafts`, {
        draftId: anas.id,
        revision: anas.revision,
        lines: [],
      }),
      await admin("POST", `/api/visits/${mesa5.visitId}/drafts/${anas.id}/take-over`, {
        revision: anas.revision,
      }),
      await ana(
        "POST",
        `/api/visits/${mesa5.visitId}/drafts/${anas.id}/submit`,
        await submitBody(mesa5.visitId, anas),
      ),
    ];
    const notAnId = await admin("POST", `/api/visits/${mesa4.visitId}/drafts/draft-1/take-over`, {
      revision: 0,
    });

    for (const answer of answers) {
      expect(answer.status).toBe(404);
      expect(answer.json).toEqual(refusal("draft.not_found", { draftId: anas.id }));
    }
    expect(notAnId.status).toBe(404);
    expect(notAnId.json).toEqual(refusal("draft.not_found", { draftId: "draft-1" }));
    expect(await snapshot(mesa4.visitId)).toEqual(before);
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
      const visit = await seated();
      await newDraft(ana, visit.visitId, [dish("Caña")]);
      const before = await snapshot(visit.visitId);

      const refused = await admin("PUT", `/api/visits/${visit.visitId}/drafts`, body);

      expect(refused.status).toBe(400);
      expect(refused.json).toEqual(refusal("management.request_invalid", { field }));
      expect(await snapshot(visit.visitId)).toEqual(before);
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
      const visit = await seated();
      const anas = await newDraft(ana, visit.visitId, [dish("Caña")]);
      const before = await snapshot(visit.visitId);

      const refused = await admin(
        "POST",
        `/api/visits/${visit.visitId}/drafts/${anas.id}/take-over`,
        body,
      );

      expect(refused.status).toBe(400);
      expect(refused.json).toEqual(refusal("management.request_invalid", { field }));
      expect(await snapshot(visit.visitId)).toEqual(before);
    },
  );

  const valid = { submissionId: "s", draftRevision: 0, expectedVisitRevision: 0 };
  it.each([
    ["body", null],
    ["submissionId", { ...valid, submissionId: undefined, groups: [] }],
    ["draftRevision", { ...valid, draftRevision: 0.5, groups: [] }],
    ["draftRevision", { ...valid, draftRevision: undefined, groups: [] }],
    ["expectedVisitRevision", { ...valid, expectedVisitRevision: "0", groups: [] }],
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
      const visit = await seated();
      const anas = await newDraft(ana, visit.visitId, [dish("Caña")]);
      const before = await snapshot(visit.visitId);

      const refused = await ana(
        "POST",
        `/api/visits/${visit.visitId}/drafts/${anas.id}/submit`,
        body,
      );

      expect(refused.status).toBe(400);
      expect(refused.json).toEqual(refusal("management.request_invalid", { field }));
      expect(await snapshot(visit.visitId)).toEqual(before);
    },
  );
});
