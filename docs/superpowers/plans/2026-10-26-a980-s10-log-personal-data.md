# A980 slice S10: no person's name or email in the log the recovery page shows

**Status: plan, 2026-10-26. Nothing was built when this was written.** Written by lane B with
nobody watching; every choice below was made conservatively and is listed under "Open decisions
for the owner" so it can be reversed. Design:
[A980 data protection, revision 2](../specs/2026-10-22-a980-data-protection-design.md) §2.3 (rows d5
and d6), §4.8 (the "log file masks URL passwords" row, marked **unverified (S10)**), §5.3 row S10 ("a
failing probe first") and the "Not verified" paragraph at the end. Overview:
[the build plan](2026-10-24-a980-data-protection-build.md), row S10 and its note ("Write the failing
probe first: make the logger receive each error and check the masked log line. If nothing leaks, the
slice is the probe as a test."). Branch `feat/a980-s10-log-personal-data`, from `main` at
`375d74212`.

**The probe found leaks, so this slice is a fix, not only a test.** Every refusal that names a
person in its error details writes that name or email into `waitron.log`, and the page the box
serves when it cannot start, which anyone on the venue's network can open without signing in, shows
the file's last lines. An email server's refusal does **not** leak: Waitron reduces it to a code
before anything is logged. The probe's runs are kept in
`/Users/clintongormley/waitron-campaign-b/a980-s10-plan-probe/` (`probe.test.ts`, `probe2.test.ts`,
`run2.txt`, `run3-boot-failure.txt`, `run4-nested.txt`, `registry-keys.txt`); the files were
deleted from the worktree before this plan was committed.

**No migration.** Logs are files. **FULL review**: personal data on a page that needs no sign-in.
Per-task reviews run, then `/finish-branch`, which runs two Codex reviews, the second told to set
this plan aside and test what it does not name.

**Nothing a screen reads changes.** The mask is applied only where a line is written to the log.
The HTTP answer keeps every detail, because the till and the setup wizard read some of them
(decision 3).

## Words used here

- An **error code** is the dotted name a refusal carries (`person.email_taken`). Its **details**
  (`params` in the code) are the values that travel with it, such as `{ email }`. Each package
  declares its codes and their details in a **registry**, a file that adds to the shared
  `ErrorParams` list (`packages/identity/src/errors.ts`, `apps/server/src/errors.ts`, and so on).
- The **error boundary** is the shared wrapper every route runs in
  (`packages/server-kit/src/error-boundary.ts`). For a refusal it writes one `warn` line holding the
  code and every detail (`:45`), and answers the request with the same code and details (`:46`).
- The **log** is `waitron.log`, one JSON line per event, rotated at 10 MB and kept as five files
  (`apps/server/src/config.ts:141-142`). The server's one logger writes each line to the container's
  output (stdout, what `docker logs` shows) and to the file (`apps/server/src/boot.ts:929-949`).
  Only the file is passed through `redactSecrets` (`apps/server/src/log-file.ts:56`), which masks a
  password inside a URL and nothing else (`apps/server/src/redact-secrets.ts:12-16`).
- The **recovery page** is what the box serves instead of the app when it cannot start
  (`recoveryApp`, `apps/server/src/recovery-surface.ts:584-591`). It needs no sign-in. It shows the
  **last 200 lines of the current `waitron.log`** (`MAX_LOG_LINES`, `:14`; `readLog`, `:80-89`),
  whichever start wrote them, HTML-escaped (`:540-543`), and the failed start's own report under
  "Why the last start failed". Both it and the server find the folder with `resolveLogDir`
  (`apps/server/src/node-entry.ts:649`, `apps/server/src/config.ts:532`), so a line the running
  server wrote is on the page after a later failed start, until 200 newer lines or a rotation push
  it out.
- The **failed-start report** is the text `failureDetail` builds when a start fails: name, message,
  stack, causes, and each `AppError`'s details as `params: {…}`
  (`apps/server/src/node-entry.ts:172-204`). It is written to the log as `server.boot_failed`'s
  `detail` (`:562-565`) and shown on the page.
- To **mask** a value is to write `***` in its place, the token `redactSecrets` already uses.

## What the probe ran, and what it printed

A throwaway Vitest file in `apps/server/src` (copy: `probe.test.ts`), with every migration set
(`useVenueDb`), a venue from `planVenue`, and a staff member Marta Soler,
`marta.soler@example.test`. The logger was built as `boot.ts:944-949` builds it: `createLogger`
over `tee(stdout, createRotatingFileSink(...))`, threshold `info` (`boot.ts:928`). After each action
the probe read `waitron.log` and rendered `recoveryApp({ logDir })`'s page.

**What the failing case would print**: the name or email inside the page's log tail. **What a
non-leaking case prints**: the event line without them. These differ, and each case also checked a
control: that the page's tail does show a line from the action (so an empty tail cannot pass as
"no leak").

| Case | Path driven | Result | What the log line said |
| --- | --- | --- | --- |
| A | `POST /management-api/staff` with Marta's email | **leaks**: in stdout, in `waitron.log`, on the page | `{"email":"marta.soler@example.test",…,"event":"person.email_taken"}` |
| B | `POST /management-api/staff` with display name "Marta Soler" | **leaks** | `{"displayName":"Marta Soler",…,"event":"person.display_name_taken"}` |
| C | `PUT /management-api/staff/:id`, the clerk given Marta's email, then her name | **leaks**, both | the same two lines |
| D | `PUT /management-api/session/me/profile`, the clerk taking Marta's name, then her email (the profile's own route, `me-api.ts`) | **leaks**, both | the same two lines |
| E | Inviting Jordi Puig, `jordi.puig@example.test`, through `POST /management-api/staff` with the real `createAccountEmailSender`, against a relay that refuses the recipient at `RCPT` (and, second run, the message at `DATA`) with a reply echoing the address | **no leak** of the address or the name | `{"purpose":"invitation","personId":"…","event":"account_email.send_failed"}` |
| F | Changing the clerk's own email to Jordi's, verification refused by the same relay at `RCPT` and at `DATA` (`me-api.ts:185-190` logs the thrown error's message) | **no leak** | `{"purpose":"email_change","error":"email.send_refused",…}`; the thrown error is `AccountEmailFailure` whose message is the code (`apps/server/src/account-email.ts:19-27`) |
| G | The invoice email sender (`createInvoiceEmailSender`) against the same relay, both refusals | **no leak**: it returns `{"status":"failed","failureCode":"transport_failed"}` and logs nothing itself | (none) |
| H | The text email sender used by attendance and box alerts (`createTextEmailSender`), both refusals | **no leak**: `onFailure` receives `"email.test_refused"` | (none) |
| J (control for E–H) | nodemailer called directly against the same relay | the relay's reply **does** carry the address | `Can't send mail - all recipients were rejected: 550 5.1.1 <jordi.puig@example.test>: Recipient address rejected: User unknown` and `Message failed: 550 5.7.1 <jordi.puig@example.test>: …` |
| I | The real error boundary throwing `draft.taken_over { ownerName: "Marta Soler" }` and `device.equipment_held { holderPersonName: "Jordi Puig" }` (thrown in a minimal app, not through the till's routes) | **leaks**, both | `{"draftId":"d1","ownerId":"p1","ownerName":"Marta Soler",…}`, `{…,"holderPersonName":"Jordi Puig",…}` |
| K (`probe2.test.ts`) | The boundary throwing `draft.taken_over`'s second shape, whose `edit` holds `editorName` | **leaks**, nested | `{…,"edit":{"billId":"b1","editorId":"p2","editorName":"Marta Soler",…},…}` |
| L (`run3-boot-failure.txt`) | `runEntry` with a start that fails on `AppError("person.email_taken", { email })`, a case added to `node-entry.test.ts` for one run and removed with `git checkout` | **leaks** into the failed-start report | `params: {"email":"marta.soler@example.test"}` |

Why E–H do not leak, read at the code after the run: `sendSmtpMessage` turns any failure into a
status and a code (`apps/server/src/smtp-send.ts:23-32`, `classifySmtpFailure`,
`apps/server/src/smtp-failure.ts:18-54`); the invoice sender does the same in its own handler
(`apps/server/src/invoice-email.ts:58-73`); the invitation route logs only the purpose and person id
and says why (`apps/server/src/management-api.ts:197-204`). Existing tests already pin the
outcome shapes exactly: `apps/server/src/smtp-send.test.ts:99`
(`toEqual({ status: "rejected", reason: "email.test_refused" })`) and the refused cases at
`apps/server/src/invoice-email.test.ts:304`.

**What else carries a person in its details** (the registries read as text with
`registry-keys.mjs` over the 31 files that declare `ErrorParams`, one of them a test fake, then each
named type opened by hand):

| Code | Detail | Who it names | Thrown where | A screen reads it from the answer? |
| --- | --- | --- | --- | --- |
| `person.email_taken` | `email` | a staff member | `packages/identity/src/staff.ts:43`, `:64`, `:122`; `packages/identity/src/account-action.ts:234` | no: the dashboard maps the code to the field (`apps/dashboard/src/widgets/person-form.ts:29-35`, `apps/dashboard/src/screens/profile-screen.ts:728-731`) and uses the typed email, not the detail (`apps/dashboard/src/screens/staff-screen.ts:423-429`) |
| `person.display_name_taken` | `displayName` | a staff member | `staff.ts:58`, `:100`, `:446`, `:491` | no (same files) |
| `draft.taken_over` | `ownerName`; `edit.editorName` and `conflicts[].editorName` (`BillEditState`, `apps/server/src/order-drafts.ts:137-144`) | a staff member | `apps/server/src/bill-editing.ts:238` | **yes**: the till names who took the bill over (`apps/till/src/state/draft-sync.ts:241-243`, `apps/till/src/till-app.ts:716-718`) |
| `device.equipment_held` | `holderPersonName` | a staff member | `apps/server/src/device-equipment.ts:406-411` | not today: `git grep holderPersonName` outside tests finds only the throw and the registry; the dashboard reads the same answer's `holderDeviceName` (`apps/dashboard/src/screens/devices-screen.ts:165`) |
| `purchase.duplicate` | `supplierTaxId` | a supplier, who may be a sole trader | `packages/purchasing` (registry `packages/purchasing/src/errors.ts:14`) | no: the message is fixed (`apps/dashboard/src/i18n/codes.ts:968-971`) and the form keeps its own typed value |
| `clock.behind_chain_restarted` | `person` | an administrator | recorded as an incident only, never thrown (`packages/fiscal-verifactu/src/errors.ts:378-389`) | no: the alert and its email use `confirmedBy` (`apps/dashboard/src/i18n/alert-messages.ts:148-151`, `apps/server/src/box-alert-email.ts:60-70`) |
| `restore.stream_venue_unconfirmed` | `legalName`, `taxId` | the venue itself (a sole trader's own name and tax number) | `apps/server/src/restore-request.ts:280`, `apps/server/src/restore-stream.ts:378` | **yes**: the setup wizard shows the venue to confirm (`apps/setup/src/setup-app.ts:1684-1685`) |

Other logging was read for the same thing and carries no person: `String(error)` of payment and
alert failures (`boot.ts:488-590`, `apps/server/src/dish-not-sent-alert.ts:46-51`), which wrap
database refusals and provider errors (not probed); incident recording, which logs only codes
(`packages/core/src/incidents.ts:41-49`); and the free-text names of things (tables, zones,
stations, products, devices), which are not a person's details by meaning (decision 4).

## What this slice builds, and what it leaves

1. **A list of detail names that hold a person's name, email or tax number**, and a mask that writes
   `***` for their values in every log line, at any depth, on both halves of the logger (stdout and
   the file). The failed-start report masks the same names.
2. **The probe as tests**: each leaking path above, driven through the real route or the real error
   boundary into the real file and the real recovery page, now showing `***`; and the email-server
   paths pinned as not leaking, with the relay's own reply as the control.
3. **A root guard** that fails when a registry gains a detail whose name looks like a person's and
   that is neither on the list nor named as not personal.
4. **Words**: one rule in the root `CLAUDE.md`, the recovery page's topic file and the deploy README,
   three code comments the change makes untrue, the design's open rows, the build plan's status, and
   the backlog.

Left on purpose, each an open decision below: free-text labels (decision 4), the venue's own legal
name and tax number (decision 5), device names (decision 4), and email-shaped text inside a message
(decision 7).

## Decisions this plan makes that the design does not

1. **Mask at the logger, by detail name, at any depth.** One file,
   `apps/server/src/log-personal-data.ts`, exports `PERSONAL_LOG_KEYS` and a `JSON.stringify`
   replacer `maskPersonalData`. `createLogger` passes it where it builds the line
   (`apps/server/src/logger.ts:21`), and `paramsLine` passes it for the failed-start report
   (`apps/server/src/node-entry.ts:172-178`). Why here and not in the error boundary:
   - `createLogger` is the only logger factory the server's processes use (`git grep` for
     `createLogger(` and for other `Logger` implementations outside tests, 2026-10-26: `boot.ts`,
     `node-entry.ts`, `first-setup-launch.ts`, `restore-command.ts`, `rejoin-command.ts`,
     `run-server.ts`; the only other `Logger` values are do-nothing defaults such as
     `apps/server/src/promote-api.ts:74`). So the mask covers the error boundary, the
     Stripe webhook's own params line (`apps/server/src/webhook.ts:131`) and any later log call,
     the way `redactSecrets` covers the file "without knowing the page exists"
     (`log-file.ts:20-23`).
   - A replacer reaches nested values, which case K needs (`edit.editorName`), without each caller
     knowing the shape.
   - `packages/server-kit` and every throwing package stay unchanged, so S4's edits to
     `packages/identity/src/staff.ts` cannot conflict (the build plan's order note expected S10 might
     edit that file; it does not).
2. **The list**: `email`, `displayName`, `ownerName`, `editorName`, `holderPersonName`, `person`,
   `supplierTaxId`. A value under one of these names is written as `"***"` whatever its type; `null`
   and an absent value stay as they are, so "no person" still reads differently from "a person".
   `person` is on the list although its one code is never logged today, because its meaning is a
   person's name and the list costs nothing for it.
3. **The answer keeps every detail.** Removing the details from the codes was considered: five of
   the seven are read by no screen (table above). It is rejected because `draft.taken_over`'s names
   and the setup wizard's venue are read from the answer, so removal could not be the one rule, and it would change a response shape for no gain: the answer
   goes to the signed-in person who typed the value. The tests assert the answer is unchanged.
4. **Names of things are not masked**, even though staff may type a person's name into them: table
   labels and short names, order labels (`route.dish_not_sent`'s `orderLabel`, incident-only), zone,
   station, course, product and reason names, and device names (`device.equipment_held`'s
   `holderDeviceName`). The design classes a device label as equipment, "personal only if it names
   someone" (§2.3 row d1). The line drawn is the detail's meaning: a person's name, email or tax
   number is masked; the name of a thing is not.
5. **The venue's own legal name and tax number are not masked** (`restore.stream_venue_unconfirmed`'s
   `legalName` and `taxId`). They are printed on every receipt the venue hands out, so the page shows
   nothing a customer does not already hold; the same holds for the venue's tax number in AEAT's
   incident details (`idEmisorFactura`, `packages/fiscal-verifactu/src/errors.ts:8-12`).
6. **Stdout is masked too.** The mask sits before the tee, so `docker logs` shows `***` as the file
   does. `redactSecrets` stays file-only (`boot.ts:937-942` explains why for passwords: masked, a
   wrong password and none look alike); no such need exists for a person's email, which the request's
   own answer carried to the person who typed it, and the design counts the container's output as
   personal data kept on the box (§2.3 row d6).
7. **No mask by pattern inside free text.** `me-api.ts:185-190` logs whatever message the email
   sender throws; today that is a code (case F). A mask of anything shaped like an email address in
   every line would cover a future sender that put the relay's reply in its message, but it would
   also hide the user half of a URL that `redactSecrets` deliberately leaves visible
   (`redact-secrets.ts:28`) and every venue sender address in setup lines. Not built; offered below.
8. **Lines already written are not rewritten.** A box's existing `waitron.log` keeps old lines until
   rotation. No venue is live, and until one is, the root `CLAUDE.md` §3 rules out data-migration
   code.
9. **The guard judges detail names in registry text** (Task 3). Keys ending in `Id` or `Ids` are
   skipped as ids. Every other key matching a person-shaped word list must be on
   `PERSONAL_LOG_KEYS` or in the guard's own `NOT_PERSONAL` map of `code.key` pairs, each with a
   one-line reason; a pair in the map that no longer exists fails too. It cannot see a key inside a
   named type (`BillEditState`'s `editorName` was found by hand, case K), a log call's own fields, or
   free text. Said where the rule is written.

## Open decisions for the owner (FYI, built with the default)

1. **Free-text names of things stay visible** (decision 4). Example: staff label a takeaway order
   "Marta" and the kitchen screen raises `route.dish_not_sent`; that incident's `orderLabel` is
   "Marta". It is not logged today, but a later refusal that logs a label would show "Marta" on the
   page. Alternative: mask `label`, `orderLabel`, `holderDeviceName` and similar too, losing which
   table or device a refusal was about.
2. **The venue's own name and tax number stay visible** (decision 5). Example: Jordi Puig Ferrer,
   a sole trader with NIF 12345678Z, restores from a bucket; the box refuses until he confirms the
   venue, and the log line shows his name and NIF, exactly as his receipts do. Alternative: add
   `legalName` and `taxId` to the list.
3. **`docker logs` is masked as well as the file** (decision 6). Example: an invitation refused
   `person.email_taken` shows `{"email":"***","event":"person.email_taken"}` in both; an installer
   who needs to know which address finds it in the dashboard's Users list. Alternative: mask the file
   only, as `redactSecrets` does.
4. **No email-shaped mask in free text** (decision 7). Example: if a later change made the email
   sender throw `new Error(relayReply)`, the profile route would log
   `"error":"550 5.1.1 <jordi.puig@example.test>: …"` unmasked. Alternative: a second mask in the
   file sink for anything shaped like an address, at the cost of hiding URL user names.

## Global constraints

- **English only.** Spanish only where the recovery page's existing Spanish strings live; this slice
  adds none. People in fixtures are Marta Soler and Jordi Puig; emails end `@example.test`.
- **The answer is unchanged.** Every refusal test asserts the exact body with `toEqual`, details
  included, beside the log assertion.
- **Every database test uses `useVenueDb`** with `migrationOptionsFor(manifestSets(), null)`, as
  the probe did. Every refused request asserts its domain code and status.
- **Each "not on the page" assertion has its control**: the same page shows the event's code and
  `***` (so an empty tail cannot pass), and for the email-server cases the relay's own reply is shown
  to hold the address (so a relay that never echoed it cannot pass).
- **No package changes.** `git diff --name-only main...HEAD -- packages/` prints nothing at the end.
- **Coverage**: `@waitron/server` holds 98/98/98/95; the new file is covered by Task 1's tests. No
  exclude or ignore comment. `apps/server` is not mutation-tested.
- Commits `git commit -s`; `pnpm format:check` before each commit.
- An implementer that passes about 150 tool calls with its task unfinished stops at a passing or
  cleanly failing point, commits, and hands over: what is done, what is left, the files, each
  check's state.

## Review focus

- **The list** (decision 2) against the table of codes: is any person-carrying detail missing, and is
  anything on it that a diagnosis needs?
- **The answer unchanged** (decision 3): the till's taken-over name and the setup wizard's venue
  still arrive, and every other detail is still in the answer.
- **Depth**: case K's nested `editorName` masked; an array of objects masked.
- **Both channels**: stdout and file masked (decision 6); the failed-start report masked (case L).
- **The controls**: every "absent" assertion paired with a "present" one.
- **The guard's limits** (decision 9), stated in its header and at the `CLAUDE.md` rule.
- **Cost on the sale path**: `createLogger` now runs a replacer on every line; Task 1's measurement.
- **Codex run-it seat**: two reviews, the second told to set this plan aside.

## Task 1 — the mask in the logger and the failed-start report

**Files:** create `apps/server/src/log-personal-data.ts`; modify `apps/server/src/logger.ts:21` and
`apps/server/src/node-entry.ts:172-178`; tests in `apps/server/src/logger.test.ts` (a new
`describe("createLogger personal data")`) and `apps/server/src/node-entry.test.ts` (a case beside
"carries an AppError's params to the installer", `:741`).

**Tests first** (watch each fail before writing the code):

1. For each key on the list, `log("warn", "x", { [key]: "Marta Soler" })` writes a line whose parsed
   object `toEqual`s `{ [key]: "***", at, level: "warn", event: "x" }`, and whose raw text does not
   contain `Marta Soler`.
2. Nested and in arrays: `{ edit: { editorName: "Marta Soler", editorVersion: 3 }, conflicts: [{
   editorName: "Jordi Puig" }] }` writes `editorName: "***"` in both places and keeps
   `editorVersion: 3`.
3. Kept as they are, in one exact `toEqual`: `ownerName: null`; and the neighbours a reader might
   expect masked but decisions 4 and 5 keep: `name`, `label`, `holderDeviceName`, `legalName`,
   `taxId`, `personId`, `ownerId`.
4. A non-string value under a listed key is masked (`{ person: { id: "p1" } }` writes
   `person: "***"`).
5. `at`, `level` and `event` are never masked, including an event named `email`.
6. `node-entry.test.ts`: a start that fails with `new AppError("person.email_taken", { email:
   "marta.soler@example.test" })` reports `params: {"email":"***"}` and not the address. The existing
   `migrations.incomplete` case at `:741` passes unedited (diagnostic details still shown).

**Code:** the file holds the list as a `ReadonlySet<string>` and
`maskPersonalData(key: string, value: unknown): unknown`, returning `"***"` when the key is on the
list and the value is neither `null` nor `undefined`, else the value. No comment beyond one line
naming what the list is for and pointing at the guard.

**Run:** `pnpm --filter @waitron/server exec vitest run src/logger.test.ts src/node-entry.test.ts
src/log-file.test.ts src/recovery-surface.test.ts` (read the `Tests` count). Then
`git grep -n -E '"(email|displayName|ownerName|editorName|holderPersonName|person|supplierTaxId)"' --
'apps/server/src/*.test.ts'` and open every hit that reads a line back from a real `createLogger`
(the planner found none on 2026-10-26: only `awaiting-fiscal-cert.test.ts` builds one, and its hits
are database values).

**Omission controls:** drop the replacer from `logger.ts:21` and watch cases 1–5 fail; drop it from
`paramsLine` and watch case 6 fail. Restore both.

**Measurement** (for the pull request, not a test): a throwaway script outside the worktree writes
200,000 lines of the boundary's shape through `createLogger` into a no-op sink, with and without the
replacer, three runs each; put the medians in the pull request.

## Task 2 — the probe as tests: real routes, the real file, the real page

**Files:** create `apps/server/src/recovery-page-personal-data.test.ts`. Base it on the probe
(`/Users/clintongormley/waitron-campaign-b/a980-s10-plan-probe/probe.test.ts`): the venue from
`planVenue` and `applyHistoricalTestVenue`, Marta and a clerk inserted through `persons`, cookies
from `startManagementSession`, `mountManagementApi` and `mountMeApi` with the logger built as
`boot.ts:944-949` builds it, and the page from `recoveryApp({ logDir })`.

**Tests first** (they fail until Task 1 lands, except 6 and 7; write them on a branch point before
Task 1's commit, or watch them fail with Task 1's replacer removed):

1. `POST /management-api/staff` with Marta's email: 409 and the body `toEqual`s
   `{ error: { code: "person.email_taken", params: { email: "marta.soler@example.test" } } }`; the
   page holds `person.email_taken` and `&quot;email&quot;:&quot;***&quot;` and not the address.
2. The same route with display name "Marta Soler": `person.display_name_taken`, likewise.
3. `PUT /management-api/staff/:id`, the clerk given Marta's email, then her name: both, likewise.
4. `PUT /management-api/session/me/profile`, the clerk taking Marta's name, then her email: both,
   likewise.
5. Through `createErrorBoundary` and the same logger: `draft.taken_over` in both shapes (with
   `ownerName`, and with `edit.editorName`) and `device.equipment_held` with `holderPersonName`: the
   answer's body still carries the names (the till reads `draft.taken_over`'s); the page does not.
6. The invitation of Jordi Puig with the real `createAccountEmailSender`, against a relay refusing at
   `RCPT` and, as a second case, at `DATA`, its reply echoing the address: the answer reports
   `invitationSent: false`; the page holds `account_email.send_failed` and neither
   `jordi.puig@example.test` nor `Jordi Puig`. Control in the same case: nodemailer sending to the
   same relay rejects with a message holding the address (probe case J).
7. The clerk's own email change to Jordi's address, verification refused at `RCPT`: the page holds
   `"error":"email.send_refused"` (escaped) and not the address.
8. The control for the page itself: the same state with `logDir` pointing at an empty folder shows
   none of the codes, so the assertions above read the log tail (as
   `recovery-surface.test.ts:137-143` does).

**Run:** `pnpm --filter @waitron/server exec vitest run src/recovery-page-personal-data.test.ts`.

**Omission control:** remove Task 1's replacer locally: cases 1–5 fail; 6–8 still pass, because they
pin today's behaviour, not the mask. Say so in the pull request. Restore.

## Task 3 — the root guard over the registries

**Files:** create `scripts/personal-log-params.test.ts`.

**What it does:** finds every `.ts` file under `packages/*/src` and `apps/*/src`, skipping
`node_modules`, `testing` folders and `*.test.ts`, whose text holds `interface ErrorParams`
(`packages/shared/src/errors.ts` included); blanks comments with `blankComments`
(`packages/shared/src/source-comments.ts`); splits the `ErrorParams` body at each `"code":`; and
collects each key written as `name:` or `name?:` in that code's text. A key ending `Id` or `Ids` is
skipped. A key matching
`/email|name|nombre|phone|tax|nif|emisor|recipient|destinatario|person|guest|owner|holder|editor|contact|address|label/i`
must be on `PERSONAL_LOG_KEYS` (imported from `../apps/server/src/log-personal-data.js`, as
`scripts/guide-links.test.ts:14` imports from that app) or be a `code.key` pair in the test's
`NOT_PERSONAL` map, whose value is a short reason ("the name of a station", "a Bluetooth address",
"the venue's own legal name, printed on every receipt"). The planner's scan
(`registry-keys.txt`, with a narrower word list) found 58 pairs; the implementer runs the guard,
reads each pair it lists, and fills the map.

**Tests first:**

1. The real registries pass.
2. A synthetic registry text holding `"guest.name_taken": { guestName: string }` is refused, naming
   the pair. This is the case that matters most: bookings would hold a guest's name.
3. A synthetic `"x.y": { personId: string }` is accepted (an id), and `"x.z": { email: string }` is
   accepted (on the list).
4. A `NOT_PERSONAL` pair whose code or key no longer exists fails.

**Header:** "Weaker than its name": it reads registry text, judges a key by a word list, never sees a
key inside a named type (`draft.taken_over`'s `edit` holds `BillEditState`, whose `editorName` was
found by hand), never sees a log call's own fields, and never reads free text.

**Run:** `pnpm exec vitest run scripts/personal-log-params.test.ts`.

**Proof by deletion:** remove `email` from `PERSONAL_LOG_KEYS` and watch case 1 fail naming
`person.email_taken.email`; remove a `NOT_PERSONAL` entry and watch it fail naming that pair.
Restore.

## Task 4 — words: the rule, the page's description, the design, the backlog

Each sentence below is a claim; check it against the code as built, not against this plan.

1. **Root `CLAUDE.md`, §3 "Data, modules and migrations"**, beside the error-code rules, one line:
   a detail or log field holding a person's name, email or tax number uses a name on
   `PERSONAL_LOG_KEYS` (`apps/server/src/log-personal-data.ts`), which the logger masks in every
   line; the answer keeps it. Guard: `scripts/personal-log-params.test.ts`, weaker than its name:
   reads registry text, judges keys by a word list, never sees a named type's keys or free text.
2. **Root `CLAUDE.md`, §3, the recovery page line** ("its log tail shows the failed start's own
   lines through `redactSecrets` and HTML-escaped"): the tail is the file's last lines, whichever
   start wrote them (`recovery-surface.ts:80-89`; the probe's lines from a running route reached the
   page), through `redactSecrets`, the personal-data mask, and HTML-escaped. Keep the owner-decision
   date and the secret sentence.
3. **`docs/developers/conventions-ui.md:1084-1145`**: the same correction, and a sentence that the
   tail's `AppError` details have the listed names masked, with the receipt (this plan's probe).
4. **`deploy/README.md:197-201`**: a person's name, email or supplier's tax number in an error's
   details shows as `***`, in the page and in `docker compose logs`.
5. **Code comments the change makes untrue**: `apps/server/src/errors.ts:16-19` (the registry
   header: add that a person's details use a listed name); `apps/server/src/recovery-surface.ts:242-246`
   ("What bounds them is not this page: `redactSecrets` … and the convention …": add the mask);
   `apps/server/src/boot.ts:937-942` ("The two halves are deliberately NOT filtered alike … The
   STDOUT half is left whole": true of `redactSecrets` only; say the personal-data mask applies to
   both). Change nothing else in those comments.
6. **The design**, a dated pointer rather than a rewrite: §2.3 rows d5 and d6, §4.8's "unverified
   (S10)" row, and the "Not verified" paragraph at the end: what the probe found and what S10 masks.
7. **The build plan**: a 2026-10-26 status sentence for S10, linking this plan; note that S10 does
   not touch `packages/identity/src/staff.ts`.
8. **The backlog**: delete the S10 bullet in `docs/backlog/data-protection.md` (`:207`); add a
   "Decisions and deliberate limits" entry for decisions 4–7 (what stays unmasked, with this plan's
   examples); in `docs/backlog/alerts.md`, under the O9 (a) point (`:64-67`), one line saying the
   log mask covers only listed detail names, so a bug report's masking must not rely on it for free
   text.

**Run:** `pnpm exec vitest run scripts/claude-md-pointers.test.ts` and `pnpm format:check`.

## Root guards to run before `/finish-branch`

`pnpm exec vitest run scripts/personal-log-params.test.ts scripts/claude-md-pointers.test.ts
scripts/errors-reachable.test.ts scripts/english-only.test.ts`, then let the pre-push hook run the
rest. CI runs `@waitron/server`'s suites and coverage; read its result on the current head.
