import type { Transaction } from "@waitron/db";
import type {
  FrozenExtraItem,
  FrozenOffer,
  MenuDocument,
  SetMenuFrozenOffer,
} from "@waitron/shared";
import {
  menusOfVersions,
  onceLiveVersionsAfter,
  readLiveDocuments,
  readRecordedDocuments,
} from "./menu-publication.js";
import { productDeclarationValues, type DeclarationValues } from "./product-declarations.js";

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
  const item =
    (dish && extraIn([dish], line)) ??
    extraIn(
      offerSets(document).flatMap((offers) => Object.values(offers)),
      line,
    );
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

function extraIn(
  offers: readonly Pick<FrozenOffer, "offeredModifiers">[],
  { extraListId, productId }: Pick<PublishedLine, "extraListId" | "productId">,
): FrozenExtraItem | undefined {
  for (const { offeredModifiers } of offers)
    for (const list of offeredModifiers) {
      if (list.kind !== "extras" || list.id !== extraListId) continue;
      const item = list.items.find((candidate) => candidate.productId === productId);
      if (item !== undefined) return item;
    }
  return undefined;
}

/**
 * Each line's declarations from its version's menu's live version. A line the live version does not
 * hold exactly takes them from the newest earlier version that was once live and does, going no
 * further back than its own version, which is read last even if it was never live; a menu with no
 * live version starts at its newest once-live one. A line found in none is absent. Whether the menu
 * is sold now makes no difference.
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
  const menuOf = await menusOfVersions(tx, [
    ...new Set(versioned.map(({ versionId }) => versionId)),
  ]);
  const live = await readLiveDocuments(tx, [...new Set(menuOf.values())]);
  const missed = versioned.filter(({ line, versionId }) => {
    const document = live.get(menuOf.get(versionId) ?? "")?.document;
    const values = document && declarationsInDocument(document, line);
    if (values !== undefined) found.set(line.id, values);
    return values === undefined;
  });
  if (missed.length === 0) return found;
  const after = await onceLiveVersionsAfter(tx, [
    ...new Set(missed.map(({ versionId }) => versionId)),
  ]);
  const earlier = new Map(
    missed.map(({ versionId }) => {
      const later = after.get(versionId) ?? [];
      const liveId = live.get(menuOf.get(versionId) ?? "")?.versionId;
      return [versionId, [...later.slice(later.indexOf(liveId ?? "") + 1), versionId]] as const;
    }),
  );
  let waiting = missed.map(({ line, versionId }) => ({ line, versions: earlier.get(versionId)! }));
  for (let step = 0; waiting.length > 0; step += 1) {
    const recorded = await readRecordedDocuments(
      tx,
      waiting.map(({ versions }) => versions[step]!),
    );
    waiting = waiting.filter(({ line, versions }) => {
      const document = recorded.get(versions[step]!);
      const values = document && declarationsInDocument(document, line);
      if (values !== undefined) found.set(line.id, values);
      return values === undefined && step + 1 < versions.length;
    });
  }
  return found;
}
