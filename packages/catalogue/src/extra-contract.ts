import { AppError, contentLanguageCode, decimal, isUuid, toScale } from "@waitron/shared";
import type { ExtraSelection } from "@waitron/shared";
import { MAX_MODIFIER_INTEGER, isProductPrice } from "./modifier-limits.js";
import { nonBlankTranslations } from "./product-presentation.js";
import "./errors.js";

export type { ExtraSelection } from "@waitron/shared";

/**
 * One product a list offers. The row holds nothing that duplicates the product: its three names,
 * VAT class, allergens, dietary labels and photo all come from the `products` row it names, so this
 * carries only the terms of the OFFER — how many the diner may take, whether it starts picked, and a
 * price that overrides the product's own.
 */
export interface ExtraListItem {
  id: string;
  productId: string;
  /** Per-dish cap for this product; at least 1, where 1 means "one or none". */
  maxQuantity: number;
  preselected: boolean;
  /** null means "charge the product's own `unitPrice`" — see `resolveExtraPrice` in extras.ts. */
  price: string | null;
}

/**
 * A reusable, named list of products the diner may add to a dish. `minPicks` 0 makes the list
 * optional and 1 or more makes it required; `maxPicks` null leaves it uncapped.
 */
export interface ExtraList {
  id: string;
  name: string;
  customerName: Record<string, string> | null;
  kitchenName: string | null;
  minPicks: number;
  maxPicks: number | null;
  active: boolean;
  /** Presentation order: the caller writes each item's `sort` from its position here. */
  items: ExtraListItem[];
}

export type ExtraListItemInput = Omit<ExtraListItem, "id"> & { id?: string };
export type ExtraListInput = Omit<ExtraList, "id" | "items"> & { items: ExtraListItemInput[] };

function invalid(field: string): never {
  throw new AppError("extras.invalid", { field });
}
function record(value: unknown, field: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) invalid(field);
  return value as Record<string, unknown>;
}
function keys(value: Record<string, unknown>, allowed: string[], field: string) {
  for (const key of Object.keys(value)) if (!allowed.includes(key)) invalid(`${field}.${key}`);
}
/** The staff name: plain text, required, and blank is the same as missing. */
function staffName(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim() === "") invalid(field);
  return value;
}
/**
 * The translated customer name: absent, null, or a map holding no text anywhere means "fall back to
 * the staff name". Same body as `option-contract.ts`'s, including its one deliberate difference from
 * the product path — a bad language key is reported with the field path rather than letting
 * `contentLanguageCode`'s own fieldless `content.language_invalid` out.
 */
function translations(value: unknown, field: string): Record<string, string> | null {
  if (value === undefined || value === null) return null;
  const map = record(value, field);
  for (const [language, text] of Object.entries(map)) {
    if (typeof text !== "string") invalid(field);
    try {
      contentLanguageCode(language);
    } catch {
      invalid(field);
    }
  }
  return nonBlankTranslations({ ...map } as Record<string, string>);
}
/** The kitchen name: plain text, and blank is the same as missing. */
function kitchenName(value: unknown, field: string): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== "string") invalid(field);
  return value.trim() === "" ? null : value;
}
function bool(value: unknown, field: string, fallback: boolean): boolean {
  if (value === undefined) return fallback;
  if (typeof value !== "boolean") invalid(field);
  return value;
}
/**
 * A whole number the `integer` columns behind this contract can hold. `min_picks`, `max_picks` and
 * `max_quantity` are all `integer` (schema/extras.ts), so without the ceiling a larger number passes
 * every check here and surfaces from the driver as `22003 value out of range for type integer`,
 * carrying no field for an editor to put beside an input. Same ceiling, for the same reason, as
 * `integer` in modifier-contract.ts.
 */
function whole(value: unknown, field: string, minimum: number): number {
  if (
    typeof value !== "number" ||
    !Number.isInteger(value) ||
    value < minimum ||
    value > MAX_MODIFIER_INTEGER
  )
    invalid(field);
  return value;
}
/**
 * `isUuid` accepts either case and so does a PostgreSQL `uuid` column, which hands the value back
 * lower-cased. Lower-casing here is what makes a body's own ids comparable to each other and to the
 * stored rows — the same normalisation `product-editor-input.ts` applies.
 */
function id(value: unknown, field: string): string {
  if (typeof value !== "string" || !isUuid(value)) invalid(field);
  return value.toLowerCase();
}
/** A price in the product-price shape, normalised to two decimals; null means "inherit". */
function price(value: unknown, field: string): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== "string" || !isProductPrice(value)) invalid(field);
  return toScale(decimal(value), 2);
}

export function parseExtraListInput(value: unknown): ExtraListInput {
  const row = record(value, "extraList");
  keys(
    row,
    ["name", "customerName", "kitchenName", "minPicks", "maxPicks", "active", "items"],
    "extraList",
  );
  const minPicks = row.minPicks === undefined ? 0 : whole(row.minPicks, "minPicks", 0);
  const maxPicks = row.maxPicks == null ? null : whole(row.maxPicks, "maxPicks", 0);
  // The cap is what is wrong when the pair cannot both hold, so the refusal names it rather than
  // `minPicks`: an editor showing both fields puts the message on the one the manager just raised.
  if (maxPicks !== null && maxPicks < minPicks) invalid("maxPicks");
  const list = {
    name: staffName(row.name, "name"),
    customerName: translations(row.customerName, "customerName"),
    kitchenName: kitchenName(row.kitchenName, "kitchenName"),
    minPicks,
    maxPicks,
    active: bool(row.active, "active", true),
  };
  if (!Array.isArray(row.items)) invalid("items");
  const seenItems = new Set<string>();
  const seenProducts = new Set<string>();
  const items = row.items.map((entry, index): ExtraListItemInput => {
    const field = `items.${index}`;
    const item = record(entry, field);
    keys(item, ["id", "productId", "maxQuantity", "preselected", "price"], field);
    let itemId: string | undefined;
    if (item.id !== undefined) {
      itemId = id(item.id, `${field}.id`);
      if (seenItems.has(itemId)) invalid(`${field}.id`);
      seenItems.add(itemId);
    }
    const productId = id(item.productId, `${field}.productId`);
    // One offer per product per list: two rows for the same product would give the diner two ways to
    // pick the same thing with different terms, and `validateExtraSelections` below matches a pick to
    // an item by product id, so it could not tell them apart.
    if (seenProducts.has(productId)) invalid(`${field}.productId`);
    seenProducts.add(productId);
    return {
      ...(itemId === undefined ? {} : { id: itemId }),
      productId,
      maxQuantity:
        item.maxQuantity === undefined ? 1 : whole(item.maxQuantity, `${field}.maxQuantity`, 1),
      preselected: bool(item.preselected, `${field}.preselected`, false),
      price: price(item.price, `${field}.price`),
    };
  });
  // An active list is asked on every order of a dish carrying it, and there is nothing to answer it
  // with when it offers no product. An inactive list is never asked, so it may be empty — the same
  // split `parseOptionListInput` makes on withdrawn labels.
  if (list.active && items.length === 0) invalid("items");
  return { ...list, items };
}

/**
 * Validate a line's answers to the extras lists a dish offers, returning one entry per ACTIVE list
 * in `lists` order — including an empty `picks` for a list left unanswered, so the caller sees the
 * whole answered set rather than only what was sent. Each list's picks come back in that list's own
 * item order, never the order they were sent, so the caller freezes them deterministically.
 *
 * A structural fault in the body — a bad shape, an unknown key, an answer for a list not on offer,
 * or a pick naming a product the list does not carry — is `extras.invalid` with a field path. A
 * COUNT the list refuses is `extras.limit_exceeded` carrying that list's id: fewer picks than
 * `minPicks`, more than `maxPicks`, or a quantity above one item's `maxQuantity`. A pick of two
 * counts as TWO towards the list's own bounds, so "choose one bread" is `minPicks = maxPicks = 1`
 * whatever an item's `maxQuantity` allows.
 *
 * VAT is untouched here: an extra always carries its product's own rate (spec
 * `docs/superpowers/specs/2026-09-18-one-product-model-design.md` §3.3), which the order path
 * resolves from the `products` row.
 */
export function validateExtraSelections(
  lists: readonly ExtraList[],
  value: unknown,
): ExtraSelection[] {
  if (!Array.isArray(value)) invalid("extraSelections");
  const offered = new Map(lists.filter((list) => list.active).map((list) => [list.id, list]));
  const answers = new Map<string, Map<string, number>>();
  for (const entry of value) {
    const row = record(entry, "extraSelections");
    keys(row, ["listId", "picks"], "extraSelections");
    const listId = row.listId;
    if (typeof listId !== "string") invalid("listId");
    const list = offered.get(listId);
    if (!list || answers.has(listId)) invalid("listId");
    if (!Array.isArray(row.picks)) invalid("picks");
    const picked = new Map<string, number>();
    for (const entry of row.picks) {
      const pick = record(entry, "picks");
      keys(pick, ["productId", "quantity"], "picks");
      const productId = pick.productId;
      if (typeof productId !== "string") invalid("productId");
      if (picked.has(productId)) invalid("productId");
      if (!list.items.some((item) => item.productId === productId)) invalid("productId");
      picked.set(productId, whole(pick.quantity, "quantity", 1));
    }
    answers.set(listId, picked);
  }
  const out: ExtraSelection[] = [];
  for (const list of lists) {
    if (!list.active) continue;
    const picked = answers.get(list.id) ?? new Map<string, number>();
    const picks: { productId: string; quantity: number }[] = [];
    let total = 0;
    for (const item of list.items) {
      const quantity = picked.get(item.productId);
      if (quantity === undefined) continue;
      if (quantity > item.maxQuantity) {
        throw new AppError("extras.limit_exceeded", { extraListId: list.id });
      }
      total += quantity;
      picks.push({ productId: item.productId, quantity });
    }
    if (total < list.minPicks || (list.maxPicks !== null && total > list.maxPicks)) {
      throw new AppError("extras.limit_exceeded", { extraListId: list.id });
    }
    out.push({ listId: list.id, picks });
  }
  return out;
}
