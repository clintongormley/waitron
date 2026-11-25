import { eq } from "drizzle-orm";
import { withTransaction } from "@waitron/db";
import {
  createPinThrottle,
  hashSessionToken,
  tillSessions,
  type Override,
} from "@waitron/identity";
import { AppError, deviceId as brandDeviceId, saleId as brandSaleId } from "@waitron/shared";
import { withCorrectionAuthorization } from "../invoice-correction-authorization.js";
import {
  expectedSplitOf,
  moneyOf,
  openInvoiceCorrection,
  previewInvoiceCorrection,
  type InvoiceCorrectionAsk,
  type InvoiceCorrectionView,
  type SplitLine,
} from "../invoice-corrections.js";
import { requestCfg } from "../request-config.js";
import { overridePinAttempts } from "../till-request-fields.js";
import { SESSION_COOKIE } from "../till-session.js";
import { requireEconomicWrite } from "../trading-admission.js";
import type { BillVenue } from "./bill-venue.js";
import { testTradingAdmission } from "./trading-admission.js";

export interface InvoiceCorrectionRequest {
  submissionId: string;
  /** The money back, VAT included. */
  gross: string;
  lineIds?: string[];
  reasonId: string;
  note?: string | null;
  /** The split the preview answered, positive. */
  expectedSplit: SplitLine[];
}

export function parseInvoiceCorrection(request: InvoiceCorrectionRequest): InvoiceCorrectionAsk {
  const { submissionId, gross, lineIds, reasonId, note, expectedSplit } = request;
  return {
    submissionId,
    gross: moneyOf(gross, "gross"),
    ...(lineIds === undefined ? {} : { lineIds }),
    reasonId,
    note: note?.trim() || null,
    expectedSplit: expectedSplitOf(expectedSplit),
  };
}

type CorrectionVenue = Pick<BillVenue, "db" | "backend" | "clock" | "cfg">;

/** What `ask` answers, as a till would read it, or its refusal's code and params. */
async function answerOf(ask: () => Promise<object>): Promise<{ json: Record<string, unknown> }> {
  try {
    return { json: JSON.parse(JSON.stringify(await ask())) as Record<string, unknown> };
  } catch (error) {
    if (!(error instanceof AppError)) throw error;
    return { json: { code: error.code, params: { ...error.params } } };
  }
}

/** The split a correction of `selection` would file, worked out as the Give back press does before
 * it opens one. */
export function previewCorrection(
  venue: CorrectionVenue,
  saleId: string,
  selection: { gross: string; lineIds?: readonly string[] },
) {
  return answerOf(() =>
    withTransaction(venue.db, (tx) =>
      previewInvoiceCorrection(
        tx,
        venue.backend,
        venue.cfg,
        venue.clock.now(),
        brandSaleId(saleId),
        selection,
      ),
    ),
  );
}

/** The VAT split {@link previewCorrection} answers; throws when it is refused. */
export async function previewedSplit(
  ...args: Parameters<typeof previewCorrection>
): Promise<SplitLine[]> {
  const { json } = await previewCorrection(...args);
  if (json.vatBreakdown === undefined) throw new Error(`no split: ${JSON.stringify(json)}`);
  return json.vatBreakdown as SplitLine[];
}

/** Opens a correction for the person whose till session `cookie` carries: `sale.rectify` is theirs or
 * the supervisor's whose PIN `body.override` is, and no money moves, unlike a Give back press. */
export function openCorrection(
  venue: CorrectionVenue,
  saleId: string,
  body: InvoiceCorrectionRequest & { override?: Override },
  cookie: string,
) {
  return answerOf(async () => {
    const ask = parseInvoiceCorrection(body);
    const token = new RegExp(`${SESSION_COOKIE}=([^;]+)`).exec(cookie)![1]!;
    const [session] = await venue.db
      .select()
      .from(tillSessions)
      .where(eq(tillSessions.tokenHash, hashSessionToken(token)));
    const { id: sessionId, personId } = session!;
    const deviceId = brandDeviceId(session!.deviceId);
    const cfg = requestCfg(venue.cfg, { deviceId });
    return withCorrectionAuthorization(
      venue.db,
      saleId,
      body.override,
      {
        personId,
        sessionId,
        deviceId,
        attempts: overridePinAttempts(createPinThrottle(), deviceId),
      },
      async (tx, authorization) => {
        await requireEconomicWrite(tx, cfg, testTradingAdmission());
        return openInvoiceCorrection(
          tx,
          { backend: venue.backend, clock: venue.clock },
          cfg,
          brandSaleId(saleId),
          ask,
          { personId, authorization },
        );
      },
    );
  });
}

/** The id of the correction {@link openCorrection} opened; throws when it was refused. */
export async function openedCorrection(
  ...args: Parameters<typeof openCorrection>
): Promise<string> {
  const { json } = await openCorrection(...args);
  if (json.correction === undefined) throw new Error(`not opened: ${JSON.stringify(json)}`);
  return (json.correction as InvoiceCorrectionView).id;
}
