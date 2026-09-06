import { tenantId as brandTenantId } from "@waitron/shared";
// Side-effect only: loads this host's errors.ts augmentation for the code this file THROWS directly,
// `management.request_invalid` (declared in `./errors.js`), under the "every file that throws one of
// these imports ./errors.js" convention. `shared.invalid_id` is declared in `@waitron/shared` and
// loads via the `AppError` value import below; the `media.*` codes are declared in
// `@waitron/catalogue`'s own errors.ts and load transitively through the value imports from that
// package (`validateImageBytes` et al.); the identity codes the gate throws
// (`management_session.*`, `person.suspended`, `authorization.not_permitted`) load via the
// `@waitron/identity` value import. So this one line is all this file needs.
import "./errors.js";
import { createHash } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { Context, Hono } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { bodyLimit } from "hono/body-limit";
import { AppError } from "@waitron/shared";
import { asAppUser, withTenant, type Database, type Transaction } from "@waitron/db";
import {
  addCatalogueToLocation,
  catalogueExists,
  createCatalogue,
  createCategory,
  createOptionGroup,
  createOptionGroupItem,
  createProduct,
  listCatalogues,
  listCataloguesForLocation,
  listCategories,
  listOptionGroupItems,
  listOptionGroups,
  listProductOptionGroupIds,
  listProducts,
  removeCatalogueFromLocation,
  setLocationDefaultCatalogue,
  setProductOptionGroups,
  updateOptionGroup,
  updateOptionGroupItem,
  updateProduct,
  validateImageBytes,
  type CreateOptionGroupInput,
  type CreateOptionGroupItemInput,
  type DietOverride,
  type ProductAllergens,
  type UpdateOptionGroupInput,
  type UpdateOptionGroupItemInput,
  type UpdateProductInput,
  type VatClass,
} from "@waitron/catalogue";
import { authorizeManager, type Permission } from "@waitron/identity";
import { createErrorBoundary } from "./error-boundary.js";
import { readJsonBody } from "./read-json-body.js";
import { requireManagementSession } from "./management-session.js";
import { isUuid } from "./till-session.js";
import type { Logger } from "./logger.js";

/**
 * Everything the dashboard's catalogue-management routes need. Mirrors `ManagementApiDeps` — `db`
 * + this venue's own `cfg.tenantId` are passed to every `withTenant` below. The deployment holds
 * one tenant per database. `mediaDir` is the absolute store `boot.ts` ensured exists;
 * `maxUploadBytes` is the DoS ceiling the upload route enforces (surfaced on `deps`, not a
 * constant, so a test can shrink it). No card provider, clock or secure-cookie flag: these routes
 * touch only the catalogue and the image store, and the session cookie is set by the
 * management-login routes, never here.
 */
export interface CatalogueApiDeps {
  db: Database;
  /** `nodeId` is this node's origin id, threaded into every catalogue write's `withTenant` so the
   * enrolled `catalogues`/`categories`/`products` INSERT/UPDATE the capture trigger records carries a
   * real `sync_log.origin_id` rather than the all-zero sentinel (design §4d(B); sync origin
   * attribution — proven end-to-end by `sync-origin.test.ts`). */
  cfg: { tenantId: string; nodeId: string };
  mediaDir: string;
  maxUploadBytes: number;
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

/**
 * Every AppError CODE these routes answer, and the HTTP status it maps to — the catalogue parallel of
 * `management-api.ts`'s `STATUS`. Mostly CLIENT faults. `catalogue.not_found` (404) is thrown by the
 * LOCATION-MENU writes' `assertCatalogueVisible` pre-check on an untrusted `catalogueId`; the PRODUCT
 * routes keep the older opaque posture — a well-formed-but-foreign `catalogueId` there hits the FK
 * (PG `23503`) and reaches `run` as a NON-AppError → opaque 500 (the `category.not_found` pre-check for
 * that path is still a noted later-slice follow-up, not an oversight). Any other genuine SERVER fault (a
 * driver error, a malformed-uuid id reaching a `uuid` column) is likewise an opaque 500. A registered
 * code absent from this table defaults to 400 via `run`'s `?? 400`.
 */
const STATUS: Record<string, ContentfulStatusCode> = {
  "management_session.required": 401,
  "management_session.expired": 401,
  "person.suspended": 403,
  "authorization.not_permitted": 403,
  "management.request_invalid": 400,
  "shared.invalid_id": 400,
  "catalogue.not_found": 404,
  "allergen.invalid_code": 400,
  "allergen.invalid_presence": 400,
  "allergen.invalid_source": 400,
  "allergen.add_remove_conflict": 400,
  // The diet-write validation codes (Task 4): an untrusted product `dietOverride` or option
  // `addOrigins`/`removeOrigins` that fails the taxonomy/label/disjointness checks in the core diet
  // validators is a CLIENT fault → 400. Listed explicitly as the house style requires; the `?? 400`
  // default already covers them.
  "diet.invalid_origin": 400,
  "diet.invalid_label": 400,
  "diet.add_remove_conflict": 400,
  "media.missing": 400,
  "media.unsupported_type": 415,
  "media.too_large": 413,
  // An invalid option-group AUTHORING config (Task 11): the select bounds or the required⇒min rule the
  // DB CHECKs enforce, surfaced by `createOptionGroup`/`updateOptionGroup` as a clean 400 before the
  // write rather than the opaque 500 the CHECK would raise. The `?? 400` default already covers it; it
  // is listed explicitly as the house style requires.
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
 * (string/number/array) is `management.request_invalid` naming the field, mirroring how `descriptions`
 * is screened. This is a SHAPE screen only; the label/contains-tag/disjointness CONTENT is
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

/**
 * Multipart framing — the boundary lines and the file part's own `Content-Disposition`/`Content-Type`
 * headers — makes the raw request body a little larger than the file bytes it carries. `bodyLimit`
 * guards that RAW body (a coarse DoS ceiling that rejects an oversized upload BEFORE `parseBody`
 * buffers the whole thing into memory), so it sits this margin ABOVE `maxUploadBytes`, leaving the
 * EXACT per-file limit to the `file.size` check in the handler — which alone knows the true size and
 * carries it in `media.too_large`'s `{ size }`. 16 KiB comfortably covers the boundary, the part
 * headers and a long client filename we never store.
 */
const UPLOAD_BODY_HEADROOM = 16 * 1024;

/**
 * The deployment holds one tenant per database. Mounts the dashboard's gated catalogue write
 * group plus the image-upload route on an existing Hono app — `mountManagementApi`'s sibling,
 * attached to the SAME app (the `mountWebhook`/`mountTillApi` convention). Every route wraps its
 * handler in `run`, calls `requireManagementSession(c)` (→ 401 before any DB work) and then,
 * inside `withTenant` + `asAppUser`, `authorizeManager(...)` (→ 403) before the headless
 * `@waitron/catalogue` op, in this database. The `person.manage` gate runs on every route through
 * one constant.
 */
export function mountCatalogueApi(app: Hono, deps: CatalogueApiDeps, log: Logger): void {
  // Brand the tenant id ONCE per mount rather than per write route — a stable value for the life
  // of the mount (cfg.tenantId is fixed), the low-risk form of the dedup (deps keeps cfg: { tenantId:
  // string }, the sibling convention).
  const tenantId = brandTenantId(deps.cfg.tenantId);
  // Open a tenant-scoped transaction as the app role, confirm the caller's management session carries
  // CATALOGUE_WRITE_PERMISSION, then run `fn`. Every route funnels its DB work through here so the gate
  // is applied identically and in exactly one place — the design §3 seam.
  const gated = <T>(sessionId: string, fn: (tx: Transaction) => Promise<T>): Promise<T> =>
    withTenant(
      deps.db,
      deps.cfg.tenantId,
      async (tx) => {
        await asAppUser(tx);
        await authorizeManager(tx, {
          managementSessionId: sessionId,
          permission: CATALOGUE_WRITE_PERMISSION,
        });
        return fn(tx);
      },
      // Sets app.node_id for this tx so sync_capture stamps origin_id (design §4d(B)). asAppUser's
      // SET ROLE does not reset the transaction-local GUC, so origin attribution survives the switch.
      { nodeId: deps.cfg.nodeId },
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
      const created = await gated(sessionId, (tx) => createCatalogue(tx, tenantId, { name }));
      return c.json(created, 201);
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
      const rows = await gated(sessionId, (tx) => listCategories(tx));
      return c.json(rows);
    }),
  );

  app.post("/management-api/categories", (c) =>
    run(c, log, async () => {
      const sessionId = requireManagementSession(c);
      const body = await readJsonBody<{ name?: unknown }>(c);
      if (typeof body.name !== "string") {
        throw new AppError("management.request_invalid", { field: "name" });
      }
      const { name } = body;
      const created = await gated(sessionId, (tx) => createCategory(tx, tenantId, { name }));
      return c.json(created, 201);
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
        descriptions?: unknown;
        pricingUnit?: unknown;
        unitPrice?: unknown;
        vatClass?: unknown;
        allergens?: unknown;
        dietOverride?: unknown;
        image?: unknown;
        active?: unknown;
        optionGroupIds?: unknown;
      }>(c);
      if (typeof body.catalogueId !== "string") {
        throw new AppError("management.request_invalid", { field: "catalogueId" });
      }
      if (typeof body.categoryId !== "string" && body.categoryId !== null) {
        throw new AppError("management.request_invalid", { field: "categoryId" });
      }
      if (!isPlainObject(body.descriptions)) {
        throw new AppError("management.request_invalid", { field: "descriptions" });
      }
      if (typeof body.pricingUnit !== "string") {
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
      // `descriptions`), then threaded raw to `createProduct`, whose `validateDietOverride` is the
      // authority on the label/contains-tag/disjointness content — exactly the posture `allergens`
      // takes with `validateAllergens`.
      screenDietOverride(body.dietOverride);
      // The optional ordered attach set (Task 11): screened here (array of uuid-shaped strings) and
      // applied in the SAME transaction as the create, so a product and its option groups land atomically.
      const optionGroupIds = parseOptionGroupIds(body.optionGroupIds);
      const input = {
        catalogueId: body.catalogueId,
        categoryId: body.categoryId,
        descriptions: body.descriptions as Record<string, string>,
        pricingUnit: body.pricingUnit as never,
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
        const product = await createProduct(tx, tenantId, input);
        if (optionGroupIds !== undefined) {
          await setProductOptionGroups(tx, tenantId, product.id, optionGroupIds);
        }
        return product;
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
        descriptions?: unknown;
        unitPrice?: unknown;
        vatClass?: unknown;
        pricingUnit?: unknown;
        categoryId?: unknown;
        allergens?: unknown;
        dietOverride?: unknown;
        image?: unknown;
        active?: unknown;
        optionGroupIds?: unknown;
      }>(c);
      const patch: UpdateProductInput = {};
      if (body.descriptions !== undefined) {
        if (!isPlainObject(body.descriptions)) {
          throw new AppError("management.request_invalid", { field: "descriptions" });
        }
        patch.descriptions = body.descriptions as Record<string, string>;
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
      const optionGroupIds = parseOptionGroupIds(body.optionGroupIds);
      await gated(sessionId, async (tx) => {
        await updateProduct(tx, productId, patch);
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
      const ids = await gated(sessionId, (tx) => listProductOptionGroupIds(tx, productId));
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
      const created = await gated(sessionId, (tx) => createOptionGroup(tx, tenantId, input));
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
      // A patch with no mutable field is a 204 no-op: `updateOptionGroup` guards its own empty `.set()`
      // is never reached (it read-merges then updates), but skipping the tenant transaction entirely
      // when nothing changed matches the sibling status/zone PATCH shape. An out-of-uuid/missing id is a
      // silent no-op inside `updateOptionGroup` (the updateProduct posture).
      if (Object.keys(patch).length === 0) return c.body(null, 204);
      await gated(sessionId, (tx) => updateOptionGroup(tx, groupId, patch));
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
        removeAllergens?: unknown;
        addOrigins?: unknown;
        removeOrigins?: unknown;
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
        ...(body.removeAllergens === undefined
          ? {}
          : { removeAllergens: body.removeAllergens as string[] | null }),
        // The origin overlay (Task 4) is threaded raw like the allergen overlay; the core's
        // `normalizeOriginOverlay` validates each entry against the taxonomy (`diet.invalid_origin`).
        ...(body.addOrigins === undefined
          ? {}
          : { addOrigins: body.addOrigins as string[] | null }),
        ...(body.removeOrigins === undefined
          ? {}
          : { removeOrigins: body.removeOrigins as string[] | null }),
      };
      // The group :id is screened for SHAPE only; a well-formed-but-missing/foreign group makes the
      // tenant-consistent (tenant_id, group_id) FK raise 23503 → the opaque 500 the STATUS map documents
      // for a foreign id, the same posture the product routes take on a foreign catalogueId.
      const created = await gated(sessionId, (tx) =>
        createOptionGroupItem(tx, tenantId, groupId, input),
      );
      return c.json(created, 201);
    }),
  );

  app.patch("/management-api/option-groups/:groupId/items/:itemId", (c) =>
    run(c, log, async () => {
      const sessionId = requireManagementSession(c);
      // Both ids screened for shape (→ shared.invalid_id). `groupId` scopes the item to its group in the
      // URL for the editor's benefit; the item's own id is the update key (items are tenant-unique).
      requireUuidParam(c.req.param("groupId"), "OptionGroupId");
      const itemId = requireUuidParam(c.req.param("itemId"), "OptionGroupItemId");
      const body = await readJsonBody<{
        name?: unknown;
        priceDelta?: unknown;
        vatClass?: unknown;
        sort?: unknown;
        active?: unknown;
        maxQuantity?: unknown;
        addAllergens?: unknown;
        removeAllergens?: unknown;
        addOrigins?: unknown;
        removeOrigins?: unknown;
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
      if (body.removeAllergens !== undefined) {
        patch.removeAllergens = body.removeAllergens as string[] | null;
      }
      // The origin overlay (Task 4), threaded raw like the allergen overlay; the core validates.
      if (body.addOrigins !== undefined) {
        patch.addOrigins = body.addOrigins as string[] | null;
      }
      if (body.removeOrigins !== undefined) {
        patch.removeOrigins = body.removeOrigins as string[] | null;
      }
      // No mutable field → 204 no-op, sidestepping updateOptionGroupItem's empty `.set()` (which Drizzle
      // rejects). A well-formed-but-missing item id is a silent no-op (the updateProduct posture).
      if (Object.keys(patch).length === 0) return c.body(null, 204);
      await gated(sessionId, (tx) => updateOptionGroupItem(tx, itemId, patch));
      return c.body(null, 204);
    }),
  );

  // ── Image upload ─────────────────────────────────────────────────────────────────────────────────
  // `bodyLimit` is the coarse DoS guard: it rejects a raw body over `maxUploadBytes + framing` BEFORE
  // `parseBody` buffers it into memory, answering the same `media.too_large` 413 the precise per-file
  // check answers so the client sees one contract. On this path the exact bytes are not measured (the
  // body was rejected mid-stream), so `size` reports the ceiling the body exceeded — a lower bound;
  // the handler's `file.size` check carries the true size.
  const tooLargeCeiling = deps.maxUploadBytes + UPLOAD_BODY_HEADROOM;
  app.post(
    "/management-api/product-images",
    bodyLimit({
      maxSize: tooLargeCeiling,
      onError: (c: Context) =>
        c.json(
          {
            error: {
              code: "media.too_large",
              params: { size: tooLargeCeiling, limit: deps.maxUploadBytes },
            },
          },
          413,
        ),
    }),
    (c) =>
      run(c, log, async () => {
        const sessionId = requireManagementSession(c);
        // The only DB work is the gate: authorise, then write to disk (no DB). Split so the fs write
        // does not hold a transaction open.
        await gated(sessionId, async () => undefined);

        const parsed = await c.req.parseBody();
        const file = parsed["file"];
        if (!(file instanceof File)) throw new AppError("media.missing", {});
        const bytes = new Uint8Array(await file.arrayBuffer());
        // Precise per-file limit (the exact authority; carries the true size). Reachable when the file
        // exceeds maxUploadBytes yet the whole body stayed under bodyLimit's coarser ceiling.
        if (file.size > deps.maxUploadBytes) {
          throw new AppError("media.too_large", { size: file.size, limit: deps.maxUploadBytes });
        }
        // The stored name is SERVER-generated from the bytes — never the untrusted client filename or
        // Content-Type. The extension is sniffed from the magic bytes (`validateImageBytes` throws
        // `media.unsupported_type`), and the 64-hex SHA-256 makes the write idempotent (same bytes →
        // same name) and the served URL cacheable + traversal-proof (design §5b).
        const ext = validateImageBytes(bytes);
        const name = `${createHash("sha256").update(bytes).digest("hex")}.${ext}`;
        await writeFile(join(deps.mediaDir, name), bytes);
        return c.json({ image: name }, 201);
      }),
  );
}

/** True for a non-null, non-array object — the shape a JSON `descriptions` / allergen map must take
 * before it is handed on (a screen the management staff routes apply to their own object fields). */
function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
