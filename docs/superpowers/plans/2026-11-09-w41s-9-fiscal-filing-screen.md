# W41s-9: the Fiscal filing screen — implementation plan

> **For agentic workers:** use `superpowers:subagent-driven-development` (or
> `superpowers:executing-plans` inline). Dispatch each task as `subagent_type: "implementer"`. Steps
> use checkbox (`- [ ]`) syntax. Every task is test-first: write the named failing check, run it and
> see it fail for the stated reason, then write the smallest code that passes it.

**Status:** plan for review, 2026-11-09, revised the same day after a fresh-context review. Written
on `main` at `1252e2b6b3`. No product code was written or run to produce it; what was read and what
was run is listed at the end.

**Approved source.** This plan carries out Task 9 of the
[approved W41s plan](2026-10-04-fiscal-prevention-and-offline-recovery.md#task-9-fiscal-filing-screen-and-missing-history-investigation)
and decision D6 of its [approved design](../specs/2026-10-04-fiscal-prevention-and-offline-recovery-design.md)
(§5, "D6: Fiscal filing screen under Reporting … Show unresolved invoices separately from queue
progress"). The owner approved that design ("lgtm") and that plan ("plan approved") on 2026-10-04;
the record is `~/waitron-campaign-l/queue.md`, "Lane J's W41s rules". This plan narrows Task 9 to
what today's code still needs. Where it departs from Task 9's text, the departure and its reason are
in "What changed since Task 9 was written" below.

## Goal

A manager (anyone holding `report.export`) opens **Reporting → Fiscal filing**, the item right after
**VAT return (modelo 303)**, and sees one page, read at a stated time ("Read at …"), with these
separate parts:

1. **Identity conflict** (only when there is one): this box has stopped issuing invoices because of
   an identity conflict. The conflicts are listed, each in AEAT's words, with a link to the existing
   recovery page.
2. **Sending progress**: how many invoice records are waiting, being sent, accepted, accepted with
   errors, refused, held or set aside, and how old the oldest waiting one is.
3. **Filing cases**: each invoice record that needs a person's decision, with its invoice number
   and date, why the case opened, what the tax agency (AEAT) said at the time, the record's
   fingerprint and, for a conflict, the fingerprint AEAT holds. Each case says how many later records
   are held behind it.
4. **Held records with no case**: a count, so nothing held is invisible.
5. **Possibly missing history**: invoices AEAT holds under a series this box no longer uses that this
   box did not issue, and each change of fiscal identity made without a handover.

One **Export** button saves what the page shows as one file. The file is built from a fixed list
of fields (Task 1), which leaves out customer details and every password, key, certificate and
session table.

The screen changes nothing. It offers no correction, release or retry button: every correction is
switched off in production today (item 5 below), and retrying is already on Box status.

## Should this exist?

- **The need.** Today a person sees the bell's "N fiscal record(s) need someone to decide what to
  do. Contact support." (`apps/dashboard/src/i18n/alert-messages.ts:313-316`) and has nowhere to see
  which invoices, why, or what AEAT said. The facts exist only in database tables. W41s-11's
  approved exercise also needs "a visible missing-history interval"
  ([Task 11](2026-10-04-fiscal-prevention-and-offline-recovery.md#task-11-full-offline-exercise-and-operator-instructions)),
  and only this item makes one visible.
- **The simplest thing that meets it.** One read-only page and one read route inside the fiscal
  module, reusing the case readers that already exist, and saving the export in the browser from a
  fresh read. Considered and rejected: changing nothing (the evidence stays unreadable, and the
  W41s-11 exercise has nothing to check); a download only, with no page (the approved outcome is to
  see it); adding the cases to Box status. Managers hold both `system.manage` and `report.export`
  (`packages/identity/src/permissions.ts:46-57`), so Box status would reach the same people; it is
  rejected only because the approved design (D6) placed the screen in Reporting.
- **What it leaves out on purpose.** Everything in "Out of scope" below, most importantly every
  action button and any way to import recovered history.
- **True size (estimate).** About **1,130 lines of production code** and **about 840 lines of new
  tests**, plus about 90 lines of guide prose (English and Spanish) and some documentation edits. No
  generated files, no migration. Per-task figures are in the size table near the end, checked
  against comparable screens.
- **Later changes, plainly.** A1308's fiscal slices will reshape every table this screen reads:
  - fi1 renames `registros_facturacion`, `envios`, `registro_sif` and `fiscal_series_conflicts`
    ([fi1 plan](2026-11-08-a1308-fi1-verifactu-names.md), lines 66-74);
  - fi5 moves `fiscal_conflict_evidence` and `fiscal_lookup_conflicts` into a new
    `verifactu_history` table and drops their `case_id` column
    ([fi5 plan](2026-11-08-a1308-fi5-history-conflicts.md), Goal and Architecture);
  - fi6 folds `filing_cases` into the submission row; a case loses its own id and is named by its
    record (`HeldRecord.caseId` becomes `caseRegistroId`,
    [fi6 plan](2026-11-08-a1308-fi6-cases-into-submissions.md), line 209);
  - fi9 folds `fiscal_allocations` into the identities table
    ([fi9 plan](2026-11-08-a1308-fi9-identities-absorb-allocations.md), Goal).

  If this item lands first, each of those four slices must also rewrite this item's queries, so
  fi1, fi5, fi6 and fi9 each need it in their "Needs" lists; Task 5 adds those lines when the owner
  answers "build now" (question 3). To keep that cost small, every query lives in one file (`filing-overview.ts`) plus
  one new reader in `filing-cases.ts`, and cases are identified by their **record id**, never a
  case id, in the payload, the export, the screen and the tests, so fi6 changes no outside contract.
  Whether to build now or after those slices is owner question 3.

## What changed since Task 9 was written

Task 9 was written on `main` at `3881303f1` (2026-10-04). Each line below is checked against
`1252e2b6b3`.

1. **The file map no longer fits the module rules.** Task 9 proposed
   `apps/server/src/fiscal-filing-api.ts`, `apps/dashboard/src/screens/fiscal-filing-screen.ts` and
   `boot.ts` changes. A module now brings its own routes (`FISCAL_ROUTES`,
   `packages/fiscal-verifactu/src/routes.ts:23-47`) and its own dashboard screens (a contribution's
   `screen`, or `moreScreens`, which are "mounted, listed, searched and permission-gated exactly as
   `screen` is", `packages/dashboard-kit/src/contract.ts:134-135`). The adjustments module puts its
   Reporting screen in through `screen` (`packages/adjustments/src/dashboard/index.ts:10-15`).
   Generic code must not name a module (CLAUDE.md §3, "A new product domain lands as a MODULE"), so
   everything here lives in `packages/fiscal-verifactu`; `boot.ts` and `apps/dashboard` are not
   touched.
2. **The case tables and their readers exist (W41s-3).** `filing_cases` and `filing_case_events`
   (`packages/fiscal-verifactu/src/schema/filing-cases.ts:30-76`), `listFilingCases`
   (`filing-cases.ts:180-209`), `openFilingCasesSummary` (`:212-231`) and `heldRecords` (`:244-304`).
   `git grep` finds no production caller of `listFilingCases` or `heldRecords`; only
   `openFilingCasesSummary` is used, by the bell's alert (`submission-alerts.ts:64`). The backlog note
   at `docs/backlog.md:317-319` asks this item to filter or page them.
3. **Conflict evidence exists (W41s-7, W41s-10a).** `fiscal_conflict_evidence`,
   `fiscal_lookup_conflicts` and `fiscal_series_conflicts` (`schema/conflict-evidence.ts:12-32`,
   `schema/lookup-conflicts.ts:7-21`, `schema/series-conflicts.ts:6-21`). The reconciliation (#2449)
   writes a `fiscal_series_conflicts` row for each invoice AEAT holds under one of this box's live
   series that this box does not have (`reconcile-series.ts:33-86`). **A series-conflict row on a
   live series is an active conflict**: `readActiveConflicts` returns it
   (`conflict-evidence.ts:103-126`, live series and unrevoked identity only), and
   `assertNoActiveConflict` then refuses issuance (`:25-32`). Only rows on a retired series are
   history.
4. **"Manual activation with re-authentication" is already built, differently.** Task 9 said to use
   Task 6's administrator recovery. W41s-7 (#2373) replaced that with a public recovery page,
   `/manage/recovery/fiscal-conflict`, which the fiscal dashboard contribution always registers
   (`packages/fiscal-verifactu/src/dashboard/index.ts:12-18`). Its API is mounted only when the host
   provides `liveOperations` (`conflict-recovery-routes.ts:113-115`, `:126`); boot provides it
   (`apps/server/src/boot.ts:2783-2787`). The page demands the box's current recovery key; a dashboard
   sign-in does not replace it (`apps/server/src/guide/en/box-status.md:89-90`). A sale refused for a
   conflict already names that page (`conflict-evidence.ts:25-32`). The screen only links to it.
5. **Corrective filings are built (W41s-8, #2399) and switched off.** `POST
   /management-api/fiscal-records/remedy` (`record-remedy-routes.ts:48-95`) needs `fiscal.remedy`,
   granted to administrators only (`permissions.ts:3-7`; checked at `record-remedy.ts:33-37`), and a
   server policy whose production set is empty (`record-remedy-routes.ts:20`). Every remedy kind is
   therefore refused at a venue, so this item builds no buttons for them. Remedies are the only
   writers of case events (`git grep "recordCaseEvent("` finds only the five `record-remedy*.ts`
   files), so no case can be resolved at a venue today: every case ever opened stays open. Task 9's
   "successful action retries", "slow reloads after successful actions" and "wrong-field refusals"
   have no action to apply to on this screen.
6. **Retry now exists.** Box status's tax row has **Retry now** (A798-B, #2030; route
   `routes.ts:29-46`, client `apps/dashboard/src/api/client.ts:4612`) and an unsent-records line
   (`apps/dashboard/src/screens/box-status-rows.ts:186-200`, from `staff-notices.ts:41-69`). Not
   rebuilt here.
7. **Alerts can now carry a "Go to" screen** (`packages/module/src/alerts.ts:16`, `:50`;
   `apps/dashboard/src/widgets/alert-format.ts:34-39`), and the most specific incident claim wins
   (`apps/server/src/alerts.ts:41-42`). Existing exact assertions pin those alerts (Task 6).
8. **`fiscal.view` exists and gates the fiscal alerts** (`packages/identity/src/permissions.ts:29`,
   granted to managers at `:56`; `packages/fiscal-verifactu/src/alerts.ts:12`). It predates the
   design (#368, 2026-09-15), which still chose `report.export`. This plan keeps `report.export`.
   Both are held by exactly the manager and administrator roles today (`permissions.ts:46-57`).
9. **No table records a missing period, and nothing computes one.** `git grep -i` for "missing
   history", "lost period" and similar finds only two comments. The evidence that does exist:
   series conflicts on retired series (item 3), and the identity rows. Each activation inserts a new
   `registro_sif` row (`allocation.ts:441`) and its `fiscal_allocations` row (`:465`) in one
   transaction (W41s-4, #1700). The approval stored with it records a handover only as
   `version: 2` with `oldMachineRelinquished: true` (`allocation-types.ts:16-37`;
   `allocation-envelope.ts:206-213`), which only a promotion can carry
   (`allocation-envelope.ts:304-305`) and a controlled handover sets
   (`apps/server/src/handover-preparation.ts:48`). The missing-history part is built from these, with
   no schema change.
10. **There is no way to bring recovered history in.** Task 9 asked to "record later-recovered source
    records separately … flag possible duplicate accounting and require reconciliation". Nothing
    imports recovered records today, so there is nothing to record or flag. Bringing them in is part
    of the remedy that adviser question Q41 gates (`docs/compliance/asesor-questions.md`). Out of
    scope.
11. **A1308 will reshape these tables** (fi1, fi5, fi6, fi9; see "Later changes" above). This plan
    adds no table, so A1308's table hold does not apply.
12. **A1089's four evidence branches are not on `main`** and nothing here relies on them. The overlap
    is set out in its own section below.

## Overlap with A1089's fiscal evidence areas

From `main` only; the unlanded `feat/a1089-*` branches were not read. This is a statement of
overlap for the owner's decision about those branches, not extra scope.

| A1089 area (`docs/backlog/self-service-refusals.md`) | Shown here? | Why, and from which stored facts |
| --- | --- | --- |
| Filing cases (`#fiscal-cases`) | **Yes, fully.** It is this screen's subject. | `filing_cases`, opened by the drain for refusals (`drain.ts:1568-1573`), conflicts (`:1899`), held cancellations (`:937-943`) and accepted-with-errors replies, and by reconciliation for fingerprint mismatches (`reconcile.ts:191`, `reconcile-conflicts.ts:6-21`). |
| Reconciliation findings (`#fiscal-reconcile`) | **Partly.** | Shown: fingerprint mismatches found by lookup (they open a case with a `fiscal_lookup_conflicts` row) and invoices AEAT holds that this box did not issue (`fiscal_series_conflicts`, `reconcile-series.ts:33-86`). Not shown: "no trace at AEAT" (`reconcile.ts:222`) and "AEAT lists it as cancelled" (`:246`). Both are kept only as incidents; a no-trace record is reset to waiting and appears only in the Waiting count. |
| Integrity and validation warnings (`#fiscal-integrity`) | **No.** | `chain.verification_failed` is raised by the core sale and correction writers (`packages/core/src/record-sale.ts:211`, `record-correction.ts:246`) and `fiscal.record_flagged` by the chain writer (`chain.ts:296`). Both are incidents about issuing a record, not filing it, and no filing table holds them. |
| AEAT reply-line mismatches (`#fiscal-reply`) | **No.** | `fiscal.respuesta_descuadrada` (`drain.ts:1512`) is an incident; its records return to waiting and appear only in the Waiting count. |
| Fiscal environment refusals (`#fiscal-environment`) | **No.** | `fiscal.environment_mismatch` and `fiscal.environment_unknown` (`drain.ts:698-716`) are incidents; the record stays unsent and appears only in the Waiting count. |

So this screen would cover the cases area and part of reconciliation. Retiring the reply,
integrity, environment and remaining reconciliation branches would leave those alerts with no
evidence view.

## Scope

In:

- A read model in `@waitron/fiscal-verifactu` that returns the parts above in one transaction,
  with an explicit list of fields at every level, using a fixed number of set-based queries (no
  query per case), with a server-side bound on the case list.
- One read route, `GET /management-api/fiscal-filing`, checking `report.export`.
- A dashboard screen contributed by the fiscal module through `moreScreens`, in the `reports`
  group, ordered right after VAT return, needing `report.export`, with Refresh and Export.
- A guide page in English and Spanish.
- Gated on the owner's approval of exact lines (Task 6): the fiscal alerts' "Go to Fiscal filing".

Out:

- Any correction, release, cancellation or retry button. They wait for the remedy enablement that
  Q35/Q37/Q38/Q40 gate; that change brings its own controls.
- Importing, matching or reconciling recovered history (Q41).
- Resolved cases and case notes: none can be written at a venue today (item 5).
- Live updates. The page reads when it opens and when **Refresh** is pressed.
- Rewording the bell's "Contact support" sentences on alerts this screen does not link (A1089).
  The ones Task 6 links are reworded there.
- The A1089 areas marked "No" above, history before the oldest reconciled month (W41s-10b/W41s-11),
  and any AEAT request.

**No migration and no schema change.** Every fact shown is already stored (items 2, 3 and 9). If an
implementer finds a fact that cannot be shown without a new column, that is a stop: write it in
`~/waitron-campaign-l/questions.md` with the receipt, and do not add one.

**Protected fiscal core (RUNNER H2) not touched.** No change to `computeHuella`, the hash chain
(`Encadenamiento`), invoice-number allocation, `registros_facturacion` or its append-only triggers,
or the alta builders (`recordSale`, `recordCorrection`, `recordSubstitution`). No change to what is
sent to AEAT, which records are held, probed or set aside, or which identity or series a sale uses.
The golden huella suite and `inmutabilidad` pass **unedited** in every task.

## Rules every task follows

- Fiscal area: FULL review path with two run-it reviews; the pull request ends `needs-owner-review`
  and the owner lands it. Show the owner the screen before landing; screenshots stay out of the
  repository.
- No existing assertion changes except the lines the owner approves in Task 6. A new case in an
  existing test file is not a change to an existing assertion.
- Each property is tested once, where it is decided (owner, 2026-11-09): the field list, the bound
  and every database fact in the read model's tests; the permission in the route's tests; drawing
  and saving in the screen's tests.
- Plain English in every string, comment and commit. Product text as short as the meaning allows.
  Never present equal dates, totals or tax as proof that two records are the same sale: the screen
  shows fingerprints and AEAT's words, and compares nothing itself. Word AEAT-sourced rows as AEAT's
  fact ("AEAT holds invoice X; this box did not issue it"), never as Waitron's conclusion.
- No refusal or next-step text sends the person to somebody else (CLAUDE.md §3); see owner
  question 1.
- An implementer that passes about 150 tool calls with its task unfinished stops at a passing or
  cleanly failing point, commits, and returns a handover.

## File map

| Path | Change |
| --- | --- |
| `packages/fiscal-verifactu/src/filing-overview-types.ts` | **New.** The payload types, shared by server and screen; types only, so the browser bundle takes no database code. |
| `packages/fiscal-verifactu/src/filing-overview.ts` | **New.** `readFilingOverview(tx, scope)`: the one read model, and every new query. |
| `packages/fiscal-verifactu/src/filing-overview.test.ts` | **New.** Progress, cases, conflicts, held records, field list, bound. |
| `packages/fiscal-verifactu/src/filing-overview.history.test.ts` | **New.** Possibly missing history. |
| `packages/fiscal-verifactu/src/filing-cases.ts` | Add `openFilingCases(tx, limit)`; share the "no resolution yet" condition with `openFilingCasesSummary`. |
| `packages/fiscal-verifactu/src/filing-overview-routes.ts` | **New.** `mountFilingOverview(app, ctx, log)`. |
| `packages/fiscal-verifactu/src/filing-overview-routes.test.ts` | **New.** |
| `packages/fiscal-verifactu/src/routes.ts` | Call `mountFilingOverview` in `FISCAL_ROUTES.mount`. |
| `packages/fiscal-verifactu/src/dashboard/fiscal-filing-screen.ts` | **New.** `<vf-fiscal-filing-screen>`. |
| `packages/fiscal-verifactu/src/dashboard/fiscal-filing-client.ts` | **New.** One `read()` call. |
| `packages/fiscal-verifactu/src/dashboard/fiscal-filing-screen.test.ts` | **New.** Browser behaviour. |
| `packages/fiscal-verifactu/src/dashboard/fiscal-filing-screen.a11y.test.ts` | **New.** Axe. |
| `packages/fiscal-verifactu/src/dashboard/strings.ts` | English and Spanish strings, including `nav.fiscal_filing`. |
| `packages/fiscal-verifactu/src/dashboard/index.ts` | Add the `moreScreens` entry. |
| `packages/dashboard-modules/src/registry.test.ts` | One new case pinning the placement. |
| `apps/server/src/guide/en/fiscal-filing.md`, `apps/server/src/guide/es/fiscal-filing.md` | **New** guide page. |
| `apps/server/src/guide-catalogue.ts` | Add `"fiscal-filing"` to `GUIDE_PAGES`. |
| `docs/backlog.md`, `docs/backlog/fiscal.md`, `docs/backlog/self-service-refusals.md` | Update in the same change (Task 5). |
| Task 6 only: `packages/fiscal-verifactu/src/alerts.ts`, `submission-alerts.ts`, and the approved lines of `alerts.test.ts` and `submission-alerts.cases.test.ts` | Alert links. |

## Task 1: progress, cases, conflicts and held records (read model)

**Files:** `filing-overview-types.ts`, `filing-overview.ts`, `filing-overview.test.ts`,
`filing-cases.ts`.

**Queries.** A fixed number of set-based queries in one transaction, awaited in turn (never
`Promise.all`), none of them repeated per case:

1. `progress`: one grouped query over `envios` joined to `registros_facturacion`: a count per state
   in `ENVIO_STATES` (`handover-summary.ts:7-15`), the generation time of the oldest `pendiente` or
   `enviando` record, and the latest `confirmado_en`.
2. `cases`: a new `openFilingCases(tx, limit)` in `filing-cases.ts`: cases with no `resolved` event,
   newest first (descending `rowid`, the reverse of `listFilingCases`'s order), joined to their
   record, its identity row and its submission row, reading no events. Move the existing `notExists(...)` condition of
   `openFilingCasesSummary` (`filing-cases.ts:218-226`) into a helper both use;
   `openFilingCasesSummary`'s behaviour does not change. Returns the first `limit` rows and the total;
   `limit: null` returns every open case (the export's read, below).
3. `conflicts`: one query over `fiscal_conflict_evidence` and one over `fiscal_lookup_conflicts`,
   each restricted to the record ids from query 2 (`inArray`), grouped onto their cases in memory.
4. `held`: `heldRecords(tx)` once (`filing-cases.ts:244-304`, one SQL statement), reduced in memory
   to a count per holding record and a count with no case.
5. `activeConflicts`: `readActiveConflicts(tx, nodeId)` once (`conflict-evidence.ts:36-129`) when
   `nodeId` is not null; an empty list otherwise.

**The bound.** The screen's read returns the **newest 200** open cases and `totalCases`. Because no
case can be resolved at a venue (item 5), "open" means every case ever opened, so the list only
grows; showing the oldest 200 would hide every newer case for good once there are 200. The screen
says "the newest 200 of N" when N is larger. The **export** reads with no bound, so the file holds
every open case; the measurement step below times that read too. Held records are not
listed, only counted, so the answer's size does not grow with them; query 4 still reads every
held and refused record, so the task measures it (step below). This settles the backlog note at
`docs/backlog.md:317-319`: the case list gains its filter and bound, and `heldRecords` stays a
single read whose cost the task records.

**Fields, at every level.** Built by picking named fields, never by spreading a row or a stored
JSON value:

- `readAt`.
- each case: `registroId` (the case's identity everywhere; no case id is returned), `cause`,
  `openedAt`, and the saved answer `evidence` as `{ codigo, mensaje, csv }`;
- its record: `tipoRegistro`, `idEmisorFactura`, `numSerieFactura`, `fechaExpedicionFactura`,
  `tipoFactura`, `importeTotal`, `cuotaTotal`, `huella`, `anteriorHuella`,
  `fechaHoraHusoGenRegistro`, and the installation name (`registro_sif.numero_instalacion`);
- its submission: `estado`, `codigoError`, `mensajeError`, `enviadoEn`;
- each conflict observation: `attempt`, `cause`, `recordedAt`, and from the stored reply line
  (`RespuestaLinea`, verifactu's `xml/parse-suministro.d.ts:22-31`) only `IDFactura`'s three
  fields, `EstadoRegistro`, `CodigoErrorRegistro`, `DescripcionErrorRegistro`, and from
  `RegistroDuplicado` only `EstadoRegistroDuplicado`, `CodigoErrorRegistro` and
  `DescripcionErrorRegistro`; from the stored comparison, `kind`, `storedFingerprint` and the three
  `storedSystem` fields. `RefExterna`, `Operacion` and `IdPeticionRegistroDuplicado` are left out;
- each lookup observation: `recordedAt`, `invoice`'s three fields, `state`, `fingerprint`, and the
  three `system` fields (`conflict-types.ts:24-31`); `reference` is left out;
- `heldBehind` per case, `heldWithoutCase`;
- `activeConflicts`: for each, the invoice number, installation name, cause, observed time, and the
  same picked evidence fields as above.

Left out: recipients (`destinatarios`), the operation description, the tax breakdown, device, sale
and person ids, and every column of every other table. `mensaje`, `mensajeError` and
`DescripcionErrorRegistro` are AEAT's own free text and are kept, because they are what AEAT said.

- [ ] **Failing test first** (`filing-overview.test.ts`, `useVenueDb` with `TEST_MIGRATIONS`, seeded
  through `test/drain-fixtures.ts` and `openFilingCase` as `filing-cases.test.ts` does). One fixture:
  an accepted record, a pending one, a refused one with a `fiscal.registro_rechazado` case and two
  records held behind it, a set-aside cancellation with its `fiscal.anulacion_retenida` case, a
  record with a `fiscal.huella_divergente` case and one `fiscal_conflict_evidence` row, a held record
  with no case, a series-conflict row on a live series, and a case resolved through
  `recordCaseEvent` (synthetic, to prove the filter). Cases:
  1. `progress` counts each state and gives the oldest waiting generation time.
  2. `cases` lists the three open cases newest first by record id, leaves out the resolved one, and
     gives `heldBehind` 2 for the refusal; `heldWithoutCase` is 1.
  3. `activeConflicts` holds the fingerprint case and the live series-conflict row for that node,
     and is empty for a null node.
  4. **Field list at every level.** Compare the key set of every object in the answer, nested ones
     included, against the listed names (a small recursive helper in the test). With the fixture's
     recipient name, `RefExterna` and `IdPeticionRegistroDuplicado` set to distinctive strings,
     `JSON.stringify(overview)` contains none of them. This proves which fields can appear; it does
     not inspect what AEAT's free text says.
  5. **Bound.** With 201 open cases, `cases` has 200, the newest (the first-opened case is the one
     left out), and `totalCases` is 201; with `limit: null` it has all 201.

  Make each case fail once for its own reason (for case 4, temporarily spread a stored reply line).
- [ ] Write `filing-overview-types.ts`, `openFilingCases` and `readFilingOverview`.
- [ ] **Measure** `readFilingOverview` once on a seeded chain with 10,000 held records and 2,000 open
  cases, bounded and with `limit: null` (a throwaway script or a skipped-by-default case, not a
  committed timing assertion). Record the command and times in the pull request. Above one second,
  stop and ask before going on.
- [ ] Run, and read the `Tests` count:
  `pnpm --filter @waitron/fiscal-verifactu exec vitest run src/filing-overview.test.ts src/filing-cases.test.ts src/submission-alerts.cases.test.ts src/conflict-recovery.test.ts`
- [ ] Guards, unedited:
  `pnpm --filter @waitron/fiscal-verifactu exec vitest run src/write-path.e2e.test.ts src/inmutabilidad.test.ts`
  and `pnpm exec vitest run scripts/module-seams.test.ts scripts/english-only.test.ts`.
- [ ] Commit (`git commit -s`).

## Task 2: possibly missing history (read model)

**Files:** `filing-overview.ts`, `filing-overview-types.ts`, `filing-overview.history.test.ts`.

Adds `missingHistory`, scoped to the venue's taxpayer (`readTenant(tx)`) and the box's deployment
environment (`readDeploymentEnvironment`), in two set-based queries:

- `notIssuedHere`: every `fiscal_series_conflicts` row whose series is retired
  (`invoice_series.retired_at` is not null), oldest first: invoice number, issue date, AEAT's state
  and fingerprint, the three system fields AEAT names, when it was found, and the series code. Rows
  on a live series are active conflicts and are shown in Task 1's conflict part, never here.
- `identityChanges`, **ordered without clocks.** Identity rows are taken in `registro_sif` insertion
  order (`rowid`; the codebase already relies on insertion order, `filing-cases.ts:181-184`). An
  activation inserts its identity row and its `fiscal_allocations` row in one transaction
  (`allocation.ts:441`, `:465`). For each `fiscal_allocations` row of that taxpayer and environment
  that is not a handover (a handover is `approval.version === 2 && approval.oldMachineRelinquished
  === true`), find the identity row of that taxpayer inserted immediately before its own that holds
  records of that environment. If there is none (a first setup), there is no entry. Otherwise the
  entry gives the new installation name, the earlier installation name, and that earlier identity's
  record with the highest `secuencia` in that environment (invoice number and issue date). No
  generation time, activation time or other clock reading decides order or membership; the
  activation time is shown only as a label.

**Wording.** The same rule must be true after a restore, an emergency promotion and a conflict
switch on the same box. So the screen says only: "The fiscal identity changed from {earlier} to
{new} without a handover. The last invoice this box holds under {earlier} is {number}. Invoices
under {earlier} that this box does not hold may exist." It names no box and claims nothing is
missing.

- [ ] **Failing test first** (`filing-overview.history.test.ts`). Cases:
  1. A series-conflict row on a retired series appears under `notIssuedHere`; one on a live series
     does not.
  2. Three activations: the first identity (no entry); a restore after records on the first
     identity (an entry naming the highest-`secuencia` record); a handover (`version: 2`,
     `oldMachineRelinquished: true`; no entry).
  3. **Clock-independence.** The earlier identity's last record is generated *after* the new
     identity's `activated_at` (a clock running ahead); the entry still appears and names it.
  4. A record of another environment is never named.
- [ ] Implement inside `readFilingOverview`; do not add an index.
- [ ] Run `pnpm --filter @waitron/fiscal-verifactu exec vitest run src/filing-overview.history.test.ts src/filing-overview.test.ts`,
  then the two unedited guards from Task 1.
- [ ] Commit.

## Task 3: the read route

**Files:** `filing-overview-routes.ts`, `filing-overview-routes.test.ts`, `routes.ts`.

`GET /management-api/fiscal-filing`, mounted from `FISCAL_ROUTES.mount` (`routes.ts:24`) before the
`fiscalDrain` early return (`:28`), so a box that is not filing still shows its evidence. It sets
`Cache-Control: no-store`, takes the session with `requireManagementSession`, and inside one
`withTransaction` checks `authorizeManager(tx, { managementSessionId, permission: "report.export" })`
before `readFilingOverview(tx, { nodeId: ctx.recordGeneration?.nodeId ?? null, limit })`, where
`limit` is 200, or `null` when the query string is `?cases=all` (the export's read; any other value
is ignored). Boot sets
`recordGeneration` from the trading node (`apps/server/src/boot.ts:2774-2775`). It adds `filing`
and `awaitingCertificate` from `ctx.fiscalDrain` (false when absent). Error boundary: the four
session and permission codes of `routes.ts:13-16`, log tag `fiscal-filing.failed`; no new error
code. Follow the certificate card's read (`apps/server/src/fiscal-certificate-api.ts:52-66`) for
session handling.

- [ ] **Failing test first.** A manager session gets 200 and `no-store`; a supervisor session
  (holds `report.view`, not `report.export`) gets 403 `authorization.not_permitted`; no session gets
  401. `?cases=all` reaches `readFilingOverview` with `limit: null` and no query string with 200.
  The payload's content is Task 1's and is not re-tested here.
- [ ] Implement; mount it.
- [ ] Run `pnpm --filter @waitron/fiscal-verifactu exec vitest run src/filing-overview-routes.test.ts src/routes.test.ts src/record-remedy-routes.test.ts`
  and `pnpm exec vitest run scripts/errors-reachable.test.ts scripts/module-seams.test.ts`.
- [ ] Commit.

## Task 4a: the screen, client and strings

**Files:** `dashboard/fiscal-filing-screen.ts`, `dashboard/fiscal-filing-client.ts`,
`dashboard/strings.ts`, `dashboard/index.ts`, `dashboard/fiscal-filing-screen.test.ts`.

**Placement.** A `moreScreens` entry `{ id: "fiscal-filing", navLabelKey: "nav.fiscal_filing",
group: "reports", order: -1, requiresPermission: "report.export" }`. Module screens are sorted by
`order` (default 0) after the group's core items (`apps/dashboard/src/dashboard-app.ts:2509-2516`),
and VAT return is Reporting's last core item (`:229-238`), so `-1` puts Fiscal filing right after
VAT return and before Adjustment report. Use `moreScreens`, not `screen`: the existing assertion
`expect(VERIFACTU_DASHBOARD.screen).toBeUndefined()` (`dashboard/index.test.ts:9`) stays true and
unedited.

**Drawing.** Read `docs/developers/design-system.md` and `conventions-ui.md` first. Only `wt-*`
primitives and declared `--wt-*` tokens. The screen holds no input: no form fields, no draft scope,
no `*.unsaved.test.ts`.

- A one-sentence intro, **Read at {time}** beside **Refresh** and **Export**, so a stale tab shows
  its age.
- When `filing` is false or `awaitingCertificate` is true, a `wt-notice` saying so in the reason's
  words only (Box status and Venue settings handle both).
- When `activeConflicts` is not empty, a `wt-notice` first: this box has stopped issuing invoices
  because of an identity conflict; recovery needs the box's recovery key; a link to
  `/manage/recovery/fiscal-conflict`. Below it, each conflict in AEAT's words (for a series
  conflict: "AEAT holds invoice {number}; this box did not issue it").
- **Sending progress**: the seven counts with plain names (Waiting, Sending, Accepted, Accepted
  with errors, Refused, Held, Set aside), the oldest waiting time and the last acceptance.
- **Filing cases**: a `wt-data-table` (opened, invoice number and date, reason, AEAT code, records
  held behind it), client-side paging, rows keyed by record id, with "The newest 200 of {N}" when
  bounded. A **View** row action (column keyed `actions`, `pinned: "end"`) opens a plain-text
  details panel, as Products' archived-row View does (design-system "Products: Active and Available
  are two different words"): the invoice facts, the record's fingerprint and the previous one,
  AEAT's answer at the time and now, each conflict observation with AEAT's fingerprint beside ours,
  and one line on what is true now for that reason (for example, that later records keep being sent
  after a refusal, or that a set-aside cancellation is not sent). Write those lines from the drain's
  code, not from this plan.
- **Held with no case**: the count, shown only when it is not 0.
- **Possibly missing history**: the two lists from Task 2, each with an empty state, in the wording
  Task 2 gives.
- Read failure: one message under the action row; Refresh clears it once a read succeeds. The first
  read and every Refresh are passive GETs (`{ passive: true }`).
- **Export**: reads again with `?cases=all` (not passive: the person asked), so the file holds
  every open case, then saves the answer as
  `fiscal-filing-<YYYY-MM-DD>.json`, pretty-printed, through a Blob and a temporary link as the VAT
  return screen does (`apps/dashboard/src/screens/vat-return-screen.ts:122-127`). The file is the
  route's answer, so it holds only the fields Task 1's field-list test admits.
- Next-step wording for a case follows owner question 1's default until answered.
- English and Spanish strings in `dashboard/strings.ts`; Spanish uses AEAT's own terms where the
  fiscal package's exception allows (CLAUDE.md §3, "General code is English only").

- [ ] **Failing test first** (`fiscal-filing-screen.test.ts`, real Chromium, client stubbed at
  `DashboardRequest`). Cases, each once:
  1. With a fixture overview, every part shows its figures and "Read at"; View on the conflict case
     shows both fingerprints; a bounded list shows "The newest 200 of 201".
  2. Active conflicts show the recovery link with that exact path; none shows no notice.
  3. Export reads with `?cases=all` and saves one file whose parsed content equals that read's
     answer, and the first read was passive.
  4. A refused read shows the read message; a later successful Refresh clears it.
- [ ] Before the browser runs, check headroom (`memory_pressure | grep free`); run beside other
  browser work only well above 15% free.
- [ ] Run `pnpm --filter @waitron/fiscal-verifactu exec vitest run src/dashboard/fiscal-filing-screen.test.ts src/dashboard/index.test.ts src/dashboard/strings.test.ts`.
- [ ] Guards: `pnpm exec vitest run scripts/native-form-fields.test.ts scripts/style-token-names.test.ts scripts/primary-coloured-text.test.ts scripts/pinned-actions-column.test.ts scripts/live-subscriptions.test.ts scripts/english-only.test.ts scripts/module-seams.test.ts`.
- [ ] Commit.

## Task 4b: accessibility, placement and a look

**Files:** `dashboard/fiscal-filing-screen.a11y.test.ts`,
`packages/dashboard-modules/src/registry.test.ts`.

- [ ] **Accessibility** (pattern of `dashboard/conflict-recovery.a11y.test.ts:12-40`, without its
  full matrix): light and dark × {page with cases, conflicts and history; empty page}, English, at
  desktop width; plus one phone-width (390 px) run of the full page in light theme, because the
  table and details panel reflow there. `expectNoA11yViolations` each time. Spanish is covered by the
  strings test and the look below, not by another axe run.
- [ ] **Placement** (one new case beside the adjustment report's in `registry.test.ts`): the fiscal
  module's `moreScreens` placement equals the object in Task 4a.
- [ ] Run `pnpm --filter @waitron/fiscal-verifactu exec vitest run src/dashboard/fiscal-filing-screen.a11y.test.ts`
  and `pnpm --filter @waitron/dashboard-modules exec vitest run src/registry.test.ts`.
- [ ] **Look at it**: screenshots in both themes, both languages, at phone and desktop width, kept
  in the worktree's untracked working folder and shown to the owner, never committed.
- [ ] Commit.

## Task 5: guide page and documentation

**Files:** `apps/server/src/guide/en/fiscal-filing.md`, `apps/server/src/guide/es/fiscal-filing.md`,
`apps/server/src/guide-catalogue.ts`, `docs/backlog.md`, `docs/backlog/fiscal.md`,
`docs/backlog/self-service-refusals.md`.

- [ ] Guide page, English and Spanish, each heading with the same `{#id}`: what each part shows,
  that the page changes nothing, how to export, and the identity-conflict link. Write each sentence
  from the code built in Tasks 1–4b; keep only sentences that change what staff do (CLAUDE.md §3).
  Add `"fiscal-filing"` to `GUIDE_PAGES`. The screen links to no guide section, so
  `apps/dashboard/src/help-guide.ts` is unchanged.
- [ ] Run `pnpm --filter @waitron/server exec vitest run src/guide-content.test.ts` and
  `pnpm exec vitest run scripts/guide-links.test.ts`.
- [ ] Backlog, in the same change: the W41s line in `docs/backlog.md` (`:300-308`) no longer lists
  W41s-9 as queued; replace the note at `:317-319` with nothing once the bound and the recorded
  measurement are in the pull request (settled, as Task 1 describes); in `docs/backlog/fiscal.md`'s
  W41s section, a dated paragraph saying what landed and what stays out; in the A1089 lines
  (`docs/backlog.md:211-212` and `self-service-refusals.md` "fiscal-cases"), that the evidence page
  exists and the decision step still waits for remedy enablement.
- [ ] If the owner chose "build now" (question 3): add one line to the "Needs" list of each of the
  fi1, fi5, fi6 and fi9 plans (`docs/superpowers/plans/2026-11-08-a1308-fi{1,5,6,9}-*.md`) naming
  `packages/fiscal-verifactu/src/filing-overview.ts` and `openFilingCases` in `filing-cases.ts` as
  readers of the tables that slice reshapes, and that cases are named by record id.
- [ ] Commit.

## Task 6 (only after the owner approves the exact lines): alerts go to the screen

The bell's "Go to" needs `screen: "fiscal-filing"` on the alerts. Every way to add it changes
existing exact assertions in the fiscal package, which the W41s rules allow only with the owner's
approval of the exact changed lines. Until that approval is recorded, skip this task; the screen
lands without it.

The same task rewords the alerts it links, because a "Go to" button beside "Contact support" breaks
the owner's rule never to send the person to somebody else (owner, 2026-10-25). In
`apps/dashboard/src/i18n/alert-messages.ts`, `fiscal.filing_cases_open` (`:313-316`),
`fiscal.refusals_repeated` (`:317-320`), `fiscal.registro_rechazado` (`:238`),
`fiscal.duplicado_anulado` (`:254`), `fiscal.anulacion_retenida` (`:258`) and
`fiscal.huella_divergente` (`:262`) end "Contact support." / "Contacta con soporte." Replace that
sentence, in English and Spanish, with one saying the record and AEAT's answer are on Fiscal
filing, and that Waitron keeps sending later records where that is true for the code (write it from
the drain's code). On main `8edd51e544`, `git grep -n "Contact support\|Contacta con soporte" --
'*.test.ts'` finds only backup and setup messages, and a `git grep -l` for distinctive phrases of
each of the six sentences, English and Spanish, finds no test, so no existing test pins them.

| Change | Existing assertion that changes |
| --- | --- |
| `alerts.ts:11-16`: add five claims, `{ prefix: "fiscal.registro_rechazado" \| "fiscal.huella_divergente" \| "fiscal.duplicado_anulado" \| "fiscal.aceptado_con_errores" \| "fiscal.anulacion_retenida", area: "fiscal", permission: "fiscal.view", screen: "fiscal-filing" }` | `alerts.test.ts:7-15`: the `events` list gains those five lines. |
| `submission-alerts.ts:66-72`: `screen: "fiscal-filing"` on `fiscal.filing_cases_open` | `submission-alerts.cases.test.ts:71-79`: the object gains `screen: "fiscal-filing",`. |
| `submission-alerts.ts:145-150`: the same on `fiscal.refusals_repeated` | `submission-alerts.cases.test.ts:179-187`: the object gains the same line. |
| `submission-alerts.ts:55-61`: the same on `fiscal.submission_stopped` | none (`submission-alerts.test.ts:133-137` uses `toMatchObject`). |

- [ ] Once approved: make exactly those changes and the rewording; run
  `pnpm --filter @waitron/dashboard exec vitest run src/i18n`,
  `pnpm --filter @waitron/fiscal-verifactu exec vitest run src/alerts.test.ts src/submission-alerts.test.ts src/submission-alerts.cases.test.ts src/drain.probe.test.ts`,
  `pnpm --filter @waitron/server exec vitest run src/alerts.test.ts src/alerts.brake-probe.test.ts`,
  `pnpm exec vitest run scripts/alert-codes.test.ts`, and the two unedited fiscal guards.
- [ ] Commit.

## Size estimate

Checked against comparable files on `main`: `adjustment-report-screen.ts` is 1,105 lines (with
filters and editing), `conflict-recovery.ts` 467 and its strings 94, `vat-return-screen.ts` 210;
their tests are 1,763 + 160 and 805 + 179 + 82 lines. This screen is read-only with no filters, so it
should sit between the conflict page and the adjustment report. Test lines count only new tests.

| Task | Production | Tests | Other |
| --- | --- | --- | --- |
| 1. Progress, cases, conflicts, held records | 230 | 220 | — |
| 2. Possibly missing history | 110 | 140 | — |
| 3. Read route | 50 | 70 | — |
| 4a. Screen, client, strings (EN+ES), placement entry | 715 | 450 | — |
| 4b. Accessibility, placement, look | 0 | 150 | screenshots, not committed |
| 5. Guide page and catalogue | 1 | 0 | ~90 guide prose, ~30 docs |
| 6. Alert links (if approved) | 25 | ~8 changed | — |
| **Total** | **~1,130** | **~1,030 new, ~8 changed** | **~120** |

Task 4a's 715 is about 550 for the screen, 130 for the strings in two languages and 35 for the
client and registration. Its tests were first put at 280 and 4b's at 130; the recovery page
(`conflict-recovery.ts`, 467 lines) has 805 + 179 + 82 = 1,066 test lines, part of them for its
form and unsaved draft, which this screen does not have, so 4a and 4b are re-estimated at 450 and
150 (counted with `wc -l` on main `8edd51e544`).

## Two slices, two pull requests

Watcher, 2026-11-09 23:23: about 2,000 lines is past what one build fits, so the item lands in two
pull requests, each working on its own.

- **Slice 1:** Tasks 1, 3, 4a without the "Possibly missing history" part, 4b, 5, and 6 if the
  owner approves its lines. About 960 production and 850 test lines. A manager can open Fiscal
  filing, read progress, cases, conflicts and held records, and export every open case.
- **Slice 2:** Task 2, the screen's "Possibly missing history" part with its strings and test case,
  and its guide paragraph. About 210 production and 180 test lines. W41s-11's exercise reads this
  list, so W41s-11 waits for slice 2. No generated files and no migration. Each task should fit well under 100
tool calls; 4a is the largest and can split again into "parts 1–3" and "cases, history and export".

## Questions for the owner

1. **May an open case's details name the venue's tax adviser?** The corrections are gated on the
   adviser's answers (Q35/Q37/Q38/Q40), but the rule is never to send the person to somebody else
   (CLAUDE.md §3). **Default, which keeps the rule:** each case says what happened, what Waitron
   keeps doing, and that no correction can be made in Waitron yet; the **Export** button is labelled
   "Export these cases" and names nobody. If the owner says yes, the wording may add "for your tax
   adviser".
   Answered 2026-11-10 16:39 by the owner: 'Export these cases for your tax adviser'.
2. **Approve the exact assertion lines in Task 6** so the bell's fiscal alerts can open this screen.
   **Default if unanswered:** Task 6 is skipped; the screen lands without alert links.
3. **Build now, or after A1308's fiscal slices?** Building now means fi1, fi5, fi6 and fi9 each also
   rewrite this item's queries (one file plus one reader) and need it in their "Needs" lists.
   Building after them means writing against the new tables once, but the screen waits until fi9 has
   landed, at the end of A1308's fiscal sequence. **Recommended default: build now** (watcher,
   2026-11-09 23:23): A1308's design lets work on these tables "land before the slice that touches
   their tables, or [be] re-planned onto the new shape", the fi slices run last in their lane, and
   the lifted A1308 hold says reading existing tables is fine. Task 5 then adds this item to the four
   slices' "Needs" lists. The lane still waits for the owner's answer before Task 1.

## How this plan was checked

Reviews: one fresh Claude read of draft `b1112a504b`, saved at
`~/waitron-campaign-l/receipts/w41s-9-plan-20261109/claude-plan-review.md`, and the watcher's
reviewer-account read of `7a06dadba6` (verdict CHANGE), at
`~/waitron-campaign-l/receipts/w41s-9-watcher-plan-verdict-20261109-2323.txt`. Every point of both
is applied in this revision.

Read: the files and lines cited above at `1252e2b6b3`; the W41s plan, design and backlog sections;
the lane-L queue's W41s rules and RUNNER H2; A1308's fi1, fi5, fi6 and fi9 plans; the self-service
refusal audit; verifactu's `RespuestaLinea` type in the installed library. Run (read-only, in this
worktree or the main checkout's installed packages): `git grep` for the callers of `listFilingCases`,
`heldRecords`, `openFilingCasesSummary` and `recordCaseEvent`, for where each A1089 fiscal code is
raised, for "missing history" and similar, and for tests pinning the fiscal alerts and the verifactu
dashboard contribution; `git log -S` for when `fiscal.view` and the retry route were added; `wc -l`
on the comparable screens. No test, server or browser was run, so every behaviour claim above about
code is a reading of it, and the tasks' failing tests are where each is first exercised.
