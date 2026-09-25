import type { Transaction } from "@waitron/db";
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
import type { PricedOrder } from "./working-order.js";

/**
 * The issuance pass: what each line of the sale about to be filed records about its product at the
 * moment the record is issued — the product sold, a variant's parent, the menu it was sold from and
 * its reporting chain and labels. Every till filing path calls it on the priced lines it files, in the
 * pass that issues the record (spec 2026-09-25-sales-classification §3), and a replay or reprint
 * never does.
 *
 * `order.identities[i]` is the working-order line `order.priced.lines[i]` was priced from, as
 * `priceStoredOrderForIssuance` and `createOpenOrder` both return them. The classification is read
 * once for the whole sale.
 */
export async function issuancePass(
  tx: Transaction,
  cfg: TillConfig,
  workingOrderId: string,
  order: PricedOrder,
): Promise<PricedLines> {
  const { priced, identities } = order;
  if (identities.length !== priced.lines.length) {
    throw new Error(
      `issuancePass: the ${priced.lines.length} priced lines of working order ${workingOrderId} do not line up with its ${identities.length} line identities`,
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
    ...new Set(identities.flatMap((line) => (line.productId === null ? [] : [line.productId]))),
  ];
  const classification = await loadClassification(tx, productIds, defaultLanguage);

  return {
    ...priced,
    lines: priced.lines.map((line, i) => {
      const { id, productId } = identities[i]!;
      return {
        ...line,
        productId,
        parentProductId: productId === null ? null : parentProductOf(classification, productId),
        menuId: menuByLine.get(id) ?? null,
        menuVersionId: null,
        // Empty, not null: a null classification means the line was filed without one.
        classification:
          productId === null
            ? { reporting: [], labels: [] }
            : classifyLine(classification, productId),
      };
    }),
  };
}
