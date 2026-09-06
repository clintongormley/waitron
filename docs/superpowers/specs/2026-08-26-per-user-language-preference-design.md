# Per-user language preference — design

> **Superseded placement decision, 2026-09-06:** The [UI navigation and controls plan](../plans/2026-09-06-ui-navigation-and-controls.md) places the language chooser at the bottom right, outside the operator header, and keeps it available on kitchen displays. The header-placement and kiosk-removal instructions below record the earlier design.

**Status:** design, awaiting review.
**Date:** 2026-08-26.
**Branch:** `feat/per-user-locale`.

## The scenario

A deli in Madrid runs the till in Spanish. One cashier is more comfortable in English. Today there
is no way for that cashier to see the till in English: the till's language comes from the venue's
server configuration (`WAITRON_TILL_LOCALE`, default `es-ES`), and the dashboard's language is
hard-coded to `es-ES` in source with no switch at all. This design lets **each person choose their
own interface language**, stored against their staff account, applied wherever they log in — while
the printed receipt keeps speaking the venue's language, not the operator's.

## What a "user" is, and what already exists

- A **user is a `person`** — a member of staff who can log in. The table is
  `packages/identity/src/schema/persons.ts` (`persons`): mutable, tenant-scoped, already under
  `FORCE ROW LEVEL SECURITY` with a `persons_tenant_isolation` policy and
  `GRANT SELECT, INSERT, UPDATE ON persons TO app_user`
  (`packages/identity/drizzle/0001_identity_rls.sql:8,10,20`). The grant is **table-level**, so a new
  column is writable by the app role with **no grant change and no RLS change**.
- The **till** authenticates a person at `POST /api/session` (`apps/server/src/till-api.ts:361`),
  returning `{ personId, canConfigureTill }`. It has no session-restore endpoint — a page reload
  returns to the lock screen and the operator re-enters their PIN — so the login response is a
  sufficient place to hand the client the person's locale.
- The **dashboard** already probes `GET /management-api/session/me`
  (`apps/server/src/me-api.ts:94`), returning `{ personId, role }`, consumed by `getMe()` in
  `apps/dashboard/src/dashboard-app.ts` (`#applyMe`). That response is where the person's locale
  joins.
- Both apps have a real i18n layer (`apps/{till,dashboard}/src/i18n/`). `t(key, locale)` resolves the
  locale's catalogue if present, **else the English base** (`en` is the source of truth):
  `catalogues[l]?.[key] ?? en[key]` (`apps/till/src/i18n/t.ts:26`). Two catalogues exist today —
  `en` and `es`. The module-global active locale defaults to `es-ES` and is changed by `setLocale`.
  The till already calls `setLocale(till.locale)` once at boot, *before* first paint
  (`apps/till/src/till-app.ts:403`); the dashboard never calls `setLocale`.
- The venue already records **`locations.province`** (nullable) and an ordered fiscal
  **`invoiceLocales`** list (`packages/db/src/schema/tenants.ts:97,104`). At runtime, though, the
  server's venue-default UI locale is `cfg.locale`, sourced from `WAITRON_TILL_LOCALE`
  (`apps/server/src/till-config.ts:127`), not from those columns.

## Decisions (agreed)

1. **Self-service, both apps, before and after login.** The logged-in person changes their own
   language, via a switcher in the till (near logout) and in the dashboard (header chrome). Both
   **login screens** also carry a chooser so the pre-auth screen can be read in the reader's language
   — transient (nothing to persist to before authentication), superseded by the person's stored
   preference the moment they log in.
2. **The receipt stays the venue's language.** The per-operator preference drives the on-screen UI
   only. The till's `invoiceLocale` (receipt/fiscal document language) is **never** the operator's
   preference — it remains the venue's configured locale. A receipt must not depend on who was at the
   till.
3. **English + Spanish only for now.** The two catalogues that exist. The mechanism is built so a
   third locale is a drop-in (add a catalogue + one list entry).
4. **A venue always has a supported default locale, derived `province → country → English`.** The
   venue default is never an arbitrary/unsupported string: it is resolved to a code from the
   available list. The chain is: an explicit config override if supported → the province's language
   (deferred, see 5) → the country's language (`tenant.country`, e.g. `ES → es-ES`) → **English**
   (`en-GB`) as the floor. So a Madrid venue defaults to Spanish (country), a Cataluña venue also to
   **Spanish** today (province→Catalan is deferred, so it falls to country=Spain — not English), and
   a venue in a country whose language we lack falls to English.
5. **Province → language derivation is deferred; country → language is built now.** The regional
   `province → language` step (Cataluña→Catalan) lands with the first regional catalogue — building
   it now would only ever output Spanish, which this repo forbids as code that buys nothing; the
   `locations.province` column is its hook. The `country → language` step **is** built now (it is the
   active part of the chain above): `ES → es-ES`, everything else → English.

## Data model

Add one nullable column to `persons`:

```sql
locale text        -- null = "no preference set"; the app falls back
```

- **Nullable**, because "no preference" must be distinguishable from a chosen locale — a null person
  falls back to the venue default.
- **No `CHECK` constraint tying it to a fixed enum.** The supported set is enforced at the write
  boundary (below), not in the schema, so adding a locale is a catalogue + constant change with no
  migration. A non-empty check (`locale is null or length(locale) > 0`) mirrors the table's existing
  column checks and rejects the empty string.
- **Plain Drizzle migration** (`drizzle-kit generate`, not `--custom`): a column add with no RLS,
  policy or grant change. Regenerate the identity migration set and commit the SQL.
- The migration must be verified against **real Postgres** as the `app_user` role: the four-line
  receipt is an `UPDATE persons SET locale = …` succeeding under RLS for a row in the current tenant.

The available languages and the geography maps are one shared source of truth. The server serves the
list to the pickers (they fetch it, they do not hard-code it — see § Front-ends), and validates
writes against it:

```ts
// packages/shared/src/locales.ts
export const SUPPORTED_LOCALES = [
  { code: "es-ES", label: "Español" },
  { code: "en-GB", label: "English" },
] as const;
export const SUPPORTED_LOCALE_CODES = SUPPORTED_LOCALES.map((l) => l.code);

// The absolute floor — reached only when neither the venue's province nor its
// country yields an available language.
export const FALLBACK_LOCALE = "en-GB";

// country → its default UI language. Built now (decision 5); one meaningful
// entry today. A country absent here falls through to FALLBACK_LOCALE.
export const COUNTRY_DEFAULT_LOCALE: Record<string, string> = { ES: "es-ES" };

// province → its regional language. DEFERRED (decision 5): empty until a
// regional catalogue (e.g. Catalan) exists, so today every province falls
// through to the country step. The hook is locations.province.
export const PROVINCE_DEFAULT_LOCALE: Record<string, string> = {};
```

`packages/shared` is chosen because both the server (validation + the `GET …/locales` endpoint) and
the maps depend on it, and locale codes/country codes are English identifiers, so the `english-only`
guard is satisfied.

## Locale resolution

Two pure functions in `packages/shared/src/locales.ts` (beside the maps, so the server shares them),
each returning **only a supported code** — the first available candidate, else the next step:

```ts
// The venue's default UI language (decision 4). Server-side.
// resolveVenueLocale({ override, province, country }) -> a SUPPORTED code
//   first supported of:
//     [ override,                           // WAITRON_TILL_LOCALE, if set & supported
//       PROVINCE_DEFAULT_LOCALE[province],  // deferred → undefined today
//       COUNTRY_DEFAULT_LOCALE[country],    // ES → es-ES
//       FALLBACK_LOCALE ]                   // en-GB (the floor)

// The active UI language for a given person. Client- and server-usable.
// resolveActiveLocale(personLocale, venueLocale) -> a SUPPORTED code
//   personLocale if set & supported, else venueLocale (already supported)
```

- **Server** computes the venue default once from config + `tenant.country` + `location.province`
  and hands it to both apps (`venueLocale`, below). Because it always resolves to a supported code,
  the apps never receive `ca-ES`.
- **Till UI:** `resolveActiveLocale(person.locale, venueLocale)`. Pre-login and on logout →
  `venueLocale` (so the lock screen is the venue's language).
- **Dashboard UI:** `resolveActiveLocale(person.locale, venueLocale)` — same venue default, now
  exposed to the dashboard.
- **Receipt / `invoiceLocale` (till):** **unchanged and untouched.** Still sourced from the venue's
  fiscal `invoiceLocales` / `cfg.invoiceLocales` exactly as today — the new UI venue-default
  derivation is a *display* value and is not an input to the receipt. A test pins this (decision 2).

English is the absolute floor, but a Spanish venue still shows Spanish for a no-preference person,
because the **country** step (`ES → es-ES`) sits above the floor. English is reached only when
neither province nor country yields an available language (a venue in an unsupported-language
country), or when a person's own supported choice is `en-GB`.

## Identity verb

One verb in `packages/identity`, called by both server surfaces:

```ts
setPersonLocale(tx, { tenantId, personId, locale }): Promise<void>
```

- Validates `locale ∈ SUPPORTED_LOCALE_CODES`, throwing a new domain error **`locale.unsupported`**
  otherwise (§ Error handling).
- Updates only the row for `personId` under RLS (tenant-scoped; the caller always passes the
  **session's** `personId`, never a value from the request body).

Reads piggy-back on existing session resolution:

- Dashboard: extend `resolveManagementSession` (or its caller) so `session/me` can return `locale`
  alongside `personId` and `role`.
- Till: the login path (`loginWithPin` / `verifyPersonCredential`) returns the person's `locale` so
  `POST /api/session` can include it.

## Server API

| Surface   | Route                                   | Session gate        | Purpose                        |
| --------- | --------------------------------------- | ------------------- | ------------------------------ |
| Dashboard | `GET /management-api/session/me`        | management session  | add `locale` + `venueLocale`   |
| Dashboard | `PUT /management-api/session/me/locale` | management session  | set own locale (role-blind)    |
| Till      | `POST /api/session` (existing)          | —                   | add `locale` to login response |
| Till      | `PUT /api/session/locale`               | till shift session  | set own locale                 |

Plus a **public** list endpoint on each app — `GET /api/locales` (till) and
`GET /management-api/locales` (dashboard):

- Each returns `{ locales: SUPPORTED_LOCALES, venueDefault }` — the available list **and** the
  server-computed venue default. **Public** (no session gate) so the login screen can, before any
  session exists (like `GET /api/till`), both seed its language to `venueDefault` and populate the
  picker. This is the one source of truth the pickers read — they do not bundle the list. (The till
  also already receives `venueDefault` via `GET /api/till`'s `locale` field.)
- **`venueLocale`** is the server-computed venue default (`resolveVenueLocale`), **not** raw
  `cfg.locale`. The till already receives it via `GET /api/till` (the `locale` field there becomes
  this derived value); the dashboard now receives it on `session/me`.

Rules that hold for both write routes:

- **Identity comes from the session, never the body** — the established pattern in `me-api.ts` ("a
  staff member acts only as themselves"). The body carries `{ locale }` and nothing identifying.
- **Role-blind.** Any logged-in person may set *their own* language, including a `staff`-role person
  (who holds an empty permission set), so no `authorize`/`authorizeManager` gate.
- Both call the single `setPersonLocale` verb.

## Front-ends

Both apps' `catalogues` maps gain an explicit `"en-GB": en` entry (they already carry `en`, `es`,
`"es-ES": es`). English then resolves *directly* for the `en-GB` code rather than only through
`t()`'s English gap-fill — matching the intent already documented on those maps.

### Live re-render (the main risk)

`t()` reads a module-global locale, and today it is set once before first paint, so no live switch
exists yet. A self-service switcher must repaint the whole tree the moment the locale changes.

The codebase already has the idiom: `StoreChangeController`
(`apps/till/src/state/store-controller.ts`) is a Lit `ReactiveController` that subscribes to a store
and calls `host.requestUpdate()`. Mirror it:

- `setLocale(code)` becomes **set + notify** — it updates the module-global and emits a
  locale-changed event on a tiny in-module emitter.
- A `LocaleChangeController(host)` subscribes on connect and `host.requestUpdate()`s on change; any
  `t()`-rendering component that would not otherwise repaint on a locale switch adds one line in its
  constructor.
- The root app (`till-app`, `dashboard-app`) additionally re-derives any locale-dependent state.

**Proven by test, not assertion:** a test switches the locale at runtime and asserts a *deep child's*
rendered text changed (e.g. the basket total label). If it does not repaint, the mechanism is wrong.

### The chooser widget

One small chooser widget per app (`apps/till/src/widgets/`, `apps/dashboard/src/widgets/`), reused in
two places within its app — the login screen and the post-login chrome. It is a **link/button
trigger** (a globe or the current language name), **not a list rendered on every screen**:

- Collapsed by default — it shows only the current language, so it costs nothing on pages that never
  open it.
- **On click it fetches the list** from `GET …/locales` (the server's source of truth) and shows the
  options as a menu; the response is cached after the first open, so repeat opens don't re-fetch.
- Picking an option **emits a `locale-selected` event with the chosen code — the widget itself calls
  neither `setLocale` nor the write API.** The parent decides what the selection means:
  - **Login screen (pre-auth):** `setLocale(code)` only — a transient switch, nothing persisted.
  - **Post-login chrome:** `PUT …/locale`; on a 2xx, `setLocale(code)`. A failure surfaces an error
    and leaves the language unchanged.

Kept per-app (not a shared `packages/ui` primitive) because each app already owns a separate i18n
layer (`strings.ts`/`t.ts`) and the widget marks the active option from that app's `currentLocale()`;
a shared component would have to be handed both, for little saving.

### Till

- Boot: keep `setLocale(venueDefault)` before login (lock screen in the venue's language).
- **Lock screen (`till-lock-screen`):** the chooser widget, transient — on `locale-selected`,
  `setLocale(code)` only. It lets the operator read the PIN screen in their language.
- On login success: `setLocale(resolveActiveLocale(session.locale, venueDefault))` — this supersedes
  any transient lock-screen choice with the person's stored preference.
- On logout: revert to `setLocale(venueDefault)` so the next operator starts in the venue's language.
- Post-login switcher: the same chooser widget in the operator chrome near logout — on
  `locale-selected` it calls `PUT /api/session/locale` and, **only on a 2xx**, `setLocale(code)`.

### Dashboard

- Boot: before the session probe resolves, the shell shows the login screen, which fetches
  `GET /management-api/locales` and seeds `setLocale(venueDefault)` — so the pre-auth screen is in the
  venue's language, not a hard-coded one.
- **Login screen (`dashboard-login-screen`):** the chooser widget, transient — `setLocale(code)`
  only, so the roster/password screen can be read in the reader's language.
- `#applyMe` (boot probe and post-login) calls
  `setLocale(resolveActiveLocale(me.locale, me.venueLocale))` — superseding any transient login-screen
  choice with the person's stored preference.
- Post-login switcher: the same chooser widget in the shell `<header>` (shared logged-in chrome),
  POST-then-`setLocale`-on-success against `PUT /management-api/session/me/locale`.

## Error handling

- New error code **`locale.unsupported`** → HTTP 400. Domain-named per the house rule (name the
  concept, not the package — `packages/shared/src/errors.ts`), registered there and imported by every
  file that throws it. Never `identity.*`/`server.*`.
- The switcher changes the on-screen language only after the server accepts the change, so a rejected
  or failed request never leaves the UI in a language the server did not store.
- Auth failures reuse existing session codes (`management_session.*` / the till session codes).

## Testing (TDD)

- **identity** (`setPersonLocale`): unsupported locale rejected with `locale.unsupported`; a
  supported one updates only the caller's own row; RLS scoping proven on **real Postgres** as
  `app_user` (a cross-tenant/other-person update writes nothing).
- **migration:** `persons.locale` exists and `app_user` can `UPDATE` it — real Postgres.
- **server:** `session/me` returns `locale` + `venueLocale`; both write routes persist, validate, are
  role-blind, and take identity from the session (a body `personId` is ignored); the till login
  response carries `locale`; the **public `GET …/locales`** returns the list + `venueDefault` and
  needs no session.
- **resolution:** `resolveVenueLocale` derives `province → country → English`, always returning a
  **supported** code — `ES → es-ES`; an unknown country → `en-GB`; a Cataluña venue (province set,
  `ca-ES` unavailable) → `es-ES` (Spanish, via country — **not** English); an unsupported/absent
  config override is ignored. `resolveActiveLocale` returns the person's supported choice, else the
  (already-supported) venue default. Neither ever returns an unsupported code.
- **front-ends:** the chooser widget emits `locale-selected` and does not itself call `setLocale`/the
  API (parent-decides); it **fetches the list from `…/locales` on open and caches it** (no per-page
  population); the post-login switcher POSTs then repaints the tree live (deep-child assertion above);
  the **login screen fetches `…/locales`, seeds `venueDefault`, and its chooser switches transiently —
  `setLocale` only, no write — and repaints**; a **stored preference applied on login supersedes a
  transient login-screen choice**; the fallback chain applies at boot/login; logout reverts the till
  to the venue default; **a receipt test proves `invoiceLocale` stays the venue's locale when the
  operator's UI locale differs** (decision 2).
- **guards:** `english-only` (locale codes are English identifiers — expected pass); errors
  reachability for `locale.unsupported`.

Prove each new guard/branch by deletion where practical (remove the check, watch the test fail,
restore).

## Out of scope (YAGNI)

- No new translations beyond the existing `en`/`es` catalogues.
- No province → language map (deferred; the `province` column is the hook). The `country → language`
  step **is** built (decision 5) — today one entry, `ES → es-ES`.
- No admin-managed language defaults; no per-device (localStorage) preference — it would be
  per-browser, wrong for a shared till. This includes the **login-screen** chooser: it does not
  remember the last-used language on the device; each cold load starts from the venue default.
  (A per-device "remember on this login screen" is a possible later nicety, deliberately not built.)
- No DB-backed, dashboard-editable venue-default-locale setting. The venue default is *derived*
  (`province → country → English`), with `WAITRON_TILL_LOCALE` as an optional explicit override; the
  dashboard only *reads* the result. (A stored, editable venue locale is a natural later step for the
  multi-tenant hosted mode, where an env-per-venue override does not apply.)

## Provenance (facts this design rests on, verified in-tree on 2026-08-26)

- Table-level app_user grant on `persons`: `packages/identity/drizzle/0001_identity_rls.sql:20`.
- Persons schema (mutable, RLS): `packages/identity/src/schema/persons.ts`.
- Till login route + response shape: `apps/server/src/till-api.ts:361`; no session-restore route
  (only `POST`/`DELETE /api/session`).
- Dashboard whoami: `apps/server/src/me-api.ts:94`; consumed in
  `apps/dashboard/src/dashboard-app.ts` `#applyMe`.
- `t()` English fallback + `setLocale`: `apps/{till,dashboard}/src/i18n/t.ts`.
- Venue default source: `apps/server/src/till-config.ts:127`; exposed to the till at
  `apps/server/src/till-api.ts:494`.
- Tenant `country` column (feeds the country → language step): `packages/db/src/schema/tenants.ts:51`.
- Location `province` / `invoiceLocales` columns: `packages/db/src/schema/tenants.ts:97,104`.
- Reactive-controller idiom to mirror: `apps/till/src/state/store-controller.ts`.
