# A679 changed test checks

Use this inventory to review changes to checks that existed before the replacement setup flow.
It records changes on the candidate branch, not acceptance of the finished product.

| Check | Before | After | Authority |
| --- | --- | --- | --- |
| `apps/server/src/first-fiscal-boot.test.ts:262` | Wait for `server.listening` in the interrupted child. | Wait for `recovery.listening`. | Owner approval, 2026-10-16 09:44, for these exact two lines. The replacement plan's Task 8 serves resolution before ordinary boot. |
| `apps/server/src/first-fiscal-boot.test.ts:280` | Child status equals `{ claimed: true }`. | Child status equals `{ claimed: true, resolution: true }`. | The same exact approval. Later ordinary raw-start status and resume checks stay unchanged. |

The launch fixtures in `apps/server/src/first-fiscal-launch.test.ts` now claim ownership, choose
candidates, import public evidence and confirm the current register before provisioning. Their
existing success, allocation-node and preproduction assertions stay unchanged. The two owner cases
use development mode to freeze preproduction, while the CLI case retains its explicit preproduction
environment. New checks compare the configured outside files' retained digests on both listeners.
Changing the passed paths to conflicting ambient paths failed both digest checks.

These launch fixtures isolate the fiscal contribution's external readiness requirement. With that
isolation removed, the direct development Live case returns `setup.request_invalid` for `aeatCert`:
preproduction forbids the certificate, but readiness's submission-target parser tries to read it.
The receipt is `a679-v2-audit/legacy-agent/real-dev-live-readiness-refusal.log` in the lane's local
receipts. Task 9 still needs to qualify that real path. Owner-bound activation uses its authenticated
public-evidence grant; the unchanged CLI case exercises the legacy environment fingerprint.

Earlier changes to non-fiscal workspace checks are recorded in the lane's 2026-10-16 07:24 FYI:
`packages/provisioning/src/first-setup-workspace.test.ts` now refuses changed current outside evidence
at selection installation. A separate case retains the original refusal after selection for changed
local directory evidence. The replacement plan's Task 8 distinguishes current outside sources from
the immutable retirement archive. No fiscal hash or filing assertion changes are covered by this inventory.

> **2026-10-17:** the hour plan replaces the Finish contract described in the following
> paragraph. See “Hour retirement and exact Finish” below; its older paper fixtures remain
> unfinished qualification.

The Finish fixtures now supply a consumed-current-register answer, including its consulted person
and public history reference, separately from publication inputs. You can inspect these additions
in `first-fiscal-declared-publication.test.ts` and `first-setup-finish.route.test.ts`. Their existing
assertions stay unchanged. New cases check the audit records, original bytes, interrupted writes
and refusal before a database opens. The request addition follows the replacement plan's Task 8
and its retained `RegisterAnswer` shape; it does not replace fresh outside confirmation.

The empty-selection HTTPS fixture in `apps/server/src/first-setup-empty-selection.route.test.ts`
now migrates the complete application schema instead of core alone. The real resolution listener
composes every available module; the new empty proof checks their required schema. Its earlier
assertions stay unchanged. The schema-scanner tests deliberately retain isolated orphan rows
without parents, so a parent table cannot conceal a missing scan of the sale or filing table.
The owner authorised this read-only empty-proof inspection on 2026-10-16 at 13:40.

The unused-PDF restart qualification adds two fixture corrections without changing an earlier
assertion. `apps/server/src/first-setup-retired-assignments.test.ts` now applies the complete module
schema instead of core alone. Its password-authorised empty replacement uses the same positive
schema proof as other empty-only actions; a new assertion checks that fixture precondition.
`apps/server/test/declared-first-fiscal.ts` gains optional candidate serials and workspace roots
for the new repeated-replacement cases. Existing calls keep their former inputs.

The shared-throttle case in `apps/server/src/first-setup-selection.route.test.ts` holds
`performance.now()` constant while it sends the requests. Its original refusal assertions stay
unchanged. In the retained failing run, the next request succeeded after an earlier 429;
the throttle's first delay can expire between real HTTPS requests. Socket timers remain real,
and the suite's existing mock teardown restores the clock.


## Hour-plan Task 3 — 2026-10-16

No existing assertion, fiscal fixture, golden suite or root guard changed. The existing
`module-operation-host.test.ts` gains one new opaque-store case; its earlier checks stay intact.
New hour-history/reader/selection, durable-store and real generic-route cases cover the new policy.
The route cases configure a test fiscal contribution with the real selector and host capability;
the production contribution switches in Task 4.

The owner separately approved four new SELECT-only enumerations in Lane E questions.md
(2026-10-16, watcher relay approximately 17:50), after the retained real-store completeness failure.
They select only the named fields from invoice_series, registro_sif, fiscal_allocations and
fiscal_reservations, sequentially and without WHERE predicates. Existing SQL and protected
writers remain unchanged. The deployment stamp is obtained through its existing database reader
and supplied to the transaction reader; no type cast or additional new SQL statement was added.

The generic candidate route now awaits preparation and gives durable writes a lazy password-grant
check. Existing pure validation still runs before consuming the grant; a new route test requires
an invalid reconfirmation to leave no hour ledger. Another new test restores an older module value
and requires the selector to retain the newer spent hour from host revisions.


## Hour-plan Task 4 checkpoint — 2026-10-16

Existing assertion expressions stay unchanged. The Demo case in `apps/server/src/boot.test.ts`
removes its supplied `initialOperations` fixture so it takes automatic preparation, as Task 4
requires. Its response, stored venue, environment, membership and restart checks remain.
The focused case first returned 400 against its retained 200 assertion, then passed with the
automatic fixture. A TypeScript token comparison retains all 293 assertion calls in the file;
that syntax check does not establish semantic equivalence.

`apps/server/test/declared-first-fiscal.ts` gains an optional environment, defaulting to production.
Only new cases request preproduction. Existing calls keep their former inputs. New checks use
this fixture's current declared-paper delivery to isolate readiness admission; they do not qualify
the unfinished hour naming or key-only PDF journey.

The new certificate-free readiness route exercises the actual fiscal contribution and retained
sample database. It records an uncertain preproduction result without credentials. Owned
preproduction publication proceeds without an authority-acceptance receipt; production still
requires its certificate and accepted readiness. This follows the existing ordinary setup route's
production gate and `FiscalContribution.activationReadiness`'s production-only contract.

The new disposable hour allocator has focused writer checks. An independently installed candidate switching that default reported
13 old-check failures across five files. Lane E's 2026-10-16 18:55 question proposes the exact
literal replacements and date fixture. The owner approved that exact patch at 20:00; the default
switch and those replacements are now applied. They change no golden suite,
numeric counter expectation or root guard.

The broader Task 4 run also reports the supplied-production case in
`fiscal-readiness-first-setup.test.ts`: its unowned provision returns `setup.owner_required`
instead of its retained success expectation. An independently installed candidate with every
tracked file restored to Task 4 base `54405e998f492442ecf00ccf14dc1b46a4cd79f6` reproduces that
same case and response. The fixture still needs the owned Live journey; its assertions remain.
This is an incomplete Task 4 checkpoint, with no final branch qualification or landing claim.

### Task 4 preparation adapter and host transition

No existing test file, assertion, fiscal fixture or guard changed in this checkpoint. New
`hour-preparation.test.ts` cases exercise the existing writer through the prepared-allocation
boundary. An initial failing case allowed a different authenticated operator to activate another
operator's saved intent; the retained intent now includes that operator in its binding. New cases
also require preparation to consume an existing intent without spending another hour, preserve all
configured bases and refuse changed input, clocks or history.

New `first-fiscal-hour-preparation.test.ts` cases exercise the real generic host's state lifecycle.
Its final preparation read initially refused after the callback entered `activation-started`.
That read is now admitted, while the replacement callback checks the earlier writable states.
A refused replacement rejects the whole held operation; the new test checks that outer rejection
and the absence of a preparation journal.

The adapter's clock/history providers are controlled fixtures in those component tests. The next
checkpoint below adds real local-history reads; full fiscal-contribution and mode wiring remains open.

### Task 4 approved disposable checks and real host facts

The owner's 2026-10-16 20:00 answer approves the exact five-file patch proposed at 18:55:

| File | Changed checks | Authority |
| --- | --- | --- |
| `packages/fiscal-verifactu/src/throwaway-allocation.test.ts` | Default-seat installation and series use literal `06RB`; reservation evidence is null and paper signing fields are absent. Throwaway markers, source binding, environment, clean SIF and historical explicit-signer checks remain. | Exact 20:00 approval; hour-code design, disposable setup. |
| `packages/provisioning/src/throwaway-allocation.test.ts` | Default-seat identity and all three series use `06RB`, for real and synthetic taxpayers. | The same exact approval. |
| `apps/server/src/provision-throwaway.test.ts` | Default-seat identity and all three series use `06RB`. | The same exact approval. |
| `apps/server/src/setup-throwaway.route.test.ts` | Shared expected-venue helper uses `06RB` and all three hour-coded series. | The same exact approval. |
| `apps/server/src/fiscal-readiness-first-setup.test.ts` | The disposable sample is `A-06RB/1`; all three disposable series retain their prior counter expectations. The supplied production fixture's `contract-S000001` expectation remains. | The same exact approval. |

All five files freeze Date alone at `2026-10-16T11:40:00.000Z` and restore real Date afterwards.
The approved patch had stray closing braces and an obsolete type member in the fiscal file;
removing that syntax debris changes none of its approved assertions.

New host-facts tests read the actual module history under the preparation hold, including a
revoked identity on another node and an occupied inventory without a deployment stamp. The
hosted adapter takes its scope, bases and configuration fingerprint from that host. These checks
use controlled clock decisions; they do not qualify browser or internet observation collection,
the complete wizard, CLI or recovery paths. The adapter and generic read interface are staged.
Boot supplies its existing database handle without opening another database here.

The broader Task 4 command still reports the retained unowned Live provision refusal above.
Its success assertion is unchanged. Keep Task 4 open until the owned production fixture and all
entry paths are qualified; this checkpoint is not branch readiness.

### Task 4 runtime clock collection

No prior assertion or fixture was changed in this continuation. The appended
`hour-selection.test.ts` case requires a trusted reader's matching clock confirmation and refuses
it after the decision changes. Previously the selection adapter passed no such confirmation to
its engine; the new real-host unavailable-comparison case refused even after explicit confirmation.
The selector now accepts that opaque proof from its trusted facts reader. Uploaded JSON still
cannot recreate the clock module's proof.

New clock tests time a browser response against a server-issued challenge, compare it with the
box and module-selected internet source, and project surviving observations to a later box reading.
A detected 180-second correction retires the displayed comparison. An old browser answer cannot
consume a newer challenge; a comparison already waiting on the internet cannot overwrite a newer
comparison. Missing release metadata still refuses after
manual confirmation. The new default-provider test reaches the unchanged activation writer and
retains one intent; real-host tests cover production and preproduction, with the external response
and embedded release controlled. These do not exercise an actual browser, external network, or
the configured wizard/CLI entry paths. Those paths and the retained production-readiness fixture
remain open under Task 4.


## Task 4 configured module and API

No existing test file or assertion changes in this continuation. The new
`apps/server/src/first-fiscal-hour-configured.test.ts` uses the actual configured contribution,
shared host, owner routes and provisioning writer. Only internet responses and immutable-release
metadata are controlled. `packages/fiscal-verifactu/src/initial-hour-setup.test.ts` covers exact
frozen-input validation and the configured contribution with controlled host facts; its host
fixture is not database or ownership qualification.

The first counted route run failed six cases because `/preparation` returned 404. The new route
and configured hour dispatch made those six pass. The complete new route file also covers actual
provisioning, committed-result reading, changed names, manual clock consent and refusal before
contacting an uploaded source. A later countdown case failed with `event_mismatch`: preview
substituted No for the stored Yes answer. It passes after preview retains the stored answer.

The five-file Task 4 command returned 55 passed and two failed. Both failures are in
`apps/server/src/fiscal-readiness-first-setup.test.ts`: the supplied production provisioning
case receives `setup.attempt_conflict` instead of its retained 200, and direct readiness receives
`outside_confirmation_missing` instead of `environment_mismatch`. The focused eight-file fiscal
command returned 201 passed and one failed: `initial-setup.test.ts` still expects configured
paper evidence to activate `S000001`. The tests and all their assertions remain untouched.
These results are failures, not whole-branch qualification. The proposed fiscal-check patch is
kept in Lane E receipts for exact permission before any application.

The protected allocation writer, restore hook, filing implementation and golden suites remain
outside this continuation's changed paths. Verify their Git blobs against the continuation base
when resuming; this inventory does not substitute for running their checks.


## Task 4 approved legacy checks and owned Live modes, 2026-10-16 22:49

The owner's 22:10 approval applies the exact 21:55 proposal. In
`packages/fiscal-verifactu/src/initial-setup.test.ts`, the former launch-configured paper case
now calls the historical paper collector directly. Its `S000001` series and stored-allocation
assertions are unchanged. In `apps/server/src/fiscal-readiness-first-setup.test.ts`, production
setup now uses the owned hour API and expects `hour/<owned event>` instead of `contract-S000001`.
Direct readiness without that session expects `outside_confirmation_missing` instead of
`environment_mismatch`, and additionally checks the scratch database's empty application tables.
The production success, node, administrator, counter and isolation assertions remain.

The existing Live certificate case in `apps/server/src/boot.test.ts` also uses the owned hour API.
Its original assertions are unchanged. Both boot fixtures share a test helper that claims ownership,
compares clocks, reconfirms the password, records the hour and submits the frozen module input.
Internet responses and the embedded release stamp are controlled; these checks do not qualify
actual browser or external-clock journeys.

A new mode check returned 200 for development Live without owned selection, including an import
request. The ordinary provision handler now answers `setup.owner_required` with 403 when its
configured host offers owned setup. The new mode cases also exercise automatic Demo and Preparation,
and owned development Live through publication. The original throwaway-route checks remain.

The browser API and tab session now transport opaque preparation proposals and readings. Six new
cases initially failed on the absent methods; the two files then returned 53 passes. Their checks
cover owner headers, selected-module binding, disposal, another attempt's response and a wait that
keeps the attempt unfrozen. Readings remain outside tab storage in these cases.

The broader boot file returned 60 passes and two failures: the missing setup bundle and excessive
maximum tick interval receive `setup.attempt_uncertain` before their expected `server.config_invalid`.
Their assertions remain unchanged. Follow the early target inspection in `boot.ts` before changing
that order. Lane F's parked A737 branch also changes `boot.ts`; this continuation leaves it untouched
under the lane's file-reservation rule. The prior baseline experiment is recorded in the plan ledger.

Task 4 remains open for CLI admission, full configuration-import mode qualification and later wizard
integration. This checkpoint does not qualify the whole branch, generated recovery PDF or recovery
entry paths. The local command logs, exact assertion inventory and installed omission controls are
in Lane E's `receipts/a679-hour-task4-modes-20261016-2234/`.

The extended mode run also found two fixtures in `first-fiscal-hour-readiness.test.ts` still
staging a paper document through the configured hour contribution. Those fixtures now use the
same owned-hour helper; their original 22 assertions remain. The final independently installed
candidate returned 77 server cases across eight files and 53 browser-session cases across two
files. The fiscal run returned 148 cases including the unchanged golden and immutability suites.
Six guard omissions each failed the intended check and passed after restoration. Three package
typechecks, scoped lint and focused root guards pass. Whole boot remains 60 passed and two failed
as listed above; these focused results do not establish branch readiness.

## Task 4 hour import qualification, 2026-10-16

To reproduce configuration import under the hour policy, run
`pnpm --filter @waitron/server exec vitest run src/first-fiscal-hour-import.e2e.test.ts`.
Its source venue uses the configured hour host and real provisioning: `06RA` with counters at 42.
The target imports its menu, uses `06RB` with counters at 1, and has different node and administrator
identities. The cases cover development Live targeting preproduction and production Live, each
with the same taxpayer or a new taxpayer. They close the server before reading its database,
restart successful setups and refuse replaced or missing staged imports before venue writes.

These are synthetic local journeys. The clock advances from a controlled instant with real
monotonic elapsed time. External clock observations, the release stamp, certificate validation and
AEAT drain replies are controlled. They do not establish actual external-clock, certificate or
filing behavior. The setup helper gains only an optional import claim; its existing assertions and
callers retain their checks. No production source changes in this continuation.

The eight-file focused setup/import command returned 72 passes; the unchanged golden and
immutability pair returned 20 passes. The retained `first-fiscal-setup.e2e.test.ts` still sends
`serials: [1]` and expects paper enrolment and register confirmation. Its selected readiness-after-
import case returned 400 at candidate selection instead of 200. The exact proposed fixture update
is in Lane E's `receipts/a679-hour-task4-import-20261016-2330/`; it has not been applied or run.
The A679 queue requires exact owner approval for existing fiscal-check changes.

A separate temporary CLI probe used the real command-line runner and its configured module host.
It returned exit 1 with `sif.allocation_invalid` / `reauthentication_required`, no taxpayer rows and
a preproduction stamp. Its desired-success assertion failed. Keep that reproduction when adding
the CLI's durable host; do not treat an uploaded input file as trusted hour-selection state.
The probe is retained in the same receipt directory, outside product source.

An independently installed checkout returned six import passes. Removing the import-digest guard
made the replaced artifact return 200 instead of 409; removing the table import left the expected
product absent. Both new checks failed on those omissions. After restoring the source, both
selected cases passed. No production file in the feature checkout was changed for these controls.

Task 4 remains incomplete. CLI admission, the retained import fixture, the two boot configuration
failures and later wizard/recovery/PDF tasks still need their own qualification.

## Task 4 retained import fixture — approval applied, 2026-10-17

The owner approved the exact proposed import-fixture patch at 00:03. Its SHA-256 is
`1a753dbcb88b518acf81fc73c428f5dc8050d265e3a6f483bd911dc0ad491433`.
The current test file matches that proposal byte for byte. The preceding 2026-10-16 entry records
the earlier failure; its permission wait is now closed.

| Check | Before | After | Authority |
| --- | --- | --- | --- |
| `apps/server/src/first-fiscal-setup.e2e.test.ts:309` | Candidate selection submits `serials: [1]`. | A clock challenge and comparison precede the taxpayer-wide No answer; the exported request must name `06RB`. | Exact owner approval, 2026-10-17 00:03; hour-plan Task 4. |
| Same file, former lines 284–302 | Two 200 checks cover custodian enrolment and current-register confirmation. | Two 200 checks cover the clock challenge and comparison. | The same exact approval. |

The fixture controls internet-clock and release replies. Its wall-clock reading advances from
16 October 2026 at 11:40 UTC using real monotonic elapsed time; ordinary timers keep running.
Every other original matcher remains, including readiness before/after import, certificate/email
requirements, import refusal, empty failed venues, publication and restart. No production source
changes in this continuation.

Run `pnpm --filter @waitron/server exec vitest run src/first-fiscal-setup.e2e.test.ts` to reproduce
the eight passing retained cases. This closes the fixture qualification only. CLI admission,
the two boot configuration failures and later wizard/recovery/PDF tasks remain open.

## Task 4 shared preparation host, 2026-10-17

The command-line composition root has no trusted facts reader or preparation journal. To make
those facilities available without importing the server application, the journal implementation
moves from `apps/server/src/module-preparation-state.ts` to
`packages/provisioning/src/module-preparation-state.ts`. Its complete 23-case suite moves beside
it; only package-local import paths change. Every original matcher is retained. No existing fiscal
check changes. The server now uses provisioning's `createSetupPreparationHost` for the journal
and matching asynchronous facts scope; its frozen-state/history/password checks stay at their
existing boundaries.

Eight new cases cover durable reopening, matching-scope facts, refusal outside a scope, a foreign
binding, a read that finishes after scope exit, refused operation and replacement authority, and
reuse of an existing coordinator hold. The initial forwarding implementation returned facts in
three forbidden cases; the behavioral run recorded three failures and three passes before the
scope checks were added. The first missing-file run collected no tests and is not that receipt.

Run the two provisioning files named in the plan's dated pointer to exercise the shared code.
This change does not wire the real CLI's claim, password, activation or publication lifecycle.
The retained CLI desired-success reproduction remains open, as do Task 4 and the later PDF work.

The broader host run exposed six failures in `module-operation-host.test.ts`. An independently
installed checkout of `ad8ca1a4fd304dac924361b621037eb64aeb2b35` reproduced all six by the same
names. Four ordinary-operation cases now pass without changing their assertions: the first-setup
evidence wrapper returns no evidence for a non-setup action, and verifies setup evidence before
checking assignment freshness. Seven new routing cases cover those four actions with no attempt,
missing setup ownership, and both fresh and reused assignments after real owner confirmation.

The final ten-file server command records 71 passes and two failures. The remaining names are
“the bound runtime retains independent trust after restart and prepares only a fresh owner-confirmed
attempt” and “binds configured outside evidence and invalidates every live confirmation after snapshot
recovery”. Their paper enrolment/document fixtures meet the new hour-only configured contribution.
Their original source and assertions remain unchanged; their replacement qualification belongs to
the unfinished setup/PDF work and its exact-permission rule. This is not a green server suite.

The four provisioning files record 172 passes. Coverage restricted to the moved journal and new
host reports both files at 100 percent for statements, branches, functions and lines. The unchanged
golden/immutability pair records 20 passes; the focused boundary/error guards record 3,036 passes.
Independent installed omissions of the scope, post-read scope check, replacement authority,
durable write, ordinary-action routing and assignment-freshness check each fail their behavioral
assertions, then pass after restoration. The moved journal's 40 original matcher expressions and
its non-import implementation statements match the starting commit.


## Task 4 provisioning command before-open check, 2026-10-17

The command now checks first-setup admission before opening the venue store, retaining its
check after opening. Two new interrupted-claim cases use the real store opener. Before the fix,
each returned `setup.attempt_invalid` but added `venue.db`, `node.db` and `venue.lock` to the
original directory. After the fix, only the unchanged claim file remains. A positive control
opens an unclaimed directory; another case introduces a claim during open and requires refusal
before stamping or applying the venue, with the opened store closed.

One existing resource assertion changes in `packages/provisioning/src/cli.test.ts`, in the
parameterised “does not ignore the fixed venue claim” case: close count **1 → 0**, plus a new
assertion that the opener was never called. The two parameter values and their domain-error,
no-stamp and no-apply assertions remain. This is a generic CLI resource-lifecycle check using
probe modules, not a fiscal, permission, login or money check. The hour plan's pre-open guarantee
and interrupted provisioning-command qualification require refusing before any store exists to
close. No other original matcher changes; no fiscal test, writer, SQL or guard changes.

The eight focused provisioning files pass 217 cases; the unchanged fiscal pair passes 20 and
four relevant root guard files pass 3,050. Types, scoped lint and source formatting pass.
An independent installed checkout passes all 65 CLI cases. Deleting the pre-open check fails
both directory-preservation cases; deleting the post-open check fails the during-open case.
Each restored control and the final 65-case run pass. Receipts remain in the lane's local
`a679-cli-lifecycle-20261017` directory. The first root invocation mistakenly selected a project
named `root`, which this config does not declare; the corrected command ran the counted cases.

This completes the command's before-open prerequisite, not Task 4. Its authenticated hour
selection, activation and publication integration remains unfinished, along with the earlier
recorded setup/PDF qualification. No current-head product CI, final review or landing is claimed.


## Task 4 shared ownership services, 2026-10-17

The CLI needs the same ownership services as the hosted setup. Eight implementations now live
in `packages/provisioning/src`: ownership, ownership audit, resolution inspection, empty-database
inspection, setup operations, password throttling, queued password attempts and atomic file writes.
Their original server paths re-export the implementations. Four error-code declarations move
with them; the code names and parameter types remain unchanged.

An audit against `f38cbe5ebd24d06b5fbfac1ec8572eff41674138` compares every non-import
implementation token. It also retains every original matcher expression in the moved suites.
The inspection suite splits at its server action tests: those integration checks stay in server;
the shared inspection and snapshot checks run in provisioning. The plain request fixture is copied
without changing its values. New ownership checks cover malformed claims, changed frozen IDs,
password-authorised resolution, stale writes and current-capability polling. New inspection checks
cover exact snapshots, missing evidence and required migration sets. No existing assertion is
removed or weakened; no fiscal writer, fiscal fixture, SQL, migration or guard changes.

The first relocation run failed on server action imports left in the shared inspection test;
splitting the suite fixes those imports. A new filesystem-fault check initially attempted to spy
on a native module namespace; it now uses Vitest's filesystem spy module. These were test-placement
and fixture errors, not product behavior fixes. The local receipt directory is
`a679-cli-owned-20261017`. Removing the capability or password check in its independently installed
checkout makes the corresponding existing refusal test fail; each restoration passes.

The actual CLI claim, hour preparation, activation and publication composition remains unfinished.
This extraction does not complete Task 4 or qualify the branch for landing.

The complete provisioning run passes 772 tests across 42 files but fails coverage at
94.98 percent statements, 92.87 branches, 98.62 functions and 97.25 lines. An independently
installed checkout of the exact starting commit passes its 565 tests but also fails coverage
(94.44/92.56/98.76/97.36). The source sets differ; neither run meets the package bar. The gap
remains open. The current server-consumer checks pass 46 cases, the unchanged fiscal pair passes
20, and eight repository guard files pass 4,768. Both package compilers, source lint/format and
the provisioning build pass. The independently installed revised tree passes 186 focused cases.
No package threshold, exclusion or ignore changes.


## Task 4 startup configuration order, 2026-10-17

With a configured setup directory missing `index.html`, or a maximum tick interval at the drain
budget, you receive `server.config_invalid` before the server inspects setup workspace files.
The workspace admission check remains before module configuration and the venue opener.

After rebasing onto main `f4ef363028efdb5670054cc083e937939a0e1364`, this command first fails
both existing cases with `setup.attempt_uncertain`, then passes them after moving the existing
configuration checks ahead of workspace inspection:

```sh
pnpm --filter @waitron/server exec vitest run src/boot.test.ts --maxWorkers=1 \
  -t 'fails the boot LOUDLY when WAITRON_SETUP_APP_DIR|rejects WAITRON_MAX_TICK_MS at or above'
```

No assertion or fixture changes. The complete boot, first-setup entry, resolution entry, failed-start
and clock-wiring suites pass 129 tests. The plan's five-file setup/readiness command passes 59;
the provisioning CLI and venue-apply files pass 108. The unchanged golden huella and immutability
pair passes 20; the module-boundary, dependency-cycle and deployment-image guards pass 3,146.
Server types, scoped lint, source formatting and whitespace checks pass.

In an independently installed disposable checkout, removing the maximum-tick check fails its
existing refusal case. Restoring it and removing the setup-app check fails the other refusal case.
Restoring both returns two passes. The receipt directory is `a679-cli-entry-20261017-0254`.
These checks qualify the startup change and selected rebased consumers. CLI lifecycle integration,
provisioning coverage and the remaining hour-plan tasks are still open.


## Shared owned preparation service, 2026-10-17

No existing test, assertion or fixture changes in this continuation. The new
`packages/provisioning/src/first-setup-preparation.test.ts` exercises selection and input import
through the shared owner, store and real hour contribution. Additional opaque module cases check
asynchronous preparation, multiple offerings, conflicting inputs and retired-assignment limits.
The HTTP routes now call that same service. This does not complete the command's claim, recovery
PDF, activation or publication journey.

The two retained paper suites, `setup-first-fiscal.route.test.ts` and
`first-setup-retired-assignments.test.ts`, return 42 failures and 36 unhandled rejections both at the
starting commit `118b02458b6e87e0fa499f07cfaf1c53b3cce353` in an independently installed checkout
and after this extraction. Their failing test names match. The local receipt directory is
`a679-cli-preparation-20261017`. Their hour/PDF qualification remains open; no existing fiscal
assertion changed to make this check pass.

## Owned terminal preparation, 2026-10-17

No existing test, assertion or fixture changes in this continuation. The complete previous
`initial-hour-setup.test.ts` remains a byte-identical prefix, followed by new terminal cases.
The new `packages/provisioning/src/first-setup-command.test.ts` uses the shared owner, store,
preparation journal and real hour contribution. Only external time replies and release metadata
are controlled. It checks password refusal, cancelled answers, retained waits, selected-input
replay, owner rotation, module version changes and retired-assignment floors.

The module owns the terminal questions and clock policy through `InitialSetupContribution.command`.
The generic stage waits until every contributing module has frozen its request before importing
any input, because the durable store accepts imports only after that transition. It returns owned
preparation state for the later delivery stage; it performs no activation or publication. The actual
`runCli`/`bin.ts` lifecycle remains unfinished. This does not qualify the complete provisioning
command or close Task 4.

The local receipts are in `a679-cli-command-20261017`. The protected allocation/restore source and
both golden suites match the starting commit. Existing coverage and retained paper-journey gaps
remain open; no threshold, exclusion, SQL, fiscal writer or guard changes in this continuation.

Returning to an unspent wait reuses its recorded answer and UTC target. A new clock comparison
is still required. The real-host password-recovery case first failed with `event_mismatch` because
the old wait used an owner-generation fingerprint. The host now supplies a stable continuation key
for waits while selected material and clock confirmations retain their owner-specific keys. The
existing `first-setup-runtime.test.ts` check that rejects a selected input after owner recovery
remains unchanged. An initial implementation applied the stable key to selections too; that
existing check failed and the implementation was narrowed to waits.

The focused final host command passes 69 cases across command, runtime and preparation files.
The six-file fiscal command passes 172 cases, including the 20 unchanged golden/immutability cases.
The command-stage-only coverage report names `first-setup-command.ts` and measures 100% in all four
metrics across 22 cases. This is not package-wide coverage. The attempted complete provisioning
coverage run exceeded its 300-second outer deadline before printing a case count; its full log and
process snapshot are retained. The earlier package coverage gap remains open.

The final independent installed checkout passes the same 69 host and 172 fiscal cases. Eleven
serial omissions each fail their intended assertion; every restoration passes. This includes the
unchanged selected-owner refusal. The first configuration-check omission was still rejected by a
downstream import check, so a cancelled-command preflight case was added and the intended omission
then failed. The initial receipt remains alongside the corrected controls. Both changed fiscal
test files retain their entire former contents as byte-identical prefixes. The disposable checkout
and its parent were removed after checking all 6,748 product paths and open working directories.

## Command ownership and preparation entry, 2026-10-17

Existing assertions remain unchanged. New command checks exercise
the shared claim, password recovery, retained wait and input-import stages. The built-command check
copies a migrated synthetic database and drives its real terminal prompts. Only the external HTTPS
clock call is replaced with an offline reply; it does not file anything.

An interrupted command must match its frozen request, environment and module versions before
recovering ownership. The recovered capability is checked before and after the database opens.
Declining the plan preserves ownership. JSON activation input does not grant owned setup authority,
and an incompatible deployment stamp is refused before a new attempt is recorded.

Preparation alone still returns `setup.not_ready` instead of applying the venue directly. Delivery,
activation and checked publication remain unfinished. Without a retired-evidence adapter, the shared
runtime also refuses a successor workspace before clock selection. This is a refusal for missing
evidence, not qualification of the future recovery path.

The local receipt directory is `a679-cli-lifecycle-20261017`. It retains initial failing checks,
installed omission controls and their restorations. The first decline control passed because the
new fixture's empty address prompted again and changed the request before confirmation. A new
assertion reproduced that unintended path; supplying a fixed address makes the case reach the
decline itself. Earlier control logs are retained separately from the corrected set.

Two existing server fixtures add `performance` beside `Date` in `vi.useFakeTimers`:
`first-fiscal-hour-configured.test.ts:35` and `first-fiscal-hour-readiness.test.ts:48`.
Every original assertion and expected value remains unchanged. In the independently installed
starting commit, adding a 1.1-second delay after comparison produces `clock_corrected` with the
original fixture and succeeds when both clocks are paused. The production correction check still
uses real elapsed time; the built-command check exercises it without fake timers.

The complete provisioning run passes 857 cases across 48 files. Its measured coverage is
95.17% statements, 92.9% branches, 98.4% functions and 97.37% lines, so the package gate still
fails. The corrected six server files pass 29 cases. The fiscal selection and protected suites
pass 160 cases; root boundary/error/teardown checks pass 3,117. Ten installed omissions fail their
intended assertions, with passing restorations; the final installed command/runtime run passes
149 cases. These results qualify this checkpoint, not Task 4 or the whole branch.


## Hour retirement and exact Finish — 2026-10-17

You can review these changes against the approved hour design’s keep/change/drop inventory
(“exact Finish” and “Consumed / Not consumed / Unknown”) and implementation plan Task 5.
A null register field records no consultation. Outcome and authority remain explicit in each
prepared/applied record; Finish also retains the checked commit with the original files.

| Existing check | Before | After |
| --- | --- | --- |
| `apps/server/src/first-fiscal-declared-publication.test.ts:238`, local audit check | Audit contains the supplied consumed-register answer. | Audit contains `register: null`; original-byte, digest, file-mode, ordering and allocation assertions remain. |
| Same file:330, malformed Finish payload cases | An unavailable consumed answer refuses with `setup.attempt_invalid`. | An obsolete register field in publication inputs refuses with `setup.request_invalid`; unchanged state and zero-publication checks remain. |
| Same file:379, recovered ownership case | Fresh password recovery without outside confirmation refuses. | The original capability still refuses; fresh password recovery plus exact commitment succeeds, with one initial activation and unchanged stored allocation. |
| `apps/server/src/first-setup-finish.route.test.ts:229`, request fixture | Every Finish silently receives a consumed-register answer. | Finish sends only its explicit body. The former missing-register representative becomes a consumed-register object that is now an unexpected field. |
| Same file:344, obsolete register payloads | Missing answer returns 400/request-invalid; other invalid answers return 409/attempt-invalid. | Every supplied register field returns 400/request-invalid before the database opens; no publication/restart remains asserted. |
| Same file:470, real resolution Finish | No new outside grant returns 400/allocation-invalid, retaining committed state and absent trading settings. | Fresh password recovery returns 200, complete state and the exact production trading settings; retained allocation comparison remains. |
| `apps/server/src/first-setup-empty-selection.route.test.ts:276`, missing declaration case | Missing register field is a malformed request (400/request-invalid). | The declaration-free request is well formed, but cannot authorise this fixture’s older register-based retirement (503/not-ready); no workspace selection remains asserted. |
| `packages/provisioning/src/first-setup-resolution.test.ts:88`, unused-assignment metadata | Null register is rejected with otherwise valid empty metadata. | Malformed `{}` and contradictory absence are rejected; new cases retain null with explicit local authority and observed outcome across restart. |
| Same file:396, unconsulted retirement/selection metadata | Null rejects beside empty-preactivation metadata. | Unknown-or-nonempty metadata still rejects; explicit empty or separately password-authorised missing outcomes can be recorded. Finish requires committed-exact. |

These are intentional generic host-contract changes. No existing hash, filing, invoice-counter,
login, cash-drawer or root-guard assertion changed. Old Finish fixtures still try to prepare paper
material through the configured hour contribution, so their revised assertions have **not** all
executed. They remain open work; their presence is not evidence of a passing Finish suite.

The new `first-fiscal-hour-finish.test.ts` uses the configured hour selector and real provisioning,
password recovery, storage and publication. Only external time replies and the release stamp are
controlled. It checks whole-hour exclusion across changed bases, immutable originals, original-root
refusal, positive full-empty proof, missing/corrupt/partial/unknown data, retained activation
history, exact module/venue/publication agreement, interrupted audit and selection writes, and
publication without fiscal replay. One case issues a real synthetic sale and compares its record,
chain, pending filing and advanced counter. The HTTPS boot case reads the retained database copy
that the resolution server actually used.

Receipts are in the lane’s `a679-retirement-20261017` directory. The independently installed exact
starting commit `7f7c93adb67c80725e46ab9581c1d8366758fe4a` reports 57 failures and 37 passes across the
six retained server suites. The installed candidate reports those same failure positions, plus the
new hour cases; `legacy-comparison.json` lists every name. This measures those six suites only.
Task 5 and the branch remain incomplete until their remaining qualification is resolved.


## Key-only recovery delivery and retained fixtures, 2026-10-17

You keep one A4 recovery PDF whose attachment contains the recovery key and its context. The new
browser units render and read that document; the old node-key codec remains unchanged. Download
and Print reuse one transient byte buffer. Disposal releases its references and Blob URL, and
local/session storage remain unchanged during the tested delivery session.

The reader requires one canonical attachment and a versioned digest in the PDF's metadata. This
checks consistency within the document. A rebuilt, internally consistent PDF remains unsigned;
you still need to authenticate its key against the matching backup. A copy with its attachment
stripped offers manual entry. Generated English and Spanish documents, including maximum-length
labels, were viewed locally. The owner's Drive acceptance remains open.

The host stores only the public binding, under `<module>.recovery.json`, beside the staged key's
verifier. `bindingDigest` covers the public recovery statement; it does not reuse the old
register's `historyDigest`. The separately named PDF digest binds the explicit kept confirmation
to the delivery session. A current password confirmation and exact owner, revision, stage, input
and document references grant activation once. Exact publication-only Finish reads the retained
public binding and installs the same staged verifier without replaying activation.

The server fixtures use a synthetic PDF digest and exercise real ownership, staging, activation
and publication. The browser tests exercise actual rendered PDF bytes. The new checks inspect
public files, collected backup inputs, HTTP errors/logs and browser storage for secret material;
they do not claim every future caller is covered.

| Retained fixture | Fixture change | Existing behavioral matchers |
| --- | --- | --- |
| `first-fiscal-declared-publication.test.ts` | Hour preparation and explicit key delivery replace the obsolete paper preparation. The retry recovers ownership with its password before exact Finish. | All 55 unchanged. |
| `first-fiscal-hour-finish.test.ts` | Keep the staged recovery document before activation. | All 79 unchanged. |
| `first-fiscal-setup.e2e.test.ts` | Add staging, public binding and explicit kept confirmation after hour import. | All 46 retained in order; three new successful-response checks. |
| `test/owned-hour-setup.ts` | Share the same HTTP staging and kept-confirmation steps. | The existing matcher remains; new steps use the same response check. |

The retained publication suite now passes 15 cases, the exact Finish suite passes 26, and the
manual-import suite passes eight. The shared-fixture boot/readiness selection passes 65. Across
the six Task 5 retained suites, the current measurement is 52 passes and 42 failures: interruption
(17), Finish routes (12), unused-PDF routes (12) and empty selection (one) still use obsolete
paper preparation. Their assertions have not all executed. Task 5 and the branch remain open.
The earlier complete provisioning coverage result remains below its bar; it was not remeasured
or declared repaired in this step. No protected writer, golden test, SQL, schema or root guard
changes in this step. Receipts are in the lane's `a679-task5-qualification-20261017` directory.


## Remaining Task 5 fixtures qualified, 2026-10-17

You can finish an exact committed setup after recovering ownership with its password. The retained
route fixtures now exercise the hour/key-only flow, so their publication and refusal assertions
run beyond the retired paper preparation. This updates the earlier qualification receipts above.

Authority: the approved hour design's entry-path table and retention/Finish decisions, and
implementation-plan Tasks 5 and 6. No production source changed in this continuation.

| Existing check or fixture | Before | After |
| --- | --- | --- |
| `first-fiscal-interruption.test.ts:72,163,175` | The fixture selects paper serials, imports a signed block, enrols its signer and confirms an outside register; retries use the provision route. | The shared fixture selects an hour, imports its exact input and explicitly keeps the staged recovery document. Password recovery precedes publication-only Finish through a real HTTPS listener. All test bodies from the first `it` onward are byte-identical; their counter, allocation, refusal, outcome and publication assertions remain. Six fixture-only HTTP-success matchers move to the shared hour transport checks or real ownership calls. |
| `first-setup-finish.route.test.ts:84,278,396,562` | The fixture delivers a declared register PDF. Three success journeys upload/confirm another register document before Finish. | The fixture keeps the key-only document. Those journeys rediscover the exact public stage and imported input; two also compare the staged-key file before and after Finish. Six obsolete document/reconfirmation success matchers are replaced by nine public-reference/key-preservation assertions. Existing allocation, permission, error, restart, settings and disabled-module assertions remain. |
| `first-setup-empty-selection.route.test.ts:24,350` | A missing paper-history file is declared only through an environment setting the hour contribution no longer reads. | A test module declares a missing evidence file through `resolutionEvidence`. The actual host and HTTPS entry still enforce the same refusal, error code and absent restart. All 35 matcher expressions remain. |
| `first-setup-unused-pdf.test.ts:56,124` | A paper fixture reserves serials 1 and 42; the successor tries 1, 2, 42 and 43. | The hour fixture keeps its document. Successors present literal earlier/current/later hours 06R9/06RA/06RB/06RC with different bases. The existing conflict/refusal and later-hour success assertions remain. Successive replacements advance the controlled clock by one hour. |
| Same file, evidence-refusal table | Corrupt or missing legacy manifest/chunk files refuse. | A malformed key-document manifest and a mismatched public binding refuse; key, stage, modules, missing database, unknown input and orphan-file checks remain. |
| Same file:317, rehashed document | The fixture checks one legacy chunk, then rehashes a statement with a false register confirmation. | The fixture checks the exact key-delivery kind, then recomputes the public digest after changing the key name. The same `setup.not_ready` refusal remains. This reaches the module's name-to-stage binding rather than merely failing JSON parsing. |
| `test/hour-first-fiscal.ts` | Every fixture owns a fresh root and omits its optional module configuration from the return value. | The fixture can enter a selected isolated workspace, retains optional module configuration, and removes only a root it created. |

The feature checkout passes 120 cases across the six retained suites and the hour-Finish suite.
The provisioning resolution/workspace pair passes 97. The protected golden and immutability pair
passes its unchanged 20 cases. These are focused results, not a complete-package coverage result.
The earlier provisioning coverage gap and the remaining command, recovery and wizard tasks stay open.
Receipts: the lane's `a679-task5-continuation-20261017` directory, including the full matcher inventory.

The independently frozen-installed candidate also passes all 120 cases. Removing the retired-hour
floor lets two forbidden hours through; removing the staged-key comparison permits a changed stage;
removing the module key-name comparison permits a rehashed mismatched document; removing both
publication-digest comparisons permits changed publication secrets. Each removal fails its named
assertion, and each exact restoration passes. The first control receipt classifier rejected Vitest's
“resolved instead of rejecting” assertion text; the corrected classifier and both attempts are retained.
Six protected writer/golden files match the continuation base byte for byte. Types, scoped lint,
source formatting and four focused root suites also pass. No complete-package coverage claim follows.

## Command recovery document delivery (2026-10-17)

The command accepts `--recovery-pdf` with an absolute path outside its state and venue
directories. Its module contribution renders the same key-only document used by the browser.
The shared host binds the saved bytes and requires explicit kept confirmation plus a fresh
setup-password check. Recovered ownership can confirm the exact saved document without
regenerating the key or selecting another hour. Activation and checked publication remain
unwired in the command; this checkpoint still refuses `setup.not_ready` after delivery.

No existing behavioral matcher or fixture changed. New cases in
`first-setup-command-document.test.ts`, `cli-first-setup.test.ts`, `cli.test.ts` and
`initial-hour-setup.test.ts` exercise the command delivery path. Existing fiscal writer,
hash, immutability, invoice-counter, permission and root-guard checks remain unchanged.

Verification receipts are in the lane's local
`receipts/a679-command-document-20261017` directory. Whole-package coverage and remaining
A679 acceptance gates are recorded separately; a focused pass is not a readiness claim.


## Production command publication (2026-10-17)

This checkpoint adds `WAITRON_SETUP_SETTINGS_FILE`, a bounded JSON file holding `aeatCert` and
`email`. The command validates these before the venue write, checks the existing authenticated
readiness receipt for the certificate, taxpayer, submission target, current schema versions and
build, and seals the validated snapshot into the vault during publication. Exact Finish checks
the original publication digest and does not require another readiness submission. Running a
readiness submission from the command itself remains open; the receipt fixture uses a controlled
accepted result and makes no claim about a real AEAT submission.

No existing test assertion or fixture changes. New cases extend `cli-first-setup.test.ts` and
`cli-owned-entry.test.ts`; both original file bodies remain byte-identical. The existing email
parser, readiness store and readiness-input builder move to provisioning without body changes,
and their server entry points forward there. The readiness suite is also retained at its server
path and copied unchanged beside the shared implementation. New publication-settings tests cover
validation and bounded file reads. Protected fiscal source/tests and root guards remain unchanged.

Receipts: the lane's `receipts/a679-production-command-20261017` directory. Task 4 and the whole
A679 branch remain incomplete. The owner approved explicit same-hour resume before activation;
that separate operation, command readiness submission, retained imports, recovery/wizard work,
coverage repair, generated-PDF acceptance and final branch gates remain.

**Later update, 2026-10-17:** the [same-hour resumption checkpoint](#same-hour-command-resumption-2026-10-17) implements that operation; the [command readiness checkpoint](#command-owned-readiness-2026-10-17) adds explicit test submission. Retained imports and later plan gates remain.


## Same-hour command resumption (2026-10-17)

Authority: the owner's 2026-10-17 15:00 answer permits a separate authenticated resume of the same selected hour and kept PDF. Ordinary changed-context refusals remain.

Existing assertions and fixtures changed: **none**. The retained command suites remain unchanged prefixes; the preparation-command suite adds one import for the new entry and new cases. No existing fiscal test or root guard changes.

New cases cover the stamped-but-unactivated retry, current recovered ownership and password confirmation, clock comparison and old-confirmation refusal, kept consent expiry, the staged-key binding, retained input/PDF, repeated resume and the owner-transition journal. A new fiscal suite covers exact scope/base/input binding, clock/history floors, continuous owner records and malformed journal entries.

A new built-command test first refuses an unset advertised origin before activation, then completes in a second process while retaining the selected input and identical PDF. It controls clock and network observations with a synthetic preload.

An additional audit case refused an orphan resumption belonging to another event only after journal validation was extended to every retained event. Its failing assertion and the omission control are retained with this checkpoint's receipts.

The new resumption fixture freezes wall and elapsed time together. Its earlier wall-only fake triggered the real clock-correction refusal when password verification took over a second. No product guard was changed for that fixture correction. The new journal-persistence assertion uses an awaited promise matcher so an omitted journal write fails an explicit admission assertion.

This checkpoint does not complete Task 4 or qualify the remaining recovery/promotion/wizard paths. The generated-PDF owner acceptance, package coverage and final branch gates remain.


## Command-owned readiness (2026-10-17)

Add `--test-fiscal` to your owned `waitron-provision venue` invocation when you need an accepted
readiness test. Confirm its separate question, including when you use `--yes`. The command uses
your validated certificate settings and records its sample in a retained preproduction database;
production activation still checks the authenticated receipt for the same certificate, taxpayer,
module versions and build. Declining, rejection and uncertainty leave production unactivated.
Repeat the command to retry the retained sample. Exact committed Finish sends no further sample.

Existing assertions changed: **none**. The one fixture change below has exact owner approval.
The command suites gain new cases; their
previous bodies remain unchanged. The existing server runner suite remains at its path, and its
behavioral cases also exercise the shared runner in provisioning. The server still supplies its
original clock. The runner's sample preparation, sale and drain bodies move to provisioning, with
an explicit clock argument and direct shared imports. The redundant environment field supplied to
the recovered-venue reader is removed; that reader does not accept or inspect it. No fiscal writer,
production SQL, schema or root guard changes.

The new binary check blocks external clocks and TLS transport. It checks the actual bundled
command's isolated sample, credential seal, refusal and unchanged production database. It does not
qualify a real AEAT submission. The accepted command cases control the external drain only.

New shared-runner cases also check malformed/unsupported inputs before file creation, an explicitly
supplied disposable hour across retries, and the real fiscal drain against controlled accepted and
rejected authority responses. Its 23-case diagnostic measures only the shared runner at 100% in all
four metrics; the whole-package gate remains below its thresholds. Eight installed omission
controls fail their intended assertions and pass after exact restoration.

The retained `fiscal-readiness-runner.verifactu.test.ts` case failed its old signed-paper fixture
at `sif.allocation_invalid`, both here and at starting commit
`572fef619d67ed258d9aa1be6d7914625a3de62a` in an independently installed checkout. The owner's
2026-10-17 17:00 approval authorises exactly the proposed patch with SHA-256
`a3ab9df05d3fd17bb5d6ed1df9d48d80d3a87faec96b87f1a388c2b5b5f9d089`: remove the
`initialSetupInput` import, creation of its paper fixture and the `initialOperations` argument.
The test now uses automatic disposable hour preparation; every existing assertion is unchanged.
Its one-sample, rejected-status and exact authority-refusal checks remain.

Task 4, package coverage, retained provision qualification, recovery/wizard work, owner PDF
acceptance and final review/publication gates remain open. Receipts: the lane's
`a679-command-readiness-20261017` directory.

## Retained configuration imports in the command (2026-10-17)

You can finish a claimed configuration-import setup through the owned venue command. It reads
the retained encrypted export with the setup key ring and checks the frozen artifact digest,
country, taxpayer choice and target module versions before activation. The existing transfer
service copies configuration inside the venue transaction. Imported counters and activation
identities stay out of that transfer. Exact Finish can complete after the staged export has
already been cleared.

Existing assertions and fixtures changed: **none**. The old command refusal case's title now names
missing staged material, rather than an unavailable adapter; its body is unchanged.
The artifact cipher, archive and key-derivation
suites move unchanged to provisioning. The existing server import, transfer and kitchen timing
suites retain their bodies and exercise the shared implementations through forwarding exports.
The transfer, staging, cipher, archive, derivation and kitchen timing function bodies and SQL
move unchanged; the kitchen timing parameter type now names only the location ID it uses.
Their error codes have one declaring home in provisioning, with the same names and parameter types.

The new command-import suite checks both taxpayer choices, fresh hour names and counters, changed
artifacts, target schema and taxpayer refusals, a replacement during readiness, rollback and
password-recovered Finish after staged cleanup. Its compiled-command case runs a relocated Node
bundle against a copied migrated synthetic database, with external clock transport blocked. It
checks imported dishes, the original selected hour, the same PDF and initial counters. This is
local qualification, not a real venue or authority submission.

New fixture corrections are retained in the lane receipts: product fields and source operator,
the staging directory, coherent wall/elapsed clocks, the publication metadata added to inputs,
the owner handle's type, and the command's optional address prompt. They changed no existing
assertion or product guard. Task 4, retained provision qualification, package coverage, later hour
tasks, owner PDF acceptance and final branch gates remain open.

Final installed focused checks pass 98 cases; the retained server group passes 172. The full
provisioning run passes 1,132 cases, but its unchanged coverage gate fails at 92.36% statements,
90% branches, 96.05% functions and 94.72% lines. That full run precedes the new suite's added
node-row and preserved-product-row assertions; the final focused group includes them.
Ten installed omission controls fail at the intended boundaries and pass after restoration.
The protected fiscal pair passes its 20 unedited cases. This is a local checkpoint, not branch readiness.

## Shared import service qualification (2026-10-17)

The shared staging and transfer services need checks in provisioning's own package, where their
coverage is measured. Three new suites cover encrypted staging after a key rotation, incomplete
publication, tampering, refused replacement, declaration and schema boundaries, dependent rows
left behind, fresh identifiers, BLOB bytes and ordinary text. Kitchen checks cover inherited
thresholds, invalid inputs, inactive stations and missing defaults. Their database fixtures use
the real opener and migrations; the kitchen and import targets use the non-filing GB regime.

Existing assertions and fixtures changed: **none**. Production source, SQL, schema, coverage
configuration and guards are unchanged in this qualification step. The new staging fixture's
initial error-code expectation, archive argument shape, module import and location enum values
were corrected against the real contracts before qualification; those failures were fixture
errors, not product defects.

Eight omissions in an independently installed checkout exercise stage validation, wrapped-key
version, previous-key recovery, effective station timing, default inheritance, dependent-row
filtering, BLOB decoding and import-version validation. Each fails its owning case, and each
restored case passes. The previous-key omission refuses a valid read before its value assertion;
the retained failure identifies that refusal explicitly. The complete retained `boot.test.ts`
suite passes all 62 cases unchanged; this step adds no startup-order fix.

A separate fixture proposal replaces `provisionAllocatedTestVenue`'s signed-paper setup material
with the real hour-preparation code and controlled clocks/history. In the installed proposal,
the retained provisioning and demo cases pass. Four HTTP setup cases remain failing. The exact
patch and comparison with the unmodified checkout are retained in the lane's approval question;
the proposal is not applied here. It qualifies a direct server fixture, not the real host's clock,
durability or PDF journey. Task 4 and the remaining branch gates stay open.

The final installed group passes 95 new cases. The full provisioning run passes 1,227 cases in
64 files; the unchanged coverage gate still fails at 94.55% statements, 92.38% branches,
97.22% functions and 96.77% lines. Staging and kitchen timing each report 100% in all four
measures. Transfer reports 92.76% statements, 89.7% branches, 94.44% functions and 93.52% lines.
These are package-run measurements, not a claim that the remaining setup journeys are complete.

## Retained provisioning and key boundaries (2026-10-17)

The owner approved the exact direct-provisioning fixture conversion at 19:00 on 2026-10-17.
`apps/server/src/testing/allocated-provision.ts:59` now prepares its input through the real hour
preparation service, using controlled box/browser clocks and synthetic empty history. It passes
that prepared module into the direct provisioning call. Its separate `initialSetupInput` function
is unchanged. The retained provisioning and demo-seed suites pass with every assertion unchanged.
This fixture does not qualify real host persistence, PDF custody, internet clocks or global
uniqueness. The permission identifies patch SHA-256
`280b0086e1b90c282f04228d384a0cf26e01ea62329a3d354cbc7206b37feaae`.

Two new provisioning suites check staged-key shape and binding, transient-secret loss, owner
rotation, exact committed-state installation, existing-verifier refusal and publication retry.
The context checks retain every configured purpose and exact base spelling, default `FF` when
the full base is absent, and refuse a module outside the frozen selection. The database cases
use the real opener and core migrations. No production source or existing assertion changes in
this qualification. Nine installed omissions each fail their intended assertion and their
restored cases pass: staged shape, node binding, transient stage, transient owner, committed node,
exact state, existing verifier, selected module and full-base default.

The four remaining HTTP setup failures have a separate fixture-only proposal. It uses actual
owned HTTPS preparation for Live imports and automatic disposable preparation for Demo and
Preparation, with controlled release/clock observations. Three invalid-import requests move to
the owned claim boundary, retaining their exact status and error-field checks. Three equality
expressions replace their obsolete `S000001` installation/series literals with `06RB` at the
literal 2026-10-16T11:40Z fixture time. Other existing expectation expressions remain.
The installed proposal passes all 46 retained consumer cases; its server typecheck and scoped
lint pass. It is not applied in this checkpoint and requires its own exact permission.
Its public-document helper registers a synthetic PDF digest; actual PDF rendering, download,
re-upload and owner acceptance remain separate qualifications.

Lane receipts: `a679-provision-http-20261017`. The proposal is
`proposed-boot-hour-fixtures.patch`, SHA-256
`b62e30c231c3ddff98eab9588ad00dc65463316b6c63141a6f36173799e9889c`.
The expectation audit retains 105 of the HTTP suite's 108 expressions; its three changed
equalities are enumerated above. This comparison does not establish fixture equivalence.

The final configured single-worker provisioning run passes 1,270 cases in 66 files. Coverage
still fails its unchanged gate at 94.79% statements, 92.76% branches, 97.51% functions and
96.95% lines. Staged node keys and module context each report 100% in all four measures.
The 43 new cases pass in the feature tree and the independently installed candidate. The
unchanged fiscal pair passes 20 cases, and the selected root guards pass 1,756 cases.
Task 4 and the remaining branch gates stay open.

### Exact HTTP-fixture approval applied at 19:45

The owner approved the exact `b62e30c2…` patch above at 19:45 on 2026-10-17. It is now
applied unchanged to `apps/server/src/boot.setup-routes.test.ts`. Its equality checks at lines
637, 649 and 1549 use `06RB` in place of `S000001`; the invalid-import requests at lines
1381, 1404 and 1511 use the owned claim route with their original refusal checks. The full
before/after expectation list is in the lane's `assertion-audit.json`. No other existing
expectation changes.

The final feature-tree setup/readiness selection passes 105 cases in eight files, including all
46 retained consumer cases. The disposable-allocation, hour-activation and unchanged fiscal pair
pass 87 cases in five files. Server typecheck, scoped lint and formatting pass. These fixture
checks control internet-clock observations and register a synthetic public PDF digest; they do
not qualify real internet clocks, an actual PDF, custody or owner acceptance. The full
provisioning coverage result above still fails its unchanged gate. The later hour-plan work
and final acceptance/review/CI remain open.

## Recovery preview and module admission (2026-10-17)

Existing test checks and fixtures changed: none. New suites cover archive, bucket and managed-Cloud
previews using real private database copies and the Cloud client's approved-point checks. The
external Cloud responses and bucket download are synthetic. A known filing selection requires
matching saved geography, module configuration and the original database/manifest migration counts;
a module with an empty migration set may legitimately record zero. Missing or conflicting evidence leaves the
preview without a filing selection. This field grants no operation authority.

The new module recovery-preparation suite uses the existing activation writer and restore hook.
It checks recovered counters, series retirement, a later surviving floor, exact committed replay,
source/context/input changes, recovery-key operator scope and isolation. Its host state and clock
observations are controlled fixtures. The adapter is not yet installed in the default recovery
hosts; these cases do not qualify archive/bucket placement, matching-secret authentication,
durable host evidence export, HTTP/CLI recovery or restart of those hosts. Task 7 remains open.


## Public hour evidence in backups (2026-10-17)

Existing assertion expressions and fixture values changed: none. Four new cases append to
`apps/server/src/hour-recovery.test.ts`; the separate new backup suites qualify public projection,
retained and conflicting floors, private-field exclusion, damaged input, workspace retirement and
archive/sealed-state capture. The nested-scope case first exposed an extra private field in the
export; the exporter now names each public field explicitly.

The new module source uses the existing `backup.nonDbState` declaration. Generic capture reads
the anchor preparation journal, asks the module for public records, and combines previously
exported evidence at the anchor and current workspace. The opaque journal, raw keys and PDF files
are not capture entries. The default archive writer and sealed-state refresher have real-database
checks after workspace retirement. The three selected-source preview checks read the exact archive
or sealed point; external Cloud responses and bucket downloads are controlled fixtures.

These checks qualify backup capture and preview transport. They do not yet qualify recovery-host
admission, matching-secret authentication, destructive placement, durable recovery restart or
source-specific HTTP/CLI Finish. The existing restore hook, writer, SQL, schema, fiscal assertions
and recovery-pack contribution stay unchanged. The prior provisioning coverage failure remains
open; isolated coverage of the new fiscal projector is not package coverage.

## Durable recovery preparation and configured dispatch (2026-10-17)

Existing assertions and fixtures changed: none. New server and provisioning suites exercise
the shared preparation journal, bound fact-read scopes, fresh key authentication and configured
module dispatch through the existing restore runner. A real encrypted archive supplies one
validated preview and public spent-hour floor. Clock transport and the release stamp are controlled
fixtures. The service combines the selected module's opaque evidence with the host's history;
its fact reader receives the database supplied by the restore runner.

Refreshing history from the committed database exposed a replay refusal that the earlier static
history fixture did not exercise. Committed replay now validates the retained event and input
before the unchanged writer checks its recorded result; it does not select a fresh hour. A new
host can finish that exact result without another clock comparison. The suites also retain
fresh-selection clock checks and wrong-key, changed-source, missing-selection and isolation refusals.

These are preparation-service and restore-hook checks, including durable host reconstruction.
They do not qualify default recovery HTTP/CLI composition, validation before database replacement,
actual staged-placement restart or bucket/managed-Cloud restoration. Task 7 remains open. No
protected writer, restore hook, SQL, schema, guard or existing fiscal assertion changes here.

## Actual recovery facts and admission before placement (2026-10-17)

Existing expectation expressions and fiscal fixture values changed: none. The new module reader
reuses the existing bases, active-result, complete-history and committed-restore readers. It owns
the database facts; the generic selected-source service supplies isolation checks and durable state.
The new cases cover repeated purposes, exact base spelling, retired names on another node, source
and target mismatches, missing scope, active-series inconsistency and exact committed results.

The selected runner now checks the source, named key, clocks, history and isolation before replacing
the destination or setting aside its identity. It checks a canonical private database copy under
the destination hold. A successful archive or bucket placement preserves recovered counters and
retires the recovered active series through the unchanged restore hook. An exact archive replay
after service reconstruction retains its current counters without another clock comparison.
These cases explicitly supply the selected runner. Default HTTP/CLI composition, surviving-target
history capture, real staged restart and managed-Cloud placement remain unqualified.

Two retained test utilities need these specific changes:

- `apps/server/src/restore.test.ts`, “a pre-existing VALID identity”: the old fixture makes the
  target's parent a file. At starting commit `9545dccd4`, `pnpm --filter @waitron/server exec vitest run
  src/restore.test.ts -t 'pre-existing VALID identity' --maxWorkers=1` fails with
  `setup.attempt_uncertain` before placement. The revised fixture provides a readable target and
  injects `ENOENT` at the placement's `mkdir`. Every original expectation remains unchanged,
  including no migration, the absent live identity and the exact set-aside bytes. In an installed
  starting checkout, removing the identity set-aside still fails the original absent-file assertion.
  No invoice, fiscal identity, money, permission or authentication fixture value changes.
- `apps/server/src/testing/s3-archive-scenario.ts`, `refusedDecrypt`: its callback's return type
  becomes `Promise<unknown>` because file decryption now returns the digest of its authenticated
  ciphertext. The callback's result was already discarded. Its two refusal assertions and all
  fixture values remain unchanged. The rehearsal itself is not run by this change's local checks.

New file-cipher cases check empty and multi-chunk digests and replace the archive pathname after
the descriptor opens. The digest and plaintext must still describe the authenticated descriptor.
Archive preview now uses validation's captured digest; its new case changes the caller's request
buffer while validation is suspended and still expects the original source. Bucket preview uses
the exact-point digest returned by validation rather than hashing the same file a second time.
No protected writer, restore hook, existing SQL, schema, guard or existing fiscal assertion changes.


## Surviving destination history (2026-10-18)

Existing assertions and fixture values changed: none. Eight new cases append inside the
selected-placement section of `apps/server/src/hour-recovery-host.test.ts`; a separate
`packages/fiscal-verifactu/src/hour-surviving-history.test.ts` adds four module-reader cases.
The selected service uses the module's opaque history reader while holding its existing
preparation exclusion. It retains captured snapshots in that service instance, including
through the placement callback. Snapshot-qualified record references let the module combine
an earlier row and its later retirement without reporting a contradictory copy.

The new archive/bucket refusal cases create a genuine newer database after the earlier clock
comparison, then check `hour_not_later` and unchanged destination rows and identity. The valid
older-target cases check exact recovered counters and the fresh series. Missing/refusing module
readers, a directory at the database path and a damaged database refuse before replacement.
The module cases include a higher retired other-node hour, separate taxpayer/environment scopes,
incomplete scope evidence and an empty migrated database. Their clocks, external replies and
release stamps are controlled fixtures.

This qualifies explicitly supplied selected runners, not default HTTP/CLI preparation or real
staged-process restart. Captured target snapshots are retained in memory by the service; this
change adds no separate durable journal for them. The shared preparation journal remains the
durable selected-hour authority. Actual historical invoice-row preservation, managed-Cloud
placement and the remaining Task 7 entry-path work remain open. No protected writer, restore
hook, SQL, schema, existing fiscal fixture/assertion or guard changes are part of this unit.

## Default restore admission, 2026-10-18

No existing assertion or fixture changes. Four cases are added inside the existing
`hour-recovery-host.test.ts` archive fixture. They exercise the restore command, staged archive
and staged bucket entry with a wrong node key, and direct archive restoration with a valid key
but no configured module preparation. Each checks that the original destination database and
identity remain intact. The command case forwards to the real file restore adapter with source
migrations.

Before the fix, all four database-preservation assertions failed: the destination contained a
SQLite database instead of its original bytes. The runner now exposes the existing pre-placement
check to every caller of `createRecoveryRestoreRunner`. It authenticates and prepares without invoking a restore hook;
the ordinary hook transaction still authenticates and prepares again before activation.

You can run these checks with:

```sh
pnpm --filter @waitron/server exec vitest run src/hour-recovery-host.test.ts \
  -t 'the default|without module preparation'
```

This qualifies refusal before placement. Default hour-preparation composition, fresh restart
clock comparisons, historical invoice preservation and managed-Cloud placement remain open in
Task 7. Protected fiscal writers, SQL, schemas and earlier fiscal assertions are unchanged.

## Staged admission retry, 2026-10-18

No existing assertion or fixture changes. Seven cases are added to
`apps/server/src/hour-recovery-host.test.ts`; its imports gain Node's `execFile` and `promisify`.
The existing archive fixture stays unchanged.

The first two archive/bucket probes reproduced a second-attempt `ERR_SQLITE_ERROR` instead of
`promotion.break_glass_invalid`. The staged marker said placement had started even though admission
refused before placement. The staging wrapper now observes an actual pre-placement exception and
restores the fresh request marker for requests retaining their node key. Failures after admission
keep the existing checked-replay path.

Four cases repeat wrong-key and missing-preparation refusals against the real file/bucket adapters.
They retain the exact original marker, destination database and identity. Two further cases invoke
the real staged restore in two separate Node processes and check the same wrong-key refusal and
retained files after each process exits. The seventh retains cleanup for a request without a stored
node key. That case failed against the initial broader wrapper and passed after restricting it to
requests with a stored node key.

You can run the new cases with:

```sh
pnpm --filter @waitron/server exec vitest run src/hour-recovery-host.test.ts \
  -t 'retries a staged|two separate processes|unstored-credential'
```

The process cases end normally after reporting their refusal. They do not qualify process death
during admission, power loss, successful staged activation, or a lost response after activation.
Default hour-preparation composition, fresh restart clocks, historical invoice preservation and
managed-Cloud placement remain open in Task 7. No protected writer, SQL, schema, guard or earlier
fiscal check changes.

## Historical invoices across selected recovery, 2026-10-18

No existing assertion or fixture changes. Four cases are appended to
`apps/server/src/hour-recovery-host.test.ts`. They use the existing selected archive fixture and
add imports for the real sale writer, fiscal backend, drain, record reader and Cloud recovery client.
Production code is unchanged in this unit.

You can run them with:

```sh
pnpm --filter @waitron/server exec vitest run src/hour-recovery-host.test.ts \
  -t 'retains issued invoices'
```

Each case records `A-06RB/123`, drains it through the synthetic AEAT HTTP transport and records
`A-06RB/124` without draining it. The real record validator and fingerprint computation check the
stored records before the backup is made. The fixture therefore contains a validated historical
chain, a saved acceptance receipt and a pending record rather than only unused series counters.

Archive bytes, an archive file and a bucket point use their real placement adapters. The fourth
case uses the real managed-Cloud recovery client with synthetic control-plane responses and
downloaded artifact bytes, then its archive placement adapter. All four compare every column of
the historical sales, lines, tenders, settlements, fiscal records and submission rows after restore.
They check exact recovered counters and retired series, refuse a sale on the old series and record
`A-06RC/1`. The earlier rows remain equal after that sale.

A reconstructed selected service then performs checked committed replay on the following day.
The bucket case replays the same bucket point; the other cases use the original archive.
The later sale, all stored submission facts and every series counter remain unchanged. No extra
allocation or preparation revision appears, and the synthetic internet-clock observer is not called.

In an independently installed disposable checkout, replacing the admitted database with a valid
snapshot captured before either sale made all four historical-row equality assertions fail. The
records and receipt rows were absent. That diagnostic snapshot exists only in the disposable test
copy; the committed test has no unused snapshot fixture. Restoring the original placement code
and final test source supplies the positive control.

These checks explicitly supply selected preparation. They do not qualify default HTTP/CLI hour
composition, the default S3 downloader, successful staged-process interruption or lost-response
recovery after process death. The managed callback places the archive directly rather than
running the setup route and restart sequence. Those Task 7 entry checks remain open. No protected
writer, restore hook, production SQL, schema, guard or earlier fiscal check changes.


## Reconstructed archive command admission, 2026-10-18

An already selected archive recovery needs its original preparation journal and fresh clock
observations when a command constructs a new host. The archive command and archive-pack command
now construct the selected-source service from the validated copy. You supply the matching node
key and the separate archive password as before. `--confirm-old-box-gone` and
`--confirm-sole-recovery` declare isolation independently of the allocation input. The latter
is your taxpayer-wide declaration; a local lock cannot establish what another venue is doing.

The generic module preparation contract adds `resumeRecovery`. Its fiscal implementation compares
the box with the authenticated internet observer without inventing a browser reading or manual
confirmation. Offline or disagreeing observations refuse admission before placement. A failed
admission can refresh again; each subsequent placement admission refreshes its transient comparison.
A checked committed event skips that comparison and retains its recorded hour, rows and counters.

Thirteen cases append to `apps/server/src/hour-recovery-host.test.ts`. Its original test bodies and
all 155 earlier matcher expressions remain unchanged; imports grow for migration-folder links and
the archive-pack fixture. This is a source comparison, not a claim of runtime equivalence.
The command cases use the default restore adapters and real archive validation, migration and
placement. The archive-pack case runs the actual downloader against a synthetic file-store
transport and checks that the pack password wins over a different environment password.
Refusal destinations carry counters different from the selected backup, so replacing the target
cannot satisfy the preservation assertions.

You can run the new cases with:

```sh
pnpm --filter @waitron/server exec vitest run src/hour-recovery-host.test.ts \
  -t 'reconstructed|default archive command|archive-pack command'
```

In an independently installed disposable checkout, omitting the refresh call, the committed-event
skip, either isolation declaration, archive-pack entry dispatch or repeated-admission refresh
made its corresponding new case fail. Restoring those changes supplies the positive control.
These are controlled clock/transport experiments, not live internet-clock qualification.

The initial new refusal fixture used an invalid destination file and could have refused before
reaching its intended clock check. Its replacement uses a valid destination with distinct counters.
A subsequent whole-file byte comparison failed on SQLite's WAL header changes; the retained cases
compare the saved series and allocation rows plus the identity instead. No earlier assertion or
fixture was changed. No protected writer, fiscal restore hook, production SQL, schema or guard changes.

Streamed-bucket command composition, staged HTTP recovery and genuine process-interruption or
lost-response recovery remain Task 7 work. Later hour-plan tasks, package coverage, generated-PDF
acceptance and final whole-branch reviews remain open. This checkpoint does not make #1752 ready.


## Streamed-bucket command admission, 2026-10-18

The bucket command accepts `--confirm-sole-recovery` independently of `--confirm-old-box-gone`.
It reconstructs module preparation from the validated downloaded point, its actual named key and
the original hour journal. The generation label remains display context; activation binds the exact
downloaded point. The archive and bucket commands share the same preparation constructor.

Nine cases append to `apps/server/src/hour-recovery-host.test.ts`. Every earlier test body remains
byte-identical, and no earlier fixture or assertion changes. Imports grow for the signed pointer,
sealed state, bucket preview and synthetic downloader. The successful case uses the command's
default stream adapter and actual child-process downloader boundary; the child copies a synthetic
database file. The other cases use the real stream adapter with an injected download callback so
they can inspect its domain refusal. No real S3 service or live internet clock is tested.

Run the new cases with:

```sh
pnpm --filter @waitron/server exec vitest run src/hour-recovery-host.test.ts -t 'bucket command'
```

The cases retain recovered counters, activate the selected fresh hour, and preserve distinct
destination rows and identity after offline/disagreeing clocks, missing isolation declarations,
wrong node or bucket keys, a changed point in the same generation, or an unconfirmed taxpayer.
The retained assertions compare stored series and allocation rows rather than database bytes.

Initial fixture runs selected a second source under an already used event, then supplied an invalid
generation name. Both refused during fixture preparation. After those corrections the command
reproduced the unsupported flag, then the unconfigured runner's `outside_confirmation_missing`.
A later source check exposed that the fixture hashed before the bucket reader opened the copy;
the final fixture obtains its selection through `previewRecoveryStream`. No existing check was
changed to address these fixture errors.

Staged HTTP composition, process interruption, managed transport/restart/Finish and the later
hour-plan gates remain open. No protected writer, fiscal restore hook, SQL, schema or guard changes.


## Staged entry reconstruction and committed process death, 2026-10-18

Staged archive and bucket requests can retain a separate selected-source label and the old-box
and sole-recovery declarations. The marker carries no authority: the entry reconstructs preparation
from a validated copy, the original journal and actual named-key authentication. It checks the
context's types before staging or using it. The shared constructor now serves archive commands,
bucket commands and the standalone staged runner. HTTP and wizard context wiring remains open.

Sixteen further cases append to `hour-recovery-host.test.ts`, for 25 additions in this checkpoint.
All earlier test bodies remain byte-identical. Two staged entries first failed with
`outside_confirmation_missing`; malformed context and missing-key requests then reproduced four
unexpected successful stagings before their validation was added. Eight refusal cases each retry
twice against distinct destination counters, retaining the destination, identity, fresh marker and
original journal. The private bucket preview copy is removed after each refusal.

Two cases start a separate Node process, substitute only the external clock observation and
release stamp, run real placement and kill that process with `SIGKILL` after the placement callback
returns. The parent requires that signal and the retained started marker, changes counters to 917,
then replays on the next day. The restored rows, counters, allocation rows and journal remain equal,
and the reconstructed parent host observes no internet clock. This checks process death after a
committed placement, not power loss or interruption inside an activation transaction.

The first staged bucket implementation previewed `restore-request.db` as if its directory held
`venue.db`, producing `restore.identity_unknown`. The entry now creates a disposable `venue.db`
copy before preview. This also retains the original staged point for retries. No protected writer,
fiscal restore hook, production SQL, schema, existing fiscal fixture or guard changes.

Run these cases with:

```sh
pnpm --filter @waitron/server exec vitest run src/hour-recovery-host.test.ts \
  -t 'staged'
```


Final installed controls omit the bucket preparation factory, either isolation declaration,
comparison refresh, the context/key requirement, committed replay dispatch and private-copy
cleanup. Each produces the intended behavioral failure, and the final restored suite is the
positive control. The first control wrapper asked for the word “expected” in a promise-refusal
failure whose actual message was “promise resolved”; its result was read and the classifier was
corrected before continuing, without repeating the qualified omission. An earlier invocation
could not start Vitest because its installed entry file was absent. The file state was retained,
the disposable checkout was reinstalled with the frozen lockfile, and no test evidence is attributed
to that failed invocation. The cause of the missing dependency file is unverified.


The final installed host suite passes 100 cases with no failures or skips after restoration.
Nine surrounding server suites pass 255 cases, and the protected fiscal pair passes 20 unchanged
cases. Server type checking, scoped ESLint, source formatting and whitespace checks pass. The
complete disposable candidate matches the source before removal. These are focused checks;
full-package coverage, HTTP/wizard integration and the later hour-plan acceptance gates remain open.


## HTTP recovery context and managed completion (2026-10-18)

Existing test checks and fixture values change: **none**. The three suites retain all 275 earlier
printed expectation expressions. The old host-suite test bodies and both other suite prefixes
remain byte-identical apart from the host imports. The source comparison is recorded in
`a679-http-recovery-20261018/assertion-audit.json`; it does not establish fixture equivalence.

- `apps/server/src/hour-recovery-host.test.ts`: thirteen new cases cover archive/bucket/managed
  HTTP handoff, six malformed archive contexts, managed completion and two child deaths inside
  the activation transaction. The three successful source journeys compare actual issued invoices,
  accepted/pending filing rows and recovered counters. Managed lost-response retries keep changed
  counters and allocation rows through the real committed-result check. Completed acknowledgement
  cannot move a reported operation back to restored; another point still refuses.
- `apps/server/src/setup-api.recovery-input.test.ts`: six new parameterized cases cover malformed
  contexts, corrected retries and request-hash binding of each source/isolation declaration across
  archive, bucket and Cloud routes. Existing bodies and fixture values remain unchanged.
- `apps/setup/src/api/recovery-input.test.ts`: one new browser case covers the public context in
  multipart archive transport alongside the separate key and opaque prepared operation.

The child fault runs the real activation writes and sends SIGKILL before their transaction commits.
The following process retains the original counters, allocates nothing and refuses publication.
This is a process-death experiment, not power-loss qualification. Internet readings and Cloud/S3
transport are controlled. The requests carry an already selected operation; they do not qualify
recovery-screen hour selection, declaration collection, rendered key entry, actual internet clocks
or a built appliance. Those interactive and installed journeys remain Tasks 9 and 10.

No protected writer, restore hook, fiscal assertion, production SQL, schema, guard or rule changes.
Raw receipts, including RED runs and installed omission controls, stay in the lane's
`receipts/a679-http-recovery-20261018` directory. Carry this inventory and every earlier section
into the final pull request's Changed test checks section.


## Selected-backup PDF and printed-key fields (2026-10-18)

No existing test body, fixture or assertion changes in this checkpoint. Three new suites add
17 module behavior cases, four accessibility cases covering both viewport widths, and four generic
setup cases. The module owns PDF parsing, scope/name matching and printed-key decoding; the
setup form uses its browser contribution and forwards the resulting secret.

- `packages/fiscal-verifactu/src/setup/recovery-key.browser.test.ts` enters values extracted from
  the actual generated PDF through native inner controls. It covers lowercase/grouping/look-alikes,
  exact secret output, wrong PDF scope/node/name, attachment-free manual fallback, oversize refusal,
  interrupted reads, native clearing, discarded drafts and the first edit after reattachment.
- `packages/fiscal-verifactu/src/setup/recovery-key.a11y.browser.test.ts` covers empty, invalid and
  imported states in EN/ES, light/dark and 390/1280 px. The imported state uses the native picker.
- `apps/setup/src/screens/recovery-key-fields.test.ts` checks module mounting, decoded credential
  forwarding, Clear, field-specific request refusal and required credentials on a fiscal selection.
  Its printed fixture was independently calculated with Python base32 and SHA-256; the expected
  raw secret is literal. Existing generic cases without a fiscal selection retain their checks.

Seven installed omission controls remove PDF matching, late-read checks, the file-size check,
parent-to-child clearing, mandatory fiscal credentials, reconnect registration and the printed
checksum refusal. Each produces the intended assertion failure and passes again after restoration.
The two new behavior suites then pass all 17 and four cases in that independently frozen-installed
checkout. These checks establish field decoding and forwarding, not authentication against a real
selected backup through the complete browser/server flow.

The setup compiler initially followed key-document types through the module root into Node-only
store types. The three type imports now use the existing browser-safe operation-authority path.
TypeScript's emitted JavaScript is byte-identical for `paper-register-protocol.ts`,
`paper-protocol.ts` and `allocation-operator.ts` before/after those import changes.
The PDF reader loads on file import. The setup build emits a separate reader chunk and worker;
its chunk-size warning remains. No dependency or licence input changes.

Receipts are in `receipts/a679-recovery-fields-20261018` under the local lane folder: RED logs,
counted browser checks, type/lint/build/guard logs, `controls.json`, `type-only-emit.json` and eight
inspected screenshots. The unedited golden/immutability pair passes 20 cases. No protected writer,
restore hook, production SQL, schema, guard or rule changes.

Task 9 remains incomplete: replace the pasted-operation workflow with authenticated interactive
hour preparation, finish the real first-setup/reissue flow and interruption ordering. Task 8's
exact protected-wrapper permission and Tasks 10–12 remain separate gates. The provisioning coverage
gate and owner acceptance of actual generated PDFs remain open; no readiness or landing is claimed.


## Interactive selected-source preparation (2026-10-18)

The hour plan's Task 9 adds an HTTPS-only setup endpoint and browser transport for module-owned
recovery proposals. The host authenticates the named key against a newly validated selected copy
on each request. It keeps comparison state between those requests and reuses the current setup
hold. Archive, bucket and managed-Cloud tests use their real adapters with synthetic external
responses; a separate case reaches the real setup boot over a connection that validates its CA.

`apps/server/src/hour-recovery-host.test.ts` gains cases and imports. No earlier test body,
fixture value or expectation is changed. The route and browser-client cases are new files.
The real-boot case initially refused `outside_confirmation_missing`: first setup's already-bound
module instance could not be configured for recovery. Recovery now receives the original module
contributions and configures its own host. The route also has observed failures and fixes for
malformed multipart input and an oversized stream without `Content-Length`.

This step does not replace the pasted-operation screen. The module-owned hour question,
clock/declaration controls, first-setup screen, reissue and installed complete browser journeys
remain open. Task 8's proposed protected standby wrapper remains unapplied pending its exact
approval. No protected writer, SQL, schema, guard or earlier fiscal assertion is changed.


## Browser recovery hour controls (2026-10-18)

The hour plan’s Task 9 now connects the selected archive, bucket kit and Cloud point to the
module-owned printed-key fields, taxpayer-wide question, clock comparison, explicit manual
confirmation and hour selection. The old-box and sole-recovery declarations travel separately
from the selected allocation. Editing them or the key invalidates the displayed selection;
Discard clears the native fields. A request refusal leaves retry available. Release/range blocks
and an ambiguous box-hour interval keep Select disabled; manual confirmation permits a clock
disagreement only while the box’s own interval stays within one hour.

The setup shell previously omitted the independent recovery context from its final archive and
Cloud bodies. New cases observed both missing fields and retained context after archive/bucket
refusal before the fixes. The real authenticator throws `promotion.break_glass_invalid` without
a field parameter (`apps/server/src/operation-authentication.ts`); observed browser failures now
map that code to the key fields in preparation and all three final restore screens.

`apps/setup/src/setup-app-recovery-credentials.test.ts` gains eight cases after its unchanged
earlier contents. New browser suites cover the module controls, accessibility and generic
selected-source wiring. Existing fiscal fixtures and assertions, protected writers, SQL, schema,
root guards and house rules remain unchanged. No earlier test check changes in this step.

These browser checks use the real key decoder, components and HTTP client with simulated endpoint
responses. They establish the client proposals, displayed states, invalidation and final body
forwarding; they do not establish a complete browser/server restoration with a real backup.
The surrounding server preparation/authentication receipts remain separate. The initial visual
captures clipped tall content; later element captures show complete controls. Vitest scales those
captures; layout widths and accessibility are checked in the browser at 390 and 1280 pixels.

Local receipts: `receipts/a679-browser-hour-20261018` under the lane folder. The independent
installed checkout catches and restores omissions of module mounting, selected-source checks,
isolation, stale-response rejection, edit invalidation, clock confirmation, shell context, refusal
clearing, operation binding and clock blockers. Later qualification and this step’s exact results stay in the
local ledger. First-setup/reissue UI, installed complete journeys, package coverage, actual
generated-PDF owner acceptance and both final reviews remain open. Task 8’s exact protected
wrapper question is unchanged and the proposed patch remains unapplied.


## First-setup hour review and PDF controls (2026-10-18)

Authority: the approved 2026-10-16 hour design and replacement implementation plan, Task 9.

- `apps/setup/src/setup-app-first-fiscal.test.ts`: the completed-activation/lost-response journey
  now selects an hour, imports the selected public input, prepares the real key-only PDF and
  confirms it kept. Its former signed-paper fixture and enrolment assertion are replaced by the
  hour fixture and assertions that no enrolment/current-master request is sent and exactly one
  kept request is sent. The certificate, revision 4 provision body, one activation request, exact
  completed read-back and no second activation assertions remain. The fixture adds clock,
  transient-key and public-document endpoints. New checks keep the draft protected until kept.
- `apps/setup/src/setup-app-first-fiscal.unsaved.test.ts`: the edited value becomes the taxpayer-wide
  Yes answer, replacing the retired paper serials `7, 8`. Both dirty checks, removal/reinsertion,
  the actual close-event wait, Keep, retained exact input and Discard navigation remain. The retained
  value assertion now reads the native radio's checked state. No fiscal writer assertion changes.
- New `screens/initial-setup-hour.test.ts` checks the owned clock action, preserved pending waits,
  separate password proofs, public delivery bodies and late-kept readiness invalidation.
- New fiscal `setup/first-hour.browser.test.ts` and its accessibility sibling exercise the real
  contribution factory, Madrid/Canary local time, all three taxpayer answers, clock blockers/manual
  confirmation, request retry, context replacement, exact frozen continuation and a non-authoritative
  countdown. The real PDF renderer/reader checks the delivered key, public bindings and one reused
  URL. Full backend browser journeys, authorised reissue and generated-PDF owner acceptance remain
  separate qualification; these endpoint replies are synthetic.

The first selected-draft check reproduced premature cleanup before PDF confirmation. The original
nested dirty assertion also caught a missing scope-parent connection. The initial countdown check
matched the target's ISO time even without a countdown; it is excluded as evidence. The corrected
check reads only the countdown field and was observed failing before implementation.

## Password-authorised unfinished-key reissue (2026-10-18)

No existing assertion or fixture value changes. New cases in
`packages/provisioning/src/first-setup-node-key.test.ts` exercise lost transient material,
password-resumed ownership, purpose-bound one-use authority, expiry, throttling and refusal after
activation starts. They compare the saved attempt before and after replacement and check both the
new verifier and the previous backup's retained verifier.

New `first-setup-key-reissue.route.test.ts` cases exercise the original-password endpoint, owner
headers, actual TLS-socket admission, foreign origins, malformed input and refusal without changing
the verifier. `first-setup-key-reissue.boot.test.ts` uses certificate-verified HTTPS on the real
setup listener, stops and restarts that server, resumes with the original password and checks the
attempt file remains byte-identical after reissue.

A new `first-setup-recovery-delivery.test.ts` case rejects the old kept grant and stale document,
registers the replacement and requires a new explicit kept confirmation. It checks unchanged setup
state and fiscal allocation rows, with zero provisioning/publication calls. The setup HTTP-client
case checks the password and current owner reach only the reissue endpoint. Browser controls and
completed-manager reissue remain unfinished; this client method alone does not provide either.

The broader server run reports ten failures. An independently installed checkout of starting
commit `0e1b2a56099ea983b67784e8e5985fb2404c6081` reproduced the same ten names in
`setup-first-fiscal.route`, `first-fiscal-delivery`, `module-operation-host` and
`first-fiscal-document.route`. Their complete names and logs remain in the lane's
`a679-key-reissue-20261018` receipts. They remain branch qualification work before finish-branch;
no whole-branch passing result is claimed.

## Hour standby activation and the same-hour question (2026-10-18)

No existing test, fixture or assertion changes. The new
`packages/fiscal-verifactu/src/hour-standby-activation.test.ts` checks the exact additive wrapper
approved by the owner on 2026-10-18 at approximately 09:00, plus hour-specific dispatch through
`activateModuleAllocation`. The first four cases failed at the obsolete reservation requirement
before that patch and dispatch were applied. This was a missing promotion path, not an observed
duplicate invoice.

With an original activation at 11:40 UTC (`06RB`), a selection at 11:50 refuses
`hour_not_later` for each taxpayer-wide answer. These cases read the real database through the
module's history reader. At 12:00, selection returns `06RC`. A separate direct activation attempt
using `06RB` refuses `installation_used`, including after the original SIF and series are retired;
the tests compare fiscal rows and counters before and after each refusal.

Next-hour activation creates every configured series, including two standard bases and `FF/full`,
without a fiscal reservation. Exact committed replay keeps counters; changed replay, active SIF
alone, active series alone, changed scope, incomplete bases, missing isolation and expired
authority refuse. A held call also checks that changing the caller's target, bases or authority
carrier cannot change the admitted activation.

The independently installed candidate passes all 22 cases. Eight omission controls fail and pass
again after restoration: complete dormant bases, active SIF, active series, hour-only source,
target snapshot, base snapshot, carrier snapshot and spent-hour floor. Removing the spent-hour
comparison makes all three same-hour selection assertions fail. No existing SQL, writer body,
hash, numbering, restore hook or protected assertion changes. The protected-file diff is exactly
the approved patch, SHA-256 `c99d9dd6957c83ded1505170a4b1a22e1e69963d3ec0f3dc31f40a4e32d4405a`.

These are module-boundary checks with synthetic clock readings. Dormant admission, the actual
host's promotion preparation and its complete browser/HTTP journey remain open in Task 8.
Unseen activity on a separate venue is still subject to the approved design's taxpayer-wide
coordination assumptions; this patch supplies no shared global reservation.

## Reported installation codes on the recovery sheet (2026-10-18)

Authority: the owner's 10:15 addition to the hour-code design, recorded in its dated addendum.
The PDF gains public `installationCodes`, and a recovery selection gains `installationCodes`
on its module-owned proposal. No fiscal expectation changes.

- `recovery-document.browser.test.ts` and `recovery-delivery.browser.test.ts`: the exact canonical
  document and public binding now include `installationCodes:["06RB"]`. Every former field,
  digest assertion, secret refusal and delivery-lifetime assertion remains.
- `initial-hour-setup.test.ts` and `setup/first-hour.browser.test.ts`: exact document statements
  gain their selected code (`06RB` and `06TH`, respectively); existing values remain unchanged.
- `setup/recovery-hour.browser.test.ts`: exact select proposals gain the entered public list.
  All prior clock confirmation, Yes/unknown waits, selected answer, isolation, secret, refusal
  and stale-response assertions remain. The shared ready fixture enters `06RB`. The accessibility
  suite enters the same code before driving each existing nonempty state.
- Document fixtures in recovery PDF/reader/key/delivery suites, the server's recovery-delivery
  and fiscal-setup suites, `test/hour-recovery-delivery.ts`, `test/owned-hour-setup.ts`, and the
  provisioning command suites gain the required public field. The two shared server helpers
  read the selected input's code rather than assuming a fixed hour.
- Existing `hour-recovery-host.test.ts` select fixtures gain `06RB`; existing expected outcomes
  remain unchanged. The new case supplies a later `06RC` absent from the backup and checks both
  refused rows and successful `06RD` activation.

New checks cover printed/attached codes, frozen-document binding, normalization and malformed
lists, retained waits, restart, backup projection, changed-code refusal, UI field validation,
late results after editing and an explicit hour-clash explanation. The initial edit check observed
the request call before its completion; it now waits for actual readable credentials before
checking that an edit invalidates them, and a separate gated case covers editing during a request.
No prior assertion was removed to resolve that test timing mistake.

The focused server suite completed 153 cases in 236.19 seconds. Its retained worker sample shows
scrypt work while the reporter was quiet; the run was not cancelled or labelled stalled.
Node/browser source checks and an independently installed copy qualify this delta, not the
whole A679 branch. Promotion host integration, manager reissue, earlier package-coverage and
legacy-server failures, complete entry journeys and final review/CI gates remain open.

Changed matcher locations (relative to this checkpoint; the JSON also retains old bodies):

- `apps/server/src/hour-recovery-host.test.ts:296, 304, 362, 389, 463, 614, 754, 772, 779, 803, 815, 824, 938, 3457, 3464, 3484, 3502, 3516, 3770, 3817`: only the authorised public field is added to the input, expected statement or canonical binding.
- `packages/fiscal-verifactu/src/initial-hour-setup.test.ts:83`: only the authorised public field is added to the input, expected statement or canonical binding.
- `packages/fiscal-verifactu/src/recovery-delivery.browser.test.ts:36`: only the authorised public field is added to the input, expected statement or canonical binding.
- `packages/fiscal-verifactu/src/recovery-document.browser.test.ts:32`: only the authorised public field is added to the input, expected statement or canonical binding.
- `packages/fiscal-verifactu/src/setup/first-hour.browser.test.ts:334`: only the authorised public field is added to the input, expected statement or canonical binding.
- `packages/fiscal-verifactu/src/setup/recovery-hour.browser.test.ts:157, 208, 247, 335, 415`: only the authorised public field is added to the input, expected statement or canonical binding.
- `packages/provisioning/src/first-setup-command-document.test.ts:108`: only the authorised public field is added to the input, expected statement or canonical binding.

AST qualification retains every former matcher after removing only the authorised `installationCodes` property or its canonical JSON spelling. This checks syntax, not behavioral equivalence.

## Dormant configuration and authenticated promotion (2026-10-18)

No existing test file changes relative to `cc5903a340106dde98dcfa2b39d59120a5e256d6`.
The byte comparison covers all 3,003 test files in that commit. Preserve every earlier inventory
above when preparing the eventual pull request.

The new `hour-dormant-standby.test.ts` checks complete configuration, unchanged fiscal rows,
retained state, invalid inputs, replay, authority lifetime and already-active refusal.
The new server `hour-promotion.test.ts` checks the real reserved-node writer, manager and matching-key
authentication, fresh comparisons, reported installation codes, restart, exact input binding,
re-registration and a real mirror boot over certificate-verified HTTPS. Source clocks and internet
responses are synthetic. These checks do not qualify the complete adoption or browser journey.

The earlier restore-preparation refusal for promotion remains unchanged. Promotion uses a separate
preparation factory. The existing single-standard/full trading reader also remains unchanged;
its multiple-standard refusal and transaction rollback have a new case. Choosing the trading
series when several bases share those purposes remains an owner question.

Six protected source/test files remain byte-identical to this checkpoint's base. The earlier
approved standby-wrapper change remains part of the branch; this delta adds no protected edit.
Receipts, coverage reports and omission/restoration checks are under the lane's local
`receipts/a679-dormant-host-20261018/`. Whole-package coverage, the earlier legacy failures,
reissue screens, PDF viewing acceptance and final review/CI gates remain open.


## One prefix per purpose, owner answer 2026-10-18 at 12:10

This dated section supersedes the earlier repeated-purpose acceptance and the dormant/promotion
checkpoint's pending trading-series question. The owner requires exactly one configured prefix
for each purpose and explicitly asks to replace the two-standard-base host scenario with a refusal
and an ordinary one-per-purpose case.

- `apps/server/src/hour-promotion.test.ts`: the shared successful fixture now has `A/standard`,
  `FF/full`, `R/rectificative`; its extra corrective prefix is removed. All existing new-node series,
  old `123` counters, no-reservation, role, HTTPS and exact-retry assertions stay. The former
  ambiguous-standard test selected an hour, then expected the old trading reader's string error
  and transaction rollback. Its replacement covers all three duplicate purposes: admission must
  refuse `sif.allocation_invalid / series_configuration_unsupported`, retain all compared fiscal
  rows and mirror mode, and save no dormant configuration or hour. No late activation is attempted.
- `packages/fiscal-verifactu/src/hour-dormant-standby.test.ts`: the supported fixture keeps exactly
  `FF/full`, `R/rectificative`, `a/B_1.2-3/standard`, preserving the punctuation and case example.
  The changed-primary fixture now renames that standard prefix to `changed` rather than changing
  the extra prefix's purpose. It still requires `reservation_mismatch` and no durable admission.
- `packages/fiscal-verifactu/src/hour-recovery-state.test.ts`: the supported fixture drops its
  second standard and full prefix. The historical-floor case's configured-base count changes
  from five to three; its literal spent hour, recorded-time floor, no-contradiction and old-counter
  assertions stay. The configuration-reading case still compares every prefix and exact spelling.
  New real-database cases record two prefixes for each purpose and require explicit refusal with
  unchanged rows and one retained allocation. The seed helper accepts that complete configuration;
  its default and `123` counters are unchanged. The original stored-purpose corruption case still
  requires `series_mismatch`; validation order was corrected after it caught a regression.
- `packages/fiscal-verifactu/src/initial-hour-setup.test.ts`: new cases submit matching request and
  allocation pairs with duplicate or missing purposes, including three-prefix duplicate/unknown
  shapes. They require the same explicit unsupported-configuration refusal. All original cases
  and assertions are retained.

Authority is the owner's 12:10 answer in Lane E's questions and the dated design addendum.
The six protected paths compared at this checkpoint remain byte-identical to starting
`707e78728c4d3a24e414881f64fc0b22f42657fa`. Lower-level hour/history tests are retained; their ability
to inspect recorded repeated-purpose evidence is separate from accepting a new configuration.

Source qualification: 135 affected fiscal cases, 171 server recovery/promotion/re-registration cases,
294 surrounding fiscal cases including the unedited protected pair, and 4,847 root cases passed.
The separately installed candidate passed 135 affected fiscal and 34 promotion cases. Four
independent omission/restoration controls caught the removed validation. The new helper's scoped
report counts four statements, four branches, three functions and three lines, all covered; this
is not a package-wide coverage result. Types, scoped lint, formatting and whitespace checks passed.
AST comparison retains 202 of 204 old matcher expressions exactly; only the two replacements
listed above differ. This syntax inventory does not establish behavioral equivalence. Receipts:
Lane E `receipts/a679-one-prefix-20261018/verification.json`, `controls.json`,
`assertion-audit.json` and the retained command logs. Earlier whole-branch failures and acceptance
gates remain open.

## Unfinished key replacement in the wizard, 2026-10-18

The setup session and optional module action now project the existing original-password reissue
endpoint. The hour screen prepares a new key-only PDF after an explicit replacement action.
Replacing clears the old download and kept choice, resets Review and protects the replacement as
an unsaved change. It retains the selected hour and imported input. The password prompt explains
that older backups still need their matching key.

No existing expected value or assertion changes in this checkpoint. The only existing test-file
delta adds seven fixture lines in `apps/setup/src/screens/recovery-hour.test.ts`: enter `06RB` in
the required installation-code control. All original lines remain in order. The three archive,
bucket and Cloud cases failed at the disabled comparison action both in the starting
`89c74222c209fe4427690f0a865b2affd2b36953` checkout and the first wider run. The added field lets
their original credential and source assertions run again. New files cover replacement ownership,
node/name mismatches, late replies, damaged ownership, fresh reconciliation, retained hour,
PDF decoding, failed-request retry and repeated kept consent through native controls.

The local receipt directory is `~/waitron-campaign-e/receipts/a679-key-reissue-ui-20261018`.
The full setup run reports 1,632 passing tests in 87 files and coverage of 98.05% statements,
95.86% branches, 99.07% functions and 99.51% lines. Earlier statement coverage of 97.83% failed;
new ownership/refusal cases close that gap without changing coverage configuration. Installed
wizard/PDF checks and the unchanged fiscal pair pass. Four independent installed omissions catch
node binding, Review reset, old PDF retention and replacement draft protection; each restored
case passes. `assertion-audit.json` checks every starting test file and all six protected paths.

Sixteen mounted wizard captures were inspected in English and Spanish, light and dark, with
measured browser widths of 390 and 1280. Axe reports no violation in either captured state.
These checks use synthetic server replies; separate server tests exercise the existing HTTPS
reissue service. They do not establish a complete installed first-Live or recovery journey,
completed-manager reissue, physical acceptance or owner viewing of the PDF through Drive.

The initial integrated fixture nested two main landmarks and failed axe. Its wrapper is now a
div. Initial selector/state type errors were corrected in the new tests. A misplaced replacement
button was caught by the frozen-hour visibility check and moved into the selected-hour section.
The initial insertion audit assumed unformatted lines and failed; the final audit checks the
actual seven-line insertion. These failures are retained in the local receipts.

Task 9 remains partial for completed-manager reissue, interrupted-page ordering and complete entry
journeys. Tasks 8 and 10–12, earlier provisioning coverage and legacy server failures, final
whole-branch reviews and publication gates remain open. Preserve all earlier inventories for the
eventual pull request.


## Completed-manager recovery document service (2026-10-18)

If you lose a completed box’s raw recovery key, the new HTTPS service accepts an authenticated
manager with `system.manage`. The fiscal module renders the replacement PDF before the host
commits its named verifier. A failed render leaves the previous key and retained PDF usable.
The host retains one PDF in memory for identical authorised reprints. A new key, an outside key
rotation or a restart makes the old download grant unusable.

No existing test file changes in this checkpoint. New checks live in:

- `apps/server/src/recovery-document-api.test.ts`: TLS and origin restrictions, management
  permission before evidence reads and again inside the transaction, malformed input, failed
  rendering, named-verifier binding, concurrent replacements and retained-download revocation.
- `apps/server/src/recovery-document-evidence.test.ts`: public projection of the preparation
  journal and restored history, both roots after workspace selection, missing evidence and
  damaged or unsafe sources. The first run exposed duplicate reads through macOS path aliases;
  the reader now compares canonical paths. The initial selected-workspace fixture also needed
  canonical anchor paths. No existing guard changed.
- `packages/fiscal-verifactu/src/completed-recovery-document.test.ts`: real English and Spanish
  PDFs include current, retired and retained codes for the taxpayer and environment, including
  codes recorded under another software identifier. The compared series, counters, SIF rows,
  chain heads and allocations remain unchanged. Damaged evidence refuses.
- `apps/server/src/recovery-document.boot.test.ts`: the real trading listener uses certificate-
  verified HTTPS, replaces a lost key, includes restored-sheet codes and reprints identical
  bytes. Verifier snapshots still accept only their matching old or new keys. This checks the
  verifier boundary; it does not exercise a complete older-backup restore.

Local receipts are in `~/waitron-campaign-e/receipts/a679-manager-interruption-20261018`.
The final new server checks pass 39 cases; the fiscal document checks pass seven. Nearby recovery
checks pass, as do the unedited golden/immutability pair within the 80-case fiscal run. Five root
suites pass 3,204 cases. Scoped coverage measures 100% in each category for the two new server
files and the new fiscal renderer; these are not package-wide reports. Four package type checks,
focused lint and the server’s Node bundle build pass. No thresholds or coverage exclusions change.

A separately frozen-installed candidate passes the same 39 server and seven fiscal checks.
Nine independent omitted safeguards each cause assertion failures, and the restored candidate
passes again. Preserve `controls.json`, the logs and all earlier inventories for the eventual PR.
The generated English and Spanish A4 sheets, including the long key name, were rendered to PNG
and inspected. They are synthetic examples, not the owner’s Drive acceptance.

Initial test setup failures included a missing deployment stamp, the wrong suspension field and
missing trading TLS files. Type checks caught an overly broad environment type and a test-header
union; the final code uses checked environment values and explicit header types. These initial
failures remain in the receipts and are not counted as feature RED evidence. The route’s 404,
missing fiscal contribution, missing-key refusal and path-alias assertion failures are the
observed behavior failures that preceded their fixes.

Task 9 remains partial. The manager’s dashboard controls, interrupted-page ordering and complete
entry journeys still need implementation and qualification. Tasks 8 and 10–12, the earlier
provisioning coverage and legacy server failures, final reviews, current-head CI and landing
remain open. The branch is not ready for publication.

## Interrupted setup controls, 2026-10-18

You can continue from a new tab with the original setup password. The wizard reads the repair
snapshot and sends its identifier, revision and ownership generation to the existing HTTPS
recovery route. Start again follows the password option and asks you to confirm retention of
the old attempt. The server still decides whether retirement is allowed.

Two existing checks deliberately follow the approved interruption design:

- `apps/setup/src/setup-app-first-fiscal.test.ts:107` expects “Continue with your setup password”
  instead of “Resume”. The owner’s 2026-10-16 password-first wording is recorded in the
  [replacement design](../superpowers/specs/2026-10-15-a679-two-route-redesign.md#appendix-f-keepchangedrop-inventory).
  The same case retains its no-claim, no-activation and secret-draft assertions.
- In the same file, the owner-refusal fixture intercepts `/resolution/recover` instead of
  `/resume`. A new tab has no previous browser proof, so it takes password recovery. Every
  original refusal and corrected-password assertion remains. The existing same-tab resume
  case still uses `/resume`.

The shared `apps/setup/test/first-setup-browser.ts` fixture gains the public repair inspection
response. No existing fixture value changes. No fiscal test, writer, SQL, migration or guard changes.

New browser cases cover recovery from a new tab, terminal and partly activated states, explicit
retirement consent, missing and uncertain databases, failed inspections, stale answers and password
draft disposal. The unsaved-change case reads the native password control after Discard.
Accessibility checks cover English and Spanish, both themes and 390/1280-pixel viewports.

Local receipts are in `~/waitron-campaign-e/receipts/a679-interrupted-ui-20261018`.
These mounted-wizard checks use synthetic HTTP replies. They do not qualify the complete installed
server journey. The manager controls, exact Finish interface, password-led missing-database
retirement and interrupted workspace selection remain open, along with the earlier whole-branch
gates. Keep every previous inventory for the eventual single PR.

The final setup coverage run passes 1,698 cases in 90 files: 98.10% statements, 95.99% branches,
99.22% functions and 99.52% lines. The initial statement result was 97.74%; seven added refusal,
late-response and draft-discard cases close that gap without changing coverage settings.
Five root suites pass 3,343 cases, and the unchanged golden/immutability pair passes 20.
Setup types, focused lint, formatting and its browser build pass. Forty mounted captures were
inspected; their replies are synthetic, and the build's size warnings remain visible in its log.

The frozen-installed candidate passes 52 focused cases. Six independent omissions fail assertions:
the recovery snapshot, terminal-state routing, password disposal, empty-only availability,
late retirement and conflicting-read recovery. Restoring the final source passes 52 cases again.
A first proposed conflicting-read omission started from an already failing candidate and is kept
as unqualified evidence. The final receipt starts from a passing baseline. That reconnect defect
needed both inspection and preserving the recovery screen after the conflict; its initial partial
fix still failed the regression case. No failure is waived.


## Exact publication Finish interface, 2026-10-18

Authority: the hour-code plan Task 9 and Task 5, and the retained repair plan Task 6
require original-password recovery, the same publication settings and publication-only Finish.
The later hour design removes the outside-register requirement. This checkpoint connects the
mounted setup app to the existing `/resolution/finish` route; it changes no server or fiscal writer.

No existing assertion or fixture value changes. `apps/setup/src/api/first-setup.test.ts` gains one
transport case after its unchanged original body. New session, app, email-mode and accessibility
files test Finish. The complete original-test byte audit is in the local receipt folder. The
ordinary certificate, email, review, interrupted ownership and session suites also run unchanged.

The new publication-only mode reuses certificate/email field checks without sending readiness or
email-test requests. The session rereads the inspection, checks its revision/generation and sends
the same settings to the dedicated route. A refused write returns to password recovery. The server
still owns the exact committed-result/digest check; a local status alone does not establish that a
commit exists. Browser fixtures are synthetic, while the existing HTTPS Finish suites separately
exercise actual boot and database paths. They are not a combined installed browser journey.

Early new-test failures included an ownership wait that observed an intermediate render, a native
button text check that missed its assigned slot, a locale import omission, and a navigation event
sent outside the app's listener. Those failures remain in the logs and are not passing evidence.
The first late-page deletion control passed because the new test awaited only the transport
instead of the entire session operation. The test now awaits that operation; the final control
fails its page assertion and restores to a passing baseline. All these edits are to new cases.

Keep every earlier changed-check inventory for the eventual single PR. The manager dashboard,
missing-database retirement, interrupted workspace selection, full installed acceptance and
whole-branch delivery gates remain open. Local commands, counts, installed controls and mounted
EN/ES light/dark 390/1280 captures are retained under
`~/waitron-campaign-e/receipts/a679-finish-ui-20261018`.


Observed verification for this checkpoint: setup's complete 94-file suite passes 1,758 cases,
with 98.04% statements, 95.89% branches, 99.22% functions and 99.49% lines. After the final
visual fixture correction, its 32 accessibility/view cases pass again. The final source has no
additional production change after that coverage run. The existing two HTTPS Finish suites pass
43 cases; the unchanged golden/immutability pair passes 20. Two selected root suites pass 36.
Setup types, changed-source lint, formatting, whitespace and the browser build pass. The build's
size warning is retained. No existing test body changes among 3,016 starting test paths; the single
API file has an unchanged original prefix and an appended transport case.

The separately installed complete candidate passes 35 focused cases before and after four
omissions. Snapshot revision, dedicated route, readiness bypass and late-page omissions fail
1, 1, 6 and 1 assertions respectively. The final late-page case awaits the session promise;
its original transport-only version is explicitly unqualified. The first screenshot helper could
not import Pillow; the retained final images use the repository's installed Sharp. The visual
fixture initially accessed a private draft property; it now sends the existing patch event.
The long review captures use a 2,200-pixel viewport height so the phone-width footer is visible;
the other states use 1,200. These remain mounted-source views, not installed-server acceptance.

## Password-led missing-database repair, 2026-10-18

If the retained setup database is missing, password recovery keeps you on repair rather than
continuing to certificates or offering Finish. For a claimed, consumption-intent or abandoned
attempt, you can confirm Start again. The session reads fresh missing-database evidence, binds
it to the recovered revision and owner generation, and sends the recovered capability through
the existing HTTPS retirement route. A refused or incomplete answer requires password recovery
again, including after a status refresh. Later activation states remain on repair. No fiscal
writer, server handler, database schema, migration or guard changes in this checkpoint.

Authority: hour-code plan Task 9 and its retained guided-repair Task 5 boundary. The backend
continues to own retirement, preservation and workspace creation. The browser does not treat a
missing database as proof of an empty setup. The complete installed browser-to-server journey,
interrupted workspace selection and every earlier whole-branch delivery gate remain open.

Changed existing test checks: **none**. All 3,020 starting test paths are byte-identical to
`f6ed577ae7f2cdde59ba895eba6250bba7e090fb`; all fiscal, server and root-guard source paths also
match that checkpoint. Preserve every earlier inventory for the eventual sole PR.

New checks:

- `apps/setup/src/setup-app-missing-database.test.ts` exercises actual password, confirmation and
  cancel controls, both tab entry paths, owner headers, refused/late answers and terminal states.
- `apps/setup/src/first-setup-retirement.test.ts` refuses changed classifications, snapshots,
  unchecked passwords, incomplete answers, reused proof after refresh and disposed sessions.
- `apps/setup/src/setup-app-missing-database.a11y.test.ts` covers password, recovered, confirmation
  and refusal states in EN/ES, both themes and 390/1280 widths, with native focus and axe checks.
  Its shared browser fixture lives in `apps/setup/test/missing-database-browser.ts`.

Observed verification: complete setup suite, 97 files and 1,822 cases; coverage 98.08% statements,
96.03% branches, 99.22% functions and 99.50% lines. The existing two HTTPS retirement/Finish
suites pass 33 cases, the unchanged fiscal golden/immutability pair passes 20 and two selected
root suites pass 3,154. Setup types, scoped lint, formatting, whitespace and its browser build
pass. The build's chunk-size warning is retained. The 32 mounted views were inspected; their
HTTP responses are synthetic, separate from the real HTTPS suites.

The separately frozen-installed candidate passes the 32 new behavioral cases before and after
eight independent omissions. Each omission fails an intended assertion: late password inspection,
wizard missing-database routing, owner transport, snapshot revision, missing classification,
password proof after refresh, late session inspection and late retirement answer.
Its final three-file run also passes all 64 behavioral and accessibility cases.

Qualifications: the initial empty-database retry regression was caught by the unchanged existing
test and fixed in the implementation. The newly extracted fixture initially lost its custom-element
side-effect import; that all-failure run is not feature evidence. After the import was restored,
the missing-database completion wording and late password-inspection cases failed for their intended
reasons before their fixes. The initial contact-sheet imports could not resolve Sharp; the final
sheet uses the server package's resolved entry. The first coverage command wrote the package's
default directory; the final explicit command writes to the external receipt directory. No bar,
exclusion, assertion or fixture value was weakened.

Local receipts: `~/waitron-campaign-e/receipts/a679-missing-database-ui-20261018/`, including
`verification.json`, `controls-final.json`, raw logs, test-preservation audit and the 32 captures.


## Interrupted workspace selection interface, 2026-10-18

You can review this checkpoint against starting commit
`99056a4fb2c0fac15ccbc0852d36b888e3245cfd`. It connects the wizard to the existing
`/resolution/selection` and `/resolution/resume-selection` routes. It sends the original password
only after a fresh inspection matches the displayed workspace and accepts a restart only for that
workspace and selection generation. The password is cleared before the request; a refusal permits
another entry. Reconnect reads the current selection. A newly selected workspace disposes the old
setup session so its abandonment, retirement and Finish controls cannot remain on the new page.

Existing test checks changed: **none**. The new behavioral and accessibility suites are
`apps/setup/src/setup-app-workspace-selection.test.ts` and
`apps/setup/src/setup-app-workspace-selection.a11y.test.ts`. The new fixture is
`apps/setup/test/workspace-selection-browser.ts`. Existing test paths retain their bytes. No
fiscal writer, fiscal assertion, money or permission check, root guard, SQL or migration changes.
Keep every earlier changed-check inventory for the eventual whole-branch PR.

The first browser run failed because the repair page had no password control. Seven malformed
snapshot cases then failed before validation was added. A later reconnect case exposed an old
session's Abandon control beside the new selection; a late initial read also reopened a departed
page. Both failures preceded their respective fixes. The first late-read probe selected a missing
native section and was corrected to the actual connection screen. Earlier versions of that
probe were blind in the installed copy: a frame alone did not await the response body. The final
probe awaits the complete API read before the frame. Those earlier receipts remain. Final controls
remove guards from the disposable checkout and check the retained behavioral assertions.

Complete package tests passed on the intermediate implementation but coverage fell below the
statement bar, first at 97.94% and later at 97.98% after the session fix. The added cases exercise
connection entry and departure, ordinary repair without a selection, selection-read failure and
reconnect to an unclaimed workspace. No threshold or exclusion changes. The lane's
`receipts/a679-workspace-selection-ui-20261018` retains final results and the earlier failures.
Mounted synthetic-HTTP browser checks and existing certificate-verified HTTPS route suites are
separate evidence; this checkpoint does not qualify their combined installed journey.

The visual check exposed one more selection-specific refusal defect: the shared owner-required
message told you to resume in the owner's tab after a rejected original password. The first new refusal
probe read the shell rather than the field primitive's shadow root and did not qualify the wording.
The corrected checks read the rendered form message; the final omission control changes it back
and must fail. The selection path uses the repair plan's approved “Password not accepted” /
“Contraseña no aceptada” wording. Other ownership messages and server refusals are unchanged.

A follow-up late-inspection control caught another probe issue after the fixture began observing
API calls: the test awaited the first inspection instead of the pending one. It now awaits the
latest call before the frame; the inspection and submission omissions each fail that test.
The final local receipts aggregate nine distinct omissions. Each failed an intended assertion;
the restored installed suites and source package coverage are recorded separately.

## Completed-manager PDF controls, 2026-10-18

Review this checkpoint against `0a391e6492bef7ddc9d3f3a18fc3d9b874c705c7`.
In Backups, a session with `system.manage` can explicitly confirm a new recovery key and PDF.
Download and Open to print use one temporary PDF URL. Printing again sends no replacement request.
Starting another replacement clears the earlier delivery, including when the request is refused.
Clear, component removal, a changed API context and removal of the permission release the browser URL.
The existing HTTPS service remains responsible for authorising the replacement and rendering the
module-owned PDF. This interface neither accepts nor parses fiscal allocation data.

Changed existing test checks:

- `apps/dashboard/src/screens/backup-screen.test.ts:30`: the off-backups case now expects
  `dashboard-recovery-document` instead of the old `dashboard-node-recovery` JSON handover.
  It explicitly supplies `canManage: true`; its non-null and API-identity assertions remain.
  This follows the hour-code design's recovery-PDF reissue requirement and implementation Task 9.
  A new denial case checks that neither handover is offered without `system.manage`.
- `apps/dashboard/src/dashboard-app.backup-unsaved.test.ts:13`: the fixture gains a permissions
  parameter, retaining its original default values. All earlier draft, navigation and logout checks
  remain. Two appended cases check that the authenticated permission reaches the Backups screen.

The new suites are `api/recovery-document.test.ts`, `screens/recovery-document-panel.test.ts`
and `screens/recovery-document-panel.a11y.test.ts` under `apps/dashboard/src`.
No existing fiscal assertion, guard, writer, SQL, migration or server source changes here.
Keep every earlier inventory for the eventual whole-branch PR.

Observed RED runs: all nine transport cases lacked the client method, eight panel cases lacked
controls, and three integration cases failed on the old handover or missing permission wiring.
The first refused-request probe read a form host's text, which included its buttons; the final
probe reads the actual form error. Late-response cases await the complete real client promise.
The initial edit put that observation variable in the wrong test; its two ReferenceError failures
are retained and provide no behavior evidence. The corrected run and installed omission checks
are the qualifying receipts. Cancel uses the shared action primitive's real `cancel` slot.

The final surrounding Chromium command passed 722 cases across 12 files, including the dashboard
shell and retained backup/draft/legacy-panel checks. The three new suites passed 53 cases.
Scoped coverage of the new panel was 100% statements/functions/lines and 97.36% branches;
this is not package-wide dashboard coverage. A frozen-installed disposable candidate passed
155 cases before and after eleven separate omissions. Removing response validation, the reissue
route, URL release, the duplicate-request guard, permission visibility, disconnect cleanup,
replacement cleanup, locale selection, shell permission forwarding, API invalidation or Escape
state handling failed the corresponding assertion. Raw logs and exact mutations are retained.

The existing server command passed 79 cases and failed
`first-fiscal-delivery.test.ts > the configured host routes the kept-document grant into real module preparation`
with `sif.allocation_invalid / outside_confirmation_missing`. This failure remains a whole-branch
gate; it is not waived by this dashboard checkpoint. The unchanged golden/immutability pair passed
20 cases. Four focused root suites passed 209 cases. Dashboard types, scoped lint, formatting,
whitespace and production build passed; the build still prints its chunk-size warning. The backup
clipboard test deliberately emits its retained `marker` rejection while checking unhandled errors;
its source and all its assertions remain unchanged in this checkpoint.

Thirty-two mounted EN/ES, light/dark, 390/1280 views of idle, confirmation, refusal and delivery
were inspected. Native buttons, focus, link geometry and axe checks passed. These views use
synthetic responses; they do not establish an installed browser-to-HTTPS-server journey or actual
PDF rendering. Those journeys, earlier server/provisioning gaps, retirement/integration, owner PDF
acceptance, final reviews and current-head CI remain required before A679 can land.

Local receipts: `~/waitron-campaign-e/receipts/a679-manager-ui-20261018/`, including
`verification.json`, `controls.py`, `controls.json`, `test-preservation.json`, raw logs and captures.


## Installed setup, recovery-key and manager journeys (2026-10-18)

The installed Chrome probe uses the built setup and dashboard, a real local HTTPS listener and
a fresh migrated venue directory. Chrome pins the generated leaf's public key. Only outside
certificate validation/sealing, AEAT drain, internet time and SMTP delivery use synthetic responses.
Native administrator, venue, certificate and email controls reach hour selection, a real PDF
download, explicit kept confirmation and one activation. English and Spanish both pass.

The exact downloaded PDF is selected through the native recovery picker. An actual annotation and
resave changes the PDF hash while retaining identical attachment bytes. Chrome prints the rendered
page to an attachment-free PDF; uploading it requests manual entry. Values extracted from the
rendered page, with grouping, lowercase and look-alike characters, enter the native controls and
authenticate an operation against a real copy of the saved database. The wrong key is refused.
This is not a full archive, bucket or Cloud restore.

After restart, the built dashboard uses a real manager session to replace the key once and
download identical repeat bytes. The downloaded key authenticates against the current verifier;
the former key does not. The saved hour journal and activation count remain unchanged. The manager
session is seeded through the real session writer; the login UI is not exercised. Sixteen setup
and manager views cover EN/ES, light/dark and 390/1280. Generated A4 PDFs are copied to
`~/My Drive/Waitron mockups/2026-10-18 A679 recovery PDF/` for the owner's required LOOK approval.

The command-line qualification exposed an eager font asset import that Node v26.11.1 with tsx
4.23.15 refuses as `ERR_UNKNOWN_FILE_EXTENSION`. The new
`apps/server/src/recovery-pdf-source.test.ts` first failed both EN/ES cases at that import.
`recovery-pdf-node.ts` now imports the embedded asset when its loader is available and otherwise
reads the source font file. Both source cases pass, including rendered key/check text and the
exact attached document. The existing relocated-bundle checks also pass.
`recovery-pdf-node.test.ts` adds two source-font fallback cases using its unchanged PDF assertions.
No existing expected value or assertion changes in this checkpoint. The initial test location
lacked tsx and failed module resolution; that attempt is retained as an unqualified probe, not
the behavioral RED. The first installed probe used an attribute instead of the dialog's live
`open` property and timed out; the corrected native journey passes.

Fresh whole-file boot verification passes all 62 cases, closing the four earlier boot failures
on this branch. The retained paper-policy suites still fail six cases across
`first-fiscal-delivery.test.ts`, `module-operation-host.test.ts` and `first-fiscal-launch.test.ts`
(52 pass). After the font fix, the old CLI public-input case now reaches
`provisioning.initial_input_invalid` rather than failing to load its font. These failures remain
branch gates. No old test is weakened or described as green.

Receipts and runnable installed-probe overlay: `~/waitron-campaign-e/receipts/a679-entry-integration-20261018/`.
Preserve all earlier Changed test checks inventories for the eventual whole-branch PR.

## Repair listener and actual entry processes, 2026-10-18

Authority: the approved hour-code implementation plan, Tasks 9–10, requires the interrupted
wizard and actual entry paths. The earlier mounted browser checks and API-only launch checks
had not requested the dedicated listener's HTML or its wizard bootstrap reads.

Changed existing test checks: **none**. The new `first-fiscal-hour.e2e.test.ts` launches the actual
source `bin.ts`, supervised `node-entry.ts`, restore command and provisioning command in owned
child processes. Fresh boot/reboot retains the box CA. Paired, torn and escalated interrupted
entry preserves the missing database, retained marker and staged restore/reset files. Public
reads serve the configured setup bundle and bootstrap the existing wizard; password recovery
still requires trusted HTTPS and same-origin requests. The TLS checks include the original
password's success and wrong-password/cross-origin refusals. Restore checks both claimed and
consumption-intent states. Provisioning submits a deliberately different base, `B`, against the
retained `A`; it qualifies changed-context refusal, not matching-request command completion.

The new `first-setup-resolution.bootstrap.test.ts` checks frozen environment metadata against
conflicting process configuration, torn-state display with valid/invalid configuration, public
certificate availability, unchanged markers and an absent database. Its static-file checks keep
missing API/assets as refusals, redirect browser navigation and retain attachment delivery for
public setup downloads. The existing ordinary setup API suite keeps its assertions after moving
its static-serving code to the shared helper.

Two observed REDs preceded the runtime fixes: all five interrupted process cases received 404
for the page; after mounting the page, all five received 404 for the bootstrap status read.
The fix reuses the existing setup SPA serving behavior and supplies public repair metadata.
The retained attempt's environment wins over the ambient setting; without a readable attempt,
this display uses the deployment parser's value or preproduction. That fallback grants no setup,
restore or trading authority: the repair listener retains only its resolution actions.

Initial command probes incorrectly expected `setup.attempt_uncertain` for an unconsumed claim
and for a conflicting provisioning request. The existing `assertOtherSetupAllowed` and CLI
request comparison distinguish those cases. The final fixtures state the changed base explicitly
and check their exact refusals. No production command behavior changed. The first root-check
command named a nonexistent project and ran no tests; the corrected root invocation is the
receipt. An early scoped coverage run passed its cases but failed its bar because the subprocess
execution did not measure the new handlers in the parent. Direct bootstrap checks supplement
that process evidence; the partial report is retained, not described as package coverage.

Receipts: `~/waitron-campaign-e/receipts/a679-entry-processes-20261018/`, including process REDs,
installed omission/restoration checks, source checks, the runnable installed-Chrome probe and
EN/ES light/dark 390/1280 captures. The installed browser uses the actual built setup app and
trusted HTTPS repair listener. This checkpoint does not qualify full backup restore, resumed
activation, every interrupted selection/Finish path or the complete branch's package coverage.
The earlier coverage and legacy-suite failures remain branch gates, as do owner PDF viewing
approval, retirement/prose/integration work and the final reviews/current-head CI.

Final installed continuation: each locale also submits the native Start again confirmation through
real HTTPS. The response selects generation 1 of a different workspace and requests one restart;
the old frozen attempt and absent original database remain. The probe does not boot that
replacement. Sixteen password/recovered captures and two confirmation captures were inspected.
The final installed run passes 21 cases across the two new committed suites and the local browser
probe. Each of five deliberate omissions (shell, bootstrap status, certificate availability,
HTTPS-only password entry and origin check) fails its intended assertion and passes after
restoration; the complete installed process suite passes 13 before and after those omissions.

The source behavioral selections pass 432 and 318 cases respectively, with overlapping suites.
Both scoped coverage commands still exit nonzero: the latter reports 97.22 statements, 91.66
branches, 84.21 functions and 100 lines across `first-setup-entry.ts` and `setup-spa.ts`. The shared
SPA helper is 100 in all four measures. These are partial selections, not the package's coverage
report; no threshold, exclusion or ignore marker changed. This report and the earlier provisioning
coverage gap remain for the complete branch's validation, rather than being counted as green
commands. The source compilers, scoped lint/format, unchanged fiscal pair and selected root guards
are recorded separately.

The fresh-boot/reboot case has a 180-second test bound, covering its initial 45-second CA wait,
two 45-second listener waits, two ten-second shutdown waits and untimed setup. That test-only
bound was added after the installed candidate was removed; the two affected source cases were
rerun. Runtime files and all earlier assertions are unchanged by that final budget adjustment.

## Replacement boot and interrupted selection, 2026-10-18

You can follow confirmed Start again into its replacement with the new cases in
`apps/server/src/first-fiscal-hour.e2e.test.ts`. They run direct `bin.ts` and supervised
`node-entry.ts` as separate processes, recover the original password through certificate-verified
HTTPS, retire the missing-database attempt, and boot and reboot the selected workspace.
The old attempt, claim, certificate and staged restore/reset files retain their bytes; the old
database stays absent. Only the selected workspace acquires a database.

Each entry also loses either the state selection witness or target backlink before restarting.
The next process serves repair and leaves the replacement database absent. A wrong password and
changed workspace ID refuse; the original password completes the same selection, after which
ordinary setup boots there. These are lost-file experiments, separate from the existing
write-interruption route tests.

Changed existing checks: none. One import, a shutdown observation helper and six new cases are added; the earlier cases retain
their bodies and values. Authority is the hour plan's Task 10 actual-entry and interruption
qualification, with the retained-original and isolated-selection rules from Tasks 5 and 9.
No production, fiscal writer, SQL, schema, migration, guard, exclusion or configuration changes.

The six-suite source command covering the process suite, entry, resolution boot, selection routes,
bootstrap and the entire boot suite passes 131 cases. Server types, scoped lint/format and the
unedited protected fiscal pair pass. The initial new test took an inspection before creating its
retained staged files, so the evidence check correctly refused with 409. The final fixture inspects
after those files exist; that first run is not a production-defect reproduction.

The new cases also await the process's own restart exit before launching its successor. They do
not send the signal that the assertion is meant to observe. Both entry processes exit cleanly
with code 0; an initial new assertion expected termination by signal and was corrected after
observing the exit and reading `run-server.ts`. Closing the test HTTP client before waiting
avoids holding the listener open during shutdown. The cleanup path still stops a child if an
earlier assertion fails.

The retained installed-Chrome probe uses the built setup app with real HTTPS and filesystem
selection. In each locale it confirms Start again, loses the replacement backlink, reopens repair,
refuses a wrong password, and completes the same selection with the original password. It then
boots the replacement, follows the native secure-connection Continue action and opens normal
setup there. Two journeys pass; 16 EN/ES light/dark 390/1280 captures were inspected. The first
probe omitted Continue and timed out waiting for the next page. That probe error is retained,
not treated as a product defect or acceptance pass.

An initial omission probe selected zero cases because Vitest quotes interpolated table values
in test names. Its log reports 19 skipped. The qualified controls use the actual listed names
and require assertion failures and counted restoration passes.

The first selected-root omission also exposed a test cleanup error: an already-closed HTTP
client threw during teardown and hid the boot assertion. The new fixture now closes each client
once, including on failure. Qualification restarts with that fixture; the masked failure is not
counted as a successful omission control.

Selected-root omissions are qualified against the existing direct/supervised boot assertions in
`first-setup-resolution.boot.test.ts`: they fail the expected environment or ordered-effect
comparison and pass after restoration. The separate process omission reached the selected-CA
wait and reported `ENOENT`; it is retained as that observation, not relabelled an assertion error.

Final installed qualification passes all 19 process cases before and after six omissions:
selection workspace binding, original password, direct selected roots, supervised selected roots,
Start again restart and selection-resumption restart. Each omission fails its intended assertion
and its restored selection passes. The final new source selection passes six cases; the previous
13 process cases remain unchanged. Types, lint, formatting, 28 focused root cases and the
unedited 20 fiscal cases pass. The installed server and setup builds pass with the retained
setup chunk-size warning. These results do not supply package-wide coverage or branch CI.

Receipts: `~/waitron-campaign-e/receipts/a679-selected-reboot-20261018/`. This checkpoint does not
complete A679. Preserve the earlier package coverage gaps, retained policy-suite failures,
remaining installed restore/promotion/Finish acceptance, owner PDF viewing approval,
retirement/prose/main integration and final review/current-head CI gates.


## Installed publication Finish and trading reboot, 2026-10-18

No existing test check or fixture value changes. `first-fiscal-hour-finish.test.ts` gains one
case and two imports. The case completes a real HTTPS Finish after the fixture interrupts
identity publication following the database commit. It discards the response body, starts the
real trading server twice, and compares the fiscal rows, counters, hour journal, staged key and
published settings. It checks development Live, whose fiscal environment is preproduction.
The first new fixture used ordinary preproduction Live, which the existing configuration parser
refuses with `intent_environment_mismatch`; the corrected fixture explicitly uses `WAITRON_ENV=dev`.
This is a fixture correction, not a product fix. Cancelling the received response body does not
simulate losing the request before commitment or killing the process during publication.

The retained installed-Chrome probe supplies the production Live journey in English and Spanish.
It runs the real built wizard over HTTPS, downloads and keeps its recovery PDF, then interrupts
identity publication after the real database commit. A new listener and a fresh browser context
refuse a wrong password, accept the original setup password, and complete Finish through the
native certificate, email and review controls. It then boots trading and opens the dashboard.
Full fiscal-table snapshots, the module preparation journal and staged key retain their values.
The browser sends one Finish request and no selection, preparation, provisioning or kept-document
request during that resumed flow. Certificate validation/sealing, email delivery and internet-clock
observations use synthetic providers. The initial activation and Finish use the actual local
provisioning and publication paths.

The first probe incorrectly waited for an authenticated Finish button immediately after its
interruption. The wizard was correctly showing password recovery; both cases timed out. After
that wait was corrected, both installed journeys passed. Initial type checking also found unused
imports and an overly narrow server type in the local probe, which were corrected. An early
English desktop capture included a transition snapshot; the final probe waits for animations and
frames before capture. Those attempts are retained separately from final qualification.

The four complete selected source suites pass 120 cases, including the existing boot suite.
The 20 unedited fiscal invariant cases pass. In an independently installed complete candidate,
three omissions each fail the new case's intended assertion: missing trading publication,
missing terminal completion and missing restart request. Each restored case passes. Server,
setup and dashboard builds pass. These are focused results, not package coverage or branch CI.

Receipts: `~/waitron-campaign-e/receipts/a679-installed-finish-20261018/`. No runtime, schema,
migration, guard, fiscal writer or earlier assertion changes in this checkpoint. Complete
archive/bucket/Cloud recovery, remaining admission/promotion acceptance, old policy-suite and
coverage gaps, active protocol retirement, current-main integration, owner PDF viewing approval
and the final installed reviews/current-head CI remain separate A679 gates.


## Native recovery and bucket confirmation, 2026-10-18

The built wizard's bucket preview previously showed the business without offering its confirmation
checkbox. The local installed EN/ES probe reached hour selection, then timed out waiting for that
checkbox. Five new source-browser cases failed with the expected missing-control assertion before
implementation. `SetupRecoveryCopy` now publishes its validated preview and its invalidation;
the bucket screen uses that snapshot for the existing business confirmation. Re-review, API changes
and selection changes clear the answer. Two further source cases caught the old answer escaping
when kit/environment changed and Restore was clicked before rendering. Those edits now clear it
synchronously. The server still validates the selected business before placement.

Changed existing test checks: `apps/setup/src/screens/recovery-allocation.test.ts`, “forwards the
selected %s copy's credentials”, gains only the bucket fixture's missing confirmation interaction.
The old operation, key and expectation expressions remain unchanged. No existing fiscal assertion,
protected writer, SQL, migration, guard or configuration changes. The new
`restore-bucket-preview-venue.test.ts` checks confirmation before submission, selection/API/review
invalidation, late responses and edits before rendering. Source verification ran all 12 surrounding
browser files: 157 cases passed, including existing accessibility cases in both themes. Five
independent installed omissions failed assertions; all five restored eight-case runs passed.

Local receipts are in `~/waitron-campaign-e/receipts/a679-recovery-qualification-20261018/`.
The installed native probe runs in an independent frozen-installed checkout. It navigates actual
built EN/ES wizard pages over HTTPS, enters the matching grouped lowercase key and check through
native controls, selects an hour, confirms the bucket business, stages each archive/bucket/Cloud
source and runs reconstructed placement after closing the listener. Fixtures contain two real sale
records, one with an accepted synthetic AEAT filing receipt and one pending. Historical sale,
line, tender, settlement, record and filing rows retain their values; retired counters remain
125/123/123, fresh series use the selected hour, and a second staged run does nothing. The 24
selected-state views cover both languages, themes and phone/desktop widths. These are local
receipts, not committed browser CI coverage. The host runs installed source, not `dist/server.js`;
remote bucket copying, Cloud replies/download and internet time are synthetic boundaries. This
check does not boot restored trading or exercise an actual Cloud account/S3 service.

The unmodified seven-file server selection passed 129 cases and the entire recovery-host file
passed 127. Protected golden/immutability checks passed 20. A separate retained-policy reproduction
still fails four cases across `first-fiscal-launch.test.ts` and `first-fiscal-delivery.test.ts`
(28 pass): two `malformed_allocation` launch refusals, the CLI's `initial_input_invalid`, and the
kept-document host's `outside_confirmation_missing`. Those failures remain gates. Other earlier
failures/coverage gaps, remaining installed admission/promotion and entry qualification, active
protocol retirement, full prose/current-main reconciliation, owner PDF viewing approval, both
final Claude reviews and current-head CI remain required before landing.


## Recovery PDF presentation revision, 2026-10-19

The owner's PDF feedback, relayed on 2026-10-18, changes the printed presentation. The sheet now
uses two columns, a localized creation date in the venue's saved time zone, a short grouped node
identifier, and separate instructions for Cloud credentials and archive passwords. The backup
preview shows the same short identifier; the module still receives the full node ID. The existing
generated key name already ends in a four-character group. This checkpoint does not change its
stored or printed name.

The command-line renderer receives the frozen venue zone, the wizard receives its reviewed zone,
and manager reissue reads the zone from `locations`. The time zone is an explicit rendering
argument, not a new field in the PDF's embedded recovery data or public delivery statement.

| Existing check | Before | After | Authority |
| --- | --- | --- | --- |
| `packages/fiscal-verifactu/src/recovery-pdf-node.test.ts:51` | Full printed `node-1` and ISO creation timestamp. | `NODE -1` and localized Madrid date/time. Full ID, raw timestamp and secret remain checked in the attachment. | Owner PDF feedback points 2 and 4. |
| `packages/fiscal-verifactu/src/recovery-pdf-node.test.ts:76` | Visible text excludes `Cloud` with other internal protocol terms. | Cloud is allowed for the requested login instruction; the other exclusions remain. | Feedback point 8. |
| `packages/fiscal-verifactu/src/recovery-pdf-node.test.ts:172` | Inline colon separates the installation-code label and values. | Two-column label and the same exact code values, with extracted whitespace normalized. | Feedback point 1. No list value changes. |
| `packages/fiscal-verifactu/src/recovery-pdf.browser.test.ts:42` | Full printed ID, ISO date, raw format heading and separate-password phrase. | Short grouped ID, localized date, no format/count explanation, explicit own-password/separate-storage instructions. | Feedback points 2–4, 7 and 8. |
| `packages/fiscal-verifactu/src/recovery-pdf.browser.test.ts:79` | `Cloud` excluded from visible text. | Only that exclusion is removed; new presentation cases require the Cloud-login instruction. | Feedback point 8. |
| `packages/fiscal-verifactu/src/recovery-pdf.browser.test.ts:105` | Maximum-length node ID printed in full; key page found by raw-format heading; page contains `47`. | Exact short node prefix; key page found by its key label; page contains the complete original payload and check labels. Other maximum-length labels remain checked. | Feedback points 3, 4 and 7. |
| `packages/fiscal-verifactu/src/completed-recovery-document.test.ts:113` | Inline code label/value with colon. | Same exact code list in two columns, normalizing PDF extraction whitespace. | Feedback point 1. |

Other changes to existing tests supply an explicit `Europe/Madrid` argument to the PDF renderer,
transient delivery, or source/bundled runner. Those files are `recovery-delivery.browser.test.ts`,
`recovery-reader.browser.test.ts`, `setup/recovery-key.browser.test.ts`,
`setup/recovery-key.a11y.browser.test.ts` and `apps/server/src/recovery-pdf-source.test.ts`,
as well as the two PDF suites above. Three command-document fixtures in
`initial-hour-setup.test.ts` gain their venue time zone. Their original assertions stay intact.
No existing test declaration is removed. Preserve every earlier inventory in this document.

Observed checks: the ten PDF/key/hour suites pass 168 cases; the selected setup family passes 44
and the new preview accessibility suite passes two; the short-ID suite passes five. Server document
checks pass 60, command delivery passes 20, and the unedited golden-hash/immutability pair passes
20. Five selected root suites pass 4,866 cases. Six affected package type checks, scoped lint and
formatting pass. The setup bundle builds with its existing chunk-size warning. These are focused
results, not package coverage or whole-branch acceptance.

In a frozen-installed disposable candidate, seven independent date/column/instruction/zone
omissions fail their selected assertions and restoration passes. Two further omissions fail the
PDF and preview short-ID checks, then pass after restoration. Four final EN/ES Madrid/Canary
PDFs and eight mounted preview language/theme/width views were inspected. The preview fixture
uses the generic recovery form; it does not qualify the complete hour-recovery journey. Earlier
PDF exports made while controls were running are superseded by `*-final.pdf`.

Receipts: `~/waitron-campaign-e/receipts/a679-pdf-revision-20261018/`. The first surrounding run
reported four whitespace-extraction failures; normalizing the column gap retained the exact code
values. A broad fixture edit briefly added a zone to an unrelated public-statement fixture; type
checking caught it and that fixture was restored. A static diff also caught and restored an
unintended shortened ID at the decoder call before the final run. The first standalone bundle
command lacked the package binary path; `pnpm exec node` supplied it. A later comparison refused
a candidate containing pre-format test bytes; the final resync recorded those paths before export.

The shorter combined key/check and the single installation code remain pending the questions
recorded under “two PDF revision dependencies” in the lane. The current check binds scope/node/name,
and recovery currently consumes a reported code list. Neither dependent behavior is changed here.
A679 remains incomplete and unpublished; earlier legacy/coverage/entry/retirement/integration gates,
owner PDF acceptance, both final reviews and current-head CI still apply.


## Promotion reboot qualification, 2026-10-19

You can run the two new cases with:

```sh
pnpm --filter @waitron/server exec vitest run src/hour-promotion.test.ts -t 'reboots a promoted'
```

Both cases use the real HTTPS listener and database. One authenticates promotion with the node
recovery key; the other uses administrator credentials. Dormant admission and hour selection
precede listener startup. The listener compares clocks again, consumes the selected `06RC` hour,
and requests restart. After shutdown, the fixture sets the standby counters to 47 and reboots
at the next hour. Repeating the HTTPS promotion returns `alreadyPrimary: true` and
`restarting: false`; fiscal allocations, SIF rows, all invoice-series rows and the hour journal
retain their exact snapshots. This qualifies installed source execution with a synthetic internet
clock, not a browser adoption flow, a real process restart or `dist/server.js`.

Changed existing checks: none. Removing only the new `it.each` block reconstructs the exact
starting bytes of `hour-promotion.test.ts` at `4d34f72a600cef98c0279cdb07e622ce6dae497d`.
No runtime, fiscal-writer, SQL, migration, guard or configuration source changes in this checkpoint.
Preserve the earlier inventories in this document.

The nine surrounding server suites pass 94 cases. Server types, scoped lint, formatting,
the unedited fiscal golden/immutability pair (20 cases), and the selected database-helper and
teardown guards (33 cases) pass. These focused checks do not establish package-wide coverage
or branch readiness.

In an independently frozen-installed candidate, returning an incorrect restart flag after reboot
fails both new cases. Separately skipping the module activation fails both with the expected
`series.no_standard_for_node` response instead of HTTP 200. Each restored candidate passes both
cases. The restored installed whole file also passes all 36 cases. An earlier omission of the
mirror helper's already-primary return passed both cases;
that is an unqualified control. Tracing `boot.ts` showed the rebooted primary endpoint uses its
own status-only delegate, so that omission did not reach the replay path under test.

Receipts: `~/waitron-campaign-e/receipts/a679-promotion-reboot-20261019/`. The owner PDF revisions
and viewing acceptance, retained legacy-suite failures, remaining entry/coverage/retirement
checks, main integration, both final reviews and current-head CI still gate the complete item.

## Configured-host kept-document qualification, 2026-10-19

The retained configured-host case in `apps/server/src/first-fiscal-delivery.test.ts` sent a
register statement to a configured hour contribution. Before this checkpoint, running that whole
file produced one failure and 28 passes. Registration refused with
`sif.allocation_invalid / outside_confirmation_missing` before the preparation assertions ran.

The case now uses `hourFirstFiscalFixture` and a real `useVenueDb` database. The existing helper
selects an hour and supplies the public key-only document and kept acknowledgement. Its document
digest is synthetic; this case does not download, render or inspect a PDF. Internet time and the
release stamp are controlled, as in the surrounding configured-hour suites.

The caller consumes the current recovery-document grant, then enters real module preparation.
That follows `packages/provisioning/src/first-setup-activation.ts:119`. The success assertion stays
`resolves.toBe(true)`. The second call still must refuse; its expected error changes from
`sif.allocation_invalid` with `outside_confirmation_missing` to `setup.not_ready` with empty params,
the current shared recovery-document interface's error. This is the only changed expected value.
The approved hour design and plan Tasks 6 and 9 replace register delivery with this interface;
the owner's 2026-10-05 test-change decision permits the corresponding non-protected check update.
No fiscal identity, number, money, hash, filing, permission or password-refusal expectation changes.

All other case text and fixture values in the file retain their exact starting bytes. Every other
test path retains its bytes. The ownership-only cleanup list now accepts either fixture through
its `dispose` method. A nested database scope keeps database setup local to the configured-host
case. No production code, guard, migration or configuration changes in this checkpoint.

The final host/clock/route selection passed 44 cases across three files. In a separately
frozen-installed checkout, the complete delivery file passed 29 cases. Deleting
`grants.delete(module)` from the shared delivery service made its second-use assertion fail because
the call resolved; restoring
the service passed. This control checks the service's one-use behavior. It does not establish that
the activation caller invokes it. The unedited shared activation suite separately passed 49 cases,
including refusal before readiness/writes without kept authority and consumption after a readiness
refusal. The protected write-path and immutability pair passed 20 cases; the focused database-helper
and teardown guards passed 33. Server types, scoped lint and formatting passed.

The broader retained-server selection still failed six cases: both direct/supervised launch cases
and the CLI public-input-file case in `first-fiscal-launch.test.ts`; the kept-document route case in
`first-fiscal-document.route.test.ts`; and the independent-trust and snapshot-recovery cases in
`module-operation-host.test.ts`. That three-file run reported six failures and eleven passes.
Their assertions are unchanged and remain gates. The earlier coverage gaps, remaining installed
journeys, PDF decisions/viewing acceptance, protocol retirement, main integration, final reviews
and current-head CI also remain open. No whole-item or landing readiness is claimed.

The A679 backlog entry now lists remaining work and points here for completed qualification,
instead of repeating checkpoint history. Earlier inventories and historical receipts stay intact.
Local evidence: `~/waitron-campaign-e/receipts/a679-host-delivery-20261019/`, including raw logs,
`test-preservation.json` and the installed omission/restoration control.

## Retained document route qualification, 2026-10-19

The retained `first-fiscal-document.route.test.ts` case submitted a register-bearing document
to the hour contribution. Its complete starting file reported one failure and four passes:
registration returned 400 where the case required 200. The replacement follows the approved
hour design's key-only document contract and implementation plan Tasks 6 and 9.

The case keeps its original name and all transient-key response checks. It now uses the existing
`hourFirstFiscalFixture` with `useVenueDb` and the real configured contribution. The fixture
selects `06RB` at the controlled instant `2026-10-16T11:40:00Z`. It supplies synthetic internet time,
a fixed release stamp and a synthetic PDF digest; this is an in-process HTTP route test, not a
PDF download, rendering or verified HTTPS journey.

Changed checks, for the eventual PR inventory:

- `apps/server/src/first-fiscal-document.route.test.ts:98`: registration and kept confirmation move
  from `document`/`document-kept` to `recovery-document`/`recovery-document-kept`. Their successful
  status remains exactly 200. The public reference replaces `historyDigest` with `bindingDigest`
  for the key-only statement.
- At line 103, exact public document equality moves from the register evidence response
  `{ trust: null, current: statement }` to the recovery service's complete public reference and
  statement. Before keeping the document, grant consumption must still refuse. Its expected code
  changes from the register-specific `sif.allocation_invalid` to `setup.not_ready` with empty params.
  After keeping the matching document, consumption must succeed once and refuse a second use.
- At line 111, a newly added mismatched-PDF reference must refuse with HTTP 503 and exactly
  `setup.not_ready` with empty params, leaving no usable grant. The first draft of this new check
  expected 400; the run returned 503, matching `setup-first-fiscal-api.ts:26`. Only that new
  expectation was corrected. The failed log is retained.
- At line 138, the existing stranger/foreign-origin table gains both recovery endpoints. Every
  previous action and the entire case body, including its 403 and `setup.owner_required`
  expectations, retain their bytes. The existing body-limit case and shared fixture are also
  byte-identical. No old case is deleted.

The owner's 2026-10-05 test-change decision permits this non-protected interface update. No
fiscal identity, invoice-number, hash, filing, money, permission or password-refusal expectation
changes. There is no production, schema, migration, configuration or guard change in this checkpoint.
The fixture already has a kept grant; re-registering the document must invalidate it before a fresh
kept confirmation. This tests that boundary as well as the subsequent one-use grant.

The affected four complete server files report 66 passes. Server types, scoped lint, code formatting
and whitespace checks pass. The unedited protected fiscal pair reports 20 passes, and the focused
database-helper/teardown guards report 33 passes. A separately frozen-installed candidate matches
all 6,887 tracked source paths before this documentation addition. Its complete route file reports
seven passes. Bypassing the matching-reference check makes the mismatch return 200 instead of 503;
omitting consumption's grant deletion makes the second-use refusal resolve. Each fault fails its
own assertion, and each restoration passes the selected case. Bypassing the foreign-origin check
makes both newly covered recovery endpoints return 400 instead of their required 403. Both
restored cases pass, followed by seven passes for the complete installed file.

The unchanged module-host and launch files still report five failures and seven passes. The two
module-host failures are independent-trust enrolment and snapshot-recovery delivery. The launch
failures are direct setup, supervised setup and the public-input-file CLI. These remain gates;
the route change does not clear them. The earlier coverage, installed-entry, PDF decisions/viewing,
protocol-retirement, integration, final-review and current-head CI requirements also remain open.
Local receipts: `~/waitron-campaign-e/receipts/a679-document-route-20261019/`.

## Retained module-host qualification, 2026-10-19

The retained host tests still used custodian enrolment and register delivery. Before this change,
`pnpm --filter @waitron/server exec vitest run src/module-operation-host.test.ts src/first-fiscal-launch.test.ts --maxWorkers=2`
reported five failures and seven passes. Two failures came from the host's old preparation fixtures;
the other three came from the unchanged launch file.

The two host cases now use `hourFirstFiscalFixture`, `useVenueDb` and the real configured module.
External clock observation, the release timestamp and the public PDF digest are synthetic; this
fixture downloads no actual PDF. The date is fixed at `2026-10-16T11:40:00Z`; this checkpoint
changes no fiscal identity or numbering assertion.

| Site in `apps/server/src/module-operation-host.test.ts` | Before | After and authority |
| --- | --- | --- |
| Restart case, line 68 | Retained paper trust and a fresh register confirmation allowed preparation; an absent or reused confirmation refused `sif.allocation_invalid`. | The complete public recovery-document reference and staged key survive a runtime restart. An absent or reused kept grant refuses `setup.not_ready` with empty params. Preparation still resolves to the original `prepared` value after fresh confirmation and clock comparison. An added assertion requires `clock_stale` before that comparison. The approved hour design's recovery PDF and restart rules, and plan Tasks 6, 9 and 10, replace the register interface. |
| Outside-evidence case, line 168 | A paper-history environment path supplied the file; the register-delivery grant refused `sif.allocation_invalid / outside_confirmation_missing` after ownership recovery. | A test descriptor declares the same outside file through `resolutionEvidence`. The file changes from the original `42` to `43`; the original changed-snapshot, `setup.owner_required` password-grant and `setup.attempt_conflict` key-stage assertions remain. The corresponding key-only document grant refuses `setup.not_ready` with empty params. A new positive check requires a usable kept grant before recovery. The hour design retires the paper source; plan Tasks 9 and 10 retain ownership and snapshot checks. |

Both declarations have names that describe the new interface. The other four declaration bodies
are byte-identical, including the four ordinary-operation expansions. Of the 3,035 tracked test
paths at the starting head, only this host file changes. The owner's 2026-10-05 interface-test
decision applies; no fiscal identity, record, hash, filing, money, permission or password-refusal
expectation changes. The new descriptor qualifies generic module-declared snapshot sources. It
does not claim that the active fiscal module still reads the retired paper-history environment
variable. The preparation helper explicitly consumes the grant before calling the real module;
this checks that service boundary, not the activation caller's orchestration.

Four complete surrounding server files report 70 passes. Server types, scoped lint, code formatting
and whitespace checks pass. The unedited protected pair reports 20 passes, and the selected helper
and teardown guards report 33 passes. The independently frozen-installed candidate initially matches
all 6,887 tracked paths and reports nine host passes. Changing the returned public document digest,
omitting grant deletion, and omitting descriptor-declared snapshot files each fail their intended
assertion; each restored selected case passes. These experiments change only the disposable copy.

The first migrated run exposed two additional fixture requirements: a restarted clock comparison
is intentionally stale, and the active hour descriptor declares no paper-history file. The final
test explicitly checks the first refusal and declares the second test's synthetic evidence source.
There is no production, configuration, guard, schema or migration change in this checkpoint.

The direct, supervised and public-input CLI launch tests remain unchanged in the feature branch.
A proposed direct/supervised fixture and exact identity-check patch is retained locally for the
owner's separate approval. Its installed selection reports two passes; the CLI case is not selected.
The final unchanged launch file and updated host file report three failures and nine passes. The
proposal is not applied here. The earlier coverage, remaining entry/native
acceptance, PDF decisions/viewing, protocol-retirement, integration, final-review and current-head
CI gates remain open. Local receipts:
`~/waitron-campaign-e/receipts/a679-retained-host-launch-20261019/`.

## Approved PDF dependencies and launch checks, 2026-10-19

The owner's 19 October watcher answers approve the combined key/check field, one current
installation code, and the exact direct/supervised launch patch. This checkpoint resumes the
03:26 firing, which stopped on model capacity with uncommitted changes; it does not treat those
changes as already qualified. Source baseline: `3295698d708a524f4c928c2dcbea5f050ac9e55b`.

| Check or fixture | Before → after; authority |
| --- | --- |
| `first-fiscal-launch.test.ts`, direct/supervised | Paper-input arrangement and `S000001` → owned hour/key-only setup and `06RB` at the existing controlled instant. The entire patch matches SHA-256 `7badf9e3c782eeb1daebab9c3dc75f6aaad208e33dda1a8f0207b2703d86443a` using `git diff --abbrev=7`. Exact owner approval, 19 October. Node/environment, successful provision body, restart signal and outside-file digests remain. The CLI declaration retains its original bytes and still fails. |
| `completed-recovery-document.test.ts` | Printed and attached code list `06RB, 06RC, 06RD` → only current `06RB`; unrelated/duplicate history cannot replace it. Existing before/after counter snapshots, rejection cases, identities and saved-zone check remain. Owner's single-code answer. |
| `recovery-document.boot.test.ts` | Reissued document's exact code list `06RB, 06RC` → `06RB`; the remaining boot/reissue checks remain. Same single-code authority. |
| `recovery-pdf-node.test.ts` | Separate eight-symbol check → literal combined key, decoded to the same raw secret. Singular code label and attachment expectation; a new multi-code render case refuses ambiguity. Existing attachment equality, metadata digest, relocated bundle and font-fallback checks remain. Both PDF answers. |
| `recovery-pdf.browser.test.ts` | Extracted rendered key/check pair and 47/57 lengths → one 41/51 value, no separate check label, same decoded secret. Long-label, attachment and reader assertions remain. Combined-key answer. |
| `setup/recovery-hour.browser.test.ts` | Two-field key fixture → same secret in the combined field; key-change/race cases edit that field. Code-list fixture/proposal → one normalized code. Missing-code wording becomes singular. A new list-refusal case checks that Compare becomes disabled; checking Select alone did not distinguish the old behavior because editing invalidates its comparison. Both PDF answers; all isolation/late-answer/clock/refusal checks remain. |
| `setup/recovery-hour.a11y.browser.test.ts` | Same combined-key fixture; existing state/theme/width accessibility and fit assertions remain. |
| `setup/recovery-key.browser.test.ts` | Rendered combined value replaces rendered value/check pair. Changing that value still clears decoded authority; backup-change, removal, PDF import/refusal and draft checks remain. New cases cover paste/middle-edit selection and a single EN/ES field refusal. The latter failed twice on duplicate messages before removing the repeated component-level message; the parent form's summary remains. |
| `setup/recovery-key.a11y.browser.test.ts` | Key-error selector moves from the removed check field to the combined field. Its error, accessibility and fit assertions remain. |
| New `recovery-key-code.test.ts` | Literal encoding/decoding, malformed inputs, one fixture's exhaustive single-symbol substitutions and unequal adjacent swaps, raw-byte round trips, and a valid-checksum value with nonzero spare bits. The last case closes a measured codec coverage gap without changing its implementation or coverage configuration. |
| `recovery-restore-input.test.ts`, two refused staged cases | Expected `placementStarted: true` → byte-for-byte equality with the staged request captured before execution. `restore-request.ts` restores the original marker on fresh admission refusal; retaining a started marker would request checked replay of an operation that admission refused. Domain errors, no outside collection for a wrong key, no hook, no trading identity and exact retained key assertions remain. This changes operational marker expectations under the 5 October interface-test decision; no fiscal identity/hash/counter/filing expectation changes. |

The combined codec retains the 192-bit secret and adds two base-32 typo-check symbols using a
modulo-1021 check. Manual entry does not bind a key to public identification; the selected backup
performs full authentication. The PDF import path retains its public-identification comparison.
The existing register codec and its consumers are unchanged in this checkpoint.

Receipts: Lane E `receipts/a679-launch-approved-20261019` retains the interrupted firing's RED
runs; `receipts/a679-resume-pdf-20261019` holds this firing's complete logs and patch inventories.
The source browser family passes 91 cases, including the unchanged register PDF suite. The
source recovery-module/staged-restore family passes 24 after its two marker failures. The
protected/initial-hour/presentation/completed-document run passes 106 cases, including the
20 unedited golden/immutability cases. Root module/error checks pass 3,168 cases. Codec-only
coverage was 97.56% statements / 91.66% branches; after the spare-bit case its measured counts
are 41/41 statements, 12/12 branches, 4/4 functions and 37/37 lines. This is one-file coverage,
not package coverage.

An independently installed clone catches and restores each serial omission: list splitting,
checksum validation, selection of a different valid installation code, original staged-marker
restoration and spare-bit validation. The initial whole-old-composer control reached the new
multi-code rendering refusal before its identity assertions; the subsequent valid-code replacement
fails the intended identity assertions instead. The original list-refusal case's passing old-code run is explicitly not a
RED receipt. Updated tests catch that control at the Compare action. Restoration is checked
before proceeding; full logs retain unsuccessful preparation runs as well as passing results.

Real-code EN/ES A4 PDFs for Madrid and Canary time zones were rendered, extracted and visually
inspected. Browser component previews cover both themes and 390/1280 widths, separately from
native whole-app acceptance. The revised samples use synthetic keys; copying them to the
owner's Drive is a viewing request, not approval. Whole A679 remains incomplete and unpublished:
the unchanged CLI launch failure, remaining entry/native acceptance, coverage, protocol/prose
retirement, current-main integration, both final installed Claude reviews, push hook, current-head
CI and PDF viewing approval still gate landing.


## Recovery PDF zone abbreviations, 2026-10-19

Authority: the owner's 04:45 request and 04:50 choice in Lane E's questions. The shared renderer
now asks Intl for the short zone name and places it after the local time without parentheses.
The eight observed English/Spanish Madrid/Canary summer/winter formatter results are CEST, CET,
WEST and WET. This is measured on Node 26.11.1; the real Chromium PDF consumer also ran.

Changed checks, all under `packages/fiscal-verifactu/src/`:

| File | Before and after |
| --- | --- |
| `recovery-pdf-presentation.test.ts` | The four summer rows expect CEST/WEST instead of spelled-out zone names, and assert the adjacent complete date/time/abbreviation. Four winter rows add literal CET/WET dates. Page count, two-column alignment, labels, instructions, short node ID and exact attachment equality remain. Winter attachment equality uses the corresponding winter input. |
| `initial-hour-setup.test.ts` | The prepared PDF's Canary zone text expects WEST instead of Western European Summer Time. Other preparation, secret and attachment assertions remain. |
| `completed-recovery-document.test.ts` | The completed reissue PDF's Canary zone text expects WEST instead of Western European Summer Time. Current-identity, key and attachment checks remain. |
| `setup/first-hour.browser.test.ts` | The browser-generated Canary PDF expects WEST instead of Western European Summer Time. The native setup and content checks remain. |

The presentation run first failed eight assertions against the long names, with its three invalid-zone
refusals passing. After implementation, four complete Node files pass 99 cases and the two browser
files pass 20. Fiscal-package types, scoped lint and formatting pass. No protected fiscal identity,
hash, counter, filing or login-refusal assertion changes in this revision. No package coverage claim.

Four real-code A4 PDFs, EN/ES for Madrid/Canary summer dates, were rendered with Poppler and each
page visually inspected. Each Created line fits on one line. PDFs and PNGs were copied and
byte-compared to `~/My Drive/Waitron mockups/2026-10-19 A679 recovery PDF/`. Viewing approval
remains pending; no physical printing or typing exercise is requested. Logs, samples and copy
digests are in Lane E's `receipts/a679-zone-abbreviations-20261019`.

The retained launch suite still reports one CLI refusal and two passing HTTPS launch cases. The
CLI is rejected by `provisioning/cli.ts` before legacy JSON input can become owned preparation
authority. Its original test bytes and S000001 expectation remain. The planned committed
document-download acceptance file is absent; naming it beside the existing launch suite did not
select or qualify a download case. Entry/coverage/retirement/integration/final-review/CI and owner
PDF acceptance gates remain open.


## Retained CLI replacement proposal, 2026-10-19

The unchanged source launch file reports two passing HTTPS cases and one CLI failure,
`provisioning.initial_input_invalid`. `packages/provisioning/src/bin.ts` configures owned setup;
`cli.ts:311–312` refuses legacy JSON authority before that setup can proceed. The replacement
proposal was tested only in a frozen-installed independent checkout. No proposed test change
has been applied to the feature tree.

The concrete patch in Lane E's `receipts/a679-zone-abbreviations-20261019` is
`proposed-cli-launch-checks.patch`, SHA-256
`3b06f60e1c2dc2f46fe16067842238f77360ffcb9710c3004ecc86277891ba3d`. It tests JSON refusal
then the real built command's owned clock/question/password/PDF path. The old stdout S000001
check becomes exact saved installation `06RB` and all three configured series at counter one.
The mismatched state/venue-root call expects exact `setup.attempt_conflict` instead of the
old generic marker guard's `setup.attempt_uncertain`; it also checks both attempts and marker
bytes remain unchanged and no refused-target database exists. The direct/supervised case bodies
are byte-identical. Both expectation changes await exact owner approval in the existing campaign
question. This is a proposed interface-test migration, not a product refusal change.

The installed complete file passes three cases in 12.54 seconds. Server types, scoped lint, formatting
and whitespace pass. Its release stamp, offline internet observation and clock are synthetic;
this does not qualify real release provenance or AEAT submission. Earlier unsuccessful fixture
preparations remain in the receipts and are not counted as passing evidence. The final restored
candidate matches all 6,889 tracked feature files. No writer, SQL, schema, guard or feature test
changes were made. The feature CLI failure and the other A679 acceptance gates remain.

## Committed wizard download acceptance, 2026-10-19

The new `apps/server/src/first-fiscal-document-download.e2e.test.ts` keeps every existing test,
fixture and expected value unchanged. Its two language cases build the actual setup app into a
fresh temporary directory and boot the real server over HTTPS. Bundled Chromium trusts that
server's public-key pin and rejects requests to other origins. Internet time, release metadata,
SMTP and the AEAT readiness response are synthetic. Certificate validation/sealing is substituted
at the readiness boundary; this does not qualify an actual certificate or external submission.

The cases complete the native wizard, await its download event and save the actual PDF. Its
SHA-256 must match the public recovery-document request. The saved file goes through the native
recovery picker. A real pdf-lib annotation/resave must change the PDF's hash while preserving the
attachment bytes, and that saved copy must recover the same key. PDF.js renders the original page;
Chromium prints that image to a new PDF without the attachment, and the picker must request manual
entry and clear the previously recovered secret. The key text extracted from the original PDF is
entered through the real single field with lowercase and accepted look-alikes. After the server
closes, its database is archived and reopened. The recovered secret must authorise a read against
that exact copy, while a wrong secret must refuse `promotion.break_glass_invalid`. The copy holds
one allocation and zero invoice records.

The picker is mounted as the real shared component after the wizard completes. This is not a
complete restore-screen, archive, bucket, Cloud or physical-paper journey. It adds no manager-reissue
qualification and does not replace the existing owner PDF viewing check. The old CLI test's proposed
patch remains unapplied pending its exact approval.

The server declares its setup-app test/build dependency, Playwright and pdf-lib. Its CI shard job
installs Chromium with three bounded attempts before the normal coverage command. No existing
exclude, threshold, shard count or root guard changes. Package selection now follows the declared
setup dependency. The workflow/dependency/teardown guards and real local install command are checked
separately; current-head CI remains a later whole-branch gate.

The first local run failed both cases because the new text extractor also captured the initial
letter of the next paragraph. Restricting the extractor to the printed 41-symbol grouped value
corrected the harness. Two initial type errors were an unused import and the image's DOM type.
These were new-test defects, not product failures or evidence of a production fix. The green
acceptance is qualified by fault controls in an independently installed copy, with all faults
restored before its final run. Lane E retains the commands and logs in
`receipts/a679-download-20261019-0620`.

Verification for this checkpoint: the four complete server files report 69 passes; the unchanged
protected pair reports 20; the three workflow/dependency/teardown suites report 232 after the final
manifest change. Server types, scoped lint, explicit code/config formatting and whitespace checks
pass. Prettier reports all three Markdown paths ignored; no whole-document formatting claim is
made. `pnpm --filter '...@waitron/setup' list --depth -1 --json` lists both setup and server. The
scoped Chromium installation command exits zero locally against the existing browser cache; no
cold Linux download-duration claim is made.

The independent frozen-installed baseline and restored tree each pass both new cases. Removing
the attachment, replacing its public PDF hash, dropping typed-key delivery and accepting a wrong
backup key each fail both cases at the intended assertions. The first is an explicit missing
attachment assertion; the second compares the registered digest with the saved download; the
third reports the absent recovered value; the fourth observes an incorrectly resolved authority
request. These are four separate faulty variants, not four product fixes. They change only the
measuring checkout and are restored there. No existing assertion, fiscal writer, migration, schema,
root guard or production implementation changes in this checkpoint. Full package coverage, CI,
remaining journeys, protocol retirement, integration, both final installed reviews and the two
existing owner approvals remain open.


## Restored trading boot acceptance, 2026-10-19

`apps/server/src/hour-recovery-host.test.ts` gains two cases, for archive and stream placement.
No earlier test body, fixture or expected value changes. Removing the new block and its imports
reconstructs the previous file byte for byte. Within each new case, the two-location shared seed
is reduced to one operational location before creating the backup, matching boot's existing
single-venue admission rule. The source fixture receives a real sealed membership key.

The existing sale/filing helper writes invoices `A-06RB/123` and `A-06RB/124`, with one accepted
synthetic AEAT receipt and one pending row. Recovery selects `06RC`. Two later simulated-clock
source-host starts must serve the public node probe over verified HTTPS, finish the rebuild,
retain both allocations and the complete recorded invoice/filing snapshots, preserve retired
counters 125/123/123 and fresh counters 1/1/1, and leave the selected-hour journal byte-identical.
This covers the hour plan's Tasks 7 and 10 restart boundary. It does not exercise a sale through
the listener, a separate process or a native adoption/promotion page.

In an independent frozen-installed candidate, omitting rebuild completion leaves its marker and
fails both new cases; forcing the public node probe to refuse sales fails both cases. Restoring
each omission passes both cases. These controls change no protected fiscal writer or assertion.
The first new-test run had fixture/order errors and a logger passed as an environment value;
those failures are harness errors, not product regressions. The first control wrapper also
expected the assertion's words in the wrong order; its retained log contains the intended two
assertion failures. The corrected wrapper verifies the failures and restored controls.


## Retained recovery delivery and command-import clock fixture, 2026-10-19

`packages/provisioning/src/first-setup-recovery-delivery.test.ts` adds 36 cases for the hour
plan's Tasks 9–10 and 12. Real owned command preparation stages the verifier and registers a
public delivery reference; the document digest in this fixture is synthetic, with no PDF created.
Configured runtime modules validate the retained snapshot. Cases reject altered attempt,
revision, owner generation, frozen input, stage and digest bindings; changed taxpayer, venue,
installation code and key name with a recomputed statement digest; missing or changed modules;
and malformed or oversized retained bytes. Positive controls read the original record again.

The kept-confirmation cases check acceptance just before the five-minute boundary, refusal at
the boundary, fresh confirmation, one-use consumption, invalidation by matching attempt, changed
delivery after confirmation, and refusal of different registration bindings or replacement bytes
for the same stage. A module that returns a different rebuilt statement is supplied only in the
new host-boundary test. Its snapshot and registration refusals are measured separately, removing
the old record before registration so its earlier read cannot hide the registration comparison.
The first omission experiment passed because that earlier read refused; it is not counted as a
successful control. The corrected omission fails its intended assertion.

The initial new suite incorrectly supplied unconfigured composition modules to the snapshot
reader. After using `runtime.modules`, four new expectations still named the host refusal rather
than the fiscal contribution's `sif.allocation_invalid` with
`reason: outside_confirmation_missing`. Both were new-test errors, not product defects; their
failed logs are retained. No previous assertion changes for these cases.

`packages/provisioning/src/first-setup-command-import.test.ts` changes only the relocated
command's build fixture. Before: the shared bundle CLI embedded the checkout's current commit
stamp while the child clock stayed at `2026-10-18T11:40:00Z`. The complete four-file run reported
105 passes and that case failing with `clock_unconfirmed`. Reading `readBuildHourRelease()` at
`00767da726b8eadb7d28d9fc00776dba54cead86` measured a release floor of
`2026-10-19T05:07:43Z`, later than its fixed clock. After: the same shared `bundle()` API embeds
an explicitly synthetic 15 October release stamp, matching the fixed-release boundary already
used by the in-process fixture. This supplies missing fixture context under the standing
27 September test-change decision; every existing assertion, child answer, invoice-series value,
PDF byte comparison and import/publication check remains byte-identical. This is not a production
release-provenance qualification or a change to clock policy.

Final four-file source run: 106 passes. The report includes only
`src/first-setup-recovery-delivery.ts`: 109/110 statements, 101/102 branches, 32/32 functions and
101/102 lines, passing the unchanged thresholds. This does not clear package-wide provisioning
or entry coverage. Types, scoped lint, explicit TypeScript formatting and the unchanged protected
fiscal pair pass. Installed controls and exact candidate comparisons are retained in the lane's
`receipts/a679-delivery-integrity-20261019`; they do not qualify any new browser journey.

No production implementation, fiscal writer, schema, SQL, migration, threshold or guard changes.
The exact CLI-launch patch and revised PDF viewing approvals remain separate pending gates.
Remaining entry acceptance, protocol/prose retirement, current-main integration, both final
installed reviews, the normal hook and current-head CI still precede landing.

## Startup exclusion and damaged-configuration admission, 2026-10-19

The hour plan's Task 10 gains eleven host-admission cases. Nine additions in
`apps/server/src/first-setup-resolution.boot.test.ts` exercise `resolveFirstSetupEntry().run()`:
claimed and selected workspaces hold the anchor and selected venue locks during the callback,
release them on success and failure, refuse a busy anchor or target before entering the callback,
and recheck an attempt that became activation-started, abandoned or uncertain after discovery.
Child processes try real SQLite lock transactions and distinguish held from available. Busy-target
cases also check that an earlier anchor hold was released. These are callback-admission checks,
not new fiscal activations or separate-process trading boots.

Two additions in `first-setup-resolution.bootstrap.test.ts` keep repair inspection available with
malformed or invalid module configuration while publication and provisioning routes remain absent.
They retain the configuration and claim bytes and require the venue database to remain missing.
Existing helper bodies, tests and assertions are unchanged: stripping the new imports and appended
blocks reconstructs both previous files byte for byte. This adds acceptance under Tasks 10/12;
it changes no fiscal expected value and needs no new exception to the standing test-change rules.

Five complete source files pass 59 cases, including the existing adoption-refusal suites. The
unchanged golden/immutability pair passes 20. The two changed files pass 31 cases in an independent
frozen-installed checkout. Six serial faulty variants fail their intended assertions: premature
anchor release, premature selected-lock release, omitted anchor release, omitted selected-lock
release, omitted attempt recheck and publication routes despite damaged configuration. Each
restored variant passes; the final installed two-file run passes all 31 cases. The first control
wrapper incorrectly counted occurrences of `AssertionError` instead of failed cases; its log
already contains four intended failures. The corrected wrapper checks Vitest's failed-test count.
The initial compiler run also rejected the new union narrowing; only new-test setup was corrected.

The earlier two-file and seven-file coverage measurements were narrower than the package and
failed their unchanged thresholds. The latter passed 91 behavioral cases and measured this entry
file at 58/60 statements, 31/35 branches, 12/15 functions and 55/55 lines. It is not a package
coverage pass, and uncalled default log callbacks do not justify meaningless tests. Full package
coverage remains a separate gate.

The consumer trace finds promotion routes in `boot.ts`/`promote-api.ts`, and no literal
`management-api/promote` or `promote/preparation` caller under the setup, dashboard or till source
search. No promotion browser screen is introduced. Existing real boot adoption qualification
retains pending adoption with `module.operation_invalid`, no selling identity and its original
latch. It does not qualify successful allocated adoption or supply the missing venue-copy path.
The hour promotion HTTPS and reboot acceptance remains in `hour-promotion.test.ts`; it was not
repeated for this test-only change.

Receipts: Lane E's `receipts/a679-entry-admission-20261019`, including commands, source counts,
installed omission/restoration logs, byte comparisons and consumer search output. No production
implementation, protected writer, SQL, schema, migration, guard, threshold or existing fiscal
assertion changes. The exact CLI-launch patch and revised PDF viewing questions remain pending;
protocol retirement, current-main integration, both final reviews, hook and current-head CI remain
before landing.

### Built CLI clock fixtures in the same qualification

The full provisioning run reports 1,324 passes and five failures across
`cli-owned-entry.test.ts` and `cli-same-hour-entry.test.ts`. All five report
`sif.allocation_invalid` with `reason: clock_unconfirmed`; the focused two-file reproduction
reports the same five failures and one pass. Their child clocks are explicitly
`2026-10-18T11:40:00Z`, while `readBuildHourRelease()` at source
`f01a5d00a2c8ace511701f7eb1067025a63e4be8` reports `2026-10-19T05:50:14Z`.

Only the two `beforeAll` build blocks change. They call the shared `bundle()` API with an
explicitly synthetic 15 October release stamp, as the retained command-import fixture already
does. The focused run then passes all six cases. Restoring only those build blocks reconstructs
both original files byte for byte: no existing test body, child answer, clock, series value,
refusal expectation, readiness check, PDF check or publication assertion changes. This supplies
missing fixture context under the standing 27 September decision; it does not alter release-floor
policy or qualify genuine image release provenance. The existing exact CLI-launch approval
request concerns a different server test and remains untouched.

The independent installed 31-case startup/repair run and its complete-tree comparison preceded
these two fixture changes. These fixture repairs have source RED/GREEN evidence; they are not
included in that installed-tree qualification. The full provisioning coverage rerun is recorded
separately in the lane receipts.

The final full provisioning rerun passes all 1,329 tests in 69 files (319.09 seconds), then fails
coverage: statements 3,613/3,788 (95.38%), branches 2,685/2,876 (93.35%), functions 682/696
(97.98%) and lines 3,271/3,356 (97.46%). No threshold or exclusion changes. The retained report's
largest statement gaps are workspace selection, resolution, configuration transfer and command
deployment; `coverage-gaps.json` records the individual locations. This is an unresolved package
coverage gate, not a passing coverage result. Both affected packages' types, scoped lint, code
formatting and whitespace checks pass. Markdown paths remain ignored by Prettier.

## Archived repair and workspace integrity, 2026-10-19

The repair archive must retain what was observed before selecting another workspace. The new
`first-setup-resolution.integrity.test.ts` exercises damaged manifests, chunks and repair events,
interrupted archive collisions, original-evidence sequence bounds, workspace bindings and directory
components. Additional cases in `first-setup-workspace.test.ts` exercise conflicting discovery
witnesses, orphan roots, missing required originals, unsafe archived paths and changed local
files or directory listings. Positive cases select an unchanged directory snapshot and resolve
the selected roots through both admission paths.

These add 67 cases. Removing the appended cases and their single import reconstructs the previous
workspace test file byte for byte. No earlier fixture, assertion or production implementation
changes. The retained server CLI test and the exact proposed approval patch remain unchanged.

In a separate detached checkout with a frozen dependency install, all three complete suites pass
164 cases. Six serial omissions then fail at assertions: base64 canonical spelling (one case),
archive collision refusal (one), inspection's resolution digest (one), required originals (three),
archived path checks (four), and local directory listing comparison (one). Restoring each guard
passes its selection; the final complete run passes all 164 cases again. The unedited golden
huella and immutability suites pass 20 cases. Types, scoped lint and code formatting pass.

The first source run contained a wrong helper import and an expectation that a missing selector
alone must prevent repair inspection. The latter is a permitted interrupted state, so that new
expectation was removed before qualification. Typechecking also exposed an incorrectly nested
parameter table; the corrected rows pass the original arrays as intended. These initial failures
do not establish product defects. A coverage run over only the three suites passes their cases
but fails the unchanged coverage thresholds; other suites exercise additional paths in these
source files. Do not treat that file selection as package coverage.

The complete provisioning run passes 1,396 cases in 70 files (396.15 seconds), then fails coverage:
statements 3,649/3,788 (96.33%), branches 2,722/2,876 (94.64%), functions 682/696 (97.98%) and
lines 3,288/3,356 (97.97%). No threshold, exclusion or ignore changes. The run retained a worker
snapshot while it was still advancing through the new repair suite. Its final report and remaining
uncovered locations are in the same receipt directory. Only the 129-invalid-event case's title
was narrowed after its installed qualification; its fixture and assertions stay unchanged.

Receipts: Lane E's `receipts/a679-resolution-integrity-20261019`, including the installed omission
and restoration logs, byte comparisons and temporary-checkout cleanup. Revised PDF viewing,
the exact CLI-test approval, remaining coverage, protocol retirement, current-main integration,
both final installed reviews, the push hook and current-head CI remain before landing.

## Configuration import and command publication, 2026-10-19

New configuration-transfer cases check the current business-day cutover, refusal of future
cutover changes and missing active series, stored receipt-language types, table/column admission
before deletion, retained target ownership, disabled imported staff credentials, source-operator
exclusion, disabled printers and agent credentials, and both sides of the row-count limit.
The configuration fixtures use the real migrated database and a non-fiscal GB venue; they do
not qualify an AEAT submission or a credential login journey.

New recovery cases check the stored node, active administrator and complete series set, with
unchanged counter rows on successful recovery and refusal. Their operation input is a synthetic
parser fixture; these cases do not establish fiscal-operation authority. Seven additional command
cases check unreadable retained vault files, lost private keys during interrupted publication,
missing publication/preparation, changed frozen requests, readiness before settings and repeated
provisioning of a completed venue. They reuse the existing command fixtures and their synthetic
clock, release and external-readiness observations.

These add 29 cases. The earlier CLI file is reconstructible byte for byte by removing only the
inserted block; no existing fixture, assertion or production implementation changes. The retained
server launch test, pending exact approval patch, protected golden pair and coverage configuration
remain unchanged. The focused four-file source run passes 123 cases. The complete independent
checkout, installed with the frozen lockfile, passes the same 123 cases before and after nine
serial omission/restoration checks. Each omission fails one intended assertion: password clearing,
source-operator filtering, printer disablement, agent credential replacement, operator-dependent
filtering, row limit, recovered node, recovered administrator role and recovered series name.

A tenth independent fault permits regeneration when the private key is missing but the public
key remains. The command still refuses publication, but the assertion that trust stays unchanged catches
the replaced public key. Restoring the condition passes that case. The unedited golden and
immutability pair passes all 20 cases. Types, scoped lint and explicit code formatting pass.

The initial command helper used the public claim summary instead of the durable state. The initial
recovery fixture had an empty operation list, so its negative cases stopped at parsing; the valid
control failed. Both new fixtures were corrected before installed qualification. The subsequent
node and administrator omissions then resolve instead of refusing, failing the intended assertions.
These initial errors are not product defects. One intermediate tree comparison ran during the
key mutation and reported that changed file; the comparison after restoration finds only the
later backlog edit. It is the latter comparison that checks restoration.

The complete provisioning run passes all 1,425 cases in 72 files (450.20 seconds), then fails
only statement coverage: 3,681/3,788 (97.17%), below 98%. Branches are 2,748/2,876 (95.54%),
functions 684/696 (98.27%) and lines 3,306/3,356 (98.51%), each meeting its unchanged threshold.
`coverage-gaps.json` retains the remaining locations, led by workspace, resolution inspection and
ownership handling. This is an unresolved package gate. The root backlog now lists open work
and links here for qualification receipts. No threshold, exclusion, guard, production source,
SQL migration or protected fiscal assertion changes in this step.

Receipts: Lane E's `receipts/a679-import-publication-20261019`. The existing PDF-viewing and exact
CLI-test approval requests remain pending, alongside the remaining A679 implementation,
integration, reviews and CI gates.


## Ownership and workspace qualification, 2026-10-19

No existing test check or fixture changes. The six existing test files retain every earlier line;
`first-setup-host-path.test.ts` is new. All 44 cases are additions, with no production, SQL,
schema, migration, guard, coverage-threshold or protected-fiscal edit.

- `packages/provisioning/src/first-setup-owner-audit.test.ts`: 15 cases retain pending records for
  inconsistent authority/source evidence, damaged markers and stale snapshots, with valid
  unchanged-source controls.
- `packages/provisioning/src/first-setup-workspace.test.ts`: 14 cases refuse conflicting selection
  records, copied workspace pointers and missing retired state, and return the exact archived
  state and resolution record for a valid retirement.
- `packages/provisioning/src/first-setup-resolution-inspection.test.ts`: nine cases retain evidence
  when capture races with file/directory changes, refuse damaged ownership state, and check the
  audit and final inspection of password-based marker repair.
- `packages/provisioning/src/first-setup-owner.test.ts`, `first-setup-state.test.ts`,
  `first-setup-runtime.test.ts` and new `first-setup-host-path.test.ts`: six cases cover a resume
  racing another owner, marker/root changes, setup-authority path boundaries and module reads
  before the host is initialized.

`pnpm --filter @waitron/provisioning test:coverage`, with reports isolated outside the package,
passes all 1,469 cases in 73 files in 579.76 seconds. Coverage is 98.09% statements, 96.76%
branches, 98.70% functions and 99.07% lines. No test case is skipped. The earlier run passed
1,458 cases but failed statement coverage at 97.67%; it is not the passing package receipt.

Independent frozen-installed checks pass the complete original three suites before and after
fault controls (174 cases), and the eleven-case extension selection before and after its controls.
Nineteen faulty variants fail their intended assertions, and every restored selection passes.
Omitting the first stat-size check alone still passes because the later byte-length check refuses
the oversized file; that probe does not qualify the first check independently. Initial new-fixture
mistakes and the control selector that matched two branches are retained, not product defects.
Both disposable checkouts are removed after their restored source and tests match the feature tree.

The unchanged golden huella/immutability pair passes 20 cases. Provisioning types, scoped lint,
explicit test-file formatting and whitespace checks pass. The pending server CLI-launch file
and its exact proposed patch remain unchanged. These results qualify the provisioning package,
not the remaining whole-branch entry/protocol, owner PDF, review or current-head CI gates.

Local receipts: Lane E `receipts/a679-ownership-qualification-20261019/`, including
`final-results.json`, `coverage-gaps-final.json`, `test-preservation-final.json`, both control
inventories, restored-candidate equality checks, full logs and cleanup records.


## Production protocol retirement, 2026-10-19

Authority: the approved hour-code design's keep/change/drop table and replacement plan Task 11
retire active paper/Cloud/emergency allocation dispatch, while retaining historical source needed
by unchanged tests and original-evidence inspection. The owner approved PDF viewing at 11:55
and the exact server CLI migration at 11:58 in Lane E's questions.

- `apps/server/src/first-fiscal-launch.test.ts`: apply exactly the approved patch,
  SHA-256 `3b06f60e1c2dc2f46fe16067842238f77360ffcb9710c3004ecc86277891ba3d`.
  The installed owned command replaces the JSON-authority positive path. Its saved installation
  changes from `S000001` to exact `06RB`, with `A-06RB`, `FF-06RB` and `R-06RB` at one in
  preproduction. Its root-conflict refusal changes from `setup.attempt_uncertain` to exact
  `setup.attempt_conflict {}` with the same nonzero exit and byte-preserved records. A new
  JSON-authority refusal remains. Original source run: two passed, one failed; exact applied
  patch: all three pass. The new public-dispatch integration is qualified separately below.
- Five hour-operation suites (`hour-dormant-standby`, `hour-recovery-state`,
  `hour-standby-activation`, `hour-surviving-history` and `initial-hour-setup`) now import the
  public production operation export. `initial-hour-setup` and the two dynamic imports in
  `hour-history` use the public initial-setup export too. Existing assertions and fixture values
  remain unchanged. Historical source dispatchers retain their tests; their prior hour-selector
  precedence had routed twelve historical tests to the new policy. An independently installed
  starting checkpoint reproduces the same twelve failures and one unhandled rejection.
  Restore only historical dispatch/configuration behavior; the selected five files then pass
  all 232 cases without changing their assertions.
- `setup/first-hour.browser.test.ts` imports the production setup subpath and adds a missing-hour-
  host refusal. Existing checks are unchanged. The initial wrapper copied the entire mutable API
  object and broke three later-added document callbacks; the three existing assertions caught
  this new regression. Keep the API object and its callbacks live after checking preparation.
  Both complete first-hour/recovery-key files pass all 36 cases after correction.
- `setup/recovery-key.browser.test.ts`: the native upload helper now awaits the promise started
  by the actual picker event and its final render. Every old matching/mismatching-PDF, key-event,
  manual-input and refusal assertion remains unchanged. The first full fiscal run failed the
  wrong-key-name check with an empty error while its helper did not await the import. A controlled 1.5-second file read in an
  independently installed candidate fails the original helper's unchanged refusal assertion;
  the awaited helper passes with the same delay. Restoring the file passes all 20 cases.
- New `hour-configuration.test.ts` uses four valid signed Cloud fixtures across ambient/configured
  restore/re-registration. Each must refuse through production without writing a receipt or
  changing current confirmation, while its direct historical collector still accepts it. All
  four fail before removal of the fallback and pass afterwards. A fifth case first reproduces
  unhosted paper-serial generation, then requires refusal. Replacing the public exports with the
  historical dispatchers makes all five assertions fail; restoring them passes all five.

The production setup factory refuses a missing hour-preparation host before returning the
historical register interface. Reverting only its public subpath makes the new browser refusal
fail; restoration passes all 16 first-hour cases. The independent candidate has its own frozen
install; the initial full local clone was stopped after copying part of the repository's 5.4 GB
object store, then replaced by an independent shallow file-protocol clone for these bounded
checks. It is not the final whole-branch review candidate.

Production configuration removes the custodian command/build and the wizard's offline-tool
asset plugin. The HTML builder remains a test-only script for retained historical suites.
The real setup build contains 13 files and no `custodian-tool` artifact. Its large-chunk warning
remains. Dashboard-module type checking initially lacked declarations for Vite asset imports;
adding its existing Vite dependency's client types makes all four affected package type checks
pass. No protected writer, SQL, schema, migration, golden hash or fiscal-record assertion changes.

The first combined five-file server run exceeded its 300-second outer deadline before a final
count and reported a manager-promotion failure without the final diagnostic. A focused diagnostic
passed both authority cases. This does not diagnose or fix the earlier timing failure. The
subsequent complete run, full fiscal coverage, remaining whole-range prose/current-main
integration and final installed reviews/CI are recorded separately as they complete.

Local receipts: `~/waitron-campaign-e/receipts/a679-retirement-20261019/`.

The second complete fiscal run passed 3,312 cases and failed only
`initial-setup.test.ts:162`, its contribution-reference check. This deliberately follows the
new production contribution: `FISCAL_PROVISIONING.initialSetup` must be the public hour
`productionInitialSetup`, rather than the historical register fixture singleton. The comparison
remains exact reference equality. This is module wiring under the approved Task 11 default-
dispatch replacement, not a fiscal identity, series, money, permission or record expectation.
The rest of the historical suite continues to inspect its original fixture contribution.
The focused wiring/public-host pair then passes 51 cases, including three new unsupported-input
snapshot cases. Preserve all earlier Changed test checks entries.

Final source qualification for this checkpoint: all 3,316 fiscal cases pass in 154 files
(233.74 seconds), then the unchanged coverage gate fails: statements 6,317/6,637 (95.17%),
branches 5,996/6,386 (93.89%), functions 1,300/1,337 (97.23%) and lines 5,717/5,906 (96.79%).
No threshold, exclusion, ignore, SQL, migration or protected writer was changed. The retained
per-file inventory starts with hosted recovery (71 uncovered statements), followed by first-hour
UI, historical initial setup and custody state. This remains real qualification work.

The final complete server group passes 193 cases in five files. Final protected checks pass
20, root guards 3,206, all four affected package types pass and scoped lint/code formatting pass.
The final setup build contains 13 files without the custodian-tool asset; its chunk warning
remains. Eight real-production-factory previews were visually inspected in English/Spanish,
light/dark and at 390/1280 pixels, with no horizontal overflow. These use synthetic clocks and
venue context, not the entire wizard. The first preview waited for the wrong English string
(“The clocks agree.” instead of “Clocks agree.”); correcting that fixture selector produced the
captured matrix, with no product change.

The independent candidate's final wiring/snapshot suites pass 51 cases. Removing only the public
input snapshot produces three intended malformed-input assertion failures; restoration passes
all eight public-dispatch cases. The earlier export and native-reader controls remain valid for
their unchanged assertions. Whole-range prose/current-main reconciliation, fiscal coverage, both
final installed reviews, normal push hook/current-head CI and authorised landing remain open.

## Public recovery and retained-evidence qualification, 2026-10-19

This extension adds 97 cases and changes no earlier assertion or fixture. The original bytes
of each extended test file remain its exact prefix. The protected write-path and immutability
test files remain unchanged from `58286f8fa52e571e5c9940a29a934854f2090221`.

| File | Added checks |
| --- | --- |
| `hosted-hour-recovery.test.ts` | 42 cases exercise the public operation export with the real clock and selection code: restore/re-registration/promotion authority, complete series, retained waits, manual confirmation invalidation, committed replay, malformed proposals, country/isolation refusals, reported floors, bounded confirmations and revocation around host/network awaits. The host supplies an opaque in-memory journal; no provisioning dependency is added. |
| `initial-hour-setup.test.ts` | Eight appended cases cover terminal resume/cancellation, altered requests, malformed previews, renewed ownership with the same retained hour and exact public document binding. |
| `setup/first-hour.browser.test.ts` | 23 appended Chromium cases cover malformed challenges/comparisons/selections/waits, retry after refusal, absent numeric countdowns and late failures after disconnection. |
| `register-history.test.ts` | 24 appended cases cover malformed retained revisions/checkpoints/originals, signed authority mismatches and conflicting independently retained heads, with a matching-head control. |

Authority is the approved hour-code plan's Tasks 7, 9, 10 and 12, including preservation of
historical evidence and meaningful omission controls. No product behavior, permission,
recorded fiscal identity, money, SQL, schema, migration or coverage setting changes.

The complete command `pnpm --filter @waitron/fiscal-verifactu test:coverage` passes all 3,413
tests in 155 files, then exits 1 solely for statement coverage: 6,425/6,637 (96.80%). Branches
are 6,089/6,386 (95.34%), functions 1,325/1,337 (99.10%) and lines 5,813/5,906 (98.42%). Hosted
recovery measures all 72 statements, 50 branches, 17 functions and 67 lines. Package types,
scoped lint, explicit TypeScript formatting and whitespace checks pass.

An independent checkout with its own frozen dependency installation runs the four complete
suites successfully: 42, 79, 55 and 39 cases. Nineteen serial omissions fail their intended
checks and every restored selection passes. Restored name-filtered runs deliberately skip the
unselected cases; their counts are not complete-suite counts. The final comparison finds no
differences across 6,901 tracked/new candidate paths, and the owned candidate and parent are
removed after the visible current-directory holder check returns empty.

Retained unsuccessful experiments are not product-defect receipts: the first new series
expectation used the wrong order; the first owner-resume fixture omitted its continuation key;
the first resume-authority omission was caught later and did not check suppression of network
activity; the first reported-floor omission supplied an invalid empty list instead of omitting
the floor; and one checkpoint-control selector matched two source locations. The corrected
authority case checks that no network call happens after revocation, the corrected floor
control observes wrongful selection, and the checkpoint control targets its exact condition.

Statement coverage, whole-range prose/current-main integration, both installed whole-branch
reviews, the normal push hook/current-head CI and landing remain open. This test-only extension
does not repeat the unchanged visual matrix or claim a complete installed wizard journey.

## Carrier validation and late-response qualification, 2026-10-19

This step adds cases without changing an earlier assertion or fixture. The only replacement of an
old test-file line adds `PDFString` to the existing PDF structure import. All other earlier lines
remain in order. The protected golden pair, production code, SQL, migrations, guards, dependencies,
coverage configuration and thresholds are unchanged by this step.

| Added checks | Boundary exercised |
| --- | --- |
| `register-pdf.browser.test.ts`, retained register carrier structure | Real nested attachments round-trip exactly; excessive depth, names, annotations, size declarations and noncanonical bytes refuse. Unsupported locale retains the reader's refusal wording. |
| `recovery-reader.browser.test.ts`, recovery carrier ambiguity and resource bounds | Real recovery PDFs reject conflicting streams, page associations, excessive depth and declared size; a nested single attachment with its matching association remains usable. |
| `custodian/custody-state.browser.test.ts` and `custodian/offline-recovery.browser.test.ts` | Historical custody refuses actions before their prerequisites, malformed candidate bases, late kit installation, overlapping public imports, unsuitable selected files and blank incident descriptions. Signing failure retains consumption and stops the signer. |
| `testing/register-compact-cases.ts`, through both existing node/browser suites | Historical compact recovery checks scope, retained positions, old heads, reference formats and generated-key input. Existing independent key/check vectors remain unchanged. |
| `declared-paper-preparation.test.ts` and `initial-setup.test.ts` | Retained declared delivery requires matching document/history digests and known-history shape. Exact repeated consultation preserves its allocation/installation keys and positions. Missing frozen requests, reservation pairs and malformed proposals keep their domain refusal. |
| `initial-cloud-setup.test.ts` | Historical receipt inspection refuses a missing fingerprint, a directory, an oversized otherwise valid trust document and an unknown trust field. No allocation is written. |
| `hour-activation.test.ts` and `hour-recovery-state.test.ts` | Admission refuses malformed input and non-null reservation evidence before its callback; exact committed re-registration reads preserve counters, while another recovery source refuses. |
| `setup/first-hour.browser.test.ts` | Real factory components ignore late clock/import responses after disconnection, discard late staged/delivered PDFs and permit retry of a refused kept confirmation without granting completion. |

The independent installed candidate first passed 320 cases in eight complete suites, then 475 in
twelve complete suites after the extension. The last custody concurrency addition passes its complete
32-case suite in that installed candidate. Twenty-seven fault variants fail their intended
assertions and every restored selection passes. The PDF publication predicate omission fails
three of its four selected race cases; the fourth still refuses through a later check. The
separate omission of the register name-tree shape check does not fail its refusal case and is
unqualified. Neither result is counted as an independently enforced earlier guard.

Initial new-test mistakes are retained in the receipts: a mutable shared base fixture affected
the next case until copied, a readonly candidate field needed replacement of its row, and the
expected allocation id assumed a fixed value although the fixture creates a UUID. The corrected
expectation uses that fixture id and literal namespaces/positions. The oversized register input
now exceeds the actual 64 MiB limit; its refusal alone does not establish that parsing was skipped.
The Cloud size case uses otherwise valid JSON padded beyond its limit. These are test corrections,
not reproduced product defects.

Receipts are under Lane E's local `receipts/a679-carrier-validation-20261019/`, including the
installed runs, every fault/restoration log, assertion summaries and preservation inventory.
Whole-branch integration, broader prose reconciliation, both final installed Claude reviews,
the push hook and literal-current-head CI remain separate gates.

The final full fiscal run passes 3,552 cases in 155 files, with statements 98.01%, branches 96.57%,
functions 99.17% and lines 98.98%. These meet the unchanged 98/95/98/98 bars, respectively.
The earlier complete runs passed 3,531 and 3,551 cases but failed statement coverage at 97.63%
and 97.99%; neither is reported as a green package run. The final run closes fiscal coverage
qualification, not the remaining whole-branch gates.

## Current-main integration, 2026-10-19

The 134 local commits were rebased onto `fcb1332f999136eae86961673f6680f2c713435a`.
This integration preserves A795 certificate-install recording, A725 configuration-transfer
format 4 and station ordering, the setup theme chooser, newer dependency versions and both
sets of fiscal browser suites. No schema or migration path differs from that captured main.
The protected golden and immutability files remain byte-identical to main.

The relocation initially lost the configuration format update: the existing server transfer
suite reported 65 failures and 54 passes, including the exact version-4 assertion. Carrying
the main implementation into provisioning then passed 133 cases across three complete server
suites. The moved configuration-transfer implementation is byte-identical to the captured
main server implementation. Kitchen timing differs only in its generic location argument type.

The existing production-command case used a base64 blob that was not a readable certificate.
It still passed while typechecking found the missing node argument. Two new cases use a real
synthetic certificate and reproduce the missing-node write failure through the command and
browser activation service. Publication now supplies the checked committed node to the
certificate seat. The production writer, fiscal numbering and historical records are unchanged.

Changed checks and fixtures:

| File | Before and after | Authority |
| --- | --- | --- |
| `packages/provisioning/test/configuration-bundle.ts` | The valid synthetic bundle moves from format 3 to format 4; other fixture values remain. | Preserve landed A725, `6a4331b4d5e038ecdfc482318eaa6c9e5a5abefe`; hour-code plan Task 12 requires retaining current-main behavior. |
| `packages/provisioning/src/configuration-transfer.boundaries.test.ts` | The future-format refusal uses 5 instead of the now-supported 4. Its expected error code and field remain unchanged. | The same A725 format change; this preserves the future-version boundary. |
| `packages/provisioning/src/cli-first-setup.test.ts` | `productionFixture` optionally accepts a readable certificate; its default and every earlier assertion remain. A new case asserts one install row with the committed node, exact fingerprint, setup source, null person and certificate kind. | Preserve A795 and Task 12's current-main integration requirement. |
| `apps/server/src/first-fiscal-declared-publication.test.ts` | The fixture optionally retains the real certificate seat and adds its certificate input. Earlier invocations still use their original stub and body. A new activation case asserts the actual install row and committed node. | Preserve A795 through the real browser activation service. |

Focused post-fix runs pass 248 provisioning cases, 122 activation/readiness/boot cases, 133
configuration-transfer/timing cases, 80 setup/recovery fiscal-browser cases, 56 certificate
browser cases and 56 setup/theme/browser cases. The protected pair plus venue-field suite
passes 34 cases; the pair remains the original 20. The fiscal contract suite passes 190 and
six focused root suites pass 3,517. Six affected package typechecks pass. These are focused
integration receipts, not whole-branch coverage or final review results.

An initial fiscal browser command included two nonexistent screen filenames; only its two
real setup/recovery files supplied the 80 cases. The later four-file certificate command
supplies the separate 56 cases. The first relocation-patch check failed before applying;
its shell continued the rebase. The lost changes were then exposed by the counted transfer
failures and carried over explicitly. Neither failed experiment is successful validation.

The backlog retains open A679 work. Its former checkpoint narrative is preserved byte-for-byte
in [a historical snapshot](a679-development-checkpoints.md); the current decision entry points
to the approved hour design. The provisioning reference now states the existing 21-character
base bound. A relative-link check resolves 935 local destinations across the changed prose
paths; it does not check anchors or the meaning of those pages. Final installed reviews,
current-head CI and authorised landing remain open.
