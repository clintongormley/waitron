# Drop the tenant id from every table and write path — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove the `tenant_id` column, its foreign keys and every query clause that references it from the whole codebase, and reduce `tenants` to a single-row taxpayer record enforced by a database constraint.

**Architecture:** The tenant value flows through the code in one direction: a config or a row shape carries a `tenantId`, that field feeds a database insert, and the insert writes the `tenant_id` column. You cannot cut anywhere in that chain and leave the rest — so the plan cuts it as a chain. Phase A removes only the *read* side (the `where tenant_id = …` filters), which is behaviour-neutral under one tenant and compiles while everything else stands. Phase B then takes each migration set and, in one commit, drops that set's columns AND rewrites every writer of them: the drizzle inserts, the upsert conflict targets, the shape fields that feed them, and the fixtures — because a dropped column breaks its writers at compile time and its inserts at runtime, so they must all move together. Phase C deletes the now-unused `TenantId` brand and locks the change in with a guard and rule updates.

**Tech Stack:** TypeScript, drizzle-orm + drizzle-kit (`0.31.x`, one config and one migration folder per package), Vitest, PGlite and Testcontainers (real PostgreSQL 18), pnpm workspaces.

**Spec:** `docs/superpowers/specs/2026-09-14-drop-tenant-id-design.md` — read it first; this plan argues from it.

## Global Constraints

- **One tenant per database, always** (owner 2026-09-05). No database anywhere holds two tenants, the preproduction trial demo included. Nothing in this plan adds support for a shared database.
- **Pre-production: schema changes drop and recreate; no data-migration or backwards-compat code** (`CLAUDE.md` §3). There is no deployed database to preserve. A re-run of provisioning is the only "existing data" case, handled explicitly in Task B8.
- **Never hand-edit drizzle snapshots or `_journal.json`; regenerate** (`CLAUDE.md` §3). `scripts/journal-monotonic.test.ts` must stay green.
- **Migrations here are virgin-DB-only for every module set except `core`, which has an upgrade test.** Regenerating a baseline is therefore legitimate; do not add ALTER-to-preserve steps.
- **Never build SQL by string concatenation** except utility statements, which must escape or validate (`CLAUDE.md` §3). All the raw SQL edited here uses drizzle's `sql` tagged template, which parameterises — keep it that way.
- **Grants are read back, not trusted by exit code** (`CLAUDE.md` §3): an object-privilege GRANT that partially applies WARNs and exits 0. Verify ACLs by running the grant assertion suites, as `app_user` with `rolsuper = f`.
- **A grant assertion must call `asAppUser(tx)` before the query under test** or it runs as owner and asserts nothing (`CLAUDE.md` §4).
- **Plain English in commit messages and PR text** (owner 2026-09-11). Exact file/function/column names appear once as pointers; commands run go in verbatim.
- **Every commit is `git commit -s`.** Feature work is in the worktree created for this branch.
- **This diff touches migrations, grants and a cross-package contract — a risk trigger.** It takes the FULL review ceremony: per-task reviews, the fresh-context plan-vs-spec read, the simplify lenses, and the Codex run-it seat.

**Naming decisions fixed for the whole plan (use these exact names):**
- `withTenant` → `withTransaction`. Signature: `withTransaction<T>(db: Database, fn: (tx: Transaction) => Promise<T>): Promise<T>`.
- The taxpayer row stays in table `tenants`; the other `tenant_*` tables keep their names (renaming is out of scope, spec §"What does not change").
- New guard file: `scripts/no-tenant-column.test.ts`.
- New provisioning error code for a conflicting re-provision: `provisioning.tenant_identity_mismatch` (confirm the `provisioning.` prefix and absence of a sibling by grepping `packages/provisioning/src/errors.ts` in Task B8 before adding it).

**The tenant value flows through these named shape fields** — a Phase B task removes the field in the same commit as the insert that reads it and the column it writes, tracing each field back to the type that declares it:
- `cfg.tenantId` / `TillConfig.tenantId` (`apps/server/src/till-config.ts`) → server + venue-service inserts
- `input.tenantId` (layouts store inputs, identity login/session/passkey inputs)
- `sale.tenantId` (the `Sale` shape in `@waitron/core`) → `fiscal-verifactu/src/backend.ts` `envios` inserts
- `key.tenantId` (`workforce/src/chain.ts`) → workforce chain upsert
- `ctx.tenantId` (`fiscal-verifactu/src/registro-row.ts`)
- `deps.cfg.tenantId` (`apps/server/src/payments-api.ts`)
- Track down any others in Task B0's census: `grep -rn '\.tenantId' packages apps --include='*.ts' | grep -v test | grep -v 'eq('`

**The 12 migration sets carrying `tenant_id`** (verify the live list in Task B0): `bookings`, `catalogue`, `credentials`, `db`, `fiscal-verifactu`, `identity`, `media`, `payments`, `scheduler`, `venue-service`, `workforce`, `workforce-es`.

**Packages with NO migration set that still write tenant columns into core-owned tables** (they are fixed in Task B8, the core-set task, because that is where those columns are dropped): `layouts` (writes `tenant_receipts`, `tenant_themes`, `canvases`, `device_profiles`), `reporting` (writes `daily_close_chain`). Task B0 confirms this list.

**Packages with NO migration set that consume tenant SEMANTICS** (found by the B0 census, 2026-09-14 — they own no column but must be converted): `payments-stripe` and `payments-sumup` (a `requireOwnTenant` runtime guard, a `tenantId` in provider `opts`/`deps`/`params`, and credential reads whose AAD is keyed by tenant — Tasks B-PAY); `reporting` (11 raw-SQL tenant filters + `input.tenantId` shape fields — its filters go in Task A5, its inserts and shape fields in Task B8); the credentials API itself (Task B2, below).

**Raw-SQL tenant filters are a distinct category from drizzle `eq()` filters.** The B0 census counts ~134 `where tenant_id = ${…}` filters inside `sql\`…\`` templates (workforce, server, catalogue, fiscal-verifactu, reporting, venue-service, provisioning, core, printing, media). Task A2 removes drizzle `eq()` filters; **Task A5** removes these raw-SQL ones. Both are behaviour-neutral under one tenant and safe while the columns exist, but a raw-SQL removal is not caught by the typechecker — its safety net is the package suite, so A5 runs each touched package's tests.

**SECURITY-SENSITIVE — the credential seal.** `tenantId` is the additional-authenticated-data (AAD) that binds a sealed credential's ciphertext, via `aadFor(tenantId, purpose)` (`packages/credentials/src/cipher.ts:23`), used by both `seal` and `open` (`packages/credentials/src/store.ts:68,132`). Task B2 changes the AAD to `purpose` alone and must change `seal` and `open` together, or every decrypt fails. Safe pre-production (no stored credentials to re-seal), but it is a change to how secrets are sealed: Task B2 gets the run-it check (a real seal→open round-trip on the new AAD) and a careful review.

---

## Phase A — Remove the read-side filters and the tenant-free renames (workspace stays green throughout)

Order rule for Phase A: nothing here drops a column or removes a shape field that an insert reads. Every task leaves the `tenant_id` columns present and still populated, and leaves every `cfg.tenantId`/`sale.tenantId`/`input.tenantId` field defined, so the workspace compiles and every suite stays green. Removing a `where tenant_id = …` filter is behaviour-neutral under one tenant (`CLAUDE.md` "preserve behavioural assertions"). Run each task's named suites; they must stay green.

### Task B0: Census (do this first, commit nothing)

Not a code change — a survey whose output the later tasks consume. Run and paste the results into the branch's handoff ledger (`docs/handoffs/2026-09-14-drop-tenant-id.md`, `Status: in progress`):

- [ ] Migration sets: `grep -rl tenant_id packages/*/drizzle/*.sql | sed -E 's#packages/([^/]+)/.*#\1#' | sort -u`
- [ ] Production drizzle inserts writing tenantId: `grep -rn 'tenantId:' packages apps --include='*.ts' | grep -v test | grep -E '\.values\(|values\(\{'` (expect ~16)
- [ ] Upsert conflict targets on tenantId: `grep -rn 'onConflict\|target:' packages apps --include='*.ts' | grep -v test | grep tenantId` (expect ~19)
- [ ] `TenantId` brand importers by package: `grep -rl 'TenantId' packages apps --include='*.ts' | grep -v test | sed -E 's#(packages|apps)/([^/]+)/.*#\2#' | sort | uniq -c | sort -rn`
- [ ] Every `.tenantId` read that is not an `eq()` filter: `grep -rn '\.tenantId' packages apps --include='*.ts' | grep -v test | grep -v 'eq('` — classify each as a shape field (goes in Phase B with its insert) or a genuine taxpayer-id read (must read the one `tenants` row instead — flag for B8; expect none on the fiscal payload path, where the NIF is `tax_id`).

This census is the authoritative work list; if any count differs materially from the plan's estimates, note it and carry the real list forward.

### Task A1: Rename `withTenant` to `withTransaction` and drop its tenant argument

**Files:**
- Modify: `packages/db/src/tenancy.ts`, `packages/db/src/index.ts:118`, `packages/db/src/index.test.ts:37`
- Modify: all ~267 non-test call sites and their test call sites (`grep -rln 'withTenant' packages apps --include='*.ts'` — heaviest in `apps/server`)

**Interfaces:**
- Produces: `withTransaction(db, fn)` — every later task uses this name.

- [ ] **Step 1: Rewrite the helper** in `packages/db/src/tenancy.ts`:

```ts
import type { Database, Transaction } from "./client.js";

/**
 * Runs the caller's work in one transaction. One tenant per database, so there is no tenant to bind:
 * a write path takes the `tx` this opens and never opens its own (CLAUDE.md §3). Renamed from
 * `withTenant` when the tenant column was dropped (2026-09-14).
 */
export async function withTransaction<T>(
  db: Database,
  fn: (tx: Transaction) => Promise<T>,
): Promise<T> {
  return db.transaction((tx) => fn(tx));
}
```

- [ ] **Step 2: Update the re-export and its test** — `packages/db/src/index.ts` exports `withTransaction`; `index.test.ts`'s re-export assertion names `withTransaction`.

- [ ] **Step 3: Update every call site.** `withTenant(db, someTenantId, fn)` → `withTransaction(db, fn)`. The middle argument (`cfg.tenantId`, `config.till.tenantId`, `deps.tenantId`, a literal) is dropped from the *call* — but leave the field's *definition* alone (later tasks remove those). Update the import name in each file.

- [ ] **Step 4: Typecheck and run the db suite.** `pnpm -r typecheck && pnpm --filter @waitron/db test:coverage` → PASS. A leftover `withTenant` is a compile error naming the file.

- [ ] **Step 5: Commit** (`-s`):

```
Rename withTenant to withTransaction and drop its unused tenant argument

One tenant per database means the transaction helper never had a tenant to
bind; the argument was threaded through ~267 call sites for nothing. First step
of removing the tenant id everywhere (spec 2026-09-14-drop-tenant-id-design.md).
No column is dropped, so every suite stays green.
```

### Task A2: Remove the per-query tenant filters (keep every shape field)

**Files:**
- Modify: every file with `eq(<table>.tenantId, <x>)` or `and(eq(<table>.tenantId, …), …)` (`grep -rln 'eq(' packages apps --include='*.ts' | ...` then filter for `.tenantId`; ~325 files touch one or two lines each)

**Interfaces:**
- Consumes: `withTransaction`.
- Produces: no read query filters on `tenantId`. **Every `cfg.tenantId`/`input.tenantId`/`sale.tenantId` field and the `TenantId` brand still exist** — they feed inserts that survive to Phase B.

- [ ] **Step 1: Remove the filters.** Delete each `eq(table.tenantId, x)`. Where it was the sole `where` argument, delete the `.where(...)`. Where it was one arm of `and(...)`, keep the other arm(s) and unwrap `and` if one remains. A by-id read `and(eq(t.id, id), eq(t.tenantId, cfg.tenantId))` becomes `eq(t.id, id)`. **Do not** touch `.values({ tenantId })`, `onConflict({ target: [...tenantId] })`, or any config/shape field — those are Phase B.

- [ ] **Step 2: Typecheck and run the heavy consumers.** `pnpm -r typecheck && pnpm --filter @waitron/core test:coverage && pnpm --filter server test:coverage` → PASS. `cfg.tenantId` is now read by fewer places but is still defined, so nothing breaks. Suites assert the same behaviour (one tenant → the filter never changed a result).

- [ ] **Step 3: Commit** (`-s`):

```
Stop filtering reads by tenant

With one tenant per database the tenant filter can never change a result; by-id
reads keep their own id predicate. Inserts, upsert targets and config shapes are
untouched — they come out in Phase B with the columns. Suites stay green.
```

### Task A3: Remove the env variable, the live-updates tenant filter, and the authorizeManager tenant return

**Files:**
- Modify: `apps/server/src/till-config.ts` (drop `WAITRON_TILL_TENANT_ID` *parsing*, but **keep** `TillConfig.tenantId` for now if any insert still reads it — see note), `.env.example:75`, `apps/server/scripts/dev-setup.ts`, `apps/server/src/break-glass-command.ts`, and the boot tests setting the var (`boot.promote.test.ts`, `boot.singleton.test.ts`, `boot.mirror.test.ts`, `config.test.ts`, `boot.promote-endpoint.test.ts`, `promote-endpoint-e2e.test.ts`, `dev-setup.test.ts`)
- Modify: `apps/server/src/live-api.ts:78-104` (drop the `tenantId` dep and `event.change.tenantId` filter), `packages/shared/src/live-updates.ts:6-7` (drop `tenantId` from `ResourceChange`), and every emitter setting it
- Modify: `packages/identity/src/manager-login.ts:~165` (`authorizeManager` stops returning `tenantId`) and its callers, deleting the route-level "session tenant vs configured tenant" comparisons

**Note on `TillConfig.tenantId`:** the *environment variable* is removed here (nothing that survives Phase A reads it — the value came from the DB row for inserts, or was only used in now-deleted filters). But if the B0 census shows a surviving insert reads `cfg.tenantId`, keep the `TillConfig.tenantId` *field* (sourced however it is today minus the env var) until that insert is converted in Phase B, then remove the field there. Resolve this concretely from B0's census before editing.

**Interfaces:**
- Produces: `authorizeManager` returns `{ authorizedBy: string; role: PersonRoleValue }`; `ResourceChange` is `{ resources: ResourceIdentity[] }`; `WAITRON_TILL_TENANT_ID` is unread. **The `TenantId` brand still exists** (Phase C deletes it).

- [ ] **Step 1: Add a failing config test** in `apps/server/src/config.test.ts`: boot config parses when `WAITRON_TILL_TENANT_ID` is absent, and when it is *set* the value does not appear on the parsed config. Run it — fails until Step 2.

- [ ] **Step 2: Remove the env variable** from parsing, `.env.example`, `dev-setup.ts`, `break-glass-command.ts` and the boot tests. A box that still sets it boots normally (Step 1 proves it is ignored, not required).

- [ ] **Step 3: Remove the live-updates tenant field** from `ResourceChange` and `live-api.ts` (both `deps.tenantId` and the `event.change.tenantId !== deps.tenantId` guard), and from every emitter that sets `tenantId` on a change.

- [ ] **Step 4: Remove `tenantId` from `authorizeManager`** — change the return type, stop selecting the tenant, and delete the route-level tenant comparisons in its callers (`configuration-export-api.ts`, printer routes, any other). Keep the permission check itself.

- [ ] **Step 5: Run** `pnpm --filter server test:coverage && pnpm --filter @waitron/identity test:coverage && pnpm --filter @waitron/shared test:coverage` → PASS, including the new env test. (A full `pnpm -r typecheck` is NOT expected green here only if Step 3's `ResourceChange` change orphans an emitter in another package — if so, fix that emitter in this task; the change is small and behaviour-neutral.)

- [ ] **Step 6: Commit** (`-s`):

```
Remove the tenant from the env, live updates and authorizeManager

authorizeManager no longer returns a tenant and the route-level tenant
comparisons are deleted; live updates drop the tenant filter; the
WAITRON_TILL_TENANT_ID variable is gone. A box that still sets it boots
normally — a new config test proves it is ignored. The TenantId brand and the
insert shape fields stay until Phase B/C.
```

### Task A4: Delete the two-tenant probe tests

**Files:**
- Delete or edit: the ~87 test files matching `grep -rl 'other tenant\|tenant B\|otherTenant\|second tenant\|two tenant\|cross-tenant\|foreign tenant\|another tenant' packages apps --include='*.test.ts'`

- [ ] **Step 1: Produce the exact list** and save it to the ledger and the commit message.
- [ ] **Step 2: Classify each file.** Whole file is a cross-tenant probe (e.g. `packages/db/src/schema/locations-default-catalogue.test.ts`, `packages/bookings/src/bookings-tenant.pg.test.ts`) → delete the file. A two-tenant *case* inside an otherwise-relevant suite → delete only those `it(...)` blocks and their second-tenant fixture. Never rewrite a two-tenant assertion into a one-tenant one (it would assert nothing — spec §Tests).
- [ ] **Step 3: Delete accordingly.** `pnpm --filter @waitron/db test:coverage && pnpm --filter @waitron/bookings test:coverage` → PASS. If deleting a whole file drops a package below its coverage threshold, it also covered single-tenant behaviour — restore it and delete only the two-tenant cases.
- [ ] **Step 4: Commit** (`-s`) listing every file deleted vs cases-removed.

### Task A5: Remove the raw-SQL tenant filters

**Files:** every production file with a `where tenant_id = ${…}` (or `and … tenant_id = ${…}`) inside a `sql\`…\`` template — ~134 sites (`grep -rn 'tenant_id = ' packages apps --include='*.ts' | grep -v test | grep '\${'`), heaviest in `workforce`, `apps/server`, `catalogue`, `fiscal-verifactu`, `reporting`.

**Interfaces:** Consumes: nothing. Produces: no raw-SQL query filters on `tenant_id`. Shape fields (`input.tenantId`, `cfg.tenantId`) stay — Phase B removes them with the inserts.

- [ ] **Step 1: Remove each raw-SQL filter.** Delete the `tenant_id = ${x}` predicate. If it was the whole `WHERE`, drop the `where`; if one `AND` arm, keep the rest. **Care, because the typechecker cannot catch a mistake here:** a filter inside a correlated subquery, an `INSERT … WHERE NOT EXISTS`, a `DELETE`/`UPDATE`, or an `ON CONFLICT … WHERE` must keep the SQL valid — read the emitted statement, do not pattern-delete. A by-id read keeps its `id = ${id}` predicate. Behaviour is unchanged under one tenant.
- [ ] **Step 2: Run the touched packages' suites** — at minimum `pnpm --filter @waitron/workforce test:coverage && pnpm --filter server test:coverage && pnpm --filter @waitron/catalogue test:coverage && pnpm --filter @waitron/fiscal-verifactu test:coverage && pnpm --filter @waitron/reporting test:coverage` (real-PG ones with `TESTCONTAINERS_RYUK_DISABLED=true`). These suites are the only safety net — a broken raw-SQL edit surfaces here, not at typecheck.
- [ ] **Step 3: Commit** (`-s`): `Remove the raw-SQL tenant filters`
- [ ] **Step 4: Phase A gate.** `pnpm -r typecheck && pnpm format:check && pnpm lint` → PASS. The workspace is fully green: every tenant *filter* (drizzle and raw-SQL) gone, every tenant *column* and *shape field* still present.

---

## Phase B — Per migration set, drop the columns and rewrite every writer of them

Order rule for Phase B: leaf module sets first (writers are in-package, so the task is self-contained), the core `db` set last (writers span many packages, so its task sweeps them). After Phase A no code *reads* a tenant column by filter, so a schema-type drop now breaks only *writers*: drizzle `.values({ tenantId })`, `onConflict({ target: [...tenantId] })`, `.tenantId` shape-field reads, and raw-SQL `insert into … (tenant_id)`. Each task fixes all of these for its set, in one commit, together with the column drop.

**The per-set mechanism, identical for every Phase B task** (each task states only what differs):

1. **Edit the schema source** under `packages/<pkg>/src/schema/`: delete each `tenantId: uuid("tenant_id")…` column; delete every constraint/index whose `.on(...)` led with `t.tenantId` (a `unique(...).on(t.tenantId, t.id)` composite-FK target is deleted — the target becomes the table's own PK; a `unique(...).on(t.tenantId, t.name)` becomes `unique(...).on(t.name)`; a bare `index(...).on(t.tenantId)` is deleted); rewrite schema-declared composite FKs to drop the tenant column.
2. **Regenerate** the drizzle-managed migration: `pnpm --filter @waitron/<pkg> db:generate`. Inspect the emitted file — it must contain only tenant-related drops/alters. Anything else means the schema edit was wrong; fix and regenerate. Never hand-edit `drizzle/meta/*.json` or `_journal.json`.
3. **Hand-rewrite the paired custom migration(s)** — the `*_sql.sql` files and any hand-written composite-FK/grant migration. Drop `tenant_id` from every `FOREIGN KEY ("tenant_id","x") REFERENCES "parent" ("tenant_id","id")` (→ `FOREIGN KEY ("x") REFERENCES "parent" ("id")`), from every `GRANT … (col,…)` column list, and from every `reject_mutation`/append-only trigger. A pure `FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id")` is deleted.
4. **Rewrite the writers in this set's production code:**
   - `.values({ tenantId: …, … })` → drop the `tenantId` key.
   - `onConflict({ target: [X.tenantId, X.other] })` → `onConflict({ target: [X.other] })` (the per-tenant unique becomes the plain unique — confirm the regenerated unique matches).
   - Raw-SQL `insert into <table> (tenant_id, …) values (${x}, …)` → drop the column and its value.
   - The shape field that fed the insert (`cfg.tenantId`, `input.tenantId`, `sale.tenantId`, `key.tenantId`, `ctx.tenantId`) → remove it, tracing back to the type that declares it (e.g. the `Sale` type in `@waitron/core`, the store input types in `layouts`) and removing the field there and at every producer.
5. **Fix this set's fixtures:** `test/fixtures.ts` and `src/testing/seed.ts` lose the tenant argument and column.
6. **Run** `pnpm --filter @waitron/<pkg> test:coverage` (real-PG sets: `TESTCONTAINERS_RYUK_DISABLED=true`, Docker up). For a set whose grants changed, its grant suite must pass as `app_user` (`asAppUser(tx)`); a green exit alone is not evidence (`CLAUDE.md` §3).
7. **Commit** (`-s`), naming the set and stating that regeneration (not hand-edited snapshots) produced the migration.

**Typecheck note:** between Phase B commits `pnpm -r typecheck` may be red, because a downstream package's writer still references a just-dropped column (spec §"How the work is cut"). That is expected and allowed *within* Phase B. Each task keeps its *own* package suite green; the Phase B gate (Task B9 Step 5) restores a green workspace typecheck.

### Task B1: `scheduler` (smallest — proves the mechanism)

One migration touching `tenant_id` (`scheduled_runs`); no composite FKs beyond the tenant FK. Its 3 `TenantId` brand imports stay (Phase C removes the brand); only the column/insert/filter go.

- [ ] Steps 1–7. Commit: `Drop tenant_id from the scheduler set`

### Task B2: `credentials` (`tenant_credentials`) — column, PK, and the seal AAD (SECURITY-SENSITIVE)

PK changes from `(tenant_id, purpose)` to `(purpose)`. Stays classified `local`. Keep the `iv`/`auth_tag` length CHECKs. Rewrite `credentials/store.ts:149` upsert target. Grant suite passes as `app_user`.

**This task also changes how secrets are sealed** — do it carefully and as one coherent change:
- `aadFor(tenantId, purpose)` (`packages/credentials/src/cipher.ts:23`) becomes `aadFor(purpose)` returning `Buffer.from(purpose)` (drop the `${tenantId}\0` prefix). `seal` and `open` both call it, so the change is symmetric by construction — but a partial edit (one call site missed) makes every decrypt fail, so verify both.
- `CredentialRef` and `putCredential`'s params drop `tenantId` (`store.ts:32,127`); `getCredential`/`tryGetCredential`/`putCredential` and the `credentials.decrypt_failed` error payload (`errors.ts:52`) drop it too.
- Every consumer of the credential API drops `tenantId` from its ref: `credentials/src/cli.ts:147`, and (in Tasks B-PAY) `payments-stripe` and `payments-sumup`. Because the API signature changes, those consumers will not typecheck until B-PAY — do B2 and B-PAY back-to-back, same implementer.

- [ ] Steps 1–7, plus: verify `aadFor` changed in both `seal` and `open` paths; the new PK is `(purpose)`, regenerated not hand-edited.
- [ ] **Run-it check (security):** a real seal→open round-trip on the new AAD — `putCredential` a value, `getCredential` it back, assert equality; and assert an `open` with a mismatched purpose still fails (the AAD still binds purpose). This is in `credentials`' own suite; run it as `app_user`.
- [ ] Commit: `Drop tenant_id from the credentials vault and its seal AAD`

### Tasks B-PAY: `payments-stripe` and `payments-sumup` (no migration set — tenant semantics only)

Neither owns a table. Both take a `tenantId` in provider `opts`/`deps`/`params`, guard it, and read tenant-keyed credentials. Convert both (one task each, or one combined — they are near-identical shapes):
- Delete the `requireOwnTenant(supplied)` method and its call sites (`payments-stripe/src/{device-provider,provider}.ts:110,88`) — a guard comparing the caller's tenant to the provider's own is vacuous with one tenant.
- Drop `tenantId` from provider `opts`/`deps`/`params` types and every use (`device-provider.ts`, `provider.ts`, `hosted-provider.ts`, `card-provider.ts`, `reverse.ts` for stripe; `card-provider.ts`, `provider.ts` for sumup), and from the `getCredential({ tenantId, purpose })` refs (now `{ purpose }`, per B2).
- `assertKeyEnvironment`/`secretKeyFromSealed` (`card-provider.ts:62,82`) drop the `tenantId` parameter — it fed only the error payload, not the environment check, so removing it changes no logic.
- `withTenant(db, tenantId, fn)` → `withTransaction(db, fn)` (already renamed in A1; here the `tenantId` argument's source is removed).

- [ ] Convert `payments-stripe`; run `pnpm --filter @waitron/payments-stripe test:coverage`.
- [ ] Convert `payments-sumup`; run `pnpm --filter @waitron/payments-sumup test:coverage`.
- [ ] Commit(s) (`-s`): `Drop the tenant from the Stripe/SumUp providers`

### Task B3: `workforce-es` (`convenio_config`) + `workforce`

`convenio_config` keeps `location_id`. `workforce`'s tables reference `tenants`/`locations`/`tills`/`nodes`; `test/fixtures.ts` `seedLocation`/`seedPerson` lose the tenant argument; `chain.ts:119` upsert (`key.tenantId`, `[chain.tenantId, chain.nodeId]`) drops the tenant column and target and the `key.tenantId` field. **The working-time chain is keyed by node, never tenant** (spec §5) — confirm no chain identity column is touched. Do both sets in one task (their fixtures interlock).

- [ ] Steps 1–7 for both. Commit: `Drop tenant_id from the workforce and workforce-es sets`

### Task B4: `bookings`

Composite FKs `(tenant_id, table_id) → dining_tables(tenant_id, id)` and `(tenant_id, tab_id) → working_orders(tenant_id, id)` become `(table_id) → dining_tables(id)` / `(tab_id) → working_orders(id)` (the referenced `id` is already those tables' PK, so valid immediately even though the parents' composite uniques drop in B8). Delete `bookings-tenant.pg.test.ts` if A4 did not.

- [ ] Steps 1–7 (real-PG). Commit: `Drop tenant_id from the bookings set`

### Task B5: `media`

Schema `src/schema/images.ts`. If regeneration touches the image expression index, keep helper calls schema-qualified (`CLAUDE.md` §3). Run `images.pg.test.ts`.

- [ ] Steps 1–7. Commit: `Drop tenant_id from the media set`

### Task B6: `venue-service`

Schema `src/schema/service.ts`. Rewrite `operations.ts` inserts (`:499,:674`, both `cfg.tenantId`) and upsert targets (`:468,:501,:676`), and remove the `cfg.tenantId` field feeding them. Keep `category-dependencies.test.ts`/`operations.test.ts` green.

- [ ] Steps 1–7. Commit: `Drop tenant_id from the venue-service set`

### Task B7: `catalogue` (largest module set)

6 tenant-bearing migrations and a deep composite-FK web (`menu_item_options → menu_item_option_groups(tenant_id, menu_item_id, group_id)`, `menu_items → catalogues/products/menu_sections/option_group_items`, all tenant-consistent — `packages/catalogue/drizzle/0000_menu_offers.sql:43-51`). Each composite FK drops its leading `tenant_id`, keeps the business columns (`(menu_id, section_id) → menu_sections(menu_id, id)`); the targets those FKs point at drop `tenant_id` too and stay unique under one tenant (verified: `menu_sections` has PK `id` plus `UNIQUE(tenant_id, menu_id, id)`, so the collapsed `(menu_id, id)` still has a matching unique). Rewrite the upsert targets in `content-languages.ts:124`, `operations.ts:557`, `categories.ts:169`, `units.ts:156`. `test/fixtures.ts` `seedLegacySellingUnits` loses its tenant argument. Has baselines + incrementals — regenerate against current schema; `journal-monotonic` stays green.

- [ ] Steps 1–7. Inspect the regenerated migration carefully (most FK churn). Also run `pnpm exec vitest run scripts/journal-monotonic.test.ts`. Commit: `Drop tenant_id from the catalogue set`

### Task B8: `db`/core — columns, the `tenants` singleton, `deriveTenantId`, `applyVenue`, and every cross-package writer of core tables

The widest task: `tenants`, `locations`, `tills`, `nodes`, `working_orders`, `sales`, `daily_closes`, `daily_close_chain`, `dining_tables`, `canvases`, `device_profiles`, `payment_policy`, `tenant_themes`, `tenant_receipts`, and more. **Its writers span packages with no migration set** — this task fixes them all, because their inserts break the moment these columns drop:
- `layouts`: `receipt-store.ts:45,47`, `theme-store.ts:53,55`, `canvas-store.ts:121`, `device-profile-store.ts:183` (`.values({ tenantId: input.tenantId })` + upsert targets → drop the key/target and the `input.tenantId` field on the store input types)
- `reporting`: `record-daily-close.ts:268-269` (`.values({ tenantId, nodeId })` + `onConflictDoNothing({ target: [dailyCloseChain.tenantId, dailyCloseChain.nodeId] })` → `{ nodeId }` / `[dailyCloseChain.nodeId]`, and remove the `tenantId` param threaded into `recordDailyClose`)
- `identity`: `login.ts:40`, `passkey.ts:284`, `management-session.ts:41` (`.values({ tenantId: input.tenantId })` into db-owned session tables → drop key + `input.tenantId`) — note identity also has its OWN migration set (Task B9); here fix only its inserts into **db-owned** tables, leaving identity-owned tables to B9. If cleaner, do B8 and B9 back-to-back by the same implementer.
- `fiscal-verifactu`: `backend.ts:300,586,748` insert `envios` with `sale.tenantId` — `envios` is fiscal-owned (Task B9), but `sale.tenantId` comes from the `Sale` shape in core; drop the `Sale.tenantId` field here in B8 and the `envios` insert key in B9
- `server`: `device.ts:94`, `station-printers.ts:83`, `payments-api.ts:225,585` (`cfg.tenantId`/`deps.cfg.tenantId`) → drop keys + the `TillConfig.tenantId` field (the last reader of it) + the `cfg` shape fields
- `core`: its own inserts (raw SQL in `record-sale.ts`) and the `Sale.tenantId` field
- fixtures across `workforce`/`recipes`/`identity`/`fiscal-verifactu` that insert into db-owned tables (`seedTenant`, `seedTill`, …)

**Files (beyond the mechanism):** `packages/db/src/schema/tenants.ts`; `packages/provisioning/src/tenant-id.ts` (delete); `packages/provisioning/src/{venue-plan,venue-apply}.ts`; `apps/server`'s double-provision guard; `packages/db/src/testing/seed.ts`; add `provisioning.tenant_identity_mismatch` to `packages/provisioning/src/errors.ts`.

- [ ] **Step 1: Make `tenants` a one-row table**, following the in-package singleton precedent (`deployment`, `mirror_config`, `node_membership` all use `id integer PRIMARY KEY` + `CHECK (id = 1)`):

```ts
export const tenants = pgTable(
  "tenants",
  {
    // One row per database. id pinned to 1 (the deployment/mirror_config/node_membership precedent):
    // a second insert violates the PK and the check.
    id: integer("id").primaryKey(),
    country: text("country").notNull(),
    taxId: text("tax_id").notNull(),
    legalName: text("legal_name").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  },
  (t) => [
    check("tenants_singleton_ck", sql`${t.id} = 1`),
    uniqueIndex("tenants_country_tax_id_key").on(t.country, t.taxId),
  ],
);
```

The `id` type changes `uuid`→`integer`; all FKs to it are gone by now (B1–B7 + this task), so nothing references the old uuid.

- [ ] **Step 2: Delete `deriveTenantId`** (`packages/provisioning/src/tenant-id.ts`) and its imports; `venue-plan.ts` stops computing a derived id; the tenant row inserts with `id = 1`.

- [ ] **Step 3: Write the failing provisioning test, then rewrite `applyVenue`'s `ensure-tenant`.** Test cases in the applyVenue suite: (a) fresh DB → creates row id=1; (b) same country/tax_id re-run → idempotent no-op; (c) different tax_id re-run → throws `provisioning.tenant_identity_mismatch`. Run — (c) fails first. Then rewrite: read `select country, tax_id from tenants where id = 1`; absent → insert `(1, country, tax_id, legal_name)`; present and matching (after `.trim().toUpperCase()`) → no-op; present and differing → throw the new code. Assert the domain code, not `toBeInstanceOf(Error)` (`CLAUDE.md` §4). Grep `errors.ts` first for the prefix/sibling.

- [ ] **Step 4: Apply the mechanism to every db-owned table** + the `id = 1` singleton shape for `payment_policy`/`tenant_themes`/`tenant_receipts`. Regenerate `pnpm --filter @waitron/db db:generate`; hand-rewrite `0001_db_baseline_sql.sql` grants, composite FKs and `reject_mutation` triggers.

- [ ] **Step 5: Rewrite every cross-package writer** listed above (layouts, reporting, identity's db-table inserts, server, core, the `Sale.tenantId`/`TillConfig.tenantId`/`input.tenantId` shape fields, fixtures). `seedTenant` becomes "ensure the one tenants row exists" returning `1` (or nothing).

- [ ] **Step 6: Run and read grants back.** `pnpm --filter @waitron/db test:coverage && pnpm --filter @waitron/core test:coverage && pnpm --filter @waitron/provisioning test:coverage && pnpm --filter @waitron/layouts test:coverage && pnpm --filter @waitron/reporting test:coverage` → PASS, including the new mismatch test and the db grant assertions as `app_user`.

- [ ] **Step 7: Commit** (`-s`):

```
Drop tenant_id from the core set and make tenants a one-row table

tenants becomes id=1 with a singleton check (the deployment/mirror_config/
node_membership precedent in this package); deriveTenantId is deleted; applyVenue
reads the one row and refuses a re-run whose country/tax_id differ
(provisioning.tenant_identity_mismatch) instead of silently minting a second
permanent tenant. Migrations regenerated with drizzle-kit. Every cross-package
writer of core tables (layouts, reporting, identity sessions, server, core) and
the shape fields feeding them (Sale.tenantId, TillConfig.tenantId,
store inputs) come out here too.
```

### Task B9: `identity` and `fiscal-verifactu`

Last and highest-risk; fixtures depend on db+identity already converted. **The fiscal hash is untouched** — verify by running (spec §Risks): `grep -rn tenant packages/verifactu/src` is empty; `registros_facturacion` loses `tenant_id` while `node_id` and the taxpayer NIF (`tax_id`) stay. `identity`'s `webauthn_credentials` unique `(tenant_id, credential_id)` → `(credential_id)`; drop tenant from `management_sessions`/`persons`/`sessions`/`webauthn_challenges`. `fiscal-verifactu` `backend.ts` `envios` inserts drop the `tenantId` key (the `Sale.tenantId` field was removed in B8); `test/fixtures.ts` (`seedTenants`, `seedTenantTillSif`, `seedTenantWithSif`) drop the column.

- [ ] **Step 1:** Mechanism on `identity`. `pnpm --filter @waitron/identity test:coverage`.
- [ ] **Step 2:** Mechanism on `fiscal-verifactu`.
- [ ] **Step 3: Run the fiscal suites in full on real PostgreSQL** — the run-not-read check: `TESTCONTAINERS_RYUK_DISABLED=true pnpm --filter @waitron/fiscal-verifactu test:coverage` → PASS, including `inmutabilidad.test.ts`, `chain.concurrency.test.ts`, `chain.node-rekey.concurrency.test.ts`. A chain-test failure means the hash input changed — stop and investigate.
- [ ] **Step 4: Commit** (`-s`):

```
Drop tenant_id from the identity and fiscal-verifactu sets

The fiscal hash was never a function of the tenant (grep -rn tenant
packages/verifactu/src is empty; the chain and inmutabilidad suites pass
unchanged on real PostgreSQL). registros_facturacion loses tenant_id like every
table; node_id and the taxpayer NIF (tax_id) identify a record to AEAT and are
untouched.
```

- [ ] **Step 5: Phase B gate.** `pnpm -r typecheck && pnpm exec vitest run scripts/journal-monotonic.test.ts scripts/classification-complete.test.ts scripts/append-only-enable-always.test.ts` → PASS. Then the replication suite (proves regenerated published tables still replicate and kept primary keys): `TESTCONTAINERS_RYUK_DISABLED=true pnpm --filter @waitron/replication-tests test:coverage` → PASS.

---

## Phase C — Delete the brand, add the guard, update the rules

### Task C1: Delete the `TenantId` brand workspace-wide

**Files:** `packages/shared/src/ids.ts:56`, `packages/shared/src/index.ts:38`, and every importer (~14 packages from B0's census: `server`, `reporting`, `fiscal-verifactu`, `provisioning`, `core`, `payments-stripe`, `scheduler`, `payments-sumup`, `payments`, `catalogue`, `recipes`, `purchasing`, `module`, `db`, `credentials`, `venue-service`, `bookings`).

By now no `.tenantId` field survives, so every `TenantId` usage is either the brand definition or a dangling import.

- [ ] **Step 1:** Delete the brand and its export; remove every `TenantId` import (`grep -rl 'TenantId' packages apps --include='*.ts'`). Any remaining *use* of the type is a bug from an earlier task — trace and remove the field it typed.
- [ ] **Step 2:** `pnpm -r typecheck` → PASS. This is the proof that every shape field is truly gone.
- [ ] **Step 3: Commit** (`-s`): `Delete the now-unused TenantId brand`

### Task C2: Add the `no-tenant-column` guard

**Files:** Create `scripts/no-tenant-column.test.ts` (root Vitest project — the hook and `lint` job run it every non-docs push, `CLAUDE.md` §4).

- [ ] **Step 1: Write the guard**, reading text (state the gap in the header): (a) no `tenant_id` in any `packages/*/drizzle/*.sql`; (b) no `tenantId` identifier in non-test `.ts` under `packages/`+`apps/`, allowlist empty (`tenants` has `country`/`taxId`, not `tenantId`). Use `sourceFilesIn` with `isFile()` (`CLAUDE.md` §4 — a screenshot directory named `*.test.ts` breaks a naive scan).

```ts
// Reads TEXT, not code: a column reintroduced under a name that avoids the
// strings "tenant_id"/"tenantId" would pass. That is the known gap.
```

- [ ] **Step 2: Prove by deletion** — reintroduce one `tenant_id` in a scratch edit, watch it fail naming the file, revert. `pnpm exec vitest run scripts/no-tenant-column.test.ts` → PASS clean.
- [ ] **Step 3: Commit** (`-s`): `Add the no-tenant-column guard (reads text; see header for the gap)`

### Task C3: Update the rules and documents

**Files:** `CLAUDE.md` §3; `docs/developers/conventions-data.md`; `docs/backlog.md` → Standing decisions; prose across `docs/`, READMEs, runbooks.

- [ ] **Step 1: Retire and reword CLAUDE.md rules.** Delete the by-id-read rule and the authorizeManager-tenant rule; reword the `withTenant`→`withTransaction` line; keep the `app_user`-grant line. Replace with: *There is no tenant column. The taxpayer is the one row in `tenants` (id = 1, singleton check); a query that wants "this tenant's rows" reads the table. (2026-09-14, spec 2026-09-14-drop-tenant-id-design.md.)*
- [ ] **Step 2: conventions-data.md + backlog.md** — dated "superseded" notes on the two retired sections pointing to the spec (historical docs are not rewritten); reword the transaction-helper section; append "and the schema carries no tenant column (2026-09-14)" to the one-tenant standing decision.
- [ ] **Step 3: Sweep the prose** by reading, not grepping an identifier (`CLAUDE.md` §1 "the PATH SET matters"): `deploy/README.md`, the runbooks in `docs/superpowers/plans/`, README paraphrases across the whole `docs/` tree. Fix live claims; add one-line dated pointers to historical plans mentioning `WAITRON_TILL_TENANT_ID`. Run `pnpm exec vitest run scripts/claude-md-pointers.test.ts`.
- [ ] **Step 4: Commit** (`-s`): `Retire the tenant-scoping rules and update the docs`

### Task C4: Full local gate and finish

- [ ] **Step 1:** `pnpm -r typecheck && pnpm format:check && pnpm lint`
- [ ] **Step 2:** `pnpm exec vitest run scripts/` → PASS (new guard, journal-monotonic, classification, append-only, claude-md-pointers).
- [ ] **Step 3:** `wa-wt reset demo <worktree-name>`, boot, confirm no `migrations.*` error, re-enrol the dev till at `http://localhost:5190` with code `DEMO`.
- [ ] **Step 4:** Announce branch readiness; run `/finish-branch` (full ceremony). Run-it seat brief: insert a second `tenants` row as `app_user` → the singleton check refuses it; boot with `WAITRON_TILL_TENANT_ID` still set → ignored; re-run `applyVenue` with a different tax id → `provisioning.tenant_identity_mismatch`.

---

## Self-Review

**Spec coverage:** Schema drop → B1–B9. `tenants` one-row `id=1` (spec updated to match this sibling-precedent shape) → B8 Step 1. `deriveTenantId` deletion + applyVenue refusal → B8 Steps 2–3. `withTenant`→`withTransaction` → A1. Env var + live-updates + authorizeManager → A3. Drizzle query filters → A2; raw-SQL query filters (~134) → A5. Two-tenant tests deleted not rewritten → A4. Insert/upsert/shape-field writers → per-set mechanism steps 4 + B8 Step 5. Credential seal AAD keyed by tenant (security-sensitive) → B2. Consumer packages with no migration set: `payments-stripe`/`payments-sumup` → B-PAY; `reporting` filters → A5, its inserts/shape fields → B8; `layouts`, `reporting` writers → B8. `TenantId` brand → C1. Fiscal hash untouched, verified by running → B9 Step 3. Replication/classification guards green → B9 Step 5. New guard (reads text, gap stated) → C2. Rules + prose sweep → C3. Fixtures → mechanism step 5 + B8 Step 5. Full ceremony + run-it brief → C4. All covered.

**Placeholder scan:** none. The per-set SQL is generated by `drizzle-kit generate` with explicit inspect-and-hand-rewrite steps — the repo's real workflow, not a placeholder (186 FK rewrites cannot be hand-authored correctly in a plan, and snapshots are never hand-edited).

**Type/name consistency:** `withTransaction(db, fn)` identical in A1 and everywhere. `provisioning.tenant_identity_mismatch` identical in B8/C4. `tenants` new shape (id:integer=1, singleton check) defined once in B8, referenced by spec, C3's rule text and C4's brief. The shape fields list (`cfg.tenantId`/`sale.tenantId`/`input.tenantId`/`key.tenantId`/`ctx.tenantId`) is fixed in Global Constraints and consumed by the mechanism and B8.

**Ordering soundness (the fix from review):** Phase A removes ONLY read-side filters and the env var — it never removes a shape field an insert reads, so the workspace stays green (A4 gate). Every writer (insert, upsert target, shape field, column) moves together in Phase B, per set. The `TenantId` brand — whose deletion depends on all shape fields being gone — is last (C1), and its `pnpm -r typecheck` is the proof the fields are all gone. Between B commits the workspace typecheck may be red (downstream writer of a just-dropped column); this is stated at the head of Phase B and restored at B9 Step 5.
