import { mountContentTranslationsApi, type GatedWork } from "./content-translations-api.js";
import { isProductOrdering, nonBlankTranslations } from "@waitron/catalogue";
import "./errors.js";
import type { Context, Hono } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import {
  AppError,
  FALLBACK_LOCALE,
  decimal,
  type ContentLanguageRules,
  type Decimal,
} from "@waitron/shared";
import { withTransaction, type Database, type Transaction } from "@waitron/db";
import {
  addCatalogueToLocation,
  moveCatalogueItems,
  deleteCatalogueItems,
  summariseFolders,
  menusHolding,
  type CatalogueSelection,
  type FolderContents,
  type ShownFolderCounts,
  catalogueExists,
  readCatalogueSettings,
  saveCatalogueDefaultColor,
  saveCatalogueSettings,
  readContentLanguages,
  listTranslationGapReport,
  writeContentLanguages,
  validateContentTranslations,
  createCatalogue,
  createCategory,
  readCategory,
  updateCategory,
  listMembers,
  readSection,
  createSectionIn,
  updateSection,
  deleteSection,
  addMember,
  addProducts,
  removeMember,
  moveMember,
  moveMembersInto,
  removeMembers,
  type MemberAt,
  replaceMember,
  HOME_DEVICES,
  readMenuHome,
  setHomeDisplay,
  addShortcut,
  replaceShortcut,
  removeShortcut,
  moveShortcut,
  type MemberRef,
  type SectionInput,
  type SectionPatch,
  setIncludeFolder,
  type IncludeFolderInput,
  type CategoryInput,
  createProduct,
  listCatalogues,
  listCataloguesForLocation,
  listCategories,
  menuPrices,
  menuStatus,
  previewMenu,
  publishMenu,
  cancelMenuPublication,
  listMenuPublications,
  queueMenuPublication,
  rescheduleMenuPublication,
  type MenuPublicationsAnswer,
  readMenuStructure,
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
  extraOfferUsageForUnitChange,
  listProducts,
  removeCatalogueFromLocation,
  setLocationDefaultCatalogue,
  updateMenuDetails,
  updateMenuItem,
  listMenuVariants,
  setMenuVariantPrice,
  setMenuVariants,
  type MenuVariant,
  readProductEditor,
  saveProductEditor,
  isModifierListKind,
  readProductModifiers,
  writeProductModifiers,
  type ProductModifierRef,
  type DietOverride,
  type ProductAllergens,
  type ProductEditorValue,
  type ProductRouting,
} from "@waitron/catalogue";
import { authorizeManager, type Permission } from "@waitron/identity";
import { createErrorBoundary } from "@waitron/server-kit";
import { readJsonBody, requireEnum, requireString } from "@waitron/server-kit";
import { requireManagementSession } from "@waitron/server-kit";
import { isUuid } from "./till-session.js";
import { setProductCourse } from "./kitchen.js";
import type { TillConfig } from "./till-config.js";
import type { Logger } from "./logger.js";
import { VENUE_SERVICE } from "./modules.js";
import { readLocationClock } from "@waitron/reporting";
import { activationInstant, checkedTimeZone, localTimeOf } from "./menu-publication-time.js";
import { kitchenStations } from "@waitron/db";
import { inArray } from "drizzle-orm";

/** Catalogue and content-language routes. One taxpayer per database, so nothing filters by one. */
export interface CatalogueApiDeps {
  /** The content languages the venue must keep; none when absent. */
  contentLanguageRules?: ContentLanguageRules;
  contentTranslationGaps?: (
    tx: Transaction,
    language: string,
  ) => Promise<{ kind: string; id: string }[]>;
  db: Database;
  /** Required by the routes that read the venue's location; `requireVenueCfg` throws without it. */
  venueCfg?: TillConfig;
  venueLocale?: string;
}

/**
 * The one permission that gates every `/management-api` catalogue route. `person.manage` stands in
 * until a `catalogue.manage` permission exists; realising it is a one-line swap here.
 */
const CATALOGUE_WRITE_PERMISSION: Permission = "person.manage";

const NO_CONTENT_LANGUAGE_RULES: ContentLanguageRules = { required: [], official: [] };

function nullOrUuid(value: unknown, field: string): string | null {
  if (value !== null && (typeof value !== "string" || !isUuid(value)))
    throw new AppError("management.request_invalid", { field });
  return value;
}

function categoryInput(body: Record<string, unknown>, creating: boolean): Partial<CategoryInput> {
  const result: Partial<CategoryInput> = {};
  if (creating || body.name !== undefined) {
    if (typeof body.name !== "string")
      throw new AppError("management.request_invalid", { field: "name" });
    result.name = body.name;
  }
  if (body.parentId !== undefined) result.parentId = nullOrUuid(body.parentId, "parentId");
  if (body.color !== undefined) {
    if (body.color !== null && typeof body.color !== "string")
      throw new AppError("management.request_invalid", { field: "color" });
    result.color = body.color;
  }
  return result;
}

/** A section's, a menu's or an include folder's presentation body, shape only: the catalogue
 * function each route hands it to checks the values. */
function sectionInput(body: Record<string, unknown>, creating: true): SectionInput;
function sectionInput(body: Record<string, unknown>, creating: false): SectionPatch;
function sectionInput(body: Record<string, unknown>, creating: boolean): SectionPatch {
  const result: SectionPatch = {};
  if (creating || body.internalName !== undefined) {
    if (typeof body.internalName !== "string")
      throw new AppError("management.request_invalid", { field: "internalName" });
    result.internalName = body.internalName;
  }
  if (body.names !== undefined) {
    if (
      !isPlainObject(body.names) ||
      Object.values(body.names).some((value) => typeof value !== "string")
    )
      throw new AppError("management.request_invalid", { field: "names" });
    result.names = body.names as Record<string, string>;
  }
  for (const field of ["image", "color"] as const) {
    const value = body[field];
    if (value === undefined) continue;
    if (value !== null && typeof value !== "string")
      throw new AppError("management.request_invalid", { field });
    result[field] = value;
  }
  return result;
}

const INCLUDE_FOLDER_OVERRIDES: readonly string[] = ["names", "image", "color"];

/** An include's folder body, shape only: `setIncludeFolder` checks the values. */
function includeFolderInput(body: unknown): IncludeFolderInput {
  const invalid = (field: string) => new AppError("management.request_invalid", { field });
  if (!isPlainObject(body) || typeof body.showAsFolder !== "boolean") throw invalid("showAsFolder");
  if (body.overrides === undefined) return { showAsFolder: body.showAsFolder };
  const overrides = body.overrides;
  if (
    !isPlainObject(overrides) ||
    Object.keys(overrides).some((key) => !INCLUDE_FOLDER_OVERRIDES.includes(key))
  )
    throw invalid("overrides");
  return { showAsFolder: body.showAsFolder, overrides: sectionInput(overrides, false) };
}

function memberRef(value: unknown): MemberRef {
  if (isPlainObject(value)) {
    if (value.kind === "product" && typeof value.productId === "string")
      return { kind: "product", productId: requireUuidParam(value.productId, "ProductId") };
    if (value.kind === "section" && typeof value.sectionId === "string")
      return { kind: "section", sectionId: requireUuidParam(value.sectionId, "SectionId") };
  }
  throw new AppError("management.request_invalid", { field: "ref" });
}

/** An array of strings, each a well-formed id of `kind`. */
function idList(value: unknown, field: string, kind: string): string[] {
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== "string"))
    throw new AppError("management.request_invalid", { field });
  return value.map((entry: string) => requireUuidParam(entry, kind));
}

/** Members named by the list holding each, every member at most once. */
function membersBody(value: unknown): MemberAt[] {
  const invalid = () => new AppError("management.request_invalid", { field: "members" });
  if (!Array.isArray(value) || value.length === 0) throw invalid();
  const members = value.map((entry: unknown): MemberAt => {
    if (
      !isPlainObject(entry) ||
      typeof entry.listId !== "string" ||
      typeof entry.memberId !== "string"
    )
      throw invalid();
    return {
      listId: requireUuidParam(entry.listId, "SectionId"),
      memberId: requireUuidParam(entry.memberId, "SectionMemberId"),
    };
  });
  if (new Set(members.map(({ memberId }) => memberId)).size !== members.length) throw invalid();
  return members;
}

function selectionBody(body: Record<string, unknown>): CatalogueSelection {
  const ids = (field: "productIds" | "categoryIds", kind: string): string[] => {
    const list = idList(body[field], field, kind);
    if (new Set(list).size !== list.length)
      throw new AppError("management.request_invalid", { field });
    return list;
  };
  return {
    productIds: ids("productIds", "ProductId"),
    categoryIds: ids("categoryIds", "CategoryId"),
  };
}

/** One entry per selected category, exactly; the counts themselves are compared by the delete. */
function shownBody(value: unknown, categoryIds: readonly string[]): ShownFolderCounts[] {
  const invalid = () => new AppError("management.request_invalid", { field: "shown" });
  const count = (n: unknown): n is number => Number.isSafeInteger(n) && (n as number) >= 0;
  if (!Array.isArray(value)) throw invalid();
  const shown = value.map((entry: unknown): ShownFolderCounts => {
    if (
      !isPlainObject(entry) ||
      typeof entry.id !== "string" ||
      !isUuid(entry.id) ||
      !count(entry.folders) ||
      !count(entry.products) ||
      !count(entry.activeProducts) ||
      !count(entry.routes) ||
      !count(entry.ownRoutes)
    )
      throw invalid();
    return {
      id: entry.id,
      folders: entry.folders,
      products: entry.products,
      activeProducts: entry.activeProducts,
      routes: entry.routes,
      ownRoutes: entry.ownRoutes,
    };
  });
  const ids = new Set(shown.map(({ id }) => id));
  if (
    ids.size !== shown.length ||
    ids.size !== categoryIds.length ||
    categoryIds.some((id) => !ids.has(id))
  )
    throw invalid();
  return shown;
}

/** A position or index, shape only: the section writes refuse a negative or fractional one. */
function numberField(value: unknown, field: string): number {
  if (typeof value !== "number") throw new AppError("management.request_invalid", { field });
  return value;
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
  "location.not_found": 404,
  "category.not_found": 404,
  "category.invalid": 400,
  "category.parent_cycle": 409,
  "menu_item.not_found": 404,
  // A menu offer asked for a variant, which follows its parent onto the menu instead.
  "menu_item.variant_not_allowed": 400,
  "product.not_found": 404,
  "product.invalid": 400,
  "menu_section.not_found": 404,
  "menu_section.invalid": 400,
  "menu_section.translation_required": 400,
  "menu_section.membership_invalid": 400,
  // 409: the body was well formed, and what the stored lists hold refused it.
  "menu_section.member_cycle": 409,
  "menu_section.member_duplicate": 409,
  "menu_section.wrong_role": 409,
  // The working menu no longer matches the preview the publish was asked from.
  "menu.changed_since_preview": 409,
  "menu.clashes_unresolved": 409,
  "menu_publication.overtakes_queued": 409,
  "menu_publication.not_found": 404,
  "menu_publication.not_queued": 409,
  "menu_publication.time_past": 400,
  "menu_publication.unchanged": 409,
  "menu_publication.time_skipped": 400,
  "menu_publication.time_repeated": 400,
  "time_zone.unreadable": 409,
  "menu.shortcut_unreachable": 409,
  "menu.home_display_invalid": 400,
  // The product editor refuses a course this venue does not have.
  "course.not_found": 404,
  "allergen.invalid_code": 400,
  "allergen.invalid_presence": 400,
  "allergen.invalid_source": 400,
  "diet.invalid_origin": 400,
  "diet.invalid_label": 400,
  "diet.add_remove_conflict": 400,
  "options.invalid": 400,
  "options.translation_required": 400,
  "options.not_found": 404,
  "extras.invalid": 400,
  "extras.translation_required": 400,
  "extras.not_found": 404,
  // Raised on the till surface (a diner's picks), never by a route here.
  "extras.limit_exceeded": 400,
  // 409: the body was well formed, and what another stored row holds refused it.
  "extras.product_has_variants": 409,
  "product.offered_as_extra": 409,
  "category.name_taken": 409,
  "category.contents_changed": 409,
  "product.name_taken": 409,
  "product.archived": 409,
  "product.on_live_menu": 409,
};

const run = createErrorBoundary(STATUS, "catalogue.failed");
const runFolder = createErrorBoundary(
  { ...STATUS, "category.parent_cycle": 409 },
  "catalogue.failed",
);
// A product create names its catalogue in the body, so an unknown one is a 400
// (docs/developers/conventions-data.md, "A refusal's HTTP status says what was wrong").
const runCreateProduct = createErrorBoundary(
  { ...STATUS, "catalogue.not_found": 400 },
  "catalogue.failed",
);
// The single-variant route names its variant in the path, so an unknown one is a 404; the whole-list
// PUT names variants in its body, and an unknown one there stays a 400.
const runVariant = createErrorBoundary(
  { ...STATUS, "product.variant_not_found": 404 },
  "catalogue.failed",
);

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

function parseMenuVariants(value: unknown): MenuVariant[] {
  if (!Array.isArray(value)) {
    throw new AppError("management.request_invalid", { field: "variants" });
  }
  return value.map((entry, index) => {
    if (
      !isPlainObject(entry) ||
      typeof entry.variantId !== "string" ||
      (entry.price !== null && typeof entry.price !== "string") ||
      Object.hasOwn(entry, "offered")
    ) {
      throw new AppError("management.request_invalid", { field: `variants.${index}` });
    }
    return {
      variantId: requireUuidParam(entry.variantId, "ProductVariantId"),
      price: entry.price,
    };
  });
}

/** A SHAPE screen only; the location-menu writes check that the id names a catalogue. */
async function requireCatalogueIdBody(c: Context): Promise<string> {
  const body = await readJsonBody<{ catalogueId?: unknown }>(c);
  if (typeof body.catalogueId !== "string") {
    throw new AppError("management.request_invalid", { field: "catalogueId" });
  }
  return requireUuidParam(body.catalogueId, "CatalogueId");
}

/** A read filtered by an absent catalogue would answer an empty list rather than name it. */
async function assertCatalogueVisible(tx: Transaction, catalogueId: string): Promise<void> {
  if (!(await catalogueExists(tx, catalogueId))) {
    throw new AppError("catalogue.not_found", { catalogueId });
  }
}

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
 * Refuse a product body still carrying a retired field: `modifierIds` or `optionGroupIds`, which the
 * ordered `modifiers` list replaced, or `soldAlone`, which `ordering` replaced. Ignoring one would
 * answer success without saving what it asked for. No first-party client sends any of them; this
 * catches a client that predates the change, such as a dashboard tab left open across the deploy.
 */
function refuseRetiredFields(body: Record<string, unknown>): void {
  for (const retired of ["modifierIds", "optionGroupIds", "soldAlone"])
    if (body[retired] !== undefined)
      throw new AppError("management.request_invalid", { field: retired });
}

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
      const lists = await gated(c, requireManagementSession(c), (tx) => surface.list(tx));
      return c.json({ [surface.collectionKey]: lists });
    }),
  );
  app.post(collection, (c) =>
    run(c, log, async () => {
      // Session before body: an unauthenticated request is refused without its payload being read.
      const sessionId = requireManagementSession(c);
      const body = await readJsonBody(c);
      const created = await gated(c, sessionId, (tx) => surface.create(tx, body));
      return c.json({ [surface.itemKey]: created }, 201);
    }),
  );
  app.get(one, (c) =>
    run(c, log, async () => {
      const id = requireUuidParam(c.req.param("id"), surface.idKind);
      const list = await gated(c, requireManagementSession(c), (tx) => surface.read(tx, id));
      return c.json({ [surface.itemKey]: list });
    }),
  );
  app.patch(one, (c) =>
    run(c, log, async () => {
      const id = requireUuidParam(c.req.param("id"), surface.idKind);
      const sessionId = requireManagementSession(c);
      const body = await readJsonBody(c);
      const updated = await gated(c, sessionId, (tx) => surface.update(tx, id, body));
      return c.json({ [surface.itemKey]: updated });
    }),
  );
  app.delete(one, (c) =>
    run(c, log, async () => {
      const id = requireUuidParam(c.req.param("id"), surface.idKind);
      await gated(c, requireManagementSession(c), (tx) => surface.remove(tx, id));
      return c.json({ ok: true });
    }),
  );
  // What deleting this list would touch — read by the dashboard's Used by popup and its delete
  // confirmation.
  app.get(`${one}/dependants`, (c) =>
    run(c, log, async () => {
      const id = requireUuidParam(c.req.param("id"), surface.idKind);
      const dependants = await gated(c, requireManagementSession(c), (tx) =>
        surface.dependants(tx, id),
      );
      return c.json({ dependants });
    }),
  );
}

/** Owned lists, their members, and menu inclusion targets. */
function mountSectionRoutes(app: Hono, gated: GatedWork, log: Logger, venueLocale: string): void {
  const collection = "/management-api/sections";
  const one = `${collection}/:id` as const;
  const members = `${one}/members` as const;
  const member = `${members}/:memberId` as const;
  const sectionId = (c: Context) => requireUuidParam(c.req.param("id")!, "SectionId");
  const memberId = (c: Context) => requireUuidParam(c.req.param("memberId")!, "SectionMemberId");

  app.post(`${one}/sections`, (c) =>
    run(c, log, async () => {
      const session = requireManagementSession(c);
      const body = await readJsonBody<Record<string, unknown>>(c);
      const input = sectionInput(body, true);
      const position =
        body.position === undefined ? undefined : numberField(body.position, "position");
      const created = await gated(c, session, (tx) =>
        createSectionIn(tx, sectionId(c), input, position, venueLocale),
      );
      return c.json({ id: created.id }, 201);
    }),
  );
  app.get(one, (c) =>
    run(c, log, async () => {
      const session = requireManagementSession(c);
      const id = sectionId(c);
      return c.json(await gated(c, session, (tx) => readSection(tx, id)));
    }),
  );
  app.patch(one, (c) =>
    run(c, log, async () => {
      const session = requireManagementSession(c);
      const id = sectionId(c);
      const patch = sectionInput(await readJsonBody<Record<string, unknown>>(c), false);
      return c.json(await gated(c, session, (tx) => updateSection(tx, id, patch, venueLocale)));
    }),
  );
  app.delete(one, (c) =>
    run(c, log, async () => {
      const session = requireManagementSession(c);
      const id = sectionId(c);
      await gated(c, session, (tx) => deleteSection(tx, id));
      return c.body(null, 204);
    }),
  );
  app.get(members, (c) =>
    run(c, log, async () => {
      const session = requireManagementSession(c);
      const id = sectionId(c);
      return c.json(await gated(c, session, (tx) => listMembers(tx, id)));
    }),
  );
  app.post(members, (c) =>
    run(c, log, async () => {
      const session = requireManagementSession(c);
      const id = sectionId(c);
      const body = await readJsonBody<{ ref?: unknown; position?: unknown }>(c);
      const ref = memberRef(body.ref);
      const position =
        body.position === undefined ? undefined : numberField(body.position, "position");
      return c.json(await gated(c, session, (tx) => addMember(tx, id, ref, position)), 201);
    }),
  );
  app.post(`${members}/products`, (c) =>
    run(c, log, async () => {
      const session = requireManagementSession(c);
      const id = sectionId(c);
      const body = await readJsonBody<{ productIds?: unknown }>(c);
      const productIds = idList(body.productIds, "productIds", "ProductId");
      return c.json(await gated(c, session, (tx) => addProducts(tx, id, productIds)));
    }),
  );
  app.delete(member, (c) =>
    run(c, log, async () => {
      const session = requireManagementSession(c);
      const id = sectionId(c);
      const held = memberId(c);
      await gated(c, session, (tx) => removeMember(tx, id, held));
      return c.body(null, 204);
    }),
  );
  app.post(`${members}/move-in`, (c) =>
    run(c, log, async () => {
      const session = requireManagementSession(c);
      const id = sectionId(c);
      const body = await readJsonBody<{ members?: unknown; position?: unknown }>(c);
      const moved = membersBody(body.members);
      const position =
        body.position === undefined ? undefined : numberField(body.position, "position");
      return c.json(await gated(c, session, (tx) => moveMembersInto(tx, id, moved, position)));
    }),
  );
  app.post("/management-api/section-members/remove", (c) =>
    run(c, log, async () => {
      const session = requireManagementSession(c);
      const removed = membersBody((await readJsonBody<{ members?: unknown }>(c)).members);
      await gated(c, session, (tx) => removeMembers(tx, removed));
      return c.body(null, 204);
    }),
  );
  app.put(`${member}/position`, (c) =>
    run(c, log, async () => {
      const session = requireManagementSession(c);
      const id = sectionId(c);
      const held = memberId(c);
      const body = await readJsonBody<{ to?: unknown }>(c);
      const to = numberField(body.to, "to");
      return c.json(await gated(c, session, (tx) => moveMember(tx, id, held, to)));
    }),
  );
  app.put(`${member}/folder`, (c) =>
    run(c, log, async () => {
      const session = requireManagementSession(c);
      const id = sectionId(c);
      const held = memberId(c);
      const input = includeFolderInput(await readJsonBody<unknown>(c));
      return c.json(
        await gated(c, session, (tx) => setIncludeFolder(tx, id, held, input, venueLocale)),
      );
    }),
  );
  app.post(`${member}/replace`, (c) =>
    run(c, log, async () => {
      const session = requireManagementSession(c);
      const id = sectionId(c);
      const held = memberId(c);
      const ref = memberRef((await readJsonBody<{ ref?: unknown }>(c)).ref);
      return c.json(await gated(c, session, (tx) => replaceMember(tx, id, held, ref)));
    }),
  );
}

/** A menu's Device Home Page. A shortcut is a member of the menu's home section, but shortcuts
 * have their own routes: the generic member routes refuse every write into that section. */
function mountMenuHomeRoutes(app: Hono, gated: GatedWork, log: Logger): void {
  const home = "/management-api/catalogues/:id/home";
  const shortcuts = `${home}/shortcuts` as const;
  const shortcut = `${shortcuts}/:memberId` as const;
  const menuId = (c: Context) => requireUuidParam(c.req.param("id")!, "MenuId");
  const memberId = (c: Context) => requireUuidParam(c.req.param("memberId")!, "SectionMemberId");

  app.get(home, (c) =>
    run(c, log, async () => {
      const session = requireManagementSession(c);
      const menu = menuId(c);
      return c.json(await gated(c, session, (tx) => readMenuHome(tx, menu)));
    }),
  );
  app.patch("/management-api/catalogues/:id/home-display", (c) =>
    run(c, log, async () => {
      const session = requireManagementSession(c);
      const menu = menuId(c);
      const body = await readJsonBody<{
        device?: unknown;
        columns?: unknown;
        tiles?: unknown;
        order?: unknown;
      }>(c);
      const device = requireEnum(body.device, "device", HOME_DEVICES);
      const { columns, tiles, order } = body;
      await gated(c, session, (tx) => setHomeDisplay(tx, menu, device, { columns, tiles, order }));
      return c.body(null, 204);
    }),
  );
  app.post(shortcuts, (c) =>
    run(c, log, async () => {
      const session = requireManagementSession(c);
      const menu = menuId(c);
      const body = await readJsonBody<{ ref?: unknown; position?: unknown }>(c);
      const ref = memberRef(body.ref);
      const position =
        body.position === undefined ? undefined : numberField(body.position, "position");
      return c.json(await gated(c, session, (tx) => addShortcut(tx, menu, ref, position)), 201);
    }),
  );
  app.post(`${shortcut}/replace`, (c) =>
    run(c, log, async () => {
      const session = requireManagementSession(c);
      const menu = menuId(c);
      const held = memberId(c);
      const ref = memberRef((await readJsonBody<{ ref?: unknown }>(c)).ref);
      return c.json(await gated(c, session, (tx) => replaceShortcut(tx, menu, held, ref)));
    }),
  );
  app.delete(shortcut, (c) =>
    run(c, log, async () => {
      const session = requireManagementSession(c);
      const menu = menuId(c);
      const held = memberId(c);
      await gated(c, session, (tx) => removeShortcut(tx, menu, held));
      return c.body(null, 204);
    }),
  );
  app.put(`${shortcut}/position`, (c) =>
    run(c, log, async () => {
      const session = requireManagementSession(c);
      const menu = menuId(c);
      const held = memberId(c);
      const to = numberField((await readJsonBody<{ to?: unknown }>(c)).to, "to");
      return c.json(await gated(c, session, (tx) => moveShortcut(tx, menu, held, to)));
    }),
  );
}

export function mountCatalogueApi(app: Hono, deps: CatalogueApiDeps, log: Logger): void {
  const epoch = crypto.randomUUID();
  let sequence = 0;
  const gated: GatedWork = (c, sessionId, fn) =>
    withTransaction(deps.db, async (tx) => {
      const { authorizedBy } = await authorizeManager(tx, {
        managementSessionId: sessionId,
        permission: CATALOGUE_WRITE_PERMISSION,
      });
      const result = await fn(tx, authorizedBy);
      if (c.req.method !== "GET") sequence++;
      c.header("x-waitron-menu-revision", JSON.stringify({ epoch, sequence }));
      return result;
    });

  app.get("/management-api/catalogue-settings", (c) =>
    run(c, log, async () => {
      const sessionId = requireManagementSession(c);
      return c.json(await gated(c, sessionId, (tx) => readCatalogueSettings(tx)));
    }),
  );
  app.put("/management-api/catalogue-settings", (c) =>
    run(c, log, async () => {
      const sessionId = requireManagementSession(c);
      const body = await readJsonBody<{ defaultProductVatClass?: unknown }>(c);
      return c.json(
        await gated(c, sessionId, (tx) =>
          saveCatalogueSettings(tx, { defaultProductVatClass: body.defaultProductVatClass }),
        ),
      );
    }),
  );
  app.put("/management-api/catalogue-settings/default-color", (c) =>
    run(c, log, async () => {
      const sessionId = requireManagementSession(c);
      const body = await readJsonBody<{ color?: unknown }>(c);
      if (body.color !== null && typeof body.color !== "string")
        throw new AppError("management.request_invalid", { field: "color" });
      return c.json(await gated(c, sessionId, (tx) => saveCatalogueDefaultColor(tx, body.color)));
    }),
  );

  /** Screen the editor body's optional course; null clears it. */
  const screenRouting = (body: Record<string, unknown>): ProductRouting => {
    const value = body.courseId;
    if (value !== undefined && value !== null && typeof value !== "string") {
      throw new AppError("management.request_invalid", { field: "courseId" });
    }
    if (typeof value === "string" && !isUuid(value)) {
      throw new AppError("course.not_found", { courseId: value });
    }
    return { courseId: value as string | null | undefined };
  };

  /** Save the course on the same transaction as the product. */
  const applyRouting = async (
    tx: Transaction,
    saved: ProductEditorValue,
    routing: ProductRouting,
  ): Promise<ProductEditorValue> => {
    if (routing.courseId === undefined) return saved;
    const cfg = requireVenueCfg(deps);
    await setProductCourse(tx, cfg, saved.id, routing.courseId, "any");
    return readProductEditor(tx, saved.id);
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

  mountSectionRoutes(app, gated, log, deps.venueLocale ?? FALLBACK_LOCALE);
  mountMenuHomeRoutes(app, gated, log);
  mountContentTranslationsApi(app, gated, log, {
    fallbackLanguage: deps.venueLocale ?? FALLBACK_LOCALE,
    required: deps.contentLanguageRules?.required ?? [],
  });

  app.get("/management-api/content-languages", (c) =>
    run(c, log, async () => {
      const sessionId = requireManagementSession(c);
      return c.json(
        await gated(c, sessionId, (tx) =>
          readContentLanguages(tx, deps.venueLocale ?? FALLBACK_LOCALE),
        ),
      );
    }),
  );

  app.get("/management-api/content-language-rules", (c) =>
    run(c, log, async () => {
      const sessionId = requireManagementSession(c);
      return c.json(
        await gated(
          c,
          sessionId,
          async () => deps.contentLanguageRules ?? NO_CONTENT_LANGUAGE_RULES,
        ),
      );
    }),
  );

  app.get("/management-api/content-translation-gaps", (c) =>
    run(c, log, async () => {
      const sessionId = requireManagementSession(c);
      return c.json(
        await gated(c, sessionId, async (tx) =>
          listTranslationGapReport(
            tx,
            await readContentLanguages(tx, deps.venueLocale ?? FALLBACK_LOCALE),
          ),
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
      await gated(c, sessionId, (tx) =>
        writeContentLanguages(
          tx,
          config,
          deps.venueLocale ?? FALLBACK_LOCALE,
          deps.contentTranslationGaps,
          deps.contentLanguageRules?.required,
        ),
      );
      return c.body(null, 204);
    }),
  );

  app.get("/management-api/catalogues", (c) =>
    run(c, log, async () => {
      const sessionId = requireManagementSession(c);
      const rows = await gated(c, sessionId, (tx) => listCatalogues(tx));
      return c.json(rows);
    }),
  );

  // One request for every menu's status, so the menus list does not ask once per row.
  app.get("/management-api/catalogues/status", (c) =>
    run(c, log, async () => {
      const sessionId = requireManagementSession(c);
      const status = await gated(c, sessionId, (tx) => menuStatus(tx));
      return c.json(Object.fromEntries(status));
    }),
  );

  app.post("/management-api/catalogues", (c) =>
    run(c, log, async () => {
      const sessionId = requireManagementSession(c);
      const body = await readJsonBody<Record<string, unknown>>(c);
      const name = requireString(body.name, "name");
      if (name.trim() === "") throw new AppError("management.request_invalid", { field: "name" });
      const presentation = sectionInput({ ...body, internalName: name }, true);
      const created = await gated(c, sessionId, (tx) =>
        createCatalogue(tx, {
          name,
          names: presentation.names,
          image: presentation.image,
          color: presentation.color,
        }),
      );
      return c.json(created, 201);
    }),
  );

  app.patch("/management-api/catalogues/:id", (c) =>
    run(c, log, async () => {
      const sessionId = requireManagementSession(c);
      const catalogueId = requireUuidParam(c.req.param("id"), "CatalogueId");
      const body = await readJsonBody<Record<string, unknown>>(c);
      const presentation = sectionInput({ ...body, internalName: body.name }, false);
      if (presentation.internalName !== undefined && presentation.internalName.trim() === "")
        throw new AppError("management.request_invalid", { field: "name" });
      await gated(c, sessionId, (tx) =>
        updateMenuDetails(tx, catalogueId, {
          name: presentation.internalName,
          names: presentation.names,
          image: presentation.image,
          color: presentation.color,
        }),
      );
      return c.body(null, 204);
    }),
  );

  app.get("/management-api/catalogues/:id/read", (c) =>
    run(c, log, async () => {
      const sessionId = requireManagementSession(c);
      const menuId = requireUuidParam(c.req.param("id"), "MenuId");
      const parts = c.req.queries("part") ?? [];
      if (
        parts.length === 0 ||
        new Set(parts).size !== parts.length ||
        parts.some((part) => !["structure", "home", "status", "preview"].includes(part))
      )
        throw new AppError("management.request_invalid", { field: "part" });
      const result = await gated(c, sessionId, async (tx) => {
        const responses: Record<string, { status: number; body: unknown }> = {};
        for (const part of parts) {
          const response = await run(c, log, async () => {
            if (part === "structure") return c.json(await readMenuStructure(tx, menuId));
            if (part === "home") return c.json(await readMenuHome(tx, menuId));
            if (part === "preview") return c.json(await previewMenu(tx, menuId));
            const status = (await menuStatus(tx, [menuId])).get(menuId);
            if (status === undefined)
              throw new AppError("catalogue.not_found", { catalogueId: menuId });
            return c.json(status);
          });
          responses[part] = { status: response.status, body: await response.json() };
        }
        return { ...responses, revision: { epoch, sequence } };
      });
      return c.json(result);
    }),
  );

  app.get("/management-api/catalogues/:id/structure", (c) =>
    run(c, log, async () => {
      const sessionId = requireManagementSession(c);
      const menuId = requireUuidParam(c.req.param("id"), "MenuId");
      return c.json(await gated(c, sessionId, (tx) => readMenuStructure(tx, menuId)));
    }),
  );

  app.get("/management-api/catalogues/:id/prices", (c) =>
    run(c, log, async () => {
      const sessionId = requireManagementSession(c);
      const menuId = requireUuidParam(c.req.param("id"), "MenuId");
      return c.json(await gated(c, sessionId, (tx) => menuPrices(tx, menuId)));
    }),
  );

  app.get("/management-api/catalogues/:id/status", (c) =>
    run(c, log, async () => {
      const sessionId = requireManagementSession(c);
      const menuId = requireUuidParam(c.req.param("id"), "MenuId");
      const status = await gated(c, sessionId, async (tx) =>
        (await menuStatus(tx, [menuId])).get(menuId),
      );
      if (status === undefined) throw new AppError("catalogue.not_found", { catalogueId: menuId });
      return c.json(status);
    }),
  );

  app.get("/management-api/catalogues/:id/preview", (c) =>
    run(c, log, async () => {
      const sessionId = requireManagementSession(c);
      const menuId = requireUuidParam(c.req.param("id"), "MenuId");
      return c.json(await gated(c, sessionId, (tx) => previewMenu(tx, menuId)));
    }),
  );

  app.post("/management-api/catalogues/:id/publish", (c) =>
    run(c, log, async () => {
      const sessionId = requireManagementSession(c);
      const menuId = requireUuidParam(c.req.param("id"), "MenuId");
      const body = await readJsonBody<{ expectedHash?: unknown }>(c);
      const expectedHash = requireString(body.expectedHash, "expectedHash");
      return c.json(
        await gated(c, sessionId, (tx, personId) =>
          publishMenu(tx, menuId, expectedHash, personId),
        ),
      );
    }),
  );

  const venueTimeZone = async (tx: Transaction): Promise<string> =>
    (await readLocationClock(tx, requireVenueCfg(deps).locationId)).timeZone;

  app.post("/management-api/catalogues/:id/publications", (c) =>
    run(c, log, async () => {
      const sessionId = requireManagementSession(c);
      const menuId = requireUuidParam(c.req.param("id"), "MenuId");
      const body = await readJsonBody<{ expectedHash?: unknown; activatesAt?: unknown }>(c);
      const expectedHash = requireString(body.expectedHash, "expectedHash");
      const queued = await gated(c, sessionId, async (tx, personId) => {
        const activatesAt = activationInstant(body.activatesAt, await venueTimeZone(tx));
        return queueMenuPublication(tx, menuId, expectedHash, activatesAt, personId);
      });
      return c.json(queued, 201);
    }),
  );

  app.get("/management-api/catalogues/:id/publications", (c) =>
    run(c, log, async () => {
      const sessionId = requireManagementSession(c);
      const menuId = requireUuidParam(c.req.param("id"), "MenuId");
      const answer = await gated(c, sessionId, async (tx): Promise<MenuPublicationsAnswer> => {
        if (!(await catalogueExists(tx, menuId)))
          throw new AppError("catalogue.not_found", { catalogueId: menuId });
        const timeZone = checkedTimeZone(await venueTimeZone(tx));
        const { live, editions } = await listMenuPublications(tx, menuId);
        return {
          timeZone,
          live:
            live === null ? null : { ...live, local: localTimeOf(new Date(live.since), timeZone) },
          editions: editions.map((edition) => ({
            ...edition,
            local: localTimeOf(new Date(edition.activatesAt), timeZone),
          })),
        };
      });
      return c.json(answer);
    }),
  );

  app.patch("/management-api/catalogues/:id/publications/:versionId", (c) =>
    run(c, log, async () => {
      const sessionId = requireManagementSession(c);
      const menuId = requireUuidParam(c.req.param("id"), "MenuId");
      const versionId = requireUuidParam(c.req.param("versionId"), "MenuVersionId");
      const body = await readJsonBody<{ activatesAt?: unknown }>(c);
      const moved = await gated(c, sessionId, async (tx) => {
        const activatesAt = activationInstant(body.activatesAt, await venueTimeZone(tx));
        return rescheduleMenuPublication(tx, menuId, versionId, activatesAt);
      });
      return c.json(moved);
    }),
  );

  app.post("/management-api/catalogues/:id/publications/:versionId/cancel", (c) =>
    run(c, log, async () => {
      const sessionId = requireManagementSession(c);
      const menuId = requireUuidParam(c.req.param("id"), "MenuId");
      const versionId = requireUuidParam(c.req.param("versionId"), "MenuVersionId");
      await gated(c, sessionId, (tx, personId) =>
        cancelMenuPublication(tx, menuId, versionId, personId),
      );
      return c.body(null, 204);
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
      for (const retired of ["active", "offered"]) {
        if (Object.hasOwn(body, retired)) {
          throw new AppError("management.request_invalid", { field: retired });
        }
      }
      await gated(c, sessionId, (tx) =>
        updateMenuItem(tx, menuId, menuItemId, {
          ...(body.grossPrice === undefined
            ? {}
            : { grossPrice: body.grossPrice as string | null }),
        }),
      );
      return c.body(null, 204);
    }),
  );

  app.get("/management-api/catalogues/:id/items/:itemId/variants", (c) =>
    run(c, log, async () => {
      const sessionId = requireManagementSession(c);
      const menuId = requireUuidParam(c.req.param("id"), "MenuId");
      const menuItemId = requireUuidParam(c.req.param("itemId"), "MenuItemId");
      return c.json(await gated(c, sessionId, (tx) => listMenuVariants(tx, menuItemId, menuId)));
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
        await gated(c, sessionId, (tx) => setMenuVariants(tx, menuItemId, variants, menuId)),
      );
    }),
  );

  app.patch("/management-api/catalogues/:id/items/:itemId/variants/:variantId", (c) =>
    runVariant(c, log, async () => {
      const sessionId = requireManagementSession(c);
      const menuId = requireUuidParam(c.req.param("id"), "MenuId");
      const menuItemId = requireUuidParam(c.req.param("itemId"), "MenuItemId");
      const variantId = requireUuidParam(c.req.param("variantId"), "ProductVariantId");
      const body = await readJsonBody<Record<string, unknown>>(c);
      const extra = Object.keys(body).find((key) => key !== "price");
      if (extra !== undefined) throw new AppError("management.request_invalid", { field: extra });
      if (!Object.hasOwn(body, "price") || (body.price !== null && typeof body.price !== "string"))
        throw new AppError("management.request_invalid", { field: "price" });
      const price = body.price as string | null;
      await gated(c, sessionId, (tx) =>
        setMenuVariantPrice(tx, menuItemId, variantId, price, menuId),
      );
      return c.body(null, 204);
    }),
  );

  // A location's menu list: its default `locations.catalogue_id` plus `location_catalogues` members.
  // PUT sets the default; the old default is demoted to a member, never dropped. DELETE needs no
  // catalogue guard: removing a non-member row is a no-op.
  app.get("/management-api/locations/:locationId/catalogues", (c) =>
    run(c, log, async () => {
      const sessionId = requireManagementSession(c);
      const locationId = requireUuidParam(c.req.param("locationId"), "LocationId");
      const rows = await gated(c, sessionId, (tx) => listCataloguesForLocation(tx, locationId));
      return c.json(rows);
    }),
  );

  app.post("/management-api/locations/:locationId/catalogues", (c) =>
    run(c, log, async () => {
      const sessionId = requireManagementSession(c);
      const locationId = requireUuidParam(c.req.param("locationId"), "LocationId");
      const catalogueId = await requireCatalogueIdBody(c);
      await gated(c, sessionId, (tx) => addCatalogueToLocation(tx, locationId, catalogueId));
      return c.body(null, 204);
    }),
  );

  app.delete("/management-api/locations/:locationId/catalogues/:catalogueId", (c) =>
    run(c, log, async () => {
      const sessionId = requireManagementSession(c);
      const locationId = requireUuidParam(c.req.param("locationId"), "LocationId");
      const catalogueId = requireUuidParam(c.req.param("catalogueId"), "CatalogueId");
      await gated(c, sessionId, (tx) => removeCatalogueFromLocation(tx, locationId, catalogueId));
      return c.body(null, 204);
    }),
  );

  app.put("/management-api/locations/:locationId/default-catalogue", (c) =>
    run(c, log, async () => {
      const sessionId = requireManagementSession(c);
      const locationId = requireUuidParam(c.req.param("locationId"), "LocationId");
      const catalogueId = await requireCatalogueIdBody(c);
      await gated(c, sessionId, (tx) => setLocationDefaultCatalogue(tx, locationId, catalogueId));
      return c.body(null, 204);
    }),
  );

  app.get("/management-api/categories", (c) =>
    run(c, log, async () => {
      const sessionId = requireManagementSession(c);
      const rows = await gated(c, sessionId, (tx) => listCategories(tx));
      return c.json(rows);
    }),
  );

  app.post("/management-api/categories", (c) =>
    run(c, log, async () => {
      const sessionId = requireManagementSession(c);
      const body = await readJsonBody<Record<string, unknown>>(c);
      const input = categoryInput(body, true) as CategoryInput;
      const created = await gated(c, sessionId, (tx) => createCategory(tx, input));
      return c.json(created, 201);
    }),
  );

  app.post("/management-api/folders/move", (c) =>
    runFolder(c, log, async () => {
      const session = requireManagementSession(c);
      const body = await readJsonBody<Record<string, unknown>>(c);
      const selection = selectionBody(body);
      const to = nullOrUuid(body.to, "to");
      await gated(c, session, (tx) => moveCatalogueItems(tx, selection, to));
      return c.body(null, 204);
    }),
  );
  app.post("/management-api/folders/delete", (c) =>
    runFolder(c, log, async () => {
      const session = requireManagementSession(c);
      const body = await readJsonBody<Record<string, unknown>>(c);
      const selection = selectionBody(body);
      if (body.contents !== "move_up" && body.contents !== "delete")
        throw new AppError("management.request_invalid", { field: "contents" });
      const contents: FolderContents = body.contents;
      const shown = selection.categoryIds.length
        ? shownBody(body.shown, selection.categoryIds)
        : undefined;
      await gated(c, session, (tx) => deleteCatalogueItems(tx, selection, contents, shown));
      return c.body(null, 204);
    }),
  );
  app.get("/management-api/folders/summary", (c) =>
    runFolder(c, log, async () => {
      const session = requireManagementSession(c);
      const ids = (c.req.queries("id") ?? []).map((id) => requireUuidParam(id, "CategoryId"));
      return c.json(await gated(c, session, (tx) => summariseFolders(tx, ids)));
    }),
  );

  app.get("/management-api/categories/:id", (c) =>
    run(c, log, async () => {
      const session = requireManagementSession(c);
      const id = requireUuidParam(c.req.param("id"), "CategoryId");
      return c.json(await gated(c, session, (tx) => readCategory(tx, id)));
    }),
  );
  app.patch("/management-api/categories/:id", (c) =>
    run(c, log, async () => {
      const session = requireManagementSession(c);
      const id = requireUuidParam(c.req.param("id"), "CategoryId");
      const input = categoryInput(await readJsonBody<Record<string, unknown>>(c), false);
      return c.json(await gated(c, session, (tx) => updateCategory(tx, id, input)));
    }),
  );
  app.get("/management-api/products", (c) =>
    run(c, log, async () => {
      const session = requireManagementSession(c);
      return c.json(await gated(c, session, (tx) => listProducts(tx)));
    }),
  );
  app.get("/management-api/products/menus", (c) =>
    run(c, log, async () => {
      const session = requireManagementSession(c);
      const ids = (c.req.queries("id") ?? []).map((id) => requireUuidParam(id, "ProductId"));
      return c.json({ menus: await gated(c, session, (tx) => menusHolding(tx, ids)) });
    }),
  );
  app.get("/management-api/products/made-at", (c) =>
    run(c, log, async () => {
      const session = requireManagementSession(c);
      return c.json(
        await gated(c, session, async (tx) => {
          const makers = await VENUE_SERVICE.describeMakers(tx, requireVenueCfg(deps));
          const stationIds = [
            ...new Set(
              [...makers.values()].flatMap(({ route, unavailableStationId }) =>
                route?.kind === "station"
                  ? [route.stationId]
                  : unavailableStationId === null
                    ? []
                    : [unavailableStationId],
              ),
            ),
          ];
          const names = new Map(
            (stationIds.length
              ? await tx
                  .select({ id: kitchenStations.id, name: kitchenStations.name })
                  .from(kitchenStations)
                  .where(inArray(kitchenStations.id, stationIds))
              : []
            ).map(({ id, name }) => [id, name]),
          );
          return Object.fromEntries(
            [...makers].map(
              ([id, { route, variesByZone, noReplacement, unavailableStationId }]) => [
                id,
                {
                  stationId: route?.kind === "station" ? route.stationId : null,
                  stationName:
                    route?.kind === "station"
                      ? (names.get(route.stationId) ?? null)
                      : unavailableStationId === null
                        ? null
                        : (names.get(unavailableStationId) ?? null),
                  noPreparation: route?.kind === "no_preparation",
                  noReplacement,
                  variesByZone,
                },
              ],
            ),
          );
        }),
      );
    }),
  );
  app.get("/management-api/catalogues/:id/products", (c) =>
    run(c, log, async () => {
      const sessionId = requireManagementSession(c);
      const catalogueId = requireUuidParam(c.req.param("id"), "CatalogueId");
      const rows = await gated(c, sessionId, async (tx) => {
        await assertCatalogueVisible(tx, catalogueId);
        return listProducts(tx, catalogueId);
      });
      return c.json(rows);
    }),
  );

  app.post("/management-api/catalogues/:id/product-editor", (c) =>
    run(c, log, async () => {
      const sessionId = requireManagementSession(c);
      const catalogueId = requireUuidParam(c.req.param("id"), "CatalogueId");
      const body = await readJsonBody<Record<string, unknown>>(c);
      const routing = screenRouting(body);
      const saved = await gated(c, sessionId, async (tx) => {
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
      return c.json(await gated(c, sessionId, (tx) => readProductEditor(tx, productId)));
    }),
  );

  app.get("/management-api/products/:id/extra-usage", (c) =>
    run(c, log, async () => {
      const sessionId = requireManagementSession(c);
      const productId = requireUuidParam(c.req.param("id"), "ProductId");
      return c.json(
        await gated(c, sessionId, async (tx) => {
          await readProductEditor(tx, productId);
          return extraOfferUsageForUnitChange(tx, productId);
        }),
      );
    }),
  );

  app.put("/management-api/products/:id/editor", (c) =>
    run(c, log, async () => {
      const sessionId = requireManagementSession(c);
      const productId = requireUuidParam(c.req.param("id"), "ProductId");
      const body = await readJsonBody<Record<string, unknown>>(c);
      const routing = screenRouting(body);
      return c.json(
        await gated(c, sessionId, async (tx) => {
          const product = await saveProductEditor(
            tx,
            productId,
            "00000000-0000-0000-0000-000000000000",
            body,
            deps.venueLocale ?? FALLBACK_LOCALE,
          );
          return product.active ? applyRouting(tx, product, routing) : product;
        }),
      );
    }),
  );

  app.post("/management-api/products", (c) =>
    runCreateProduct(c, log, async () => {
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
        ordering?: unknown;
        modifiers?: unknown;
        // Retired fields, declared so `refuseRetiredFields` can see them.
        soldAlone?: unknown;
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
      if (body.ordering !== undefined && !isProductOrdering(body.ordering)) {
        throw new AppError("management.request_invalid", { field: "ordering" });
      }
      screenDietOverride(body.dietOverride);
      // Applied in the SAME transaction as the create, so a product and its lists land atomically.
      refuseRetiredFields(body);
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
        ...(body.ordering === undefined ? {} : { ordering: body.ordering }),
      };
      const created = await gated(c, sessionId, async (tx) => {
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
}

/** A misconfiguration guard, not a request fault: `boot.ts` always supplies `venueCfg`. */
function requireVenueCfg(deps: CatalogueApiDeps): TillConfig {
  /* v8 ignore start -- boot always threads a venueCfg; only a harness that omits it AND calls a route
     that reads the venue's location reaches this, which no suite does — surfaced as a 500 by `run`. */
  if (deps.venueCfg === undefined) {
    throw new Error(
      "mountCatalogueApi: venueCfg is required by routes that read the venue's location",
    );
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
