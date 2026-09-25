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
  setMainReportingCategory,
  listCategoryProducts,
  listLabels,
  createLabel,
  renameLabel,
  deleteLabel,
  readProductLabels,
  setProductLabels,
  type CategoryInput,
  type CategoryReassignment,
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
   * The venue whose kitchen stations and courses the product editor may route a product to. Optional
   * so a suite that never routes a product can mount without it; `requireVenueCfg` throws on a
   * routing request that arrives without one.
   */
  venueCfg?: TillConfig;
  venueLocale?: string;
}

/**
 * The one permission that gates every `/management-api` catalogue route. `person.manage` stands in
 * until a `catalogue.manage` permission exists; realising it is a one-line swap here.
 */
const CATALOGUE_WRITE_PERMISSION: Permission = "person.manage";

/** A label body's `name`, shape only: `createLabel`/`renameLabel` trim it and refuse a blank. */
async function requireLabelName(c: Context): Promise<string> {
  const body = await readJsonBody<{ name?: unknown }>(c);
  if (typeof body.name !== "string")
    throw new AppError("management.request_invalid", { field: "name" });
  return body.name;
}

function nullOrUuid(value: unknown, field: string): string | null {
  if (value !== null && (typeof value !== "string" || !isUuid(value)))
    throw new AppError("management.request_invalid", { field });
  return value;
}

async function requireTopLevelProduct(tx: Transaction, productId: string): Promise<void> {
  const [row] = await tx
    .select({ id: products.id })
    .from(products)
    .where(productWithId(productId, "top-level"));
  if (!row) throw new AppError("product.not_found", { productId });
}

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
  if (body.parentId !== undefined) result.parentId = nullOrUuid(body.parentId, "parentId");
  if (body.image !== undefined) {
    if (body.image !== null && typeof body.image !== "string")
      throw new AppError("management.request_invalid", { field: "image" });
    result.image = body.image as string | null;
  }
  // Shape screen only — `createCategory`/`updateCategory` own the `#rrggbb` format check.
  if (body.color !== undefined) {
    if (body.color !== null && typeof body.color !== "string")
      throw new AppError("management.request_invalid", { field: "color" });
    result.color = body.color as string | null;
  }
  return result;
}

const STATUS: Record<string, ContentfulStatusCode> = {
  "management_session.required": 401,
  "management_session.expired": 401,
  "person.suspended": 403,
  "authorization.not_permitted": 403,
  "management.request_invalid": 400,
  "shared.invalid_id": 400,
  // Raised by the `decimal()` inside the catalogue writes' `stringToCents`, not by this file:
  // `refuseNegativePrice` swallows its own `decimal()` throw.
  "shared.invalid_decimal": 400,
  // Raised by the op's `decimalToCents`, not by this file's screens.
  "shared.decimal_overflow": 400,
  "catalogue.not_found": 404,
  "category.not_found": 404,
  "category.color_invalid": 400,
  "category.reassign_invalid": 400,
  "label.invalid": 400,
  "label.not_found": 404,
  "label.name_taken": 409,
  "menu_item.not_found": 404,
  // A menu offer asked for a variant, which follows its parent onto the menu instead.
  "menu_item.variant_not_allowed": 400,
  "product.not_found": 404,
  "product.invalid": 400,
  // Retired: nothing throws it since a product may have one variant. Still mapped, as a shipped
  // code stays registered.
  "product.variant_count_invalid": 400,
  "menu_section.not_found": 404,
  // The product editor's kitchen routing: an id that names no LIVE station or course of this venue.
  "station.not_found": 404,
  "course.not_found": 404,
  "allergen.invalid_code": 400,
  "allergen.invalid_presence": 400,
  "allergen.invalid_source": 400,
  "diet.invalid_origin": 400,
  "diet.invalid_label": 400,
  "diet.add_remove_conflict": 400,
  // Retired with the option-group machinery; nothing throws them. A shipped code stays mapped.
  "modifier.invalid": 400,
  "modifier.not_found": 404,
  "modifier.in_use": 409,
  "options.group_invalid": 400,
  "options.item_invalid": 400,
  "options.invalid": 400,
  "options.translation_required": 400,
  "options.not_found": 404,
  // Nothing throws it: a list delete cascades its product attachments rather than refusing.
  "options.in_use": 409,
  "extras.invalid": 400,
  "extras.translation_required": 400,
  "extras.not_found": 404,
  // Nothing throws it: an extras list delete cascades rather than refusing.
  "extras.in_use": 409,
  // Raised on the till surface (a diner's picks), never by a route here.
  "extras.limit_exceeded": 400,
  // 409: the body was well formed, and what another stored row holds refused it.
  "extras.product_has_variants": 409,
  "product.offered_as_extra": 409,
  // Nothing throws it, and no route deletes a product.
  "product.in_use": 409,
};

const run = createErrorBoundary(STATUS, "catalogue.failed");

/**
 * Nothing below this screen objects to a malformed id — every id column is plain `text`, so the
 * value would simply match no row. Shape only: a well-formed id that names no row passes.
 */
function requireUuidParam(id: string, kind: string): string {
  if (!isUuid(id)) throw new AppError("shared.invalid_id", { kind, value: id });
  return id;
}

/**
 * Refuse a negative CATALOGUE price. Scoped to the catalogue deliberately: a corrective invoice's
 * totals are negative on purpose, so "a price is never negative" is only true of prices this file
 * writes.
 *
 * SIGN ONLY. A value `decimal()` cannot parse is left to the write's own `decimal()`, which keeps
 * both the error code and the order in which a request carrying two faults reports them. `decimal()`
 * drops the sign from a zero magnitude, so `-0.00` is not refused.
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

/** A SHAPE screen only; whether the id names a catalogue is {@link assertCatalogueVisible}'s job. */
async function requireCatalogueIdBody(c: Context): Promise<string> {
  const body = await readJsonBody<{ catalogueId?: unknown }>(c);
  if (typeof body.catalogueId !== "string") {
    throw new AppError("management.request_invalid", { field: "catalogueId" });
  }
  return requireUuidParam(body.catalogueId, "CatalogueId");
}

/**
 * The foreign keys on `catalogues(id)` also refuse an absent id; this check is what turns that into a
 * clean `catalogue.not_found` naming the id.
 */
async function assertCatalogueVisible(tx: Transaction, catalogueId: string): Promise<void> {
  if (!(await catalogueExists(tx, catalogueId))) {
    throw new AppError("catalogue.not_found", { catalogueId });
  }
}

/**
 * The int4 bound here is the ONLY bound: this engine's INTEGER is 64-bit whatever the declared type
 * says, so the column itself refuses nothing.
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

/** A SHAPE screen only; `createProduct`/`updateProduct` validate the content (the `diet.*` codes). */
function screenDietOverride(value: unknown): void {
  if (value !== undefined && value !== null && !isPlainObject(value)) {
    throw new AppError("management.request_invalid", { field: "dietOverride" });
  }
}

/**
 * The ordered attach list, in the order a diner is offered them; absent leaves the product's
 * attachments untouched. A SHAPE screen only: duplicates and whether each id names a real list are
 * `writeProductModifiers`' checks, so a repeat is refused rather than quietly collapsed.
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
 * Refuse a product body still carrying one of the two fields the ordered `modifiers` list replaced.
 * Ignoring it would save a product with NO attachments and answer success. No first-party client
 * sends either field; this catches a client that predates the change, such as a dashboard tab left
 * open across the deploy.
 */
function refuseLegacyAttachFields(body: Record<string, unknown>): void {
  for (const legacy of ["modifierIds", "optionGroupIds"])
    if (body[legacy] !== undefined)
      throw new AppError("management.request_invalid", { field: legacy });
}

/** `mountCatalogueApi`'s `gated`: one transaction, with the caller's session checked first. */
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
 * Mount the six routes that serve one kind of modifier list. Both kinds sit UNDER
 * `/management-api/modifiers` because a dish's one attachment list holds either kind. A
 * `/management-api/modifiers/:id` route registered ahead of these would swallow both segments.
 */
function mountListSurface<TList, TDependants>(
  app: Hono,
  gated: GatedWork,
  log: Logger,
  surface: ListSurface<TList, TDependants>,
): void {
  // `as const` keeps these as a template literal TYPE rather than `string`, and Hono reads the `:id`
  // out of that type.
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
      // Session before body: an unauthenticated request is refused without its payload being read.
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
  // What deleting this list would touch — the preview a delete confirmation reads.
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
  // Every `/management-api` route's DB work goes through here, so the gate is applied in exactly
  // one place.
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
      // A malformed id gets the same not-found code an absent one does, as in `management-api.ts`.
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
   * Write the product's kitchen routing on the SAME transaction the product was saved on, so a
   * station or course id the venue does not have rolls the whole product back. Only a body that
   * writes routing needs the re-read.
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
   * Refuse a product patch naming no stored product, or naming a variant. This read is what refuses
   * an unknown id at all: `updateProduct` reports nothing when no row matches.
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
    dependants: optionListDependants,
  });

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

  // A location's menu list: its default `locations.catalogue_id` plus `location_catalogues` members.
  // PUT sets the default; the old default is demoted to a member, never dropped. DELETE needs no
  // catalogue guard: removing a non-member row is a no-op.
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
  // An optional body says where the products and subcategories go; an absent key, or no body at
  // all, takes `deleteCategory`'s default.
  app.delete("/management-api/categories/:id", (c) =>
    run(c, log, async () => {
      const session = requireManagementSession(c);
      const id = requireUuidParam(c.req.param("id"), "CategoryId");
      const body = await readJsonBody<Record<string, unknown>>(c);
      const reassign: CategoryReassignment = {};
      for (const field of ["productsTo", "childrenTo"] as const) {
        if (body[field] !== undefined) reassign[field] = nullOrUuid(body[field], field);
      }
      await gated(session, (tx) => deleteCategory(tx, id, reassign));
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
      const includeDescendants = c.req.query("descendants") === "1";
      return c.json(
        await gated(session, (tx) => listCategoryProducts(tx, id, { includeDescendants })),
      );
    }),
  );
  // The body screen checks SHAPE only; whether each id names a product, and whether the selection
  // repeats one, is `addProductsToCategory`'s `category.membership_invalid`.
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
  // A variant's id answers as an unknown id here, as on every product-by-id route but the editor's:
  // `setMainReportingCategory`'s default scope finds only a product with no parent.
  app.put("/management-api/products/:id/categories", (c) =>
    run(c, log, async () => {
      const session = requireManagementSession(c);
      const id = requireUuidParam(c.req.param("id"), "ProductId");
      const body = await readJsonBody<{ primaryCategoryId?: unknown }>(c);
      const categoryId = nullOrUuid(body.primaryCategoryId, "primaryCategoryId");
      return c.json(await gated(session, (tx) => setMainReportingCategory(tx, id, categoryId)));
    }),
  );

  app.get("/management-api/labels", (c) =>
    run(c, log, async () => {
      const session = requireManagementSession(c);
      return c.json(await gated(session, (tx) => listLabels(tx)));
    }),
  );
  app.post("/management-api/labels", (c) =>
    run(c, log, async () => {
      const session = requireManagementSession(c);
      const name = await requireLabelName(c);
      return c.json(await gated(session, (tx) => createLabel(tx, name)), 201);
    }),
  );
  app.patch("/management-api/labels/:id", (c) =>
    run(c, log, async () => {
      const session = requireManagementSession(c);
      const id = requireUuidParam(c.req.param("id"), "LabelId");
      const name = await requireLabelName(c);
      return c.json(await gated(session, (tx) => renameLabel(tx, id, name)));
    }),
  );
  app.delete("/management-api/labels/:id", (c) =>
    run(c, log, async () => {
      const session = requireManagementSession(c);
      const id = requireUuidParam(c.req.param("id"), "LabelId");
      await gated(session, (tx) => deleteLabel(tx, id));
      return c.body(null, 204);
    }),
  );
  // A variant's id answers as an unknown id on both, as on every product-by-id route but the
  // editor's; the editor carries a variant's inherited labels.
  app.get("/management-api/products/:id/labels", (c) =>
    run(c, log, async () => {
      const session = requireManagementSession(c);
      const id = requireUuidParam(c.req.param("id"), "ProductId");
      return c.json(
        await gated(session, async (tx) => {
          await requireTopLevelProduct(tx, id);
          return { labelIds: await readProductLabels(tx, id) };
        }),
      );
    }),
  );
  app.put("/management-api/products/:id/labels", (c) =>
    run(c, log, async () => {
      const session = requireManagementSession(c);
      const id = requireUuidParam(c.req.param("id"), "ProductId");
      const body = await readJsonBody<{ labelIds?: unknown }>(c);
      if (
        !Array.isArray(body.labelIds) ||
        body.labelIds.some((labelId) => typeof labelId !== "string" || !isUuid(labelId))
      )
        throw new AppError("management.request_invalid", { field: "labelIds" });
      const labelIds = body.labelIds as string[];
      return c.json(
        await gated(session, async (tx) => {
          await requireTopLevelProduct(tx, id);
          return { labelIds: await setProductLabels(tx, id, labelIds) };
        }),
      );
    }),
  );

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
      // `allergens` is left to `createProduct`, which throws the authoritative `allergen.*` codes.
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
      screenDietOverride(body.dietOverride);
      // Applied in the SAME transaction as the create, so a product and its lists land atomically.
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
        // The 201 reports the STORED list, never the array the caller sent: `writeProductModifiers`
        // lower-cases every list id.
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
      if (body.dietOverride !== undefined) {
        screenDietOverride(body.dietOverride);
        patch.dietOverride = body.dietOverride as DietOverride | null;
      }
      // A full replace when present; `[]` detaches them all. An empty `patch` is fine: `updateProduct`
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

/** A misconfiguration guard, not a request fault: `boot.ts` always supplies `venueCfg`. */
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
 * A map with no non-blank entry means the same as `null` — the staff name is what a receipt shows —
 * so `nonBlankTranslations` folds it to `null`, the same fold the product editor's parser makes.
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
