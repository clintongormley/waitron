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
