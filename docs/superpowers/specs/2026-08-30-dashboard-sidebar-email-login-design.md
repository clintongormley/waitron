# Dashboard grouped sidebar + email/password login — design (demo Tier A #2)

Status: approved for planning (2026-08-30).

## 1. Motivation

Backlog **Tier A #2 — Admin-site professionalization**. Two coupled halves the owner flagged:

- **(a) Grouped sidebar.** The dashboard nav is a **flat row of 16 text buttons** rendered by
  `apps/dashboard/src/dashboard-app.ts` `#nav()` (verified: sixteen `wt-button`s, one per `Screen`,
  driven by `this.screen`). It overflows and does not scale as admin screens land. Replace it with a
  grouped **sidebar** — also the structural enabler for every later admin screen.
- **(b) Email + password login.** The login screen (`apps/dashboard/src/screens/login-screen.ts`)
  fetches a **pre-authentication roster** and renders a `<select>` of every person's display name,
  then calls `api.login({ personId, password, totp })`. The owner flagged the dropdown as wrong (and
  it leaks the staff list before login). Replace it with an **email field**. Password auth already
  exists; persons have **no `email` column** today (verified against
  `packages/identity/src/schema/persons.ts`).

Both are demo-facing polish, no new fiscal surface.

## 2. Decisions (locked with owner, 2026-08-30)

1. **Sidebar behaviour: static grouped.** All groups and items are always visible under section
   headers; the panel scrolls if tall. Not an accordion. On narrow screens it becomes an off-canvas
   drawer toggled by a hamburger.
2. **Text-only, no new primitive.** No icon set is registered in the dashboard (the current nav is
   text-only `wt-button`s), so the sidebar is app-level markup built from existing `wt-*` primitives
   and `--wt-*` tokens. Icons are out of scope.
3. **Email is managed in the Users form now** (not seed/CLI only), and the demo seed sets emails so
   email login is demoable end to end.
4. **Login enumeration hardening.** On the now-public login form, an **unknown email and a wrong
   password both throw `password.invalid`** — a deliberate change from today's `person.not_found`
   (404) on the personId path. (Suspended still `person.suspended`; bad TOTP still `totp.invalid`.)
5. **Password reset stays admin-managed.** `setPassword` + `POST /management-api/staff/:id/password`
   + the Users-form control already exist and are unchanged. **Self-service "forgot password" (email
   a reset link) is out of scope** — the on-prem box has no mail transport, and self-service email
   flows are gated on Waitron-cloud infra that does not exist yet (backlog). Adding `email` does not
   touch any credential-reset path.

## 3. Part (a) — grouped sidebar

### 3.1 Grouping (real nav labels from `i18n/strings.ts`)

| Group (new i18n key) | Screens (existing `Screen` values → labels) |
| --- | --- |
| _(pinned, no header)_ | `overview` → Overview · `sales` → Sales & takings |
| `nav.group.menu` — Menu | `catalogue` → Menu · `recipe` → Recipes |
| `nav.group.service` — Service | `floor` → Floor plan · `statuses` → Statuses · `kitchen` → Kitchen |
| `nav.group.team` — Team | `staff` → Users · `roster` → Shifts · `approvals` → Approvals · `planned-actual` → Planned vs actual |
| `nav.group.purchasing` — Purchasing | `purchases` → Purchases |
| `nav.group.configuration` — Configuration | `layout` → Layout · `receipt` → Receipt · `devices` → Devices · `printers` → Printers |

Grouping is data, easy to re-order later. `my-schedule` is the `staff`-role self-service screen and
is **not** in the manager sidebar (that role gets no nav, unchanged).

### 3.2 Shell restructure

`dashboard-app.ts` `render()` changes from `header(nav + actions)` + `body` to a two-column layout:

```
<div class="layout">
  <aside class="sidebar">
    <nav aria-label="{nav.sections}"> …grouped items… </nav>
  </aside>
  <div class="main">
    <header class="topbar"> hamburger(mobile) · language-chooser · logout </header>
    <div class="body"> {keyed(currentLocale(), #renderScreen())} </div>
  </div>
</div>
```

- The nav is **data-driven**: a module-level `NAV_GROUPS` array of `{ headerKey?: string; items:
  { screen: Screen; labelKey: string; testId: string }[] }`. `#nav()` renders it in a loop, replacing
  the sixteen hand-written buttons.
- **Active item**: the item whose `screen === this.screen` renders `variant="primary"` +
  `aria-current="page"`; the rest `variant="secondary"`. Every existing `data-test="nav-<screen>"`
  id is preserved verbatim so current tests keep asserting the same behaviour.
- **Responsive**: at/below a token-driven breakpoint the sidebar is `position: fixed` off-canvas; a
  hamburger `wt-button` in the topbar toggles an `open` state, and a scrim (`--wt-color-scrim`)
  behind it closes it on click. Selecting an item closes the drawer. The desktop layout keeps the
  sidebar in-flow. (Breakpoint value lives in a token/const, no hardcoded chrome.)
- `staff`-role sessions keep the no-nav branch (self-service only).

### 3.3 Styling

All spacing/colour/radius via `--wt-*` tokens per the design system (no hardcoded chrome). No new
`wt-*` primitive; this is app-level layout. Section headers use `--wt-color-text-muted` +
`--wt-font-size-sm`.

## 4. Part (b) — email/password login

### 4.1 Schema + migration

- Add nullable `email text` to `persons` (`packages/identity/src/schema/persons.ts`).
- **Uniqueness**: a **partial functional unique index**
  `create unique index persons_tenant_email_uq on persons (tenant_id, lower(email)) where email is not null;`
  — case-insensitive, per-tenant, multiple `NULL`s allowed (staff who log in only at the till via PIN
  need no email).
- Generated via `drizzle-kit generate` / `generate:custom` (the functional index is hand-written in a
  custom migration, as `.enableRLS()`-style extras are). **Do not hand-edit snapshots** — follow the
  migration-rebase memory: reset `drizzle/` to main if a number collides, keep the schema TS, re-run
  `db:generate` / `db:generate:custom`.
- **No new grant** — `persons` already grants `app_user` SELECT/INSERT/UPDATE (0001_identity_rls.sql)
  and PostgreSQL table grants cover future columns; RLS/FORCE/policy are table-level and unchanged.
- **No backfill** (pre-production, nullable column).
- After the migration, run `pnpm --filter @waitron/fiscal-verifactu test inmutabilidad` (house rule:
  the fiscal guard scans every `tenant_id` table; a persons change must keep it green).

### 4.2 identity — login by email + validation

- **`normalizeEmail(raw)`** (trim + lowercase) and **`isValidEmail(raw)`** helpers (new small module,
  or added beside `staff.ts`). Email shape validated only at the **write** boundary.
- **`loginManager`** (`packages/identity/src/manager-login.ts`) signature changes from
  `{ tenantId, personId, password, totp }` to `{ tenantId, email, password, totp }`. Lookup:
  `where tenantId = … and lower(email) = normalizeEmail(input.email)`.

  > **Correction (2026-08-30, during implementation).** This bullet originally asserted that the server
  > session route "is the **only caller** of its old shape (verified — the till uses `loginWithPin`)".
  > That was **false**: `loginManager` had a SECOND production caller, `apps/server/src/mirror-bundle-api.ts`
  > (the C2b mirror-bundle admin, seeded emailless), which that "verification" never looked at — a §1
  > unchecked-"only" claim. The implementation therefore added an id-based sibling **`loginManagerById`**
  > (sharing `completeManagerLogin`) for that path; the mirror admin keeps authenticating by id. See the
  > backlog follow-up on whether `venue` should gain an `--admin-email`.

  - not found **or** wrong password → `password.invalid` (no enumeration);
  - suspended → `person.suspended`; TOTP enrolled and missing/wrong → `totp.invalid`.
- **Person mutators** (`packages/identity/src/staff.ts`). There is **no generic `updatePerson`** in
  identity — person edits are field-specific mutators (`createPerson`, `setRole`, `resetPin`,
  `setPassword`, `suspendPerson`, `reactivatePerson`, `setPersonLocale`), each gated on
  `person.manage`. Follow that pattern for email:
  - `createPerson` gains an optional `email` param;
  - a new **`setEmail(tx, { managementSessionId, personId, email })`** mutator (parallel to
    `setPassword`), `person.manage`-gated;
  - both run `normalizeEmail` → `isValidEmail` (else `person.email_invalid`) → write, mapping a
    unique-violation to **`person.email_taken`**.
- **New error codes** (domain-named, existing `person.*` namespace):
  `person.email_invalid`, `person.email_taken`. Registered in identity's `errors.ts`. Grep siblings
  to match the `person.*` spelling exactly before adding.

### 4.3 server — route + comment updates

- `POST /management-api/session` (`apps/server/src/management-api.ts`): body becomes
  `{ email?: string; password?: string; totp?: string }`. Screen `email` as a non-empty string
  (format is validated at write-time, not login-time; an unparseable email simply fails the lookup →
  `password.invalid`). Remove the `personId` UUID screening.
- **Update the stale comments** around this route (lines ~150–181, ~446–476, ~162–168) that describe
  the personId behaviour ("an unknown `personId` surfaces 404 and a suspended one 403", the
  `staff-roster` picker rationale). Editing this file is not auditing it (house rule) — audit the
  whole route block.
- Staff create/update routes (`POST /management-api/staff`, `PATCH /management-api/staff/:id`) accept
  `email` and forward it to `createPerson`/`updatePerson`.
- `GET /management-api/staff-roster` **stays** (the till login may use it); only the dashboard stops
  calling it.

### 4.4 dashboard — login screen + Users form + client

- **`api.login`** type → `{ email, password, totp? }`; drop `getStaffRoster` from the login path.
- **`login-screen.ts`**: remove the roster `<select>`, `#loadRoster`, `#rosterSelect`, the `updated()`
  reconcile, and the `RosterEntry` import; add an email `wt-input` (`type="email"`, label
  `login.email`). `#submit` sends `{ email, password, totp }`. Password, optional TOTP, and passkey
  login are untouched.
- **Client methods** (`api/client.ts`): `createPerson(input)` gains `email?`; the edit path carries
  `email?` — extend the existing `PATCH /management-api/staff/:id` (`updatePerson(id, patch)`, today
  `{ role?, status? }`) to `{ role?, status?, email? }`, the server calling `setEmail` when `email`
  is present (no new subroute). `PersonSummary` gains `email`. (These are inline object types, not
  named `PersonInput`/`PersonPatch` types.)
- **Users form** (`staff-screen.ts` + its create/edit form widget): add an **email** field to create
  and edit; group email + password visually as the "dashboard sign-in" credentials (PIN stays the
  till credential). `person.email_invalid` / `person.email_taken` render in the existing
  `role="alert"` banner via `codeMessage`.

### 4.5 seed + i18n

- **Demo seed** (`apps/server/scripts/demo-seed/seed.ts`): set `email` on the manager/admin persons
  (e.g. `owner@<demo-domain>`), so email login works in the demo.
- **i18n** (`apps/dashboard/src/i18n/strings.ts` + locale files): add `nav.group.menu`,
  `nav.group.service`, `nav.group.team`, `nav.group.purchasing`, `nav.group.configuration`;
  `login.email`; `person.email` (Users-form label); and the copy for `person.email_invalid` /
  `person.email_taken` in `i18n/codes`.

## 5. Error handling

| Condition | Code | Where |
| --- | --- | --- |
| Login: unknown email or wrong password | `password.invalid` (401) | `loginManager` |
| Login: suspended person | `person.suspended` (403) | `loginManager` |
| Login: TOTP enrolled, missing/wrong | `totp.invalid` (401) | `loginManager` |
| Users form: malformed email | `person.email_invalid` (400) | `createPerson`/`setEmail` |
| Users form: duplicate email in tenant | `person.email_taken` (409) | unique-violation map |

All surface through the existing `codeMessage`-at-the-render-edge banner pattern.

## 6. Testing (TDD — failing test first each time)

- **db (real Postgres)**: `persons_tenant_email_uq` — same email (differing only in case) rejected
  within one tenant, allowed across tenants, multiple `NULL`s allowed. Real PG (uniqueness under the
  deployment role), not PGlite.
- **identity**: `loginManager` by email — found; case-insensitive match; unknown email →
  `password.invalid`; wrong password → `password.invalid`; suspended → `person.suspended`; TOTP
  paths. `createPerson`/`setEmail` — valid email stored normalized; malformed → `email_invalid`;
  duplicate → `email_taken`. The two new codes are declared in identity's `errors.ts` augmentation
  (`scripts/errors-reachable.test.ts` keeps that file barrel-reachable; it does not assert per-code —
  the unit tests above are what exercise each code).
- **server**: `POST /management-api/session` with `{email,…}` (success + the `password.invalid`
  collapse); staff create/update carrying `email`.
- **dashboard**: grouped sidebar renders every group + all 16 `nav-<screen>` ids, click switches
  `screen`, active `aria-current`, hamburger opens/closes the drawer and scrim; axe a11y on the nav.
  Login screen: email field present, `#submit` payload is `{email,password,totp}`, no roster fetch.
  Update `dashboard-app.test.ts` / `login-screen.test.ts` **preserving their behavioural assertions**
  (rewrite setup, not the assertions).

## 7. Out of scope

- Self-service password reset / email delivery (cloud-era, no mail transport).
- Icons in the sidebar; accordion/collapsible behaviour.
- Till-side roster picker (unchanged); the `staff-roster` route (kept).
- Definable roles / RBAC editor (separate backlog item).

## 8. Risks / notes

- **Migration numbering collision** if main advances — regenerate, never hand-edit snapshots
  (memory: `drizzle-migration-rebase-collision`).
- **Enumeration change** alters an existing tested behaviour on the session route — the personId-era
  assertions and comments must be updated, not left standing (§4.3).
- **CI scope**: this touches `packages/db`, `packages/identity`, `apps/server`, `apps/dashboard` — run
  the whole workspace before the PR (a scoped green is evidence only about packages that ran), and the
  fiscal `inmutabilidad` guard explicitly (§4.1).
