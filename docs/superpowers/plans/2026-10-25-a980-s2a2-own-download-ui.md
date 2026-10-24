# A980 slice S2a2: a staff member downloads their own data (the README, the button, the guide)

**Status: plan, 2026-10-25. Nothing was built when this was written.** Revised the same day after
round 1: the plan review (`~/waitron-campaign-b/a980-s2a2-plan-review/round1-review.md`, findings
I1–I3 and M1–M11) and the claim check (`…/claim-check.md`, its FALSE and OVERSTATED list and its
minor list) are folded in below. Revised again the same day after round 3, a narrow check of
that revision (`…/round3-check.md`, findings I1–I3 and M1–M9). Design:
[A980 data protection, revision 2](../specs/2026-10-22-a980-data-protection-design.md) §4.2 (the
download, its worked example, what the README carries), §2.1 and §2.4 (what is held and where it
goes, which the README explains), §4.1 (the staff notice's wording), §5.3 row S2, §8 owner answer
O5. Overview: [the build plan](2026-10-24-a980-data-protection-build.md), row S2a2 and "Notes for
each slice → S2a2". It continues [S2a1's plan](2026-10-24-a980-s2a1-own-download.md) (landed as
#2036), whose "Left for later" list names what this slice owes. Branch
`feat/a980-s2a2-own-download-ui`. **No migration**: the slice reads one more existing column
(`tenants.legal_name`) and writes nothing. **FULL review** (personal data): per-task reviews run,
then `/finish-branch`.

**Words used here.** A **README** is a plain-text file, `README.txt`, that explains the other files
in the download. A **ZIP** is the one-file archive the person downloads. A **part** is one
contributor's share of the download (S2a1's word): a list of file names it may add, and the code
that builds them. The **snapshot turn** is the first of the route's two write-lock turns, in which
every part reads (S2a1 decision 7). **`Content-Disposition`** is the response header that names a
downloaded file. **`Accept-Language`** is the request header in which a browser lists the languages
its user prefers. **Help mode** is the dashboard's app-wide switch that shows or hides the "?"
badges (design-system.md, "Help mode", `:2290`). A **card action** is the Profile page's row button
that is plain at rest and coloured on hover (design-system.md, "Card action buttons", `:3956`). A
**passive** request is one the dashboard makes on its own, which must not count as the person being
active (home CLAUDE.md §3, "Automatic dashboard reads are passive session activity"). The
**configuration export** is the encrypted file a manager downloads from the backup screen to set up
another box with the same menus, staff and settings.

## What this slice builds, and what it leaves

`GET /management-api/me/personal-data/export` (built by S2a1) gains `README.txt`, first in the ZIP,
in the person's language, explaining each file actually in the ZIP, what it is used for, where it
came from, who else receives it, how long it is kept and the person's rights. Its words live in
`apps/server/src/i18n/personal-data-readme.ts`, English and Spanish. The Profile page gains a row,
**Copy of your data**, with a **Download** button that fetches the ZIP and saves it under the name
the server gives it. The Users guide gains a section, **Download your data** (`{#own-data}`), in
English and Spanish, linked from a help-mode "?" on that row.

Left for later, on purpose:

- **S2b** adds the workforce and staffing files and the working-time export. It must add README
  words for each file it adds (the guard in Task 1 fails for a module part's file with none; a
  server part's file is not seen by that guard, decision 2), widen the guide section's and the help
  text's list of contents ("your profile and sign-in details"), and add its own "how long it is
  kept" and "who else receives it" sentences (for example the four-year working-time floor, design
  §2.1 row s11, and the configuration export's employment records and pay rate, design §2.4 r4).
- **S2c** adds the actions file and an admin's download of another person. Its `authorize` must
  return a README language too (decision 6), and it adds README words for `actions.csv`.
- **S1b** moves the privacy-notice address from the environment into a stored setting. The README
  now shows that address (decision 4), so S1b's list of places that show it gains the README; Task 7
  says so in the overview.
- **No admin download, no new permission, no workforce or staffing file** (S2b, S2c).

## Decisions this plan makes that the design does not

1. **The README is in the language the person's own dashboard shows, not the venue's.** The
   design's worked example says "in the venue's language" (§4.2). Default: the person's saved
   language when it is one the apps support, else the best match for the request's
   `Accept-Language`, else the venue's language: `resolveActiveLocale(viewer.locale,
   resolveLoginLocale(c.req.header("Accept-Language"), deps.venueLocale))`, then `es-…` → Spanish,
   anything else → English (only `es-ES` and `en-GB` are supported,
   `packages/shared/src/locales.ts:7-10`). That is exactly the rule the dashboard uses to pick its
   own language: it calls `resolveActiveLocale(me.locale, me.sessionDefault)`
   (`apps/dashboard/src/dashboard-app.ts:1199`), and the server computes `sessionDefault` as
   `resolveLoginLocale(Accept-Language, venueLocale)` (`apps/server/src/me-api.ts:337`;
   `resolveActiveLocale` at `locales.ts:37-44`; `resolveLoginLocale` at
   `apps/server/src/login-locale.ts:10-36`). A language picked while signed in is saved before it is
   applied (`dashboard-app.ts:1545-1555`), so the saved value is the one on screen. The session
   already returns the saved locale (`resolveManagementSession`,
   `packages/identity/src/management-session.ts:57`, `:100`), and the browser sends
   `Accept-Language` with the request. The claim check ran this rule over Task 2's six rows (its
   probe P1): every row gave the expected language. Why: the README is the person's Article 15
   answer, which GDPR 12(1) asks to be «inteligible … con un lenguaje claro y sencillo» (design
   §4.1.1's provenance table), and the person reads the dashboard in this language; the venue's
   language is still the last fallback. The route takes no query (S2a1 decision 7 refuses any,
   `apps/server/src/personal-data-export-api.ts:94-97`), so the dashboard does not send its
   language: the server reaches the same answer from the same inputs. One language per README, not
   both: shorter, and the person can switch their language and download again. Task 7 records this
   departure in the overview, because S3's download for an invoice customer, who has no saved
   language, will need its own rule.

2. **The README describes only the files in the ZIP, from words keyed by file name.** The words
   file holds, for each file name, what it holds and what it is used for, and optionally whom it is
   sent to and what the box itself keeps or deletes. The README is built after every part has built
   its files, from the names actually built, not the names declared: S2a1's `files` lists the names
   a part **may** add (`packages/module/src/personal-data.ts:21-22`), and a part may build fewer. So
   when S2b and S2c add parts, the README never lists a file the ZIP lacks, and a file's own
   recipient and keeping sentences appear only when that file does. **A built file with no words is
   listed by its name alone**, with no description, rather than refused. Why, first: the copy itself
   is the person's main right (GDPR 15(3), «facilitará una copia de los datos personales»), and a
   refusal would withhold the whole copy for want of one sentence, while a name-only line still
   hands over the data. Second: the existing route test's stub part builds `extra.json`
   (`apps/server/src/personal-data-export-api.test.ts:49-63`) and expects a 200 (`:148-163`). The
   gap is closed for modules by a guard (Task 1): every file name declared by a part in
   `ALL_MODULES` has words in English and in Spanish. It is weaker than its name: a server-side part
   (S2b's working-time part, S2a1 decision 5) is passed at mount time
   (`PersonalDataExportDeps.serverParts`, `personal-data-export-api.ts:22-23`) and is not in
   `ALL_MODULES`, so S2b must add its own check.

3. **What the README says, and what it leaves out.** GDPR 15(1) lists what an access answer
   carries; quoted from the BOE copy of the Official Journal text
   (`https://www.boe.es/buscar/doc.php?id=DOUE-L-2016-80807`, fetched with `curl` on 2026-10-25
   and read as text): «a) los fines del tratamiento; b) las categorías de datos personales de que
   se trate; c) los destinatarios o las categorías de destinatarios … d) de ser posible, el plazo
   previsto de conservación … o, de no ser posible, los criterios utilizados para determinar este
   plazo; e) la existencia del derecho a solicitar del responsable la rectificación o supresión …
   o la limitación del tratamiento … o a oponerse a dicho tratamiento; f) el derecho a presentar una
   reclamación ante una autoridad de control; g) cuando los datos personales no se hayan obtenido
   del interesado, cualquier información disponible sobre su origen; h) la existencia de decisiones
   automatizadas …». The design's list (§4.2) names purposes, recipients, retention and rights; this
   plan also covers (b), (f) and (g) because 15(1) asks for them. Sections, in order: what each
   file holds and is used for (a, b); where it came from (g); who else receives it (c); how long it
   is kept (d); your rights (e, f) and whom to ask.

   **Who else receives it**, from design §2.4's routes for the profile and sign-in data: the venue's
   backups (r1, r2), the configuration export (r4), the venue's email service (r7) and Google, only
   for a person who linked a Google login (r8). AEAT, the card providers and Waitron Cloud receive
   none of the identity data (r5, r6, r9), so they are not named.

   **How long it is kept**: the box's own facts, then the venue's part. The box deletes the
   sign-in secrets when an account is disabled (S4, #2032), clears old account-email records and
   expired Google sign-in states by itself, and deletes no person and no session (Task 1's source
   table gives the code). For how long the venue keeps the data, and why, the README sends the
   person to the venue.

   Left out, each on purpose:
   - **(h), automated decisions**: the clause applies to the decisions of GDPR art. 22, and this
     plan found none to describe; saying "none" would be a claim nobody here has checked, so the
     README says nothing.
   - **Transfers outside the EU** (15(1)(c)'s «en particular destinatarios en terceros u
     organizaciones internacionales», and 15(2)): the box does not know where the venue's backup
     storage keeps its copy (design §5.2, "A gap, not a defect", and owner answer O8), so the README
     cannot say.
   - **The remote-access relay** (design §2.4 r10, question Q57, open). From the code: the box
     dials out to a relay only when `WAITRON_TUNNEL_RELAY_URL` is set
     (`apps/server/src/config.ts:249-256`), which is an environment setting of the installation,
     not a choice the venue makes in the dashboard, and it then passes bytes between the relay and
     its own local service port (`packages/tunnel/src/client.ts:1-3`). That the bytes are encrypted
     end to end is stated only in that file's comment, which this plan did not test, and whether
     carrying them makes Waitron a recipient is Q57. A conditional sentence would therefore either
     rest on an untested comment or imply a legal verdict, so the README says nothing about it.
   - **Exact keeping periods**: the venue sets them, and they wait for the specialists (design §2:
     "Every period below is a proposal until G1 to G3 agree it"). The design asks the venue to state
     them in its own notice (§4, the Retention row: the venue "states its periods, or how they are
     set, in its notice").
   - **The Spanish authority's name**: the README says "a data-protection authority", not "the
     AEPD". General code is English only and Spain-only wording belongs in a country pack (home
     CLAUDE.md §3; design §5.3: "Spain-only legal wording goes in `packages/country-es`"), and the
     right in 15(1)(f) is to complain to «una autoridad de control», which does not need the name.
   The exact text, and the source behind each sentence, are in Task 1.

4. **Who the venue is, and the privacy notice.** The README names the venue by its legal name,
   `tenants.legal_name`, read with `readTenant` (`packages/db/src/read-tenant.ts:20-30`) in the
   snapshot turn. The venue is the controller (design §3, first row: "the one `tenants` row").
   With no tenant row it says "the venue": kept for safety, since `/management-api/session/me` and
   `/management-api/locales` already throw without the row (`readVenueName`,
   `apps/server/src/me-api.ts:293-297`), so the dashboard cannot sign in on such a box. The
   privacy notice's address is shown when one is configured: today that is
   `WAITRON_PRIVACY_NOTICE_URL` (`apps/server/src/config.ts:503`), already handed to `mountMeApi` as
   `privacyNoticeUrl` (`apps/server/src/boot.ts:2147`, `me-api.ts:70`), and already shown on the
   Profile page, the sign-in screen and in account emails
   (`apps/dashboard/src/screens/profile-screen.ts:1009-1020`;
   `apps/dashboard/src/screens/login-screen.ts:1132-1138`; `apps/server/src/account-email.ts:132`).
   Why include it: rights are exercised with the venue, and §4.1's staff notice ends with "More
   information: …"; S1b changes where it is read from.

5. **The README's format.** UTF-8 without a byte-order mark, `\n` line ends, paragraphs unwrapped
   (a text editor wraps them), headings as plain lines, list items starting `- `, one blank line
   between sections, a final newline. It is the ZIP's first entry (the claim check's probe P4:
   fflate's `unzipSync` returned the entries in the order written, `README.txt` first). The date is
   the same calendar date as the file name (`civilDateOf(at, timeZone)`, as `archiveFileName` uses
   at `apps/server/src/download-archive.ts:36-38`), written as `YYYY-MM-DD` in both languages so
   the README and the file name cannot disagree. `{venue}`, `{name}`, `{date}` and `{url}` are
   replaced with a function, so a venue called `$& Bar` is written as typed, as `boxEmailMessage`
   does (`apps/server/src/box-alert-email.ts:34-36`). `README.txt` cannot collide with a part's
   file: part names must be lower-case and end `.json`, `.csv` or `.pdf`
   (`packages/module/src/personal-data.ts:37-39`).

6. **What the route's contract gains.** `PersonalDataAuthorize`
   (`apps/server/src/personal-data-export-api.ts:26-28`) returns
   `{ personId, label, language: "en" | "es" }`: the caller decides the language because only the
   caller knows whose language counts (the own route: decision 1; S2c's admin download: the target
   person's, which S2c decides). The second `authorize` call's language is ignored, as its label
   is today (only the person id is compared, `:70-74`). `PersonalDataExportDeps` gains
   `venueLocale: string` (required: the own route cannot pick a language without it) and
   `privacyNoticeUrl?: string`. `mountMeApi` already holds both (`me-api.ts:62`, `:70`; boot passes
   them at `boot.ts:2141`, `:2147`) and passes them on, so `apps/server/src/boot.ts` does not change
   (the S2a1 mount note, decision 9, still holds). The one other caller,
   `apps/server/src/start-full-disk.e2e.test.ts:306`, gains `venueLocale` (Task 2).

7. **The browser saves the ZIP under the server's name, read from `Content-Disposition`.** Other
   dashboard downloads name their file in the browser (`profile-screen.ts:744`,
   `vat-return-screen.ts:126`, `attendance-export-dialog.ts:303`, `backup-screen.ts:1277`,
   `order-detail-dialog.ts:259`; and outside the dashboard,
   `packages/fiscal-verifactu/src/setup/first-fiscal-screen.ts:345`), because the request primitive
   hands back the body alone (`packages/dashboard-kit/src/request.ts:14-18`, `:130`). This file's
   name needs the display name made safe and the venue's date (S2a1 decision 8), which the server
   already computes and the browser cannot repeat without a second copy of that code. Default: the
   primitive gains a second download form, `as: "file"`, resolving to `{ blob, fileName }`, where
   `fileName` is read from the header only in the exact form the server writes,
   `attachment; filename="<name>"` with no quote or backslash inside (S2a1 decision 8: the name is
   plain ASCII, so there is no `filename*=` form), and is `null` otherwise. The screen falls back to
   `personal-data.zip`. Like `as: "blob"`, it has no read time limit (`request.ts:85` applies the
   limit to a GET only when `as` is not `"blob"`; Task 3 extends that to `"file"`), so a large ZIP
   is not cut off at 30 seconds. The header is readable because the dashboard calls its own origin
   (`new DashboardApi("", …)`, `apps/dashboard/src/main.ts:35`); a cross-origin caller would also
   need the header exposed.

8. **The button: where it sits and how it behaves.** A new action row at the end of the Profile
   page's **Your details** tab, after Language (`profile-screen.ts:858-863`): the label **Copy of
   your data** with the hint "A ZIP file with your data and what it is used for", and a card action
   reading **Download** (the existing `action.download` words) with the page's card-action classes
   `card-action accent-primary`, as Change PIN has (`profile-screen.ts:885-895`). "Your data" was
   not used as the label because the tab's own Spanish name is already «Tus datos»
   (`apps/dashboard/src/i18n/strings.ts:4334`). The hint does not say "everything", because until
   S2b and S2c the ZIP holds the profile and sign-in files only.
   - **States.** The button is never drawn quiet or disabled except while its own request is sent:
     the rule that a button that is not a save is quiet while it waits does not cover "a button
     disabled only while a request is being sent" (design-system.md `:2773`). While sent it is
     `loading` with its label changed to "Preparing…", the form design-system.md gives for an
     action in progress (`:1182-1186`), and its accessible name changes with it. Its handler also
     returns early while a request is out: `disabled` "stops a person, not a test"
     (design-system.md `:2707-2709`).
   - **Failure.** A refusal or a lost connection shows its sentence (`codeMessage(codeOf(error))`)
     on its own line under the row, `role="alert"`, until the next press. It is held in its own
     field, not the screen's `error` (whose read-versus-action bookkeeping is at
     `profile-screen.ts:233-235`, `:362-370`), so a download failure never replaces a read's
     message or appears at the foot of an edit dialog (home CLAUDE.md §3, "A screen that shows a
     read's and an action's failure in one field remembers which one set it"). A refusal never
     disables the button (design-system.md `:2477-2478`: "an error that comes back from a request …
     never disables the action by itself"). A session refusal (`management_session.required`,
     `management_session.expired`, `person.suspended`) also returns the dashboard to sign-in through
     the existing signal (`apps/dashboard/src/session-signals.ts:6-21`).
   - **Not passive, and a known countdown mismatch.** The person pressed it, so the request is an
     ordinary one (no `passive`). A non-passive success restarts the dashboard's own idle countdown
     (`request.ts:135` calls `onSuccess`; `session-signals.ts:22-24`; `dashboard-app.ts:981-986`),
     while the route itself does not restart the server's (`touch: false`,
     `personal-data-export-api.ts:96`; `management-session.ts:87-93`), so that it answers on a full
     disk (`docs/developers/conventions-data.md:2585-2591`). The claim check ran the cases behind
     both halves (its probes P5 and P6). So after a download the dashboard may believe the session
     has up to 30 minutes more than the server does; when the server's clock ends it, the next
     request is refused `management_session.expired` and the dashboard returns to sign-in, the same
     path as any server-side expiry. The mismatch is specific to this route and accepted for the
     full-disk reason above: the working-time download, by contrast, does restart the server's
     countdown (`apps/server/src/attendance-export-api.ts:84` resolves with `touch` on; only its
     second check after building, `:126`, and its options read, `:61`, pass `false`; its tests at
     `attendance-export-api.test.ts:340-353` and `:543-553` assert the stamp moves). Marking the
     press passive would break the rule that only automatic reads are passive.
   - **Leaving.** If the screen is removed while the request is out, the answer is dropped: no file
     is saved and no message is set (a counter like the screen's `#operation`,
     `profile-screen.ts:249`, bumped on removal at `:291`).
   - The blob address is released straight after the click, as the recovery-codes download does
     (`profile-screen.ts:739-747`).

9. **The guide: a section in the existing Users page, linked from a help-mode "?".** No page is
   added to `GUIDE_PAGES` (`apps/server/src/guide-catalogue.ts:6-19`): the Users page already has
   "Your own account" (`apps/server/src/guide/en/staff.md:20-23`), and the new section **Download
   your data** `{#own-data}` goes straight after it, with its Spanish twin «Descargar tus datos»
   `{#own-data}` in `es/staff.md`. The overview's build-order note ("S2a2 may add a page") is
   therefore not used. The row carries a `wt-help-tooltip` with `mode="help-mode"` (required outside
   the setup wizard, home CLAUDE.md §3), whose short text says what the ZIP holds and whose link
   goes to the section through `guideHref("staff.own-data")` (`apps/dashboard/src/help-guide.ts`),
   the pattern the Box status page uses (`apps/dashboard/src/screens/box-status-screen.ts:299-305`).
   It shows only while help is on, so the page at rest is unchanged apart from the row. Why not a
   plain link: the dashboard reaches guides through help mode (conventions-ui.md:241-252, "How the
   dashboard links a guide"). The account menu's entry that opens the page reads **Account
   settings** / «Configuración de la cuenta» (`strings.ts:853`, `:4252`; `dashboard-app.ts:1855`),
   so the guide names it that way; the existing "Your own account" sentence, which says "Open **Your
   profile** from the account menu", is corrected in the same task.

## Global constraints

- Every database test uses `useVenueDb`; every refused request asserts the domain error code.
- No query on a transaction in `Promise.all`; the venue's name is read in the snapshot turn,
  awaited in turn with the other reads.
- The download never contains a hash, a token, a key, a challenge or an encrypted value. The
  existing no-secrets cases already search every unzipped file's text (the cases starting at
  `personal-data-export-api.test.ts:165` and `:184` join `Object.values(files)`), so they cover the
  README from Task 2 on without being edited.
- Exact text and exact shapes are asserted with `toBe` and `toEqual`, never `toContain` alone or
  `toMatchObject`, except where a case checks one sentence's presence or absence on purpose.
- **Existing assertions.** Three pin the ZIP's whole file list, which this slice changes on
  purpose: `personal-data-export-api.test.ts:158`, `me-api.personal-data-export.test.ts:52` and
  `:58` (whose `toEqual({})` becomes "only `README.txt`", keeping its fact: no module file when
  identity is off). Each gains `README.txt` and every existing value is unchanged, which the
  campaign's standing rule allows for an assertion pinning a whole shape. The pull request names
  all three. Removing the README makes all three fail again. No other existing assertion changes.
  Fixtures that grow are named in their task, with the reason, and the pull request lists them.
- Product text is as short as the meaning allows. English only in code and tests; Spanish only in
  `apps/server/src/i18n/`, `apps/dashboard/src/i18n/strings.ts` and `apps/server/src/guide/es/`.
  A test of Spanish text reads its expected words from the words file or `t()`, never a Spanish
  literal of its own.
- Browser tests follow testing-guide.md: a test that changes the language or help mode restores it
  before the next case; a promise the test controls stands in for a slow server, never a sleep.
- Coverage: `@waitron/server`, `@waitron/dashboard` and `@waitron/dashboard-kit` each hold
  98/98/98/95. None is mutation-tested (the mutation-tested packages are `ui`, `ui-core`, `shared`,
  `fiscal` and `db`).
- Same files as open pull requests (`gh pr list`, `gh api …/pulls/<n>/files`, 2026-10-25): #2025
  (parked for the owner) changes `apps/dashboard/src/api/client.ts`,
  `apps/dashboard/src/help-guide.ts`, `apps/dashboard/src/i18n/strings.ts`,
  `apps/server/src/guide-content.test.ts` (which Task 5 runs, unedited), `docs/backlog.md`,
  `docs/developers/conventions-data.md` (which Task 7 edits) and
  `docs/developers/design-system.md`; #1986 changes `docs/backlog.md`. The plan review found the
  dashboard files clear of each other except `help-guide.ts`, where #2025 appends after
  `"box-status.retry-now"`, so Task 5 puts the new entry after `"products.variants"` instead. This
  slice only adds lines in those files; whichever lands later rebases.
- Commits `git commit -s`. Run `pnpm format:check` before each commit.
- An implementer that passes about 150 tool calls with its task unfinished stops at a passing or
  cleanly failing point, commits, and hands over: what is done, what is left, the files, each
  check's state.

## Task 1 — the README's words and the function that writes it (`@waitron/server`)

Files: `apps/server/src/i18n/personal-data-readme.ts` (new: the words),
`apps/server/src/personal-data-readme.ts` (new: the builder),
`apps/server/src/personal-data-readme.test.ts` (new).

Interface:

```ts
// i18n/personal-data-readme.ts
export interface ReadmeFileWords {
  readonly holds: string;
  readonly use: string;
  /** Recipients this file alone has; listed under "Who else receives it" only when the file is. */
  readonly sentTo?: readonly string[];
  /** What the box itself keeps or deletes; listed under "How long it is kept" only when the file is. */
  readonly kept?: readonly string[];
}
export const PERSONAL_DATA_README: Record<"en" | "es", { /* the keys below */ files: Record<string, ReadmeFileWords> }>;

// personal-data-readme.ts
export interface PersonalDataReadmeInput {
  readonly language: "en" | "es";
  /** `tenants.legal_name`, or null when there is no tenant row. */
  readonly venue: string | null;
  readonly person: string; // the display name
  readonly date: string; // YYYY-MM-DD, the venue's date
  readonly privacyNoticeUrl?: string;
  /** The names in the ZIP, in ZIP order, README excluded. */
  readonly files: readonly string[];
}
export function personalDataReadme(input: PersonalDataReadmeInput): string;
```

**The layout** (decision 5). `[…]` is printed only when its condition holds; blank lines are kept
exactly as shown; the text ends with one `\n`.

```text
{title}
{prepared}

[files not empty:]
{filesHeading}
- {name}: {holds} {use}            one line per file; "- {name}" alone for a file with no words
[some file ends .json:] {machineReadable}

{originHeading}
{origin}

{sentToHeading}
- {backup}
- {sentTo}                          one line per entry of each present file's list, in file order

{keptHeading}
- {kept}                            one line per entry of each present file's list, in file order
- {decides}

{rightsHeading}
{rights}
{ask} [privacyNoticeUrl set:] {notice}
```

`[files not empty:]` covers the heading and its lines together, and the blank line after them.
`{title}`, `{ask}` take `{venue}`, which is the legal name or, when it is null, `unnamedVenue`.

**The words, English** (each paragraph one line in the file):

| Key | Text |
| --- | --- |
| `title` | `Your data held by {venue}` |
| `prepared` | `Prepared for {name} on {date}.` |
| `filesHeading` | `What each file holds` |
| `files["profile.json"].holds` | `your name, contact details, language, role and account status, and any device profile set to let you in or keep you out.` |
| `files["profile.json"].use` | `Used to run the venue, contact you and decide what you may do.` |
| `files["profile.json"].sentTo[0]` | `A manager or admin can download a configuration export that holds your name, contact details, language, role and account status, and any device profile set to let you in or keep you out, including after you leave; they protect it with a passphrase they choose.` |
| `files["profile.json"].kept[0]` | `Your profile stays on the box after your account is disabled: nothing in the box deletes it.` |
| `files["sign-in.json"].holds` | `how you sign in: whether you have a PIN, a password, an authenticator app or a Google login (never the secrets themselves), your passkeys, how many recovery codes you have, your sign-ins, the account emails issued to you and any setup you started but did not finish.` |
| `files["sign-in.json"].use` | `Used to keep your account secure.` |
| `files["sign-in.json"].sentTo[0]` | `Account emails (invitations, password resets and email-change codes) are sent through the email service the venue set up, when it has one.` |
| `files["sign-in.json"].sentTo[1]` | `If you link a Google login, the box asks Google to confirm who you are each time you link or use it, and keeps Google's identifier for your account; this file says only whether one is linked.` |
| `files["sign-in.json"].kept[0]` | `When your account is disabled, your PIN, password, passkeys, authenticator app, recovery codes and Google login are deleted from the box.` |
| `files["sign-in.json"].kept[1]` | `Your sign-in sessions stay on the box after they end.` |
| `files["sign-in.json"].kept[2]` | `The record of an account email that was used or has expired is deleted when another of the same kind is issued to you; an unfinished Google link is deleted the next time anyone starts a Google sign-in after it has expired.` |
| `machineReadable` | `The .json files are a machine-readable copy you can take to another service.` |
| `originHeading` | `Where it came from` |
| `origin` | `You or the venue's managers entered your details, or they were imported when the box was set up; the rest was recorded automatically as you used Waitron.` |
| `sentToHeading` | `Who else receives it` |
| `backup` | `If the venue has set up backups, they hold a copy of the whole database, this data included, wherever the venue keeps them.` |
| `keptHeading` | `How long it is kept` |
| `decides` | `Ask the venue how long it keeps your data and why; its privacy notice may say.` |
| `rightsHeading` | `Your rights` |
| `rights` | `You may ask the venue to correct or delete your data, to limit its use, or to give you another copy in a form you can take to another service, and you may object to its use. It must answer within one month; if it needs longer, up to two more months, it must tell you so, and why, within that first month. You may also complain to a data-protection authority.` |
| `ask` | `To ask, contact {venue}.` |
| `notice` | `Its privacy notice: {url}` |
| `unnamedVenue` | `the venue` |

**The words, Spanish:**

| Key | Text |
| --- | --- |
| `title` | `Tus datos en {venue}` |
| `prepared` | `Preparado para {name} el {date}.` |
| `filesHeading` | `Qué contiene cada archivo` |
| `files["profile.json"].holds` | `tu nombre, tus datos de contacto, tu idioma, tu rol y el estado de tu cuenta, y los perfiles de dispositivo configurados para dejarte entrar o impedírtelo.` |
| `files["profile.json"].use` | `Sirve para gestionar el local, contactarte y decidir qué puedes hacer.` |
| `files["profile.json"].sentTo[0]` | `Un gerente o un administrador puede descargar una exportación de la configuración que contiene tu nombre, tus datos de contacto, tu idioma, tu rol, el estado de tu cuenta y los perfiles de dispositivo configurados para dejarte entrar o impedírtelo, también después de que te vayas; la protege con una contraseña que elige esa persona.` |
| `files["profile.json"].kept[0]` | `Tu perfil se queda en el servidor Waitron del local después de que se deshabilite tu cuenta: nada en el servidor lo borra.` |
| `files["sign-in.json"].holds` | `cómo accedes: si tienes PIN, contraseña, aplicación de autenticación o inicio de sesión con Google (nunca los secretos), tus passkeys, cuántos códigos de recuperación tienes, tus sesiones, los correos de cuenta generados para ti y cualquier configuración que empezaste sin terminar.` |
| `files["sign-in.json"].use` | `Sirve para mantener tu cuenta segura.` |
| `files["sign-in.json"].sentTo[0]` | `Los correos de cuenta (invitaciones, restablecimientos de contraseña y códigos de cambio de correo) se envían a través del servicio de correo que configuró el local, si tiene uno.` |
| `files["sign-in.json"].sentTo[1]` | `Si vinculas un inicio de sesión con Google, el servidor Waitron del local pide a Google que confirme quién eres cada vez que lo vinculas o lo usas, y guarda el identificador de Google de tu cuenta; este archivo solo dice si hay uno vinculado.` |
| `files["sign-in.json"].kept[0]` | `Cuando se deshabilita tu cuenta, se borran del servidor Waitron del local tu PIN, tu contraseña, tus passkeys, la aplicación de autenticación, los códigos de recuperación y el inicio de sesión con Google.` |
| `files["sign-in.json"].kept[1]` | `Tus sesiones se quedan en el servidor Waitron del local aunque hayan terminado.` |
| `files["sign-in.json"].kept[2]` | `El registro de un correo de cuenta ya usado o caducado se borra cuando se genera para ti otro del mismo tipo; una vinculación con Google sin terminar se borra la próxima vez que alguien empieza un inicio de sesión o una vinculación con Google después de que caduque.` |
| `machineReadable` | `Los archivos .json son una copia legible por máquina que puedes llevar a otro servicio.` |
| `originHeading` | `De dónde salen` |
| `origin` | `Tus datos los introdujiste tú o los gerentes del local, o se importaron al configurar el servidor Waitron del local; el resto se registró automáticamente mientras usabas Waitron.` |
| `sentToHeading` | `Quién más los recibe` |
| `backup` | `Si el local tiene copias de seguridad, estas guardan una copia de toda la base de datos, incluidos estos datos, allí donde el local las tenga.` |
| `keptHeading` | `Cuánto tiempo se guardan` |
| `decides` | `Pregunta al local cuánto tiempo guarda tus datos y por qué; su aviso de privacidad puede indicarlo.` |
| `rightsHeading` | `Tus derechos` |
| `rights` | `Puedes pedir al local que corrija o borre tus datos, que limite su uso o que te dé otra copia en un formato que puedas llevar a otro servicio, y puedes oponerte a su uso. Debe responder en el plazo de un mes; si necesita más tiempo, hasta dos meses más, debe decírtelo, y por qué, dentro de ese primer mes. También puedes reclamar ante una autoridad de protección de datos.` |
| `ask` | `Para pedirlo, contacta con {venue}.` |
| `notice` | `Su aviso de privacidad: {url}` |
| `unnamedVenue` | `el local` |

The terms follow the Profile page's own words: "Authenticator app" / «Aplicación de autenticación»
(`apps/dashboard/src/i18n/strings.ts:1045`, `:4350`), "Recovery codes" / «Códigos de recuperación»
(`:1055`, `:4360`), "Google login" / «Inicio de sesión con Google» (`:1058`, `:4363`) and
"Passkeys" / «Passkeys» (`:1067`, `:4372`); the Spanish guide calls passkeys «llaves de acceso»
(`apps/server/src/guide/es/staff.md:17`, `:23`), so the README follows the screen the person
reads, not the guide. Disabling an account is "Disable" / «Deshabilitar» on the screen
(`strings.ts:1881`, `:5200`) and in the guide (`en/staff.md:17`, `es/staff.md:17`), so the README
says "disabled" / «se deshabilita». «gerentes» is the guide's word for managers (`es/staff.md:8`,
`:18`); «responsables» is avoided because in Spanish data protection it means the controller
(design, "Words used here"). The box is «el equipo» in the server's Spanish text
(`apps/server/src/i18n/box-emails.ts:9`), but «el equipo» alone also means "the team"
(`es/staff.md:3`, «datos del equipo»), and «el equipo de Waitron» reads as "Waitron's staff", which
would tell the person that the Waitron company holds their data. So the README writes «el servidor
Waitron del local» the first time in a line and «el servidor» after it, in every Spanish line that
names the box (profile `kept[0]`, sign-in `sentTo[1]`, `kept[0]`, `kept[1]`, and `origin`).

**What backs each sentence.** A reviewer checks each row; a sentence with no row is not shipped.

| Sentence | Source |
| --- | --- |
| profile.json holds | the file's keys: `packages/identity/src/personal-data.ts:37-50`, `:67-78`, written at `:140`; S2a1 decision 10's `profile.json` shape (name fields, email, pending email, telephone, locale, role, status, `deviceProfileExceptions` with `admitted`). The file also holds `id`, `emailVerifiedAt` and `createdAt`; the sentence does not claim to be complete |
| profile.json use | design §2.1 rows s1 ("run the venue, attribute work"), s2 ("sign-in, invitations"), s3 ("contact"), s7 ("permissions") |
| profile.json sentTo (configuration export) | the export route needs `system.manage` (`apps/server/src/configuration-export-api.ts:46-49`), which managers hold (`packages/identity/src/permissions.ts:55-74`, `:62`) and admins hold with every permission (`:76`, `:82`); the passphrase is at least 12 characters (`configuration-export-api.ts:40-42`; `packages/provisioning/src/configuration-transfer.ts:465`); it carries `persons` minus PIN, password, two-factor secret, email-verified time, Google subject, pending email and passkey-offer time, and `device_profile_admission_persons` (`packages/identity/src/configuration-transfer.ts:1-23`, the admission table at `:20-21`), so names, telephone, email, locale, role, status and device-profile exceptions; `persons` is read with `select *` and no status filter (`packages/provisioning/src/configuration-transfer.ts:251-290`; design §2.4 r4, "former staff included") |
| profile.json kept | no code outside tests deletes a `persons` row: `grep -rniE "delete\s+from\s+\"?(persons\|sessions\|management_sessions)\b\|\.delete\((persons\|sessions\|managementSessions)\b" packages apps --include='*.ts'`, test and `testing/` files excluded, 2026-10-25, found only two unrelated in-memory `Map`s named `sessions` (`hour-setup-clock.ts:57`, `recovery-preparation.ts:364`). A literal grep cannot see a table name filled in at run time: the configuration import runs `delete from ${sql.identifier("persons")} where role <> 'admin'` (`packages/provisioning/src/configuration-transfer.ts:696-700`), but only inside the transaction that sets up a new venue (`apps/server/src/boot.ts:1363-1370`; `packages/provisioning/src/first-setup-command-deployment.ts:329`), before anyone on that box could download anything; and the whole-database removals (`apps/server/src/db-wipe.ts`, used by `rejoin-command.ts` and `reset-request.ts`) discard the local copy, not a row. Disabling sets `status` and keeps the row (`packages/identity/src/staff.ts:266-274`, `:306-311`) |
| sign-in.json holds | S2a1 decision 10's `sign-in.json` shape (yes/no for PIN, password, two-factor, Google; passkeys; recovery-code counts; dashboard and device sessions; account emails; unfinished setups; `personal-data.ts:51-61`, `:80-105`, `:107-119`, `:121-157`) and its "no secrets" rule, enforced by its tests (`packages/identity/src/personal-data.test.ts`). "Issued", not "sent": a `management_account_actions` row is written before delivery and stays when the send fails (`apps/server/src/management-api.ts:1140-1162`, `invitationSent: false`) |
| sign-in.json use | design §2.1 rows s4–s6 ("secure sign-in", "stay signed in") |
| sign-in.json sentTo[0] (email) | account emails are sent through `resolveAccountEmail` (`apps/server/src/boot.ts:1963-1964`, `:2148-2155`), which reads the venue's `email.smtp` credential (`apps/server/src/email-delivery.ts:24-40`); design §2.4 row r7. With no credential, a practice or dev box sends the mail to a local capture server on the box (`email-delivery.ts:39`; dev mode at `boot.ts:1964`), and any other box refuses to send (`boot.ts:2153`): hence "when it has one" |
| sign-in.json sentTo[1] (Google) | Google sign-in exists only when configured (`apps/server/src/config.ts:493`; design §2.4 r8); linking and signing in each send the person to Google's authorisation endpoint with the venue's client id and the `openid email` scope (`packages/identity/src/google-oidc.ts:58-66`, `begin`, used by both `beginGoogleLogin` and `beginGoogleLink`); a link stores Google's subject on `persons.google_subject` (`google-oidc.ts:121`); `sign-in.json` carries only `googleLinked` (`personal-data.ts:59`) |
| sign-in.json kept[0] | both disable paths clear `pin_hash`, `password_hash`, `totp_secret`, `google_subject` and delete passkeys, recovery codes, two-factor enrolments and passkey challenges (`staff.ts:170-182`, `:266-274`, `:306-311`), since S4 (#2032, commit `69fb3fdf0`, 2026-10-24). Design §2.1 row s4 ("today kept after deactivation") and §5.2 item 1 predate S4 and no longer describe the code. "From the box": backups keep earlier copies until they age out (design §2.4 r1, r2) |
| sign-in.json kept[1] | sessions are ended, never deleted (`staff.ts:157-167` sets `ended_at`; the grep in the profile.json kept row finds no delete of `sessions` or `management_sessions`) |
| sign-in.json kept[2] | issuing an account action of a purpose deletes that person's used or expired rows of the same purpose (`deleteDeadActions`, `packages/identity/src/account-action.ts:147-165`, called for the person at `:98`; its other call, `:387`, is a stand-in run against no real person); starting any Google sign-in or link deletes every expired state (`google-oidc.ts:49`, inside `begin`), and a used state is deleted when claimed (`:94`), so an expired unfinished link goes at the next start after it expires, and stays if none comes |
| machineReadable | GDPR 20(1), «en un formato estructurado, de uso común y lectura mecánica» (design provenance R15; claim check P7); the files are JSON |
| origin | rows are created by an admin (`invitePerson`, `createPerson`, `staff.ts:397`, `:453`) or by a configuration import at setup (`apps/server/src/boot.ts:1363-1370`), edited by the person (`saveOwnProfile`, `apps/server/src/me-api.ts:160`) or a manager (`updatePersonDetails`, `staff.ts:190`); sessions, passkeys and account emails are written by the box as the person signs in and acts |
| backup | design §2.4 rows r1 (the bucket copy, "the whole database, every table above") and r2 (scheduled archives, "the whole database", to "the venue's folder or bucket") |
| decides | design §4, the Retention row: the venue "states its periods, or how they are set, in its notice" (hence "may say": the box cannot check the notice); §2: "Every period below is a proposal"; the box offers no way to delete a person (the profile.json kept row) |
| rights (first sentence) | GDPR 15(1)(e), quoted in decision 3; another copy: 15(3) «facilitará una copia» (R11); in a form to take elsewhere: 20(1), as machineReadable |
| rights (one month and the extension) | GDPR 12(3), from the BOE copy (claim check P7): «… y, en cualquier caso, en el plazo de un mes a partir de la recepción de la solicitud. Dicho plazo podrá prorrogarse otros dos meses en caso necesario, teniendo en cuenta la complejidad y el número de solicitudes. El responsable informará al interesado de cualquiera de dichas prórrogas en el plazo de un mes a partir de la recepción de la solicitud, indicando los motivos de la dilación.» (design provenance R9 quotes only the first part) |
| rights (authority) | GDPR 15(1)(f), «el derecho a presentar una reclamación ante una autoridad de control» (decision 3) |
| ask, title | the venue is the controller: design §3, first row |
| notice | the configured address (decision 4) |

Steps:

1. Tests first, in `personal-data-readme.test.ts` (no database):
   - **English, every section.** `language: "en"`, `venue: "Bar Ejemplo S.L."`,
     `person: "Marta López"`, `date: "2026-10-05"`, `privacyNoticeUrl:
     "https://barejemplo.example/privacy"`, `files: ["profile.json", "sign-in.json"]`: `toBe` the
     whole expected text, written out in the test as one template literal following the layout.
   - **Spanish, every section.** The same input with `language: "es"`: `toBe` the whole text, built
     in the test from `PERSONAL_DATA_README.es`'s values (never a Spanish literal in the test).
   - **No files.** `files: []`: no "What each file holds" block and no machine-readable line; under
     "Who else receives it" only the backup line; under "How long it is kept" only `decides`.
     `toBe` the whole text.
   - **One file.** `files: ["profile.json"]`: the configuration-export line and the profile kept
     line appear; no `sign-in.json` line, no email, Google, disable, sessions or clean-up line.
     `toBe` the whole text.
   - **A file with no words.** `files: ["profile.json", "extra.json"]`: the line `- extra.json`
     alone, after the profile line; nothing else changes. A file name with no words and no `.json`
     ending (`notes.csv`, alone) prints no machine-readable line.
   - **No venue name, no notice.** `venue: null`, no `privacyNoticeUrl`: the title and ask line read
     `the venue`; the last line is `To ask, contact the venue.` with nothing after it.
   - **Replacement is literal.** `venue: "$& Bar"`, `person: "$1 Ana"`: both appear as typed.
   - **Every module file has words.** For every name in
     `personalDataParts(ALL_MODULES).flatMap((p) => p.part.files)`, both
     `PERSONAL_DATA_README.en.files[name]` and `.es.files[name]` exist; and the two languages' file
     keys are the same set, and for each file the two languages' `sentTo` and `kept` lists have the
     same length. Weaker than its name (decision 2): it sees module parts only.
   Run `pnpm --filter @waitron/server exec vitest run src/personal-data-readme.test.ts`; watch it
   fail because neither file exists.
2. Write the words file and the builder.
3. Omission controls, each run and reverted, the failing case recorded for the pull request:
   list every file that has words instead of the input's files → "No files", "One file" and "A
   file with no words" (both its sub-cases: `extra.json` drops out and the `sign-in.json` lines
   appear) fail;
   replace with a string instead of a function → "Replacement is literal" fails; drop
   `profile.json` from the Spanish words → "Every module file has words" fails.
4. Run `pnpm --filter @waitron/server typecheck`.

## Task 2 — put the README in the ZIP

Files: `apps/server/src/personal-data-export-api.ts`, `apps/server/src/me-api.ts` (the mount
call, `:118-122`), `apps/server/src/personal-data-export-api.readme.test.ts` (new),
`apps/server/src/personal-data-export-api.test.ts`, `apps/server/src/me-api.personal-data-export.test.ts`,
`apps/server/src/boot.personal-data-export.test.ts`, `apps/server/src/start-full-disk.e2e.test.ts`
(one fixture line, `:306`).

Changes (decisions 1, 4, 6):

- `PersonalDataAuthorize` returns `{ personId: string; label: string; language: "en" | "es" }`.
- `PersonalDataExportDeps` gains `venueLocale: string` and `privacyNoticeUrl?: string`.
- In `sendPersonalData`, the snapshot turn also reads `readTenant(tx)` after `venuePlace`, awaited
  in turn. After the second turn, the README is built with `personalDataReadme({ language:
  snapshot.who.language, venue: tenant?.legalName ?? null, person: snapshot.who.label, date:
  civilDateOf(at, snapshot.place.timeZone), privacyNoticeUrl: deps.privacyNoticeUrl, files:
  files.map((f) => f.name) })` and zipped first: `zipArchive([{ name: "README.txt", content:
  readme }, ...files], at)`.
- The own route's `authorize` adds `language`, from `viewer.locale`, the request's
  `Accept-Language` and `deps.venueLocale` (decision 1).
- `mountMeApi` passes `venueLocale: deps.venueLocale` and `privacyNoticeUrl: deps.privacyNoticeUrl`.

Fixtures that grow, and why (the pull request lists each): in `personal-data-export-api.test.ts`,
`deps()` (`:65-74`) gains `venueLocale: "en-GB"` because the field is required; the two spy
`authorize` results (`:308`, `:319-320`) gain `language: "en"` because the type requires it. In
`start-full-disk.e2e.test.ts`, the mount call at `:306` gains `venueLocale: "en-GB"` for the same
reason: without it `pnpm --filter @waitron/server typecheck` fails, since the server's
`tsconfig.json` includes `src`, test files among them (Vitest does not typecheck, so the run alone
would not show it). The whole-list assertions at `personal-data-export-api.test.ts:158` and
`me-api.personal-data-export.test.ts:52` and `:58` gain `README.txt` (Global constraints).

1. Tests first, in the new `personal-data-export-api.readme.test.ts` (`useVenueDb` with core and
   identity migrations; `seedTenant`, whose legal name is `Test SL`,
   `packages/db/src/testing/seed.ts:30`; a location in `Europe/Madrid` and a node there, as the
   existing file sets up at `:106-145`; Marta López with a management session; `now` at
   `2026-10-04T22:30:00Z`; mounted with the real identity entry from `ALL_MODULES` and two stub
   server parts: one building `extra.json`, one declaring `silent.json` and building nothing):
   - **The README describes the ZIP.** The ZIP's entries are, in order, `README.txt`,
     `profile.json`, `sign-in.json`, `extra.json`; `README.txt` is `toBe`
     `personalDataReadme({ language: "en", venue: "Test SL", person: "Marta López", date:
     "2026-10-05", files: ["profile.json", "sign-in.json", "extra.json"] })`. This one case pins
     the venue's name, the venue's date (the UTC date would be `2026-10-04`), the built list and the
     order.
   - **Built, not declared.** The README does not contain `silent.json`.
   - **The privacy notice.** Mounted with `privacyNoticeUrl: "https://venue.example/privacy"`, the
     README's last line ends with that address; without it, no README line contains `https://`.
   - **The language.** Each row sets Marta's saved `locale` by SQL, sends `Accept-Language` (or
     none) and mounts with a `venueLocale`; the README's first line is the expected language's
     `title` (from `PERSONAL_DATA_README`). Each row is chosen so a rule that skipped one step
     would give the other language:

     | Row | Saved | `Accept-Language` | `venueLocale` | README |
     | --- | --- | --- | --- | --- |
     | 1 | `es-ES` | `en-GB` | `en-GB` | Spanish (saved beats the browser) |
     | 2 | `en-GB` | `es-ES` | `es-ES` | English (saved beats both) |
     | 3 | null | `es-ES,es;q=0.9` | `en-GB` | Spanish (browser beats the venue) |
     | 4 | null | none | `es-ES` | Spanish (the venue last) |
     | 5 | null | `fr-FR` | `es-ES` | Spanish (an unsupported browser language falls to the venue) |
     | 6 | `de-DE` | `es-ES` | `en-GB` | Spanish (an unsupported saved language is skipped) |

   - **No tenant row.** With the tenant row deleted by SQL, the README's title is
     `Your data held by the venue`.
   - In `me-api.personal-data-export.test.ts`, a new case: mounted with `venueLocale: "es-ES"` and
     `privacyNoticeUrl`, a person with no saved language and no `Accept-Language` gets a Spanish
     README ending with the address (shows `mountMeApi` passes both).
   - In `boot.personal-data-export.test.ts`, one more assertion in the existing case: the ZIP holds
     `README.txt` and its first line names the venue's legal name as the fixture seeds it (read the
     fixture for the value), so a real start reaches the tenant read.
   Run `pnpm --filter @waitron/server exec vitest run src/personal-data-export-api.readme.test.ts
   src/personal-data-export-api.test.ts src/me-api.personal-data-export.test.ts
   src/boot.personal-data-export.test.ts`; watch the new cases fail, and the three whole-list
   assertions fail once updated (no README yet).
2. Make the changes.
3. Omission controls, each run and reverted; the predictions are the claim check's probe P2, which
   ran the six rows under both language controls: return `language: "en"` always → rows 1, 3, 4, 5
   and 6 fail (five rows); drop `Accept-Language` from the rule → rows 3 and 6 fail; build the
   README from the parts' declared names → "Built, not declared" fails; drop the tenant read → "The
   README describes the ZIP" fails.
4. Run the existing cases with their assertions unedited: `pnpm --filter @waitron/server exec
   vitest run src/personal-data-export-api.test.ts` (the whole file, so the `sendPersonalData`
   cases, whose names lack "personal-data", run too), then `pnpm --filter @waitron/server exec
   vitest run src/start-full-disk.e2e.test.ts -t "personal-data"` (its case is "a person's own
   personal-data download answers on a full disk with a change waiting", `:382`), then
   `pnpm --filter @waitron/server typecheck`. Read the test count of each run.

## Task 3 — a download that keeps the server's file name (`@waitron/dashboard-kit`, the client)

Files: `packages/dashboard-kit/src/request.ts`, `packages/dashboard-kit/src/request.test.ts`,
`apps/dashboard/src/api/client.ts` (a method beside `getProfile`, `:2265`),
`apps/dashboard/src/api/client-routes.test.ts`.

Interface (decision 7):

```ts
// request.ts
export interface DownloadedFile {
  readonly blob: Blob;
  /** From `Content-Disposition: attachment; filename="<name>"` only; otherwise null. */
  readonly fileName: string | null;
}
export interface RequestOptions {
  passive?: boolean;
  as?: "blob" | "file";
  timeLimitMs?: number;
}
// client.ts
downloadOwnPersonalData(): Promise<DownloadedFile>; // GET /management-api/me/personal-data/export, { as: "file" }
```

1. Tests first:
   - `request.test.ts`: with `as: "file"`, a 200 whose `Content-Disposition` is
     `attachment; filename="marta-lopez-2026-10-05.zip"` resolves to that name and the body's bytes
     unchanged; no header → `fileName: null`; `attachment; filename*=UTF-8''x.zip`,
     `attachment; filename=x.zip` (unquoted) and `inline; filename="x.zip"` → `null`; a refusal is
     decoded exactly as with `as: "blob"` (copy the case starting at `:245`); no time limit, as the
     `as: "blob"` case at `:448-459`; `onSuccess` is called for a non-passive download (the
     dashboard's activity signal, decision 8).
   - `client-routes.test.ts`: `downloadOwnPersonalData()` asks `GET
     /management-api/me/personal-data/export` with credentials and no `x-waitron-live` header, and
     returns the name and bytes. Its fake response is a real `new Response(bytes, { headers })`:
     the file's `jsonResponse` helper (`:6-8`) has no headers.
   Run `pnpm --filter @waitron/dashboard-kit exec vitest run src/request.test.ts` and
   `pnpm --filter @waitron/dashboard exec vitest run src/api/client-routes.test.ts`; watch them
   fail.
2. Write it. The `as: "blob"` path and its cases do not change.
3. Omission controls: drop the quoted-form check (take anything after `filename=`) → the unquoted
   and `inline` cases fail (the claim check's probe P3: such a parser returns `x.zip` for both, and
   still `null` for `filename*=`, which does not contain the text `filename=`, so that case keeps
   passing); apply the time limit to `"file"` → the no-limit case fails.
4. Run `pnpm --filter @waitron/dashboard-kit exec vitest run`, and `typecheck` in both packages.

## Task 4 — the Profile page's row and button

Files: `apps/dashboard/src/screens/profile-screen.ts`, `apps/dashboard/src/i18n/strings.ts`,
`apps/dashboard/src/screens/profile-screen.personal-data.test.ts` (new).

Strings (English / Spanish):

| Key | English | Spanish |
| --- | --- | --- |
| `profile.data_copy` | Copy of your data | Copia de tus datos |
| `profile.data_copy_hint` | A ZIP file with your data and what it is used for. | Un archivo ZIP con tus datos y para qué se usan. |
| `profile.data_copy_download` | Download a copy of your data | Descargar una copia de tus datos |
| `profile.data_copy_busy` | Preparing… | Preparando… |

The button's text is `action.download` («Descargar»); its `aria-label` is
`profile.data_copy_download`, or `profile.data_copy_busy` while loading (decision 8). Markup: a
`div.action-row` (not `.row`: two existing cases read every `.row` as a label-and-value pair,
`profile-screen.test.ts:986-990`, `:1074-1077`) holding `div.text` with `span.field-value` (the
label) and `span.field-meta` (the hint), and the `wt-button` with `data-test="download-data-copy"`,
`class="card-action accent-primary"`, `?loading=${this.downloading}`; under the row, while set,
`<p class="error" role="alert" data-test="download-data-copy-error">`.

The new test file's fixture: its own small API stub with `getProfile`, `getLocales` and
`getGoogleConfig` as `profile-screen.a11y.test.ts:9-43` has them, plus `downloadOwnPersonalData`
resolving `{ blob: new Blob(["zip"]), fileName: "marta-lopez-2026-10-05.zip" }`. It is a new stub,
not a change to the existing files' stubs, because those files' cases never press this button.

1. Tests first, in `profile-screen.personal-data.test.ts` (browser), each case restoring the
   language it changed:
   - **The row.** On the details tab: the label, the hint, the button reading `t("action.download")`
     with the `aria-label` `t("profile.data_copy_download")`; not disabled, not loading.
   - **A press saves the file.** Spy `URL.createObjectURL` (recording the blob it was given),
     `URL.revokeObjectURL` and `HTMLAnchorElement.prototype.click`, as
     `profile-screen.test.ts:1246-1262` does: one call to `downloadOwnPersonalData` with no
     arguments; the anchor's `download` is `marta-lopez-2026-10-05.zip`; its `href` is the address
     made from the very blob the API returned; that address is revoked.
   - **No name from the server.** `fileName: null` → the anchor's `download` is `personal-data.zip`.
   - **While it is sent.** With the API's promise held by the test: the button is `loading`, its
     text and `aria-label` are `t("profile.data_copy_busy")`; axe finds nothing in this state
     (`expectNoA11yViolations`); a second `.click()` on the button host makes no second call; once
     the promise resolves, `loading` is false and the label is back.
   - **A refusal.** The API rejects `{ code: "connection.failed" }`: the error line reads
     `codeMessage("connection.failed")` with `role="alert"`; the button is neither disabled nor
     loading; opening the details editor (`el.editDetails()`) shows no message at the dialog's foot
     (`wt-form-actions`' `error` is `""`). A second press clears the line while its request is still
     held, and a success leaves it empty.
   - **Leaving while it is sent.** Remove the element while the promise is held, then resolve it:
     no anchor click, no blob address made; reject instead: nothing thrown, no message on the next
     mount.
   - **Spanish.** With `setLocale("es-ES")`: the label, hint, button text and busy text are the
     Spanish `t()` values.
   - **Accessible.** In light and dark (`mountWidget`'s theme argument), axe finds nothing with the
     row at rest, while sending (the case above, in both themes) and with the error line shown.
   Run `pnpm --filter @waitron/dashboard exec vitest run src/screens/profile-screen.personal-data.test.ts`
   (check free memory first: `memory_pressure | grep free`); watch them fail.
2. Write the row and the handler (decision 8).
3. Omission controls: drop the early return while sending → the second-press case fails; set the
   message in the screen's `error` field instead → the editor-foot check fails; drop the leave
   check → the leaving case fails.
4. Run the existing Profile suites unedited:
   `pnpm --filter @waitron/dashboard exec vitest run src/screens/profile-screen.test.ts
   src/screens/profile-screen.a11y.test.ts src/screens/profile-screen.save-state.test.ts
   src/screens/profile-screen.unsaved.test.ts` (the a11y file's hover loop selects
   `[slot=details] .card-action`, so it now also hovers the new button,
   `profile-screen.a11y.test.ts:77-84`), and `pnpm --filter @waitron/dashboard typecheck`. Read each
   count.

## Task 5 — the guide section and the help link

Files: `apps/server/src/guide/en/staff.md`, `apps/server/src/guide/es/staff.md`,
`apps/dashboard/src/help-guide.ts` (`"staff.own-data": { page: "staff", section: "own-data" }`,
placed straight after `"products.variants"`, away from where #2025 appends),
`apps/dashboard/src/screens/profile-screen.ts`, `apps/dashboard/src/i18n/strings.ts`,
`apps/dashboard/src/screens/profile-screen.personal-data.test.ts`.

The guide text, after "Your own account" in each file (one paragraph; labels in bold as the screen
writes them; check each label against `strings.ts` before committing):

> ## Download your data {#own-data}
>
> Open **Account settings** from the account menu and, on **Your details**, press **Download**
> beside **Copy of your data**. You get a ZIP file with your profile and sign-in details as `.json`
> files, and a `README.txt` that explains each file, who else receives the data, how long it is
> kept and your rights. It never holds a secret such as your PIN or password. For anything else
> about your data, ask the venue.

> ## Descargar tus datos {#own-data}
>
> Abre **Configuración de la cuenta** desde el menú de cuenta y, en **Tus datos**, pulsa
> **Descargar** junto a **Copia de tus datos**. Recibes un archivo ZIP con tus datos de perfil y de
> acceso en archivos `.json`, y un `README.txt` que explica cada archivo, quién más recibe los
> datos, cuánto tiempo se guardan y tus derechos. Nunca contiene secretos como tu PIN o tu
> contraseña. Para cualquier otra cosa sobre tus datos, pregunta al local.

In the same files, the existing "Your own account" sentence (`en/staff.md:22`, and its twin) says
"Open **Your profile** from the account menu" / «Abre **Tu perfil** desde el menú de cuenta»; the
menu entry reads **Account settings** / «Configuración de la cuenta» (decision 9), so it becomes
"Open **Account settings** from the account menu" / «Abre **Configuración de la cuenta** desde el
menú de cuenta», the rest of the sentence unchanged.

Sources: the menu entry (`strings.ts:853`, `:4252`; `dashboard-app.ts:1855`); the tab names
(`strings.ts:1030`, `:4334`); Task 4's keys; the contents (S2a1 decision 10; Task 1's layout);
"never a secret" (S2a1's no-secrets rule and its tests). The guide's renderer accepts bold and
backticked code (conventions-ui.md:147-148).

Help strings:

| Key | English | Spanish |
| --- | --- | --- |
| `profile.data_copy_help_label` | What the copy holds | Qué contiene la copia |
| `profile.data_copy_help` | Your profile and sign-in details, and a README.txt that explains them and your rights. | Tus datos de perfil y de acceso, y un README.txt que los explica junto con tus derechos. |
| `profile.data_copy_help_guide` | More about your data | Más sobre tus datos |

The row's `.text` gains, after the label, `<wt-help-tooltip mode="help-mode"
aria-label=${t("profile.data_copy_help_label")} guide-href=${guideHref("staff.own-data")}
guide-label=${t("profile.data_copy_help_guide")}>${t("profile.data_copy_help")}</wt-help-tooltip>`,
as `box-status-screen.ts:299-305` does.

1. Tests first:
   - In `profile-screen.personal-data.test.ts`: the row holds one `wt-help-tooltip` whose `mode` is
     `help-mode`, whose `guide-href` is `/help/en/staff#own-data`, and whose text and labels are
     the `t()` values; with `setLocale("es-ES")`, `guide-href` is `/help/es/staff#own-data`. With
     help mode on (`setHelpMode(true)` from `@waitron/ui`, set back to off after), axe finds nothing
     in light and dark.
   - The guide suites read the pages as they are; no edit to them:
     `pnpm --filter @waitron/server exec vitest run src/guide-content.test.ts src/guide-pages.test.ts`
     (the twin's ids must match in order); from the repository root,
     `pnpm exec vitest run scripts/guide-links.test.ts scripts/help-tooltip-mode.test.ts`
     (`guide-links` renders each linked section).
   Run the dashboard file; watch the new cases fail. Run `scripts/guide-links.test.ts` after adding
   only the `GUIDE_LINKS` entry, and watch it fail because the section does not exist yet.
2. Write the two sections, the corrected sentence, the link and the tooltip.
3. Omission control: give the Spanish section another id → `guide-content.test.ts` fails; drop
   `mode="help-mode"` → `scripts/help-tooltip-mode.test.ts` fails.
4. Run the four suites of step 1 again and `pnpm --filter @waitron/dashboard typecheck`.

## Task 6a (visual) — LOOK at the row in the browser test runner

Task 6a and Task 6b may be dispatched to separate implementers: together they could pass 100
tool calls. Screenshots go to `/Users/clintongormley/waitron-campaign-b/a980-s2a2-shots/`, named
`<what>-<lang>-<theme>-<width>.png`; scripts live in
`/Users/clintongormley/waitron-campaign-b/a980-s2a2-scripts/`, never in the worktree. A fix either
task leads to is committed with a test that would have caught it where one can.

1. A throwaway `apps/dashboard/src/zz-profile-data-copy.look.test.ts`, never committed, built like
   the existing look screenshots in `profile-screen.a11y.test.ts:85-88` (`page.viewport`,
   `page.screenshot` to `__screenshots__/look/`), with Task 4's stub: for English and Spanish ×
   light and dark × 1280 and 390 px, the details tab (a) at rest, (b) while sending, (c) with the
   error line, (d) with help on and the "?" opened.
2. Run `pnpm --filter @waitron/dashboard exec vitest run src/zz-profile-data-copy.look.test.ts`,
   copy the PNGs to the shots folder, then delete the file (`git status --short` shows nothing of
   it).
3. Open every PNG and look for: the button at the row's end at 1280 and not overflowing at 390;
   «Copia de tus datos» and «Preparando…» fitting; the hint muted like the other rows' hints; the
   error line in the danger colour under the row; the "?" beside the label, not over the button.
   Write what was seen, one line per picture, for the pull request's **LOOK** section.

## Task 6b (visual) — LOOK at a real download and the guide on the dev stack

If dispatched alone: screenshots and the downloaded files go to
`/Users/clintongormley/waitron-campaign-b/a980-s2a2-shots/`, named
`<what>-<lang>-<theme>-<width>.png`; the Playwright script lives in
`/Users/clintongormley/waitron-campaign-b/a980-s2a2-scripts/`, never in the worktree; a fix this
leads to is committed with a test that would have caught it where one can.

1. `wa-wt demo waitron-feat-a980-s2a2-own-download-ui`; `wa-wt ls` gives the dashboard and server
   addresses. With the workspace's Playwright Chromium (a script in the scripts folder; record its
   process id):
   - sign in to the dashboard as the demo manager, Marta Ruiz (`manager@demo.waitron.local`,
     password `dashPass123`: `apps/server/scripts/demo-seed/staff.ts:10`, `:26-30`); open
     **Account settings** (`/manage/profile`); press **Download** and wait for the browser's
     download event; record its suggested file name (expected `marta-ruiz-<the venue's date>.zip`,
     not `personal-data.zip`) and save the file to the shots folder;
   - `unzip -l` the file (expected entries in order: `README.txt`, `profile.json`,
     `sign-in.json`) and `unzip -p <file> README.txt`; save the README beside the screenshots;
     check its title names the demo venue's legal name and its date matches the file name;
   - change the profile's language to Español (the details editor's Language field), download
     again, and check the README is Spanish;
   - screenshot `/help/en/staff#own-data` and `/help/es/staff#own-data` in light and dark (the
     guide reads `localStorage["waitron-theme"]`, `apps/server/src/guide-pages.ts:52`) at 1280 and
     390 px; check the section heading and paragraph render with the bold labels and code, and that
     the "?" link on the row opens that section.
2. Stop the Playwright process by its recorded id, then
   `wa-wt down waitron-feat-a980-s2a2-own-download-ui`.
3. Open every PNG and both READMEs, and write what was seen, one line each, for the pull
   request's **LOOK** section.

## Task 7 — backlog and docs

Files: `docs/backlog/data-protection.md` (the S2 point, `:72-78`), `docs/backlog.md` (the A980
entry, `:6198-6201`), `docs/superpowers/plans/2026-10-24-a980-data-protection-build.md`,
`docs/developers/conventions-data.md` (`:2585-2591`).

1. Grep the siblings first (home CLAUDE.md §1): `grep -rn "personal-data\|S2a2\|README" docs/backlog.md
   docs/backlog/data-protection.md docs/developers/ docs/superpowers/plans/2026-10-24-a980-*.md`.
2. In `data-protection.md`, the S2 point says the Profile page's button, the README (English and
   Spanish, in the person's language) and the Users guide section exist, and lists only what is
   left: **S2b** and **S2c**, each with the README words, guide text and help text it must add
   ("Left for later" above). The "Mount the own download from `boot.ts`" point (`:79-84`) is not
   this slice's and stays. `docs/backlog.md`'s A980 entry stays accurate as written; change it only
   if the grep finds it naming S2a2.
3. In the overview, add to the header's status paragraph: "2026-10-25: S2a2 is built
   ([its plan](2026-10-25-a980-s2a2-own-download-ui.md)): the README inside the ZIP, the Profile
   page's button and the Users guide section. The README is in the person's own language, not the
   venue's as design §4.2 says (S2a2 decision 1); S2c and S3 choose the language for a download
   made for someone else. The README shows the privacy-notice address, so S1b also moves the
   README to the stored setting." In the slice table's S1b row (`:44`, "Every place that shows the
   link …"), add the README to the list of places.
4. In `conventions-data.md`, the sentence "every part in the first" (`:2587`) becomes "every part,
   and the venue's name for the README, in the first". #2025 also changes this file; whichever
   lands later rebases.
5. `pnpm exec prettier --file-info <file>` on each changed doc: `docs/` is ignored, so each prints
   `"ignored": true` and no format step applies.

## Review focus

- **Every README sentence against its source.** Task 1's table; a sentence that claims more than
  its row (for example "deleted" for something only ended, "sent" for an email only issued, or
  "everything" while S2b and S2c are missing) is a defect. The Google link's unfinished-setup row
  is deliberately not in the disable sentence (`google_oidc_states` survives disabling). Design
  §2.1 row s4 predates S4; the code is the source.
- **The language rule** (decision 1) departs from the design's "venue's language"; the six rows in
  Task 2 are the evidence that it is the dashboard's own rule.
- **An undescribed file is listed by name only** (decision 2): a refusal would withhold the whole
  copy. The module guard is weaker than its name: server parts are outside it.
- **What the README leaves out** (decision 3): automated decisions, transfers outside the EU, the
  remote-access relay and exact periods, each with its reason.
- **Whose data.** Nothing here changes who may download: the own route still takes no query and
  compares the person id after building (S2a1 decision 7); the README is built from the same
  person's files after the second check.
- **The idle-countdown mismatch** (decision 8): specific to this route (the working-time download
  does restart the server's countdown), accepted for the full-disk reason.
- **The file name.** `as: "file"` reads the header only in the server's own form and is otherwise
  `null`; the cross-origin limit is stated in decision 7.
- **Nothing written.** The README adds one read (`readTenant`) to the snapshot turn and no write;
  the existing "changes no row with a change waiting" case (`personal-data-export-api.test.ts:236-246`)
  and the full-disk e2e case pass with their assertions unedited (the full-disk file's mount call
  gains `venueLocale`, a fixture line).
- **The changed assertions and fixtures.** The pull request names the three whole-list assertions
  that gain `README.txt` and every fixture that grows (Task 2).
- **Codex run-it seat**: personal data is a risk trigger, so `/finish-branch` runs two Codex
  reviews, the second told to set this plan aside and test what it does not name.
