# A980 slice S10: no person's name or email in the log the recovery page shows

**Status: plan, 2026-10-26, rounds 1 and 3 of review folded. Nothing was built when this was
written.** Written by lane B with nobody watching; every choice below was made conservatively and is
listed under "Open decisions for the owner" so it can be reversed. The reviews, claim check and
rulings are in `/Users/clintongormley/waitron-campaign-b/a980-s10-plan-review/` (`round1-review.md`,
`round1-claims.md`, `round1-rulings.md`, `round3-review.md`, `round3-rulings.md`, and `round3/`,
with the scripts and outputs they cite); every ruling is folded below. Folding round 1 added two
tasks and split one: old Task 2 is now Tasks 3 and 4, old Task 3 is now Tasks 5 and 6, old Task 4
is now Task 7, and Task 2 is new. Folding round 3 split Task 6 into Task 6a (named types) and
Task 6b (log calls' fields), so the tasks are 1 to 5, 6a, 6b and 7.
Design:
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
deleted from the worktree before this plan was committed. The claim check re-ran both probe files
in a copy of the worktree (`Tests 16 passed (16)`, `round1-claims.md` → "Probe re-run").

**No migration.** Logs are files. **FULL review**: personal data on a page that needs no sign-in.
Per-task reviews run, then `/finish-branch`, which runs two Codex reviews, the second told to set
this plan aside and test what it does not name.

**What a screen reads.** The mask is applied only where a line is written to the log, so the HTTP
answer keeps every detail the till, the dashboard and the setup wizard read (decision 3), with one
renamed key no screen reads (decision 10). One screen does change: the dashboard's log view
(**Diagnostics**, `GET /management-api/diagnostics/recent`, `apps/server/src/diagnostics-api.ts:71-81`,
permission `diagnostics.view`, called from `apps/dashboard/src/api/client.ts:4208`) reads the log
files through `createLogReader` (`apps/server/src/boot.ts:937`), so it will show `***` where the
file does. The pull request says so.

## Words used here

- An **error code** is the dotted name a refusal carries (`person.email_taken`). Its **details**
  (`params` in the code) are the values that travel with it, such as `{ email }`. Each package
  declares its codes and their details in a **registry**, a file that adds to the shared
  `ErrorParams` list (`packages/identity/src/errors.ts`, `apps/server/src/errors.ts`, and so on).
- The **error boundary** is the shared wrapper every route runs in
  (`packages/server-kit/src/error-boundary.ts`). For a refusal it writes one `warn` line holding the
  code and every detail (`:45`), and answers the request with the same code and details (`:46`).
- The **log** is `waitron.log`, one JSON line per event, rotated at 10 MB and kept as **six files**:
  the current `waitron.log` and five rotated copies, `.1` to `.5` (`apps/server/src/config.ts:141-142`
  sets five rotated files; `apps/server/src/log-file.ts:42-53` removes `.5`, moves `.1`–`.4` up one and
  renames the current file to `.1`; the claim check counted six files after rotation in a copy of
  the worktree). The server's logger writes each line to the container's output (stdout, what
  `docker logs` shows) and to the file (`apps/server/src/boot.ts:929-949`). Of those two halves only
  the file is passed through `redactSecrets` (`apps/server/src/log-file.ts:56`), which masks a
  password inside a URL and nothing else (`apps/server/src/redact-secrets.ts:12-16`). The
  failed-start report is also passed through `redactSecrets` as a whole
  (`apps/server/src/node-entry.ts:203`), on stdout as well as in the file.
- The **recovery page** is what the box serves instead of the app when it cannot start
  (`recoveryApp`, `apps/server/src/recovery-surface.ts:581`; its `GET /` handler is `:584-591`). It
  needs no sign-in. It shows the **last 200 lines of the current `waitron.log`** (`MAX_LOG_LINES`,
  `:14`; `readLog`, `:80-89`), whichever start wrote them, HTML-escaped (`:540-543`), and the failed
  start's own report under "Why the last start failed". Both it and the server find the folder with
  `resolveLogDir` (`apps/server/src/node-entry.ts:649`, `apps/server/src/config.ts:532`), so a line the
  running server wrote is on the page after a later failed start, until 200 newer lines or a
  rotation push it out.
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
| F | Changing the clerk's own email to Jordi's, verification refused by the same relay at `RCPT` and at `DATA` (`me-api.ts:186-189` logs the thrown error's message) | **no leak** | `{"purpose":"email_change","error":"email.send_refused",…}`; the thrown error is `AccountEmailFailure` whose message is the code (`apps/server/src/account-email.ts:19-27`) |
| G | The invoice email sender (`createInvoiceEmailSender`) against the same relay, both refusals | **no leak**: it returns `{"status":"failed","failureCode":"transport_failed"}` and logs nothing itself | (none) |
| H | The text email sender used by box alerts and certificate reminders (`createTextEmailSender`, `boot.ts:2314`, `apps/server/src/certificate-reminder-email.ts:5`), both refusals | **no leak**: `onFailure` receives `"email.test_refused"` | (none) |
| J (control for E–H) | nodemailer called directly against the same relay | the relay's reply **does** carry the address | `Can't send mail - all recipients were rejected: 550 5.1.1 <jordi.puig@example.test>: Recipient address rejected: User unknown` and `Message failed: 550 5.7.1 <jordi.puig@example.test>: …` |
| I | The real error boundary throwing `draft.taken_over { ownerName: "Marta Soler" }` and `device.equipment_held { holderPersonName: "Jordi Puig" }` (thrown in a minimal app, not through the till's routes) | **leaks**, both | `{"draftId":"d1","ownerId":"p1","ownerName":"Marta Soler",…}`, `{…,"holderPersonName":"Jordi Puig",…}` |
| K (`probe2.test.ts`) | The boundary throwing `draft.taken_over`'s second shape, whose `edit` holds `editorName` | **leaks**, nested | `{…,"edit":{"billId":"b1","editorId":"p2","editorName":"Marta Soler",…},…}` |
| L (`run3-boot-failure.txt`) | `runEntry` with a start that fails on `AppError("person.email_taken", { email })`, a case added to `node-entry.test.ts` for one run and removed with `git checkout` | **leaks** into the failed-start report | `params: {"email":"marta.soler@example.test"}` |

**Not probed: the attendance email.** Attendance has its own sender, `createAttendanceEmailSender`
(`apps/server/src/attendance-email.ts:14`, wired at `boot.ts:1858`), not the text sender case H
drove. It calls the same `sendSmtpMessage` and hands only `outcome.reason` to `onFailure`
(`attendance-email.ts:30-47`), and boot logs its loop's failures as `codeOf(error)`
(`boot.ts:1859`), so I believe it does not leak; that is a reading, not a run. Boot builds it as
`createAttendanceEmailSender()` with no `onFailure` (`boot.ts:1858`), so in production the sender hands
a refusal's reason to nobody and returns only the status. Task 4 case 9 runs it as boot builds it.

Why E–H do not leak, read at the code after the run: `sendSmtpMessage` turns any failure into a
status and a code (`apps/server/src/smtp-send.ts:23-32`, `classifySmtpFailure`,
`apps/server/src/smtp-failure.ts:18-54`); the invoice sender does the same in its own handler
(`apps/server/src/invoice-email.ts:58-73`); the invitation route logs only the purpose and person id
and says why (`apps/server/src/management-api.ts:197-204`). Existing tests already pin the
outcome shapes exactly: `apps/server/src/smtp-send.test.ts:99`
(`toEqual({ status: "rejected", reason: "email.test_refused" })`) and the refused cases at
`apps/server/src/invoice-email.test.ts:304-314` (the `it.each` is `:304`, its `toEqual` `:314`).

**What else carries a person in its details** (the registries read as text with
`registry-keys.mjs` over the 31 files that declare `ErrorParams`, one of them a test fake, then each
named type opened by hand; round 1's claim check dumped all 356 keys, `all-keys.txt`, and found the
`merchants[].name` row this table first missed; round 1's review found the `table.label_taken` row):

| Code | Detail | Who it names | Thrown where | A screen reads it from the answer? |
| --- | --- | --- | --- | --- |
| `person.email_taken` | `email` | a staff member | `packages/identity/src/staff.ts:43`, `:64`, `:122`; `packages/identity/src/account-action.ts:234` | no: the dashboard maps the code to the field (`apps/dashboard/src/widgets/person-form.ts:29-35`, `apps/dashboard/src/screens/profile-screen.ts:728-731`) and uses the typed email, not the detail (`apps/dashboard/src/screens/staff-screen.ts:423-429`) |
| `person.display_name_taken` | `displayName` | a staff member | `staff.ts:58`, `:100`, `:446`, `:491` | no (same files) |
| `draft.taken_over` | `ownerName`; `edit.editorName` and `conflicts[].editorName` (`BillEditState`, `apps/server/src/order-drafts.ts:137-144`) | a staff member | `apps/server/src/bill-editing.ts:238`, which throws only the second shape (`edit`, `conflicts`); the first shape (`ownerName`) is declared but thrown nowhere outside tests (`git grep '"draft.taken_over"'`, round 1 review) | **yes**: the till names who took the bill over (`apps/till/src/state/draft-sync.ts:241-243`, `apps/till/src/till-app.ts:716-718`) |
| `device.equipment_held` | `holderPersonName` | a staff member | `apps/server/src/device-equipment.ts:406-411` | not today: `git grep holderPersonName` outside tests finds only the throw and the registry; the dashboard reads the same answer's `holderDeviceName` (`apps/dashboard/src/screens/devices-screen.ts:165-166`) |
| `table.label_taken`, the shape a till sends for a table's name for today | `label` (renamed `todayName` by decision 10) | a guest, when staff type a booking's surname as a table's or group's name for today | `apps/server/src/floor-today-name.ts:86`, reached only through the till (`mountFloorTodayApi` is mounted only at `apps/server/src/till-api.ts:1361`; `till-api.ts:561` maps the code to 409) | no: the till reads only the code and `field` (`apps/till/src/screens/till-floor-screen.ts:2042-2049`). The dashboard reads `label` (`apps/dashboard/src/screens/floor-plan-editor.ts:839-842`), but only from the floor-plan save's throws (`apps/server/src/floor-plan.ts:409`, `:434`), which keep `label` |
| `purchase.duplicate` | `supplierTaxId` | a supplier, who may be a sole trader | `packages/purchasing/src/operations.ts:224`, `:321` (registry `packages/purchasing/src/errors.ts:14`) | no: the message is fixed (`apps/dashboard/src/i18n/codes.ts:968-971`) and the form keeps its own typed value |
| `clock.behind_chain_restarted` | `person` | an administrator | recorded as an incident only, never thrown (`packages/fiscal-verifactu/src/errors.ts:378-389`) | no: the alert and its email use `confirmedBy` (`apps/dashboard/src/i18n/alert-messages.ts:148-151`, `apps/server/src/box-alert-email.ts:60-70`) |
| `restore.stream_venue_unconfirmed` | `legalName`, `taxId` | the venue itself (a sole trader's own name and tax number) | `apps/server/src/restore-request.ts:280`, `apps/server/src/restore-stream.ts:378`; logged by the setup routes' boundary (`apps/server/src/setup-api.ts:357`, `:364`) and by the first-backup setup routes' boundary, which also maps the code to 409 (`apps/server/src/setup-first-backup-api.ts:37`); both read, not run | **yes**: the setup wizard shows the venue to confirm (`apps/setup/src/setup-app.ts:1684-1685`); the restore command prints both on its own terminal so the installer can type the tax number back (`apps/server/src/restore-command.ts:410-413`) |
| `payment.provider_merchant_ambiguous` | `merchants[].name` | a SumUp merchant account, whose name may be a sole trader's own | `packages/payments-sumup/src/card-provider.ts:180-182` (registry `packages/payments-sumup/src/errors.ts:10`) | **yes**: the SumUp connect form lists them as a picker (`ambiguousMerchants`, `packages/payments-sumup/src/dashboard/client.ts:101-104`, read at `packages/payments-sumup/src/dashboard/sumup-connect-form.ts:209`) |
| `fiscal.reconcile_no_trace`, `fiscal.reconcile_drift_errores`, `fiscal.reconcile_drift_anulada`; nested in `fiscal.estado_desconocido` (`identidadEnviada`, a `FacturaParams`, and `lineaRespuesta`, a `LineaParams`, which extends `FacturaParams`) and `fiscal.respuesta_descuadrada` (`lineasRespuesta[]`, `LineaParams`) (`packages/fiscal-verifactu/src/errors.ts:159-171`, `:182-186`) | `idEmisorFactura` (`FacturaParams`, `packages/fiscal-verifactu/src/errors.ts:8-12`) | the venue's own tax number | raised as incidents (`packages/fiscal-verifactu/src/reconcile.ts:176`, `:200`; the two nested codes at `packages/fiscal-verifactu/src/drain.ts:1405` and `:1571`, through `raiseIncident`, `:1616-1632`, which calls `recordIncident` and logs nothing), whose recording logs codes only (`packages/core/src/incidents.ts:41-49`) | no: never an answer |

Other logging was read for the same thing and carries no person: `String(error)` of payment and
alert failures (`boot.ts:488-590`, `apps/server/src/dish-not-sent-alert.ts:46-51`), which wrap
database refusals and provider errors (Stripe and SumUp error text was not probed); incident
recording, which logs only codes (`packages/core/src/incidents.ts:41-49`); and the free-text names
of things (zones, stations, products, devices, saved table labels), which are not a person's
details by meaning (decision 4). Round 1's review extracted every structured log call
(`logcalls.pl`, `logcalls.tsv`) and found no other person-named field.

## What this slice builds, and what it leaves

1. **A list of detail names that hold a person's name, email or tax number**, plus one path rule
   (`merchants[].name`), and a mask that writes `***` for their values in every log line, at any
   depth, on both halves of the logger (stdout and the file). The failed-start report masks the same
   names.
2. **Two call sites stop handing a person's details to the log**: a till's name for today travels
   under a masked key, and the profile route logs the email sender's code, not its message.
3. **The probe as tests**: each leaking path above, driven through the real route or the real error
   boundary into the real file, the captured stdout and the real recovery page, now showing `***`;
   and the email-server paths, the attendance sender included, pinned as not leaking, with the
   relay's own reply as the control.
4. **A root guard** that fails when a registry or a log call gains a detail whose name looks like a
   person's and that is neither on the list nor named as harmless, or when a registry uses a named
   type nobody has reviewed.
5. **Words**: one rule in the root `CLAUDE.md`, the recovery page's topic file and the deploy README,
   the code comments the change makes untrue, the design's open rows (with a dated correction to d5's
   file count), the build plan's status, and the backlog.

Left on purpose, each an open decision below: free-text names of things other than a table's name
for today (decision 4), email-shaped text inside a message (decision 7), the frozen-process
watchdog's own line (decision 12), and the page showing lines from the last running server (owner
note 5).

## Decisions this plan makes that the design does not

1. **Mask at the logger, by detail name, at any depth.** One file,
   `apps/server/src/log-personal-data.ts`, exports `PERSONAL_LOG_KEYS`, `PERSONAL_LOG_PATHS` and a
   `JSON.stringify` replacer `maskPersonalData`. `createLogger` passes it where it builds the line
   (`apps/server/src/logger.ts:21`), and `paramsLine` passes it for the failed-start report
   (`apps/server/src/node-entry.ts:172-178`). Why here and not in the error boundary:
   - `createLogger` is the only logger factory the server's processes use (`git grep` for
     `createLogger(` and for other `Logger` implementations outside tests, 2026-10-26: `boot.ts`,
     `node-entry.ts`, `first-setup-launch.ts`, `restore-command.ts`, `rejoin-command.ts`,
     `run-server.ts`; the only other `Logger` values are do-nothing defaults:
     `apps/server/src/first-setup-entry.ts:54`, `:84`, `:156`, `apps/server/src/mirror-bundle-api.ts:65`
     and `apps/server/src/promote-api.ts:74`). So the mask covers every `Logger` call: the error
     boundary, the Stripe webhook's own params line (`apps/server/src/webhook.ts:131`), boot's
     stdout-only logger (`boot.ts:931`) and any later log call, the way `redactSecrets` covers the
     file "without knowing the page exists" (`log-file.ts:20-23`). One writer appends to
     `waitron.log` without a `Logger`: decision 12.
   - A replacer reaches nested values, which case K needs (`edit.editorName`), without each caller
     knowing the shape.
   - `packages/server-kit` and every throwing package stay unchanged, so S4's edits to
     `packages/identity/src/staff.ts` cannot conflict (the build plan's order note expected S10 might
     edit that file; it does not).
2. **The list**: `email`, `displayName`, `ownerName`, `editorName`, `holderPersonName`, `person`,
   `supplierTaxId`, `legalName`, `taxId`, `idEmisorFactura` and `todayName`. A value under one of
   these names is written as `"***"` whatever its type; `null` and an absent value stay as they are,
   so "no person" still reads differently from "a person". `person` is on the list although its one
   code is never logged today, because its meaning is a person's name and the list costs nothing for
   it. **The path rule**: under a key `merchants` whose value is an array, each element's `name` is
   masked the same way, and nothing else in it (`code` stays); a bare `name` elsewhere is a thing's
   name and stays (decision 4). The list is flat across every code, which is why a person's detail
   must be named for whose it is (decision 13).
3. **The answer keeps every detail.** Removing the details from the codes was considered. Of the
   person-naming details in the table, seven are read by no screen (`email`, `displayName`,
   `holderPersonName`, `todayName`, `supplierTaxId`, `person` and `idEmisorFactura`), but that is true only of the
   detail that names a person: `device.equipment_held`'s answer is read by a screen
   (`holderDeviceName`, `devices-screen.ts:165-166`), and `clock.behind_chain_restarted` is never an
   answer at all. It is rejected because `draft.taken_over`'s names, the setup wizard's venue and the
   SumUp form's merchants are read from the answer, so removal could not be the one rule, and it
   would change a response shape for no gain: the answer goes to the signed-in person who typed the
   value or owns the account. The tests assert the answer is unchanged. The one renamed key is
   decision 10.
4. **Names of things are not masked**, even though staff may type a person's name into them: saved
   table labels and short names, order labels (`route.dish_not_sent`'s and
   `route.released_at_closed_station`'s `orderLabel`, both incident-only:
   `apps/server/src/dish-not-sent-alert.ts:78`, `apps/server/src/closed-station-alert.ts:45`), zone,
   station, course, product, reason and location names (`restore.stream_venue_unconfirmed`'s
   `locationName`), and device names (`device.equipment_held`'s `holderDeviceName`). The design says
   a device label is "personal only if it names someone" (§2.3 row d1); its "equipment, not people"
   is row d2's wording, about printer addresses. The line drawn is the detail's meaning: a person's
   name, email or tax number is masked; the name of a thing is not. The one exception is a table's
   name for today (decision 10), because its normal use is a booking's surname.
5. **The venue's own legal name and tax number are masked** (`restore.stream_venue_unconfirmed`'s
   `legalName` and `taxId`, AEAT's `idEmisorFactura`, and a SumUp account's `merchants[].name`). For a
   sole trader they are a person's name and DNI-based tax number, and a receipt handed to a customer
   is not a page open to anyone on the venue's network. Diagnosis loses nothing: the setup wizard reads
   the venue from the answer (decision 3), the restore command prints it on its own terminal
   (`restore-command.ts:410-413`, a terminal line, not a log line), and the code alone says what is
   waiting. The alternative, showing them, is owner note 2.
6. **Stdout is masked too.** The mask sits before the tee, so `docker logs` shows `***` as the file
   does. `redactSecrets` stays file-only (`boot.ts:938-942` explains why for passwords: masked, a
   wrong password and none look alike); no such need exists for a person's email, which the request's
   own answer carried to the person who typed it, and the design counts the container's output as
   personal data kept on the box (§2.3 row d6).
7. **No mask by pattern inside free text.** A mask of anything shaped like an email address in every
   line would cover a future call site that logged a relay's reply, but it would also hide the user
   half of a URL that `redactSecrets` deliberately leaves visible (`redact-secrets.ts:28`). Not built;
   offered below. The one known call site that logged an email sender's message is changed instead
   (decision 11).
8. **Lines already written are not rewritten.** A box's existing `waitron.log` keeps old lines until
   rotation. No venue is live, and until one is, the root `CLAUDE.md` §3 rules out data-migration
   code.
9. **The guard judges detail names in registry text and in log calls' literal fields, and refuses
   unreviewed named types** (Tasks 5, 6a and 6b). A key ending in `Id` or `Ids` (matched with its
   capital) is skipped as an id, **unless the rest of the key names a tax number** (matches
   `/tax|nif|nie|dni|cif|vat/i`), so `customerTaxId` is judged. Every other key matching a widened
   person-shaped word list (Task 5) must be on `PERSONAL_LOG_KEYS`, be a child written inside the
   braces of a listed path's parent member, or be in the guard's harmless map with a one-line reason;
   an entry in a harmless map that no longer exists fails too. Every capitalised type name inside a
   registry must be in a `REVIEWED_TYPES` map with a one-line verdict. What it still cannot see is
   said in its header and at the `CLAUDE.md` rule: a key added later inside a type already reviewed,
   a field whose name says nothing about a person (`{ to: email }`), a throw site that spreads an
   object and so can carry keys its registry type does not name (`{ ...prepared.venue }`,
   `restore-request.ts:280`, `restore-stream.ts:378`), a spread or a variable passed as a log call's
   fields, free text, and the watchdog's own line (decision 12).
10. **A till's name for today travels as `todayName`, which the mask lists.**
    `floor-today-name.ts:86` throws `table.label_taken { label: name, field: "name" }` with the name a
    till typed, which is normally a booking's surname, and the till's routes log every detail
    through the shared boundary. Every consumer of that throw's `label` was followed (table above):
    the till reads only `code` and `field`, the dashboard never reaches this route, and only tests
    read the key (`apps/server/src/floor-today-name.test.ts:276-391`,
    `apps/server/src/floor-today-api.test.ts:961`, and test fakes in
    `apps/till/src/screens/till-floor-screen.rename.test.ts`). So, as round 1's ruling directs when
    nothing else reads it, the key is renamed rather than `label` being masked on that code; every
    other `label` stays visible (decision 4). `todayName` is already the till's own name for the
    field (`apps/till/src/widgets/today-name-dialog.ts:177`). The registry type becomes two shapes,
    `{ label: string; takenBy?: string; field?: never } | { todayName: string; field: "name" }`
    (`apps/server/src/errors.ts:384-391`). The `field?: never` is what refuses the old leaking shape
    `{ label: name, field: "name" }`: without it the union accepts that shape (round 3 review, run 1,
    `tsc` 7.0.2 with `--strict`). This changes one answer's key; no venue is live, and the root
    `CLAUDE.md` §3 allows renames until one is.
11. **The profile route logs the email sender's code, not its message.** `me-api.ts:186-189` logs
    `error.message`; it becomes
    `errorCode: error instanceof AccountEmailFailure ? error.problem : codeOf(error)`, as the
    invitation route already refuses to log the mailer's error (`management-api.ts:197-204`).
    `errorCode` is the key 49 sibling lines in `apps/server/src` use for `codeOf(…)`
    (`git grep -c -E 'errorCode: codeOf\('`, 2026-10-26). `codeOf` answers `"unknown"` for anything
    that is not an `AppError` (`packages/server-kit/src/error-code.ts:7-9`). Still `apps/server`, so
    no package changes.
12. **The frozen-process watchdog's line is not covered by the mask, and writes no person's details
    today.** `packages/store/src/venue-liveness.ts:174-179` appends `venue.holder_frozen` to
    `waitron.log` without a `Logger`. Its fields are `code` (`VENUE_HOLDER_FROZEN_CODE`, `:243`),
    `kind`, `pid`, `lockedAt`, `lastTickAt` and `stack` (`:166-173`), and the stack is a list of
    function name, file base name, line and column (`:150-155`), never a value. That is a reading,
    not a run. It is listed as a known limit in the guard's header and in the recovery page's topic
    file. `console.warn` diagnostics (for example `optional-document.ts:12`,
    `invoice-document.ts:98`, round 1 claim check) also skip the logger, but reach only the
    container's output, not the file, and carry ids and codes.
13. **A person's detail is named for whose it is** (`guestName`, `customerTaxId`), never a bare
    `name` or `taxId`, because the list is flat across every code and a bare `name` cannot be masked
    without masking every thing's name. The rule goes in the root `CLAUDE.md` line Task 7 adds. The
    existing bare `taxId` is the venue's own and is on the list (decision 5).

## Open decisions for the owner (FYI, built with the default)

1. **Free-text names of things stay visible, except a table's name for today** (decisions 4 and
   10). Example, a table named García for tonight: the García party has booked, so a waiter names
   table 4 "García" for tonight; later another waiter tries to name table 7 "García" too, and the
   till says "Another table already has that name". Before this slice the log line read
   `{"label":"García","field":"name",…,"event":"table.label_taken"}` and was on the recovery page;
   now it reads `{"todayName":"***","field":"name",…}`. But a manager who names a permanent table
   "García" in the floor plan and collides still logs `{"label":"García",…}`, and the same goes for
   a device named "Marta's phone", a location named after its owner, or a takeaway order labelled
   "Marta" (that one is an incident, not logged today). Alternative: mask `label`, `orderLabel`,
   `holderDeviceName`, `locationName`, `name` and similar everywhere, losing which table, device or
   station a refusal was about.
2. **The venue's own name and tax number are masked** (decision 5). Example: Jordi Puig Ferrer, a
   sole trader with NIF 12345678Z, restores from a bucket; the box refuses until he confirms the
   venue. The log line now reads
   `{"legalName":"***","taxId":"***","locationName":"Bar del Port",…,"event":"restore.stream_venue_unconfirmed"}`,
   while the setup wizard still shows "Jordi Puig Ferrer, 12345678Z" to confirm and the restore
   command still prints "if Jordi Puig Ferrer (tax id 12345678Z) is your business, re-run with
   --confirm-venue 12345678Z" on its terminal. Likewise a SumUp key covering two accounts logs
   `{"merchants":[{"code":"MC1","name":"***"},{"code":"MC2","name":"***"}],…}` while the connect form
   still lists both names. Alternative: show them, as the venue's receipts do, by taking `legalName`,
   `taxId`, `idEmisorFactura` and the `merchants` path off the list.
3. **`docker logs` is masked as well as the file** (decision 6). Example: an invitation refused
   `person.email_taken` shows `{"email":"***","event":"person.email_taken"}` in both; an installer
   who needs to know which address finds it in the dashboard's Users list. Alternative: mask the file
   only, as `redactSecrets` does.
4. **No email-shaped mask in free text** (decision 7). After decision 11 no known call site logs an
   email sender's message. Example of what would still get through: a later change that logged a
   caught nodemailer error as `{ error: String(error) }` would write
   `"error":"Error: Message failed: 550 5.7.1 <jordi.puig@example.test>: …"` unmasked, in the file
   and on the page. Alternative: a second mask in the file sink for anything shaped like an address,
   at the cost of hiding the user name in URLs that `redactSecrets` leaves visible.
5. **The page's log tail also shows lines from the last running server**, not only the failed
   start's. Example: on Monday night the running server logs a refusal; on Tuesday a start fails; the
   page shows Monday's line among the last 200, after this slice's mask. The default is unchanged,
   because those lines are what explain a stop the running server saw, such as an append-only
   refusal from the trading watch (round 1 review). Alternative: start the tail at the latest
   `server.boot_started` (written at `apps/server/src/node-entry.ts:505`), which removes every running
   server's line from the page, free text included, and loses that explanation.

## Global constraints

- **English only.** Spanish only where the recovery page's existing Spanish strings live; this slice
  adds none. People in fixtures are Marta Soler and Jordi Puig (the venue, Jordi Puig Ferrer, NIF
  12345678Z, location "Bar del Port"); emails end `@example.test`. A table's name for today in a
  fixture is "Soler".
- **The answer is unchanged**, except `table.label_taken`'s today's-name shape, whose `label` is now
  `todayName` (decision 10). Every refusal test asserts the exact body with `toEqual`, details
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
- The till's tests run real headless Chromium: check `memory_pressure | grep free` first, and run
  beside another session only well above 15% free.

## Review focus

- **The list and the path rule** (decision 2) against the table of codes: is any person-carrying
  detail missing, and is anything on it that a diagnosis needs?
- **The answer unchanged** (decision 3): the till's taken-over name, the setup wizard's venue and the
  SumUp form's merchants still arrive, and every other detail is still in the answer; the one
  renamed key (decision 10) is read by nothing but tests.
- **Depth**: case K's nested `editorName` masked; an array of objects masked; the `merchants` path.
- **Both channels**: stdout and file masked (decision 6); the failed-start report masked (case L).
- **The controls**: every "absent" assertion paired with a "present" one.
- **The guard's limits** (decision 9), stated in its header and at the `CLAUDE.md` rule.
- **Cost on the sale path**: `createLogger` now runs a replacer on every line; Task 1's measurement
  through the real file sink and the replacer's own share, against the 5% bar both must exceed to
  miss it.
- **Codex run-it seat**: two reviews, the second told to set this plan aside.

## Task 1 — the mask in the logger and the failed-start report

**Files:** create `apps/server/src/log-personal-data.ts`; modify `apps/server/src/logger.ts:21` and
`apps/server/src/node-entry.ts:172-178`; tests in `apps/server/src/logger.test.ts` (a new
`describe("createLogger personal data")`) and `apps/server/src/node-entry.test.ts` (a case beside
"carries an AppError's params to the installer, scrubbed like everything else", `:741`).

**Tests first** (watch each fail before writing the code):

1. For each key on the list, `log("warn", "x", { [key]: "Marta Soler" })` writes a line whose parsed
   object `toEqual`s `{ [key]: "***", at, level: "warn", event: "x" }`, and whose raw text does not
   contain `Marta Soler`.
2. Nested and in arrays: `{ edit: { editorName: "Marta Soler", editorVersion: 3 }, conflicts: [{
   editorName: "Jordi Puig" }] }` writes `editorName: "***"` in both places and keeps
   `editorVersion: 3`.
3. Kept as they are, in one exact `toEqual`: `ownerName: null`; and the neighbours a reader might
   expect masked but decisions 4 and 10 keep: `name`, `label`, `holderDeviceName`, `locationName`,
   `personId`, `ownerId`.
4. A non-string value under a listed key is masked (`{ person: { id: "p1" } }` writes
   `person: "***"`).
5. `at`, `level` and `event` are never masked, including an event named `email`.
6. The path rule: `{ merchants: [{ code: "MC1", name: "Jordi Puig Ferrer" }, { code: "MC2", name:
   null }] }` writes `[{ code: "MC1", name: "***" }, { code: "MC2", name: null }]`; in the same line
   a top-level `name: "Patio"` is kept, and a `merchants` value that is not an array is kept as it
   is. A second line, `{ merchants: [{ code: "MC1", name: "Jordi Puig Ferrer", email:
   "jordi.puig@example.test" }] }`, writes `[{ code: "MC1", name: "***", email: "***" }]`: the key
   list still applies inside the copied elements.
7. `node-entry.test.ts`: a start that fails with `new AppError("person.email_taken", { email:
   "marta.soler@example.test" })` reports `params: {"email":"***"}` and not the address. The existing
   `migrations.incomplete` case at `:741` passes unedited (diagnostic details still shown).

**Code:** the file holds the list as a `ReadonlySet<string>`, the path rule as
`PERSONAL_LOG_PATHS: ReadonlyMap<string, ReadonlySet<string>>` (`merchants` → `name`), and
`maskPersonalData(key: string, value: unknown): unknown`, returning `"***"` when the key is on the
list and the value is neither `null` nor `undefined`; for a key in `PERSONAL_LOG_PATHS` whose value
is an array, a copy whose object elements have each listed child's non-null value replaced by
`"***"`; else the value. `JSON.stringify` walks into the copy the replacer returns, so the key list
is still applied to every key inside the copied elements; build the copy so that stays true (a
shallow copy of each element, not one serialised or parsed on the side). No comment beyond one line
naming what the list is for and pointing at the guard.

**Run:** `pnpm --filter @waitron/server exec vitest run src/logger.test.ts src/node-entry.test.ts
src/log-file.test.ts src/recovery-surface.test.ts` (read the `Tests` count). Then check that no
existing test reads a masked key back from a real logger's output. A test that captures log calls
with a fake `Logger` sees the fields before the mask and is unaffected; five test files call
`createLogger(` (`awaiting-fiscal-cert`, `logger`, `pass.db`, `recovery-surface`, `request-id`:
`git grep -l 'createLogger(' -- '*.test.ts'`, 2026-10-26), and many more start a real server and read
its file or stdout. List the files that do either and search them:

```bash
git grep -l -E 'createLogger\(|waitron\.log|logDir|stdout' -- 'apps/server/src/*.test.ts' \
  | xargs git grep -n -P '\b(email|displayName|ownerName|editorName|holderPersonName|person|supplierTaxId|legalName|taxId|idEmisorFactura|todayName|merchants)\b"?\s*:' --
```

Open every hit that reads a line back. `-P` is needed: with `git grep -E` the same `\b…\s` pattern
matched nothing (0 hits against `-P`'s 904 over every `apps/server/src/*.test.ts`, 2026-10-26). On
2026-10-26 the list held 58 files and the search 68 hits. Receipt for the expected result: round 1's
review searched the test files that read `waitron.log`, `logDir` or stdout for the first seven keys
and found no masked key read back (the only hit, `boot.setup-routes.test.ts:344`, is a request body).
For the four keys added since, the planner searched only for keys written as JSON text in a test
(`\\?"key\\?"\s*:`) and found no log-line assertion; that is not the full check, opening the hits is.

**Omission controls:** drop the replacer from `logger.ts:21` and watch cases 1–6 fail; drop it from
`paramsLine` and watch case 7 fail; drop the path rule and watch case 6 fail. Restore all three.

**Measurement** (for the pull request, not a test). The bar, set before running: **the mask may add
no more than 5% to the cost of writing one line through the real file sink.** A throwaway Vitest
file in `apps/server/src`, deleted before the commit (its copy and output saved to
`/Users/clintongormley/waitron-campaign-b/a980-s10-measure/`), writes 20,000 lines of the
boundary's shape (`{ workingOrderId, requestId, productIds, errorCode }`, as round 1's `bench.mjs`)
through `createLogger` over `createRotatingFileSink` into a temporary folder with the default
10 MB × 5 settings, with and without the replacer, in **at least 7 interleaved rounds** (alternating
which variant goes first in each round), compared by **median**. Measure a second number too: the
replacer's own cost, `JSON.stringify` of the same line with the replacer minus without, per line, as
a share of the real sink's per-line time; this one does not drown in disk noise. Put both sets of
numbers in the pull request. **The bar is missed only if both measures exceed 5%.** Expectation:
round 3's review ran a prototype of the mask through the real sink this way, 7 interleaved rounds,
on a Mac (a Mac measurement, not CI's), and got a median of 32.90 µs per line with the
mask against 33.21 µs without, about −1%, while one variant's own runs spread about 8%
(`/Users/clintongormley/waitron-campaign-b/a980-s10-plan-review/round3/bench-output.txt`). Round 1's
review measured about +0.4 µs on roughly 34 µs per line with a plain `appendFileSync`, not the real
sink. **If the bar is missed**, build the fallback in this task: write the line with plain
`JSON.stringify` first, and re-write it with the replacer only when a regular expression finds a
listed key or path parent followed by `":` (round 1 measured about 0.61 µs against 0.85 µs for the
replacer on every line); add a case that a line with no listed key is byte-identical to plain
`JSON.stringify`, re-run cases 1–7 unchanged, and measure again the same way. **If the fallback still
misses, keep the fallback**, put both runs' numbers in the pull request, and carry on with Task 2:
do not iterate further.

## Task 2 — two call sites stop handing a person's details to the log

**Files:** modify `apps/server/src/floor-today-name.ts:86`, `apps/server/src/errors.ts:384-391` and
`apps/server/src/me-api.ts:186-189`; tests in `apps/server/src/floor-today-name.test.ts`,
`apps/server/src/floor-today-api.test.ts` and `apps/server/src/me-api.test.ts`; test fakes in
`apps/till/src/screens/till-floor-screen.rename.test.ts`.

**Tests first** (watch each fail before writing the code):

1. Every `table.label_taken` expectation in `floor-today-name.test.ts` (`:276-391`) and
   `floor-today-api.test.ts:961` expects `params: { todayName: …, field: "name" }` in place of
   `{ label: …, field: "name" }`. This rewrites assertions on purpose: the answer's key is the
   behaviour being changed (decision 10), and the values asserted stay the same.
2. `me-api.test.ts`'s `it.each` at `:1253-1290` ("saves the profile but reports no verification
   email sent when sending throws %s") expects `{ purpose: "email_change", errorCode: "unknown" }`
   for an `Error("mail relay down")` and for a bare string, in place of the message; add rows for
   `new AccountEmailFailure("email.send_refused", "email.test_refused", false)` expecting
   `errorCode: "email.send_refused"`, and for an `AppError` expecting its code. Again the change is
   the behaviour being changed (decision 11, round 1 ruling M4); say so in the commit.
3. A compile-time case in `apps/server/src/errors.test.ts`, beside "constructs table.label_taken
   with the name and the table showing it as its short name" (`:32`): `new AppError(
   "table.label_taken", { todayName: "Soler", field: "name" })` and `{ label: "T1", takenBy:
   "Terrace 1" }` both construct, and `// @ts-expect-error the old shape that logged a guest's
   name` above `new AppError("table.label_taken", { label: "Soler", field: "name" })`. The directive
   is the assertion: the typecheck (`pnpm --filter @waitron/server typecheck`) reports an unused
   `@ts-expect-error` when the type accepts the old shape again, as the `order-groups.test.ts:3424`
   case says of its own; Vitest does not typecheck. Watch it fail by declaring the type without
   `field?: never` first.

**Code:** `floor-today-name.ts:86` throws `{ todayName: name, field: "name" }`. The registry type at
`errors.ts:391` becomes
`{ label: string; takenBy?: string; field?: never } | { todayName: string; field: "name" }`,
and its comment (`:384-390`) says which shape a floor-plan save sends and which a till's name for
today sends. `floor-plan.ts:409` and `:434` are unchanged, and so is the dashboard's reader
(`floor-plan-editor.ts:839-842`). `me-api.ts:186-189` logs
`{ purpose: issued.purpose, errorCode: error instanceof AccountEmailFailure ? error.problem :
codeOf(error) }`, importing `AccountEmailFailure` from `./account-email.js` and `codeOf` from
`@waitron/server-kit`. In `till-floor-screen.rename.test.ts`, the fakes that refuse `nameToday` with
`label: "Window"` (`:287`, `:529`, `:660`, `:723`, `:767`, `:785`) send `todayName: "Window"`, so
they match the server; they assert only `code` and `field`, which do not change.

**Run:** `pnpm --filter @waitron/server exec vitest run src/floor-today-name.test.ts
src/floor-today-api.test.ts src/errors.test.ts src/floor-plan.test.ts src/me-api.test.ts`, then
(after the memory check) `pnpm --filter @waitron/till exec vitest run
src/screens/till-floor-screen.rename.test.ts`; read each `Tests` count. Then
`pnpm --filter @waitron/server typecheck` for test 3. Then
`git grep -n -E 'label_taken' -- apps packages` and confirm every remaining `label` for this code is
the floor-plan save's.

**Omission controls:** put `label: name` back at `floor-today-name.ts:86` and watch test 1's cases
fail; put `error.message` back in `me-api.ts` and watch test 2's rows fail; drop `field?: never` from
the type and watch the typecheck report test 3's unused `@ts-expect-error`. Restore all three.

## Task 3 — the probe as tests: real routes, the real file, stdout, the real page

**Files:** create `apps/server/src/recovery-page-personal-data.test.ts`. Base it on the probe
(`/Users/clintongormley/waitron-campaign-b/a980-s10-plan-probe/probe.test.ts`): the venue from
`planVenue` and `applyHistoricalTestVenue`, Marta and a clerk inserted through `persons`, cookies
from `startManagementSession`, `mountManagementApi` and `mountMeApi` with the logger built as
`boot.ts:944-949` builds it, except that the stdout half is a captured array of lines in place of
`process.stdout.write` (`createLogger(tee(captured, createRotatingFileSink(...)))`), and the page
from `recoveryApp({ logDir })`.

**Tests first** (they fail until Task 1 lands, except 6; write them on a branch point before
Task 1's commit, or watch them fail with Task 1's replacer removed):

1. `POST /management-api/staff` with Marta's email: 409 and the body `toEqual`s
   `{ error: { code: "person.email_taken", params: { email: "marta.soler@example.test" } } }`; the
   page holds `person.email_taken` and `&quot;email&quot;:&quot;***&quot;` and not the address; the
   captured stdout line and the file's line each parse to an object with `email: "***"` and neither
   holds the address.
2. The same route with display name "Marta Soler": `person.display_name_taken`, likewise (page and
   file).
3. `PUT /management-api/staff/:id`, the clerk given Marta's email, then her name: both, likewise.
4. `PUT /management-api/session/me/profile`, the clerk taking Marta's name, then her email: both,
   likewise.
5. Through `createErrorBoundary` and the same logger, each answer's body still carrying the names
   and the page not: `draft.taken_over` in both shapes (with `ownerName`, which nothing outside tests
   throws today, and with `edit.editorName`, which `bill-editing.ts:238` throws);
   `device.equipment_held` with `holderPersonName`; `table.label_taken { todayName: "Soler", field:
   "name" }`; `restore.stream_venue_unconfirmed { legalName: "Jordi Puig Ferrer", taxId:
   "12345678Z", locationName: "Bar del Port" }`; and `payment.provider_merchant_ambiguous` with
   `merchants: [{ code: "MC1", name: "Jordi Puig Ferrer" }, { code: "MC2", name: "Marta Soler" }]`.
   In the other direction, on the same page: `Bar del Port`, `MC1` and, from a floor-plan
   `table.label_taken { label: "Patio 1" }` thrown the same way, `Patio 1` are shown, so names of
   things stay visible (decision 4).
5b. The live leak end to end: the real today-name route, `POST /api/tables/:id/today/name`, through
   `mountTillApi` (its third argument the same logger), set up as `floor-today-api.test.ts:76-112`
   sets it up: a venue from `setupPartyVenue`, then a till session from `seedSessionDevice`, a staff
   person and `loginWithPin`, sent as the `SESSION_COOKIE` cookie. Two tables from `plannedZone`;
   name the first "Soler" for today, then the second, one after the other, each body through
   `withRevision` (the requests `floor-today-api.test.ts:955-956` send at once): the second answers
   409 and its body `toEqual`s `{ error: { code: "table.label_taken", params: { todayName:
   "Soler", field: "name" } } }`, and the page, the file's line and the captured stdout line hold
   `table.label_taken` and `***` and not `Soler`. Its venue setup differs from cases 1–5's, so if it
   cannot share their database it goes in a second file,
   `apps/server/src/recovery-page-today-name.test.ts`, with its own `useVenueDb`.
6. The control for the page itself: the same state with `logDir` pointing at an empty folder shows
   none of the codes, so the assertions above read the log tail (as
   `recovery-surface.test.ts:139-144` does).

**Run:** `pnpm --filter @waitron/server exec vitest run src/recovery-page-personal-data.test.ts`
(and the second file, if 5b needed one).

**Omission control:** remove Task 1's replacer locally: cases 1–5 and 5b fail (page, file and
stdout); 6 still passes. Restore.

## Task 4 — the probe as tests: the email servers

**Files:** add to `apps/server/src/recovery-page-personal-data.test.ts` (after Task 3), with the
probe's refusing relay.

**Tests** (they pin today's behaviour, so they pass before and after the mask; their controls are
the relay's own reply and the page's code):

7. The invitation of Jordi Puig with the real `createAccountEmailSender`, against a relay refusing at
   `RCPT` and, as a second case, at `DATA`, its reply echoing the address: the answer reports
   `invitationSent: false`; the page holds `account_email.send_failed` and neither
   `jordi.puig@example.test` nor `Jordi Puig`. Control in the same case: nodemailer sending to the
   same relay rejects with a message holding the address (probe case J).
8. The clerk's own email change to Jordi's address, verification refused at `RCPT`: the page holds
   `&quot;errorCode&quot;:&quot;email.send_refused&quot;` (Task 2's key) and not the address.
9. The attendance sender built as `boot.ts:1858` builds it, `createAttendanceEmailSender()` with no
   `onFailure`, against the same relay refusing at `RCPT` and at `DATA`: it returns `"rejected"`, and
   the return holds no address. A second variant passes `onFailure`, which production does not:
   its arguments `toEqual` `["email.test_refused"]` (what case H saw for the text sender, which calls
   the same `sendSmtpMessage`) and hold no address. The sender logs nothing itself
   (`attendance-email.ts:14-50`), and boot logs only `codeOf(error)` of what the worker throws
   (`boot.ts:1859`). If the sender answers differently, the test records what it does and the pull
   request corrects this plan's "Not probed" paragraph.

**Run:** `pnpm --filter @waitron/server exec vitest run src/recovery-page-personal-data.test.ts`.

**Omission control:** remove Task 1's replacer locally: 7–9 still pass, because they pin today's
behaviour, not the mask; say so in the pull request. Make the relay stop echoing the address and
watch 7's and 9's controls fail. Restore.

## Task 5 — the root guard over the registries

**Files:** create `scripts/personal-log-params.test.ts`.

**What it does:** finds every `.ts` file under `packages/*/src` and `apps/*/src`, skipping
`node_modules`, `testing` folders and `*.test.ts`, whose text holds `interface ErrorParams`
(`packages/shared/src/errors.ts` included); blanks comments with `blankComments`
(`packages/shared/src/source-comments.ts:254`); takes each `ErrorParams` body, which **ends at the
interface's matching closing brace**, not at the end of the file; splits that body at each
`"code":`; and collects each key written as `name:` or `name?:` in that code's text, nested ones
included. (Round 1's `all-keys.mjs` ran each last code's text to the end of the file, which is why
`all-keys.txt` gives `tab.already_open` keys such as `guestCount` and `openedBy`: they come from
function bodies after the interface in `packages/bookings/src/testing/fake-core.ts`, whose entry is
`{ tableId: string }` at `:27`. A guard that split the same way would wrongly refuse keys outside
`ErrorParams` in any registry file with code after the interface.)

- **Ids.** A key ending `Id` or `Ids` (with that capital) is skipped, unless the key without that
  ending matches `/tax|nif|nie|dni|cif|vat/i`; then it is judged like any other. Of the 81 such keys
  in the registries on 2026-10-26, only `supplierTaxId` and `taxId` have such a stem, and both are on
  the list (planner's run over round 1's `all-keys.txt`).
- **The word list.** A key matching
  `/email|mail|name|nombre|surname|apellido|phone|tel|mobile|tax|nif|nie|dni|cif|vat|emisor|recipient|destinatario|person|guest|owner|holder|editor|contact|address|label|who|user|staff|operator|waiter|customer|client/i`,
  or ending `By` (with that capital), is judged. (`waiter` and `apellido` come from round 1's review
  list; the ruling's list did not name them, and they match no key today.)
- **Judged keys** must be on `PERSONAL_LOG_KEYS`; or be a child of a `PERSONAL_LOG_PATHS` entry,
  written inside the braces of that parent key's own member (`payment.provider_merchant_ambiguous.name`
  inside `merchants: { code: string; name: string }[]`, `packages/payments-sumup/src/errors.ts:10`;
  a `name` elsewhere in a code that also carries `merchants` is judged like any other); or be a `code.key` pair in the test's `NOT_PERSONAL` map, whose value is a
  one-line reason ("the name of a station", "a Bluetooth address", "an enum of who confirmed:
  authority, devices or admin"). Both imported from `../apps/server/src/log-personal-data.js`, as
  `scripts/guide-links.test.ts:14` imports from that app.
- **What the map will hold.** The planner's run of the widened list over `all-keys.txt` on
  2026-10-26 judged, besides the listed keys: `address`, `departmentName`, `holderDeviceName`,
  `label`, `locationName`, `name` (22 codes), `orderLabel`, `periodName`, `shortName`, `tableName`,
  `zoneName`, `takenBy` (2 codes, a table's name), `confirmedBy` and `soldBy` (enums), and three
  matches of a word inside another (`activatesAt` for `vat`, `byteLength` for
  `tel`, `filename` for `name`). (`guestCount` and `openedBy` in `all-keys.txt` are the scan
  artefact above, outside any `ErrorParams` body, and a `testing` folder besides.) The guard's own
  output is the authority: the implementer runs it, reads each pair it lists, and fills the map, one
  reason each.

**Tests first:**

1. The real registries pass.
2. A synthetic registry text holding `"guest.name_taken": { guestName: string }` is refused, naming
   the pair. This is the case that matters most: bookings would hold a guest's name.
3. A synthetic `"x.w": { customerTaxId: string }` is refused, naming the pair (the id skip does not
   apply to a tax number).
4. A synthetic `"x.b": { takenBy: string }` is refused (the `By` ending), and
   `"x.u": { userName: string }` is refused.
5. The cases it must still accept: `"x.y": { personId: string }` (an id), `"x.z": { email: string }`
   (on the list), and `"x.m": { merchants: { code: string; name: string }[] }` (the path rule).
6. A `NOT_PERSONAL` pair whose code or key no longer exists fails.
7. The body ends at its closing brace (must not refuse): a synthetic registry file holding
   `interface ErrorParams { "x.k": { tableId: string } }` followed, after the interface's closing
   brace, by `function f(guestName: string) { return { ownerEmail: guestName }; }` passes, and
   neither `guestName` nor `ownerEmail` is reported.
8. The path rule is bounded by its parent's braces: `"x.n": { merchants: { code: string }[];
   name: string }` is refused, naming `x.n.name`.

**Header**, written in this task, "weaker than its name": it reads text; judges a key by a word
list, so a key whose name says nothing about a person passes; judges only keys written in a
registry's text, so a throw site that spreads an object can carry keys its registry type does not
name (`{ ...prepared.venue }`, `apps/server/src/restore-request.ts:280` and
`apps/server/src/restore-stream.ts:378`: if `RestoredVenue`, `apps/server/src/restore-stream.ts:41-45`,
gained an `ownerEmail`, the answer and the log line would carry it and the guard would stay green);
and never reads free text. Tasks 6a and 6b extend it.

**Run:** `pnpm exec vitest run scripts/personal-log-params.test.ts`.

**Proof by deletion:** remove `email` from `PERSONAL_LOG_KEYS` and watch case 1 fail naming
`person.email_taken.email`; remove the `merchants` path and watch case 1 fail naming
`payment.provider_merchant_ambiguous.name`; remove the tax-stem exception and watch case 3 fail;
remove a `NOT_PERSONAL` entry and watch it fail naming that pair; make the body run to the end of
the file and watch case 7 fail naming `guestName`; drop the braces bound on the path rule and watch
case 8 fail. Restore.

## Task 6a — the root guard: named types

**Files:** add to `scripts/personal-log-params.test.ts` (after Task 5).

**What it does.** The guard also collects every capitalised type name inside each `ErrorParams` body
(bounded as in Task 5), after blanking comments and the contents of string literals (or a literal
such as `"Alta"` would be read as a type). Each must be in a `REVIEWED_TYPES` map with a one-line
verdict (`BillEditState: "holds editorName, which is on the list"`; `Record: "TypeScript's own; holds
what its arguments name, which the guard reads"`); a type nobody has reviewed fails, naming it and
its file, and an entry no registry uses any more fails too. The planner's scan on 2026-10-26 (a node
one-liner over the registry files round 1 listed in `registries.txt`) found 26 names, three of them
TypeScript's own (`Array`, `Readonly`, `Record`): `AllocationPreview`, `Approval`, `BillEditState`,
`BucketOperation`, `BusinessDayClockConflict`, `CancellationContext`, `DestinationCleanup`,
`DestinationOperation`, `EquipmentField`, `FacturaParams`, `HomeDevice`, `LineaParams`, `MemberRef`,
`MenuUse`, `Operacion`, `OrphanRemediation`, `OvertakenEdition`, `ProbeFailure`, `ProductUsingUnit`,
`ThemeNameRefusal`, `ThemeRefusalReason`, `UnservedDish`, `VerifyFailure`. Round 1's review counted
25 across 8 files with its own scan; the guard's output is the authority. Round 1 opened every one
and found a person only in `BillEditState` (`editorName`); `FacturaParams` holds `idEmisorFactura`,
now on the list. `LineaParams`'s verdict says that it inherits `idEmisorFactura` from
`FacturaParams` (`packages/fiscal-verifactu/src/errors.ts:15`):
the guard judges a type by its name only, so the verdict is the one place this is recorded. The
implementer opens each type again to write its verdict.

**Tests first:**

1. The real registries pass.
2. A synthetic registry `"x.v": { party: PartySummary }` is refused, naming `PartySummary`.
3. A `REVIEWED_TYPES` entry no registry uses fails.
4. The case it must still accept, the blanking: `"x.o": { operacion: "Alta" | "Anulacion" /* see
   Foo */ }` passes with no `REVIEWED_TYPES` entry for `Alta`, `Anulacion` or `Foo`.

**Header**, extending Task 5's: it judges a named type only by its name, so a person-named key
added later inside a type already in `REVIEWED_TYPES` passes.

**Run:** `pnpm exec vitest run scripts/personal-log-params.test.ts`.

**Proof by deletion:** remove `BillEditState` from `REVIEWED_TYPES` and watch case 1 fail naming it;
stop blanking string literals and watch case 4 fail naming `Alta`. Restore.

## Task 6b — the root guard: log calls' fields

**Files:** add to `scripts/personal-log-params.test.ts` (after Task 6a). From the earlier tasks it
uses only Task 5's word list and id rule.

**What it does.** The guard also reads every `.ts` file under `packages/*/src` and `apps/*/src`,
not only registries, skipping `node_modules`, `*.test.ts` and `testing` folders as Task 5 does, and
finds every call whose first argument is a level literal (`"debug"`, `"info"`, `"warn"` or
`"error"`), written `name(`, `a.b(` or `name?.(`, as round 1's `logcalls.pl` does (it found 250
such calls, and the review a further 11 written `log?.(`). When the third argument is an object
literal, it collects every key in it, `key:` and shorthand `key`, at any depth, and judges each with Task 5's id rule and word list. A judged key
must be on `PERSONAL_LOG_KEYS` or in a `HARMLESS_LOG_FIELDS` map keyed `event.key` (the event
literal; for an event that is not a literal, the file's path and the key), with a one-line reason;
an entry no call uses any more fails. The planner's run of the widened list over `logcalls.tsv` on
2026-10-26 judged `owner` (`staff_notice.*` lines in `apps/server/src/staff-notices.ts:91`, `:98`,
`:150` and `apps/server/src/box-health.ts:352`: the id of a notice's source, such as
`"fiscal-outbox"`), `hostname` (`apps/server/src/discovery-api.ts:147`, `apps/server/src/mdns.ts:77`),
`holderKind` (`apps/server/src/node-entry.ts:614`, `:618`) and `name` (`restore.recovery_key_selected`,
`apps/server/src/restore.ts:325`, a recovery key's name). That run missed the `log?.(` calls, so the
guard's output is the authority.

**Tests first:**

1. The real tree's log calls pass.
2. Synthetic log calls `log("warn", "x.sent", { guestName })` and
   `log?.("info", "x.mailed", { meta: { recipientEmail: e } })` are refused, naming each.
3. The calls it must still accept: `log("info", "x", { personId })` and `log("info", "x", { email })`.
4. A `HARMLESS_LOG_FIELDS` entry no call uses fails.

**Header**, extending Task 6a's: it sees no spread or variable passed as a log call's fields, and
does not see `packages/store/src/venue-liveness.ts:174-179`, which writes `waitron.log` without a
`Logger` (decision 12).

**Run:** `pnpm exec vitest run scripts/personal-log-params.test.ts`.

**Proof by deletion:** remove the `staff_notice.duplicate_key.owner` entry and watch case 1 fail
naming it; stop matching the `name?.(` form and watch case 2 fail naming `recipientEmail`. Restore.

## Task 7 — words: the rule, the page's description, the design, the backlog

Each sentence below is a claim; check it against the code as built, not against this plan.

1. **Root `CLAUDE.md`, §3 "Data, modules and migrations"**, beside the error-code rules, one line: a
   detail or log field holding a person's name, email or tax number uses a name on
   `PERSONAL_LOG_KEYS` (`apps/server/src/log-personal-data.ts`), which the logger masks in every
   line; the answer keeps it. Name it for whose it is (`guestName`, `customerTaxId`), never a bare
   `name` or `taxId`: the list is flat across every code. Guard: `scripts/personal-log-params.test.ts`,
   weaker than its name: reads text, judges keys by a word list, judges a named type only by its
   name, sees no spread at a throw site or in a log call, no free text and not the watchdog's own
   line. The full limits go in
   `docs/developers/conventions-ui.md` (item 3).
2. **Root `CLAUDE.md`, §3, the recovery page line** ("its log tail shows the failed start's own
   lines through `redactSecrets` and HTML-escaped"): the tail is the file's last lines, whichever
   start wrote them (`recovery-surface.ts:80-89`; the probe's lines from a running route reached the
   page), through `redactSecrets`, the personal-data mask, and HTML-escaped. Keep the owner-decision
   date and the secret sentence.
3. **`docs/developers/conventions-ui.md`, the recovery page's section (`:1084`, its redaction
   paragraph `:1140-1145`)**: the same correction; a sentence that the tail's `AppError` details
   have the listed names masked, with the receipt (this plan's probe and Task 3); that the dashboard's
   Diagnostics log view shows `***` the same way, because it reads the same files; and the known
   limits, the watchdog's line (decision 12) and the guard's list from the header Tasks 5, 6a and
   6b write among them.
4. **`deploy/README.md:192-194` and `:201-203`**: a person's name, email or tax number in an error's
   details shows as `***` in **the server's own log lines**, on the page and in
   `docker compose logs`. The command-line tools still print an error's details on their terminal:
   the provisioning (setup) and credentials tools (`packages/provisioning/src/cli.ts:646`,
   `packages/credentials/src/cli.ts:193`), and the restore command's venue confirmation, on purpose
   (`apps/server/src/restore-command.ts:410-413`).
5. **Code comments the change makes untrue**: `apps/server/src/errors.ts:16-18` (the registry
   header: add that a person's details use a listed name, named for whose they are);
   `apps/server/src/recovery-surface.ts:242-246` ("What bounds them is not this page: `redactSecrets`
   … and the convention …": add the mask); `apps/server/src/boot.ts:938-942` ("The two halves are
   deliberately NOT filtered alike … The STDOUT half is left whole": true of `redactSecrets` only;
   say the personal-data mask applies to both). Change nothing else in those comments. (The
   `table.label_taken` registry comment is Task 2's.)
6. **The design**, a dated pointer rather than a rewrite: §2.3 rows d5 and d6, §4.8's "unverified
   (S10)" row, and the "Not verified" paragraph at the end: what the probe found and what S10 masks.
   Row d6's pointer says exactly what is masked in the container's output: only the server's own
   log lines; `console.warn` lines, the watchdog's line on standard error and the command-line tools'
   output are not, as item 4 says for the README.
   Row d5 also gets a dated correction: the log is kept as six files, the current one and five
   rotated, not "five files" (`log-file.ts:42-53`; round 1 claim check F1).
7. **The build plan**: a 2026-10-26 status sentence for S10, linking this plan; note that S10 does
   not touch `packages/identity/src/staff.ts`.
8. **The backlog**: delete the S10 bullet in `docs/backlog/data-protection.md` (`:207`); add a
   "Decisions and deliberate limits" entry for decisions 4–7, 10 and 12 and owner note 5 (what stays
   unmasked and what is masked, with this plan's examples); in `docs/backlog/alerts.md`, under the
   O9 (a) point (`:64-67`), one line saying the log mask covers only listed detail names, so a bug
   report's masking must not rely on it for free text.

No guide page describes what the Diagnostics log view shows (`git grep -l -i diagnostics --
apps/server/src/guide` finds only `box-status.md`, whose line 5 names the screen), so no guide
changes.

**Run:** `pnpm exec vitest run scripts/claude-md-pointers.test.ts` and `pnpm format:check`.

## Root guards to run before `/finish-branch`

`pnpm exec vitest run scripts/personal-log-params.test.ts scripts/claude-md-pointers.test.ts
scripts/errors-reachable.test.ts scripts/english-only.test.ts scripts/coverage-thresholds.test.ts`,
then let the pre-push hook run the rest. The hook typechecks the changed packages, which covers the
`table.label_taken` type change in `apps/server` and its readers in `apps/dashboard` and `apps/till`.
CI runs `@waitron/server`'s and `@waitron/till`'s suites and coverage; read its result on the current
head.
