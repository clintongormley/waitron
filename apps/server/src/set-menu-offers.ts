import type { Transaction } from "@waitron/db";
import { readRecordedDocuments } from "@waitron/menu";
import type { ZoneMenu, ZoneMenuOffer } from "@waitron/module";
import { AppError, setMenuCopyOf, type SetMenuCopy } from "@waitron/shared";
import { serveRecordedSetMenus } from "@waitron/venue-service";
import { readBillSetMenuVersions } from "./set-menu-bill.js";
import "./errors.js";

interface SetMenuLineOffer {
  setMenuId: string;
  menuVersionId: string | null;
  menuItemId: string;
  allowStale?: boolean;
}

export interface SetMenuOfferLookup {
  offerFor(
    line: SetMenuLineOffer,
  ): { offer: ZoneMenuOffer; copy: SetMenuCopy; fromRecordedCopy: boolean } | undefined;
}

/** Use the zone menus the caller already loaded to validate the basket's versions. */
export async function setMenuOfferLookup(
  tx: Transaction,
  workingOrderId: string | null,
  lines: readonly SetMenuLineOffer[],
  zoneMenus: readonly Pick<ZoneMenu, "id" | "versionId">[],
  stale: "refuse" | "hide" = "refuse",
): Promise<SetMenuOfferLookup> {
  const requests = new Map<string, { menuId: string; versionId: string; allowStale: boolean }>();
  for (const { setMenuId, menuVersionId, allowStale } of lines) {
    if (menuVersionId === null) continue;
    const key = `${menuVersionId}:${setMenuId}`;
    requests.set(key, {
      menuId: setMenuId,
      versionId: menuVersionId,
      allowStale:
        stale === "hide" || (allowStale === true && requests.get(key)?.allowStale !== false),
    });
  }
  if (requests.size === 0) return { offerFor: () => undefined };
  const recorded =
    workingOrderId === null
      ? new Map<string, string>()
      : await readBillSetMenuVersions(tx, workingOrderId);
  const documents = await readRecordedDocuments(
    tx,
    [...requests.values()].map(({ versionId }) => versionId),
  );
  const live = new Map(zoneMenus.map(({ id, versionId }) => [id, versionId]));
  const changed = new Map<string, string | null>();
  for (const [key, { menuId, versionId, allowStale }] of requests) {
    const fullMenuId = documents.get(versionId)?.menuId;
    if (fullMenuId === undefined) {
      if (allowStale) {
        requests.delete(key);
        continue;
      }
      throw new AppError("management.request_invalid", { field: "menuVersionId" });
    }
    const liveVersionId = live.get(fullMenuId) ?? null;
    const expected = recorded.get(menuId) ?? liveVersionId;
    if (versionId !== expected) {
      if (allowStale) requests.delete(key);
      else changed.set(fullMenuId, liveVersionId);
    }
  }
  if (changed.size > 0) {
    throw new AppError("menu.version_changed", {
      menus: [...changed].map(([menuId, liveVersionId]) => ({ menuId, liveVersionId })),
    });
  }
  const usable = [...requests].filter(([, { menuId, versionId }]) =>
    Object.hasOwn(documents.get(versionId)?.setMenus ?? {}, menuId),
  );
  const served =
    usable.length === 0
      ? []
      : await serveRecordedSetMenus(
          tx,
          usable.map(([, request]) => request),
        );
  const byCopy = new Map(
    usable.map(([key, { menuId, versionId }], i) => {
      const snapshot = served[i]!;
      const doc = documents.get(versionId)!;
      return [
        key,
        {
          copy: setMenuCopyOf(snapshot, versionId),
          fromRecordedCopy: recorded.get(menuId) === versionId,
          offers: new Map(
            snapshot.offers.map((offer) => [
              offer.id,
              { ...offer, menuId: doc.menuId, menuName: doc.menuName } satisfies ZoneMenuOffer,
            ]),
          ),
        },
      ];
    }),
  );
  return {
    offerFor({ setMenuId, menuVersionId, menuItemId }) {
      const entry = byCopy.get(`${menuVersionId}:${setMenuId}`);
      if (entry === undefined) return undefined;
      const offer = entry.offers.get(menuItemId);
      return offer === undefined
        ? undefined
        : { offer, copy: entry.copy, fromRecordedCopy: entry.fromRecordedCopy };
    },
  };
}

export function assertSetMenuPortion(offer: ZoneMenuOffer, variantId: string | null): void {
  const variant = offer.variants.find(({ id }) => id === variantId);
  if ((variant?.unit ?? offer.unit).measure === true)
    throw new AppError("set_menu.dish_sold_by_measure", {
      productId: variant?.id ?? offer.productId,
    });
}
