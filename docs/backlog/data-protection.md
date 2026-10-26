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

- **S2** — the remaining download work is listed below.
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
  `personal_data.export` presses **Download their data** on a person, or **Find** or **Download
  their data** in Orders' **Find a customer by tax number**, the refusal's **Sign in as an
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
- **Measure the working-time, actions and adjustments parts, and the invoice customer's download,
  on a box.** The PDF renders on the thread that serves sales, which is why the box's figure
  matters. Measure the working-time read and PDF on a box.
  The actions part (S2c) reads in write-lock turns of its own while the files are built, after the
  turn that reads the other parts. The two row turns scan their whole tables, because none of the
  person columns they select on has an index, so they grow with the venue's whole history, not
  only the person's (S2c decision 4). Repeat the turns and the file's size on a box.
  The adjustments part (S2d) reads in the first turn. Measure that read and the whole first turn
  on a box.
  The invoice customer's search and download (S3) read in a search turn, a first turn and one turn
  per invoice. Repeat the S3 plan's decision 7 measurements on a box, against its stop rules, with
  the ZIP's size and the whole download's time.
- **Reduce the first snapshot turn's cost for a person heavy in two histories.** The
  [S2d plan](../superpowers/plans/2026-10-25-a980-s2d-line-voids.md#decisions-this-plan-makes-that-the-spec-does-not),
  decision 13, sets a 250 ms median stop rule for its Mac fixture with heavy working-time and
  adjustments histories.
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
- **What the box keeps with a tax number outside issued sales is not in the invoice customer's
  download** (S3 decision 19): the customer typed for a full invoice on a bill
  (`working_orders.recipient_tax_id`, `recipient_legal_name`, `recipient_address` and
  `recipient_country_code`), with the email address staged for it (`working_orders.invoice_delivery`),
  kept while the bill's choice is a full invoice, whether or not one was issued from it; and the
  printer bytes of a printed full invoice (`print_jobs.payload`). Switching a bill back to a
  simplified invoice clears the staged customer (`setOrderInvoiceChoice`,
  `apps/server/src/working-order.ts`). While full invoices are off, a bill is the only place an
  invoice customer's tax number can be (S3 decision 21): `setOrderInvoiceChoice` stages a
  full-invoice choice with a customer without asking whether full invoices are on, and paying such
  a bill is refused (`refuseUnavailableFullInvoice`, the same file). The README says the
  box keeps such details and to ask the venue for them. Waits for the owner's answer below.
- **A supplier found by tax number is not in the invoice customer's download.** A purchase invoice
  from a supplier who is a sole trader carries that person's name and tax number
  (`purchase_invoices.supplier_tax_id`, `packages/db/src/schema/purchase-invoices.ts`; design
  §2.2), and the S3 search reads only issued sales. The README tells the customer that anything
  else the venue holds, such as an invoice they sent the venue, is not in the copy and to ask the
  venue for it. Next action: decide whether a supplier's request gets a download of its own.
- **A foreign invoice customer's tax number** (S3 decision 4). None can be stored today: staging a
  customer whose country is not Spain is refused `fiscal.foreign_recipient_unsupported`
  (`apps/server/src/invoice-selection.ts`), as is the Verifactu record that would name them
  (`buildDestinatarios`, `packages/fiscal-verifactu/src/backend.ts`), because which `IDOtro` type a
  non-resident takes is open with the adviser
  ([Q17(a)](../compliance/asesor-questions.md#q17-f3-canje--recipient-identity-series-and-cross-sif-substitution-added-2026-08-26)).
  The search's rule removes only a leading `ES`, so a foreign number would be matched with its own
  country prefix kept. Next action: revisit the rule when Q17(a) is answered.
- **Owner questions on S3's defaults**, each built with the default until answered (the S3 plan's
  "Open decisions for the owner"):
  - **The README's language** (decision 10): the venue's, not the language of the customer's newest
    invoice (`sales.locale`). Example: a Spanish venue invoices a visiting English sole trader in
    English; his README is in Spanish.
  - **No record of who downloaded a customer's copy** (decision 12): an order's detail lists who
    downloaded its invoice PDF from **Orders**, and a copy given out through S3 does not show
    there. Example: the admin downloads Jordi's ZIP; the next day a manager opens bill F/2 on
    **Orders** and sees no PDF download.
  - **Details kept outside issued sales** (decision 19): not in the download (the point above).
    Example, once full invoices are on: staff type Jordi's details on a bill and issue his full
    invoice; his download holds the invoice, not the bill's own copy of his name, tax number and
    address, and the README tells him the venue keeps such details.
  - **An invoice with someone else's name on the customer's number** (decision 20): every invoice
    carrying the number is in the download, and the dialog shows each row's name first. Example:
    staff typed Jordi's NIF, 12345678Z, on an invoice for Maria Puig at her address; Jordi's ZIP
    holds Maria's name and address.
  - **S3 built before full invoices exist** (decision 21): the alternative was to park S3 until
    they are switched on.
- **S6** — English and Spanish help-guide templates: privacy notices, record of processing, breach
  checklist.
- **S1** — a dashboard setting for the address of the venue's own privacy-notice page, replacing an
  environment setting a box cannot set. Adds a migration.
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

- **A980 S2c, decision 3:** no product path records a whole-sale void yet, so the voids list is
  empty on every box until one does. See the
  [S2c plan](../superpowers/plans/2026-10-25-a980-s2c-actions-admin-download.md).

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
- **A980 S2d, 2026-10-26:** line voids, comps and discounts are in the download as their own
  `adjustments.json`, from the adjustments module's part, not in `actions.json`; that settles in
  practice the S2c question the owner left open (should they have joined S2c?). An item taken off
  with **Remove** before its preparation started is not in the file: no row records who removed
  the line (an `order_group_events` row names the person only when the removal empties a held
  group, and that column is not in the download yet). See the
  [S2d plan](../superpowers/plans/2026-10-25-a980-s2d-line-voids.md)'s decisions 4 and 14.
- **A980 S2d follow-up, 2026-10-26:** the owner chose to keep each adjustment's reason in
  `adjustments.json` as the venue named it on the Voids and comps page, even though a reason's
  name can name someone (the question's example: a reason "Ana's mistake" appears in the copies of
  the person who used it and the person who approved it). The free-text note stays out (S2d
  decision 8). Relayed by the watcher, `questions.md:4377` in lane B's campaign folder.
- **A980 S3, 2026-10-26:** the invoice customer's search and download refuse on a mirror
  (403 `node.read_only`), unlike S2c's admin download of a person (the [S3 plan](../superpowers/plans/2026-10-26-a980-s3-invoice-customer-download.md)'s
  decision 14). The owner then decided that a mirror is to serve no dashboard at all, so this
  refusal is the permanent answer, not a wait for A1111, which is withdrawn. Relayed by the
  watcher, `questions.md:4400` in lane B's campaign folder.
- **A980 S10, 2026-10-26:** what the log masks and what it leaves, each built with the default
  and open for the owner to reverse (the [S10 plan](../superpowers/plans/2026-10-26-a980-s10-log-personal-data.md)'s decisions 4 to 7, 10 and 12 and its
  owner note 5). Masked in every line the server's logger writes, on `docker logs` as
  well as in `waitron.log` and on the recovery page: a person's name, email or tax number under a
  listed detail name. Masked partly, by the owner's decision of 2026-10-26 (the plan's decision 14, which
  also lists the choices made where the answer left a point open):
  each word, each half of an email address and each tax number keeps only its first and last
  character around `***`, so a refused invitation logs
  `{"email":"m***r@e***e.test",…,"event":"person.email_taken"}`. The
  venue's own legal name and tax number are masked too, because for a sole trader they are a
  person's: Jordi Puig Ferrer's refused restore logs
  `{"legalName":"J***i P***g F***r","taxId":"1***Z","locationName":"Bar del Port",…}`, while the setup wizard and the
  restore command still show them. A table's name for today, normally a booking's surname, travels
  as `todayName` and is masked: `{"todayName":"S***r","field":"name",…}`. Left visible: the names of
  things, even when they name someone (a floor-plan table named "García" still logs
  `{"label":"García",…}`, and so do a device named "Marta's phone" and a location named after its
  owner); email-shaped text inside a message, because the mask goes by key, not by pattern; the
  answer to the request, which keeps every detail; and the frozen-process watchdog's own line,
  which writes no person's details today. The recovery page's tail still shows lines the last
  running server wrote, not only the failed start's, because they explain a stop that server saw.
