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
): ((language: string, mode?: "new" | "recorded") => OptionSnapshot)[] {
  // The validator answers with ids drawn from the lists it was handed, so both lookups resolve.
  return validateOptionSelections(offered, requested ?? []).map((selection) => {
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
  const answers = answerFreezers(offered, requested);
  const kept = pairEach(answers, stored, freezesTo);
  if (answers.length === stored.length && kept.every((answer) => answer !== undefined)) return null;
  return answers.map((freeze, index) => kept[index] ?? freeze(defaultLanguage));
}

/**
 * Whether every answer `requested` names is one `stored` holds, by the staff names of its list and
 * label: the till re-derives a stored answer by those names alone, and leaves out a list it cannot
 * match, so such a request asks for nothing new. A malformed request, one naming an id `offered`
 * does not carry, or one naming a list twice (which the validator refuses) answers false.
 */
export function asksNoNewAnswer(
  offered: readonly OptionList[],
  requested: unknown,
  stored: readonly OptionSnapshot[],
): boolean {
  if (!Array.isArray(requested)) return false;
  const named: { list: string; label: string }[] = [];
  const listIds = new Set<string>();
  for (const entry of requested as unknown[]) {
    const { listId, labelId } = (entry ?? {}) as { listId?: unknown; labelId?: unknown };
    if (typeof listId !== "string" || typeof labelId !== "string") return false;
    if (listIds.has(listId.toLowerCase())) return false;
    listIds.add(listId.toLowerCase());
    const list = offered.find((candidate) => candidate.id === listId.toLowerCase());
    const label = list?.labels.find((candidate) => candidate.id === labelId.toLowerCase());
    if (list === undefined || label === undefined) return false;
    named.push({ list: list.name, label: label.name });
  }
  return pairEach(
    named,
    stored,
    (answer, held) =>
      staffName(held.listName) === answer.list && staffName(held.labelName) === answer.label,
  ).every((held) => held !== undefined);
}

/** The active lists `requested` answers with an available label, each with its answer. A malformed
 * request or entry answers nothing here, and is left to the validator. */
function answeredLists(
  offered: readonly OptionList[],
  requested: unknown,
): { list: OptionList; answer: { listId: string; labelId: string } }[] {
  const entries: unknown[] = Array.isArray(requested) ? requested : [];
  return offered.flatMap((list) => {
    if (!list.active) return [];
    for (const entry of entries) {
      const { listId, labelId } = (entry ?? {}) as { listId?: unknown; labelId?: unknown };
      if (typeof listId !== "string" || typeof labelId !== "string") continue;
      if (listId.toLowerCase() !== list.id) continue;
      const label = list.labels.find(
        (candidate) => candidate.available && candidate.id === labelId.toLowerCase(),
      );
      return label === undefined ? [] : [{ list, answer: { listId: list.id, labelId: label.id } }];
    }
    return [];
  });
}

/**
 * Whether a request {@link asksNoNewAnswer} accepted re-sends every stored answer the menu still
 * matches, at least one stored answer is left unmatched, and the dish has no more active lists than
 * the line holds answers. Answers are counted, never tied to a list: a frozen answer holds no ids,
 * and two lists can share a staff name.
 */
export function onlyStoredAnswersUnmatched(
  offered: readonly OptionList[],
  requested: unknown,
  stored: readonly OptionSnapshot[],
): boolean {
  const active = offered.filter((list) => list.active);
  const matched = pairEach(
    stored,
    active,
    (held, list) =>
      list.name === staffName(held.listName) &&
      list.labels.some((label) => label.available && label.name === staffName(held.labelName)),
  ).filter((list) => list !== undefined).length;
  return (
    matched < stored.length &&
    answeredLists(offered, requested).length === matched &&
    active.length <= stored.length
  );
}

/**
 * `stored` with each answer `requested` re-sends brought up to today's wording, or `null` when none
 * differs. Everything else stays as stored and in its place, including an answer re-sent with a label
 * since withdrawn.
 */
function refreshResentAnswers(
  offered: readonly OptionList[],
  requested: unknown,
  stored: readonly OptionSnapshot[],
  defaultLanguage: string,
): OptionSnapshot[] | null {
  const answered = answeredLists(offered, requested);
  const freezers = answerFreezers(
    answered.map(({ list }) => list),
    answered.map(({ answer }) => answer),
  );
  const slots = stored.map((held, index) => ({ held, index }));
  const unchanged = pairEach(freezers, slots, (freeze, { held }) => freezesTo(freeze, held));
  const reworded = freezers
    .filter((_, index) => unchanged[index] === undefined)
    .map((freeze) => freeze(defaultLanguage));
  if (reworded.length === 0) return null;
  const taken = new Set(unchanged.map((slot) => slot?.index));
  const refreshed = [...stored];
  // Every re-sent answer pairs: asksNoNewAnswer found each a stored answer of the same staff names.
  pairEach(
    reworded,
    slots.filter(({ index }) => !taken.has(index)),
    (answer, { held }) =>
      staffName(answer.listName) === staffName(held.listName) &&
      staffName(answer.labelName) === staffName(held.labelName),
  ).forEach((slot, index) => {
    refreshed[slot!.index] = reworded[index]!;
  });
  return refreshed;
}

/**
 * The stored answers left over once each active list is paired with one answer under its staff name,
 * the answers `edited` keeps being paired first so that none is carried twice. A frozen answer holds
 * no ids, so of two answers under one name either may be the one left over. None is left over while
 * an active list finds no answer: that list may be a gone one, renamed.
 */
function answersOfGoneLists(
  offered: readonly OptionList[],
  stored: readonly OptionSnapshot[],
  edited: readonly OptionSnapshot[],
): OptionSnapshot[] {
  const slots = stored.map((held) => ({ held }));
  const paired = pairEach(
    offered.filter((list) => list.active),
    [
      ...slots.filter(({ held }) => edited.includes(held)),
      ...slots.filter(({ held }) => !edited.includes(held)),
    ],
    (list, { held }) => list.name === staffName(held.listName),
  );
  if (paired.includes(undefined)) return [];
  return slots.filter((slot) => !paired.includes(slot)).map(({ held }) => held);
}

/**
 * {@link editLineOptions} for a line not yet sent, on a whole-order save. When only stored answers the
 * menu no longer matches are missing from the request ({@link onlyStoredAnswersUnmatched}), those stay
 * as stored and the re-sent ones are compared as usual. Otherwise the request is validated and applied
 * as usual, and the answers of lists gone from the dish are kept as {@link answersOfGoneLists} allows.
 */
export function editUnsentLineOptions(
  offered: readonly OptionList[],
  requested: unknown,
  stored: readonly OptionSnapshot[],
  defaultLanguage: string,
): OptionSnapshot[] | null {
  if (
    asksNoNewAnswer(offered, requested, stored) &&
    onlyStoredAnswersUnmatched(offered, requested, stored)
  )
    return refreshResentAnswers(offered, requested, stored, defaultLanguage);
  const edited = editLineOptions(offered, requested, stored, defaultLanguage);
  return edited === null ? null : [...edited, ...answersOfGoneLists(offered, stored, edited)];
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
