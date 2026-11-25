import type {
  MenuState,
  MenuUnavailable,
  TillMenuOffer,
  TillProduct,
  TillZoneMenu,
  ZoneOffers,
} from "../api/client.js";
import { menuOfferToTillProduct } from "../api/client.js";
import { endedPeriodOf, type EndedPeriod } from "./late-send.js";
import { type BlockReason, lineBlock, withUnavailable } from "./menu-refresh.js";
import {
  lookupSetMenuLine,
  orderingCopies,
  ownSetMenuOffer,
  type OrderingCopy,
  type SetMenuLine,
  type SetMenuOfferLookup,
} from "./set-menus.js";
import type { OrderLine } from "./working-order.js";

/** Whether menu membership, versions, selection eligibility or ended periods differ from the loaded
 * snapshot. */
export function menusMoved(loaded: readonly TillZoneMenu[], polled: MenuState["menus"]): boolean {
  return (
    loaded.length !== polled.length ||
    polled.some((menu) => {
      const own = loaded.find((entry) => entry.id === menu.menuId);
      return (
        own?.versionId !== menu.versionId ||
        own.orderable !== menu.orderable ||
        own.endedPeriodName !== menu.endedPeriodName
      );
    })
  );
}

/** The offers a zone sells now: as loaded, or with the latest poll's unavailable set applied. */
export class ZoneOfferIndex {
  #loaded: TillMenuOffer[] = [];
  #loadedSetMenus: NonNullable<ZoneOffers["setMenus"]> = [];
  #sellingVersions = new Set<string>();
  setMenus: NonNullable<ZoneOffers["setMenus"]> = [];
  /** The set last applied, as a sorted key, so an unchanged poll answer rebuilds nothing. */
  #unavailableKey: string | null = null;
  /** The offers with the latest unavailable set applied, kept rather than rebuilt at each read. */
  live: TillMenuOffer[] = [];
  byId = new Map<string, TillMenuOffer>();
  versions = new Map<string, string>();
  readonly menuOfVersion = new Map<string, string>();
  selectable = new Set<string>();
  /** Each menu whose period ended earlier today, to that period's name. */
  ended = new Map<string, string>();
  /** False after a load that failed, when there is nothing to judge a line against. */
  loaded = false;
  liveFields: string | undefined;

  load(
    zoneOffers: Pick<ZoneOffers, "offers" | "menus" | "liveFields" | "setMenus">,
    loaded = true,
  ): void {
    this.selectable = new Set(
      zoneOffers.menus.filter((menu) => menu.orderable).map((menu) => menu.id),
    );
    this.ended = new Map(
      zoneOffers.menus.flatMap((menu) =>
        menu.endedPeriodName === null ? [] : [[menu.id, menu.endedPeriodName] as const],
      ),
    );
    this.#loaded = zoneOffers.offers;
    this.#loadedSetMenus = zoneOffers.setMenus ?? [];
    this.setMenus = this.#loadedSetMenus;
    this.#sellingVersions = new Set(
      zoneOffers.menus.filter((menu) => menu.orderable).map((menu) => menu.versionId),
    );
    this.#unavailableKey = null;
    this.#setLive(zoneOffers.offers);
    this.versions = new Map(zoneOffers.menus.map((menu) => [menu.id, menu.versionId]));
    for (const menu of zoneOffers.menus) this.menuOfVersion.set(menu.versionId, menu.id);
    this.liveFields = zoneOffers.liveFields;
    this.loaded = loaded;
  }

  /** Whether the set differs from the one last applied; only then is it applied. */
  setUnavailable(unavailable: MenuUnavailable): boolean {
    const key = JSON.stringify([
      [...unavailable.products].sort(),
      [...unavailable.optionLabels].sort(),
    ]);
    if (key === this.#unavailableKey) return false;
    this.#unavailableKey = key;
    this.#setLive(withUnavailable(this.#loaded, unavailable));
    this.setMenus = this.#loadedSetMenus.map((copy) => ({
      ...copy,
      offers: withUnavailable(copy.offers, unavailable),
    }));
    return true;
  }

  #setLive(live: TillMenuOffer[]): void {
    this.live = live;
    this.byId = new Map(live.map((offer) => [offer.id, offer]));
  }

  products(): TillProduct[] {
    return this.live.map((offer) => menuOfferToTillProduct(offer, this.versions.get(offer.menuId)));
  }

  ordering(bill: Parameters<typeof orderingCopies>[0]): readonly OrderingCopy[] {
    return orderingCopies(bill, this.setMenus, this.#sellingVersions);
  }

  setMenuLookup(bill?: Parameters<typeof orderingCopies>[0]): SetMenuOfferLookup {
    const copies = new Map(
      orderingCopies(bill, this.setMenus, this.#sellingVersions).map((row) => [
        row.copy.menuId,
        row,
      ]),
    );
    return (line) => {
      const { setMenuId, menuItemId, menuVersionId } = line;
      if (setMenuId === undefined) return undefined;
      const recorded = Object.hasOwn(bill?.setMenus?.recorded ?? {}, setMenuId);
      const held =
        menuVersionId === null || recorded
          ? undefined
          : this.setMenus.find(
              (copy) => copy.menuId === setMenuId && copy.versionIds.includes(menuVersionId),
            );
      const selected =
        held !== undefined && menuVersionId !== null
          ? { copy: held, versionId: menuVersionId }
          : copies.get(setMenuId);
      // Bill reads apply availability to recorded copies, including dishes absent from the zone.
      const offer = selected?.copy.offers.find((dish) => dish.id === menuItemId);
      if (selected === undefined || offer === undefined) return undefined;
      const sold = { offer, versionId: selected.versionId };
      return { ...sold, own: ownSetMenuOffer(line, sold, this) };
    };
  }

  /** For the declarations a line shows, whether or not it can still be sold. */
  ownSetMenuLookup(bill?: Parameters<typeof orderingCopies>[0]) {
    const lookup = this.setMenuLookup(bill);
    return (line: SetMenuLine) => ownSetMenuOffer(line, lookup(line), this);
  }

  /** Why each line cannot be sold as it stands. A line with no menu version is the server's to price
   * from the live version, so a missing offer marks only a line that came from a versioned one. */
  blocks(
    lines: readonly OrderLine[],
    setMenuOffer?: SetMenuOfferLookup,
  ): (BlockReason | undefined)[] {
    return lines.map((line) => {
      if (!this.loaded || line.workingOrderLineId !== undefined) return undefined;
      if (line.setMenuId !== undefined)
        return lineBlock(line, lookupSetMenuLine(line, setMenuOffer)?.offer)?.reason;
      const offer = this.byId.get(line.product.menuItemId ?? "");
      if (offer === undefined && line.product.menuVersionId === undefined) return undefined;
      return (
        lineBlock(line, offer)?.reason ??
        (offer !== undefined && !this.selectable.has(offer.menuId) && !this.ended.has(offer.menuId)
          ? "period_ended"
          : undefined)
      );
    });
  }

  /** The ended period each line is marked with; nothing while the offers could not be read. */
  endedPeriods(lines: readonly OrderLine[]): (EndedPeriod | undefined)[] {
    return lines.map((line) =>
      this.loaded && line.setMenuId === undefined ? endedPeriodOf(line, this) : undefined,
    );
  }
}
