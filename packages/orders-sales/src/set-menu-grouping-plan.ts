import {
  centsToDecimal,
  decimalToCents,
  grossOf,
  groupSetMenus,
  setMenuOfferOf,
  thousandthsToDecimal,
  type ServedSetMenuCopy,
  type SetMenuGrouping,
  type SetMenuGroupingDish,
  type SetMenuGroupingInput,
} from "@waitron/shared";

export interface GroupingLine {
  id: string;
  lineNo: number;
  parentLineId: string | null;
  /** As a set menu lists it: a variant by its parent's id and its own. */
  listedProductId: string | null;
  listedVariantId: string | null;
  countsAsCourseId: string | null;
  menuItemId: string | null;
  /** Whole thousandths. */
  quantity: number;
  /** Its unit is a measure (g, ml…): never a set-menu dish (`set_menu.dish_sold_by_measure`). */
  soldByMeasure: boolean;
  /** Stamped by any comp or discount (D15). */
  listUnitPriceGross: number | null;
  unitPriceGross: number;
  lineTotal: number;
  aLaCarteUnitPrice: number | null;
  creditedTo: string | null;
  setMenuRole: "set_menu" | "dish" | null;
  setMenuId: string | null;
  setMenuVersionId: string | null;
  setMenuLineId: string | null;
  setMenuPlace: number | null;
  setMenuCountsAsCourseId: string | null;
}

export interface GroupingCopy {
  copy: ServedSetMenuCopy;
  versionId: string;
}

export interface GroupingDishUpdate {
  id: string;
  setMenuRole: "dish" | null;
  setMenuLineId: string | null;
  setMenuPlace: number | null;
  setMenuCountsAsCourseId: string | null;
  unitPriceGross: number;
  lineTotal: number;
}

export interface GroupingPlan {
  exact: boolean;
  inserts: {
    id: string;
    lineNo: number;
    copy: GroupingCopy;
    priceCents: number;
    creditedTo: string | null;
  }[];
  dishUpdates: GroupingDishUpdate[];
  menuUpdates: { id: string; priceCents: number; creditedTo: string | null }[];
  deletes: string[];
}

const ONE_PORTION = 1000;

/** D2/D15: a dish is frozen by one of its extras, a set-menu row by one of its dishes, and every
 *  dish of a frozen set-menu row with it. A row stamped with a list price counts as named. */
export function frozenLinesOf(
  lines: readonly GroupingLine[],
  named: ReadonlySet<string>,
): Set<string> {
  const frozen = new Set(named);
  for (const line of lines) if (line.listUnitPriceGross !== null) frozen.add(line.id);
  for (const line of lines) {
    if (line.parentLineId !== null && frozen.has(line.id)) frozen.add(line.parentLineId);
  }
  for (const line of lines) {
    if (line.setMenuLineId !== null && frozen.has(line.id)) frozen.add(line.setMenuLineId);
  }
  for (const line of lines) {
    if (line.setMenuLineId !== null && frozen.has(line.setMenuLineId)) frozen.add(line.id);
  }
  return frozen;
}

function isGroupingDish(line: GroupingLine, frozen: ReadonlySet<string>): boolean {
  return (
    !frozen.has(line.id) &&
    line.parentLineId === null &&
    line.setMenuRole !== "set_menu" &&
    line.listedProductId !== null &&
    line.aLaCarteUnitPrice !== null &&
    line.quantity === ONE_PORTION &&
    !line.soldByMeasure
  );
}

const A_LA_CARTE = {
  setMenuRole: null,
  setMenuLineId: null,
  setMenuPlace: null,
  setMenuCountsAsCourseId: null,
} as const;

/** An unfrozen dish the calculation is not handed still loses any place or charge a set menu gave
 *  it, or a resized or remeasured dish would keep a deleted set menu's price. */
function aLaCarteUpdate(line: GroupingLine): GroupingDishUpdate | null {
  if (line.parentLineId !== null || line.setMenuRole === "set_menu") return null;
  if (line.aLaCarteUnitPrice === null) return null;
  if (line.setMenuRole === null && line.unitPriceGross === line.aLaCarteUnitPrice) return null;
  return {
    id: line.id,
    ...A_LA_CARTE,
    unitPriceGross: line.aLaCarteUnitPrice,
    lineTotal: decimalToCents(
      grossOf(centsToDecimal(line.aLaCarteUnitPrice), thousandthsToDecimal(line.quantity)),
    ),
  };
}

function copyKey(copies: readonly GroupingCopy[], row: GroupingLine): string {
  const recorded = copies.find(
    ({ copy, versionId }) => copy.menuId === row.setMenuId && versionId === row.setMenuVersionId,
  );
  return recorded?.copy.key ?? `unrecorded:${row.setMenuVersionId}:${row.setMenuId}`;
}

function sameDish(line: GroupingLine, update: GroupingDishUpdate): boolean {
  return (
    line.setMenuRole === update.setMenuRole &&
    line.setMenuLineId === update.setMenuLineId &&
    line.setMenuPlace === update.setMenuPlace &&
    line.setMenuCountsAsCourseId === update.setMenuCountsAsCourseId &&
    line.unitPriceGross === update.unitPriceGross &&
    line.lineTotal === update.lineTotal
  );
}

/** {@link groupSetMenus} handed ids that sort in line order: it breaks ties between identical
 *  dishes by id, so random ids would pair the same bill differently each time. */
export function groupInLineOrder(
  lines: readonly GroupingLine[],
): (input: SetMenuGroupingInput) => SetMenuGrouping {
  const byLine = new Map(
    lines.map(({ id, lineNo }) => [id, `line-${String(lineNo).padStart(12, "0")}`]),
  );
  const byToken = new Map([...byLine].map(([id, token]) => [token, id]));
  const swap = (map: ReadonlyMap<string, string>) => (id: string) => map.get(id) ?? id;
  const remap = <T extends { id: string; place: { setMenuId: string } | null }>(
    dish: T,
    to: (id: string) => string,
  ): T => ({
    ...dish,
    id: to(dish.id),
    place: dish.place && { ...dish.place, setMenuId: to(dish.place.setMenuId) },
  });
  const to = swap(byLine);
  const back = swap(byToken);
  return (input) => {
    const result = groupSetMenus({
      ...input,
      dishes: input.dishes.map((dish) => ({ ...dish, id: to(dish.id) })),
      previous: input.previous && {
        setMenus: input.previous.setMenus.map((menu) => ({ ...menu, id: to(menu.id) })),
        dishes: input.previous.dishes.map((dish) => remap(dish, to)),
      },
    });
    return {
      ...result,
      setMenus: result.setMenus.map((menu) => ({ ...menu, id: back(menu.id) })),
      dishes: result.dishes.map((dish) => remap(dish, back)),
    };
  };
}

export function planBillGrouping(
  lines: readonly GroupingLine[],
  frozen: ReadonlySet<string>,
  copies: readonly GroupingCopy[],
  newId: () => string,
  calculate: (input: SetMenuGroupingInput) => SetMenuGrouping = groupInLineOrder(lines),
): GroupingPlan {
  const byId = new Map(lines.map((line) => [line.id, line]));
  const extrasCents = new Map<string, number>();
  for (const { parentLineId, lineTotal } of lines) {
    if (parentLineId !== null) {
      extrasCents.set(parentLineId, (extrasCents.get(parentLineId) ?? 0) + lineTotal);
    }
  }
  const groupingDishes = lines.filter((line) => isGroupingDish(line, frozen));
  const savedMenus = lines.filter(
    ({ id, setMenuRole }) => setMenuRole === "set_menu" && !frozen.has(id),
  );
  const savedIds = new Set(savedMenus.map(({ id }) => id));

  const dishes = groupingDishes.map((line): SetMenuGroupingDish => ({
    id: line.id,
    productId: line.listedProductId!,
    variantId: line.listedVariantId,
    courseId: line.countsAsCourseId ?? "",
    aLaCarteCents: line.aLaCarteUnitPrice!,
    extrasCents: extrasCents.get(line.id) ?? 0,
    eligible: line.countsAsCourseId !== null && line.menuItemId !== null,
  }));
  const input: SetMenuGroupingInput = {
    // A menu version id belongs to the whole published menu, so two recorded versions can hold one copy.
    offers: [...new Map(copies.map(({ copy }) => [copy.key, copy])).values()].map(setMenuOfferOf),
    dishes,
    discounts: [],
    previous:
      savedMenus.length === 0 && groupingDishes.length === 0
        ? null
        : {
            setMenus: savedMenus.map((row) => ({
              id: row.id,
              offerId: copyKey(copies, row),
              discountId: null,
            })),
            dishes: groupingDishes.map(({ id, setMenuLineId, setMenuPlace }) => ({
              id,
              place:
                setMenuLineId !== null && setMenuPlace !== null
                  ? { setMenuId: setMenuLineId, lineIndex: setMenuPlace }
                  : null,
            })),
          },
  };
  const result = calculate(input);

  const firstDish = new Map<string, GroupingLine>();
  for (const { id, place } of result.dishes) {
    if (!place) continue;
    const line = byId.get(id)!;
    const first = firstDish.get(place.setMenuId);
    if (!first || line.lineNo < first.lineNo) firstDish.set(place.setMenuId, line);
  }

  let lineNo = Math.max(0, ...lines.map((line) => line.lineNo));
  const rowIds = new Map<string, string>();
  const inserts: GroupingPlan["inserts"] = [];
  const menuUpdates: GroupingPlan["menuUpdates"] = [];
  const newMenus = result.setMenus
    .filter(({ id }) => !savedIds.has(id))
    .sort((a, b) => firstDish.get(a.id)!.lineNo - firstDish.get(b.id)!.lineNo);
  for (const menu of newMenus) {
    const id = newId();
    rowIds.set(menu.id, id);
    inserts.push({
      id,
      lineNo: ++lineNo,
      copy: copies.find(({ copy }) => copy.key === menu.offerId)!,
      priceCents: menu.baseCents - menu.discountCents,
      creditedTo: firstDish.get(menu.id)!.creditedTo,
    });
  }
  for (const menu of result.setMenus) {
    if (!savedIds.has(menu.id)) continue;
    rowIds.set(menu.id, menu.id);
    const row = byId.get(menu.id)!;
    const priceCents = menu.baseCents - menu.discountCents;
    const creditedTo = firstDish.get(menu.id)!.creditedTo;
    if (
      row.unitPriceGross !== priceCents ||
      row.lineTotal !== priceCents ||
      row.creditedTo !== creditedTo
    ) {
      menuUpdates.push({ id: menu.id, priceCents, creditedTo });
    }
  }

  const dishUpdates = result.dishes.flatMap(({ id, place, chargeCents }) => {
    const line = byId.get(id)!;
    const update: GroupingDishUpdate = {
      id,
      unitPriceGross: chargeCents,
      lineTotal: chargeCents,
      ...(place
        ? {
            setMenuRole: "dish",
            setMenuLineId: rowIds.get(place.setMenuId)!,
            setMenuPlace: place.lineIndex,
            setMenuCountsAsCourseId: line.countsAsCourseId,
          }
        : A_LA_CARTE),
    };
    return sameDish(line, update) ? [] : [update];
  });
  const grouped = new Set(groupingDishes.map(({ id }) => id));
  for (const line of lines) {
    if (frozen.has(line.id) || grouped.has(line.id)) continue;
    const update = aLaCarteUpdate(line);
    if (update !== null) dishUpdates.push(update);
  }

  const kept = new Set(result.setMenus.map(({ id }) => id));
  return {
    exact: result.exact,
    inserts,
    dishUpdates,
    menuUpdates,
    deletes: savedMenus.flatMap(({ id }) => (kept.has(id) ? [] : [id])),
  };
}
