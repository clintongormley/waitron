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
  createProduct,
  listCatalogues,
  listCataloguesForLocation,
  listCategories,
  listProducts,
  removeCatalogueFromLocation,
  setLocationDefaultCatalogue,
  updateProduct,
  validateImageBytes,
  type ProductAllergens,
  type UpdateProductInput,
} from "@waitron/catalogue";
import { authorizeManager, type Permission } from "@waitron/identity";
import { createErrorBoundary } from "./error-boundary.js";
import { readJsonBody } from "./read-json-body.js";
import { requireManagementSession } from "./management-session.js";
import { isUuid } from "./till-session.js";
import type { Logger } from "./logger.js";

/**
 * Everything the dashboard's catalogue-management routes need. Mirrors `ManagementApiDeps` — `db` +
 * this venue's own `cfg.tenantId` scope every `withTenant` below, so RLS confines each read/write to
 * this server's one tenant. `mediaDir` is the absolute store `boot.ts` ensured exists; `maxUploadBytes`
 * is the DoS ceiling the upload route enforces (surfaced on `deps`, not a constant, so a test can
 * shrink it). No card provider, clock or secure-cookie flag: these routes touch only the catalogue and
 * the image store, and the session cookie is set by the management-login routes, never here.
 */
export interface CatalogueApiDeps {
  db: Database;
  /** `nodeId` is this node's origin id, threaded into every catalogue write's `withTenant` so the
   * enrolled `catalogues`/`categories`/`products` INSERT/UPDATE the capture trigger records carries a
   * real `sync_log.origin_id` rather than the all-zero sentinel (design §4d(B); sync origin
   * attribution — proven end-to-end by `sync-origin.rls.test.ts`). */
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
  "media.missing": 400,
  "media.unsupported_type": 415,
  "media.too_large": 413,
};

// The one error boundary every catalogue route wraps its handler in — the shared `createErrorBoundary`
// closed over this surface's `STATUS` map and its `catalogue.failed` log tag, the catalogue
// counterpart of `management-api.ts`'s local `run`. Local, not exported.
const run = createErrorBoundary(STATUS, "catalogue.failed");

/**
 * Screen a `/…/:id` path param as a UUID before it reaches a `uuid` column, returning it. A malformed
 * id passed straight into a query would `22P02` → an opaque 500; refusing it here as `shared.invalid_id`
 * (the branded-id constructors' own code — `packages/shared/src/ids.ts`) turns that 500 into a clean
 * 400. Shape only: a well-formed id that names no row (or another tenant's row RLS hides) passes this
 * and is handled by the op it reaches. `value` is the caller-supplied uuid-shaped string, safe to echo.
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
 * The trust-boundary check for an untrusted `catalogueId` a location-menu WRITE will reference: refuse
 * it as `catalogue.not_found` (404) unless it names a catalogue VISIBLE to the current tenant. Runs
 * inside `gated`'s tenant-scoped tx, so `catalogueExists`'s read is RLS-filtered and another tenant's
 * id reads as absent. This is the CLEAN-error front of a two-layer defense: both write targets carry a
 * tenant-consistent composite FK (`locations.catalogue_id` → 0078, `location_catalogues.catalogue_id`
 * → 0074) that 23503-rejects a cross-tenant id at the data layer anyway — see the route comment.
 */
async function assertCatalogueVisible(tx: Transaction, catalogueId: string): Promise<void> {
  if (!(await catalogueExists(tx, catalogueId))) {
    throw new AppError("catalogue.not_found", { catalogueId });
  }
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
 * Mounts the dashboard's gated catalogue write group plus the image-upload route on an existing Hono
 * app — `mountManagementApi`'s sibling, attached to the SAME app (the `mountWebhook`/`mountTillApi`
 * convention). Every route wraps its handler in `run`, calls `requireManagementSession(c)` (→ 401
 * before any DB work) and then, inside `withTenant` + `asAppUser`, `authorizeManager(...)` (→ 403)
 * before the headless `@waitron/catalogue` op, so RLS scopes each read/write to this server's one
 * tenant and the `person.manage` gate runs on every route through one constant.
 */
export function mountCatalogueApi(app: Hono, deps: CatalogueApiDeps, log: Logger): void {
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
      const created = await gated(sessionId, (tx) => createCatalogue(tx, { name }));
      return c.json(created, 201);
    }),
  );

  // ── Location menus ───────────────────────────────────────────────────────────────────────────────
  // The dashboard's location↔menu membership screen: which catalogues a location may SELL (its default
  // `locations.catalogue_id` plus `location_catalogues` members). GET returns EVERY tenant catalogue
  // flagged sellable/isDefault so the screen can also offer the not-yet-sold ones; POST/DELETE add and
  // remove a member; PUT sets the default (keep-sellable — the old default is demoted, never dropped).
  // The two routes that WRITE a `catalogueId` reference (POST add, PUT default) guard it with
  // `catalogueExists` FIRST — an absent or cross-tenant id is refused `catalogue.not_found` (404).
  // This is defense-in-depth, not the sole protection: BOTH write targets carry a tenant-consistent
  // composite FK — `locations.catalogue_id` → catalogues(tenant_id,id) (0078), `location_catalogues`
  // → (0074) — that 23503-rejects a cross-tenant id at the DATA layer independently of RLS. The guard's
  // job is the CLEAN, uniform error: without it both routes still refuse a cross-tenant id, but via the
  // FK's opaque 500 (proven cross-tenant in catalogue-api.rls.test.ts: guard deleted → the PUT returns
  // 500, the default is never set). DELETE needs no guard: removing a non-member row is a no-op.
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
      const body = await readJsonBody<{ name?: unknown }>(c);
      if (typeof body.name !== "string") {
        throw new AppError("management.request_invalid", { field: "name" });
      }
      const { name } = body;
      const created = await gated(sessionId, (tx) => createCategory(tx, { name }));
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
        image?: unknown;
        active?: unknown;
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
      const input = {
        catalogueId: body.catalogueId,
        categoryId: body.categoryId,
        descriptions: body.descriptions as Record<string, string>,
        pricingUnit: body.pricingUnit as never,
        unitPrice: body.unitPrice,
        vatClass: body.vatClass as never,
        ...(body.allergens === undefined ? {} : { allergens: body.allergens as ProductAllergens }),
        ...(body.image === undefined ? {} : { image: body.image }),
        ...(body.active === undefined ? {} : { active: body.active }),
      };
      const created = await gated(sessionId, (tx) => createProduct(tx, input));
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
        image?: unknown;
        active?: unknown;
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
      await gated(sessionId, (tx) => updateProduct(tx, productId, patch));
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
