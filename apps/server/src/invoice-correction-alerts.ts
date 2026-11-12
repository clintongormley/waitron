import { and, eq, isNull, notExists, sql, type SQLWrapper } from "drizzle-orm";
import { recordIncidentOnce } from "@waitron/core";
import {
  incidents,
  invoiceCorrectionRefunds,
  invoiceCorrections,
  tenderRefunds,
  withTransaction,
  type Transaction,
} from "@waitron/db";
import { authorizeApproval } from "@waitron/identity";
import {
  AppError,
  centsToDecimal,
  jobOrigin,
  rawCentsToDecimal,
  saleId,
  type Decimal,
} from "@waitron/shared";
import { readCorrectionMoney, readCorrectionRow } from "./invoice-correction-legs.js";
import { fileCorrectionIn, previewOrRefusal } from "./invoice-corrections.js";
import { storedDeviceOrigin } from "./request-config.js";
import type { TenderRefundDeps } from "./tender-refunds.js";
import { requireEconomicWrite } from "./trading-admission.js";
import "./errors.js";

const UNFINISHED_MS = 3_600_000;
const ORIGIN = jobOrigin("payment_check");

/** The payment check's open, unhandled alert of `code` on the ticket `saleId`: the rows
 * `recordIncidentOnce` finds already open, by `incidents_open_dedup`'s own key. */
function openAlert(db: Transaction, code: string, saleId: string | SQLWrapper) {
  return db
    .select({ id: incidents.id })
    .from(incidents)
    .where(
      and(
        eq(incidents.source, ORIGIN.source),
        sql`case when ${incidents.deviceId} is null then '' else ${incidents.deviceId} end = ''`,
        eq(incidents.code, code),
        eq(incidents.saleId, saleId),
        isNull(incidents.acknowledgedAt),
      ),
    );
}

/** Open corrections whose earliest completed refund is before `cutoff` and whose ticket has no
 * unhandled unfinished alert yet, each with the money its completed refunds gave back, as raw
 * cents text, and that earliest completion. */
function dueCorrections(db: Transaction, cutoff: string) {
  const completedSince = sql<string>`min(${tenderRefunds.completedAt})`;
  return db
    .select({
      correction: invoiceCorrections,
      back: sql<string>`cast(sum(${tenderRefunds.appliedAmount}) as text)`,
      completedSince,
    })
    .from(invoiceCorrections)
    .innerJoin(
      invoiceCorrectionRefunds,
      eq(invoiceCorrectionRefunds.invoiceCorrectionId, invoiceCorrections.id),
    )
    .innerJoin(
      tenderRefunds,
      and(
        eq(tenderRefunds.id, invoiceCorrectionRefunds.tenderRefundId),
        eq(tenderRefunds.state, "completed"),
      ),
    )
    .where(
      and(
        eq(invoiceCorrections.state, "open"),
        notExists(
          openAlert(db, "invoice_correction.unfinished", invoiceCorrections.originalSaleId),
        ),
      ),
    )
    .groupBy(invoiceCorrections.id)
    .having(sql`${completedSince} < ${cutoff}`);
}

/** Open corrections whose completed refunds add up to their amount, none pending. */
async function settledCorrections(db: Transaction): Promise<string[]> {
  const legs = (state: "completed" | "pending") => sql`from ${invoiceCorrectionRefunds} l
    join ${tenderRefunds} r on r.id = l.tender_refund_id and r.state = ${state}
    where l.invoice_correction_id = c.id`;
  const { rows } = await db.execute<{ id: string }>(sql`select c.id from ${invoiceCorrections} c
    where c.state = 'open'
      and not exists (select 1 ${legs("pending")})
      and c.gross = (select coalesce(sum(r.applied_amount), 0) ${legs("completed")})
    order by c.created_at, c.id`);
  return rows.map((row) => row.id);
}

/**
 * Files, when `fileSettled`, every open correction whose money is all back
 * (`fileCorrectionAutomatically`), then raises `invoice_correction.unfinished` for every open
 * correction whose earliest completed refund is over an hour old and whose ticket's alert is not
 * already open. The first reads run outside the write lock, so a pass with no correction to file
 * or retry and no alert to raise holds up no sale; the write transaction reads again, so a
 * correction filed in between raises nothing. A correction whose filing throws something other than
 * a refusal leaves the others to be filed and alerted, and is thrown after them.
 */
export async function sweepInvoiceCorrections(
  deps: TenderRefundDeps,
  now: Date,
  { fileSettled = true }: { fileSettled?: boolean } = {},
): Promise<void> {
  const failures: unknown[] = [];
  if (fileSettled)
    for (const correctionId of await settledCorrections(deps.db))
      await fileCorrectionAutomatically(deps, correctionId).catch((error: unknown) => {
        failures.push(error);
      });
  await raiseUnfinished(deps, now);
  if (failures.length === 1) throw failures[0];
  if (failures.length > 1) throw new AggregateError(failures, "Automatic correction filing failed");
}

async function raiseUnfinished(deps: TenderRefundDeps, now: Date): Promise<void> {
  const cutoff = new Date(now.getTime() - UNFINISHED_MS).toISOString();
  if ((await dueCorrections(deps.db, cutoff)).length === 0) return;
  await withTransaction(deps.db, async (tx) => {
    for (const due of await dueCorrections(tx, cutoff))
      await raiseCorrectionUnfinished(
        tx,
        due.correction,
        rawCentsToDecimal(due.back),
        due.completedSince,
        now,
      );
  });
}

/** Raised once per ticket while unacknowledged, by the payment check alone. */
export function raiseCorrectionUnfinished(
  tx: Transaction,
  row: typeof invoiceCorrections.$inferSelect,
  moneyBack: Decimal,
  completedSince: string,
  now: Date,
): Promise<boolean> {
  return recordIncidentOnce(tx, {
    origin: ORIGIN,
    saleId: saleId(row.originalSaleId),
    error: new AppError("invoice_correction.unfinished", {
      correctionId: row.id,
      saleId: row.originalSaleId,
      moneyBack,
      completedSince,
    }),
    severity: "warning",
    detectedAt: now,
  });
}

/**
 * Files the open correction `correctionId` on its opening approval
 * (`{ invoiceCorrectionId }`), under the device that opened it, once its refunds have given all
 * its money back with none pending; does nothing otherwise. Before trying, it checks that the
 * approver is still active and holds `sale.rectify`, and that the filing is not refused for a reason
 * Close could end the correction over; while either fails it attempts no filing. A refusal, there
 * or from the filing, files nothing, raises `invoice_correction.filing_refused` once per ticket
 * while it is open, and is not thrown.
 */
export async function fileCorrectionAutomatically(
  deps: TenderRefundDeps,
  correctionId: string,
): Promise<void> {
  const row = await readCorrectionRow(deps.db, correctionId);
  const { completed, pendingRefundId } = await readCorrectionMoney(deps.db, correctionId);
  if (row.state !== "open" || pendingRefundId !== null || completed !== row.gross) return;
  const cfg = { ...deps.cfg, origin: storedDeviceOrigin(row) };
  let refusal: AppError | null;
  try {
    await authorizeApproval(deps.db, { personId: row.authorizedBy, permission: "sale.rectify" });
    const filing = await previewOrRefusal(deps.db, deps.backend, cfg, row.originalSaleId, {
      gross: centsToDecimal(completed),
      ...(row.lineIds === null ? {} : { lineIds: row.lineIds }),
    });
    refusal = "refusal" in filing && filing.closable ? filing.refusal : null;
    if (refusal === null)
      await withTransaction(deps.db, async (tx) => {
        if ((await readCorrectionRow(tx, correctionId)).state !== "open") return;
        await requireEconomicWrite(tx, cfg, deps.admission);
        await fileCorrectionIn(
          tx,
          deps,
          cfg,
          correctionId,
          { invoiceCorrectionId: correctionId },
          null,
        );
      });
  } catch (error) {
    if (!(error instanceof AppError)) throw error;
    refusal = error;
  }
  if (refusal === null) return;
  if (
    (await openAlert(deps.db, "invoice_correction.filing_refused", row.originalSaleId)).length > 0
  )
    return;
  const refused = refusal;
  await withTransaction(deps.db, (tx) =>
    recordIncidentOnce(tx, {
      origin: ORIGIN,
      saleId: saleId(row.originalSaleId),
      error: new AppError("invoice_correction.filing_refused", {
        correctionId,
        saleId: row.originalSaleId,
        moneyBack: centsToDecimal(completed),
        refusal: refused.code,
      }),
      severity: "error",
      detectedAt: deps.clock.now().instant,
    }),
  );
}
