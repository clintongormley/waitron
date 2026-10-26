# A980 slice S6: data-protection templates in the help guide

**Status: plan, 2026-10-26, revised the same day after one fresh-context review
(`~/waitron-campaign-b/a980-s6-plan-review.md`, findings I1–I4 and M1–M11, all folded). Nothing was
built when this was written.** Written by lane B with
nobody watching; every choice the design does not make is listed under "Decisions this plan
makes" with the default that will be built. Design:
[A980 data protection, revision 2](../specs/2026-10-22-a980-data-protection-design.md) §4.1 (the
notices' draft content), §4.5 (breach), §4.6 (record of processing), §2 (the data map the record
lists), §5.3 row S6, §8 answer O10 (b). Overview: [the build plan](2026-10-24-a980-data-protection-build.md),
row S6 and "Notes for each slice → S6". Branch `feat/a980-s6-guide-templates`. **No migration**,
no code path changes: one guide page in English and Spanish, its title, its entry in the page
list, a test, and two cross-links from the Users guide. **LIGHT review**: no per-task reviewer;
one claim check of the finished pages (Task 4), then `/finish-branch`.

**Words used here.** The **guide** is the help pages the box serves at `/help/<language>/<page>`,
written in a small subset of Markdown that `apps/server/src/guide-markdown.ts` renders and refuses
everything outside (no tables, no numbered or nested lists, no quotes, no links except to another
guide page, no backslash, no address in angle brackets). A **twin** is the Spanish page of an
English one; it must have the same section ids in the same order
(`apps/server/src/guide-content.test.ts`). The **controller** is the venue, which decides why and
how personal data is used; a **processor** handles it on the controller's behalf (design §3). A
**first layer** is the short notice given when data is collected; the **second layer** is the full
notice it points to (LOPDGDD art. 11, design R23). The **AEPD** is Spain's data-protection
authority. A **placeholder** is a blank in a template the venue fills in.

## What this slice builds, and what it leaves

A new guide page, `data-protection`, titled **Data protection** / **Protección de datos**, with
these sections, in this order, in both languages:

| id | English heading | What it says |
| --- | --- | --- |
| `who-does-what` | What the venue does and what Waitron does | the venue is the controller and carries the duties (design §1, §3, §4 table's "venue does" column), including answering a request within one month (GDPR 12(3), L15); what Waitron offers today, only features on this tree (decision 10); these pages are templates for the venue's adviser, not legal advice |
| `staff-notice` | A privacy notice for staff | the first-layer template for staff (design §4.1), with placeholders |
| `invoice-notice` | A privacy notice for invoice customers | the first-layer template for a full invoice's customer (design §4.1), and where to show it today (decision 6) |
| `booking-notice` | What to tell a guest who books | the spoken first layer (design §4.1) |
| `full-notice` | The full notice on your web page | what the second layer must say: GDPR art. 13(1) and (2), item by item, in plain words |
| `record` | Your record of processing | why a small venue keeps one (art. 30(5), design §4.6), the seven things art. 30(1) asks for, and one prefilled entry per activity Waitron performs (design §2) |
| `breach` | If personal data is lost or exposed | the duty (art. 33(1), 33(5), 34(1)), the four things a notification describes (art. 33(3)), the AEPD's online form and its initial-then-complete route, Comunica-Brecha; never a verdict |
| `breach-records` | What Waitron can and cannot tell you | what a manager can look up in the dashboard after an incident, and what the box never records (design §4.5, verified in Task 0) |
| `breach-losses` | Common losses | a stolen till device, a lost or stolen box, a lost recovery kit, a leaked configuration export, an account someone else used, an invoice emailed to the wrong address: for each, what it exposes and what to do in Waitron |

The Users guide (`staff.md`, both languages) gains one link each in **Download another person's
data** and **Download an invoice customer's data**, to `data-protection.md#who-does-what`, so the
page is reachable from a screen's help: the Profile page's "?" opens `staff#own-data` today
(`apps/dashboard/src/screens/profile-screen.ts`, `guideHref`).

Left for later, on purpose:

- **No dashboard entry point of its own.** S1a adds the privacy-notice setting; its "?" is the
  natural link to `#staff-notice` and `#full-notice`. Task 6 writes that into the S1a row of the
  overview plan and the backlog.
- **No text Waitron prints or sends changes.** The notices are templates; S1b puts the invoice
  notice's link in the invoice email, and receipts wait for Q59 (design §4.1.1).
- **No retention periods** beyond the one the law states outright and the design already quotes:
  the working-time record's four years (ET 34.9, design R32). Every other period is A664's
  proposal, waiting for the specialists (design §2 preamble), so the record's entries say "set with
  your adviser".
- **Catalan, Basque, Galician**: the guide has only `en` and `es` (`GUIDE_LANGUAGES`,
  `apps/server/src/guide-catalogue.ts:5`).

## Decisions this plan makes that the design does not

1. **One page with nine sections, not three pages.** The design says "pages"; one page keeps the
   notices, the record and the breach material in one place a manager can find from one link, and
   every part still has its own section link. Alternative: three pages (`privacy-notices`,
   `processing-record`, `breach-checklist`).
2. **Placeholders are written in italics inside the template text**, for example
   "Responsable: _razón social_ (_NIF_)". The guide subset reserves `[` for links, so the usual
   `[venue name]` cannot be written (`guide-markdown.ts`, the `[` branch of `renderInline`, which
   fails "a [ that does not start a link"). The review's renderer probes found where italics are
   refused ("an _ that is neither inside a word nor emphasis"): a placeholder starts after a space,
   `(` or the line start, never touches `«`, `“` or `/`, and is never part of a web address, so a
   notice address is one whole placeholder ("_la dirección de tu página de privacidad_"). Write
   Veri\*Factu as `Veri*Factu` in code, or avoid it (a lone `*` is refused), and never start a
   wrapped line with a number and a full stop (`30. ` is read as a numbered list). Alternative: the design's fictional Bar Ejemplo S.L.
   filled in, which reads better but invites publishing the example unchanged.
3. **The English page's templates are in English; the Spanish page's are in Spanish.** A venue in
   Spain publishes the Spanish text. The English page says that the Spanish page holds the same
   templates in Spanish and names its address, `/help/es/data-protection`, as code (a guide link
   cannot name another language). Alternative: both languages on the English page.
4. **Templates go in ordinary paragraphs, introduced by a sentence saying "Copy and adapt:"**, since
   the subset has no quote block. Bold opens each template ("**Protección de datos.**"), as the
   design's draft does.
5. **The record of processing is one bulleted list per activity**, each bullet one of the art.
   30(1) items, because the subset has no tables. Activities, from design §2: staff accounts and
   sign-in; employment, planning and absences; the working-time record; who did what at the till;
   full invoices and emailing them; bookings; allergies; card payments; backups and the configuration
   export. Each names what Waitron does for its security (art. 30(1)(g)) and, where design §2.4
   says so, what Waitron does not (the database and its bucket copy are not encrypted by Waitron),
   because the venue needs that to judge a loss under art. 34(3)(a).
6. **The invoice notice says where to show it today.** Waitron shows it nowhere yet (S1b adds it to
   the invoice email). Default text: show it where staff take the customer's details, and if the
   venue wants it on paper too, type a short version into the receipt's **Footer message**
   (dashboard label, `apps/dashboard/src/i18n/strings.ts:1234`; Spanish **Mensaje de pie**,
   `:4646`), which prints on every till receipt, simplified ones and full invoices alike
   (`apps/server/src/receipt-document.ts:430-432`). The page states the field's limits: it is set
   per department, in the department's receipt panel (`apps/dashboard/src/dashboard-app.ts:1428`,
   `apps/dashboard/src/screens/department-receipt-editor.ts:570`), per language, and holds at most
   200 characters (`packages/layouts/src/validate.ts:7`, `MAX_RECEIPT_FIELD_LENGTH`); the design's
   invoice notice is 238 characters, so the page gives a short version under 200 in each language
   and says so. It does not say whether the law requires a line
   on the invoice: that is Q59, open with the adviser.
7. **The breach sections never say whether to notify.** They give the art. 33(3) questions, the
   time limit, the documentation duty and the AEPD's tool, and say the judgement is the venue's
   with its adviser (design §4.5, O10 (b)).
8. **What a manager can look up after an incident is limited to what the dashboard shows.** The box
   operator has no terminal, so a fact held only in a database table is described as "the box
   records it, but no screen shows it", or left out. Task 0's research (below) settles which.
9. **Two cross-links from the Users guide, no other page changed.** `staff.md`'s
   `person-data` and `invoice-customer-data` sections end "Waitron keeps no list of these
   requests…"; each gains one sentence pointing to `who-does-what` for the one-month answer time and
   the venue's other duties.
10. **The page offers only what exists on this tree, and never mentions the notice-link
    environment setting or a planned setting.** Today a venue's notice link reaches Waitron only
    through `WAITRON_PRIVACY_NOTICE_URL` in the box's environment (`apps/server/src/config.ts:503-511`),
    which an operator without a terminal cannot set. So `staff-notice` says the venue gives the
    notice itself (with the contract, on paper or in its own email) and `full-notice` says it goes
    on the venue's own web page. `who-does-what` lists, each checked at its file:line on this tree:
    a person's own data copy, an admin's copy of another person's data and of an invoice customer's,
    disabling an account deleting its sign-in secrets, editing a person's details. S1b updates the
    page when the setting exists (Task 6 writes that into the overview).
11. **Internal identifiers never reach the page**: no Q-numbers, R- or L-numbers, slice names or
    file paths. The page says "ask your adviser to confirm"; the IDs stay in the commit and PR.

## Task 0 (done while planning) — what the dashboard can tell a manager after an incident

Recorded here, with file:line on this branch's base `24ef0908f`, so the breach sections state only
what was checked. `S` is `apps/dashboard/src/i18n/strings.ts`, cited English line / Spanish line.
Found by a read-only research run on 2026-10-26 (reading, not running: Task 4 re-checks each line it
uses). Two findings correct the design: the box does keep some devices' network addresses (point 8),
and a disabled device can ask to come back (point 1).

1. **A stolen device.** **Devices / Dispositivos** (S:1315/4728), row actions **Disable /
   Deshabilitar** (S:1321/4734) and **Delete / Eliminar** (S:661/4066). Disable ends every open staff
   sign-in on the device and stops it connecting (`device-delete.ts:175-185`,
   `packages/identity/src/login.ts:69-74`,
   `device-session.ts:224-225`), but keeps its token hash, so the device can ask to come back and
   appear under the devices asking to join with **Enable / Habilitar** (S:1376,1384/4789,4797;
   `join-requests.ts:231-243`). Delete (refused while a payment is in progress) also clears the token
   hash, so the device can never prove itself again (`device-delete.ts:191-219`). But a deleted
   device leaves the Devices list (`device-api.ts:731` filters `isNull(devices.deletedAt)`), and its
   **Last seen** with it. So the page orders the steps: **Disable** at once; note its **Last seen**
   and who used it; then **Delete**, and never enable a lost device that asks to join. Sign-ins
   survive a Delete (`sessions.device_id` is `onDelete: "restrict"` and the row is kept), so a
   person's data copy still lists them under the device's name. Disabling a device ends its till
   sign-ins only (`endDeviceSessions` touches `sessions`, `packages/identity/src/login.ts:69-74`); a
   dashboard sign-in on a stolen phone or laptop is a per-person `management_sessions` row, ended by
   that person's **Reset login** (point 4).
2. **Who was signed in where.** No screen lists sign-ins per device. **Last seen / Visto por última
   vez** on Devices (S:1324/4737) shows when each device was last heard from. A person's
   sign-ins on each device (device, from, to) are in `sign-in.json` inside their data copy, which an
   admin downloads with **Download their data / Descargar sus datos** (S:1925/5349;
   `packages/identity/src/personal-data.ts:85-100`).
3. **Who did what, on Orders / Pedidos** (S:194/3591) → **View details / Ver detalle** (S:233/3630):
   who printed each copy (S:146-147/3542-3543), who downloaded the invoice PDF (S:173/3570), who asked
   for each email delivery (S:172/3569). Cash-drawer openings are not shown on any screen; they reach
   a manager only in a person's data copy (`actions.json`, `personal-data-actions.ts:174-185`).
4. **An account someone else used.** **Users / Usuarios**: **Disable / Deshabilitar** (S:1910/5334)
   or **Reset login / Restablecer acceso** (S:1909/5333); both sign the person out and delete their
   PIN, password, two-factor secret, Google link, passkeys and recovery codes
   (`packages/identity/src/staff.ts:157-182`, `:281-362`). Admin only.
5. **A lost recovery kit.** It holds the bucket's access key and secret and the recovery key
   (`packages/stream/src/kit.ts:14-20`), so whoever has it can read the whole database copy in the
   bucket. On **Backups / Copias de seguridad** (S:975/4382): **Change the recovery key / Cambiar la
   clave de recuperación** (S:1798/5221) and **Change bucket / Cambiar de bucket** (S:1868/5291) with
   new keys; the old keys are revoked at the bucket provider, which Waitron cannot do.
6. **A leaked configuration export.** Holds every person's name, email, phone, role and status,
   former staff included, and employment records with pay rate and availability; never a PIN,
   password, two-factor secret or Google link (`packages/identity/src/configuration-transfer.ts:1-22`,
   `packages/workforce/src/configuration-transfer.ts`). Encrypted under a passphrase of at least 12
   characters (`configuration-export-api.ts:39-41`), so its risk is the passphrase's strength.
7. **What a till's browser keeps** (local storage): the last operator's person id, the make-now
   list with free-text notes, unfinished refund drafts with their typed reason
   (`till-lock-screen.ts:23,300`; `till-app.ts:2472-2484`; `state/tender-refund.ts:25-32`). Nothing
   clears the first two when the device is disabled or deleted (no `Clear-Site-Data` in the tree).
8. **Addresses.** No sign-in, session or request records a network address or browser identifier
   (`sessions.ts:10-28`, `management-sessions.ts:14-22`, `request-id.ts:27-33`). The box does keep the
   LAN address of each device that took part in a clock check, inside `clock_confirmations.proof`
   (`packages/fiscal-verifactu/src/clock-checks.ts:133-137`). The page says "Waitron does not record
   who opened or read a record on a screen, or the network address a sign-in or request came from"
   and nothing broader (Orders does record who downloaded a PDF and who printed a copy, point 3).
9. **Logs.** **Diagnostics / Diagnóstico** (S:973/4380) shows the recent log lines (names, emails and
   tax numbers partly masked since S10); **Alerts / Avisos** (S:814/4318) lists alerts.

## Global constraints

- **Every sentence about the product is checked against the code before it is written**, and the
  commit message or PR lists each one with its `file:line` (CLAUDE.md §1). UI labels are quoted
  from `apps/dashboard/src/i18n/strings.ts` in each language, never paraphrased.
- **Every sentence about the law paraphrases a source quoted in the "Legal receipts" table below**,
  or a row of the design's provenance table (§10), and says no more than the quote. Nothing new is
  settled on our say-so; a doubt becomes a sentence telling the venue to ask its adviser.
- **No verdicts**: never "you must notify", "you need not notify", "this is not a breach". The page
  says what the law asks and which questions decide it.
- **The guide subset** (`apps/server/src/guide-markdown.ts`): `# Title`; `## Heading {#id}`;
  paragraphs; `- ` bullets, continuation lines indented two spaces, no nesting; `**bold**`,
  `_italic_`, `` `code` ``; links only `[text](page.md#id)` to another guide page. No tables,
  numbered lists, `>`, backslashes, HTML comments, HTML entities, or `<…@…>`/`<…:…>` addresses. A
  web address or email written as plain text is allowed only if the renderer accepts it (Task 1
  checks one of each).
- **House style** (`~/.claude/docs-writing-style.md`): second person, short plain sentences, no em
  dashes, no marketing words, the why for each step. The Spanish page addresses the manager as
  `tú`, as `es/staff.md` does ("Usa **Usuarios**…"); a template addressed to a guest keeps the
  design's `usted` ("Guardamos su nombre…"), and the staff template its `tú`.
- **English only outside the guide's `es/` folder and the title file's `es` value** (CLAUDE.md §3).
  Spanish legal terms on the English page appear only as quoted names of things (AEPD, Sede
  Electrónica, Comunica-Brecha RGPD), each explained in English the first time.
- Commits `git commit -s`. Run `pnpm exec prettier --check` on every changed file, the guide
  Markdown included: the review ran `pnpm exec prettier --file-info apps/server/src/guide/en/staff.md`
  and it printed `"ignored": false`, so format checking covers these files.

## Task 1 — the page, its title and the test that pins its sections (`@waitron/server`)

Files: `apps/server/src/guide-catalogue.ts`, `apps/server/src/i18n/data-protection-guide.ts`
(new), `apps/server/src/guide-pages.ts`, `apps/server/src/guide-content.test.ts`,
`apps/server/src/guide/en/data-protection.md` (new, sections `who-does-what` to `full-notice`
written in full; `record`, `breach`, `breach-records`, `breach-losses` present with one holding
sentence each, filled by Task 2).

1. **Test first.** In `guide-content.test.ts`, add a case shaped like the till-notices one:
   for each of `GUIDE_LANGUAGES`, `GUIDE_PAGES` contains `"data-protection"`, `readGuide` finds the
   page, and its rendered section ids equal the nine ids above in order. Add a second case: the
   English page's `staff-notice`, `invoice-notice` and `full-notice` sections each contain an
   `<em>` (a placeholder), and no section of either language contains the words "you must notify"
   / "debes notificar" / "no es necesario notificar" (a guard for decision 7, weaker than its name:
   three phrases). Run
   `pnpm --filter @waitron/server exec vitest run src/guide-content.test.ts` and watch both fail
   for the missing page.
2. Add `"data-protection"` to `GUIDE_PAGES` (after `"staff"`); add
   `DATA_PROTECTION_GUIDE_TITLE = { en: "Data protection", es: "Protección de datos" } as const` in
   the new i18n file; add it to both `names` maps in `guide-pages.ts`.
3. Write the English page's first five sections in full (decisions 2–4, 6; design §4.1's drafts as
   the starting point, with placeholders for the venue's legal name, tax number, address, privacy
   email and notice address). Write the last four headings with a holding sentence.
4. Spanish: create `es/data-protection.md` with the same nine headings and ids, Spanish headings,
   one holding sentence each (Task 3 writes it in full). The twin test needs the same ids now.
5. Check one plain-text web address (`https://www.aepd.es`) and one plain-text email in a
   paragraph render without a refusal (the renderer refuses only angle-bracketed ones); if either is
   refused, write it as `code`.
6. Run the test file again (green), `pnpm --filter @waitron/server exec vitest run
   src/guide-pages.test.ts src/guide-catalogue.test.ts`, and from the root `pnpm exec vitest run
   scripts/guide-links.test.ts`, and `pnpm --filter @waitron/server typecheck` (Vitest does not
   typecheck; a missing `names` entry in `guide-pages.ts` would show only there). Commit.

## Task 2 — the record of processing and the breach sections, in English

File: `apps/server/src/guide/en/data-protection.md`.

1. `record`: why it is kept (art. 30(5): the under-250 exemption does not apply where processing
   is not occasional or includes special categories; a restaurant's staff and invoice processing is
   continuous, which on its own is enough; allergy notes can be health data, and the venue's
   adviser confirms whether its are, and that the record is needed); the seven art. 30(1) items in
   plain words; then one entry per activity (decision 5, plus **supplier invoices** from sole
   traders, which carry a person's name and tax number, design §2.2), each a short paragraph naming
   the activity followed by a bullet list: purpose; whose data; what data; who receives it;
   transfers outside the EU (it depends on the providers the venue chose, which Waitron does not
   check, so "check with each provider"); how long (only the working-time record's four years is
   stated; the rest "set with your adviser"; print jobs, which keep the invoice and allergy blocks, are
   never deleted today, design §2.2 c3, so the invoice and allergy entries say so); how Waitron
   protects it. Missing-clock reminder emails go under the working-time entry's recipients (design
   §2.1 s13). Facts from design §2.1–2.4, each re-checked against the
   code at the cited line before it is written.
2. `breach`: the duty and the four questions, the 72-hour limit and the reason-for-delay rule, the
   documentation duty for every breach, telling the people when the risk is high, the AEPD's online
   form on its Sede Electrónica, which the person filling it in reaches with a recognised electronic
   certificate or Cl@ve (so check you have one before you need it), with an initial notification within 72 hours completed within 30 days, the
   Comunica-Brecha RGPD tool. The cases where telling people is not needed are paraphrased from L10 as
   written there: appropriate protection applied to the affected data that makes it unintelligible to
   anyone not authorised, such as encryption; whether that holds when the key may be exposed too (a
   recovery kit carries its key; an export is as safe as its passphrase) is for the adviser. One sentence: whether a breach must be notified, and whether people
   must be told, is the venue's decision with its adviser.
3. `breach-records`: from Task 0 only.
4. `breach-losses`: one short paragraph per loss (the list in "What this slice builds"),
   each saying what the loss exposes, what to do in Waitron with the exact dashboard labels from
   Task 0, and which question in `breach` it feeds. Every action named must exist (Task 0). The stolen
   device follows Task 0 point 1's order (Disable, note Last seen and users, then Delete), and a
   stolen phone or laptop used for the dashboard adds **Reset login** for its person. A lost or stolen
   box: the database on its disk is not encrypted by Waitron (design §4.8), so treat its data as
   exposed and change the passwords and keys it holds; re-check that claim at the code first.
5. Run the guide tests. Commit.

## Task 3 — the Spanish page, and the two cross-links

Files: `apps/server/src/guide/es/data-protection.md`, `apps/server/src/guide/en/staff.md`,
`apps/server/src/guide/es/staff.md`.

1. Write the Spanish page in full from the English one: same sections, same order, same facts.
   Templates are the design's Spanish drafts (§4.1) with placeholders. Dashboard labels are the
   Spanish strings (`strings.ts`'s Spanish block), never translated by hand. Legal phrases use the
   regulation's Spanish wording from the Legal receipts table.
2. Add the cross-link sentence (decision 9) to `person-data` and `invoice-customer-data` in both
   `staff.md` files.
3. Run the guide tests and `scripts/guide-links.test.ts`. Commit.

## Task 4 — claim check (review, fresh context, default effort)

A fresh reviewer reads both pages and the two `staff.md` changes and, for every sentence that says
what Waitron does, shows, records, deletes or encrypts, opens the cited code and marks it TRUE,
OVERSTATED or FALSE; for every legal sentence, checks it against the Legal receipts table or design
§10 and marks it the same way. It also reads the two pages side by side and lists any fact present in
one language and missing or different in the other. Fix every FALSE and OVERSTATED; check each fix
once more, narrowly (a correction is a new claim). Output to
`~/waitron-campaign-b/a980-s6-claim-check.md`.

## Task 5 — LOOK

Render both pages through the real route and open them in the workspace's Playwright Chromium:
light and dark, 1280 and 390 wide, English and Spanish (eight screenshots to
`~/waitron-campaign-b/a980-s6-shots/`). Check long bullet lists wrap cleanly at 390, every section
heading shows, and the templates read as templates. A small script mounting `mountGuidePages` on a
Hono app and writing each response to a file is enough; no dev stack needed.

## Task 6 — backlog and docs

- `docs/backlog/data-protection.md`: delete the **S6** bullet; add "the guide page has no dashboard
  entry point of its own; S1a's setting gets a '?' to `data-protection#staff-notice`" under S1, if
  S1 is still open.
- `docs/superpowers/plans/2026-10-24-a980-data-protection-build.md`: a dated sentence in the status
  paragraph saying S6 is built and what it holds; in the S1a notes, the "?" link.
- The design: a dated one-line pointer under §5.3 that the templates are at
  `apps/server/src/guide/<lang>/data-protection.md`, and dated notes (historical text is not
  rewritten) for three corrections Task 0 found: under §2.3, that `clock_confirmations.proof` keeps
  the LAN address of each device in a clock check (row d3 said none stored); under §4.5, that no
  screen shows who was signed in where, only a person's data copy does, and that the action is
  **Disable** or **Delete**, not "Revoke".
- The overview's S1b row: S1b also updates `data-protection`'s `staff-notice` and `full-notice`
  sections once the setting exists.
- `docs/backlog.md`: if its A980 entry lists S6 as open, remove it.

## Review focus

- Every product sentence true on this tree, with the exact UI label in each language.
- No legal sentence goes beyond its quote; no verdict on notifying.
- Spanish and English pages say the same thing.
- The page renders under the subset; the twin test and the section-id test pin it.

## Legal receipts

Fetched 2026-10-26 with `curl`; text extracted from the raw page and searched with `grep`. Files in
`~/waitron-campaign-b/a980-s6-sources/`. GDPR Spanish: BOE's copy of the Official Journal text,
`https://www.boe.es/buscar/doc.php?id=DOUE-L-2016-80807`; the 2021 Spanish corrigendum
(`DOUE-L-2021-80264`) changes art. 13 only in 13(1)(f)'s ending, 13(2)(e)'s "de que no" → "de no",
and 13(2)(f)'s "automatizas" → "automatizadas", and does not touch arts. 30, 33 or 34. GDPR English:
the Publications Office's XHTML (`https://publications.europa.eu/resource/celex/32016R0679`,
`Accept: application/xhtml+xml`), SHA-256 starting `962539af`, the same file the design's §10 names.
AEPD: `https://www.aepd.es/guias/guia-brechas-seguridad.pdf`, extracted with `pdftotext`.

| ID | Claim the page makes | Source | Words (source's own) |
| --- | --- | --- | --- |
| L1 | the full notice's contents | GDPR 13(1)(a)–(f) | ES: «a) la identidad y los datos de contacto del responsable y, en su caso, de su representante; b) los datos de contacto del delegado de protección de datos, en su caso; c) los fines del tratamiento a que se destinan los datos personales y la base jurídica del tratamiento; d) cuando el tratamiento se base en el artículo 6, apartado 1, letra f), los intereses legítimos del responsable o de un tercero; e) los destinatarios o las categorías de destinatarios de los datos personales, en su caso; f) en su caso, la intención del responsable de transferir datos personales a un tercer país…». EN: "(a) the identity and the contact details of the controller … (b) the contact details of the data protection officer, where applicable; (c) the purposes of the processing … as well as the legal basis for the processing; (d) where the processing is based on point (f) of Article 6(1), the legitimate interests pursued by the controller or by a third party; (e) the recipients or categories of recipients of the personal data, if any; (f) where applicable, the fact that the controller intends to transfer personal data to a third country…" |
| L2 | the full notice's further contents | GDPR 13(2)(a)–(f) | ES: «a) el plazo durante el cual se conservarán los datos personales o, cuando no sea posible, los criterios utilizados para determinar este plazo; b) la existencia del derecho a solicitar al responsable del tratamiento el acceso a los datos personales relativos al interesado, y su rectificación o supresión, o la limitación de su tratamiento, o a oponerse al tratamiento, así como el derecho a la portabilidad de los datos; c) … la existencia del derecho a retirar el consentimiento en cualquier momento…; d) el derecho a presentar una reclamación ante una autoridad de control; e) si la comunicación de datos personales es un requisito legal o contractual…; f) la existencia de decisiones automatizadas, incluida la elaboración de perfiles…». EN: "(a) the period for which the personal data will be stored, or if that is not possible, the criteria used to determine that period; (b) the existence of the right to request from the controller access to and rectification or erasure … restriction … or to object … as well as the right to data portability; (c) where the processing is based on point (a) of Article 6(1) or point (a) of Article 9(2), the existence of the right to withdraw consent at any time…; (d) the right to lodge a complaint with a supervisory authority; (e) whether the provision of personal data is a statutory or contractual requirement…; (f) the existence of automated decision-making, including profiling…" |
| L3 | what the record holds | GDPR 30(1)(a)–(g) | ES: «a) el nombre y los datos de contacto del responsable…; b) los fines del tratamiento; c) una descripción de las categorías de interesados y de las categorías de datos personales; d) las categorías de destinatarios a quienes se comunicaron o comunicarán los datos personales…; e) en su caso, las transferencias de datos personales a un tercer país…; f) cuando sea posible, los plazos previstos para la supresión de las diferentes categorías de datos; g) cuando sea posible, una descripción general de las medidas técnicas y organizativas de seguridad…». EN: "(a) the name and contact details of the controller … (b) the purposes of the processing; (c) a description of the categories of data subjects and of the categories of personal data; (d) the categories of recipients … (e) where applicable, transfers of personal data to a third country … (f) where possible, the envisaged time limits for erasure of the different categories of data; (g) where possible, a general description of the technical and organisational security measures" |
| L4 | the record is written and shown to the AEPD on request | GDPR 30(3), 30(4) | ES: «constarán por escrito, inclusive en formato electrónico»; «pondrán el registro a disposición de la autoridad de control que lo solicite». EN: "shall be in writing, including in electronic form"; "shall make the record available to the supervisory authority on request" |
| L5 | the under-250 exemption and its limits | GDPR 30(5) | design R18 |
| L6 | 72 hours, unless unlikely to be a risk; reasons if late | GDPR 33(1) | ES: «sin dilación indebida y, de ser posible, a más tardar 72 horas después de que haya tenido constancia de ella, a menos que sea improbable que dicha violación de la seguridad constituya un riesgo para los derechos y las libertades de las personas físicas. Si la notificación a la autoridad de control no tiene lugar en el plazo de 72 horas, deberá ir acompañada de indicación de los motivos de la dilación». EN: "without undue delay and, where feasible, not later than 72 hours after having become aware of it … unless the personal data breach is unlikely to result in a risk to the rights and freedoms of natural persons. Where the notification … is not made within 72 hours, it shall be accompanied by reasons for the delay." |
| L7 | what a notification describes | GDPR 33(3)(a)–(d) | ES: «a) describir la naturaleza de la violación…, inclusive, cuando sea posible, las categorías y el número aproximado de interesados afectados, y las categorías y el número aproximado de registros de datos personales afectados; b) comunicar el nombre y los datos de contacto del delegado de protección de datos o de otro punto de contacto…; c) describir las posibles consecuencias…; d) describir las medidas adoptadas o propuestas…». EN: "(a) describe the nature of the personal data breach including where possible, the categories and approximate number of data subjects concerned and the categories and approximate number of personal data records concerned; (b) communicate the name and contact details of the data protection officer or other contact point…; (c) describe the likely consequences…; (d) describe the measures taken or proposed to be taken…" |
| L8 | information may follow in phases | GDPR 33(4) | ES: «la información se facilitará de manera gradual sin dilación indebida». EN: "the information may be provided in phases without undue further delay" |
| L9 | document every breach | GDPR 33(5) | ES: «documentará cualquier violación de la seguridad de los datos personales, incluidos los hechos relacionados con ella, sus efectos y las medidas correctivas adoptadas». EN: "shall document any personal data breaches, comprising the facts relating to the personal data breach, its effects and the remedial action taken" |
| L10 | tell the people when the risk is high; in clear language; among the cases where it is not needed, appropriate protection applied to the affected data that makes it unintelligible, such as encryption | GDPR 34(1), 34(2), 34(3)(a) | ES: «Cuando sea probable que la violación … entrañe un alto riesgo…, el responsable del tratamiento la comunicará al interesado sin dilación indebida»; «en un lenguaje claro y sencillo»; «el responsable del tratamiento ha adoptado medidas de protección técnicas y organizativas apropiadas y estas medidas se han aplicado a los datos personales afectados por la violación de la seguridad de los datos personales, en particular aquellas que hagan ininteligibles los datos personales para cualquier persona que no esté autorizada a acceder a ellos, como el cifrado». EN: "likely to result in a high risk … shall communicate the personal data breach to the data subject without undue delay"; "in clear and plain language"; "render the personal data unintelligible to any person who is not authorised to access it, such as encryption" |
| L11 | the AEPD's online form needs a recognised electronic certificate or Cl@ve; initial then complete within 30 days | AEPD guide (June 2021) | «la AEPD ha elaborado un formulario en línea y lo pone a disposición de los responsables de tratamiento a través de su Sede Electrónica» (design R38's words); «Para acceder al formulario es necesario disponer de un certificado electrónico reconocido» and, elsewhere in the same guide, «es necesario estar en posesión de un certificado electrónico reconocido o sistemas Cl@ve permanente y PIN24H», so the page says certificate or Cl@ve; «la posibilidad de realizar una notificación de tipo "inicial", antes de las 72 horas señaladas, rellenando el formulario con la información preliminar que se disponga»; «Antes del plazo máximo de 30 días desde la notificación inicial, el responsable de tratamiento deberá completar toda la información mediante una "modificación" de la notificación anterior» |
| L12 | Comunica-Brecha RGPD helps decide whether to tell the people | AEPD guide, same file | «La herramienta Comunica-Brecha RGPD ofrece ayuda a los responsables de tratamiento para la toma de decisiones en cuanto a la obligación de comunicar una brecha de datos»; design R37 |
| L13 | first layer: controller, purpose, rights, and a way to the rest | LOPDGDD 11.1–2 | design R23 |
| L14 | working-time record kept four years and available | ET 34.9 | design R32 |
| L15 | answer within a month | GDPR 12(3) | design R9 |

