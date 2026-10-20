# A773-2: Firing and the pass Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Work inline; this plan authorises no immediate execution. Implementation requires a later RUNNER firing.

**Goal:** Let the waiter request cooking, let each pass release only its visible station/zone work, and keep ready food visible until service ends.

**Architecture:** Keep party-wide groups and A773-1's bill ownership. Add a waiter-request timestamp to each kitchen item, separate from its actual station release. Use the existing service-command replay store and print outbox for atomic pass release; derive readiness across every active station part before narrowing a board's display.

**Tech Stack:** TypeScript, SQLite/Drizzle, Hono, Lit, Vitest with real Chromium, existing print jobs.

**Spec:** Read the whole [A773 design](../specs/2026-10-16-a773-courses-and-groups-design.md), implementing §§5–10, 12–13. Its [ownership amendment](../specs/2026-10-17-a773-one-editor-design.md) governs affected writes. Preserve the landed [A773-1 plan](2026-10-16-a773-1-unsent-list.md), including its 2026-10-19 cancellation amendment. Text overrides pictures.

## Dated authority amendment, 2026-10-19

Q42 was completed on **2026-10-18 ~22:55**, approved with the owner's changes. Authority: the completed owner answer in `~/waitron-campaign-c/questions.md:3614–3640` (section “OWNER ANSWER to Q42 … COMPLETE”) and the explicit Lane G handoff in `~/waitron-campaign-g/questions.md:1319–1320`, both dated 2026-10-18. These local receipts stay outside the repository; the product requirements are recorded here. Its partial-answer preamble is historical; the completed answer governs. The owner says **“same language everywhere”**, **“In progress”**, and **“column ORDER is set in the screen's settings, not on the live screen”**. These completed owner amendments take precedence over the older checked-in A797 design and status.

The pass has **Held (optional) / To fire / In progress / Ready**, plus optional **Overview, OFF by default**. Station Coming up becomes **Held**, containing genuinely held and pass-requested work, the latter marked **Waiting for the pass**. Every column collapses by heading tap, retaining heading/count; corner **Columns** settings control show/hide and up/down order, persisted per device. No heading drag. Narrow tabs/list preserve the chosen order. Non-pass dishes are dimmed, station/state information only, configurable in both profile and device settings. Profile-true/device-null-inherits and Held-shown defaults below are **builder calls**, not owner approvals.

Before UI building, lane C must revise A797's design, redraw pictures and post the required FYI, including Drive. This existing prerequisite is not another product-approval question: **“Parts the notes settle may be built without waiting.”** A773-2 integrates its Held/requested/pass work into those revised layouts; A797 owns broad station cards/Overview aggregation, handheld navigation/short names and unrelated redesign. Reorient landed/current work and hand off any shared controller before editing; do not double-build it or edit A797's source spec here.

## Global Constraints

- This is a prospective plan, researched at `96f93c52d486c805307b2390a4cdaa766f6af0eb`, which includes A773-1 `c9ad7a634` and A737 refunds. The source receipts below are read-only findings; no product tests ran in this planning item.
- Before **each implementation slice**, re-read current main, the slice's actual callers and adjacent approved designs/plans. Compare landed work and current reservations with RUNNER. Another lane's active files/functions remain reserved; neither this file nor a dependency landing grants permission to edit them.
- Implement only after that reorientation and a later explicit firing. Use a registered feature worktree; never write another lane's checkout. Read `superpowers:test-driven-development` before future test/code changes. Each task needs an observed assertion failure, minimal implementation, observed pass and `git commit -s`.
- **“Only the waiter fires.”** Pass Fire releases an already requested item. Stations cannot request or release held work. **“A group reads ready only when every station's part of it is ready.”** Never infer whole-group readiness from a pass's visible subset.
- **“A pass's Fire releases the requested lines of that group that this pass sees.”** Both station and zone must match inside the write transaction. Null scope means every; an empty list means none. A no-zone order needs an every-zone pass.
- **“Away goes.”** **“The pass screen's Done mark goes.”** Payment does not clear ready food. Service cancellation removes the cancelled kitchen quantity; otherwise retain ready work until served, table clear, or counter collection/closure.
- Keep existing authentication, person permissions, device/profile actions and zones, source reservations, payment-in-flight checks and frozen paid-line fields. Serve/Undo and sent-group Fire remain shared; Recall, Void and station moves retain bill-editor checks. No automatic takeover.
- No live-venue mutation, compatibility/backfill, data migration, invoice, tax, numbering, refund amount, adjustment-policy or fiscal change. Schema releases require a pre-live reset, stated first in the PR; do not reset a real installation from this plan.
- Never edit fiscal golden data, `packages/fiscal-verifactu/src/write-path.e2e.test.ts` or `src/inmutabilidad.test.ts`. Run unchanged controls when required below. No A758 reason/reporting/refund redesign, A803 portions/fiscal receipts, A669 allergy work or automatic station-to-station firing.
- Use existing tokens, field primitives, save/leave protection, passive reads and EN/ES catalogues. Native enabled/checked state, keyboard operation and actual rendered widths matter. New Spanish copy requires owner approval, recorded below once.

## Review Focus

1. A cold pass sharing the hot pass's zone cannot release Grill, including through a forged mixed batch; the entire invalid batch rolls back (T6).
2. An older card survives Recall, move, Serve or scope narrowing in another transaction; pressing it must refuse rather than cook stale food or silently substitute new rows (T6, T8).
3. A parent dish and separately routed extra progress at different stations; one ready part never makes the whole dish/group ready, including on a narrowed pass or with non-pass rows hidden/collapsed (T5, T7a, T8).
4. Payment, partial serving and Undo must keep exactly the remaining ready quantity on screen; a completed release retry cannot print another fire ticket (T1, T6, T8).
5. A shared printer and several station screens observe the same release; output count follows configured outputs, not screen count, and the monitor has no cooking write path; remembered Columns settings never grant authority (T6, T7a, T7b, T7, T11).

---

## Ownership and historical differences

| Owner              | Exact boundary for this plan                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| ------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A773-1, landed     | Reuse placement, stable group display numbers, source-aware Recall, per-bill `BillEditExpected`, ownership/replay checks, paid-group Fire and Sent/New order. Do not rebuild these.                                                                                                                                                                                                                                                                                                                                        |
| A756               | Owns Courses page, department reminder, per-station timing, grouping/held/MOVED printing, bump mode and three-value Recall policy. See [A756 plan](2026-10-18-a756-kitchen-tab-split.md):87–98, 618–691 and `docs/backlog/kitchen.md:135`. A773-2 adds `waits_for_pass`, its editor/column/warning and removes Fire control. Consume A756 PR 6's print settings and PR 8's policy when landed; coordinate/release shared functions first. Never recreate Every station or department Fire control.                         |
| A797               | Q42 complete with changes; dated authority amendment above overrides its stale checked-in design. T7a/T7b/T7 integrate the pass columns, Held/requested distinction and settings after lane C's revision/redraw/FYI prerequisite. Reuse its released station card/Overview/controller work; handheld short names, broad station redesign and totals stay A797-owned. No new Q42 question.                                                                                                                                  |
| A803               | [Approved spec](../specs/2026-10-18-a803-bills-and-tables-design.md) §§3.2–3.3, 6 and [plan dependency tail](2026-10-19-a803-bills-and-tables.md):402–417 own portion ids, bill names, three station ticket modes and one cross-bill ticket per action/station. They wait for A773-2. Keep ids behind presentation, expose released item sets and group/course identity, and hand off T11's seams. Do not implement its portions, naming, receipt allocation, shared cross-bill ticket batching or new station modes here. |
| A758 / A737        | A773-1 plan:20–50 and A758 design §10 supersede old A773 §10's Finish Fire/Void choice. Current `finishPartyService` confirms and cancels **all unserved paid dishes**, then closes atomically (`finish-party-service.ts:96–188`). Extend that context to Requested; never restore the withdrawn Fire choice. Refund remains the landed public handoff, with no new money rules.                                                                                                                                           |
| A757 / A669 / A760 | Feed requested facts into existing floor reads; A757 owns the floor's visual state design. Preserve allergy fields/ticks without extending them. Coordinate schema/reset reservations with A760; this plan authorises neither its migration squash nor a home-box reset.                                                                                                                                                                                                                                                   |

### One Spanish copy review before future UI landing

The owner settled the English words **Held / To fire / In progress / Ready / Overview**, consistently across till, station and pass. Settled Spanish: Held / «En espera» (owner, 2026-10-20: «en espera» everywhere for held dishes). Proposed Spanish, not approved: To fire / «Por marchar»; In progress / «En curso»; Ready / reuse current «Listo»; Overview / «Resumen»; Waiting for the pass / «Esperando al pase»; Columns / «Columnas»; Show non-pass stations / «Mostrar estaciones que no esperan al pase»; Use profile setting / «Usar la configuración del perfil». Include up/down/show/hide wording in this same copy sheet; never introduce two Spanish words for the same meaning.

Also include Added / «Añadido», Next course / «Siguiente pase», Waits for the pass / «Espera al pase», Goes with kitchen food / «Sale con la comida de cocina», No service zone / «Sin zona de servicio». Proposed stale-card sentence: “The kitchen work changed. Refresh the pass and check before firing.” / «El pedido de cocina ha cambiado. Actualiza el pase y comprueba los platos antes de marcharlos.» Coverage: “No pass covers {stations} in {zone}. Food may wait for release.” / «Ningún pase cubre {stations} en {zone}. La comida puede quedar pendiente de cocinar.» This is one future UI-landing wording review, not a reopened Q42 layout decision or immediate execution authority.

## Baseline receipts and consumer audit

These are **read-only findings**, not runtime verification. Paths below are relative to `apps/server/src/` unless prefixed. In task file lists, server means `apps/server/src/`, till means `apps/till/src/`, db means `packages/db/src/`, and venue-service/dashboard means `packages/venue-service/src/dashboard/`. Re-run searches at pick-up, including tests, SQL and prose; this inventory is a starting set, not a permanent allowlist.

| Current seam           | Receipt and consequence                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| ---------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Kitchen state          | `packages/db/src/schema/ticket-items.ts:24,65` has queued/preparing/ready, with null `fired_at` meaning held and a unique item per working line at :82. `order-groups.ts:388` fires party groups across bills. New Requested must not be treated as unsent or as a second charge.                                                                                                                                                                                    |
| Immediate/held writers | `working-order.ts:1844,2008,2071,2128` chooses course release, stamps sent and prints inserted fired rows; `insertSplitExtras` at :1712 has independent routing. `releaseHeld` at :2339 and `sendLines` at :2437 update every matching null-fired item. Each needs held/requested separation.                                                                                                                                                                        |
| Serving and stopping   | `isReleased` at `working-order.ts:3338` and extra gate at :3292 currently require actual `firedAt`; serving Requested needs a separate initiation predicate. `ordersWithUnfiredDish` at :3357 feeds `unpaid-departure.ts:91`; `adjustments-apply.ts:305` also reads `isReleased`. Keep those existing financial gates unchanged. `order-groups.ts:1839,1858,2247` needs an explicit service/relocation choice.                                                       |
| Ownership/cancellation | `draft-recall.ts:207–289` checks editor, interim venue policy, started state, correction slips and source reservation. `line-cancel-context.ts:11,63` fingerprints component state and fired time; release changes can race without bill revision changes (:103). `finish-party-service.ts:142–166` compares exact dish/context sets.                                                                                                                                |
| Scope                  | `pass-board.ts:31–38` already intersects station and zone; :42 filters available slots. `device-levers.ts:95–128` uses only `assertPassScreenZone`; its venue implementation at `packages/venue-service/src/kitchen-screens.ts:940–960` checks zones, not stations. Do not reuse that boundary for release authority.                                                                                                                                                |
| Read/admission         | `device-api.ts:451–551` serves pass/monitor/station reads; `kitchenScreenOf` at :962 checks effective choice, availability and non-KDS sign-in. `till-api.ts:2195` also exposes the legacy expo read. Both paths need the same service lifetime and no monitor writes. `packages/layouts/src/device-types.ts:38–62` classifies `run-the-pass` as a screen flag, not a `ProfileAction`; `till-session.ts:92–123` distinguishes person permission from profile action. |
| Lifetime/Done          | `pass-board.ts:51–127` has per-device marks versus away-based monitor clearing; `markPassItems` at :131 writes marks. `working-order.ts:7678` only excludes abandoned/collected orders, not closed parties. Table clear therefore needs an explicit family/party lifetime check.                                                                                                                                                                                     |
| Readiness              | `order-groups.ts:1396–1412` counts only actual-fired rows, so newly requested parts must enter the denominator. `pass-board.ts:85` rolls readiness before filtering visible items, a useful ordering to preserve. `working-order.ts:7382,7687` are station and cross-station projections.                                                                                                                                                                            |
| Tickets                | `kitchen-print.ts:512–590,715` plans per-order tickets and enqueues supplied fired sets; station output routing starts at :457. `order-groups.ts:1902` prints advance HOLD. Preserve `.returning()`-driven sets (`working-order.ts:2072`) and actual print-job links.                                                                                                                                                                                                |
| Floor and counter      | `table-signals.ts:36–76` excludes null-fired items; `working-order.ts:8076` counts away as en-route. `fireLines` at :1967–2013 applies course ordering to non-party orders. `handOverOrder` at :6709–6782 supplies collection lifetime. Counter presentation needs no course/group sections.                                                                                                                                                                         |
| Settings               | `packages/db/src/schema/kitchen-stations.ts:15–29` lacks pass waiting; timing/MOVED inheritance is still present. `kitchen.ts:30,81,126,177` owns station contracts/writers; dashboard `routing-client.ts:24,56,75` reads them. Do not assume the waiting A756 settings PRs have landed.                                                                                                                                                                             |

Before changing any stamp or gate, run `rg -n 'firedAt|fired_at|awayAt|away_at|passItemMarks|pass_item_marks|fireControl|fire_control|fireHeldGroupsOfCourse|fireCourse' apps packages scripts docs`, then follow every result's callers. Assign every live result to these tasks:

- **Null fired stamp (T4–T9):** all writers above; `dish-kitchen.ts`, `station-move.ts`, `draft-recall.ts`, `line-cancel{,-context,-input}.ts`, `adjustments-apply.ts`, `kitchen-print.ts`, `kitchen-ticket.ts`, `table-signals.ts`, `rest-of-order.ts`, station deletion/output alerts, `department-transfer-api.ts`, working-order transfer/split/course-edit/collection and group/reminder reads. Include legacy `recallLines` (`working-order.ts:2566`, HTTP caller `till-api.ts:3959`, client :4197) and split-extra editing (`working-order.ts:5931`). Till consumers include client/cancel types, Sent model, table screen, basket, sent-orders, fired-ago, adjustment target and finish dialog. Preserve existing paid/fiscal callers' policy rather than globally replacing every null check.
- **Away (T1–T3, T12):** `working-order.ts:2679,3890,6891,7596,7672,8076`; `order-groups.ts:571,1401,1573`; `pass-board.ts`; `rest-of-order.ts:46`; `station-closing.ts:27`; `station-delete.ts:72`; `station-outputs-down.ts:269`; `station-move.ts:157`; `kitchen-print.ts:809`; `department-transfer-api.ts:257`. Remove `away`, `awayAt`, `enRoute` and raw `en_route` projections plus `table-details-sheet.ts:35–42`, client types, labels, styling and route consumers. Retain served/cancelled quantity checks instead.
- **Done (T1–T3, T12):** `pass-board.ts:131`, `pass-done-body.ts`, `device-api.ts:469`, `station-outputs-down.ts:250`, split copying at `working-order.ts:4610–4615`, db schema/barrel/classification and schema tests. Remove client `markDevicePassDone`, expo buttons/Undo and EN/ES `expo.done*`; unrelated Done buttons stay.
- **Fire control/course Fire (T2, T12):** tenants enum/field/CHECK, `kitchen.ts:259`, `management-api.ts:2045`, `till-setup.ts:29,89`, configuration-transfer read/write/validation, module/profile call chains, till setup/client/app/table/station/expo/queue props and strings. Remove `fireCourse`, `fireHeldGroupsOfCourse`, legacy course-fire routes and KDS group-fire routes; preserve waiter `fireGroup`/`fireHeldLine`. Search prose for Who fires, Away, En route, Done and Fire all now too.

## Contracts to implement

1. Add nullable `ticket_items.requested_at` and `pass_controlled:boolean` NOT NULL default false on the existing item table. Set `passControlled` when waiter initiation chooses pass release; preserve it through release/move. This per-item snapshot keeps outstanding requests pass-controlled after a station move/settings change; it adds no domain table. Keep `TicketState = queued | preparing | ready`; derive `KitchenPhase = held | requested | waiting | preparing | ready`. Held has both timestamps null; Requested has request time and null fired time; Waiting has both and queued state. Made-here remains immediately ready; no-preparation creates no item. `order_groups.state=fired` and its `firedAt` continue to mean **waiter initiation**, not completion of every pass release.
2. Add `kitchen_stations.waits_for_pass:boolean`, NOT NULL default **false**. It governs each independently routed component, not each output screen/printer. Resolve settings when the waiter requests cooking; persist the result in stamps. Builder default: changing settings affects later requests, never automatically releases or re-holds outstanding work. Moving Requested work preserves its pending pass-release obligation even to an immediate station; only pass release may turn an existing Requested row into Waiting. Moving actual-released work never re-holds it. Warn about uncovered outstanding requests even after a setting change or move.
3. Add `order_groups.request_kind: new_order | next_course | added`, default `new_order`, typed at its internal writers. Capture first-send versus addition before inserting the submission's groups; a held group or held-line Fire is `next_course`. Counter uses its order id and `new_order`, with no synthetic party/group. Retain immutable display numbers/course labels. No inference from mutable position or payment status. Groups are service records, not a new configuration import surface.
4. New `apps/server/src/kitchen-phase.ts`: export `kitchenPhase(item:{requestedAt:string|null;firedAt:string|null;state:TicketState}):KitchenPhase`. Use it for TS projections; make equivalent SQL predicates explicit at query sites. New `requestKitchenItems(tx:Transaction,cfg:OriginConfig,orderId:string,lineIds:readonly string[],routing:RoutingOnce,mark?:"FIRE"):Promise<FiredItem[]>` in `kitchen-release.ts` handles waiter initiation after routing. It returns only newly **actual-released** items; its caller enqueues those once in the same transaction.
5. New `PassTarget = {kind:"group";partyId:string;groupId:string} | {kind:"counter";orderId:string}`; `PassReleaseAsk = {submissionId:string;target:PassTarget;ticketItemIds:string[];expectedContext:string}`; `PassReleaseResult = {releasedTicketItemIds:string[]}`. Define `PassActor = {deviceId:string;personId:null} | {deviceId:string;personId:string;sessionId:string}`. New `releasePassItems(tx:Transaction,cfg:OriginConfig,by:PassActor,ask:PassReleaseAsk):Promise<PassReleaseResult>` in `pass-release.ts` re-reads effective pass/profile/zone authority, target membership, source reservations and active service rows. No trusted body scope or operator id.
6. Route `POST /api/device/pass-screen/release` accepts exactly that ask; client `releaseDevicePass(ask:PassReleaseAsk):Promise<PassReleaseResult>`. Reuse `requireDeviceProof`/`assertDeviceStillProven` inside the release transaction, effective pass admission and, for non-KDS, `requireSession` then `assertStillSignedIn`. Require profile action `prepare-orders` and an explicit fresh `capabilities.includes("run-the-pass")` check; the latter is not a valid `assertProfileAction` argument. Apply `assertSubjectZones` to each order as well as pass station/zone intersection. Legacy preparation verbs declare no person permission (`till-api.ts:1117–1140`); do not invent one or weaken any newly landed permission. Never require `take-orders` to release. Monitor/station-only devices refuse. Current authority precedes replay; matching completed replay precedes stale-work checks.
7. Fingerprint sorted ids, full target, `expectedContext`, device and acting person using `runServiceCommand` with its existing `{kind:"party",partyId}` or `{kind:"bill",workingOrderId}` scope. Reject empty/duplicate/non-UUID ids as `management.request_invalid` (`field:ticketItemIds`). Require the ids to equal **all currently visible Requested components of that card**, excluding served/cancelled/recalled work. Compare `expectedContext` to a SHA-256 digest over canonically ordered visible rows' ids, line/order/group, station/zone, request/release stamps, quantities, source reservation and routing facts. This detects a same-id move within one pass too; it grants no authority. Unknown, stale, extra or missing ids/context refuse `ticket.pass_context_changed` (409), registered in server errors and EN/ES fallback. Out-of-scope access uses existing device/screen refusals. No silent filtering or substitution.
8. Validate the entire batch before updates/print jobs. Reroute at waiter initiation as today. If routing becomes invalid before pass release, refuse the stale card with no writes; refresh and use the existing explicit station-choice/move flow. An outside-scope destination can never gain authority through a reroute. Two independent passes do not share an expected party-revision gate: each validates its exact current item set. Overlapping distinct commands have one winner; the loser refreshes. Completed matching retries keep their original answer.
9. In `pass-board.ts`, define `PassCard {key:string;target:PassTarget;kind:"held"|"new_order"|"next_course"|"added";requestedAt:string|null;allReady:boolean;items:PassCardItem[];releaseTicketItemIds:string[];releaseContext:string|null}`. Held cards have `kind:"held"`, null request time/context, no release ids and `allReady:false`. `PassCardItem` extends existing `ExpoItem` without `awayAt`, adding `lineId:string`, `orderId:string`, `stationId:string`, `phase:KitchenPhase`, `requestedAt:string|null`, `readyAt:string|null`, `visible:boolean`, `informational:boolean`, `passControlled:boolean`. `visible` remains station/zone authority, independent of presentation hiding. `PassBoard {held:PassCard[];toFire:PassCard[];inProgress:PassCard[];ready:PassCard[];overview:OverviewFact[]}`; `OverviewFact = Pick<PassCardItem,"lineId"|"stationId"|"name"|"qty"|"phase"|"informational">`. These component facts feed A797's Overview aggregator; do not build a second station totals algorithm. `readScopedPassBoard(tx:Transaction,cfg:TillConfig,scope:PassScope,display?:{showNonPassStations:boolean}):Promise<PassBoard>` defaults display true until T7a supplies effective policy. Keep headers/notes/names and use one canonical snapshot builder for release comparison.
10. Cards span one party group across bills or one counter order. Include genuinely held groups in `held`; initiated work goes to To fire while this pass has Requested items, otherwise In progress until every active station part is ready, then Ready. Never make empty/served cards ready. Compute whole-group readiness and candidate/context sets before display filtering. For genuinely held preview rows, classify non-pass information from the current destination setting; for initiated rows, use the frozen `passControlled` fact. Non-pass components are dimmed information, with station/state, and may be hidden by effective profile/device policy; hiding/collapsing them changes neither readiness nor release authority/context. An existing Requested item stays actionable pass-controlled work after any move, even to a station now configured immediate. Omit made-here and cancelled/recalled quantities; retain split extras and remaining unserved quantities. Sort To fire by request time/stable key; Held by firing order; ready age uses actual ready time (whole group: last active part), never payment time. Another pass's independent release cannot invalidate this pass's context.

11. Shared display policy stays in venue-service's existing `device_profile_kitchen_screens` and `device_kitchen_screens` rows (`schema/kitchen-screens.ts:26,116`). Add profile `show_non_pass_stations` NOT NULL default true and device nullable `show_non_pass_stations` default null, for pass/pass-monitor presentation. Builder proposal: `deviceOverride ?? profileDefault`; neither is a scope/permission bound. Extend `ProfileKitchenScreens` entry values with `showNonPassStations?:boolean`, `DeviceKitchenScreen` with `showNonPassStations?:boolean|null`, and `ResolvedKitchenScreen` with effective `showNonPassStations:boolean` plus `nonPassStationsOverride:boolean|null`. Missing write fields retain an existing value; a new profile/device choice starts true/null. Preserve them in read/copy/replace/narrowing, without classifying policy changes as lost station/zone access.
12. Reuse profile management POST/PUT `/management-api/device-profiles` (`management-api.ts:1364,1420`) and device admin PATCH `/management-api/devices/:id` (`device-api.ts:787,833`), existing parsers in `device.ts`, and module `setProfileKitchenScreens`/`setDeviceKitchenScreens` seats. Add `setDeviceKitchenScreenDisplay(tx:Transaction,cfg:{locationId:LocationId},deviceId:string,kind:"pass"|"pass_monitor",value:boolean|null):Promise<void>` to that venue-service seat/service export and implement it in `kitchen-screens.ts`; it updates only the override, never replaces scope/removal rows. New PUT `/api/device/kitchen-screen-display` accepts `{kind,showNonPassStations:boolean|null}` using proven-device/effective-screen admission and non-KDS session checks; no cooking action is required to change presentation. Pass/monitor reads return effective policy, override and `storageScope:{venueId:string;deviceId:string}` (server location id + proven device id). Admin configuration is shared server data; this device's Columns UI state is browser data.
13. Columns state: `ColumnKey = "overview"|"held"|"toFire"|"inProgress"|"ready"|"waiting"|"preparing"`; pass defaults order Overview/Held/To fire/In progress/Ready, Overview hidden, other columns shown, none collapsed. Overview OFF is the owner answer; Held shown and Overview-first-when-enabled on pass are builder defaults. Station registers Overview/Held/Waiting/Preparing/Ready through A797's controller. `ColumnScope {venueId:string;deviceId:string;screen:"pass"|"pass_monitor"|"station";stationId?:string}`; `ColumnState {order:ColumnKey[];hidden:ColumnKey[];collapsed:ColumnKey[]}`. Use one device-scoped controller, reusing A797's released implementation or adding the thin adapter in T7b. Key `waitron.kitchenColumns.v1.` plus an encoded JSON tuple of venue/proven-device/screen/station-or-empty; never key by display names or allow absent identity to share storage. Validate stored JSON/version, remove unknown/duplicate keys, append missing registered keys in default order, and intersect hidden/collapsed with registered keys. Storage failure leaves a usable in-memory view. Order/show/hide belong to corner Columns settings with up/down, no drag; heading tap toggles collapse and retains heading/count; narrow tabs/list use the same order/visibility/collapse. Columns remain reachable even if every content column is hidden. Monitor display settings cannot fire or Ready anything.

## Shared verification contract for later execution

Run commands separately and inspect each exit status and nonzero `Tests` count. RED means the named behaviour assertion fails, not an import/fixture error. GREEN reruns the owning files without `-t`. Use real `useVenueDb`; catch expected refusals outside `withTransaction` and compare complete affected rows/jobs/events. Use promise barriers for concurrent writers, never sleeps.

Manifests expose `test = vitest run` and `db:generate = drizzle-kit generate`. Server/db use Node tests; till uses Chromium (`apps/till/vitest.config.ts`); venue-service has `node` and `browser` projects. Commands below use those actual seams. Before browser runs measure `memory_pressure | rg free`; do not overlap a package's report directories or another lane's tests in this checkout.

**S, every schema slice:** generate with `pnpm --filter @waitron/db db:generate` (and `pnpm --filter @waitron/venue-service db:generate` only if its schema changes). Read SQL. Inventory inbound FKs from TS, generated snapshots and `PRAGMA foreign_key_list` on the migrated test database, plus trigger bodies naming rebuilt tables. Ticket items currently have incoming pass marks; stations and locations have many incoming keys. Drop retired children before any parent rebuild. Do not combine ADD COLUMN and CHECK/rebuild in one generation; remove/re-add expression indexes in separate generations if required. Never edit shipped SQL/snapshots/journals by hand. On rebase collisions regenerate from main.

Run `pnpm exec vitest run scripts/schema-constraints.test.ts scripts/append-only-triggers.test.ts scripts/behavioural-triggers.test.ts scripts/migrations-match-schema.test.ts scripts/classification-complete.test.ts scripts/append-only-migration-sets.test.ts scripts/module-graph-honesty.test.ts scripts/id-columns-are-references.test.ts scripts/two-file-foreign-keys.test.ts scripts/journal-monotonic.test.ts scripts/migration-upgrade.test.ts scripts/apply-migrations-callers.test.ts`, then `pnpm --filter @waitron/composition exec vitest run src/composition.test.ts`.

Run unchanged `pnpm --filter @waitron/fiscal-verifactu exec vitest run src/write-path.e2e.test.ts src/inmutabilidad.test.ts` after schema work and any serving/paid-line integration. Preserve original assertions. An unsafe parent rebuild or failing preservation guard blocks that schema PR: retain the generated diff and failing fixture, coordinate the A760 reset boundary, and revise the slice before landing. Never disable FKs, hide a guard, change fiscal SQL or invent a data-copy compatibility path.

**G, changed guides:** `pnpm --filter @waitron/server exec vitest run src/guide-content.test.ts src/guide-pages.test.ts` and `pnpm exec vitest run scripts/guide-links.test.ts`. Create/reuse `guide/en/kitchen-service.md` and Spanish twin, register `kitchen-service` in `guide-catalogue.ts` and localized page names in `guide-pages.ts`; share `{#ids}`. Coordinate any newly landed guide instead of duplicating it.

**LOOK, each UI slice:** start only the authorised dev stack with `wa-wt demo "$(basename "$PWD")"` from its registered implementation worktree; inspect actual screens in EN/ES, light/dark at measured 390 and 1280 px. Browser cases use `page.viewport`, assert `window.innerWidth`, inspect native controls, focus, wrapping and non-colour cues; restore locale/timers. Save screenshots under the workspace's allowed screenshot paths. Use existing tokens and measure the wide-to-stacked breakpoint; use the approved wide columns and narrow ordered tabs/list, including collapsed heading/count, Columns settings and dimmed/hidden informational rows. Physical printing/real-till trials remain separate, unclaimed measurements.

**Each PR:** finish focused checks, update current guides/prose, then installed `finish-branch`: initial rebase, one Claude run-it whole-branch review, resolved findings, normal pre-push hook, required CI/coverage on the exact head SHA. Inspect selected packages and coverage/merge jobs, not just a green summary. No additional whole-workspace run solely to finish. Tell the owner when ready; use the campaign’s standing `finish-branch` and `land-branch` authorisation when its gates pass, including H11’s landing lock. Respect any item-specific owner-review exception. Stop only recorded processes you started. Parent/RUNNER owns backlog and campaign updates.

## Working PR boundaries

| PR                                            | Tasks, intended review size                                            | Working state at its boundary                                                                                                                                                                                            |
| --------------------------------------------- | ---------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| A. Service lifetime and waiter authority      | T1–T3; each about 20–45 calls                                          | Existing immediate cooking works; ready survives payment; no Away/Done or station/pass initiation. Legacy schema/configuration fields remain until D, with no operational Fire-control gate.                             |
| B. Requested/release engine and boards        | T4–T9 including T7a/T7b; each about 20–65 calls; A756 PR 8 precedes T8 | Full requested lifecycle and visible-scope release work through tested contracts; default-false station field has no exposed editor yet. Existing venues continue immediate release. No temporary Fire-control fallback. |
| C. Station configuration and coverage warning | T10; about 25–50 calls                                                 | Venue can enable pass waiting, see uncovered station/zone pairs and use complete boards. Coordinate A756 prerequisites before exposing their fields.                                                                     |
| D. Ticket presentation and schema retirement  | T11–T12; each about 25–55 calls                                        | Course headings/coordination cues complete; retired storage removed after rebuild checks. A803 naming/modes tail remains explicitly separate.                                                                            |

The estimates are planning bounds, not measured budgets. Split a task further at its testable interface if reorientation reveals it approaches 100 calls. Do not cut checks to fit. Finish/land each working PR before reorienting the next; intermediate commits within a PR are not separate deployment boundaries.

### Task 1: One service lifetime for pass and monitor

**Files:** Modify server `pass-board.ts`, `working-order.ts` pass reads and family lifetime predicate; test `pass-board.test.ts`, `pass.db.test.ts`, `pass.test.ts`. Create `kitchen-service.md` guides/catalogue
entries as described in G.

**Interfaces:** Keep `listPassScreen(tx,cfg,deviceId,scope)` / `listPassMonitor(tx,cfg,scope)` callable until T5 changes their result together with clients. Both use served/cancelled quantities and
closed-party/collected-order lifetime, with identical retention.

- [ ] **Failing tests:**
      Add `A773 lifetime` cases: ready paid bill remains; serving one of two leaves one; Undo restores it with original ready age; full service/party clear hides it; counter payment alone retains it and collection/closure hides it. Include merged-party paid bills and no-zone/every-zone monitor reads. Compare item ids and quantities, not just order counts.

- [ ] **Run RED:**
      `pnpm --filter @waitron/server exec vitest run src/pass-board.test.ts src/pass.db.test.ts src/pass.test.ts -t 'A773 lifetime'`. Expect current Done/away or closed-party lifetime assertions to fail.

- [ ] **Minimal implementation:**
      Remove mark/away retention filters in reads; share active-service filtering and preserve existing station scope. Do not change payment, cancellation or collection writes. Legacy marking routes become inert only in the next task's coordinated removal, before PR A lands.

- [ ] **Run GREEN:**
      Repeat unfiltered command; retain unrelated scope/readiness assertions. Update guide lifecycle and run G.

- [ ] **Signed commit:**
      Stage reviewed task paths only; `git diff --cached --check`; `git commit -s -m "feat: keep pass food until service ends"`.

### Task 2: Remove obsolete controls and kitchen initiation

**Files:** Server `device-levers.ts`, `device-api.ts`, `pass-done-body.ts`, `till-api.ts`, `order-groups.ts`, `working-order.ts`, `kitchen.ts`, `management-api.ts`, `till-setup.ts`; till `api/client.ts`,
`till-app.ts`, table/station/expo screens, `widgets/station-queue.ts`, strings; dashboard `screens/kitchen-screen.ts`, client and strings.

**Interfaces:** Preserve waiter `fireGroup` and `fireHeldLine` signatures and their replay. Remove old course Fire and device group Fire, Away and Done contracts. Retain legitimate existing authorised Ready operations and real station-item/ticket preparation routes for actual-released work. The Q42 column answer does not retire them. Never expose Ready on genuinely held/requested rows or on monitors, and do not introduce a new permission policy.

- [ ] **Failing tests:**
      `A773 waiter authority` in server `till-api.groups.test.ts`, `device-api.pass.test.ts`, `pass.test.ts`: all four waiter firing paths still work, including paid sent held work; forged retired Fire/Away/Done routes cannot mutate; existing authorised Ready behavior for released work remains checked. Stations and monitors cannot initiate. Till station/expo tests assert absent native buttons and no client call; table Fire stays enabled under all former modes.

- [ ] **Run RED:**
      `pnpm --filter @waitron/server exec vitest run src/till-api.groups.test.ts src/device-api.pass.test.ts src/pass.test.ts -t 'A773 waiter authority'`; separately `pnpm --filter @waitron/till exec vitest run src/screens/till-station-screen.test.ts src/screens/till-expo-screen.test.ts -t 'A773 waiter authority'`. Expect obsolete actions still accepted/rendered.

- [ ] **Minimal implementation:**
      Retire routes, helpers, props and EN/ES action strings, including per-device Done Undo. Remove Fire-control management/setup clients, preserving independent bump mode. Do not delete the Kitchen tab while A756-owned controls remain. Leave physical schema and configuration-format retirement to T12; every operational Fire-control gate is gone before PR A lands. This is staged retirement, with no compatibility
      conversion.

- [ ] **Run GREEN:**
      Rerun owning files unfiltered plus till `widgets/station-queue.test.ts`; run server profile action/zone maps and update their route rows/refusal cases. Update current Fire/Away/Done prose; LOOK includes disabled profiles and monitor.

- [ ] **Signed commit:**
      `git commit -s -m "feat: reserve cooking requests for waiters"` after staging reviewed paths and checking staged diff.

### Task 3: Audit every Away/Done consumer without changing money

**Files:** Consumer-audit Away/Done rows above; server `station-closing.ts`, `station-delete.ts`, `station-outputs-down.ts`, `station-move.ts`, `rest-of-order.ts`, `department-transfer-api.ts`, `kitchen-print.ts`,
working-order split/floor reads; till `widgets/table-details-sheet.ts` and client types. Schema removal waits for T12.

**Interfaces:** `stillMovable` drops `awayAt` but retains queued/not-made-here/unserved gates. Retire `TableParty.enRoute`; use remaining service quantity for pass/rest/alerts. Keep quantities, prices, adjustment
records and payment allocation byte-for-byte unchanged.

- [ ] **Failing tests:**
      Add `A773 no dispatch state` to server `station-move.test.ts`, `station-delete.test.ts`, `station-outputs-down.test.ts`, `station-queue-rest.test.ts`: served work is excluded, unserved ready work retained, queued work movable, preparing/ready work not movable; split no longer copies device marks. Floor detail shows ready quantity with no en-route subtraction.

- [ ] **Run RED:**
      `pnpm --filter @waitron/server exec vitest run src/station-move.test.ts src/station-delete.test.ts src/station-outputs-down.test.ts src/station-queue-rest.test.ts -t 'A773 no dispatch state'`. Expect legacy dispatch filtering/projection assertions to fail.

- [ ] **Minimal implementation:**
      Remove each audited reader/writer, split-copy operation and stale comment. Preserve deletion/history, closed-station retention and department-transfer permission checks. Update existing till floor/detail tests to assert ready counts directly.

- [ ] **Run GREEN:**
      Rerun server files unfiltered, `src/kitchen-delete.integration.test.ts`, and `pnpm --filter @waitron/till exec vitest run src/widgets/table-details-sheet.test.ts`; re-run the audit search and explain every surviving schema/history hit. Run G and finish PR A.

- [ ] **Signed commit:**
      `git commit -s -m "refactor: remove kitchen dispatch and device completion consumers"` after staging only reviewed paths.

### Task 4: Requested storage and explicit phase foundation

**Files:** Db `schema/ticket-items.ts`, `schema/kitchen-stations.ts`, `schema/order-groups.ts`, generated `drizzle/`; create server `kitchen-phase.ts` and `.test.ts`; modify group creation for `requestKind`. Test
db schema siblings, server `order-groups.test.ts`, configuration-transfer tests for station settings.

**Interfaces:** Produce Contracts 1–4's fields and `KitchenPhase`; expose nullable request time without activating station waiting yet. Group state/firedAt retain their current waiter meaning. Add exported types through
existing barrels only where needed.

- [ ] **Failing tests:**
      `A773 phases`: exact held/requested/waiting/preparing/ready tuples; made-here readiness; default station false; group origin remains stable after reorder and bill move. Schema fixture round-trips new fields; malformed imported station pass settings refuse with no partial write. Do not add service-group configuration imports.

- [ ] **Run RED:**
      `pnpm --filter @waitron/server exec vitest run src/kitchen-phase.test.ts src/order-groups.test.ts -t 'A773 phases'`; `pnpm --filter @waitron/db exec vitest run src/schema/ticket-items.test.ts src/schema/kitchen-stations.test.ts src/schema/order-groups.test.ts`. Connect tests to current behavior first; fail a phase/default assertion, not a missing import.

- [ ] **Minimal implementation:**
      Add nullable timestamp, per-item `passControlled` snapshot and additive defaulted fields using schema vocabulary; generate migrations with S. Store request kind at existing `startGroup` /`startGroupAfter` call sites from submission context. Expose `requestKind:"new_order"|"next_course"|"added"` on the internal group record. Keep the group-state enum and append-only event kinds unchanged.

- [ ] **Run GREEN:**
      Rerun unfiltered owning files, S and unchanged fiscal controls. Inspect every generated rebuild/inbound key before accepting SQL. State reset requirement in the commit/PR.

- [ ] **Signed commit:**
      `git commit -s -m "feat: record kitchen requests separately from release"` after reviewed staging.

### Task 5: Board reads and all-station readiness

**Files:** Server `working-order.ts`, `pass-board.ts`, `rest-of-order.ts`, `order-groups.ts`, `dish-kitchen.ts`, `device-api.ts`, `till-api.ts`; till `api/client.ts`, `state/sent-panel.ts`, table/station/expo
consumers. Create focused server `pass-requested.test.ts`.

**Interfaces:** Produce `PassBoard`, `PassCard`, `PassCardItem` from Contract 9 through pass-screen/monitor and legacy expo reads; update clients atomically. Station queue items add `requestedAt`, `readyAt`, `phase`, `passControlled`; retain existing order/group/notes/name facts. Current-order kitchen rows add request time; requested lines belong to Fired with “at the pass”.

- [ ] **Failing tests:**
      `A773 requested reads` seeds two bills in one group, Grill requested, Cold preparing, Bar ready. Assert one initiated card, allReady false, full companion progress, only visible release ids; genuinely held groups appear only in Held with null requestedAt/context and zero action ids; after all parts ready it enters Ready. Include cancelled/recalled/made-here exclusions, two separately routed extras, all-served empty set, no-zone and counter card in line-entry order.

- [ ] **Run RED:**
      `pnpm --filter @waitron/server exec vitest run src/pass-requested.test.ts src/pass-board.test.ts src/order-groups.test.ts -t 'A773 requested reads'`. Expect requested classification/readiness/grouping assertions to fail.

- [ ] **Minimal implementation:**
      Build group-wide readiness and Overview component facts before narrowing actionable rows or hiding dimmed information; non-pass presentation never changes release ids/context. Keep cards once per group across bills, informational rows clearly marked and ids intact. Do not add A803 bill-name lookup; retain any already-landed identity fields. Adapt current UI enough to consume the complete result; T7 owns layout. Old paid/settled filtering must not return.

- [ ] **Run GREEN:**
      Rerun owning server files unfiltered plus `current-orders.test.ts`, `table-signals.test.ts`; run `pnpm --filter @waitron/till exec vitest run src/state/sent-panel.test.ts src/screens/till-table-order-screen.current-orders.test.ts`.

- [ ] **Signed commit:**
      `git commit -s -m "feat: project requested work and whole-group progress"` after reviewed staging.

### Task 6: Atomic pass release and print-once replay

**Files:** Create server `pass-release.ts`, `pass-release.test.ts`; modify `device-api.ts`, error registry, till client/fallbacks; existing `device-api.pass.test.ts`, `kitchen-print.concurrency.test.ts`, profile
maps. Reuse venue-service effective-screen seat; add a seat only if the existing read cannot express the required effective scope.

**Interfaces:** Implement Contracts 5–8. Service-command keys/actor fingerprints reuse existing party/order scope, not a new queue. Print through existing `enqueueKitchenTickets(tx,cfg,orderId,firedItems,options?)` once
per returned order's transitioned set.

- [ ] **Failing tests:**
      `A773 pass release`: hot/cold same-zone passes release disjoint sets; wrong station/right zone and right station/wrong zone refuse; every/empty/no-zone semantics; missing/deleted/served/recalled/foreign ids, duplicate/empty ids and omitted visible id refuse atomically. Include a monitor, station-only KDS, forbidden profile, signed-out handheld and narrowed profile. Positive KDS fixture must create/save its profile through real management parsing/validation and load the real effective screen: `act-as-kds` + `prepare-orders` + screen flag `run-the-pass`, configured effective pass choice and scope, then release through the real device route. Remove `prepare-orders`, `run-the-pass` or the effective pass choice independently and assert server refusal/no writes. Test `act-as-kds` through its actual app mount gate; do not promote a UI-only gate to a new release permission. `sharedDisplayMay` permits non-action screen flags (`packages/layouts/src/device-profile.ts:26–29`); the dashboard renders them separately (:2326). Preserve action allowlists/default capabilities and assert layout/dashboard parity; never invent a run-the-pass action.

- [ ] **Failing race tests:**
      barriers arrange release versus release, Recall, station move, Serve and cancellation both ways. Matching replay returns original ids/jobs even after service; changed actor/target/id set/context under the same submission refuses. Partial Serve, Undo, cancellation and a move between two stations visible to the same pass retain ticket IDs but invalidate the old context. Refreshed release prints only the remaining unserved quantity, including proportional extras; an independent cold-pass release leaves the hot-pass context valid. Two overlapping new commands print only the winner's set; disjoint passes succeed independently. Failed enqueue rolls stamps and replay back. Assert job bytes/link sets, not only enqueue call counts.

- [ ] **Run RED:**
      `pnpm --filter @waitron/server exec vitest run src/pass-release.test.ts src/device-api.pass.test.ts src/kitchen-print.concurrency.test.ts -t 'A773 pass release'`. Expect missing release/scope/replay behavior assertions to fail.

- [ ] **Minimal implementation:**
      Re-resolve authority and exact requested set in one transaction, then conditional update from requested to actual-fired/queued. Print only newly transitioned `.returning()` rows at remaining unserved quantity, with proportional extras; a refresh after partial Serve/Undo cannot reprint already served quantity. Keep request time, start station age at release, and record result in the same transaction. Never mutate bills, sources, invoices or person ownership.

- [ ] **Run GREEN:**
      Rerun the files unfiltered plus server profile action/zone tests and `kitchen-print.shared-printers.test.ts`. Use a printer plus two screens fixture: one job per configured print destination/layout, no screen-created duplicates.

- [ ] **Signed commit:**
      `git commit -s -m "feat: release only this pass's requested kitchen work"` after reviewed staging.

### Task 7a: Shared profile/device information policy (PR B, about 25–50 calls)

**Files:** `packages/venue-service/src/schema/kitchen-screens.ts`, `kitchen-screens.ts`, `service.ts`, `configuration-transfer.ts`, generated `drizzle/`; `packages/module/src/module.ts`; server `device.ts`, `device-api.ts`, `management-api.ts`; dashboard `screens/device-profiles-screen.ts`, `screens/devices-screen.ts`, clients/strings and existing tests. Reorient lane C's active settings files first; reuse its released contract rather than build twice.
**Interfaces:** Implement Contracts 11–12 through existing module/profile/device seats; till client `setDeviceKitchenScreenDisplay(kind:"pass"|"pass_monitor",showNonPassStations:boolean|null):Promise<void>`. Existing table state classifications already cover both rows (`classification.ts:26,29`); existing core dependency (`packages/composition/src/modules.ts:136`), schema/index and service exports travel with the generated module migration. No new core table or local table. Profile defaults transfer via `VENUE_SERVICE_CONFIGURATION_TRANSFER` (:780); device choices/overrides remain outside configuration export, tied to the proven registration's device-id FK, not a node-global preference. A new/reconnected identity inherits until configured; replication cannot turn another device's setting into this one's. Do not add node-local ownership or a backfill to shared device configuration.

- [ ] **Failing tests:** `A773 pass display policy` covers proposed true/null inheritance, explicit false/true override, reset to null following a later profile change, profile copy, management device scope edits retaining override, narrowing retaining empty/removed scope, invalid null profile/nonboolean override and atomic refusal. Same board with information shown/hidden has identical allReady, release ids and expectedContext; non-pass rows dimmed with station/state, Requested moved to immediate remains pass-controlled/actionable. Monitor setting changes send no cooking request.

- [ ] **Run RED:** `pnpm --filter @waitron/venue-service exec vitest run --project node src/kitchen-screens.test.ts src/configuration-transfer.test.ts -t 'A773 pass display policy'`; `pnpm --filter @waitron/server exec vitest run src/management-api.device-profiles.test.ts src/device-api.pass.test.ts -t 'A773 pass display policy'`. Expect missing policy round-trip/inheritance assertions to fail.

- [ ] **Minimal implementation:** Add columns/typed parsers and server-resolved effective policy; keep scope algebra unchanged. Update profile and device admin controls plus device corner setting through the same server seat. Preserve `setDeviceKitchenScreens`' existing override when a scope-only writer omits it; own-device update never deletes scope/removal rows. New permission-less presentation update uses proven-device/screen and session admission, never grants run-the-pass/prepare-orders. Run S, inspecting inbound child FKs before any rebuild; no FK disable or metadata shortcut.

- [ ] **Run GREEN:** Rerun the owning files unfiltered, then `pnpm --filter @waitron/dashboard exec vitest run src/screens/device-profiles-screen.test.ts src/screens/devices-screen.test.ts src/device-profile-types.parity.test.ts`; include existing profile/device save-state/unsaved/axe checks and native inheritance control. Keep existing `requires`, classification and transfer declarations correct; generate through venue-service and run S plus unchanged fiscal controls. Run `pnpm --filter @waitron/layouts exec vitest run src/device-profile.test.ts` for the real KDS validator, without changing the action list. UI copy/LOOK/G remain T7's landing gate.

- [ ] **Signed commit:** `git commit -s -m "feat: retain pass information policy per profile and device"` after reviewed staging. Continue PR B; do not land settings alone with mismatched clients.

### Task 7b: One scoped Columns controller (PR B, about 20–40 calls)

**Files:** Reuse lane C's released Columns controller; if it has no implementation after the required ownership handoff, create till `state/kitchen-columns.ts` and `.test.ts` plus the existing corner-settings integration in station/expo screens. This is the shared controller/persistence task, not another station card/Overview redesign.
**Interfaces:** Contract 13; adapter exports `readColumnState(storage:Pick<Storage,"getItem">,scope:ColumnScope,defaults:ColumnState):ColumnState`, `saveColumnState(storage:Pick<Storage,"setItem">,scope:ColumnScope,state:ColumnState):void`, `moveColumn(state:ColumnState,key:ColumnKey,direction:"up"|"down"):ColumnState`, `toggleColumnCollapsed(state:ColumnState,key:ColumnKey):ColumnState`, `setColumnVisible(state:ColumnState,key:ColumnKey,visible:boolean):ColumnState`. Wire the single implementation; expose `storageScope` only after server device proof. Profile policy is never read from browser storage.

- [ ] **Failing tests:** `A773 columns state`: order/show/hide/collapse survives remount; profile switch retains this device's layout, another venue/device/screen/station cannot inherit it; renamed station keeps id-based state. Corrupt JSON/version, unknown/duplicate keys and new registered columns sanitize deterministically; unavailable storage keeps in-memory interaction usable. Up/down boundaries do not wrap; collapsed heading/count remains, reopening restores content; hidden-all leaves Columns accessible. No drag handler. Narrow and wide views consume identical order; Overview remains off by default on pass.

- [ ] **Run RED:** `pnpm --filter @waitron/till exec vitest run src/state/kitchen-columns.test.ts -t 'A773 columns state'`. Expect persistence/sanitization/order assertions to fail through the current controller seam, not an absent-import failure.

- [ ] **Minimal implementation:** Reuse A797 controller or add the stated adapter, versioned device-scoped key and pure state changes. Never reset layout on polling or use local state to widen service scope; storage errors do not trigger a product Save refusal.

- [ ] **Run GREEN:** Rerun the controller file unfiltered; T7 exercises actual native heading/Columns controls and 390/1280 transitions. If A797 supplies an existing controller file instead, record that exact current path/command during mandatory reorientation rather than duplicate it.

- [ ] **Signed commit:** `git commit -s -m "feat: remember kitchen columns by proven device"` after reviewed staging; continue PR B.

### Task 7: Held and the approved pass columns on real screens

**Files:** Till `screens/till-station-screen.ts`, `screens/till-expo-screen.ts`, `widgets/station-queue.ts`, app/client/strings, sibling tests/axe; new `screens/till-expo-screen.requested.test.ts`; kitchen-service guides. Gate: lane C's A797 revision/redraw/FYI and shared-file handoff, not another Q42 answer.
**Interfaces:** Consume T5's Held/Overview board facts, T6's release and T7a/T7b's effective policy/controller. Station Held contains held/requested, distinguishing Waiting for the pass. Pass registers Held (optional), To fire, In progress, Ready, Overview (optional/off default). Preserve authorised actual-released Ready operations; held/requested have none, monitor has no cooking buttons. A797 supplies broad station cards/Overview totals, while A773-2 supplies Held/requested integration and pass rendering.

- [ ] **Failing tests:** `A773 boards` checks genuinely held optional cards with null request/context/no action ids, requested label/no native advance or Ready, one group card across bills, request ordering, all-station readiness and ready ages. Non-pass rows dimmed and informational, profile/device override show/hide, unchanged readiness/release context. Every visible heading collapses with heading/count retained; corner Columns uses show/hide/up/down, no drag, survives reload and keeps chosen narrow order. Monitor matches views without release/Ready calls. Rapid double-click sends one ask; lost reply retains exact ask/id; stale refusal refreshes without auto-release.

- [ ] **Run RED:** `pnpm --filter @waitron/till exec vitest run src/screens/till-expo-screen.requested.test.ts src/screens/till-station-screen.test.ts src/widgets/station-queue.test.ts -t 'A773 boards'`. Expect Held/column/controller/native-control assertions to fail.

- [ ] **Minimal implementation:** Integrate the revised A797 layouts and one controller, preserving A756 bump mode and existing authorised actual-released Ready behavior. Corner Columns and display-only policy changes cannot release food; Fire sends only canonical `releaseTicketItemIds`/context. Fence late reads/answers by generation; retain action refusals across read recovery. Keep pass identity/coverage header, heading/count on collapse and dimmed station/state labels. Do not implement handheld short names, the broad station card redesign or a second Overview aggregator here.

- [ ] **Run GREEN:** Rerun owning files and station/expo/queue axe siblings in both themes; LOOK EN/ES at measured 390/1280 includes optional Held/Overview, each collapsed heading/count, persisted order, all-hidden recovery, profile-inherit/override, dimmed/hidden non-pass rows, monitor and denied KDS. Complete the one Spanish copy review before UI landing, update guides and run G.

- [ ] **Signed commit:** `git commit -s -m "feat: integrate held work and remembered pass columns"` after reviewed staging; continue T8/T9 before finishing PR B.

### Task 8: Requested lifecycle, serving and current Finish-table flow

**Files:** Server `draft-recall.ts`, `dish-kitchen.ts`, `line-cancel-context.ts`, `line-cancel-input.ts`, `station-move.ts`, `station-closing.ts`, `station-delete.ts`, `department-transfer-api.ts`,
`finish-party-service.ts`, working-order serving/transfer/split gates; till cancel context types, finish dialog and current-order presentation.

**Interfaces:** Add `requestedAt:string|null` and `stationId:string|null` to every `CancellationContext.components` entry and parser/client twin; preserve exact comparison/refusal, including same-id station moves. Add
`ticketRequestedAt:string|null` to `ServableLine` and internal `serviceRequested(line:Pick<ServableLine,"groupState"|"ticketItemId"|"ticketFiredAt"|"ticketRequestedAt"|"ticketMadeHere"|"sentAt">):boolean` in
`working-order.ts`. Serving/current-order/relocation reads use this initiation predicate. Keep `isReleased`, `ordersWithUnfiredDish` and adjustment-stage financial consumers on their existing actual-release meaning.
Extra-held means genuinely held, not requested. Keep `finishPartyService(tx,cfg,args,attendance?)` and its complete confirmed cancellation set.

- [ ] **Failing tests:**
      `A773 requested lifecycle`: Recall requested into the same bill outbox with unchanged price/discount/ticks; another editor refuses before writes; started/paid still refuse. Requested cancellation removes only active kitchen quantity with existing no-start/paid choices; release racing the dialog causes `tab.cancel_context_changed`. Finish includes held/requested/waiting/ready unserved paid dishes, exact contexts,
      one cancellation/close transaction and unchanged refund handoff.

- [ ] **Failing tests:**
      Move requested to either waiting or immediate station keeps it Requested with no fire job; its destination pass releases it once. Move actual-released queued work never re-holds it. Automatic rerouting cannot let a pass cook outside scope. Whole-line/partial serving of Requested, split extras, All served and Undo preserve quantities and suppress later fire jobs for already served components. A recalled source
      cannot be fired by a sent-group action. Direct legacy Recall cannot leave a request stamp that a later generic Send bypasses; any recall-to-held writer clears both stamps, while the party New order path retains its source reservation.

- [ ] **Run RED:**
      `pnpm --filter @waitron/server exec vitest run src/draft-recall.test.ts src/line-cancel-context.test.ts src/station-move.test.ts src/finish-party-service.test.ts src/current-orders.test.ts -t 'A773 requested lifecycle'`. Expect null-fired serving/context/lifecycle assertions to fail.

- [ ] **Minimal implementation:**
      Apply phase-aware checks and corrections at existing writers. Carry stamps through move/split; preserve bill/group/source identities and ownership observations. Recall/cancellation of Requested follows unreleased/held correction rules, including printed HOLD, without a fictitious FIRE/RECALLED cooking slip. Keep A756 policy implementation as its prerequisite: Requested is unreleased for “while held”; any started
      component refuses.

- [ ] **Run GREEN:**
      Rerun owning files unfiltered plus `line-cancel.test.ts`, `till-api.station-move.test.ts`, `working-order.test.ts`, `kitchen-delete.integration.test.ts`. Add a requested fixture to `unpaid-departure.test.ts` asserting the existing `unpaid_departure.unfired_dishes` refusal and unchanged sale/number rows; run `pnpm --filter @waitron/server exec vitest run src/unpaid-departure.test.ts src/adjustments-apply.test.ts`
      and unchanged fiscal controls. Run `pnpm --filter @waitron/till exec vitest run src/widgets/finish-table-dialog.test.ts src/widgets/finish-table-dialog.unsaved.test.ts src/widgets/finish-table-dialog.a11y.test.ts src/widgets/cancel-item-dialog.test.ts src/widgets/cancel-item-preparation.test.ts src/widgets/cancel-item-dialog.a11y.test.ts`. Continue to T9 before finishing PR B.

- [ ] **Signed commit:**
      `git commit -s -m "feat: preserve requested work through service actions"` after reviewed staging.

### Task 9: Waiter initiation and counter routing, with default-false setting

**Files:** Create server `kitchen-release.ts`, `kitchen-release.test.ts`; modify working-order `fireLines`, `insertSplitExtras`, `releaseHeld`, `sendLines`, `fireOrderLines`, group release/held-line Fire and
source resend. Modify floor/reminder readers, station output alerts, db/server configuration transfer. No counter payment handler redesign.

**Interfaces:** Implement `requestKitchenItems` from Contract 4 and wire all four waiter paths. New requests use per-component station settings; requested work is never swept up by a second generic null-fired release.
Preserve paid sent-service exception and no-preparation/made-here behavior.

- [ ] **Failing tests:**
      `A773 waiter request` covers first Send, selected Fire, held group Fire and one held-line Fire; Bar immediate, Grill/Cold requested, independent extra destinations. Advance/item/ticket APIs refuse held/requested. No FIRE print for requested until T6; held advance printing remains HOLD. Replays keep request stamps and print counts. A paid group's fire changes no financial row.

- [ ] **Failing tests:**
      Counter sends all courses immediately into each station's release policy, keeps dish entry order, has one New order pass card and no course/group headings. Include a counter moved to a table through existing seating, source resend and a multi-output station; no duplicate item or ticket.

- [ ] **Run RED:**
      `pnpm --filter @waitron/server exec vitest run src/kitchen-release.test.ts src/order-groups.test.ts src/working-order.test.ts -t 'A773 waiter request'`. Expect current course/default-null-fire rules to fail requested/counter assertions.

- [ ] **Minimal implementation:**
      Route first, request once, then partition by destination `waitsForPass`. Populate request time for immediate work too. Counter ignores course **presentation/release ordering**, retaining recorded course facts; do not erase catalogue/snapshot data. Extend requested floor/held counts without treating pass waiting as unsent or as a second due-held group; reminder timing still waits for previously initiated dishes to
      be served. Output-down alerts include requested pass demand without requiring `firedAt` or marks.

- [ ] **Run GREEN:**
      Rerun unfiltered files plus `table-signals.test.ts`, `station-outputs-down.test.ts`, `till-api.groups.test.ts`, server configuration-transfer tests and unchanged fiscal controls. **This task completes PR B**, before T10 exposes the setting.

- [ ] **Signed commit:**
      `git commit -s -m "feat: route waiter requests through each station's pass policy"` after reviewed staging.

### Task 10: Station editor, pass coverage warning and A756 integration

**Files:** Server `kitchen.ts`, `management-api.ts`, create `pass-coverage.ts` /`.test.ts`; venue-service effective kitchen-screen read/service seat, dashboard `routing-client.ts`, `station-editor.ts`,
`station-table.ts`, `prep-stations-screen.ts`, strings and sibling tests. Update configuration transfer/provisioning station field readers and guides.

**Interfaces:** `Station`, `PrepStation`, station input/patch and editor save add `waitsForPass:boolean`; absent create defaults false, explicit null/nonboolean refuses. Add
`readPassCoverage(tx:Transaction,cfg:Pick<TillConfig,"locationId">):Promise<{stationId:string;stationName:string;zoneId:string|null;zoneName:string|null}[]>`, returned by GET `/management-api/stations/pass-coverage`
through existing management session plus `venue.configure` authorization. Warn for active waiting-station×active service-zone pairs, plus outstanding Requested pairs regardless of today's station setting, without an
available writable pass screen covering both. A monitor or profile forbidden to run the pass does not cover it; a null-zone outstanding request requires every-zone coverage.

- [ ] **Failing tests:**
      `A773 station policy` checks unchanged Save disabled, changed native switch round-trip, refusal retains draft, column/read-only state, import/provisioning defaults and explicit invalid values. Coverage distinguishes hot/cold, zones, every versus empty, disabled device/profile/screen and monitor-only setup. Saving uncovered settings succeeds with a warning; no pass prohibition.

- [ ] **Run RED:**
      `pnpm --filter @waitron/server exec vitest run src/kitchen.test.ts src/pass-coverage.test.ts src/configuration-transfer.test.ts -t 'A773 station policy'`; separately `pnpm --filter @waitron/venue-service exec vitest run --project browser src/dashboard/station-editor.test.ts src/dashboard/station-table.test.ts src/dashboard/prep-stations-screen.test.ts -t 'A773 station policy'`.

- [ ] **Minimal implementation:**
      Expose the field only now that PR B supports every lifecycle. No Every station fallback. Consume A756 PR 6 held-print/grouping/MOVED and PR 8 Recall policy after landed/current reorientation; their code remains A756-owned. If either is outstanding, sequence its own firing before closing this integration, without implementing that lane's reserved work here.

- [ ] **Run GREEN:**
      Rerun files unfiltered, venue-service `kitchen-screens.test.ts` under `--project node`, editor save-state/unsaved/a11y and prep table a11y siblings under `--project browser`; G and LOOK. Check live setupRevision/subscription dependencies so settings and warning refresh without resetting dirty drafts. Finish PR C.

- [ ] **Signed commit:**
      `git commit -s -m "feat: configure station pass waiting and show coverage gaps"` after reviewed staging.

### Task 11: Course headings, coordination cues and print boundary

**Files:** Server `kitchen-print.ts`, `kitchen-ticket.ts`, `order-groups.ts` held corrections; till station queue/expo presentation as needed; `kitchen-print.test.ts`, `kitchen-print.shared-printers.test.ts`,
`kitchen-print.concurrency.test.ts`, `kitchen-ticket.test.ts`; kitchen-service guides.

**Interfaces:** Extend `KitchenTicketItem` with `groupCourseNames?:string[]` and `goesWithKitchenFood?:boolean`; propagate through current planner. Build ordered course names from the lines' course identities and
retained course names, then freeze text in print bytes; print the cue once per affected group/station section. Keep numeric group identity separate from mutable firing order. Expose T6/T9's exact released ids and
existing job-link associations for A803's later adapter; do not change print-job ownership to several bills here.

- [ ] **Failing tests:**
      `A773 fire paper` asserts `GROUP 3 · MAINS` after reorder; multiple course names in course order; immediate Bar ticket/screen says Goes with kitchen food only when same group has pass-waiting station work. Requested Grill prints no fire paper at request, one at release; advance HOLD and its corrections still obey each station's A756 setting.

- [ ] **Run RED:**
      `pnpm --filter @waitron/server exec vitest run src/kitchen-print.test.ts src/kitchen-ticket.test.ts src/kitchen-print.shared-printers.test.ts src/kitchen-print.concurrency.test.ts -t 'A773 fire paper'`. Expect missing headings/cue assertions to fail.

- [ ] **Minimal implementation:**
      Build course labels from recorded lines, carry the semantic cue explicitly, and reuse station output routing/grouping. For multiple printers/screens, print once per intended physical output/layout from transitioned sets. Grouped cross-bill single-ticket batching and named/unnamed labels remain A803's dependency tail; no new ticket mode or fiscal receipt work.

- [ ] **Run GREEN:**
      Rerun files unfiltered and till `widgets/station-queue.test.ts`; inspect rendered 58/80 mm output and EN/ES screens. Describe rendering separately from physical paper measurements. Run G; attach A803 interface handoff to PR D.

- [ ] **Signed commit:**
      `git commit -s -m "feat: label kitchen groups and coordinated station work"` after reviewed staging.

### Task 12: Remove retired storage and close the complete audit

**Files:** Db `schema/ticket-items.ts`, `schema/pass-item-marks.ts`, `schema/tenants.ts`, schema/index barrels/classification/configuration transfer, generated migrations; server/core
import/provisioning/configuration-transfer consumers. Current developer prose/guides; preserve historical specs/plans with dated pointers. No backlog edit by this dedicated writer.

**Interfaces:** Delete `away_at`, `pass_item_marks`, `locations.fire_control` and its enum/CHECK from current schema/export contracts only after no runtime consumer remains. Preserve `bump_mode` or A756's replacement
independently. Bump configuration bundle format from baseline 4 (`configuration-transfer.ts:138,172,483`) to 5 in producer/type/parser and readers; older format refuses `setup.configuration_outdated`, newer keeps
`setup.request_invalid` with `field:version`. No conversion. If another lane has already advanced the format, reorient and take its next value in the same slice. Existing ticket state/quantity, service-command replay
and fiscal interfaces stay unchanged.

- [ ] **Failing tests:**
      `A773 retired storage` checks migrated schema lacks the three retired storage contracts and exports omit Fire control; full current setup/client snapshots omit dispatch/Done fields. Invalid retired import format refuses explicitly through current configuration-version policy, with no conversion/backfill. Keep existing preservation assertions for every retained row/key/trigger.

- [ ] **Run RED:**
      `pnpm --filter @waitron/db exec vitest run src/schema/ticket-items.test.ts src/configuration-transfer.test.ts -t 'A773 retired storage'`; separately `pnpm --filter @waitron/server exec vitest run src/configuration-transfer.test.ts -t 'A773 retired storage'`. Expect retired columns/table/field still present.

- [ ] **Minimal implementation:**
      Remove retired child marks first; generate drops with S. Inventory **all** inbound FKs and trigger reads for any `ticket_items` /`locations` rebuild, including other migration sets; inspect actual generated SQL. Reset is required, never backfill. If protected SQL or populated preservation fails, stop this schema slice with the exact receipt and coordinate A760 before revising/landing; no partial claim of storage
      retirement.

- [ ] **Run GREEN:**
      Rerun files unfiltered, S and unchanged fiscal controls; run till/server setup snapshots affected by removed fields. Re-run every audit search across the complete PR-A-to-D range, follow indirect callers and inspect all prose hits. No live Away/Done/fire-control reader survives; historical SQL/docs remain historical. Update developer pass/profile/setup descriptions and G.

- [ ] **Signed commit:**
      `git commit -s -m "refactor: retire pass dispatch completion and fire-control storage"` after reviewed staging; PR first line states reset requirement. Finish PR D with current-head CI; report any actual blocking migration receipt without weakening checks.

## Plan self-review and later handoff

- Spec coverage: §5 → T1–T10 including T7a/T7b; Q42 amendment → T5/T7a/T7b/T7; §6 → T6/T9/T11; §7 → T10 plus named A756 prerequisites; §8 → T5/T9; §9 → T4/T7a/T12 with A773-1 ownership preserved; §10 → T6/T8 and the landed Finish amendment; §12 → ownership table; §13 → each task's behavioural assertions and LOOK. No automatic station coordination, portion/fiscal receipt or allergy implementation is assigned.
- Type/step scan: requested and actual release use distinct stamps; group `firedAt` retains waiter meaning; `PassReleaseAsk`/result and `PassBoard` are shared by named producer/consumer tasks. Each task has a named failing assertion, runnable focused command, minimal change, unfiltered green step and signed commit; T7a owns shared policy, T7b owns one scoped controller, T7 owns integration. No implementation bodies are prescribed.
- Corrected during self-review: old Finish Fire choice is superseded; cross-bill groups aggregate before scope filtering; Requested serving and split extras need separate initiation/release checks; same-id moves need a context digest; `run-the-pass` is a screen flag rather than an action; current authority precedes replay; output count must not follow screen count. PR B includes T7a/T7b and T9 before T10 exposes the setting. Q42 is completed: optional Held/Overview, In progress, dimmed policy and remembered Columns govern the integration; Ready behavior is retained for released work.
- Reorientation is mandatory at every PR boundary. Keep the copy sheet pending for owner review; report actual RED/GREEN counts, native screenshots, migration/FK findings and current-head CI only when later execution produces them. This plan records no passing tests or runtime results.
- The parent lands this plan and owns backlog/campaign state. Implementation is a later firing. After implementation checks and CI, explicitly tell the owner the branch is ready for `finish-branch`, or report its result if already underway; use the standing campaign landing authorisation, H11 lock and current-head gates; never invent another approval request or waive an explicit item gate.
