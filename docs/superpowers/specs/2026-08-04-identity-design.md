# Identity — users, roles, permissions (sub-project 5), first slice

**Date:** 2026-08-04
**Status:** design, awaiting review
**Sub-project:** 5 (Identity) — the till-track unblocker after Locations (#57), before Counter POS (#7)

Companion: [pos-architecture-design.md](2026-07-18-pos-architecture-design.md) §2 (row 5), and the
backlog's *Not started* row for #5.

---

## 1. Why this exists, and why now

The architecture makes Identity a **launch requirement**, not a later nicety, for one reason
(`2026-07-18-pos-architecture-design.md:128-129`):

> **Identity is required at launch** because roles gate refunds, voids, discounts and rectificative
> records. Those are exactly the operations that need supervisor authority on day one.

Today none of those operations is gated. The tree carries deliberate, documented **seams** waiting
for this work — `sale_voids.voided_by` is a nullable, currently-unwritten column tagged "The seam
for sub-project 5" (`packages/db/src/schema/sale-voids.ts:45-47`), and `recordVoid`
"[d]eliberately takes no actor argument and performs no authorisation check … a half-built check
here would look like security while enforcing nothing" (`packages/core/src/record-void.ts:24-28`).
This slice is the moment those seams get filled.

A minimal **`persons` stub already exists**, built inside `packages/workforce` explicitly so that #5
could absorb it: `id, tenant_id, display_name, pin_hash, role` (enum `staff/supervisor/manager/admin`),
`status` (`active/suspended`), plus `hashPin`/`verifyPin` (scrypt). Its own header pre-declares the
move — "relocating it to a future `packages/identity` is a free rename pre-production"
(`packages/workforce/src/schema/persons.ts:29-38`). No app-level authentication, session, or login
mechanism exists anywhere else; `apps/server` serves a single unauthenticated `/health` route.

### Decisions taken with the owner (2026-08-04)

These five choices set the shape and are not re-litigated below:

1. **Authorization model: shift login + supervisor override.** A cashier signs in for a shift
   (a session, used for sale attribution and baseline permissions), and privileged actions above the
   cashier's level are authorized by a supervisor **override** at the moment of the action.
2. **Slice boundary: headless core + wire the seams.** Build the identity model, PIN login, sessions,
   and `authorize()` as a headless, fully-tested package, **and** wire the existing fiscal seams so
   the privileged writes require and record an authorizer. No UI, no HTTP endpoints — the Counter POS
   (#7) consumes this later, the way daily-close reporting (#56) shipped headless ahead of its UI.
3. **RBAC shape: fixed roles, code-defined permission bundles.** An explicit permission catalog and a
   fixed role→permission map, both in code. Call sites gate on a **permission**, never a role string.
   Pre-production, so growing to data-driven/editable roles later is free.
4. **Placement: `packages/identity` owns `persons`.** Relocate `persons` (+ its enums) and
   `verifyPin`/`hashPin` out of `packages/workforce`; `workforce` and `core` then depend on
   `identity`. Layering becomes `db < identity < workforce/core`.
5. **Edges: invitations deferred, admin seeded via the provisioning CLI.** No invitation/onboarding
   flow this slice (no delivery channel or UI exists without the till). `waitron-provision venue`
   seeds an initial admin person so a fresh venue has someone who can log in.

---

## 2. Scope and non-goals

**In scope (headless, provable by tests today):**

- A new `@waitron/identity` package: relocated `persons` + enums + PIN hashing; a new `sessions`
  table; the permission catalog + role map; `authorize()`; `loginWithPin`/`endSession`; and the
  headless staff-admin API (`createPerson`/`setRole`/`resetPin`/`suspendPerson`).
- Rewiring `packages/workforce` to import the relocated symbols; relocating the `persons` DDL/RLS
  migrations; ordering the migration manifest `identity` before `workforce`.
- Wiring the privileged write paths that **exist today**: `recordVoid` and `recordCorrection` gain a
  required authorization and record the authorizer.
- Adding the **seam** columns and optional parameters for the paths whose human call site is #7:
  `payment_refunds.authorized_by` (refund) and `sales.operator_id` (sale attribution).
- Seeding an initial admin person from `waitron-provision venue`.

**Out of scope (deferred, with the reason):**

- **Any UI or HTTP transport.** The till (#7) builds the login screen, the supervisor-override
  prompt, and whatever session transport the client needs. Building transport now would be building
  it against a client that does not exist.
- **Invitations / onboarding.** Named in #5's charter but needs a delivery channel and a UI; rides
  with #7.
- **The discount gate.** There is **no discount write path in the tree** — a repo-wide grep for
  `discount`/`descuento`/`allowance` across `packages/*/src` returns only workforce's unrelated
  "annual-jornada allowance" comment (`packages/workforce/src/projection.ts:21`). A discount is only
  ever baked into a finished sale/line total. `sale.discount` therefore enters the permission catalog
  (so the catalog is complete), but there is nothing to attach a gate to until #7 builds sale-entry.
- **Data-driven / tenant-editable roles, multi-role per person, per-employment roles.** Decision 3.
- **Consolidating workforce's own role check** (`approveCorrection`'s inline `SUPERVISOR_ROLES`,
  `packages/workforce/src/clocking.ts:117-118`) onto `authorize()`. It reads the same relocated
  `person_role`, but it throws the **shipped** error code `correction.not_permitted`, and error codes
  are never renamed once shipped (`CLAUDE.md` §3). Left as a follow-up; noted so it is not lost.
- **Enforcement that a session must exist to ring a sale.** `sales.operator_id` is a nullable seam;
  the "you must be logged in" rule is a #7 UI concern.

---

## 3. Package, layering, and the relocation

`@waitron/identity`, a generic English package (subject to the `english-only` guard — no Spanish
tokens expected in it). Barrel is re-exports only, per repo convention.

**Layering:** `db < identity < workforce/core`. `identity`'s tables depend on `db` (they carry
`tenant_id → tenants.id` and rely on `current_tenant_id()` from `db`'s tenancy migration). `workforce`
and `core` depend on `identity`.

**Relocated into `identity`:**

- `persons` table + `person_role` enum (renamed from `workforce_role`; values `staff/supervisor/
  manager/admin` unchanged) + `person_status` enum (`active/suspended`).
- `hashPin`/`verifyPin` (`packages/workforce/src/verify-pin.ts`).
- The `persons` DDL and RLS migrations (`packages/workforce/drizzle/0000_workforce.sql` creates
  `persons` + the two enums; `0001_workforce_rls.sql` is its RLS — MUTABLE: `GRANT SELECT, INSERT,
  UPDATE`, no delete, no immutability trigger). These become `identity`'s migrations.

**Stays in `packages/workforce`:** `employments` (a *labour* relationship — contract, pay rate — not
identity). It keeps its own DDL/RLS and simply FKs `persons` across a package boundary, exactly as it
already FKs `tenants` in `db`. Workforce's `approveCorrection` gate stays as-is (see §2 non-goals).

**Blast radius (verified):** every production importer of `persons`/`employments`/`verifyPin`/
`hashPin` is inside `packages/workforce` — 7 intra-package schema modules FK/import `persons`
(`absences`, `availability`, `shifts`, `time-entries`, `roster-versions`, `employments`,
`shift-swaps`), plus the two barrels and one test fixture. Nothing **outside** workforce imports these
symbols today (`workforce-es` and `migrations` touch only workforce's time/rules surface and the
`WORKFORCE_MIGRATIONS` manifest). So the move is a rename-plus-reexport whose churn is contained;
pre-production drop-and-recreate means there is no data migration.

**`persons` gets a `unique(tenant_id, id)`** added on relocation, so that tenant-consistent composite
FKs to it are possible later. The authorizer columns this slice adds do **not** use it (see §6) — they
follow the existing `voided_by` no-FK precedent — but `sessions.person_id` and `employments.person_id`
can adopt the composite shape the repo prefers.

---

## 4. Data model

### 4.1 `persons` (relocated, unchanged shape)

`id, tenant_id, display_name, pin_hash, role (person_role), status (person_status), created_at`.
Mutable (a PIN resets, a role changes, a person is suspended): tenant-isolation RLS only, `GRANT
SELECT, INSERT, UPDATE`, no DELETE, no immutability trigger. Suspension is a `status` change, never a
delete.

### 4.2 `sessions` (new)

A shift login: a person active at a physical station.

| column | type | notes |
| --- | --- | --- |
| `id` | uuid PK | |
| `tenant_id` | uuid NOT NULL → `tenants.id` restrict | |
| `person_id` | uuid NOT NULL | composite FK `(tenant_id, person_id) → persons(tenant_id, id)` |
| `till_id` | uuid NOT NULL → `tills.id` restrict | the **till**, not the node — see below |
| `opened_at` | timestamptz NOT NULL | application-supplied (`mode: "string"`, matching the repo's "nothing formatted is ever stored" discipline) |
| `ended_at` | timestamptz, nullable | stamped on `endSession` |

**Why `till_id`, not `node_id`.** The `till` is "A point of sale" — the physical station a cashier
operates and where cash-up/Z-report is grouped (`packages/db/src/schema/tenants.ts:89-117`). The
`node` is the SIF machine, one per venue, shared across the tills it serves
(`packages/fiscal-verifactu/src/schema/registros.ts:170-172` — "two tills of one node share one
sequence"). A session is a person-at-a-station for a shift, so it anchors on the till. The node is not
needed for login or attribution and is derivable at sale time; the session does not carry it.

`sessions` is **mutable** (we stamp `ended_at`): a new `tenant_id`-bearing table, so it needs
FORCE RLS + a `sessions_tenant_isolation` policy + `GRANT SELECT, INSERT, UPDATE` (no DELETE),
hand-written in a custom migration, exactly like `persons`. Because it is mutable and carries no
hash-chain, it takes tenant-isolation only, **not** the four-part immutability recipe.

### 4.3 New authorizer / attribution columns on existing tables

All are plain nullable `uuid` with **no FK**, following the existing `voided_by` precedent
(`sale_voids.voided_by` has no FK). This avoids new cross-package schema edges and sidesteps needing
a composite-unique target on `persons` for these columns.

| table (package) | column | filled by | required? |
| --- | --- | --- | --- |
| `sale_voids` (db) | `voided_by` *(exists)* | `recordVoid`, at insert | **required** authz |
| `sales` (db) | `authorized_by` *(new)* | `recordCorrection`, at insert | **required** authz (corrective rows only; null for ordinary sales) |
| `sales` (db) | `operator_id` *(new)* | `recordSale`, at insert | optional (attribution seam) |
| `payment_refunds` (payments) | `authorized_by` *(new)* | `recordRefund`, at insert | optional (seam; automated callers pass none) |

Both `sales` columns are added in one `packages/db` migration. `sales` is insert-only/immutable, so
both are supplied at insert, never back-filled — the same constraint `voided_by` has on the
append-only `sale_voids` (its migration is explicit: "sub-project 5 fills that column by supplying it
on the INSERT `recordVoid` already makes, never by a later UPDATE",
`packages/db/drizzle/0006_sale_voids.sql`). `payment_refunds` is mutable (tenant-isolation only), so
its column is additive and low-friction; by the same precedent it is still set at insert.

**The authorizer is never hashed.** For corrections the authorizer lives on the `sales` row, which
carries no huella at all — so it cannot enter the fiscal hash by construction. This deliberately keeps
the authorizer in the regime-neutral core layer and out of `packages/fiscal-verifactu`'s
`registros_facturacion`, honouring `CLAUDE.md` §5 ("Never put our own metadata into a hash") the
cleanest possible way: on a different table.

---

## 5. Permission model (in code)

An explicit catalog. Call sites always check a **permission**, so the role→permission mapping can
change in one place without touching a single call site (unlike today's `SUPERVISOR_ROLES` set inlined
in `clocking.ts`).

```text
Permission =
  | "sale.void"
  | "sale.refund"
  | "sale.discount"     // in the catalog; no call site until #7 (no discount write path today)
  | "sale.rectify"
  | "person.manage"     // create / set-role / reset-pin / suspend

ROLE_PERMISSIONS: Record<PersonRole, ReadonlySet<Permission>>
  staff       → {}
  supervisor  → { sale.void, sale.refund, sale.discount, sale.rectify }
  manager     → supervisor ∪ { person.manage }
  admin       → every permission
```

The catalog and the map are the two things a future data-driven RBAC would replace; keeping them as a
named module makes that swap local.

---

## 6. `authorize()`, sessions, and login — the core primitive

One function expresses both halves of "shift login + override":

```text
authorize(tx, { sessionId, permission, override? }) → Authorization

  1. Read the session (must be open — ended_at IS NULL — and tenant-scoped). Its person is the
     operator. If ROLE_PERMISSIONS[operator.role] has `permission`:
        → { authorizedBy: operator.id, permission, viaOverride: false }
  2. Otherwise an override is required: override = { personId, pin }.
     Verify the PIN against that active person; if ROLE_PERMISSIONS[that.role] has `permission`:
        → { authorizedBy: that.id, permission, viaOverride: true }
  3. Otherwise throw `authorization.not_permitted`.
```

`Authorization = { authorizedBy: PersonId, permission: Permission, viaOverride: boolean }` — the value
a gated write records (into `voided_by` / `authorized_by`).

**The gate is intrinsic, not a separate step a caller can forget.** A gated write **takes the raw
`{ session, override? }` and calls `authorize()` itself** with the specific permission it needs, then
records the returned `authorizedBy`. There is no way to perform the write without supplying a
credential `authorize()` accepts. This is the direct answer to the `record-void.ts` warning that a
detached check "would look like security while enforcing nothing". (Alternative considered and
rejected: have the write accept an already-resolved `Authorization`; it lets a caller fabricate one
and detaches the check from the write.)

**Login and override credentials.**

- `loginWithPin(tx, { tillId, personId, pin }) → Session` — verifies the PIN against that active
  person and opens a session. `endSession(tx, sessionId)` stamps `ended_at`.
- The UI resolves `personId` from a roster picker; `pin` confirms. Login is not PIN-alone.
- **Override takes `{ personId, pin }`, not PIN-alone.** PINs are salted-scrypt-hashed and cannot be
  uniquely looked up by value, so "type a supervisor PIN and we find who it is" is not available
  without weakening the hash or adding a uniqueness constraint the salt prevents. A PIN-only override
  prompt is a #7 UX nicety layered on top; it is not a schema or model change and is not built here.

---

## 7. Wiring the seams

| Action | Function | This slice |
| --- | --- | --- |
| **Void** | `recordVoid(tx, backend, saleId, reason, authz)` | New required `authz = { session, override? }`; calls `authorize(…, "sale.void")`; writes `voided_by = authz.authorizedBy` on the existing insert. |
| **Rectificativa** | `recordCorrection(tx, backend, input)` | `input` gains a required `authz`; calls `authorize(…, "sale.rectify")`; writes the new `sales.authorized_by` on the corrective-sale insert (`record-correction.ts:205-221`). |
| **Refund** | `recordRefund(tx, params)` / `recordFailedRefund` | `params` gains an **optional** `authorizedBy`; written to the new `payment_refunds.authorized_by`. **No enforced `authorize()` yet** — the only callers today are automated (reconcile, `manual.ts`) with no human authorizer; the human gate attaches at the till (#7). |
| **Discount** | — | Catalog only; no write path exists (§2). |
| **Attribution** | `recordSale(tx, …, operator?)` | Optional `operator` (a session or its person); written to the new `sales.operator_id`. Enforcement is #7. |

**Callers to update.** Making `recordVoid`/`recordCorrection` require `authz` means their current
callers — tests and the demo scripts (`settle-invoice-first`, `record-one-sale`, …) — must seed a
person and open a session (or supply an override). That caller update is part of this slice; it is
also the first end-to-end exercise of login → authorize → gated write.

---

## 8. Provisioning bootstrap

`waitron-provision venue` (`packages/provisioning`) plans and applies a venue as an ordered
`VenueAction[]` replayed in one transaction (`venue-apply.ts`, `venue-plan.ts`). Add a `seed-admin`
action:

- New union variant `{ kind: "seed-admin"; displayName: string; pinHash: string }`, emitted by
  `planVenue` after `ensure-tenant` (a person needs only the tenant), described by
  `describeVenueAction`, and applied by an `insert into persons` case in `applyVenue`.
- The CLI `venue` command parses two new request fields (admin display name + initial PIN), hashes the
  PIN via the relocated `hashPin`, and passes them through. The whole apply stays one transaction.
- This introduces a `provisioning → identity` dependency (provisioning does not import `persons`
  today). That is the correct direction and expected.

Result: a freshly provisioned venue has exactly one **admin** person who can `loginWithPin` and, being
admin, authorize every gated action — including creating the rest of the staff via the staff-admin API.

---

## 9. Staff-admin API (headless)

The operations a #7 admin screen calls. All operate within a tenant transaction and, when invoked
with an operator session, require `person.manage` via `authorize()`:

- `createPerson(tx, { session, displayName, role, pin }) → Person`
- `setRole(tx, { session, personId, role })`
- `resetPin(tx, { session, personId, pin })`
- `suspendPerson(tx, { session, personId })` / `reactivatePerson(tx, { session, personId })` (status
  change, never delete)

**Bootstrap.** The provisioning `seed-admin` path (§8) does **not** go through this gated API — it
inserts the first admin person directly in `applyVenue`, which is what resolves the chicken-and-egg
(there is no admin to authorize the creation of the first admin). Every subsequent person is created
through the gated API by that admin (or another manager+).

A minimum PIN policy (length) is enforced at `hashPin`/set time; the exact rule is finalized in the
plan.

---

## 10. Error codes

Concept-named, never package-named (`CLAUDE.md` §3; e.g. `series.not_found`, and workforce's own
`correction.not_permitted`). Proposed set, finalized against `packages/shared/src/errors.ts` (and its
per-package registries) with a sibling grep during the plan:

- `authorization.not_permitted` — neither operator nor override holds the permission.
- `pin.invalid` — PIN verification failed (login or override).
- `pin.too_short` — set-PIN below the minimum length.
- `session.not_open` — the session id is unknown, ended, or another tenant's.
- `person.not_found` / `person.suspended` — login/override against a missing or suspended person.

Every file that throws a code imports its registry directly (`import "./errors.js"`).

---

## 11. Tenancy, guards, and testing

- **`sessions` is a new `tenant_id`-bearing table** ⇒ FORCE RLS + tenant-isolation policy + grants in
  a hand-written custom migration. After adding it, run
  `pnpm --filter @waitron/fiscal-verifactu test inmutabilidad` — that suite scans **every** table in
  the database with a `tenant_id` column (keyed on the column, not the package), so a missing FORCE on
  `sessions` shows up there even though it lives in `identity` (`CLAUDE.md` §3).
- **Targets.** `authorize()` (operator-holds / override-succeeds / denied), login and PIN verify, the
  staff-admin API, and the gated writes are provable on **PGlite** (hermetic, fast). RLS behaviour as
  the non-superuser `app_user` (a session/person of one tenant invisible to another) and any
  concurrency (e.g. two logins racing a session) go on **real Postgres** via `describeEachTarget`,
  with a one-line justification in each suite (`CLAUDE.md` §4).
- **Prove each gate by deletion** (`CLAUDE.md` §4): remove the `authorize()` call in `recordVoid`,
  confirm the void-without-permission test fails, restore it. Same for `recordCorrection`.
- **Relocation is behaviour-preserving.** Workforce's existing suites must stay green after the move;
  update imports/fixtures, do not rewrite assertions to match new code (global instruction).
- **Coverage** thresholds are the package default (98/98/98/95).

---

## 12. Migrations touched (one branch, distinct packages)

This slice adds/moves migrations in several packages on one branch (the per-package journal-conflict
rule only bites **concurrent** branches):

- `identity` (new) — `persons` DDL + enums + RLS (relocated), and the new `sessions` table + RLS.
- `workforce` — remove the `persons`/enum DDL that moved out; keep `employments` and its RLS (its FK
  now targets a table created by `identity`'s migration).
- `db` — add `sales.authorized_by` and `sales.operator_id` (one migration).
- `payments` — add `payment_refunds.authorized_by` (one migration).
- `migrations` manifest — order `identity` before `workforce` (and before anything FKing `persons`).

Pre-production, so all of this is drop-and-recreate with no data step.

---

## 13. Open questions and follow-ups (non-blocking)

- **Consolidate workforce's `approveCorrection` gate onto `authorize()`** — deferred because it would
  change the shipped `correction.not_permitted` code. Do it when a permission like
  `workforce.correction.approve` can be introduced without renaming the code (e.g. add the new code
  beside the old, deprecate the old).
- **PIN-only supervisor override** (type a PIN, resolve the person) — a #7 UX nicety; needs either a
  deterministic keyed hash or a uniqueness scheme the salt currently prevents. Not built here.
- **The discount gate** attaches when #7 builds a discount write path.
- **Session lifecycle policy** — expiry/idle timeout, one-open-session-per-till — is a #7 concern; the
  model here supports it (a session has `opened_at`/`ended_at`) but enforces no policy beyond
  "open vs ended".
- **`sales.operator_id`/`payment_refunds.authorized_by` enforcement** — the "must be logged in"
  and "till refunds must be authorized" rules land with #7's human call sites.
