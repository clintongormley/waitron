import { nonBlankTranslations } from "@waitron/catalogue";
import "./errors.js";
import type { Context, Hono } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { AppError, FALLBACK_LOCALE, decimal, type Decimal } from "@waitron/shared";
import { products, withTransaction, type Database, type Transaction } from "@waitron/db";
import {
  addCatalogueToLocation,
  catalogueExists,
  readContentLanguages,
  writeContentLanguages,
  validateContentTranslations,
  createCatalogue,
  addProductsToCategory,
  categoryDependants,
  createCategory,
  readCategory,
  updateCategory,
  deleteCategory,
  replaceProductCategories,
  readProductCategories,
  listCategoryProducts,
  type CategoryInput,
  createMenuItem,
  createMenuSection,
  createProduct,
  deactivateMenuItem,
  listCatalogues,
  listCataloguesForLocation,
  listCategories,
  listMenuOffers,
  listMenuSections,
  listOptionLists,
  getOptionList,
  createOptionList,
  updateOptionList,
  deleteOptionList,
  optionListDependants,
  listExtraLists,
  getExtraList,
  createExtraList,
  updateExtraList,
  deleteExtraList,
  extraListDependants,
  listProducts,
  removeCatalogueFromLocation,
  setLocationDefaultCatalogue,
  renameCatalogue,
  updateMenuItem,
  updateMenuSection,
  updateProduct,
  listMenuVariants,
  setMenuVariants,
  type MenuVariant,
  readProductEditor,
  saveProductEditor,
  productWithId,
  isModifierListKind,
  readProductModifiers,
  writeProductModifiers,
  type ProductModifierRef,
  type DietOverride,
  type ProductAllergens,
  type ProductEditorValue,
  type ProductRouting,
  type UpdateProductInput,
} from "@waitron/catalogue";
import { authorizeManager, type Permission } from "@waitron/identity";
import { createErrorBoundary } from "@waitron/server-kit";
import { readJsonBody, requireString } from "@waitron/server-kit";
import { requireManagementSession } from "@waitron/server-kit";
import { isUuid } from "./till-session.js";
import { setProductCourse, setProductStation } from "./kitchen.js";
import type { TillConfig } from "./till-config.js";
import type { Logger } from "./logger.js";

/** Catalogue and content-language routes. One taxpayer per database, so nothing filters by one. */
export interface CatalogueApiDeps {
  contentTranslationGaps?: (
    tx: Transaction,
    language: string,
  ) => Promise<{ kind: string; id: string }[]>;
  db: Database;
  /**
   * The venue whose kitchen stations and courses the product editor may route a product to. OPTIONAL
   * so a suite that never routes a product to a station or course can mount without it; `boot.ts`
   * always supplies it for a real venue server, and `requireVenueCfg` throws on a routing request
   * that arrives without one.
   */
  venueCfg?: TillConfig;
  venueLocale?: string;
}

/**
 * The ONE permission that gates every catalogue write route — the design §3 seam. Referenced through
 * this single named constant, never an inline literal at a route, so realising the deferred
 * `catalogue.manage` permission later is a ONE-LINE swap here (add it to `@waitron/identity`'s
 * `PERMISSIONS` + the manager/admin sets, then change this value). `person.manage` maps to exactly
 * `manager` + `admin` today — the dashboard's audience — so the two gates are behaviourally identical
 * on the current role set. The gate throws the existing `authorization.not_permitted`; its
 * `{ permission }` param reads `"person.manage"` until the seam is realised, which is honest about
 * what actually gated the call.
 */
const CATALOGUE_WRITE_PERMISSION: Permission = "person.manage";

function categoryInput(body: Record<string, unknown>, creating: boolean): Partial<CategoryInput> {
  const result: Partial<CategoryInput> = {};
  if (creating || body.name !== undefined) {
    if (
      !body.name ||
      typeof body.name !== "object" ||
      Array.isArray(body.name) ||
      Object.values(body.name).some((value) => typeof value !== "string")
    )
      throw new AppError("management.request_invalid", { field: "name" });
    result.name = body.name as Record<string, string>;
  }
  if (body.parentId !== undefined) {
    if (body.parentId !== null && (typeof body.parentId !== "string" || !isUuid(body.parentId)))
      throw new AppError("management.request_invalid", { field: "parentId" });
    result.parentId = body.parentId as string | null;
  }
  if (body.image !== undefined) {
    if (body.image !== null && typeof body.image !== "string")
      throw new AppError("management.request_invalid", { field: "image" });
    result.image = body.image as string | null;
  }
  // Shape screen only — `createCategory`/`updateCategory` own the `#rrggbb` format check and its
  // `category.color_invalid`, the same split `image` takes with `validateImage`.
  if (body.color !== undefined) {
    if (body.color !== null && typeof body.color !== "string")
      throw new AppError("management.request_invalid", { field: "color" });
    result.color = body.color as string | null;
  }
  return result;
}

/** Domain faults are client errors; unclassified driver failures remain opaque server errors. */
const STATUS: Record<string, ContentfulStatusCode> = {
  "management_session.required": 401,
  "management_session.expired": 401,
  "person.suspended": 403,
  "authorization.not_permitted": 403,
  "management.request_invalid": 400,
  "shared.invalid_id": 400,
  // A price string that is not a well-formed decimal literal, refused by the `decimal()` inside
  // `stringToCents` in the four catalogue writes that convert one
  // (`packages/catalogue/src/operations.ts`): `createMenuItem`/`updateMenuItem`'s `grossPrice` and
  // `createProduct`/`updateProduct`'s `unitPrice`. A CLIENT request fault -> 400. Listed explicitly
  // as the house style requires; the `?? 400` default already covers it — measured 2026-09-21 with
  // the entry absent, a `unitPrice` of `01.00` answered 400 `shared.invalid_decimal`.
  // `refuseNegativePrice` below calls `decimal()` too, and is NOT a second source of this code: it
  // swallows the throw so the refusal still comes from the write, in the write's own order.
  "shared.invalid_decimal": 400,
  // A price too wide for the money scale's twelve integer digits, thrown inside the
  // `decimalToCents` each of those four `stringToCents` calls makes — raised by the op, not by this
  // file's screens. A CLIENT request fault -> 400. Listed explicitly as the house style requires; the
  // `?? 400` default already covers it — measured 2026-09-21 with this entry absent, a `unitPrice` or
  // `grossPrice` of `1234567890123.00` answered 400 `shared.decimal_overflow` on all four of
  // `POST`/`PATCH /management-api/products` and `POST`/`PATCH /management-api/catalogues/:id/items`.
  "shared.decimal_overflow": 400,
  "catalogue.not_found": 404,
  "category.not_found": 404,
  // A colour that is not `#rrggbb`, refused by `createCategory`/`updateCategory` before the write.
  "category.color_invalid": 400,
  "menu_item.not_found": 404,
  // A menu offer asked for a variant, which follows its parent onto the menu instead: a CLIENT
  // request fault.
  "menu_item.variant_not_allowed": 400,
  "product.not_found": 404,
  // A product write's own domain validation (`createProduct`/`updateProduct` in `operations.ts`)
  // refused a malformed unit field — a CLIENT request fault → 400. Listed explicitly as the house
  // style requires; the `?? 400` default already covers it.
  "product.invalid": 400,
  // Retired: nothing throws it since a product may have one variant. Still mapped, as a shipped
  // code stays registered.
  "product.variant_count_invalid": 400,
  "menu_section.not_found": 404,
  // The product editor's kitchen routing (`setProductStation`/`setProductCourse`): an id that names no
  // LIVE station or course of this venue. 404 on every other surface that raises them
  // (`management-api.ts`, `till-api.ts`, `print-api.ts`), so it is 404 here too.
  "station.not_found": 404,
  "course.not_found": 404,
  "allergen.invalid_code": 400,
  "allergen.invalid_presence": 400,
  "allergen.invalid_source": 400,
  // The diet-write validation codes: an untrusted product `dietOverride` that fails the
  // taxonomy/label/disjointness checks in the core diet validators is a CLIENT fault → 400. Listed
  // explicitly as the house style requires; the `?? 400` default already covers them.
  "diet.invalid_origin": 400,
  "diet.invalid_label": 400,
  "diet.add_remove_conflict": 400,
  // The five codes the deleted option-group machinery raised. An error code is never retired once
  // shipped (CLAUDE.md §3), so they stay registered and stay mapped; nothing on this surface throws
  // one today. `grep -rn '\"modifier.invalid\"\|\"options.group_invalid\"\|\"options.item_invalid\"' apps
  // packages --include=\"*.ts\"` on 2026-09-21 finds only the registry
  // (`packages/catalogue/src/errors.ts`), this map and this comment.
  "modifier.invalid": 400,
  "modifier.not_found": 404,
  "modifier.in_use": 409,
  "options.group_invalid": 400,
  "options.item_invalid": 400,
  // Option lists (`packages/catalogue/src/options.ts`). `options.invalid` reaches here from more
  // than one place — `parseOptionListInput` on a malformed authoring body, and `writeLabels` on a
  // label id the stored rows put on another list, among them; `options.translation_required` from a
  // customer-facing name map with no text in the default content language. Both are CLIENT request
  // faults → 400. Listed
  // explicitly as the house style requires; the `?? 400` default
  // (`packages/server-kit/src/error-boundary.ts:57`) already covers them.
  "options.invalid": 400,
  "options.translation_required": 400,
  // An id naming no list. The default would make this a 400, so this entry is what makes it a 404.
  "options.not_found": 404,
  // 409 rather than the default 400 because the body was fine and the stored state refused it.
  // NOTHING throws it, and the design may never give
  // it one: a list delete is DESIGNED to cascade its product attachments rather than refuse — and
  // `product_modifiers_option_list_fk` is what does that cascading
  // (packages/catalogue/drizzle/0000_catalogue_baseline.sql) — which
  // `packages/catalogue/src/errors.ts` states on the code itself, citing spec
  // `2026-09-18-one-product-model-design.md` §2.3. Mapped because Task 3 of the plan names it.
  "options.in_use": 409,
  // Extras lists (`packages/catalogue/src/extras.ts`), the twin of the `options.*` pair above: 400
  // for the same reason and listed explicitly by the same convention. What differs is where they
  // are thrown. `extras.invalid` comes from several places, among them `parseExtraListInput`
  // (extra-contract.ts) on a malformed authoring body and `assertProductsExist` / `writeItems`
  // (extras.ts) on an item naming no `products` row or reusing an item id another list holds;
  // `extras.translation_required` comes from `validateNames` (extras.ts) alone.
  "extras.invalid": 400,
  "extras.translation_required": 400,
  // An id naming no list: `getExtraList` on the single read, `assertExtraListForWrite` on the update and the
  // delete, `assertExtraList` on the dependants preview (all extras.ts). The default would make this
  // a 400, so this entry is what makes it a 404.
  "extras.not_found": 404,
  // `options.in_use` above, one table over: 409 for the same reason, thrown by nothing, and mapped
  // because the plan names it — Task 6 here, Task 3 there. What differs is the cascade (deleting an
  // extras list takes its menu publications with it as well as its product attachments) and the
  // spec section `packages/catalogue/src/errors.ts` cites on the code itself,
  // `2026-09-18-one-product-model-design.md` §3.5.
  "extras.in_use": 409,
  // An order line answering an extras list with too few picks, too many, or a quantity above one
  // item's cap — thrown by `validateExtraSelections` (extra-contract.ts). NO ROUTE ON THIS SURFACE
  // raises it: a management route takes an authoring body, never a diner's picks. Its one
  // production caller is on the TILL surface —
  // `grep -rn validateExtraSelections apps packages --include="*.ts"`, 2026-09-20, finds
  // `buildLineExtras` (`apps/server/src/modifier-selection.ts`), reached from `priceOrderLines` and
  // `updateHeldOrder` (`apps/server/src/working-order.ts`) — and no caller under this file. Mapped at
  // 400, which is also what the default would give: it is a CLIENT request fault, the caller having
  // sent a selection the list's own published counts refuse.
  "extras.limit_exceeded": 400,
  // 409 like the `*.in_use` codes: the body was well formed, and what another stored row holds
  // refused it — a product's Active variants, or an extras list offering the product.
  "extras.product_has_variants": 409,
  "product.offered_as_extra": 409,
  // 409 for the same reason as the three `*.in_use` codes above, and unthrown like two of them.
  // `grep -rn 'product.in_use' apps packages --include="*.ts"` on 2026-09-20 returns three lines:
  // the declaration in `packages/catalogue/src/errors.ts`, this comment quoting the command, and
  // the map entry below it — so nothing throws it. No route deletes a product either, but the
  // command that would show that is BLIND in one place, so it is not on its own a receipt:
  // `grep -rn "app.delete(" apps/server/src --include="*.ts"`, same date, lists the DELETE routes
  // whose path is written out at the call, and `mountListSurface` above registers
  // `app.delete(one, …)` with the path in a variable — one grep line standing for the two real
  // paths its two call sites mount, `/management-api/modifiers/options/:id` and
  // `/management-api/modifiers/extras/:id`. Both delete a LIST. Of the rest of that output, two
  // lines are this comment quoting the command and every remaining one writes its path out, which
  // is what makes them readable. What refuses a product delete today is the database: an extras
  // list item's and a menu override's `product_id` are both ON DELETE RESTRICT
  // (`packages/catalogue/src/schema/extras.ts`), which surfaces as a driver error and not as this
  // code. Mapped because Task 6 of the plan names it — the same reason `extras.in_use` above is
  // mapped with no thrower either.
  "product.in_use": 409,
};

// The one error boundary every catalogue route wraps its handler in — the shared `createErrorBoundary`
// closed over this surface's `STATUS` map and its `catalogue.failed` log tag, the catalogue
// counterpart of `management-api.ts`'s local `run`. Local, not exported.
const run = createErrorBoundary(STATUS, "catalogue.failed");

/**
 * Screen a `/…/:id` path param as a UUID before it reaches a query, returning it. Nothing below
 * this screen objects to a malformed id — every id column is plain `text`, so the value would simply
 * match no row (`till-api.ts`'s note on `shared.invalid_id` states it once for this app). Refusing it
 * here as `shared.invalid_id` (the branded-id constructors' own code — `packages/shared/src/ids.ts`)
 * makes that silent miss a clean 400. Shape only: a well-formed id that names no row passes this and
 * is handled by the op it reaches. `value` is the caller-supplied uuid-shaped string, safe to
 * echo.
 */
function requireUuidParam(id: string, kind: string): string {
  if (!isUuid(id)) throw new AppError("shared.invalid_id", { kind, value: id });
  return id;
}

/**
 * Refuse a CATALOGUE price a caller sent as a negative amount — a product's `unitPrice` and a menu
 * item's `grossPrice`. Scoped to the catalogue deliberately: a corrective invoice's sale total and
 * its line TOTALS are negative on purpose (`packages/core/src/record-correction.ts`, and
 * `sales_total_ck` exempts a row with a `corrects_sale_id`), so "a price is never negative" is only
 * true of the prices this file writes.
 *
 * SIGN ONLY, and the two halves of that both matter. A value `decimal()` cannot parse is swallowed
 * here and left to the write's own `decimal()` a moment later, which keeps both the error code AND
 * the order in which a request carrying two faults reports them. And `decimal()` strips the sign
 * from a zero magnitude (`packages/shared/src/money.ts:21`), so a leading `-` on what it returns
 * means strictly below zero: `-0.00` is not refused.
 *
 * The code is `management.request_invalid`, the body-shape code most of this file's screens use,
 * rather than the `product.invalid` the product-editor routes use for the same fact: a boundary
 * screen answering in the boundary's own code. The file is not uniform about this and a quantifier
 * here would be wrong — `screenRouting` and `parseProductModifiers` both screen a body field and
 * answer in a domain code instead. Neither of these two refusals reaches an operator: every
 * dashboard form carrying a catalogue price refuses a negative in the browser first.
 *
 * What each route did before this screen, and how far the fix reaches, is in `docs/backlog.md` →
 * Track C.
 */
function refuseNegativePrice(value: string, field: string): void {
  let parsed: Decimal;
  try {
    parsed = decimal(value);
  } catch {
    return;
  }
  if (parsed.startsWith("-")) throw new AppError("management.request_invalid", { field });
}

/** A menu's settings for the offer's variants: a `price` of null follows the variant's own. */
function parseMenuVariants(value: unknown): MenuVariant[] {
  if (!Array.isArray(value)) {
    throw new AppError("management.request_invalid", { field: "variants" });
  }
  return value.map((entry, index) => {
    if (
      !isPlainObject(entry) ||
      typeof entry.variantId !== "string" ||
      (entry.price !== null && typeof entry.price !== "string") ||
      typeof entry.offered !== "boolean"
    ) {
      throw new AppError("management.request_invalid", { field: `variants.${index}` });
    }
    return {
      variantId: requireUuidParam(entry.variantId, "ProductVariantId"),
      price: entry.price,
      offered: entry.offered,
    };
  });
}

/**
 * Screen the `{ catalogueId }` body the location-menu POST/PUT routes carry: REQUIRED (a
 * missing/wrong-typed one is `management.request_invalid` naming the field, the body-screen convention)
 * and uuid-SHAPED (a malformed string is `shared.invalid_id` before it reaches a `uuid` column, exactly
 * as `requireUuidParam` screens a path id). This is a SHAPE screen only; whether the id names a
 * catalogue the tenant may use is {@link assertCatalogueVisible}'s job, run inside the tx.
 * `readJsonBody` coerces a null/malformed body to `{}`, so those land on the typeof screen as a clean 400.
 */
async function requireCatalogueIdBody(c: Context): Promise<string> {
  const body = await readJsonBody<{ catalogueId?: unknown }>(c);
  if (typeof body.catalogueId !== "string") {
    throw new AppError("management.request_invalid", { field: "catalogueId" });
  }
  return requireUuidParam(body.catalogueId, "CatalogueId");
}

/**
 * The deployment holds one taxpayer per database. The trust-boundary check for an untrusted
 * `catalogueId` a location-menu WRITE will reference: refuse it as `catalogue.not_found` (404)
 * unless it names a catalogue present in this database. Runs inside `gated`'s transaction;
 * `catalogueExists` checks by id only. This is the CLEAN-error front: the write targets carry a
 * plain by-id FK on `catalogues(id)` (`locations.catalogue_id`, `location_catalogues.catalogue_id`)
 * which rejects an ABSENT id at the data layer — the id is all either layer can check, since
 * every catalogue in the database belongs to the one taxpayer.
 */
async function assertCatalogueVisible(tx: Transaction, catalogueId: string): Promise<void> {
  if (!(await catalogueExists(tx, catalogueId))) {
    throw new AppError("catalogue.not_found", { catalogueId });
  }
}

/**
 * Screen the menu-offer routes' optional `displayOrder` body field, returning it. Absent stays
 * `undefined` (a no-op: the create route defaults it, the patch route leaves it untouched); a
 * PRESENT value must be an integer NUMBER in int4 range, else `management.request_invalid` naming
 * `displayOrder` (never the value). The `typeof` screen is first so a non-number is REJECTED rather
 * than coerced, and the int4 bound is now the ONLY bound: this engine's INTEGER is 64-bit whatever
 * the declared type says, so the column itself refuses nothing
 * (`packages/db/src/schema/columns.ts`).
 */
function parseDisplayOrder(value: unknown): number | undefined {
  if (value === undefined) return undefined;
  if (
    typeof value !== "number" ||
    !Number.isInteger(value) ||
    value < -2_147_483_648 ||
    value > 2_147_483_647
  ) {
    throw new AppError("management.request_invalid", { field: "displayOrder" });
  }
  return value;
}

/**
 * SHAPE-screen an optional product `dietOverride` body field (Task 4): `undefined` (leave unchanged)
 * and `null` (clear) are legitimate no-ops, and a present value must be a plain OBJECT — a non-object
 * (string/number/array) is `management.request_invalid` naming the field, mirroring how
 * `customerName` is screened by `screenCustomerName` below. This is a SHAPE screen only; the
 * label/contains-tag/disjointness CONTENT is
 * `validateDietOverride`'s job inside `createProduct`/`updateProduct` (which throws the `diet.*` codes),
 * exactly as `validateAllergens` owns the `allergens` content.
 */
function screenDietOverride(value: unknown): void {
  if (value !== undefined && value !== null && !isPlainObject(value)) {
    throw new AppError("management.request_invalid", { field: "dietOverride" });
  }
}

/**
 * Screen the OPTIONAL ordered `modifiers` attach list on the product POST/PATCH body, returning it.
 * Absent stays `undefined` (the product's attachments are left untouched); present must be an ARRAY
 * of `{ kind: "extras" | "options", id }` objects, in the order a diner is offered them.
 *
 * A non-array, a non-object entry, an unknown or missing `kind` and a non-string `id` are all
 * `management.request_invalid` naming `modifiers` — the split Task 1 made, where the server's screen
 * throws the REQUEST code and the catalogue's own parser throws the DOMAIN code
 * (`parseProductEditorInput`, packages/catalogue/src/product-editor-input.ts, throws
 * `product.invalid`). A string that is not uuid-shaped is `shared.invalid_id` instead, exactly as
 * `requireUuidParam` treats a path id and for the same reason: the column is plain `text`, so an
 * un-screened value would be STORED or would match nothing, with no refusal anywhere below.
 *
 * DUPLICATES are NOT collapsed here: `writeProductModifiers`
 * (packages/catalogue/src/product-modifiers.ts) refuses a repeat itself, as `product.invalid`
 * naming the entry, which the STATUS map maps to 400 — so the caller is told rather than quietly
 * saved something it did not send.
 *
 * Whether each id names a real list is `writeProductModifiers`' check, not this shape screen's.
 */
function parseProductModifiers(value: unknown): ProductModifierRef[] | undefined {
  if (value === undefined) return undefined;
  const invalid = () => new AppError("management.request_invalid", { field: "modifiers" });
  if (!Array.isArray(value)) throw invalid();
  return value.map((entry): ProductModifierRef => {
    if (!isPlainObject(entry)) throw invalid();
    const { kind, id } = entry as { kind?: unknown; id?: unknown };
    if (!isModifierListKind(kind)) throw invalid();
    if (typeof id !== "string") throw invalid();
    if (!isUuid(id)) throw new AppError("shared.invalid_id", { kind: "ModifierListId", value: id });
    return { kind, id };
  });
}

/**
 * Refuse a product body still carrying one of the two fields the ordered `modifiers` list replaced,
 * naming the field the caller sent so it knows which of its own fields went away. Ignoring it would
 * save a product with NO attachments and answer 201/204, the one outcome a caller on the old
 * contract could not tell from having worked.
 *
 * Nothing in this repository sends either field any more — no first-party client can trip this. It
 * stays as a tripwire for a client that PREDATES the change: a dashboard tab left open across the
 * deploy still holds the old body shape, and its save must be refused rather than silently stripped.
 * `parseProductEditorInput` (packages/catalogue/src/product-editor-input.ts) holds the same tripwire
 * on the editor body, for the same reason.
 */
function refuseLegacyAttachFields(body: Record<string, unknown>): void {
  for (const legacy of ["modifierIds", "optionGroupIds"])
    if (body[legacy] !== undefined)
      throw new AppError("management.request_invalid", { field: legacy });
}

/**
 * How a mounted route runs its database work: `mountCatalogueApi`'s `gated` — one transaction, with
 * the caller's management session checked for the catalogue write permission.
 */
type GatedWork = <T>(sessionId: string, fn: (tx: Transaction) => Promise<T>) => Promise<T>;

/** Everything that differs between one kind of modifier list and another. */
interface ListSurface<TList, TDependants> {
  /** The path segment under `/management-api/modifiers` that says which kind of list this is. */
  segment: string;
  /** What a refused `:id` is called in `shared.invalid_id`'s `kind` param. */
  idKind: string;
  /** The JSON key the collection read answers under. */
  collectionKey: string;
  /** The JSON key every single-list route answers under. */
  itemKey: string;
  list: (tx: Transaction) => Promise<TList[]>;
  read: (tx: Transaction, id: string) => Promise<TList>;
  create: (tx: Transaction, body: unknown) => Promise<TList>;
  update: (tx: Transaction, id: string, body: unknown) => Promise<TList>;
  remove: (tx: Transaction, id: string) => Promise<void>;
  dependants: (tx: Transaction, id: string) => Promise<TDependants>;
}

/**
 * Mount the six routes that serve one kind of modifier list: read and create on the collection,
 * read, update and delete on one list, and the delete preview. Both kinds sit UNDER
 * `/management-api/modifiers` because a dish's one attachment list holds either an option list or
 * an extras list; `surface.segment` is the discriminator in the path.
 *
 * Where these calls sit among the other mounts no longer matters. Nothing registers a
 * `/management-api/modifiers/:id` route any more — the legacy option-group CRUD that did was deleted
 * with its tables — so no wildcard can swallow `options` or `extras`.
 *
 * MEASURED with a control, not read off the router. `pnpm --filter @waitron/server test
 * src/catalogue-api.test.ts`: with both calls moved to the END of `mountCatalogueApi`, 131/131 pass.
 * With a `/management-api/modifiers/:id` handler put back ahead of them, FOUR go red — each
 * segment's collection read with `expected 400 to be 200` and each segment's gate case with
 * `expected 400 to be 401`, because that handler screens the uuid before it asks for a session. So
 * the suite does discriminate the ordering; it is the hazard that is gone, not the check.
 */
function mountListSurface<TList, TDependants>(
  app: Hono,
  gated: GatedWork,
  log: Logger,
  surface: ListSurface<TList, TDependants>,
): void {
  // `as const` keeps these as the template literal TYPE `` `/management-api/modifiers/${string}` ``
  // instead of the plain `string` a template expression widens to, and Hono reads the `:id` out of
  // that type. `surface.segment` being declared `string` does not flatten it — the literal parts of
  // the template survive around the `${string}` hole, which is the part Hono needs.
  // MEASURED, not read off the types: with both assertions deleted and nothing else changed,
  // `pnpm --filter @waitron/server typecheck` reports four errors, one per route that reads the
  // path param — `Argument of type 'string | undefined' is not assignable to parameter of type
  // 'string'` at each `requireUuidParam(c.req.param("id"), …)` below, because Hono no longer knows
  // the route declares an `id`. Put back, it is clean.
  const collection = `/management-api/modifiers/${surface.segment}` as const;
  const one = `${collection}/:id` as const;
  app.get(collection, (c) =>
    run(c, log, async () => {
      const lists = await gated(requireManagementSession(c), (tx) => surface.list(tx));
      return c.json({ [surface.collectionKey]: lists });
    }),
  );
  app.post(collection, (c) =>
    run(c, log, async () => {
      // Session before body, as `POST /management-api/categories` below does: an unauthenticated
      // request is then refused without its payload being read at all.
      const sessionId = requireManagementSession(c);
      const body = await readJsonBody(c);
      const created = await gated(sessionId, (tx) => surface.create(tx, body));
      return c.json({ [surface.itemKey]: created }, 201);
    }),
  );
  app.get(one, (c) =>
    run(c, log, async () => {
      const id = requireUuidParam(c.req.param("id"), surface.idKind);
      const list = await gated(requireManagementSession(c), (tx) => surface.read(tx, id));
      return c.json({ [surface.itemKey]: list });
    }),
  );
  app.patch(one, (c) =>
    run(c, log, async () => {
      const id = requireUuidParam(c.req.param("id"), surface.idKind);
      const sessionId = requireManagementSession(c);
      const body = await readJsonBody(c);
      const updated = await gated(sessionId, (tx) => surface.update(tx, id, body));
      return c.json({ [surface.itemKey]: updated });
    }),
  );
  app.delete(one, (c) =>
    run(c, log, async () => {
      const id = requireUuidParam(c.req.param("id"), surface.idKind);
      await gated(requireManagementSession(c), (tx) => surface.remove(tx, id));
      return c.json({ ok: true });
    }),
  );
  // What deleting this list would touch — the preview a delete confirmation reads. What each kind
  // counts, and whether anything reads it yet, is at the call site's `dependants`.
  app.get(`${one}/dependants`, (c) =>
    run(c, log, async () => {
      const id = requireUuidParam(c.req.param("id"), surface.idKind);
      const dependants = await gated(requireManagementSession(c), (tx) =>
        surface.dependants(tx, id),
      );
      return c.json({ dependants });
    }),
  );
}

export function mountCatalogueApi(app: Hono, deps: CatalogueApiDeps, log: Logger): void {
  // Open a transaction, confirm the caller's management session carries
  // CATALOGUE_WRITE_PERMISSION, then run `fn`. Every route funnels its DB work through here so the gate
  // is applied identically and in exactly one place — the design §3 seam.
  const gated = <T>(sessionId: string, fn: (tx: Transaction) => Promise<T>): Promise<T> =>
    withTransaction(deps.db, async (tx) => {
      await authorizeManager(tx, {
        managementSessionId: sessionId,
        permission: CATALOGUE_WRITE_PERMISSION,
      });
      return fn(tx);
    });

  /**
   * Screen the editor body's OPTIONAL kitchen routing. `undefined` means "leave it alone"; `null`
   * clears it. Only the SHAPE is checked here — `setProductStation`/`setProductCourse` are the
   * authority on whether the id names a live station or course of this venue, and raise
   * `station.not_found` / `course.not_found`.
   */
  const screenRouting = (body: Record<string, unknown>): ProductRouting => {
    for (const field of ["stationId", "courseId"] as const) {
      const value = body[field];
      if (value !== undefined && value !== null && typeof value !== "string") {
        throw new AppError("management.request_invalid", { field });
      }
      // A malformed id would reach a `uuid` comparison and come back as an opaque 500, so it is
      // folded to the same not-found code an absent one gets — the shape `management-api.ts`'s
      // station and course routes use.
      if (typeof value === "string" && !isUuid(value)) {
        throw field === "stationId"
          ? new AppError("station.not_found", { stationId: value })
          : new AppError("course.not_found", { courseId: value });
      }
    }
    return {
      stationId: body.stationId as string | null | undefined,
      courseId: body.courseId as string | null | undefined,
    };
  };

  /**
   * Write the product's kitchen routing on the SAME transaction the product was saved on, then read
   * the editor value back so the response shows what was stored. Sharing the transaction is the point:
   * a station or course id the venue does not have rolls the whole product back rather than leaving a
   * saved product with the routing it asked for missing. The two writes are awaited IN TURN, never
   * `Promise.all` — queries on one transaction run one at a time.
   *
   * A body that names NEITHER field returns `saved` — which `saveProductEditor` has already read back
   * — rather than reading the whole product a second time. Only a body that actually writes routing
   * needs the re-read, so the common save costs one read, not two.
   */
  const applyRouting = async (
    tx: Transaction,
    saved: ProductEditorValue,
    routing: ProductRouting,
  ): Promise<ProductEditorValue> => {
    if (routing.stationId === undefined && routing.courseId === undefined) return saved;
    const cfg = requireVenueCfg(deps);
    // `saveProductEditor` has already found the product, a variant included.
    if (routing.stationId !== undefined) {
      await setProductStation(tx, cfg, saved.id, routing.stationId, "any");
    }
    if (routing.courseId !== undefined) {
      await setProductCourse(tx, cfg, saved.id, routing.courseId, "any");
    }
    return readProductEditor(tx, saved.id);
  };

  /**
   * Refuse a product patch naming no stored product, or naming a variant. This read is what makes an unknown id a
   * refusal at all and cannot be folded into the write that follows it: `updateProduct`
   * (packages/catalogue/src/operations.ts) runs a bare `update products … where id = $1` and
   * reports nothing when no row matches. Measured by removing the call and re-running the file —
   * the unknown-id case answers 204 having written nothing, instead of 403.
   */
  const assertOwned = async (tx: Transaction, id: string): Promise<void> => {
    const [row] = await tx
      .select({ id: products.id })
      .from(products)
      .where(productWithId(id, "top-level"));
    if (row === undefined) {
      throw new AppError("authorization.not_permitted", { permission: CATALOGUE_WRITE_PERMISSION });
    }
  };

  // The option lists.
  mountListSurface(app, gated, log, {
    segment: "options",
    idKind: "OptionListId",
    collectionKey: "optionLists",
    itemKey: "optionList",
    list: listOptionLists,
    read: getOptionList,
    create: (tx, body) => createOptionList(tx, body, deps.venueLocale ?? FALLBACK_LOCALE),
    update: (tx, id, body) => updateOptionList(tx, id, body, deps.venueLocale ?? FALLBACK_LOCALE),
    remove: deleteOptionList,
    // The delete preview. Nothing under `apps/dashboard` or `apps/till` reads it today.
    dependants: optionListDependants,
  });

  // The extras lists.
  mountListSurface(app, gated, log, {
    segment: "extras",
    idKind: "ExtraListId",
    collectionKey: "extraLists",
    itemKey: "extraList",
    list: listExtraLists,
    read: getExtraList,
    create: (tx, body) => createExtraList(tx, body, deps.venueLocale ?? FALLBACK_LOCALE),
    update: (tx, id, body) => updateExtraList(tx, id, body, deps.venueLocale ?? FALLBACK_LOCALE),
    remove: deleteExtraList,
    // The products carrying the list and the menu offers publishing it. Both are detached by the
    // delete rather than blocking it, so this is information, never a refusal.
    dependants: extraListDependants,
  });

  app.get("/management-api/content-languages", (c) =>
    run(c, log, async () => {
      const sessionId = requireManagementSession(c);
      return c.json(
        await gated(sessionId, (tx) =>
          readContentLanguages(tx, deps.venueLocale ?? FALLBACK_LOCALE),
        ),
      );
    }),
  );

  // Language choices are public content metadata; this read neither requires nor touches a session.
  app.get("/api/content-languages", (c) =>
    run(c, log, async () => {
      const config = await withTransaction(deps.db, async (tx) => {
        return readContentLanguages(tx, deps.venueLocale ?? FALLBACK_LOCALE);
      });
      return c.json(config);
    }),
  );

  app.put("/management-api/content-languages", (c) =>
    run(c, log, async () => {
      const sessionId = requireManagementSession(c);
      const body = await readJsonBody<{ defaultLanguage?: unknown; languages?: unknown }>(c);
      if (
        typeof body.defaultLanguage !== "string" ||
        !Array.isArray(body.languages) ||
        !body.languages.every((language): language is string => typeof language === "string")
      ) {
        throw new AppError("management.request_invalid", { field: "languages" });
      }
      const config = {
        defaultLanguage: body.defaultLanguage,
        languages: body.languages as string[],
      };
      await gated(sessionId, (tx) =>
        writeContentLanguages(
          tx,
          config,
          deps.venueLocale ?? FALLBACK_LOCALE,
          deps.contentTranslationGaps,
        ),
      );
      return c.body(null, 204);
    }),
  );

  // ── Catalogues ─────────────────────────────────────────────────────────────────────────────────
  app.get("/management-api/catalogues", (c) =>
    run(c, log, async () => {
      const sessionId = requireManagementSession(c);
      const rows = await gated(sessionId, (tx) => listCatalogues(tx));
      return c.json(rows);
    }),
  );

  app.post("/management-api/catalogues", (c) =>
    run(c, log, async () => {
      const sessionId = requireManagementSession(c);
      const body = await readJsonBody<{ name?: unknown }>(c);
      if (typeof body.name !== "string") {
        throw new AppError("management.request_invalid", { field: "name" });
      }
      const { name } = body;
      const created = await gated(sessionId, (tx) => createCatalogue(tx, { name }));
      return c.json(created, 201);
    }),
  );

  app.patch("/management-api/catalogues/:id", (c) =>
    run(c, log, async () => {
      const sessionId = requireManagementSession(c);
      const catalogueId = requireUuidParam(c.req.param("id"), "CatalogueId");
      const body = await readJsonBody<Record<string, unknown>>(c);
      const name = requireString(body.name, "name");
      if (name.trim() === "") throw new AppError("management.request_invalid", { field: "name" });
      await gated(sessionId, (tx) => renameCatalogue(tx, catalogueId, name));
      return c.body(null, 204);
    }),
  );

  app.get("/management-api/catalogues/:id/offers", (c) =>
    run(c, log, async () => {
      const sessionId = requireManagementSession(c);
      const menuId = requireUuidParam(c.req.param("id"), "MenuId");
      const rows = await gated(sessionId, (tx) =>
        listMenuOffers(tx, [menuId], { includeUnavailable: true }),
      );
      return c.json(rows);
    }),
  );

  app.get("/management-api/catalogues/:id/sections", (c) =>
    run(c, log, async () => {
      const sessionId = requireManagementSession(c);
      const menuId = requireUuidParam(c.req.param("id"), "MenuId");
      return c.json(await gated(sessionId, (tx) => listMenuSections(tx, menuId)));
    }),
  );

  app.post("/management-api/catalogues/:id/sections", (c) =>
    run(c, log, async () => {
      const sessionId = requireManagementSession(c);
      const menuId = requireUuidParam(c.req.param("id"), "MenuId");
      const body = await readJsonBody<Record<string, unknown>>(c);
      if (!isPlainObject(body.name)) {
        throw new AppError("management.request_invalid", { field: "name" });
      }
      const displayOrder = parseDisplayOrder(body.displayOrder);
      const created = await gated(sessionId, async (tx) => {
        await validateContentTranslations(
          tx,
          body.name as Record<string, string>,
          deps.venueLocale ?? FALLBACK_LOCALE,
        );
        return createMenuSection(tx, {
          menuId,
          name: body.name as Record<string, string>,
          ...(displayOrder === undefined ? {} : { displayOrder }),
        });
      });
      return c.json(created, 201);
    }),
  );

  app.patch("/management-api/menu-sections/:id", (c) =>
    run(c, log, async () => {
      const sessionId = requireManagementSession(c);
      const sectionId = requireUuidParam(c.req.param("id"), "MenuSectionId");
      const body = await readJsonBody<Record<string, unknown>>(c);
      if (typeof body.name !== "object" || body.name === null || Array.isArray(body.name)) {
        throw new AppError("management.request_invalid", { field: "name" });
      }
      const name = body.name as Record<string, string>;
      await gated(sessionId, async (tx) => {
        await validateContentTranslations(tx, name, deps.venueLocale ?? FALLBACK_LOCALE);
        await updateMenuSection(tx, sectionId, { name });
      });
      return c.body(null, 204);
    }),
  );

  app.post("/management-api/catalogues/:id/items", (c) =>
    run(c, log, async () => {
      const sessionId = requireManagementSession(c);
      const menuId = requireUuidParam(c.req.param("id"), "MenuId");
      const body = await readJsonBody<Record<string, unknown>>(c);
      if (typeof body.productId !== "string") {
        throw new AppError("management.request_invalid", { field: "productId" });
      }
      if (typeof body.sectionId !== "string") {
        throw new AppError("management.request_invalid", { field: "sectionId" });
      }
      // Required on create, and null is a value: a blank menu price is the product's own price.
      if (typeof body.grossPrice !== "string" && body.grossPrice !== null) {
        throw new AppError("management.request_invalid", { field: "grossPrice" });
      }
      if (body.grossPrice !== null) refuseNegativePrice(body.grossPrice, "grossPrice");
      const productId = requireUuidParam(body.productId, "ProductId");
      const sectionId = requireUuidParam(body.sectionId, "MenuSectionId");
      const displayOrder = parseDisplayOrder(body.displayOrder);
      const created = await gated(sessionId, (tx) =>
        createMenuItem(tx, {
          menuId,
          productId,
          sectionId,
          grossPrice: body.grossPrice as string | null,
          ...(displayOrder === undefined ? {} : { displayOrder }),
        }),
      );
      return c.json(created, 201);
    }),
  );

  app.patch("/management-api/catalogues/:id/items/:itemId", (c) =>
    run(c, log, async () => {
      const sessionId = requireManagementSession(c);
      const menuId = requireUuidParam(c.req.param("id"), "MenuId");
      const menuItemId = requireUuidParam(c.req.param("itemId"), "MenuItemId");
      const body = await readJsonBody<Record<string, unknown>>(c);
      if (body.grossPrice !== undefined && body.grossPrice !== null) {
        if (typeof body.grossPrice !== "string") {
          throw new AppError("management.request_invalid", { field: "grossPrice" });
        }
        refuseNegativePrice(body.grossPrice, "grossPrice");
      }
      const displayOrder = parseDisplayOrder(body.displayOrder);
      await gated(sessionId, (tx) =>
        updateMenuItem(tx, menuId, menuItemId, {
          ...(body.grossPrice === undefined
            ? {}
            : { grossPrice: body.grossPrice as string | null }),
          ...(displayOrder === undefined ? {} : { displayOrder }),
        }),
      );
      return c.body(null, 204);
    }),
  );

  app.delete("/management-api/catalogues/:id/items/:itemId", (c) =>
    run(c, log, async () => {
      const sessionId = requireManagementSession(c);
      const menuId = requireUuidParam(c.req.param("id"), "MenuId");
      const menuItemId = requireUuidParam(c.req.param("itemId"), "MenuItemId");
      await gated(sessionId, (tx) => deactivateMenuItem(tx, menuId, menuItemId));
      return c.body(null, 204);
    }),
  );

  app.get("/management-api/catalogues/:id/items/:itemId/variants", (c) =>
    run(c, log, async () => {
      const sessionId = requireManagementSession(c);
      const menuId = requireUuidParam(c.req.param("id"), "MenuId");
      const menuItemId = requireUuidParam(c.req.param("itemId"), "MenuItemId");
      return c.json(await gated(sessionId, (tx) => listMenuVariants(tx, menuItemId, menuId)));
    }),
  );

  app.put("/management-api/catalogues/:id/items/:itemId/variants", (c) =>
    run(c, log, async () => {
      const sessionId = requireManagementSession(c);
      const menuId = requireUuidParam(c.req.param("id"), "MenuId");
      const menuItemId = requireUuidParam(c.req.param("itemId"), "MenuItemId");
      const body = await readJsonBody<Record<string, unknown>>(c);
      const variants = parseMenuVariants(body.variants);
      return c.json(
        await gated(sessionId, (tx) => setMenuVariants(tx, menuItemId, variants, menuId)),
      );
    }),
  );

  // ── Location menus ───────────────────────────────────────────────────────────────────────────────
  // The deployment holds one tenant per database.
  // A location's menu list (its default `locations.catalogue_id` plus `location_catalogues`
  // members). GET returns EVERY catalogue flagged sellable/isDefault; POST/DELETE add and remove a
  // member; PUT sets the default (the old default is demoted to a member, never dropped). The two
  // routes that WRITE a `catalogueId` reference (POST add, PUT default) guard it with
  // `catalogueExists` FIRST — an absent id is refused `catalogue.not_found` (404). The lookup is by
  // id. This is defense-in-depth, not the sole protection: BOTH write targets carry a by-id FK on
  // `catalogues(id)` (`locations.catalogue_id`, `location_catalogues.catalogue_id`) that rejects an
  // absent id at the DATA layer even if the guard is skipped; the guard is what turns that into a
  // clean 404, and it is also the only layer that can say WHICH id was wrong — this engine's
  // foreign-key refusal is the whole message `FOREIGN KEY constraint failed`, naming no table and
  // no column (`packages/db/src/constraint-target.ts`). Neither layer can check more than the id,
  // because every catalogue in the database belongs to the one taxpayer. DELETE needs no guard:
  // removing a non-member row is a no-op.
  app.get("/management-api/locations/:locationId/catalogues", (c) =>
    run(c, log, async () => {
      const sessionId = requireManagementSession(c);
      const locationId = requireUuidParam(c.req.param("locationId"), "LocationId");
      const rows = await gated(sessionId, (tx) => listCataloguesForLocation(tx, locationId));
      return c.json(rows);
    }),
  );

  app.post("/management-api/locations/:locationId/catalogues", (c) =>
    run(c, log, async () => {
      const sessionId = requireManagementSession(c);
      const locationId = requireUuidParam(c.req.param("locationId"), "LocationId");
      const catalogueId = await requireCatalogueIdBody(c);
      await gated(sessionId, async (tx) => {
        await assertCatalogueVisible(tx, catalogueId);
        await addCatalogueToLocation(tx, locationId, catalogueId);
      });
      return c.body(null, 204);
    }),
  );

  app.delete("/management-api/locations/:locationId/catalogues/:catalogueId", (c) =>
    run(c, log, async () => {
      const sessionId = requireManagementSession(c);
      const locationId = requireUuidParam(c.req.param("locationId"), "LocationId");
      const catalogueId = requireUuidParam(c.req.param("catalogueId"), "CatalogueId");
      await gated(sessionId, (tx) => removeCatalogueFromLocation(tx, locationId, catalogueId));
      return c.body(null, 204);
    }),
  );

  app.put("/management-api/locations/:locationId/default-catalogue", (c) =>
    run(c, log, async () => {
      const sessionId = requireManagementSession(c);
      const locationId = requireUuidParam(c.req.param("locationId"), "LocationId");
      const catalogueId = await requireCatalogueIdBody(c);
      await gated(sessionId, async (tx) => {
        await assertCatalogueVisible(tx, catalogueId);
        await setLocationDefaultCatalogue(tx, locationId, catalogueId);
      });
      return c.body(null, 204);
    }),
  );

  // ── Categories ─────────────────────────────────────────────────────────────────────────────────
  app.get("/management-api/categories", (c) =>
    run(c, log, async () => {
      const sessionId = requireManagementSession(c);
      const rows = await gated(sessionId, (tx) => listCategories(tx));
      return c.json(rows);
    }),
  );

  app.post("/management-api/categories", (c) =>
    run(c, log, async () => {
      const sessionId = requireManagementSession(c);
      const body = await readJsonBody<Record<string, unknown>>(c);
      const input = categoryInput(body, true) as CategoryInput;
      const created = await gated(sessionId, (tx) =>
        createCategory(tx, input, deps.venueLocale ?? FALLBACK_LOCALE),
      );
      return c.json(created, 201);
    }),
  );

  app.get("/management-api/categories/:id", (c) =>
    run(c, log, async () => {
      const session = requireManagementSession(c);
      const id = requireUuidParam(c.req.param("id"), "CategoryId");
      return c.json(await gated(session, (tx) => readCategory(tx, id)));
    }),
  );
  app.patch("/management-api/categories/:id", (c) =>
    run(c, log, async () => {
      const session = requireManagementSession(c);
      const id = requireUuidParam(c.req.param("id"), "CategoryId");
      const input = categoryInput(await readJsonBody<Record<string, unknown>>(c), false);
      return c.json(
        await gated(session, (tx) =>
          updateCategory(tx, id, input, deps.venueLocale ?? FALLBACK_LOCALE),
        ),
      );
    }),
  );
  app.delete("/management-api/categories/:id", (c) =>
    run(c, log, async () => {
      const session = requireManagementSession(c);
      const id = requireUuidParam(c.req.param("id"), "CategoryId");
      await gated(session, (tx) => deleteCategory(tx, id));
      return c.body(null, 204);
    }),
  );
  // What deleting this category would touch — the preview the dashboard's delete confirmation reads.
  app.get("/management-api/categories/:id/dependants", (c) =>
    run(c, log, async () => {
      const session = requireManagementSession(c);
      const id = requireUuidParam(c.req.param("id"), "CategoryId");
      return c.json(await gated(session, (tx) => categoryDependants(tx, id)));
    }),
  );
  app.get("/management-api/categories/:id/products", (c) =>
    run(c, log, async () => {
      const session = requireManagementSession(c);
      const id = requireUuidParam(c.req.param("id"), "CategoryId");
      return c.json(await gated(session, (tx) => listCategoryProducts(tx, id)));
    }),
  );
  // Add a whole selection of products to one category in a single transaction. The body screen
  // checks SHAPE only (an array of uuid-shaped strings, and that screen is the only thing refusing a
  // malformed one); whether each id names a product of this tenant, and whether the selection
  // repeats one, is `addProductsToCategory`'s `category.membership_invalid`. An empty selection is
  // a legitimate no-op.
  app.post("/management-api/categories/:id/products", (c) =>
    run(c, log, async () => {
      const session = requireManagementSession(c);
      const id = requireUuidParam(c.req.param("id"), "CategoryId");
      const body = await readJsonBody<{ productIds?: unknown }>(c);
      if (!Array.isArray(body.productIds) || body.productIds.some((v) => typeof v !== "string"))
        throw new AppError("management.request_invalid", { field: "productIds" });
      const productIds = body.productIds.map((pid) => requireUuidParam(pid as string, "ProductId"));
      await gated(session, (tx) => addProductsToCategory(tx, id, productIds));
      return c.body(null, 204);
    }),
  );
  app.get("/management-api/products", (c) =>
    run(c, log, async () => {
      const session = requireManagementSession(c);
      return c.json(await gated(session, (tx) => listProducts(tx)));
    }),
  );
  app.get("/management-api/products/:id/categories", (c) =>
    run(c, log, async () => {
      const session = requireManagementSession(c);
      const id = requireUuidParam(c.req.param("id"), "ProductId");
      return c.json(await gated(session, (tx) => readProductCategories(tx, id)));
    }),
  );
  app.put("/management-api/products/:id/categories", (c) =>
    run(c, log, async () => {
      const session = requireManagementSession(c);
      const id = requireUuidParam(c.req.param("id"), "ProductId");
      const body = await readJsonBody<{ categoryIds?: unknown; primaryCategoryId?: unknown }>(c);
      if (
        !Array.isArray(body.categoryIds) ||
        body.categoryIds.some((id) => typeof id !== "string" || !isUuid(id))
      )
        throw new AppError("management.request_invalid", { field: "categoryIds" });
      if (
        body.primaryCategoryId !== undefined &&
        body.primaryCategoryId !== null &&
        (typeof body.primaryCategoryId !== "string" || !isUuid(body.primaryCategoryId))
      )
        throw new AppError("management.request_invalid", { field: "primaryCategoryId" });
      return c.json(
        await gated(session, (tx) =>
          replaceProductCategories(tx, id, {
            categoryIds: body.categoryIds as string[],
            ...(body.primaryCategoryId === undefined
              ? {}
              : { primaryCategoryId: body.primaryCategoryId as string | null }),
          }),
        ),
      );
    }),
  );

  // ── Products ───────────────────────────────────────────────────────────────────────────────────
  app.get("/management-api/catalogues/:id/products", (c) =>
    run(c, log, async () => {
      const sessionId = requireManagementSession(c);
      const catalogueId = requireUuidParam(c.req.param("id"), "CatalogueId");
      const rows = await gated(sessionId, (tx) => listProducts(tx, catalogueId));
      return c.json(rows);
    }),
  );

  app.post("/management-api/catalogues/:id/product-editor", (c) =>
    run(c, log, async () => {
      const sessionId = requireManagementSession(c);
      const catalogueId = requireUuidParam(c.req.param("id"), "CatalogueId");
      const body = await readJsonBody<Record<string, unknown>>(c);
      const routing = screenRouting(body);
      const saved = await gated(sessionId, async (tx) => {
        const product = await saveProductEditor(
          tx,
          null,
          catalogueId,
          body,
          deps.venueLocale ?? FALLBACK_LOCALE,
        );
        return applyRouting(tx, product, routing);
      });
      return c.json(saved, 201);
    }),
  );

  app.get("/management-api/products/:id/editor", (c) =>
    run(c, log, async () => {
      const sessionId = requireManagementSession(c);
      const productId = requireUuidParam(c.req.param("id"), "ProductId");
      return c.json(await gated(sessionId, (tx) => readProductEditor(tx, productId)));
    }),
  );

  app.put("/management-api/products/:id/editor", (c) =>
    run(c, log, async () => {
      const sessionId = requireManagementSession(c);
      const productId = requireUuidParam(c.req.param("id"), "ProductId");
      const body = await readJsonBody<Record<string, unknown>>(c);
      const routing = screenRouting(body);
      return c.json(
        await gated(sessionId, async (tx) => {
          const product = await saveProductEditor(
            tx,
            productId,
            "00000000-0000-0000-0000-000000000000",
            body,
            deps.venueLocale ?? FALLBACK_LOCALE,
          );
          return applyRouting(tx, product, routing);
        }),
      );
    }),
  );

  app.post("/management-api/products", (c) =>
    run(c, log, async () => {
      const sessionId = requireManagementSession(c);
      // Read via `readJsonBody` so an empty/malformed/`null`/non-object body hits the field screens as
      // a 400 rather than becoming an opaque 500 (the management-api convention). Each REQUIRED field is
      // type-screened, refusing a missing/wrong-typed one as `management.request_invalid` naming the
      // FIELD, never the value. `allergens` is left to `createProduct`'s `validateAllergens`, which
      // throws the authoritative `allergen.*` codes; a well-formed-but-out-of-range `pricingUnit` /
      // `vatClass` (a string the CHECK rejects) flows on to the DB, the same typeof-only posture the
      // management staff routes take.
      const body = await readJsonBody<{
        catalogueId?: unknown;
        categoryId?: unknown;
        name?: unknown;
        customerName?: unknown;
        unitId?: unknown;
        pricingUnit?: unknown;
        unitPrice?: unknown;
        vatClass?: unknown;
        allergens?: unknown;
        dietOverride?: unknown;
        image?: unknown;
        active?: unknown;
        available?: unknown;
        soldAlone?: unknown;
        modifiers?: unknown;
        // The two fields `modifiers` replaced, declared so `refuseLegacyAttachFields` can see them.
        modifierIds?: unknown;
        optionGroupIds?: unknown;
      }>(c);
      if (typeof body.catalogueId !== "string") {
        throw new AppError("management.request_invalid", { field: "catalogueId" });
      }
      if (typeof body.categoryId !== "string" && body.categoryId !== null) {
        throw new AppError("management.request_invalid", { field: "categoryId" });
      }
      if (typeof body.name !== "string" || !body.name.trim()) {
        throw new AppError("management.request_invalid", { field: "name" });
      }
      const customerName = screenCustomerName(body.customerName);
      if (body.unitId !== undefined && (typeof body.unitId !== "string" || !isUuid(body.unitId))) {
        throw new AppError("management.request_invalid", { field: "unitId" });
      }
      if (body.unitId === undefined && body.pricingUnit === undefined) {
        throw new AppError("management.request_invalid", { field: "unitId" });
      }
      if (body.pricingUnit !== undefined && typeof body.pricingUnit !== "string") {
        throw new AppError("management.request_invalid", { field: "pricingUnit" });
      }
      if (typeof body.unitPrice !== "string") {
        throw new AppError("management.request_invalid", { field: "unitPrice" });
      }
      refuseNegativePrice(body.unitPrice, "unitPrice");
      if (typeof body.vatClass !== "string") {
        throw new AppError("management.request_invalid", { field: "vatClass" });
      }
      if (body.image !== undefined && typeof body.image !== "string") {
        throw new AppError("management.request_invalid", { field: "image" });
      }
      if (body.active !== undefined && typeof body.active !== "boolean") {
        throw new AppError("management.request_invalid", { field: "active" });
      }
      if (body.available !== undefined && typeof body.available !== "boolean") {
        throw new AppError("management.request_invalid", { field: "available" });
      }
      if (body.soldAlone !== undefined && typeof body.soldAlone !== "boolean") {
        throw new AppError("management.request_invalid", { field: "soldAlone" });
      }
      // The optional staff diet override (Task 4): SHAPE-screened here (object or null, like
      // `customerName`), then threaded raw to `createProduct`, whose `validateDietOverride` is the
      // authority on the label/contains-tag/disjointness content — exactly the posture `allergens`
      // takes with `validateAllergens`.
      screenDietOverride(body.dietOverride);
      // The optional ordered attach list: screened here and applied in the SAME transaction as the
      // create, so a product and its extras/options lists land atomically.
      refuseLegacyAttachFields(body);
      const modifiers = parseProductModifiers(body.modifiers);
      const input = {
        catalogueId: body.catalogueId,
        categoryId: body.categoryId,
        name: body.name.trim(),
        customerName,
        ...(body.unitId === undefined
          ? { pricingUnit: body.pricingUnit as never }
          : { unitId: body.unitId as string }),
        unitPrice: body.unitPrice,
        vatClass: body.vatClass as never,
        ...(body.allergens === undefined ? {} : { allergens: body.allergens as ProductAllergens }),
        ...(body.dietOverride === undefined
          ? {}
          : { dietOverride: body.dietOverride as DietOverride | null }),
        ...(body.image === undefined ? {} : { image: body.image }),
        ...(body.active === undefined ? {} : { active: body.active }),
        ...(body.available === undefined ? {} : { available: body.available }),
        ...(body.soldAlone === undefined ? {} : { soldAlone: body.soldAlone }),
      };
      const created = await gated(sessionId, async (tx) => {
        if (customerName !== null) {
          await validateContentTranslations(tx, customerName, deps.venueLocale ?? FALLBACK_LOCALE);
        }
        const product = await createProduct(tx, input);
        if (modifiers === undefined) return { ...product, modifiers: [] };
        await writeProductModifiers(tx, product.id, modifiers);
        // The 201 reports the STORED list, read back inside the same transaction, never the array
        // the caller sent: `writeProductModifiers` lower-cases every list id, so a caller that
        // sent an upper-cased one would otherwise be told its attachments are held in a casing the
        // database does not have, and its own next read would disagree with this response. The
        // read is skipped above when the body named no list, because a product created a statement
        // ago carries nothing whatever the read would say.
        const stored = await readProductModifiers(tx, [product.id]);
        return { ...product, modifiers: stored.get(product.id) ?? [] };
      });
      return c.json(created, 201);
    }),
  );

  app.patch("/management-api/products/:id", (c) =>
    run(c, log, async () => {
      const sessionId = requireManagementSession(c);
      const productId = requireUuidParam(c.req.param("id"), "ProductId");
      // Every field is OPTIONAL (a PATCH touches only what it names) and the body is coerced to `{}` by
      // `readJsonBody`, so an empty/malformed/`null` body is a legitimate no-op that bumps `updatedAt`. A field PRESENT with a
      // wrong type is refused as `management.request_invalid` naming it; `allergens` is validated by
      // `updateProduct` (the `allergen.*` authority). Only present keys enter `patch`, so an absent
      // field is never written.
      const body = await readJsonBody<{
        name?: unknown;
        customerName?: unknown;
        unitPrice?: unknown;
        vatClass?: unknown;
        unitId?: unknown;
        pricingUnit?: unknown;
        categoryId?: unknown;
        allergens?: unknown;
        dietOverride?: unknown;
        image?: unknown;
        active?: unknown;
        available?: unknown;
        soldAlone?: unknown;
        modifiers?: unknown;
        // The two fields `modifiers` replaced, declared so `refuseLegacyAttachFields` can see them.
        modifierIds?: unknown;
        optionGroupIds?: unknown;
      }>(c);
      const patch: UpdateProductInput = {};
      if (body.name !== undefined) {
        if (typeof body.name !== "string" || !body.name.trim()) {
          throw new AppError("management.request_invalid", { field: "name" });
        }
        patch.name = body.name.trim();
      }
      if (body.customerName !== undefined) {
        patch.customerName = screenCustomerName(body.customerName);
      }
      if (body.unitPrice !== undefined) {
        if (typeof body.unitPrice !== "string") {
          throw new AppError("management.request_invalid", { field: "unitPrice" });
        }
        refuseNegativePrice(body.unitPrice, "unitPrice");
        patch.unitPrice = body.unitPrice;
      }
      if (body.vatClass !== undefined) {
        if (typeof body.vatClass !== "string") {
          throw new AppError("management.request_invalid", { field: "vatClass" });
        }
        patch.vatClass = body.vatClass as never;
      }
      if (body.pricingUnit !== undefined) {
        if (typeof body.pricingUnit !== "string") {
          throw new AppError("management.request_invalid", { field: "pricingUnit" });
        }
        patch.pricingUnit = body.pricingUnit as never;
      }
      if (body.unitId !== undefined) {
        if (typeof body.unitId !== "string" || !isUuid(body.unitId)) {
          throw new AppError("management.request_invalid", { field: "unitId" });
        }
        patch.unitId = body.unitId;
      }
      if (body.categoryId !== undefined) {
        if (typeof body.categoryId !== "string" && body.categoryId !== null) {
          throw new AppError("management.request_invalid", { field: "categoryId" });
        }
        patch.categoryId = body.categoryId;
      }
      if (body.image !== undefined) {
        if (typeof body.image !== "string" && body.image !== null) {
          throw new AppError("management.request_invalid", { field: "image" });
        }
        patch.image = body.image;
      }
      if (body.active !== undefined) {
        if (typeof body.active !== "boolean") {
          throw new AppError("management.request_invalid", { field: "active" });
        }
        patch.active = body.active;
      }
      if (body.available !== undefined) {
        if (typeof body.available !== "boolean") {
          throw new AppError("management.request_invalid", { field: "available" });
        }
        patch.available = body.available;
      }
      if (body.soldAlone !== undefined) {
        if (typeof body.soldAlone !== "boolean") {
          throw new AppError("management.request_invalid", { field: "soldAlone" });
        }
        patch.soldAlone = body.soldAlone;
      }
      if (body.allergens !== undefined) {
        patch.allergens = body.allergens as ProductAllergens | null;
      }
      // The diet override (Task 4): shape-screened (object or null) then threaded raw; `updateProduct`'s
      // `validateDietOverride` is the content authority, and it republishes `diet` only when the key is
      // present — the same posture `allergens` takes.
      if (body.dietOverride !== undefined) {
        screenDietOverride(body.dietOverride);
        patch.dietOverride = body.dietOverride as DietOverride | null;
      }
      // The optional ordered attach list: a full replace when present, applied in the SAME
      // transaction as the field update. Absent leaves the product's attachments untouched; `[]`
      // detaches them all. An empty `patch` alongside a present `modifiers` is fine — `updateProduct`
      // always bumps `updatedAt`, so its `.set()` is never empty.
      refuseLegacyAttachFields(body);
      const modifiers = parseProductModifiers(body.modifiers);
      await gated(sessionId, async (tx) => {
        await assertOwned(tx, productId);
        // A customer-facing name is optional: absent or wholly blank, the staff name is what a
        // receipt shows, so there is nothing to hold to the venue's default content language. One
        // with no text in that language is a translation gap and is refused.
        if (patch.customerName != null)
          await validateContentTranslations(
            tx,
            patch.customerName,
            deps.venueLocale ?? FALLBACK_LOCALE,
          );
        await updateProduct(tx, productId, patch);
        if (modifiers !== undefined) {
          await writeProductModifiers(tx, productId, modifiers);
        }
      });
      return c.body(null, 204);
    }),
  );
}

/**
 * The venue config the product editor's kitchen routing needs (`deps.venueCfg`), or a fail-closed
 * throw. `boot.ts` always supplies it for a real venue server, so this is a misconfiguration guard,
 * not a request fault — the same posture `management-api.ts`'s namesake takes.
 */
function requireVenueCfg(deps: CatalogueApiDeps): TillConfig {
  /* v8 ignore start -- boot always threads a venueCfg; only a harness that omits it AND sends editor
     routing reaches this, which no suite does — a config error, surfaced as an opaque 500 by `run`. */
  if (deps.venueCfg === undefined) {
    throw new Error("mountCatalogueApi: venueCfg is required for the product editor's routing");
  }
  /* v8 ignore stop */
  return deps.venueCfg;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Screen a product's optional customer-facing name: a language->text object, or `null` for "none".
 * A map with no non-blank entry means the same as `null` — the staff name is what a receipt shows —
 * so it is folded to `null` here and never reaches `validateContentTranslations`, which would
 * otherwise refuse it for lacking the default language. Literally the same fold the product editor's
 * parser makes — both call `nonBlankTranslations` — so the two write paths cannot disagree. The
 * per-LANGUAGE checks stay with `validateContentTranslations`, the authority on them.
 */
function screenCustomerName(value: unknown): Record<string, string> | null {
  if (value === undefined || value === null) return null;
  if (!isPlainObject(value)) {
    throw new AppError("management.request_invalid", { field: "customerName" });
  }
  const entries = Object.entries(value);
  if (entries.some(([, text]) => typeof text !== "string")) {
    throw new AppError("management.request_invalid", { field: "customerName" });
  }
  return nonBlankTranslations(Object.fromEntries(entries) as Record<string, string>);
}
