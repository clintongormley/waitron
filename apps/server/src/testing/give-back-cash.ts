import { listAdjustmentReasons } from "@waitron/adjustments";
import type { SaleId } from "@waitron/shared";
import { recordAttendanceFact } from "../attendance-capture.js";
import { giveCorrectionCash, parseCorrectionCash } from "../invoice-correction-cash.js";
import { openInvoiceCorrection, previewInvoiceCorrection } from "../invoice-corrections.js";
import { parseInvoiceCorrection } from "./invoice-correction.js";
import { inTx, type PartyVenue } from "./party-venue.js";

/** The venue's operator correcting a sale, holding `sale.rectify`. */
export const correctionActor = (venue: PartyVenue) => ({
  personId: venue.operator.personId,
  authz: { sessionId: venue.operator.sessionId },
  authorization: {
    authorizedBy: venue.operator.personId,
    permission: "sale.rectify",
    viaOverride: false,
  },
});

/** Gives `gross` back in cash off the sale's lines `lineIds`, or off the whole sale without them;
 * answers the corrective's id. */
export async function giveBackCash(
  venue: PartyVenue,
  saleId: SaleId,
  gross: string,
  lineIds?: string[],
): Promise<string> {
  const chosen = lineIds === undefined ? {} : { lineIds };
  const { vatBreakdown } = await inTx(venue, (tx) =>
    previewInvoiceCorrection(tx, venue.backend, venue.cfg, venue.clock.now(), saleId, {
      gross,
      ...chosen,
    }),
  );
  const deps = { backend: venue.backend, clock: venue.clock, attendance: recordAttendanceFact };
  const actor = correctionActor(venue);
  const given = await inTx(venue, async (tx) => {
    const { correction } = await openInvoiceCorrection(
      tx,
      deps,
      venue.cfg,
      saleId,
      parseInvoiceCorrection({
        submissionId: crypto.randomUUID(),
        gross,
        ...chosen,
        reasonId: (await listAdjustmentReasons(tx))[0]!.id,
        note: "Goodwill",
        expectedSplit: vatBreakdown.map(({ rate, base, tax }) => ({ rate, base, tax })),
      }),
      actor,
    );
    return giveCorrectionCash(
      tx,
      deps,
      venue.cfg,
      correction.id,
      parseCorrectionCash({ submissionId: crypto.randomUUID(), amount: gross }),
      { ...actor, authorization: { ...actor.authorization, permission: "sale.refund" } },
    );
  });
  return given.correction.correctiveSaleId!;
}
