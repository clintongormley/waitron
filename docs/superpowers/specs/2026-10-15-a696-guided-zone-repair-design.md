# A696: guided repair of an unusable saved time zone

> **Owner approval and planning update, 2026-10-21:** the owner approved the
> [startup design](2026-10-20-a696-startup-zone-validation-design.md), including the minimal
> A166 country-zone list and creation/import checks first, and authorised its plan and build
> (lane E questions, “OWNER ANSWER — A696”, approximately 02:25). Follow the
> [implementation plan](../plans/2026-10-21-a696-startup-zone-validation.md). Earlier approval
> statements below record their dates; the product remains unbuilt. The production fiscal PR
> must finish green and wait for the owner to land it.

> **Historical proposal, superseded 2026-10-20:** the owner's 2026-10-15 ~22:25 direction did
> not approve this mid-payment repair design. The [startup redesign](2026-10-20-a696-startup-zone-validation-design.md)
> replaces its post-capture state, resume action and reporting consequence with startup validation,
> checks at every zone writer and authenticated confirmation before trading. The body below is
> preserved as history, including its former status and proposals. Full design, plan and build
> approval remain outstanding; no repair is built here.

**Status: proposed exact design, awaiting owner approval.** The owner approved restricted guided repair as a scope direction at **2026-10-15 ~17:20**, recorded in `~/waitron-campaign-e/questions.md:4384`. That answer does not approve this design, an implementation plan or a build.

This supplements [the invoice time-zone design](2026-10-15-a696-invoice-time-zone-design.md). Guided repair and strict issuance-zone validation are both **unbuilt**. All current-source observations below are **UNVERIFIED at runtime**: this author read files but ran no product, tests or probes. The parent spec’s historical audit receipts retain their original scope; they do not qualify this repair.

## When the card payment is recorded but the invoice cannot finish

You should be able to correct an unusable venue time zone from the dashboard, then finish recording an existing card payment without asking the customer to pay again.

For a known capture, the till and dashboard explain:

> The card payment is recorded, but its invoice could not be issued because the venue’s saved time zone is missing or invalid. Do not take payment again. Ask a manager to repair the time zone.

An uncertain provider outcome keeps its existing “outcome unknown” wording. A configuration fault does not establish whether money moved.

The proposed experience is:

1. **Sign in to the dashboard.** A manager or administrator uses the existing dashboard login. An already authenticated eligible session suffices; repair introduces no separate password ceremony, repair token or special session.
2. **Open Repair time zone.** Offer the action beside the configuration fault in Venue settings and beside affected payment recovery rows. Show the venue’s identity and explain that the change affects the whole location, including future business-day calculations.
3. **Confirm the correct named zone.** A named zone, such as `Europe/Madrid`, supplies the rules for converting an instant into local time. Show the saved geography’s suggested zone as a selectable suggestion. Do not select or save it automatically. You may enter another supported named zone.
4. **Review and save.** Show the proposed local date and time, numerical offset, reporting business date, and retained day changeover. Require an explicit confirmation: “I confirm that this is the correct time zone for this venue.” Save changes only the zone, advances the clock revision and records the repair.
5. **Resume the recorded payment.** Return to the affected payment with **Resume recorded payment**. This finishes the existing capture rather than starting another payment. A bill’s existing background recovery may finish first; refresh then shows the saved invoice.

Saving the zone and resuming a payment are separate operations. A later invoice failure must not undo a successfully committed configuration repair. Before Save, disclose that existing background bill recovery can resume once the zone is repaired.

If another fault remains, name it and retain the payment for recovery. Offer no reset, database edit, guessed zone, second charge or automatic refund.

### Worked example: Madrid at 00:30

This is a hypothetical acceptance example, not a reproduced current-code failure.

At **00:30 Madrid on 15 October 2026**, corresponding to `2026-10-14T22:30Z`, a card payment is captured. Before an invoice exists, A696’s proposed strict validation finds an unusable saved zone.

You sign in, confirm `Europe/Madrid`, review the clock and save. Recovery issues the invoice at **00:45 Madrid**, corresponding to `2026-10-14T22:45Z`.

The expected facts are:

| Fact | Required result |
| --- | --- |
| Payment capture | Retains its original saved capture instant, corresponding to 00:30 Madrid. |
| New invoice | Uses the recovery issuance instant, with issue date 15 October. |
| New generation record | Uses the recovery instant and `+02:00`, giving `2026-10-15T00:45:00+02:00` in this example. |
| Payment amount and evidence | Retained; no second collection request. |
| Retry after completion | Returns the saved invoice and payment facts. |

If recovery instead issues at 10:00 Madrid on **16 October**, the new invoice uses 16 October and that issuance instant’s offset. It does not backdate issuance to the capture.

This specifies no new capture-time precision or stored capture-offset field. Preserve the evidence actually saved. The current recovery source reads `captured.settledAt` separately from the issuance reading (`apps/server/src/till-sale.ts:1639`, `:1659`, `:1690`).

## Decisions already fixed, and choices proposed here

**Owner decisions:** offer repair only for a genuinely missing or invalid saved zone; require a manager to sign in and confirm the correct named zone; retain capture and recovery evidence; never charge again; use recovery-time issuance; preserve settled replay and all historical fiscal facts. Valid-to-valid changes retain the normal settings locks. A444’s operation/service date remains separate.

**Design-author recommendations awaiting approval:** reuse `venue.configure` for repair and `payments.manage` for payment recovery; accept supported named zones with country-pack guidance; preserve every cutover row; record repair in the existing incident store; and accept the reporting consequence below. None is an already approved owner policy.

### Explicit approval needed: the reporting consequence

**Recommendation: restore the location’s single saved zone, retain its complete cutover schedule, and use the repaired clock for subsequent calculations, including newly requested historical reports.**

A business day is a reporting window between day changeovers, rather than an invoice’s calendar date. Current source combines one location zone with the baseline changeover and dated changeover rows (`packages/reporting/src/business-day.ts:171`). Historical query windows are calculated from the supplied clock (`:112`). Daily closes save their calculated snapshot (`packages/reporting/src/record-daily-close.ts:43`, `:68`).

Under this recommendation:

- Existing fiscal rows, invoices, tenders, recorded business-date labels, daily-close snapshots and hashes remain unchanged.
- `locations.day_cutover` and every `location_day_cutover_changes` row remain unchanged, including future changes.
- Newly calculated report windows use the repaired zone. Their grouping of old instants may differ from earlier calculations or frozen closes. A newly created close for an unclosed historical date also uses the repaired clock.
- Future service schedules and business-day calculations use that same repaired zone and retained cutovers. Repair introduces no invoice-only zone override.

An invalid zone supplies no usable old conversion to preserve. This proposal does not infer what zone earlier calculations used.

**Approve this disclosed reporting consequence as part of exact-design approval.** If historical recalculations must reproduce an earlier clock instead, keep the build parked for a separately approved historical-clock design. That is not a builder choice or permission to reconstruct history silently.

## Builder contract

### Authority and target

Repair reads, previews and writes require `venue.configure`; payment recovery requires `payments.manage`. The current permission map grants both to managers and administrators, neither to staff or supervisors (`packages/identity/src/permissions.ts:45`, `:57`, `:79`). Gate on permissions through `authorizeManager`, never role strings. It resolves the live session and current role (`packages/identity/src/manager-login.ts:162`); session resolution checks expiry and person status (`packages/identity/src/management-session.ts:60`).

Use the server’s configured writing node and its stored location association. Require agreement with the configured location and any referenced payment/order. The node-to-location seam is `packages/reporting/src/business-day.ts:209`. The browser supplies no node, location, actor, device or provider identity. Reject missing or inconsistent target rows; do not create them.

Keep the existing read-only node restrictions. Repair receives no exemption from the mirror/fenced write gate (`apps/server/src/boot.ts:1382`).

### Eligibility and validation

Read the saved field directly, without first requiring a successful business-day conversion.

| Saved configuration | Repair eligibility |
| --- | --- |
| Existing location with an absent/null zone value, empty string or whitespace-only string | Eligible as a missing zone. |
| Saved value rejected as an unsupported zone name, or resolving to a numerical offset such as `+02:00` | Eligible as an invalid zone. |
| Supported named zone, including a recognized alias | Ineligible, even if it differs from the country suggestion or the proposed replacement. |
| Named zone accepted, but offset formatting fails | Conversion fault; does not itself authorize changing the zone. |
| Invalid instant, unreadable database, missing table/column, node or location | Separate fault; ineligible for this repair. |

The current location schema declares the zone non-null with a default (`packages/db/src/schema/tenants.ts:82`). “Missing zone” here does not authorize rebuilding missing database structure.

Validate the proposed value as a nonblank string, normalize it, resolve it to the server runtime’s canonical named zone, refuse numerical offsets, and demonstrate usable conversion at the server’s finite preview instant. Distinguish an unsupported name from an unexpected formatter failure.

Country-pack geography supplies a suggestion, not the validity rule. Spain’s current source assigns Madrid or Canary names by administrative area (`packages/country-es/src/spain.ts:265`), while ordinary settings accept runtime-supported named zones (`apps/server/src/venue-details.ts:197`). A supported named zone outside the suggestion remains valid and cannot unlock repair. Choosing a zone changes no country, province, fiscal territory or module support.

### Narrow management routes and transaction

Proposed route: `GET /management-api/venue-details/time-zone-repair`, with an optional candidate `timeZone` query for preview, and `POST` on the same path for Save.

The POST accepts exactly:

- `timeZone`: proposed string;
- `expectedClockRevision`: nonnegative safe integer from the displayed context;
- `confirmed`: literal `true`.

Reject missing fields, wrong types and additional fields. Accept no generic `changes`, cutover, identity, payment amount, capture time, invoice date or force flag.

Use the existing management cookie and authorization boundary. Its cookie is `HttpOnly`, `SameSite=Strict`, with the existing caller-selected Secure setting (`packages/server-kit/src/management-cookie.ts:11`). Require JSON and an exact configured management Origin on the new write route, following the explicit origin-check pattern at `apps/server/src/content-suggestions-api.ts:84`. Do not describe the ordinary location settings route as already enforcing that check; its source entry is `apps/server/src/location-settings-api.ts:199`.

Inside one `withTransaction`, reauthorize, resolve the target, re-read the saved zone and clock revision, establish that the zone is still genuinely unusable, validate the complete candidate clock, then update the zone, advance the existing clock revision once, and insert its audit event. Await transaction queries sequentially. The transaction seam is `packages/db/src/tenancy.ts:30`.

A competing repair or ordinary valid-zone update must make the stale request refuse and refresh. A preview grants no authority to write. After a lost successful response, a repeated Save finds a valid zone and reports that repair is no longer needed; it neither changes that zone nor creates another audit event.

Ordinary zone edits retain their existing history locks, including orders, sales, closes and dated cutovers (`apps/server/src/venue-details.ts:95`, `:242`). The repair exception applies only to the unusable zone field.

### Retained cutovers and future clock consistency

Do not run repair through a generic settings save. Current general PATCH refuses a changed day changeover (`apps/server/src/venue-details.ts:206`); the dedicated dated-change writer can replace a pending cutover and advance the revision (`apps/server/src/business-day-start.ts:252`). Repair must perform neither operation.

Construct the candidate from the chosen zone and all existing baseline/dated cutovers. Validate their shapes and ordered dates, resolve the current business day, and check increasing boundaries around each retained cutover transition. Apply the existing service-period end-offset validation against the candidate (`packages/venue-service/src/menu-timetable.ts:259`). Do not compare against a fabricated “old” clock or silently skip a failed check.

A malformed cutover or incompatible schedule is a separate, named blocker. Repair changes no schedule to make validation pass. If resolving such a blocker requires additional repair authority, return that concrete dependency for owner approval.

Advancing `location_business_day_settings.revision` invalidates drafts opened under the broken clock. Schedule writes already compare that revision (`packages/venue-service/src/business-day-schedule.ts:485`). Refresh clock-dependent views after commit; do not cache the old setting or a numerical offset for future issuance.

### Recovery without another charge

The current whole-order stuck list selects `attempting` payments on open orders (`apps/server/src/payments-api.ts:923`, `:945`). Its resolve route also requires that state (`:983`). It is insufficient as the only entry for a payment already saved as captured.

Extend payment recovery visibility to retained, unassociated captures for walk-up, retrieved held and placed orders. Keep bill-payment recovery distinct. Show stored amount, order/device identification and available capture time; derive the recovery kind on the server.

Provide a recovery-only resume action. It accepts an existing payment identifier and no replacement financial facts. Re-read its associations and evidence under the transaction. Reuse the existing finalization behavior with collection structurally unavailable, following `withoutCollect` (`apps/server/src/payments-api.ts:192`), rather than relying on the button’s wording.

Current seams to preserve are:

- Whole-order orchestration selects capture recovery before collection (`apps/server/src/till-sale.ts:1114`, `:1253`, `:1275`).
- Recovery checks settled replay before acquiring a new issuance reading, then associates the existing capture (`:1631`, `:1639`, `:1696`).
- Bill completion retains payment receipt times while acquiring a separate invoice reading (`apps/server/src/bill-payments.ts:670`, `:683`, `:1223`).
- Background bill recovery reads saved provider evidence and retries completion (`apps/server/src/bill-payments-loop.ts:88`, `:167`); boot wires that loop at `apps/server/src/boot.ts:2364`.

Strict validation belongs before a new external capture and again in the transaction creating a new invoice. A post-capture failure retains the capture, order, attempt/reservation, provider resolutions and other committed recovery evidence. It produces no partial invoice or consumed number.

An already-settled replay returns saved facts before new zone validation, pricing or issuance, even when the current zone is broken. Authentication still applies. Concurrent till, manager and background recovery must converge on one saved invoice without duplicate payment, receipt or other completion effects.

Keep locked financial inputs and existing total, tip, VAT and mismatch rules. New issuance rates VAT from the same frozen issuance reading used for its date (`apps/server/src/issue-moment.ts:17`). Repair permits no amount adjustment or invented tip to force reconciliation.

Existing bill attestations remain separate: they require the manager’s own PIN and note, and refuse contradictory evidence (`apps/server/src/payments-api.ts:1181`). Repair is not an attestation. Preserve committed attestation evidence; if its completion transaction rolls back, do not claim that the entered attestation was saved. Retain its draft for retry under the existing form rules.

### Audit and interface

**Recommendation: reuse the existing incident store; add no repair table.** Insert one immediately handled warning event, proposed code `venue.time_zone_repaired`, in the repair transaction. Record the authorized actor, server time, node/location, old-value category and fingerprint, new canonical zone, and before/after clock revision. The fingerprint identifies the replaced field without copying arbitrary invalid text into logs; it is unrelated to fiscal hashes.

Set `acknowledgedAt` and `acknowledgedBy` on this event at insertion so each committed repair remains a distinct handled record. Ordinary open-incident deduplication is keyed without location or arbitrary parameters (`packages/db/src/schema/incidents.ts:64`), and must not suppress successful repairs. Incident preservation is an application convention, not database-enforced immutability (`:14`).

Register the code, area permission and English/Spanish wording. Keep credentials, cookies, PINs, provider secrets, raw request bodies and arbitrary invalid-zone text out of logs and error parameters.

Use existing field primitives, a semantic `timeZone` input, required confirmation, `draftScopeFor` and `saveActionState`. Save starts quiet and disabled until edited. Follow design-system Forms for field errors, the bottom message, focus, Enter and unsaved changes. A server refusal alone does not disable retry. Close after a committed save; show a subsequent refresh failure as a load failure. Session exit clears sensitive attestation drafts.

## Protected boundary and approval gate

Repair changes no historical invoice or fiscal date, offset, hash, number, predecessor, record or numbering state. It introduces no fiscal correction workflow and leaves A444 separate.

H2 remains unchanged (`~/waitron-campaign-e/RUNNER.md:85`). This supplement authorizes no edits to protected fiscal writers, alta builders, `computeHuella`, chain logic, allocation, `registros_facturacion`, `registerSif` or `restoreFiscal`. Protected golden huella and `inmutabilidad` checks remain unedited.

The proposed recovery seam supplies a prepared clock to existing issuance calls; core currently reads that supplied clock (`packages/core/src/record-sale.ts:275`). Runtime feasibility remains unverified. If preserving financial facts or completing any required path needs a protected change, park that dependency with the exact file and required change for owner approval. Do not weaken a refusal or change financial facts to avoid H2.

## Acceptance contract

These are requirements for the later approved build, not executed results.

| Case | Required observation |
| --- | --- |
| Roles and session changes | Manager/admin permissions allow repair; staff, supervisor, expired, suspended and revoked sessions refuse. Recheck authorization at write time. |
| Eligibility controls | Blank, missing-value, unsupported and numerical zones qualify. Valid named zones and aliases never qualify, with or without history. Formatter, instant and structural faults remain distinct. |
| Request boundary | Extra fields, forged targets, absent/foreign Origin and malformed payloads change nothing. Mirror/fenced nodes retain their write refusal. |
| Madrid example and later day | Capture remains at the saved original instant; issuance uses actual recovery time and its zone offset in both UTC and Madrid processes. No collection call occurs. |
| Recovery families | Walk-up, held/placed and bill captures remain discoverable after failure/restart. Known captures resume without provider collection; uncertain outcomes retain existing checks and attestation requirements. |
| Replay and races | Broken configuration does not prevent settled replay. Competing repairs, ordinary zone updates and till/manager/background completion produce no overwrite, duplicate invoice, audit event or completion side effect. |
| Retained history and clock | Compare all historical fiscal/payment/close rows and every baseline/dated cutover before and after. Only the zone, revision and repair audit change. Old schedule drafts refuse; future calculations observe the repaired clock. |
| Reporting policy | Frozen closes remain identical. Recalculated historical windows and new closes follow the explicitly approved repaired-clock policy, without claiming agreement with earlier calculations. |
| Failure and evidence | Inject failure after capture and during local finalization. Retain committed capture, resolution, attestation and reservation evidence; no partial invoice or number advance. A failed audit insert rolls back repair. |
| Interface and audit | Inspect EN/ES, both themes and phone/desktop. Confirm explicit zone choice, errors, unsaved edits, lost responses, background completion and refresh failures. Audit and logs contain no credentials. |

Exact-design approval must include the reporting policy and proposed permission/workflow choices above. The implementation plan and build require their later approvals.