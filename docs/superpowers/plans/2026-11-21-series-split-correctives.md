# Correctives of full invoices get their own series, and correctives get one English name: plan

> Lane L, 21 November 2026, item SERIES-SPLIT-CORRECTIONS. Fiscal: the owner lands every PR. Code
> facts were read on main at c4b677c44f, not run, unless a line says what was run. Counts come from
> `git grep -l` at that commit.

**Goal.** A corrective invoice of a full invoice and a corrective invoice of a ticket (a simplified
invoice) are numbered in different series, on every path that creates or lists a box's series. A
"corrective invoice" is the new invoice that corrects an earlier one; AEAT calls it a factura
rectificativa and types it R1 to R5. In English code, screens and guides it gets one word,
**corrective**.

**The owner's words.** 21 November, about 09:37, reviewing the series list in #3925 ("A-… Standard,
FF-… Full invoice, R-… Correction"): "it feels like we're missing a series. Invoice corrections and
ticket corrections should be separate. And some of the naming uses corrective and other
rectificative". About 09:39: "Yes, corrective". Both are recorded in lane L's `queue.md`
(SERIES-SPLIT-CORRECTIONS), outside this repository.

**Should this exist?** Yes. The adviser says the two kinds of corrective must not share a series,
and the one full-invoice corrective Waitron can make, the switched-off R4 replacement, would today
take the tickets' corrective series (`packages/fiscal-verifactu/src/record-remedy-replacement.ts:82`).
The simplest alternative, a series made on first use from the ticket correctives' code, is not
simpler. A box makes its series only at a series start, as one set its installation is allocated
(`isAllocatedSeries`, `packages/fiscal-verifactu/src/allocation-identity.ts:56-85`), and handover,
restore, promotion and the custodian's papers copy that set through `liveSeriesBases`
(`packages/fiscal-verifactu/src/reserved-series.ts:44-73`). A fourth stored purpose rides that copy
unchanged; a series made on the side would have to be taught to every one of those paths.

**True size, estimated.** PR 1 touches about 400 files, over nine tenths of them tests and fixtures;
about 47 are production code or live docs. PR 2 touches about 120 to 170 files: about 36 production
files, the rest test fixtures that list a box's series. Generated files in each Waitron PR: the core
set's starting migration (`packages/db/drizzle/0000_baseline.sql`, `meta/0000_snapshot.json`) and
`scripts/migration-baseline-epoch.json`. PR 3 (Waitron Cloud) is about 15 files of test rig.

**Approvals.** The owner asked for both changes (above). The plan has not been read or cleared yet;
when the watcher clears it, the clearance is recorded in lane L's `questions.md`.

## Provenance

| Claim | Source | Its own words | What we take from it |
| --- | --- | --- | --- |
| Correctives of tickets (R5) and of full invoices (R1 to R4) may not share one series | Adviser's answer 1.14, second half, as restated in `docs/compliance/2026-11-15-adviser-answers.md:379-380` | "No. They are different types and must use separate series (RD 1619/2012 arts. 6.1.a and 7.1.a)." | Two corrective series. That file restates the adviser's draft in our words (`:19-20`); the draft is "subject to review" and is not in the repository. |
| The owner decided they will not share | Same file, `:387`; `docs/compliance/2026-11-19-adviser-meeting.md:454` | "You decided on 15 November that they will not share, so no decision is needed" | No owner decision is pending on the split itself. |
| Correctives always go in a series of their own | `docs/compliance/2026-11-19-adviser-meeting.md:206` (owner, 18 November, answering question 8's wrong-day corrective, `:194`) | "always use a separate series for correctives" | Correctives stay apart from tickets. It was said about tickets versus their correctives, not about R5 versus R1 to R4. |
| A ruling allows ticket correctives in the ticket series | `docs/compliance/asesor-questions.md:326` | "Ticket correctives may stay in the ticket series (V2884-16)." | Not a contradiction: it allows sharing with tickets, which the owner declined; it says nothing on R5 sharing with R1 to R4. |
| A1407's R4 replacement waits partly for this | `docs/backlog.md:375-380`, `:1271` | "Turning it on waits for full invoices' correctives to get a series of their own" | PR 2 removes that half of the wait; the AEAT test-service probe remains. |

## Decisions

1. **Rename first, then the series** (my call). A rename that changes no behaviour is checked by
   the existing tests as they stand, so any failure is a rename slip. Doing the series first would
   shift what "rectificative" means (from every corrective to ticket correctives only) and would add
   new names beside old ones, so a later mechanical rename would have to tell the two meanings apart.
2. **The four purposes are `standard`, `full`, `corrective` and `full_corrective`** (my call),
   with request fields `seriesCode`, `fullSeriesCode`, `correctiveSeriesCode` and
   `fullCorrectiveSeriesCode`, the pattern `fullSeriesCode` already set
   (`packages/provisioning/src/venue-plan.ts:36-38`).
3. **Which series a corrective takes follows the invoice it corrects**: one naming a customer takes
   `full_corrective`, any other `corrective`. This is the rule a sale's own series already follows
   (`packages/core/src/record-sale.ts:255`) and the R4-or-R5 typing uses
   (`apps/server/src/invoice-typing.ts:69,88`). Core refuses a mismatch before a number is
   allocated, as it does for sales (my call).
4. **`fullCorrectiveSeriesCode` is optional and defaults to `FFR`**, as `fullSeriesCode` defaults to
   `FF` (`venue-plan.ts:149,231`). That keeps the CLI, test venues and Cloud's callers working
   without the field. The setup page always sends it, with `FFR` as its default beside `FS`, `FF`
   and `FR` (`apps/setup/src/screens/venue-screen.ts:428-430`) (my call; the owner may pick another
   code).
5. **Labels** (my call; the owner may reword). Series lists: "Standard", "Full invoice",
   "Corrective", "Full invoice corrective"; Spanish "Simplificada", "Factura completa",
   "Rectificativa de simplificadas", "Rectificativa de completas". Setup fields: "Corrective series
   code" and "Full invoice corrective series code".
6. **What the one word covers** (my call). "Corrective" names the document. "Correction" stays where
   it names the act of correcting or the correction under way before a corrective exists: the
   `invoice_corrections` table, its routes and `invoice_correction.*` codes, `recordCorrection`. A
   label naming the document becomes "Corrective", and so does the till's "credit note", a fourth
   word for the same document (`apps/till/src/i18n/strings.ts:2006-2058`,
   `apps/till/src/i18n/codes.ts:405`).

**Does a box mid-chain need anything at its next series start?** It would. A box set up with three
series copies three at its next handover, restore, promotion or emergency switch, and
`assertHourSeriesConfiguration` (`packages/fiscal-verifactu/src/hour-series-configuration.ts:4-11`)
will refuse them once it requires four; before that, any full-invoice corrective would be refused
`series.no_full_corrective_for_node`. Nothing is built for it: both Waitron PRs change the core set's
starting migration, which resets every venue, and backups and exports from before cannot be
restored or imported (`docs/developers/conventions-data.md:4088-4090`; CLAUDE.md §3's last rule).
**Each Waitron PR's first line says: "Venue reset needed."**

**Left out on purpose.** Turning on `FULL_INVOICE_REPLACEMENT_ON`
(`packages/fiscal-verifactu/src/put-right.ts:17`): it still waits for the R4 "S" probe on AEAT's test
service. Renaming "correction" where it names the act (decision 6): tables, routes, stored incident
codes and the daily close's hashed `counts.corrections` key would all change for no word a person
reads differently. Historical specs, plans and compliance papers keep their words. `promote.ts:278-279`
and `restore.ts:1041-1042` check only the standard and full series after activation; the whole set is
checked before activation, and that stays.

## PR 1: one English word, "corrective" (no behaviour change)

First line: "Venue reset needed: the stored series purpose `rectificative` becomes `corrective`."

1. **The stored purpose.** In `packages/db/src/schema/series.ts:43`, `reserved-identity.ts:80`,
   `packages/provisioning/src/venue-plan.ts:113`, `configuration-transfer.ts:115`,
   `packages/fiscal-verifactu/src/setup/strings.ts:1` and the four checks
   (`allocation-identity.ts:69`, `custodian/custody-state.ts:149`, `hour-series-configuration.ts:7`,
   `initial-paper-candidates.ts:29`), and in every test literal (206 files), `"rectificative"` becomes
   `"corrective"`. Include the stored copies in `packages/country-es/test-fixtures/demo/madrid-before-move.{en,es}.json`
   (as a value and inside the `@invoice_series:[…]` keys). Run
   `pnpm --filter @waitron/server migration-baseline rebuild --set core`. The signed
   `packages/fiscal-verifactu/test/cloud-allocation-receipt.json` names `rectificative` inside its
   packet, and the repository holds only its public key, so it cannot be signed again here.
   `cloud-evidence.test.ts:91-113` ("validates a consumed packet produced by the landed Cloud signer")
   moves to `cloudReceiptFixture` (`packages/fiscal-verifactu/test/cloud-fixture.ts:5`), which signs
   a changed copy with a fresh key; its `:109` expectation changes from `rectificative` to
   `corrective`, and the case is renamed for what it now proves. Cloud's current allocation package
   names no purpose (`git grep -n purpose -- packages/fiscal-allocation` in waitron-cloud printed
   nothing). Leave `paper-register-history.test.ts:586` on the original bytes if it passes, since it
   carries them opaquely.
2. **Names.** `rectificativeSeriesCode` → `correctiveSeriesCode` (170 files); `seedRectificativeSeries`,
   `rectificativeSeriesId` and test locals likewise; `--rectificative-code` → `--corrective-code`
   (`packages/provisioning/src/cli.ts:97,182,238`, both READMEs); `series.no_rectificative_for_node`
   → `series.no_corrective_for_node` in every copy (`packages/db/src/errors.ts:44`,
   `reserved-identity.ts:99`, `apps/server/src/till-api.ts:519`, `apps/till/src/i18n/codes.ts:404`,
   `packages/fiscal-verifactu/src/dashboard/put-right-words.ts:41`, `remedy-refusals.ts:36`); the
   setup keys `venue.label/field.rectificative_series_code`, `review.rectificative_series(_base)`
   (`apps/setup/src/i18n/strings/venue.ts:96,120,180,183` and Spanish twins); the `rectificative:`
   label key (`setup/strings.ts:18,72`, `custodian/strings.ts:246,253`).
3. **Words people read.** "Rectificative series code", "correction series code", "Corrections series
   (base)" become "Corrective series code", "Corrective series (base)"; the Spanish twins become
   "Serie rectificativa" (today "Serie de correcciones", `venue.ts:452,455`). "Correction" as a
   series or document label becomes "Corrective" (`setup/strings.ts:18`, `custodian/strings.ts:246`,
   the till's `find_page.correction`, `strings.ts:757`, the corrections workbook's kind in
   `apps/server/src/i18n/corrections-report.ts`, the dashboard's `overview.corrections` and
   `sales.corrections` counts, `apps/server/src/i18n/daily-report-email.ts:9`, `apps/server/src/i18n/deferred-payment-export.ts:14`). The till's
   "credit note" texts say "corrective invoice". Guides, English and Spanish with the same `{#id}`:
   `invoices.md:61` and `table-service.md:356` name the kind **Corrective**. Comments that say
   "rectificative" in English say "corrective" (about 27 files, among them
   `apps/server/src/cancel-credit.ts:40`, `packages/core/src/record-replacement.ts:42`).
4. **Live docs.** `apps/server/README.md:196,236`, `packages/provisioning/README.md:33,50,75,196,273`,
   `docs/developers/emergency-recovery.md:54`, `docs/developers/paper-custodian.md:119,165`, and the
   identifiers in `docs/backlog/fiscal.md` and `docs/backlog/till.md`.

**Tests.** No assertion changes meaning; the ones that change spell the new names, such as
`packages/core/src/record-replacement.test.ts:432` (`expected: "rectificative"` → `"corrective"`) and
`packages/provisioning/src/venue-apply.test.ts:487`. `correction-amount.huella.test.ts:41` changes its
purpose literal and its pinned huella at `:181` must not change. Run each changed package's changed
files (`pnpm --filter <pkg> exec vitest run <files>`); then `git grep -il rectificative -- ':!docs'`
shows only the Spanish `rectificativa` forms; then the guards below.

## PR 2: correctives of full invoices get their own series

First line: "Venue reset needed: every box now has four invoice series."

1. **Schema and core (test first).** In `packages/core/src/record-replacement.test.ts`, add: a full
   invoice replaced with the `corrective` series is refused `sale.series_wrong_purpose` with
   `expected: "full_corrective"`, using no number; a ticket replaced with `full_corrective` is refused
   with `expected: "corrective"`. Watch both fail. Then add `full_corrective` to the CHECK
   (`series.ts:43`) and rebuild the core set; `readLiveSeriesIdTx` takes it and throws
   `series.no_full_corrective_for_node` (`reserved-identity.ts:77-105`, `errors.ts:41-44`, the 409s
   at `till-api.ts:519` and `remedy-refusals.ts:36`, words at `put-right-words.ts:41` and its
   dashboard strings in English and Spanish). `requireCorrectiveSeries`
   (`packages/core/src/corrective-series.ts:13-52`) takes the expected purpose; `recordReplacement`
   passes `full_corrective` when the original names a customer (`record-replacement.ts:59,96`), and
   `recordCorrection` passes `corrective`, so its refusal order stays as it is
   (`record-correction.ts:164,184`; it refuses full invoices anyway). Changed assertions:
   `record-replacement.test.ts:355-402` and `:479-519` pass a full-corrective series instead of the
   ticket one (today `rectSeriesId`, `:33,47,127`).
2. **The writer.** `record-remedy-replacement.ts:82` reads `full_corrective` for an F1 target and
   `corrective` for an F2. In `record-remedy-replacement.test.ts`, seed a `full_corrective` series
   `RF`. Changed assertions: `:381` `numSerieFactura: "R/1"` → `"RF/1"`; `:398-400` the `RF` counter
   moves by one and the `R` counter does not. New case: an F1 with no live `full_corrective` series
   is refused `series.no_full_corrective_for_node`, 409. `apps/server/src/testing/replacement-fixture.ts`
   picks the same way; update each server test whose printed corrective number changes, listing
   them in the commit message (not enumerated here). `cancel-credit.ts:55` and
   `invoice-corrections.ts:378` keep `corrective`: they correct only tickets.
3. **Provisioning.** `fullCorrectiveSeriesCode?` with default `FFR` in `venue-plan.ts` (`:36-38`,
   the duplicate check `:146-156`, the plan `:230-232`), `first-setup-module-context.ts:29-32`,
   `recover-provisioned-venue.ts:25-29,59-61` (three becomes four), `configuration-transfer.ts:87-160,605`,
   `first-setup-state.ts:213-224`, `cli.ts` (`--full-corrective-code`), `packages/fiscal/src/contribution.ts:228-233`,
   `packages/fiscal-verifactu/src/venue-fields.ts:14-70`, `apps/server/src/setup-api.ts:609,696` and
   `setup-first-fiscal-api.ts:417`. Test first: `pnpm --filter @waitron/provisioning exec vitest run src/venue-apply.test.ts`
   expects four series rows.
4. **The series checks and lists.** The four checks read `seriesPurposes`
   (`setup/strings.ts:1`, now four) and its length instead of a literal 3
   (`allocation-identity.ts:69`, `hour-series-configuration.ts:6-7`, `initial-paper-candidates.ts:28-29`,
   `custodian/custody-state.ts:140,149`). The labels (decision 5) go in `setup/strings.ts`, and
   `register-pdf.ts:117-125` and `first-fiscal-screen.ts:458` read the label map instead of a
   three-way choice. Test first: `hour-recovery-state.test.ts:240` and `initial-hour-setup.test.ts:943,958`
   gain `full_corrective`, and a three-series set is refused.
5. **The setup page.** A fourth field on the venue step and a fourth row on the review step
   (`venue-screen.ts`, `review-screen.ts`, `server-fields.ts`, `setup-app.ts`, `api/client.ts`,
   `first-setup-types.ts`, `i18n/strings/venue.ts` in both languages). Look at it in both languages,
   light and dark, at phone width.
6. **Fixtures.** Every test or helper that lists a box's whole series set gains the fourth (about 95
   files hold a `{ code, purpose: "corrective" }` literal after PR 1; only those listing the set
   change), the Madrid fixtures gain the fourth row, and `custodian-fixture.ts`,
   `live-conflict-fixture.ts` and the receipt from PR 1 carry four.
7. **Docs and backlog.** `docs/operations/first-live-fiscal-setup.md:161` and `hour-recovery.md:226`
   name four prefixes; both READMEs and the two developer docs gain the fourth base. Guides: no page
   names the series (`git grep -n -i series -- apps/server/src/guide/en` shows only "lists each with
   what it is for"), so none changes unless that grep finds more at build time. Backlog: drop "and for
   full invoices' correctives to get a series of their own" and the sentence after it from
   `docs/backlog.md:375-380` and the matching clause from A1407 (`:1271`); add a dated line to
   `docs/backlog/fiscal.md` at A1e (`:283-289`) and after `:1283`; trim the stale "until adviser
   question S14 is answered" from `put-right.ts:14-16`.

## PR 3 (Waitron Cloud): the cost rig provisions four series

`scripts/cloud-cost/waitron-adapter.mjs:57,69-70,124-131` requires exactly three series and the field
`rectificativeSeriesCode`; its fixtures (about 13 files) and
`packages/registration/test/fixtures/fiscal-registry-schema.ts:7-9` spell the old purpose. After
Waitron's PR 2 lands, rename the field, accept four series and select the fourth. That repository's
own checks apply.

## Checks for every Waitron task

Run unedited and passing: `pnpm --filter @waitron/fiscal-verifactu exec vitest run src/write-path.e2e.test.ts src/inmutabilidad.test.ts`.
Root guards: `pnpm exec vitest run scripts/schema-constraints.test.ts scripts/append-only-triggers.test.ts scripts/behavioural-triggers.test.ts scripts/starting-migrations.test.ts scripts/english-only.test.ts scripts/errors-reachable.test.ts scripts/alert-codes.test.ts scripts/setup-wizard-fiscal-fields.test.ts`.
`pnpm test <file> -t` drops the `-t`; use `exec vitest run … -t`. Run `format:check` on changed files.
Each task is one implementer's work, well under 100 tool calls; PR 1 task 1 and PR 2 task 6 are
mechanical but wide, and split by package if they grow.

## Needs the owner

Nothing blocks the plan. The owner may want to change decision 4's `FFR` code or decision 5's
labels, and may overrule decision 6 if "correction" should go everywhere.
