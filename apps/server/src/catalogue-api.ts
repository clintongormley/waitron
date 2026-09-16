import {
  createModifier,
  updateModifier,
  deleteModifier,
  getModifier,
  listModifiers,
  modifierDependants,
} from "@waitron/catalogue";
import { tenantId as brandTenantId } from "@waitron/shared";
import "./errors.js";
import type { Context, Hono } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { sql } from "drizzle-orm";
import { AppError, FALLBACK_LOCALE } from "@waitron/shared";
import { asAppUser, withTenant, type Database, type Transaction } from "@waitron/db";
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
  createOptionGroup,
  createOptionGroupItem,
  createProduct,
  deactivateMenuItem,
  listCatalogues,
  listCataloguesForLocation,
  listCategories,
  listMenuOffers,
  listMenuSections,
  listOptionGroupItems,
  listOptionGroups,
  listProductOptionGroupIds,
  listProducts,
  removeCatalogueFromLocation,
  setLocationDefaultCatalogue,
  setProductOptionGroups,
  renameCatalogue,
  updateOptionGroup,
  updateOptionGroupItem,
  updateMenuItem,
  updateMenuSection,
  updateProduct,
  listMenuVariants,
  setMenuVariants,
  type MenuVariant,
  readProductEditor,
  saveProductEditor,
  type CreateOptionGroupInput,
  type CreateOptionGroupItemInput,
  type DietOverride,
  type ProductAllergens,
  type UpdateOptionGroupInput,
  type UpdateOptionGroupItemInput,
  type ProductEditorValue,
  type UpdateProductInput,
  type VatClass,
} from "@waitron/catalogue";
import { authorizeManager, type Permission } from "@waitron/identity";
import { createErrorBoundary } from "@waitron/server-kit";
import { readJsonBody, requireString } from "@waitron/server-kit";
import { requireManagementSession } from "@waitron/server-kit";
import { isUuid } from "./till-session.js";
import { setProductCourse, setProductStation } from "./kitchen.js";
import type { TillConfig } from "./till-config.js";
import type { Logger } from "./logger.js";

/** Catalogue and content-language routes scope every operation to the configured tenant. */
export interface CatalogueApiDeps {
  contentTranslationGaps?: (
    tx: Transaction,
    tenantId: string,
    language: string,
  ) => Promise<{ kind: string; id: string }[]>;
  db: Database;
  /** `cfg.tenantId` scopes every `withTenant` below (one tenant per database). `nodeId` is this
   * node's id, carried on the uniform write-path `cfg` shape every mounted API takes; it no longer
   * stamps a capture origin — the application outbox and its capture triggers were removed (native
   * replication ships every row). */
  cfg: { tenantId: string; nodeId: string };
  /**
   * The venue whose kitchen stations and courses the product editor may route a product to. OPTIONAL
   * because `setProductStation`/`setProductCourse` check the id against `cfg.locationId`, which the
   * tenant-only `cfg` above does not carry; `boot.ts` always supplies it for a real venue server.
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
  "catalogue.not_found": 404,
  "category.not_found": 404,
  // A colour that is not `#rrggbb`, refused by `createCategory`/`updateCategory` before the write.
  "category.color_invalid": 400,
  "menu_item.not_found": 404,
  "product.not_found": 404,
  // A product editor save carrying exactly one variant: a product has no variants or at least two, so
  // this is a CLIENT request fault → 400. Listed explicitly as the house style requires; the `?? 400`
  // default already covers it.
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
  // An invalid option-group AUTHORING config (Task 11): the select bounds or the required⇒min rule the
  // DB CHECKs enforce, surfaced by `createOptionGroup`/`updateOptionGroup` as a clean 400 before the
  // write rather than the opaque 500 the CHECK would raise. The `?? 400` default already covers it; it
  // is listed explicitly as the house style requires.
  "modifier.invalid": 400,
  "modifier.not_found": 404,
  "modifier.in_use": 409,
  "options.group_invalid": 400,
  // An invalid option-ITEM per-option-quantity config (max_quantity < 1 / non-integer), surfaced by
  // `createOptionGroupItem`/`updateOptionGroupItem` as a clean 400 before the write rather than the
  // opaque 500 the `option_group_items_qty_ck` CHECK would raise. Listed explicitly as the house style
  // requires; the `?? 400` default already covers it.
  "options.item_invalid": 400,
};

// The one error boundary every catalogue route wraps its handler in — the shared `createErrorBoundary`
// closed over this surface's `STATUS` map and its `catalogue.failed` log tag, the catalogue
// counterpart of `management-api.ts`'s local `run`. Local, not exported.
const run = createErrorBoundary(STATUS, "catalogue.failed");

/**
 * Screen a `/…/:id` path param as a UUID before it reaches a `uuid` column, returning it. A
 * malformed id passed straight into a query would `22P02` → an opaque 500; refusing it here as
 * `shared.invalid_id` (the branded-id constructors' own code — `packages/shared/src/ids.ts`)
 * turns that 500 into a clean 400. Shape only: a well-formed id that names no row passes this and
 * is handled by the op it reaches. `value` is the caller-supplied uuid-shaped string, safe to
 * echo.
 */
function requireUuidParam(id: string, kind: string): string {
  if (!isUuid(id)) throw new AppError("shared.invalid_id", { kind, value: id });
  return id;
}

function parseMenuVariants(value: unknown): MenuVariant[] {
  if (!Array.isArray(value)) {
    throw new AppError("management.request_invalid", { field: "variants" });
  }
  return value.map((entry, index) => {
    if (
      !isPlainObject(entry) ||
      typeof entry.variantId !== "string" ||
      typeof entry.unitPrice !== "string" ||
      typeof entry.available !== "boolean"
    ) {
      throw new AppError("management.request_invalid", { field: `variants.${index}` });
    }
    return {
      variantId: requireUuidParam(entry.variantId, "ProductVariantId"),
      unitPrice: entry.unitPrice,
      available: entry.available,
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
 * The deployment holds one tenant per database. The trust-boundary check for an untrusted
 * `catalogueId` a location-menu WRITE will reference: refuse it as `catalogue.not_found` (404)
 * unless it names a catalogue present in this database. Runs inside `gated`'s transaction;
 * `catalogueExists` checks by id only. This is the CLEAN-error front of a two-layer defense: both
 * write targets carry a tenant-consistent composite FK (`locations.catalogue_id` → 0078,
 * `location_catalogues.catalogue_id` → 0074) that 23503-rejects a cross-tenant id at the data
 * layer anyway — see the route comment.
 */
async function assertCatalogueVisible(tx: Transaction, catalogueId: string): Promise<void> {
  if (!(await catalogueExists(tx, catalogueId))) {
    throw new AppError("catalogue.not_found", { catalogueId });
  }
}

/**
 * Screen an OPTIONAL integer request field (option-group `minSelect`/`maxSelect`/`sort`), returning it.
 * Absent stays `undefined` (a no-op — the create route defaults it, the patch route leaves it
 * untouched); a PRESENT value must be an integer NUMBER in int4 range, else `management.request_invalid`
 * naming the FIELD (never the value). The `typeof` screen is first so a non-number is REJECTED rather
 * than coerced, and the int4 bound keeps an out-of-range value off the `integer` column (a `22003`
 * opaque 500). The DOMAIN relationship between min/max (and the required⇒min rule) is NOT checked here —
 * that is `createOptionGroup`/`updateOptionGroup`'s `options.group_invalid`; this is a shape screen only.
 */
function parseOptionalInteger(value: unknown, field: string): number | undefined {
  if (value === undefined) return undefined;
  if (
    typeof value !== "number" ||
    !Number.isInteger(value) ||
    value < -2_147_483_648 ||
    value > 2_147_483_647
  ) {
    throw new AppError("management.request_invalid", { field });
  }
  return value;
}

/**
 * Screen an OPTIONAL `vatClass` request field for an option item, returning `string | null | undefined`.
 * `null` means "inherit the parent dish's rate" (a legitimate value, the column default); a present
 * string flows to the DB (its membership is the `option_group_items` CHECK's job, the same typeof-only
 * posture the product `vatClass` screen takes); anything else is `management.request_invalid`.
 */
function parseOptionalVatClass(value: unknown): VatClass | null | undefined {
  if (value === undefined) return undefined;
  if (value !== null && typeof value !== "string") {
    throw new AppError("management.request_invalid", { field: "vatClass" });
  }
  return value as VatClass | null;
}

/**
 * SHAPE-screen an optional product `dietOverride` body field (Task 4): `undefined` (leave unchanged)
 * and `null` (clear) are legitimate no-ops, and a present value must be a plain OBJECT — a non-object
 * (string/number/array) is `management.request_invalid` naming the field, mirroring how
 * `customerName` is screened by `screenCustomerName` below. This is a SHAPE screen only; the label/contains-tag/disjointness CONTENT is
 * `validateDietOverride`'s job inside `createProduct`/`updateProduct` (which throws the `diet.*` codes),
 * exactly as `validateAllergens` owns the `allergens` content.
 */
function screenDietOverride(value: unknown): void {
  if (value !== undefined && value !== null && !isPlainObject(value)) {
    throw new AppError("management.request_invalid", { field: "dietOverride" });
  }
}

/**
 * Screen an OPTIONAL ordered `optionGroupIds` attach list on the product POST/PATCH body, returning it.
 * Absent stays `undefined` (the attach set is left untouched); present must be an ARRAY of uuid-shaped
 * STRINGS — a non-array or a non-string element is `management.request_invalid` naming the field, and a
 * string that is not uuid-shaped is `shared.invalid_id` (as `requireUuidParam`, so a malformed id never
 * reaches the `uuid` column → `22P02` → opaque 500). Existence + tenant-consistency of each id is the
 * `product_option_groups` FK's job, not this shape screen's.
 *
 * DUPLICATES are collapsed here, first-occurrence order preserved: two copies of one id would otherwise
 * both reach `setProductOptionGroups`' insert and collide on the `(product_id, group_id)` PK → an opaque
 * 500. A repeated attach carries no meaning (the list is a set of groups in display order), so the second
 * copy is dropped rather than rejected.
 */
function parseOptionGroupIds(value: unknown): string[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) {
    throw new AppError("management.request_invalid", { field: "optionGroupIds" });
  }
  for (const id of value) {
    if (typeof id !== "string") {
      throw new AppError("management.request_invalid", { field: "optionGroupIds" });
    }
    if (!isUuid(id)) throw new AppError("shared.invalid_id", { kind: "OptionGroupId", value: id });
  }
  return [...new Set(value as string[])];
}

export function mountCatalogueApi(app: Hono, deps: CatalogueApiDeps, log: Logger): void {
  // Brand the tenant id ONCE per mount rather than per write route — a stable value for the life
  // of the mount (cfg.tenantId is fixed), the low-risk form of the dedup (deps keeps cfg: { tenantId:
  // string }, the sibling convention).
  const tenantId = brandTenantId(deps.cfg.tenantId);
  // Open a tenant-scoped transaction as the app role, confirm the caller's management session carries
  // CATALOGUE_WRITE_PERMISSION, then run `fn`. Every route funnels its DB work through here so the gate
  // is applied identically and in exactly one place — the design §3 seam.
  const gated = <T>(sessionId: string, fn: (tx: Transaction) => Promise<T>): Promise<T> =>
    withTenant(deps.db, deps.cfg.tenantId, async (tx) => {
      await asAppUser(tx);
      const auth = await authorizeManager(tx, {
        managementSessionId: sessionId,
        permission: CATALOGUE_WRITE_PERMISSION,
      });
      if (auth.tenantId !== deps.cfg.tenantId) {
        throw new AppError("authorization.not_permitted", {
          permission: CATALOGUE_WRITE_PERMISSION,
        });
      }
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
    if (routing.stationId !== undefined) {
      await setProductStation(tx, cfg, saved.id, routing.stationId);
    }
    if (routing.courseId !== undefined) {
      await setProductCourse(tx, cfg, saved.id, routing.courseId);
    }
    return readProductEditor(tx, tenantId, saved.id);
  };

  const assertOwned = async (
    tx: Transaction,
    table: "products" | "option_groups" | "option_group_items",
    id: string,
    groupId?: string,
  ): Promise<void> => {
    const result = await tx.execute(sql`
      select 1 from ${sql.identifier(table)}
      where tenant_id = ${tenantId} and id = ${id}
      ${groupId === undefined ? sql`` : sql`and group_id = ${groupId}`}
    `);
    if (result.rows.length === 0) {
      throw new AppError("authorization.not_permitted", { permission: CATALOGUE_WRITE_PERMISSION });
    }
  };

  app.get("/management-api/modifiers", (c) =>
    run(c, log, async () => {
      const modifiers = await gated(requireManagementSession(c), (tx) =>
        listModifiers(tx, tenantId),
      );
      return c.json({ modifiers });
    }),
  );
  app.get("/management-api/modifiers/:id", (c) =>
    run(c, log, async () => {
      const id = requireUuidParam(c.req.param("id"), "ModifierId");
      const modifier = await gated(requireManagementSession(c), (tx) =>
        getModifier(tx, tenantId, id),
      );
      return c.json({ modifier });
    }),
  );
  app.post("/management-api/modifiers", (c) =>
    run(c, log, async () => {
      const body = await readJsonBody(c);
      const modifier = await gated(requireManagementSession(c), (tx) =>
        createModifier(tx, tenantId, body, deps.venueLocale ?? FALLBACK_LOCALE),
      );
      return c.json({ modifier }, 201);
    }),
  );
  app.patch("/management-api/modifiers/:id", (c) =>
    run(c, log, async () => {
      const id = requireUuidParam(c.req.param("id"), "ModifierId");
      const body = await readJsonBody(c);
      const modifier = await gated(requireManagementSession(c), (tx) =>
        updateModifier(tx, tenantId, id, body, deps.venueLocale ?? FALLBACK_LOCALE),
      );
      return c.json({ modifier });
    }),
  );
  app.delete("/management-api/modifiers/:id", (c) =>
    run(c, log, async () => {
      const id = requireUuidParam(c.req.param("id"), "ModifierId");
      await gated(requireManagementSession(c), (tx) => deleteModifier(tx, tenantId, id));
      return c.json({ ok: true });
    }),
  );
  // What deleting this modifier would touch — the preview the dashboard's delete confirmation reads.
  app.get("/management-api/modifiers/:id/dependants", (c) =>
    run(c, log, async () => {
      const id = requireUuidParam(c.req.param("id"), "ModifierId");
      const dependants = await gated(requireManagementSession(c), (tx) =>
        modifierDependants(tx, tenantId, id),
      );
      return c.json({ dependants });
    }),
  );

  app.get("/management-api/content-languages", (c) =>
    run(c, log, async () => {
      const sessionId = requireManagementSession(c);
      return c.json(
        await gated(sessionId, (tx) =>
          readContentLanguages(tx, tenantId, deps.venueLocale ?? FALLBACK_LOCALE),
        ),
      );
    }),
  );

  // Language choices are public content metadata; this read neither requires nor touches a session.
  app.get("/api/content-languages", (c) =>
    run(c, log, async () => {
      const config = await withTenant(deps.db, tenantId, async (tx) => {
        await asAppUser(tx);
        return readContentLanguages(tx, tenantId, deps.venueLocale ?? FALLBACK_LOCALE);
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
          tenantId,
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
      const rows = await gated(sessionId, (tx) => listCatalogues(tx, tenantId));
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
      const created = await gated(sessionId, (tx) => createCatalogue(tx, tenantId, { name }));
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
      await gated(sessionId, (tx) => renameCatalogue(tx, tenantId, catalogueId, name));
      return c.body(null, 204);
    }),
  );

  app.get("/management-api/catalogues/:id/offers", (c) =>
    run(c, log, async () => {
      const sessionId = requireManagementSession(c);
      const menuId = requireUuidParam(c.req.param("id"), "MenuId");
      const rows = await gated(sessionId, (tx) => listMenuOffers(tx, tenantId, [menuId]));
      return c.json(rows);
    }),
  );

  app.get("/management-api/catalogues/:id/sections", (c) =>
    run(c, log, async () => {
      const sessionId = requireManagementSession(c);
      const menuId = requireUuidParam(c.req.param("id"), "MenuId");
      return c.json(await gated(sessionId, (tx) => listMenuSections(tx, tenantId, menuId)));
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
      const displayOrder = parseOptionalInteger(body.displayOrder, "displayOrder");
      const created = await gated(sessionId, async (tx) => {
        await validateContentTranslations(
          tx,
          tenantId,
          body.name as Record<string, string>,
          deps.venueLocale ?? FALLBACK_LOCALE,
        );
        return createMenuSection(tx, tenantId, {
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
        await validateContentTranslations(tx, tenantId, name, deps.venueLocale ?? FALLBACK_LOCALE);
        await updateMenuSection(tx, tenantId, sectionId, { name });
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
      if (typeof body.grossPrice !== "string") {
        throw new AppError("management.request_invalid", { field: "grossPrice" });
      }
      const productId = requireUuidParam(body.productId, "ProductId");
      const sectionId = requireUuidParam(body.sectionId, "MenuSectionId");
      const displayOrder = parseOptionalInteger(body.displayOrder, "displayOrder");
      const created = await gated(sessionId, (tx) =>
        createMenuItem(tx, tenantId, {
          menuId,
          productId,
          sectionId,
          grossPrice: body.grossPrice as string,
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
      if (body.grossPrice !== undefined && typeof body.grossPrice !== "string") {
        throw new AppError("management.request_invalid", { field: "grossPrice" });
      }
      const displayOrder = parseOptionalInteger(body.displayOrder, "displayOrder");
      await gated(sessionId, (tx) =>
        updateMenuItem(tx, tenantId, menuId, menuItemId, {
          ...(body.grossPrice === undefined ? {} : { grossPrice: body.grossPrice as string }),
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
      await gated(sessionId, (tx) => deactivateMenuItem(tx, tenantId, menuId, menuItemId));
      return c.body(null, 204);
    }),
  );

  app.get("/management-api/catalogues/:id/items/:itemId/variants", (c) =>
    run(c, log, async () => {
      const sessionId = requireManagementSession(c);
      const menuId = requireUuidParam(c.req.param("id"), "MenuId");
      const menuItemId = requireUuidParam(c.req.param("itemId"), "MenuItemId");
      return c.json(
        await gated(sessionId, (tx) => listMenuVariants(tx, tenantId, menuItemId, menuId)),
      );
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
        await gated(sessionId, (tx) => setMenuVariants(tx, tenantId, menuItemId, variants, menuId)),
      );
    }),
  );

  // ── Location menus ───────────────────────────────────────────────────────────────────────────────
  // The deployment holds one tenant per database.
  // The dashboard's location↔menu membership screen: which catalogues a location may SELL (its
  // default `locations.catalogue_id` plus `location_catalogues` members). GET returns EVERY
  // tenant catalogue flagged sellable/isDefault so the screen can also offer the not-yet-sold
  // ones; POST/DELETE add and remove a member; PUT sets the default (keep-sellable — the old
  // default is demoted, never dropped). The two routes that WRITE a `catalogueId` reference (POST
  // add, PUT default) guard it with `catalogueExists` FIRST — an absent id is refused
  // `catalogue.not_found` (404). The lookup is by id. This is defense-in-depth, not the sole
  // protection: BOTH write targets carry a tenant-consistent composite FK —
  // `locations.catalogue_id` → catalogues(tenant_id,id), `location_catalogues.catalogue_id` → catalogues(tenant_id,id) —
  // that 23503-rejects a foreign-tenant id at the DATA layer. The guard gives an absent id a
  // clean error. A foreign row seeded into the same database passes that by-id lookup, but the
  // composite FK still rejects the write with 23503. DELETE needs no guard: removing a non-member
  // row is a no-op.
  app.get("/management-api/locations/:locationId/catalogues", (c) =>
    run(c, log, async () => {
      const sessionId = requireManagementSession(c);
      const locationId = requireUuidParam(c.req.param("locationId"), "LocationId");
      const rows = await gated(sessionId, (tx) =>
        listCataloguesForLocation(tx, tenantId, locationId),
      );
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
        await addCatalogueToLocation(tx, tenantId, locationId, catalogueId);
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
        await setLocationDefaultCatalogue(tx, tenantId, locationId, catalogueId);
      });
      return c.body(null, 204);
    }),
  );

  // ── Categories ─────────────────────────────────────────────────────────────────────────────────
  app.get("/management-api/categories", (c) =>
    run(c, log, async () => {
      const sessionId = requireManagementSession(c);
      const rows = await gated(sessionId, (tx) => listCategories(tx, tenantId));
      return c.json(rows);
    }),
  );

  app.post("/management-api/categories", (c) =>
    run(c, log, async () => {
      const sessionId = requireManagementSession(c);
      const body = await readJsonBody<Record<string, unknown>>(c);
      const input = categoryInput(body, true) as CategoryInput;
      const created = await gated(sessionId, (tx) =>
        createCategory(tx, tenantId, input, deps.venueLocale ?? FALLBACK_LOCALE),
      );
      return c.json(created, 201);
    }),
  );

  app.get("/management-api/categories/:id", (c) =>
    run(c, log, async () => {
      const session = requireManagementSession(c);
      const id = requireUuidParam(c.req.param("id"), "CategoryId");
      return c.json(await gated(session, (tx) => readCategory(tx, tenantId, id)));
    }),
  );
  app.patch("/management-api/categories/:id", (c) =>
    run(c, log, async () => {
      const session = requireManagementSession(c);
      const id = requireUuidParam(c.req.param("id"), "CategoryId");
      const input = categoryInput(await readJsonBody<Record<string, unknown>>(c), false);
      return c.json(
        await gated(session, (tx) =>
          updateCategory(tx, tenantId, id, input, deps.venueLocale ?? FALLBACK_LOCALE),
        ),
      );
    }),
  );
  app.delete("/management-api/categories/:id", (c) =>
    run(c, log, async () => {
      const session = requireManagementSession(c);
      const id = requireUuidParam(c.req.param("id"), "CategoryId");
      await gated(session, (tx) => deleteCategory(tx, tenantId, id));
      return c.body(null, 204);
    }),
  );
  // What deleting this category would touch — the preview the dashboard's delete confirmation reads.
  app.get("/management-api/categories/:id/dependants", (c) =>
    run(c, log, async () => {
      const session = requireManagementSession(c);
      const id = requireUuidParam(c.req.param("id"), "CategoryId");
      return c.json(await gated(session, (tx) => categoryDependants(tx, tenantId, id)));
    }),
  );
  app.get("/management-api/categories/:id/products", (c) =>
    run(c, log, async () => {
      const session = requireManagementSession(c);
      const id = requireUuidParam(c.req.param("id"), "CategoryId");
      return c.json(await gated(session, (tx) => listCategoryProducts(tx, tenantId, id)));
    }),
  );
  // Add a whole selection of products to one category in a single transaction. The body screen
  // checks SHAPE only (an array of uuid-shaped strings, so a malformed id never reaches a `uuid`
  // column as a 22P02); whether each id names a product of this tenant, and whether the selection
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
      await gated(session, (tx) => addProductsToCategory(tx, tenantId, id, productIds));
      return c.body(null, 204);
    }),
  );
  app.get("/management-api/products", (c) =>
    run(c, log, async () => {
      const session = requireManagementSession(c);
      return c.json(await gated(session, (tx) => listProducts(tx, tenantId)));
    }),
  );
  app.get("/management-api/products/:id/categories", (c) =>
    run(c, log, async () => {
      const session = requireManagementSession(c);
      const id = requireUuidParam(c.req.param("id"), "ProductId");
      return c.json(await gated(session, (tx) => readProductCategories(tx, tenantId, id)));
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
          replaceProductCategories(tx, tenantId, id, {
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
      const rows = await gated(sessionId, (tx) => listProducts(tx, tenantId, catalogueId));
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
          tenantId,
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
      return c.json(await gated(sessionId, (tx) => readProductEditor(tx, tenantId, productId)));
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
            tenantId,
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
        optionGroupIds?: unknown;
        modifierIds?: unknown;
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
      if (typeof body.vatClass !== "string") {
        throw new AppError("management.request_invalid", { field: "vatClass" });
      }
      if (body.image !== undefined && typeof body.image !== "string") {
        throw new AppError("management.request_invalid", { field: "image" });
      }
      if (body.active !== undefined && typeof body.active !== "boolean") {
        throw new AppError("management.request_invalid", { field: "active" });
      }
      // The optional staff diet override (Task 4): SHAPE-screened here (object or null, like
      // `customerName`), then threaded raw to `createProduct`, whose `validateDietOverride` is the
      // authority on the label/contains-tag/disjointness content — exactly the posture `allergens`
      // takes with `validateAllergens`.
      screenDietOverride(body.dietOverride);
      // The optional ordered attach set (Task 11): screened here (array of uuid-shaped strings) and
      // applied in the SAME transaction as the create, so a product and its option groups land atomically.
      if (body.modifierIds !== undefined && body.optionGroupIds !== undefined)
        throw new AppError("modifier.invalid", { field: "modifierIds" });
      const optionGroupIds = parseOptionGroupIds(
        body.modifierIds === undefined ? body.optionGroupIds : body.modifierIds,
      );
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
      };
      const created = await gated(sessionId, async (tx) => {
        if (customerName !== null) {
          await validateContentTranslations(
            tx,
            tenantId,
            customerName,
            deps.venueLocale ?? FALLBACK_LOCALE,
          );
        }
        const product = await createProduct(tx, tenantId, input);
        if (optionGroupIds !== undefined) {
          await setProductOptionGroups(tx, tenantId, product.id, optionGroupIds);
        }
        return { ...product, modifierIds: optionGroupIds ?? [] };
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
        optionGroupIds?: unknown;
        modifierIds?: unknown;
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
      // The optional ordered attach set (Task 11): a full replace when present, applied in the SAME
      // transaction as the field update. Absent leaves the product's attached groups untouched; `[]`
      // detaches them all. An empty `patch` alongside a present `optionGroupIds` is fine — `updateProduct`
      // always bumps `updatedAt`, so its `.set()` is never empty.
      if (body.modifierIds !== undefined && body.optionGroupIds !== undefined)
        throw new AppError("modifier.invalid", { field: "modifierIds" });
      const optionGroupIds = parseOptionGroupIds(
        body.modifierIds === undefined ? body.optionGroupIds : body.modifierIds,
      );
      await gated(sessionId, async (tx) => {
        await assertOwned(tx, "products", productId);
        // A customer-facing name is optional: absent or wholly blank, the staff name is what a
        // receipt shows, so there is nothing to hold to the enabled languages. A PARTIAL one is a
        // translation gap and is refused.
        if (patch.customerName != null)
          await validateContentTranslations(
            tx,
            tenantId,
            patch.customerName,
            deps.venueLocale ?? FALLBACK_LOCALE,
          );
        await updateProduct(tx, tenantId, productId, patch);
        if (optionGroupIds !== undefined) {
          await setProductOptionGroups(tx, tenantId, productId, optionGroupIds);
        }
      });
      return c.body(null, 204);
    }),
  );

  // ── Product ↔ option-group attach read-back ──────────────────────────────────────────────────────
  // The ids of the option groups attached to a product, in per-attachment `sort` order — the read-back
  // Task 12's product form uses to show which groups are attached and in what order (it cross-references
  // GET /management-api/option-groups for the names). The attach itself is carried on the product
  // POST/PATCH body above; this is the read half. `:id` screened as a uuid (→ shared.invalid_id).
  app.get("/management-api/products/:id/option-groups", (c) =>
    run(c, log, async () => {
      const sessionId = requireManagementSession(c);
      const productId = requireUuidParam(c.req.param("id"), "ProductId");
      const ids = await gated(sessionId, (tx) =>
        listProductOptionGroupIds(tx, tenantId, productId),
      );
      return c.json(ids);
    }),
  );

  // ── Option groups (reusable modifier groups) ─────────────────────────────────────────────────────
  // CRUD the tenant's reusable `option_groups`. Every route is gated exactly like the catalogue/product
  // routes above — `requireManagementSession` first (401), then `gated` runs the op under withTenant +
  // asAppUser + `authorizeManager(person.manage)` (403). Body-shape screens mirror the product routes;
  // the DOMAIN select-bound invariant is `createOptionGroup`/`updateOptionGroup`'s `options.group_invalid`.
  app.get("/management-api/option-groups", (c) =>
    run(c, log, async () => {
      const sessionId = requireManagementSession(c);
      const rows = await gated(sessionId, (tx) => listOptionGroups(tx));
      return c.json(rows);
    }),
  );

  app.post("/management-api/option-groups", (c) =>
    run(c, log, async () => {
      const sessionId = requireManagementSession(c);
      const body = await readJsonBody<{
        name?: unknown;
        minSelect?: unknown;
        maxSelect?: unknown;
        required?: unknown;
        sort?: unknown;
        active?: unknown;
      }>(c);
      if (!isPlainObject(body.name)) {
        throw new AppError("management.request_invalid", { field: "name" });
      }
      const minSelect = parseOptionalInteger(body.minSelect, "minSelect");
      const maxSelect = parseOptionalInteger(body.maxSelect, "maxSelect");
      const sort = parseOptionalInteger(body.sort, "sort");
      if (body.required !== undefined && typeof body.required !== "boolean") {
        throw new AppError("management.request_invalid", { field: "required" });
      }
      if (body.active !== undefined && typeof body.active !== "boolean") {
        throw new AppError("management.request_invalid", { field: "active" });
      }
      const input: CreateOptionGroupInput = {
        name: body.name as Record<string, string>,
        ...(minSelect === undefined ? {} : { minSelect }),
        ...(maxSelect === undefined ? {} : { maxSelect }),
        ...(body.required === undefined ? {} : { required: body.required }),
        ...(sort === undefined ? {} : { sort }),
        ...(body.active === undefined ? {} : { active: body.active }),
      };
      const created = await gated(sessionId, async (tx) => {
        await validateContentTranslations(
          tx,
          tenantId,
          input.name,
          deps.venueLocale ?? FALLBACK_LOCALE,
        );
        return createOptionGroup(tx, tenantId, input);
      });
      return c.json(created, 201);
    }),
  );

  app.patch("/management-api/option-groups/:id", (c) =>
    run(c, log, async () => {
      const sessionId = requireManagementSession(c);
      const groupId = requireUuidParam(c.req.param("id"), "OptionGroupId");
      const body = await readJsonBody<{
        name?: unknown;
        minSelect?: unknown;
        maxSelect?: unknown;
        required?: unknown;
        sort?: unknown;
        active?: unknown;
      }>(c);
      const patch: UpdateOptionGroupInput = {};
      if (body.name !== undefined) {
        if (!isPlainObject(body.name)) {
          throw new AppError("management.request_invalid", { field: "name" });
        }
        patch.name = body.name as Record<string, string>;
      }
      const minSelect = parseOptionalInteger(body.minSelect, "minSelect");
      if (minSelect !== undefined) patch.minSelect = minSelect;
      const maxSelect = parseOptionalInteger(body.maxSelect, "maxSelect");
      if (maxSelect !== undefined) patch.maxSelect = maxSelect;
      const sort = parseOptionalInteger(body.sort, "sort");
      if (sort !== undefined) patch.sort = sort;
      if (body.required !== undefined) {
        if (typeof body.required !== "boolean") {
          throw new AppError("management.request_invalid", { field: "required" });
        }
        patch.required = body.required;
      }
      if (body.active !== undefined) {
        if (typeof body.active !== "boolean") {
          throw new AppError("management.request_invalid", { field: "active" });
        }
        patch.active = body.active;
      }
      await gated(sessionId, async (tx) => {
        await assertOwned(tx, "option_groups", groupId);
        if (Object.keys(patch).length === 0) return;
        if (patch.name !== undefined)
          await validateContentTranslations(
            tx,
            tenantId,
            patch.name,
            deps.venueLocale ?? FALLBACK_LOCALE,
          );
        await updateOptionGroup(tx, tenantId, groupId, patch);
      });
      return c.body(null, 204);
    }),
  );

  // ── Option group items (choices within a group) ──────────────────────────────────────────────────
  app.get("/management-api/option-groups/:id/items", (c) =>
    run(c, log, async () => {
      const sessionId = requireManagementSession(c);
      const groupId = requireUuidParam(c.req.param("id"), "OptionGroupId");
      const rows = await gated(sessionId, (tx) => listOptionGroupItems(tx, groupId));
      return c.json(rows);
    }),
  );

  app.post("/management-api/option-groups/:id/items", (c) =>
    run(c, log, async () => {
      const sessionId = requireManagementSession(c);
      const groupId = requireUuidParam(c.req.param("id"), "OptionGroupId");
      const body = await readJsonBody<{
        name?: unknown;
        priceDelta?: unknown;
        vatClass?: unknown;
        sort?: unknown;
        active?: unknown;
        maxQuantity?: unknown;
        addAllergens?: unknown;
      }>(c);
      if (!isPlainObject(body.name)) {
        throw new AppError("management.request_invalid", { field: "name" });
      }
      if (body.priceDelta !== undefined && typeof body.priceDelta !== "string") {
        throw new AppError("management.request_invalid", { field: "priceDelta" });
      }
      const vatClass = parseOptionalVatClass(body.vatClass);
      const sort = parseOptionalInteger(body.sort, "sort");
      // Shape screen only (integer, int4 range); the DOMAIN `max_quantity >= 1` rule is
      // `createOptionGroupItem`'s `options.item_invalid`, the same split min/max/sort take.
      const maxQuantity = parseOptionalInteger(body.maxQuantity, "maxQuantity");
      if (body.active !== undefined && typeof body.active !== "boolean") {
        throw new AppError("management.request_invalid", { field: "active" });
      }
      const input: CreateOptionGroupItemInput = {
        name: body.name as Record<string, string>,
        ...(body.priceDelta === undefined ? {} : { priceDelta: body.priceDelta }),
        ...(vatClass === undefined ? {} : { vatClass }),
        ...(sort === undefined ? {} : { sort }),
        ...(body.active === undefined ? {} : { active: body.active }),
        ...(maxQuantity === undefined ? {} : { maxQuantity }),
        ...(body.addAllergens === undefined
          ? {}
          : { addAllergens: body.addAllergens as ProductAllergens | null }),
      };
      // The group :id is screened for SHAPE only; a well-formed-but-missing/foreign group makes the
      // tenant-consistent (tenant_id, group_id) FK raise 23503 → the opaque 500 the STATUS map documents
      // for a foreign id, the same posture the product routes take on a foreign catalogueId.
      const created = await gated(sessionId, async (tx) => {
        await validateContentTranslations(
          tx,
          tenantId,
          input.name,
          deps.venueLocale ?? FALLBACK_LOCALE,
        );
        return createOptionGroupItem(tx, tenantId, groupId, input);
      });
      return c.json(created, 201);
    }),
  );

  app.patch("/management-api/option-groups/:groupId/items/:itemId", (c) =>
    run(c, log, async () => {
      const sessionId = requireManagementSession(c);
      const groupId = requireUuidParam(c.req.param("groupId"), "OptionGroupId");
      const itemId = requireUuidParam(c.req.param("itemId"), "OptionGroupItemId");
      const body = await readJsonBody<{
        name?: unknown;
        priceDelta?: unknown;
        vatClass?: unknown;
        sort?: unknown;
        active?: unknown;
        maxQuantity?: unknown;
        addAllergens?: unknown;
      }>(c);
      const patch: UpdateOptionGroupItemInput = {};
      if (body.name !== undefined) {
        if (!isPlainObject(body.name)) {
          throw new AppError("management.request_invalid", { field: "name" });
        }
        patch.name = body.name as Record<string, string>;
      }
      if (body.priceDelta !== undefined) {
        if (typeof body.priceDelta !== "string") {
          throw new AppError("management.request_invalid", { field: "priceDelta" });
        }
        patch.priceDelta = body.priceDelta;
      }
      const vatClass = parseOptionalVatClass(body.vatClass);
      if (body.vatClass !== undefined) patch.vatClass = vatClass;
      const sort = parseOptionalInteger(body.sort, "sort");
      if (sort !== undefined) patch.sort = sort;
      const maxQuantity = parseOptionalInteger(body.maxQuantity, "maxQuantity");
      if (maxQuantity !== undefined) patch.maxQuantity = maxQuantity;
      if (body.active !== undefined) {
        if (typeof body.active !== "boolean") {
          throw new AppError("management.request_invalid", { field: "active" });
        }
        patch.active = body.active;
      }
      if (body.addAllergens !== undefined) {
        patch.addAllergens = body.addAllergens as ProductAllergens | null;
      }
      await gated(sessionId, async (tx) => {
        await assertOwned(tx, "option_group_items", itemId, groupId);
        if (Object.keys(patch).length === 0) return;
        if (patch.name !== undefined)
          await validateContentTranslations(
            tx,
            tenantId,
            patch.name,
            deps.venueLocale ?? FALLBACK_LOCALE,
          );
        await updateOptionGroupItem(tx, tenantId, itemId, patch);
      });
      return c.body(null, 204);
    }),
  );
}

/** A product editor body's optional kitchen routing: absent leaves it alone, `null` clears it. */
interface ProductRouting {
  stationId?: string | null;
  courseId?: string | null;
}

/**
 * The venue config the product editor's kitchen routing needs (`deps.venueCfg`), or a fail-closed
 * throw. `boot.ts` always supplies it for a real venue server, so this is a misconfiguration guard,
 * not a request fault — the same posture `management-api.ts`'s namesake takes.
 */
function requireVenueCfg(deps: CatalogueApiDeps): TillConfig {
  /* v8 ignore next 8 -- boot always threads a venueCfg of the mounted tenant; only a harness that
     omits it or mounts a mismatched one AND sends editor routing reaches these, which no suite does —
     a config error, surfaced as an opaque 500 by `run`. */
  if (deps.venueCfg === undefined) {
    throw new Error("mountCatalogueApi: venueCfg is required for the product editor's routing");
  }
  // The routing verbs scope their station/course check and their write to `venueCfg`, so a mount whose
  // venue belongs to a DIFFERENT tenant than the one every other route is scoped to would check the
  // wrong venue. The type permits that pairing; this refuses it rather than trusting the wiring.
  if (deps.venueCfg.tenantId !== deps.cfg.tenantId) {
    throw new Error("mountCatalogueApi: venueCfg must belong to the mounted tenant");
  }
  return deps.venueCfg;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Screen a product's optional customer-facing name: a language->text object, or `null` for "none".
 * A map with no non-blank entry means the same as `null` — the staff name is what a receipt shows —
 * so it is folded to `null` here and never reaches `validateContentTranslations`, which would
 * otherwise refuse it for lacking the default language. The same fold the product editor's parser
 * makes (`product-editor-input.ts`), so the two write paths agree. The per-LANGUAGE checks stay with
 * `validateContentTranslations`, the authority on them.
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
  const map = Object.fromEntries(entries) as Record<string, string>;
  return Object.values(map).some((text) => text.trim()) ? map : null;
}
