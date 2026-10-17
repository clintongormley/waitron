import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";
import { parties, workingOrders } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { loginWithPin } from "@waitron/identity";
import { readBillEditState } from "./bill-editing.js";
import { closeParty, finishTable, partyRevisionOfOrder } from "./parties.js";
import { saveDraft, type BillEditExpected } from "./order-drafts.js";
import { fireAll } from "./testing/serve-line.js";
import { SESSION_COOKIE } from "./till-session.js";
import { inTx, provisionBillVenue, tabWith, type BillVenue } from "./testing/bill-venue.js";

let venue: BillVenue;
let adminCookie: string;
useVenueDb({
  migrations: migrationOptionsFor(manifestSets(), null),
  resetPerTest: false,
  timeoutMs: 60_000,
  setup: async (db) => {
    venue = await provisionBillVenue(db);
    const session = await inTx(venue, (tx) =>
      loginWithPin(tx, { deviceId: venue.deviceId, personId: venue.adminId, pin: "1234" }),
    );
    adminCookie = `${SESSION_COOKIE}=${session.token}; ${venue.cookie.split("; ").slice(1).join("; ")}`;
  },
});
const modes = ["finish", "close", "finish-http", "departure-http"] as const;
type Mode = (typeof modes)[number];
async function fixture(mode: Mode) {
  const billId = await tabWith(venue, ...(mode === "departure-http" ? ["Paella"] : []));
  if (mode === "departure-http") await inTx(venue, (tx) => fireAll(tx, venue.cfg, billId));
  const party = (await inTx(venue, (tx) => partyRevisionOfOrder(tx, billId)))!;
  return { billId, partyId: party.id, revision: party.revision };
}
type Fixture = Awaited<ReturnType<typeof fixture>>;
const edit = (billId: string) => inTx(venue, (tx) => readBillEditState(tx, billId));
async function own(p: Fixture, personId = venue.adminId) {
  const expectedEdit = await edit(p.billId);
  return inTx(venue, (tx) =>
    saveDraft(tx, venue.cfg, p.partyId, personId, {
      billId: p.billId,
      expectedEdit,
      draftId: null,
      revision: 0,
      lines: [{ menuItemId: venue.offerFor("Caña"), quantity: "1" }],
    }),
  );
}
async function sibling(p: Fixture) {
  const [bill] = await inTx(venue, (tx) =>
    tx
      .insert(workingOrders)
      .values({
        source: "dashboard",
        orderNumber: 2,
        partyId: p.partyId,
        locationId: venue.cfg.locationId,
      })
      .returning(),
  );
  return bill!.id;
}
async function ask(p: Fixture, mode: Mode, expectedEdits: unknown, actor = venue.adminId) {
  if (mode === "finish")
    return inTx(venue, (tx) =>
      finishTable(tx, {
        partyId: p.partyId,
        expectedPartyRevision: p.revision,
        operatorId: actor,
        expectedEdits: expectedEdits as BillEditExpected[],
      }),
    );
  if (mode === "close")
    return inTx(venue, (tx) =>
      closeParty(tx, p.partyId, [p.billId], actor, undefined, expectedEdits as BillEditExpected[]),
    );
  const response = await venue.app.request(
    `/api/parties/${p.partyId}/${mode === "finish-http" ? "finish" : "unpaid-departure"}`,
    {
      method: "POST",
      headers: { "content-type": "application/json", cookie: adminCookie },
      body: JSON.stringify({
        expectedPartyRevision: p.revision,
        expectedEdits,
        reason: "Guests left",
        operatorId: actor,
      }),
    },
  );
  const body = (await response.json()) as { error?: { code: string; params: unknown } };
  if (body.error) throw { ...body.error, status: response.status };
  expect(response.status).toBe(200);
  return body;
}
function frozen() {
  return Object.fromEntries(
    venue.db
      .all<{ name: string }>(sql`select name from sqlite_master where type='table' order by name`)
      .map(({ name }) => [
        name,
        venue.db
          .all<Record<string, unknown>>(sql`select * from ${sql.identifier(name)} order by rowid`)
          .map((row) => (name === "devices" ? { ...row, last_seen_at: null } : row)),
      ]),
  );
}
async function refused(
  p: Fixture,
  mode: Mode,
  expected: unknown,
  code: string,
  params: unknown,
  actor?: string,
) {
  const before = frozen();
  await expect(ask(p, mode, expected, actor)).rejects.toMatchObject({
    code,
    params,
    ...(mode.endsWith("http") ? { status: code === "management.request_invalid" ? 400 : 409 } : {}),
  });
  expect(frozen()).toEqual(before);
}
for (const mode of modes)
  describe(`${mode} compares every closing bill`, () => {
    it("refuses a missing observation before closing or invoicing anything", async () => {
      const p = await fixture(mode);
      await refused(p, mode, undefined, "management.request_invalid", { field: "expectedEdits" });
    });
    it.each(
      [
        null,
        {},
        [],
        [{ billId: randomUUID(), editorVersion: 0, draftId: null, draftRevision: null }],
      ].map((value) => ({ value })),
    )("refuses malformed or incomplete observations $value", async ({ value }) => {
      const p = await fixture(mode);
      await refused(p, mode, value, "management.request_invalid", { field: "expectedEdits" });
    });
    it("refuses a colleague's bill without trusting the body actor", async () => {
      const p = await fixture(mode);
      const owned = await own(p, venue.operatorId);
      await refused(
        p,
        mode,
        [owned.edit],
        "draft.taken_over",
        {
          billId: p.billId,
          draftId: owned.draft!.id,
          ownerId: venue.operatorId,
          edit: owned.edit,
          conflicts: [owned.edit],
        },
        mode.endsWith("http") ? venue.operatorId : undefined,
      );
    });
    it("refuses a raced first save even for the same person", async () => {
      const p = await fixture(mode),
        old = await edit(p.billId),
        owned = await own(p);
      await refused(p, mode, [old], "draft.out_of_date", {
        billId: p.billId,
        draftId: owned.draft!.id,
        revision: owned.draft!.revision,
        edit: owned.edit,
      });
    });
    it("requires explicit resolution of its editor's saved dishes", async () => {
      const p = await fixture(mode),
        owned = await own(p);
      await refused(p, mode, [owned.edit], "bill.unsent_dishes", { billId: p.billId });
    });
    it("compares an empty sibling bill, including a later acquisition", async () => {
      const p = await fixture(mode),
        second = await sibling(p);
      const old = [await edit(p.billId), await edit(second)].sort((a, b) =>
        a.billId.localeCompare(b.billId),
      );
      const owned = await own({ ...p, billId: second });
      await refused(p, mode, old, "draft.out_of_date", {
        billId: second,
        draftId: owned.draft!.id,
        revision: owned.draft!.revision,
        edit: owned.edit,
      });
    });
    it("rejects duplicate and unsorted bill observations", async () => {
      const p = await fixture(mode),
        second = await sibling(p);
      const ordered = [await edit(p.billId), await edit(second)].sort((a, b) =>
        a.billId.localeCompare(b.billId),
      );
      await refused(p, mode, [...ordered].reverse(), "management.request_invalid", {
        field: "expectedEdits.1.billId",
      });
      await refused(p, mode, [ordered[0], ordered[0]], "management.request_invalid", {
        field: "expectedEdits.1.billId",
      });
    });
    it("includes bills retained on a party merged into this one", async () => {
      const p = await fixture(mode);
      const [ancestor] = await inTx(venue, (tx) =>
        tx
          .insert(parties)
          .values({
            state: "closed",
            closedAt: new Date().toISOString(),
            openedBy: venue.adminId,
            mergedIntoPartyId: p.partyId,
          })
          .returning(),
      );
      const second = await sibling({ ...p, partyId: ancestor!.id });
      await refused(p, mode, [await edit(p.billId)], "management.request_invalid", {
        field: "expectedEdits",
      });
      const expected = [await edit(p.billId), await edit(second)].sort((a, b) =>
        a.billId.localeCompare(b.billId),
      );
      expect(await ask(p, mode, expected)).toMatchObject({ state: "closed" });
    });
    it("closes with current empty observations and preserves another party's outbox", async () => {
      const p = await fixture(mode),
        unrelated = await fixture(mode);
      await own(unrelated, venue.operatorId);
      const before = await edit(unrelated.billId);
      expect(await ask(p, mode, [await edit(p.billId)])).toMatchObject({ state: "closed" });
      expect(await edit(unrelated.billId)).toEqual(before);
      const [party] = await venue.db.select().from(parties).where(eq(parties.id, p.partyId));
      expect(party).toMatchObject({ state: "closed", closedBy: venue.adminId });
    });
  });

describe("departure checks before fiscal issuance", () => {
  it("refuses a stale owner before invoking the fiscal backend", async () => {
    const p = await fixture("departure-http"),
      old = await edit(p.billId),
      owned = await own(p);
    const issue = vi
      .spyOn(venue.backend, "recordSale")
      .mockRejectedValue(new Error("must not issue"));
    try {
      await refused(p, "departure-http", [old], "draft.out_of_date", {
        billId: p.billId,
        draftId: owned.draft!.id,
        revision: owned.draft!.revision,
        edit: owned.edit,
      });
      expect(issue).not.toHaveBeenCalled();
    } finally {
      issue.mockRestore();
    }
  });
});
