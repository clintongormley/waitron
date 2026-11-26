# O1a and O1b. The venue's other card machines, kept on the dashboard · PLAN FOR APPROVAL

Part of [lane O's payment plan](2026-11-26-o-till-payment-after-pay.md). What a manager can do once
both land: on the dashboard's card readers page, add, rename and remove the venue's other card
machines (the ones Waitron is not paired with), each with a name and where its payments go, "SumUp
account" or "Another bank". Staff see the list from O13, where the till's Other card machine screen
offers it as a dropdown ([spec §7.9](../specs/2026-11-26-till-handheld-redesign-design.md#79-pass-3-the-ways-to-pay)
and §13: "a new venue list on the dashboard's card readers page (name, and where its payments go),
read by the till"). Neither PR changes a till file, so neither collides with lane I's PR 15.

A Claude read found the first version about twice its estimate, so it is two PRs of about three
hours each. Its precedent is #4088, which added the tips switch the same way.

## O1a. The list on the server

1. **Stored in the payments settings document**, no table and no migration
   (`packages/payments/src/settings.ts:13-46`). It gains `otherCardMachines`, a list of
   `{ id, name, paysInto }` (`paysInto` is where its payments go: `"connected_account"` or
   `"other"`), empty by default. The document's own check refuses anything else and stays as a
   backstop, because the till's start read loads this same document (`apps/server/src/till-setup.ts:120`).
2. **Two management routes** beside the existing payment settings ones, through the same `gated`
   check (`hardware.manage`, held by managers): `GET /management-api/payments/other-card-machines`
   answers the list and the document's save counter (its `revision`, which catches two people
   editing at once); `PUT` takes the whole list and that counter, keeps every other key of the
   document as the settings PUT does (`apps/server/src/payments-provider-settings-routes.ts:69-76`),
   gives a new machine its id on the server, and answers the saved list. The PUT checks the request
   itself before saving and refuses with `management.request_invalid` naming the row's field
   (`otherCardMachines.<index>.name`) for a blank name, one over 60 characters (proposed), a name
   repeated (ignoring case and spaces at either end), another `paysInto`, or an id that is not
   already stored. Without that check, a bad name would come back as a server error
   (`settings.invalid`, which `apps/server/src/payments-api-errors.ts:23` answers as 500).
3. **Both choices are always accepted.** A machine can say "SumUp account" while SumUp is not
   connected (after a disconnect, or from an imported configuration); O13 then records "other", as
   the till does today (`apps/till/src/widgets/outside-card.ts:18-30`).
4. **The till learns the list from its start read**: `readTillSetup` answers `otherCardMachines`
   beside `sumUpConnected` (`apps/server/src/till-setup.ts:120-145`). Its revision is a hash of the
   whole answer, so a change reaches open tills by the existing refresh; no new till route.
5. **The configuration export carries the list** (`transfers`, beside `tipsEnabled`), so the
   export format moves from 61 to 62 (`packages/provisioning/src/configuration-transfer.ts:587-590`), and every pin of 61 moves with it, as #4088 did for 56 to 57. An export in format 61 is then
   refused as out of date (`setup.configuration_outdated`, `:590`), as every format change before
   go-live does.

Tests first: `packages/payments/src/settings.test.ts` (each refusal, the empty default, a stored
document without the key reading as an empty list); `apps/server/src/payments-api.test.ts` (GET and
PUT, other keys kept, a stale counter refused, someone without `hardware.manage` refused, each field
refusal naming its row, ids given on the server); `apps/server/src/till-api.setup-revision.test.ts`
(a changed list changes the till's revision); the configuration transfer suites (the list travels). About 150 lines of product code and 250 of tests.

## O1b. The list on the dashboard

A new small file `apps/dashboard/src/screens/other-card-machines-panel.ts`, on the card readers page
under the readers table, beside the payment settings panel (`apps/dashboard/src/screens/payments-screen.ts:2574`).
There is no approved picture; it follows `design-system.md` → Forms:
- a heading "Other card machines" and a muted line saying what they are for;
- one row per machine: the name (a field primitive), "Where its payments go" (a select, both choices
  always offered; a row saying "SumUp account" while SumUp is not connected gets a short muted note
  that its payments are recorded as another bank's), and Remove at the row's end;
- "Add a machine", and Save, quiet and disabled until the draft changes (`draftScopeFor`,
  `saveActionState`, the save handler's early return); field refusals under their field, one bottom
  message for any other refusal; leaving with unsaved changes asks.
- The list's read joins the dashboard's live updates (`QUERY_DEPENDENCIES` with
  `["settings.payments"]`, `apps/dashboard/src/api/live-queries.ts`). The tips panel saves the same
  document, so after a save there the list takes the new counter without losing an edit in
  progress, as #4088's panel does.

English and Spanish strings; the guide's `{#card-readers}` section
(`apps/server/src/guide/en/printers.md:141` and its Spanish twin) gains a short paragraph. Tests:
the panel's `*.test.ts`, `*.unsaved.test.ts` and `*.a11y.test.ts` in both themes. About 200 lines of
product code and 250 of tests. Pictures: phone and desktop widths, light and dark, English and
Spanish, to the watcher.

Both PRs: full review with two run-it reviews (payments). Lane O lands both: they issue and file
nothing.
