# Correctives of full invoices get their own series, and correctives get one English name: plan

> Lane L, 21 November 2026, item SERIES-SPLIT-CORRECTIONS. Fiscal: the owner lands every PR. Code
> facts were read on main at c4b677c44f, not run, unless a line says what was run. Counts come from
> `git grep -l` at that commit. Revised the same day after a fresh Claude read; each finding was
> checked against the code before it went in.

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
(`isAllocatedSeries`, `packages/fiscal-verifactu/src/allocation-identity.ts:44-85`), and handover,
restore, promotion and the custodian's papers copy that set through `liveSeriesBases`
(`packages/fiscal-verifactu/src/reserved-series.ts:44-73`). A fourth stored purpose rides that copy
unchanged; a series made on the side would have to be taught to every one of those paths.

**Nothing numbers from the new series yet.** The only writer of a full-invoice corrective is the R4
replacement (`recordReplacement`'s one caller is `record-remedy-replacement.ts:75`), and its remedy
is offered only while `FULL_INVOICE_REPLACEMENT_ON` is true (`put-right.ts:17`,
`record-remedy-routes.ts:37`); it is false. So the fourth series stays at number 1 until A1407
turns that on.

**True size, estimated.** PR 1 touches about 400 files, over nine tenths of them tests and fixtures;
about 47 are production code or live docs. PR 2 touches about 40 to 60 files once PR 1 has put the
tests' whole-set series lists behind one constant: about 36 production files and a few fixtures.
Generated files in each PR: the core set's starting migration (`packages/db/drizzle/0000_baseline.sql`,
`meta/0000_snapshot.json`, `meta/_journal.json`) and `scripts/migration-baseline-epoch.json`.

**Approvals.** The owner asked for both changes (above). When the watcher clears this plan, the
clearance is recorded in lane L's `questions.md`.

## Provenance

| Claim | Source | Its own words | What we take from it |
| --- | --- | --- | --- |
| Tickets and full invoices of one year need separate series | Invoicing regulation (RD 1619/2012) art. 7.1.a, quoted in `docs/compliance/research/2026-10-09-vat-and-corrections.md:340-341` | «será obligatoria la expedición mediante series separadas de unas y otras» | Already built: `standard` and `full`. |
| Correctives of full invoices need a series of their own | V2884-16 (binding), same file `:344-345`; art. 6.1.a, `:347` | «la expedición de las facturas rectificativas debe efectuarse obligatoriamente con una serie específica, distinta de aquella que identifica a las facturas completas»; art. 6.1.a makes it obligatory «en todo caso» | Full invoices' correctives may not sit in the full-invoice series. The same ruling lets ticket correctives stay in the ticket series, which the owner declined. |
| Whether R5 and R1 to R4 may share one corrective series | Same file `:359-361` (bullet d) | "No source addresses it directly." | Our research found no law or ruling on the point. |
| They may not share | Adviser's answer 1.14, second half, as restated in `docs/compliance/2026-11-15-adviser-answers.md:379-380` | "No. They are different types and must use separate series (RD 1619/2012 arts. 6.1.a and 7.1.a)." | That file restates the adviser's draft in our words (`:19-20`); the draft is "subject to review" (`:16`) and is not in the repository. |
| The owner decided they will not share | Same file, `:387`; `docs/compliance/2026-11-19-adviser-meeting.md:454` | "You decided on 15 November that they will not share, so no decision is needed" | No owner decision is pending on the split. |
| Correctives always go in a series of their own | `docs/compliance/2026-11-19-adviser-meeting.md:206` (owner, 18 November, answering question 8's wrong-day corrective, `:194`) | "always use a separate series for correctives" | Correctives stay apart from tickets. It was said about tickets versus their correctives, not about R5 versus R1 to R4. |
| A1407's R4 replacement waits partly for this | `docs/backlog.md:375-380`, `:1271` | "Turning it on waits for full invoices' correctives to get a series of their own" | PR 2 removes that half of the wait; the AEAT test-service probe remains. |

**Separating R5 from R1 to R4 rests only on the adviser's answer 1.14, a draft subject to review,
and the owner's 15 November decision.** No law or ruling we hold says it.

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
   allocated, as it does for sales (my call). Corrections by differences stay on `corrective` only
   because `requireSupportedCorrection` refuses any invoice naming a customer
   (`packages/core/src/correction-eligibility.ts:5-8`). Two lane L items are building corrective
   writers that must pick by the same rule: ADVISER-ADVANCES' corrective for a no-show's kept
   deposit, which may correct an advance invoiced in full to a company, and
   ADVISER-GOODWILL-CORRECTIVE.
4. **`fullCorrectiveSeriesCode` is optional and defaults to `FFR`**, as `fullSeriesCode` defaults to
   `FF` (`venue-plan.ts:149,231`). That keeps the command-line tool and test venues working without
   the field. The setup page always sends it, with `FFR` as its default beside `FS`, `FF` and `FR`
   (`apps/setup/src/screens/venue-screen.ts:428-430`) (my call; the owner may pick another code).
   _2026-11-21 22:43: the owner picked the defaults S (standard), F (full), SR (corrective) and FR
   (full corrective), relayed by the watcher; the build follows them, so `fullSeriesCode`'s default
   is `F` and the new code's is `FR`, not `FF` and `FFR`._
5. **Labels** (my call; the owner may reword). Series lists: "Standard", "Full invoice",
   "Corrective", "Full invoice corrective"; Spanish "Simplificada", "Factura completa",
   "Rectificativa de simplificadas", "Rectificativa de completas". Setup fields: "Corrective series
   code" and "Full invoice corrective series code".
   _2026-11-23 09:44: the owner kept the Spanish and asked for English to match it, relayed by the
   watcher; the series are now "Corrective of simplified invoices" and "Corrective of full invoices",
   and the setup fields "Corrective of simplified invoices series code" and "Corrective of full
   invoices series code"._
6. **What the one word covers** (my call). "Corrective" names the document. "Correction" stays where
   it names the act of correcting or the correction under way before a corrective exists: the
   `invoice_corrections` table, its routes and `invoice_correction.*` codes, `recordCorrection`. A
   label naming the document becomes "Corrective", and so does the till's "credit note", a fourth
   word for the same document (`apps/till/src/i18n/strings.ts:2006-2058`,
   `apps/till/src/i18n/codes.ts:405`). Identifiers naming the document as a credit note (`creditNotes`, the
   invoice kind `credit_note`, `creditNoteNumber`) become "corrective" too (2026-11-22, after review).

**Does a box mid-chain need anything at its next series start?** It would. A box set up with three
series copies three at its next handover, restore, promotion or emergency switch, and
`assertHourSeriesConfiguration` (`packages/fiscal-verifactu/src/hour-series-configuration.ts:4-11`)
will refuse them once it requires four; before that, any full-invoice corrective would be refused
`series.no_full_corrective_for_node`. Nothing is built for it: both PRs change the core set's
starting migration, which resets every venue, and backups and exports from before cannot be
restored or imported (`docs/developers/conventions-data.md:4088-4090`; CLAUDE.md §3's last rule).
**Each PR's first line says: "Venue reset needed."**

**Left out on purpose.** Turning on `FULL_INVOICE_REPLACEMENT_ON`: it still waits for the R4 "S"
probe on AEAT's test service. Renaming "correction" where it names the act (decision 6): tables,
routes, stored incident codes and the daily close's hashed `counts.corrections` key would all change
for no word a person reads differently. Historical specs, plans and compliance papers keep their
words, and so does Cloud's `packages/registration/test/fixtures/fiscal-registry-schema.ts:7-9`, which
describes kept data from the removed registry. `apps/server/src/promote.ts:278-279` and
`apps/server/src/restore.ts:1041-1042` check only the standard and full series after activation; the
whole set is checked before activation, and that stays. **Waitron Cloud needs no PR now:** its cost
rig (`scripts/cloud-cost/waitron-adapter.mjs:57,69-70,124-131`) requires three series and
`rectificativeSeriesCode`, but it runs Waitron pinned at `REPLAY_REVISION = b1b0f10952`
(`scripts/cloud-cost/replay-release.mjs:5` in waitron-cloud), so it changes only when that pin next
moves. Whoever lands PR 2 adds one line saying so to Cloud's
`docs/backlog/cost-conformance-fixtures.md`, the cost rig's bundle, as a docs-only commit there.

## PR 1: one English word, "corrective" (no behaviour change)

First line: "Venue reset needed: the stored series purpose `rectificative` becomes `corrective`."

**How the rename is made.** Tasks 1 and 2 are one list of `git ls-files … | xargs perl -pi -e …`
commands, written down in the PR description. On a rebase, take main's side of every file the list
touches and run the list again, rather than resolving its conflicts by hand. Two branches in flight
add the old word (`git diff main...<branch> | grep -c '^+.*rectificative'`):
`feat/a1558-join-by-code` (2 lines) and `feat/a802-partial-invoice-correction` (12 lines); whichever
lands second runs the list too. `bench/box-installer/run.mjs:968` is the one untyped file holding the
old word (`git grep -ln rectificative -- '*.mjs' '*.js' '*.sh' ':!docs'`), and no workflow runs it
(`grep -rn box-installer .github/workflows` printed nothing), so check it by eye.

1. **The stored purpose, and one test constant.** In `packages/db/src/schema/series.ts:43`,
   `reserved-identity.ts:80`, `packages/provisioning/src/venue-plan.ts:113`,
   `configuration-transfer.ts:115`, `packages/fiscal-verifactu/src/setup/strings.ts:1` and the
   checks (`allocation-identity.ts:69`, which only checks a purpose is known;
   `custodian/custody-state.ts:149`; `hour-series-configuration.ts:7`; `initial-paper-candidates.ts:29`),
   and in every test literal (206 files), `"rectificative"` becomes `"corrective"`. Run
   `pnpm --filter @waitron/server migration-baseline rebuild --set core`. Add `SERIES_BASES`, the
   whole set as `{ code, purpose }`, to `packages/db/src/testing/seed.ts` (already exported as
   `@waitron/db/testing/seed.js`); each test or helper that lists the whole set imports it instead
   (browser tests keep their own lists). Keep the order standard, full, corrective:
   `apps/server/scripts/testing/venue.ts:52` picks the corrective series as `seriesIds[2]`.
   - **The Madrid fixture stays as it is.** `seed.madrid-baseline.test.ts:757` checks each fixture's
     sha256 against `madrid-before-move.manifest.json`, which also pins `invoice_series: 3` per phase
     (manifest `:359,591,1057,1289`). Add a step beside the table renames (`:803`) that renames the
     purpose in the series rows and in the `@invoice_series:[…]` keys.
   - **The Cloud receipt tests.** `cloud-allocation-receipt.json` names `rectificative` inside its
     signed packet, and the repository holds only its public key. I ran a throwaway Vitest file in
     `packages/fiscal-verifactu` (deleted): a receipt signed afresh with a purpose the reader does not
     know answered `reservation_untrusted`, with valid trust and with none; the control with today's
     purposes answered `ok: true`. So every case in `cloud-evidence.test.ts` that reads the old bytes
     (from `:8`, about 22 cases) would pass or fail on the purpose word, not on what it tests. Move
     the whole file onto `cloudReceiptFixture` (`packages/fiscal-verifactu/test/cloud-fixture.ts:5`),
     which signs a changed copy with a fresh key, and keep one case on the original bytes asserting
     they are now refused. Changed assertions: `:91-98` ("validates a consumed packet produced by the
     landed Cloud signer") now validates the re-signed copy and is renamed for that; `:106-110` expect
     `corrective`. Cloud no longer signs these: its allocation package was removed in Cloud #711
     (531dacfb0), and at the receipt's source commit 8b59faa its `validation.ts:136` accepted exactly
     `standard`, `full` and `rectificative`. This reader is a historical format already listed for
     removal (`docs/backlog/fiscal.md:1626-1640`), so no independent signer is left to compare with.
     Leave `paper-register-history.test.ts:586` on the original bytes if it passes, since it carries
     them opaquely.
2. **Names.** `rectificativeSeriesCode` → `correctiveSeriesCode` (170 files); `seedRectificativeSeries`,
   `rectificativeSeriesId` and test locals likewise; `--rectificative-code` → `--corrective-series-code`
   (`packages/provisioning/src/cli.ts:97,182,238`, both READMEs); `series.no_rectificative_for_node`
   → `series.no_corrective_for_node` in every copy (`packages/db/src/errors.ts:44`,
   `reserved-identity.ts:99`, `apps/server/src/till-api.ts:519`, `apps/till/src/i18n/codes.ts:404`,
   `packages/fiscal-verifactu/src/dashboard/put-right-words.ts:41`, `remedy-refusals.ts:36`); the
   setup keys `venue.label/field.rectificative_series_code`, `review.rectificative_series(_base)`
   (`apps/setup/src/i18n/strings/venue.ts:96,120,180,183` and Spanish twins); the `rectificative:`
   label key (`setup/strings.ts:18,72`, `custodian/strings.ts:246,253`).
3. **Words people read.** "Rectificative series code", "correction series code", "Corrections series
   (base)" become "Corrective series code", "Corrective series (base)"; the Spanish twins become
   "Serie rectificativa" (today "Serie de correcciones", `venue.ts:452,455`). The duplicate-code
   refusal "The series code and rectificative series code must differ."
   (`apps/setup/src/i18n/strings/shell.ts:73-74`, Spanish `:323-324`) names no pair any more, since
   any two may clash. The refusal is shown under the field the error names (`field` is in its params,
   `venue-plan.ts:146-156`), in the venue form's own words for a repeated code, on the Live claim as on
   the final request (2026-11-22, after review). "Correction" as a series or document label becomes "Corrective"
   (`setup/strings.ts:18`, `custodian/strings.ts:246`, the till's `find_page.correction`,
   `strings.ts:757`, the corrections workbook's kind in `apps/server/src/i18n/corrections-report.ts`,
   the dashboard's `overview.corrections` and `sales.corrections` counts,
   `apps/server/src/i18n/daily-report-email.ts:9`, `apps/server/src/i18n/deferred-payment-export.ts:14`).
   The till's "credit note" texts say "corrective invoice". Guides, English and Spanish with the same
   `{#id}`: `invoices.md:61` and `table-service.md:356` name the kind **Corrective**. English comments
   that say "rectificative" say "corrective" (about 27 files, among them
   `apps/server/src/cancel-credit.ts:40`, `packages/core/src/record-replacement.ts:42`).
4. **Live docs.** `apps/server/README.md:196,236`, `packages/provisioning/README.md:33,50,75,196,273`,
   `docs/developers/emergency-recovery.md:54`, `docs/developers/paper-custodian.md:119,165`, and the
   identifiers in `docs/backlog/fiscal.md` and `docs/backlog/till.md`.

**Tests.** No assertion changes meaning except the Cloud receipt cases above; the others spell the
new names, such as `packages/core/src/record-replacement.test.ts:432` (`expected: "rectificative"` →
`"corrective"`) and `packages/provisioning/src/venue-apply.test.ts:487`.
`correction-amount.huella.test.ts:41` changes its purpose literal and its pinned huella at `:181` must
not change. Locally, run only the focused files each task names
(`pnpm --filter <pkg> exec vitest run <files>`), among them `cloud-evidence.test.ts`,
`seed.madrid-baseline.test.ts`, `record-replacement.test.ts` and `correction-amount.huella.test.ts`;
CI runs the rest. Then `git grep -il rectificative -- ':!docs'` shows only the Spanish
`rectificativa` forms.

## PR 2: correctives of full invoices get their own series

First line: "Venue reset needed: every box now has four invoice series."

1. **Schema and core.** First add `full_corrective` to the database rule (`series.ts:43`) and rebuild
   the core set: a `full_corrective` series cannot be created before that. Then, in
   `packages/core/src/record-replacement.test.ts`, add: a full invoice replaced with the `corrective`
   series is refused `sale.series_wrong_purpose` with `expected: "full_corrective"`, using no number;
   a ticket replaced with `full_corrective` is refused with `expected: "corrective"`. Watch both fail
   on the refusal itself. Then `readLiveSeriesIdTx` takes the new purpose and throws
   `series.no_full_corrective_for_node` (`reserved-identity.ts:77-105`, `errors.ts:41-44`, the 409s
   at `till-api.ts:519` and `remedy-refusals.ts:36`, words at `put-right-words.ts:41` and its
   dashboard strings in English and Spanish). `requireCorrectiveSeries`
   (`packages/core/src/corrective-series.ts:13-52`) takes the expected purpose; `recordReplacement`
   passes `full_corrective` when the original names a customer (`record-replacement.ts:59,96`), and
   `recordCorrection` passes `corrective`, so its refusal order stays as it is
   (`record-correction.ts:164,184`). Changed assertions: `record-replacement.test.ts:355-402` and
   `:479-519` pass a full-corrective series instead of the ticket one (today `rectSeriesId`,
   `:33,47,127`).
2. **The writer.** `record-remedy-replacement.ts:82` reads `corrective` for an F2 target and
   `full_corrective` for anything else, so an F3, refused today, cannot drift into the ticket series.
   In `record-remedy-replacement.test.ts`, seed a `full_corrective` series `RF`. Changed assertions:
   `:381` `numSerieFactura: "R/1"` → `"RF/1"`; `:398-400` the `RF` counter moves by one and the `R`
   counter does not. New case: an F1 with no live `full_corrective` series is refused
   `series.no_full_corrective_for_node`, 409. `apps/server/src/testing/replacement-fixture.ts` picks
   the same way; update each server test whose printed corrective number changes, listing them in
   the commit message (not enumerated here). `cancel-credit.ts:55` and `invoice-corrections.ts:378`
   keep `corrective`: they correct only tickets.
3. **Provisioning.** `fullCorrectiveSeriesCode?` with default `FFR` in `venue-plan.ts` (`:36-38`,
   the duplicate check `:146-156`, the plan `:230-232`), `first-setup-module-context.ts:29-32`,
   `recover-provisioned-venue.ts:25-29,59-61` (three becomes four), `configuration-transfer.ts:87-160,605`,
   `first-setup-state.ts:213-224`, `cli.ts` (`--full-corrective-series-code`), `packages/fiscal/src/contribution.ts:228-233`,
   `packages/fiscal-verifactu/src/venue-fields.ts:14-70`, `apps/server/src/setup-api.ts:609,696` and
   `setup-first-fiscal-api.ts:417`. Test first: `pnpm --filter @waitron/provisioning exec vitest run src/venue-apply.test.ts`
   expects four series rows.
4. **The series checks and lists.** The checks read `seriesPurposes` (`setup/strings.ts:1`, now four)
   and its length instead of a literal list or a literal 3 (`allocation-identity.ts:69`,
   `hour-series-configuration.ts:6-7`, `initial-paper-candidates.ts:28-29`,
   `custodian/custody-state.ts:140,149`). The labels (decision 5) go in `setup/strings.ts`, and
   `register-pdf.ts:117-125` and `first-fiscal-screen.ts:458` read the label map instead of a
   three-way choice. Test first: `hour-recovery-state.test.ts:240` and `initial-hour-setup.test.ts:943,958`
   gain `full_corrective`, and a three-series set is refused.
5. **The setup page.** A fourth field on the venue step and a fourth row on the review step
   (`venue-screen.ts`, `review-screen.ts`, `server-fields.ts`, `setup-app.ts`, `api/client.ts`,
   `first-setup-types.ts`, `i18n/strings/venue.ts` in both languages). Look at it in both languages,
   light and dark, at phone width.
6. **Fixtures.** `SERIES_BASES` gains the fourth, last. The browser tests' own lists,
   `custodian-fixture.ts`, `live-conflict-fixture.ts` and the re-signed receipt carry four. The Madrid
   test's step adds the fourth row and maps the pinned count from 3 to 4.
7. **Docs and backlog.** `docs/operations/first-live-fiscal-setup.md:161` and `hour-recovery.md:226`
   name four prefixes; both READMEs and the two developer docs gain the fourth base. Guides:
   `git grep -n -i series -- apps/server/src/guide/en` prints about ten lines and none names a series
   kind, so no guide changes unless that grep finds one at build time. Backlog: drop "and for full
   invoices' correctives to get a series of their own" and the sentence after it from
   `docs/backlog.md:375-380` and the matching clause from A1407 (`:1271`); add a dated line to
   `docs/backlog/fiscal.md` at A1e (`:283-289`) and after `:1283`; trim the stale "until adviser
   question S14 is answered" from `put-right.ts:14-16`.

## Checks for every task

Run unedited and passing: `pnpm --filter @waitron/fiscal-verifactu exec vitest run src/write-path.e2e.test.ts src/inmutabilidad.test.ts`.
Root guards: `pnpm exec vitest run scripts/schema-constraints.test.ts scripts/append-only-triggers.test.ts scripts/behavioural-triggers.test.ts scripts/starting-migrations.test.ts scripts/english-only.test.ts scripts/errors-reachable.test.ts scripts/alert-codes.test.ts scripts/setup-wizard-fiscal-fields.test.ts`.
`pnpm test <file> -t` drops the `-t`; use `exec vitest run … -t`. Run `format:check` on changed files.
Each task is one implementer's work, well under 100 tool calls. PR 1's tasks 1 and 2 are wide but
mechanical; they split by package if they grow.

## Needs the owner

Nothing blocks the plan. The owner may want to change decision 4's `FFR` code or decision 5's
labels, and may overrule decision 6 if "correction" should go everywhere.
