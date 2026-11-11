import { beforeEach, expect, it, vi } from "vitest";
import { decimal, deviceOrigin } from "@waitron/shared";
import type { DeviceId, NodeId, SaleId, SeriesId } from "@waitron/shared";
import { FakeFiscalBackend } from "@waitron/fiscal/src/testing/fake-backend.js";
import type { TrustedClock, VatBreakdownLine } from "@waitron/fiscal";
import {
  CORE_MIGRATIONS,
  captureError,
  invoiceSeries,
  saleLines,
  sales,
  withTransaction,
} from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { seedDevice } from "@waitron/db/testing/seed.js";
import { hashPin, loginWithPin, persons } from "@waitron/identity";
import { eq } from "drizzle-orm";
import { recordCorrection } from "./record-correction.js";
import { recordSale } from "./record-sale.js";
import type { RecordSaleLine } from "./record-sale.js";
import { seedRectificativeSeries, seedTenant } from "../test/fixtures.js";

const suite = useVenueDb({
  migrations: [CORE_MIGRATIONS],
  setup: (db) => FakeFiscalBackend.install(db),
  timeoutMs: 60_000,
});

const clock: TrustedClock = {
  now: () => ({
    instant: new Date("2026-03-01T13:05:00+01:00"),
    offsetMinutes: 60,
    confident: true,
    confidence: "anchored",
    anchorAgeSeconds: 0,
  }),
  anchor: () => {
    throw new Error("not used");
  },
  currentAnchor: () => null,
};

type InvoiceLine = [rate: string, quantity: string, base: string, gross: string | undefined];

// The invoice: 10% 10.00/1.00; 21% 12.00/2.52.
const INVOICE: InvoiceLine[] = [
  ["10.00", "2", "10.00", "11.00"],
  ["21.00", "1", "10.00", "12.10"],
  ["21.00", "1", "1.00", "1.21"],
  ["21.00", "1", "1.00", undefined],
];

interface Invoice {
  saleId: SaleId;
  lineIds: string[];
}

let backend: FakeFiscalBackend;
let deviceId: DeviceId;
let nodeId: NodeId;
let seriesId: SeriesId;
let rectSeriesId: SeriesId;
let sessionId: string;
let staffSessionId: string;
let invoice: Invoice;

beforeEach(async () => {
  let locationId: string;
  ({ locationId, deviceId, nodeId, seriesId } = await seedTenant(suite.db));
  rectSeriesId = await seedRectificativeSeries(suite.db, nodeId);
  const till = (await seedDevice(suite.db, {})).deviceId;
  const openSession = async (role: "staff" | "supervisor") => {
    const [person] = await suite.db
      .insert(persons)
      .values({ displayName: `P ${role}`, pinHash: hashPin("1234"), role })
      .returning({ id: persons.id });
    return (
      await withTransaction(suite.db, (tx) =>
        loginWithPin(tx, { deviceId: till, personId: person!.id, pin: "1234" }),
      )
    ).id;
  };
  sessionId = await openSession("supervisor");
  staffSessionId = await openSession("staff");
  backend = new FakeFiscalBackend(suite.db);
  await withTransaction(suite.db, (tx) => backend.registerNode(tx, nodeId));
  invoice = await sell("25.52", INVOICE);
});

/** Sells `lines`, with `split` as the stored breakdown when given, else the derived one. */
async function sell(
  total: string,
  lines: InvoiceLine[],
  split?: [rate: string, base: string, tax: string][],
): Promise<Invoice> {
  const { saleId } = await withTransaction(suite.db, (tx) =>
    recordSale(tx, backend, {
      origin: deviceOrigin(deviceId),
      nodeId,
      seriesId,
      locale: "es-ES",
      invoiceLocales: ["es-ES"],
      total,
      lines: lines.map(([vatRate, quantity, base, gross], index) => ({
        lineNo: index + 1,
        name: `Dish ${index + 1}`,
        descriptions: { "es-ES": `Dish ${index + 1}` },
        quantity,
        unitPrice: "5.00",
        vatRate,
        lineTotal: base,
        lineGross: gross ?? null,
      })),
      ...(split === undefined
        ? {}
        : {
            vatBreakdown: split.map(([rate, base, tax]) => ({
              rate: decimal(rate),
              base: decimal(base),
              tax: decimal(tax),
            })),
          }),
      settlement: {
        kind: "immediate",
        tenders: [
          { method: "cash", amount: total, tipAmount: "0", settledAt: clock.now().instant },
        ],
      },
      clock,
    }),
  );
  const rows = await suite.db
    .select({ id: saleLines.id })
    .from(saleLines)
    .where(eq(saleLines.saleId, saleId))
    .orderBy(saleLines.lineNo);
  return { saleId, lineIds: rows.map((row) => row.id) };
}

async function rectSeriesNext(): Promise<number | undefined> {
  const [series] = await suite.db
    .select({ n: invoiceSeries.nextNumber })
    .from(invoiceSeries)
    .where(eq(invoiceSeries.id, rectSeriesId));
  return series?.n;
}

interface Draft {
  total: string;
  lines: (Omit<RecordSaleLine, "correctsLineId"> & { corrects?: number })[];
  split: [rate: string, base: string, tax: string][];
  wholeInvoice?: true;
}

function line(
  lineNo: number,
  corrects: number | undefined,
  rate: string,
  base: string,
  gross?: string,
) {
  return {
    lineNo,
    name: `Credit ${lineNo}`,
    descriptions: { "es-ES": `Credit ${lineNo}` },
    quantity: "-1",
    unitPrice: "5.00",
    vatRate: rate,
    lineTotal: base,
    ...(gross === undefined ? {} : { lineGross: gross }),
    corrects,
  };
}

/** Slice 1's mixed-rate split: €2 off line 1 (10%) and line 2 (21%). */
function passing(): Draft {
  return {
    total: "-2.00",
    lines: [line(1, 0, "10.00", "-0.86", "-0.95"), line(2, 1, "21.00", "-0.87", "-1.05")],
    split: [
      ["10.00", "-0.86", "-0.09"],
      ["21.00", "-0.87", "-0.18"],
    ],
  };
}

interface Target {
  to?: Invoice;
  correctsSaleId?: SaleId;
  sessionId?: string;
}

/** Files `draft` against `invoice` unless told otherwise; an empty split takes the derived path. */
function file(draft: Draft, target: Target = {}) {
  const to = target.to ?? invoice;
  return withTransaction(suite.db, (tx) =>
    recordCorrection(tx, backend, {
      origin: deviceOrigin(deviceId),
      nodeId,
      seriesId: rectSeriesId,
      correctsSaleId: target.correctsSaleId ?? to.saleId,
      total: draft.total,
      lines: draft.lines.map(({ corrects, ...rest }) => ({
        ...rest,
        correctsLineId: corrects === undefined ? undefined : to.lineIds[corrects],
      })),
      ...(draft.split.length === 0
        ? {}
        : {
            partialVatBreakdown: draft.split.map(
              ([rate, base, tax]) => ({ rate, base, tax }) as VatBreakdownLine,
            ),
          }),
      ...(draft.wholeInvoice ? { wholeInvoice: true } : {}),
      authz: { sessionId: target.sessionId ?? sessionId },
      clock,
    }),
  );
}

/** Refused with `code`, with nothing handed to the backend and no number taken. */
async function expectRefused(code: string, draft: Draft, target?: Target) {
  const spy = vi.spyOn(backend, "recordCorrection");
  const next = await rectSeriesNext();
  const error = await captureError(() => file(draft, target));
  expect(error).toMatchObject({ code });
  expect(spy).not.toHaveBeenCalled();
  expect(await rectSeriesNext()).toBe(next);
}

// Corrections already filed against the invoice before the case's own.
const EARLIER = {
  // All of line 3's €1.21 (21%), filed exactly.
  line3Whole: () =>
    file({
      total: "-1.21",
      lines: [line(1, 2, "21.00", "-1.00", "-1.21")],
      split: [["21.00", "-1.00", "-0.21"]],
    }),
  // €10.45 at 10% through the derived path, naming no line.
  unnamedAt10: () =>
    file({ total: "-10.45", lines: [line(1, undefined, "10.00", "-9.50")], split: [] }),
  // €1.10 off line 1 through the derived path, with no gross stored.
  line1NoGross: () => file({ total: "-1.10", lines: [line(1, 0, "10.00", "-1.00")], split: [] }),
  // The same, then another €1.10 off line 1 with its gross stored.
  line1NoGrossThenGross: async () => {
    await file({ total: "-1.10", lines: [line(1, 0, "10.00", "-1.00")], split: [] });
    await file({ total: "-1.10", lines: [line(1, 0, "10.00", "-1.00", "-1.10")], split: [] });
  },
};

const UNUSABLE = "sale.correction_history_unusable";

type Case = [
  name: string,
  change: (draft: Draft) => void,
  earlier?: keyof typeof EARLIER,
  code?: typeof UNUSABLE,
];

const at = (draft: Draft, index: number) => draft.lines[index]!;

/** Both 21% lines of `passing` taken from invoice line `second` at one rate. */
const twoAt21 =
  (second: number) =>
  (d: Draft): void =>
    void d.lines.splice(
      1,
      1,
      line(2, 1, "21.00", "-0.41", "-0.50"),
      line(3, second, "21.00", "-0.46", "-0.55"),
    );

const REFUSED: Case[] = [
  ["a total past the cent", (d) => void (d.total = "-2.001")],
  ["a line gross past the cent", (d) => void (at(d, 0).lineGross = "-0.951")],
  ["a tax past the cent", (d) => void (d.split[0]![2] = "-0.091")],
  ["a unit price past the cent", (d) => void (at(d, 0).unitPrice = "5.001")],
  ["a total of zero", (d) => void (d.total = "0.00")],
  ["a positive total", (d) => void (d.total = "2.00")],
  ["a line gross of zero", (d) => void (at(d, 0).lineGross = "0.00")],
  ["a positive line gross", (d) => void (at(d, 0).lineGross = "0.95")],
  ["a positive line base", (d) => void (at(d, 0).lineTotal = "0.86")],
  ["a line base past its gross", (d) => void (at(d, 0).lineTotal = "-0.96")],
  ["a positive group base", (d) => void (d.split[0]![1] = "0.86")],
  ["a positive group tax", (d) => void (d.split[0]![2] = "0.09")],
  ["a rate below zero", (d) => void (d.split[0]![0] = "-1.00")],
  ["a rate above 100", (d) => void (d.split[0]![0] = "100.01")],
  ["a rate past two places", (d) => void (d.split[0]![0] = "10.001")],
  ["a rate that is not a number", (d) => void (d.split[0]![0] = "ten")],
  ["a total that is not the split's sum", (d) => void (d.total = "-2.01")],
  ["a group base that is not its lines'", (d) => void (d.split[1] = ["21.00", "-0.86", "-0.19"])],
  ["a line base that is not its group's", (d) => void (at(d, 1).lineTotal = "-0.86")],
  ["a group gross that is not its lines'", (d) => void (at(d, 1).lineGross = "-1.04")],
  ["a rate given twice", (d) => void d.split.push(["21.00", "-0.87", "-0.18"])],
  ["a rate with no lines", (d) => void d.split.push(["4.00", "0.00", "0.00"])],
  ["lines at a rate the split omits", (d) => void ((d.split = [d.split[1]!]), (d.total = "-1.05"))],
  ["no lines", (d) => void (d.lines = [])],
  ["a line naming no invoice line", (d) => void delete at(d, 0).corrects],
  ["the same invoice line twice, at another rate", (d) => void (at(d, 1).corrects = 0)],
  ["the same invoice line twice, at its rate", twoAt21(1)],
  ["a duplicate line number", (d) => void (at(d, 1).lineNo = 1)],
  ["a line number of zero", (d) => void (at(d, 0).lineNo = 0)],
  ["a line with no gross", (d) => void delete at(d, 0).lineGross],
  ["a negative unit price", (d) => void (at(d, 0).unitPrice = "-5.00")],
  ["a price quantity of zero", (d) => void (at(d, 0).priceQuantity = "0")],
  ["a negative price quantity", (d) => void (at(d, 0).priceQuantity = "-1")],
  ["a quantity of zero", (d) => void (at(d, 0).quantity = "0")],
  ["a positive quantity", (d) => void (at(d, 0).quantity = "1")],
  ["a quantity past three places", (d) => void (at(d, 0).quantity = "-1.0001")],
  ["the field with wholeInvoice", (d) => void (d.wholeInvoice = true)],
  ["a quantity above the invoice line's", (d) => void (at(d, 0).quantity = "-3")],
  ["a line at a rate its invoice line is not", (d) => void (at(d, 0).corrects = 2)],
  [
    "an invoice line with no stored gross",
    (d) => void (at(d, 1).corrects = 3),
    undefined,
    UNUSABLE,
  ],
  [
    "a base one cent above the rule",
    (d) => void ((d.split[1] = ["21.00", "-0.88", "-0.17"]), (at(d, 1).lineTotal = "-0.88")),
  ],
  [
    "a base one cent below the rule",
    (d) => void ((d.split[1] = ["21.00", "-0.86", "-0.19"]), (at(d, 1).lineTotal = "-0.86")),
  ],
  [
    "a line's running gross past its invoice line's",
    (d) => void (at(d, 1).corrects = 2),
    "line3Whole",
  ],
  [
    "a rate an earlier correction took from without naming a line",
    () => undefined,
    "unnamedAt10",
    UNUSABLE,
  ],
  [
    "an earlier correction of the line with no stored gross",
    () => undefined,
    "line1NoGross",
    UNUSABLE,
  ],
  [
    "an earlier correction of the line with no stored gross, filed before one with it",
    () => undefined,
    "line1NoGrossThenGross",
    UNUSABLE,
  ],
];

it.each([
  ["the passing split", () => undefined, undefined],
  [
    "after line 3 was wholly corrected, the same cents from line 2, which has room",
    () => undefined,
    "line3Whole",
  ],
  ["two lines at one rate, each naming its own invoice line", twoAt21(2), undefined],
  [
    "a 21% split after an earlier correction named no line at 10% only",
    (d: Draft): void =>
      void ((d.total = "-1.05"),
      (d.lines = [line(1, 1, "21.00", "-0.87", "-1.05")]),
      (d.split = [["21.00", "-0.87", "-0.18"]])),
    "unnamedAt10",
  ],
] as const)("files %s as given", async (_name, change, earlier) => {
  if (earlier) await EARLIER[earlier]();
  const spy = vi.spyOn(backend, "recordCorrection");
  const draft = passing();
  change(draft);
  await file(draft);
  expect(spy).toHaveBeenCalledOnce();
  expect(spy.mock.calls[0]![1].vatBreakdown).toEqual(
    draft.split.map(([rate, base, tax]) => ({ rate, base, tax })),
  );
});

it.each(REFUSED)("refuses %s before the backend files", async (_name, change, earlier, code) => {
  if (earlier) await EARLIER[earlier]();
  const draft = passing();
  change(draft);
  await expectRefused(code ?? "sale.correction_breakdown_invalid", draft);
});

/** All of the first line's €12.10 at 21%, filed exactly. */
const firstWhole = (): Draft => ({
  total: "-12.10",
  lines: [line(1, 0, "21.00", "-10.00", "-12.10")],
  split: [["21.00", "-10.00", "-2.10"]],
});

it.each([
  ["named no line, refuses the first", undefined, 0, UNUSABLE],
  ["named the first, refuses the first", 0, 0, "sale.correction_breakdown_invalid"],
  ["named the first, files the second", 0, 1, undefined],
] as const)(
  "after a legacy correction of one of two identical €12.10 lines that %s",
  async (_name, earlierNames, takes, code) => {
    const twins = await sell("24.20", [
      ["21.00", "1", "10.00", "12.10"],
      ["21.00", "1", "10.00", "12.10"],
    ]);
    await file(
      { total: "-12.10", lines: [line(1, earlierNames, "21.00", "-10.00", "-12.10")], split: [] },
      { to: twins },
    );
    const draft = firstWhole();
    at(draft, 0).corrects = takes;
    if (code !== undefined) return expectRefused(code, draft, { to: twins });
    const spy = vi.spyOn(backend, "recordCorrection");
    await file(draft, { to: twins });
    expect(spy.mock.calls[0]![1].vatBreakdown).toEqual([
      { rate: "21.00", base: "-10.00", tax: "-2.10" },
    ]);
  },
);

it.each([
  ["no group at the line's rate", [["10.00", "10.00", "2.10"]]],
  [
    "two groups at the line's rate",
    [
      ["21.00", "5.00", "1.05"],
      ["21.00", "5.00", "1.05"],
    ],
  ],
] as const)(
  "refuses a split of an invoice whose stored breakdown has %s",
  async (_name, stored) => {
    const odd = await sell(
      "12.10",
      [["21.00", "1", "10.00", "12.10"]],
      stored.map((group) => [...group]),
    );
    await expectRefused(
      UNUSABLE,
      {
        total: "-1.21",
        lines: [line(1, 0, "21.00", "-1.00", "-1.21")],
        split: [["21.00", "-1.00", "-0.21"]],
      },
      { to: odd },
    );
  },
);

// Two 21% lines of 0.03 that each round up to 0.04, while their group's tax rounds down: 0.07.
it("refuses a rate's gross past the invoice's when each line is within its own", async () => {
  const rounded = await sell("11.07", [
    ["21.00", "1", "0.03", "0.04"],
    ["21.00", "1", "0.03", "0.04"],
    ["10.00", "1", "10.00", "11.00"],
  ]);
  expect(
    (
      await suite.db
        .select({ split: sales.vatBreakdown })
        .from(sales)
        .where(eq(sales.id, rounded.saleId))
    )[0]!.split,
  ).toContainEqual({ rate: "21.00", base: "0.06", tax: "0.01" });
  await expectRefused(
    "sale.correction_breakdown_invalid",
    {
      total: "-0.08",
      lines: [line(1, 0, "21.00", "-0.03", "-0.04"), line(2, 1, "21.00", "-0.04", "-0.04")],
      split: [["21.00", "-0.07", "-0.01"]],
    },
    { to: rounded },
  );
});

it("refuses a rate's running gross past the invoice's after an earlier exact correction", async () => {
  const rounded = await sell("11.07", [
    ["21.00", "1", "0.03", "0.04"],
    ["21.00", "1", "0.03", "0.04"],
    ["10.00", "1", "10.00", "11.00"],
  ]);
  await file(
    {
      total: "-0.04",
      lines: [line(1, 0, "21.00", "-0.03", "-0.04")],
      split: [["21.00", "-0.03", "-0.01"]],
    },
    { to: rounded },
  );
  await expectRefused(
    "sale.correction_breakdown_invalid",
    {
      total: "-0.04",
      lines: [line(1, 1, "21.00", "-0.04", "-0.04")],
      split: [["21.00", "-0.04", "0.00"]],
    },
    { to: rounded },
  );
});

it("answers a session that may not correct with the permission refusal, not the history's", async () => {
  const draft = passing();
  draft.split[1] = ["21.00", "-0.88", "-0.17"];
  at(draft, 1).lineTotal = "-0.88";
  await expectRefused("authorization.not_permitted", draft, { sessionId: staffSessionId });
});

it("refuses a split that disagrees with its own lines before looking for the sale", async () => {
  const draft = passing();
  draft.total = "-2.01";
  await expectRefused("sale.correction_breakdown_invalid", draft, {
    correctsSaleId: "00000000-0000-4000-8000-000000000000" as SaleId,
  });
});
