import { beforeEach, expect, it } from "vitest";
import { decimal, deviceOrigin, saleId as brandSaleId } from "@waitron/shared";
import type { DeviceId, NodeId, SaleId, SeriesId } from "@waitron/shared";
import { FakeFiscalBackend } from "@waitron/fiscal/src/testing/fake-backend.js";
import type { FiledFigures, FiscalBackend, TrustedClock } from "@waitron/fiscal";
import {
  CORE_MIGRATIONS,
  captureError,
  newId,
  saleLines,
  sales,
  saleSubstitutions,
  withTransaction,
} from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { seedDevice } from "@waitron/db/testing/seed.js";
import { hashPin, loginWithPin, persons } from "@waitron/identity";
import { eq } from "drizzle-orm";
import {
  correctionLinesFor,
  previewCorrectionAmounts,
  readCorrectionAmountHistory,
} from "./correction-history.js";
import type { CorrectionAmountAllocation } from "./correction-allocation.js";
import { recordCorrection, type RecordCorrectionInput } from "./record-correction.js";
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

const OPTION = {
  listName: { "es-ES": "Side" },
  listCustomerName: null,
  listKitchenName: null,
  labelName: { "es-ES": "Salad" },
  labelCustomerName: null,
  labelKitchenName: "SAL",
};

// 10%: rice 10.00/11.00 and its sauce, an extra on the steak, 1.00/1.10; 21%: steak 10.00/12.10.
function invoiceLines(): RecordSaleLine[] {
  return [
    {
      lineNo: 1,
      name: "Rice",
      descriptions: { "es-ES": "Rice bowl" },
      unitName: { "es-ES": "kg" },
      unitPrecision: 3,
      quantity: "2.500",
      priceQuantity: "0.500",
      unitPrice: "2.00",
      vatRate: "10.00",
      lineTotal: "10.00",
      lineGross: "11.00",
      optionSnapshots: [OPTION],
      variantName: "Large",
      variantDescriptions: { "es-ES": "Large bowl" },
      variantKitchenName: "LG",
      category: "Mains",
      kitchenName: "RICE",
      productId: "product-rice-large",
      parentProductId: "product-rice",
      menuId: "menu-1",
      menuVersionId: "menu-1-v2",
      listGross: "11.00",
      listUnitPriceGross: "2.20",
      classification: { reporting: [{ id: "food", name: "Food" }] },
    },
    {
      lineNo: 2,
      name: "Steak",
      descriptions: { "es-ES": "Steak" },
      quantity: "1",
      unitPrice: "10.00",
      vatRate: "21.00",
      lineTotal: "10.00",
      lineGross: "12.10",
    },
    {
      lineNo: 3,
      name: "Sauce",
      descriptions: { "es-ES": "Sauce" },
      quantity: "1",
      unitPrice: "1.00",
      vatRate: "10.00",
      lineTotal: "1.00",
      lineGross: "1.10",
      parentLineNo: 2,
    },
  ];
}

let backend: FakeFiscalBackend;
let deviceId: DeviceId;
let nodeId: NodeId;
let seriesId: SeriesId;
let rectSeriesId: SeriesId;
let sessionId: string;

beforeEach(async () => {
  let locationId: string;
  ({ locationId, deviceId, nodeId, seriesId } = await seedTenant(suite.db));
  rectSeriesId = await seedRectificativeSeries(suite.db, nodeId);
  const till = (await seedDevice(suite.db, { locationId })).deviceId;
  const [person] = await suite.db
    .insert(persons)
    .values({ displayName: "Supervisor", pinHash: hashPin("1234"), role: "supervisor" })
    .returning({ id: persons.id });
  sessionId = (
    await withTransaction(suite.db, (tx) =>
      loginWithPin(tx, { deviceId: till, personId: person!.id, pin: "1234" }),
    )
  ).id;
  backend = new FakeFiscalBackend(suite.db);
  await withTransaction(suite.db, (tx) => backend.registerNode(tx, nodeId));
});

async function sell(lines = invoiceLines(), total = "24.20") {
  const { saleId } = await withTransaction(suite.db, (tx) =>
    recordSale(tx, backend, {
      origin: deviceOrigin(deviceId),
      nodeId,
      seriesId,
      locale: "es-ES",
      invoiceLocales: ["es-ES"],
      total,
      lines,
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
    .select()
    .from(saleLines)
    .where(eq(saleLines.saleId, saleId))
    .orderBy(saleLines.lineNo);
  return { saleId, rows, ids: rows.map((row) => row.id) };
}

function correctionInput(
  saleId: SaleId,
  total: string,
  lines: RecordSaleLine[],
  how: { wholeInvoice?: true } = {},
): RecordCorrectionInput {
  return {
    origin: deviceOrigin(deviceId),
    nodeId,
    seriesId: rectSeriesId,
    correctsSaleId: saleId,
    total,
    lines,
    ...how,
    authz: { sessionId },
    clock,
  };
}

function correct(...args: Parameters<typeof correctionInput>) {
  return withTransaction(suite.db, (tx) => recordCorrection(tx, backend, correctionInput(...args)));
}

type StoredSplit = (typeof sales.$inferSelect)["vatBreakdown"];

/** Stores what `correct` would, but with `split` as the correction's stored split. */
async function correctStoring(split: StoredSplit, ...args: Parameters<typeof correctionInput>) {
  const rollBack = new Error("roll back");
  let written: { sale: typeof sales.$inferSelect; lines: (typeof saleLines.$inferSelect)[] };
  const error = await captureError(() =>
    withTransaction(suite.db, async (tx) => {
      const { saleId } = await recordCorrection(tx, backend, correctionInput(...args));
      const [sale] = await tx.select().from(sales).where(eq(sales.id, saleId));
      written = {
        sale: sale!,
        lines: await tx.select().from(saleLines).where(eq(saleLines.saleId, saleId)),
      };
      throw rollBack;
    }),
  );
  expect(error).toBe(rollBack);
  await suite.db.insert(sales).values({ ...written!.sale, vatBreakdown: split });
  await suite.db.insert(saleLines).values(written!.lines);
  return { saleId: brandSaleId(written!.sale.id) };
}

function read(saleId: SaleId) {
  return withTransaction(suite.db, (tx) => readCorrectionAmountHistory(tx, saleId));
}

const BREAKDOWN = [
  { rate: "10.00", base: "11.00", tax: "1.10" },
  { rate: "21.00", base: "10.00", tax: "2.10" },
];

it("reads every invoice line, extras included, its stored split and nothing consumed", async () => {
  const { saleId, ids } = await sell();

  expect(await read(saleId)).toEqual({
    lines: [
      { id: ids[0], lineNo: 1, rate: "10.00", gross: "11.00", base: "10.00" },
      { id: ids[1], lineNo: 2, rate: "21.00", gross: "12.10", base: "10.00" },
      { id: ids[2], lineNo: 3, rate: "10.00", gross: "1.10", base: "1.00" },
    ],
    vatBreakdown: BREAKDOWN,
    consumed: [],
  });
});

// An earlier correction filed through the derived path: €1.05 off the steak, its split derived
// from its lines (21%: -0.87/-0.18). Each case changes one fact of it, or of the invoice.
interface Change {
  invoiceGross?: null;
  correctionLines?: [lineTotal: string, lineGross: string | null][];
  namesLine?: false;
  readCorrection?: true;
  readUnknown?: true;
  storedSplit?: StoredSplit;
}

async function history(change: Change) {
  const lines = invoiceLines();
  if (change.invoiceGross === null) lines[0]!.lineGross = null;
  const { saleId, ids } = await sell(lines);
  const write = (...args: Parameters<typeof correct>) =>
    change.storedSplit ? correctStoring(change.storedSplit, ...args) : correct(...args);
  const correction = await write(
    saleId,
    "-1.05",
    (change.correctionLines ?? [["-0.87", "-1.05"]]).map(([lineTotal, lineGross], index) => ({
      lineNo: index + 1,
      name: "Steak",
      descriptions: { "es-ES": "Steak" },
      quantity: "-1",
      unitPrice: "10.00",
      vatRate: "21.00",
      lineTotal,
      lineGross,
      correctsLineId: change.namesLine === false ? null : ids[1],
    })),
  );
  const target = change.readUnknown
    ? brandSaleId(newId())
    : change.readCorrection
      ? correction.saleId
      : saleId;
  return { target, ids, result: () => read(target) };
}

it("reads an earlier derived-path correction whose split agrees with its lines", async () => {
  const { ids, result } = await history({});

  expect((await result()).consumed).toEqual([
    { saleLineId: ids[1], rate: "21.00", gross: "1.05", base: "0.87", tax: "0.18" },
  ]);
});

it.each<[name: string, change: Change, code: string]>([
  ["an unknown sale", { readUnknown: true }, "sale.not_found"],
  ["a corrective invoice's own id", { readCorrection: true }, "sale.correction_history_unusable"],
  ["an invoice line with no gross", { invoiceGross: null }, "sale.correction_history_unusable"],
  [
    "an earlier correction line with no gross, its correction's split agreeing with the rest",
    {
      correctionLines: [
        ["-0.50", null],
        ["-0.37", "-1.05"],
      ],
    },
    "sale.correction_history_unusable",
  ],
  [
    "an earlier correction line naming no invoice line",
    { namesLine: false },
    "sale.correction_history_unusable",
  ],
  [
    "an earlier correction whose lines disagree with its stored split",
    { correctionLines: [["-0.87", "-1.06"]] },
    "sale.correction_history_unusable",
  ],
  [
    "an earlier correction's stored split at a rate with no lines",
    {
      storedSplit: [
        { rate: "21.00", base: "-0.87", tax: "-0.18" },
        { rate: "10.00", base: "0.00", tax: "0.00" },
      ],
    },
    "sale.correction_history_unusable",
  ],
  [
    "an earlier correction's stored split leaving out its lines' rate",
    { storedSplit: [] },
    "sale.correction_history_unusable",
  ],
  [
    "an earlier correction's stored base that is not its lines', at their gross",
    { storedSplit: [{ rate: "21.00", base: "-0.86", tax: "-0.19" }] },
    "sale.correction_history_unusable",
  ],
])("refuses %s", async (_name, change, code) => {
  const { result } = await history(change);

  expect(await captureError(result)).toMatchObject({ code });
});

it("builds correction lines carrying the invoice line's frozen facts, negated", async () => {
  const { rows, ids } = await sell();
  const lines = correctionLinesFor(rows, [
    {
      saleLineId: ids[0]!,
      rate: decimal("10.00"),
      gross: decimal("0.55"),
      base: decimal("0.50"),
      tax: decimal("0.05"),
    },
  ]);

  expect(lines).toEqual([
    {
      lineNo: 1,
      name: "Rice",
      descriptions: { "es-ES": "Rice bowl" },
      unitName: { "es-ES": "kg" },
      unitPrecision: 3,
      quantity: "-2.500",
      priceQuantity: "0.500",
      unitPrice: "2.00",
      vatRate: "10.00",
      lineTotal: "-0.50",
      lineGross: "-0.55",
      optionSnapshots: [OPTION],
      variantName: "Large",
      variantDescriptions: { "es-ES": "Large bowl" },
      variantKitchenName: "LG",
      category: "Mains",
      kitchenName: "RICE",
      productId: "product-rice-large",
      parentProductId: "product-rice",
      menuId: "menu-1",
      menuVersionId: "menu-1-v2",
      listGross: null,
      listUnitPriceGross: "2.20",
      classification: { reporting: [{ id: "food", name: "Food" }] },
      parentLineNo: null,
      correctsLineId: ids[0],
    },
  ]);
});

it("numbers built lines in allocation order, keeping an extra's rate and its corrected dish", async () => {
  const { rows, ids } = await sell();
  const sauce: CorrectionAmountAllocation = {
    saleLineId: ids[2]!,
    rate: decimal("10.00"),
    gross: decimal("1.10"),
    base: decimal("1.00"),
    tax: decimal("0.10"),
  };
  const lines = correctionLinesFor(rows, [
    {
      saleLineId: ids[1]!,
      rate: decimal("21.00"),
      gross: decimal("1.21"),
      base: decimal("1.00"),
      tax: decimal("0.21"),
    },
    sauce,
  ]);

  expect(
    lines.map(({ lineNo, name, vatRate, parentLineNo, correctsLineId }) => [
      lineNo,
      name,
      vatRate,
      parentLineNo,
      correctsLineId,
    ]),
  ).toEqual([
    [1, "Steak", "21.00", null, ids[1]],
    [2, "Sauce", "10.00", 1, ids[2]],
  ]);
  expect(correctionLinesFor(rows, [sauce])[0]!.parentLineNo).toBeNull();
});

function preview(saleId: SaleId, of = backend as FiscalBackend) {
  return withTransaction(suite.db, (tx) =>
    previewCorrectionAmounts(tx, of, saleId, nodeId, { gross: decimal("6.05") }),
  );
}

async function sellSteak() {
  return sell([{ ...invoiceLines()[1]!, lineNo: 1 }], "12.10");
}

it("previews an admitted correction with the admission's filing and the lines to file", async () => {
  const { saleId, ids } = await sellSteak();

  expect(await preview(saleId)).toMatchObject({
    gross: "6.05",
    vatBreakdown: [{ rate: "21.00", base: "5.00", tax: "1.05" }],
    filing: "accepted",
    original: { number: "T1-1", issuedAt: "2027-03-14" },
    lines: [{ name: "Steak", lineTotal: "-5.00", lineGross: "-6.05", correctsLineId: ids[0] }],
  });
});

it("refuses every invoice when the regime cannot answer", async () => {
  const { saleId } = await sellSteak();
  const unanswering = new Proxy<FiscalBackend>(backend, {
    get: (target, key, receiver) =>
      key === "correctionAdmissionFor" ? undefined : Reflect.get(target, key, receiver),
  });

  expect(await captureError(() => preview(saleId, unanswering))).toMatchObject({
    code: "sale.correction_not_admitted",
    params: { reason: "unsupported" },
  });
});

it("refuses a substituted invoice as replaced before asking the regime", async () => {
  const { saleId } = await sellSteak();
  const substitute = await sellSteak();
  await suite.db
    .insert(saleSubstitutions)
    .values({ substitutionSaleId: substitute.saleId, substitutedSaleId: saleId });
  backend.setCorrectionAdmission({ eligible: false, reason: "filing_refused" });

  expect(await captureError(() => preview(saleId))).toMatchObject({
    code: "sale.correction_not_admitted",
    params: { reason: "replaced" },
  });
});

const filed = (total: string, ...split: [rate: string, base: string, tax: string][]) => ({
  readable: true as const,
  newest: {
    total: decimal(total),
    vatBreakdown: split.map(([rate, base, tax]) => ({
      rate: decimal(rate),
      base: decimal(base),
      tax: decimal(tax),
    })),
  },
  newestAnswered: null,
});

it.each<
  [
    name: string,
    moved: (ids: { invoice: SaleId; corrective: SaleId }) => [SaleId, FiledFigures],
    reason: string,
  ]
>([
  [
    "the invoice filed with an extra rate",
    ({ invoice }) => [
      invoice,
      filed("12.10", ["21.00", "10.00", "2.10"], ["10.00", "0.00", "0.00"]),
    ],
    "filed_figures_changed",
  ],
  [
    "the invoice's base and VAT moved at its rate",
    ({ invoice }) => [invoice, filed("12.10", ["21.00", "10.01", "2.09"])],
    "filed_figures_changed",
  ],
  [
    "the invoice's total alone moved",
    ({ invoice }) => [invoice, filed("12.11", ["21.00", "10.00", "2.10"])],
    "filed_figures_changed",
  ],
  [
    "an earlier corrective's split moved",
    ({ corrective }) => [corrective, filed("-1.05", ["21.00", "-0.88", "-0.17"])],
    "filed_figures_changed",
  ],
  [
    "an earlier corrective unreadable",
    ({ corrective }) => [corrective, { readable: false }],
    "filed_figures_unreadable",
  ],
])("refuses when %s", async (_name, moved, reason) => {
  const { saleId, ids } = await sellSteak();
  const corrective = await correct(saleId, "-1.05", [
    {
      lineNo: 1,
      name: "Steak",
      descriptions: { "es-ES": "Steak" },
      quantity: "-1",
      unitPrice: "10.00",
      vatRate: "21.00",
      lineTotal: "-0.87",
      lineGross: "-1.05",
      correctsLineId: ids[0],
    },
  ]);
  backend.setFiledFigures(...moved({ invoice: saleId, corrective: corrective.saleId }));

  expect(await captureError(() => preview(saleId))).toMatchObject({
    code: "sale.correction_not_admitted",
    params: { reason },
  });
});

it("refuses as unreadable when the regime cannot read its filed figures", async () => {
  const { saleId } = await sellSteak();
  const unreading = new Proxy<FiscalBackend>(backend, {
    get: (target, key, receiver) =>
      key === "filedFiguresFor" ? undefined : Reflect.get(target, key, receiver),
  });

  expect(await captureError(() => preview(saleId, unreading))).toMatchObject({
    code: "sale.correction_not_admitted",
    params: { reason: "filed_figures_unreadable" },
  });
});
