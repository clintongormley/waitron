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
