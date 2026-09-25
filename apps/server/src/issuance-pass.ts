import { eq } from "drizzle-orm";
import { workingOrderLines, type Transaction } from "@waitron/db";
import {
  classifyLine,
  loadClassification,
  parentProductOf,
  readContentLanguages,
} from "@waitron/catalogue";
import type { PricedLines } from "@waitron/catalogue";
import { FALLBACK_LOCALE } from "@waitron/shared";
import { VENUE_SERVICE } from "./modules.js";
import type { TillConfig } from "./till-config.js";

/**
 * The issuance pass: what each line of the sale about to be filed records about its product at the
 * moment the record is issued — the product sold, a variant's parent, the menu it was sold from and
 * its reporting chain and labels. Every filing path calls it on the priced lines it files, in the
 * pass that issues the record (spec 2026-09-25-sales-classification §3), and a replay or reprint
 * never does.
 *
 * `priced` must be the order's stored lines in `line_no` order, as `priceStoredOrder` and a
 * walk-up's `createOpenOrder` both produce them. The classification is read once for the whole sale.
 */
export async function issuancePass(
  tx: Transaction,
  cfg: TillConfig,
  workingOrderId: string,
  priced: PricedLines,
): Promise<PricedLines> {
  const stored = await tx
    .select({
      id: workingOrderLines.id,
      name: workingOrderLines.name,
      productId: workingOrderLines.productId,
    })
    .from(workingOrderLines)
    .where(eq(workingOrderLines.workingOrderId, workingOrderId))
    .orderBy(workingOrderLines.lineNo);
  if (
    stored.length !== priced.lines.length ||
    stored.some((line, i) => line.name !== priced.lines[i]!.name)
  ) {
    throw new Error(
      `issuancePass: the priced lines of working order ${workingOrderId} do not line up with its stored lines`,
    );
  }

  const menuByLine = new Map(
    (await VENUE_SERVICE.listLineContexts(tx, cfg, workingOrderId)).map((context) => [
      context.workingOrderLineId,
      context.menuId,
    ]),
  );
  // The language the line's free-text `category` is resolved in (`listMenuOffers`).
  const { defaultLanguage } = await readContentLanguages(tx, FALLBACK_LOCALE);
  const productIds = [
    ...new Set(stored.flatMap((line) => (line.productId === null ? [] : [line.productId]))),
  ];
  const classification = await loadClassification(tx, productIds, defaultLanguage);

  return {
    ...priced,
    lines: priced.lines.map((line, i) => {
      const { id, productId } = stored[i]!;
      return {
        ...line,
        productId,
        parentProductId: productId === null ? null : parentProductOf(classification, productId),
        menuId: menuByLine.get(id) ?? null,
        menuVersionId: null,
        // A line with no product is still a line filed after this change, so it reads as
        // Uncategorised rather than as the null of a line filed before it.
        classification:
          productId === null
            ? { reporting: [], labels: [] }
            : classifyLine(classification, productId),
      };
    }),
  };
}
