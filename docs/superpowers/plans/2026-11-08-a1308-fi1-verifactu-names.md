# A1308 fiscal 1: the Veri\*Factu tables take the module's name — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rename the six Veri\*Factu tables that keep their shape to `verifactu_*` names (design R12,
U9), with every index, CHECK and trigger following, and rename the fiscal module's four "tenant"
leftovers — changing nothing else. Every later fiscal plan uses the names this one sets.

**Architecture:** One committed, idempotent script, `scripts/a1308/fiscal-rename.mjs`, does the whole
rename from one name map: SQL names in strings, comments and documents; the drizzle table exports in
TypeScript; six schema file names and the imports that name them. The same map, applied to a
protection list, is the proof that nothing but names changed: the base list with the map applied
compares `EQUAL` with the branch's list.

**Tech stack:** Node 26 ESM, the root `typescript` (version 6) parser for TypeScript files,
drizzle-kit 0.31.11 through the slice 1a rebuild command, Vitest.

**Spec:** [design README](../specs/2026-11-02-rationalisation/README.md) §3 R12, §5 U9 (the
Veri\*Factu names and the fiscal module's tenant leftovers), §6 "The fiscal record's content is
untouched"; appendix [tables-fiscal.md](../specs/2026-11-02-rationalisation/tables-fiscal.md) §0
"The names" and "Renaming `registros_facturacion`". Every slice follows
[the slice rules](2026-11-08-a1308-slice-rules.md), cited as "rules §n".

**Base:** `main` after every other A1308 area has landed (build order: fiscal is last) and after
A802 and A1325. Line numbers below were read at `a086eedfb7`; a cite that no longer says what this
plan says is a stop (rules §5.1).

**Owner lands:** yes (rules §6: it renames `registros_facturacion`).

**Pull request's first line (rules §2):** "Every venue is reset: fiscal-verifactu; backups and
exports from before this cannot be restored or imported."

## Global Constraints

- Rules §1–§9 apply. The script's output is not counted against the size cap (rules §1); every edit
  made by hand after the script is listed in the pull request description.
- **The record is untouched.** `verifactu_records` keeps today's 38 columns, in the order slice 1a built, with
  the same 11 CHECKs, the same keys, the same three unique and three plain indexes, and the same
  append-only pair, under the new names (design §6). No column is renamed: column names are AEAT's
  (tables-fiscal §0).
- The fiscal pair (`packages/fiscal-verifactu/src/write-path.e2e.test.ts`, `inmutabilidad.test.ts`)
  changes only through the script's names; no hand edit touches it.
- No function changes behaviour. A test whose assertion must change for any reason other than a
  table, index, CHECK, trigger, file or identifier name in the map is a stop (rules §4, §5.3).
- Codex builds, Claude reviews (rules §7). The owner lands.

## Review Focus

1. **A protection that changed under a renamed name.** Task 4's "renamed base equals branch"
   comparison is the receipt; a reviewer re-runs it, not reads it.
2. **The script's `envios` rule.** `envios` is both a SQL name and a TypeScript identifier. Check the
   script renames the drizzle table export and never a property of some other object (the handover
   summary's `envios` counts, `ChainSummary.envios`, stay).
3. **Column order.** Slice 1a already rebuilt `fiscal-verifactu` in the TypeScript column order
   (1a plan, "Expected protection-list difference", the fiscal-verifactu row). Task 1 checks that a
   rebuild before the rename still changes nothing; otherwise the record's table text would change
   beyond its name. This plan reorders no column.
4. **Anything sent to AEAT.** The drain suites' request bodies must be byte-identical (they hold no
   table name).

---

## What it builds

- The renames (old → new; constraint names follow the table, so a search for either finds the map):

  | Table | New name |
  | --- | --- |
  | `registros_facturacion` | `verifactu_records` |
  | `envios` | `verifactu_submissions` |
  | `registro_sif` | `verifactu_identities` |
  | `envio_flujo` | `verifactu_sending_state` |
  | `fiscal_certificate_installs` | `verifactu_certificates` |
  | `fiscal_series_conflicts` | `verifactu_series_conflicts` |

  Every index and CHECK named after one of them takes the new prefix
  (`registros_identidad_uq` → `verifactu_records_identidad_uq`, `envios_estado_ck` →
  `verifactu_submissions_estado_ck`, and so on: the full list is the map in Task 2). The append-only
  triggers follow by themselves: their names and bodies are built from the table name
  (`appendOnlyTriggers`, `packages/store/src/append-only.ts:68-84`).
- The fiscal module's tenant leftovers (design U9): `registros_tenant_node_secuencia_uq` →
  `verifactu_records_node_secuencia_uq`; `TenantTransport` → `AeatTransport`
  (`packages/fiscal-verifactu/src/aeat-transport.ts:85`); `DrainResult.tenantsWithWork` →
  `passesWithWork`, still a count, 0 or 1 (`drain.ts:175`; the backlog entry asks to keep the
  "did this pass have due work" meaning, and the number keeps every `toBe(0)`/`toBe(1)` assertion
  as it is); the log line `drain.tenant_skipped` → `drain.skipped` (`apps/server/src/pass.ts:85`).
- The fiscal fixtures named "tenant", which the venue-and-box slice deliberately left to this pull
  request because the fiscal pair (`write-path.e2e.test.ts`, `inmutabilidad.test.ts`) imports them
  and a lane-landed pull request does not edit the pair
  ([vb1](2026-11-08-a1308-vb1-taxpayer-names.md):79): `TENANT_A` → `TAXPAYER_A`, `TENANT_B` →
  `TAXPAYER_B`, `seedTenantWithSif` → `seedTaxpayerWithSif`, `seedTenantNodeSif` →
  `seedTaxpayerNodeSif`, `seedTenants` → `seedTaxpayers` (`packages/fiscal-verifactu/test/fixtures.ts:29-104`,
  `:297`), following vb1's "taxpayer meaning" map (`TENANT` → `TAXPAYER`, `Tenant` → `Taxpayer`,
  vb1 :120). About 690 lines at `a086eedfb7` (`TENANT_A` 405, `seedTenantWithSif` 104,
  `seedTenants` 93, `seedTenantNodeSif` 72, `TENANT_B` 19, in `packages/fiscal*`; more in
  `apps/server` tests that import them).
- The drizzle exports, so code and SQL use one name: `registrosFacturacion` → `verifactuRecords`,
  `envios` → `verifactuSubmissions`, `registroSif` → `verifactuIdentities`, `envioFlujo` →
  `verifactuSendingState`, `fiscalCertificateInstalls` → `verifactuCertificates`,
  `fiscalSeriesConflicts` → `verifactuSeriesConflicts`; and their files under
  `packages/fiscal-verifactu/src/schema/`: `registros.ts` → `verifactu-records.ts`, `envios.ts` →
  `verifactu-submissions.ts`, `sif.ts` → `verifactu-identities.ts`, `envio-flujo.ts` →
  `verifactu-sending-state.ts`, `certificate-installs.ts` → `verifactu-certificates.ts`,
  `series-conflicts.ts` and its test → `verifactu-series-conflicts.ts` / `.test.ts`.
- `fiscal-verifactu`'s starting migration rebuilt with the slice 1a command (rules §2). Slice 1a
  already made the built column order the TypeScript order, so the rebuild changes names only.
- CLAUDE.md §5's rule renamed, and CLAUDE.md §3's `column-vocabulary` exception path.

## What it leaves out

| Left out | Who takes it |
| --- | --- |
| Dropping `registros_node_secuencia_idx` (renamed here to `verifactu_records_node_secuencia_idx`) | fi2, with the chain-head read it serves |
| Every merge, deletion and new column of the area | fi2–fi10 |
| `invoice_series`, `daily_closes`, `sales.fiscal_*` | Stay generic (design U9); `daily_closes` is A1325's |
| Column names (`secuencia`, `huella`, `estado`…) | Never: they are AEAT's (tables-fiscal §0) |
| `EnvioState`, `isEnvioState`, the `ChainSummary.envios` field, Spanish function names | Not table names; unchanged |
| The `tenant` local variables and `readTenant` callers in the fiscal packages | Whatever the venue-and-box slice did to `readTenant` stands; locals follow their helper, not this map |
| `registros_devueltos`, `envios_devueltos` (A1018 slice 11) | Not on `main` at `a086eedfb7`. If they have landed, stop (below) |
| Waitron Cloud's code and fixtures that read these tables by name. In `waitron-cloud` at `9dd901b59` (2026-11-08), `git grep -lw "registros_facturacion\|registro_sif\|envio_flujo\|fiscal_certificate_installs\|fiscal_series_conflicts\|envios\|registrosFacturacion\|registroSif"` lists `deploy/test-cloud/test-fixtures/integration-authorised-recovery.test.ts`, `integration-continuous-recovery.test.ts`, `scripts/cloud-cost/waitron-adapter.mjs`, `waitron-adapter.test.mjs`, and `scripts/cloud-cost/fixtures/` `cadence-conformance.test.mjs`, `private-replay-conformance.test.mjs`, `replay-conformance.test.mjs`, `replay-series-fixture.mjs`, `source-bills-conformance.test.mjs` (plus `docs/reference/2026-07-31-cloud-storage-model-design.md`, historical, left alone) | The Cloud lane, in step with this pull request (design U11 "Waitron Cloud"); the plan's map file is what it applies. It re-runs that grep on its own `main` first |
| Historical documents (`docs/superpowers/**`, `docs/research/**`, `docs/operations/**`, `docs/developers/grants-retirement-audit.md`) | Never rewritten (CLAUDE.md §6 "Historical docs record what was true when written") |
| Quoted receipts in `docs/developers/` and `docs/compliance/` (dated measurements, quoted plan lines, experiments) | Not renamed: Task 5 Step 0 renames only sentences about today's behaviour there and gives each receipt a one-line dated pointer (CLAUDE.md §6) |
| Moving the area's server files into a package | The CI redesign (build order, batch 2); this plan only lists them, below |

### Area files for the package move

Fiscal-area files under `apps/server/src` at `a086eedfb7` (non-test), for the CI redesign's package
move; this plan moves none of them: `cert-expiry.ts`, `certificate-reminder-email.ts`,
`certificate-reminder-worker.ts`, `chain-height.ts`, `fiscal-certificate-api.ts`,
`fiscal-certificate-diagnosis-dispatch.ts`, `fiscal-certificate-diagnosis-entry.ts`,
`fiscal-certificate-diagnosis-runner.ts`, `fiscal-certificate-diagnosis-runtime.ts`,
`fiscal-readiness-runner.ts`, `fiscal-readiness.ts`, `fiscal-reconciliation.ts`, `issuance-pass.ts`,
`pass.ts`, `reconcile-duty.ts`, `recovery-fiscal-selection.ts`, `first-fiscal-activation.ts`,
`first-fiscal-delivery.ts`, `first-fiscal-evidence.ts`, `first-fiscal-mode.ts`,
`setup-first-fiscal-api.ts`, and the clock-stop files `clock-challenges.ts`, `clock-correction.ts`,
`clock-disagrees-alert.ts`, `clock-start-up.ts`, `clock-sync-alert.ts`, `clock-watch.ts`,
`clock-witnesses.ts`, `till-box-clock-api.ts`, `till-clock-api.ts`, `till-clock-state.ts`,
`venue-clock-preview.ts`. 136 test files under `apps/server/src` match the same name patterns. Which
of the `first-fiscal-*` and clock files belong to venue-and-box instead is the redesign's call.

## Files

**Create**
- `scripts/a1308/fiscal-rename.mjs` — the script (Task 2).
- `scripts/a1308/fiscal-rename-map.json` — the map, read by the script and by the Cloud lane.
- `scripts/a1308/fiscal-rename.test.mjs` — its tests (root Vitest project).

**Modify by hand**
- `apps/server/scripts/demo-seed/seed-sales.golden.test.ts:220-221` (Task 3 Step 4): the object keys
  `registros_facturacion` and `envios` are TypeScript property names, which the script does not
  rename, while the golden file's keys (`testing/spanish-practice-sales.golden.json:2805`, `:3799`)
  are JSON text, which it does. Rename the two keys to `verifactu_records` and
  `verifactu_submissions` so the comparison at `:248` still holds.
- `docs/developers/conventions-data.md`, `docs/developers/testing-guide.md`,
  `docs/compliance/asesor-questions.md`, `docs/compliance/verifactu-faq-notes.md`,
  `docs/compliance/verifactu-findings.md` (Task 5 Step 0: today's-behaviour sentences renamed,
  receipts given a dated pointer).
- `scripts/append-only-triggers.test.ts:34-80` (re-sort `EXPECTED` after the script: it is compared
  sorted, `:215`).
- `apps/server/scripts/demo-seed/seed.madrid-baseline.test.ts` (the capture adapter; Task 3).
- `docs/backlog/architecture.md:281-293` and `:305-310` and the "What A1308 retires" line for
  `DrainResult.tenantsWithWork` (Task 5).
- `apps/server/README.md:676`, `:736`, `:751` (the log line's name and meaning, Task 5 — the script
  renames the word; the hand edit checks the sentences still read true).

**Changed by the script** (uncounted): every tracked file under `apps/`, `packages/`, `scripts/`
(minus `scripts/a1308/` and `scripts/english-only.test.ts`, whose strings are Spanish-word fixtures,
`scripts/english-only.test.ts:336-456`), `deploy/`, `CLAUDE.md`, `docs/backlog.md`,
`docs/backlog/`; never `**/drizzle/**` (rebuilt instead), `packages/country-es/test-fixtures/**`
(hashed captures, `seed.madrid-baseline.test.ts:91`), `docs/developers/` or `docs/compliance/`
(they mix today's-behaviour sentences with quoted receipts, such as the plan lines quoted at
`conventions-data.md:4073` and `:4078` and the 2026-10-12 experiment at `:1743-1748`, which record
what was printed then; Task 5 Step 0 edits them by hand). Measured at `a086eedfb7`: `registros_facturacion` alone is on
657 lines in 233 files under `apps`, `packages` and `scripts` outside `drizzle/`
(`git grep -cw`); with `envios` (662 lines, 136 files), `registro_sif` (237, 93) and the rest, about
1,700 lines.

**Generated** (uncounted): `packages/fiscal-verifactu/drizzle/0000_baseline.sql`,
`packages/fiscal-verifactu/drizzle/meta/*`, `scripts/migration-baseline-epoch.json`.

## Size

| Counted (hand-written) | Lines, estimated |
| --- | --- |
| Script 240 (map JSON 70 of it), `EXPECTED` re-sort 10, demo-baseline adapter 30, golden keys 2, backlog and README 25, `docs/developers` and `docs/compliance` hand edits 30 (22 lines found, below, plus pointers) | ~337 |
| Tests: script tests 130; fixes the typecheck and the suites find after the script, budgeted 80 | ~210 |
| **Total** | **~547** |

Not counted: the script's output (about 1,700 lines of table names plus about 690 of fixture names), the generated migration. About 3 hours,
most of it running suites.

## Finish line

```bash
node scripts/a1308/fiscal-rename.mjs --check            # prints "nothing to change", exit 0
pnpm exec vitest run scripts/a1308/fiscal-rename.test.mjs scripts/append-only-triggers.test.ts scripts/schema-constraints.test.ts scripts/classification-complete.test.ts scripts/behavioural-triggers.test.ts scripts/starting-migrations.test.ts scripts/migration-upgrade.test.ts scripts/no-till-as-issuer.test.ts scripts/column-vocabulary.test.ts scripts/apply-migrations-callers.test.ts scripts/claude-md-pointers.test.ts scripts/write-path-tables.test.ts
pnpm --filter @waitron/fiscal-verifactu typecheck && pnpm --filter @waitron/server typecheck && pnpm --filter @waitron/fiscal typecheck && pnpm --filter @waitron/fiscal-none typecheck
pnpm --filter @waitron/fiscal-verifactu exec vitest run src/inmutabilidad.test.ts src/chain.test.ts src/verify.test.ts src/write-path.e2e.test.ts src/correction-path.e2e.test.ts src/void-path.e2e.test.ts src/canje-path.e2e.test.ts src/substitution-path.e2e.test.ts src/sale-amount.huella.test.ts src/money-conversion.huella.test.ts src/correction-amount.huella.test.ts src/registro-row.roundtrip.test.ts src/backup-verification-chain.test.ts src/drain.test.ts src/drain.names.test.ts src/drain.record-versions.test.ts src/outbox.drain.test.ts src/backend.record-versions.test.ts src/handover-summary.test.ts src/schema-ownership.test.ts src/classification.test.ts
pnpm --filter @waitron/server exec vitest run src/pass.test.ts src/awaiting-fiscal-cert.test.ts src/onboarding-policy.test.ts src/chain-height.test.ts scripts/demo-seed/seed.madrid-baseline.test.ts scripts/demo-seed/seed-sales.golden.test.ts
pnpm --filter @waitron/composition exec vitest run src/composition.test.ts
git grep -nw "registros_facturacion\|registro_sif\|envio_flujo\|fiscal_certificate_installs\|fiscal_series_conflicts\|registrosFacturacion\|registroSif\|TenantTransport\|tenantsWithWork\|tenant_skipped\|TENANT_A\|TENANT_B\|seedTenantWithSif\|seedTenantNodeSif\|seedTenants" -- apps packages scripts CLAUDE.md ':!**/drizzle/**' ':!packages/country-es/test-fixtures/**' ':!scripts/a1308/**' ':!scripts/english-only.test.ts' ':!apps/server/scripts/demo-seed/seed.madrid-baseline.test.ts'
```

The last prints nothing. Each Vitest run shows a `Tests` count with no failures (CLAUDE.md §4).

**The fiscal record suites.** The `@waitron/fiscal-verifactu` line above is named "fi1's record
suites" in every later fiscal plan: the immutability, chain, art. 7.i verification, the five
issuance paths end to end, the hash vectors, the row round trip, the backup chain walk, and the
drain's request bodies. Each later plan runs them unchanged.

## Expected protection-list difference

**The proof (Task 4):** the base list with the script's map applied
(`node scripts/a1308/fiscal-rename.mjs --protection-list <A> <A'>`) compared with the branch's list
prints exactly `EQUAL`. Anything else is a stop.

**The raw comparison** (base against branch, no map) prints three headers, all
`composition=fiscal-verifactu … database=venue`; nothing for `fiscal-none` or `node.db`. Produced on
2026-11-08 by applying the map to a list of `a086eedfb7` (scratch, not committed), so it is a
prediction: re-derive it if the base moved (stop 1).

`phase=sql-only` (66 lines, in the tool's order):

```text
missing index envios.primary key(registro_id)
missing index envios_confirmado_idx
missing index envios_drenaje_idx
missing index fiscal_certificate_installs.primary key(id)
missing index fiscal_certificate_installs_node_idx
missing index fiscal_series_conflicts.primary key(id)
missing index fiscal_series_conflicts_invoice_uq
missing index registro_sif.primary key(id)
missing index registro_sif_activo_uq
missing index registro_sif_instalacion_uq
missing index registros_corrects_registro_uq
missing index registros_facturacion.primary key(id)
missing index registros_generado_idx
missing index registros_identidad_uq
missing index registros_node_secuencia_idx
missing index registros_sale_idx
missing index registros_tenant_node_secuencia_uq
missing table acks.foreignKeys[registro_id->registros_facturacion(id)]
missing table cadenas.foreignKeys[ultimo_registro_id->registros_facturacion(id)]
missing table clock_confirmations.foreignKeys[registro_id->registros_facturacion(id)]
missing table clock_stop_restarts.foreignKeys[registro_id->registros_facturacion(id)]
missing table envio_flujo
missing table envios
missing table filing_case_events.foreignKeys[remedy_registro_id->registros_facturacion(id)]
missing table filing_cases.foreignKeys[registro_id->registros_facturacion(id)]
missing table fiscal_allocations.foreignKeys[sif_id->registro_sif(id)]
missing table fiscal_certificate_installs
missing table fiscal_certificate_reminders.foreignKeys[install_id->fiscal_certificate_installs(id)]
missing table fiscal_conflict_evidence.foreignKeys[registro_id->registros_facturacion(id)]
missing table fiscal_lookup_conflicts.foreignKeys[registro_id->registros_facturacion(id)]
missing table fiscal_series_conflicts
missing table registro_sif
missing table registros_facturacion
extra table acks.foreignKeys[registro_id->verifactu_records(id)]
extra table cadenas.foreignKeys[ultimo_registro_id->verifactu_records(id)]
extra table clock_confirmations.foreignKeys[registro_id->verifactu_records(id)]
extra table clock_stop_restarts.foreignKeys[registro_id->verifactu_records(id)]
extra table filing_case_events.foreignKeys[remedy_registro_id->verifactu_records(id)]
extra table filing_cases.foreignKeys[registro_id->verifactu_records(id)]
extra table fiscal_allocations.foreignKeys[sif_id->verifactu_identities(id)]
extra table fiscal_certificate_reminders.foreignKeys[install_id->verifactu_certificates(id)]
extra table fiscal_conflict_evidence.foreignKeys[registro_id->verifactu_records(id)]
extra table fiscal_lookup_conflicts.foreignKeys[registro_id->verifactu_records(id)]
extra index verifactu_certificates.primary key(id)
extra index verifactu_certificates_node_idx
extra index verifactu_identities.primary key(id)
extra index verifactu_identities_activo_uq
extra index verifactu_identities_instalacion_uq
extra index verifactu_records.primary key(id)
extra index verifactu_records_corrects_registro_uq
extra index verifactu_records_generado_idx
extra index verifactu_records_identidad_uq
extra index verifactu_records_node_secuencia_idx
extra index verifactu_records_node_secuencia_uq
extra index verifactu_records_sale_idx
extra index verifactu_series_conflicts.primary key(id)
extra index verifactu_series_conflicts_invoice_uq
extra index verifactu_submissions.primary key(registro_id)
extra index verifactu_submissions_confirmado_idx
extra index verifactu_submissions_drenaje_idx
extra table verifactu_certificates
extra table verifactu_identities
extra table verifactu_records
extra table verifactu_sending_state
extra table verifactu_series_conflicts
extra table verifactu_submissions
```

`phase=migrated` and `phase=change-feed` (identical, 78 lines each): the 66 above, plus, after
`missing table registros_facturacion`,

```text
missing trigger fiscal_certificate_installs_append_only_delete
missing trigger fiscal_certificate_installs_append_only_update
missing trigger fiscal_series_conflicts_append_only_delete
missing trigger fiscal_series_conflicts_append_only_update
missing trigger registros_facturacion_append_only_delete
missing trigger registros_facturacion_append_only_update
```

and, at the end,

```text
extra trigger verifactu_certificates_append_only_delete
extra trigger verifactu_certificates_append_only_update
extra trigger verifactu_records_append_only_delete
extra trigger verifactu_records_append_only_update
extra trigger verifactu_series_conflicts_append_only_delete
extra trigger verifactu_series_conflicts_append_only_update
```

No change-feed trigger appears: the fiscal module declares no live-update source. No `changed` line
appears for any table: slice 1a made the built column order the TypeScript order, this plan moves
no column, and Task 1 checks a rebuild before the rename changes nothing. Design reason for every line: README U9 and R12
("Every index, CHECK and trigger takes its table's new name", tables-fiscal §0); tables-fiscal §5
rows for each renamed table ("unchanged … The trigger pair is rebuilt from the new name").

## Stop points (beyond rules §5)

1. `git diff --stat a086eedfb7 HEAD -- packages/fiscal-verifactu/src/schema packages/fiscal-verifactu/drizzle`
   prints anything other than the slice 1a and other A1308 changes this plan names: the raw
   prediction was made at `a086eedfb7`. Ask the watcher for a re-derived one (the map proof still
   applies).
2. Any change to the bytes of a record's hashed fields, to what is sent to AEAT, or to which
   identity or series a sale uses: any of fi1's record suites fails, or needs an edit beyond the map.
3. `git grep -lw "registros_devueltos\|envios_devueltos" -- packages` finds a table: A1018 slice 11
   landed first, and the map needs its two tables (proposed `verifactu_returned_records`,
   `verifactu_returned_submissions`) and their constraint names, which the watcher confirms. (The
   owner confirmed fi1's naming on 2026-11-09: names follow the renamed tables, `passesWithWork`,
   and these two proposed names.)
4. A fixture name in the map was already renamed to something else by an earlier slice (the
   script finds neither the old nor the map's new name): use the name on `main`, drop the pair from
   the map, and tell the watcher.
5. Task 4's map comparison prints anything but `EQUAL`.
6. A suite outside the Finish line fails for a reason other than a name (for example a digest over
   exported rows that includes a table name). Report it; do not edit its assertion.

## Needs

Every other A1308 area, A802 and A1325 (build order). Slice 1a's rebuild command
(`pnpm --filter @waitron/server migration-baseline rebuild --set fiscal-verifactu`). Slice 0's
protection list.

**Landed by: owner.**

---

### Task 0: record the base protection list

- [ ] **Step 1:** In a throwaway worktree of the base commit (`git worktree add --detach <dir> <base-sha>`,
  `pnpm install`), from its `apps/server`: `pnpm protection-list list --out <empty absolute dir A>`.
  Keep `A` for Task 4.

### Task 1: check that a rebuild before the rename changes nothing

Slice 1a rebuilt every set from its TypeScript schema, so `registros_facturacion` and `envios`
already hold their columns in the TypeScript order (1a plan, "Expected protection-list difference":
`corrects_registro_id` second, `technical_incidence` beside `incidencia`). This plan moves no column.
Reordering them back to the order A760 preserved would print `columnOrder` lines against a base
that 1a already rebuilt. This task only confirms the base is in step, so that Task 4's map proof
compares names and nothing else.

**Files:** none changed.

- [ ] **Step 1:** On the branch, before Task 2:
  `pnpm --filter @waitron/server migration-baseline rebuild-check --set fiscal-verifactu` exits 0,
  and `pnpm --filter @waitron/server migration-baseline rebuild --set fiscal-verifactu` prints
  `unchanged fiscal-verifactu` with `git status --porcelain` empty (the 1a command's own
  "nothing to do" answer, 1a plan "Finish line" item 1).
- [ ] **Step 2:** If Step 1 printed `rebuilt fiscal-verifactu` instead, from `apps/server` run
  `pnpm protection-list list --out <B1>` and
  `pnpm protection-list compare --old <A> --new <B1> --report <file>`. **Passing:** `EQUAL` (only
  the generated text or its date moved); discard the rebuilt files (`git checkout -- packages/fiscal-verifactu/drizzle scripts/migration-baseline-epoch.json`)
  and go on. **Failing:** any line, a `columnOrder` line included: the base's generated files are
  out of step with its schema, which this plan did not cause. Stop (rules §5.1) and ask the watcher.
- [ ] No commit.

### Task 2: the rename script

**Files:** create `scripts/a1308/fiscal-rename.mjs`, `fiscal-rename-map.json`,
`fiscal-rename.test.mjs`.

**Interfaces:**

```text
node scripts/a1308/fiscal-rename.mjs            # rewrite the tree; prints each changed file
node scripts/a1308/fiscal-rename.mjs --check    # change nothing; exit 1 and list files if anything would change
node scripts/a1308/fiscal-rename.mjs --protection-list <in dir> <out dir>
                                                # write <out>/protection-list.json: <in>'s with the sql map applied
```

`fiscal-rename-map.json` has five keys:

- `sql` — exact SQL names, whole word (`(?<![A-Za-z0-9_])name(?![A-Za-z0-9_])`), longest first. The
  JSON holds every pair spelled out in full (old → new, no pattern applied at run time), so the
  reviewer reads the result, not a rule. The pairs: the six tables;
  `registros_facturacion_source_ck` → `verifactu_records_source_ck` and
  `registros_facturacion_source_device_ck` → `verifactu_records_source_device_ck` (the whole
  `registros_facturacion_` prefix is replaced, never only `registros_`, which would give
  `verifactu_records_facturacion_source_ck`); `registros_tipo_registro_ck`,
  `registros_tipo_huella_ck`, `registros_huella_ck`,
  `registros_secuencia_ck`, `registros_entorno_ck`, `registros_tipo_rectificativa_ck`,
  `registros_tipo_factura_rectificativa_ck`, `registros_facturas_sustituidas_f3_ck`,
  `registros_encadenamiento_ck`, `registros_corrects_registro_uq`, `registros_identidad_uq`,
  `registros_sale_idx`, `registros_node_secuencia_idx`, `registros_generado_idx` (each: the
  `registros_` prefix → `verifactu_records_`, so `registros_huella_ck` → `verifactu_records_huella_ck`);
  `registros_tenant_node_secuencia_uq` →
  `verifactu_records_node_secuencia_uq`; `envios_estado_ck`, `envios_drenaje_idx`,
  `envios_confirmado_idx` (→ `verifactu_submissions_<rest>`); `envio_flujo_singleton_ck` →
  `verifactu_sending_state_singleton_ck`; `registro_sif_numero_ck`, `registro_sif_instalacion_uq`,
  `registro_sif_activo_uq` (→ `verifactu_identities_<rest>`); `fiscal_certificate_installs_source_ck`,
  `_kind_ck`, `_dashboard_ck`, `_node_idx` (→ `verifactu_certificates_<rest>`);
  `fiscal_series_conflicts_invoice_uq` → `verifactu_series_conflicts_invoice_uq`; and the
  `<old table>_append_only_update` / `_delete` names of the three append-only tables. Every name
  was read from `0000_baseline.sql` at `a086eedfb7`. The script refuses to run when, for some `sql`
  pair, neither the old nor the new name is a whole-word match in
  `packages/fiscal-verifactu/drizzle/0000_baseline.sql` (a typo in the map would otherwise rename
  nothing, silently); before the rename the old name is there, after it the new one.
- `identifiers` — TypeScript identifiers, whole token: the six drizzle exports above (with `envios`
  under the rule below), `TenantTransport` → `AeatTransport`, `tenantsWithWork` → `passesWithWork`,
  and the five fixture names above.
- `strings` — exact text in string literals and documents: `drain.tenant_skipped` → `drain.skipped`.
- `files` — the six schema file moves above, as repository paths.
- `keep` — exact text the script never rewrites, as `{ "file": <repository path>, "text": <exact
  substring> }` pairs; the script refuses to run if a `text` is not found in its file (a stale
  entry would otherwise protect nothing, silently). One entry at `a086eedfb7`:
  `docs/backlog/architecture.md`, "including `registros` and `envios`".

Decisions the implementer cannot make alone:

- **Files it reads:** `git ls-files` within the scope in "Files" above, with extensions `.ts`,
  `.mts`, `.mjs`, `.js`, `.json`, `.md`, `.sql`, `.sh`, `.yml`, `.yaml`.
- **TypeScript and JavaScript files** are parsed with `ts.createSourceFile` from the root
  `typescript` package (`node -e "require('typescript').version"` prints `6.0.3`). Edits are
  collected as `[start, end, text]` and applied from the end:
  - every `Identifier` whose text is an `identifiers` key other than `envios` is renamed;
  - `envios` is renamed to `verifactuSubmissions` only in a file that imports a binding named
    `envios`, declares `export const envios`, or re-exports it (`export { envios } from "…"`, as
    `packages/fiscal-verifactu/src/schema/index.ts:14` and `src/index.ts:30` do; both names of an
    export specifier are renamed), and only where the identifier is not the name of a
    property access, a property assignment, a property signature, or a binding element's property
    name. Elsewhere `envios` as an identifier is left alone. Without the re-export case the barrel
    files keep exporting `envios` while every importer asks for `verifactuSubmissions`, and the
    typecheck fails;
  - string literals, no-substitution templates, template heads, middles and tails, and every
    comment (collected with `ts.getLeadingCommentRanges`/`getTrailingCommentRanges` at each node,
    de-duplicated by position) get the `sql` and `strings` maps as text;
  - a module specifier that resolves, relative to the importing file, to a moved file is rewritten to
    the new path, keeping its extension style; so is a package deep import of a moved file,
    `@waitron/fiscal-verifactu/src/schema/<old>.js` → `…/<new>.js` (24 such imports at
    `a086eedfb7`, all in tests:
    `git grep -n "@waitron/fiscal-verifactu/src/schema/\(registros\|envios\|sif\|envio-flujo\|certificate-installs\|series-conflicts\)" -- apps packages scripts`).
- **Other files** (`.md`, `.json`, `.sql`, `.sh`, `.yml`, `.yaml`) get the `sql` and `strings` maps
  as text, the `identifiers` map whole word **except `envios`**, and the `files` map's repository
  paths as text. In these files the `sql` map wins for `envios` (→ `verifactu_submissions`).
  Applying the `identifiers` pair there too would make the result depend on which map ran first.
  In scope at `a086eedfb7` there are three whole-word hits outside TypeScript (`git grep -nw envios`
  over the non-TypeScript files in scope): the golden file's key
  (`spanish-practice-sales.golden.json:3799`) and `docs/backlog/architecture.md:1221` name the table;
  `docs/backlog/architecture.md:773` names Spanish variable names in server tests, not the table,
  so it goes in `keep` (above). A hand edit after the script would not do: `--check` would rename
  it again and the Finish line's first command would fail.
- **Moves** use `git mv` and skip a pair whose source is gone and whose target exists.
- **Idempotent:** a second run prints nothing and `--check` exits 0 (no old name remains to match;
  every new name is outside every key).

- [ ] **Step 1: Write the failing tests** in `scripts/a1308/fiscal-rename.test.mjs`, on fixture text
  passed to the script's exported `renameSource(path, text, context)` and `renameDocument(text)`:
  - "renames the table inside SQL strings and templates": `` sql`select * from envios e join registros_facturacion r on r.id = e.registro_id` ``
    becomes `verifactu_submissions` and `verifactu_records`.
  - "renames the drizzle export where it is imported": `import { envios } from "./schema/envios.js"; db.select().from(envios).where(eq(envios.estado, "x"))`
    becomes `import { verifactuSubmissions } from "./schema/verifactu-submissions.js"; … .from(verifactuSubmissions) … eq(verifactuSubmissions.estado, "x")`.
  - "leaves another object's `envios` property alone": `summary.envios.aceptado` and
    `type S = { envios: number }` are unchanged in a file that also imports `envios`.
  - "leaves `envios` identifiers alone where the table is not imported".
  - "renames a re-exported `envios`": `export { envios } from "./envios.js";` becomes
    `export { verifactuSubmissions } from "./verifactu-submissions.js";`.
  - "rewrites a package deep import of a moved file":
    `import { registroSif } from "@waitron/fiscal-verifactu/src/schema/sif.js";` becomes
    `import { verifactuIdentities } from "@waitron/fiscal-verifactu/src/schema/verifactu-identities.js";`.
  - "replaces the whole `registros_facturacion_` prefix": `registros_facturacion_source_ck` becomes
    `verifactu_records_source_ck`, never `verifactu_records_facturacion_source_ck`.
  - "gives `envios` the table name outside TypeScript": in a `.json` document, `"envios": [` becomes
    `"verifactu_submissions": [`.
  - "leaves `keep` text alone": a document holding a `keep` entry's text keeps it; a `keep` text
    missing from its file makes the script refuse.
  - "renames comments": `// one envios row per registros_facturacion row` → new names.
  - "renames constraint names whole-word only": `registros_identidad_uq` changes;
    `registros_identidad_uq_extra` does not; `waitron_change_envios_insert` does not (not in the map).
  - "applies the protection-list map": a two-object JSON fixture's names change and its other text
    does not.
  - "is idempotent": each fixture's output run again is unchanged.
- [ ] **Step 2:** `pnpm exec vitest run scripts/a1308/fiscal-rename.test.mjs`. FAIL (module missing).
- [ ] **Step 3:** Implement. Export `renameSource`, `renameDocument`, `applyListMap` for the tests;
  the command line calls them.
- [ ] **Step 4:** Run; PASS, reading the `Tests` count.
- [ ] **Step 5:** Commit: "Add the fiscal rename script and its map (A1308 fiscal 1)".

### Task 3: run it, rebuild, and repair what names alone could not

**Files:** everything the script changes; by hand `scripts/append-only-triggers.test.ts`,
`apps/server/scripts/demo-seed/seed.madrid-baseline.test.ts`,
`apps/server/scripts/demo-seed/seed-sales.golden.test.ts`; regenerate the set.

- [ ] **Step 1:** `node scripts/a1308/fiscal-rename.mjs`, then
  `pnpm --filter @waitron/server migration-baseline rebuild --set fiscal-verifactu`, then
  `node scripts/a1308/fiscal-rename.mjs --check` (exit 0). Commit the script's output alone:
  "Rename the Veri\*Factu tables after the module (A1308 fiscal 1, script output)".
- [ ] **Step 2: Re-sort `EXPECTED`** in `scripts/append-only-triggers.test.ts` (the three renamed
  entries move to `verifactu_*` places; compared sorted at `:215`).
- [ ] **Step 3: The demo capture.** The Madrid fixtures are a hashed capture of an older schema and
  are not rewritten (`seed.madrid-baseline.test.ts:91`). Rename the six tables in the expected
  capture inside the test, the way earlier A1308 slices did for theirs: if the test already has a
  table-rename adapter, add the six pairs to it; if not, add `RENAMED_TABLES` beside
  `RENAMED_COLUMNS` (`:22`) and apply it to `expected` and `phases` before the comparison. Also
  re-point its `registros_facturacion` column patch (`:146-160`) to `verifactu_records`. No assertion
  changes.
- [ ] **Step 4:** Rename the two property keys in `seed-sales.golden.test.ts:220-221` (Files). Run
  the typecheck lines of the Finish line, then every Vitest line. Fix what fails
  only where the failure is a name the map could not reach (a property keyed by a table name at run
  time, a test that builds a table name from parts). Each such edit goes in the pull request's list
  of hand edits. Any other failure is a stop (stop 2 or 6).
- [ ] **Step 5:** Run the last line of the Finish line (the grep). Expected: no output.
- [ ] **Step 6:** Commit: "Repair what the rename could not reach by name (A1308 fiscal 1)".

### Task 4: the protection list

- [ ] **Step 1:** From `apps/server`: `pnpm protection-list list --out <B>`;
  `node ../../scripts/a1308/fiscal-rename.mjs --protection-list <A> <A'>`;
  `pnpm protection-list compare --old <A'> --new <B> --report <map report>`. Expected: `EQUAL`.
- [ ] **Step 2:** `pnpm protection-list compare --old <A> --new <B> --report <raw report>`. Compare it
  line by line with "Expected protection-list difference". Paste both reports into the pull request,
  each raw line marked against the prediction.

### Task 5: documents and the backlog

**Files:** `CLAUDE.md` (the script renamed §5's table and §3's path; check the sentences still read
true and still fit the format check), `apps/server/README.md`, `docs/backlog/architecture.md`, and
by hand the five `docs/developers/` and `docs/compliance/` files named in Step 0.

- [ ] **Step 0: `docs/developers/` and `docs/compliance/` by hand** (outside the script, Files).
  List the hits:

  ```bash
  git grep -nw "registros_facturacion\|registro_sif\|envio_flujo\|fiscal_certificate_installs\|fiscal_series_conflicts\|envios\|registrosFacturacion\|registroSif\|TenantTransport\|tenantsWithWork\|tenant_skipped\|registros_[a-z_]*_\(ck\|uq\|idx\)" -- docs/developers docs/compliance ':!docs/developers/grants-retirement-audit.md'
  ```

  At `a086eedfb7` it printed 22 lines in 5 files. Read each in its paragraph and sort it (this
  sorting was done by reading at `a086eedfb7`; re-read if a line moved):
  - **Today's behaviour, rename** (old name → map's new name; a schema path that moved, such as
    `schema/registros.ts` or `schema/sif.ts`, follows the `files` map): `conventions-data.md:1426`,
    `:4056`, `:4067`, `:5119`, `:5605`, `:5607`; `testing-guide.md:587`;
    `asesor-questions.md:3846`; `verifactu-faq-notes.md:39`, `:115`, `:156`.
  - **Receipts, leave the words as they were and add one dated pointer line after the block**,
    "**2026-11-xx:** these tables are now named `verifactu_*` (A1308 fiscal 1); the names above are
    as they were when this was measured.": `conventions-data.md:1372-1374` (the measurement when the
    trigger wiring went in), `:1454` (measured 2026-09-27), `:1744-1748` (the 2026-10-12 experiment),
    `:4073` and `:4078` (quoted query-plan lines, one pointer after the paragraph);
    `testing-guide.md:2539` (the cost of a past defect); `verifactu-findings.md:35-41` (a dated
    2026-08-03 update).
  A line found that is in neither list is sorted the same way and named in the pull request.
- [ ] **Step 1:** `apps/server/README.md:736`: the entry is now `drain.skipped`; its sentence keeps
  "The pass had due fiscal work and could not …"; `:676` and `:751` name the new log line.
- [ ] **Step 2: Backlog** (rules §9). Delete the entry "`DrainResult.tenantsWithWork` is named for a
  count that can now only be 0 or 1" (`docs/backlog/architecture.md:305-310`) and its line in "What
  A1308 retires". In "These index and key names still read `tenant`" (`:281-293`), delete
  `registros_tenant_node_secuencia_uq` from the list; if the venue-and-box slice already emptied the
  rest of the list, delete the entry.
- [ ] **Step 3:** `pnpm exec vitest run scripts/claude-md-pointers.test.ts` and
  `pnpm exec prettier --check CLAUDE.md`. PASS.
- [ ] **Step 4:** Commit; run `/finish-branch` with this plan's path as its note. This is a
  risk-trigger branch (a fiscal schema): the full wave, with the Codex run-it seat's second angle.
  After it lands: `wa-wt reset` the dev slots and the Santet venue (rules §2); the Cloud lane applies
  `scripts/a1308/fiscal-rename-map.json` to its fixtures.
