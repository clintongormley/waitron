# Data protection and legal compliance — detail

The open entries are listed in [the backlog](../backlog.md), under “Data protection and legal
compliance”. This file holds their full text.

## A664 — archive or delete a venue's old data once it no longer has to be kept

- **A664 — archive or delete a venue's old data once it no longer has to be kept (owner,
  2026-10-14; revised proposal adopted for specialist review 2026-10-17;
  relevant adviser agreement, implementation and verification remain open).** Read the
  [revised design](../superpowers/specs/2026-10-16-a664-data-retention-design.md),
  [unchanged primary-source register](../compliance/research/2026-10-16-a664-retention.md),
  [historical inventory with dated current delta](../superpowers/specs/2026-10-16-a664-retention-table-inventory.md)
  and [complete current field audit](../superpowers/specs/2026-10-16-a664-personal-data-audit.md).
  This is static schema review, not runtime inspection or proof of actual data prevalence.

  **Owner-adopted proposal for specialist review:** keep live undeleted business/evidence on
  one shared schedule based on the longest applicable legal floor, preserving necessary dinner
  allergy evidence rather than expiring it at service end. Six years is a discussion baseline;
  actual book/venue clocks, longer floors and proportionality require fiscal/commercial, labour
  and privacy agreement. Unnecessary identifying information is assessed separately for earlier
  removal, subject to remaining evidence duties. The schema has booking names/phones, account
  names/emails/telephones, invoice identities, staff links, card metadata/provider references,
  health fields and free-text/payload routes; no absence-of-personal-data assumption is accepted.

  Explicit deletion, supersession or archive opens a separate retirement assessment, potentially
  immediate or within the next daily sweep when no floor, hold, dependency or storage protection
  remains. UI visibility or status is never evidence of removal permission. Necessary archived
  evidence retains its duties; protected rows remain blocked pending separate approved storage
  design. No trigger/hash/allocation/restore change, bypass, folder rotation or artificial chain
  is authorised. Obsolete credentials/sessions and disposable delivery/queue machinery remain
  purpose-bound, never retained for years by the shared live schedule. Minimum necessary staff
  and evidence identity survives with its records.

  The [recorded owner decision](../superpowers/specs/2026-10-16-a664-data-retention-design.md#owner-decision-2026-10-17-adopted-for-specialist-review)
  supersedes the design snapshot’s pending approach question. Its three worked examples remain
  proposals subject to specialist agreement. The [dated Q48 revision](../compliance/asesor-questions.md#q48-a664-retention-and-evidence-process-added-2026-10-16)
  supersedes the initial short live-allergy expiry premise and separates fiscal, labour and privacy
  decisions. You will send Q48; no enquiry was sent by this campaign. **All product code, including
  reporting, waits for relevant G1–G3 design agreement; G4/G5 remain in force.** The existing
  finished print-job month choice remains subject to audit/replay dependencies. A664 stays open
  for adviser agreement, build and verification; the wider privacy programme remains open under
  “The advisor gap”.

## libvips is LGPL-3.0-or-later

- **libvips is LGPL-3.0-or-later** and ships in the box image with its notices and a written
  source offer in `/app/third-party/` (`deploy/third-party/`). The legal advisor is asked to
  confirm it (`docs/compliance/action-plan.md`, 2026-09-23). Left open by photos shrunk
  on upload (#543).

## cairo, built into that libvips, is listed under the Mozilla Public License, and `/app/third-party/` carries neither its licence text nor a source offer for it

- **cairo, built into that libvips, is listed under the Mozilla Public License, and `/app/third-party/`
  carries neither its licence text nor a source offer for it** — found by A775 (#1760, 2026-10-16).
  sharp's libvips package lists cairo under the MPL (1.1 since 1.3.4, 2.0 in 1.3.3); that list is
  the package's `README.md`, copied into the image as `/app/third-party/libvips/NOTICES.md`
  (`deploy/Dockerfile`). cairo's own `COPYING` offers LGPL 2.1 or MPL 1.1. `deploy/third-party/` covers
  only the LGPL-3.0 libraries: it holds neither the MPL 1.1 nor the LGPL 2.1 text (the Debian base
  image's `/usr/share/common-licenses/` has both, unreferenced), and its source offer does not name
  cairo.
  The legal advisor is asked (`docs/compliance/action-plan.md`, 2026-10-16). **Next action:** add
  the licence text and source notice the answer calls for.

## A980 — data protection, Waitron's side

[Design, revision 2](../superpowers/specs/2026-10-22-a980-data-protection-design.md) (2026-10-24)
and its [build plan](../superpowers/plans/2026-10-24-a980-data-protection-build.md). The owner
answered all ten questions on 2026-10-22 (design §8). The open slices, by the design's numbers (S5, S7 and S8 were dropped
by the answers):

- **S2** — a staff member downloads their own data from their profile; an admin downloads another
  person's under a new admin-only permission, `personal_data.export`. Built: the server route for a
  person's own download (`GET /management-api/me/personal-data/export`, a ZIP of their profile and
  sign-in details with a `README.txt` first, in the person's own language, English or Spanish), the
  Profile page's **Download** button beside **Copy of your data**, and the Users guide's "Download
  your data" section (`{#own-data}`) in English and Spanish. When the workforce module is on, the
  download also holds `employment.json`, `rota.json`, `absences.json` and `attendance.json`, and
  when the staffing module is on, `staff-roles.json`. When workforce and a working-time exporter
  (today `workforce-es`) are both on, it also holds the working-time record (`time-record.pdf`,
  `time-record.csv`), but only if the person has an entry at this box's location
  (`apps/server/src/personal-data-time-record.ts:26`, `:42`). Since S2c
  ([its plan](../superpowers/plans/2026-10-25-a980-s2c-actions-admin-download.md)) it also holds
  `actions.json` when the person has at least one such action: the whole sales already recorded
  whose void they authorised, the refunds they asked for, authorised or recorded the outcome of,
  and the cash-drawer openings they made or authorised, with how many of each, the invoice number
  and amount where there is one, when, and their part in each refund and opening
  (`apps/server/src/personal-data-actions.ts`); the README inside the download lists every field
  (`apps/server/src/i18n/personal-data-readme.ts`). No product path records a whole-sale void yet, so
  the voids list is empty on every box until one does (S2c decision 3). Since S2d
  ([its plan](../superpowers/plans/2026-10-25-a980-s2d-line-voids.md)) it also holds
  `adjustments.json` when the person made or approved an adjustment: the voids, comps and
  discounts on a bill that they made giving a reason, or approved for someone else, from the
  adjustments module's own part (`packages/adjustments/src/personal-data.ts`; S2d decision 4). An
  admin downloads another person's data, a disabled person's included, from **Download their
  data** in the person's row menu on **Users** (`GET /management-api/staff/:id/personal-data/export`),
  with the README in that person's language, else the venue's, and the Users guide's "Download
  another person's data" section (`{#person-data}`) says how. What is left of S2 is in the points
  below.
- **A manager's own copy of what they decided about others** — the absences and swaps they
  decided, the rotas they published and the attendance answers they authorised: the design's "who
  did what" row (§2.1 row s12). S2c's actions part, as scoped, covers only voids, refunds and drawer
  openings (S2b decision 11).
- **The rest of "who did what" in the download** (design §2.1 row s12). S2c's `actions.json` holds
  only whole-sale voids, refunds and cash-drawer openings (S2c decisions 2 and 3), and S2d's
  `adjustments.json` the line voids, comps and discounts. What is left:
  - **The core columns** the guard in `apps/server/src/personal-data-actions.coverage.test.ts`
    lists as not in the download yet, by table: `sales` (`operator_id`, who rang a sale;
    `authorized_by`, who authorised a corrective invoice); `unpaid_departures` (`authorized_by`,
    `recorded_by`); `receipt_reprints.person_id`; `invoice_pdf_downloads.person_id`;
    `invoice_deliveries.person_id`; `bill_payments` (`requested_by`, `attested_by`);
    `order_amendments.actor_id`; `ticket_item_moves.moved_by_person_id`; `order_drafts.owner_id`;
    `order_draft_events` (`actor_id`, `from_person`, `to_person`); `order_group_events.actor_id`;
    `order_groups` (`fired_by`, `submitted_by`); `working_order_lines.credited_to`, whose sale a
    line counts as; `bill_edit_states.editor_id`, who is editing a bill; `parties` (`opened_by`,
    `closed_by`); `daily_closes.closed_by`; `incidents.acknowledged_by`; `membership_clearances` and
    `membership_removals` (`person_id`); and `pass_item_marks.done_by_person_id`. Core's
    `line_service_cancellations.actor_id` is covered by `adjustments.json`: every value of it is
    also an adjustment's requester (S2d decision 3). The guard knows a column by its name;
    `credited_to`, `owner_id` and `editor_id` are named in it because the name pattern would miss
    them (S2c decision 2).
  - **Other modules' actor columns**: bookings, menu publication, fiscal operations, payment holds
    and resolutions, department transfers, allergy answers and service steps, and the adjustments
    module's `credited_to`, whose sale the item counted as. The S2c guard reads core's tables only;
    since S2d the adjustments module's columns are held by its own guard,
    `packages/adjustments/src/personal-data.coverage.test.ts`.
  - **The invoice number of an adjusted bill in `adjustments.json`.** The file gives the order
    number only, which is what the Adjustment report shows of each entry. The invoice number of the
    sale later filed from the bill could be found through `sales.working_order_id`, but formatting
    it needs `formatInvoiceNumber` from `@waitron/core`, a new dependency for the adjustments
    package, and one more lookup per row inside the snapshot turn (S2d decision 9).
  - **The table in `adjustments.json`.** An adjustment records the bill, not a table, and a bill's
    table is not one column: a party's bill reaches its tables through its party, a counter order
    names the table it is delivered to in `delivery_table_id`, and the bill's `label` is operator
    text that filing overwrites with the frozen table grouping (S2d decision 9).
- **An administrator's sign-in that keeps the current session**, offered in place on a permission
  refusal. Today the dashboard has none (S2c decision 12), so when a person who has lost
  `personal_data.export` presses **Download their data**, the refusal's **Sign in as an
  administrator** signs them out first. The server already checks an administrator's credentials
  for one request without replacing the session — `checkManagerPassword`, then `loginManagerById`
  → `authorizeManager` → `endManagementSession` in one transaction
  (`apps/server/src/management-api.ts:1065-1078`) — which is the pattern to reuse.
- **Owner question: the times of the shifts a swap names.** Today a swap in the download carries
  no shift (S2b decision 8). Example: Ana offers Marta her Saturday 18:00–02:00 shift as a
  give-away; Marta accepts and Luis approves. Approving moves no shift, so the shift stays Ana's
  and Marta's copy shows the approved swap with no time. The alternative is to add the two shifts
  the swap names as `fromShift` and `toShift`, which shows Marta the times of a shift that is Ana's.
  Include them, yes or no?
- **The working-time record of a box with more than one location** — only this node's location is
  exported (S2b decision 6). Today provisioning refuses a second, different location.
- **Measure the working-time and actions parts on a box.** On a Mac, with 48 closed pay periods ×
  30 staff, Task 6a's run timed the read inside the write lock at 669.7 ms. Task 6c, measuring its own
  before-figure on the same Mac at 590.2 ms median, moved the person cut to read time, with one
  copy of the export's logic, and brought it to 213.8 ms median with an identical CSV. The
  whole-history PDF for 4 years × about 20 shifts a month rendered in 2.6 s (4.0 MB) on the Mac
  (Task 6a); the plan's 650 ms estimate was for 1,000 sessions. The PDF renders on the thread that
  serves sales, which is why the box's figure matters. Measure both on a box.
  The actions part (S2c) reads in write-lock turns of its own while the files are built, after the
  turn that reads the other parts. S2c's Task 3 measured them on the Mac, with 1,000,000 drawer
  openings and 20,000 whole-sale voids, for a person with 33,677 openings: medians of 12 builds, in
  each of two freshly loaded databases, of row turn 1 (voids and refunds) about 7 ms; row turn 2
  (drawer openings) 105 and 125 ms (single builds 97–196 ms); each of the 83 invoice-number turns
  (up to 500 sales a turn) about 2 ms; one bill-payment turn under 1 ms; the whole build about
  0.3 s over 86 turns. `actions.json` was 7.07 MB. The two row turns scan their whole tables,
  because none of the person columns they select on has an index, so they grow with the venue's
  whole history, not only the person's (S2c decision 4). A control with indexes on those columns,
  not shipped, brought row turn 2 to 61 and 75 ms. Repeat the turns and the file's size on a box.
  The adjustments part (S2d) reads in the first turn. S2d's Task 3a timed it on the Mac with
  200,000 adjustments over 100,000 bills: medians of 15 reads, for a person named on 6,667 rows,
  31.4 ms with the two indexes of adjustments migration 0009 and 52.5 ms with them dropped; for a
  person named on 50 rows, 0.26 ms and 30.8 ms. The heavy person's `adjustments.json` was 2.6 MB.
  Task 3b timed the whole first turn, every part, for a person heavy in both the working-time
  history (48 closed pay periods × 30 staff) and the adjustments: a median of 238.2 ms over 12
  runs (234.5 ms on a repeat; 213.1 ms without the adjustments part, which itself took about
  24 ms), with the route's own single-row reads left out. Repeat both on a box.
- **The first snapshot turn is close to S2b's 250 ms bar for a person heavy in every history.**
  S2d's Task 3b measured 238.2 ms median on the Mac, its slowest run 249.9 ms, and about 89% of it
  is the working-time read (about 213 ms). A slower box, or a longer history, would cross it.
  Options: give a module's part write-lock turns of its own, as the actions part has, or narrow the
  working-time read further.
- **The Profile page's help badge covers the end of its label** — at 1280 and 390 px, the "?"
  badge sits over the last letter of "Copy of your data" / "Copia de tus datos". The placement
  came from S2a2 (#2049), whose test in
  `apps/dashboard/src/screens/profile-screen.personal-data.test.ts` puts the badge's centre on the
  label's top trailing corner. The shared rule in
  [design-system.md](../developers/design-system.md) (`wt-help-tooltip`) hangs the badge over the
  top trailing corner of the nearest positioned box, so the fix is likely which box is positioned
  on the Profile row, not the shared rule (not measured). Place it so it never covers the label.
- **Mount the own download from `boot.ts`** — the route is mounted through `mountMeApi`, which
  gets module names and rebuilds the modules with `modulesNamed` (`apps/server/src/modules.ts`),
  and is not given boot's `now`, because #1990 was editing `boot.ts` while the route was built.
  `mountMeApi` now also builds the working-time part from `modulesNamed`
  (`apps/server/src/me-api.ts`). #1990 has since landed, so the next step is for `boot.ts` to pass
  its module list (`setsToMigrate`) and `now`, as it does for the attendance export, and to delete
  `modulesNamed` and `MeApiDeps.now`.
  The admin's download of another person (S2c) is mounted by the same function,
  `mountPersonalDataExportApi`, so the move takes both routes.
- **S3** — an admin finds an invoice customer by tax number and downloads what the box holds.
- **S6** — English and Spanish help-guide templates: privacy notices, record of processing, breach
  checklist.
- **S10** — check that logged errors carry no names or email addresses; mask them if they do.
- **S1** — a dashboard setting for the address of the venue's own privacy-notice page, replacing an
  environment setting a box cannot set. Adds a migration, so while lane B builds it, it waits for
  lane B's parked pull request (#2025) to close: lane B's own rule; it carries no
  migration.
- **S9** — erase a booking guest's details on request. Waits for the privacy specialist (A664 G3).
- **S11** — clear a former employee's email a year after she leaves, keeping her name. Adds a
  migration; waits for the labour and privacy specialists (A664 G2, G3).
- **Receipts and invoices** — a privacy line waits for the specialist's answer to Q59 (design
  §4.1.1).
- **Emergency admin recovery keeps its own wipe** — `apps/server/src/break-glass-command.ts` clears
  sign-in details with its own SQL rather than identity's shared helper (left out of S4, #2032),
  and does not delete pending passkey challenges. Next action: route it through the helper, or say
  at the command why not.

## Decisions and deliberate limits

- **A980 S2d, 2026-10-26:** line voids, comps and discounts are in the download as their own
  `adjustments.json`, from the adjustments module's part, not in `actions.json`; that settles in
  practice the S2c question the owner left open (should they have joined S2c?). An item taken off
  with **Remove** before its preparation started is not in the file: no row records who removed
  the line (an `order_group_events` row names the person only when the removal empties a held
  group, and that column is not in the download yet). See the
  [S2d plan](../superpowers/plans/2026-10-25-a980-s2d-line-voids.md)'s decisions 4 and 14.

- **A664, 2026-10-17:** you adopted the revised retention proposal for specialist review.
  Six years remains the discussion baseline. Q48 is yours to send; all product/report code
  waits for relevant fiscal/commercial, labour and privacy design agreement. G4/G5 remain
  required; this decision authorises no removal or fiscal invariant change. See the
  [dated decision](../superpowers/specs/2026-10-16-a664-data-retention-design.md#owner-decision-2026-10-17-adopted-for-specialist-review).
- **A980, 2026-10-22:** the owner's ten data-protection answers. A former employee's email is kept
  a year after she leaves, then cleared, keeping her name (O1); sign-in details are deleted at
  deactivation (O2); the full privacy notice lives on the venue's own web page (O3); staff download
  their own data, and anything else needs an admin-only permission (O5); a privacy line on receipts
  waits for research and the specialist (O4); no allergy-note hint (O6), no requests list (O7), no
  backup-storage check (O8); bug reports carry only what O9 (a) allows (in the A9 entry,
  `docs/backlog/alerts.md`); EN/ES guide templates for the record of processing and breach
  checklist (O10). See the design's
  [§8](../superpowers/specs/2026-10-22-a980-data-protection-design.md#8-owner-decisions-answered-2026-10-22).
