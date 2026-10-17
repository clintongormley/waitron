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
