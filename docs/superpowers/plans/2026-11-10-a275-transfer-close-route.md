# A275 Task 3: the till can call close-by-transfer (route, device permission, recovery read)

**Status: cleared by the watcher 2026-11-10 12:48 (lane L `questions.md`); built on `feat/a275-transfer-close-route`.** Tasks 0–2 landed as #2664
(`959b1cd89a`): `closeBillByTransferTx` in `apps/server/src/transfer-close.ts` issues or reuses the
invoice and closes the whole bill as **to be paid by transfer**, but nothing can call it yet.

## Authority

- Design approved by the owner 2026-10-22 15:55 ("A275 looks fine";
  [design](../specs/2026-10-22-a275-final-transfer-close-design.md)); H2 build scope "Yes" 2026-10-22
  ~17:20 (lane L `queue.md`, A275). Task 3 is the
  [master plan's Task 3](2026-10-22-a275-final-transfer-close.md#task-3-enforce-access-and-finish-the-party-only-when-ready);
  this file cuts it to today's code.
- **Owner 2026-11-09 21:39** (watcher relay, lane L `questions.md`): Task 3 also makes (a) column
  `intent` → `fingerprint`; (b) the request id is `submissionId`, as the till uses, not
  `operationId`; (c) `actor_id`'s foreign key declared in the TypeScript schema. (d), a shared "no
  money on a closed business day" rule, stays an idea.
- A1308 §8 ([rules](2026-11-08-a1308-slice-rules.md#8-other-work-beside-a1308-owner-2026-11-08)): a
  schema change in an area A1308 has not reached lands before that area's slice starts. Orders and
  sales (os1–os11) has not started (lane H's lane 1 is at slice 5b, 2026-11-10); this plan rechecks at
  build start and stops if it has.

## What it delivers

Still nothing staff can use: the till has no button until Task 7 (after A739's pay screen lands in
lane F). After this task a signed-in person with permission to take payment (`payment.take`), on a device whose
profile has the new **Close by transfer** action switched on, in a zone that covers the bill, can
close the bill through `POST /api/working-orders/:id/close-by-transfer`, and any device that may read
the bill can ask `GET /api/working-orders/:id/transfer-closure` whether and how it was closed (so a
till that lost the answer recovers it). The dashboard's device-profile editor shows the new action,
off by default.

## Changes

1. **Owner a–c (schema; rebuild, never a hand edit).** In `packages/db/src/schema/transfer-closures.ts`:
   rename `intent`/`"intent"` to `fingerprint`/`"fingerprint"`; declare `actorId` with
   `.references(() => persons.id, { onDelete: "restrict" })` as `outgoing-mail.ts:61` does, and delete
   the "No key yet" sentence. Rebuild core's starting migration with
   `migration-baseline rebuild --set core`. The venue resets (first line of the PR). In
   `transfer-close.ts`/`transfer-close-types.ts`, `operationId` becomes `submissionId` in the request,
   the stored result (`TransferClosureResult` in the schema file) and every read; the digest function
   and its variables say `fingerprint`. Only these files: about 875 other `operationId`s belong to
   other features, so never a global replace. Nothing in SQL reads inside the stored result, so the
   venue reset is all the field rename needs. No behaviour changes: Task 2's three server suites pass
   with only the renamed names in their inputs and assertions (named in the PR as changed test checks,
   owner rule 2026-10-05: the owner's answer changes what they name).
   `packages/db/src/schema/transfer-closures.test.ts` inserts with a made-up person id
   (`:17`); the new key refuses it, so that suite's fixture gains a real `persons` row (a fixture
   gaining what it lacks, no assertion changed; named in the PR). The backlog entry
   (`docs/backlog/fiscal.md:346`), the design and the master plan get a dated pointer naming the new
   names rather than a rewrite.
2. **The device action.** Add `"close-by-transfer"` to `CAPABILITY_FLAGS` and `PROFILE_ACTIONS` in
   `packages/layouts/src/device-types.ts`, its mirrors in `apps/dashboard/src/device-profile-types.ts`
   and the till's `apps/till/src/layout.ts:40–53`, and the profile editor's list with English and
   Spanish wording. Not in any default or starter
   profile, and not on a shared-display profile; existing stored profiles do not gain it.
3. **POST route**, in a new `apps/server/src/transfer-close-api.ts` mounted from `till-api.ts`, built
   like the money routes, not like `unpaid-departure-api.ts` (which re-checks nothing inside its
   write): `requireSession(deps, c, { permission: "payment.take", action: "close-by-transfer" })`
   (`till-session.ts:148`), a strict body parser (unknown fields refused, `invalid(...)` per field),
   then `withIssuanceTransaction`. `requireSession` checks in its own transaction before the write
   queue (`till-session.ts:184`) and `withIssuanceTransaction` re-checks nothing
   (`packages/core/src/incidents.ts:35–36`), so **inside the write, before `closeBillByTransferTx`**,
   repeat what bill payments, tender refunds and department transfers repeat
   (`bill-payments.ts:1121`, `tender-refund-api.ts:57–68`, `department-transfer-api.ts:43–53`): the
   person still signed in, the device still proven and its profile still allowed, the person's
   `payment.take`, the profile's `close-by-transfer`, and `checkZones` on the bill; build `cfg` from the
   device read there. Then call `closeBillByTransferTx`; the route's checks, before the queue and inside the
   write, run before it is called, so a revoked person or device is refused before any replay lookup. The route supplies `admitPartyRelease`: the person and device may release
   a party only with `take-orders` and scope over every affected order (`"authority"` /`"scope"`
   otherwise). The disk read before the queue follows `bill-payments.ts:1236`, passed as
   `diskBlockedBeforeQueue`. Status map (`till-api.ts:431`): `transfer_close.ineligible`,
   `.conflict`, `.day_frozen` → 409 beside `submission.id_reused` (`:619`). Their English and Spanish
   wording already exists in both apps' `i18n/codes.ts`.
4. **GET recovery read**, same file: `{ closure: CloseByTransferResult | null }` from
   `readTransferClosure`; 200 with `null` for a bill not closed, `working_order.not_found` for none.
   Session, device and zone read scope as the bill's own read; no `payment.take`, no
   `close-by-transfer`, passive request; it adds no sale or closure and stamps no device sighting.
5. **Till client.** `apps/till/src/api/transfer-close-types.ts` (browser-safe copies of the request
   and result) and `closeByTransfer` / `getTransferClosure` in `apps/till/src/api/client.ts`, with a
   client test of both shapes. No screen.

## Tests (red first; `useVenueDb`; implementer dispatches at medium)

2026-11-10, as built: review cut six cases from `transfer-close-api.test.ts`, because each repeats a
check tested once elsewhere (lane L's 14:06 deviation and the watcher's 14:10 answer, lane L
`questions.md`, under the owner's 2026-11-09 test rule): the close's no-session, ended-session,
switched-off-device and profile-without-the-action refusals below, and the read's no-session and
out-of-zone answers. The sign-in step's own suites
(`till-session.*.test.ts`), the route inventories (`till-api.profile-actions.test.ts`,
`till-api.profile-zones.test.ts`, `till-api.session-person.test.ts`) and the revoked-while-queued
cases cover them.

- `apps/server/src/transfer-close-api.test.ts`: refusals each beside an allowed control differing in
  one fact: no session, expired, suspended person, inactive device or profile, missing
  `payment.take` (every role holds it, so through an `authorize` stand-in as
  `take-payment-permission.test.ts:26–40` does, adding this route there), profile without the action
  (a real stored profile, not a stub), wrong zone,
  malformed body, unknown field, null where a value is required; and **revocation while queued**:
  the person signed out, the device switched off, and the action removed from the profile while the
  request waits behind a held write, each refused with nothing written. Each refusal asserts the
  domain code and that no sale, invoice number, closure row or outbox row was written. Allowed: a seated bill and a
  Counter bill close and the GET returns the same result; another authorised device reads it, and a
  different person sending the same submission id is refused `submission.id_reused`
  (`transfer-close.replay.test.ts:271`). Party: two bills of one party, the first closes and leaves the party open with blockers,
  the second releases it; release refused for a device without `take-orders` (`authority`) and for a
  sibling order outside the zone (`scope`), the bill still closing.
- The inventories root CLAUDE.md §3 names: rows for both the POST and the GET in
  `till-api.profile-actions.test.ts` (its walk compares every mounted route with its list,
  `:750–772`) and a refusing case for the POST; a row in the zone table
  (`till-api.profile-zones.test.ts:187`) and a refusing case. `till-api.session-person.test.ts`
  needs no `BODIES` entry: `requireSession` runs first. Error wording guards:
  `scripts/errors-reachable.test.ts`, `scripts/alert-codes.test.ts`; till and dashboard
  `i18n/codes.test.ts`.
- Profiles: `packages/layouts/src/device-types.test.ts`, `device-profile.test.ts` and the dashboard
  device-profiles screen test: the action is listed, off by default, saved when switched on.
- Read-only boots: nothing to add. The gate is one filter on every write method
  (`read-only-gate.ts:20–26`) installed before the till routes (`boot.ts:2019` against `:2302`).
- Schema: `scripts/schema-constraints.test.ts`, `append-only-triggers`, `behavioural-triggers`,
  `starting-migrations`, `two-file-foreign-keys`, `classification-complete`; the transfer-closures
  schema test gains the `actor_id` key refusal (an unknown person refused at insert).
- Unchanged: golden huella and `inmutabilidad`
  (`pnpm --filter @waitron/fiscal-verifactu exec vitest run src/write-path.e2e.test.ts` and
  `… inmutabilidad`), Task 2's three transfer-close suites (renames only), `unpaid-departure` and
  `finish-party-service` suites. Typecheck server, till, dashboard, layouts, db.
- One-time deletion controls, recorded in the PR, not committed: drop the in-write profile-action
  re-check, the in-write sign-in re-check, the zone check, and the `admitPartyRelease` scope check;
  each fails its test.

**Implementer dispatches** (each well under 100 tool calls, committed at a passing point): (i) the
a–c schema changes and renames; (ii) the device action, editor and till list; (iii) the two routes,
in-write re-checks and inventory rows; (iv) the till client.

## Size

About 400 production lines (route, parser and in-write re-checks ~220, renames ~40, action lists
and editor ~50, till types and client ~80, status map ~10) and about 1,050 test lines (Task 2's three
suites came to 1,250); generated migration files counted separately. Stop for an outside opinion
past about 1,800 written lines or tests past about two and a half times the code.

## Left out

The till button, screen and printed paper (Task 7, after A739); reports, close of day and export
(Tasks 4–6); the shared closed-day money rule (owner's (d)). No change to `closeBillByTransferTx`'s
behaviour, the invoice writer, numbering or any fiscal record.

## For the watcher

1. **Route now, or the schema changes alone now?** Staff gain nothing until Task 7, which waits on
   A739 in lane F. Building the route now means keeping its inventory rows and fixtures current
   through A1308's renames before anyone uses it. The simplest alternative meets the owner's a–c
   alone: change 1 by itself (about 300 lines with the renamed tests) lands now, before A1308's orders
   and sales slice reaches this table, and changes 2–5 are built with Task 7. I recommend the full
   task now, as one owner-landed PR: the hidden route was allowed on 2026-11-01 (Task 2's plan), and
   it lets Task 7 be only the screen.

**Plan review, 2026-11-10 (fresh-context Opus, lane L, reading and grep only).** Its two high
findings (the permission is `payment.take`; the template route re-checks nothing inside the write, so
the master plan's in-write re-checks and revocation-while-queued test are restored) and its medium and
low ones (the schema test's made-up person, dispatch split, inventory rows, read-only gate, disk
pattern, existing wording, stale names, the till's action list) are written into this revision.
