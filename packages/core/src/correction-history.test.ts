import { seedPersons } from "@waitron/identity/test/person-rows.js";
import { beforeEach, expect, it } from "vitest";
import {
  decimal,
  deviceOrigin,
  subtractDecimal,
  sumDecimals,
  saleId as brandSaleId,
  seriesId as brandSeriesId,
} from "@waitron/shared";
import type { DeviceId, NodeId, SaleId, SeriesId } from "@waitron/shared";
import { FakeFiscalBackend } from "@waitron/fiscal/src/testing/fake-backend.js";
import type { FiledFigures, FiscalBackend, TrustedClock } from "@waitron/fiscal";
import {
  CORE_MIGRATIONS,
  captureError,
  invoiceSeries,
  newId,
  saleLines,
  sales,
  saleSubstitutions,
  withTransaction,
} from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { seedDevice } from "@waitron/db/testing/seed.js";
import { hashPin, loginWithPin } from "@waitron/identity";
import { eq, sql } from "drizzle-orm";
import {
  correctionLinesFor,
  previewCorrectionAmounts,
  readCorrectableLines,
  readCorrectionAmountHistory,
} from "./correction-history.js";
import { recordCorrection, type RecordCorrectionInput } from "./record-correction.js";
import { recordReplacement } from "./record-replacement.js";
import { recordSale } from "./record-sale.js";
import type { RecordSaleLine } from "./record-sale.js";
import { seedCorrectiveSeries, seedTaxpayer } from "../test/fixtures.js";

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
  ({ deviceId, nodeId, seriesId } = await seedTaxpayer(suite.db));
  rectSeriesId = await seedCorrectiveSeries(suite.db, nodeId);
  const till = (await seedDevice(suite.db, {})).deviceId;
  const [person] = await seedPersons(suite.db, {
    displayName: "Supervisor",
    pinHash: hashPin("1234"),
    role: "supervisor",
  });
  sessionId = (
    await withTransaction(suite.db, (tx) =>
      loginWithPin(tx, { deviceId: till, personId: person!.id, pin: "1234" }),
    )
  ).id;
  backend = new FakeFiscalBackend(suite.db);
  await withTransaction(suite.db, (tx) => backend.registerNode(tx, nodeId));
});

async function sell(
  lines = invoiceLines(),
  total = "24.20",
  extra: Partial<Parameters<typeof recordSale>[2]> = {},
) {
  const { saleId } = await withTransaction(suite.db, (tx) =>
    recordSale(tx, backend, {
      operationDescription: "Sale on premises",
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
      ...extra,
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
    operationDescription: "Sale on premises",
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

/** A correction line taking `lineGross` off the steak. */
function steakTaken(
  lineNo: number,
  correctsLineId: string | null,
  lineTotal: string,
  lineGross: string | null,
): RecordSaleLine {
  const steak = invoiceLines()[1]!;
  return { ...steak, lineNo, quantity: "-1", lineTotal, lineGross, correctsLineId };
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
    (change.correctionLines ?? [["-0.87", "-1.05"]]).map(([lineTotal, lineGross], index) =>
      steakTaken(index + 1, change.namesLine === false ? null : ids[1]!, lineTotal, lineGross),
    ),
  );
  const target = change.readUnknown
    ? brandSaleId(newId())
    : change.readCorrection
      ? correction.saleId
      : saleId;
  return { target, ids, result: () => read(target) };
}

it("reads every invoice line, extras included, its stored split and what earlier corrections took", async () => {
  const { ids, result } = await history({
    correctionLines: [
      ["-0.50", "-0.61"],
      ["-0.37", "-0.44"],
    ],
  });

  expect(await result()).toEqual({
    lines: [
      { id: ids[0], lineNo: 1, rate: "10.00", gross: "11.00", base: "10.00" },
      { id: ids[1], lineNo: 2, rate: "21.00", gross: "12.10", base: "10.00" },
      { id: ids[2], lineNo: 3, rate: "10.00", gross: "1.10", base: "1.00" },
    ],
    vatBreakdown: BREAKDOWN,
    consumed: [
      { saleLineId: ids[1], rate: "21.00", gross: "0.61", base: "0.50", tax: "0.11" },
      { saleLineId: ids[1], rate: "21.00", gross: "0.44", base: "0.37", tax: "0.07" },
    ],
  });
});

const UNUSABLE = "sale.correction_history_unusable";

it.each<[name: string, change: Change, code: string]>([
  ["an unknown sale", { readUnknown: true }, "sale.not_found"],
  ["a corrective invoice's own id", { readCorrection: true }, UNUSABLE],
  ["an invoice line with no gross", { invoiceGross: null }, UNUSABLE],
  [
    "an earlier correction line with no gross, its correction's split agreeing with the rest",
    {
      correctionLines: [
        ["-0.50", null],
        ["-0.37", "-1.05"],
      ],
    },
    UNUSABLE,
  ],
  ["an earlier correction line naming no invoice line", { namesLine: false }, UNUSABLE],
  [
    "an earlier correction whose lines' gross is not its stored split's",
    { correctionLines: [["-0.87", "-1.06"]] },
    UNUSABLE,
  ],
  [
    "an earlier correction's stored split at a rate with no lines",
    {
      storedSplit: [
        { rate: "21.00", base: "-0.87", tax: "-0.18" },
        { rate: "10.00", base: "0.00", tax: "0.00" },
      ],
    },
    UNUSABLE,
  ],
  [
    "an earlier correction's stored split leaving out its lines' rate",
    { storedSplit: [] },
    UNUSABLE,
  ],
  [
    "an earlier correction's stored base that is not its lines', at their gross",
    { storedSplit: [{ rate: "21.00", base: "-0.86", tax: "-0.19" }] },
    UNUSABLE,
  ],
])("refuses %s", async (_name, change, code) => {
  const { result } = await history(change);

  expect(await captureError(result)).toMatchObject({ code });
});

const allocation = (saleLineId: string, rate: string, gross: string, base: string) => ({
  saleLineId,
  rate: decimal(rate),
  gross: decimal(gross),
  base: decimal(base),
  tax: decimal("0"),
});

it("builds lines in allocation order from the invoice line's frozen facts, negated", async () => {
  const { rows, ids } = await sell();
  const sauce = allocation(ids[2]!, "10.00", "1.10", "1.00");
  const lines = correctionLinesFor(rows, [
    allocation(ids[1]!, "21.00", "1.21", "1.00"),
    sauce,
    allocation(ids[0]!, "10.00", "0.55", "0.50"),
  ]);

  expect(lines.slice(0, 2).map((line) => [line.lineNo, line.name, line.parentLineNo])).toEqual([
    [1, "Steak", null],
    [2, "Sauce", 1],
  ]);
  expect(lines[2]).toEqual({
    lineNo: 3,
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
    advanceRole: null,
    deductsSaleId: null,
    setMenuRole: null,
  });
  expect(correctionLinesFor(rows, [sauce])[0]!.parentLineNo).toBeNull();
});

it("keeps an invoice line's advance role, and a deduction line's sale", async () => {
  const { rows, ids } = await sell();
  const lines = correctionLinesFor(
    [
      { ...rows[0]!, advanceRole: "payment_on_account", deductsSaleId: null },
      { ...rows[1]!, advanceRole: "deduction", deductsSaleId: "advance-sale" },
    ],
    [allocation(ids[0]!, "10.00", "0.55", "0.50"), allocation(ids[1]!, "21.00", "1.21", "1.00")],
  );

  expect(lines.map(({ advanceRole, deductsSaleId }) => ({ advanceRole, deductsSaleId }))).toEqual([
    { advanceRole: "payment_on_account", deductsSaleId: null },
    { advanceRole: "deduction", deductsSaleId: "advance-sale" },
  ]);
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

it("previews a correction of a replaced invoice from its replacement's lines", async () => {
  const { saleId } = await sellSteak();
  const { saleId: replacementId } = await withTransaction(suite.db, (tx) =>
    recordReplacement(tx, backend, {
      operationDescription: "Sale on premises",
      origin: deviceOrigin(deviceId),
      nodeId,
      seriesId: rectSeriesId,
      correctsSaleId: saleId,
      authz: { sessionId },
      clock,
    }),
  );
  const [copy] = await suite.db
    .select({ id: saleLines.id })
    .from(saleLines)
    .where(eq(saleLines.saleId, replacementId));

  expect(await preview(saleId)).toMatchObject({
    gross: "6.05",
    vatBreakdown: [{ rate: "21.00", base: "5.00", tax: "1.05" }],
    lines: [{ lineTotal: "-5.00", lineGross: "-6.05", correctsLineId: copy!.id }],
  });
});

it("refuses an invoice with a named customer, as the writer does", async () => {
  const [full] = await suite.db
    .insert(invoiceSeries)
    .values({ nodeId, code: "F", purpose: "full" })
    .returning({ id: invoiceSeries.id });
  suite.db.run(
    sql`update taxpayer set taxpayer_domicile = 'Calle Fiscal 8, 28001 Madrid' where id = 1`,
  );
  const { saleId } = await sell([{ ...invoiceLines()[1]!, lineNo: 1 }], "12.10", {
    seriesId: brandSeriesId(full!.id),
    counterparty: { taxId: "12345678Z", legalName: "Ana Garcia", countryCode: "ES" },
    recipientAddress: "Calle Mayor 2, 28013 Madrid, Spain",
  });
  backend.setFiledFigures(saleId, { readable: false });

  expect(await captureError(() => preview(saleId))).toMatchObject({
    code: "sale.correction_unsupported",
    params: { saleId },
  });
});

it.each([
  ["correctionAdmissionFor", "unsupported"],
  ["filedFiguresFor", "filed_figures_unreadable"],
])("refuses every invoice when the regime has no %s", async (member, reason) => {
  const { saleId } = await sellSteak();
  const lacking = new Proxy<FiscalBackend>(backend, {
    get: (target, key, receiver) =>
      key === member ? undefined : Reflect.get(target, key, receiver),
  });

  expect(await captureError(() => preview(saleId, lacking))).toMatchObject({
    code: "sale.correction_not_admitted",
    params: { reason },
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

it("refuses a replaced invoice that was also exchanged for a full invoice, as replaced", async () => {
  const { saleId } = await sellSteak();
  await withTransaction(suite.db, (tx) =>
    recordReplacement(tx, backend, {
      operationDescription: "Sale on premises",
      origin: deviceOrigin(deviceId),
      nodeId,
      seriesId: rectSeriesId,
      correctsSaleId: saleId,
      authz: { sessionId },
      clock,
    }),
  );
  // Written directly: `recordSubstitution` refuses a replaced ticket, so this is the history
  // check's own refusal.
  const substitute = await sellSteak();
  await suite.db
    .insert(saleSubstitutions)
    .values({ substitutionSaleId: substitute.saleId, substitutedSaleId: saleId });

  expect(await captureError(() => preview(saleId))).toMatchObject({
    code: "sale.correction_not_admitted",
    params: { reason: "replaced" },
  });
});

const filed = (total: string, ...split: (readonly [string, string, string])[]) => ({
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
const AT_21 = ["21.00", "10.00", "2.10"] as const;
const CHANGED = "filed_figures_changed";

it.each<[name: string, whose: "invoice" | "corrective", figures: FiledFigures, reason: string]>([
  ["an extra rate", "invoice", filed("12.10", AT_21, ["10.00", "0.00", "0.00"]), CHANGED],
  ["another base and VAT", "invoice", filed("12.10", ["21.00", "10.01", "2.09"]), CHANGED],
  ["another total alone", "invoice", filed("12.11", AT_21), CHANGED],
  ["another split", "corrective", filed("-1.05", ["21.00", "-0.88", "-0.17"]), CHANGED],
  ["nothing readable", "corrective", { readable: false }, "filed_figures_unreadable"],
])("refuses when the filed figures show %s for the %s", async (_name, whose, figures, reason) => {
  const { saleId, ids } = await sellSteak();
  const corrective = await correct(saleId, "-1.05", [steakTaken(1, ids[0]!, "-0.87", "-1.05")]);
  backend.setFiledFigures(whose === "invoice" ? saleId : corrective.saleId, figures);

  expect(await captureError(() => preview(saleId))).toMatchObject({
    code: "sale.correction_not_admitted",
    params: { reason },
  });
});

it("reads each invoice line with what earlier corrections left of it, refusing as the preview does", async () => {
  const { saleId, ids } = await sell();
  await correct(saleId, "-1.05", [steakTaken(1, ids[1]!, "-0.87", "-1.05")]);
  const lines = (of = backend as FiscalBackend) =>
    withTransaction(suite.db, (tx) => readCorrectableLines(tx, of, saleId, nodeId));

  expect(await lines()).toEqual([
    {
      id: ids[0],
      descriptions: { "es-ES": "Rice bowl" },
      rate: "10.00",
      gross: "11.00",
      left: "11.00",
    },
    {
      id: ids[1],
      descriptions: { "es-ES": "Steak" },
      rate: "21.00",
      gross: "12.10",
      left: "11.05",
    },
    {
      id: ids[2],
      descriptions: { "es-ES": "Sauce" },
      rate: "10.00",
      gross: "1.10",
      left: "1.10",
    },
  ]);
  backend.setCorrectionAdmission({ eligible: false, reason: "voided" });
  expect(await captureError(() => lines())).toMatchObject({
    code: "sale.correction_not_admitted",
    params: { reason: "voided" },
  });
});

// The rest's invoice of a bill whose advances it takes off (advances plan, examples 1, 2 and 8).
type Dish = [rate: string, base: string, gross: string];

/** Sells an advance of `gross` at `rate` (`base`), then the rest: `dishes` less that advance. */
async function sellRest(
  dishes: Dish[],
  advance: Dish,
  total: string,
  split = splitOf([...dishes, [advance[0], `-${advance[1]}`, `-${advance[2]}`]]),
) {
  const [rate, base, gross] = advance;
  const paid = await sell(
    [
      {
        lineNo: 1,
        name: "Payment on account",
        descriptions: { "es-ES": "Payment on account" },
        quantity: "1",
        unitPrice: gross,
        vatRate: rate,
        lineTotal: base,
        lineGross: gross,
        advanceRole: "payment_on_account",
      },
    ],
    gross,
  );
  const rest = await sell(
    [
      ...dishes.map(([vatRate, lineTotal, lineGross], index) => ({
        lineNo: index + 1,
        name: `Dish ${index + 1}`,
        descriptions: { "es-ES": `Dish ${index + 1}` },
        quantity: "1",
        unitPrice: lineGross,
        vatRate,
        lineTotal,
        lineGross,
      })),
      {
        lineNo: dishes.length + 1,
        name: "Payment on account",
        descriptions: { "es-ES": "Payment on account" },
        quantity: "1",
        unitPrice: `-${gross}`,
        vatRate: rate,
        lineTotal: `-${base}`,
        lineGross: `-${gross}`,
        advanceRole: "deduction",
        deductsSaleId: paid.saleId,
      },
    ],
    total,
    { vatBreakdown: split },
  );
  return { ...rest, dishIds: rest.ids.slice(0, dishes.length), deductionId: rest.ids.at(-1)! };
}

/** The record's split, rate by rate the sum of the lines' bases and of their VAT. */
function splitOf(lines: Dish[]) {
  const rates = [...new Set(lines.map(([rate]) => rate))];
  return rates.map((rate) => {
    const atRate = lines.filter(([lineRate]) => lineRate === rate);
    const base = sumDecimals(atRate.map(([, lineBase]) => decimal(lineBase)));
    const gross = sumDecimals(atRate.map(([, , lineGross]) => decimal(lineGross)));
    return { rate: decimal(rate), base, tax: subtractDecimal(gross, base) };
  });
}

const BREAD: Dish = ["10.00", "0.95", "1.05"];

const restPreview = (saleId: SaleId, gross: string, lineIds?: string[]) =>
  withTransaction(suite.db, (tx) =>
    previewCorrectionAmounts(tx, backend, saleId, nodeId, {
      gross: decimal(gross),
      ...(lineIds === undefined ? {} : { lineIds }),
    }),
  );

/** Files what the preview of `gross` shows, through the writer's own check of the split. */
async function fileRestPreview(saleId: SaleId, gross: string, lineIds?: string[]) {
  const shown = await restPreview(saleId, gross, lineIds);
  await withTransaction(suite.db, (tx) =>
    recordCorrection(tx, backend, {
      ...correctionInput(saleId, `-${gross}`, shown.lines),
      partialVatBreakdown: shown.vatBreakdown.map(({ rate, base, tax }) => ({
        rate,
        base: decimal(`-${base}`),
        tax: decimal(`-${tax}`),
      })),
    }),
  );
  return shown;
}

it("keeps the preview refusal and accepts a checked split for a meal above the limit before its advance", async () => {
  const dish: Dish = ["0.00", "600000000000.00", "600000000000.00"];
  const rest = await sellRest(
    [dish, dish],
    ["0.00", "400000000000.00", "400000000000.00"],
    "800000000000.00",
  );

  expect(await captureError(() => restPreview(rest.saleId, "1.00"))).toMatchObject({
    code: "sale.correction_history_unusable",
  });
  const line: RecordSaleLine = {
    lineNo: 1,
    name: "Dish 1",
    descriptions: { "es-ES": "Dish 1" },
    quantity: "-1",
    unitPrice: "1.00",
    vatRate: "0.00",
    lineTotal: "-1.00",
    lineGross: "-1.00",
    correctsLineId: rest.dishIds[0]!,
  };
  const result = await withTransaction(suite.db, (tx) =>
    recordCorrection(tx, backend, {
      ...correctionInput(rest.saleId, "-1.00", [line]),
      partialVatBreakdown: [
        { rate: decimal("0.00"), base: decimal("-1.00"), tax: decimal("0.00") },
      ],
    }),
  );
  expect(result.saleId).toEqual(expect.any(String));
});

it("example 1: correcting the rest's invoice never takes from its deduction line, and the preview shows what the writer files", async () => {
  const rest = await sellRest(
    [["10.00", "109.09", "120.00"]],
    ["10.00", "27.27", "30.00"],
    "90.00",
  );

  const shown = await fileRestPreview(rest.saleId, "10.00");

  expect(shown.vatBreakdown).toEqual([{ rate: "10.00", base: "9.09", tax: "0.91" }]);
  expect(shown.lines.map((line) => line.correctsLineId)).toEqual([rest.dishIds[0]]);
  const [filed] = await suite.db
    .select({ vatBreakdown: sales.vatBreakdown })
    .from(sales)
    .where(eq(sales.correctsSaleId, rest.saleId));
  expect(filed!.vatBreakdown).toEqual([{ rate: "10.00", base: "-9.09", tax: "-0.91" }]);
  expect(await read(rest.saleId)).toMatchObject({
    lines: [{ id: rest.dishIds[0], gross: "120.00", base: "109.09" }],
    vatBreakdown: [{ rate: "10.00", base: "109.09", tax: "10.91" }],
  });
  expect((await restPreview(rest.saleId, "80.00")).vatBreakdown).toEqual([
    { rate: "10.00", base: "72.73", tax: "7.27" },
  ]);
  expect(await captureError(() => restPreview(rest.saleId, "80.01"))).toMatchObject({
    code: "sale.correction_amount_invalid",
  });
});

it("example 8: one €1.05 dish files −0.95/−0.10, and €3.00 files what the meal's figures give, not the rest's", async () => {
  const rest = await sellRest(Array<Dish>(7).fill(BREAD), ["10.00", "2.73", "3.00"], "4.35");

  const one = await fileRestPreview(rest.saleId, "1.05", [rest.dishIds[0]!]);
  expect(one.vatBreakdown).toEqual([{ rate: "10.00", base: "0.95", tax: "0.10" }]);

  const other = await sellRest(Array<Dish>(7).fill(BREAD), ["10.00", "2.73", "3.00"], "4.35");
  const three = await fileRestPreview(other.saleId, "3.00");
  expect(three.vatBreakdown).toEqual([{ rate: "10.00", base: "2.72", tax: "0.28" }]);
  expect(three.lines.map((line) => line.correctsLineId)).not.toContain(other.deductionId);
  expect(await captureError(() => restPreview(other.saleId, "1.36"))).toMatchObject({
    code: "sale.correction_amount_invalid",
  });
});

it("example 8: the writer refuses a split worked out from the rest's own figures", async () => {
  const rest = await sellRest(Array<Dish>(7).fill(BREAD), ["10.00", "2.73", "3.00"], "4.35");
  const shown = await restPreview(rest.saleId, "3.00");
  const lines = shown.lines.map((line, index) =>
    index === 0
      ? { ...line, lineTotal: subtractDecimal(decimal(line.lineTotal), decimal("0.01")) }
      : line,
  );

  expect(
    await captureError(() =>
      withTransaction(suite.db, (tx) =>
        recordCorrection(tx, backend, {
          ...correctionInput(rest.saleId, "-3.00", lines),
          partialVatBreakdown: [
            { rate: decimal("10.00"), base: decimal("-2.73"), tax: decimal("-0.27") },
          ],
        }),
      ),
    ),
  ).toMatchObject({ code: "sale.correction_breakdown_invalid" });
});

it("example 2: the 10% the advance more than covers has nothing to correct, and €50 at 21% files −41.32/−8.68", async () => {
  const rest = await sellRest(
    [
      ["10.00", "18.18", "20.00"],
      ["21.00", "66.12", "80.00"],
    ],
    ["10.00", "45.45", "50.00"],
    "50.00",
  );

  expect(
    await withTransaction(suite.db, (tx) => readCorrectableLines(tx, backend, rest.saleId, nodeId)),
  ).toEqual([
    {
      id: rest.dishIds[0],
      descriptions: { "es-ES": "Dish 1" },
      rate: "10.00",
      gross: "20.00",
      left: "0.00",
    },
    {
      id: rest.dishIds[1],
      descriptions: { "es-ES": "Dish 2" },
      rate: "21.00",
      gross: "80.00",
      left: "80.00",
    },
  ]);
  expect(
    await captureError(() => restPreview(rest.saleId, "1.00", [rest.dishIds[0]!])),
  ).toMatchObject({
    code: "sale.correction_amount_invalid",
  });
  const shown = await fileRestPreview(rest.saleId, "50.00");
  expect(shown.vatBreakdown).toEqual([{ rate: "21.00", base: "41.32", tax: "8.68" }]);
});

it("drops a rate only an advance holds, which must net to nothing, and leaves the meal's other rates whole", async () => {
  const rest = await sellRest([["21.00", "66.12", "80.00"]], ["10.00", "9.09", "10.00"], "70.00");

  expect(await read(rest.saleId)).toEqual({
    lines: [{ id: rest.dishIds[0], lineNo: 1, rate: "21.00", gross: "80.00", base: "66.12" }],
    vatBreakdown: [{ rate: "21.00", base: "66.12", tax: "13.88" }],
    consumed: [],
  });

  const moved = await sellRest([["21.00", "66.12", "80.00"]], ["10.00", "9.09", "10.00"], "70.00", [
    { rate: decimal("10.00"), base: decimal("-9.08"), tax: decimal("-0.92") },
    { rate: decimal("21.00"), base: decimal("66.12"), tax: decimal("13.88") },
  ]);
  expect(await captureError(() => read(moved.saleId))).toMatchObject({
    code: "sale.correction_history_unusable",
  });
});
