import { decimal } from "@waitron/shared";
import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { workingOrders } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { insertCapturedPayment } from "@waitron/payments";
import { readBillEditState } from "./bill-editing.js";
import { saveDraft } from "./order-drafts.js";
import { createOpenOrder, parkOrder } from "./working-order.js";
import {
  payWorkingOrder,
  collectOrderOrchestration,
  payWorkingOrderIntegratedOrchestration,
  recordTillSaleOrchestration,
  type PayWorkingOrderRequest,
  type IntegratedPayRequest,
  type TillSaleRequest,
} from "./till-sale.js";
import {
  inTx,
  provisionBillVenue,
  tabWith,
  registroCount,
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
const modes = ["cash", "manual", "sale", "collect", "reader", "reader-placed"] as const;
type Mode = (typeof modes)[number];
const deps = () => ({ db: venue.db, backend: venue.backend, clock: venue.clock });
const edit = (id: string) => inTx(venue, (tx) => readBillEditState(tx, id));
async function fixture(mode: Mode, counter = false, draftOwnerId?: string) {
  const id = counter ? randomUUID() : await tabWith(venue, "Paella");
  if (counter)
    await parkOrder({ db: venue.db }, venue.cfg, {
      id,
      zoneId: venue.zoneId,
      lines: [{ menuItemId: venue.offerFor("Paella"), quantity: "1" }],
    });
  const [open] = await venue.db.select().from(workingOrders).where(eq(workingOrders.id, id));
  const owned = draftOwnerId === undefined ? null : await owner(open!, draftOwnerId);
  if (mode === "collect" || mode === "reader-placed")
    await inTx(venue, (tx) =>
      tx.update(workingOrders).set({ status: "placed" }).where(eq(workingOrders.id, id)),
    );
  const [order] = await venue.db.select().from(workingOrders).where(eq(workingOrders.id, id));
  return { ...order!, owned };
}
type Fixture = Awaited<ReturnType<typeof fixture>>;
async function owner(p: typeof workingOrders.$inferSelect, personId = venue.operatorId) {
  const current = await edit(p.id);
  return inTx(venue, (tx) =>
    saveDraft(tx, venue.cfg, p.partyId!, personId, {
      billId: p.id,
      expectedEdit: current,
      draftId: current.draftId,
      revision: current.draftRevision ?? 0,
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
function request(p: Fixture, expectedEdit: unknown, mode: Mode) {
  return {
    id: p.id,
    workingOrderId: p.id,
    expectedEdit,
    lines: [],
    tender: { method: mode === "manual" ? "card" : "cash", amount: "35.00" },
  };
}
function run(
  mode: Mode,
  p: Fixture,
  expectedEdit: unknown,
  operatorId: string | undefined = venue.operatorId,
) {
  const ask = request(p, expectedEdit, mode);
  if (mode === "reader" || mode === "reader-placed")
    return payWorkingOrderIntegratedOrchestration(
      { ...deps(), provider: venue.card },
      venue.cfg,
      ask as IntegratedPayRequest,
      operatorId,
    );
  if (mode === "collect")
    return collectOrderOrchestration(deps(), venue.cfg, ask as PayWorkingOrderRequest, operatorId);
  if (mode === "sale")
    return recordTillSaleOrchestration(deps(), venue.cfg, ask as TillSaleRequest, operatorId);
  return payWorkingOrder(deps(), venue.cfg, ask as PayWorkingOrderRequest, operatorId);
}

describe.each(modes)("%s whole payment bill authority", (mode) => {
  it("refuses another editor before unsent checks without any write or card charge", async () => {
    const p = await fixture(mode, false, venue.adminId),
      owned = p.owned!,
      before = frozen(),
      calls = venue.card.collectCalls.length;
    await expect(run(mode, p, owned.edit)).rejects.toMatchObject({
      code: "draft.taken_over",
      params: {
        billId: p.id,
        draftId: owned.draft!.id,
        ownerId: venue.adminId,
        ownerName: "Administradora",
        edit: owned.edit,
      },
    });
    expect(frozen()).toEqual(before);
    expect(venue.card.collectCalls.length).toBe(calls);
  });
  it.each(["absent", "null", "wrong-bill", "malformed", "no-actor"] as const)(
    "requires complete %s authority",
    async (kind) => {
      const p = await fixture(mode),
        other = await fixture(mode),
        current = await edit(p.id),
        before = frozen();
      const wanted =
        kind === "absent"
          ? undefined
          : kind === "null"
            ? null
            : kind === "wrong-bill"
              ? await edit(other.id)
              : kind === "malformed"
                ? { ...current, editorVersion: -1 }
                : current;
      // An explicit undefined actor must reach the raw orchestration function.
      const ask = request(p, wanted, mode);
      const operator = kind === "no-actor" ? undefined : venue.operatorId;
      const attempt =
        mode === "reader" || mode === "reader-placed"
          ? payWorkingOrderIntegratedOrchestration(
              { ...deps(), provider: venue.card },
              venue.cfg,
              ask as IntegratedPayRequest,
              operator,
            )
          : mode === "collect"
            ? collectOrderOrchestration(deps(), venue.cfg, ask as PayWorkingOrderRequest, operator)
            : mode === "sale"
              ? recordTillSaleOrchestration(deps(), venue.cfg, ask as TillSaleRequest, operator)
              : payWorkingOrder(deps(), venue.cfg, ask as PayWorkingOrderRequest, operator);
      await expect(attempt).rejects.toMatchObject({
        code: "management.request_invalid",
        params: {
          field:
            kind === "wrong-bill"
              ? "expectedEdit.billId"
              : kind === "malformed"
                ? "expectedEdit.editorVersion"
                : kind === "no-actor"
                  ? "operatorId"
                  : "expectedEdit",
        },
      });
      expect(frozen()).toEqual(before);
    },
  );
  it("rejects stale released-bill metadata before any payment or issuance", async () => {
    const p = await fixture(mode),
      current = await edit(p.id),
      before = frozen();
    await expect(
      run(mode, p, { ...current, editorVersion: current.editorVersion + 1 }),
    ).rejects.toMatchObject({
      code: "draft.out_of_date",
      params: { billId: p.id, draftId: null, revision: null, edit: current },
    });
    expect(frozen()).toEqual(before);
  });
  it("retains the current editor's unsent refusal", async () => {
    const p = await fixture(mode, false, venue.operatorId),
      owned = p.owned!,
      before = frozen();
    await expect(run(mode, p, owned.edit)).rejects.toMatchObject({
      code: "bill.unsent_dishes",
      params: { billId: p.id },
    });
    expect(frozen()).toEqual(before);
  });
  it("pays this bill while a colleague edits another bill and acquires neither", async () => {
    const p = await fixture(mode),
      id = randomUUID();
    await inTx(venue, (tx) =>
      createOpenOrder(tx, venue.cfg, id, [], null, {
        partyId: p.partyId!,
        existingService: true,
        copyServiceContextFrom: p.id,
      }),
    );
    const [other] = await venue.db.select().from(workingOrders).where(eq(workingOrders.id, id));
    const owned = await owner(other!, venue.adminId),
      current = await edit(p.id);
    const result = await run(mode, p, current);
    expect(result).toMatchObject(
      mode.startsWith("reader")
        ? { outcome: "captured", ticket: { total: "35.00" } }
        : { total: "35.00" },
    );
    expect(registroCount(venue, p.id)).toBe(1);
    expect(await edit(p.id)).toEqual(current);
    expect(await edit(id)).toEqual(owned.edit);
  });
  it("retains counter payments without an editor observation or actor", async () => {
    const p = await fixture(mode, true),
      current = await edit(p.id);
    const ask = request(p, null, mode);
    const result = mode.startsWith("reader")
      ? await payWorkingOrderIntegratedOrchestration(
          { ...deps(), provider: venue.card },
          venue.cfg,
          ask as IntegratedPayRequest,
        )
      : mode === "collect"
        ? await collectOrderOrchestration(deps(), venue.cfg, ask as PayWorkingOrderRequest)
        : mode === "sale"
          ? await recordTillSaleOrchestration(deps(), venue.cfg, ask as TillSaleRequest)
          : await payWorkingOrder(deps(), venue.cfg, ask as PayWorkingOrderRequest);
    expect(result).toMatchObject(
      mode.startsWith("reader")
        ? { outcome: "captured", ticket: { total: "35.00" } }
        : { total: "35.00" },
    );
    expect(await edit(p.id)).toEqual(current);
  });
  it("replays the original completed payment before checking fresh editor metadata", async () => {
    const p = await fixture(mode),
      current = await edit(p.id);
    const original = await run(mode, p, current),
      before = frozen(),
      calls = venue.card.collectCalls.length;
    expect(await run(mode, p, { ...current, editorVersion: 999 })).toEqual(original);
    expect(frozen()).toEqual(before);
    expect(venue.card.collectCalls.length).toBe(calls);
  });
});

describe.each(["reader", "reader-placed"] as const)("%s captured recovery", (mode) => {
  it("files an existing capture despite missing new-start authority without charging again", async () => {
    const p = await fixture(mode),
      before = await edit(p.id),
      paymentRef = randomUUID(),
      calls = venue.card.collectCalls.length;
    await inTx(venue, (tx) =>
      insertCapturedPayment(tx, {
        origin: venue.cfg.origin,
        provider: "fake",
        workingOrderId: p.id,
        paymentRef,
        amount: decimal("35.00"),
        settledAt: new Date(),
      }),
    );
    const outcome = await run(mode, p, null);
    expect(outcome).toMatchObject({ outcome: "captured", ticket: { total: "35.00" } });
    expect(venue.card.collectCalls.length).toBe(calls);
    expect(registroCount(venue, p.id)).toBe(1);
    expect(await edit(p.id)).toEqual(before);
  });
});

describe.each(["sale", "collect", "reader"] as const)("%s HTTP authority", (mode) => {
  async function http(p: Fixture, expectedEdit: unknown, extra = {}) {
    const path =
      mode === "sale"
        ? "/api/sales"
        : mode === "reader"
          ? "/api/pay"
          : `/api/working-orders/${p.id}/collect`;
    const response = await venue.app.request(path, {
      method: "POST",
      headers: { cookie: venue.cookie, "content-type": "application/json" },
      body: JSON.stringify({ ...request(p, expectedEdit, mode), ...extra }),
    });
    const parsed = (await response.json()) as Record<string, unknown>;
    return { status: response.status, json: parsed.error ?? parsed };
  }
  it("uses the authenticated actor rather than a body editor", async () => {
    const p = await fixture(mode, false, venue.adminId),
      owned = p.owned!,
      before = frozen(true),
      calls = venue.card.collectCalls.length;
    expect(
      await http(p, owned.edit, { personId: venue.adminId, operatorId: venue.adminId }),
    ).toMatchObject({
      status: 409,
      json: {
        code: "draft.taken_over",
        params: { billId: p.id, ownerId: venue.adminId, edit: owned.edit },
      },
    });
    expect(frozen(true)).toEqual(before);
    expect(venue.card.collectCalls.length).toBe(calls);
  });
  it("requires an observation on a party bill", async () => {
    const p = await fixture(mode),
      before = frozen(true);
    expect(await http(p, undefined)).toMatchObject({
      status: 400,
      json: { code: "management.request_invalid", params: { field: "expectedEdit" } },
    });
    expect(frozen(true)).toEqual(before);
  });
  it("passes the submitted observation to the writer", async () => {
    const p = await fixture(mode),
      current = await edit(p.id);
    expect(await http(p, current)).toMatchObject({
      status: 200,
      json:
        mode === "reader"
          ? { outcome: "captured", ticket: { total: "35.00" } }
          : { total: "35.00" },
    });
    expect(registroCount(venue, p.id)).toBe(1);
    expect(await edit(p.id)).toEqual(current);
  });
});
