# A942 — AEAT technical-outage submission flag

Plan author: separate GPT-6.1 Sol, high effort; 2026-10-21. Research and plan only.
Implement inline in this feature worktree after the fresh plan review. Research and implementation
are authorised; the eventual fiscal PR stops at `needs-owner-review` for owner landing.

## Duty and provenance

Official text requires prompt, ordered recovery and at least hourly retries after a technical
incident prevents filing. Notify AEAT in messages carrying the affected records. The flag belongs
to voluntary submission headers and applies to affected altas and annulments, not just records
whose first attempt failed. These sources do not prescribe a database model or detection algorithm.

| Source, checked 2026-10-21 | Brief source wording / location | Meaning used here |
| --- | --- | --- |
| [BOE, Order HAC/1177/2024, art. 16.4](https://www.boe.es/buscar/act.php?id=BOE-A-2024-22138#a1-8) | “registros de facturación afectados” | Send affected records as soon as possible, in generation order; notify in their submission messages and retry at least hourly. |
| [BOE annex §2.1 header table](https://www.boe.es/datos/imagenes/disp/2024/260/22138_14945626_1.png) | Visually inspected the table embedded in `boe.html`, annex §2.1. | `Incidencia` is under `RemisionVoluntaria`; omission means N. It describes technical circumstances affecting submission. |
| [AEAT outage FAQ](https://sede.agenciatributaria.gob.es/Sede/iva/sistemas-informaticos-facturacion-verifactu/preguntas-frecuentes/sistemas-verifactu.html?faqId=fe7f30143f472910VgnVCM100000dc381e0aRCRD) | «incorporando en el envío la "S" en el campo “Incidencia”» | Exceptional power, computer, connectivity or service failures require periodic retries with S; filing failure does not require stopping invoicing. |
| [AEAT SuministroInformacion.xsd](https://www2.agenciatributaria.gob.es/static_files/common/internet/dep/aplicaciones/es/aeat/tike/cont/ws/SuministroInformacion.xsd) | Parsed `CabeceraType/RemisionVoluntaria/Incidencia`, optional; `IncidenciaType` enumerates S/N. | Header metadata; no addition to the record payload is needed. |

Downloaded HTML/XSD receipt directory:
`/Users/clintongormley/waitron-campaign-e/receipts/a942-20261021-042658`.
The annex table is an image, so HTML text extraction alone does not verify that table.

## Design and decisions

The following outage boundaries are **implementer decisions**, not additional claims about AEAT rules.

- Keep `envios.incidencia` and every existing assertion unchanged. It currently signals operator
  attention for failures, holds and uncertain answers (`drain.ts:444,723,993,1349,1391`). Neither that
  field nor `intentos > 0` identifies a technical outage. `cabeceraFor` currently sends taxpayer
  identity only (`drain.ts:1010`); both claim paths select attempts but no technical marker.
- Choose two additive sidecar columns: `envios.technicalIncidence` (`technical_incidence`, flag,
  non-null/default false) and nullable `envioFlujo.technicalIncidentToken`
  (`technical_incident_token`, id). Use column helpers exported by `@waitron/db`. A fresh token
  identifies each detected failure; null means no open technical incident. Existing table
  classifications remain. No new table, module, dependency, sale-path read or network call.
- Reject simpler alternatives: local incidence/attempts confuse refusals with outages; memory-only
  state loses restarts; a row flag alone misses new/out-of-cap rows; a global flag alone loses the
  affected tail when recovery closes it. A token also prevents an older success clearing a newer
  failure when drain calls overlap. Do not introduce a separate incident-history subsystem.
- On a filing-preventing resolver failure, submit transport/HTTP/SOAP/parser failure, or local
  failure saving a submission answer, open/refresh the token and mark the affected cohort in a
  short transaction. Resolver failures occur before claims (`drain.ts:155`); do not wait for a
  claimed batch. Preserve the outer skip/error and retry schedule. If the database itself cannot
  save this state, retain failure containment and keep a bounded per-Database/per-environment
  in-process fallback. Flush it before the next writable claim; clear it only after the durable
  metadata transaction commits. Test resolver failure plus failed metadata persistence and recovery
  in the same process. A process loss cannot preserve uncommitted evidence; the restart policy below
  is the conservative fallback, not proof of the original failure.
- Cohort: this environment's outstanding pending/in-flight records, including rows waiting behind
  retries or a cap/name boundary, plus due held probes and any probe actually attempted in the
  incident. Exclude accepted/refused terminal rows, set-aside cancellations, environment-refused
  rows and holds that are not yet eligible to probe. A hold or readable fiscal refusal alone never
  opens an incident. Unknown line states, duplicate conflicts and lookup uncertainty retain their
  current handling; they do not acquire S merely because local `incidencia` is true.
- While the token is open, mark newly claimed eligible records in the claim transaction. On the
  first normally parsed authority response that is successfully persisted, mark the outstanding
  cohort again (including records created during the request), then close only the token captured
  by that attempt. A readable rejection also establishes recovery; it retains its rejection.
  Commit cohort marking, response effects and conditional closure together. Never clear row flags:
  affected records retain S on later retries/probes even after the global incident closes.
- Recovery is observed at that successful save, not guessed from a network-reconnect time. New
  records committed before that recovery transaction are conservatively included; later records
  remain clean. An older response must not close a token opened by a later concurrent failure.
- Reset/stale recovery must retain existing state/count semantics and mark interrupted claims,
  including the unsent cohort. For pending-only restart detection, read `readDeploymentEnvironment(db)` before the reset
  transaction. With a saved production/preproduction stamp, evaluate pre-existing pending rows
  using the same environment/name/chain eligibility and lawful flow gate as claiming; the cap here
  is production `MAX_REGISTROS_POR_ENVIO` (the slot supplies no test override). Mark only when a
  sendable batch was already due at reset, either its wait had elapsed or its claimable cohort
  filled that cap. No stamp means no inferred environment or pending-only outage. Add stamped
  production/preproduction, unstamped, recent-pending-under-wait and unexpired-gate controls.
  This is a conservative operational inference: eligibility at restart does not establish why
  a previous process stopped. Keep the reset signature and generic fiscal contract unchanged.
  An idle boot, ordinary flow-control wait and non-stale live claim alone do not open an incident.
  Preserve the current fields checked by `drain.test.ts`'s “leaves ... rows alone” case.
- Pass the marker through **both** `claimBatch` and `claimProbes`; raw SQL returns 0/1 (the registro
  decoder does not map sidecar columns). Build the header from the final batch: if **any** row is
  marked, add `RemisionVoluntaria: { Incidencia: "S" }`; otherwise omit it. Keep taxpayer-name
  selection, order, caps, flow-control waits and hourly probes unchanged; no extra split by flag.
- All metadata work stays in the drain/reset path, in short sequential database transactions;
  network operations remain outside them. Preserve submission/acceptance counts at their existing
  commit boundaries. Protect new token fields from `upsertFlujo` overwrites; creating flow state
  before the first response must preserve the existing open-gate/initial-wait behaviour.

Protected boundary: no edits to stored fiscal records, hash inputs, `computeHuella`, invoice
numbering, alta builders, `registerSif`, `restoreFiscal`, golden huella tests or `inmutabilidad.test.ts`.
No guard, threshold, exclusion or configuration changes. No shipped SQL edits. If implementation
requires a forbidden H2 change, stop and report that exact dependency; do not broaden this plan.

## Task 1 — first outage retry, with durable metadata

**Checkpoint 2026-10-21:** implemented and focused checks passed. Tasks 2–3 remain open;
this is not a complete outage lifecycle or a branch ready for review.

1. Before any test/code edit, locate and read `superpowers:test-driven-development/SKILL.md` and
   follow red/green discipline. Read the relevant data, testing and writing-claims topic sections.
2. Add `src/drain.outage.test.ts` under `packages/fiscal-verifactu`. Import `useVenueDb` from
   `@waitron/db/testing/venue-db.js`, `TEST_MIGRATIONS` from `../test/migrations.js`, existing drain
   fixtures and `createFakeAeat` from `@waitron/verifactu/testing`. Use `createClient` with a recording
   fetch around `fake.fetch`, retaining the real serializer and response parser.
3. **RED:** clean send omits the flag; a failed request followed by recovery sends S and preserves
   existing result/state semantics. Assert on captured XML, not just the Cabecera argument.
   Run `pnpm --filter @waitron/fiscal-verifactu exec vitest run --project=node src/drain.outage.test.ts`;
   retain the expected missing-S assertion failure before implementation.
4. Add `src/outage-metadata.test.ts`: new-column defaults and preservation of existing flow values
   during incident open/close/upsert. Watch its missing-column assertions fail. Implement the two
   schema additions and minimal drain helpers (suggest `src/outage-metadata.ts` if extraction helps).
   Generate with `pnpm --filter @waitron/fiscal-verifactu db:generate --name aeat_outage_flag`.
   The package's `drizzle.config.ts` reads `src/schema/index.ts` and writes `drizzle/`; do not edit it.
5. Inspect generated SQL: only additive columns on the sidecars, no `registros_facturacion` change,
   rebuild, foreign-key changes or shipped migration edits. If generation needs a rebuild, inspect
   incoming foreign keys first and use separate generations for adding columns and constraints.
   Do not hand-repair snapshots/journal. On a later collision regenerate against main's migrations.
6. **GREEN:** rerun both files with the same command, naming both paths. Confirm a `Tests` count.

## Task 2 — complete the affected scope without changing fiscal outcomes

Add cases incrementally to the new files, plus suggested `src/drain.outage.integrity.test.ts`.
For each group, run it red before the smallest implementation, then rerun it green:

`pnpm --filter @waitron/fiscal-verifactu exec vitest run --project=node src/drain.outage.test.ts src/outage-metadata.test.ts src/drain.outage.integrity.test.ts`

- Cover resolver failure before any claim; failure after claim but before submit; committed outage
  surviving reopen/restart; fresh interrupted and stale claims; pending-only downtime; idle restart
  and ordinary flow waits as negative controls. Use a helper-owned real database and guarded
  resource teardown. Exercise `resetInFlightClaims` rather than adding work to boot/sale code.
- Fail the first capped batch, leave an unsent tail, append records during outage and while recovery
  is in flight, then drain across multiple cap and taxpayer-name boundaries. Every affected message
  carries S. Append a healthy record after recovery and send it separately: no S. Test a marked row
  **after** a clean first row; check both ordinary and probe claim projections.
- Exercise an hourly held probe failing in transport, surviving restart, then returning the same
  refusal and later an ordinary readable result. Preserve held/probe cadence, acks, incidents and
  counts. A refusal-only chain, accepted-with-errors and other operator-attention cases remain clean
  unless independently outage-affected; no blanket marking of all held/terminal rows.
- Through the real client/fetch parser, exercise lost response, HTTP failure and malformed XML.
  Separately inject response-save failure (temporary test trigger, removed in `finally`): preserve
  submitted-versus-accepted counts and retries. Readable rejection/unknown-line/duplicate cases keep
  their old outcomes. Hold two drain responses to check that a late success cannot clear a newer
  failure token; no network wait may hold the write transaction.
- For integrity, generate valid altas and annulments through existing real sale/void helpers;
  reuse the setup pattern in `void-path.e2e.test.ts`, not synthetic huellas as the integrity proof.
  Capture full raw immutable rows and invoice/chain state before filing and after every retry.
  Compare actual submitted record XML fragments byte for byte across attempts, including Huella
  and predecessor fields; only the header changes. Assert immutable stored bytes remain identical
  by record id, retry consumes no invoice number, and existing hash recomputation still matches.
  Also complete a sale while transport is held/failing, with no sale-path client resolution.

## Task 3 — migration checks, deletion controls and finishing boundary

Run focused regressions without modifying their assertions:

```sh
pnpm --filter @waitron/fiscal-verifactu exec vitest run --project=node src/drain.test.ts src/drain.cases.test.ts src/drain.containment.test.ts src/drain.ordering.test.ts src/drain.names.test.ts src/drain.probe.test.ts src/drain.probe.names.test.ts src/drain.probe.gate.test.ts src/drain.probe.seat.test.ts src/aeat-transport.test.ts
pnpm --filter @waitron/fiscal-verifactu exec vitest run --project=node src/schema/schema-conformance.test.ts src/migrations.test.ts src/write-path.e2e.test.ts src/inmutabilidad.test.ts src/sale-amount.huella.test.ts src/correction-amount.huella.test.ts src/money-conversion.huella.test.ts src/void-path.e2e.test.ts
pnpm exec vitest run scripts/schema-constraints.test.ts scripts/append-only-triggers.test.ts scripts/behavioural-triggers.test.ts scripts/migrations-match-schema.test.ts scripts/migration-upgrade.test.ts scripts/journal-monotonic.test.ts scripts/two-file-foreign-keys.test.ts
```

Execute commands separately and inspect each exit status/test count. New migration/default checks
must include populated predecessor rows; generic upgrade guards count synthetic rows and do not
replace the immutable-byte comparisons above. No whole-workspace local run solely for finishing.

After implementation, use an **independent installed temporary clone** containing the complete
candidate tree for deletion controls; never swap files/stash in the feature worktree. This plan-only
turn creates none. Disable, one at a time: header S, the second claim projection, cohort marking,
durable token write, conditional recovery closure and row-marker retention. Run the relevant new
file: each deletion must fail the intended assertion (**RED**); restore the candidate and confirm
it passes (**GREEN**). Keep clean-send/refusal/healthy-tail controls to detect overmarking. Record
commands/results and preserve existing tests. Remove only the temporary checkout you created.

Audit base-to-tip changed paths and prose, including drain/sidecar comments and any README/runbook
claims. Keep comments for invariants/non-obvious decisions. Update shared backlog later when it
becomes stale; `docs/backlog/fiscal.md` remains reserved to Lane F and must not be touched here.

When implementation and focused validation finish, announce readiness for `finish-branch`; run its
normal initial rebase and **sole Claude run-it review** using
`~/workspace/tools/claude-seat.sh review-run <candidate-checkout> <brief-file> <report-file>`.
Use a complete installed disposable candidate, captured base SHA, and the skill's required brief.
Read completed findings, fix inline with red/green tests, then signed-off commits and normal push
hook. No parallel implementation delegation, repeated whole-branch review solely for a rebase,
hook bypass or merge. Verify CI scope includes fiscal-verifactu and affected dependents, and all
required checks/coverage belong to the current head SHA. Keep PR at `needs-owner-review` for landing.

Validation limit: this plan ran no product tests. Repository workflow/fixture inspection found local
fake-AEAT SOAP and local mTLS coverage, not a Waitron live AEAT qualification workflow. Those runs
do not prove live acceptance. External verifactu live probes and endpoint credentials are outside
A942 authorisation; report this limit instead of using them.
