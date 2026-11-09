import { beforeEach, expect, it, vi } from "vitest";
import { deviceOrigin } from "@waitron/shared";
import type { DeviceId, NodeId, SaleId, SeriesId } from "@waitron/shared";
import { FakeFiscalBackend } from "@waitron/fiscal/src/testing/fake-backend.js";
import type { TrustedClock, VatBreakdownLine } from "@waitron/fiscal";
import { CORE_MIGRATIONS, captureError, saleLines, withTransaction } from "@waitron/db";
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

// The invoice: [rate, quantity, base, stored gross]. 10% 10.00/1.00; 21% 12.00/2.52.
const INVOICE: [string, string, string, string | undefined][] = [
  ["10.00", "2", "10.00", "11.00"],
  ["21.00", "1", "10.00", "12.10"],
  ["21.00", "1", "1.00", "1.21"],
  ["21.00", "1", "1.00", undefined],
];

let backend: FakeFiscalBackend;
let deviceId: DeviceId;
let nodeId: NodeId;
let rectSeriesId: SeriesId;
let sessionId: string;
let original: SaleId;
let invoiceLineIds: string[];

beforeEach(async () => {
  let seriesId: SeriesId;
  let locationId: string;
  ({ locationId, deviceId, nodeId, seriesId } = await seedTenant(suite.db));
  rectSeriesId = await seedRectificativeSeries(suite.db, nodeId);
  const [person] = await suite.db
    .insert(persons)
    .values({ displayName: "Supervisor", pinHash: hashPin("1234"), role: "supervisor" })
    .returning({ id: persons.id });
  const till = (await seedDevice(suite.db, { locationId })).deviceId;
  sessionId = (
    await withTransaction(suite.db, (tx) =>
      loginWithPin(tx, { deviceId: till, personId: person!.id, pin: "1234" }),
    )
  ).id;
  backend = new FakeFiscalBackend(suite.db);
  ({ saleId: original } = await withTransaction(suite.db, async (tx) => {
    await backend.registerNode(tx, nodeId);
    return recordSale(tx, backend, {
      origin: deviceOrigin(deviceId),
      nodeId,
      seriesId,
      locale: "es-ES",
      invoiceLocales: ["es-ES"],
      total: "25.52",
      lines: INVOICE.map(([vatRate, quantity, base, gross], index) => ({
        lineNo: index + 1,
        name: `Dish ${index + 1}`,
        descriptions: { "es-ES": `Dish ${index + 1}` },
        quantity,
        unitPrice: "5.00",
        vatRate,
        lineTotal: base,
        lineGross: gross ?? null,
      })),
      settlement: {
        kind: "immediate",
        tenders: [
          { method: "cash", amount: "25.52", tipAmount: "0", settledAt: clock.now().instant },
        ],
      },
      clock,
    });
  }));
  const rows = await suite.db
    .select({ id: saleLines.id })
    .from(saleLines)
    .where(eq(saleLines.saleId, original))
    .orderBy(saleLines.lineNo);
  invoiceLineIds = rows.map((row) => row.id);
});

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

/** Files `draft`; an empty split takes the derived path. */
function file(draft: Draft) {
  return withTransaction(suite.db, (tx) =>
    recordCorrection(tx, backend, {
      origin: deviceOrigin(deviceId),
      nodeId,
      seriesId: rectSeriesId,
      correctsSaleId: original,
      total: draft.total,
      lines: draft.lines.map(({ corrects, ...rest }) => ({
        ...rest,
        correctsLineId: corrects === undefined ? undefined : invoiceLineIds[corrects],
      })),
      ...(draft.split.length === 0
        ? {}
        : {
            partialVatBreakdown: draft.split.map(
              ([rate, base, tax]) => ({ rate, base, tax }) as VatBreakdownLine,
            ),
          }),
      ...(draft.wholeInvoice ? { wholeInvoice: true } : {}),
      authz: { sessionId },
      clock,
    }),
  );
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
};

type Case = [name: string, change: (draft: Draft) => void, earlier?: keyof typeof EARLIER];

const at = (draft: Draft, index: number) => draft.lines[index]!;

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
  ["a group gross that is not its lines'", (d) => void (at(d, 1).lineGross = "-1.04")],
  ["a rate given twice", (d) => void d.split.push(["21.00", "-0.87", "-0.18"])],
  ["a rate with no lines", (d) => void d.split.push(["4.00", "0.00", "0.00"])],
  ["lines at a rate the split omits", (d) => void ((d.split = [d.split[1]!]), (d.total = "-1.05"))],
  ["no lines", (d) => void (d.lines = [])],
  ["a line naming no invoice line", (d) => void delete at(d, 0).corrects],
  ["the same invoice line twice", (d) => void (at(d, 1).corrects = 0)],
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
  ["an invoice line with no stored gross", (d) => void (at(d, 1).corrects = 3)],
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
  // Rule after €10.45: cumulative €11.40 at 10% takes base 10.40, so 0.90 now.
  [
    "a rate's running gross past the invoice's",
    (d) => void ((d.split[0] = ["10.00", "-0.90", "-0.05"]), (at(d, 0).lineTotal = "-0.90")),
    "unnamedAt10",
  ],
  ["an earlier correction of the line with no stored gross", () => undefined, "line1NoGross"],
];

it.each([
  ["the passing split", undefined],
  ["after line 3 was wholly corrected, the same cents from line 2, which has room", "line3Whole"],
] as const)("files %s as given", async (_name, earlier) => {
  if (earlier) await EARLIER[earlier]();
  const spy = vi.spyOn(backend, "recordCorrection");
  await file(passing());
  expect(spy).toHaveBeenCalledOnce();
  expect(spy.mock.calls[0]![1].vatBreakdown).toEqual(
    passing().split.map(([rate, base, tax]) => ({ rate, base, tax })),
  );
});

it.each(REFUSED)("refuses %s before the backend files", async (_name, change, earlier) => {
  if (earlier) await EARLIER[earlier]();
  const spy = vi.spyOn(backend, "recordCorrection");
  const draft = passing();
  change(draft);
  const error = await captureError(() => file(draft));
  expect(error).toMatchObject({ code: "sale.correction_breakdown_invalid" });
  expect(spy).not.toHaveBeenCalled();
});
