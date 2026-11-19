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
): Promise<SetMenuOfferLookup> {
  const requests = new Map<string, { menuId: string; versionId: string }>();
  for (const { setMenuId, menuVersionId } of lines) {
    if (menuVersionId !== null) {
      requests.set(`${menuVersionId}:${setMenuId}`, {
        menuId: setMenuId,
        versionId: menuVersionId,
      });
    }
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
  for (const { menuId, versionId } of requests.values()) {
    const fullMenuId = documents.get(versionId)?.menuId;
    if (fullMenuId === undefined) {
      throw new AppError("management.request_invalid", { field: "menuVersionId" });
    }
    const expected = recorded.get(menuId) ?? live.get(fullMenuId) ?? null;
    if (versionId !== expected) changed.set(fullMenuId, expected);
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
