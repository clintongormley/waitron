# Catalogue / menu management UI — Design

**Date:** 2026-08-08
**Status:** Design; not started.
**Scope:** the owner-facing UI and HTTP write path to **author the menu** — create/list/edit products
(price, VAT, pricing unit, per-locale descriptions, allergen declaration, active, image) and
create/list categories, on `apps/dashboard`, backed by a new `/management-api/*` catalogue route group
on `apps/server` that wraps the already-built headless `@waitron/catalogue` operations. Includes the
`products.image` column, local-disk image storage, an upload endpoint and a public media-serving
route. Slices past **Slice 1** are decided and recorded here but are not Slice-1 work.

This document follows `CLAUDE.md` §1: every claim of necessity/impossibility carries a receipt or is
marked an assumption; conventions are grepped against siblings before being asserted.

---

## 1. Problem and context

`@waitron/catalogue` shipped headless and deliberately UI-less. Its own design note is explicit —
`2026-08-05-catalogue-model-design.md` D12: *"No management UI, CLI, or HTTP this slice… →
dashboard"*, and `docs/backlog.md:622` records the same deferral: *"no management UI/CLI/HTTP (→
dashboard)"*. So the write functions exist and are tested (`createCatalogue`, `createCategory`,
`createProduct`, `updateProduct`, `deactivateProduct`, `listCatalogues`, `listCategories`,
`listProducts` — `packages/catalogue/src/operations.ts`), but **there is no way for an owner to
call them**: nothing authors the items a shop sells. The till only *reads* the menu
(`GET /api/products` → `listAvailableProducts`).

Allergen declaration landed as #65 — the EU-14 taxonomy, `validateAllergens`, the `allergen.*` codes
and a nullable `products.allergens jsonb` column (`packages/catalogue/src/allergens.ts`), with the
three-state invariant the till renders (`null` = unreviewed/PENDING, `{}` = reviewed-none,
`{code:…}` = declared — `apps/till/src/screens/till-allergen-screen.ts:52-60`). This UI is where the
owner *records* that declaration; it does not decide **which** allergens a product has (a food-safety
matter, out of scope — `docs/backlog.md:276`).

The management dashboard (`apps/dashboard`) is the named home for exactly this
(`2026-08-07-management-dashboard-design.md` §3: *"Catalogue management → later"*; §8's components
table lists `@waitron/catalogue` as a later management-API consumer). Staff admin shipped as its
first slice (#67/#69/#70). This is the catalogue slice.

**New in this slice:** an **image** per product. The owner's decision (this session) is **local-file
storage** — a path/reference in the column, bytes on local disk in a configured directory, a
server upload endpoint and a static-serving route. Not bytes-in-DB.

---

## 2. The frame

Nothing about the architecture is new; it reuses the exact frame staff-admin proved.

- **Dashboard app (`apps/dashboard`).** New screens/widgets on `@waitron/ui` primitives + `--wt-*`
  tokens, in the same Lit/Vite/Vitest-browser toolchain as staff admin. A `DashboardApi` client
  (`apps/dashboard/src/api/client.ts`) gains catalogue methods, mirroring its staff methods
  verbatim (same-origin `fetch`, `credentials:"include"`, `{ error: { code } }` envelope). Browser
  types are redefined locally — the dashboard never imports `@waitron/catalogue` at runtime, exactly
  as `apps/till/src/api/client.ts` redefines its response shapes to keep `@waitron/db` and Node
  builtins out of the browser bundle (`apps/till/src/screens/till-allergen-screen.ts:15-22`).

- **A new `/management-api/*` route group on `apps/server`** — `mountCatalogueApi`, in a new file
  `apps/server/src/catalogue-api.ts`, mirroring `management-api.ts`: a local `STATUS` map, a local
  `run` error boundary, `requireManagementSession` for the 401 gate, and `withTenant` + `asAppUser`
  on every DB touch so RLS scopes every read/write to this server's one venue tenant
  (`cfg.tenantId`, as `mountManagementApi` and `mountTillApi` already do —
  `apps/server/src/boot.ts:259`). It wraps the headless `@waitron/catalogue` ops; **no new domain
  package**.

- **Media handling on `apps/server`.** An **authenticated** upload route in the catalogue group and a
  **public** serving route mounted separately (`mountMedia`), reading/writing a configured local
  directory (§5).

- **No change to the fiscal core, the till sale path, or `computeHuella`.** Menu authoring writes
  `catalogues`/`categories`/`products` only.

**Data flow** (identical shape to staff admin): browser → HTTP → catalogue route → management-session
check → `authorizeManager(person.manage)` → headless `@waitron/catalogue` fn under `withTenant` +
`asAppUser` → local Postgres → response.

---

## 3. Permission gate — decision

The route brief asked which permission gates these writes. **Receipt (grepped, not assumed):** the
permission catalog `packages/identity/src/permissions.ts` is
`["sale.void","sale.refund","sale.discount","sale.rectify","person.manage"]`. **`catalogue.manage`
does not exist.** It is a *recorded deferred seam* — `docs/backlog.md:626-627`: *"the
`catalogue.manage` permission enforcement (→ with the till's call sites, like the discount seam)."*

**Decision: gate every catalogue write route on `person.manage` for Slice 1**, and record
`catalogue.manage` as the intended future gate.

- **Why it is correct today, not a shortcut.** `person.manage` maps to `manager` + `admin`
  (`permissions.ts:26,33`) — exactly the dashboard's audience (operators use the till PIN; managers/
  admins use the dashboard — `2026-08-07-management-dashboard-design.md` §4e). A `catalogue.manage`
  permission added now would be mapped to the same two roles, so the two gates are **behaviourally
  identical** on today's role set; the only difference is a semantic label and where the seam-
  realisation cost lands.
- **Why not realise `catalogue.manage` now.** The backlog deferral is deliberate and dated. Adding a
  permission is a cross-package change to `@waitron/identity` (the `PERMISSIONS` tuple, the
  role→permission sets, and the tests that pin them), which pulls identity role-mapping decisions
  into a slice whose subject is the catalogue UI. Keeping the gate as `person.manage` honours the
  recorded deferral and keeps the slice's blast radius on `apps/server` + `apps/dashboard` +
  `@waitron/catalogue` + one `@waitron/db` column.
- **The error code is unaffected.** The gate throws the existing `authorization.not_permitted`
  (`packages/identity/src/manager-login.ts:49`) — no invented or renamed code (`CLAUDE.md` §3). Its
  `{ permission }` param will read `"person.manage"` until the seam is realised; that is honest about
  what actually gated the call.
- **Realising the seam later** (a follow-up, exactly like the `sale.discount` seam
  `docs/backlog.md:679`): add `"catalogue.manage"` to `PERMISSIONS`, add it to the `manager`/`admin`
  sets, and swap the gate constant in `catalogue-api.ts` from `"person.manage"` to
  `"catalogue.manage"`. One constant, one place — because the routes gate on a permission, never a
  role (`permissions.ts:1-6`). **To make that a one-line swap, `mountCatalogueApi` references the gate
  through a single named module constant** (`const CATALOGUE_WRITE_PERMISSION: Permission =
  "person.manage"`), not an inline literal at each route.

---

## 4. The write API surface

New file `apps/server/src/catalogue-api.ts`, `mountCatalogueApi(app, deps, log)`, `deps =
{ db, cfg: { tenantId }, mediaDir, maxUploadBytes }`. Its own `run`/`STATUS` (mirroring
`management-api.ts:64-118`). Every route below is wrapped in `run`; every gated route calls
`requireManagementSession(c)` (→ `management_session.required` 401 before any DB work) and then,
inside the `withTenant`+`asAppUser` transaction, `authorizeManager(tx, { managementSessionId,
permission: CATALOGUE_WRITE_PERMISSION })` (→ `authorization.not_permitted` 403) **before** the
catalogue op. Path `:id` params are `isUuid`-screened (→ `shared.invalid_id` 400) before reaching a
`uuid` column, exactly as `management-api.ts:133` / `till-api.ts:133` screen theirs.

Bodies are coerced `?? {}` then type-screened, refusing a missing/wrong-typed field as
`management.request_invalid` naming the field, never the value — the established management pattern
(`management-api.ts:259-265`).

| Verb + path | Permission | Body → result | Codes it can answer |
| --- | --- | --- | --- |
| `GET /management-api/catalogues` | `person.manage` | — → 200 `[{id,name,active,version}]` | 401 |
| `POST /management-api/catalogues` | `person.manage` | `{name}` → 201 `{id,name,active,version}` | 401, 403, `management.request_invalid` 400 |
| `GET /management-api/categories` | `person.manage` | — → 200 `[{id,name}]` | 401 |
| `POST /management-api/categories` | `person.manage` | `{name}` → 201 `{id,name}` | 401, 403, `management.request_invalid` 400 |
| `GET /management-api/catalogues/:id/products` | `person.manage` | — → 200 `[Product]` | 401, `shared.invalid_id` 400 |
| `POST /management-api/products` | `person.manage` | `CreateProductBody` → 201 `Product` | 401, 403, `management.request_invalid` 400, `allergen.invalid_code`/`allergen.invalid_presence`/`allergen.invalid_source` 400 |
| `PATCH /management-api/products/:id` | `person.manage` | `UpdateProductBody` → 204 | 401, 403, `shared.invalid_id` 400, `management.request_invalid` 400, `allergen.*` 400 |
| `POST /management-api/product-images` | `person.manage` | `multipart/form-data` (`file`) → 201 `{image}` | 401, 403, `media.missing` 400, `media.unsupported_type` 415, `media.too_large` 413 |
| `GET /media/:filename` (**public**, `mountMedia`) | none | — → 200 image bytes / 404 | plain 404 (not an AppError envelope) |

`CreateProductBody` = `{ catalogueId, categoryId: string|null, descriptions: Record<string,string>,
pricingUnit, unitPrice, vatClass, allergens?, image? }`. `UpdateProductBody` = the mutable slice
`{ descriptions?, unitPrice?, vatClass?, pricingUnit?, categoryId?, allergens?, image?, active? }`.
These match `CreateProductInput`/`UpdateProductInput` (`operations.ts:49-70`) once §6 extends them
with `image`/`active`.

**Status map (the new `STATUS` for `catalogue-api.ts`):** `management_session.required` 401,
`management_session.expired` 401, `person.suspended` 403, `authorization.not_permitted` 403,
`management.request_invalid` 400, `shared.invalid_id` 400, `allergen.invalid_code` 400,
`allergen.invalid_presence` 400, `allergen.invalid_source` 400, `media.missing` 400,
`media.unsupported_type` 415, `media.too_large` 413. Any registered code absent from the map defaults
to 400 via `run`'s `?? 400` (as both existing surfaces do). A genuine server fault is a non-`AppError`
→ opaque 500.

**Deliberately opaque for Slice 1:** a *well-formed* but non-existent/foreign `catalogueId` or
`categoryId` in `POST /management-api/products` reaches the single-column FK and raises a PG `23503`,
which `run` maps to an opaque 500 — the same posture `management-api` takes for server faults. The
dashboard only ever posts ids it just listed, so this is a degenerate path. A pre-check adding
`catalogue.not_found` / `category.not_found` domain codes (and the cross-tenant-FK hardening the
backlog already tracks, `docs/backlog.md:574-583`) is a **noted follow-up**, not Slice-1 work — it is
called out so the 500 is a recorded decision, not an oversight (`CLAUDE.md` §1: "unreachable" is a
claim).

**Error-code naming (grepped siblings, per `CLAUDE.md` §3).** The registry uses domain-concept
prefixes (`allergen.*`, `payment.*`, `person.*`, `fiscal.*`, `series.*`; scanned across every
`errors.ts`). There is **no existing** `image.*`/`media.*`/`upload.*`/`file.*`/`asset.*` code (grep of
`packages/*/src` + `apps/*/src` returned none), so this slice **establishes** `media.*` as the domain
concept for *an uploaded media file*, decoupled from `products` so a future logo/avatar upload reuses
it. It names the *thing* (a media file), not the throwing package — the rule
`packages/shared/src/errors.ts` states. The three codes: `media.missing` (no file part in the
multipart body), `media.unsupported_type` (the bytes are not an accepted image type),
`media.too_large` (exceeds `maxUploadBytes`). These, plus a pure `sniffImageType`/`validateImageBytes`
helper, live in `@waitron/catalogue` beside the allergen validation (§5), registered in
`packages/catalogue/src/errors.ts`.

---

## 5. Image upload, storage, serving

### 5a. The `products.image` column + migration

Add a **nullable** `image` column to `products` (`packages/db/src/schema/catalogue.ts`):
`image: text("image")` — a path *reference*, never bytes. Nullable because a product legitimately has
no photo (distinct from `allergens`' `null`, which is a load-bearing PENDING state; `image === null`
just means "no picture").

**Migration** `packages/db/drizzle/0034_<generated>.sql` (next free index — the journal's last is idx
33 / `0033_furry_silver_samurai`, `packages/db/drizzle/meta/_journal.json`). This is a **plain column
add**, so `drizzle-kit generate` (not `--custom`) produces
`ALTER TABLE "products" ADD COLUMN "image" text;` and updates the journal. It lands in the existing
**`core`** set (`migrations.manifest.json` maps `core → ../db/drizzle`), so it is picked up
automatically; it adds no migration *set*, so it does not touch the manifest or the
`migratedSets`-pinning test (`packages/provisioning/src/instance-apply.rls.test.ts`) — the
cross-package hardcoded-list trap (`CLAUDE.md` §2) does not apply.

**RLS — confirmed needs nothing beyond the existing policy.** `products` is already tenant-scoped with
FORCE RLS, a `FOR ALL` tenant-isolation policy, and `GRANT SELECT, INSERT, UPDATE ON products TO
app_user` — receipt: `packages/db/drizzle/0027_light_smiling_tiger.sql` (the three `products` lines:
`FORCE ROW LEVEL SECURITY`, `CREATE POLICY "products_tenant_isolation" … USING/WITH CHECK (tenant_id
= current_tenant_id())`, `GRANT SELECT, INSERT, UPDATE`). A **table-level** privilege GRANT (no column
list) extends to columns added later, and the policy filters rows not columns, so the new `image`
column inherits both. This is **not asserted from reading** — the plan (§Testing) proves it by
mutation: a real-PG test writes and reads `image` as `app_user` under `withTenant`+`asAppUser` and a
cross-tenant read returns nothing (the differential fails if `asAppUser` is dropped). No new
`tenant_id` table is created, so the "new tenant-scoped table needs FORCE + policy + grants"
requirement (`CLAUDE.md` §3) is not triggered. The FORCE-RLS scan guard
(`packages/fiscal-verifactu/src/inmutabilidad.test.ts`, keyed on "has a `tenant_id` column") already
covers `products` and must be re-run after the change (it stays green — the column add does not remove
FORCE).

### 5b. Filename strategy — decision: content-addressed SHA-256

The uploaded filename is **untrusted** (path traversal: `../../etc/passwd`), so it is **never** used
for storage — the same "validate, never concatenate untrusted input into a path/statement" discipline
`CLAUDE.md` §3 states for SQL utility statements. The stored name is **server-generated**:

**`<sha256-hex-of-bytes>.<ext>`**, where `<ext> ∈ {jpg, png, webp}` is derived from **magic-byte
sniffing** of the bytes (not the client's `Content-Type`, not the client filename):

- JPEG: first bytes `FF D8 FF` → `jpg`
- PNG: first bytes `89 50 4E 47 0D 0A 1A 0A` → `png`
- WEBP: bytes `52 49 46 46` (`RIFF`) at 0 and `57 45 42 50` (`WEBP`) at 8 → `webp`
- anything else → throw `media.unsupported_type`

**Why content-addressed over a random UUID** (both are safe; this is the resolved trade-off):
1. **Idempotent re-upload** — the same bytes always produce the same name, so a retried upload writes
   the same file, never a duplicate.
2. **Immutable, cacheable URL** — the name changes only when the bytes change, so the serving route
   can send `Cache-Control: public, max-age=31536000, immutable`. That matters when the till fetches
   images over a metered remote tunnel (T1, `2026-08-07-management-dashboard-design.md` §5).
3. **Dedup** — identical photos share one file.
4. **Path-traversal-proof by construction** — the name is 64 hex chars + a fixed extension; the
   serving route re-validates against `^[0-9a-f]{64}\.(jpg|png|webp)$` and rejects anything else with
   a bare 404 before touching the filesystem, so a crafted `:filename` can never escape `mediaDir`.

The rejected alternative — `crypto.randomUUID()` + ext — is simpler but gives none of the four; the
cost of SHA-256 over a ≤ few-MB buffer is negligible and one-time per upload.

**GC of orphaned images** (a replaced or deactivated product's old file) is **deferred** — Slice 1
never deletes image files (consistent with "products are deactivated, never deleted"). Refcounted
cleanup is a later-slice concern, noted so the disk-growth trade-off is on record.

### 5c. The stored value and the served URL

`products.image` stores the **bare filename** (`<sha256>.<ext>`), not a full URL — transport-agnostic,
so the same value resolves whether served from the LAN, a tunnel, or a future cloud read-mirror (the
§2 decoupling). Clients build the display URL by prefixing the known media base: **`/media/<filename>`**
(same-origin in production where the server serves the built bundle; proxied in dev — each app's
`vite.config.ts` gains a `/media` proxy entry beside its existing `/api` / `/management-api` one).

### 5d. The directory config

`WAITRON_MEDIA_DIR` (env, `WAITRON_*` convention — `apps/server/src/config.ts`), added to
`ServerConfig` as `mediaDir: string`, resolved to an **absolute** path at load (`path.resolve`).
Default: a boot-provided `defaultMediaRoot` (mirroring how `migrationsRoot` takes a boot-computed
`defaultMigrationsRoot`, `config.ts:159,258`), e.g. `<dist>/media` / `<cwd>/media`; deployment (#9)
sets it explicitly. `boot.ts` ensures the directory exists once at startup
(`fs.mkdirSync(mediaDir, { recursive: true })`) before mounting. **Empty-string guard:** an unset OR
empty `WAITRON_MEDIA_DIR` falls back to the default (the `isUnset` pattern `config.ts:234` already
uses for the TLS pair) — never `path.resolve("")` (which is `cwd`, the "empty value is a valid value"
class `CLAUDE.md` §3 warns about).

### 5e. Upload + serve mechanics

- **Upload** `POST /management-api/product-images` (gated): a coarse `bodyLimit(maxUploadBytes)`
  middleware (`hono/body-limit`, confirmed present in hono@4.12.32) as a DoS guard on the route, then
  `const body = await c.req.parseBody()` (hono's `multipart/form-data` parser, confirmed present),
  take `body.file` (must be a `File` else `media.missing`), read `await file.arrayBuffer()`, a precise
  `file.size > maxUploadBytes` check → `media.too_large`, `validateImageBytes` → ext, compute the
  SHA-256 name, `fs.writeFile(path.join(mediaDir, name), bytes)` (idempotent — same name, same bytes),
  answer `201 { image: name }`.
- **Serve** `GET /media/:filename` (public, `mountMedia`): validate `:filename` against the strict
  regex → 404 on any miss, `fs.readFile(path.join(mediaDir, filename))` (ENOENT → 404), answer 200
  with `Content-Type` from the extension (`jpg→image/jpeg`, `png→image/png`, `webp→image/webp`) and
  the immutable `Cache-Control`. Unauthenticated because menu photos are not secret and both the till
  (till-session) and the dashboard (management-session) must fetch them with a plain `<img src>`; the
  filename is a 256-bit content hash, not enumerable. A custom `fs` handler is chosen over
  `@hono/node-server/serve-static` (which exists) so the path-traversal guard is **explicit and
  unit-testable** rather than trusted to middleware — `CLAUDE.md` §3's "the defence is explicit, never
  implicit."

`maxUploadBytes` is a config constant (proposal: 5 MiB) surfaced on `deps` so tests can shrink it.

---

## 6. `@waitron/catalogue` changes (headless)

Small, additive extensions so the ops carry `image` and an `active` toggle:

- **Schema** (`schema/catalogue.ts`): `image: text("image")` on `products` (§5a).
- **`Product`, `RawProduct`, `PRODUCT_COLUMNS`** (`operations.ts`): add `image: string | null`.
- **`CreateProductInput`**: add `image?: string`; `createProduct` inserts `image: input.image ?? null`.
- **`UpdateProductInput`**: add `image?: string | null` and `active?: boolean`; `updateProduct`'s
  existing `.set({ ...patch, updatedAt })` maps both straight to their columns (no other change — the
  allergen validation is untouched). `active` in the patch lets the edit form toggle active/inactive
  through one route rather than a separate deactivate verb (the headless `deactivateProduct` stays for
  the till/other callers).
- **`media.ts`** (new): pure `validateImageBytes(bytes: Uint8Array): "jpg"|"png"|"webp"` +
  `sniffImageType`, no `fs`/`db` (so it stays browser-safe and is unit-tested by feeding byte
  arrays), throwing `media.*`; **`errors.ts`** gains the three `media.*` augmentations. Exported from
  the barrel (`index.ts`).
- **Optional, same PR or a fast-follow:** add `image` to `AvailableProduct` + the
  `listAvailableProducts` select so the till read carries it. The **till rendering** of the image is a
  separate till slice, noted, not Slice-1 dashboard work; adding the field is harmless to the till
  (its client redefines its own types and simply ignores an extra field).

No Spanish schema tokens are added (`image`, `media` are English), so `SPANISH_WORDS`
(`packages/db/src/english-only.ts`) is unchanged; `@waitron/catalogue` is scanned by the english-only
guard and stays clean.

---

## 7. Dashboard screens

All on `@waitron/ui` primitives (`wt-button`, `wt-input`, `wt-card`, `wt-dialog`, `wt-switch`,
`wt-icon` — the full registered set) + `--wt-*` tokens; native `<select>` styled with tokens for
pickers (there is **no `wt-select`** — the recorded #70 convention,
`2026-08-07-dashboard-slice1c-dashboard-app.md` §Global Constraints). This is a pointer/keyboard app,
so keyboard/focus a11y is weighted over touch-target size, and **every screen/widget carries a
`.a11y.test.ts` running axe in both light and dark themes** — the #70 pattern exactly.

- **`dashboard-catalogue-screen`** (the composition point, sibling of `dashboard-staff-screen`):
  loads catalogues + categories + the selected catalogue's products via `DashboardApi`; owns the
  catalogue selector, the product-form open state and the category-manager open state; on
  `create-product`/`update-product`/`create-category` events calls the API then reloads. Error
  handling mirrors `staff-screen.ts` (every async path caught → `errorKey` in a `role="alert"`
  banner; a single-flight guard on create/update, like `staff-screen.ts:70`). Because products need a
  catalogue (`catalogue_id` is `NOT NULL`), the screen lists catalogues and, when none exist, prompts
  to create one before products can be added; the selected catalogue scopes the product list and new
  products.
- **`dashboard-product-list`** (pure display): one `wt-card` row per product showing the name
  (`descriptions[primaryLocale]`, the `productName` approach `apps/till/src/widgets/product-name.ts`
  takes), gross `unitPrice` + `pricingUnit`, `vatClass`, an active badge, an allergen state pill
  (PENDING / none / declared — the three states §1), and a thumbnail (`<img src="/media/${image}">`)
  or a placeholder. Emits `edit-product { productId }` on a row's Edit control.
- **`dashboard-product-form`** (`wt-dialog`, create + edit): fields —
  - **per-locale descriptions**: one `wt-input` per locale in a `locales` property (default `["es"]`;
    seeding it from the tenant's configured locales is a noted follow-up — the dashboard has no
    venue-locale fetch yet). Produces the `descriptions: Record<locale,string>` map; requires a
    non-empty primary-locale description client-side (the column is `NOT NULL`; `{}` is legal in the
    DB but a nameless product is a UI error).
  - **`unitPrice`** `wt-input` (gross, `numeric(12,2)` — string, validated shape client-side),
  - **`vatClass`** native `<select>` (`general`/`reduced`/`super_reduced`/`zero` — the CHECK set,
    `schema/catalogue.ts:91`),
  - **`pricingUnit`** native `<select>` (`each`/`weight` — the CHECK set),
  - **`categoryId`** native `<select>` (the loaded categories + a "— none —" option → `null`),
  - **`active`** `wt-switch`,
  - **`<dashboard-allergen-picker>`** (below),
  - **`<dashboard-image-upload>`** (below).
  Emits `create-product` / `update-product` with the assembled body.
- **`dashboard-allergen-picker`**: the EU-14 taxonomy (`ALLERGEN_DISPLAY_ORDER`, redefined locally as
  the till screen does — `till-allergen-screen.ts:24`), each code a control with **contains /
  may_contain / (unset)** plus an optional free-text `source` `wt-input`. It **preserves the
  null=PENDING invariant** with an explicit top-level control: a **"reviewed" switch/toggle**
  distinguishing the three states —
  - toggle **off** → the declaration is `null` (unreviewed / PENDING) regardless of any per-code
    entries (the picker's per-code controls are disabled),
  - toggle **on** with no code set to contains/may_contain → `{}` (reviewed, none of the 14),
  - toggle **on** with entries → `{ code: { presence, source? } }`.
  This is the UI counterpart of the three states the till renders and the reason it must be an
  explicit control, not "empty ⇒ none": fourteen blank cells must never silently claim "allergen-free"
  (`till-allergen-screen.ts:54-58`). The picker's output is fed to `createProduct`/`updateProduct`
  unvalidated-for-shape client-side but **server-validated** by `validateAllergens`
  (`operations.ts:192,225`), so the `allergen.*` codes remain the authority.
- **`dashboard-category-manager`** (a `wt-dialog` or an inline panel on the screen): list categories +
  a create field; emits `create-category { name }`.
- **`dashboard-image-upload`**: a token-styled native `<input type="file"
  accept="image/png,image/jpeg,image/webp">`; on change calls `api.uploadImage(file)` →
  `{ image }`, shows a preview (`<img src="/media/${image}">`), and emits/binds the stored `image`
  reference to the form. Shows the `media.*` error key on rejection. a11y: the input is labelled; the
  preview `<img>` carries `alt`.
- **App shell nav** (`dashboard-app.ts`): the logged-in state gains navigation between the existing
  `staff` screen and the new `catalogue` screen (the `screen` machine extends
  `"login" | "staff" | "catalogue"` with a simple nav control; the session-probe and logout flow are
  unchanged, `2026-08-07-dashboard-slice1c-dashboard-app.md` Task 7).

---

## 8. Slices

**Slice 1 — the minimum coherent vertical (this document's build target):**
- `products.image` column + migration (§5a); the `@waitron/catalogue` `image`/`active` extensions (§6)
  + `media.ts` validation.
- `mountCatalogueApi` with catalogues (list/create), categories (list/create), products
  (list-by-catalogue / create / patch) and the image-upload route; `mountMedia` serve route; config +
  boot wiring (§4, §5).
- Dashboard: catalogue screen, product list, product form (price / VAT / pricing_unit / per-locale
  descriptions / allergens / active + **at least one image**), allergen picker, image upload,
  category create/list, catalogue create/list/select, shell nav (§7).
- All guard suites + a11y both themes + coverage (§9).

**Later slices (decided, not built here):**
- **Slice 2 — richer editing:** catalogue rename/deactivate, category rename, product deactivate/
  reactivate UX polish, `catalogue.not_found`/`category.not_found` pre-checks + cross-tenant-FK
  hardening (`docs/backlog.md:574-583`), multi-locale description seeding from tenant config, till-side
  image rendering, image GC.
- **Slice 3 — catalogue↔location + sync:** catalogue-to-location assignment UI
  (`assignCatalogueToLocation` exists headless), catalogue versioning / sync hooks (the
  `catalogues.version` seam), per-location price/availability overrides.
- **Realise the `catalogue.manage` permission** (§3) — swap the one gate constant.

---

## 9. Testing + guard suites

- **`@waitron/db`** — schema + migration. Run the whole package (`pnpm --filter @waitron/db
  test:coverage`, 98/98/98/95) — a filtered run skips cross-cutting suites (`CLAUDE.md` §2).
- **FORCE-RLS scan** — `pnpm --filter @waitron/fiscal-verifactu test inmutabilidad`: stays green
  (products keeps FORCE; the column add removes nothing). Mandatory after any schema touch on a
  tenant-scoped table (`CLAUDE.md` §3).
- **`@waitron/catalogue`** (98/98/98/95) — `media.ts` validation (magic-byte tables, each accepted
  type + rejections), the `image`/`active` op extensions, `createProduct`/`updateProduct` carrying
  `image`. Prove each `media.*` code by feeding malformed bytes.
- **`apps/server`** (98/98/98/95):
  - `catalogue-api.test.ts` — every route's happy path + body-shape refusals (`management.request_invalid`),
    id screening (`shared.invalid_id`), allergen refusals, the media upload (accepted type → 201
    `{image}`; `media.missing`/`unsupported_type`/`too_large`), the media serve (200 bytes + headers;
    404 on a traversal attempt and on ENOENT). Use hono's `app.request` in-process, as
    `management-api.test.ts` does.
  - `catalogue-api.rls.test.ts` — **real-Postgres**, mirroring `management-api.rls.test.ts`:
    - a **differential** cross-tenant isolation proof — two provisioned venues; a manager of tenant A
      lists/reads only tenant A's catalogues/categories/products; **the test fails if `asAppUser` is
      dropped** from a handler (`listProducts` has no explicit tenant filter and relies entirely on
      `withTenant`+`asAppUser` RLS — `management-api.rls.test.ts:219-220` is the template);
    - **prove the `person.manage` gate by deletion** — a `staff`-role management session is refused
      `403 authorization.not_permitted` on every write route; remove the `authorizeManager` line and
      confirm the test goes red, then restore (`CLAUDE.md` §4 "prove a guard by deletion";
      `2026-08-07-management-dashboard-design.md` §9);
    - the `image` column write/read as `app_user` under RLS (the §5a receipt — the column is
      writable through the existing grant/policy; a cross-tenant read returns nothing).
- **`apps/dashboard`** (95/95/90/88, its own `test-dashboard` Chromium shard — already wired in #70,
  `scripts/changed-scope.mjs` `OWN_SHARD_PACKAGES`): component tests for the client methods + each
  widget/screen (stub `DashboardApi`), and a `.a11y.test.ts` per widget/screen in **both themes**. No
  CI-scope change is needed — every touched package is already in scope; no new package is added.
- **Root tree-wide guards** — `pnpm vitest run --coverage` from root runs `english-only` and
  `guarded-teardowns` (they live in `scripts/`, `CLAUDE.md` §4). The new real-PG suites use the
  `useRealPostgres` lifecycle helper so they write no teardown to get wrong.
- **Whole-branch base-to-tip review** before the PR (`CLAUDE.md` §1 "a behaviour change retires every
  receipt") — the schema change touches READMEs/claims about the products table and the catalogue
  ops.

---

## 10. Components and boundaries

| Unit | Purpose | Depends on | Slice |
| --- | --- | --- | --- |
| `products.image` column + 0034 | the image reference | `@waitron/db` schema | 1 |
| `@waitron/catalogue` `media.ts` + `image`/`active` ops | pure image-byte validation + op extensions | `@waitron/shared` | 1 |
| `apps/server` `catalogue-api.ts` (`mountCatalogueApi`) | gated write routes wrapping the headless ops + upload | `@waitron/catalogue`, `@waitron/identity`, `@waitron/db` | 1 |
| `apps/server` `mountMedia` + `mediaDir` config | public serve of stored bytes | `fs`, config | 1 |
| `apps/dashboard` catalogue screens/widgets | render + call the catalogue API | `@waitron/ui`, `DashboardApi` | 1 |

Each has one purpose and a defined interface: the routes authorise and delegate; `@waitron/catalogue`
owns menu logic + image-byte validation; the dashboard renders and calls. The dashboard can be
understood without the storage internals, and the storage scheme can change (UUID↔hash, disk↔object-
store) without touching the dashboard, which only ever sees `/media/<ref>`.

---

## 11. Provenance — receipts and assumptions

| Claim | Receipt / status |
| --- | --- |
| `catalogue.manage` does not exist; `person.manage` does | `packages/identity/src/permissions.ts` (grepped); deferral `docs/backlog.md:626-627` |
| `products` already has FORCE RLS + isolation policy + SELECT/INSERT/UPDATE grant | `packages/db/drizzle/0027_light_smiling_tiger.sql` (quoted §5a) |
| Table-level GRANT + row policy cover a later-added column | **Proven by the §9 real-PG test**, not asserted from reading |
| No existing `media.*`/`image.*`/`upload.*` error code | grep of `packages/*/src` + `apps/*/src` returned none |
| hono `c.req.parseBody()` (multipart) + `hono/body-limit` available | hono@4.12.32 in the pnpm store (`request.d.ts:126`; `middleware/body-limit/index.d.ts:44`) |
| `@hono/node-server/serve-static` exists (rejected in favour of the explicit fs guard) | `@hono/node-server@1.19.15` `dist/serve-static.*` |
| Next migration index is 0034 | `packages/db/drizzle/meta/_journal.json` last idx 33 (`0033_furry_silver_samurai`) |
| Three-state allergen invariant (null=PENDING, {}=none, {…}=declared) | `apps/till/src/screens/till-allergen-screen.ts:52-60`; `validateAllergens` `packages/catalogue/src/allergens.ts:39` |
| Env-var + config-default + `isUnset` pattern | `apps/server/src/config.ts:159,234,258` |
| Magic-byte signatures (JPEG/PNG/WEBP) | **Assumption to confirm in the `media.ts` test** by feeding known-good files' bytes; the test is the receipt |

**Internal cross-references:** management-dashboard design
(`2026-08-07-management-dashboard-design.md`), catalogue model
(`2026-08-05-catalogue-model-design.md`), menu & allergens plan (`2026-08-07-menu-allergens.md`),
staff-admin slice-1c plan (`2026-08-07-dashboard-slice1c-dashboard-app.md`).
