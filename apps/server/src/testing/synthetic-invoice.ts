import { randomUUID } from "node:crypto";
import { invoiceSeries, withTransaction, type Database } from "@waitron/db";
import { formatInvoiceNumber, recordSale } from "@waitron/core";
import type { TrustedClock } from "@waitron/fiscal";
import { enabledModules, fiscalSlot, parseModuleConfig } from "@waitron/module";
import { jobOrigin, seriesId } from "@waitron/shared";
import { ALL_MODULES } from "../modules.js";
import { venueModuleConfig } from "../provision.js";

/** The customer a synthetic full invoice is made out to. */
export const SYNTHETIC_CUSTOMER = {
  taxId: "12345678Z",
  legalName: "Saved customer",
  address: "Saved address",
};

const clock: TrustedClock = {
  now: () => ({
    instant: new Date("2026-10-12T09:00:00.000Z"),
    offsetMinutes: 0,
    confident: true,
    confidence: "anchored",
    anchorAgeSeconds: 0,
  }),
  anchor: () => {
    throw new Error("Unused anchor");
  },
  currentAnchor: () => null,
};

/**
 * A one-line sale written through the core into a new series on `nodeId`, as part 1's delivery
 * suites write theirs: a full invoice to {@link SYNTHETIC_CUSTOMER}, or a simplified one when `full`
 * is false. The tenant needs a taxpayer domicile for a full invoice.
 */
export async function recordSyntheticInvoice(
  db: Database,
  nodeId: string,
  options: { full?: boolean; seriesCode?: string } = {},
): Promise<{ saleId: string; number: string }> {
  const full = options.full ?? true;
  const [series] = await db
    .insert(invoiceSeries)
    .values({
      nodeId,
      code: options.seriesCode ?? `F${randomUUID().slice(0, 4)}`,
      purpose: full ? "full" : "standard",
    })
    .returning();
  const backend = fiscalSlot(
    enabledModules(ALL_MODULES, venueModuleConfig(parseModuleConfig({}, ALL_MODULES), "GB-vat")),
    null,
  ).makeBackend({ db, clock, environment: "preproduction" });
  const sale = await withTransaction(db, (tx) =>
    recordSale(tx, backend, {
      origin: jobOrigin("operator_script"),
      nodeId: nodeId as Parameters<typeof recordSale>[2]["nodeId"],
      seriesId: seriesId(series!.id),
      locale: "es-ES",
      invoiceLocales: ["es-ES"],
      total: "1.00",
      lines: [
        {
          lineNo: 1,
          name: "Coffee",
          descriptions: { "es-ES": "Café" },
          quantity: "1",
          unitPrice: "1.00",
          vatRate: "0",
          lineTotal: "1.00",
        },
      ],
      clock,
      settlement: { kind: "deferred" },
      ...(full
        ? {
            counterparty: {
              taxId: SYNTHETIC_CUSTOMER.taxId,
              legalName: SYNTHETIC_CUSTOMER.legalName,
              countryCode: "ES",
            },
            recipientAddress: SYNTHETIC_CUSTOMER.address,
          }
        : {}),
    }),
  );
  return { saleId: sale.saleId, number: formatInvoiceNumber(series!.code, 1) };
}
