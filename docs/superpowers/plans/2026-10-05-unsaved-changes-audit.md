# W69 editable-form inventory

> 2026-10-06: Hours (A261 step 5) deleted `station-hours-form` and added the Hours page's own editors (`packages/venue-service/src/dashboard/hours-screen.ts`), which this document does not list.

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
| DS `menus-screen` layout form; DW `home-layout-editor`                                                                                                             | **P** create/duplicate/rename layout name, seed existing/copy/default name and trim exactly as Save. **E** tile add/reorder/replace/default assignment already writes through host events; do not create a new staged layout transaction.                                                                                                                         | Name modal, layout/tab/menu/page                                                         | DS `menus-screen`; DW `home-layout-editor`                                                 |
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
