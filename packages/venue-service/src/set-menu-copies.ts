import type { Transaction } from "@waitron/db";
import { applyLiveFields, readRecordedDocuments, setMenuCopyHash } from "@waitron/menu";
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

/** Reads just the published copies a bill names, even after their full menus are republished. */
export async function serveRecordedSetMenus(
  tx: Transaction,
  requests: readonly { versionId: string; menuId: string }[],
): Promise<ServedSetMenuCopy[]> {
  const documents = await readRecordedDocuments(
    tx,
    requests.map(({ versionId }) => versionId),
  );
  const copies = requests.map(({ menuId, versionId }) => {
    const setMenus = documents.get(versionId)?.setMenus;
    if (setMenus === undefined || !Object.hasOwn(setMenus, menuId))
      throw new AppError("set_menu.not_found", { menuId });
    return { menuId, copy: setMenus[menuId]! };
  });
  const { setMenuOffers } = await applyLiveFields(
    tx,
    [],
    undefined,
    copies.map(({ copy }) => copy),
  );
  return copies.map(({ menuId, copy }) =>
    serveSetMenuCopy(setMenuCopyKey(menuId, copy), menuId, copy, setMenuOffers.get(copy)!),
  );
}
