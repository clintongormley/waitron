import { createOpenOrder } from "./working-order.js";
import { deviceId } from "@waitron/shared";
import { randomUUID } from "node:crypto";
import { and, eq, isNull, sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { sessions } from "@waitron/identity";
import { readBillEditState } from "./bill-editing.js";
import {
  previewBillPayment,
  takeBillPayment,
  takeReaderBillPayment,
  type BillPaymentAsk,
  type BillPaymentRequest,
} from "./bill-payments.js";
import { saveDraft, type BillEditExpected } from "./order-drafts.js";
import {
  inTx,
  paymentRows,
  provisionBillVenue,
  seatedWith,
  type BillVenue,
} from "./testing/bill-venue.js";

let venue: BillVenue;
useVenueDb({
  migrations: migrationOptionsFor(manifestSets(), null),
  resetPerTest: false,
  timeoutMs: 60_000,
  setup: async (db) => {
    venue = await provisionBillVenue(db);
  },
});
const edit = (billId: string) => inTx(venue, (tx) => readBillEditState(tx, billId));
async function otherBill(p: { partyId: string; tabId: string }) {
  const id = randomUUID();
  await inTx(venue, (tx) =>
    createOpenOrder(
      tx,
      venue.cfg,
      id,
      [{ menuItemId: venue.offerFor("Caña"), quantity: "1" }],
      "Other bill",
      { partyId: p.partyId, existingService: true, copyServiceContextFrom: p.tabId },
    ),
  );
  return { partyId: p.partyId, tabId: id };
}
const deps = () => ({ db: venue.db, backend: venue.backend, clock: venue.clock });
async function owner(p: { partyId: string; tabId: string }, personId = venue.adminId) {
  const expectedEdit = await edit(p.tabId);
  return inTx(venue, (tx) =>
    saveDraft(tx, venue.cfg, p.partyId, personId, {
      billId: p.tabId,
      expectedEdit,
      draftId: null,
      revision: 0,
      lines: [{ menuItemId: venue.offerFor("Tarta"), quantity: "1" }],
    }),
  );
}
function frozen(http = false) {
  return Object.fromEntries(
    venue.db
      .all<{ name: string }>(sql`select name from sqlite_master where type='table' order by name`)
      .map(({ name }) => [
        name,
        venue.db
          .all<Record<string, unknown>>(sql`select * from ${sql.identifier(name)} order by rowid`)
          .map((row) => (http && name === "devices" ? { ...row, last_seen_at: null } : row)),
      ]),
  );
}
type Mode = "preview" | "cash" | "manual" | "reader";
function ask(mode: Mode, expectedEdit: BillEditExpected | null | undefined) {
  return {
    expectedEdit: expectedEdit!,
    kind: "contribution" as const,
    amount: "5.00",
    method: mode === "preview" || mode === "cash" ? ("cash" as const) : ("card" as const),
    ...(mode === "preview" || mode === "cash" ? { tendered: "5.00" } : { entry: mode }),
    applied: "5.00",
    tip: "0.00",
    submissionId: randomUUID(),
  };
}
async function direct(
  mode: Mode,
  billId: string,
  expectedEdit: BillEditExpected | null | undefined,
  request = ask(mode, expectedEdit),
) {
  const [session] = await venue.db
    .select()
    .from(sessions)
    .where(and(eq(sessions.deviceId, venue.deviceId), isNull(sessions.endedAt)));
  const operator = { personId: venue.operatorId, sessionId: session!.id };
  const cfg = { ...venue.cfg, origin: { ...venue.cfg.origin, deviceId: deviceId(venue.deviceId) } };
  if (mode === "preview")
    return previewBillPayment(deps(), cfg, billId, request as BillPaymentAsk, operator.personId);
  if (mode === "reader")
    return takeReaderBillPayment(
      { ...deps(), provider: venue.card },
      cfg,
      billId,
      request as BillPaymentRequest,
      operator,
    );
  return takeBillPayment(deps(), cfg, billId, request as BillPaymentRequest, operator);
}
async function http(mode: Mode, billId: string, body: unknown) {
  const res = await venue.app.request(
    `/api/working-orders/${billId}/payments${mode === "preview" ? "/preview" : ""}`,
    {
      method: "POST",
      headers: { cookie: venue.cookie, "content-type": "application/json" },
      body: JSON.stringify(body),
    },
  );
  const parsed = (await res.json()) as Record<string, unknown>;
  return {
    status: res.status,
    json: (parsed.error as Record<string, unknown> | undefined) ?? parsed,
  };
}

describe.each(["preview", "cash", "manual", "reader"] as const)(
  "%s payment bill authority",
  (mode) => {
    it("refuses another editor before the unsent check with no writes or provider charge", async () => {
      const p = await seatedWith(venue, "Paella"),
        owned = await owner(p),
        before = frozen(),
        calls = venue.card.collectCalls.length;
      await expect(direct(mode, p.tabId, owned.edit)).rejects.toMatchObject({
        code: "draft.taken_over",
        params: {
          billId: p.tabId,
          draftId: owned.draft!.id,
          ownerId: venue.adminId,
          ownerName: "Administradora",
          edit: owned.edit,
        },
      });
      expect(frozen()).toEqual(before);
      expect(venue.card.collectCalls.length).toBe(calls);
    });
    it.each([undefined, null])("requires a complete observation (%s)", async (value) => {
      const p = await seatedWith(venue, "Paella"),
        before = frozen();
      await expect(direct(mode, p.tabId, value)).rejects.toMatchObject({
        code: "management.request_invalid",
        params: { field: "expectedEdit" },
      });
      expect(frozen()).toEqual(before);
    });
    it("refuses an observation for another bill", async () => {
      const p = await seatedWith(venue, "Paella"),
        other = await seatedWith(venue, "Caña"),
        before = frozen();
      await expect(direct(mode, p.tabId, await edit(other.tabId))).rejects.toMatchObject({
        code: "management.request_invalid",
        params: { field: "expectedEdit.billId" },
      });
      expect(frozen()).toEqual(before);
    });
    it("refuses a stale observation without any payment reservation", async () => {
      const p = await seatedWith(venue, "Paella"),
        current = await edit(p.tabId),
        before = frozen();
      await expect(
        direct(mode, p.tabId, { ...current, editorVersion: current.editorVersion + 1 }),
      ).rejects.toMatchObject({
        code: "draft.out_of_date",
        params: { billId: p.tabId, draftId: null, revision: null, edit: current },
      });
      expect(frozen()).toEqual(before);
    });
    it("keeps the editor's own unsent refusal and changes nothing", async () => {
      const p = await seatedWith(venue, "Paella"),
        owned = await owner(p, venue.operatorId),
        before = frozen();
      await expect(direct(mode, p.tabId, owned.edit)).rejects.toMatchObject({
        code: "bill.unsent_dishes",
        params: { billId: p.tabId },
      });
      expect(frozen()).toEqual(before);
    });
    it("accepts this bill while a colleague edits another bill", async () => {
      const p = await seatedWith(venue, "Paella"),
        other = await otherBill(p),
        owned = await owner(other),
        current = await edit(p.tabId);
      const result = await direct(mode, p.tabId, current);
      if (mode === "preview") {
        expect(result).toMatchObject({ applied: "5.00", tip: "0.00" });
        expect(await paymentRows(venue, p.tabId)).toEqual([]);
      } else {
        expect(result).toMatchObject({
          outcome: "received",
          payment: { applied: "5.00", tip: "0.00" },
          balance: { outstanding: "30.00" },
        });
        expect(await paymentRows(venue, p.tabId)).toHaveLength(1);
      }
      expect(await edit(p.tabId)).toEqual(current);
      expect(await edit(other.tabId)).toEqual(owned.edit);
    });
    it("refuses an old draft revision before the current owner's unsent check", async () => {
      const p = await seatedWith(venue, "Paella"),
        owned = await owner(p, venue.operatorId),
        before = frozen();
      await expect(
        direct(mode, p.tabId, { ...owned.edit, draftRevision: owned.edit.draftRevision! + 1 }),
      ).rejects.toMatchObject({
        code: "draft.out_of_date",
        params: { billId: p.tabId, revision: owned.edit.draftRevision, edit: owned.edit },
      });
      expect(frozen()).toEqual(before);
    });
    it("preserves counter payments without a bill observation", async () => {
      const billId = randomUUID();
      await inTx(venue, (tx) =>
        createOpenOrder(
          tx,
          venue.cfg,
          billId,
          [{ menuItemId: venue.offerFor("Paella"), quantity: "1" }],
          null,
          { zoneId: venue.zoneId },
        ),
      );
      const current = await edit(billId),
        result = await direct(mode, billId, null);
      expect(result).toMatchObject(
        mode === "preview"
          ? { kind: "allocated", applied: "5.00", tip: "0.00" }
          : {
              outcome: "received",
              payment: { applied: "5.00", tip: "0.00" },
              balance: { outstanding: "30.00" },
            },
      );
      expect(await edit(billId)).toEqual(current);
    });
    it("refuses a missing HTTP observation", async () => {
      const p = await seatedWith(venue, "Paella"),
        before = frozen(true);
      const result = await http(mode, p.tabId, ask(mode, undefined));
      expect(result).toMatchObject({
        status: 400,
        json: { code: "management.request_invalid", params: { field: "expectedEdit" } },
      });
      expect(frozen(true)).toEqual(before);
    });
    it("uses the HTTP session actor rather than body-supplied editor identity", async () => {
      const p = await seatedWith(venue, "Paella"),
        owned = await owner(p),
        before = frozen(true),
        calls = venue.card.collectCalls.length;
      const result = await http(mode, p.tabId, {
        ...ask(mode, owned.edit),
        operatorId: venue.adminId,
        personId: venue.adminId,
      });
      expect(result).toMatchObject({
        status: 409,
        json: {
          code: "draft.taken_over",
          params: { billId: p.tabId, ownerId: venue.adminId, edit: owned.edit },
        },
      });
      expect(frozen(true)).toEqual(before);
      expect(venue.card.collectCalls.length).toBe(calls);
    });
    it("passes the HTTP observation without replacing it with a current read", async () => {
      const p = await seatedWith(venue, "Paella"),
        current = await edit(p.tabId),
        before = frozen(true);
      const result = await http(mode, p.tabId, ask(mode, { ...current, editorVersion: 1 }));
      expect(result).toMatchObject({
        status: 409,
        json: { code: "draft.out_of_date", params: { billId: p.tabId, edit: current } },
      });
      expect(frozen(true)).toEqual(before);
    });
  },
);

describe.each(["cash", "manual", "reader"] as const)("%s original payment replay", (mode) => {
  it("normalizes only the observed edit fields in the payment fingerprint", async () => {
    const p = await seatedWith(venue, "Paella"),
      expectedEdit = await edit(p.tabId),
      request = ask(mode, expectedEdit);
    const noisyRequest = {
      ...request,
      expectedEdit: {
        ...expectedEdit,
        billId: p.tabId.toUpperCase(),
        editorId: venue.adminId,
        editorVersion: expectedEdit.editorVersion,
      },
    };
    const first = await direct(mode, p.tabId, expectedEdit, noisyRequest);
    expect(first).toMatchObject({ outcome: "received", payment: { applied: "5.00" } });
    const before = frozen(),
      calls = venue.card.collectCalls.length;
    expect(await direct(mode, p.tabId, expectedEdit, request)).toEqual(first);
    expect(frozen()).toEqual(before);
    expect(venue.card.collectCalls.length).toBe(calls);
  });
  it("returns its original facts after a colleague acquires the bill, without collecting twice", async () => {
    const p = await seatedWith(venue, "Paella"),
      original = ask(mode, await edit(p.tabId));
    const first = await http(mode, p.tabId, original);
    expect(first.status).toBe(200);
    await owner(p);
    const before = frozen(true),
      calls = venue.card.collectCalls.length;
    expect(await http(mode, p.tabId, original)).toEqual(first);
    expect(frozen(true)).toEqual(before);
    expect(await paymentRows(venue, p.tabId)).toHaveLength(1);
    expect(venue.card.collectCalls.length).toBe(calls);
    const changed = await http(mode, p.tabId, { ...original, expectedEdit: await edit(p.tabId) });
    expect(changed).toMatchObject({
      status: 409,
      json: { code: "submission.id_reused", params: { submissionId: original.submissionId } },
    });
    expect(frozen(true)).toEqual(before);
  });
});

describe("payment preview actor", () => {
  it("requires a named actor on a party bill even when unowned", async () => {
    const p = await seatedWith(venue, "Paella"),
      before = frozen();
    await expect(
      previewBillPayment(
        deps(),
        venue.cfg,
        p.tabId,
        ask("preview", await edit(p.tabId)),
        undefined,
      ),
    ).rejects.toMatchObject({
      code: "management.request_invalid",
      params: { field: "operatorId" },
    });
    expect(frozen()).toEqual(before);
  });
});
