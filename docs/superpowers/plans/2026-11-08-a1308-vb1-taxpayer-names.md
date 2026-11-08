# A1308 venue and box, PR vb1: no name says "tenant" — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to build this plan task by task. Steps use checkbox
> (`- [ ]`) syntax. Every rule in [the slice rules](2026-11-08-a1308-slice-rules.md) applies; this
> plan cites them as "rules §n". Implementers are dispatched as `subagent_type: "implementer"`.

**Goal:** Every name in the tree that still says "tenant" and means the taxpayer, the venue or the
box says that instead: the `tenants` table becomes `taxpayer`, `tenant_credentials` becomes
`venue_credentials`, and the helpers, types, files, error codes, the device-cookie variable and the
shared test helpers follow — by one committed, idempotent rename script.

**Architecture:** A Node script, `scripts/a1308/rename-tenant.mjs`, renames paths and rewrites text
over the tracked files of `apps/`, `packages/` and `scripts/` with one ordered map, after shielding a
fixed list of names it must not touch. A handful of hand edits follow (the dropped unique index, the
docs that state current rules, the Madrid capture's table names). Core's starting migration is then
regenerated with slice 1a's command.

**Tech Stack:** Node 26 ESM script (no dependencies), Drizzle schema, Vitest (root project for the
script's test).

**Spec:** [README §5 U9](../specs/2026-11-02-rationalisation/README.md) ("No name says tenant any
more"), [tables-venuebox.md](../specs/2026-11-02-rationalisation/tables-venuebox.md) §1.1, §1.16,
§5 (the `tenants_*` and `tenant_credentials` rows); environment.md's `WAITRON_VENUE_DOMAIN` row
(`docs/superpowers/specs/2026-11-02-rationalisation/environment.md:221, :299`).

**Lands:** the lane (rules §6), unless the watcher rules otherwise — **open question 1** in this
area's return: the PR renames the table that holds the fiscal identity, and the fiscal code that
reads it (`readTenant` → `readTaxpayer` in `packages/fiscal-verifactu/src/backend.ts:292-316`,
`allocation.ts:68-86`, `allocation-operation.ts:54-58`), by name only. No value, column, hash input,
AEAT wire field, numbering or series changes. The PR's first line after the reset line says so.

**Pull request's first line:** "Every venue is reset: core; backups and exports from before this
cannot be restored or imported." (rules §2).

## What it builds

1. `tenants` → `taxpayer`; its CHECK `tenants_singleton_ck` → `taxpayer_singleton_ck`; the unique
   index `tenants_country_tax_id_key` is **dropped** (`packages/db/src/schema/tenants.ts:51`): with
   `id = 1` enforced there is one row, so it can refuse nothing (appendix §5).
2. `tenant_credentials` → `venue_credentials`, with its primary key and four CHECKs renamed
   (`tenant_credentials_pk` → `venue_credentials_pk`, `tenant_credentials_key_version_ck` →
   `venue_credentials_key_version_ck`, and so on; `packages/db/src/schema/credentials/tenant-credentials.ts:30-40`).
3. Error codes: `provisioning.foreign_tenant` → `provisioning.foreign_taxpayer`,
   `provisioning.tenant_identity_mismatch` → `provisioning.taxpayer_identity_mismatch`
   (`packages/provisioning/src/errors.ts:70, :74`). Neither has dashboard or setup wording
   (`git grep -n "foreign_tenant\|tenant_identity_mismatch" -- apps/*/src/i18n` prints nothing).
4. `WAITRON_TENANT_DOMAIN` → `WAITRON_VENUE_DOMAIN`, `config.tenantDomain` → `config.venueDomain`,
   `loadTenantDomain` → `loadVenueDomain` (`apps/server/src/config.ts:110-114, :228-238, :576`;
   `device-session.ts:34-73`; `device-api.ts:139, :323`; `boot.ts:2525`). Nothing outside
   `config.test.ts` sets it (environment.md :299); Waitron Cloud does not name it
   (`git -C ~/workspace/repos/waitron-cloud grep -n TENANT_DOMAIN` finds one design doc only).
5. Files renamed: `packages/db/src/read-tenant.ts` (+ test) → `read-taxpayer.ts`;
   `packages/db/src/schema/tenants.ts` → `taxpayer.ts`; `schema/tenants.singleton.test.ts` →
   `taxpayer.singleton.test.ts`; `schema/credentials/tenant-credentials.ts` → `venue-credentials.ts`;
   `packages/provisioning/src/tenant-guard.ts` (+ `.test.ts`, `.db.test.ts`) → `taxpayer-guard.*`;
   `apps/server/src/me-api.no-tenant.test.ts` → `me-api.no-taxpayer.test.ts`;
   `packages/payments-stripe/src/tenant-scoping.test.ts` → `venue-scoping.test.ts`. JSON keys that
   name these paths follow (`packages/db/mutation-costs.json:25, :52, :118`,
   `apps/server/test-durations.json:692`).
6. The wire key between two boxes in the mirror bundle, `tenant` → `taxpayer`
   (`apps/server/src/mirror-bundle.ts:56, :212`, `mirror-bundle-fetch.ts:39-56`); both boxes run
   one image after the reset. The provisioning plan's action kind `ensure-tenant` →
   `ensure-taxpayer` (`packages/provisioning/src/venue-plan.ts:66`, `venue-apply.ts:74, :116, :183`).
7. Every other identifier, local, comment and SQL string (live-update type names included:
   `apps/dashboard/src/api/live-queries.ts:511-527` read `"taxpayer"`), by the script's map below.
8. CLAUDE.md §3's "There is no tenant column" rule reworded (README U9), and the current-rule
   sentences in `docs/developers/` (Task 4). `scripts/no-tenant-column.test.ts` stays and keeps
   matching the retired column's spellings; only its header's first sentence changes.
9. The backlog entry "These index and key names still read `tenant`…"
   (`docs/backlog/architecture.md:281-293`) is rewritten to name which area slice renames each name
   (below), and its "(The `tenants*` … names are correct and stay.)" sentence is deleted.

## What it leaves out

| Left out | Owner |
| --- | --- |
| `registros_tenant_node_secuencia_uq`, `TenantTransport`, `tenantsWithWork`, `drain.tenant_skipped` | fiscal slice fi1 (README U9; [fi1](2026-11-08-a1308-fi1-verifactu-names.md) :77), owner lands |
| The fiscal pair (`packages/fiscal-verifactu/src/write-path.e2e.test.ts`, `inmutabilidad.test.ts`) and the fiscal fixture names they import — `TENANT_A`, `TENANT_B`, `seedTenantWithSif`, `seedTenantNodeSif`, `seedTenants` (`packages/fiscal-verifactu/test/fixtures.ts:29-104, :297`) | fi1: the pair is never edited by a lane-landed PR (A1301 plan, "The fiscal pair"; `scripts/a1301-seed-codemod.mjs:92-97`). fi1 :105 assumes this PR renames them; its stop point 4 (:309) already says to leave them and tell the watcher — **coordination point 2** in the return |
| `persons_tenant_email_uq`, `_live_display_name_uq`, `_pending_email_uq`, `_google_subject_uq` | people, [pp4](2026-11-08-a1308-pp4-person-folded-keys.md) (renames to `persons_*_uq`; three are matched by name in `packages/identity/src/person-constraints.ts`) |
| `working_orders_tenant_status_idx`, `sales_tenant_issued_idx` | orders, [os1](2026-11-08-a1308-os1-order-numbers.md) :38 and [os8](2026-11-08-a1308-os8-sale-receipt-facts.md) :41 (`sales` is owner-landed) |
| `print_agents_tenant_node_key`, `purchase_invoices_tenant_received_idx` | devices and menu area slices: no plan names them yet — **coordination point 3** in the return. This PR does not take them: rules §7 keeps another area's tables out of this lane's PRs |
| The taxpayer's privacy columns leaving the row | vb2 |
| Non-secret fields leaving `venue_credentials` | environment slice [env4](2026-11-08-a1308-env4-unsealed-settings.md) |
| `server.credential_unusable`'s prefix (`docs/backlog/architecture.md:295`) | not in A1308's lists; it touches `packages/fiscal-verifactu/src/errors.ts`, so it is not folded into a lane-landed rename |

## The rename script

`scripts/a1308/rename-tenant.mjs`, with `scripts/a1308/rename-tenant.test.mjs`. Root coverage
measures `scripts/**/*.mjs` (`vitest.config.ts:119`), so the test must reach 98/98/98/95.

**Command line:** `node scripts/a1308/rename-tenant.mjs [--write]`. Without `--write` it prints
each path rename and each changed file and exits 1 when anything would change, 0 when nothing would
(so a second `--write` run followed by a plain run exits 0: the idempotency check). `--report`
prints every remaining `tenant` occurrence (case-insensitive) in the files it covers that is not a
shielded name, as `path:line: text`, and exits 1 if there is any.

**Files covered:** `git ls-files -z -- apps packages scripts`, minus:
`**/drizzle/**`; `packages/country-es/test-fixtures/**` (the frozen Madrid capture and its hashed
manifest, `seed.madrid-baseline.test.ts:88-89`); `apps/server/src/testing/fixtures/configuration-v1-*.json`
(a retired export format); the fiscal pair (two paths above); `scripts/no-tenant-column.test.ts`;
`scripts/a1308/**`; binary files by extension (`.png .jpg .jpeg .webp .gif .ico .pdf .woff .woff2
.db .sqlite .p12 .pfx`).

**Shielded names** (replaced by a placeholder before mapping and restored after, so they come out
unchanged): the four fiscal leftovers; the five fiscal fixture names; the eight other areas' index
names in the table above; the retired column's spellings the guards pin — `tenant_id`, `tenant_ids`,
`tenantId`, `tenantIds`, `tenantID`, `TenantId`, `source_tenant_id`, `sourceTenantId`; retired tables
and files named in history tests — `tenant_receipts`, `tenantReceipts`, `tenant_themes`,
`tenants_nif_key` (`packages/db/src/schema/nodes.test.ts:123`), `bootstrap-tenant`; and
`tenants_country_tax_id_key` (removed by hand, Task 3). Longest first, so `tenantsWithWork` is
shielded before `tenants` can match inside it.

**The map,** applied as ordered, case-sensitive substring replacements (first match wins, longest
first within each group):

| Group | From → to |
| --- | --- |
| Venue or box meaning | `WAITRON_TENANT_DOMAIN` → `WAITRON_VENUE_DOMAIN`; `TenantDomain` → `VenueDomain`; `tenantDomain` → `venueDomain`; `tenant_credentials` → `venue_credentials`; `tenantCredentials` → `venueCredentials`; `tenant-credentials` → `venue-credentials`; `TenantIncident` → `VenueIncident`; `tenantIncident` → `venueIncident`; `sumupClientForTenant` → `sumupClientForVenue`; `setupTenant` → `setupVenue`; `provisionTenant` → `provisionVenue`; `asTenant` → `asVenue`; `UnderNewTenant` → `UnderNewVenue`; `tenant-scoping` → `venue-scoping` |
| Taxpayer meaning | `tenants_singleton_ck` → `taxpayer_singleton_ck`; `TENANTS` → `TAXPAYERS`; `Tenants` → `Taxpayers`; `tenants` → `taxpayer`; `TENANT` → `TAXPAYER`; `Tenant` → `Taxpayer`; `tenant` → `taxpayer` |

`tenants` maps to the singular because it is the table's name in code and SQL (`schema/tenants.js`,
`from tenants t`, `tenants.id`); plural prose ("other tenants") becomes "other taxpayer", and Task 4
fixes such comments by hand. Path renames apply the same map to each tracked path's segments and use
`git mv`; content follows.

**Collision rule:** after the script, `tsc` may find a renamed local `taxpayer` (from `tenant` or
`tenants`) that clashes with an existing `taxpayer` in the same scope. Where both hold the same
value, delete the duplicate declaration; otherwise name the renamed one `taxpayerRow`. A renamed
`setupVenue`/`provisionVenue`/`asVenue` that clashes with an existing declaration in the same file
is renamed `setupTestVenue`/`provisionTestVenue`/`asTestVenue`. Each such edit is a hand edit,
listed in the PR description (rules §1). Measured 2026-11-08 at `a086eedfb7`: no file that names
`setupTenant`, `provisionTenant`, `setupTenantOnce` or `asTenant` also names its target.

## Files

Create: `scripts/a1308/rename-tenant.mjs`, `scripts/a1308/rename-tenant.test.mjs`.

Modify by script: ~790 files (measured: `git grep -l -i tenant -- apps packages scripts ':!**/drizzle/**' | wc -l`
printed 790 at `a086eedfb7`, 3,943 lines; batch 1 will have removed some).

Modify by hand:

- `packages/db/src/schema/taxpayer.ts` (after the script) — delete the `uniqueIndex(...)` line and
  its import if unused.
- `scripts/schema-constraints.test.ts:503` — delete `"tenants_country_tax_id_key"`.
- `apps/server/scripts/migration-baseline/controls.ts:432-448` — the "unique index columns changed"
  control re-pointed at `menu_periods_department_key`, rewriting `` (`id`,`department_id`) `` to
  `` (`department_id`) ``, expecting the same four lines with that index's name
  (`changed index menu_periods_department_key.columns[0].column`, `…columns[1].column`,
  `…columns[1].key`, `missing index menu_periods_department_key.columns[2]`). The appendix needs that
  index kept (tables-venuebox §7), so it is stable.
- `apps/server/scripts/demo-seed/seed.madrid-baseline.test.ts` and a new
  `apps/server/scripts/demo-seed/testing/madrid-renamed-tables.ts` (+ `.test.ts`):
  `madridWithRenamedTables(snapshot: CanonicalMadridSemantics, renames: Readonly<Record<string, string>>): CanonicalMadridSemantics`
  renames each table key, its count in each phase, and every foreign key's `table` naming it. The
  baseline test applies `{ tenants: "taxpayer", tenant_credentials: "venue_credentials" }` beside
  `madridWithRenamedColumns` (`:116-118`). If batch 1 or another slice already added a table-rename
  helper there, use it instead and do not create this file.
- `scripts/no-tenant-column.test.ts:10-12` — the header's first sentences say the taxpayer is "the
  single row of `taxpayer`". Nothing else in it changes.
- `CLAUDE.md:317` ("the tenant's legal name" → "the taxpayer's legal name") and `:539-542`, reworded
  to: "**Nothing is scoped by a taxpayer column: the taxpayer is the one row of `taxpayer` (id = 1,
  `taxpayer_singleton_ck`), and a query that wants it reads that row.** Guard:
  `scripts/no-tenant-column.test.ts`, weaker than its name — it matches the retired `tenant_id`
  column's spellings and skips test files."
- `docs/developers/conventions-data.md` — the write-path section (`:918-953`: its table list and
  the paragraph naming each writer) and the "There is no tenant column" section (`:3616-3622`), retitled "Nothing is
  scoped by a taxpayer column" with the CLAUDE.md wording; the superseded sections at `:3600` and
  `:4803` are history and stay.
- `docs/developers/conventions-ui.md:779, :2313`, `design-system.md:3816, :4480`,
  `products.md:950` ("tenant" → "taxpayer"), `authorised-cloud-restore-fixture.md:31` (unchanged:
  `TENANT_A` keeps its name until fi1). `grants-retirement-audit.md` is a dated record and stays.
- `docs/backlog.md:2544-2548` (the decision record): add one dated sentence, "Since A1308 vb1 the
  table is `taxpayer`"; do not rewrite the record.
- `docs/backlog/architecture.md:281-293` and `:716-719` as in "What it builds" 9.
- Comments the map made read wrongly ("other taxpayer", "multi-taxpayer"), found by
  `git diff -U0 | grep -E '^\+.*(//|\*).*taxpayer'` and read: delete the comment if it only retells
  the retired multi-tenant design (CLAUDE.md §1, "prefer deleting to rewording"), else fix its
  grammar.

Regenerated, never by hand: `packages/db/drizzle/**`, `scripts/migration-baseline-epoch.json`
(`pnpm --filter @waitron/server migration-baseline rebuild --set core`, slice 1a).

## Size

| Part | Counted (hand-written) |
| --- | --- |
| Script | ~180 |
| Script test | ~120 |
| Madrid table-rename helper and its test, baseline wiring | ~60 |
| Collision fixes, comment fixes (estimate) | ~80 |
| Schema index, guards, controls | ~20 |
| CLAUDE.md, docs, backlog | ~40 |
| **Total** | **~500** |

Not counted: the script's output (about 3,900 lines in about 790 files), the regenerated migration
files. About 3 hours; the implementer dispatch splits after Task 2 (rules §1, 150-call handover).

## Finish line

Read the `Tests` count of every Vitest run (CLAUDE.md §4).

1. `pnpm exec vitest run scripts/a1308/rename-tenant.test.mjs` passes; `node scripts/a1308/rename-tenant.mjs`
   (no `--write`) exits 0 on the branch; `node scripts/a1308/rename-tenant.mjs --report` exits 0.
2. The reviewer's check (rules §1): in a throwaway worktree of the base,
   `node scripts/a1308/rename-tenant.mjs --write`, then `git diff --stat <base>..<branch> -- apps packages scripts`
   differs from the worktree's diff only by the hand edits the PR lists.
3. `pnpm --filter @waitron/server migration-baseline rebuild --set core` prints `unchanged core` on
   the branch.
4. Root guards: `pnpm exec vitest run scripts/schema-constraints.test.ts scripts/write-path-tables.test.ts scripts/classification-complete.test.ts scripts/no-tenant-column.test.ts scripts/live-subscriptions.test.ts scripts/starting-migrations.test.ts scripts/append-only-triggers.test.ts scripts/behavioural-triggers.test.ts scripts/errors-reachable.test.ts scripts/english-only.test.ts scripts/personal-log-params.test.ts scripts/mutation-shard.test.mjs scripts/claude-md-pointers.test.ts`.
5. Focused suites (check `memory_pressure | grep free` first):
   `pnpm --filter @waitron/db exec vitest run src/read-taxpayer.test.ts src/schema/taxpayer.singleton.test.ts`;
   `pnpm --filter @waitron/provisioning exec vitest run src/taxpayer-guard.test.ts src/taxpayer-guard.db.test.ts src/venue-apply.test.ts src/cli.test.ts`;
   `pnpm --filter @waitron/credentials exec vitest run`;
   `pnpm --filter @waitron/server exec vitest run src/config.test.ts src/device-session.test.ts src/device-api.test.ts src/adopt.test.ts src/provision.test.ts src/mirror-bundle.test.ts src/mirror-bundle-api.test.ts src/me-api.no-taxpayer.test.ts src/configuration-transfer.test.ts scripts/demo-seed/seed.madrid-baseline.test.ts scripts/migration-baseline`.
6. The fiscal pair passes unedited: both print a `Tests` line, and
   `git diff --exit-code origin/main -- packages/fiscal-verifactu/src/write-path.e2e.test.ts packages/fiscal-verifactu/src/inmutabilidad.test.ts` exits 0.
7. From `apps/server`: `pnpm migration-baseline controls --reference <list B> --out <empty dir>`
   prints `PASS` for every control; `pnpm protection-list compare` prints exactly the next section.
8. The pre-push hook's typecheck passes (every package is in scope).

## Expected protection-list difference

Under each of the six `DIFF composition=… phase=… database=venue` headers, except `trigger` lines,
which appear only under the two `change-feed` headers; `node.db` prints nothing:

```text
missing index tenant_credentials.primary key(purpose)
missing index tenants_country_tax_id_key
missing table tenant_credentials
missing table tenants
extra index venue_credentials.primary key(purpose)
extra table taxpayer
extra table venue_credentials
```

Under the two `change-feed` headers also:

```text
missing trigger waitron_change_tenants_delete
missing trigger waitron_change_tenants_insert
missing trigger waitron_change_tenants_update
extra trigger waitron_change_taxpayer_delete
extra trigger waitron_change_taxpayer_insert
extra trigger waitron_change_taxpayer_update
```

Why: U9 renames both tables, so each prints whole as missing and extra (their CHECKs are part of
the table object); appendix §5 drops `tenants_country_tax_id_key`; `tenants` is a change source
(`CORE_OWN_CLASSIFICATION`, `packages/db/src/classification.ts:102, :492-498`) and
`tenant_credentials` is not (no module declares it, `apps/dashboard/src/api/live-queries.ts:147`).
`tenants`' integer key is the row id, so it has no index line.

**How this was made:** a simulation, not the real build. The `fiscal-verifactu` change-feed
`venue.db` built at `a086eedfb7` was copied, the two tables recreated under the new names, the index
and the three triggers dropped and recreated as above, and the copy compared through the tool's own
`readSchema` and `compareSchemaLists`; it printed exactly these 13 lines. Slice 5 changes the base;
a line this list lacks is a stop (rules §5.2).

## Assertions that change, by design (rules §4)

Each changes because U9 renames the name it asserts; the script makes the change:

- The error codes: `apps/server/src/adopt.test.ts:378, :471`, `provision.test.ts:380`,
  `packages/provisioning/src/cli.test.ts:714`, `tenant-guard.test.ts:22, :32`,
  `venue-apply.test.ts:207`.
- `server.config_invalid`'s `variable`: `apps/server/src/config.test.ts:384-407`.
- Live-update dependency names `"tenants"` → `"taxpayer"` in `apps/dashboard/src/api/live-queries.test.ts`.
- The mirror bundle's `tenant` key in `apps/server/src/mirror-bundle*.test.ts` and `adopt.test.ts`.
- Table names in raw SQL assertions (for example `packages/composition/src/credentials-backup-verification.test.ts:39-150`).

## Stop points (beyond rules §5)

1. `--report` lists an occurrence that is neither shielded nor fixable by the map, in a file outside
   `docs/`: ask whether it means taxpayer, venue or box before adding a map entry.
2. A test fails after the script for a reason other than a collision the rule above settles.
3. A file in the "covered" set holds recorded bytes another test hashes (like the Madrid capture):
   exclude it, do not edit it, and ask.
4. A slice that lands while this is in flight adds a new `tenant` name: rebase, re-run the script,
   and if the new name is not in the map, stop point 1.

## Area files for the package move

Agreed 2026-11-08: `apps/server`'s domain areas move into packages, each move paired with its A1308
area; A1453 sets the order. This list is by which tables each file mainly reads or writes; the move
design may regroup it. Tests travel with their files (`<name>.test.ts`, `<name>.*.test.ts`).

- **Taxpayer and venue:** `apps/server/src/venue-settings-api.ts`, `venue-details.ts`,
  `venue-detail-types.ts`, `venue-privacy.ts`, `venue-address.ts`, `venue-locale.ts`,
  `venue-time-zone.ts`, `venue-clock-preview.ts`, `venue-zone-context.ts`, `venue-zone-repair.ts`,
  `venue-zone-repair-api.ts`, `business-day-start.ts`, `business-day-changeover.ts`,
  `setup-opening-hours.ts`, `provision.ts`, `credentials.ts`, `email-settings-api.ts`.
- **Departments:** `department-receipt-api.ts`, `department-receipt-draft.ts`,
  `department-receipt-languages.ts`, `sale-operation-description.ts`,
  `operation-description-default.ts`, `receipt-logo.ts`.
- **Incidents:** `alerts.ts`, `alerts-api.ts`, `box-alert-email.ts`.
- **The box and the second box:** `adopt.ts`, `promote.ts`, `promote-api.ts`, `promoted-role.ts`,
  `promotion-operation.ts`, `break-glass.ts`, `break-glass-command.ts`, `reserved-identity.ts`,
  `membership-*.ts`, `mirror-*.ts`, `node-api.ts`, `node-config.ts`, `node-entry.ts`,
  `node-enrol-api.ts`, `node-identity.ts`, `node-membership-api.ts`, `node-operation-*.ts`,
  `peer-status-api.ts`, `start-peer-check.ts`, `boot-peer-check.ts`, `carry-on.ts`,
  `restricted-page.ts`, `restricted-start.ts`, `waiting-start.ts`, `rebuild-first-start.ts`,
  `deployment-guard.ts`, `deployment-holders.ts`, `sealed-state.ts`, `handover-*.ts`.
- Not this area (left for the batch 3 backup, recovery and file-layout slices, or fiscal):
  `backup-*.ts`, `recovery-*.ts`, `restore-*.ts`, `first-setup-*.ts`, `clock-*.ts`.

The opening-hours code already lives in `packages/venue-service` and moves nowhere.

**Where the move sits:** after vb1, so files move under their final names, and before vb2, so the
rest of the area is built in the new package. If the move design is not ready when vb1 lands, it
sits after vb9. No plan in this area moves a file between packages.

## Needs

- Outside this area: all of batch 1 (1a's rebuild command; 1b, 2, 3a/3b, 4a/4b, 5a–5g landed).
- In this area: none. vb2–vb9 come after it.

---

## Task 1: The script and its test

**Files:** create `scripts/a1308/rename-tenant.mjs`, `scripts/a1308/rename-tenant.test.mjs`.

**Interfaces — Produces:** `renameText(text: string): string` (shield, map, restore);
`renamePath(path: string): string`; `coveredFiles(paths: readonly string[]): string[]`;
`residuals(path: string, text: string): string[]` (the `--report` lines); `main(argv: string[]): Promise<number>`
(the exit status). Exported so the test calls them without spawning.

- [ ] **Step 1: Write the failing tests.** `rename-tenant.test.mjs`:
  - "maps the taxpayer names": `renameText("readTenant(tx) from tenants where tenants.id = 1; const tenant = …")`
    equals `"readTaxpayer(tx) from taxpayer where taxpayer.id = 1; const taxpayer = …"`.
  - "maps the venue and box names first": `WAITRON_TENANT_DOMAIN`, `tenantDomain`,
    `tenant_credentials`, `setupTenant()`, `TenantIncident` → `WAITRON_VENUE_DOMAIN`, `venueDomain`,
    `venue_credentials`, `setupVenue()`, `VenueIncident`.
  - "leaves every shielded name alone": each shielded name, alone and inside a sentence
    (`"tenantsWithWork > 0"`, `"registros_tenant_node_secuencia_uq"`, `"TENANT_A.nodeId"`,
    `"tenant_id"`), comes back byte for byte.
  - "is idempotent": `renameText(renameText(x)) === renameText(x)` for a fixture holding every map
    entry and every shielded name.
  - "renames paths": `renamePath("packages/db/src/read-tenant.ts")` →
    `"packages/db/src/read-taxpayer.ts"`; `"packages/db/src/schema/tenants.singleton.test.ts"` →
    `"…/taxpayer.singleton.test.ts"`; `"scripts/no-tenant-column.test.ts"` is not covered.
  - "skips what it must not touch": `coveredFiles([...])` drops a `drizzle/` path, a
    `test-fixtures/` path, both fiscal pair paths, a `.png`, and keeps an ordinary `.ts`.
  - "reports leftovers": `residuals("a.ts", "x tenant y\nTENANT_A\n")` → `["a.ts:1: x tenant y"]`.
  - "main exits 1 when a run would change something and 0 when not" (on a temporary git repository
    made in `mkdtemp`, with `GIT_DIR` and its family cleared, CLAUDE.md §4).
- [ ] **Step 2: Run** `pnpm exec vitest run scripts/a1308/rename-tenant.test.mjs` — FAIL (no module).
- [ ] **Step 3: Implement.** Placeholders are `\u0000S<n>\u0000`, which no tracked text holds.
- [ ] **Step 4: Run** it — PASS; then `pnpm exec vitest run --coverage scripts/a1308/rename-tenant.test.mjs`
  and read the file's row: 98/98/98/95 or better.
- [ ] **Step 5: Commit** `git commit -s -m "scripts: a rename script that retires the word tenant (A1308 vb1)"`.

## Task 2: Run it, regenerate, and fix the fallout

**Files:** the script's output; `packages/db/src/schema/taxpayer.ts`; `scripts/schema-constraints.test.ts`;
`apps/server/scripts/migration-baseline/controls.ts`; regenerated `packages/db/drizzle/**`,
`scripts/migration-baseline-epoch.json`.

- [ ] **Step 1:** From `apps/server` on the base, `pnpm protection-list list --out <A>` (rules §3).
- [ ] **Step 2:** `node scripts/a1308/rename-tenant.mjs --write`; commit the output alone:
  `git commit -s -m "Rename tenant to taxpayer, venue or box (script output, A1308 vb1)"`.
- [ ] **Step 3:** Hand edits: delete the unique index; delete its name from
  `schema-constraints.test.ts`; re-point the control. Run
  `pnpm --filter @waitron/server migration-baseline rebuild --set core`.
- [ ] **Step 4:** Typecheck each package the script changed, by name (`pnpm --filter <pkg> typecheck`
  for every package in `git diff --name-only HEAD~1 | cut -d/ -f1-2 | sort -u`; the pnpm
  changed-since filter matches nothing in a worktree, CLAUDE.md §2); fix collisions by the rule
  above.
- [ ] **Step 5:** Run Finish-line items 3, 4 and 5; fix only names. A failing assertion that is not
  in "Assertions that change" is rules §5.3.
- [ ] **Step 6: Commit** `git commit -s -m "taxpayer: drop the unique index one row cannot break; regenerate core"`.

## Task 3: The Madrid capture follows the renames

**Files:** `apps/server/scripts/demo-seed/testing/madrid-renamed-tables.ts`, `.test.ts`;
`apps/server/scripts/demo-seed/seed.madrid-baseline.test.ts`.

- [ ] **Step 1: Write the failing test** `madrid-renamed-tables.test.ts`: "renames a table, its phase
  counts and the foreign keys that name it" on a two-table snapshot; "leaves a table not in the map
  as it was".
- [ ] **Step 2: Run** `pnpm --filter @waitron/server exec vitest run scripts/demo-seed/testing/madrid-renamed-tables.test.ts` — FAIL.
- [ ] **Step 3: Implement**, and apply it in the baseline test before the column renames.
- [ ] **Step 4: Run** it and `scripts/demo-seed/seed.madrid-baseline.test.ts` — PASS.
- [ ] **Step 5: Commit** `git commit -s -m "demo seed: the Madrid capture reads the renamed tables"`.

## Task 4: Docs, CLAUDE.md, backlog, and the check

**Files:** as listed under "Modify by hand" for docs; the comments the map made read wrongly.

- [ ] **Step 1:** Make the doc and CLAUDE.md edits; fix or delete the comments.
- [ ] **Step 2:** `node scripts/a1308/rename-tenant.mjs --report` exits 0; `node scripts/a1308/rename-tenant.mjs`
  exits 0; `pnpm exec prettier --check CLAUDE.md`; root guard `scripts/claude-md-pointers.test.ts`.
- [ ] **Step 3:** `pnpm protection-list list --out <B>` and `compare --old <A> --new <B> --report <file>`;
  paste the report into the PR and mark each line against the prediction.
- [ ] **Step 4: Commit** `git commit -s -m "docs: the taxpayer row, not the tenant row"`.
