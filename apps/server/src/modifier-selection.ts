import { isDeepStrictEqual } from "node:util";
import { EACH_UNIT, validateExtraSelections, validateOptionSelections } from "@waitron/menu";
import {
  newCustomerText,
  AppError,
  compareDecimal,
  decimal,
  multiplyDecimal,
  resolveSnapshotText,
} from "@waitron/shared";
import { prepareUnitSnapshot } from "@waitron/menu/src/unit-presentation.js";
import type { OptionList, ResolvedExtraList, VatClass } from "@waitron/menu";
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
  takeawayVatClass: VatClass;
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
  /** The extra PRODUCT's own labels, never the dish's. Taken away, its line files at the product's
   * takeaway rate (`product_takeaway_vat_rates`), not `takeawayVatClass`. */
  vatClass: VatClass;
  takeawayVatClass: VatClass;
  /**
   * The picks for ONE dish, NOT multiplied by the dish count: `grossBasketWithOptions`
   * (`packages/menu/src/pricing.ts`) does that multiplication.
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
  retained?: ReadonlySet<string>,
): ((language: string, mode?: "new" | "recorded") => OptionSnapshot)[] {
  // The validator answers with ids drawn from the lists it was handed, so both lookups resolve.
  return validateOptionSelections(offered, requested ?? [])
    .filter(({ listId }) => !retained?.has(listId))
    .map((selection) => {
      const list = offered.find((candidate) => candidate.id === selection.listId)!;
      const label = list.labels.find((candidate) => candidate.id === selection.labelId)!;
      return (language, mode = "new") => {
        const customer = (text: Record<string, string> | null, staff: string) =>
          text === null
            ? null
            : mode === "recorded"
              ? { [language]: resolveSnapshotText(text, language, language) }
              : {
                  [language]: newCustomerText(text, staff, language, {
                    defaultLanguage: language,
                    languages: [language],
                  }),
                };
        return {
          listId: list.id,
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

function extraUnitSnapshot(
  unit: ResolvedExtraList["items"][number]["unit"],
  defaultLanguage: string,
) {
  const config = { defaultLanguage, languages: [defaultLanguage] };
  return {
    unitName: prepareUnitSnapshot(unit, config).abbreviation,
    unitPrecision: unit.precision,
    unitContext: {
      id: unit.id,
      name: {
        [defaultLanguage]: newCustomerText(unit.name, unit.staffName, defaultLanguage, config),
      },
      precision: unit.precision,
      hardwareUnit: unit.hardwareUnit,
    },
  };
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
          takeawayVatClass: product.takeawayVatClass,
          quantity: pick.quantity,
          physicalQuantity: multiplyDecimal(decimal(item.portion), decimal(String(pick.quantity))),
          priceQuantity: item.portion,
          ...extraUnitSnapshot(item.unit, defaultLanguage),
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

/** A frozen staff name is a one-entry map, keyed by the language it was frozen in. */
const staffName = (names: Record<string, string>) => Object.values(names)[0];

type AnswerFreezer = ReturnType<typeof answerFreezers>[number];

/** Whether `freeze` gives `held` in the language `held` was frozen in (the one key of its staff list
 * name). An unchanged answer keeps its recorded maps even when new fallback would produce different
 * text. */
function freezesTo(freeze: AnswerFreezer, held: OptionSnapshot): boolean {
  const [language] = Object.keys(held.listName);
  return (
    language !== undefined &&
    (isDeepStrictEqual(freeze(language), held) ||
      isDeepStrictEqual(freeze(language, "recorded"), held))
  );
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
  return editOptionAnswers(answerFreezers(offered, requested), stored, defaultLanguage);
}

function editOptionAnswers(
  answers: readonly AnswerFreezer[],
  stored: readonly OptionSnapshot[],
  defaultLanguage: string,
): OptionSnapshot[] | null {
  const kept = pairEach(answers, stored, freezesTo);
  if (answers.length === stored.length && kept.every((answer) => answer !== undefined)) return null;
  return answers.map((freeze, index) => kept[index] ?? freeze(defaultLanguage));
}

function sameStaffAnswer(held: OptionSnapshot, list: OptionList, labelName: string): boolean {
  return (
    held.listId === list.id &&
    staffName(held.listName) === list.name &&
    staffName(held.labelName) === labelName
  );
}

/** A sent dish can keep its recorded answers when every re-sent choice is one it already holds. */
export function asksNoNewAnswer(
  offered: readonly OptionList[],
  requested: unknown,
  stored: readonly OptionSnapshot[],
): boolean {
  if (!Array.isArray(requested)) return false;
  const listIds = new Set<string>();
  for (const entry of requested as unknown[]) {
    const { listId, labelId } = (entry ?? {}) as { listId?: unknown; labelId?: unknown };
    if (typeof listId !== "string" || typeof labelId !== "string") return false;
    const list = offered.find((candidate) => candidate.id === listId.toLowerCase());
    const label = list?.labels.find((candidate) => candidate.id === labelId.toLowerCase());
    if (
      list === undefined ||
      label === undefined ||
      listIds.has(list.id) ||
      !stored.some((held) => sameStaffAnswer(held, list, label.name))
    )
      return false;
    listIds.add(list.id);
  }
  return true;
}

/** An unsent dish keeps an answer that its own list no longer offers until staff replace it. */
export function editUnsentLineOptions(
  offered: readonly OptionList[],
  requested: unknown,
  stored: readonly OptionSnapshot[],
  defaultLanguage: string,
): OptionSnapshot[] | null {
  const activeIds = new Set(offered.filter((list) => list.active).map((list) => list.id));
  const heldByList = new Map(stored.map((held) => [held.listId, held]));
  const entries = (Array.isArray(requested) ? requested : []) as {
    listId?: unknown;
    labelId?: unknown;
  }[];
  const retained = new Set<string>();
  const listsToCheck = offered.map((list) => {
    const held = heldByList.get(list.id);
    if (
      !list.active ||
      held === undefined ||
      list.labels.some((label) => label.available && sameStaffAnswer(held, list, label.name))
    )
      return list;
    const entry = entries.find(
      (choice) => typeof choice?.listId === "string" && choice.listId.toLowerCase() === list.id,
    );
    if (entry === undefined) {
      retained.add(list.id);
      return { ...list, active: false };
    }
    const labelId = typeof entry.labelId === "string" ? entry.labelId.toLowerCase() : undefined;
    const withdrawn = list.labels.find(
      (label) =>
        !label.available && label.id === labelId && sameStaffAnswer(held, list, label.name),
    );
    if (withdrawn === undefined) return list;
    retained.add(list.id);
    // Let a stale till re-send this one label through the normal shape and duplicate checks.
    return {
      ...list,
      labels: list.labels.map((label) =>
        label === withdrawn ? { ...label, available: true } : label,
      ),
    };
  });

  const kept = stored.filter((held) => !activeIds.has(held.listId!) || retained.has(held.listId!));
  const replaced = stored.filter((held) => !kept.includes(held));
  const edited = editOptionAnswers(
    answerFreezers(listsToCheck, requested, retained),
    replaced,
    defaultLanguage,
  );
  if (edited === null) return null;
  const wordingOnly =
    edited.length === replaced.length &&
    edited.every((answer) => {
      const previous = heldByList.get(answer.listId);
      return (
        previous !== undefined &&
        staffName(previous.listName) === staffName(answer.listName) &&
        staffName(previous.labelName) === staffName(answer.labelName)
      );
    });
  if (wordingOnly) {
    const editedByList = new Map(edited.map((answer) => [answer.listId, answer]));
    return stored.map((answer) => editedByList.get(answer.listId) ?? answer);
  }
  return [...edited, ...kept];
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
  defaultLanguage: string,
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
        takeawayVatClass: product.takeawayVatClass,
        quantity: pick.quantity,
        physicalQuantity: multiplyDecimal(decimal(item.portion), decimal(String(pick.quantity))),
        priceQuantity: item.portion,
        ...extraUnitSnapshot(item.unit, defaultLanguage),
      });
    }
  }
  return { kept: [...kept.values()], added, removed: remaining };
}
