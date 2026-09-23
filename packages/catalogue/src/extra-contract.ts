import { AppError, contentLanguageCode, decimal, isUuid, toScale } from "@waitron/shared";
import type { ExtraSelection } from "@waitron/shared";
import type { ExtraList, ExtraListItemInput, ExtraListInput } from "./modifier-list-types.js";
import { MAX_MODIFIER_INTEGER, isProductPrice } from "./modifier-limits.js";
import { nonBlankTranslations } from "./product-presentation.js";
import "./errors.js";

export type { ExtraSelection } from "@waitron/shared";

// The four shapes below live in `modifier-list-types.ts`, the browser-safe LEAF the dashboard
// imports; this file keeps the code that validates them and re-exports them so existing imports are
// unchanged.
export type {
  ExtraList,
  ExtraListInput,
  ExtraListItem,
  ExtraListItemInput,
} from "./modifier-list-types.js";

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
 * carrying no field for an editor to put beside an input.
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
/**
 * A price in the product-price shape, normalised to two decimals; null means "inherit". Exported
 * because the same rule decides a list item's price here and a MENU offer's override of it
 * (`setMenuItemExtraLists`, extras.ts): one body, so the two prices a diner can be charged cannot
 * drift apart.
 */
export function extraPrice(value: unknown, field: string): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== "string" || !isProductPrice(value)) invalid(field);
  return toScale(decimal(value), 2);
}

/**
 * One published list as a body sends it, normalised: ids lower-cased, prices in the stored shape,
 * and each item carrying the field path a refusal about it should name.
 */
export interface MenuExtraPublication {
  listId: string;
  items: { productId: string; price: string | null; available: boolean; field: string }[];
}

/**
 * What one menu offer publishes, as `setMenuItemExtraLists` (extras.ts) takes it: the lists it
 * carries, in the order the editor sent, each with the overrides that narrow and reprice it.
 *
 * It lives beside {@link parseExtraListInput} because every rule it needs is already here — the
 * uuid-and-lower-case `id`, the boolean `bool`, the unknown-key `keys` and the shared
 * {@link extraPrice}. Parsed by hand inside the write path instead, two of those checks were simply
 * absent, and on this engine NOTHING downstream supplies either of them.
 *
 * `available` is a `flag`, which is drizzle's `integer(..., { mode: "boolean" })`
 * (`packages/db/src/schema/columns.ts`). That column DOES declare a `mapToDriverValue`, and it
 * coerces rather than refuses: calling it directly on the column this table builds (Node v26.7.0,
 * 2026-09-22) mapped `true`/`1` to 1 and `false`/`0` to 0, and mapped `"banana"`, `{}` AND the
 * string `"false"` to 1, with `null` and `undefined` to 0. So every bad value stores a boolean
 * silently and none of them throws. `listId` has no backstop either: `id` is a plain `text` column
 * on this engine, so a value that is not a uuid is simply stored.
 *
 * That is worse than what the storage switch replaced, which is the reason to state it rather than
 * drop the paragraph: under the previous engine the driver at least threw a plain `Error` for
 * `"banana"` and `{}`, and a non-uuid `listId` came back `22P02` — both unreadable to an editor,
 * but both refusals. What {@link bool} adds now is the only refusal there is, and it carries the
 * field path an editor can put beside an input.
 *
 * The two duplicates a body can carry are refused here as well, because neither has a unique index
 * behind it that would name the offending position: one list published twice, and one product
 * overridden twice within a list.
 */
export function parseMenuExtraPublications(value: unknown): MenuExtraPublication[] {
  if (!Array.isArray(value)) invalid("lists");
  const seenLists = new Set<string>();
  return value.map((entry, index): MenuExtraPublication => {
    const field = `lists.${index}`;
    const row = record(entry, field);
    keys(row, ["listId", "items"], field);
    const listId = id(row.listId, `${field}.listId`);
    if (seenLists.has(listId)) invalid(`${field}.listId`);
    seenLists.add(listId);
    if (!Array.isArray(row.items)) invalid(`${field}.items`);
    const seenProducts = new Set<string>();
    const items = row.items.map((each, at) => {
      const itemField = `${field}.items.${at}`;
      const item = record(each, itemField);
      keys(item, ["productId", "price", "available"], itemField);
      const productId = id(item.productId, `${itemField}.productId`);
      // One override per product per list: the primary key refuses the pair as `23505`, which
      // carries no position for an editor to put a message beside.
      if (seenProducts.has(productId)) invalid(`${itemField}.productId`);
      seenProducts.add(productId);
      return {
        productId,
        // The same rule that decides a LIST item's own price, so the two prices a diner can be
        // charged cannot drift apart.
        price: extraPrice(item.price, `${itemField}.price`),
        available: bool(item.available, `${itemField}.available`, true),
        field: itemField,
      };
    });
    return { listId, items };
  });
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
      price: extraPrice(item.price, `${field}.price`),
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
 * VAT is untouched here: an extra always carries its product's rate — the product's own, or its
 * parent's where a variant leaves it blank — never the dish's (spec
 * `docs/superpowers/specs/2026-09-18-one-product-model-design.md` §3.3), which the order path
 * resolves from the product's `products` row and, for a variant, its parent's.
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
    const sentListId = row.listId;
    if (typeof sentListId !== "string") invalid("listId");
    // Lower-cased for the same reason `id` above lower-cases an authored id: the stored rows come
    // back from their `uuid` columns lower-cased, so a pick sent in upper case has to be folded
    // before it is compared to them. Deliberately NOT `id()`: a value that is no uuid at all keeps
    // the refusal it has today — `extras.invalid` naming the field, from the membership check
    // below — rather than gaining a second way to be a shape fault.
    const listId = sentListId.toLowerCase();
    const list = offered.get(listId);
    if (!list || answers.has(listId)) invalid("listId");
    if (!Array.isArray(row.picks)) invalid("picks");
    const picked = new Map<string, number>();
    for (const entry of row.picks) {
      const pick = record(entry, "picks");
      keys(pick, ["productId", "quantity"], "picks");
      const sentProductId = pick.productId;
      if (typeof sentProductId !== "string") invalid("productId");
      const productId = sentProductId.toLowerCase();
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
