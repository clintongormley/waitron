import { randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { eq, sql } from "drizzle-orm";
import {
  deviceProfiles,
  devices,
  invoiceCorrections,
  sales,
  tenderRefunds,
  withTransaction,
} from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { listAdjustmentReasons } from "@waitron/adjustments";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { saleId as brandSaleId } from "@waitron/shared";
import { readBillEditState } from "./bill-editing.js";
import { readRefundableTenders } from "./tender-refund-balance.js";
import { reserveTenderRefund } from "./tender-refund-reservation.js";
import { parkOrder } from "./working-order.js";
import { issueOrderInvoice } from "./testing/issue-order.js";
import { inTx, provisionBillVenue, send, type BillVenue } from "./testing/bill-venue.js";
import { testTradingAdmission } from "./testing/trading-admission.js";
import {
  watchDerivationsAndLock,
  watchedDerivationCount,
  watchedOrder,
} from "./testing/watched-scrypt.js";

vi.mock("node:crypto", async (importOriginal) =>
  (await import("./testing/watched-scrypt.js")).watchedCrypto(await importOriginal()),
);

let venue: BillVenue;
let reasonId: string;

useVenueDb({
  resetPerTest: false,
  migrations: migrationOptionsFor(manifestSets(), null),
  timeoutMs: 60_000,
  setup: async (db) => {
    venue = await provisionBillVenue(db);
    reasonId = (await inTx(venue, (tx) => listAdjustmentReasons(tx)))[0]!.id;
  },
});

/** A €10.00 croquettes order paid through the till in `parts`; issued unpaid when `parts` is empty. */
async function sold(parts: readonly (string | { card: string })[]) {
  const id = randomUUID();
  const deps = {
    db: venue.db,
    backend: venue.backend,
    clock: venue.clock,
    admission: testTradingAdmission(),
  };
  await parkOrder(deps, venue.cfg, {
    id,
    lines: [{ menuItemId: venue.offerFor("Croquettes"), quantity: "1" }],
    zoneId: venue.zoneId,
    operatorId: venue.operatorId,
  });
  if (parts.length === 0) await issueOrderInvoice(deps, venue.cfg, id, venue.operatorId);
  for (const part of parts) {
    const amount = typeof part === "string" ? part : part.card;
    const paid = await send(venue.app, venue.cookie, "POST", `/api/working-orders/${id}/payments`, {
      submissionId: randomUUID(),
      kind: "contribution",
      amount,
      ...(typeof part === "string"
        ? { method: "cash", tendered: amount }
        : { method: "card", entry: "manual" }),
      applied: amount,
      tip: "0.00",
      expectedEdit: await inTx(venue, (tx) => readBillEditState(tx, id)),
    });
    expect(paid.status).toBe(200);
  }
  const [sale] = await venue.db.select().from(sales).where(eq(sales.workingOrderId, id));
  return brandSaleId(sale!.id);
}

const supervisor = () => ({ personId: venue.adminId, pin: "1234" });
const SPLIT = [{ rate: "21.00", base: "4.13", tax: "0.87" }];
const body = (patch: Record<string, unknown> = {}) => ({
  submissionId: randomUUID(),
  gross: "5.00",
  reasonId,
  note: "Cold",
  expectedSplit: SPLIT,
  override: supervisor(),
  ...patch,
});
const preview = (saleId: string, payload: unknown) =>
  send(venue.app, venue.cookie, "POST", `/api/transactions/${saleId}/corrections/preview`, payload);
const correct = (saleId: string, payload: unknown) =>
  send(venue.app, venue.cookie, "POST", `/api/transactions/${saleId}/corrections`, payload);

function counts() {
  return venue.db.all<{ invoices: number; refunds: number; drawers: number }>(sql`
    select (select count(*) from sales) as invoices,
           (select count(*) from tender_refunds) as refunds,
           (select count(*) from print_jobs where kind = 'drawer') as drawers`)[0]!;
}

describe("POST /api/transactions/:saleId/corrections/preview", () => {
  it("answers the split and the cash still refundable, and refuses malformed line ids", async () => {
    const saleId = await sold(["10.00"]);
    expect(await preview(saleId, { gross: "5.00" })).toMatchObject({
      status: 200,
      json: { gross: "5.00", vatBreakdown: SPLIT, cashRefundable: "10.00" },
    });
    for (const lineIds of [null, "x", ["not-a-uuid"]])
      expect(await preview(saleId, { gross: "5.00", lineIds })).toEqual({
        status: 400,
        json: { code: "management.request_invalid", params: { field: "lineIds" } },
      });
    expect(await preview(saleId, { gross: 5 })).toEqual({
      status: 400,
      json: { code: "management.request_invalid", params: { field: "gross" } },
    });
  });
});

describe("POST /api/transactions/:saleId/corrections", () => {
  it.each([
    ["submissionId", { submissionId: 1 }],
    ["gross", { gross: "five" }],
    ["reasonId", { reasonId: undefined }],
    ["lineIds", { lineIds: null }],
    ["note", { note: 3 }],
    ["expectedSplit", { expectedSplit: [{ rate: "21.00", base: 4.13, tax: "0.87" }] }],
    ["override", { override: null }],
  ])("refuses a malformed %s, naming it and writing nothing", async (field, patch) => {
    const saleId = await sold(["10.00"]);
    const before = counts();
    expect(await correct(saleId, body(patch))).toEqual({
      status: 400,
      json: { code: "management.request_invalid", params: { field } },
    });
    expect(counts()).toEqual(before);
  });

  it("refuses staff without sale.refund, then corrects with a supervisor's PIN, and answers a repeat the same", async () => {
    const saleId = await sold(["10.00"]);
    const before = counts();
    expect(await correct(saleId, body({ override: undefined }))).toMatchObject({
      status: 403,
      json: { code: "authorization.not_permitted" },
    });
    expect(
      await correct(saleId, body({ override: { personId: venue.adminId, pin: "0000" } })),
    ).toMatchObject({ status: 401, json: { code: "pin.invalid" } });
    expect(counts()).toEqual(before);

    const ask = body();
    const first = await correct(saleId, ask);
    expect(first).toMatchObject({
      status: 200,
      json: { replayed: false, refunds: [{ state: "completed", appliedAmount: "5.00" }] },
    });
    expect(
      await venue.db.select().from(tenderRefunds).where(eq(tenderRefunds.saleId, saleId)),
    ).toMatchObject([{ requestedBy: venue.operatorId, authorizedBy: venue.adminId }]);
    const after = counts();
    expect(after).toEqual({
      invoices: before.invoices + 1,
      refunds: before.refunds + 1,
      drawers: before.drawers + 1,
    });

    expect(await correct(saleId, ask)).toEqual({
      status: 200,
      json: { ...first.json, replayed: true },
    });
    expect(counts()).toEqual(after);
  });

  it("checks the supervisor's PIN once, before the write lock", async () => {
    const saleId = await sold(["10.00"]);
    watchDerivationsAndLock(venue.db, supervisor().pin, () =>
      withTransaction(venue.db, (tx) => tx.execute(sql`select 1`)),
    );
    const answer = await correct(saleId, body());
    expect(answer.status, JSON.stringify(answer.json)).toBe(200);
    expect(await watchedOrder()).toEqual(["writer", "derived"]);
    expect(watchedDerivationCount()).toBe(1);
  });

  it("refuses a till whose profile cannot take cash, writing nothing, and corrects once it can", async () => {
    const saleId = await sold(["10.00"]);
    const [till] = await venue.db
      .select({ profileId: deviceProfiles.id, capabilities: deviceProfiles.capabilities })
      .from(devices)
      .innerJoin(deviceProfiles, eq(deviceProfiles.id, devices.deviceProfileId))
      .where(eq(devices.id, venue.deviceId));
    const capabilities = till!.capabilities as string[];
    const setCapabilities = (to: string[]) =>
      venue.db
        .update(deviceProfiles)
        .set({ capabilities: to })
        .where(eq(deviceProfiles.id, till!.profileId));
    const corrections = () => venue.db.select().from(invoiceCorrections).all().length;
    const before = { ...counts(), corrections: corrections() };
    await setCapabilities(capabilities.filter((entry) => entry !== "take-cash"));
    try {
      expect(await correct(saleId, body())).toEqual({
        status: 403,
        json: { code: "device.cash_not_allowed", params: {} },
      });
      expect({ ...counts(), corrections: corrections() }).toEqual(before);
    } finally {
      await setCapabilities(capabilities);
    }
    expect(await correct(saleId, body())).toMatchObject({
      status: 200,
      json: { replayed: false, refunds: [{ appliedAmount: "5.00" }] },
    });
  });

  it("refuses a reused submission id and an unknown sale", async () => {
    const saleId = await sold(["10.00"]);
    const ask = body();
    expect((await correct(saleId, ask)).status).toBe(200);
    expect(await correct(saleId, { ...ask, note: "Burnt" })).toMatchObject({
      status: 409,
      json: { code: "submission.id_reused" },
    });
    expect(await correct(randomUUID(), body())).toMatchObject({
      status: 404,
      json: { code: "sale.not_found" },
    });
  });

  const refusals: [string, () => Promise<{ saleId: string; patch?: Record<string, unknown> }>][] = [
    ["invoice_correction.not_settled", async () => ({ saleId: await sold([]) })],
    ["invoice_correction.not_cash", async () => ({ saleId: await sold([{ card: "10.00" }]) })],
    [
      "invoice_correction.not_cash",
      async () => ({ saleId: await sold(["4.00", { card: "6.00" }]) }),
    ],
    [
      "invoice_correction.cash_short",
      async () => {
        const saleId = await sold(["10.00"]);
        const [cash] = await inTx(venue, (tx) => readRefundableTenders(tx, saleId));
        const goodwill = await send(
          venue.app,
          venue.cookie,
          "POST",
          `/api/transactions/${saleId}/refunds`,
          {
            submissionId: randomUUID(),
            tenderId: cash!.tenderId,
            appliedAmount: "3.00",
            tipAmount: "0.00",
            reason: "Goodwill",
            override: supervisor(),
          },
        );
        expect(goodwill.status).toBe(200);
        return { saleId, patch: { gross: "10.00" } };
      },
    ],
    [
      "invoice_correction.split_changed",
      async () => ({
        saleId: await sold(["10.00"]),
        patch: { expectedSplit: [{ rate: "21.00", base: "4.12", tax: "0.88" }] },
      }),
    ],
    [
      "invoice_correction.chain_unsound",
      async () => {
        const saleId = await sold(["10.00"]);
        vi.spyOn(venue.backend, "checkIntegrity").mockResolvedValueOnce({
          ok: false,
          checked: 1,
          issues: [{ code: "predecessor-hash-mismatch", params: {} }],
        } as Awaited<ReturnType<typeof venue.backend.checkIntegrity>>);
        return { saleId };
      },
    ],
    [
      "invoice_correction.refund_pending",
      async () => {
        const saleId = await sold(["10.00"]);
        await inTx(venue, async (tx) => {
          const [cash] = await readRefundableTenders(tx, saleId);
          await reserveTenderRefund(
            tx,
            venue.cfg,
            saleId,
            {
              submissionId: randomUUID(),
              tenderId: cash!.tenderId,
              appliedAmount: "1.00",
              tipAmount: "0.00",
              reason: "Goodwill",
            },
            { requestedBy: venue.adminId, authorizedBy: venue.adminId },
            venue.clock.now().instant.toISOString(),
          );
        });
        return { saleId };
      },
    ],
  ];
  it.each(refusals)("answers %s with 409, writing nothing", async (code, arrange) => {
    const { saleId, patch } = await arrange();
    const before = counts();
    expect(await correct(saleId, body(patch))).toMatchObject({ status: 409, json: { code } });
    expect(counts()).toEqual(before);
  });
});
