import { isDeepStrictEqual } from "node:util";
import { EACH_UNIT, validateExtraSelections, validateOptionSelections } from "@waitron/catalogue";
import { newCustomerText } from "@waitron/catalogue/src/new-customer-text.js";
import { prepareUnitSnapshot } from "@waitron/catalogue/src/unit-presentation.js";
import type { OptionList, ResolvedExtraList, VatClass } from "@waitron/catalogue";
import {
  AppError,
  compareDecimal,
  decimal,
  multiplyDecimal,
  resolveSnapshotText,
} from "@waitron/shared";
import type { OptionSnapshot } from "@waitron/shared";

/** A product offered as an extra, as the published offer serves it. */
export interface ExtraProductFacts {
  id: string;
  /** The plain staff name. */
  name: string;
  /** locale -> customer-facing text. */
  descriptions: Record<string, string>;
  kitchenName: string | null;
  vatClass: VatClass;
}

/**
 * One child line to be, per picked product. Every field is a copied value, so deleting a list or an
 * item cannot rewrite the order.
 */
export interface ExtraChild {
  productId: string;
  name: string;
  descriptions: Record<string, string>;
  kitchenName: string | null;
  /** GROSS, already resolved. */
  price: string;
  /** The list the pick was taken from, stored on the child line as `extra_list_id`. */
  listId: string;
  /** The extra PRODUCT's own class, never the dish's. */
  vatClass: VatClass;
  /**
   * The picks for ONE dish, NOT multiplied by the dish count: `grossBasketWithOptions`
   * (`packages/catalogue/src/pricing.ts`) does that multiplication.
   */
  quantity: number;
  physicalQuantity?: string;
  priceQuantity?: string;
  unitName?: Record<string, string>;
  unitPrecision?: number;
  unitContext?: {
    id: string;
    name: Record<string, string>;
    precision: number;
    hardwareUnit: "kg" | "g" | "mg" | null;
  };
}

/**
 * One function per validated options answer, in the offered order, freezing that answer in the
 * language it is given.
 */
function answerFreezers(
  offered: readonly OptionList[],
  requested: unknown,
): ((language: string, mode?: "new" | "recorded") => OptionSnapshot)[] {
  // The validator answers with ids drawn from the lists it was handed, so both lookups resolve.
  return validateOptionSelections(offered, requested ?? []).map((selection) => {
    const list = offered.find((candidate) => candidate.id === selection.listId)!;
    const label = list.labels.find((candidate) => candidate.id === selection.labelId)!;
    return (language, mode = "new") => {
      const customer = (text: Record<string, string> | null, staff: string) =>
        mode === "recorded"
          ? text === null
            ? null
            : { [language]: resolveSnapshotText(text, language, language) }
          : {
              [language]: newCustomerText(text, staff, language, {
                defaultLanguage: language,
                languages: [language],
              }),
            };
      return {
        listName: { [language]: list.name },
        listCustomerName: customer(list.customerName, list.name),
        listKitchenName: list.kitchenName,
        labelName: { [language]: label.name },
        labelCustomerName: customer(label.customerName, label.name),
        labelKitchenName: label.kitchenName,
      };
    };
  });
}

/**
 * Validate one line's answers to the extras and options lists its dish offers, and freeze them:
 * options into `OptionSnapshot`s for the dish line's own column, extras into child lines.
 *
 * `defaultLanguage` is the language the plain staff names widen under, because an `OptionSnapshot`
 * holds locale -> text maps where an `OptionList`/`OptionLabel` holds a `string`, and the one
 * language the two customer maps are narrowed to.
 *
 * `products` must hold every product an ACTIVE list in `offered.extras` offers. A missing one is
 * refused with `product.not_found` rather than skipped, because dropping a picked extra would serve
 * it unbilled.
 */
export function buildLineExtras(
  offered: { extras: readonly ResolvedExtraList[]; options: readonly OptionList[] },
  products: ReadonlyMap<string, ExtraProductFacts>,
  requested: { extras?: unknown; options?: unknown },
  defaultLanguage: string,
): { extraChildren: ExtraChild[]; optionSnapshots: OptionSnapshot[] } {
  const optionSnapshots = answerFreezers(offered.options, requested.options).map((freeze) =>
    freeze(defaultLanguage),
  );

  // `validateExtraSelections` answers with ids drawn from the lists it was handed, so every lookup
  // below that re-finds one of those ids resolves.
  const extraChildren = validateExtraSelections(offered.extras, requested.extras ?? []).flatMap(
    (selection): ExtraChild[] => {
      const list = offered.extras.find((candidate) => candidate.id === selection.listId)!;
      return selection.picks.map((pick): ExtraChild => {
        const item = list.items.find((candidate) => candidate.productId === pick.productId)!;
        const product = products.get(pick.productId);
        if (product === undefined) {
          throw new AppError("product.not_found", { productId: pick.productId });
        }
        return {
          productId: product.id,
          name: product.name,
          descriptions: product.descriptions,
          kitchenName: product.kitchenName,
          price: item.price,
          listId: list.id,
          vatClass: product.vatClass,
          quantity: pick.quantity,
          physicalQuantity: multiplyDecimal(decimal(item.portion), decimal(String(pick.quantity))),
          priceQuantity: item.portion,
          unitName: prepareUnitSnapshot(item.unit, {
            defaultLanguage,
            languages: [defaultLanguage],
          }).abbreviation,
          unitPrecision: item.unit.precision,
          unitContext: {
            id: item.unit.id,
            name: {
              [defaultLanguage]: newCustomerText(
                item.unit.name,
                item.unit.staffName,
                defaultLanguage,
                {
                  defaultLanguage,
                  languages: [defaultLanguage],
                },
              ),
            },
            precision: item.unit.precision,
            hardwareUnit: item.unit.hardwareUnit,
          },
        };
      });
    },
  );

  return { extraChildren, optionSnapshots };
}

/**
 * The candidate each entry pairs with, `undefined` where it pairs with none, pairing as many entries
 * as any assignment can: an entry takes a free candidate, or one whose holder can move to another.
 */
function pairEach<Entry, Candidate>(
  entries: readonly Entry[],
  candidates: readonly Candidate[],
  matches: (entry: Entry, candidate: Candidate) => boolean,
): (Candidate | undefined)[] {
  const holder: (number | undefined)[] = candidates.map(() => undefined);
  const claim = (entry: number, tried: Set<number>): boolean =>
    candidates.some((candidate, index) => {
      if (tried.has(index) || !matches(entries[entry]!, candidate)) return false;
      tried.add(index);
      const current = holder[index];
      if (current !== undefined && !claim(current, tried)) return false;
      holder[index] = entry;
      return true;
    });
  entries.forEach((_, entry) => claim(entry, new Set()));
  const paired: (Candidate | undefined)[] = entries.map(() => undefined);
  holder.forEach((entry, index) => {
    if (entry !== undefined) paired[entry] = candidates[index];
  });
  return paired;
}

/**
 * The options answer to an edit of a SAVED line, or `null` when the edit gives the answers the line
 * already holds. A stored answer is kept as it is when an answer of the edit, frozen in the language
 * the stored one was frozen in (the one key of its staff list name), equals it; so a later change of
 * the venue's default content language moves no unchanged answer. Every other answer is frozen in
 * `defaultLanguage`.
 *
 * Compared BY VALUE — not by JSON key order, send order or offered order, because the offered
 * order is a stored position a save re-numbers. A RENAMED list still differs, deliberately.
 * Receipt: docs/developers/modifiers.md.
 */
export function editLineOptions(
  offered: readonly OptionList[],
  requested: unknown,
  stored: readonly OptionSnapshot[],
  defaultLanguage: string,
): OptionSnapshot[] | null {
  const answers = answerFreezers(offered, requested);
  const kept = pairEach(answers, stored, (freeze, answer) => {
    const [language] = Object.keys(answer.listName);
    // An unchanged answer keeps its recorded maps even when new fallback would produce different text.
    return (
      language !== undefined &&
      (isDeepStrictEqual(freeze(language), answer) ||
        isDeepStrictEqual(freeze(language, "recorded"), answer))
    );
  });
  if (answers.length === stored.length && kept.every((answer) => answer !== undefined)) return null;
  return answers.map((freeze, index) => kept[index] ?? freeze(defaultLanguage));
}

/** One pick as a request names it, read leniently: a malformed one is left to the validator. */
export function namedPicks(
  requested: unknown,
): { listId: string; productId: string; quantity: number }[] {
  if (!Array.isArray(requested)) return [];
  return requested.flatMap((entry: unknown) => {
    const { listId, picks } = (entry ?? {}) as { listId?: unknown; picks?: unknown };
    if (typeof listId !== "string" || !Array.isArray(picks)) return [];
    return picks.flatMap((pick: unknown) => {
      const { productId, quantity } = (pick ?? {}) as { productId?: unknown; quantity?: unknown };
      return typeof productId === "string" && typeof quantity === "number"
        ? [{ listId: listId.toLowerCase(), productId: productId.toLowerCase(), quantity }]
        : [];
    });
  });
}

/**
 * The extras answer to an edit of a SAVED line (plan D10). A pick that names a stored child's list,
 * product and per-dish quantity keeps that child, and is accepted even where its list no longer
 * offers it at that quantity, or at all (spec §11.7 example 7). Every other pick is NEW: it must be
 * offered by an active list in `offered` now, and it is priced from that list. A stored child no pick
 * keeps is removed. The lists' own rules apply to the kept and new picks together, except that the
 * kept picks alone may exceed a cap the list has since lowered.
 *
 * `dishQuantity` is the STORED dish count; a child's stored quantity is it times the per-dish picks.
 */
export function editLineExtras<
  Child extends {
    productId: string | null;
    extraListId: string | null;
    quantity: string;
    priceQuantity?: string;
  },
>(
  offered: readonly ResolvedExtraList[],
  products: ReadonlyMap<string, ExtraProductFacts>,
  requested: unknown,
  stored: { children: readonly Child[]; dishQuantity: string },
): { kept: { child: Child; perDish: number }[]; added: ExtraChild[]; removed: Child[] } {
  const dish = decimal(stored.dishQuantity);
  const remaining = [...stored.children];
  const kept = new Map<string, { child: Child; perDish: number }>();
  for (const pick of namedPicks(requested)) {
    const index = remaining.findIndex(
      (child) =>
        child.extraListId === pick.listId &&
        child.productId === pick.productId &&
        compareDecimal(
          multiplyDecimal(
            multiplyDecimal(dish, decimal(String(pick.quantity))),
            decimal(child.priceQuantity ?? "1"),
          ),
          decimal(child.quantity),
        ) === 0,
    );
    if (index < 0) continue;
    kept.set(`${pick.listId}\u0000${pick.productId}`, {
      child: remaining[index]!,
      perDish: pick.quantity,
    });
    remaining.splice(index, 1);
  }

  // The lists the picks are checked against: the live ones, plus each kept pick where the live list
  // no longer offers it as the line holds it.
  const lists = offered.map((list) => ({ ...list, items: [...list.items] }));
  for (const { child, perDish } of kept.values()) {
    let list = lists.find((candidate) => candidate.active && candidate.id === child.extraListId);
    if (list === undefined) {
      list = {
        id: child.extraListId!,
        name: "",
        customerName: null,
        kitchenName: null,
        minPicks: 0,
        maxPicks: null,
        active: true,
        items: [],
      };
      lists.push(list);
    }
    const index = list.items.findIndex((item) => item.productId === child.productId);
    if (index < 0) {
      list.items.push({
        id: "",
        productId: child.productId!,
        maxQuantity: perDish,
        preselected: false,
        price: "0.00",
        portion: child.priceQuantity ?? "1",
        unit: EACH_UNIT,
      });
    } else {
      const item = list.items[index]!;
      list.items[index] = {
        ...item,
        maxQuantity: item.maxQuantity === null ? null : Math.max(item.maxQuantity, perDish),
      };
    }
    const keptOnList = [...kept.values()]
      .filter((entry) => entry.child.extraListId === list.id)
      .reduce((total, entry) => total + entry.perDish, 0);
    if (list.maxPicks !== null && keptOnList > list.maxPicks) list.maxPicks = keptOnList;
  }

  const added: ExtraChild[] = [];
  for (const selection of validateExtraSelections(lists, requested ?? [])) {
    for (const pick of selection.picks) {
      if (kept.has(`${selection.listId}\u0000${pick.productId}`)) continue;
      // A list or item added above holds only kept picks, so a new pick names a live one.
      const list = offered.find(
        (candidate) => candidate.active && candidate.id === selection.listId,
      )!;
      const item = list.items.find((candidate) => candidate.productId === pick.productId)!;
      // `products` holds every product a live list offers.
      const product = products.get(pick.productId)!;
      added.push({
        productId: product.id,
        name: product.name,
        descriptions: product.descriptions,
        kitchenName: product.kitchenName,
        price: item.price,
        listId: list.id,
        vatClass: product.vatClass,
        quantity: pick.quantity,
        physicalQuantity: multiplyDecimal(decimal(item.portion), decimal(String(pick.quantity))),
        priceQuantity: item.portion,
        unitName: item.unit.abbreviation,
        unitPrecision: item.unit.precision,
        unitContext: {
          id: item.unit.id,
          name: item.unit.name,
          precision: item.unit.precision,
          hardwareUnit: item.unit.hardwareUnit,
        },
      });
    }
  }
  return { kept: [...kept.values()], added, removed: remaining };
}
