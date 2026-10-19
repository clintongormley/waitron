# A799: upgrade a venue an older release actually used

**Proposal for owner review, 19 October 2026. Full design and build await agreement.**
This prepares the owner-marked pre-live blocker in [the backlog](../../backlog.md#the-box-backups-upgrades-and-recovery).
It authorizes no implementation, migration, squash, reset, compatibility repair or deployment.
No tests were requested or run for this proposal. All current-source observations below are
**UNVERIFIED at runtime**, read at `87f19d4bc98d2fb7925e886228430cabfc490a9b`.
Examples and acceptance conditions are proposed requirements, not observed outputs.
[Review boards](../../backlog/mockups/a799-real-database-upgrade-testing/README.md) give you
the first owner choice and worked examples in English and Spanish at phone and desktop widths.

An upgrade can keep every table and every row count while changing yesterday's invoice or losing
the relationship between an order and its payment. You need a small, real venue folder that an
older immutable image has booted and used, with facts you recorded before the new image existed.
Give each candidate a disposable copy and ask whether those facts survived its normal start.

## First owner question

**Should the required fixture be an invented venue created by an older image (recommended: Ana's
0.350 kg cheese sale must still be 0.350 kg after upgrade), or an actual private venue snapshot
with a separately approved custody process?**

The recommendation gives ordinary CI a real database with product-written history, without
customer information or working credentials. It costs an explicit scenario and cannot represent
every operator habit. A private snapshot could expose combinations the scenario misses, but its
origin, permission to retain it, access, and reproducibility need separate agreement. Removing
personal information afterwards can change the very fiscal bytes you need to preserve. Under this
proposal no private venue is collected, redacted, uploaded or used. Silence approves neither option.

## The A760 boundary comes first

The [approved A760 plan](../plans/2026-10-16-a760-migration-squash.md#owner-approval-16-october-2026)
requires existing venues to enter the new migration history through approved destructive pre-live
resets. Its [inventory](../plans/2026-10-16-a760-migration-squash-inventory.md) is a dated input to
that job, not a database this design may upgrade across the boundary. Preserve both documents.

The supported A799 baseline starts **after the approved squash/reset**. Call that history an
_epoch_: a family of releases that share the approved baseline migration hashes. Record the actual
squash merge and baseline identity when available. Do not choose a pre-squash image merely because
it is conveniently old. This proposal does not establish that A760 has executed or that a suitable
post-squash image already exists.

The first post-reset release can supply fixture R1. A later candidate C must preserve R1 through
its supported migrations. R1-to-R1 is a useful harness control, but it proves restart only. Before
calling the upgrade requirement met, include a distinct later image with at least one applicable
pending migration and evidence that its normal boot applied it. Until then report “upgrade case
awaiting a later release”, never preservation success for a missing case.

A later matrix cell with no pending migrations still runs and reports restart/preservation
coverage. It must not be counted as the distinct pending-migration case required above.

An optional pre-squash rehearsal has a different result: the real entry must refuse
`provisioning.database_ahead` before migration; database journals and domain facts stay unchanged.
Recovery counters or logs may change and are reported separately. This is refusal coverage, not
preservation coverage. Never delete tracking rows, translate hashes, restore into the new epoch,
run a reset, add a migration or add backwards compatibility to make that rehearsal pass. A799
neither executes nor amends A760's freeze, named reset roster or home-box quarantine.

## What today's source suggests

Every row is **UNVERIFIED at runtime**. Locations identify the read, not a successful experiment.
Re-trace these paths in the selected historical release and final candidate before building.

| Path read                                                                                                                                                                                   | Source observation and design consequence                                                                                                                                                                                                                                                   |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `deploy/Dockerfile:197`, `:206`, `:259`, `:275`; `apps/server/scripts/copy-migrations.mjs:17`                                                                                               | The image copies the bundled entry/server and migration folders; its entry is `node /app/node-entry.js`. Pin the image digest and platform, and inspect its actual packaged folders rather than inferring them from a checkout.                                                             |
| `deploy/waitron.sh:607`, `:623`, `:629`; `deploy/compose.yml:17`, `:103`, `:144`                                                                                                            | Install selects images and starts compose; compose uses host networking and a hardware print agent. The fixture runner must exercise the image entry in its own isolated rig, not invoke the real installer or reuse the appliance compose stack. This does not qualify the install script. |
| `apps/server/src/node-entry.ts:457`, `:473`, `:480`, `:486`, `:492`                                                                                                                         | Entry runs staged restore/reset handling, takes the venue hold, checks ahead-of-image, loads box environment, then starts the server. A candidate run must retain that chain and must begin without pending restore/reset operations.                                                       |
| `apps/server/src/node-entry.ts:362`; `packages/provisioning/src/schema-ahead.ts:17`, `:34`, `:49`                                                                                           | The ahead check compares recorded hashes with shipped hashes. Equal migration counts do not substitute for this check.                                                                                                                                                                      |
| `apps/server/src/boot.ts:849`, `:863`, `:874`, `:878`, `:882`, `:1460`                                                                                                                      | Boot checks the deployment stamp, selects migration sets from module configuration, migrates, opens the long-lived store, checks append-only triggers and installs the change feed. Calling only `applyMigrations` omits these parts.                                                       |
| `packages/migrations/src/apply.ts:50`, `:65`, `:70`, `:74`, `:126`                                                                                                                          | The migrator takes `migrations.lock`, removes the old feed, applies ordered sets, installs declared append-only pairs and refuses an incomplete set. Preserve the old image's installed triggers in the capture so the candidate meets them.                                                |
| `packages/db/src/client.ts:69`, `:89`; `packages/store/src/venue-lock.ts:53`, `:76`                                                                                                         | The database opener delegates to the store; the venue hold uses a SQLite transaction on `venue.lock`. Use the release's real lock protocol; do not unlink lock files or bypass it with `exclusive: false`.                                                                                  |
| `apps/server/src/box-env.ts:7`, `:22`, `:31`; `apps/server/src/trading-config.ts:31`; `apps/server/src/module-config.ts:12`, `:32`                                                          | Box environment reads secrets/trading/backup files with nonempty process overrides; trading config carries node/location/environment; module choices live in `modules.json`. A bare `venue.db` is insufficient provenance.                                                                  |
| `apps/server/src/box-secrets.ts:139`, `:154`; `apps/server/src/node-identity.ts:24`, `:39`                                                                                                  | TLS/vault files are created when absent; node identity is sealed in the database vault. Capture their matching state and check that candidate boot reuses identity, rather than creating another one.                                                                                       |
| `apps/server/src/setup-api.ts:704`; `apps/server/src/provision.ts:199`, `:209`, `:219`                                                                                                      | Setup delegates provisioning, allocation inputs and module-config persistence. Evaluate that release's supported initial setup path and fake authority inputs; do not insert its domain rows directly.                                                                                      |
| `apps/server/src/management-api.ts:1092`, `:1120`; `apps/server/src/catalogue-api.ts:1087`, `:1481`; `apps/server/src/till-api.ts:1643`, `:1673`, `:1749`                                   | Staff invitations, catalogue writes/publication, sales and parked orders have product HTTP paths. The transcript must follow the old release's authentication, enrollment and permissions too.                                                                                              |
| `apps/server/src/till-sale.ts:943`; `packages/core/src/record-sale.ts:164`; `apps/server/src/till-clock-api.ts:105`, `:156`                                                                 | Sale orchestration calls the sale writer; clock routes call the workforce backend. These are useful trace points for identifying which old product code wrote the facts.                                                                                                                    |
| `packages/fiscal-verifactu/src/schema/registros.ts:59`, `:84`, `:88`, `:99`; `packages/fiscal-verifactu/src/schema/envios.ts:19`; `packages/workforce/src/schema/time-entries.ts:57`, `:83` | Fiscal rows declare original monetary text, predecessor fields and huella; the outbox links by registro ID; workforce rows declare event times and chain hashes. Capture raw typed values as well as product reads, keeping these histories distinct from mutable delivery state.           |
| `apps/server/src/till-setup.ts:108`; `apps/server/src/till-sale.ts:507`; `apps/server/src/working-order.ts:3732`, `:3773`                                                                   | Today's till advertises F1 disabled and refuses an F1 sale request, while invoice choice can save a recipient on an unpaid order. An issued F1 and a saved recipient are different coverage claims. See the capture boundary below.                                                         |
| `apps/server/src/onboarding-policy.ts:12`; `apps/server/src/mdns.ts:52`; `apps/server/src/email-delivery.ts:16`, `:37`                                                                      | Preparation/demo suppress filing; loopback binding suppresses mDNS; email can still select configured SMTP. Check all effective settings and enforce network isolation as well. Preproduction alone is not the containment mechanism.                                                       |
| `apps/server/scripts/demo-seed/seed.ts:71`; `apps/server/scripts/demo-seed/seed-staff.ts:12`; `apps/server/scripts/demo-seed/seed-sales.ts:274`, `:298`                                     | Demo seeding mixes direct staff inserts with product sale calls using `demo_seed` origin. It is useful scenario material, but is not evidence that the staff/API/order journeys required here ran.                                                                                          |
| `apps/server/src/testing/venue-fixtures.ts:70`; `apps/server/src/testing/fiscal-fixtures.ts:72`, `:97`                                                                                      | Existing helpers construct rows and sessions for tests. They are not substitutes for a historical image using its normal product paths.                                                                                                                                                     |
| `scripts/migration-upgrade.test.ts:63`, `:218`, `:248`, `:295`, `:299`                                                                                                                      | The walk stages current migrations, installs current protection lists, fills synthetic rows and handles named resets. It remains unchanged and complementary; the new real-fixture check has no reset allowance.                                                                            |
| `apps/server/src/run-server.ts:31`, `:72`; `apps/server/src/boot.ts:729`, `:746`                                                                                                            | Shutdown has a deadline whose timeout path exits zero; ordinary close logs `server.stopped`. Exit zero alone must not qualify a clean capture.                                                                                                                                              |

The relevant house explanations are [migration upgrade coverage](../../developers/ci-and-gates.md#migration-upgrade-test-coverage),
[data conventions](../../developers/conventions-data.md#one-process-per-venue-folder), and
[fixture and process ownership](../../developers/testing-guide.md). Their historical receipts
are not new runtime verification by this author.

## Create history once, through the old product

Recommend a small invented Spanish preparation venue, explicitly stamped `preproduction`, using
Veri*Factu locally without an AEAT certificate. Use the immutable old image for setup and every
domain write. An external scenario driver may send requests or operate its UI. It must not import
current writers, apply today's migrations to an old schema, use direct domain SQL, fabricate
sessions, or replace the fiscal backend. Read-only extraction after shutdown is allowed.

Version the scenario with that image. Keep exact requests, responses and returned identifiers;
enrollment and login are part of it. Use the image's supported fake payment/authority/email seams
only at their external boundaries, keeping validation, authorization, sale writing and hashing real.
Do not change old source, inject a replacement migrator, or add a general compatibility layer.
An unsupported route or incompatible runtime is a capture blocker to resolve explicitly.

Use invented staff Ana Ríos and Luis Vega, emails under `example.test`, and a clearly labelled
test taxpayer and customer. Select valid test identifiers accepted by the old image, recording
the exact values and their test-only origin. For the issuer, the current Spain demo identity is
`Waitron Demo S.L.` / `B00000000` (**UNVERIFIED at runtime**, `packages/country-es/src/spain.ts:312`, `:313`).
Do not represent a made-up tax ID as an issued identity or contact any authority to validate it.

Supply fixed, public test-only passwords, PINs, vault/TLS material and signed preproduction
allocation inputs through interfaces that the selected image actually supports. The fixture's
node, SIF installation, series and key fingerprints become fixed at sealing and are reused in every
candidate copy. Product-generated salts, UUIDs and signatures are captured exactly; they are never
normalized away to force byte-identical recapture. Deterministic test inputs and deterministic
replay of frozen facts are required; byte-identical recreation of a new database is not claimed.

There is no demonstrated universal deterministic-identity hook: **UNVERIFIED at runtime**,
`packages/provisioning/src/throwaway-allocation.ts:35` generates UUIDs and
`packages/fiscal-verifactu/src/throwaway-allocation.ts:49`, `:57` generate keys/IDs/time;
`packages/fiscal-verifactu/test/allocation-fixture.ts:19` also generates a key. Do not describe these
helpers as deterministic. If fixed external test material cannot be supplied without patching the
image, stop capture for an explicit harness decision. Never rewrite generated identity in its SQL.

### The little venue you must be able to recognize

These are scenario targets. The sealed facts must contain the actual old image's returned IDs,
timestamps, rounding and accepted inputs, independently reviewed against this example.

| Old product journey                                                                                                                                                    | Facts to freeze and compare                                                                                                                                                                                                                                                                         |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Ana and Luis accept invitations, set test PINs, and use enrolled devices with distinct permitted profiles.                                                             | Person/device/profile IDs, names, roles, admission and permissions. Show Ana's recorded sale still attributed to Ana; authenticate afresh after upgrade through normal login, rather than relying on an unexpired session.                                                                          |
| Publish “Lunch”, with staff name “Curado”, customer name “Queso de oveja” and kitchen name “QUESO FRÍO”; include coffee, wine, a variant and a whole-portion modifier. | Every name separately, units and scales, category/section/include links, published-version IDs and document bytes, current draft and publication state. Give the three names different text so a wrong reader is visible.                                                                           |
| Sell 0.350 kg of cheese at €22.00/kg, one coffee at €2.20 and one wine at €3.63.                                                                                       | Illustrative VAT-inclusive total €13.53: 10% base €9.00/tax €0.90 and 21% base €3.00/tax €0.63. Cheese quantity is 350 thousandths, not 35 or 350 cents. Record each line, rate, tender, change and attribution, plus exact invoice/series identity returned by the old product.                    |
| Rename the live cheese and raise its price to €24.00/kg, then publish again.                                                                                           | The earlier sale keeps its recorded €7.70 cheese line and old customer name. The live offer carries the new price/name. Comparing only today's catalogue would miss a rewritten invoice snapshot.                                                                                                   |
| Save an unpaid order “Window seat”, with a supported full-invoice choice for invented “Cliente Prueba S.L.” and its accepted test tax ID/address.                      | Order/line IDs, revision, quantities, frozen selections, recipient fields and pending status. It is a recipient-bearing unpaid order, not an issued F1 invoice. If the selected old image can issue F1 through a supported product path, also capture that distinct invoice and recipient snapshot. |
| Leave an ordinary issued sale's fiscal submission pending, and leave a separate parked order unpaid.                                                                   | The issued sale has its original fiscal record and pending outbox entry; the parked order has no invented sale or invoice. Keep attempts, due time and links exact under the no-filing posture.                                                                                                     |
| Ana clocks in, starts/ends a break and clocks out; send and recall a supported kitchen line without hardware output.                                                   | Workforce event IDs, exact instants/offsets, actor, sequence and predecessor/hash; order-event history and actor/order links. Record real timestamps if the release has no supported controlled clock. Include only event kinds the old release actually writes.                                    |
| Create a small booking through its product path, then deliberately switch bookings off through a supported module path.                                                | Retained booking data and explicit disabled configuration, with no automatic re-enable at candidate boot. If that old release lacks a safe toggle, use a separate never-enabled optional-module fixture and record the retained-data case as missing.                                               |

The exact monetary result must be checked against the old response and stopped database before
accepting capture; never modify the expected arithmetic to accept an unexplained discrepancy.
The example's quantities and rates are test coverage, not a ruling about applicable VAT.

**Issued-F1 boundary:** capture must report recipient coverage precisely. Current public F1
refusals must remain intact. If a required issued-recipient invoice cannot be created by the
selected post-squash image, keep that acceptance item open until a qualifying release or an
explicitly approved narrower scope exists. Calling `recordSale` directly or importing a fabricated
F1 fixture would not satisfy this product-route requirement. The later owner question covers this
choice; this author has not settled it by omission.

## Stop, capture and seal the whole state

The proposed capture procedure is a contract for a future harness, not a command run here:

1. Finish all requests; close scenario clients and normal product background work; stop the old
   entry process gracefully. Require completed shutdown evidence and no deadline/forced-kill
   signal, then account for every owned child. A timed-out capture is rejected, never frozen.
2. Take the old release's venue hold while copying. Coordinate state-file writers as well as the
   database writer; a venue hold alone is not a claim about every sidecar. No services may still
   write the state root. Never remove `venue.lock`, `migrations.lock` or `recovery.lock` to acquire it.
3. Capture the complete isolated state root and any declared companion volume, including
   `venue.db`, `node.db`, configuration, `modules.json`, vault material, TLS, node/account settings
   and necessary environment inputs. Inventory every entry recursively and classify each as
   captured or explicitly excluded, with a reason. Reject links outside the root and special files.
   The old release's inventory decides what exists; today's recovery-file list is not that list.
4. Record SQLite side files. Never delete a WAL or journal to make a capture look clean. Require a
   consistent stopped set: either evidence of a completed checkpoint/clean close, or the complete
   matching side-file set with an independently checked consistent read. Recheck hashes while
   the hold is owned. Exclude only documented transient holder/lock-journal files created by the
   recorder itself; retain persistent lock files and never treat a captured PID as an active owner.
5. Read the stopped copy without migrating it. Require integrity result `ok`, no foreign-key
   violations, nonempty scenario coverage, exact old journal identities and the historical boot's
   trigger definitions. Read-only extraction must not create journals or regenerate protection.
   Release the hold and close all handles in guarded cleanup.
6. Independently inspect the old product responses and raw typed rows. Seal expected facts,
   schema, triggers, journals and checksums alongside the archive **before any candidate opens
   a copy**. A reviewer accepts this evidence, not merely the recorder's exit code.

“Whole state” has no blanket deletion of node-local rows. Keep sessions, vault data and queues in
the private test artifact, using only test credentials. Expiration is a declared runtime effect to
compare separately, not permission to drop arbitrary local rows. No live customer data, real
AEAT certificate, Cloud binding, provider token, bucket credential or LAN hardware address enters
the capture. Reject an unsafe capture rather than edit fiscal history to sanitize it.

### Provenance and custody

Recommend a small committed index and immutable fixture bundles in a dedicated release-artifact
store, outside the shared dependency cache. The exact destination and retention await owner
agreement. Each bundle has one content-addressed identity, for example
`epoch-1/R1/scenario-1/<sha256>`; these labels are illustrative, not existing artifacts.

| Sealed input      | Required content                                                                                                                                                                                                                                      |
| ----------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Origin            | Full source SHA; registry/repository, image digest and platform-specific digest; architecture; build identity; Node/SQLite runtime versions; scenario-driver SHA/version; epoch and capture UTC time. A mutable tag alone fails admission.            |
| Commands          | Exact image launch, environment allowlist, setup/API/UI sequence, capture/extraction commands and exit results; paths relative to an owned root; actor and returned-ID map. Store only explicit public test secrets, never ambient environment dumps. |
| Database identity | Per-set migration journal rows with hashes and dates, migration SQL/meta file hashes as shipped, module selection, schema definitions including indexes/FKs/CHECKs/triggers and SQLite metadata. Record old boot-created trigger bodies as found.     |
| Expected facts    | Independently frozen typed facts and raw rows/bytes, their extraction version and review receipt. Include coverage declarations such as “recipient-bearing order; issued F1 absent”. No candidate-generated expectation is admissible.                |
| Files             | Archive hash, per-file SHA-256, sizes, modes, entry inventory/exclusions, schema/expectation/transcript hashes and dependency identities. Include declared clock/time-zone and network settings and the evidence that the source stopped cleanly.     |

Append a fixture for a release; never replace a bundle, reuse its version for new bytes, or rerun
an old scenario to bless a candidate failure. Corrections get a new version and explicit review,
retaining the original and its defect notice. An expectation fix must be justified against the
unchanged old artifact and its product transcript, independently of the candidate result.

Use archive limits before extraction: maximum compressed/unpacked bytes and entries in the index,
no absolute/parent paths, no escaping links, no device nodes. Use a fresh 0700 directory and 0600
secret files; map ownership only to the isolated image user, not a real box account. Verify all
hashes and permissions before launch, and hash the sealed source again after the run. The writable
copy must share no database inode with the sealed source; no hardlinks or shared writable volume.

CI receives read-only artifact access; publication credentials are unavailable to candidate jobs.
Untrusted pull-request code must not receive private-store credentials. Choose either sanitized
test-only bundles downloadable without a secret, or a trusted prefetch stage that passes verified
content without credentials. If repository policy forbids that transfer, report the required job
blocked and run it in the trusted release lane before release. Missing, expired, wrong-size,
wrong-hash or inaccessible required artifacts fail distinctly within a bounded fetch deadline;
they never skip to green or fall back to a new empty venue.

Reproduction means obtaining the pinned image, driver, bundle and expectation hashes and replaying
the candidate check locally in the same isolated rig. Regenerating the original scenario is a
separate fixture-validation exercise; compare its business facts and record any allowed generated
IDs/time/salts explicitly. Do not claim byte-identical reconstruction without measuring it.

## Run the actual candidate, then compare what matters

Recommend an isolated container/VM rig under `bench/` for image orchestration. The house forbids
container-starting suites under `packages/` or `apps/`; ordinary comparator unit tests can remain
in their owning package. This resource-owning image rig needs its own guarded cleanup and closed
readers, rather than `useVenueDb` constructing a new database in place of the captured one.

Each matrix cell takes a new verified copy. Mount only that copy, use the candidate image's normal
entry and packaged migrations, and preserve the captured node/environment/module configuration.
Do not inject no-op entry dependencies, bypass `assertNotAhead`, run direct migrations first, invoke
restore, allocate a new identity or provision again. Reject pending reset/restore/rejoin/first-start
markers during fixture admission; do not delete one to make candidate boot succeed.

Use a dedicated network namespace with no default egress, DNS forwarding, host network, LAN route,
multicast or published host ports. The driver and fake services communicate inside that boundary;
bind the product to loopback there and use its own TLS trust. Override image host/origin defaults
explicitly and record the effective merged configuration. No host trust-store edits, `/dev`, DBus,
Docker socket in the application, real print agent, tunnel or operator volume is mounted. Disable
automatic restart so an unexpected exit is a failure, apart from explicitly counted setup restarts
while producing the old fixture.

Keep both old and candidate in a preparation/no-submission posture with no real external
credentials. Use a local captured mailbox for invitations, no printer enrollment, and cash/manual
card or the release's built-in simulator for payments. Print jobs may be stored for inspection but
no hardware transport consumes them. Cloud, backups, external payment recovery and SMTP must be
absent or point only to explicitly supported fake endpoints. Record unexpected outbound attempts
as containment failures even if the network blocked them. Evaluate these capabilities for each
old image at implementation; today's settings and `StartServerSeams` are not a promise that an
arbitrary old image can be isolated through those same interfaces.

Wait for the trading endpoint and an authenticated historical read, not a setup page or recovery
page that happens to return 200. Stop cleanly before raw database comparisons. Read-only product
requests can have session/activity effects, so inventory those separately. Do not open a writable
test handle while the server is active. A normal candidate boot may add operational records;
enumerate allowed additions by key, field and cause, rather than ignoring whole tables.

### Comparison contract

Keep the old expectations outside the mounted venue and unavailable for writes by the candidate.
The comparator reads them as inputs and cannot call a capture/update-snapshot mode. Match entities
by their original stable IDs and recorded invoice/chain identity, never array position or a current
display name. Compare the complete declared set in both directions so a missing child, duplicate
row or unexpected extra is visible. Counts are supporting diagnostics only.

| Subject                           | Exact comparison                                                                                                                                                                                                                                                                                                                                                                                  |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Money, tax and quantities         | Raw typed storage values plus their declared scale and exact decimal strings; line/base/tax/gross/tender/change totals and VAT grouping. No binary floating-point tolerance or common “numeric” conversion. A raw 350 for 0.350 kg must not become money €3.50.                                                                                                                                   |
| Identity and relationships        | Taxpayer, node, SIF/allocation, series, next invoice number before any new sale, person/device/profile/menu/order/sale/payment IDs and full FK tuples. Run `foreign_key_check` and integrity checks on stopped copies too; an absent child can satisfy FK checks while still failing the fact comparison.                                                                                         |
| Names and time                    | Each staff/customer/kitchen translation and recorded snapshot; original recipient/issuer/address; timestamps including original textual spelling and stored offset, locale and operation date. Do not reformat yesterday's facts using today's time zone.                                                                                                                                         |
| Fiscal and event history          | Every original registro field as typed bytes, including original monetary text, payload text/BLOBs where present, predecessor pointers, sequence, SIF/software data, environment and stored huella; workforce hashes/predecessors and order events. Compare the raw representation as well as decoded facts. A newly serialized payload or freshly recomputed hash is not the old expected value. |
| Pending work and disabled modules | Original outbox/order state, due times, attempts, selections and links; preserved disabled configuration and any retained rows/schema at their original version. Never enable all modules to simplify the test. For the default no-filing fixture, expect no submission attempt or fiscal queue advancement.                                                                                      |

For example, a captured issue instant `2026-11-04T12:15:00.000Z` with stored offset `60` must keep
both values after upgrade, rather than retain only a similarly displayed date. These are example
values; capture records the old image's actual instant without rewriting it.

Use supported existing fiscal validation interfaces only as additional diagnostics on another
disposable copy; they cannot generate expectations or replace byte preservation. Evaluate their
side effects before calling them. Keep `computeHuella`, chain/invoice allocation code,
`registros_facturacion` writers, alta builders, `registerSif`, `restoreFiscal`, golden huella tests
and `inmutabilidad` unchanged. No rewrite of a fiscal value is an acceptable mapping in this test.
The later build must run the protected suites unedited under the repository's normal gates.

Schema equality is not “same number of tables”. Compare the actual old and resulting schemas with
the candidate's packaged migrations and runtime declarations: columns/types/defaults/nullability,
PK/unique/index expressions and predicates, CHECK bodies, FK columns/actions, views and full
trigger bodies/targets. Account for engine metadata separately. Compare tokenized SQL only for
irrelevant whitespace outside quoted content; retain raw SQL too. Same-name changed definitions
must remain visible. Candidate protection expectations come from its declarations, not from a
fresh database silently declared authoritative.

An intentional release schema change needs a small reviewed mapping, separate from frozen
expectations: exact source epoch/release range, migration/module, old and new object/field, reason,
transformation, exact expected result and approving receipt. For example, a new nullable catalogue
field can be expected as `null` on each old product while every existing product value stays exact.
A renamed table must map its original keys and rows, not disappear from the comparison. Disabled
modules that boot does not migrate retain their old schema expectation. Any later re-enable is a
separate scenario with its own expected changes. No wildcard table exclusions, count-only match,
mass snapshot refresh or generic “all local state may change” rule is allowed. A new unexplained
delta fails and needs review; it does not authorize a migration repair here.

### Preservation and a new sale are two results

First compare the stopped candidate's upgraded state, before a new business action. Then make a
second disposable copy of that preserved result and boot it for a normal new sale. Keep the same
captured preproduction node/SIF identity and chain. There is no restore or identity allocation
between these steps, and the copy can reach no external service.

For the example, the old cheese line stays €7.70 while a new 0.350 kg line at €24.00/kg is €8.40.
The new invoice takes the captured next number and the new fiscal record extends the captured
head; all old bytes remain exact. Freeze the new-sale inputs and expected business calculation
independently of its response; generated new IDs/time may be checked against explicit bounds and
relationships. Do not derive the expected total from the candidate's returned total. A successful
new sale cannot compensate for failed preservation, and preservation alone does not prove the
upgraded product can sell. Never promote either test copy to production.

## Focus the gate and bound every failure

Fixture qualification is a separate release activity: old-image journey, clean capture, independent
expectation review, containment checks and R1-to-R1 control. Candidate CI downloads those sealed
inputs; it does not recreate history. Build the candidate image once as a separately bounded job
and pass its exact digest to matrix cells. An image fetch/build failure is reported separately from
a data-preservation failure, with no source-mode fallback.

Proposed initial matrix, subject to the later owner choice: oldest supported post-squash fixture
and immediately previous retained release, each with the required Veri*Factu scenario; include
the deliberate optional-module-off variant. Deduplicate identical baselines. Add fiscal-none
when that composition has its own declared upgrade support; it cannot stand in for the fiscal
chain case. A release gate runs every declared supported cell. PRs select the affected module's
fixtures and dependents; entry/store/migration/composition/image changes select the whole small
matrix. A docs-only change does not need an image run. Keep ordinary per-package coverage and
synthetic/schema guards; do not replace them with this gate or add a whole-workspace test run.

Proposed per-cell bounds are planning limits, **not measured timings**: artifact fetch 30 s;
admission/copy 20 s; first boot 90 s; reads/stop/preservation comparison 40 s; second-copy boot
and sale 40 s; cleanup reserve 20 s, with a 240 s outer deadline covering the cell. Every request
has a 5 s bound and every phase records progress. Fit the sum, including shutdown, inside the
outer bound. If measurements exceed the roughly four-minute CI job goal, split preservation and
new-sale jobs using a hashed intermediate artifact; never shorten coverage, skip a fixture or
silently raise timeouts. Artifact/image prefetch jobs also need explicit deadlines and bounded
retries. The longer old-fixture authoring journey has a proposed 10-minute overall bound, separate
from candidate jobs; a stalled capture needs investigation, not a partially accepted artifact.

Allocate all needed ports together before binding (current helper read: **UNVERIFIED at runtime**,
`apps/server/src/testing/free-ports.ts:23`), or use isolated namespace-internal fixed ports with
no host publication. Track each process/container by owned ID and start identity, phase and root
directory. Outer supervision must still operate if the application's event loop blocks. On timeout,
retain bounded logs and the phase/process snapshot, gracefully stop only owned descendants, then
force only those still owned/alive; a forced stop invalidates capture. Cleanup is idempotent and
removes only recorded owned scratch resources. Never kill by program name or prune shared volumes.
Report any cleanup failure and remaining owned IDs as failure, even when data comparison passed.

Retain the candidate SHA/digest, fixture/expectation hashes, mapping version, tested matrix cells,
phase durations, actual assertion counts and exact field differences. Example proposed failure:
`R1 → C: sale <original-id>, line <original-id>, quantity: expected 350 thousandths; got 35`.
Do not print secret contents or whole state archives into ordinary CI logs. Success must name
nonzero compared sales, fiscal records, people, menus and history and explicitly list missing
coverage; “booted” alone is insufficient.

## Acceptance and bounded future build slices

These describe separately reviewable outcomes, not an implementation plan or authorization.

| Future slice                         | Acceptance boundary                                                                                                                                                                                                                                                                                                                                                                                    |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Historical capture and custody       | One eligible post-squash immutable image completes the declared product journeys; clean stopped whole-state capture, fixed test identity/material, historical trigger inventory, transcript and independently reviewed expected facts are sealed and retrievable by checksum. No current writers or domain seed SQL supplied the history. Missing required issued-F1 coverage remains explicitly open. |
| Candidate preservation               | Real image entry/boot including `assertNotAhead` upgrades a fresh copy with pending migration work; exact semantic/byte/schema comparisons and reviewed mappings pass; another normal restart preserves them. No reset, restore, new identity, journal editing or changed synthetic guard is involved.                                                                                                 |
| Continued operation                  | A second isolated copy makes the prescribed new sale through product routes with exact independently specified amounts and next-number/chain relationships; old records remain byte-exact. This result is reported separately from preservation.                                                                                                                                                       |
| Failure evidence and CI availability | Required matrix selection and untrusted-code permissions are explicit; damaged/missing artifacts, timeout, unsafe network/configuration and cleanup failures stop the job within its bounds. Repeat from pinned inputs in a clean rig produces the same preservation judgment.                                                                                                                         |

Before accepting the harness, future controls must distinguish failure from success: an unchanged
old-image copy passes; a non-fiscal child deletion or changed catalogue value in a dedicated damaged
copy fails by its original ID even with equal aggregate counts; a same-name altered protection
definition fails; an archive-byte corruption fails checksum admission; wrong image/epoch and a
contended folder fail specifically. These damaged controls never become product-provenance
fixtures and never edit protected fiscal source, rows or golden assertions. Removing the relevant
comparison in a disposable harness checkout must make its negative control fail to detect the
damage. Retain that receipt alongside an accepting control, not just “a test exists”.

## Later owner choices and unresolved implementation boundaries

Ask these only after the first question is answered. Every recommendation here is unapproved.

1. **Baseline lifetime and matrix:** retain the oldest supported post-squash release and the
   previous release as required gates, or retain every release as a required gate? Recommend the
   small named support window initially, keeping all frozen artifacts. Two fixture releases give
   bounded jobs; every release costs more matrix cells and needs explicit support/retirement rules.
2. **Artifact destination/access:** dedicated immutable release artifacts with a committed checksum
   index, or small bundles committed directly in git? Recommend the former, provided ordinary CI
   can fetch safely with no credentials exposed to untrusted candidate code. Git simplifies
   availability but grows every clone and still exposes public test keys. Neither store is selected.
3. **Issued-recipient coverage:** keep an issued F1 as a mandatory additional capture before A799
   closes, or approve recipient coverage on an unpaid F1-choice order plus ordinary issued F2
   invoices until public F1 is enabled? Recommend keeping issued F1 as an explicit completion
   dependency if it is required. The narrower alternative is useful but does not test preservation
   of an issued recipient snapshot, and requires the owner's explicit scope decision.
4. **Capture determinism/time:** approve fixed supported external test identity/key inputs with
   frozen product-generated IDs/time, or require fully repeatable initial IDs/time through a
   separately evaluated isolated runtime? Recommend the former. The latter needs a demonstrated
   old-image-compatible mechanism; changing the old source or broad compatibility is excluded.

At implementation, evaluate the selected old image's setup/identity interfaces, route versions,
runtime/architecture availability, optional-module toggle and clock behavior. This source read
cannot settle them. A missing post-squash image, unavailable digest or absent safe identity seam
blocks capture rather than authorizing a substitute. Proposed numerical budgets must be measured.

Lane E's A679 boot/identity work, lane G's A773-1 order consumers and Lane A's A795 certificate
work remain reserved. The paths above name eventual seams, not permission to edit them. The future
builder must obtain their release through the parent and re-trace the final source. A795's
certificate install/query flow is not part of this test. Parent owns review, rendered review
boards, backlog updates and publication; this proposal preserves existing docs/specs and creates
no implementation plan.
