# Catalogue / menu management UI — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: use `superpowers:subagent-driven-development`
> (recommended) or `superpowers:executing-plans` to run this plan task-by-task. Every task is
> **TDD**: write the failing test, run it and watch it fail for the stated reason, write the minimal
> implementation, run the verify command and watch it pass. Steps use `- [ ]` for tracking.

**Goal:** let an owner author the menu. A `/management-api/*` catalogue write group on `apps/server`
wrapping the headless `@waitron/catalogue` ops, local-disk product images (upload + public serve), and
`apps/dashboard` screens to create/list/edit products (price, VAT, pricing unit, per-locale
descriptions, allergens, active, **image**) and create/list categories.

**Design:** `docs/superpowers/specs/2026-08-08-catalogue-management-ui-design.md`. Read it first — this
plan assumes its decisions (permission gate = `person.manage` with the `catalogue.manage` seam
deferred; content-addressed SHA-256 filenames; public `/media/:filename` serve; `products.image`
nullable column).

## Global constraints

- **Permission gate is `person.manage`** via one named constant `CATALOGUE_WRITE_PERMISSION` in
  `catalogue-api.ts` (design §3) — never an inline literal, so the future `catalogue.manage` swap is
  one line.
- **Every DB touch is `withTenant(deps.db, deps.cfg.tenantId, …)` + `asAppUser(tx)`**, and
  `authorizeManager(tx, { managementSessionId, permission: CATALOGUE_WRITE_PERMISSION })` runs
  **before** the catalogue op on every write route (`management-api.ts` is the template).
- **Uploaded filenames are untrusted** — never used for storage or joined into a path; the stored name
  is `<sha256hex>.<ext>` and the serve route re-validates `^[0-9a-f]{64}\.(jpg|png|webp)$` (design §5b).
- **Error codes name the domain concept** (`media.*`, reusing `allergen.*`/`management.request_invalid`/
  `shared.invalid_id`/`authorization.not_permitted`); **never invent or rename a shipped code**
  (`CLAUDE.md` §3). New codes only: `media.missing`, `media.unsupported_type`, `media.too_large`.
- **Dashboard: 95/95/90/88; server/catalogue/db: 98/98/98/95.** Run `test:coverage`, not `test`
  (`CLAUDE.md` §2). Dashboard has its own Chromium shard (already wired, #70) — no CI-scope change.
- **Every commit `-s`.** Feature work in a worktree (`worktree.py new waitron feat/catalogue-management-ui`).
- **Prove every guard by deletion** (`CLAUDE.md` §4); **whole-branch base-to-tip review** before the PR
  (`CLAUDE.md` §1).

---

# SLICE 1 — the minimum coherent vertical

## Task 1 — `products.image` column + migration

**Files:** modify `packages/db/src/schema/catalogue.ts`; generate
`packages/db/drizzle/0034_<generated>.sql` (+ journal); modify a schema/migration test in
`packages/db`.

- [ ] **Step 1 (failing test):** in `packages/db` add/extend a real-PG test (use `useRealPostgres`
      from `@waitron/db/testing/lifecycle.js` — never own the DB, `CLAUDE.md` §4) asserting that after
      migrations `products` has an `image text` (nullable) column and that a row can be inserted and
      read back with a non-null `image` **as `app_user` under `withTenant`+`asAppUser`**. Expect FAIL
      (column does not exist).
- [ ] **Step 2 (schema):** add `image: text("image")` to `products` in `schema/catalogue.ts` (nullable
      — no `.notNull()`).
- [ ] **Step 3 (migration):** `pnpm --filter @waitron/db db:generate` (plain generate — a column add
      needs no `--custom`). Confirm the emitted `0034_*.sql` is exactly
      `ALTER TABLE "products" ADD COLUMN "image" text;` and the journal gained idx 34. Do **not**
      hand-edit; if it emitted anything else, reconcile the schema.
- [ ] **Step 4 (verify):** `pnpm --filter @waitron/db test:coverage` → PASS.
- [ ] **Step 5 (FORCE-RLS guard):** `pnpm --filter @waitron/fiscal-verifactu test inmutabilidad` →
      PASS (products keeps FORCE; the column add removes nothing). Mandatory per `CLAUDE.md` §3.
- [ ] **Step 6 (commit):** `git add packages/db && git commit -s -m "feat(db): products.image column
      (0034)"`.

**Receipt for "RLS needs nothing more":** Step 1's write/read as `app_user` under RLS proves the
existing table-level `GRANT` + `products_tenant_isolation` policy (0027) cover the new column — do not
merely assert it (design §5a, §11).

## Task 2 — `@waitron/catalogue`: thread `image` + `active` through the ops

**Files:** modify `packages/catalogue/src/operations.ts`, `operations.test.ts`,
`operations.rls.test.ts` (if it pins the product shape).

- [ ] **Step 1 (failing test):** extend `operations.test.ts` — `createProduct` with `image: "x.webp"`
      returns a `Product` whose `image` is `"x.webp"`; omitting it yields `image: null`;
      `updateProduct` with `{ image: "y.png" }` sets it, `{ image: null }` clears it, `{ active: false
      }` deactivates and `{ active: true }` reactivates; `listProducts` returns `image`. Expect FAIL
      (types/shape).
- [ ] **Step 2 (impl):** add `image: string | null` to `Product`, `RawProduct`, `PRODUCT_COLUMNS`;
      `image?: string` to `CreateProductInput` (`createProduct` inserts `image: input.image ?? null`);
      `image?: string | null` and `active?: boolean` to `UpdateProductInput` (the existing
      `.set({ ...patch, updatedAt })` maps them — no other change). Leave `validateAllergens` untouched.
      (Optional, same task: add `image` to `AvailableProduct` + the `listAvailableProducts` select —
      harmless to the till; till rendering is a later slice.)
- [ ] **Step 3 (verify):** `pnpm --filter @waitron/catalogue test:coverage` → PASS (98/98/98/95).
- [ ] **Step 4 (commit):** `-s -m "feat(catalogue): products carry image + active toggle"`.

## Task 3 — `@waitron/catalogue`: `media.ts` image-byte validation + `media.*` codes

**Files:** create `packages/catalogue/src/media.ts`, `media.test.ts`; modify
`packages/catalogue/src/errors.ts`, `index.ts`.

- [ ] **Step 1 (failing test):** `media.test.ts` — `validateImageBytes(bytes)` returns `"jpg"` for
      `FF D8 FF …`, `"png"` for `89 50 4E 47 0D 0A 1A 0A …`, `"webp"` for `RIFF····WEBP …`; throws
      `media.unsupported_type` for a GIF/plain-text/empty buffer. Prove each `media.*` by feeding
      malformed bytes (guard-by-deletion: remove a signature branch → its test fails). Expect FAIL
      (module missing).
- [ ] **Step 2 (codes):** in `errors.ts` add the three `declare module "@waitron/shared"` augmentations
      — `media.missing: {}`, `media.unsupported_type: { detected?: string }`, `media.too_large:
      { size: number; limit: number }` (params carry facts, never bytes). Keep the DOMAIN-concept
      `media.` prefix (design §4 — grepped: no sibling `image.*`/`file.*` exists).
- [ ] **Step 3 (impl):** `media.ts` — a pure `sniffImageType(bytes: Uint8Array)` +
      `validateImageBytes` throwing `media.unsupported_type`; `import "./errors.js"` for reachability.
      No `fs`/`db` (stays browser-safe, unit-tested by byte arrays). Export both from `index.ts`.
- [ ] **Step 4 (verify):** `pnpm --filter @waitron/catalogue test:coverage` → PASS.
- [ ] **Step 5 (commit):** `-s -m "feat(catalogue): image-byte validation + media.* codes"`.

## Task 4 — `apps/server`: `mediaDir` config + boot wiring

**Files:** modify `apps/server/src/config.ts`, `config.test.ts`, `boot.ts`, `boot.test.ts`.

- [ ] **Step 1 (failing test):** `config.test.ts` — `loadConfig` resolves `WAITRON_MEDIA_DIR` to an
      absolute path; an unset OR empty value falls back to `defaultMediaRoot` (the `isUnset` pattern,
      `config.ts:234`); it is never `path.resolve("")` (the empty-value trap, `CLAUDE.md` §3). Expect
      FAIL.
- [ ] **Step 2 (impl config):** add `mediaDir: string` to `ServerConfig`; read `WAITRON_MEDIA_DIR`,
      `isUnset ? defaultMediaRoot : path.resolve(value)`. Thread `defaultMediaRoot` into `loadConfig`'s
      signature as `boot.ts` supplies it (mirror `defaultMigrationsRoot`, `config.ts:159`) — pick
      `<dist>/media` or `<cwd>/media`.
- [ ] **Step 3 (impl boot):** in `boot.ts`, after config, `fs.mkdirSync(config.mediaDir, { recursive:
      true })`, then wire the two mounts (added in Tasks 5–6) with `mediaDir: config.mediaDir` and a
      `maxUploadBytes` constant (5 MiB). Extend `boot.test.ts` for the mkdir + mounts.
- [ ] **Step 4 (verify):** `pnpm --filter @waitron/server test:coverage config` and `… boot` → PASS.
- [ ] **Step 5 (commit):** `-s -m "feat(server): WAITRON_MEDIA_DIR config + ensure dir at boot"`.

## Task 5 — `apps/server`: `mountMedia` public serve route

**Files:** create `apps/server/src/media-api.ts`, `media-api.test.ts`.

- [ ] **Step 1 (failing test):** `media-api.test.ts` (in-process `app.request`, a temp `mediaDir` via
      `fs.mkdtemp`, cleaned in `finally`) — `GET /media/<64hex>.webp` for a file that exists → 200,
      `Content-Type: image/webp`, immutable `Cache-Control`, the bytes; a non-existent name → 404; a
      traversal attempt (`/media/..%2f..%2fetc%2fpasswd`, `/media/x`, `/media/<hex>.gif`) → 404 **before
      any fs touch** (assert the filename regex rejects it). Expect FAIL.
- [ ] **Step 2 (impl):** `mountMedia(app, { mediaDir }, log)` — `GET /media/:filename`: validate against
      `^[0-9a-f]{64}\.(jpg|png|webp)$` → bare 404 on miss; `fs.readFile(path.join(mediaDir, filename))`
      (ENOENT → 404); 200 with the extension's `Content-Type` (`jpg→image/jpeg`) + `Cache-Control:
      public, max-age=31536000, immutable`. Custom fs handler (not `serve-static`) so the traversal
      guard is explicit (design §5e). Unauthenticated (menu photos are not secret).
- [ ] **Step 3 (wire):** call `mountMedia(app, { mediaDir: config.mediaDir }, log)` in `boot.ts`.
- [ ] **Step 4 (verify):** `pnpm --filter @waitron/server test:coverage media-api` → PASS.
- [ ] **Step 5 (commit):** `-s -m "feat(server): public /media/:filename serve (traversal-guarded)"`.

## Task 6 — `apps/server`: `mountCatalogueApi` write group + upload

**Files:** create `apps/server/src/catalogue-api.ts`, `catalogue-api.test.ts`.

- [ ] **Step 1 (failing tests):** `catalogue-api.test.ts` (in-process, mirroring
      `management-api.test.ts`; stub/seed a management session cookie) covering every design-§4 route:
  - `POST /management-api/catalogues` `{name}` → 201; missing/non-string `name` →
    `management.request_invalid` 400; unauthenticated → 401.
  - `GET /management-api/catalogues`, `GET /management-api/categories`, `POST
    /management-api/categories` (same shapes).
  - `GET /management-api/catalogues/:id/products` (200; non-uuid `:id` → `shared.invalid_id` 400).
  - `POST /management-api/products` full body → 201 `Product`; a bad allergen map →
    `allergen.invalid_code`/`invalid_presence`/`invalid_source` 400; missing required field →
    `management.request_invalid` 400.
  - `PATCH /management-api/products/:id` `{ unitPrice }`/`{ active:false }`/`{ image:null }` → 204;
    non-uuid `:id` → `shared.invalid_id` 400; bad allergen → `allergen.*` 400.
  - `POST /management-api/product-images` multipart with a valid PNG → 201 `{ image: "<64hex>.png" }`;
    no file part → `media.missing` 400; a text/gif blob → `media.unsupported_type` 415; an over-limit
    blob → `media.too_large` 413.
  Expect FAIL (module missing).
- [ ] **Step 2 (impl):** `catalogue-api.ts` — `const CATALOGUE_WRITE_PERMISSION: Permission =
      "person.manage";`, a local `STATUS` (design §4) + local `run` (copy `management-api.ts`'s shape,
      logging server faults under `catalogue.failed`), a `requireProductId`/`isUuid` screen. Each route:
      `requireManagementSession(c)` → inside `withTenant`+`asAppUser`: `authorizeManager(tx, {
      managementSessionId, permission: CATALOGUE_WRITE_PERMISSION })` → the `@waitron/catalogue` op.
      Upload route: `bodyLimit(maxUploadBytes)` middleware + `await c.req.parseBody()` → `File` (else
      `media.missing`) → size check (`media.too_large`) → `validateImageBytes` → `sha256hex(bytes) +
      "." + ext` → `fs.writeFile(path.join(mediaDir, name), bytes)` → 201 `{ image: name }`.
- [ ] **Step 3 (wire):** `mountCatalogueApi(app, { db, cfg: { tenantId: till.tenantId }, mediaDir:
      config.mediaDir, maxUploadBytes }, log)` in `boot.ts` beside `mountManagementApi`.
- [ ] **Step 4 (verify):** `pnpm --filter @waitron/server test:coverage catalogue-api` → PASS.
- [ ] **Step 5 (commit):** `-s -m "feat(server): catalogue-api /management-api write group + image
      upload"`.

## Task 7 — `apps/server`: real-PG RLS + gate-by-deletion proof

**Files:** create `apps/server/src/catalogue-api.rls.test.ts`.

- [ ] **Step 1 (failing test):** mirror `management-api.rls.test.ts` (two provisioned venues via the
      real-PG lifecycle helper; `TESTCONTAINERS_RYUK_DISABLED=true` locally, `CLAUDE.md` §4). Assert:
  - **Differential cross-tenant isolation** — a `manager` of tenant A lists/reads only tenant A's
    catalogues/categories/products; a create under A is invisible to B and vice-versa. Write it so it
    **fails if `asAppUser` is dropped** (the reads have no explicit tenant filter — the template is
    `management-api.rls.test.ts:208-232`).
  - **`person.manage` gate by deletion** — a `staff`-role session is refused
    `403 authorization.not_permitted` on `POST /catalogues`, `POST /products`, `PATCH /products/:id`,
    `POST /product-images`. In a comment, record the deletion check: removing the `authorizeManager`
    line turns these green→red (run it once, restore).
  - **`image` under RLS** — create a product with an `image`, read it back as `app_user`; a
    cross-tenant read returns nothing (the design §5a receipt).
- [ ] **Step 2:** implement is already done (Task 6); this task only adds the proof suite. Watch it
      fail first if written before Task 6, else confirm green.
- [ ] **Step 3 (verify):** `pnpm --filter @waitron/server test:coverage catalogue-api.rls` → PASS; then
      the **whole** package unfiltered: `pnpm --filter @waitron/server test:coverage` → PASS (a filtered
      run skips cross-cutting suites, `CLAUDE.md` §2).
- [ ] **Step 4 (commit):** `-s -m "test(server): catalogue-api RLS isolation + person.manage gate
      (differential)"`.

## Task 8 — `DashboardApi`: catalogue methods + `uploadImage`

**Files:** modify `apps/dashboard/src/api/client.ts`, `client.test.ts`.

- [ ] **Step 1 (failing test):** extend `client.test.ts` (stub `fetch`, as the existing file does) —
      `listCatalogues`/`createCatalogue`/`listCategories`/`createCategory`/`listProducts(catalogueId)`/
      `createProduct`/`updateProduct` hit the exact §4 paths/verbs with `credentials:"include"`;
      `uploadImage(file)` POSTs `multipart/form-data` (a `FormData` with a `file` part, **no** JSON
      content-type header) to `/management-api/product-images` and returns `{ image }`; a non-2xx throws
      `{ code }` from the envelope. Expect FAIL.
- [ ] **Step 2 (impl):** add the methods to `DashboardApi`, reusing its `#request` funnel; `uploadImage`
      builds a `FormData` and passes it as the body (browser sets the multipart boundary — do not set
      `content-type`). Define **browser-local** types `CatalogueSummary`, `CategorySummary`,
      `ProductSummary`, `ProductInput`, `AllergenDeclaration`, `PricingUnit`, `VatClass` (NOT imported
      from `@waitron/*` — keep server code out of the bundle, the #70 rule).
- [ ] **Step 3 (verify):** `pnpm --filter @waitron/dashboard test client` → PASS.
- [ ] **Step 4 (commit):** `-s -m "feat(dashboard): DashboardApi catalogue methods + image upload"`.

## Task 9 — `dashboard-allergen-picker` widget (+ a11y)

**Files:** create `apps/dashboard/src/widgets/allergen-picker.ts`, `.test.ts`, `.a11y.test.ts`.

- [ ] **Step 1 (failing test):** a `reviewed` toggle **off** → `value === null` (PENDING; per-code
      controls disabled); toggle **on**, no code marked → `value` deep-equals `{}`; marking `gluten`
      contains with source "trigo" → `{ gluten: { presence: "contains", source: "trigo" } }`. Emits
      `allergens-changed { value }`. Locally redefine `ALLERGEN_DISPLAY_ORDER` (the till pattern,
      `till-allergen-screen.ts:24` — no `@waitron/catalogue` runtime import). a11y test both themes.
      Expect FAIL.
- [ ] **Step 2 (impl):** the 14 codes, each a native token-styled `<select>` (unset/contains/
      may_contain) + optional `wt-input` source; a top `wt-switch` "Revisado" gating null vs `{}`/`{…}`
      (design §7 — the three-state invariant; empty must never mean allergen-free). Emit
      `allergens-changed` (bubbles + composed; `stopPropagation` re-emit pattern).
- [ ] **Step 3 (verify):** `pnpm --filter @waitron/dashboard test allergen-picker` → PASS.
- [ ] **Step 4 (commit):** `-s -m "feat(dashboard): allergen picker (three-state, null=PENDING)"`.

## Task 10 — `dashboard-image-upload` control (+ a11y)

**Files:** create `apps/dashboard/src/widgets/image-upload.ts`, `.test.ts`, `.a11y.test.ts`.

- [ ] **Step 1 (failing test):** selecting a file calls `api.uploadImage` and emits `image-changed
      { image }`; renders `<img src="/media/${image}">` with `alt`; a rejected upload shows the
      `media.*` `errorKey` in a `role="alert"`. a11y both themes (labelled input). Expect FAIL.
- [ ] **Step 2 (impl):** token-styled `<input type="file" accept="image/png,image/jpeg,image/webp">`
      (no `wt-file` primitive exists); on change → `api.uploadImage(file)` → emit; error handling
      mirrors `login-screen`/`staff-screen`.
- [ ] **Step 3 (verify):** `pnpm --filter @waitron/dashboard test image-upload` → PASS.
- [ ] **Step 4 (commit):** `-s -m "feat(dashboard): product image upload control"`.

## Task 11 — `dashboard-product-form` dialog (+ a11y)

**Files:** create `apps/dashboard/src/widgets/product-form.ts`, `.test.ts`, `.a11y.test.ts`.

- [ ] **Step 1 (failing test):** open (`.open = true`), fill per-locale description(s) (default locale
      `["es"]`), price, `vatClass`/`pricingUnit`/`categoryId` selects, `active` switch, drive the
      allergen picker + image control; confirm emits `create-product` with the assembled body
      (`{ catalogueId, categoryId, descriptions, unitPrice, vatClass, pricingUnit, allergens, image,
      active }`); in edit mode a passed `product` pre-fills fields and confirm emits `update-product
      { id, patch }`; `wt-close` resets `open`; a non-empty primary-locale description is required.
      a11y both themes. Expect FAIL.
- [ ] **Step 2 (impl):** `wt-dialog` composing `wt-input`s, token `<select>`s, `wt-switch`,
      `<dashboard-allergen-picker>`, `<dashboard-image-upload>` (import the widget modules for their
      `@customElement` side effects, the `staff-screen.ts:8-9` pattern). `catalogueId` comes from a
      property set by the screen. Single-flight guard on confirm (`staff-screen.ts:70`).
- [ ] **Step 3 (verify):** `pnpm --filter @waitron/dashboard test product-form` → PASS.
- [ ] **Step 4 (commit):** `-s -m "feat(dashboard): product create/edit form"`.

## Task 12 — `dashboard-product-list` + `dashboard-category-manager` (+ a11y)

**Files:** create `apps/dashboard/src/widgets/product-list.ts`, `category-manager.ts`, and their
`.test.ts` + `.a11y.test.ts`.

- [ ] **Step 1 (failing test):** `product-list` renders one `wt-card` row per product (name from
      `descriptions[primaryLocale]`, gross price + unit, `vatClass`, active badge, allergen-state pill:
      PENDING/none/declared, a thumbnail or placeholder) and emits `edit-product { productId }`;
      `category-manager` lists categories + emits `create-category { name }` on submit. a11y both themes.
      Expect FAIL.
- [ ] **Step 2 (impl):** both widgets on `wt-card`/`wt-button`/`wt-input` + tokens; pure-display
      `product-list` (`@property people-like products`), `category-manager` owning only its input.
- [ ] **Step 3 (verify):** `pnpm --filter @waitron/dashboard test product-list category-manager` → PASS.
- [ ] **Step 4 (commit):** `-s -m "feat(dashboard): product list + category manager widgets"`.

## Task 13 — `dashboard-catalogue-screen` (compose) (+ a11y)

**Files:** create `apps/dashboard/src/screens/catalogue-screen.ts`, `.test.ts`, `.a11y.test.ts`.

- [ ] **Step 1 (failing test):** stub `DashboardApi`; on connect loads catalogues + categories +
      `listProducts(selected)`; a catalogue selector switches the product list; "Añadir producto" opens
      the form and confirming calls `createProduct` then reloads; an edit opens the form pre-filled and
      confirming calls `updateProduct` then reloads; the category manager's `create-category` calls
      `createCategory` then reloads; when no catalogue exists it prompts to create one first. Every
      async path caught → `errorKey` banner (the `staff-screen.ts` contract). a11y both themes. Expect
      FAIL.
- [ ] **Step 2 (impl):** the composition point (sibling of `staff-screen.ts`), owning selected-catalogue
      + form-open + category-manager state; `stopPropagation` on the child events; single-flight on
      create/update.
- [ ] **Step 3 (verify):** `pnpm --filter @waitron/dashboard test catalogue-screen` → PASS.
- [ ] **Step 4 (commit):** `-s -m "feat(dashboard): catalogue screen (compose list/form/categories)"`.

## Task 14 — app-shell navigation to the catalogue screen (+ a11y)

**Files:** modify `apps/dashboard/src/dashboard-app.ts`, `dashboard-app.test.ts`,
`dashboard-app.a11y.test.ts`.

- [ ] **Step 1 (failing test):** after login the shell shows a nav switching between
      `<dashboard-staff-screen>` and `<dashboard-catalogue-screen>`; `screen` extends
      `"login" | "staff" | "catalogue"`; the session-probe and logout paths are unchanged (still wrapped
      so no async path is an unhandled rejection, the #70 contract). a11y both themes. Expect FAIL.
- [ ] **Step 2 (impl):** extend the screen machine + add a token-styled nav (`wt-button`s); import the
      catalogue-screen module for registration.
- [ ] **Step 3 (verify):** `pnpm --filter @waitron/dashboard test dashboard-app` → PASS.
- [ ] **Step 4 (commit):** `-s -m "feat(dashboard): nav between staff and catalogue screens"`.

## Task 15 — dev proxy, full green, guard sweep

**Files:** modify `apps/dashboard/vite.config.ts` and `apps/till/vite.config.ts` (add `/media` proxy).

- [ ] **Step 1 (proxy):** add `"/media": "http://127.0.0.1:8080"` to both apps' `server.proxy` (beside
      `/management-api` and `/api`) so `<img src="/media/…">` resolves in dev. (Production serves same-
      origin; no proxy needed.)
- [ ] **Step 2 (dashboard coverage):** `pnpm --filter @waitron/dashboard test:coverage` → PASS
      (95/95/90/88).
- [ ] **Step 3 (touched-package coverage):** `pnpm --filter @waitron/catalogue test:coverage`,
      `pnpm --filter @waitron/server test:coverage`, `pnpm --filter @waitron/db test:coverage` → PASS
      (98/98/98/95 each). **Unfiltered per package** (cross-cutting suites, `CLAUDE.md` §2).
- [ ] **Step 4 (FORCE-RLS guard, again):** `pnpm --filter @waitron/fiscal-verifactu test inmutabilidad`
      → PASS.
- [ ] **Step 5 (tree-wide guards):** from root `pnpm vitest run --coverage` → PASS (`english-only`,
      `guarded-teardowns` — they live in `scripts/`; the migration adds only the English token `image`,
      so `SPANISH_WORDS` is unchanged).
- [ ] **Step 6 (workspace gate):** `pnpm lint && pnpm typecheck && pnpm format:check` → PASS. Run
      `pnpm install` if a dep moved; commit the lockfile.
- [ ] **Step 7 (manual dev smoke, optional):** boot the server + `pnpm --filter @waitron/dashboard dev`;
      log in, create a catalogue + category, create a product with an image, verify it lists and the
      `/media/<name>` image renders. **Blocked** until a first-admin dashboard password exists
      (`docs/backlog.md:308-312`) — record any gap, don't fail the task on it.
- [ ] **Step 8:** no commit — verification only.

---

## Self-review

**Spec coverage:**
- `products.image` column + migration + RLS-needs-nothing proof — Task 1 (+ receipt), Task 7. ✅
- Headless `image`/`active` ops + `media.*` byte validation — Tasks 2–3. ✅
- `/management-api/*` write group (catalogues/categories/products) gated on `person.manage`, image
  upload, public serve, config/boot — Tasks 4–6. ✅
- Differential cross-tenant RLS + gate-by-deletion — Task 7. ✅
- Dashboard: client, allergen picker (null=PENDING), image upload, product form, list, category
  manager, catalogue screen, shell nav, a11y both themes — Tasks 8–14. ✅
- Guard sweep (inmutabilidad, english-only/guarded-teardowns, per-package coverage, dashboard shard) —
  Task 15. ✅

**Decisions carried from the design (not relitigated here):** permission gate `person.manage` +
deferred `catalogue.manage` seam (§3); content-addressed SHA-256 filenames + public serve (§5);
opaque-500 for a foreign `catalogueId` with `catalogue.not_found` deferred (§4). Each is a resolved
decision-point, recorded with its receipt in the design doc.

**Type consistency:** browser-local types (`CatalogueSummary`/`ProductSummary`/`ProductInput`/…)
defined once in `client.ts` (Task 8) and consumed by every widget/screen; event names
(`allergens-changed`, `image-changed`, `create-product`, `update-product`, `edit-product`,
`create-category`) stable across tasks; `/management-api/*` and `/media/*` paths match design §4 exactly.

**Placeholder scan:** Tasks give full failing tests + concrete implementations against named
`@waitron/ui` primitives and named source templates (`management-api.ts`, `staff-screen.ts`,
`till-allergen-screen.ts`); no "TBD".
