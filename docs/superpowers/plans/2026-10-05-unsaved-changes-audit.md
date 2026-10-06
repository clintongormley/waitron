# W69 editable-form inventory

## 2026-10-06 advancing Hours owner audit

Hours #1298 is included in the candidate after the rebase onto `ac861b774d9d368d8435b0b06f1467ef89f9386e`.
It retired `station-hours-form` and the old hours APIs. The baseline row and earlier station-hours
receipts below are historical; they do not establish protection of the replacement editors.
The obsolete W69 component suite was removed with its component. The remaining prep-station
fallback, exception and watcher protection stays in the candidate.

Current source owners in `packages/venue-service/src/dashboard/hours-screen.ts`:

| Owner | Draft and leave boundary | Existing suites; W69 work still required |
| --- | --- | --- |
| Weekday cell | `Editor.kind=cell`: selected mode and ordered periods; Cancel/native Escape, ancestor leave/unload. | `hours-screen.test.ts`, `hours-cell-editor.test.ts`, `hours-screen.unsaved.test.ts`; weekday protection implemented and checked below. |
| Configure hours | `Editor.kind=configure`: seven ordered day drafts. The confirmation stage shares this draft; Back from that stage retains it. | `hours-screen.test.ts`; protect actual dismissal, not the confirmation-stage Back. |
| Special-date Add/Edit and calendar Create/Edit/Close venue | `Editor.kind=date`: date, trimmed name, colour, whole-venue closure and each shown subject cell. Hidden/stored cells travel with the opening. | `hours-screen.test.ts`, `hours-calendar.test.ts`; keep invalid raw input and commit the captured date payload. |
| Special-date Duplicate from list/calendar | `Editor.kind=duplicate`: ordered target dates; source/cells identify the opening. | `hours-screen.test.ts`, `hours-calendar.test.ts`; protect target entry through dismissal/ancestor leave. |
| Clear standard week/Delete special date | Safety confirmations without edited values. | Existing direct cancellation remains exempt. |
| Week/Dates/Calendar tabs, inactive filter, month navigation | View controls; `#url` restores views and calendar emits actions to the same date editor. | Do not mark filters dirty; intercept replacement before removing an edited owner. |

The weekday-cell owner is now registered against the canonical `wire` cell, comparing its
mode and ordered period IDs/times by values. Cancel/native Escape and another editor opening
ask through the shared registry. A successful write commits the captured cell before refreshing;
newer input stays dirty. Disconnect removes unload protection and invalidates the question/write
generation; reconnect registers the retained draft against its original baseline and redraws its
controls. Clear/Delete confirmations stay exempt. Configure/date/duplicate still lack scopes.

The five Hours checks formerly generated in `venue-operations-screen.unsaved.test.ts` are now in
`hours-screen.unsaved.test.ts`: Keep/Discard with native Escape and actual input, clean/revert,
exact submitted request with a failed refresh, refusal retains dirty input, and direct Clear
cancellation without a write. The new body is `HoursApi.saveWeek`'s seven-day request, retaining
all unchanged days and the edited period ID. The other venue assertions are unchanged. Added
cases cover newer input, reconnect, departed replies/controls, period property order and guarded
replacement. The first weekday run observed two expected failures; lifecycle and replacement
runs observed additional assertion failures before their guards were implemented. Intermediate
bad API usage and callback identity diagnostics are retained separately rather than called RED.

The focused final family passed 173 cases across five suites. Four separately mutated installed
candidate checks each failed their intended assertion while Clear's control passed; restoring
that candidate passed 11 cases, and its four source/test files byte-matched the feature tree before
removal. Eight rendered EN/ES/light/dark/390/1280 flows passed 16 scoped axe scans; their 16 captures
were inspected in four contact sheets. Local receipts: Lane E `receipts/w69-reorientation-20261006-next`.
These scope tests do not establish every Hours owner, page navigation, browser native reload or
current-head CI. The temporary visual renderer supplies the shell's ES confirmation wording;
it is a component-host inspection, not an end-to-end dashboard shell flow.

Tasks 1/4 remain partial; this inventory adds owners rather than marking them protected. Task 5
remaining direct writers/till/setup shells and Task 6 page/setup owners remain pending.


## 2026-10-06 dashboard logout and language checkpoint

Dashboard voluntary logout and a language change now request the shared coordinator before their
API calls. `dashboard-app.unsaved-changes.test.ts` mounts the real profile editor and dispatches the
shell actions with its telephone field edited. The language cases additionally register a test-only
input inside the departing main screen; they do not stand in for individual page-owner tests.
Keep preserves the selected inputs and URL; Discard restores the departing inputs before accepting
the original action once. A language change leaves the profile editor and its telephone value
mounted, so that owner is explicitly excluded. The suite checks concurrent attempts,
reverts, successful child saves, coordinator reset, forced expiry, disconnect and reconnect, and
late logout/language responses. These profile-based shell cases do not establish every page owner
or a pointer click through a modal backdrop. The sidebar/link/history and other app shells remain
unwired.

`LeaveRequest.scopes` now also accepts `"all"` for an action that leaves the entire application.
An explicit ID list retains its scoped meaning, and `[]` still selects nothing. The optional
`except` ID list retains those owners and their descendants. Core tests cover
independent roots and descendants, clean/reverted scopes, one restoration per dirty owner and
invalidation after an affected owner changes, commits, disposes or registers. Retained-owner
changes and new retained descendants leave another page’s question valid. The shell uses `[]` when
you choose its current language, because persisting that preference does not recreate the screen.
An explicit login language choice still increments its existing choice generation even when the
language is already active, so a pending browser-default response cannot overwrite your choice.

The final dashboard/profile family ran 460 cases; the final coordinator run passed 45, with focused
coverage of `unsaved-changes.ts` at 100% statements/lines/functions and 96.36% branches. Thirteen
independent installed-clone deletions failed their intended case while a clean control passed;
restoring the clone passed 17 shell and 45 core cases. Sixteen visual flows passed 32 scoped axe
scans in EN/ES, both themes and 390/1280 px; their 32 final captures were inspected. UI consumers
passed 48 cases, the packed core consumer passed one, and the unedited fiscal pair passed 20.
Three types, scoped lint, formatting and diff checks passed. This is focused evidence, not
package-wide coverage or current-head CI. The two added lifecycle tests cover duplicate disposal
without unregistering a replacement and an abort after accepted asynchronous work starts; each
also failed its intended deletion control.

Logs, installed-clone deletion controls and visual captures are retained locally under Lane E's
`receipts/w69-shell-actions-20261006`. This checkpoint supersedes the logout status in the earlier history receipt. The shared history
and remaining owner audit described below
are still incomplete W69 work. No existing test assertion changed in this checkpoint.

## 2026-10-06 shared history checkpoint

`NavigationGuard` and opt-in `UrlStateController` integration are implemented on the W69 branch.
The application shells have not enabled the adapter. Their direct route mutations, links,
signout, page/setup owners and native reload remain Task 5/6 work. The focused browser suites
are `packages/ui/src/navigation-guard.test.ts` and `url-state.unsaved.test.ts`; they use the real
coordinator and exercise indexed/unindexed Back and Forward, retained routes, stale answers,
multiple controllers and rapid traversal. Two deliberately delayed replay-report cases use
synthetic popstate reports; they do not establish browser scheduling by themselves.

The observed first run failed four route assertions before implementation. The abandoned-request
core case then failed its renderer-abort assertion. A later double-disposal case failed because
the old adapter rewrote the replacement's namespace; its lifecycle gate made it pass. Five
independent installed-clone deletions each failed one intended assertion while one unchanged
control passed. Restoring that clone passed 39 UI and 33 core cases. The driver’s focused UI
family passed 48 cases; coverage scoped to the adapter and URL controller reported 99.44% statements,
100% lines/functions and 98.26% branches. This is focused evidence, not package-wide coverage or CI.
Logs and controls are retained in Lane E's local `receipts/w69-history-20261006` directory.
The unchanged dashboard, till and setup shell suites passed 323, 672 and 332 cases respectively.
The packed ui-core consumer passed its independent browser check, all five affected package/app
typechecks passed, and the unedited fiscal golden-write/immutability suites passed 20 cases.

`LeaveRequest.signal` is an optional cancellation source for the adapter's decision phase.
Abandoning navigation aborts its question without restoring registered drafts. The adapter’s
generation also prevents a late continuation changing the route. Existing requests omit the
signal and retain their original scope rules. The new cancellation cases are in
`packages/ui-core/src/unsaved-changes.test.ts`; no existing assertion changed.

Lane C’s `feat/venue-hours` diff adds a dated note to this inventory and the implementation plan:
its Hours page replaces `station-hours-form`. That branch was not landed at this checkpoint.
Keep its worktree unchanged and reconcile the new editor owners against main when it lands.
The final advancing-owner audit and shell/page rollout remain pending; neither proposed W69 PR
is ready for finish-branch.

Rebased 63 commits over main `f048de959`: two patches needed conflict resolution. The Menu suite
retains both A291's reset-refusal cases and W69's selection cases. Catalogue markup retains A279's
contents-question gate and W69's connected/busy/change handlers. The combined three-suite run
passed 553 cases. A new catalogue case then failed at unload protection after fresh counts hid
the contents choice. The dirty reader now uses the same effective choice as the delete request;
a summary change updates its registry notification. The final catalogue pair passed 197 cases.
No existing assertion changed. Logs: `rebase-consumers.log`, `hidden-choice-red.log` and
`hidden-choice-green.log` in the same local receipt directory.

Baseline: `5597e06923b64acacf9df54ed6e8fb42e7fa411e`, inspected 2026-10-05 in the W69 documentation worktree. This inventory records **observed source owners** and **proposed protection**. None of its rows is a claim that a browser behavior was run or verified. Read it with the [design](../specs/2026-10-05-unsaved-changes-warning-design.md) and [implementation plan](2026-10-05-unsaved-changes-warning.md).

2026-10-06 implementation checkpoint: Product Add/Edit and its nested Variant form now register
scopes on the W69 branch. The cross-owner suite
`apps/dashboard/src/widgets/product-editor.unsaved.test.ts` covers Cancel/Escape, Keep/Discard,
reverts, comparison ordering, child saves and the Catalogue write/refresh boundary. Unit Add/Edit,
Related Unit and explicit Product colour forms are also wired; their new cross-owner suites
cover close decisions, submitted-value commits and parent/child boundaries. Category colour
selection is an automatic-save exemption, reconciled below against the current source. The remaining
modal rows and all page/navigation rows below remain pending; shared APIs alone do not complete
them. Follow the [W69 backlog entry](../../backlog.md) for the current rollout boundary.

2026-10-06 selection-owner checkpoint: Add-to-menus and section Add products now register their
selected ID sets on the W69 branch. Search and category filters stay exempt, with hidden selections
retained. Section additions commit before close/refresh; partial placement clears only successful
destinations. `apps/dashboard/src/widgets/menu-selections.unsaved.test.ts` and the Catalogue/Menu
screen suites exercise the close and write boundaries. Replacement, layout and the remaining
modal/page owners are still pending.

2026-10-06 staff-create checkpoint: Add staff's normalized details and role now register a scope
on the W69 branch. Cancel/native Escape, Keep/Discard, normalized reverts, pending/refused writes,
submitted commits before refresh and delivered newer input are exercised in
`apps/dashboard/src/widgets/person-form.unsaved.test.ts` and
`apps/dashboard/src/screens/staff-create.unsaved.test.ts`. Edit staff and credential subforms in
the staff row below remain pending; this checkpoint covers creation only.

## 2026-10-06 retired Printing rules owner

A261 step 8 removed the Printing rules page in [#1288](https://github.com/clintongormley/waitron/pull/1288),
main `822d242f499a64dfed359ef52a2c41f6f43609a7`. The baseline's `DS printing-rules-screen`
row below is historical: it has no remaining form or suite to cover. Its bookmark now goes to
Prep stations Tickets with manage permission, Prep stations Stations with read-only permission,
or Overview when the module is unavailable. The existing
`apps/dashboard/src/dashboard-app.test.ts` retirement cases exercise those three destinations
and assert that neither the old navigation entry nor the page is drawn.

Keep the surviving station/watch forms, department/zone receipt settings and printer calibration
in the inventory. The retired location drawer policy adds no draft; device/profile/printer gates
and the manual drawer command retain their own behavior. This reconciliation does not complete
bill payment, collection, the other pending modal owners or page/navigation protection.

## 2026-10-06 table-dialog checkpoint

The table screen's send-preview bill choice and serving count now register separate child scopes.
`apps/till/src/screens/till-table-order-screen.preview-unsaved.test.ts` and
`apps/till/src/screens/till-table-order-screen.serve-unsaved.test.ts` exercise Back/native Escape,
Keep/local Discard, unchanged/reverted entry, direct Confirm, reconnect, child close reports and
replacement openings. Confirm retires its scope before emitting the existing command. These
suites use the real table screen, shared coordinator and native dialogs.

The preview's station choices and Remove action already change the retained party draft through
`setLineMakeAt` and `removeLine`; the new suite checks that Back retains those changes without a
second warning. Discard of the separate bill choice does not restore or delete party draft lines.
Page-level destination/join selections and inline split/transfer remain for Tasks 5–6; this
checkpoint does not mark the whole table-screen inventory row complete.

## How to reproduce discovery

Run each command separately and inspect its exit status. The broad search deliberately includes helpers before classifying their owners.

```sh
git rev-parse HEAD
rg --files apps/dashboard/src apps/till/src apps/setup/src packages
rg -n 'wt-modal|wt-dialog|wt-form-actions|<form|wt-input|wt-textarea|wt-price-input|wt-combobox|wt-number-stepper|wt-switch' apps/dashboard/src apps/till/src apps/setup/src packages --glob '*.ts' --glob '!*.test.ts' --glob '!*.test-helpers.ts'
rg -n 'save|submit|draft|cancel|close|focusout' apps/dashboard/src/screens apps/dashboard/src/widgets apps/till/src/screens apps/till/src/widgets apps/setup/src/screens --glob '*.ts' --glob '!*.test.ts'
rg -n 'new UrlStateController|history\.|popstate|setup-goto|setup-patch|logout|session\.required|session\.expired' apps packages --glob '*.ts' --glob '!*.test.ts'
rg -n 'save|submit|draft|persist|flush|dirty|close' apps/till/src/state apps/till/src/till-app.ts --glob '*.ts' --glob '!*.test.ts'
rg -n 'dashboard|contribution|register' packages/dashboard-modules/src/index.ts packages/venue-service/src/dashboard packages/media/src/dashboard packages/bookings/src/dashboard packages/adjustments/src/dashboard packages/payments-sumup/src/dashboard packages/payments-stripe/src/dashboard --glob '*.ts' --glob '!*.test.ts'
rg -n 'wt-dialog|wt-modal|wt-close|\.open=|\.open =' apps packages --glob '*.ts' --glob '!*.test.ts'
rg -n '\bW69\b|Warn before' docs/backlog.md
```

Search hits are candidates, not forms. Owners were classified by their draft initialization, submit/event handlers, containing shell and close routes. The module registry names media, bookings, venue-service and adjustments; payment panels additionally come from SumUp and Stripe. Render helpers, table cells and nested children are attributed to their write owner below. The last command found no matching W69 backlog row, so this assignment does not edit the backlog.

## Reading the tables

Path prefixes expand literally: **DS** = `apps/dashboard/src/screens/`; **DW** = `apps/dashboard/src/widgets/`; **TS** = `apps/till/src/screens/`; **TW** = `apps/till/src/widgets/`; **SS** = `apps/setup/src/screens/`; **VS** = `packages/venue-service/src/dashboard/`; **MD** = `packages/media/src/dashboard/`; **BK** = `packages/bookings/src/dashboard/`; **AD** = `packages/adjustments/src/dashboard/`; **SU** = `packages/payments-sumup/src/dashboard/`; **ST** = `packages/payments-stripe/src/dashboard/`.

Every named owner has the `.ts` extension. In the Test column, a named sibling has the `.test.ts` extension and is the exact owning suite path after expanding the prefix; create that path if it does not exist. Rows naming several suites assign assertions to each relevant owner, rather than only to a shared mock. New cross-owner suites have full paths in the plan.

**P** means protected staged input. **E** means exempt, with the reason stated. Unless a row specifies otherwise, P compares its actual normalized submit payload to the captured seeded/default payload; successful write commits the submitted snapshot before refresh, failed write keeps it dirty. Invalid text is retained as a distinguishable draft value. P modal routes include Cancel/close/Back, native Escape, existing backdrop behavior, enclosing-owner leave and browser unload. P page routes include sidebar/menu/tab/breadcrumb/deep link/in-app Back/Forward/voluntary signout and browser unload. Every P route uses the same registry. Forced security exits bypass every row and clear sensitive local values. E has no W69 baseline/reset; its existing writes and cleanup remain responsible for state. This convention supplies each row's baseline, comparison, reset and routes without repeating the entire contract.

## Dashboard catalogue, related forms and menus

| Owner path(s)                                                                                                                                                      | Classification and observed baseline source; proposed comparison/reset                                                                                                                                                                                                                                                                                            | Close/navigation routes                                                                  | Test                                                                                       |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| DS `catalogue-screen`; DW `product-editor`, `product-editor-model`                                                                                                 | **P** product Add/Edit, seeded product or creation defaults. Compare `currentValue` after existing name trimming, blank-to-null and inheritance deletion; include translations, primary/category membership, variants and modifier lists. Membership sets ignore order; persisted display positions retain it. Successful product write commits only the product. | Modal, product switch, related forms, deep links, page                                   | DW `product-editor`; DS `catalogue-screen`                                                 |
| DW `variant-form`, `variant-table`                                                                                                                                 | **P** standalone Related Product variant and nested variant; seed selected variant/new inherited defaults. Compare effective emitted patch including null inheritance, price, names, image and availability. Child Save copies to product and clears child only; parent remains dirty. Table action/list display itself **E**.                                    | Child modal, enclosing product, standalone related route                                 | DW `variant-form`; DW `product-editor`                                                     |
| DW `catalogue-browser`, `product-list`, `category-form`, `category-color-form`; DS `catalogue-screen`                                                              | **E** inline category Add/rename automatically commits trimmed name on Enter/focusout; category-form is a path/refusal helper, not an editor. **E** category colour selection immediately emits `wt-choose`: `catalogue-browser.#chooseColor` writes an existing category or assigns the inline name box's colour and closes the chooser. There is no separate Save or staged chooser payload. Preserve the name box's existing automatic write.               | Color modal and parent catalogue leave; inline name keeps existing Escape/blur semantics | DW `product-list`; DW `catalogue-browser`; DW `category-color-form`; DS `catalogue-screen` |
| DW `catalogue-browser` operation dialog                                                                                                                            | **P** destination and contents disposition until move/delete Confirm; seed operation defaults, compare existing operation payload including selected IDs as sets and disposition scalar. **E** readonly summaries and selection-only browsing. Successful operation commits its scope; Keep makes no move/delete request.                                         | Operation modal Cancel/Escape and parent page                                            | DW `catalogue-browser`                                                                     |
| DW `product-color-form`; DS `menus-screen`                                                                                                                         | **P** explicit product-color override; seed current override, compare token/null emitted by Save. Commit override write, not containing product/menu metadata.                                                                                                                                                                                                    | Modal, menu/page                                                                         | DW `product-color-form`; DS `menus-screen`                                                 |
| DW `unit-form`; DS `units-screen`; DW `product-editor`                                                                                                             | **P** both Units Add/Edit and Product Related Unit creation. Seed unit/default precision; compare trimmed names, translations, abbreviation and precision payload. Child creation commits unit, leaving product's selection edit dirty.                                                                                                                           | Modal, related parent, units page                                                        | DW `unit-form`; DS `units-screen`; DW `product-editor`                                     |
| DS `units-screen` reassignment                                                                                                                                     | **P** in-use product selections and target until explicit reassignment. Seed empty selection/target; compare selected IDs as a set and target scalar. Commit when reassignment succeeds. Read-only usage/search **E**.                                                                                                                                            | Reassignment modal, units page                                                           | DS `units-screen`                                                                          |
| DW `extra-list-form`; DS `modifiers-screen`; DW `product-editor`                                                                                                   | **P** standalone/Related extras list and staged item rows. Seed fetched list/new defaults; compare all names, translations, min/max, active and ordered items from emitted value. Preserve `maxPicks=null` meaning uncapped. Successful list creation does not save parent product.                                                                               | Modal, nested row editing, parent/page                                                   | DW `extra-list-form`; DS `modifiers-screen`; DW `product-editor`                           |
| DW `option-list-form`, `option-label-form`; DS `modifiers-screen`; DW `product-editor`                                                                             | **P** standalone/Related options list and nested label. Seed fetched/new values; compare trimmed/null-normalized names, active, ordered labels and defaultLabelId. Label Save commits child into list only; list Save commits list only.                                                                                                                          | Nested child and parent modal, page                                                      | DW `option-list-form`; DW `option-label-form`; DS `modifiers-screen`                       |
| DW `course-list`; DS `kitchen-screen`, `catalogue-screen`                                                                                                          | **E**, courses commit on Enter/blur/reorder. Preserve pending-save settlement and existing refused/unsaved handling in catalogue close; do not convert to staged Save or discard a refused write. Related Course is included explicitly.                                                                                                                          | Existing related modal and kitchen page close semantics                                  | DW `course-list`; DS `catalogue-screen`; DS `kitchen-screen`                               |
| DW `add-content-language`; DS `content-languages-screen`                                                                                                           | **E**, choosing Add/default/remove writes immediately; language choice is navigation/automatic action, not a pending Save payload.                                                                                                                                                                                                                                | Modal/page, existing immediate action                                                    | DW `add-content-language`; DS `content-languages-screen`                                   |
| DW `add-to-menus`, `section-add-products`                                                                                                                          | **P**, selected IDs until Confirm/Add. Seed empty set; compare membership, not offered order. Successful add commits this choice without saving unrelated menu/product metadata.                                                                                                                                                                                  | Selection modal, parent/page                                                             | DW `add-to-menus`; DW `section-add-products`                                               |
| DW `section-details-form`; DS `menus-screen`                                                                                                                       | **P**, menu create/rename and section create/edit. Seed current SectionInput/defaults; compare names/internalName/image/color as emitted. Commit corresponding API write.                                                                                                                                                                                         | Modal, ancestor menu/tree navigation, page                                               | DW `section-details-form`; DS `menus-screen`                                               |
| DS `menus-screen` Device Home Page | **E** W93 (#1287, 2026-10-06) retired named layouts and their name dialogs. Display choices and shortcut selection write immediately. | Home tab, shortcut picker | DS `menus-screen` |
| DW `member-list-editor`                                                                                                                                            | **P** replacement choice until explicit confirmation, seeded no replacement choice and existing member ID. **E** add selection, reorder and remove events that already write immediately. Successful replacement clears only replacement scope.                                                                                                                   | Replacement dialog, list/menu/page                                                       | DW `member-list-editor`; DS `menus-screen`                                                 |
| DW `menu-prices-table`, `menu-structure-table`, `menu-structure-tree`; DS `menus-screen`                                                                           | **E** price typing commits on Enter/focusout, Escape restores existing stored/sent value. Structure tree expansion/drag is view state or immediate host write; metadata forms are owned by section-details above. Keep refused-save and Undo assertions.                                                                                                          | Existing price blur/Enter and tree/tab routes                                            | DW `menu-prices-table`; DS `menus-screen`                                                  |
| DW `ingredient-form`; DS `recipe-screen`                                                                                                                           | **P** ingredient create/edit, seeded ingredient/defaults; compare name/active and allergen/dietary sets. Commit ingredient only.                                                                                                                                                                                                                                  | Modal and containing recipe/page                                                         | DW `ingredient-form`; DS `recipe-screen`                                                   |
| DW `recipe-editor`; DS `recipe-screen`                                                                                                                             | **P** page ingredient selections, seeded fetched recipe; compare ingredient membership set. Product switch/Cancel protected. Commit on `setProductRecipe` success before following read, even if read fails.                                                                                                                                                      | Product picker, Cancel, page                                                             | DW `recipe-editor`; DS `recipe-screen`                                                     |
| DW `allergen-picker`, `allergen-dietary-picker`, `dietary-origin-picker`, `classification-fields`, `form-fields`, `color-field`, `image-upload`, `location-picker` | **E as independent owners**, choices feed the containing P payload or immediately select a read context. Do not double prompt; guard context changes through the containing form. Image picker may own nested media editor below.                                                                                                                                 | Parent's routes; nested media separately                                                 | DW `product-editor`; DW `ingredient-form`; MD `image-library`                              |

## Dashboard staff, devices, printing, settings and credentials

| Owner path(s)                                                                                                                                                                                                                                                                                                                                                                                          | Classification and observed baseline source; proposed comparison/reset                                                                                                                                                                                                                                                                                                                                        | Close/navigation routes                                                                                    | Test                                                                                                                                   |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| DS `staff-screen`; DW `person-form`, `person-edit`                                                                                                                                                                                                                                                                                                                                                     | **P** Add/Edit person details. Seed normalized details/default role; compare emitted trimmed details and scalar role/status. Commit only completed details write, not invitation/reset actions. **E** Suspend/reset confirmations contain no authored credential values; credential inputs belong to Profile below.                                                                                                      | Modal, staff page                                                                        | DW `person-form`; DW `person-edit`; DS `staff-screen`                                                                                  |
| DW `shift-dialog`; DS `roster-screen`                                                                                                                                                                                                                                                                                                                                                                  | **P** Add/Edit shift, seed selected person/day/shift; compare request timestamps/offsets/role built by existing submitter, not display spelling alone. Remove confirmation **E**.                                                                                                                                                                                                                             | Shift modal, roster period/person navigation, page                                                         | DW `shift-dialog`; DS `roster-screen`                                                                                                  |
| DS `my-schedule-screen`                                                                                                                                                                                                                                                                                                                                                                                | **P** independent cover request and absence forms. Seed empty IDs/dates/note and default kind; compare actual requestSwap/requestAbsence body, including null note. Success resets only its submitted form. Date/filter controls **E**.                                                                                                                                                                       | Form cancel/reset if supplied, tabs/page                                                                   | DS `my-schedule-screen`                                                                                                                |
| DW `purchase-form`; DS `purchases-screen`                                                                                                                                                                                                                                                                                                                                                              | **P** Add/Edit purchase. Seed fetched purchase/defaults; compare actual supplier/invoice/date/regime/Decimal amounts/note and ordered line body. No rounding or fiscal changes.                                                                                                                                                                                                                               | Purchase modal, page                                                                                       | DW `purchase-form`; DS `purchases-screen`                                                                                              |
| DS `device-profiles-screen`                                                                                                                                                                                                                                                                                                                                                                            | **P** profile details, seeded selected profile/create defaults; compare name/canvas/form factor/inactivity/capability set, ordered printer/reader preferences and defaults. Home-layout assignment already saved separately **E**.                                                                                                                                                                            | Page editor, selected profile, tabs and shell leave                                                        | DS `device-profiles-screen`                                                                                                            |
| DS `canvas-editor-screen`; DS `canvas-editor/canvas-grid-preview`, `canvas-editor/card-preview`, `canvas-editor/card-contracts`                                                                                                                                                                                                                                                                        | **P** canvas name and copied CanvasDef including nested card/property drafts, ordered tabs/cards; seed selected canvas clone. Create/duplicate name dialogs also P. Visual preview tabs retain common draft; page/selection leave protects it. Delete/read-only preview **E**.                                                                                                                                | Name modal, nested settings cancel, editor Back, canvas selection/page                                     | DS `canvas-editor-screen`                                                                                                              |
| DS `devices-screen`                                                                                                                                                                                                                                                                                                                                                                                    | **P** edit device and Add pairing settings after device is identified: seed name/profile/binding/printer/reader defaults and compare actual patch. Invitation QR/waiting and completed pairing **E**; number proof remains existing immediate verification. Preserve pairing generations/cleanup.                                                                                                             | Add/Edit modal, nested choice, page                                                                        | DS `devices-screen`                                                                                                                    |
| DS `floor-screen`                                                                                                                                                                                                                                                                                                                                                                                      | **P** new table and each explicit-save label/capacity row, seeded new defaults/fetched row. Commit per row. **E** placement/drag writes and viewing plano.                                                                                                                                                                                                                                                    | Inline Cancel, selected zone/table/tab/page                                                                | DS `floor-screen`                                                                                                                      |
| DS `service-status-screen`                                                                                                                                                                                                                                                                                                                                                                             | **P** new status and each explicit-save status row; seed label/color/default or fetched row, compare trimmed label/color/order/active body. Commit only written row. Immediate row reorder **E**.                                                                                                                                                                                                             | Inline Cancel, tab/page                                                                                    | DS `service-status-screen`                                                                                                             |
| DS `printers-screen`                                                                                                                                                                                                                                                                                                                                                                                   | **P** Add/manual network host/port/name, discovered-device naming, agent rename, detail name/connection and calibration settings. Seed existing printer or discovery/manual defaults; compare existing submission bodies, normalized host/port and saved calibration fields, ordered where applicable. Replace local armed-discard logic with shared question. Calibration test results are not saved fields. | Dialog Cancel/Escape, editor change, calibration exit/page; internal steps retaining draft do not reset it | DS `printers-screen`                                                                                                                   |
| DS `printers-screen` discovery/calibration actions                                                                                                                                                                                                                                                                                                                                                     | **E** discovery waiting, test print/open drawer, ruler result/connection probe output, successful registration; preserve Bluetooth pairing proof/busy behavior. Typed pairing proof before action is **P**, ephemeral only. No new prompt while a hardware command runs.                                                                                                                                      | Existing action, busy and cleanup routes                                                                   | DS `printers-screen`                                                                                                                   |
| DS `printing-rules-screen`                                                                                                                                                                                                                                                                                                                                                                             | **E**, station/watch/drawer policy changes already save through handlers. No staged form transaction introduced.                                                                                                                                                                                                                                                                                              | Existing tab/page routes                                                                                   | DS `printing-rules-screen`                                                                                                             |
| DS `receipts-screen`                                                                                                                                                                                                                                                                                                                                                                                   | **P** receipt header/footer settings, location description and receipt language. Seed each fetched value; compare each actual independent write payload. Language write and `putReceipt`/`putLocationSettings` outcomes commit independently; failed sibling or refresh does not dirty a committed part again. Width/department preview **E**.                                                                | Department/tab/location context and shell leave                                                            | DS `receipts-screen`                                                                                                                   |
| DS `backup-screen`                                                                                                                                                                                                                                                                                                                                                                                     | **P** destination/schedule/retention/weekday choices and pasted setup recovery key; seed loaded/default settings, compare actual Apply body with weekdays as set. Configuration export passphrase/confirmation P until successful export. **E** generated recovery-key output, download/rotation confirmations and status. No key persistence added.                                                          | Page/cancel/setup branch changes                                                                           | DS `backup-screen`                                                                                                                     |
| DS `stream-settings-panel`                                                                                                                                                                                                                                                                                                                                                                             | **P** editing bucket endpoint/region/bucket/access credentials, seeded by existing edit/new draft; compare `#body()`. Test connection is not a save. Commit `saveStreamSettings` success before kit load; kit-load failure cannot restore dirtiness. **E** recovery-kit output and immediate turn-off confirmation.                                                                                           | Cancel, settings container/page                                                                            | DS `stream-settings-panel`; DS `backup-screen`                                                                                         |
| DS `payments-screen`                                                                                                                                                                                                                                                                                                                                                                                   | **P** reader rename, discovered-reader naming, manual outcome/note/PIN attestation inputs until existing action. Seed reader/name/empty proof defaults; compare existing bodies. **E** detail/status/unpair/reconciliation confirmations and operations in flight. Provider forms below are independent P scopes.                                                                                             | Dialog/panel/tab/page; payment submission unchanged                                                        | DS `payments-screen`                                                                                                                   |
| DS `profile-screen`; `apps/dashboard/src/dashboard-app.ts`                                                                                                                                                                                                                                                                                                                                             | **P** details, password/PIN change, passkey name, TOTP proof/setup and credential removal proof inputs. Seed person details or empty mode fields; compare exact existing mode body, clear successful mode only. Recovery codes/TOTP output alone **E**. Parent profile close covers dirty children without committing them.                                                                                   | Inner Cancel/Back, outer close, profile URL/history, voluntary logout                                      | DS `profile-screen`; `apps/dashboard/src/dashboard-app.test.ts`                                                                        |
| DS `login-screen`                                                                                                                                                                                                                                                                                                                                                                                      | **P** typed sign-in, TOTP/recovery, account activation/password-reset inputs on voluntary method/back/route loss. Seed current step/default email or empty proof, compare actual step body; successful authentication/reset commits that step. **E** method selection, passkey browser ceremony and readonly notices. Forced invalidation clears inputs, no new storage/enrolment query.                      | Method/step Back, app route/unload                                                                         | DS `login-screen`; `apps/dashboard/src/dashboard-app.test.ts`                                                                          |
| DS `venue-settings-screen`                                                                                                                                                                                                                                                                                                                                                                             | **E as container**; contributed venue/stream settings own their P scopes. Its tabs must consult descendants before leaving.                                                                                                                                                                                                                                                                                   | Container tabs and shell                                                                                   | DS `venue-settings-screen`; VS `venue-operations-screen`                                                                               |
| DS `dashboard-overview-screen`, `dashboard-sales-screen`, `orders-screen`, `orders-filter`, `planned-actual-screen`, `vat-return-screen`, `alerts-screen`, `approvals-screen`, `diagnostics-screen`, `email-screen`, `servers-screen`, `cloud-services-screen`, `demo-printer-screen`, `demo-reader-screen`; DW `order-detail-dialog`, `order-reprint-dialog`, `print-job-preview`, `receipt-language` | **E**, report/search/print-language/view choices, readonly detail and explicit immediate confirmations without authored staged entities. VAT return selectors prepare a report, not a saved tax record. Server allow/revoke, cloud actions, approval actions and demos retain existing behavior.                                                                                                              | Existing view/command close; shell still consults other P scopes                                           | DS `orders-screen`; DS `vat-return-screen`; DS `servers-screen`; DW `order-reprint-dialog`; `apps/dashboard/src/dashboard-app.test.ts` |

## Contributed management screens

| Owner path(s)                                                           | Classification and observed baseline source; proposed comparison/reset                                                                                                                                                                                                                                                                                                                                                                   | Close/navigation routes                                               | Test                                                                                                 |
| ----------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| VS `venue-operations-screen`                                            | **P** department/zone Add/Edit, trading name, hours, zone configuration, inline zone/name and paid/collection/receipt settings drafts. Seed fetched row/settings or defaults; compare each existing write body separately, including ordered intervals and receipt translation maps. Commit each row/form on its write. Delete/disable/reassign confirmations and immediate toggles **E** unless an editable target is awaiting Confirm. | Modal, inline Cancel, department/zone selection and tabs/page         | VS `venue-operations-screen`                                                                         |
| VS `station-hours-form`                                                 | **P** rows seeded from weekly intervals, compare emitted intervals after existing time normalization/order. Save into containing draft commits child only; API-backed host success commits respective host scope.                                                                                                                                                                                                                        | Inline Cancel/own modal, parent/page                                  | VS `station-hours-form`; VS `prep-stations-screen`; VS `venue-operations-screen`                     |
| VS `prep-stations-screen`                                               | **P** station name/output settings, exception draft/target, edited fallback/close time/day/destination and staged assignment selections. Seed selected station/exception/action defaults; compare actual saveStation/saveException/saveStationAction bodies, independently. **E** immediate switches/rest-of-order/reorder writes, route-test product/extras/zone/time controls and read-only explanation.                               | Modal, station/exception tab, parent/page                             | VS `prep-stations-screen`                                                                            |
| VS `watcher-form`; VS `prep-stations-screen`, `venue-operations-screen` | **P** watcher new/edit draft, seeded watcher/default printer/screen/zone choices. Compare emitted WatcherInput with membership sets where request has unordered selections. Commit host write; no parent reset.                                                                                                                                                                                                                          | Watcher Cancel, parent modal/page                                     | VS `watcher-form`; VS `prep-stations-screen`; VS `venue-operations-screen`                           |
| VS `service-settings-panel`                                             | **E**, edit-sent-lines/held-work and other setting controls call save on change. Preserve passive reads and per-field errors.                                                                                                                                                                                                                                                                                                            | Tabs/page, immediate write                                            | VS `service-settings-panel`                                                                          |
| MD `image-library`; MD `image-picker`; DW `image-upload`                | **P** Upload/Edit image file and translated names, seeded file/new names or fetched metadata. Compare name map values and selected file identity; a different file is dirty even with same filename. Write success closes/commits editor before library refresh, as current handler separates them. **E** image selection, filters, viewer/backdrop and deletion usage inspection. Already uploaded resource survives parent Discard.    | Nested editor Cancel/Escape, enclosing picker/product or library page | MD `image-library`; `packages/media/src/dashboard/image-library.narrow.test.ts`; DW `product-editor` |
| BK `booking-form`; BK `bookings-screen`                                 | **P** Add/Edit booking date/time/party/contact/phone/notes/table, seeded booking/defaults. Compare existing booking submission normalization and table/null choice. Commit booking only. **E** calendar filters and immediate status/arrival/no-show actions.                                                                                                                                                                            | Booking modal, calendar day/tab/page                                  | BK `booking-form`; BK `bookings-screen`                                                              |
| AD `reasons-screen`                                                     | **P** Add/Edit reason translations/settings and separate explicit-save limitDraft. Seed reason/settings/defaults; compare reason body and normalized limit independently. **E** immediate ordering/activation and readonly deletion confirmation.                                                                                                                                                                                        | Reason modal, limit page/tab, shell                                   | AD `reasons-screen`                                                                                  |
| AD `adjustment-report-screen`                                           | **E**, date/reason filters and export describe reads, not staged writes.                                                                                                                                                                                                                                                                                                                                                                 | Report/tab/page                                                       | AD `adjustment-report-screen`                                                                        |
| SU `sumup-connect-form`, `sumup-add-reader`, `panel`                    | **P** API/affiliate keys, merchant selection in ambiguous connect, name/pairing code. Seed empty/default body per phase; compare exact emitted request. Connection/pair action success commits that phase, not other fields. **E** completed connection, polling/waiting and immediate unpair. Keep orphan cleanup and generation tests.                                                                                                 | Form Cancel, provider panel/tab/page, unload                          | SU `sumup-connect-form`; SU `sumup-add-reader`; DS `payments-screen`                                 |
| ST `stripe-connect-form`, `stripe-add-reader`, `panel`                  | **P** secret/webhook keys and redirect URLs, reader name/reference. Seed empty/default values; compare existing connect/register bodies, commit success before refresh. **E** completed status/unpair confirmations. No provider or payment work gated once submitted.                                                                                                                                                                   | Form Cancel, provider panel/tab/page, unload                          | ST `stripe-connect-form`; ST `stripe-add-reader`; DS `payments-screen`                               |

## Till local forms and order flows

| Owner path(s)                                                                                                                       | Classification and observed baseline source; proposed comparison/reset                                                                                                                                                                                                                                                                                                                                                                                                   | Close/navigation routes                                                                          | Test                                                                                                                                              |
| ----------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| TW `invoice-recipient-dialog`; `apps/till/src/till-app.ts` | **P** customer tax ID, name, street, postal code, locality and province until Use full invoice. Seed blank defaults; compare existing trimmed fields and valid normalized Spanish tax ID. Commit bill write before refresh, or accepted local choice before its owner leaves. Retain newer edits and returned bill revision. | Cancel/native Escape, parent/shell/unload | TW `invoice-recipient-dialog`; `apps/till/src/till-app-bill-payments.test.ts`; `apps/till/src/till-app.test.ts` |
| TW `modifier-picker`                                                                                                                | **P** new/edit line variant, picks, quantities, answers and note; seed original line/product defaults. Compare emitted selection values, list identity and membership, retaining order only where body positions matter. Confirm commits child into store, not a server order/save.                                                                                                                                                                                      | Picker Cancel/Escape, parent counter/table view                                                  | TW `modifier-picker`; TS `till-counter-screen`; TS `till-table-order-screen`                                                                      |
| TW `party-name-dialog`, `seat-dialog`                                                                                               | **P** typed party name and guest count until explicit action; seed current name/count/default absence, retain guestCount=null meaning no count. Commit accepted existing action.                                                                                                                                                                                                                                                                                         | Modal Cancel, floor/table parent/page                                                            | TW `party-name-dialog`; TW `seat-dialog`                                                                                                          |
| TW `station-choice-dialog`                                                                                                          | **P** station selected/default current station, compare actual stationId including null rules choice. Commit existing station-chosen action; no station/payment semantics change.                                                                                                                                                                                                                                                                                        | Modal Cancel/Escape, line/parent leave                                                           | TW `station-choice-dialog`; TS `till-table-order-screen`                                                                                          |
| TW `dead-ends-dialog`, `dead-ends-section`                                                                                          | **P** choices map and removed IDs until Continue; seed route-plan defaults. Compare map by key/value and removal set, not insertion order. Continue commits local decision into existing submit workflow; Cancel never submits.                                                                                                                                                                                                                                          | Modal Cancel/Escape, parent send review                                                          | TW `dead-ends-dialog`; TS `till-table-order-screen`                                                                                               |
| TS `till-table-order-screen`                                                                                                        | **P** local send/review destination/join target/pendingDraft choices, serve-count editor, naming, split quantities/table and transfer-line selections until explicit command. Seed existing command defaults, compare command body only, not live totals/preview fields; sets unordered, quantity maps keyed, line list order per command. Commit only accepted action. **E** readonly takeover/fire summary and immediate target clicks without a staged confirmation.  | Dialog Cancel, review Back, table/bill selection, tab/shell/unload                               | TS `till-table-order-screen`                                                                                                                      |
| TW `tender-pay`                                                                                                                     | **P** local cash/custom charge/park label/reference/tip entry until existing explicit action; seed current step defaults, compare exact emitted body without monetary changes. **E** ongoing provider/payment busy, completion and retained store data. Submission itself never asks W69.                                                                                                                                                                                | Entry Cancel/Back, counter/table page leave before submission                                    | TW `tender-pay`; TS `till-counter-screen`                                                                                                         |
| TW `bill-pay-dialog`, `bill-refund-dialog`, `adjustment-dialog`, `cancel-credit-dialog`, `unpaid-departure-dialog`                  | **P** amount/reference/reason/note and authorization inputs before explicit action, seeded current bill/action defaults. Compare each existing request body; success commits only submitted form. **E** readonly Done/results or nondismissible in-flight work. Discard is local reset, never reversal/cancellation/deletion.                                                                                                                                            | Dialog Cancel/Escape, parent/page before request                                                 | TW `bill-pay-dialog`; TW `bill-refund-dialog`; TW `adjustment-dialog`; TW `cancel-credit-dialog`; TW `unpaid-departure-dialog`                    |
| TW `supervisor-override-dialog`; TS `till-lock-screen`                                                                              | **P** typed PIN/credential attempt on voluntary close/back/method loss; seed empty attempt, compare exact local submission inputs without retaining them externally. Successful authentication clears; forced lock/switch clears without asking. Selection-only login stage **E**.                                                                                                                                                                                       | Voluntary dialog/method route/unload; forced bypass                                              | TW `supervisor-override-dialog`; TS `till-lock-screen`; `apps/till/src/till-app.test.ts`                                                          |
| TW `find-bill-dialog`                                                                                                               | **E** search query/result choices; **P** collection amount/external-reference step awaiting explicit command, seed selected bill/default entry. Commit collection success.                                                                                                                                                                                                                                                                                               | Dialog Back/Cancel, parent/page                                                                  | TW `find-bill-dialog`                                                                                                                             |
| TW `bill-choice-dialog`                                                                                                             | **E**, Merge/Separate buttons immediately emit their choice; there is no intermediate selected draft (observed `#choose` and button handlers). Existing operation confirmation remains without an added discard question.                                                                                                                                                                                                                                                | Existing Cancel/Escape and choice actions                                                        | TW `bill-choice-dialog`; TW `held-orders`; TS `till-table-order-screen`                                                                           |
| TW `held-orders`                                                                                                                    | **E** order listing and table target clicks; move picker itself does not contain typed draft. Its nested bill-choice buttons perform their choice immediately, also E. Keep existing move/held-order pricing and identity assertions.                                                                                                                                                                                                                                    | Existing picker Cancel and immediate bill-choice confirmation                                    | TW `held-orders`; TW `bill-choice-dialog`                                                                                                         |
| TW `basket`, `line-extras-editor`, `menu-browser`, `menu-switcher`, `numeric-pad`, `tab-shell`                                      | **E as independent forms**, basket notes immediately call `store.setLineExtras`; line-extras-editor is a render helper also used by protected modifier-picker. Menu search, menu selection, numeric keypad and tab chrome feed their containing owner, not a separate saved draft. Store protection below covers memory-only notes.                                                                                                                                      | Containing picker/store/shell routes                                                             | TW `basket`; TW `modifier-picker`; TS `till-counter-screen`; `apps/till/src/till-app.test.ts`                                                     |
| TW `reader-picker`, `printers-dialog`, `reprint-language-dialog`, `basket-refresh-dialog`, `track-dialog`                           | **E**, immediate device choice/setting, print-language command, readonly refresh explanation and tracking helper, not staged entity edits. Do not add repeated payment/print confirmations.                                                                                                                                                                                                                                                                              | Existing dialog/command routes                                                                   | TW `reader-picker`; TW `printers-dialog`; TW `reprint-language-dialog`; TW `basket-refresh-dialog`                                                |
| TS `till-schedule-screen`                                                                                                           | **P** coverShiftId/coverColleagueId and absence kind/from/to/note, independently seeded empty/default inputs. Compare exact requestSwap/requestAbsence bodies; success resets only that request. **E** schedule read/filter.                                                                                                                                                                                                                                             | Back-to-counter, tabs/page/unload                                                                | TS `till-schedule-screen`                                                                                                                         |
| TS `till-enrol-screen`                                                                                                              | **P** name entry before join, seeded blank/default name, compare actual join request. Verification proof pre-action P if edited and dismissible; successful phase commits. **E** QR/number output/waiting/refused notice; no pairing cleanup change.                                                                                                                                                                                                                     | Voluntary enrol leave/unload; forced device switch bypass                                        | TS `till-enrol-screen`                                                                                                                            |
| TS `till-device-chooser`, `till-allergen-screen`, `till-station-screen`, `till-expo-screen`, `till-ticket-view`; TW `station-queue` | **E**, context/device selections, filters/readonly explanations, immediate kitchen commands and ticket views. Choosing a context still routes through the shell when it would leave another P form.                                                                                                                                                                                                                                                                      | Existing tab/page/context actions                                                                | TS `till-device-chooser`; TS `till-allergen-screen`; `apps/till/src/till-app.test.ts`                                                             |
| TS `till-floor-screen`                                                                                                              | **E** readonly floor/placement and immediate table actions. Nested seat/name widgets P as above. Existing explicit clear/close confirmations remain.                                                                                                                                                                                                                                                                                                                     | Floor/table/tab/shell                                                                            | TS `till-floor-screen`; TW `seat-dialog`                                                                                                          |
| TS `till-counter-screen`; `apps/till/src/till-app.ts`, `apps/till/src/state/working-order.ts`, `apps/till/src/state/draft-sync.ts`  | **P** memory-only/unassigned basket against destructive replacement/unload, seed current accepted order payload; compare actual line selections/quantities/notes/label, with existing position meaning. **E** retained view/logout transitions, automatic party DraftSync and notes already copied into store. Committing UI selections updates store baseline for that child only; sale/place acceptance commits relevant basket. Never delete server draft as Discard. | Destructive local order replacement/unload only for basket; local form scopes cover other routes | `apps/till/src/till-app.test.ts`; TS `till-counter-screen`; `apps/till/src/state/draft-sync.test.ts`; `apps/till/src/state/working-order.test.ts` |

The store's existing dirty flag measures line synchronization and excludes the full form contract, notably label edits. Do not reuse it as W69 truth. Party drafts already autosave with a delay and serialize writes; existing flush/close/refusal/takeover paths remain intact. The till logout currently locks the UI and closes its draft writer before finishing cleanup. Voluntary signout protection runs before that sequence, while expiry/inactivity/operator switches bypass it. Persisted working orders survive UI-only Discard. A retained counter basket can remain after logout because it already does; this item introduces no new persistence or access to it.

## Setup steps and accumulated draft

| Owner path(s)                                                                                                  | Classification and observed baseline source; proposed comparison/reset                                                                                                                                                                                                                                                                                                                          | Close/navigation routes                                                                                      | Test                                                                       |
| -------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------- |
| `apps/setup/src/setup-app.ts`                                                                                  | **P** accumulated setup draft until successful provisioning/import/adoption outcome that writes it. Seed initial root defaults; compare actual configuration payload, not step index/read state. A child Next copies its patch to root and commits child only. Root remains uncommitted.                                                                                                        | Start over, mode/branch changes that discard values, external leave/unload; retained steps do not clear root | `apps/setup/src/setup-app.test.ts`                                         |
| SS `admin-screen`                                                                                              | **P** names/email/password/PIN, seeded root administrator/defaults. Compare existing normalized next patch including derived display name and exact secrets. No new sensitive storage.                                                                                                                                                                                                          | Back/step/mode leaving unpatched values, unload                                                              | SS `admin-screen`; `apps/setup/src/setup-app.test.ts`                      |
| SS `venue-screen`                                                                                              | **P** legal/tax/geography/description/cutover/language/default settings, seeded root/default pack values. Compare existing next patch; language membership vs primary/position semantics follows current writer.                                                                                                                                                                                | Back/step/mode and unload                                                                                    | SS `venue-screen`; `apps/setup/src/setup-app.test.ts`                      |
| SS `cert-screen`                                                                                               | **P** selected PFX bytes/passphrase/certificate kind, seeded root/current selection. Compare file identity/actual patch rather than filename, exact passphrase. Step Next commits child into root only. No live certificate/fiscal experiment.                                                                                                                                                  | Back/branch/unload, forced teardown                                                                          | SS `cert-screen`; `apps/setup/src/setup-app.test.ts`                       |
| SS `live-source-screen`                                                                                        | **P** artifact/passphrase selection, seed empty import/defaults. Compare selected file and exact import proof. Successful parse transfers configuration to root; preview/root remains P until final write.                                                                                                                                                                                      | Back/import branch change/unload                                                                             | SS `live-source-screen`; `apps/setup/src/setup-app.test.ts`                |
| SS `restore-screen`, `restore-bucket-screen`, `cloud-restore-screen`, `old-box-question`                       | **P** archive/kit/key/source choices and typed proof until restore action; seed existing defaults, compare respective actual restore body/file identity. **E** standalone old-box/safety acknowledgement controls are existing safety confirmation, not authored configuration. They remain required by their current operation. Success commits completed operation; no fiscal restore change. | Back/source/mode/unload before action; in-flight stays existing busy                                         | SS `restore-screen`; SS `restore-bucket-screen`; SS `cloud-restore-screen` |
| SS `connect-screen`                                                                                            | **P** server address/username/password/TOTP/adoption fields, seeded current step/default address; compare actual next/auth/adopt body per phase. Success clears completed proof only. No auth-query/session behavior change.                                                                                                                                                                    | Back/step/mode/unload; security bypass                                                                       | SS `connect-screen`; `apps/setup/src/setup-app.test.ts`                    |
| SS `reset-screen`                                                                                              | **P** selected person and typed reset/password proof until explicit request; seed defaults, compare existing request. Success clears proof, forced expiry clears without asking.                                                                                                                                                                                                                | Back/mode/unload                                                                                             | SS `reset-screen`                                                          |
| SS `mode-screen`, `role-screen`, `connection-screen`                                                           | **E as forms**, immediate mode/role choices, acknowledgement and connectivity status. A mode change discarding the root P draft must still request root leave before mutation.                                                                                                                                                                                                                  | Existing choice/step routes through root                                                                     | SS `mode-screen`; SS `role-screen`; `apps/setup/src/setup-app.test.ts`     |
| SS `configuration-preview-screen`, `review-screen`, `fiscal-test-screen`, `provisioning-screen`, `done-screen` | **E as forms**, readonly preview/review/status/results and displayed break-glass output; containing root draft P until write succeeds. In-flight provisioning must not be delayed or cancelled by W69. Fiscal-test screen has status and Run/Back/Continue buttons, not editable input; it is command work rather than an edited entity.                                                        | Back/review root leave; busy/result existing behavior                                                        | `apps/setup/src/setup-app.test.ts`; SS `review-screen`; SS `done-screen`   |

## Shared consumers and navigation owners

| Owner path(s)                                                                                                                                                              | Classification and baseline/reset                                                                                                                                                                                                                                                                                                                                                                    | Routes                                                                                            | Test                                                                                                                 |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| `packages/ui/src/components/wt-dialog.ts`, `packages/ui/src/components/wt-modal.ts`, `packages/ui/src/components/wt-form-actions.ts`                                       | **E themselves**, no domain draft; render/intercept scopes supplied by owners. Existing dismissible/nondismissible and delayed-close rules are constraints, not baselines.                                                                                                                                                                                                                           | Native cancel/close, request-close, approved success/security close                               | `packages/ui/src/components/wt-dialog.test.ts`; `packages/ui/src/components/wt-modal.test.ts`                        |
| `packages/ui/src/url-state.ts`; `apps/dashboard/src/dashboard-app.ts`; `apps/till/src/till-app.ts`; `apps/setup/src/setup-app.ts`                                          | **E as shells**, aggregate P owners through one shared registry. Preserve history.state, query data, parent identities and accepted route. Receipts owns direct preview history/popstate and login/dashboard own direct replaceState calls; migrate them to accepted-history delivery too. Forced transitions invalidate requests, dispose sensitive scopes; voluntary signout guards before logout. | Sidebar/menu/tabs/breadcrumb/deep links/in-app Back/Forward/profile/locale/signout; native unload | `packages/ui/src/url-state.test.ts`; each shell's sibling `.test.ts`; new `packages/ui/src/navigation-guard.test.ts` |
| `packages/ui-core/src/components/*`, `packages/ui/src/components/*` field/table/menu primitives; `packages/dashboard-kit/src/*`; `packages/dashboard-modules/src/index.ts` | **E as primitives/registries**, rendering, draft propagation, table preferences or module assembly, not independently saved forms. Popup keyboard and picker choices cannot falsely clear containing scope.                                                                                                                                                                                          | Owner receives value/event and owns leave                                                         | New `packages/ui-core/src/unsaved-changes.test.ts`; new `packages/ui/src/components/wt-unsaved-changes.test.ts`      |

## Boundaries and remaining verification

This source inventory includes Add/Edit modals, related Product variants/units/extras/options/courses, nested image/label forms, explicit-save inline rows, page editors, contributed modules, login/credential steps, setup branches and order drafts. It distinguishes staged inputs from immediate commands, report controls and automatic writes; protection is not inferred solely from a widget tag.

Text search cannot establish runtime reachability or native browser timing and may miss dynamically constructed markup. The registry and contributor entry points were inspected to widen the path set beyond app screens. This audit is baseline-specific: repeat discovery and inspect diffs for every advancing owner before implementation and PR finishing, particularly W70a #1265, Lane D prep-station tabs, Lane C device dialog edges, Lane A receipt top block, A231 and W41s-10c. Do not modify their branches. Overlap is owner-waived; the second landing rebases.

The classifications above choose minimal behavior consistent with the owner's exemptions. There is no deferred form inventory or unresolved product decision. Runtime evidence, exact Chromium history/unload behavior, package coverage and combined-neighbor validation remain implementation work. Unknown-history document leaving and platform/process-termination prompt reliability are limited as described in the design, not promised as custom-dialog guarantees.


## Section/menu metadata rollout checkpoint (2026-10-06)

On the W69 implementation branch, `section-details-form` owns a submitted-value scope for both
menu metadata and section metadata. The comparison uses the existing trimmed name/translations,
image id and colour. Names not shown by the current language settings remain in the submitted
payload. Cancel/native Escape use the shared decision; a replacement section disposes its prior
scope. The image picker registers beneath this form, so a scoped ancestor request sees its staged
image-name edits. Menu and section writes commit their submitted body before close/refresh.

Focused browser cases: `apps/dashboard/src/widgets/section-details-form.unsaved.test.ts` and
`apps/dashboard/src/screens/menu-details.unsaved.test.ts`. Layout metadata, membership selections,
member replacement and the remaining modal/page inventory are still pending; this checkpoint does
not establish page navigation protection.

## Replacement/layout rollout checkpoint (2026-10-06)

_2026-10-06 reconciliation: W93 #1287 retired the named layout editor. Its W69 hooks and layout-only suite were removed on rebase; the receipt below records the earlier tree. Member replacement remains covered in its retained widget, which no production screen draws after W93. Current Device Home Page display success/refusal exemptions are checked through `menu-details.unsaved.test.ts`._

The subsequent W69 branch checkpoint wires the inline `member-list-editor` replacement choice and
the menu screen's layout create/duplicate/rename name dialog. Replacement Cancel asks through the
shared registry; layout Cancel and native Escape use its dialog gate. A changed replacement scope
disposes its old draft and invalidates its question. Both owners commit the submitted value after
acceptance, retaining newer input against that baseline. Layout names compare after trimming.

`apps/dashboard/src/widgets/member-replacement.unsaved.test.ts` and
`apps/dashboard/src/screens/menu-layout.unsaved.test.ts` exercise the actual owners, their successful
and refused write boundaries and unload registration. Include menu is **E**: the current
`menus-screen` invokes `#includeMenu` immediately on a dropdown choice, with no staged confirmation.
The new controller-hosted cases check both success and refusal without a discard question. Immediate
member additions and existing tile operations remain exempt. Other audited modal owners and all
page/navigation owners remain pending. This supersedes the replacement/layout pending status in
the earlier checkpoints; it does not establish page navigation protection.

## Staff edit rollout checkpoint (2026-10-06)

The W69 branch now wires `person-edit` alongside Add staff. Its scope compares the existing
trimmed details, null-or-trimmed telephone, role and status. A refreshed summary with the same
person id retains the current draft; a replacement person disposes the old scope and question.
Cancel/native Escape use the shared decision and successful saves commit before list refresh.
Newer delivered input remains compared against the submitted value. Invitation resend is an
independent command: it leaves an edited form open and does not commit its details. Pending
writes retain nondismissible controls. Late save/resend results or refusals for another person
leave that editor's values, baseline and refusal message alone.

`apps/dashboard/src/widgets/person-edit.unsaved.test.ts` and
`apps/dashboard/src/screens/staff-edit.unsaved.test.ts` exercise those owners in Chromium.
Staff reset/suspend confirmations contain no secret-entry fields; the earlier staff-row
credential-subform classification is superseded by the current source. Profile's credential
modal forms are wired on the W69 branch as of 2026-10-06. Other modal owners and all
page/navigation owners remain pending.

### Profile modal implementation checkpoint — 2026-10-06

`profile-screen` registers normalized details and exact credential inputs per editor opening.
Cancel/native Escape use its scoped decision; changed/reverted fields update unload handling.
Writes commit the captured submission before refresh. A later delivered detail or passkey-name
edit stays dirty. The authenticator's proof and code stages commit separately; recovery-code
output is exempt. Google proof disposes its scope before redirect. Disconnect clears passwords,
proofs and authenticator/recovery output, and invalidates outstanding write replies and ceremonies.

The real-controller cases are in `apps/dashboard/src/screens/profile-screen.unsaved.test.ts`.
The existing Profile suite remains unchanged. Outer Profile dismissal and page/history navigation
remain Task 5 work; this checkpoint covers the inner modal owners only.


### Purchase modal checkpoint (2026-10-06)

Add/Edit purchase uses the shared registry for its header and ordered VAT lines. Comparison removes
only insignificant trailing decimal zeroes and applies the existing empty-note-to-null rule;
request amounts and validation are unchanged. Native Escape is its existing dismissal route.
Successful writes commit the submitted snapshot before refresh. A same-invoice read preserves
input, a replacement identity invalidates its question, and a late write cannot close or mark
a replacement editor. Busy fields and dismissal are disabled.

`purchase-form.unsaved.test.ts` and `purchases-screen.unsaved.test.ts` under `apps/dashboard/src/`
exercise these cases alongside the existing form, screen and accessibility suites. Purchase modal
protection is implemented; dashboard navigation and page protection remain Task 5/6 work.

### Print-agent rename checkpoint (2026-10-06)

On the W69 branch, agent rename now registers the trimmed submitted name independently of the
printer forms. Cancel and native Escape retain that name until Discard; Keep returns focus, and
changing back to the starting name removes the unload warning. Pending writes disable input and
close controls. Successful writes commit their captured name before list refresh; a delivered
newer input remains dirty. Replacement and disconnect dispose the prior scope and invalidate its
question, and a late successful/refused rename cannot close or mark the replacement editor.
Reopening survives the previous native close report; successful saves finish without waiting on
that delayed event.
`apps/dashboard/src/screens/printer-agent.unsaved.test.ts` exercises these paths alongside the
unchanged printer behavior/accessibility suites. Synthetic beforeunload cancellation checks the
listener, not the browser's native reload prompt, which remains Task 5. The printer row above is
still partial: printer naming, connection, calibration and pairing proof remain to be wired.


### Discovered-printer naming checkpoint (2026-10-06)

On the W69 branch, your edited printer name is protected before submission through Cancel, native
Escape and discovery close. Keep retains the name and focus; Discard restores its opening value.
The trimmed name is compared independently of scan reports. Registration commits its submitted
name before refresh, while newer delivered input stays dirty. Replacing the named device or
removing the screen releases the old scope and question. A disconnected result performs no reads
or calibration reopening.

In-flight Cancel/Escape retain their existing immediate close and completed calibration result,
as required by the design's in-flight-work rule. No warning delays the submitted registration.
Successful registration clears the discovery owner without waiting for a native close report;
reopening prevents an old report from closing the new name editor.
`apps/dashboard/src/screens/printer-name.unsaved.test.ts` covers these paths. Synthetic unload
checks establish listener cancellation, not a native reload prompt. The printer row remains
partial: manual address entry, detail name/connection, calibration and pairing proof are pending.

### Manual network address checkpoint (2026-10-06)

Your manual printer address stays in discovery until you discard it or register that address.
Close and native Escape use the shared question; closing a nested naming editor affects only
its name. An address check submits the existing normalized host/port without committing that
draft. Registration commits its matching address before refresh. An unrelated address or a
newer delivered edit stays in discovery while the registered printer's calibration opens.
Closing discovery during submitted registration retains the earlier immediate close and
reload without reopening calibration.

`apps/dashboard/src/screens/printer-address.unsaved.test.ts` covers these paths, normalized
reverts and invalid input, replacement/disconnect, detached input and delayed native close.
Its synthetic unload event checks listener cancellation; native reload remains Task 5.
The printer inventory remains partial: Bluetooth proof, detail name/connection and calibration
settings are still pending.

### Bluetooth pairing proof checkpoint (2026-10-06)

The W69 branch now protects the exact pre-submission Bluetooth PIN, including invalid input,
through Cancel, native Escape and discovery Close. Keep retains the proof and focus; Discard
removes only that proof when closing its child dialog, leaving an edited manual address intact.
An exact revert closes directly. Replacement and disconnect cancel the old question, and detached
input cannot change a reopened proof.

Submitted requests retain direct Cancel/Escape and discovery Close when no other draft is dirty.
The existing command result still appears after child dismissal; discovery closed before the
reply still tracks no command. A successful request commits its captured proof independently of
the address. A newer delivered PIN remains dirty against that committed value; a departed result
cannot close or mark a replacement proof. Delayed native close reports cannot clear a reopened
proof or delay successful proof cleanup.

`apps/dashboard/src/screens/printer-pair.unsaved.test.ts` covers these paths alongside the unchanged
printer suites. Synthetic unload checks test listener cancellation; the native reload prompt remains
Task 5. Printer detail name/connection, calibration and the remaining modal/page owners are pending.

### Printer calibration checkpoint (2026-10-06)

Your changed paper width, resolution and attached-drawer settings now ask before Cancel or native
Escape closes the calibration modal. Keep retains the settings, wizard step and focus; Discard
closes once. Changing the settings back clears unload protection. A ruler answer that changes the
paper width is an edit; a ruler answer matching the saved width, wizard steps and hardware output
alone are exempt.

Successful calibration commits the captured settings before list refresh. Newer delivered input
stays open, and a second save sends only the settings still changed from the accepted write.
A refused write retains its draft. Submitted saves and ruler/sample/drawer commands keep their
existing direct dismissal. Replacing or disconnecting the editor disposes its scope and pending
question; a departed write cannot close or mark the replacement, and delayed native close reports
cannot discard a reopened editor.

`apps/dashboard/src/screens/printer-calibration.unsaved.test.ts` exercises these routes alongside
the unchanged printer behavior/accessibility suites. Its synthetic unload checks establish listener
cancellation, not the browser's native reload prompt. Printer detail name and connection editors
are page forms and remain with Tasks 5/6; the other modal and page owners remain pending.

### Device Edit checkpoint (2026-10-06)

Device Edit compares its existing device patch independently of the default card reader's write.
The device baseline is captured after opening defaults; the reader baseline is captured after its
own read. Cancel and native Escape ask for changed name, profile, Shows, receipt/slip printer,
made-here station membership or reader. Keep retains the draft and focus; Discard closes once.
Normalized reverts close directly. Saving commits each captured write separately before refresh;
a failed reader write leaves that reader dirty, and newer delivered values remain open and dirty.

Replacement and disconnect dispose the scopes and invalidate a pending answer. Generation checks
ignore detached control events. Late write replies and delayed native close reports cannot mark
or close a replacement editor. Existing in-flight nondismissible Escape and disabled Cancel remain.
Losing reader permission removes its reader scope without clearing a changed device name.
`apps/dashboard/src/screens/device-edit.unsaved.test.ts` checks these paths and actual sent patches;
the existing device behavior/accessibility suites remain unchanged. Eight EN/ES, light/dark,
phone/desktop confirmation renderings also ran with axe. Synthetic unload checks cover listener
cancellation; the browser reload prompt is still Task 5. Device pairing settings and Payments
reader dialogs remain pending; the Device/Reader inventory row is not complete.

### Device pairing settings checkpoint (2026-10-06)

On the W69 branch, pairing settings register their existing acceptance payload after number proof
or a previously claimed request opens its settings. The baseline includes returning-device defaults;
comparison trims the name and keeps profile and station/watcher IDs. Cancel/native Escape and Add
Close use the shared decision. Keep preserves settings and the pairing hold; Discard performs the
existing request cleanup once. Number verification and waiting/QR output remain exempt. Pending
acceptance retains its existing nondismissible controls.

Acceptance commits the captured payload before list refresh. Newer delivered input remains dirty
against it, but the completed request cannot be accepted again. A replaced request or removed screen
disposes its question; late replies, detached inputs and delayed native close reports leave a new
editor alone. An Add dialog closed during an awaited child opening cannot reopen that child.
`apps/dashboard/src/screens/device-pair.unsaved.test.ts` exercises these cases alongside the unchanged
device suites. Eight English/Spanish, light/dark, phone/desktop confirmation renderings ran with axe
and were inspected. Synthetic unload cases test listener cancellation, not the native reload prompt.
Device modal owners are wired; Payments reader dialogs and the other modal/page owners remain pending.


### Payments attestation checkpoint (2026-10-06)

On the W69 branch, payment and refund attestation forms compare outcome, trimmed note and exact
PIN with the empty opening values. Cancel and native Escape ask through the shared registry;
Keep retains the entered values, Discard closes, and normalized reverts close directly. Successful
attestations commit the submitted values before refreshing recovery lists; newer delivered input
remains dirty. Refused writes retain their draft. Pending requests keep disabled inputs and
nondismissible Escape. Provider-check confirmations remain direct-close exemptions.

Disconnect disposes the scope, cancels its question and clears the local fields. Departed replies,
control events and native close reports leave a replacement form alone. The focused cases are in
`apps/dashboard/src/screens/payment-attestation.unsaved.test.ts`, alongside the unchanged Payments
behavior and accessibility suites. English/Spanish, light/dark, phone/desktop editor and confirmation
renderings ran with axe. Synthetic unload checks cover listener cancellation, not a native reload
prompt. Reader naming was wired at the preceding checkpoint; the earlier device checkpoints' pending
reader references are superseded. SumUp/Stripe forms and the other modal/page owners remain pending.

## 2026-10-06 connection-form checkpoint

SumUp and Stripe connection forms register their own exact submitted inputs with the nearest
application registry. SumUp includes the optional affiliate fields and ambiguous merchant choice;
Stripe includes both keys and redirect URLs. A scoped request retains the visible draft on Keep,
restores it on Discard, and skips unchanged values. A submitted request is exempt while waiting;
a refusal restores draft protection, and an accepted response commits only its submitted values.
If newer input arrived, the form remains editable instead of calling the host's closing callback.
Disconnect clears typed values and unregisters the scope; old controls and replies cannot affect
a reconnected opening. SumUp's restored merchant selection also updates the combobox value.

The new sibling `*-connect-form.unsaved.test.ts` suites exercise these boundaries and the containing
owner's scope request. They do not establish interception of the Payments page's actual navigation
or browser reload. Those adapters remain Tasks 5–6. SumUp/Stripe reader forms and other modal owners
remain pending. Existing provider connect and pairing assertions are unchanged.

## 2026-10-06 Stripe reader checkpoint

Stripe reader registration now compares exact name/reference input and asks through the shared
registry on Cancel/native Escape. Keep retains the visible fields; Discard closes without an add.
Clean/reverted values and a submitted registration waiting for its answer close directly. A refused
registration retains its draft. Acceptance commits before the host notification and keeps newer
input dirty, while still reporting the reader that was added. A departed successful registration
still notifies its captured host callback, as the existing detached/pending-close tests require,
without closing or marking a reconnected form. Departed input/submit/Cancel controls and native close
reports cannot change that new opening. A host notification that reconnects the form also leaves
the replacement open. Disconnect unregisters the scope and clears its local fields.

The unchanged Stripe reader suite and `stripe-add-reader.unsaved.test.ts` ran in Chromium, together
with its connection and panel suites. The visual/accessibility matrix exercised native Escape in
English/Spanish, light/dark and phone/desktop. SumUp reader pairing and the remaining modal owners
remain pending. Page/history/native-reload integration remains Tasks 5–6.


## 2026-10-06 SumUp reader checkpoint

When you edit a reader name or pairing code, Cancel and native Escape ask before discarding those
exact inputs. Keep retains them; Discard closes without pairing. Clean/reverted inputs close
directly. Once you submit Pair, the existing pairing cancellation and cleanup run without another
question. A refused POST restores input protection. Failed/expired results are exempt; Try again
keeps the submitted name and clears the old code as the next form's defaults.

Each opening owns its controls and each attempt owns its client, notification, timer and in-flight
status read. Disconnect clears the input and unregisters its scope. Departed replies cannot finish
or fail a replacement opening, and a pending old status read cannot block or release its new poll.
A late accepted POST still notifies the captured callback or cleans up its processing row through
its captured request, preserving the existing detached/pending-close behavior.

`sumup-add-reader.test.ts` is unchanged. Its new sibling `sumup-add-reader.unsaved.test.ts` ran with
the full SumUp dashboard family in Chromium. The visual/axe matrix covers EN/ES, light/dark and
390/1280 widths through native Escape. Deleting close interception, opening identity and poll-reply
identity in an installed disposable candidate failed their cases; clean controls still passed.
Synthetic unload events establish listener cancellation only. Other modal owners remain pending,
and actual page/history/native-reload integration remains Tasks 5–6.

## 2026-10-06 adjustment-reason modal checkpoint

When you edit a reason's names, actions, limits, roles or note setting, Cancel and native Escape
ask through the shared registry. Keep preserves the visible values and returns focus; Discard
closes that editor. Names compare after trimming, action choices compare membership and valid
limit spellings compare their submitted values. Invalid input stays distinct. Accepted Add/Edit
writes commit their captured values before refresh, while newer delivered input remains dirty.
A refused write keeps its draft. In-flight writes retain nondismissible Escape and Cancel.

Each editor owns its controls and asynchronous result. Disconnect cancels its pending question;
departed inputs, Enter, Save, Cancel, deactivation controls and native close reports leave a new
editor alone. Read-only deactivation remains exempt. The sibling
`packages/adjustments/src/dashboard/reasons-screen.unsaved.test.ts` exercises these boundaries
alongside the unchanged reason and report suites. The independent explicit-save discount-limit
page owner remains Task 6 work; other contributed modal owners remain pending. Synthetic unload
checks establish listener cancellation only, not a native reload prompt.

## 2026-10-06 Booking Add/Edit checkpoint

When you edit booking date, time, party size, contact details, notes or table choice, native Escape
asks before discarding those values. Keep preserves the editor; Discard closes it once. The form
also guards its scoped close API; it has no explicit Cancel button or backdrop close to intercept.
Clean/reverted values close directly. Party size compares its existing numeric submission; blank
phone and notes compare as null, while nonblank contact text retains its submitted spelling.

An accepted Add/Edit commits its captured values before list refresh; a rejected write retains the
draft. Newer delivered input remains visible and dirty against the submitted snapshot. Pending
writes block dismissal. A same-id booking refresh cannot replace the opening baseline, and departed
inputs, submits, native reports and write replies leave a replacement editor alone. Disconnect
unregisters the scope and cancels its question.

`packages/bookings/src/dashboard/booking-form.unsaved.test.ts` exercises these boundaries through
the real BookingApi and rendered screen, alongside the unchanged Booking dashboard suites.
The EN/ES, light/dark, 390/1280 matrix covers Add/Edit and the shared confirmation. Calendar filters
and immediate seat/no-show/cancel/complete commands also have explicit exemption cases. Inline
seating choices remain page work, as do actual navigation and native reload; synthetic unload checks establish cancellation
of the listener only. Other contributed and till modal owners remain Task 4 work.

## 2026-10-06 Station Add/Rename checkpoint

When you edit a station's Add name, display order or timing thresholds, Cancel and native Escape
ask through the shared registry. Rename protects the name after the same trimming its update
submits. Add compares the existing numeric values and preserves its untrimmed create request.
Keep preserves the visible fields; Discard restores and closes only that editor. Clean or reverted
values close directly. Synthetic unload checks cover listener cancellation, not a native reload.

Accepted writes commit their captured values before refresh. Newer delivered input stays visible
and dirty, refusals retain the draft, and pending writes block dismissal. A connected opening owns
its dialog and control handlers. Disconnect unregisters its scope and aborts its question; departed
field events and successful/refused write replies leave a reconnected editor alone.

`packages/venue-service/src/dashboard/prep-stations-screen.unsaved.test.ts` exercises these paths
alongside the existing prep-station behavior, settings and accessibility suites. The EN/ES,
light/dark, 390/1280 matrix covers Add/Rename and their shared warning. This is a partial Task 4
checkpoint: exceptions, hours, watchers, department/zone forms and other audited modal owners still
need integration. Page/history/native reload remain Tasks 5–6.


## 2026-10-06 Station-hours modal checkpoint

When you edit a station's weekday, opening/closing time or interval rows, Cancel and native Escape
ask through the shared registry. The comparison preserves the emitted list order and exact time
strings, including invalid blank input. Keep retains the visible rows; Discard closes the editor
without a write. Clean/reverted rows close directly. Successful writes commit their captured
intervals before refresh; newer delivered input remains editable against that saved snapshot.
Refused writes retain the draft and existing field messages. Pending writes block dismissal.

Disconnect aborts the question and unregisters the scope. The station-action opening owns its
hours form and asynchronous replies, so departed controls/refusals cannot affect a new editor and
an old reply cannot release a replacement station write. Editors without a registry retain their
existing direct Cancel behavior. `station-hours-form.unsaved.test.ts` exercises the real prep-station
host and its submitted bodies alongside the unchanged hours and prep-station suites.
The EN/ES, light/dark, 390/1280 matrix covers this editor and the shared confirmation. Synthetic
unload checks establish listener cancellation only; actual navigation/reload and inline hours
remain Tasks 5–6. Exceptions, watchers, department/zone and remaining modal owners remain Task 4.

## 2026-10-06 Exception Add/Edit modal checkpoint

Exception subject, zone and destination now use the shared scope through Cancel and native Escape.
Keep retains the fields; Discard closes without a write. Clean/reverted values close directly.
Add's empty destination compares as unset even though its existing field handler encodes an empty
station id; the submission guard still refuses that destination. Clearing a saved destination remains
dirty. No request body or domain validation changed.

The scope survives routing preview. Preview Cancel returns to the edited form without abandoning
its values or asking a second question. Confirm writes the captured body and commits that snapshot
before refresh; newer input delivered during the preview read remains dirty and visible. Preview and
confirmed-write refusals retain the draft. Preview reads and confirmed writes block dismissal. Disconnect aborts the question and invalidates old preview/save replies; detached controls
and close reports cannot edit or close a replacement form, including the form restored by preview
Cancel. `packages/venue-service/src/dashboard/prep-exceptions.unsaved.test.ts` checks these paths.

The EN/ES, light/dark, 390/1280 rendered matrix exercises Add/Edit and the shared question. Synthetic
unload checks establish listener cancellation only. Watchers, department/zone, remaining station
actions and other modal owners still need Task 4 work; page/history/native reload remain Tasks 5–6.

An additional filtered consumer run failed the existing station keyboard-reorder focus assertion
at `packages/venue-service/src/dashboard/prep-stations-screen.test.ts:3914`. In an independently
installed checkout at the preceding checkpoint `f8cbc0caa16baa41d3d798d47c7bfc5b6880ccc9`,
the following command failed that same assertion:

```sh
pnpm --filter @waitron/venue-service exec vitest run src/dashboard/prep-stations-screen.test.ts src/dashboard/prep-stations-screen.settings.test.ts -t 'exception|preview|claim|assignment|routing'
```

The single-case selection passed in both checkouts. The broader family
passed before the close-report guard addition; the cause of the filtered focus failure remains
unverified. Preserve the assertion and investigate it before branch finishing.

## 2026-10-06 Stations focus fixture follow-up

The filtered reproduction below failed the same retained-focus assertion, with 52 passing tests.
Its screenshot showed Routing selected. `mountToday` did not set a URL, while the screen's URL
controller reads the retained `view` selection. The reorder handle was in the hidden Stations panel.

```sh
pnpm --filter @waitron/venue-service exec vitest run src/dashboard/prep-stations-screen.test.ts -t 'exception|preview|claim|assignment|routing'
```

The fixture now explicitly starts at `/manage/prep-stations/view/stations`. The original focus,
station order and unchanged routing assertions remain. With that one-line fixture change, the
following selection passed 74 tests; one completely filtered file was skipped. This receipt concerns
test initialization, not a production focus change.

```sh
pnpm --filter @waitron/venue-service exec vitest run src/dashboard/prep-stations-screen.test.ts src/dashboard/prep-stations-screen.settings.test.ts src/dashboard/prep-exceptions.unsaved.test.ts -t 'exception|preview|claim|assignment|routing'
```

The subsequent unfiltered selection of prep-station, hours and exception suites passed 443 tests
across six matched files in 184.34 seconds. The requested `station-hours-form.a11y.test.ts` path
matched no file, so this run supplies no result for a separate hours accessibility suite.


## 2026-10-06 follow-up: Watcher Add and seeded form drafts

`watcher-form.unsaved.test.ts` exercises the actual Prep Stations Add host. The initial focused
run failed nine of eleven cases: edited values neither registered unload protection nor opened a
leave question, and acceptance removed newer input. After wiring the form scope and host close
route, the two-file form selection passed 24 cases. Further controls cover refreshed seeded rows,
reordered offered choices, an accepted write invalidating an open question, and departed write
acceptance/refusal during another pending write. They passed without another production change;
these are characterization controls rather than new red results.

A further red case removed the form and pressed its retained Save control. The host still wrote
its input. The host now checks that the originating form is connected before submitting. The
five-file form/station/exception/hours selection then passed 84 tests. Existing assertions remain
unchanged. The seeded Edit control verifies the form contract directly; Prep Stations currently
opens that form only for Add. Its separate Rename modal and staged inline selections remain open.

```sh
pnpm --filter @waitron/venue-service exec vitest run src/dashboard/watcher-form.unsaved.test.ts src/dashboard/watcher-form.test.ts src/dashboard/prep-stations-screen.unsaved.test.ts src/dashboard/prep-exceptions.unsaved.test.ts src/dashboard/station-hours-form.unsaved.test.ts
```

In an independently installed disposable candidate, deleting the Watcher host's close gate failed
the native Escape question assertion; deleting the submitted-value commit failed the newer-input
revert's unload assertion; deleting the connected-form check failed the no-write assertion. Each
mutation failed one focused case. Restoring all three passed all sixteen watcher cases, including
the clean/revert controls. The temporary candidate was then removed.

The generated visual probe ran eight EN/ES, light/dark, 390/1280 combinations and sixteen axe scans
covering the editor and confirmation. It retained sixteen screenshots; representative desktop and
phone renders were inspected. The probe's initial missing health-read stub displayed a load error
behind the editor. Adding the same empty health response used by the form fixture removed that
fixture error; the eight visual cases and sixteen scans passed again. Captures and exact commands
are retained in Lane E's local receipts. This records the Watcher Add/form boundary only, not
completion of all Watcher controls or the W69 rollout.

A further red case re-rendered the Prep Stations host while its discard question was open.
Discard restored the draft but left the modal mounted. `WtDialog.requestClose` compares its
`beforeClose` callback by identity after the answer; the inline render expression had replaced
that callback. The Watcher host now binds a stable method. The final two-file watcher selection
passed 30 tests, including the added background-render case.

The broader selection reported the same background-render failure plus the existing clean-Cancel
case at `prep-stations-screen.test.ts:5740`. That case waited a timer and the host update, which no
longer waits for the native close report. It now waits until the modal disconnects, keeping its
original modal-absence and no-create assertions unchanged. This does not change the expected
clean-close behavior. The latest consumer result is recorded separately in Lane E's checkpoint.


After those corrections, the watcher-filtered host/form selection passed 109 tests; its 238 other
cases were filtered out. The existing clean Cancel and dismiss controls still assert no create
request and absence of the original modal. An updated independently installed candidate tested
four final controls: removing the gate, removing the submitted commit, removing connected-form
validation, and replacing the stable gate with a fresh render callback. Each failed its intended
case; restoring the candidate passed all seventeen watcher cases. Both owned candidates were
removed. This supersedes the earlier control receipt for the final gate's shape.

```sh
pnpm --filter @waitron/venue-service exec vitest run src/dashboard/prep-stations-screen.test.ts src/dashboard/watcher-form.unsaved.test.ts -t 'watcher|Watcher'
```


## 2026-10-06 follow-up: Watcher Rename and current-main reconciliation

The separate Watcher Rename modal now registers its trimmed submitted name. Cancel and native
Escape keep it mounted while you choose Keep editing or Discard changes. Clean and normalized
reverted names close directly. Successful writes commit before refresh, and edits delivered during
that write stay dirty against the submitted name. Refusals retain newer input. Disconnect aborts
the question and unregisters the scope; late replies cannot release a replacement write. Retained
input, Enter, Save and native close controls from a departed opening cannot submit its replacement.

The initial rename selection failed all eight new cases. After implementation it passed all
25 watcher cases. Four additional lifetime cases exposed one failure: Enter from the removed
input found the replacement Save button. The opening check fixed that failure. The final command
below passed 121 tests; 238 cases outside its name selection were skipped.

```sh
pnpm --filter @waitron/venue-service exec vitest run src/dashboard/watcher-form.unsaved.test.ts src/dashboard/prep-stations-screen.test.ts -t 'watcher|Watcher'
```

The existing standalone Rename Cancel check now waits for the native dialog's delayed close;
its modal-absence, no-write and reopened stored-name assertions are retained. No historical
expected value changed. In an independently installed disposable checkout, removing the close
gate failed the edited Cancel case, removing the submitted commit failed the newer-input revert,
and removing the Enter opening check failed the departed-control no-write assertion. Each failed
one selected test. Restoring the candidate passed all 29 watcher unsaved cases.

A temporary Chromium probe passed eight EN/ES, light/dark, 390/1280 flows, including 16 axe scans,
visible name retention and focus after Keep. Its shell supplied localized warning copy. Sixteen
screenshots and the probe are retained in Lane E's local receipts. The probe's first screenshot
attempt was refused because its absolute output path was outside Vite's allowed paths; the final
run used a package-local path and copied the evidence out afterwards. Synthetic unload assertions
check cancellation only; native reload remains Task 5.

Rebasing onto main retained both the authority-clock cleanup and the shell's forced dirty-registry
reset, and kept both test groups. The focused till shell selection passed nine cases, its types
passed, and the existing dialog/modal suites passed 160 cases, including compact sizing. This is
reconciliation evidence, not completion of the full W69 rollout.

Current-main source inspection adds `apps/till/src/widgets/invoice-recipient-dialog.ts` to the
remaining protected modal inventory: its staged tax ID, name and address fields currently cancel
through `invoice-recipient-cancel`. Cover that form and its till host before PR 1; retain explicit
submission and fiscal behavior. This entry is a source inventory, not a runtime test of that owner.
The venue-details page added on main also needs Task 6 reconciliation. Watcher inline selections,
other modal owners and page/history/navigation coverage remain open.


## 2026-10-06 follow-up: staged Watcher cells

You now get the shared warning before Cancel, native Escape or replacement drops an edited
Watcher station, zone, pass or printer selection on the branch. Choice cells and printer cells
own independent scopes, so saving one does not commit the other. Each scope compares selected
membership, captures its opening once, and commits the submitted selection before refreshing.
An accepted or refused write retains newer input. Disconnect clears these local editors and
aborts their questions; removed selection and Save controls cannot submit a replacement.

The first inline selection run failed 14 new cases and passed eight controls. After the initial
implementation, four native Escape cases still failed: the keyboard event reached the selector,
but its newly opened warning was closed. Preventing Escape's default action passed all 22 cases.
Six additional membership, independent-refresh, invalidated-answer and printer-replacement cases
then passed with those cases, giving 28 focused passes. No existing expected value changed.

```sh
pnpm --filter @waitron/venue-service exec vitest run src/dashboard/watcher-form.unsaved.test.ts -t 'Watcher inline'
```

In a separately installed disposable checkout, removing the leave gate failed edited Cancel,
removing the submitted commit failed the newer-input baseline check, removing Escape's default
prevention failed native Escape, and removing Save's opening check submitted a replacement draft.
Each control failed one selected case; restoring the code passed all 57 watcher draft cases.
The candidate and its parent directory were removed after those runs.

A temporary Chromium probe passed eight EN/ES, light/dark, 390/1280 flows with 16 axe scans.
Its 16 captures show the retained cell and warning; Keep returned focus to the native selector
trigger. Synthetic unload cases check cancellation only; native reload remains Task 5. Probe
source, logs and captures live in Lane E's local `receipts/w69-inline-20261006` directory.
Department/zone forms, station-action drafts and remaining modal owners still need Task 4 work;
page and history integration remain Tasks 5–6. This checkpoint completes only the staged Watcher
cell family, not either proposed W69 PR.

The final Watcher host/form selection passed 154 tests across three suites; 246 cases outside
its name selection were skipped. Venue-service types, changed-file ESLint, Prettier and
`git diff --check` passed. The documentation paths are Prettier-ignored and were read directly.

```sh
pnpm --filter @waitron/venue-service exec vitest run src/dashboard/watcher-form.unsaved.test.ts src/dashboard/watcher-form.test.ts src/dashboard/prep-stations-screen.test.ts -t 'watcher|Watcher'
```


## 2026-10-06 department and zone modal checkpoint

The branch now protects Department Add/Edit, zone Add/configuration, hours and menu-assignment
editors through Cancel and native Escape. Each opening captures its rendered field values once;
text uses its existing trimming and assignment order uses its existing valid-number conversion.
Invalid values remain distinct. The native default checkbox belongs to the assignment scope.
Successful writes commit submitted values before refreshing. Newer delivered input stays dirty,
and background zone updates keep the opening's defaults. Replacement/disconnect abort a pending
question; departed Save/Enter and refusals cannot affect the new form. Read-only removal
confirmations remain exempt.

The initial focused run failed 12 warning assertions and passed 12 clean/save controls. The next
lifetime run failed the accepted-save/newer-edit case and the background-zone draft assertion.
The two-suite venue selection passed 220 tests; a subsequent removal exemption case passed
separately. A reconnection probe then failed its unload assertion: the retained draft had no
registered scope. Retaining its accepted baseline and scheduling an update on reconnection
made that probe pass. The final combined venue selection passed 222 tests. Four deletion controls
in an installed independent checkout each failed
its intended assertion, and restoring the source passed all 32 cases then present. The candidate
was removed. A fifth deletion of the reconnect update failed its unload assertion; the final
restored candidate passed 34 tests and was removed. Temporary visual cases passed in EN/ES, both themes and at 390/1280 widths, with
16 axe scans and 16 inspected captures. Logs and images are in Lane E's local
`receipts/w69-resume-20261006-forms` directory. Browser logs contain Lit's development-mode warning.

The existing Cancel helper now polls for native modal removal. Its absence, focus and no-write
assertions are retained; the initial full suite exposed four assertions running before native
close completed. The first final family run passed 217 tests before the three additional lifetime
controls were added. No existing expected value was changed.

Station-action drafts and the remaining dashboard/till modal owners still need Task 4 work.
Venue inline settings and shell/page/history routes remain Tasks 5–6; this checkpoint completes
only the venue modal family, not either proposed W69 PR.


## 2026-10-06 station-action fallback checkpoint

The Disable station dialog now asks before Cancel, native Escape or another station action drops
your edited replacement-station selection. Keep preserves that selection. Discard restores its
accepted baseline and then closes, without a fallback or disable command. Reviewing an unchanged
selection does not make it dirty. Default-station and Today confirmations retain direct Cancel.
The existing disabled input and nondismissible pending-command phase remain in place.

The fallback write and disable command have separate outcomes: a successful fallback write commits
its submitted selection immediately, even when the later disable is refused. Replacement and
disconnect invalidate old controls and pending replies. A disconnected fallback reply does not
start the subsequent disable command. The question's callback remains stable across rerenders,
including the Discard restoration itself.

The corrected initial browser fixture produced six failing behavioral cases and two passing
controls. The initial implementation passed six cases; two Discard cases exposed callback replacement
on rerender. Keeping the callback per opening passed those cases. A further replacement-opening
case failed before its gate was added. The focused final station-action suite in an independently
installed disposable checkout passed 15 cases. Four deletion controls each failed one intended
assertion: edited Cancel without its leave gate, partial-save cleanliness without the submitted
commit, a departed write without its identity check, and replacement values without the old-control
check. Restoring the candidate passed all 15 cases. The measuring checkout and its parent were
removed after those runs.

```sh
pnpm --filter @waitron/venue-service exec vitest run src/dashboard/station-action.unsaved.test.ts
```

The first five-suite consumer run passed 383 cases and failed the existing immediate Cancel
assertion in the refused Today confirmation. The implementation was narrowed to retain that
confirmation's direct Cancel; no existing assertion or fixture changed. The subsequent focused
consumer selection passed 16 cases, with 327 outside the selection skipped. Temporary visual
cases passed eight EN/ES, light/dark, 390/1280 flows, with 16 axe scans and 16 inspected editor
and warning captures. That probe supplied the shell's localized warning copy. Its source and
captures are kept in Lane E's local `receipts/w69-station-actions-20261006` directory.

Remaining modal owners, including the full-invoice recipient dialog added by A231, still need
Task 4 work. Venue inline settings and page/history/navigation remain Tasks 5–6. This checkpoint
covers station-action fallback selection; neither proposed W69 PR is complete.

A later live-update case failed when a background update made the edited station default:
the choice control disappeared and its scope was disposed. Retaining an already registered scope
across that metadata change passed the case and the 16-case station-action suite. The opening's
comparison baseline is retained even when the refreshed metadata changes which controls appear.
The temporary visual probe initially remained in the package during typechecking and imported
app icons outside that package's `rootDir`; that check failed. The probe was archived and removed,
and the package typecheck then passed. These temporary artifacts are not part of the change.

A second background-update case failed when another write had already persisted the selected
fallback. The dialog's Confirm skipped the redundant fallback request, completed Disable, but
left the local selection dirty and the editor open. Commit the selection once the fallback is
known to be accepted, whether this confirmation writes it or the refreshed snapshot already
holds it. The case keeps its literal single Disable request and clean-close assertions. Its
initial focused run failed the modal-removal assertion; the same case also failed in the ongoing
consumer run, which otherwise passed 387 cases. No existing assertion changed.

The final five-suite station/hour consumer run passed 388 tests on the completed candidate.
The final independently installed deletion controls each failed one selected assertion for all
five protections, including retaining the opening baseline through a background default change.
Restoring that checkout passed all 17 station-action cases. Its checkout and parent were removed.
Package types, changed-file lint, formatting and `git diff --check` passed. Documentation paths
are Prettier-ignored and were read directly. Generated visual and failure captures were archived
outside the product source; no existing test assertion or fixture was edited.


## 2026-10-06 invoice-recipient modal checkpoint

The till's full-invoice recipient dialog now registers its six staged fields with the shared
coordinator. Cancel and native Escape ask before dropping edits. Keep retains the entered values
and Escape's input focus; Discard restores the opening values and emits cancellation once. Each
field compares its existing trimmed submission spelling, with valid tax identifiers compared
through the existing Spanish validator. Invalid text remains distinguishable. Same-form refusal
renders preserve the draft and pending question.

A bill's successful invoice-choice write commits the submitted snapshot before refreshing its
bills. If newer fields were entered during the write, the dialog stays open and its next request
uses the revision returned by that accepted write. A refusal leaves its values dirty. Disconnect
unregisters the scope and invalidates captured completion callbacks. Reconnecting the retained form
restores dirty tracking against its opening baseline; departed input, Cancel, Save and Enter
controls cannot issue a new choice or cancellation. The field binding also restores the native
widget value on reconnection when a detached control changed itself.

Focused cases are in `apps/till/src/widgets/invoice-recipient-dialog.unsaved.test.ts` and the new
recipient write-completion case in `apps/till/src/till-app-bill-payments.test.ts`. Six installed
measuring-checkout controls failed the intended assertions after deleting the leave gate,
submitted commit, reconnect baseline, departed input guard, host completion call or host connection
lifetime check. Restoring that candidate passed 29 recipient-related cases. An accepted or refused
reply from a disconnected till lifetime cannot refresh bills or mark the reconnected form. The temporary visual probe passed eight language,
theme and viewport combinations with 16 axe scans; all 16 editor/warning captures were inspected.
The initial probe used an unavailable viewport command and failed before inspection; the corrected
probe uses `page.viewport` and asserts the document width. Synthetic unload events establish
listener cancellation only. Other till/modal owners and Tasks 5–6 page/history/native reload work
remain open. Public F1 issuance stays disabled.

### Seating count modal checkpoint, 2026-10-06

The till's seating-count form now uses the shared coordinator for Cancel and native Escape.
Keep retains the typed count; Discard restores the opening count and reports cancellation without
seating anyone. Blank counts compare as no count, valid count spellings compare by the number
already submitted by this form, and invalid input remains distinguishable. Validation and
`seat-confirm` request values are unchanged. Explicit Seat commits the chosen count at the local
handoff: `TillFloorScreen.#onSeatConfirm` removes the dialog and emits `open-table` immediately;
this form owns no pending server operation. That handoff does not ask to discard.

Parent rerenders retain the baseline and pending question. Disconnect cancels a question and
unregisters the scope; reconnect retains the opening or accepted baseline. Retained departed input,
Save and Enter controls cannot submit or replace the draft. A submission invalidates a pending
Discard. The actual Floor screen is exercised through Keep, Discard, reopening and direct seating.

`pnpm --filter @waitron/till exec vitest run src/widgets/seat-dialog.unsaved.test.ts` first failed
all ten new cases. The final run of both seating suites, both floor suites and
`src/till-app-table-service.test.ts` passed 187 cases. Four deletions in an installed disposable
checkout each failed one intended case while the blank/revert control passed: close gate,
submitted commit, reconnect baseline and departed-input guard. Restoring the source passed 29
cases. Eight temporary visual flows passed sixteen axe scans, and their sixteen EN/ES,
light/dark, 390/1280 captures were inspected. Synthetic unload checks establish listener
cancellation only. Types, changed-file lint, formatting and diff checks passed; existing test
assertions were not edited. Other till modal owners and Tasks 5–6 remain pending.


### Party-name modal checkpoint, 2026-10-06

You can keep a typed party name when cancelling or pressing native Escape. Discard restores the
starting value and reports cancellation once. Comparisons use the trimmed name already emitted
by this form; validation and blank-name null submission keep their existing meanings. Explicit
Save commits the submitted name before reporting `party-name-confirm`. The table screen removes
the form and hands that action to the existing naming request without another question.

The table screen also passes its stored party name as `savedValue`. When an existing request
refusal reopens a submitted name, that form compares against the stored value rather than treating
the refused value as saved. Keep preserves the refused value; Discard sends no naming action.
Other rerenders keep the existing baseline and pending question. Disconnect aborts a question and
unregisters unload tracking; reconnect retains the starting or submitted baseline. Detached input,
Cancel, Save and Enter controls cannot replace the retained draft or submit it.

The initial new widget run failed nine cases. After the close/lifetime implementation, a corrected
long-name fixture uses a native input event to exercise validation beyond the field's maxlength;
real typing stops at 40 characters. The refused-name widget and actual table-screen tests each
failed before adding the stored baseline and its parent binding. The final command was
`pnpm --filter @waitron/till exec vitest run src/widgets/party-name-dialog.unsaved.test.ts src/widgets/party-name-dialog.test.ts src/screens/party-name.unsaved.test.ts src/screens/till-table-order-screen.test.ts src/till-app-table-service.test.ts`:
336 cases passed. Existing assertions were not edited.

Five installed disposable-checkout deletions each failed its intended case: close gate, submitted
commit, reconnect baseline, departed-input guard and table-screen stored-name binding. Restoring
the candidate passed 19 party-name cases. Eight temporary visual flows passed 16 axe scans;
their 16 EN/ES, light/dark, 390/1280 editor/warning captures were inspected. Types, changed-file
lint, formatting and diff checks passed. Synthetic unload events establish listener cancellation
only. Other till modal owners and Tasks 5–6 remain pending; public F1 issuance stays disabled.


### Dead-end routing modal checkpoint, 2026-10-06

You can keep staged destinations and removals when cancelling or pressing native Escape.
Discard restores the local decision and reports cancellation once; it does not remove a basket
line or record a sale. Continue commits the captured decision before emitting the existing
`dead-ends-continue` event. `TillApp.#answerDeadEnds` removes this child and resolves its existing
routing question. The caller retains responsibility for changing the basket or making a stored
order request. No server write is performed by this dialog.

Comparison preserves each row key and station ID and compares removals by membership. Incomplete
choices stay protected; a revert clears dirty tracking. Background answer updates retain the
baseline and pending question. Disconnect aborts that question; reconnect retains the original
or accepted baseline. Departed controls cannot edit or emit the decision. Removal on a stored
bill remains refused. Existing test assertions were not edited.

The new widget run failed eight cases before implementation and then passed all ten alongside
three existing widget cases. Five installed disposable-checkout controls each failed the intended
assertion after deleting close interception, change notification, submitted commit, disconnect
disposal or the departed-choice guard. Restoring the candidate passed 13 cases. The actual till
shell has destination/removal Keep and Discard cases asserting unchanged basket values and no
sale submission. Their first run asserted before the native dialog's delayed close report;
polling for removal passed both cases. Eight temporary visual flows passed 16 axe scans, with all
16 EN/ES, light/dark, 390/1280 editor/warning captures inspected. Synthetic unload events check
listener cancellation only. Other modal owners and Tasks 5–6 remain pending.


The final focused family command,
`pnpm --filter @waitron/till exec vitest run src/widgets/dead-ends-dialog.unsaved.test.ts src/widgets/dead-ends-dialog.test.ts src/widgets/dead-ends-section.test.ts src/till-app.test.ts --reporter=dot`,
passed 681 browser cases. The unedited `write-path.e2e.test.ts` and `inmutabilidad.test.ts` passed
20 cases. Changed-file lint, till types, formatting and diff checks passed. This verifies the
dead-end modal family on the branch, not completion of W69 or either proposed PR.


## 2026-10-06 modifier-picker checkpoint

Cancel and native Escape now protect your edited variant, extras pick/count, options answer or
kitchen note. Keep retains the draft. Discard restores this picker before reporting its existing
cancellation once. A fresh picker captures preselected defaults; a reopened picker captures the
recorded selections instead. Counts include list identity, and map insertion or offered order
does not make an otherwise reverted selection dirty. Notes compare their trimmed submitted value.

Add/Save commits this child decision at the existing synchronous parent handoff. It does not
commit an independent parent draft or make a server order/payment write. Incomplete choices
remain protected when Confirm refuses them. Background offer updates and reconnects retain the
baseline; disconnected controls and old warning answers cannot submit or cancel a replacement.
The actual menu and basket cases exercise Keep/Discard without changing a line, explicit Add/Save,
and preservation of a basket line's existing note and quantity.

```sh
pnpm --filter @waitron/till exec vitest run src/widgets/modifier-picker.unsaved.test.ts src/widgets/modifier-picker.test.ts src/widgets/menu-browser.test.ts src/widgets/basket.test.ts src/widgets/tender-pay.test.ts src/screens/till-counter-screen.test.ts src/screens/till-table-order-screen.test.ts --reporter=dot
```

The first new-suite run reported 14 failing cases and one passing clean/revert control. After
implementation, two new assertions incorrectly read the parent product id as the variant id;
the existing `productAsVariant` reader puts that identity in `variantId`. The new fixture also
lacked required variant selling values and extras portion/unit fields. Correcting only that new
fixture and its assertions passed 63 cases across the picker suites. Additional background,
list-identity, parent-draft, forced-reset and real-parent controls passed; the final seven-suite
command above passed 598 browser cases. No existing test assertion was changed. Unedited golden
write-path and immutability suites passed 20 cases.

Five separate controls in a freshly installed disposable candidate each failed one intended
assertion after removing the pre-close callback, submitted commit, change notification, departed
control guard, or reconnect baseline commit. Restoring the candidate passed all 21 new cases.
Eight temporary visual cases covered EN/ES, both themes and measured 390/1280 iframe widths, with
16 axe scans and 16 inspected editor/warning captures. Temporary visual source, captures and
failure screenshots were archived outside the repository; the disposable candidate was removed.

Station choice and the remaining audited modal owners still need Task 4 work. Page/history and
inline owners remain Tasks 5–6. This checkpoint completes the modifier-picker family; neither
proposed W69 PR is ready.


## 2026-10-06 station-choice dialog checkpoint

The preceding modifier checkpoint's station-choice pending note is superseded by this addition.
Make at and Move use the shared registry for their actual stationId, including the null rules
choice. Cancel and native Escape retain the destination on Keep. Discard resets only that local
selection and closes once, with no station command or basket change. Reverts close directly.
Make at commits at its existing local basket handoff. Move keeps an uncommitted destination
after a refused write; its existing successful path removes the dialog before refreshing.
The opening selection stays captured across current-station updates and offered ordering.
When the option list removes the selected station, its existing null fallback now notifies the
registry. Disconnect aborts the question; reconnect retains the baseline, and departed controls
cannot submit or change a reconnected draft. No existing assertion was changed.

Focused command:

```sh
pnpm --filter @waitron/till exec vitest run src/widgets/station-choice-dialog.unsaved.test.ts src/widgets/station-choice-dialog.test.ts src/widgets/station-choice-dialog.a11y.test.ts src/till-app-counter-adjustments.test.ts src/till-app-table-service.test.ts
```

The initial new-suite run failed all ten cases at warning, dirty-unload or retained-selection
assertions. An additional option-removal case failed at unload protection before its notification
was implemented. The new counter-shell fixture initially lacked its move API stub; supplying that
stub retained all basket assertions. The final five-suite run passed 189 browser cases. Six installed deletion controls each failed
one intended assertion; restoring that disposable candidate passed all 14 new widget cases.
The unedited golden write-path and immutability suites passed 20 cases. Logs are retained in the
lane's station-choice receipts. Eight temporary visual flows passed with
16 axe scans; all 16 editor/warning captures were inspected in EN/ES, both themes and 390/1280
widths. The visual probe and captures stay outside product source.

The other audited modal owners and inline/page/history/native-reload work remain pending.
This is a coherent Task 4 family checkpoint; neither proposed W69 PR is ready.


## 2026-10-06 supervisor proof checkpoint

On the W69 branch, supervisor approval protects the typed PIN through Back and native Escape.
Selecting an authorizer alone is exempt; deleting every digit reverts to the empty baseline.
Keep retains the exact digits, including leading zeros. Discard clears only this proof; an
independent action draft remains dirty. Authorize emits the existing selected person/PIN body
without a question and consumes the PIN. A returned refusal does not restore that consumed secret;
newly entered retry digits are protected. Roster/error rerenders leave unsubmitted digits intact.
Disconnect aborts a pending question, clears the PIN and removes unload protection; reconnect
starts with an empty attempt. Departed keypad events do not seed the reconnected form.

Focused behavioral checks live in `apps/till/src/widgets/supervisor-override-dialog.unsaved.test.ts`.
The real drawer-approval Escape/Keep/Discard route is exercised in `apps/till/src/till-app.test.ts`,
retaining the ticket and making no additional drawer request. Existing test assertions are unchanged.

The focused command below passed 936 browser cases, including the unchanged approval consumers:

```sh
pnpm --filter @waitron/till exec vitest run src/widgets/supervisor-override-dialog.unsaved.test.ts src/widgets/supervisor-override-dialog.test.ts src/widgets/supervisor-override-dialog.a11y.test.ts src/till-app-counter-adjustments.test.ts src/till-app-adjustments.test.ts src/till-app-counter-cancel-credit.test.ts src/till-app-bill-payments.test.ts src/till-app.test.ts
```

The unedited golden write-path and immutability suites passed 20 cases. The initial new-suite run
failed eight cases at missing warning/unload assertions. In an installed
disposable candidate, removing native pre-close, Back interception, input notification, pending-save
invalidation, disconnect secret clearing and departed-input protection each failed an intended
assertion. Removing the departed Authorize check alone did not fail its control: disconnect already
empties the PIN, and empty proof cannot submit. That result is retained, rather than counted as
proof of that check. The restored candidate passed all 13 new widget cases.
Eight temporary visual flows exercised EN/ES, both themes and measured 390/1280 iframe widths, with
16 axe scans. All 16 editor/warning captures were inspected; the probe and captures are kept outside
product source. Receipts are in the lane's `w69-supervisor-20261006` directory.

This is a Task 4 family checkpoint. Tender, bill, adjustment, refund, collection and other audited
modal owners and inline/page/history/native-reload work remain pending. Neither proposed W69 PR
is ready for finishing.


## Unpaid-departure reason checkpoint — 2026-10-06

The branch protects the trimmed reason comparison through Cancel and native Escape while
retaining the raw input for Keep. Reverting to whitespace is clean. Invalid input and a refused
request remain protected; bill-summary rerenders do not reset the draft. Busy requests retain
nondismissible behavior. Continue emits the existing trimmed reason without a discard question;
a successful departure removes its owner before the table's following refresh.

The real till cases in `apps/till/src/till-app-parties.test.ts` retain the table and complete bill
list after local Discard, send no departure request from either leave route, and keep the reason
when a nested PIN approval is discarded. Recording after that dismissal sends the existing
reason/revision and closes without a warning or drawer request. Existing assertions were retained.
New approval dismissal explicitly waits for the native dialog's delayed close report.

The widget cases in `apps/till/src/widgets/unpaid-departure-dialog.unsaved.test.ts` cover raw
value/focus preservation, normalized revert, validation, refusal, busy dismissal, disconnect,
reconnection, retained departed controls and duplicate native reports. In a frozen-installed
throwaway checkout, independently deleting the native close binding, dirty notification, local
restore, disconnect disposal or departed-input guard failed its intended behavioral assertion;
restoring the source passed all eight widget cases. Deleting the native close binding also failed
the real till Escape assertion; restoring it passed the four selected till leave cases. The
temporary visual probe exercised EN/ES,
light/dark and 390/1280 widths with axe and captured the editor and warning at each combination.
The campaign's `receipts/w69-departure-20261006` holds logs, probe and inspected images.

This advances Task 4 only. Other modal owners and the page/history/navigation rollout remain open.


## Cancel-and-credit reason checkpoint — 2026-10-06

On the W69 branch, Keep the bill and native Escape protect the staged reason. Keep retains its
raw spelling and focus; Discard restores the local input and reports close once. Comparisons use
the trimmed reason already submitted by this form. Empty and reverted input close directly.
Validation, refused submissions and bill-summary rerenders retain the reason. Busy operations
remain nondismissible. Submission sends the existing reason without a discard question; the
accepted result unregisters its scope before the shell's following queue/bill refresh.

Disconnect aborts the question and unregisters unload protection; reconnect retains the reason
against the empty starting baseline. Departed controls cannot submit, close or replace the input.
Result views remain exempt after reconnect. The real counter and table cases exercise both leave
routes, preserving the waiting order, separate basket and both table bills without a cancel request.
The widget suite is `apps/till/src/widgets/cancel-credit-dialog.unsaved.test.ts`.

The first new widget run failed ten cases before implementation. Six independent deletions in an
installed disposable candidate failed the intended close, change-notification, local-restore,
result-scope-retirement, disconnect or departed-input assertion while the untouched-form control
passed. Restoring the source passed eleven cases. Replacing the widget with its previous committed
version failed all four new counter/table leave cases; restoring the candidate passed them.

A consumer run also failed an unpaid-departure modal-absence assertion, then another run failed
the clean counter cancel-credit modal-absence assertion. A third run failed the clean departure
modal-absence assertion. Their expected values are unchanged;
they now await the native close report. A filtered previous-version departure run passed once,
so no reproducible baseline failure is claimed. Delaying that report by 100 ms in the disposable
fixture failed the old departure assertion and passed the awaited assertion. The table's clean
cancel-credit close assertion also awaits that native report. Carry these wait-only changes into
the eventual PR's Changed test checks section.

Eight temporary visual flows passed sixteen axe scans. The sixteen editor/warning captures were
inspected in EN/ES, both themes and measured 390/1280 widths. The probe, captures and control logs
stay in the lane's `receipts/w69-cancel-credit-20261006` directory. Synthetic unload events check
listener cancellation only. Other modal owners and the page/history/navigation rollout remain
open; neither proposed W69 PR is ready for finishing.


The acceptance-to-refresh boundary was then measured directly. The new counter case passed at
first run; the table case failed because unload remained protected at the start of getPartyBills.
The shell now calls the form's showResult immediately on accepted cancellation, before that read.
Both boundary cases then passed, preserving their exact existing cancel request bodies. In the
final installed candidate, the six widget controls were repeated after this restructure, and a
seventh deletion of the shell's completion handoff failed the table boundary assertion. The
counter control still passed without that handoff, so it is not claimed as proof of the handoff.


The final five-suite browser command passed 393 cases on this completed family candidate:

```sh
pnpm --filter @waitron/till exec vitest run src/widgets/cancel-credit-dialog.unsaved.test.ts src/widgets/cancel-credit-dialog.test.ts src/widgets/cancel-credit-dialog.a11y.test.ts src/till-app-counter-cancel-credit.test.ts src/till-app-parties.test.ts --reporter=dot
```

The unedited golden write-path and immutability suites passed 20 cases. Till types, changed-file
lint, formatting and diff checks passed. The final candidate was restored byte for byte before
its owned checkout and parent were removed. The normal push hook, whole-branch review and
current-head CI remain for the complete W69 modal rollout.

## 2026-10-06 W93 reconciliation and refund entry checkpoint

Rebased W69 over W93 #1287 onto `53c8f1e6d07bec7c9548c1c704507c81457df962`.
W93 retired the named Home layout editor. Removed its W69 hooks and layout-only suite;
kept member replacement protection in its retained widget. The ServedMenu fixture in
`apps/till/src/widgets/modifier-picker.unsaved.test.ts` now uses `home.shortcuts` and the two
Device Home display settings, without changing its basket or modifier assertions.
The `menu-details.unsaved.test.ts` Device Home display success/refusal cases run the real
screen beneath a LeaveController and assert the immediate write stays exempt.

Refund entry scopes compare whole/part choice, existing amount normalization with invalid
raw input retained, and the trimmed reason; snapshots preserve raw inputs for Keep/restore.
Cancel and native Escape ask before dismissing. The initial suggested amount belongs to the
baseline; disconnect disposes its scope and reconnect retains that baseline. Refusal and
terminal confirmation do not commit a refund. Busy or departed controls cannot submit or edit.
`TillBillRefundDialog.closeSaved()` releases the scope and closes through the saved bypass;
the real app calls it after refund acceptance, before its first following table read.

The new widget tests initially failed seven assertions on missing confirmation/unload and
busy submission protection. The first host probe at `getTabLines` passed: that read follows
an earlier await, so it did not measure the first read. The corrected probe at
`getTablesState` failed with `[true]` before the synchronous success cleanup and passed with
`[false]` after it. A reconnect case then failed with the departed input value still visible;
`live` bindings restored the retained fields on reconnect. Seven independent installed-candidate
deletions each failed the selected assertion while the untouched refund control passed;
the restored selected run passed six tests. The focused final till command ran 1,223 tests:
refund widget/axe/real-owner, modifier widget/real basket, menu browser, counter cancel-credit,
till app and table-order screen suites. The unedited golden huella and inmutabilidad suites
ran 20 tests. Eight EN/ES light/dark 390/1280 visual cases ran 16 axe scans; all 16 captures
were inspected. These checks cover this checkpoint, not the remaining W69 owners or CI coverage.

Changed existing check: `apps/till/src/till-app-bill-payments.test.ts`, the PIN-cancel/refund-close
case, now retains the edited refund on Cancel, checks Keep preserves its reason, and checks
explicit Discard removes only the refund dialog. Its original parent-dialog and no-approved-refund
assertions remain. W69's approved design, “Closing a dialog,” requires that change.
This remains a Task 4 milestone; all-modal PR 1 and page/navigation PR 2 are not complete.

## 2026-10-06 adjustment-input checkpoint

`TW adjustment-dialog` now registers its quantity, reason, note, discount kind and typed value.
Cancel and native Escape retain the editor until Keep or Discard; Keep restores focus, and Discard
resets local fields and closes once without applying an adjustment. Whitespace-only notes and
reverted default choices remain clean. Invalid values remain protected after validation.

Preview and Confirm emit their existing exact choices without a discard question. A refusal or
preview keeps the local input scope, and the accepted adjustment calls `closeSaved()` before the
counter/table refresh. Disconnect aborts a question and unregisters its scope; reconnect retains
the opening baseline. Departed controls cannot alter that draft or submit. Nested approval Discard
retains the parent adjustment, checked through the real counter shell.

Verification at this checkpoint:

- `pnpm --filter @waitron/till exec vitest run src/widgets/adjustment-dialog.unsaved.test.ts
  src/widgets/adjustment-dialog.test.ts src/widgets/adjustment-dialog.a11y.test.ts
  src/till-app-counter-adjustments.test.ts src/till-app-adjustments.test.ts
  src/screens/till-table-order-screen.adjustments.test.ts`: 204 passed in Chromium.
- Initial new widget run after correcting an invalid leading-zero fixture: eight expected
  assertion failures. The shell success case failed with unload still dirty at its first
  basket refresh, then passed after the synchronous scope retirement.
- Seven separate deletions in an installed disposable candidate failed their intended assertion
  while the clean no-reasons close control passed: native close gate, edit notification, local
  note restore, disconnect disposal, retained reconnect baseline, departed input guard and
  accepted-write retirement. Restoration passed the selected cases. Receipts stay outside git
  in Lane E's `receipts/w69-adjustment-20261006`.
- Temporary visual harness: eight EN/ES, light/dark, 390/1280 flows, sixteen axe scans and sixteen
  inspected editor/warning screenshots. The harness and images are archived outside source.
- Unedited fiscal golden write-path and inmutabilidad suites: twenty passed.

Changed existing checks in `till-app-adjustments.test.ts`: the edited Give away close case now
asserts Keep retains the reason and Discard closes without applying anything (design, Closing a
dialog). The clean cancellation and empty approval close cases now poll their original absence
assertion for the delayed native close report; the clean cancellation also asserts no warning.
All original no-write and confirm-step assertions remain. No fiscal or payment amounts changed.

Task 4 remains partial. Tender, bill payment, collection and remaining modal owners still need
coverage before PR 1; page/history/native reload work remains Tasks 5–6.


## Tender entry checkpoint — 2026-10-06

On the W69 branch, Cancel protects local cash and weight entry, park labels and manual card
references. Keep preserves raw spelling and focus; Discard resets the entry without a sale,
collection or park command, and leaves the existing basket intact. Zero cash and trimmed-empty
labels/references revert to the clean baseline. Replacing a staged weighed product asks before
changing its product or quantity. Disconnect aborts a question and unregisters unload protection;
reconnect retains the opening baseline. Departed controls cannot alter a later attempt.

Card tip, offline consent and simulator outcome use an independent child scope. Cancelling cash
entry preserves these retained card inputs. A coordinator navigation request can Keep or locally
Discard them, but application navigation interception is still Task 5 work. Reader preferences
retain their existing lifetime; choosing a demo reader hides the instant simulator choice and
refreshes its dirty state. Cash/card/hold/weight submission emits the existing normalized details
without a question. Submission releases that input scope before dispatch; provider collection,
waiting, outcomes and cancellation remain exempt.

The first corrected new widget run failed eight assertions on missing warning/unload protection
and busy control behavior. A subsequent two-case run failed staged weight replacement and a
retained departed input; both then passed. A separate reader-preference test failed stale unload
registration before the preference handler notified its scope. No existing assertion changed.
The first fixture used a nonexistent OrderLine.productId; correcting it to product.id separated
that fixture mistake from the expected failures.

The seven-suite final focused command ran 886 browser cases:

```sh
pnpm --filter @waitron/till exec vitest run src/widgets/tender-pay.unsaved.test.ts src/widgets/tender-pay.test.ts src/widgets/tender-pay-enter-key.test.ts src/widgets/tender-pay-weighed-dish.test.ts src/widgets/tender-pay.a11y.test.ts src/screens/till-counter-screen.test.ts src/till-app.test.ts --reporter=dot
```

Its earlier run caught the new collection busy guard refusing an existing retry's spinner while
an earlier kitchen-station attempt finished. The guard was narrowed to preserve that provider
path; the unchanged retry case passed, followed by the final family run. The unedited fiscal
write-path and immutability suites ran 20 cases. Till types, changed-file lint, formatting and
diff checks passed.

In an independently installed disposable checkout, nine separate removals failed their intended
assertions alongside a passing clean/reverted control: Cancel gating, entry notification, card
notification, card local restore, disconnect disposal, retained reconnect baseline, departed input,
submission retirement and weight replacement. The restored widget ran 14 passing cases. Deleting
the Cancel gate failed both real counter leave cases; restoring it passed both. The first control
selector also matched a second test, so the retained final controls use an anchored selector.

Eight temporary EN/ES, light/dark, 390/1280 visual flows ran 16 axe checks, and all 16 editor/warning
captures were inspected. Logs, visual probe and captures stay outside product source in Lane E's
`receipts/w69-tender-20261006`. Synthetic unload events establish registration/cancellation, not
that a browser-native reload prompt appeared. Bill payment, collection, remaining modal owners
and Tasks 5–6 remain open; neither W69 PR is ready for finishing.

## Find a bill collection checkpoint — 2026-10-06

On the W69 branch, edited collection cash and terminal references share the existing dirty
registry. Back and native Escape ask before leaving; Keep retains raw input and focus, and
Discard changes only local entry. Search text and result choices remain exempt. The comparison
uses the existing cash conversion or trimmed terminal reference, ignoring the dormant method's
fields. Returning to a selected bill seeds its existing cash default. Invalid cash stays dirty.

Busy collection blocks entry, method changes and dismissal. Starting a request invalidates an
earlier leave answer without accepting its draft. A refusal retains protection. Disconnect
aborts an outstanding question; reconnect compares against the opening baseline. Departed
controls cannot collect or change that retained draft. A successful collection retires the scope
before the following station read, including when that read fails, without another submission.

The corrected initial widget run failed six assertions and passed the search exemption. The busy
case initially dereferenced a missing control; an explicit presence check then failed for the
expected missing busy gate. The successful-close case failed on the missing acceptance API.
The real till-app case first observed no queue read because the fixture uses prepay; tracing
`#loadStationQueue` moved the probe to the station-list read. It then observed unload protection
still active at that read, and passed after the success boundary retired the collection scope.
A final added case failed because starting collection left an earlier Discard question open.
No existing assertion changed; the existing tender body checks remain.

The final focused five-suite command ran 808 browser cases:

```sh
pnpm --filter @waitron/till exec vitest run src/widgets/find-bill-dialog.unsaved.test.ts src/widgets/find-bill-dialog.test.ts src/widgets/find-bill-dialog.a11y.test.ts src/till-app.test.ts src/till-app-boot-and-counter.test.ts
```

Six separate removals in an independently installed disposable checkout each failed its targeted
case while a clean search or existing collection control passed: Back gating, Escape gating,
input notification, reconnect baseline, busy invalidation and the host success boundary.
Restoration passed 15 selected cases. Eight temporary EN/ES, light/dark, 390/1280 visual flows
ran 16 axe checks; all 16 editor/warning captures were inspected. The temporary probe and captures
are archived outside source in Lane E's `receipts/w69-collection-20261006`. Till types, changed-file
lint and formatting passed. The unedited fiscal write-path and immutability suites ran 20 cases.
Synthetic unload events check registration/cancellation, not a browser-native reload prompt.

Task 4 remains partial: bill payment and other audited modal owners are still open. Tasks 5–6
remain open. Neither W69 PR is ready for finishing.

## Bill payment entry checkpoint — 2026-10-06

On the W69 branch, Close and native Escape protect the payment entry's normalized active request
values: selected item/unit pairs, contribution/share, cash, card tip/reference and reader choice.
Keep preserves raw fields and returns focus; Discard restores only local values before closing.
Back from cash confirmation covers its separate staged tip, retaining the payment entry. Clean
or reverted entry and a tip-free Back remain exempt. Busy transitions abort outstanding answers;
refusal and balance refresh retain the draft. Disconnect unregisters scopes, and reconnect keeps
the original entry baseline. Successful payment clears its entry synchronously in the actual
app's answer handler, before the following table read. Submission bodies and money checks remain
unchanged in the focused suites; no fiscal source or golden assertion changed in this checkpoint.

Observed RED: the first widget run failed all eight cases at missing question/dirty-state
assertions. The actual app's acceptance probe later printed `[true]` for dirty state at its first
following table read, rather than `[false]`. After the synchronous acceptance boundary, that probe
passed. Its first green attempt had a wrong new request expectation (it included the bill ID and
omitted applied/tip amounts); the existing `sent()` helper returns only the request body, so the
new assertion was corrected without changing production requests.

Focused verification commands:

```sh
pnpm --filter @waitron/till exec vitest run src/widgets/bill-pay-dialog.unsaved.test.ts src/widgets/bill-pay-dialog.test.ts src/widgets/bill-pay-dialog.a11y.test.ts src/till-app-bill-payments.test.ts src/till-app.test.ts
pnpm --filter @waitron/till exec vitest run src/widgets/bill-pay-dialog.unsaved.test.ts
pnpm --filter @waitron/fiscal-verifactu exec vitest run src/write-path.e2e.test.ts src/inmutabilidad.test.ts
pnpm --filter @waitron/till typecheck
```

The five-suite run passed 903 tests before the final untouched-form control was added; the final
widget run passed 13. Both unedited fiscal suites passed 20 tests. Seven separate deletions in an
independently installed copy each produced one intended failure and one passing untouched-Close
control: Close, Escape, input notification, tip Back, busy invalidation, reconnect baseline and
host acceptance. Restoring that copy passed eight selected cases (112 explicitly skipped).

The temporary visual probe passed eight EN/ES, light/dark, 390/1280 flows, with 16 axe scans and
16 inspected captures of the entry and warning. Artifacts are retained in Lane E's local
`receipts/w69-bill-pay-20261006`; the probe and its captures were removed from source. Till types,
changed-file lint and formatting passed after removal of the temporary probe. Initial import,
probe-unused-helper and request-fixture failures remain in the receipts, not counted as passes.

Changed existing check: `bill-pay-dialog.test.ts`, “closes from its Close button,” retains exactly
one close event, now waiting for the native close report. The synchronous manually dispatched
close-event assertion remains unchanged. This is the approved design's request-close route.

Task 4 remains partial. Ingredient entry, Units reassignment and other remaining audited modal
owners, and Tasks 5–6 pages/history/navigation/native reload, remain open. Existing shift and
purchase hooks remain on the branch; their host coverage still belongs to the final audit. Neither
proposed W69 PR is ready.

Reconciliation with W94 #1291: rebase onto `c3339ed99b46fd62aca32837cad1eb209155eb53` kept all
53 patches unchanged in `git range-diff`. The first eight-suite combined till run passed 630
cases and failed the refund PIN-cancel test's immediate absent-dialog assertion. The same
assertion appears on checkpoint `9c1bc9f8637baf386e327e5ea53e873e18618ff4`; supervisor Cancel now
runs through `requestClose` and the native dialog's delayed close report. It now polls the same
absence result, retaining the refund Keep/Discard, request-count and no-financial-command checks.
No assertion was removed. This is the second timing-only check change in this checkpoint and
belongs in the PR's Changed test checks section. The owner FYI names both checks.

After that timing correction, the eight-suite combined run passed all 631 tests. Till, UI and
dashboard typechecks and the frozen install passed on the rebased tree. The corrected test's
formatting/lint and `git diff --check` also passed. These receipts verify this checkpoint, not the
remaining modal owners, page navigation or required CI.


## Ingredient modal checkpoint — 2026-10-06

`ingredient-form` now registers name, active status, allergen declaration and dietary origin with
the shared coordinator. Native Escape retains them until Keep or Discard. Same-id reads preserve
the draft and detached baselines; reconnect registers against the retained baseline. Successful
create/edit commits the submitted value and closes before the Recipes refresh. Refused writes
retain the edited form, and starting a write invalidates a pending discard question. No request
body or existing test assertion changed.

Commands run at this checkpoint:

```sh
pnpm --filter @waitron/dashboard exec vitest run src/widgets/ingredient-form.unsaved.test.ts src/widgets/ingredient-form.test.ts src/screens/recipe-screen.test.ts src/widgets/allergen-picker.test.ts src/widgets/dietary-origin-picker.test.ts
pnpm --filter @waitron/fiscal-verifactu exec vitest run src/write-path.e2e.test.ts src/inmutabilidad.test.ts
```

The first expected red run failed ten assertions with one clean/revert control passing; the later
busy-answer and detached-controls red run failed two with thirteen passing. Eight separate
deletions in an independently installed candidate each failed its intended case while the
untouched Escape control passed: close interception, busy invalidation, both write-success
boundaries and each field's unload notification. The restored candidate passed fifteen tests.
The final focused family also checks all field reverts, invalid raw names and Keep focus.
Both unedited fiscal suites passed twenty tests.

The temporary visual probe passed eight EN/ES, light/dark, 390/1280 flows with sixteen axe scans.
All sixteen final editor/warning captures were inspected. Earlier attempts used a forbidden
screenshot path and then omitted the requested theme from the mounting helper; neither is the
final visual receipt. The corrected probe asserts the theme and translated heading. Artifacts
and command output are retained locally in `receipts/w69-ingredient-20261006`; the probe and
captures are removed from source.

Tasks 1/4 remain partial. Units reassignment and the other remaining audited modal owners, followed
by Tasks 5–6 pages/history/navigation/native reload, still keep both proposed PRs unfinished.


## Units reassignment checkpoint — 2026-10-06

The Units reassignment row now has an owner scope on the W69 branch. Its payload compares
selected product IDs as a set and the target scalar, preserving the existing Each-to-null mapping
at submission. Cancel and native Escape use requestClose; Keep retains the selections/target,
and Discard restores only local values. Search and untouched/reverted entry remain exempt.
A successful reassignment resets/commits that entry; a refused reassignment retains it. Starting
a write invalidates an older question and holds the selection/target controls unavailable.
Disconnect disposes the scope; reconnect protects the retained local draft against its empty seed.
The modal close handler ignores a bubbled child report.

Commands run for this checkpoint:

```sh
pnpm --filter @waitron/dashboard exec vitest run src/screens/units-reassignment.unsaved.test.ts src/screens/units-screen.test.ts src/screens/unit-owners.unsaved.test.ts src/widgets/unit-form.test.ts src/widgets/unit-form.a11y.test.ts src/screens/units-screen.a11y.test.ts
pnpm --filter @waitron/fiscal-verifactu exec vitest run src/write-path.e2e.test.ts src/inmutabilidad.test.ts
pnpm --filter @waitron/dashboard typecheck
pnpm exec eslint apps/dashboard/src/screens/units-screen.ts apps/dashboard/src/screens/units-reassignment.unsaved.test.ts
```

The final focused family passed 120 tests, including 15 new reassignment cases; the unchanged
fiscal suites passed 20. The initial new suite observed seven missing-behavior failures with two
controls passing; follow-up busy-control/child-report cases observed two failures. No existing
assertion changed. In an independently installed disposable candidate, ten separate deletions
failed their intended case while an untouched usage/search control passed; restoring the
candidate passed all 15 reassignment cases. The first target-notification deletion also failed
the original reverted-input control, which depends on that notification; it was retained as a
diagnostic and all controls were repeated with the independent untouched control.

A temporary visual probe ran eight EN/ES, light/dark, 390/1280 flows and 16 axe scans. All 16
editor/warning captures were inspected. The probe and captures were archived outside source;
final dashboard typecheck, changed-file lint, formatting and diff checks passed. Receipt logs
are in the lane's local `receipts/w69-units-20261006` folder.

Re-discovery still finds protected baseline owners without their own close interception:
`catalogue-browser` operation destination/disposition (its current close handlers discard the
operation), and `canvas-editor-screen` Create/Duplicate name dialogs. Source inspection identifies
these as next candidates, not verified runtime failures. Reconcile their advancing code before
TDD, preserve A278's current deletion-count contract, and classify every other discovery hit.
Tasks 1/4 remain partial; page/history/navigation and native reload are still pending. Neither
proposed W69 PR is ready for finish-branch.


## Catalogue operation checkpoint — 2026-10-06

Move destination and delete disposition now register with the shared coordinator on the W69
branch. Cancel and native Escape ask before discarding changed choices. Keep retains the raw
choice and returns focus; Discard resets only local operation values, retaining the browsing
selection and issuing no move/delete request. Untouched/reverted choices close directly.
Successful requests release their operation scope, while refused requests and changed deletion
counts retain the staged choice. The existing A278 all-products count remains in the exact
submitted deletion body. Selection IDs are captured by the existing operation opening path and
are not editable inside this dialog; the dirty reader compares its staged destination/disposition.

Busy submission invalidates an outstanding question without accepting the choice, and busy controls
cannot change it. Disconnect aborts the question and unregisters unload protection; reconnect
retains the initial operation defaults. Child reports and detached Cancel/Confirm/input/close
controls cannot close, change or submit a replacement operation. In the delayed Cancel test,
waiting for the native close report exposed the replacement closing after the initial immediate
check had passed. The final test keeps that wait.

Commands run:

```sh
pnpm --filter @waitron/dashboard exec vitest run src/widgets/catalogue-browser.unsaved.test.ts src/widgets/catalogue-browser.test.ts src/widgets/catalogue-browser.a11y.test.ts src/screens/catalogue-screen.test.ts
pnpm --filter @waitron/fiscal-verifactu exec vitest run src/write-path.e2e.test.ts src/inmutabilidad.test.ts
pnpm --filter @waitron/dashboard typecheck
pnpm exec eslint apps/dashboard/src/widgets/catalogue-browser.ts apps/dashboard/src/widgets/catalogue-browser.unsaved.test.ts
```

The initial suite observed eight missing-behavior failures with four controls passing. The first
follow-up exposed a detached destination changing the replacement. A later run caught two radio
handlers referring to an event they had not accepted as an argument; the handlers were corrected,
with all existing assertions retained. Further expected failures exposed a detached close report
and, after awaiting native reports, a detached Cancel closing the replacement. The final four-suite
run passed 330 browser tests, including 18 new cases. The two unedited fiscal suites passed 20.
Dashboard, till and UI typechecks and scoped lint passed. The family output includes Lit warnings
and the catalogue screen suite's deliberately rejected marker (`catalogue-screen.test.ts:2320`).

In an independently installed disposable checkout, eleven separate removals each failed their
intended case alongside a passing untouched/reverted move control: native close interception,
Cancel, both choice notifications, busy-answer invalidation, disconnect disposal, child close,
and detached input/Cancel/report/Confirm controls. Restoring that checkout passed all 18 cases.
Sixteen temporary visual flows covered both operations in EN/ES, light/dark and 390/1280 widths,
with 32 axe scans. All 32 editor/warning captures were inspected in eight contact sheets. The
harness, images and logs are retained outside source in Lane E's local
`receipts/w69-catalogue-20261006`. Synthetic unload events check registration/cancellation only.
No existing test assertion changed.

Rebase onto `53659aa27965e188a567986c0630fcad9a8a3944` retained 56 equal patches in `git range-diff`;
the frozen install passed. Tasks 1/4 remain partial: canvas Create/Duplicate name dialogs and the
remaining modal classification still precede Tasks 5–6 page/history/navigation/native reload.
Neither proposed W69 PR is ready for finish-branch.


## Canvas name-dialog checkpoint, 2026-10-06

Create and Duplicate name dialogs now register separate scopes with the existing coordinator.
Create compares the raw name and form factor passed into the local editor; Duplicate compares
its trimmed submitted name, retaining invalid whitespace as a distinguishable value. Native
Escape and request-close ask about changes; Keep retains the entry and returns native input
focus, while Discard closes once without a canvas write. Reverts remove unload protection.
Create transfers its fields into the existing local editor directly. That editor's independent
page scope remains Task 6 work.

Duplicate stays open and nondismissible while its create request runs. A refusal keeps the name
and its protection. Success commits and unregisters before the list refresh, including a failing
refresh. Submission invalidates an earlier question, and detached controls cannot mutate or
submit retained entry. Parent requests scoped to the screen cover the name dialogs. These
boundaries are exercised by `apps/dashboard/src/screens/canvas-editor-screen.unsaved.test.ts`.

Receipts from the feature worktree:

- `pnpm --filter @waitron/dashboard exec vitest run src/screens/canvas-editor-screen.unsaved.test.ts`
  first failed all twelve added cases: missing unload notification, child close propagation,
  detached input/submission, and the immediate Duplicate close. No production code preceded it.
- The focused existing behavior, accessibility and expanded unsaved suites passed 110 tests.
  A refusal test initially sent Escape after disabling its focused input; explicitly refocusing
  the re-enabled native input exercised its native cancellation. No existing assertion changed.
- Nine independently removed guards in an installed disposable clone each produced the intended
  one failing case and one passing untouched Duplicate control. Restoring the clone passed all
  21 new cases. The controls removed each name dialog's close gate, Create name/form-factor
  notifications, Create parent association, child-report filtering, busy-question invalidation,
  Create disconnect disposal and detached-input protection.
- A temporary browser harness passed 16 flows across English/Spanish, light/dark and 390/1280 px,
  with 32 axe scans and 32 captures inspected in four contact sheets. The initial screenshot
  path outside Vite's allowed tree was refused; captures from the corrected path supply the
  visual receipt. The harness and captures are archived outside product source.
- Unedited fiscal golden-write and immutability suites passed 20 tests. Dashboard typechecking
  passed after adding explicit registry type parameters. Scoped lint passed after removing an
  unused lifecycle parameter; this cleanup leaves the tested guard expressions unchanged.

The command logs, deletion controls, source inventories and visual artifacts live under the
lane's local `receipts/w69-canvas-20261006/`. This checkpoint does not complete W69 or replace
current-head CI and the whole-branch review.

### Remaining modal boundary, source inspection on 2026-10-06

Re-ran the literal `<wt-modal`/`<wt-dialog` inventory over dashboard, till, setup and the contributed
media/bookings/venue-service/adjustment screens. This scan finds literal markup; it does not prove
that a dynamically constructed dialog is absent. Read the owners without close gates against the
original P/E classification. The remaining staged modal inputs are:

- `till-table-order-screen` preview (`#previewDialog`) and count (`#serveDialog`), including the
  `pendingDraft` review choices and `servePending.count`. Their Back and native `wt-close` routes
  currently remove local entry. Read their command-acceptance boundary before adding scopes.
- `till-app` line-edit dead-end station choice (`#renderEditDeadEnds`): Cancel and native close
  currently remove the selected station. This is distinct from the protected standalone
  `dead-ends-dialog` and remains Task 4 work.
- The outer profile container in `dashboard-app` still closes through `#closeProfile` without
  consulting the protected `profile-screen` child. Its native Close/Cancel path and shell
  profile/history paths remain to be wired. The child scope's ID is the profile-screen element.

Other ungated literal dialogs in that scan match the existing E rows: delete/publish/security
confirmations, report/detail views, immediate language/colour/device/printer choices, held-order
move target buttons, table takeover/fire/move-target confirmations, and station-health drilldowns.
This is source classification, not new runtime verification of every exemption. Existing owner
suites retain their assertions. Split/transfer selections and other inline table action inputs
remain staged page work in Tasks 4/6 even though their markup is not a dialog.

Tasks 1/4 remain partial. Shared history/shell integration and all page/setup owners in Tasks 5/6
remain open. Neither proposed PR is ready for finish-branch.


## Line-edit station-choice checkpoint — 2026-10-06

The till shell's `data-edit-dead-ends` question now registers its selected station separately
from the party draft. Cancel and native Escape use the shared coordinator. Keep retains the
station, while Discard restores only the local choice and closes without a retry. Confirm
retires this scope before dispatching the existing line-edit retry with its original quantity,
revision and selected `makeAt`. A new refused retry gets a separate opening and empty choice.
Child close reports and departed controls cannot operate on that replacement. Operator lock
invalidates an outstanding answer and clears the local question immediately.

Commands run in the feature worktree:

```sh
pnpm --filter @waitron/till exec vitest run src/till-app-drafts.test.ts src/widgets/dead-ends-dialog.unsaved.test.ts src/widgets/dead-ends-dialog.test.ts
pnpm --filter @waitron/fiscal-verifactu exec vitest run src/write-path.e2e.test.ts src/inmutabilidad.test.ts
pnpm --filter @waitron/till typecheck
pnpm exec eslint apps/till/src/till-app.ts apps/till/src/till-app-drafts.test.ts
```

The first run observed six missing-behavior failures and one passing untouched-close control.
The initial implementation left two Discard cases failing because rendering replaced the
callback that `wt-dialog.requestClose` was awaiting. Retaining one callback per opening passed
all seven cases. The expanded suite's reconnect experiment found that the existing URL controller
restores a route outside the order (`UrlStateController.hostConnected` calls `restore`); its new
case now checks retirement and that detached controls issue no retry. It does not claim a
retained modal after application reconnect. No existing assertion changed. The final three-suite
family passed 166 tests, including eleven new line-choice cases. The unedited fiscal suites
passed 20. Till typechecking, scoped lint and diff checks passed.

Four separate guard deletions in an independently installed disposable clone each produced
one intended failure and one passing untouched-close control: native close interception,
choice notification, child-close filtering and parent association. Restoring that clone passed
all eleven line-choice cases. A temporary visual harness passed eight EN/ES, light/dark,
390/1280 flows and sixteen axe scans. All sixteen warning/kept-editor captures were inspected
in four contact sheets. The command logs, disposable-copy results and visual artifacts are
retained locally in `receipts/w69-line-edit-20261006`; the harness and captures are removed
from product source. Synthetic unload checks establish listener behavior, not a native reload.

Tasks 1/4 remain partial. Next: the dashboard's outer profile Close/Cancel, inline split/transfer
choices, then Tasks 5/6 page/setup/history/navigation and native reload. Neither proposed W69
PR is ready for finish-branch; this checkpoint does not complete the item.


## 2026-10-06 outer profile container checkpoint

`dashboard-app` routes the profile footer Close through the outer modal’s `requestClose`, and
its stable `beforeClose` delegates to `profile-screen.requestLeave`. The child’s existing guard
retains its busy-write refusal and asks for that child’s scope only. Native outer cancel follows
the same guard; Keep retains the child, its exact telephone and profile URL, while Discard closes
the profile and replaces its URL with the underlying screen. Child close reports still cannot
close the outer container. The profile URL/history navigation paths remain Task 5 work.

Before implementation, `dashboard-app.profile-unsaved.test.ts` had four intended failures and
two passing controls. Its added shell cases cover exact submitted values, refused writes,
success before refresh refusal, stale Discard after save/disconnect/security expiry, reverts and
an unrelated retained draft. A real child Escape case checks preserved focus and values. These
cases exercise native `cancel` for the outer route; they do not establish keyboard access to an
outer dialog while its nested editor is topmost.

The existing shell cases for four landing roles, the catalogue return before/after profile save,
and fresh-reopen readiness now await the native close report. Their destinations, underlying
screen and readiness expectations remain unchanged. The queue’s FYI notes identify them for the
future PR’s Changed test checks. No fiscal, monetary, permission or sign-in check changed.

A whole-shell visual scan reported light-theme desktop selected-navigation contrast of 4.32:1.
A disposable probe using main’s dashboard shell reproduced that result with the profile closed.
The backlog records it outside W69; warning/editor accessibility scans cover those modal surfaces.
The new harness also supplies the underlying schedule’s actual roster read, avoiding a fixture-only
load error. Initial diagnostic logs and final captures remain in the local campaign receipts.

The six-suite family passed 632 browser cases before the final roster-fixture addition; the final
profile owner suites passed all 32 cases after it. Four independently removed guards each failed
one intended case beside a passing reverted-close control: native outer interception, footer
request-close, child busy refusal and child dirty-scope consultation. Restoring the installed
copy passed all ten new shell cases. An attempted all-scope mutation instead passed an invalid
request shape and failed structurally; it is not a deletion receipt. The corrected child-guard
probe supplies the fourth receipt.

Eight final EN/ES, light/dark, 390/1280 visual flows passed sixteen modal accessibility scans;
all sixteen final warning/kept-editor captures were inspected in four contact sheets. The
filtered owner/visual run passed 29 selected cases, with 21 deliberately unselected cases; it
is not a package-wide result. Unedited golden-write/immutability suites passed twenty cases.
Dashboard types, scoped lint, formatting and diff check passed. Local commands, diagnostics,
baseline probe and captures are retained under `receipts/w69-profile-container-20261006`.
The temporary visual source/captures and restored candidate were removed from product source.

Tasks 1/4 remain partial. Inline split/transfer choices and Tasks 5/6 page/setup/history/navigation
and native reload remain. Neither proposed W69 PR is ready for finish-branch at this checkpoint.


## 2026-10-06 inline table action checkpoint

Back now consults the same registry before abandoning split quantities, a transfer destination
and selected items, or the table selected for Split a table. The scope starts with the action's
empty defaults. Keep retains the exact raw quantity, selected items and target; Discard restores
those local inputs before continuing Back. Explicit Confirm retires this scope before dispatching
the existing command. Immediate Merge bill targets remain exempt. No command-body conversion or
server write is added by Discard.

The scope is a child of the table screen, so an enclosing leave includes it. Set membership and
quantity-map keys compare by value. Same-order reads retain its initial defaults. Disconnect
removes the scope and invalidates the question; reconnect reinstates its original baseline.
Old controls cannot alter a replacement flow. A busy transition invalidates a pending question
without restoring its staged inputs. The existing order-identity replacement closes actions and
invalidates the question; interception before a voluntary bill switch remains Tasks 5/6 work.

`apps/till/src/screens/till-table-order-screen.actions-unsaved.test.ts` uses the actual
LeaveController and table screen. The initial fixture omitted table signals and failed before
reaching the feature; that run is not a red receipt. With complete table fixtures, ten intended
assertions failed and the immediate-merge control passed. The first implementation passed all
11. Two departed-control cases then failed their assertions; liveness checks made them pass.
A temporary raw-quantity fixture allowed its parent rerender to overwrite its precision; the
fixture now supplies the same rows through the parent. The busy-transition case subsequently
failed because the old question stayed open, then passed after explicit invalidation. A final
departed-menu case failed when an old Name/Transfer/Split button reset a replacement split;
the same control-liveness check now covers those menu actions.

The retained receipt directory is `~/waitron-campaign-e/receipts/w69-inline-actions-20261006`.
Its logs name the exact tests and commands. The seven-suite family passed 711 cases before
the final departed-menu extension; the final table-screen family passed 273 cases, including
all 19 new action-owner cases. Eight independent deletions each failed the intended
assertion beside an unchanged passing control: Back, retirement before each of the three commands,
synchronous dirty notification, reconnect baseline, ancestor restoration and departed-control
liveness. The final busy invalidation and parent relationship receive separate deletion controls.
The unedited fiscal write-path and immutability suites passed 20 cases. No existing behavioral
assertion changed in this checkpoint.

The temporary visual probe runs Split bill, Transfer items and Split a table in EN/ES, light/dark
and 390/1280 widths. It passed 24 flows and 48 axe scans. Its first captures left the action below
the viewport; the final probe scrolls to the action and clicks the actual Back control. The final
48 question/retained-choice captures were inspected in six contact sheets. The probe source and
captures are retained outside product source. These are in-app Back and synthetic unload checks;
native reload, shell interception and remaining page/setup owners still need Tasks 5/6.

Tasks 1/4 remain partial pending the final owner classification and advancing-main audit. Tasks
2/3 remain complete. Neither proposed W69 PR is ready for finish-branch.


## Dashboard route checkpoint — 2026-10-06

The dashboard now installs the accepted-history adapter. Sidebar requests and product deep
links write their complete destination before the shell changes its screen. Ordinary same-app
anchors are intercepted through their dispatched click's composed path, including links from a
child shadow root. Modified clicks, new tabs, downloads and other origins/app paths stay with
the browser. Account settings keeps the underlying page mounted; closing it selects only the
profile scope. Forced expiry resets pending traversal before replacing the login URL.

`dashboard-app.unsaved-changes.test.ts` exercises an edited profile's actual telephone input
through sidebar, indexed Back/Forward, same-app links and product deep links. It also checks
reverts, old answers after expiry and retained main-page input (the latter is a test-only
registered owner, not evidence for each page). `navigation-guard.test.ts` checks destination-based
retained scopes and accepted-route URL normalization. Three existing dashboard shell fixtures
now disconnect their previous application before mounting the next application in the same
document; every existing permission/navigation assertion remains unchanged.

Receipts: `~/waitron-campaign-e/receipts/w69-shell-routes-20261006`. The initial sidebar selector
and retained-route probe failed before their intended assertions; the corrected runs supply
the RED receipts. The initial family exposed the retained-page close and current-page group
regressions; their original assertions pass after scoping and accepted-route handling fixes.
Seven separate installed-candidate deletions failed at the intended assertions beside passing
controls. The restored candidate passed its shell and adapter/controller suites and its two
production files byte-matched the feature checkout. Scoped adapter/controller coverage and
shell/browser checks are recorded in that receipt directory; package-wide CI remains pending.

The rendered Back/Keep/Discard probe covers EN/ES, both themes and 390/1280 widths, with axe on
the confirmation and retained profile editor and screenshots of both states. Native reload,
actual pointer navigation through a modal backdrop and individual page owners are not covered
by that probe. Its initial background Orders read used an incomplete API fixture; the final
probe supplies those reads and is retained separately.

Tasks 1/4 remain partial, 2/3 complete, and 5/6 incomplete. The remaining Task 5 work includes
till/setup shells, direct receipt/login writers and screen/tab/context mutations before URL
writes, plus activated native reload. Task 6 still supplies every page/setup owner. Hours landed
as #1298, main `bbc14bc0f`, during this checkpoint; rebase and audit its cell/date/calendar
editors before treating the old station-hours classification as current. No partial PR is ready.


The later encoded Profile-link case first failed on a shadow-root fixture's absent parentElement;
that is not RED evidence. After moving the anchor into the actual shadow root, the intended URL
assertion failed. Destination scoping now decodes the primary segment, with a malformed-segment
control retaining its existing fallback. An eighth installed-candidate deletion of that decoding
failed the encoded-link assertion; the malformed-route control passed. The final restored shell
suite passed 37 cases. The earlier shell family passed 368 cases before these two added cases;
scoped adapter/controller checks passed 41, and unedited fiscal checks passed 20. Final visual
fixture checks passed 43 (35 route cases plus eight visual flows), with 16 scoped axe scans and
16 inspected final captures before the encoded-link extension. These dated counts are receipts
for the named stages, not a full-branch completion claim.


## Configure hours checkpoint — 2026-10-06

The Hours page's Configure editor now registers its seven-day draft with the shared coordinator.
Cancel and native Escape ask before closing edited values, including from the compact Save hours
confirmation. That confirmation's Back returns to the retained draft without a warning. Opening
another editor asks before replacing the draft. Compare each day's submitted mode and ordered
period values; periods excluded by the chosen mode do not make that day's payload dirty.

`hours-screen.unsaved.test.ts` exercises all seven days, clean/reverted values, invalid period
input, exact accepted/refused bodies, failed following refresh, background refresh, reconnect,
replacement openings and departed write completion. Starting a weekday or Configure write
invalidates an unanswered question while retaining the dirty draft until acceptance. The initial
Configure run failed four missing-warning assertions; the lifecycle extension failed its
unanswered-question assertion before the write-start invalidation was added.

Receipt directory: `~/waitron-campaign-e/receipts/w69-configure-hours-20261006`. The final five-suite
Hours browser run passed 175 tests; unedited fiscal checks passed 20. Six independent deletions
in a frozen-installed disposable checkout each failed the intended assertion while the
clean/reverted control passed. Restoring the source passed all 29 unsaved cases. That candidate's
three changed source/test files byte-matched the feature checkout before it was removed.

Eight Configure visual flows passed 24 scoped axe scans and captured the question, retained
seven-day editor and compact save confirmation in EN/ES, light/dark and 390/1280 widths. All 24
captures were inspected in four contact sheets. This is a component host with shell Spanish copy,
not a full-dashboard navigation test. Typechecking, scoped lint and formatting checks passed.

The older weekday Cancel/focus case still asserts the same absence, returned focus, original
value on reopening and zero writes. Its first absence check now polls for the native close report.
The immediate assertion failed in the preceding signed-off checkpoint `1eee5b10c` too, measured
in a separately installed checkout (`baseline-close.log`). Copy this timing change into the
eventual PR's Changed test checks section. No other existing assertion changed in this checkpoint.

Tasks 1/4 still need the special-date/calendar/duplicate owners and final advancing-main audit.
Tasks 5/6 still need direct receipt/login history consumers, all screen/tab/context interception,
till/setup shells, the remaining page/setup owners and activated native reload. Tasks 2/3 remain
complete. Neither proposed W69 PR is ready for finish-branch.
