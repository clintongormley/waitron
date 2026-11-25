import type { Transaction } from "@waitron/db";
import {
  applyLiveFields,
  extraDeclarationValues,
  readPublishedDeclarations,
  readRecordedDocuments,
  setMenuCopyHash,
  type PublishedLine,
} from "@waitron/menu";
import {
  AppError,
  type PublishedSetMenu,
  type ServedSetMenu,
  type ServedSetMenuCopy,
  type ServedSetMenuOffer,
} from "@waitron/shared";
import "./errors.js";

export function setMenuCopyKey(menuId: string, copy: PublishedSetMenu): string {
  return `${menuId}:${setMenuCopyHash(copy)}`;
}

export function serveSetMenuCopy(
  key: string,
  menuId: string,
  copy: PublishedSetMenu,
  offers: ServedSetMenuOffer[],
): ServedSetMenuCopy {
  return {
    key,
    menuId,
    name: copy.name,
    terms: copy.terms,
    changedAt: copy.changedAt,
    structure: copy.root,
    offers,
  };
}

type UnrankedCopy = Omit<ServedSetMenu, "newestOnSale">;

export function markNewestOnSale(copies: readonly UnrankedCopy[]): ServedSetMenu[] {
  const newest = new Map<string, UnrankedCopy>();
  for (const copy of copies) {
    if (!copy.orderable) continue;
    const current = newest.get(copy.menuId);
    if (
      current === undefined ||
      copy.changedAt > current.changedAt ||
      (copy.changedAt === current.changedAt && copy.key < current.key)
    ) {
      newest.set(copy.menuId, copy);
    }
  }
  return copies.map((copy) => ({ ...copy, newestOnSale: newest.get(copy.menuId) === copy }));
}

/**
 * Reads just the published copies a bill names, even after their full menus are republished.
 * `published` also reads the declarations published since, for a caller that shows them.
 */
export async function serveRecordedSetMenus(
  tx: Transaction,
  requests: readonly { versionId: string; menuId: string }[],
  declarations: "recorded" | "published" = "recorded",
): Promise<ServedSetMenuCopy[]> {
  const documents = await readRecordedDocuments(
    tx,
    requests.map(({ versionId }) => versionId),
  );
  const copies = requests.map(({ menuId, versionId }) => {
    const setMenus = documents.get(versionId)?.setMenus;
    if (setMenus === undefined || !Object.hasOwn(setMenus, menuId))
      throw new AppError("set_menu.not_found", { menuId });
    return { menuId, versionId, copy: setMenus[menuId]! };
  });
  const { setMenuOffers } = await applyLiveFields(
    tx,
    [],
    undefined,
    copies.map(({ copy }) => copy),
  );
  const recorded = copies.map(({ versionId, copy }) => ({
    versionId,
    offers: setMenuOffers.get(copy)!,
  }));
  const offers =
    declarations === "published"
      ? await withPublishedDeclarations(tx, recorded)
      : recorded.map((copy) => copy.offers);
  return copies.map(({ menuId, copy }, index) =>
    serveSetMenuCopy(setMenuCopyKey(menuId, copy), menuId, copy, offers[index]!),
  );
}

/** The offers with the declarations {@link readPublishedDeclarations} answers for a line ordered
 * from them, so the till shows what the kitchen does; with their own where it answers none. */
async function withPublishedDeclarations(
  tx: Transaction,
  copies: readonly { versionId: string; offers: ServedSetMenuOffer[] }[],
): Promise<ServedSetMenuOffer[][]> {
  const line = (
    menuVersionId: string,
    menuItemId: string,
    productId: string,
    extraListId: string | null = null,
  ): PublishedLine => ({
    id: [menuVersionId, menuItemId, productId, extraListId].join(":"),
    menuVersionId,
    menuItemId,
    productId,
    extraListId,
  });
  const published = await readPublishedDeclarations(
    tx,
    copies.flatMap(({ versionId, offers }) =>
      offers.flatMap((offer) => [
        ...[offer.productId, ...offer.variants.map(({ id }) => id)].map((id) =>
          line(versionId, offer.id, id),
        ),
        ...offer.offeredModifiers.flatMap((list) =>
          list.kind === "extras"
            ? list.items.map((item) => line(versionId, offer.id, item.productId, list.id))
            : [],
        ),
      ]),
    ),
  );
  return copies.map(({ versionId, offers }) =>
    offers.map((offer) => {
      const of = (productId: string, listId?: string) =>
        published.get(line(versionId, offer.id, productId, listId).id);
      return {
        ...offer,
        ...of(offer.productId),
        variants: offer.variants.map((variant) => ({ ...variant, ...of(variant.id) })),
        offeredModifiers: offer.offeredModifiers.map((list) =>
          list.kind === "extras"
            ? {
                ...list,
                items: list.items.map((item) => {
                  const values = of(item.productId, list.id);
                  return { ...item, ...(values && extraDeclarationValues(values)) };
                }),
              }
            : list,
        ),
      };
    }),
  );
}
