# A696: validate the saved venue zone before admitting trading

> **Owner approval and planning update, 2026-10-21:** the owner approved the
> [startup design](2026-10-20-a696-startup-zone-validation-design.md), including the minimal
> A166 country-zone list and creation/import checks first, and authorised its plan and build
> (lane E questions, “OWNER ANSWER — A696”, approximately 02:25). Follow the
> [implementation plan](../plans/2026-10-21-a696-startup-zone-validation.md). Earlier approval
> statements below record their dates; the product remains unbuilt. The production fiscal PR
> must finish green and wait for the owner to land it.

**Status, 2026-10-20: requirements-reviewed redesign, unbuilt.** The owner approved the saved-zone
behavior and the startup redesign direction, not this full design, its implementation plan or
the separate FULL fiscal build. The fresh-context requirements review returned “nothing important
left”; it was a read-only builder check, not runtime verification. Full-design approval, the
implementation plan and build authorization remain next.

This supersedes the recovery mechanisms in the [15 October audit](2026-10-15-a696-invoice-time-zone-design.md)
and [guided repair proposal](2026-10-15-a696-guided-zone-repair-design.md). Their bodies remain
historical. Owner direction: `~/waitron-campaign-e/questions.md`, **OWNER 2026-10-15 ~22:25**.
Current source references below were inspected at
`8f37d82ce9a34473ef3b788eb701a4584977d03e`; runtime behavior is **unverified**.
No product tests, server or image ran for this redesign. The audit's sourced
legal evidence and measured results retain their historical scope; no new legal claim is made here.

## 1. The owner contract

Check the saved venue zone at startup and at **every application writer**. While it is missing
or invalid, record no new sale, payment or invoice and ask no reader to collect money. Tills
receive a localized domain refusal before an economic action starts. A manager or administrator
signs in to confirm a zone using existing `venue.configure`; no new permission or table is needed.

Only a missing or invalid saved value permits this confirmation. A supported named zone, including
an alias, remains valid even when geography suggests another. Valid-to-valid changes retain every
ordinary settings lock. A formatter failure, invalid instant, missing node/location/table/column
or unreadable database never grants repair authority. Do not infer a zone from the process or browser.

Every new issue date and generation offset uses the writing location's saved zone at issuance,
including daylight saving time (DST). Ordinary receipts and till displays use the recorded offset.
Preserve old dates, offsets, captures, numbers, hashes, predecessor references and all other saved
facts. A444's operation/service-date decision stays separate. There is no A696 post-capture
failure screen, “Resume recorded payment” action, historical recalculation project or outage state.

## 2. Establish trading readiness before routes or workers can act

**Proposal: a small in-memory admission state, initially unchecked, with repair-only serving
for a bad saved value.** Admission means permission to start economic work, not process liveness.
Use the following lifecycle on every startup, including restored databases and promotion restarts:

1. Keep existing entry and boot checks: restore/reset ordering, ahead-of-image refusal, migration,
   deployment identity, append-only integrity, operational venue, keys, fiscal slot and membership.
   Resolve the configured node's location from stored rows and require agreement with configuration.
   Retain adoption-pending behavior, primary eligibility, mirror restrictions and fencing.
2. Before starting any trading duty or binding an unrestricted listener, read the raw zone and
   classify it. Validate a named zone separately from converting a finite instant. Resolve a test
   reading using the actual runtime, then check the retained business-day clock and schedule rules.
   Do not call the whole Venue details model just to classify the zone.
3. A usable zone and usable clock allow normal initialization. Publish readiness only after the
   existing required boot checks finish. A valid zone alone cannot override another refusal.
4. A missing/invalid zone with readable identity and authentication structure enters **zone repair
   only**. Mount the dashboard assets and the narrow authentication/confirmation surfaces below.
   The process can answer liveness, but reports trading unavailable and never advertises
   `acceptingSales: true`. It starts no issuance, capture, settlement or refund worker.
5. Structural failures use the existing fatal-start unwind and unauthenticated diagnostic recovery
   surface. Conversion/instant/cutover/schedule faults are separate blockers, never zone eligibility;
   if detected with an otherwise valid zone at admission, fail startup with their own bounded code.
   Do not catch arbitrary boot errors and turn them into zone repair.
6. After confirmation commits, answer success and request an orderly restart after the response.
   Until restart, keep admission closed. Reuse normal boot on restart; only its successful checks
   admit trading and start duties. A failed restart retains the committed repair and its own fault.
   A lost response is resolved by reading status; a valid saved zone needs no second confirmation.

Current source starts duties before and after the listener, so a check immediately before
`listen` is insufficient: attendance/email duties begin at `apps/server/src/boot.ts:1706`,
the listener at `:2466`, and automatic card/bill completion at `:2558`. Move the admission decision
ahead of the first dependent duty. Register every newly started duty's undo immediately, following
the existing failed-start contract. `boot.ts:933` checks append-only integrity; `:1399` checks the
operational venue; `:1405` reads deployment axes; `:1441` handles fencing; `:1601` resolves fiscal
identity. `apps/server/src/node-entry.ts:362`, `:391`, `:397` show restore, ahead check and boot order.

Use one shared admission check for HTTP mutations **and direct orchestration callers**. At each
economic transaction, require admission before new writes; before external collection, require it
in the preparation transaction. Include payment/collection/refund routes, management resolutions,
unpaid departure, cancellation credits, and edits/save/split/adjustment that can auto-issue a bill.
Gate automatic whole-order recovery, pending bill completion and tender-refund recovery per pass
and again at their write boundary (`boot.ts:2573`, `:2589`, `:2612`). No worker may finalize before
the first check. Existing primary/role predicates remain additional requirements.

Proposed refusal: `venue.time_zone_not_ready`, HTTP 409 on till/management economic actions,
with only a fixed reason (`unchecked`, `missing`, `invalid` or `restart_required`). Register it
in the neutral error registry and EN/ES boundary maps. Show the manager-confirmation direction
for missing/invalid, and waiting/reloading wording for unchecked/restart; never show a payment
success. Separate conversion/instant/structure errors retain their own codes and cannot offer repair.

In repair-only mode, refuse other application mutations by default, including direct callers that
could create payment facts. The hosted webhook currently records payments without issuing a sale
(`apps/server/src/webhook.ts:56`); it receives no A696 bypass. Do not acknowledge a new settlement
as saved while admission is closed: return a retryable refusal, retain existing stored evidence,
and exercise redelivery in acceptance. This adds no collection/refund or capture-failure workflow.
Already received external money is not evidence of a newly admitted sale. Provider redelivery
behavior remains to be qualified; do not claim this prevents money moving outside Waitron.

Authenticated saved replay, historical reads, reprints and outbox reconstruction must not acquire
a new issue clock. They retain their facts. A repair-only implementation may serve these only
where it can do so without clock-dependent initialization or new economic writes; otherwise it
defers access until restart. It must never reinterpret a replay as a new payment.

## 3. Keep manager login and confirmation reachable

**Proposal:** retain `/manage`, the existing login methods, their authentication dependencies,
session read/logout, language resources and a small authenticated zone-status/confirmation page.
Keep public status minimal. After login, display the legal venue identity and:
“The venue's saved time zone is missing or invalid. Trading is stopped. Ask a manager to confirm it.”
Only `venue.configure` exposes the action; others see the explanation and can log out.

Do not require ordinary Venue details, reporting, alerts or navigation's clock-dependent loaders
to succeed first. Read identity, raw zone, baseline/dated cutovers and revision directly for this
page. Existing password login uses identity/passkey-offer reads (`management-api.ts:883`);
the shell reads locale/venue identity and session (`me-api.ts:291`, `:308`). Reuse these authentication
contracts, including MFA and explicit passkey actions, through a route allowlist rather than
exempting all `/management-api/*`. Normal details calls `readBusinessDayClockModel`
(`venue-details.ts:100`), whose conversion can yield a null current day
(`business-day-start.ts:89`). Do not rely on that model or preview as the recovery entry point.

Offer the country's zone choices with its geography suggestion visibly explained, never silently
saved or preconfirmed. Show candidate local date/time, numerical offset, business date and retained
day changeover. Require “I confirm that this is the correct time zone for this venue.”
Use shared field primitives, semantic `timeZone`, required markers, `draftScopeFor`,
`saveActionState`, field messages and one bottom message. Save begins quiet and disabled until
edited; request refusals alone do not disable retry. After commit, clear the saved draft and show
restart/readiness status; a failed refresh is a load failure. Provide English/Spanish guides and
wording, both themes, keyboard access and phone layout under the existing Forms contract.

**Proposed API:** authenticated `GET /management-api/venue-details/time-zone-repair` for raw context
and candidate preview; `POST` on that path accepts exactly `timeZone`, `expectedClockRevision`
(a nonnegative safe integer) and `confirmed: true`. No target id, cutover, payment, amount, invoice
date or force flag is accepted. Require JSON, the configured management Origin, the existing
management cookie and live `authorizeManager(..., permission: "venue.configure")` on both paths.
Managers/admins hold it (`packages/identity/src/permissions.ts:61`, `:81`); never gate by role text.
Keep the mirror/fenced write gate (`boot.ts:1506`) outside this exception. No elevation or new login.

Inside **one `withTransaction`**, reauthorize, resolve node/location, read raw zone/revision,
recheck eligibility and expected revision, validate the candidate and the complete retained clock,
then update only the zone, bump `location_business_day_settings.revision` once and insert one
immediately handled incident. Await queries in order. Commit all three changes together or none.
Competing/stale confirmations refuse and refresh. A retry after success sees a valid zone and
creates no second event. The revision's absent-row convention is zero (`business-day-start.ts:86`).

Use proposed `venue.time_zone_repaired` with actor, server time, node/location, old-value category
and fingerprint, canonical new zone and before/after revision. Set `acknowledgedAt`/`By` on insert;
the existing open-only incident uniqueness then does not collapse distinct successful repairs
(`packages/db/src/schema/incidents.ts:40`, `:64`). Register its area and EN/ES wording. Never log
raw invalid text, secrets or request bodies. The fingerprint is unrelated to fiscal hashes.

Preserve `locations.day_cutover` and **every** dated cutover, including pending changes. Validate
shapes, ordered dates, increasing day boundaries around retained transitions and existing service
period end-offset checks against the candidate. Malformed or incompatible schedules block Save
with their own reason; do not delete them or invent an old usable clock. Refresh clock-dependent
drafts after revision change. This grants no new historical report recalculation authority.

## 4. Validate every saved-zone writer, including callers without HTTP

The following inventory follows values to their writes. All observations are **source inspection,
unverified at runtime**. File names in this table are repository-relative; line numbers describe
the inspected head. Test fixtures are not operator pathways.

| Path and actual write                                                                                                                                                                                                                                                                                                                                                              | Required check in the later build                                                                                                                                                                                                 |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Web setup derives the zone at `apps/setup/src/screens/venue-screen.ts:646`; server checks province-derived equality at `apps/server/src/setup-api.ts:446` and returns it at `:482`. `apps/server/src/provision.ts:120`, `:173` plan/apply; the actual insert is `packages/provisioning/src/venue-apply.ts:289`, zone at `:300`.                                                    | Keep geographic checks; validate runtime-supported named zone before readiness/provisioning and at the shared insert.                                                                                                             |
| Exported `planVenue` copies request zone at `packages/provisioning/src/venue-plan.ts:193`; exported `applyVenue` consumes create-location actions at `venue-apply.ts:230`, `:300`. Existing-location reuse converts the saved clock at `:268`.                                                                                                                                     | Validate planner input and every create-location action independently before reuse/conversion or writes. A caller constructing its own action list must not bypass validation.                                                    |
| CLI takes zone at `packages/provisioning/src/cli.ts:230`, puts it in request at `:271`, plans at `:303` and applies at `:471`. Owned first setup separately calls plan/apply at `packages/provisioning/src/first-setup-command-deployment.ts:321`.                                                                                                                                 | Both paths use the same planner/apply checks; browser parsing is no protection for these callers.                                                                                                                                 |
| Configuration artifact decoding checks the zone's string type at `packages/provisioning/src/configuration-transfer.ts:524`; validation at `:591` passes it to module validators at `:608`. Staging invokes validation at `apps/server/src/boot.ts:1163`; web import runs after provisioning at `:1260`; command import at `first-setup-command-deployment.ts:329`.                 | Validate the artifact zone when staging, again when applying, and validate the final provision request that actually reaches `venue-apply.ts:300`. Do not assume the artifact and selected request have identical geography/zone. |
| `importConfigurationTables` inserts declared configuration rows at `packages/provisioning/src/configuration-transfer.ts:756`. Its final `applyPreparedLocation` call at `:769` writes **only** bump mode, fire control and catalogue at `:163`. Core's table list is `packages/db/src/configuration-transfer.ts:24`.                                                               | This is not a second zone assignment. Keep location/history tables outside the allowlist; direct import callers still validate bundle clock metadata. Do not add a hidden zone overwrite to the final update.                     |
| Normal settings PATCH at `apps/server/src/location-settings-api.ts:235` calls `writeVenueDetails`. Named-zone/numeric checks are `apps/server/src/venue-details.ts:197`, `:204`; history locks `:242`; actual dynamic location update `:260`.                                                                                                                                      | Retain all locks and schedule checks. Use shared validation inside this exported writer, including direct callers. Advance clock revision on a real zone change and refresh admitted configuration only after commit.             |
| Development provisioning uses `apps/server/scripts/dev-setup.ts:203`, zone `:218`. CLI demo provisioning uses `apps/server/scripts/demo-seed/testing/provision-venue.ts:68`, zone `:84`; its helper delegates to `applyVenue` at `packages/provisioning/test/allocated-venue.ts:13`. Installed Demo seeds an already provisioned venue (`apps/server/src/demo-seed.ts:17`, `:26`). | Validate through the shared write and validate the saved zone before seed issuance; the historical fixture helper is not a repair bypass.                                                                                         |
| Four scripts insert a location **without an explicit zone**: `apps/server/scripts/daily-close-demo.ts:88`, `daily-close-z-demo.ts:97`, `modelo-303-demo.ts:256`, `allergens-demo.ts:39`. The column default is `packages/db/src/schema/tenants.ts:82`.                                                                                                                             | Validate and explicitly supply the intended zone at each script insert; validate before any issuing work. An implicit database default is still a saved-zone writer. Do not change the schema/default or migration.               |
| Readiness provisions/reuses an isolated venue at `packages/provisioning/src/fiscal-readiness-runner.ts:36`, `:41`, `:48`, then issues at `:110`.                                                                                                                                                                                                                                   | Apply writer validation and admission to the isolated database too, including reused readiness data; do not use the live venue's admission as evidence.                                                                           |
| Archive restore places a whole database at `apps/server/src/restore.ts:496`, `:522`; bucket restore calls `writeValidated` at `apps/server/src/restore-stream.ts:350`. Startup consumes staged restore before boot (`node-entry.ts:362`).                                                                                                                                          | These copy existing zones, not individual assignments. Preserve the artifact; classify its saved zone before any post-restore trading or background finalization. Do not rewrite history or reject away the only repair entry.    |

No additional application assignment was found in the bounded `apps`, `packages`, `scripts`, `bench`
searches of zone names and location inserts/updates. That is source coverage, not a proof against
arbitrary SQL. Audit/manual database edits are outside the supported product pathways.

### Runtime validity and A166 are separate checks

Put reusable name validation/conversion in a neutral shared seam. Accept a nonblank string that
the executing runtime resolves to a named zone; normalize accepted input, reject numeric offsets,
and compute the offset at each finite instant. Keep name rejection distinct from conversion failure.
Never fall back to Madrid, UTC or the process. Cache formatters by zone if useful, never offsets.

[A166](../../backlog/setup.md#a-venues-time-zone-must-come-from-its-country-packs-list-a166-owner-2026-10-01)
also requires creation/provisioning choices to come from the country pack. The current country
contract has a default and per-area zones (`packages/country/src/country.ts:28`, `:115`), not an
explicit allowed list. Spain supplies Madrid/Canary (`packages/country-es/src/spain.ts:271`),
Britain London (`packages/country-gb/src/united-kingdom.ts:10`).

**Driver sequencing choice proposed for full-design approval:** include A166's minimal explicit
country-zone list and shared creation/import validation as a prerequisite slice in the A696 plan.
Use the same list for confirmation choices; require runtime support as well. The wider A166
backlog entry stays open until its own remaining acceptance is met.
Keep Spain's province derivation and unsupported territory restriction. Do not silently replace
A166 with free-text worldwide selection. A currently supported saved zone outside that list is
not invalid and cannot unlock confirmation; any change still goes through normal settings locks.
This proposal does not retrofit country policy into historical data or enable Canary taxation.

## 5. New issuance and concurrent valid settings changes

Prepare the zone asynchronously from the writing node/location **inside the issuance transaction**,
then freeze one copied instant/offset reading before VAT rating. Pass it through existing clock
inputs for sale, correction and substitution. For void, construct the existing backend with a
prepared clock after the caller adapter resolves the original record's writing node from saved
facts: `packages/fiscal-verifactu/src/backend.ts:327` reads that node and `:343` uses the injected
clock. Direct core/backend/CLI callers must validate their own database/location and prepare their
reading in their caller transaction; they do not inherit a live server's in-memory admission.
Raw record builders retain their explicit-input contract.
Do not change protected fiscal writers, hash algorithms, numbering, allocation, chains or history.
If a required path cannot use existing inputs, stop that dependency for driver/owner approval.

The smallest consistency mechanism is the existing serialized transaction plus settings locks.
For an immediate local sale, settings either commits first and issuance reads its zone, or the
sale/order commits first and settings refuses. For reader collection, validate in preparation:
whole-order payment creates an order at `apps/server/src/till-sale.ts:1223`, commits preparation
at `:1297`, then collects at `:1325`. Bill payment starts against an existing order at
`apps/server/src/bill-payments.ts:1342`, then collects at `:1368`. Settings refuses any order
history (`venue-details.ts:95`, `:250`). Keep that lock through pending, captured and settled states.
Re-read the zone in finalization; compute its offset at the **new issuance instant**, not capture
time. No database transaction or new global mutex spans an external provider call.

Source inspection found no supported valid-to-invalid live writer after applying the checks above.
Settings already refuses invalid names, provisioning/imports create a venue rather than editing a
trading zone, and restore replaces files before startup. Thus retain **no mid-payment zone repair**.
This reasoning requires future race tests; it is not a runtime impossibility proof. A new supported
writer that can invalidate admission must return with exact evidence and the smallest required
recovery design, not silently revive the superseded UI. DST changes an offset, not name validity.

Settled replay returns its saved result before acquiring an issue reading (`till-sale.ts:1685`).
Existing captured recovery keeps provider settlement facts (`:1713`, `:1744`) and issues at its
existing finalization point (`:1693`). Bill tenders keep receipt times separately from issuance
(`bill-payments.ts:685`, `:698`). No new payment recovery authority or financial adjustment is granted.

## 6. Keep the complete audit scope and neighboring stops

The audit's complete issuance inventory remains mandatory: walk-up cash/manual card; held, placed
and zero-due orders; integrated/accepted-offline capture and existing recovery; deferred invoices
and later settlement; table/bill payment, worker/retry/attestation completion; save, line edit, split
and adjustment auto-issue; unpaid departure; cancellation R5 and generic correction; core F1/F3;
fiscal void; emergency identities/series; isolated readiness; installed/CLI seeds; live-clock sales
CLIs and fixed reporting demos. No absent public F1/F3/void route is enabled by this design.

Close the ordinary F2 presentation gap independently of recipient blocks: pass the saved offset
to thermal receipts, till/browser tickets and reprints; retain A4/F1 consistency. Preserve replay,
QR dates, old references, resend/restart, reconciliation, filing-case, export and archive/bucket
restore facts exactly as the audit requires. Use the offset at each backdated seed instant.
Keep UTC instant storage. Do not use reporting day changeover as the invoice date boundary.

[A798 §4.8](2026-10-19-a798-degraded-trading-design.md#48-a-clock-behind-the-last-sale-payments-stop-question-3-pictures-8-and-9)
compares UTC instants with the latest saved fiscal generation time across chains; it can stop a
valid-zone venue. Its minimum-date, clock-behind and evidence-based restart rules remain separate.
Confirming a zone never changes the system clock, clears that stop or grants `system.manage`.
A798's hosted-webhook exception concerns its clock stop; it does not override A696's startup gate.
Retain all other boot/trading refusals and permissions. This redesign adds no clock restart policy.

## 7. Future failing-first acceptance, not results

For the approved build, first add focused behavioral cases, observe the expected failure, then
implement the smallest change. Run issuance cases in separate UTC and Madrid processes, asserting
the same saved date, instant, offset and generation literal. Keep protected golden huella and
`inmutabilidad` checks unedited. Required future observations include:

| Case                                                              | Required result                                                                                                                                                                                                                                                                            |
| ----------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Bad-zone fresh/restored boot, delayed validation                  | Manager login/confirmation works without Venue details; trading reports unavailable; every HTTP/direct/worker capture or issuance path writes nothing and calls no collect/refund before admission. Valid-zone control admits normally.                                                    |
| Every writer above, including direct actions/imports and defaults | Missing, blank, unsupported and numeric input refuses before its zone write; runtime-valid alias succeeds subject to country policy; replay/reuse never repairs implicitly. Delete each writer check separately to show its focused case fails.                                            |
| Confirmation and transaction failures                             | Staff/supervisor, expired/revoked/suspended sessions, foreign Origin, forged fields, stale revision and valid saved zone refuse. Exactly one handled incident/revision change; failed audit insert rolls all changes back. Concurrent/lost-response retries do not overwrite or duplicate. |
| Error classification and retained clock                           | Offset failure, invalid instant, missing structure and malformed cutovers never authorize repair. Baseline/past/future cutovers, schedules and all historical financial/fiscal rows compare unchanged. Save plus failed restart remains gated for the actual remaining fault.              |
| Runtime settings and provider wait                                | Eligible valid-to-valid edit affects next issuance without restart; order/sale/close/cutover locks persist. Hold capture open and attempt settings change, then finalize: no invalidation, stale zone/offset, second charge or changed capture facts.                                      |
| Midnight, noon and DST                                            | Madrid `2026-10-14T23:30Z`: 15 October, +120, `2026-10-15T01:30:00+02:00`; noon is the same-day control. `22:30Z` is Madrid 00:30. Canary winter/summer and Madrid spring jump/autumn repeated hour use each instant's offset, in both process zones.                                      |
| All issuance/preservation families in §6                          | Real reachable boundaries and labeled core-only capabilities; one issue reading for VAT/date; old identity dates and hash inputs unchanged on void/correction/F3, replay, reprint, resend and restore. Historical facts remain readable without a current-zone conversion.                 |
| Repair-only UI and worker lifecycle                               | EN/ES, themes, phone/desktop, keyboard, unsaved edits and success/load failure; webhook redelivery retains existing evidence without false success. No worker starts early; shutdown completes before store close.                                                                         |

Delete the admission guard, then a worker's boundary check, and show each corresponding negative
control fails for the expected write/provider call; retain the valid trading and saved replay
controls to catch over-refusal. Test simultaneous A696/A798 stops: fixing either leaves the other.
Full-design approval, the implementation plan and FULL fiscal build authorization remain outstanding.
