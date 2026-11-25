import { seedPersons } from "@waitron/identity/test/person-rows.js";
import { eq, sql } from "drizzle-orm";
import { beforeEach, expect, it } from "vitest";
import {
  CORE_MIGRATIONS,
  invoiceSeries,
  saleLines,
  sales,
  tillSessions,
  withTransaction,
  workingOrders,
} from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { seedDevice, seedWorkingOrder } from "@waitron/db/testing/seed.js";
import { hashPin, loginWithPin } from "@waitron/identity";
import { FakeFiscalBackend } from "@waitron/fiscal/src/testing/fake-backend.js";
import { deviceOrigin, workingOrderId, type SaleId } from "@waitron/shared";
import type { RecordSaleLine } from "./record-sale.js";
import { recordSale } from "./record-sale.js";
import { seedCorrectiveSeries, seedTaxpayer } from "../test/fixtures.js";
import { recordCorrection, type RecordCorrectionInput } from "./record-correction.js";

const suite = useVenueDb({
  migrations: [CORE_MIGRATIONS],
  setup: (db) => FakeFiscalBackend.install(db),
});

const AT = "2026-03-01T11:00:00.000Z";
const clock: RecordCorrectionInput["clock"] = {
  now: () => ({
    instant: new Date("2026-03-01T13:00:00Z"),
    offsetMinutes: 60,
    confident: true,
    confidence: "anchored",
    anchorAgeSeconds: 0,
  }),
  anchor: () => {
    throw new Error("Unused clock anchor");
  },
  currentAnchor: () => null,
};
const LINES: RecordSaleLine[] = [
  {
    lineNo: 1,
    name: "Coffee",
    descriptions: { "es-ES": "Coffee" },
    quantity: "2",
    unitPrice: "5.00",
    vatRate: "21.00",
    lineTotal: "10.00",
  },
];

let backend: FakeFiscalBackend;
let seed: Awaited<ReturnType<typeof seedTaxpayer>>;
let correctiveSeriesId: Awaited<ReturnType<typeof seedCorrectiveSeries>>;
let printedBillId: string;
let ticketId: SaleId;
let staffId: string;
let staffSessionId: string;

beforeEach(async () => {
  backend = new FakeFiscalBackend(suite.db);
  seed = await seedTaxpayer(suite.db);
  correctiveSeriesId = await seedCorrectiveSeries(suite.db, seed.nodeId);
  await withTransaction(suite.db, (tx) => backend.registerNode(tx, seed.nodeId));
  printedBillId = await bill("placed");
  ticketId = await issueTicket(printedBillId);
  const [staff] = await seedPersons(suite.db, {
    displayName: "Staff without sale.rectify",
    role: "staff",
    pinHash: hashPin("1357"),
  });
  staffId = staff!.id;
  const { deviceId } = await seedDevice(suite.db, {});
  staffSessionId = (
    await withTransaction(suite.db, (tx) =>
      loginWithPin(tx, { deviceId, personId: staffId, pin: "1357" }),
    )
  ).id;
});

async function bill(status: "open" | "placed"): Promise<string> {
  const row = await seedWorkingOrder(suite.db, {
    deviceId: null,
    nodeId: seed.nodeId,
    status,
    openedAt: AT,
  });
  return row.id;
}

async function issueTicket(billId: string): Promise<SaleId> {
  const { saleId } = await withTransaction(suite.db, (tx) =>
    recordSale(tx, backend, {
      operationDescription: "Food and drink",
      origin: deviceOrigin(seed.deviceId),
      nodeId: seed.nodeId,
      seriesId: seed.seriesId,
      workingOrderId: workingOrderId(billId),
      locale: "es-ES",
      invoiceLocales: ["es-ES"],
      total: "12.10",
      lines: LINES,
      settlement: { kind: "deferred" },
      clock,
    }),
  );
  return saleId;
}

async function reopen(from: string): Promise<string> {
  const reopened = await bill("open");
  await suite.db.run(sql`update working_orders set reopened_from = ${from} where id = ${reopened}`);
  return reopened;
}

async function wholeCredit(): Promise<Omit<RecordCorrectionInput, "authz">> {
  const [line] = await suite.db
    .select({ id: saleLines.id })
    .from(saleLines)
    .where(eq(saleLines.saleId, ticketId));
  return {
    origin: deviceOrigin(seed.deviceId),
    operationDescription: "Reopen to split",
    nodeId: seed.nodeId,
    seriesId: correctiveSeriesId,
    correctsSaleId: ticketId,
    total: "-12.10",
    wholeInvoice: true,
    lines: [{ ...LINES[0]!, quantity: "-2", lineTotal: "-10.00", correctsLineId: line!.id }],
    clock,
  };
}

function apply(input: Omit<RecordCorrectionInput, "authz">, authz: RecordCorrectionInput["authz"]) {
  return withTransaction(suite.db, (tx) => recordCorrection(tx, backend, { ...input, authz }));
}

async function snapshot() {
  return {
    sales: await suite.db.select().from(sales),
    series: await suite.db.select().from(invoiceSeries),
  };
}

async function expectRefused(
  input: Omit<RecordCorrectionInput, "authz">,
  authz: RecordCorrectionInput["authz"],
  refusal: object,
) {
  const before = await snapshot();
  await expect(apply(input, authz)).rejects.toMatchObject(refusal);
  expect(await snapshot()).toEqual(before);
}

function reopenInvalid(reopenedBillId: string, reason: string) {
  return {
    code: "sale.correction_reopen_invalid",
    params: { saleId: ticketId, reopenedBillId, reason },
  };
}

it("credits a bill's ticket whole for a person without sale.rectify when its reopened bill is open", async () => {
  const reopenedBillId = await reopen(printedBillId);
  await suite.db
    .update(workingOrders)
    .set({ status: "abandoned" })
    .where(eq(workingOrders.id, printedBillId));
  const result = await apply(await wholeCredit(), { reopenedBillId, sessionId: staffSessionId });
  const [row] = await suite.db.select().from(sales).where(eq(sales.id, result.saleId));
  expect(row).toMatchObject({ authorizedBy: staffId, correctsSaleId: ticketId, total: -1210 });
});

it("refuses a partial correction", async () => {
  const reopenedBillId = await reopen(printedBillId);
  const whole = await wholeCredit();
  await expectRefused(
    {
      ...whole,
      wholeInvoice: false,
      total: "-6.05",
      lines: [{ ...whole.lines[0]!, quantity: "-1", lineTotal: "-5.00" }],
    },
    { reopenedBillId, sessionId: staffSessionId },
    reopenInvalid(reopenedBillId, "not_whole"),
  );
});

it("refuses when no open bill was reopened from the ticket's bill", async () => {
  const unlinked = await bill("open");
  await expectRefused(
    await wholeCredit(),
    { reopenedBillId: unlinked, sessionId: staffSessionId },
    reopenInvalid(unlinked, "no_reopened_bill"),
  );
  const unknown = crypto.randomUUID();
  await expectRefused(
    await wholeCredit(),
    { reopenedBillId: unknown, sessionId: staffSessionId },
    reopenInvalid(unknown, "no_reopened_bill"),
  );
});

it("refuses when the reopened bill names another bill", async () => {
  const otherPrinted = await bill("placed");
  await issueTicket(otherPrinted);
  const reopenedBillId = await reopen(otherPrinted);
  await expectRefused(
    await wholeCredit(),
    { reopenedBillId, sessionId: staffSessionId },
    reopenInvalid(reopenedBillId, "no_reopened_bill"),
  );
});

it("refuses when the reopened bill is no longer open", async () => {
  const reopenedBillId = await reopen(printedBillId);
  await suite.db
    .update(workingOrders)
    .set({ status: "placed" })
    .where(eq(workingOrders.id, reopenedBillId));
  await expectRefused(
    await wholeCredit(),
    { reopenedBillId, sessionId: staffSessionId },
    reopenInvalid(reopenedBillId, "no_reopened_bill"),
  );
});

it("refuses an ended session", async () => {
  const reopenedBillId = await reopen(printedBillId);
  await suite.db
    .update(tillSessions)
    .set({ endedAt: "2026-03-01T12:30:00.000Z" })
    .where(eq(tillSessions.id, staffSessionId));
  await expectRefused(
    await wholeCredit(),
    { reopenedBillId, sessionId: staffSessionId },
    { code: "session.not_open", params: { sessionId: staffSessionId } },
  );
});

it("the other kinds still need sale.rectify", async () => {
  await reopen(printedBillId);
  await expectRefused(
    await wholeCredit(),
    { sessionId: staffSessionId },
    { code: "authorization.not_permitted", params: { permission: "sale.rectify" } },
  );
});
