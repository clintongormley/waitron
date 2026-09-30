import { inArray } from "drizzle-orm";
import { products, type Transaction } from "@waitron/db";
import type { GrossLines } from "@waitron/catalogue";
import { VENUE_SERVICE } from "./modules.js";
import type { TillConfig } from "./till-config.js";
import type { GrossOrder } from "./working-order.js";

/**
 * The issuance pass: what each line of the sale about to be filed records about its product — the
 * product sold, a variant's parent, the menu and menu version it was sold from, and the reporting
 * chain the line recorded when it was added, copied as it is. Every till filing path calls it on
 * the gross lines it files, before `issueMoment` rates them, and a replay or reprint never does.
 *
 * `order.identities[i]` is the working-order line `order.gross.lines[i]` was priced from, as
 * `priceStoredOrderForIssuance` and `createOpenOrder` both return them.
 */
export async function issuancePass(
  tx: Transaction,
  cfg: TillConfig,
  workingOrderId: string,
  order: GrossOrder,
): Promise<GrossLines> {
  const { gross, identities } = order;
  if (identities.length !== gross.lines.length) {
    throw new Error(
      `issuancePass: the ${gross.lines.length} gross lines of working order ${workingOrderId} do not line up with its ${identities.length} line identities`,
    );
  }

  const contextByLine = new Map(
    (await VENUE_SERVICE.listLineContexts(tx, cfg, workingOrderId)).map((context) => [
      context.workingOrderLineId,
      context,
    ]),
  );
  const productIds = [
    ...new Set(identities.flatMap((line) => (line.productId === null ? [] : [line.productId]))),
  ];
  // A variant's parent never changes after it is created (`products_variant_parent_fixed_update`).
  const parentOf = new Map(
    productIds.length === 0
      ? []
      : (
          await tx
            .select({ id: products.id, parentId: products.parentId })
            .from(products)
            .where(inArray(products.id, productIds))
        ).map((row) => [row.id, row.parentId]),
  );

  return {
    ...gross,
    lines: gross.lines.map((line, i) => {
      const { id, productId, classification } = identities[i]!;
      return {
        ...line,
        productId,
        parentProductId: productId === null ? null : (parentOf.get(productId) ?? null),
        menuId: contextByLine.get(id)?.menuId ?? null,
        menuVersionId: contextByLine.get(id)?.menuVersionId ?? null,
        classification,
      };
    }),
  };
}
