import { randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { eq, sql } from "drizzle-orm";
import {
  deviceProfiles,
  devices,
  floorZones,
  invoiceCorrections,
  products,
  sales,
  withTransaction,
} from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { seedDeviceProfiles } from "@waitron/db/testing/seed.js";
import { receiptLabelsFor } from "@waitron/country-packs";
import { listAdjustmentReasons, type AdjustmentReason } from "@waitron/adjustments";
import { loginWithPin } from "@waitron/identity";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { saleId as brandSaleId } from "@waitron/shared";
import {
  createDepartment,
  createServiceZone,
  setProfileServiceAccess,
} from "@waitron/venue-service";
import { DEVICE_COOKIE } from "./device-session.js";
import { printedLines } from "./testing/decode-ticket.js";
import { SESSION_COOKIE } from "./till-session.js";
import { enrolDeviceForTest } from "./testing/enrol.js";
import { BASIC_ACTIONS } from "./testing/session-device.js";
import { readBillEditState } from "./bill-editing.js";
import { readRefundableTenders } from "./tender-refund-balance.js";
import { parkOrder } from "./working-order.js";
import { issueOrderInvoice } from "./testing/issue-order.js";
import { inTx, provisionBillVenue, send, type BillVenue } from "./testing/bill-venue.js";
import { testTradingAdmission } from "./testing/trading-admission.js";
import { offerProducts } from "./testing/zone-offers.js";
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
let reasons: AdjustmentReason[];
/** A till of its own, signed in, whose profile `serveOnly` limits to one zone. */
let zonedTill: { cookie: string; profileId: string };
/** A zone in a department of its own, where no test sells. */
let otherZone: string;

useVenueDb({
  resetPerTest: false,
  migrations: migrationOptionsFor(manifestSets(), null),
  timeoutMs: 60_000,
  setup: async (db) => {
    venue = await provisionBillVenue(db);
    reasons = await inTx(venue, (tx) => listAdjustmentReasons(tx));
    reasonId = reasons[0]!.id;
    const profileId = await inTx(venue, async (tx) => {
      const department = await createDepartment(tx, { name: "Interior", orderStart: "table" });
      otherZone = (await createServiceZone(tx, { name: "Interior", departmentId: department.id }))
        .id;
      const [profile] = await seedDeviceProfiles(tx, {
        name: "Zoned till",
        formFactor: "till",
        capabilities: [...BASIC_ACTIONS, "open-cash-drawer", "take-cash"],
      });
      return profile!.id;
    });
    const device = await enrolDeviceForTest(db, venue.cfg, { name: "Zoned till", profileId });
    const session = await withTransaction(db, (tx) =>
      loginWithPin(tx, { deviceId: device.deviceId, personId: venue.operatorId, pin: "5555" }),
    );
    zonedTill = {
      cookie: `${SESSION_COOKIE}=${session.token}; ${DEVICE_COOKIE}=${device.deviceId}.${device.token}`,
      profileId,
    };
  },
});

async function serveOnly(zoneId: string) {
  await inTx(venue, async (tx) => {
    const [policy] = await tx
      .select({ departmentId: floorZones.departmentId })
      .from(floorZones)
      .where(eq(floorZones.id, zoneId));
    await setProfileServiceAccess(tx, zonedTill.profileId, {
      departmentId: policy!.departmentId,
      allowedZoneIds: [zoneId],
      startingZoneId: zoneId,
    });
  });
}

/** A €10.00 croquettes order paid through the till in `parts`; issued unpaid when `parts` is empty.
 * `where` names another zone and its croquettes offer. */
async function sold(
  parts: readonly (string | { card: string } | { reader: string })[],
  where?: { zoneId: string; croquettes: string },
) {
  const id = randomUUID();
  const deps = {
    db: venue.db,
    backend: venue.backend,
    clock: venue.clock,
    admission: testTradingAdmission(),
  };
  await parkOrder(deps, venue.cfg, {
    id,
    lines: [{ menuItemId: where?.croquettes ?? venue.offerFor("Croquettes"), quantity: "1" }],
    zoneId: where?.zoneId ?? venue.zoneId,
    operatorId: venue.operatorId,
  });
  if (parts.length === 0) await issueOrderInvoice(deps, venue.cfg, id, venue.operatorId);
  for (const part of parts) {
    const amount = typeof part === "string" ? part : "card" in part ? part.card : part.reader;
    const paid = await send(venue.app, venue.cookie, "POST", `/api/working-orders/${id}/payments`, {
      submissionId: randomUUID(),
      kind: "contribution",
      amount,
      ...(typeof part === "string"
        ? { method: "cash", tendered: amount }
        : { method: "card", entry: "card" in part ? "manual" : "reader" }),
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
const preview = (saleId: string, payload: unknown, cookie = venue.cookie) =>
  send(venue.app, cookie, "POST", `/api/transactions/${saleId}/corrections/preview`, payload);
const open = (saleId: string, payload: unknown, cookie = venue.cookie) =>
  send(venue.app, cookie, "POST", `/api/transactions/${saleId}/corrections`, payload);
const read = (correctionId: string, cookie = venue.cookie) =>
  send(venue.app, cookie, "GET", `/api/invoice-corrections/${correctionId}`);

function counts() {
  return venue.db.all<{
    invoices: number;
    refunds: number;
    drawers: number;
    corrections: number;
  }>(sql`
    select (select count(*) from sales) as invoices,
           (select count(*) from tender_refunds) as refunds,
           (select count(*) from print_jobs where kind = 'drawer') as drawers,
           (select count(*) from invoice_corrections) as corrections`)[0]!;
}

/** The id of a correction of €5.00 opened on `saleId` through the main till. */
async function opened(saleId: string): Promise<string> {
  const answer = await open(saleId, body());
  expect(answer.status, JSON.stringify(answer.json)).toBe(200);
  return (answer.json as { correction: { id: string } }).correction.id;
}

const ZONE_REFUSED = () => ({
  status: 403,
  json: { code: "service_zone.not_allowed", params: { zoneId: venue.zoneId } },
});

describe("POST /api/transactions/:saleId/corrections/preview", () => {
  it("answers the split and the money still refundable, and refuses malformed line ids", async () => {
    const saleId = await sold(["10.00"]);
    expect(await preview(saleId, { gross: "5.00" })).toMatchObject({
      status: 200,
      json: { gross: "5.00", vatBreakdown: SPLIT, moneyRefundable: "10.00" },
    });
    for (const lineIds of [null, "x", ["not-a-uuid"]])
      expect(await preview(saleId, { gross: "5.00", lineIds })).toEqual({
        status: 400,
        json: { code: "management.request_invalid", params: { field: "lineIds" } },
      });
    for (const gross of [5, "06.05", "00.50"])
      expect(await preview(saleId, { gross })).toEqual({
        status: 400,
        json: { code: "management.request_invalid", params: { field: "gross" } },
      });
    expect(await preview(saleId, { gross: "0.50" })).toMatchObject({
      status: 200,
      json: { gross: "0.50" },
    });
  });

  it("refuses a till outside the invoice's zone, and answers it once the zone is its own", async () => {
    const saleId = await sold(["10.00"]);
    const readable = await opened(await sold(["10.00"]));
    await serveOnly(otherZone);
    const before = counts();
    expect(await preview(saleId, { gross: "5.00" }, zonedTill.cookie)).toEqual(ZONE_REFUSED());
    expect(await open(saleId, body(), zonedTill.cookie)).toEqual(ZONE_REFUSED());
    expect(await read(readable, zonedTill.cookie)).toEqual(ZONE_REFUSED());
    expect(counts()).toEqual(before);
    await serveOnly(venue.zoneId);
    expect(await preview(saleId, { gross: "5.00" }, zonedTill.cookie)).toMatchObject({
      status: 200,
      json: { gross: "5.00", vatBreakdown: SPLIT, moneyRefundable: "10.00" },
    });
    expect(await open(saleId, body(), zonedTill.cookie)).toMatchObject({
      status: 200,
      json: { replayed: false, correction: { saleId, state: "open", gross: "5.00" } },
    });
    expect(await read(readable, zonedTill.cookie)).toMatchObject({
      status: 200,
      json: { id: readable, state: "open" },
    });
  });
});

describe("POST /api/transactions/:saleId/corrections", () => {
  it.each([
    ["submissionId", { submissionId: 1 }],
    ["gross", { gross: "five" }],
    ["gross", { gross: "06.05" }],
    ["reasonId", { reasonId: undefined }],
    ["lineIds", { lineIds: null }],
    ["note", { note: 3 }],
    ["expectedSplit", { expectedSplit: [{ rate: "21.00", base: 4.13, tax: "0.87" }] }],
    ["expectedSplit", { expectedSplit: [{ rate: "021.00", base: "4.13", tax: "0.87" }] }],
    ["override", { override: null }],
  ])("refuses a malformed %s, naming it and writing nothing", async (field, patch) => {
    const saleId = await sold(["10.00"]);
    const before = counts();
    expect(await open(saleId, body(patch))).toEqual({
      status: 400,
      json: { code: "management.request_invalid", params: { field } },
    });
    expect(counts()).toEqual(before);
  });

  it("opens a correction, refusing staff without sale.rectify, then opening with a supervisor's PIN", async () => {
    const saleId = await sold(["10.00"]);
    const before = counts();
    expect(await open(saleId, body({ override: undefined }))).toEqual({
      status: 403,
      json: { code: "authorization.not_permitted", params: { permission: "sale.rectify" } },
    });
    expect(
      await open(saleId, body({ override: { personId: venue.adminId, pin: "0000" } })),
    ).toMatchObject({ status: 401, json: { code: "pin.invalid" } });
    expect(counts()).toEqual(before);

    const ask = body();
    const first = await open(saleId, ask);
    expect(first).toMatchObject({
      status: 200,
      json: {
        replayed: false,
        correction: {
          saleId,
          state: "open",
          gross: "5.00",
          moneyBack: "0.00",
          pending: "0.00",
          left: "5.00",
          legs: [],
          fileNow: null,
        },
      },
    });
    expect(
      await venue.db
        .select({
          requestedBy: invoiceCorrections.requestedBy,
          authorizedBy: invoiceCorrections.authorizedBy,
          viaOverride: invoiceCorrections.viaOverride,
        })
        .from(invoiceCorrections)
        .where(eq(invoiceCorrections.originalSaleId, saleId)),
    ).toEqual([{ requestedBy: venue.operatorId, authorizedBy: venue.adminId, viaOverride: true }]);
    const after = counts();
    expect(after).toEqual({ ...before, corrections: before.corrections + 1 });

    expect(await open(saleId, ask)).toEqual({
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
    const answer = await open(saleId, body());
    expect(answer.status, JSON.stringify(answer.json)).toBe(200);
    expect(await watchedOrder()).toEqual(["writer", "derived"]);
    expect(watchedDerivationCount()).toBe(1);
  });

  it("refuses a reused submission id and an unknown sale", async () => {
    const saleId = await sold(["10.00"]);
    const ask = body();
    expect((await open(saleId, ask)).status).toBe(200);
    expect(await open(saleId, { ...ask, note: "Burnt" })).toMatchObject({
      status: 409,
      json: { code: "submission.id_reused" },
    });
    expect(await open(randomUUID(), body())).toMatchObject({
      status: 404,
      json: { code: "sale.not_found" },
    });
  });

  it("refuses a reason that is not a Void reason, and one asking for a note without it, writing nothing", async () => {
    const saleId = await sold(["10.00"]);
    const comp = reasons.find((reason) => reason.kind === "comp")!;
    const other = reasons.find((reason) => reason.kind === "void" && reason.noteRequired)!;
    const before = counts();
    expect(await open(saleId, body({ reasonId: comp.id }))).toEqual({
      status: 409,
      json: { code: "adjustment.action_not_allowed", params: {} },
    });
    expect(await open(saleId, body({ reasonId: other.id, note: null }))).toEqual({
      status: 400,
      json: { code: "adjustment.note_required", params: {} },
    });
    expect(counts()).toEqual(before);
    expect(await open(saleId, body({ reasonId: other.id, note: "Wrong table" }))).toMatchObject({
      status: 200,
      json: { replayed: false, correction: { state: "open", gross: "5.00" } },
    });
  });

  const refusals: [string, () => Promise<{ saleId: string; patch?: Record<string, unknown> }>][] = [
    ["invoice_correction.not_settled", async () => ({ saleId: await sold([]) })],
    [
      "invoice_correction.already_open",
      async () => {
        const saleId = await sold(["10.00"]);
        await opened(saleId);
        return { saleId };
      },
    ],
    [
      "invoice_correction.money_short",
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
        const saleId = await sold([{ reader: "10.00" }]);
        const [card] = await inTx(venue, (tx) => readRefundableTenders(tx, saleId));
        venue.card.scriptNextRefund({
          made: false,
          answer: { kind: "uncertain", reason: "network" },
        });
        const goodwill = await send(
          venue.app,
          venue.cookie,
          "POST",
          `/api/transactions/${saleId}/refunds`,
          {
            submissionId: randomUUID(),
            tenderId: card!.tenderId,
            appliedAmount: "1.00",
            tipAmount: "0.00",
            reason: "Goodwill",
            override: supervisor(),
          },
        );
        expect(goodwill).toMatchObject({ status: 200, json: { state: "pending" } });
        return { saleId };
      },
    ],
  ];
  it.each(refusals)("answers %s with 409, writing nothing", async (code, arrange) => {
    const { saleId, patch } = await arrange();
    const before = counts();
    expect(await open(saleId, body(patch))).toMatchObject({ status: 409, json: { code } });
    expect(counts()).toEqual(before);
  });
});

describe("GET /api/invoice-corrections/:id", () => {
  it("answers an open correction, and refuses an unknown or malformed id", async () => {
    const saleId = await sold(["10.00"]);
    const id = await opened(saleId);
    expect(await read(id)).toMatchObject({
      status: 200,
      json: { id, saleId, state: "open", gross: "5.00", left: "5.00", legs: [] },
    });
    const unknown = randomUUID();
    expect(await read(unknown)).toEqual({
      status: 404,
      json: { code: "invoice_correction.not_found", params: { correctionId: unknown } },
    });
    expect(await read("not-an-id")).toEqual({
      status: 404,
      json: { code: "invoice_correction.not_found", params: { correctionId: "not-an-id" } },
    });
  });
});

const giveCash = (correctionId: string, payload: unknown, cookie = venue.cookie) =>
  send(venue.app, cookie, "POST", `/api/invoice-corrections/${correctionId}/cash`, payload);
const cashBody = (patch: Record<string, unknown> = {}) => ({
  submissionId: randomUUID(),
  amount: "5.00",
  override: supervisor(),
  ...patch,
});

describe("GET /api/invoice-corrections", () => {
  const list = (cookie = venue.cookie) =>
    send(venue.app, cookie, "GET", "/api/invoice-corrections") as Promise<{
      status: number;
      json: { corrections: { id: string }[] };
    }>;

  it("lists open corrections in the till's zones only", async () => {
    const terrace = await inTx(venue, async (tx) => {
      const department = await createDepartment(tx, { name: "Terrace", orderStart: "counter" });
      const zoneId = (await createServiceZone(tx, { name: "Terrace", departmentId: department.id }))
        .id;
      const [croquettes] = await tx
        .select({ id: products.id })
        .from(products)
        .where(eq(products.name, "Croquettes"));
      const offers = await offerProducts(tx, venue.cfg, { zone: { zoneId } });
      return { zoneId, croquettes: offers.offerFor(croquettes!.id) };
    });
    const here = await opened(await sold(["10.00"]));
    const there = await opened(await sold(["10.00"], terrace));
    const filed = await opened(await sold(["10.00"], terrace));
    expect(await giveCash(filed, cashBody())).toMatchObject({
      status: 200,
      json: { correction: { state: "filed" } },
    });
    await serveOnly(terrace.zoneId);
    const zoned = await list(zonedTill.cookie);
    expect(zoned).toMatchObject({
      status: 200,
      json: {
        corrections: [{ id: there, state: "open", gross: "5.00", moneyBack: "0.00", left: "5.00" }],
      },
    });
    expect(zoned.json.corrections[0]).not.toHaveProperty("fileNow");
    const ids = (await list()).json.corrections.map((correction) => correction.id);
    expect(ids).toEqual(expect.arrayContaining([here, there]));
    expect(ids).not.toContain(filed);
    await serveOnly(venue.zoneId);
  });
});

describe("POST /api/invoice-corrections/:id/cash", () => {
  it("refuses staff without sale.refund, then gives the cash with a supervisor's PIN and files the corrective", async () => {
    const saleId = await sold(["10.00"]);
    const id = await opened(saleId);
    const before = counts();
    expect(await giveCash(id, cashBody({ override: undefined }))).toEqual({
      status: 403,
      json: { code: "authorization.not_permitted", params: { permission: "sale.refund" } },
    });
    expect(counts()).toEqual(before);

    const ask = cashBody();
    const first = await giveCash(id, ask);
    expect(first).toMatchObject({
      status: 200,
      json: {
        replayed: false,
        refunds: [{ state: "completed", appliedAmount: "5.00" }],
        correction: { id, state: "filed", moneyBack: "5.00", left: "0.00" },
      },
    });
    expect(counts()).toEqual({
      ...before,
      invoices: before.invoices + 1,
      refunds: before.refunds + 1,
      drawers: before.drawers + 1,
    });
    const after = counts();
    expect(await giveCash(id, ask)).toEqual({
      status: 200,
      json: { ...first.json, replayed: true },
    });
    expect(counts()).toEqual(after);
  });

  it("answers a repeat of the last cash leg after every cash payment has been given back", async () => {
    const saleId = await sold(["10.00"]);
    const split = (await preview(saleId, { gross: "10.00" })).json.vatBreakdown;
    const answer = await open(saleId, body({ gross: "10.00", expectedSplit: split }));
    expect(answer.status, JSON.stringify(answer.json)).toBe(200);
    const id = (answer.json as { correction: { id: string } }).correction.id;
    const ask = cashBody({ amount: "10.00" });
    const first = await giveCash(id, ask);
    expect(first).toMatchObject({ status: 200, json: { correction: { state: "filed" } } });
    const after = counts();

    expect(await giveCash(id, ask)).toEqual({
      status: 200,
      json: { ...first.json, replayed: true },
    });
    expect(counts()).toEqual(after);
  });

  it("refuses a till whose profile cannot take cash, writing nothing, and gives cash once it can", async () => {
    const id = await opened(await sold(["10.00"]));
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
    const before = counts();
    await setCapabilities(capabilities.filter((entry) => entry !== "take-cash"));
    try {
      expect(await giveCash(id, cashBody())).toEqual({
        status: 403,
        json: { code: "device.cash_not_allowed", params: {} },
      });
      expect(counts()).toEqual(before);
    } finally {
      await setCapabilities(capabilities);
    }
    expect(await giveCash(id, cashBody())).toMatchObject({
      status: 200,
      json: { replayed: false, refunds: [{ appliedAmount: "5.00" }] },
    });
  });

  it("refuses a till outside the invoice's zone, writing nothing, and gives cash once the zone is its own", async () => {
    const id = await opened(await sold(["10.00"]));
    await serveOnly(otherZone);
    const before = counts();
    expect(await giveCash(id, cashBody(), zonedTill.cookie)).toEqual(ZONE_REFUSED());
    expect(counts()).toEqual(before);
    await serveOnly(venue.zoneId);
    expect(await giveCash(id, cashBody(), zonedTill.cookie)).toMatchObject({
      status: 200,
      json: { refunds: [{ appliedAmount: "5.00" }], correction: { state: "filed" } },
    });
  });

  it.each([
    ["submissionId", { submissionId: 1 }],
    ["amount", { amount: 5 }],
    ["amount", { amount: "05.00" }],
    ["override", { override: null }],
  ])("refuses a malformed %s, naming it and writing nothing", async (field, patch) => {
    const id = await opened(await sold(["10.00"]));
    const before = counts();
    expect(await giveCash(id, cashBody(patch))).toEqual({
      status: 400,
      json: { code: "management.request_invalid", params: { field } },
    });
    expect(counts()).toEqual(before);
  });

  it("refuses an unknown or malformed correction id", async () => {
    const unknown = randomUUID();
    expect(await giveCash(unknown, cashBody())).toEqual({
      status: 404,
      json: { code: "invoice_correction.not_found", params: { correctionId: unknown } },
    });
    expect(await giveCash("not-an-id", cashBody())).toEqual({
      status: 404,
      json: { code: "invoice_correction.not_found", params: { correctionId: "not-an-id" } },
    });
  });

  const cashRefusals: [string, () => Promise<{ id: string; patch?: Record<string, unknown> }>][] = [
    [
      "invoice_correction.not_open",
      async () => {
        const id = await opened(await sold(["10.00"]));
        expect((await giveCash(id, cashBody())).status).toBe(200);
        return { id, patch: { amount: "1.00" } };
      },
    ],
    [
      "invoice_correction.leg_too_large",
      async () => ({ id: await opened(await sold(["10.00"])), patch: { amount: "5.01" } }),
    ],
    [
      "invoice_correction.cash_short",
      async () => ({ id: await opened(await sold(["10.00"])), patch: { amount: "10.01" } }),
    ],
    [
      "invoice_correction.chain_unsound",
      async () => {
        const id = await opened(await sold(["10.00"]));
        vi.spyOn(venue.backend, "checkIntegrity").mockResolvedValueOnce({
          ok: false,
          checked: 1,
          issues: [{ code: "predecessor-hash-mismatch", params: {} }],
        } as Awaited<ReturnType<typeof venue.backend.checkIntegrity>>);
        return { id };
      },
    ],
  ];
  it.each(cashRefusals)("answers %s with 409, writing nothing", async (code, arrange) => {
    const { id, patch } = await arrange();
    const before = counts();
    expect(await giveCash(id, cashBody(patch))).toMatchObject({ status: 409, json: { code } });
    expect(counts()).toEqual(before);
  });
});

const fileNow = (correctionId: string, payload: unknown, cookie = venue.cookie) =>
  send(venue.app, cookie, "POST", `/api/invoice-corrections/${correctionId}/file`, payload);
const closeIt = (correctionId: string, payload: unknown, cookie = venue.cookie) =>
  send(venue.app, cookie, "POST", `/api/invoice-corrections/${correctionId}/close`, payload);
const THREE_BACK = [{ rate: "21.00", base: "2.48", tax: "0.52" }];
const fileBody = (patch: Record<string, unknown> = {}) => ({
  expectedSplit: THREE_BACK,
  override: supervisor(),
  ...patch,
});

/** A €5.00 correction of a fresh €10.00 cash ticket with €3.00 of it given back in cash. */
async function threeBack(): Promise<string> {
  const id = await opened(await sold(["10.00"]));
  expect((await giveCash(id, cashBody({ amount: "3.00" }))).status).toBe(200);
  return id;
}

describe("POST /api/invoice-corrections/:id/file and /close", () => {
  it("files and closes only with sale.rectify, or a supervisor's PIN", async () => {
    const id = await threeBack();
    const before = counts();
    expect(await fileNow(id, fileBody({ override: undefined }))).toEqual({
      status: 403,
      json: { code: "authorization.not_permitted", params: { permission: "sale.rectify" } },
    });
    expect(
      await fileNow(id, fileBody({ override: { personId: venue.adminId, pin: "0000" } })),
    ).toMatchObject({ status: 401, json: { code: "pin.invalid" } });
    expect(counts()).toEqual(before);
    expect(await fileNow(id, fileBody())).toMatchObject({
      status: 200,
      json: { id, state: "filed", moneyBack: "3.00", left: "2.00" },
    });
    expect(counts()).toEqual({ ...before, invoices: before.invoices + 1 });

    const empty = await opened(await sold(["10.00"]));
    const was = counts();
    expect(await closeIt(empty, { override: undefined })).toEqual({
      status: 403,
      json: { code: "authorization.not_permitted", params: { permission: "sale.rectify" } },
    });
    expect(await read(empty)).toMatchObject({ status: 200, json: { state: "open" } });
    expect(await closeIt(empty, { override: supervisor() })).toMatchObject({
      status: 200,
      json: { id: empty, state: "discarded" },
    });
    expect(counts()).toEqual(was);
  });

  it("refuses a till outside the invoice's zone, writing nothing, and files and closes once the zone is its own", async () => {
    const id = await threeBack();
    const empty = await opened(await sold(["10.00"]));
    await serveOnly(otherZone);
    const before = counts();
    expect(await fileNow(id, fileBody(), zonedTill.cookie)).toEqual(ZONE_REFUSED());
    expect(await closeIt(empty, { override: supervisor() }, zonedTill.cookie)).toEqual(
      ZONE_REFUSED(),
    );
    expect(counts()).toEqual(before);
    expect(await read(empty)).toMatchObject({ json: { state: "open" } });
    await serveOnly(venue.zoneId);
    expect(await fileNow(id, fileBody(), zonedTill.cookie)).toMatchObject({
      status: 200,
      json: { state: "filed" },
    });
    expect(await closeIt(empty, { override: supervisor() }, zonedTill.cookie)).toMatchObject({
      status: 200,
      json: { state: "discarded" },
    });
  });

  it.each([
    ["expectedSplit", { expectedSplit: [{ rate: "21.00", base: 2.48, tax: "0.52" }] }],
    ["expectedSplit", { expectedSplit: null }],
    ["override", { override: null }],
  ])("File now refuses a malformed %s, naming it and writing nothing", async (field, patch) => {
    const id = await threeBack();
    const before = counts();
    expect(await fileNow(id, fileBody(patch))).toEqual({
      status: 400,
      json: { code: "management.request_invalid", params: { field } },
    });
    expect(counts()).toEqual(before);
  });

  it("refuses an unknown or malformed correction id", async () => {
    const unknown = randomUUID();
    for (const call of [fileNow, closeIt]) {
      expect(await call(unknown, fileBody())).toEqual({
        status: 404,
        json: { code: "invoice_correction.not_found", params: { correctionId: unknown } },
      });
      expect(await call("not-an-id", fileBody())).toEqual({
        status: 404,
        json: { code: "invoice_correction.not_found", params: { correctionId: "not-an-id" } },
      });
    }
  });

  const refusals: [string, () => Promise<{ call: typeof fileNow; id: string; patch?: object }>][] =
    [
      [
        "invoice_correction.nothing_back",
        async () => ({ call: fileNow, id: await opened(await sold(["10.00"])) }),
      ],
      [
        "invoice_correction.split_changed",
        async () => ({ call: fileNow, id: await threeBack(), patch: { expectedSplit: SPLIT } }),
      ],
      [
        "invoice_correction.still_correctable",
        async () => ({ call: closeIt, id: await threeBack() }),
      ],
      [
        "invoice_correction.not_open",
        async () => {
          const id = await opened(await sold(["10.00"]));
          expect((await closeIt(id, { override: supervisor() })).status).toBe(200);
          return { call: fileNow, id };
        },
      ],
    ];
  it.each(refusals)("answers %s with 409, writing nothing", async (code, arrange) => {
    const { call, id, patch } = await arrange();
    const before = counts();
    expect(await call(id, fileBody(patch as Record<string, unknown>))).toMatchObject({
      status: 409,
      json: { code },
    });
    expect(counts()).toEqual(before);
  });
});

describe("the corrective invoice's paper", () => {
  /** The print jobs of the sale `saleId`, oldest first. */
  const papers = (saleId: string) =>
    venue.db
      .all<{ kind: string; copy: number | null; payload: Uint8Array }>(
        sql`select kind, receipt_copy as copy, payload from print_jobs
            where sale_id = ${saleId} order by rowid`,
      )
      .map(({ kind, copy, payload }) => ({
        kind,
        copy: copy === 1,
        text: printedLines(payload).join("\n"),
      }));
  const numberOf = (saleId: string) =>
    venue.db.all<{ number: string }>(
      sql`select s.code || '/' || sales.invoice_number as number from sales
          join invoice_series s on s.id = sales.series_id where sales.id = ${saleId}`,
    )[0]!.number;

  it("prints the corrective once when the last cash leg files it, and nothing on a replay", async () => {
    const saleId = await sold(["10.00"]);
    const id = await opened(saleId);
    const ask = cashBody();
    const first = await giveCash(id, ask);
    const correctiveSaleId = (first.json as { correction: { correctiveSaleId: string } }).correction
      .correctiveSaleId;
    const [paper, ...more] = papers(correctiveSaleId);
    expect(more).toEqual([]);
    expect(paper).toMatchObject({ kind: "document", copy: false });
    const lines = paper!.text.split("\n").map((line) => line.trim().split(/\s{2,}/u)[0]);
    const { correctiveInvoice, correctedInvoice } = receiptLabelsFor("es-ES");
    const title = lines.indexOf(correctiveInvoice);
    expect(lines.slice(title, title + 4), paper!.text).toEqual([
      correctiveInvoice,
      numberOf(correctiveSaleId),
      correctedInvoice,
      numberOf(saleId),
    ]);

    expect(await giveCash(id, ask)).toMatchObject({ status: 200, json: { replayed: true } });
    expect(papers(correctiveSaleId)).toHaveLength(1);
  });

  it("prints the corrective File now files", async () => {
    const id = await threeBack();
    const filed = await fileNow(id, fileBody());
    const correctiveSaleId = (filed.json as { correctiveSaleId: string }).correctiveSaleId;
    expect(papers(correctiveSaleId)).toMatchObject([{ kind: "document", copy: false }]);
  });

  it("reprints the corrective as a copy that opens no drawer", async () => {
    const id = await opened(await sold(["10.00"]));
    const correctiveSaleId = (
      (await giveCash(id, cashBody())).json as { correction: { correctiveSaleId: string } }
    ).correction.correctiveSaleId;
    const [till] = await venue.db
      .select({ profileId: deviceProfiles.id, capabilities: deviceProfiles.capabilities })
      .from(devices)
      .innerJoin(deviceProfiles, eq(deviceProfiles.id, devices.deviceProfileId))
      .where(eq(devices.id, venue.deviceId));
    const setCapabilities = (to: string[]) =>
      venue.db
        .update(deviceProfiles)
        .set({ capabilities: to })
        .where(eq(deviceProfiles.id, till!.profileId));
    const before = counts();
    await setCapabilities([...(till!.capabilities as string[]), "print-receipt"]);
    try {
      expect(
        await send(
          venue.app,
          venue.cookie,
          "POST",
          `/api/transactions/${correctiveSaleId}/reprint`,
          {},
        ),
      ).toMatchObject({ status: 200 });
    } finally {
      await setCapabilities(till!.capabilities as string[]);
    }
    const [original, copy] = papers(correctiveSaleId);
    expect(copy).toMatchObject({ kind: "document", copy: true });
    const { duplicate } = receiptLabelsFor("es-ES");
    expect(original!.text).not.toContain(duplicate);
    expect(copy!.text).toContain(duplicate);
    expect(counts()).toEqual(before);
  });
});
