import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import {
  parties,
  tenants,
  workingOrders,
  withTransaction,
  type Database,
  type Transaction,
} from "@waitron/db";
import type { TrustedClock } from "@waitron/fiscal";
import { computeDailyClose, recordDailyClose } from "@waitron/reporting";
import { AppError } from "@waitron/shared";
import { readBillEditState, readPartyBillIds } from "../bill-editing.js";
import { partyFamily } from "../parties.js";
import { systemClock } from "../till-backend.js";
import { closeBillDeferredTx, type DeferredCloseDeps } from "../deferred-close.js";
import type { CloseDeferredRequest } from "../deferred-close-types.js";
import { parkOrder } from "../working-order.js";
import { inTx, provisionBillVenue, type BillVenue } from "./bill-venue.js";
import { issueOrderInvoice } from "./issue-order.js";
import { placeOrder } from "./order-writer-fixture.js";
import { testTradingAdmission } from "./trading-admission.js";
import { tableSnapshot } from "./table-snapshot.js";
import { offerProducts } from "./zone-offers.js";

export const MINUTE = 60_000;

/** The fiscal records and their outbox rows, by id: a refused close adds to neither. */
export function fiscalWrites(db: Database) {
  return {
    records: db.all(sql`select id from registros_facturacion order by id`),
    outbox: db.all(sql`select registro_id from envios order by registro_id`),
  };
}

export const RECIPIENT = {
  taxId: "B12345674",
  legalName: "Cliente SL",
  address: "2 Main Street, 28013 Madrid, Madrid",
  countryCode: "ES",
};

/** A Veri*Factu bill venue with a Counter zone and a taxpayer domicile, for full invoices. */
export async function deferredCloseVenue(db: Database) {
  const venue = await provisionBillVenue(db);
  const counterZone = (
    await inTx(venue, (tx) =>
      offerProducts(tx, venue.cfg, { zone: "counter", orderStart: "counter" }),
    )
  ).zoneId;
  await inTx(venue, (tx) => tx.update(tenants).set({ taxpayerDomicile: "Calle Fiscal 8, Madrid" }));
  return deferredCloseKit(venue, counterZone);
}

export type DeferredCloseKit = ReturnType<typeof deferredCloseKit>;

export function deferredCloseKit(venue: BillVenue, counterZone: string) {
  function depsWith(over: Partial<DeferredCloseDeps> = {}): DeferredCloseDeps {
    return {
      db: venue.db,
      backend: venue.backend,
      clock: venue.clock,
      admission: testTradingAdmission(),
      admitPartyRelease: () => Promise.resolve("allowed"),
      ...over,
    };
  }

  function close(
    request: CloseDeferredRequest,
    deps = depsWith(),
    as: { actorId?: string; cfg?: BillVenue["cfg"] } = {},
  ) {
    return withTransaction(venue.db, (tx) =>
      closeBillDeferredTx(tx, deps, as.cfg ?? venue.cfg, request, as.actorId ?? venue.operatorId),
    );
  }

  async function partyEdits(tx: Transaction, partyId: string) {
    const edits = [];
    for (const billId of (await readPartyBillIds(tx, await partyFamily(tx, partyId))).sort())
      edits.push(await readBillEditState(tx, billId));
    return edits;
  }

  /** The request staff would send for the bill as it stands now. */
  async function requestFor(
    billId: string,
    expectedTotal: string,
    partyId: string | null,
    over: Partial<CloseDeferredRequest> = {},
  ): Promise<CloseDeferredRequest> {
    return inTx(venue, async (tx) => {
      const [order] = await tx
        .select({ revision: workingOrders.revision, invoiceType: workingOrders.invoiceType })
        .from(workingOrders)
        .where(eq(workingOrders.id, billId));
      const [party] =
        partyId === null ? [] : await tx.select().from(parties).where(eq(parties.id, partyId));
      return {
        id: billId,
        submissionId: randomUUID(),
        expectedRevision: order!.revision,
        expectedEdit: partyId === null ? null : await readBillEditState(tx, billId),
        expectedTotal,
        invoiceType: order!.invoiceType,
        recipient: order!.invoiceType === "F1" ? RECIPIENT : null,
        receiptLanguage: venue.cfg.locale,
        delivery: null,
        partyFinish:
          party === undefined
            ? null
            : {
                partyId: party.id,
                expectedPartyRevision: party.revision,
                expectedEdits: await partyEdits(tx, party.id),
              },
        ...over,
      };
    });
  }

  /** A counter order of one Tarta (18.00), parked and, unless `open`, placed. */
  async function counterOrder(state: "open" | "placed", issued = false): Promise<string> {
    const id = randomUUID();
    const deps = { db: venue.db, backend: venue.backend, clock: venue.clock };
    await parkOrder(deps, venue.cfg, {
      id,
      lines: [{ menuItemId: venue.offerFor("Tarta"), quantity: "1" }],
      zoneId: counterZone,
      operatorId: venue.operatorId,
    });
    if (issued)
      await issueOrderInvoice(
        { ...deps, admission: testTradingAdmission() },
        venue.cfg,
        id,
        venue.operatorId,
      );
    if (state === "placed")
      await placeOrder(
        { ...deps, admission: testTradingAdmission() },
        venue.cfg,
        id,
        venue.operatorId,
      );
    return id;
  }

  /** Every row of the venue, which a refused, replayed or rolled-back close leaves as it was. */
  function ledger() {
    return tableSnapshot(venue.db);
  }

  /** The latest fiscal record's time: the clock-behind stop measures from it. */
  function latestRecordMs(): number {
    const [row] = venue.db.all<{ at: string }>(sql`
      select fecha_hora_huso_gen_registro as at from registros_facturacion
      order by fecha_hora_huso_gen_registro desc, id desc limit 1
    `);
    return new Date(row!.at).getTime();
  }

  /** One fixed instant, no earlier than now or the latest record, for every close in a case. */
  function sameDayClock(): TrustedClock {
    return clockAt(Math.max(Date.now(), latestRecordMs()));
  }

  /** Freeze this node's business day by its daily close, counting each drawer as expected. */
  async function freezeDay(businessDay: string): Promise<void> {
    const day = {
      cutoverChanges: [],
      businessDay,
      timeZone: "Europe/Madrid",
      dayCutover: "05:00",
    };
    await inTx(venue, async (tx) => {
      const close = await computeDailyClose(tx, { ...day, nodeIds: [venue.cfg.nodeId] });
      await recordDailyClose(tx, {
        ...day,
        nodeId: venue.cfg.nodeId,
        closedBy: venue.adminId,
        cashCounts: close.cash.byOrigin.flatMap((row) =>
          row.deviceId === null
            ? []
            : [
                {
                  deviceId: row.deviceId,
                  openingFloat: "0.00",
                  payouts: "0.00",
                  countedCash: row.cashTakings,
                },
              ],
        ),
      });
    });
  }

  return {
    venue,
    freezeDay,
    counterZone,
    depsWith,
    close,
    requestFor,
    counterOrder,
    ledger,
    latestRecordMs,
    sameDayClock,
  };
}

/** A clock whose every reading is `ms`. */
export function clockAt(ms: number): TrustedClock {
  const base = systemClock();
  const reading = { ...base.now(), instant: new Date(ms), offsetMinutes: 60 };
  return { ...base, now: () => reading };
}

export async function refusal(run: Promise<unknown>): Promise<AppError> {
  const error = await run.then(
    () => undefined,
    (caught: unknown) => caught,
  );
  if (!(error instanceof AppError)) throw new Error(`expected a refusal, got ${String(error)}`);
  return error;
}
