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
  person's under a new admin-only permission, `personal_data.export`. The server route for a
  person's own download exists (`GET /management-api/me/personal-data/export`, a ZIP of their
  profile and sign-in details with a `README.txt` first, in the person's own language, English or
  Spanish), the Profile page has a **Download** button beside **Copy of your data**, and the Users
  guide has a "Download your data" section (`{#own-data}`) in English and Spanish. When the
  workforce module is on, the download also holds `employment.json`, `rota.json`, `absences.json`
  and `attendance.json`, and when the staffing module is on, `staff-roles.json`. When workforce and
  a working-time exporter (today `workforce-es`) are both on, it also holds the working-time record
  (`time-record.pdf`, `time-record.csv`), but only if the person has an entry at this box's
  location (`apps/server/src/personal-data-time-record.ts:26`, `:42`). Left:
  - **S2c** — the counts of voids, refunds and drawer openings (`actions.csv`) and an admin's
    download of another person's data. Its `authorize` returns a README language too, and it adds
    README words for `actions.csv`. It also widens the guide section's and the Profile help text's
    list of contents ("your profile and sign-in details", the `own-data` section of
    `apps/server/src/guide/{en,es}/staff.md` and `profile.data_copy_help` in
    `apps/dashboard/src/i18n/strings.ts`) for `actions.csv`, and adds guide text for an admin's
    download of another person's data.

  A new section in the Users guide (`apps/server/src/guide/<language>/staff.md`) also goes into
  that page's section-id list in `apps/server/src/guide-content.test.ts`.
- **A manager's own copy of what they decided about others** — the absences and swaps they
  decided, the rotas they published and the attendance answers they authorised: the design's "who
  did what" row (§2.1 row s12). S2c's actions part, as scoped, covers only voids, refunds and drawer
  openings (S2b decision 11).
- **Owner question: the times of the shifts a swap names.** Today a swap in the download carries
  no shift (S2b decision 8). Example: Ana offers Marta her Saturday 18:00–02:00 shift as a
  give-away; Marta accepts and Luis approves. Approving moves no shift, so the shift stays Ana's
  and Marta's copy shows the approved swap with no time. The alternative is to add the two shifts
  the swap names as `fromShift` and `toShift`, which shows Marta the times of a shift that is Ana's.
  Include them, yes or no?
- **The working-time record of a box with more than one location** — only this node's location is
  exported (S2b decision 6). Today provisioning refuses a second, different location.
- **Measure the working-time part on a box.** On a Mac, with 48 closed pay periods × 30 staff,
  Task 6a's run timed the read inside the write lock at 669.7 ms. Task 6c, measuring its own
  before-figure on the same Mac at 590.2 ms median, moved the person cut to read time, with one
  copy of the export's logic, and brought it to 213.8 ms median with an identical CSV. The
  whole-history PDF for 4 years × about 20 shifts a month rendered in 2.6 s (4.0 MB) on the Mac
  (Task 6a); the plan's 650 ms estimate was for 1,000 sessions. The PDF renders on the thread that
  serves sales, which is why the box's figure matters. Measure both on a box.
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
