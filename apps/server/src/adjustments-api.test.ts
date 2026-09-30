import { randomUUID } from "node:crypto";
import { asc, eq } from "drizzle-orm";
import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { workingOrders } from "@waitron/db";
import {
  adjustments,
  deactivateAdjustmentReason,
  createAdjustmentReason,
} from "@waitron/adjustments";
import { persons } from "@waitron/identity";
import { send } from "./testing/bill-venue.js";
import {
  billWith,
  inTx,
  lineIdOf,
  PINS,
  provisionAdjustmentVenue,
  REASONS,
  rowsOf,
  type AdjustmentVenue,
} from "./testing/adjustment-venue.js";
import { mountTillApi } from "./till-api.js";
import { parkOrder } from "./working-order.js";
import "./errors.js";

// The till's adjustment routes (service plan Task 11): apply, preview, and the reasons and
// approvers the till offers, over HTTP against a provisioned venue.
let venue: AdjustmentVenue;

useVenueDb({
  resetPerTest: false,
  migrations: migrationOptionsFor(manifestSets(), null),
  timeoutMs: 60_000,
  setup: async (db) => {
    venue = await provisionAdjustmentVenue(db);
  },
});

async function revisionOf(billId: string): Promise<number> {
  const [row] = await inTx(venue, (tx) =>
    tx
      .select({ revision: workingOrders.revision })
      .from(workingOrders)
      .where(eq(workingOrders.id, billId)),
  );
  return row!.revision;
}

/** POSTs an adjustment of the bill as it reads now, as the supervisor unless another cookie is given. */
async function post(
  billId: string,
  body: Record<string, unknown>,
  opts: { cookie?: string; path?: "" | "/preview" } = {},
) {
  return send(
    venue.app,
    opts.cookie ?? venue.cookie.supervisor,
    "POST",
    `/api/working-orders/${billId}/adjustments${opts.path ?? ""}`,
    {
      submissionId: randomUUID(),
      expectedRevision: await revisionOf(billId),
      lineId: null,
      reasonId: venue.reasonId.house,
      note: null,
      ...body,
    },
  );
}

function recordedOn(billId: string) {
  return inTx(venue, (tx) =>
    tx
      .select()
      .from(adjustments)
      .where(eq(adjustments.workingOrderId, billId))
      .orderBy(asc(adjustments.createdAt)),
  );
}

describe("weighed lines through the route (plan D4)", () => {
  it.each([
    [
      "10% off 0.333 kg of ham at €24.00/kg",
      "Ham",
      "0.333",
      { action: "discount_percent", percentBp: 1000 },
      "21.60",
      "0.80",
      "7.19",
    ],
    [
      "10% off 2.5 kg of fish at €12.99/kg",
      "Fish",
      "2.5",
      { action: "discount_percent", percentBp: 1000 },
      "11.69",
      "3.25",
      "29.23",
    ],
    [
      "€3.27 off the fish, nearest €29.20",
      "Fish",
      "2.5",
      { action: "discount_amount", amount: "3.27" },
      "11.68",
      "3.28",
      "29.20",
    ],
    [
      "€3.24 off the fish, the tie taking €29.25",
      "Fish",
      "2.5",
      { action: "discount_amount", amount: "3.24" },
      "11.70",
      "3.23",
      "29.25",
    ],
  ] as const)("%s", async (_what, name, quantity, ask, unit, achieved, lineTotal) => {
    const { billId, partyId } = await billWith(venue, [{ name, quantity }]);
    const lineId = await lineIdOf(venue, billId, 1);

    const preview = await post(billId, { lineId, ...ask }, { path: "/preview" });
    const applied = await post(billId, { lineId, ...ask });

    expect(preview.status).toBe(200);
    expect(preview.json).toMatchObject({
      reduction: achieved,
      needsApproval: null,
      lines: [
        { lineId, reduction: achieved, rows: [{ quantity: expect.any(String), unitGross: unit }] },
      ],
    });
    expect(applied.status).toBe(200);
    expect(applied.json).toEqual({
      adjustmentIds: [expect.any(String)],
      revision: expect.any(Number),
      party: { id: partyId, revision: expect.any(Number) },
    });
    const [row] = await rowsOf(venue, billId);
    expect(row).toMatchObject({
      unitPriceGross: unit,
      lineTotal,
      listUnitPriceGross: expect.any(String),
    });
    const [recorded] = await recordedOn(billId);
    expect((recorded!.reduction / 100).toFixed(2)).toBe(achieved);
  });
});

describe("approval through the route (plan D6)", () => {
  const comp = async (billId: string) => ({
    lineId: await lineIdOf(venue, billId, 1),
    action: "comp",
    reasonId: venue.reasonId.complaint,
  });

  it("refuses a staff member's comp with no approver, then applies it with a manager's PIN, leaving the waiter signed in", async () => {
    const { billId } = await billWith(venue, [{ name: "Burger" }]);

    const refused = await post(billId, await comp(billId), { cookie: venue.cookie.staff });
    expect(refused.status).toBe(403);
    expect(refused.json).toEqual({
      code: "adjustment.approval_required",
      params: { approverRole: "manager" },
    });

    const applied = await post(
      billId,
      { ...(await comp(billId)), approver: { personId: venue.managerId, pin: PINS.manager } },
      { cookie: venue.cookie.staff },
    );
    expect(applied.status).toBe(200);
    expect((await recordedOn(billId))[0]).toMatchObject({
      requestedBy: venue.staffId,
      approvedBy: venue.managerId,
    });
    // The waiter's session is untouched by the manager's PIN.
    const lines = await send(
      venue.app,
      venue.cookie.staff,
      "GET",
      `/api/working-orders/${billId}/lines`,
    );
    expect(lines.status).toBe(200);
  });

  it("answers a wrong PIN as pin.invalid, 401", async () => {
    const { billId } = await billWith(venue, [{ name: "Burger" }]);
    const refused = await post(
      billId,
      { ...(await comp(billId)), approver: { personId: venue.managerId, pin: "0000" } },
      { cookie: venue.cookie.staff },
    );
    expect(refused.status).toBe(401);
    expect(refused.json).toMatchObject({ code: "pin.invalid" });
    expect(await recordedOn(billId)).toEqual([]);
  });

  it("says in the preview who must approve, before anyone is asked", async () => {
    const { billId } = await billWith(venue, [{ name: "Burger" }]);
    const preview = await post(billId, await comp(billId), {
      cookie: venue.cookie.staff,
      path: "/preview",
    });
    expect(preview.json).toMatchObject({
      reduction: "12.00",
      nominalValue: "12.00",
      needsApproval: "manager",
    });
    expect(await recordedOn(billId)).toEqual([]);
  });
});

describe("a cancel's preview", () => {
  it("names the line it removes and what the bill loses, writing nothing", async () => {
    const { billId } = await billWith(venue, [{ name: "Steak", quantity: "2" }]);
    const lineId = await lineIdOf(venue, billId, 1);

    const preview = await post(
      billId,
      { lineId, action: "cancel", quantity: "1" },
      { path: "/preview" },
    );

    expect(preview.json).toEqual({
      reduction: "25.00",
      nominalValue: "25.00",
      needsApproval: null,
      overBillDiscountLimit: false,
      lines: [{ lineId, lineNo: 1, reduction: "25.00", rows: [] }],
    });
    expect(await recordedOn(billId)).toEqual([]);
    expect((await rowsOf(venue, billId))[0]).toMatchObject({ quantity: "2.000" });
  });

  it("previews a cancel of 1 of Pizza ×2 with olives as exactly what the applied cancel takes off the bill", async () => {
    const { billId } = await billWith(venue, [{ name: "Pizza", quantity: "2", olives: 1 }]);
    const lineId = await lineIdOf(venue, billId, 1);
    const totalOf = async () =>
      (await rowsOf(venue, billId)).reduce(
        (sum, row) => sum + Math.round(Number(row.lineTotal) * 100),
        0,
      );
    const before = await totalOf();

    const preview = await post(
      billId,
      { lineId, action: "cancel", quantity: "1" },
      { path: "/preview" },
    );
    const applied = await post(billId, { lineId, action: "cancel", quantity: "1" });

    expect(applied.status).toBe(200);
    expect(
      (await rowsOf(venue, billId)).map((row) => [row.name, row.quantity, row.lineTotal]),
    ).toEqual([
      ["Pizza", "1.000", "9.00"],
      ["Olives", "1.000", "1.50"],
    ]);
    expect(before - (await totalOf())).toBe(1050);
    expect(preview.json).toMatchObject({ reduction: "10.50", nominalValue: "10.50" });
    expect((await recordedOn(billId))[0]).toMatchObject({
      action: "cancel",
      quantity: 1000,
      reduction: 1050,
      nominalValue: 1050,
    });
  });
});

describe("the route's own rules", () => {
  it("answers a resent adjustment with the first answer, applying it once", async () => {
    const { billId } = await billWith(venue, [{ name: "Bottle" }]);
    const body = {
      submissionId: randomUUID(),
      expectedRevision: await revisionOf(billId),
      lineId: null,
      reasonId: venue.reasonId.house,
      action: "discount_amount",
      amount: "5.00",
      note: null,
    };
    const path = `/api/working-orders/${billId}/adjustments`;

    const first = await send(venue.app, venue.cookie.supervisor, "POST", path, body);
    const again = await send(venue.app, venue.cookie.supervisor, "POST", path, body);

    expect(first.status).toBe(200);
    expect(again.json).toEqual(first.json);
    expect(await recordedOn(billId)).toHaveLength(1);
  });

  it("maps each refusal to its status", async () => {
    const { billId } = await billWith(venue, [
      { name: "Bottle" },
      { name: "Pizza", quantity: "2", olives: 1 },
    ]);
    const bottle = await lineIdOf(venue, billId, 1);
    const cases: [Record<string, unknown>, number, string][] = [
      [
        { lineId: bottle, action: "discount_amount", amount: "40.00" },
        409,
        "adjustment.exceeds_amount",
      ],
      [
        { lineId: bottle, action: "cancel", reasonId: venue.reasonId.complaint },
        409,
        "adjustment.action_not_allowed",
      ],
      [
        { lineId: bottle, action: "cancel", reasonId: venue.reasonId.mistake },
        400,
        "adjustment.note_required",
      ],
      [{ lineId: bottle, action: "comp", quantity: "2" }, 400, "adjustment.quantity_invalid"],
      [
        { lineId: await lineIdOf(venue, billId, 3), action: "comp", quantity: "1" },
        400,
        "adjustment.quantity_invalid",
      ],
      [{ lineId: randomUUID(), action: "comp" }, 404, "tab.line_not_found"],
      [
        { lineId: bottle, action: "comp", reasonId: randomUUID() },
        404,
        "adjustment_reason.not_found",
      ],
      [{ lineId: bottle, action: "comp", expectedRevision: 0 }, 409, "working_order.out_of_date"],
    ];
    for (const [body, status, code] of cases) {
      const answer = await post(billId, body);
      expect([answer.status, answer.json.code]).toEqual([status, code]);
    }
    expect(await recordedOn(billId)).toEqual([]);
  });

  it("comps a dish on an open counter order, which has no party, recording it once", async () => {
    const orderId = randomUUID();
    await parkOrder({ db: venue.db }, venue.cfg, {
      id: orderId,
      lines: [{ menuItemId: venue.item("Burger"), quantity: "1" }],
      zoneId: venue.tables.zoneId,
      operatorId: venue.staffId,
    });
    const [order] = await inTx(venue, (tx) =>
      tx
        .select({ status: workingOrders.status, partyId: workingOrders.partyId })
        .from(workingOrders)
        .where(eq(workingOrders.id, orderId)),
    );
    expect(order).toEqual({ status: "open", partyId: null });
    const revision = await revisionOf(orderId);
    const rows = await rowsOf(venue, orderId);

    const answer = await post(orderId, { lineId: rows[0]!.id, action: "comp" });

    expect(answer.status).toBe(200);
    expect(answer.json).toEqual({
      adjustmentIds: [expect.any(String)],
      revision: revision + 1,
      party: null,
    });
    expect(await recordedOn(orderId)).toMatchObject([
      { action: "comp", lineId: rows[0]!.id, reduction: 1200 },
    ]);
    expect(await revisionOf(orderId)).toBe(revision + 1);
    expect((await rowsOf(venue, orderId)).map((row) => [row.name, row.lineTotal])).toEqual([
      ["Burger", "0.00"],
    ]);
  });

  it("maps over_limit, weighed_partial and reason_inactive to 409", async () => {
    const { billId } = await billWith(venue, [
      { name: "Bottle" },
      { name: "Bottle" },
      { name: "Ham", quantity: "0.333" },
    ]);
    const inactive = await inTx(venue, async (tx) => {
      const reason = await createAdjustmentReason(tx, {
        ...REASONS.house,
        name: "Retired",
        names: {},
      });
      await deactivateAdjustmentReason(tx, reason.id);
      return reason.id;
    });
    const comp = async (lineNo: number, extra: Record<string, unknown> = {}) => ({
      lineId: await lineIdOf(venue, billId, lineNo),
      action: "comp",
      reasonId: venue.reasonId.complaint,
      ...extra,
    });
    // The first €30.00 bottle reaches the reason's €30.00 cap; the second goes over it.
    expect((await post(billId, await comp(1))).status).toBe(200);
    const over = await post(billId, await comp(2));
    expect([over.status, over.json.code]).toEqual([409, "adjustment.over_limit"]);
    const partial = await post(
      billId,
      await comp(3, { reasonId: venue.reasonId.house, quantity: "0.100" }),
    );
    expect([partial.status, partial.json.code]).toEqual([409, "adjustment.weighed_partial"]);
    const retired = await post(billId, await comp(2, { reasonId: inactive }));
    expect([retired.status, retired.json.code]).toEqual([409, "adjustment.reason_inactive"]);
  });

  it("screens the body field by field", async () => {
    const { billId } = await billWith(venue, [{ name: "Bottle" }]);
    const lineId = await lineIdOf(venue, billId, 1);
    const cases: [Record<string, unknown>, string][] = [
      [{ expectedRevision: -1 }, "expectedRevision"],
      [{ expectedRevision: "3" }, "expectedRevision"],
      [{ action: "refund" }, "action"],
      [{ lineId: undefined, action: "comp" }, "lineId"],
      [{ lineId: "line-1", action: "comp" }, "lineId"],
      [{ lineId, action: "comp", reasonId: "house" }, "reasonId"],
      [{ lineId, action: "comp", quantity: 1 }, "quantity"],
      [{ lineId, action: "discount_percent", percentBp: "10" }, "percentBp"],
      [{ lineId, action: "discount_amount", amount: "1.005" }, "amount"],
      [{ lineId, action: "comp", note: 5 }, "note"],
      [{ lineId, action: "comp", note: "x".repeat(501) }, "note"],
      [{ lineId, action: "comp", submissionId: "" }, "submissionId"],
    ];
    for (const [body, field] of cases) {
      const answer = await post(billId, { action: "comp", ...body });
      expect([answer.status, answer.json]).toEqual([
        400,
        { code: "management.request_invalid", params: { field } },
      ]);
    }
    const noBill = await send(
      venue.app,
      venue.cookie.supervisor,
      "POST",
      "/api/working-orders/not-a-bill/adjustments",
      { lineId, action: "comp" },
    );
    expect([noBill.status, noBill.json.code]).toEqual([409, "tab.not_open"]);
    const badApprover = await post(billId, {
      lineId,
      action: "comp",
      approver: { personId: "x", pin: "1" },
    });
    expect(badApprover.json.code).toBe("pin.invalid");
    expect(await recordedOn(billId)).toEqual([]);
  });

  it("asks for a session on every route", async () => {
    const { billId } = await billWith(venue, [{ name: "Bottle" }]);
    for (const [method, path] of [
      ["POST", `/api/working-orders/${billId}/adjustments`],
      ["POST", `/api/working-orders/${billId}/adjustments/preview`],
      ["GET", "/api/adjustment-reasons"],
      ["GET", "/api/adjustment-approvers?role=manager"],
    ] as const) {
      const answer = await send(venue.app, "", method, path, method === "POST" ? {} : undefined);
      expect([path, answer.status]).toEqual([path, 401]);
    }
  });
});

describe("what the till reads", () => {
  it("lists the active reasons in the operator's language", async () => {
    const answer = await send(venue.app, venue.cookie.staff, "GET", "/api/adjustment-reasons");
    expect(answer.status).toBe(200);
    const names = (answer.json as unknown as { name: string }[]).map((reason) => reason.name);
    expect(names).toEqual(expect.arrayContaining(["Queja", "Casa", "Error"]));
    expect(names).not.toContain("Retired");
    expect((answer.json as unknown as unknown[])[0]).toEqual({
      id: venue.reasonId.complaint,
      name: "Queja",
      actions: ["comp", "discount_percent", "discount_amount"],
      noteRequired: false,
      maxPercentBp: 5000,
      maxAmount: "30.00",
      applyRole: "supervisor",
      approverRole: "manager",
    });

    await inTx(venue, (tx) =>
      tx.update(persons).set({ locale: "en-GB" }).where(eq(persons.id, venue.staffId)),
    );
    try {
      const english = await send(venue.app, venue.cookie.staff, "GET", "/api/adjustment-reasons");
      expect((english.json as unknown as { name: string }[])[0]!.name).toBe("Complaint");
    } finally {
      await inTx(venue, (tx) =>
        tx.update(persons).set({ locale: null }).where(eq(persons.id, venue.staffId)),
      );
    }
  });

  it("records an adjustment's reason in the language the reasons list showed it in", async () => {
    // A venue whose display language is English while its receipts are Spanish.
    const app = new Hono();
    mountTillApi(
      app,
      {
        db: venue.db,
        backend: venue.backend,
        clock: venue.clock,
        cfg: venue.cfg,
        secureCookies: false,
        venueLocale: "en-GB",
      },
      () => {},
    );
    expect(venue.cfg.locale).toBe("es-ES");
    const listed = await send(app, venue.cookie.manager, "GET", "/api/adjustment-reasons");
    expect(
      (listed.json as unknown as { id: string; name: string }[]).find(
        (reason) => reason.id === venue.reasonId.complaint,
      )!.name,
    ).toBe("Complaint");
    const { billId } = await billWith(venue, [{ name: "Burger" }]);

    const answer = await send(
      app,
      venue.cookie.manager,
      "POST",
      `/api/working-orders/${billId}/adjustments`,
      {
        submissionId: randomUUID(),
        expectedRevision: await revisionOf(billId),
        lineId: await lineIdOf(venue, billId, 1),
        reasonId: venue.reasonId.complaint,
        action: "comp",
        note: null,
      },
    );

    expect(answer.status).toBe(200);
    expect((await recordedOn(billId))[0]!.reasonName).toBe("Complaint");
  });

  it("gives the price a comped or discounted line had before, and nothing on a line never adjusted", async () => {
    const { billId } = await billWith(venue, [
      { name: "Burger" },
      { name: "Steak", quantity: "2" },
      { name: "Bread" },
    ]);
    const [burgerId, steakId] = [
      await lineIdOf(venue, billId, 1),
      await lineIdOf(venue, billId, 2),
    ];
    expect((await post(billId, { lineId: burgerId, action: "comp" })).status).toBe(200);
    expect((await post(billId, { lineId: steakId, action: "comp", quantity: "1" })).status).toBe(
      200,
    );

    const answer = await send(
      venue.app,
      venue.cookie.staff,
      "GET",
      `/api/working-orders/${billId}/lines`,
    );

    const lines = (
      answer.json as unknown as {
        lines: { name: string; unitPriceGross: string; listUnitPriceGross?: string }[];
      }
    ).lines.map(({ name, unitPriceGross, listUnitPriceGross }) => ({
      name,
      unitPriceGross,
      ...(listUnitPriceGross === undefined ? {} : { listUnitPriceGross }),
    }));
    expect(lines).toEqual([
      { name: "Burger", unitPriceGross: "0.00", listUnitPriceGross: "12.00" },
      // The part of the Steak not comped kept its price, and still names the price it had.
      { name: "Steak", unitPriceGross: "25.00", listUnitPriceGross: "25.00" },
      { name: "Bread", unitPriceGross: "2.50" },
      { name: "Steak", unitPriceGross: "0.00", listUnitPriceGross: "25.00" },
    ]);
  });

  it("lists who can approve at a role, and refuses a role that is not one", async () => {
    const managers = await send(
      venue.app,
      venue.cookie.staff,
      "GET",
      "/api/adjustment-approvers?role=manager",
    );
    expect(managers.json).toEqual([
      { personId: expect.any(String), displayName: "Administradora" },
      { personId: venue.managerId, displayName: "Marta" },
    ]);
    for (const query of ["?role=chef", ""]) {
      const refused = await send(
        venue.app,
        venue.cookie.staff,
        "GET",
        `/api/adjustment-approvers${query}`,
      );
      expect([refused.status, refused.json]).toEqual([
        400,
        { code: "management.request_invalid", params: { field: "role" } },
      ]);
    }
  });
});
