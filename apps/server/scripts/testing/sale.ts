import { recordSale, withIssuanceTransaction } from "@waitron/core";
import type { Database } from "@waitron/db";
import type { TrustedClock } from "@waitron/fiscal";
import { VerifactuBackend } from "@waitron/fiscal-verifactu";
import { addDecimal, decimal, jobOrigin, nodeId, percentOf, seriesId } from "@waitron/shared";

interface FixtureSale {
  nodeId: string;
  seriesId: string;
  description: string;
  baseAmount: string;
  vatRate: string;
  tipAmount?: string;
}

// The fixture simulates operator-origin issuance without a command or an environment-selected store.
export function recordFixtureSale(db: Database, args: FixtureSale) {
  const clock: TrustedClock = {
    now: () => {
      const instant = new Date();
      return {
        instant,
        offsetMinutes: -instant.getTimezoneOffset(),
        confident: true,
        confidence: "anchored",
        anchorAgeSeconds: 0,
      };
    },
    anchor: () => {
      throw new Error("fixture sales do not anchor the clock");
    },
    currentAnchor: () => null,
  };
  const baseAmount = decimal(args.baseAmount);
  const vatRate = decimal(args.vatRate);
  const tipAmount = decimal(args.tipAmount ?? "0.00");
  const total = addDecimal(baseAmount, percentOf(baseAmount, vatRate));
  const backend = new VerifactuBackend({
    clock,
    db,
    environment: "preproduction",
    deploymentEnvironment: "preproduction",
    resolveClient: () => Promise.reject(new Error("fixture sales must not contact AEAT")),
  });
  return withIssuanceTransaction(db, (tx) =>
    recordSale(tx, backend, {
      origin: jobOrigin("operator_script"),
      nodeId: nodeId(args.nodeId),
      seriesId: seriesId(args.seriesId),
      locale: "es-ES",
      invoiceLocales: ["es-ES"],
      total,
      lines: [
        {
          lineNo: 1,
          name: args.description,
          descriptions: { "es-ES": args.description },
          quantity: "1",
          unitPrice: baseAmount,
          vatRate,
          lineTotal: baseAmount,
        },
      ],
      settlement: {
        kind: "immediate",
        tenders: [
          {
            method: "cash",
            amount: addDecimal(total, tipAmount),
            tipAmount,
            settledAt: clock.now().instant,
          },
        ],
      },
      clock,
    }),
  );
}
