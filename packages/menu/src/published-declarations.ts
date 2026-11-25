import type { Transaction } from "@waitron/db";
import type {
  FrozenExtraItem,
  FrozenOffer,
  MenuDocument,
  SetMenuFrozenOffer,
} from "@waitron/shared";
import { onceLiveVersionsAfter, readRecordedDocuments } from "./menu-publication.js";
import { productDeclarationValues, type DeclarationValues } from "./declaration-values.js";

export interface PublishedLine {
  id: string;
  menuVersionId: string | null;
  menuItemId: string | null;
  productId: string | null;
  extraListId: string | null;
}

/**
 * The declarations `document` holds for the line's dish, variant or extra; undefined when it does
 * not hold that exact one. An extra (`extraListId` set) reads the item for `productId` in an extras
 * list with that id; a dish reads the ordinary offer or set-menu copy whose id is `menuItemId` when
 * `productId` is that offer's product, or that offer's variant whose id is `productId`. A missing
 * variant or extras item is undefined: never the parent dish's values.
 */
export function declarationsInDocument(
  document: MenuDocument,
  line: Pick<PublishedLine, "menuItemId" | "productId" | "extraListId">,
): DeclarationValues | undefined {
  const dish = line.menuItemId === null ? undefined : offerOf(document, line.menuItemId);
  if (line.extraListId === null) {
    const sold =
      dish?.productId === line.productId
        ? dish
        : dish?.variants.find(({ id }) => id === line.productId);
    return sold && productDeclarationValues(sold);
  }
  const item = (dish && extraIn(dish, line)) ?? extraInAnyOffer(document, line);
  return (
    item &&
    productDeclarationValues({
      allergens: item.addAllergens,
      dietaryDeclarations: item.suitableFor,
      dietOverride: null,
    })
  );
}

function offerSets(document: MenuDocument): Record<string, FrozenOffer | SetMenuFrozenOffer>[] {
  return [document.offers, ...Object.values(document.setMenus ?? {}).map(({ offers }) => offers)];
}

function offerOf(document: MenuDocument, menuItemId: string) {
  return offerSets(document).find((offers) => Object.hasOwn(offers, menuItemId))?.[menuItemId];
}

type ExtraKey = Pick<PublishedLine, "extraListId" | "productId">;

function extraIn(
  { offeredModifiers }: Pick<FrozenOffer, "offeredModifiers">,
  { extraListId, productId }: ExtraKey,
): FrozenExtraItem | undefined {
  for (const list of offeredModifiers) {
    if (list.kind !== "extras" || list.id !== extraListId) continue;
    const item = list.items.find((candidate) => candidate.productId === productId);
    if (item !== undefined) return item;
  }
  return undefined;
}

function extraInAnyOffer(document: MenuDocument, key: ExtraKey): FrozenExtraItem | undefined {
  for (const offers of offerSets(document))
    for (const offer of Object.values(offers)) {
      const item = extraIn(offer, key);
      if (item !== undefined) return item;
    }
  return undefined;
}

/** Documents one statement reads for a line at most. */
const LARGEST_READ = 16;

/**
 * Each line's declarations from the newest version of its version's menu that is live or was once,
 * holds the line exactly and is newer than the line's own version; otherwise from its own, live
 * ever or not. A line found in none is absent. Whether the menu is sold now makes no difference.
 *
 * A menu's live version outnumbers every other that was once live, so most lines are answered by
 * the first document; a line it does not hold reads 2, 4, 8, then {@link LARGEST_READ} at a time.
 */
export async function readPublishedDeclarations(
  tx: Transaction,
  lines: readonly PublishedLine[],
): Promise<Map<string, DeclarationValues>> {
  const found = new Map<string, DeclarationValues>();
  const versioned = lines.flatMap((line) =>
    line.menuVersionId === null ? [] : [{ line, versionId: line.menuVersionId }],
  );
  if (versioned.length === 0) return found;
  const versionIds = [...new Set(versioned.map(({ versionId }) => versionId))];
  const after = await onceLiveVersionsAfter(tx, versionIds);
  const newestFirst = new Map(
    versionIds.map((versionId) => [versionId, [...(after.get(versionId) ?? []), versionId]]),
  );
  let waiting = versioned.map(({ line, versionId }) => ({
    line,
    versions: newestFirst.get(versionId)!,
  }));
  let start = 0;
  for (let size = 1; waiting.length > 0; size = Math.min(size * 2, LARGEST_READ)) {
    const end = start + size;
    const recorded = await readRecordedDocuments(
      tx,
      waiting.flatMap(({ versions }) => versions.slice(start, end)),
    );
    waiting = waiting.filter(({ line, versions }) => {
      for (const versionId of versions.slice(start, end)) {
        const document = recorded.get(versionId);
        const values = document && declarationsInDocument(document, line);
        if (values === undefined) continue;
        found.set(line.id, values);
        return false;
      }
      return end < versions.length;
    });
    start = end;
  }
  return found;
}
