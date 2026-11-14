# A1527: Find settings inside windows through Search pages

You should find a setting without knowing its window. **All four families below are required in the first released version.** Scope authority is the owner's **"3"**, recorded in `~/waitron-campaign-i/questions.md`, WATCHER 2026-11-14 18:02, answering “departments first / plus receipts / everything at once”. This approves scope only. Claude read the design (180 s) and its revision (143 s); the watcher cleared the corrected design for docs-only publication on 14 November at 18:17.

Type **“Remind to fire the next course after”**, or “remind”, into **Search pages**. The result shows the current-language label and **Departments and zones / Service**. Spanish finds **“Avisar para marchar el siguiente curso tras”**. Preserve `nav-search.ts` matching: labels rank ahead of location-only matches. Enter opens the first page match before falling back to a destination; clicking opens the selected result. Only settings gain a tab/window suffix. Existing page, Venue settings, Calendar and module results retain their formats.

**Required coverage.** Declare settings beside their owning field definitions:

- **Departments:** Details, Service and Transfers in venue-service's `department-settings.ts`, beside `fieldTab`, sharing nested `service-settings-fields.ts` definitions.
- **Receipts:** dashboard's real `department-receipt-editor.ts`, mounted through `renderPanel("department-receipt", …)` in `venue-departments-shell.ts`. Its dashboard-owned declarations open Receipt, covering saved fields and logo; transient preview selectors are not settings.
- **Zones:** `zone-edit-dialog.ts`, including name and all three shared service overrides. Defaults and overrides produce distinct department/zone results.
- **Hardware:** printer edit/calibration controls, including receipt/kitchen and A4 variants; device settings; card-reader name/slip settings; device-profile controls. Reuse field/role/capability definitions in the four owning `*-screen.ts` files. A1529's profile tabs are **General**, **Where it serves**, **Who can sign in**, **What it can do**, **Printers and card readers**; **Kitchen screens** replaces Where/Who for kitchen profiles. Calibration targets open the step holding the setting, including drawer/portable/pickup on step 3, without running a hardware action. Paper width and Resolution also match their details labels, opening the existing ruler-number and QR-square controls; the completeness check includes those two answers explicitly.

**Shared mechanism.** Add a resolved-setting variant alongside static `DashboardSearchDestination`: stable identity, existing label key, screen/tab/window and row resolver. The shell aggregates exported core/module declarations; rendered labels and search share definitions. No copied central settings list or form framework. At activation, module resolvers receive `DashboardModuleContext`'s request/render-panel context; core resolvers use the dashboard API. Reuse `VenueServiceApi` and Hardware list reads; automatic reads stay passive.

Keep existing page/child permissions and enabled-module gates. Row eligibility uses receipt-panel availability, `offeredDepartmentTabs` and hardware/profile-kind rules; Transfers requires two active departments. Recheck declaration identity, gates and eligibility on click. Reuse the existing destination screen/path checks at that boundary, with visible refusal for an invalid candidate. Invalid paths get a visible refusal. Keep static-path validation in synchronous `collectSearchDestinations`; validate asynchronous candidates only at activation, without static-href freshness matching.

**Choosing and opening.** Open one eligible candidate directly, or offer several in a chooser with Cancel, including when one of them is already open. Zone choices show department and zone together. No candidates gets an explanation and Cancel, without creation; failed reads offer Retry. Vanished rows/unavailable tabs get an explanation, never a substitute.

Reuse department/zone routes and printer/profile row paths. Add `dashboardPath` entries and screen-owned URL controllers for device/reader rows, profile tabs and printer edit/calibration step selection; do not change the shared `UrlStateController`. These addresses open existing editors and support Back/Forward/reload. Final navigation uses `navigationGuardFor(window).write`, draft scopes and `navigationScopes`: Keep editing retains draft/query/drawer; Discard proceeds. Offered department-tab changes retain their draft. Landing on the window/tab finishes search: no field focus, scrolling or reveal handoff.

**Completeness.** Each window's existing browser fixture mounts every offered tab/variant and compares named configuration controls, including nested controls, with declarations and rendered labels, in both directions. Data-driven choice groups, service steps and repeated receipt-language fields count once; fixed capability labels remain individually searchable. Explicit exclusions cover buttons, list filters and transient diagnostic answers. Acceptance covers EN/ES matching, zero/one/several candidates, gates, vanished rows, invalid paths and Keep/Discard/navigation. Locations follow `#permittedNav`; whichever lands second checks Hardware/System and profile-tab names against `docs/superpowers/plans/2026-11-14-a1529-hardware.md`.

**Sequencing.** Device-profile search follows A1529 2b: its tabs do not exist in today’s editor. That plan says build after A949. This search PR owns the explicit-target exception to A1529’s default “Open General on each profile load”; ordinary profile opens still start on General. Card-reader search coordinates with A1529’s payments-window slice, preserving both changes. All required families must land before the whole ask is complete; this dependency is a delivery limit, not an extra release framework.

**Size and delivery.** Estimated changed lines, unmeasured; production includes declarations, routing and EN/ES wording. All seven PRs are required; the Hardware family is split by window.

| Required PR | Production | Tests |
| --- | ---: | ---: |
| Shared search/chooser + departments | 450–600 | 350–500 |
| Receipts | 100–150 | 120–180 |
| Zones | 80–120 | 100–150 |
| Printers | 180–260 | 180–260 |
| Devices | 180–260 | 180–260 |
| Card readers | 100–160 | 120–180 |
| Device profiles | 150–220 | 180–260 |
| **Total** | **1,240–1,770** | **1,230–1,790** |

Approximate added/removed totals: production +1,100–1,600/−140–170, tests +1,100–1,600/−130–190; docs +80/−20; no generated files are expected. These are unmeasured estimates, to be refined in each family plan.

No search of saved values, cross-language synonyms, creation flow, server index or database change. Driver checks this revision, requests one Claude reread, then reports WATCHER-NEEDED. The watcher's 18:02 direction permits docs-only publication afterwards unless the reread changes what the owner would see.
