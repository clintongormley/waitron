# Backlog — what to work on next, and why

This file answers **"what should I work on?"** It is state, not history: what is built (one line each),
what is open, and the order to take it in. The git log, the PR threads, and the committed
specs/plans in `docs/superpowers/` hold the detail — do not paste receipts back in here.

> **Restructured 2026-09-12 (evening).** The goal is a **standalone working primary on prem**. The
> on-prem mirror and the cloud primary stay on the list, but they come afterwards. Three build tracks
> replace the six push steps and the four file-ownership tracks: **A — UI and application**,
> **B — infrastructure**, **C — smaller items**. Landed work is one line with its PR number as a
> locator; what a review seat caught and how something was proven stay in the PR thread.

**Companion documents, not duplicated here:**

- **[ui-review.md](ui-review.md)** — the live tracker for the UI/UX walkthrough (Track A): which areas
  are examined, which remain, and the corrections logged against each.
- **[compliance/action-plan.md](compliance/action-plan.md)** — the legal/administrative track
  (certificates, company formation, the declaración responsable).
- **[compliance/asesor-questions.md](compliance/asesor-questions.md)** and
  **[compliance/asesor-laboral-questions.md](compliance/asesor-laboral-questions.md)** — the fiscal
  and labour advisor question lists (see *The advisor gap*, at the end).
- **[superpowers/specs/2026-07-18-pos-architecture-design.md](superpowers/specs/2026-07-18-pos-architecture-design.md)
  §2** — the twenty numbered sub-projects (the strategy; changes rarely).

---

## How the order is decided

- **The north star (revised 2026-09-12): a standalone on-prem primary a real operator can install
  and run.** A blank box to selling, printing, paying and closing, with its backups leaving the box
  and the things that go wrong visible on a screen. **Afterwards, in this order:** the on-prem mirror
  it can fail over to, then a cloud primary. Nothing is built for Waitron Cloud now, but every decision
  must keep a node usable in the cloud unchanged (the rules below).
- **Soundness, not the calendar** (2026-08-02). Waitron will be finished before the deli must trade,
  so 1-Jan-2027 ranks nothing above anything. Order by dependency, correctness, and de-risking the
  most-reused or most-uncertain foundations first.
- **Never autonomously land anything touching the unrepairable fiscal core** — hash-chained records,
  never-reused invoice numbers. Fiscal-adjacent work in any track takes owner sign-off at land.
- **Docs land direct to `main`** (2026-08-02): the `main protection` ruleset grants Repository-admin a
  bypass, so a docs-only change is branched, `commit -s`, fast-forwarded and pushed — no PR, no CI
  wait. Feature and code changes still go through a PR.
- **Residency:** cloud instances will be hosted in Spain (owner, 2026-09-05), so asesor Q16 does not
  arise.

**The shape we build for:**

- **One venue and one taxpayer per operational node group** (2026-09-09). One active primary, one or
  more warm mirrors, human promotion. Restaurant/bar and deli can be departments within the same
  venue and share preparation. A taxpayer with independent venues has separate node groups; shared
  cloud management sits above them.
- **A mirror is on prem or in the cloud and is reached the same way** — URL + credentials over the
  same replication link. A cloud mirror is reached over WireGuard, so two containers on one machine
  joined by WireGuard IS the cloud test.
- **A node is two containers, app + Postgres**, with named volumes for state, logs and backups. The
  cloud scales by many containers per server, never by multi-tenancy.
- **Product images live in Postgres and are served from it** (2026-09-08). Replication, backup,
  restore and a cloud move are then one mechanism. The URL is content-addressed and served
  `immutable`, so each device fetches each image once until its bytes change.
- **Backups leave the primary.** Destinations, in build order now that the mirror comes afterwards
  (revised 2026-09-12; the 2026-09-08 order had the mirror first): an S3-compatible bucket, Google
  Drive, then the mirror once it exists. All three hang off the existing `StorageBackend` seat.

**Cloud-compatibility rules** — a change that breaks one is a design question, never a default:

1. Peers are reached by URL + credentials only. No LAN discovery, no shared-subnet assumption.
2. Adopt, promote, rejoin and backup are ONE code path wherever the node sits.
3. Every two-node test runs twice: over the plain LAN and over the WireGuard fixture
   (`@waitron/db/testing/two-node-wireguard.ts`, #275).
4. Everything a node keeps outside Postgres is a named volume, and every secret can come from the
   environment as well as a file.
5. The print agent is its own process on the venue's LAN, dialling OUT to the primary by URL. It is
   the one piece that must stay on prem when the primary is in the cloud.

---

## What to work on next

Ranked 2026-09-12, with the reason for each place and the track it belongs to. Each item is its own
brainstorm → spec → plan → PR; fiscal-adjacent ones take owner sign-off at land.

1. **Walk the box setup on real devices** (B1) — the onboarding code landed (#330): certificate
   guidance before setup details, connection retry/help, matching download/help paths over HTTP and
   HTTPS, and an installer QR pointing at the guide, across macOS, Windows, Linux, ChromeOS, Android
   and iPhone/iPad. What is left is physical verification — install the certificate, reopen with no
   warning, then replace it after a re-image — tracked per OS/browser in
   [ui-review.md](ui-review.md). This closes the 2026-09-11 setup dead-end: a re-image replaced the
   box's CA while the browser trusted the old one, and the provisioning error offered no recovery
   instructions.

2. **The till does not load its menu until a manual refresh** (A4). Seen on the blank-box-to-selling
   run; the box and sale path worked.

3. **Somewhere for things that went wrong to show up** (A5). The `incidents` table has several
   producers and no reader, and the dashboard has no notification surface. A rejected filing, a payment drift, a
   stalled print agent and a failed or stale backup are all invisible; several other items end "…waits
   for the notification surface".

4. **Backups that leave the box** (B2) — S3 first, then Drive. With the mirror deferred, a bucket is a
   standalone primary's only off-box copy. Only `LocalFsBackend` exists.

5. **The displays and the printers walked at the real box** (A4, A3) — till, handheld and KDS through
   [ui-review.md](ui-review.md), and the first physical print since #327: slips, duplicates, the
   drawer pulse, the feed-before-cut.

6. **The two remaining by-id read classes** (C1) — request-supplied table ids and the `ticket_items`
   reads. Same class as the cross-tenant leak the run-it seat caught on till-reroute S3; CLAUDE.md §3
   makes it a rule.

7. **The bootable USB installer** (B3) — the last piece of "install without a terminal".

Then the on-prem mirror, then the cloud primary — under *Afterwards*. Everything else ranks beneath
these.

---

## Track A — UI and application

What staff and the operator touch: `apps/till`, `apps/dashboard`, `apps/setup`, `packages/ui`,
`packages/layouts`, `packages/identity`, the dashboard-, till- and setup-facing routes in
`apps/server`, `packages/printing`'s dashboard side, `packages/payments*`. Numbered in priority
order; the small items at the end of each area live in Track C.

**Ongoing — the dashboard UI overhaul, screen by screen.** Every screen is being brought onto one
shared look, and the rules for it live in [design-system.md](developers/design-system.md). That
document is the contract, and it grows as we go: each screen tends to raise a question the rules do
not answer yet, and the answer is written down there in the same change rather than left in the
screen. Owner decision 2026-09-12: **this work runs on Sonnet.** It is screenshot-driven iteration
with the owner looking at each step, not a write-a-plan-and-dispatch job.

**Open, and it bites this work first: two documents now state the component rules and they have
already drifted** (found by the #337 review, not fixed there). `design-system.md` binds the token
rule to "any component or view" and its forbidden-colour list omits `color()`;
[conventions-ui.md](developers/conventions-ui.md) records what the guard mechanically enforces, which
is narrower — `packages/ui/src/no-hardcoded-chrome.test.ts` globs `packages/ui/src/components/*.ts`
only — and its list does include `color()`. #337 recorded which is authoritative for what
(the guard decides what CI does, `design-system.md` decides what a reviewer asks for) rather than
silently editing either. **Next action:** decide whether the token rule binds views as well as
components, then make the guard and both documents agree — one of them is currently telling a reader
something CI will not enforce. Whoever picks up the next screen should settle this first, because
every screen after it inherits the answer.

Done so far: the dashboard shell itself — the sidebar, the banner and the account menu — plus
**Account settings** (Your profile) and the **user administration** section (#333; what changed is
under A7).

Still to do, roughly in the order a venue meets them. As each one lands, add the rule it taught to
`design-system.md`:

1. **Overview and Sales** — `dashboard-overview-screen.ts`, `dashboard-sales-screen.ts`.
2. **Catalogue and product depth** — `catalogue-screen.ts`, `recipe-screen.ts`, `purchases-screen.ts`.
3. **Printing** — `printers-screen.ts` with its agent tabs, and `printing-rules-screen.ts`. #319 and
   #327 reworked these recently, so read them against the rules before changing anything.
4. **Payments** — `payments-screen.ts` and the provider panels in `packages/payments-stripe` and
   `packages/payments-sumup`. #333 changed only their row menus.
5. **Devices and displays** — `devices-screen.ts`, `device-profiles-screen.ts`, `floor-screen.ts`,
   `kitchen-screen.ts`, `service-status-screen.ts`.
6. **The two editors** — `canvas-editor-screen.ts`, `receipt-screen.ts`.
7. **Workforce** — `roster-screen.ts`, `my-schedule-screen.ts`, `planned-actual-screen.ts`,
   `approvals-screen.ts`.
8. **Venue operations and bookings** — `packages/venue-service/src/dashboard/` and
   `packages/bookings/src/dashboard/`. #333 touched only the venue-operations row menu.
9. **Operator utilities** — `backup-screen.ts`, `diagnostics-screen.ts`, `email-screen.ts`.
10. **Login** — `login-screen.ts`, which already carries the owner's own review from 2026-09-09
    (CLAUDE.md §3, the `ui-login` findings). Fold those corrections in rather than restyle it twice.

The till (`apps/till`) and the setup wizard (`apps/setup`) are separate apps drawing on the same
shared components. Whether they follow in this pass or later is open — decide it before the
component rules harden around the dashboard alone.

### A1. Checking a fiscal record before it is written — LANDED #331 (2026-09-12)

`packages/verifactu/src/validate.ts` holds AEAT's rules and no production file called it, confirmed by
experiment (a series code of `Serie A` reached `registros_facturacion` as `Serie A/1`, which AEAT
would reject). What landed: a record AEAT could not accept is refused at the chain seam, before
anything is written; one whose totals disagree with its own VAT lines is written, filed and flagged as
an incident, because AEAT accepts those under a ±10 euro tolerance; the same rules reach the setup
boundary and the `waitron-provision venue` command through a seat on the regime-neutral fiscal
contract, so no host code imports a regime package; and the wizard now returns the operator to the
refused field with a sentence saying what is wrong.

**No root guard keeps the validator wired** — the design left that open and the answer was no. The
guard is behavioural: the refusal at each seam is proven by deletion, and a root test pins the
wizard's field list against the constant the regime itself loops over. A text-walking guard was
rejected with a receipt: only two of the four field paths appear as string literals, so a scrape
would find two, pass, and claim four.

Three things the work uncovered, none of which anyone was looking for. The shared alta test fixture
had drifted into describing a record AEAT would reject, so 42 tests went red-to-green across eight
files when it was corrected. `recordSale` promoted a record to a full invoice whenever a sale carried
a business customer but never named the recipient — a real latent defect, fixed here for a Spanish
customer. And the new permanent refusal reached the till as "try again", which is the one instruction
that cannot work; five handlers now say to stop and who to call.

### A1c. Dead pointers to deleted test suites

The per-package `errors.reachability.test.ts` suites were deleted on 2026-08-11, but roughly 37
comments across 15 or more packages still cite them as the guard for error-code reachability. The
real guard is `scripts/errors-reachable.test.ts`. Found while reviewing A1, and deliberately NOT
swept there — fixing one of 37 makes the rot look addressed, and CLAUDE.md §1 says thin on touch
rather than sweep. One pass, whenever somebody has the file open anyway.

### A1a. A foreign business customer needs an identifier-type decision

`recordSale` now names a Spanish recipient on a full invoice. A non-Spanish one is refused by name
(`fiscal.foreign_recipient_unsupported`), deliberately: AEAT's `IDOtro` needs an `IDType` — NIF-IVA,
passport, residence certificate and so on, enumerated at
`packages/verifactu/schemas/SuministroInformacion.xsd:894-927` — and choosing wrongly files a record
into an append-only table that can never be unfiled. Whoever wires up business-customer sales makes
that call. No HTTP route supplies a counterparty today — core's `recordSale` hardcodes `null` and
nothing calls `recordSubstitution` from a route — but `packages/core`'s substitution path types it as
required, so the refusal is one route away, not one feature away.

### A1b. The validator never checks the recipient's own identity — DONE in A1

`validate` scanned the issuer's name and the operation description for characters XML forbids but
did neither for `Destinatarios.IDDestinatario[].NombreRazon`, and applied no length rule to the
recipient's NIF. The gap predates A1 (`git log -S`, #51) and was already reachable through core's
`recordSubstitution`, whose recipient has always been required; A1 widened it to any F1 `recordSale`
builds. Neither is reachable from an HTTP route yet, so the run-it review reproduced it by calling
the backend directly: a customer named `Cliente<U+0007>SL` went through the new full-invoice path
against real PostgreSQL, the sale COMMITTED, and the bell character was stored in the append-only
record. Fixed on the same branch: every recipient's
name is scanned and the issue names which one, and the recipient's NIF gets the same exactly-nine
rule the issuer's does (`sf:NIFType` is the identical XSD type). Regression at the chain seam.

### A1d. Four things the A1 review wave raised and did not fix

Each was judged and deliberately left; none blocks the merge.

- **The audited AEAT package's own shared record fixture is still a full invoice naming no
  recipient.** `packages/verifactu/test/fixtures.ts`'s `ALTA_INPUT` is the exact shape A1 corrected
  everywhere else. Not free to fix: it reproduces AEAT's own vector-1 hash, and the exact-XML
  expectations in `xml/serialize.test.ts` would all move. Whoever touches it does so with those two
  facts in hand.
- **The venue-field check restates three rules the validator owns.** `packages/fiscal-verifactu`'s
  `venue-fields.ts` copies the series-code character set, the description cap and the control-character
  range out of `@waitron/verifactu`'s `validate.ts`, and a whole test file exists to keep the copy
  honest. A reviewer proposed exporting `NUMSERIE_PATTERN`, `CONTROL_CHAR_PATTERN` and a named
  description cap from the library's barrel instead, deleting both the copy and the guard. DEFERRED
  on purpose (owner, 2026-09-12): it widens an audited fiscal library's public surface at the end of
  a branch, and the drift guard already closes the risk — 34 tests, proven against fourteen
  mutations. Revisit when something else needs those patterns.
- **The till writes the same three-way error classification at five call sites.**
  `apps/till/src/till-app.ts` decides permanent-refusal / known-code / unknown in five places; a
  helper would collapse it. Cosmetic, and cheapest to do alongside the tip-collection work that
  touches `#onPayTab` anyway.

### A2. The setup wizard

Landed in #334 (2026-09-12). [Design](superpowers/specs/2026-09-12-setup-wizard-a2-design.md) ·
[Plan](superpowers/plans/2026-09-12-setup-wizard-a2.md).

**Still open after #334**, each one something the branch consciously did not take:

- *The certificate export help has never been followed on a real machine.* Nobody exported a
  certificate through Windows', macOS' or Firefox's own certificate store while reading the new
  guidance, so the instructions are unverified against the thing they describe. Fold this into the
  device walkthrough (item 1 of *What to work on next*) and tick it off per operating system in
  [ui-review.md](ui-review.md).
- *Switching setup mode does not clean up what the server already holds.* #334 clears the browser's
  own record that a certificate import was requested, and nothing more. If someone fills in Demo,
  Prepare or Live far enough that the server has stored part of that answer and then switches mode,
  what the server kept is untested — write a test that stages configuration in one mode, switches,
  and asserts what survives.
- *The setup app's catch-all redirect was not proven by deleting it.* Unknown setup addresses now go
  to `/` while real files and API routes keep their own responses. The reviews checked this by
  running the route tests and the full server suites, not by removing each exclusion one at a time
  and watching a test fail, and no separate probe confirmed the trading app is untouched by the
  redirect. That is weaker evidence than this repository normally accepts for a guard.

The original walkthrough is retained under *Detail → Setup wizard*.

### A3. Printers from the dashboard

**Check a known address — LANDED #335 (2026-09-12).** The Add printer dialog now takes an IP
address and port and asks the approved print agents to try it, so a printer the two discovery passes
cannot see (they do not cross a subnet) can still be added, including reactivating a disabled one.
The check opens a TCP connection and sends no bytes; the server keeps at most eight targets for
30 seconds and each agent works out the remaining time against its own clock.
[Design](superpowers/specs/2026-09-12-printer-address-probe-design.md) ·
[Validation](superpowers/plans/2026-09-12-printer-address-probe.md).

- **Nobody has yet typed a real printer's address into it.** Everything proven so far is loopback
  sockets and browser tests. The owner's home is the case that motivated it — the box sits on
  192.168.10.x and both printers on 192.168.20.x, so the port-9100 sweep lists neither — and it is
  the first thing to try: add the Epson TM-T88III at 192.168.20.247:9100 from the dashboard and
  print to it.
- **No promise about how long a check takes end to end.** The dialog polls and reports a fresh
  result, but nothing bounds the round trip from pressing the button to an answer; the agent only
  picks the request up on its next job pull.
- **Two review suggestions were deliberately not taken** and would be relitigated otherwise:
  renaming the new error code (codes name the domain concept and are never renamed once shipped),
  and deduplicating targets in the agent host (the issuing server already normalises and
  deduplicates its bounded list of eight).
- **Nothing physical has been verified since #327:** discovery, paper output, whether a device knock
  reaches the box while the Add agent dialog is open, the five-line feed before the cut, Bluetooth
  discovery, and the receipt preview against printed paper. #324's slips, duplicates and drawer pulse
  have never produced paper either.
- **Printer discovery and the Bluetooth model** (owner, 2026-09-11, own spec): move Bluetooth
  scan-and-pair off the agent's `:9110` page into the dashboard, and surface the host's already-bonded
  printers through the existing `paired()` seam. Prereq: the box's Bluetooth radio path is
  hardware-unconfirmed.
- **The virtual PDF printer**, and a `print_jobs` retention sweep — nothing deletes a job today.
- Read-back gaps: the per-till printer picker is not location-filtered; the print-mode and
  `drawer_open_policy` toggles are set-only (the latter gates cash access); the Impresoras editor
  leaves agent and transport re-binding read-only though the API accepts it.

### A4. Till, displays and devices

- **The till does not load its menu until a manual refresh**, and a dashboard menu change does not
  appear live on it. A till-app fix.
- **The three displays walked end to end** — [ui-review.md](ui-review.md)'s areas, at the real box.
- **Android/iOS on-device install and trust rows** — real phones on the shop WiFi, the owner's to
  run. The name-constrained CA does NOT protect a personal Android phone (measured 2026-09-08); BYOD
  Android either accepts broad trust in the box CA or uses the public-certificate path — an owner
  call before go-live.
- **Location-consistency guard** — nothing enforces that a sale-capable device's register lives in
  the box's configured location, so a mis-provisioned device could stamp a fiscal record with a
  different site. Guard at enrol or first sale.
- Register/device follow-ups: `WAITRON_TILL_TILL_ID` still seeds a "Caja 1" register while a till
  enrol auto-creates its own; the device-management routes build their `devices ⨝ device_profiles`
  read inline where a `listDevices` store verb belongs.

### A5. Incidents and notifications

Two halves, one branch each (owner decision 2026-09-12).

- **A reader for `incidents`.** `openIncidents` is the only read and nothing calls it, while the
  fiscal drain (AEAT rejections), the payments reconciler (drift), the Stripe device provider and the
  card provider pool all write. Design questions: its own screen or part of diagnostics; who may see
  it (fiscal versus money); acknowledge or only observe. Detail under *Detail → Incidents*.
- **A notification surface for the dashboard** (owner-raised 2026-09-08). First consumer: "2 devices
  tried to join in the last 10 minutes" when pairing mode is shut. Then: a stalled fiscal outbox, a
  print agent that stopped pulling, a stuck job past its lease, a failed or stale backup, a low reader
  battery, later a standby that has fallen behind. Decide scope first: toast versus a persisted
  per-person inbox, `state` versus `local`, push versus poll.

### A6. Payments

- **The SumUp Solo experiments** ([runbook](research/2026-09-10-sumup-solo-experiments.md)). Question
  4 — does the reader still work standalone once paired to SumUp's cloud — governs whether the deli's
  card-outage path holds; if it fails, the deli-hardware outage design must be rewritten. The other
  three: whether we may supply the idempotency key, whether reader webhooks are signed, and whether
  `void` maps onto the refund endpoint.
- **The printer-cradle experiment** (hardware not yet owned). SumUp's OpenAPI has no `print` and no
  receipt option on a reader checkout, so we can neither request nor suppress a cradle slip. State the
  failing case first (the cradle stays silent), with a standalone payment as the control. Also unread:
  `GET /v1.1/receipts/{transaction_id}`, richer than the four fields the adapter keeps.
- **What #329 left open:** adding or adopting a reader does not shut out a provider disconnect at the
  same moment (an accepted race); Stripe's reader list is one page; low battery waits on A5; status
  never refreshes by itself, and polling must go through the passive-session controller.
- **The SumUp reconciler** — settlement-report audit and orphan self-heal. `resolvePending` is the
  interim backstop; without an affiliate key a create whose response is lost resolves `failed` and
  raises `payment.pending_outcome_unactionable` for a human. Note: a SumUp refund is a separate
  `type: REFUND` transaction linked by `transaction_code`; the original's `status` never flips.
- **A SumUp API drift-detection suite** on a Virtual Solo in a sandbox merchant account — would have
  caught the #312 refund-unit bug. Needs a sandbox account and a CI secret.
- **Stripe does not fill `CardDetails`**, so a Stripe card sale prints `Tarjeta` with no scheme/PAN/
  auth. Gated on the deli having a Stripe account, which it does not.
- **Slice 2 — the handheld NFC/QR link** and restoring `stripe_on_device` (Tap-to-Pay). Redsys and
  bank terminals are parked; Bizum research is under *Later and parked*.
- **The webhook `recordSale` hand-off** (Mode 3) and the reconcile remediation UI.

### A7. Users, roles and the dashboard shell

**The dashboard shell restyle landed (#333, 2026-09-12).** The sidebar's groups now collapse and the
current item is highlighted, there is a Settings group, and the app registered the kebab and hamburger
icons it had never had. The banner's separate "Your profile" and "Log out" buttons became a single
person-icon menu, and the profile moved off its own page into a modal opened from that banner, with
"Your details" and "Security" tabs. Two shared pieces gained options instead of being copied:
`wt-row-actions` takes an `icon` and `iconSize` (it was a fixed kebab) and `wt-button` takes an
`align`, so menu entries read left-aligned like a real dropdown — the staff, payments-reader and
venue-operations menus use them too. The Users edit form lost its Reset access/PIN and
Deactivate/Reactivate buttons, which already sit on the row's own menu behind a confirmation; Resend
invitation stayed. Two bugs were found while checking the work and fixed test-first: saving your
profile re-probed the session and silently reset the screen behind the modal to Overview, so closing
the modal dropped you there instead of where you had been; and Edit was clickable before the profile
data had loaded. The rules went into [design-system.md](developers/design-system.md) and CLAUDE.md §3.

Left open by that branch: no review finding was deferred — they were all applied — but the restyle
was only ever checked in screenshots on a desktop browser. Nobody has walked it on the real box or a
phone, so the narrow-viewport banner and drawer are unverified on hardware; that walk belongs with
the display walkthrough in [ui-review.md](ui-review.md). The rest of the dashboard's screens are the
ongoing overhaul listed at the top of Track A.

- **Roles are something an admin can add and edit; the four built-ins are only defaults** (owner
  decision 2026-09-12, design not written). Detail under *Detail → Roles*: the ladder question decides
  the schema.
- **`wt-select` in `packages/ui`** (owner decision 2026-09-12): every screen writes its own raw
  `<select>`, so a rule alone could not be guarded. Sorts by the label the person reads with
  `Intl.Collator`; lists in a lifecycle order say so; then migrate the screens. Fix `wt-data-table`'s
  locale-less `localeCompare` at the same time.
- **Shared database-backed table paging, search and sorting** (owner decision 2026-09-12; users
  first). 50 per page with a server-enforced maximum; search and sort over the whole dataset; debounce,
  reset on filter change, ignore superseded responses, keep passive live refreshes. Deliberately kept
  out of #328.
- **Tell people by email when their account's security changes** (owner, 2026-09-12): password changed,
  passkey or authenticator added or removed, recovery codes regenerated, email changed, Google login
  connected or disconnected. No link, one line on what to do if it was not them. Open: notify the OLD
  address on an email change; wording when an admin made the change; grouping a burst.
- **Permission-based dashboard navigation** (owner, 2026-09-09; `NAV_GROUPS` in
  `apps/dashboard/src/dashboard-app.ts` mostly uses role checks): map every built-in destination to
  its server permission, hide unavailable items and empty groups, same rule for direct URLs and the
  landing screen.
- **Dashboard-wide location context** — one persistent location dropdown in the banner; classify
  every screen and API as tenant-wide or location-scoped first.
- **The admin's Edit user form has no Language** chooser; a person's `locale` can only be set on Your
  profile.
- **Nothing checks that a typed value makes sense — a phone number accepts "abc".** The country packs
  hold the seat (`CountryPack.telephone`, filled by `validateSpanishPhone`) and nothing calls it. Use
  the pack's rule where there is one, otherwise `+` and country code then digits; browser and server.
  Open: normalise or keep as typed; whether an old bad number blocks an unrelated edit; which fields
  follow (the tax identifier is fiscal).
- **Adding a second passkey on the same device shows a generic error** (owner, 2026-09-12). Reading
  the code, not yet reproduced with a real authenticator: `beginPasskeyRegistration` lists the
  person's enrolled credentials as `excludeCredentials` (`packages/identity/src/passkey.ts:157`), so
  the authenticator refuses a duplicate and the browser throws a WebAuthn `InvalidStateError` from
  `startRegistration` — before any request reaches the server. The profile screen's catch maps every
  error through `codeOf` (`apps/dashboard/src/screens/profile-screen.ts:383`), so a browser error
  with no Waitron code reads as the generic fallback; the login screen's offer-a-passkey path
  swallows `NotAllowedError`/`AbortError` and nothing else. Wanted: say "this device already holds a
  passkey for this account" in both languages, on both screens, and leave the form open. The server's
  `passkey.already_registered` 409 stays as the backstop for a non-compliant client.
- Still open from #298/#305/#317, device checks before deployment: passkey reauthentication for a
  passwordless account; an operator screen for Google provider credentials; native passkey prompts on
  real hardware; a physical authenticator ceremony; live SMTP through `startServer`; whether an
  intermediary cache honours `Vary: Accept-Language`. #328's overlapping-dialog state was reached
  from code only; nobody has shown a real pointer can get there.

### A8. Receipts

- **One original per invoice, structurally.** `POST /api/sales/:id/receipt` has no limit and no
  idempotency; two calls produced three unmarked originals, and art. 14.1 says exactly one. Cheapest
  containment: idempotent per sale, invoice number on the slip.
- **A per-tender payment slip** when one sale is settled by several cards — needs a multi-tender pay
  path (`settleSale` takes `tenders[]`; `payWorkingOrder` and `readTenderBlock` assume one). Art. 11.1
  bounds how long an invoice may sit open.
- **Bilingual receipts** — `invoice_locales` is configured and snapshotted but rendered by neither
  document.
- **Tip-collection UI** — the only surface that COLLECTS a tip is the integrated-Stripe idle screen;
  cash, manual card and the handheld have none. A design decision per tender type. And `#onPayTab`
  flattens every server code but the two permanent fiscal refusals to one `sale.error` key, hiding
  `sale.empty_basket`.

### A9. Product depth — after the primary works

- **Departments and menus** (#297) remaining: remove the legacy price and fixed-station compatibility
  fields; per-menu modifier authoring; department hours and calendar exceptions; workforce
  assignments; immutable department attribution and reporting; batched readiness and offer queries;
  a replication smoke test. Same legal seller is the working assumption, to confirm before go-live.
- **Counter/walk-up kitchen fire** — the #193 follow-up, the next piece of menu work.
- **Menu draft/published state** and time-of-day / seasonal scheduling.
- **Pricing adjustments** (owner, 2026-09-03), both gated on the discount permission: reduce or zero
  an order line; a whole-order discount spread across lines and VAT rates. A *descuento* agreed at or
  before issuance is outside the VAT base (Q15), so it must reach the line BEFORE `computeHuella` —
  specced with the owner, never landed unattended.
- **KDS corrections deferred from #191** (owner, 2026-09-01): a moved dish must keep its kitchen
  status (`moveTabLines` deletes and reinserts the line, so its `ticket_items` row cascade-drops; the
  ticket must travel with the line, not re-fire — no test covers it today); hold-on-send
  without courses plus a venue disable setting; FP-1's empty-named child-modifier row; device-scoped
  fire/collect routes. Then the low-priority KDS list under *Detail → KDS*.
- **Order-timing and modifier follow-ons**: delivery-order floor flash, idle-floor escalation,
  station-kind threshold defaults, an unbumped-since-fire metric; on-screen modifier `×N`, the shared
  `#allergens` render, the KDS-versus-till unreviewed-dish call, post-fire note and doneness edit
  (needs a re-fire endpoint), the TS-4 partial-transfer modifier-split guard.
- **Handheld live updates** — the app is pull-only, so two waiters on one table see stale data until
  a refetch. A sizable new subsystem; spec it when it matters.
- **Configurable per-device face-set editor** — persist a face-set per device profile with the
  `HANDHELD_FACES` constant as fallback; the heavier half makes the table-order screen canvas-driven.
- **Layout designer follow-ons**: the aggregated device-profile bundle (till, station, hardware, area,
  order routing, printer target on the profile); truly-real card renders in the editor (needs a
  neutral shared card package); the visual theme editor; community canvas sharing.
- **Unify string resolution** behind one language-negotiation resolver
  ([design](superpowers/specs/2026-08-30-localization-fallback-negotiation-design.md)): a shared
  `negotiate()`, de-hardcode `"es"`, a presentational venue-default UI language, and the write-side
  header drift (`sales.locale` stamped from boot-time `cfg` rather than `locations.invoice_locales`).
  The apps ship only Spanish and English catalogues, so a Catalan preference falls back to Spanish.
- **Bookings**, each greenfield: public/online/QR booking, availability, reminders, a CRM entity,
  recurring, a calendar grid, deposits.
- **Wages / labour cost (SP16)** — a per-person pay-rule set (hourly or fixed salary for N contracted
  hours, rate overrides by condition of the hour, paid non-worked states) turning recorded and
  scheduled hours into accrued-versus-pending money. Rates are editable data, never hardcoded convenio
  numbers; needs a public-holidays calendar. Gated on the labour advisor; not fiscal.
- **Logging Slice 2 — one-touch bug report**, then Slice 3 triage and forwarding, with the Slice 1
  hardening (client-trail key allowlist, `maskPath` PII, the setup app). Detail under *Detail →
  Logging*.
- **SP-4 — the module UI surface on the TILL** (card-registry inversion, self-sourcing cards); the
  dashboard half is done. Migrate the remaining core dashboard screens onto the module UI seat and off
  the coarse `requiresManager` gate.
- **AEAT certificate management UI** — first-run only today; `cert-expiry.ts` monitors but there is
  no view/rotate/renew surface.

---

## Track B — infrastructure

The box, the image, the data layer and the machinery: `deploy/`, the Dockerfiles and compose,
`packages/provisioning`, `packages/migrations`, `packages/db`, `packages/credentials`, the
print-agent process (`packages/print-agent`, `apps/print-agent`), `apps/server`'s boot, config,
TLS, backup and media code, the module framework, CI and test infra. `packages/sync` and
`packages/membership` belong here too but their open work is under *Afterwards*.

**Built:** the two containers + `deploy/compose.yml` + named volumes (#285); `waitron.sh install` and
`reset` (#314); the recovery supervisor and the box serving its own leaf over HTTPS in every mode;
the CI `image` job (#288); boot-failure diagnosability — a recovery page of curated operator text keyed
by error code, and an ahead-of-image database check (#310); the enum-upgrade repair and its two root
guards (#307); real hardware bringup (#302); `linux/amd64`-only images (#325, published — the manifest
carries amd64 alone); the backup + recovery-key wizard (#295); guided node onboarding, all four modes
(#296); the print-agent process, its box wiring and on-node auto-enrolment (#282, #289, #308, #311); the
CA-trust onboarding guidance, connection retry/help and the per-OS certificate walkthrough (#330).
Proven end to end 2026-09-09: blank box → phone setup → provision → trading over HTTPS → enrolled
till → a recorded preproduction sale.

### B1. Onboarding must surface the CA-trust step — LANDED #330 (2026-09-12)

The branch added certificate guidance before collecting setup details, connection retry/help,
matching download/help paths over HTTP and HTTPS, and an installer QR pointing at the guide. It
covers macOS, Windows, Linux, ChromeOS, Android and iPhone/iPad, with browser-specific instructions.
[Design](superpowers/specs/2026-09-12-box-trust-onboarding-design.md),
[plan and validation](superpowers/plans/2026-09-12-box-trust-onboarding.md).

Still to walk on real devices: installing the certificate, reopening without a warning, then replacing
it after a re-image. Track each OS/browser in [ui-review.md](ui-review.md). Browser rendering and a
successful API request do not verify an OS trust installation. The original Mac/Chrome incident
needed removal of the old CA and a full browser quit; HTTPS-only browser policy can still prevent
opening HTTP before any Waitron page runs.

### B2. Backups that leave the box

- **S3-compatible bucket, then Google Drive.** Only `LocalFsBackend` exists. The abort-aware
  per-destination timeout lands with the first network backend.
- **Whole-state-volume capture** (its own §5-reviewed slice): capture the whole state directory EXCEPT
  an explicit exclusion set, with a completeness guard that fails when a new top-level entry is
  neither captured nor excluded — the curated list went stale on `modules.json` already.
- **The "backups off or stale" reminder** belongs in A5's notification surface; when a nightly report
  job exists, the backup slot should fire after it.
- **The cold-restore operator surface** (promote Slice 4): connection rebinding, advertised origin,
  an authenticated entry.
- **Reconsider the backup container against off-the-shelf tools** (a brainstorm): `WBA1` plus
  `artifact-cipher.ts` holds the whole dump in memory and is restorable only by Waitron code, where
  `pg_dump | age` into a tar is the obvious alternative.
- Carry-forwards under *Detail → Backup*.

### B3. The bootable USB installer

Runs `waitron.sh install` unattended. Open questions it owns: whether the stick carries the images so
install needs no internet; unattended updates for a box we did not sell; AP-mode WiFi onboarding. Box
image constraints under *Detail → Box image*.

### B4. Upgrades and migrations

- **Core release points 1 to 6 cannot upgrade at all.** Entries 2 to 6 carry `when` values below
  entry 1's and drizzle picks what to apply from `max(created_at)`; no journal edit repairs it. The
  only real repair is a squashed baseline — **an owner decision nobody has taken**. Until it is, the
  hazard stands: **do not run `pnpm --filter @waitron/db db:generate`** (it proposes dropping the
  bookings table, which left core's barrel but stayed in core's snapshot chain).
- **Four paths migrate a live database with no ahead-of-image check** (`instance-apply.ts`,
  `restore.ts`, `rejoin-command.ts`, `dev-setup.ts`); only the boot path has one.
- **`waitron-provision instance` migrates on every run**, which against a trading shop can lock
  tables — gate it (a flag, a refusal, a louder confirmation)? A product decision before production.
- **Provisioning's migrate path still runs the linear full `manifestSets()`** — route it through the
  resolver once it gains per-module enablement.
- **`modules.json` has no flow-down channel** from a primary to its standby (matters under
  *Afterwards*, designed now that bookings is genuinely toggleable), and a toggleable module that is
  load-bearing (identity, payments) fails boot loudly if disabled until the wiring inversion.

### B5. The recovery page and degraded mode

- **The recovery spec** — a degraded-but-trading mode and the module-contract field it needs.
- **The recovery page's secret bound is a convention, not a guard.** #310 masks URL credentials on
  every log line — the connection-string shape and nothing else. A secret in any other shape still
  reaches the unauthenticated page through the log tail, bounded only by the convention that an
  `AppError`'s params carry none.
- A `sealAeat`/`persistTrading` I/O failure AFTER `provisionVenue` succeeds wedges the box (tenant
  minted, no `trading.env`) and needs a recovery path or a loud wedge; a provision failure after
  `provision()` mints the tenant and chain needs a re-image today.

### B6. The print-agent process

- **A sweep in flight keeps connecting after the discovery window closes** (189 of 253 connects on
  #313 started after expiry). Pass the deadline through `Host.scan`.
- Retry spacing is the agent's batch interval rather than a per-job backoff, so a flapping printer
  burns `MAX_DELIVERY_ATTEMPTS` at loop speed — needs a next-attempt column.
- **Cross-box print-agent TLS** — an agent trusts only its local box CA, so a mirror's agent cannot
  reach the primary; gates the mirror's print agent (*Afterwards*). The vouch slots into the same
  route later.
- **Cloud-poll transports** (Star CloudPRNT, Epson Server Direct Print) — a NAT'd printer with no
  agent. Low priority.
- **On-device agent** — a till hosting a print agent, the single-box venue's box-death printing path.
  Needs a native app; parked behind the go-native decision.

### B7. Provisioning and build debt

- **The `tenant` command is unplanned**; its idempotency check should attempt the insert and catch
  the unique violation, and with one tenant per database the guard is really `assertNoForeignTenant`.
- **The credential READ path does not `validatePayload`** (`getCredential`/`tryGetCredential`,
  `packages/credentials/src/store.ts`), so a
  row sealed under an older `PURPOSES` list returns a missing field as `undefined` — fail-loudly
  versus keep-serving, to settle before the first consumer relies on it.
- **Two near-identical node-forge certificate builders** (`self-signed-cert.ts`, `testing/tls.ts`,
  plus the fiscal module's byte-copy). Extract one; its own PR, it touches the mTLS fixture.
- **A box that mints its certificate before NTP sync persists a wrong validity window**, with no
  renewal path yet. Ties to a time-health check and certificate renewal.
- **Hardening from onboarding 2b:** a DB-level advisory lock on `tenantId` spanning
  guard→stamp→`applyVenue`; one `closeAll(pools)` so a throw from the first close cannot skip the
  rest; a wizard-only box runs its trading life on the owner role rather than `app_user` until the
  role-split retrofit.
- **`pnpm install` prints exactly one warning and nobody has looked at it**: a cyclic workspace
  dependency among `bookings`, `migrations`, `fiscal-verifactu`, `sync`, `provisioning` and
  `composition`. Unknown whether real or an artefact of the composition list depending on the modules
  it names.
- The shutdown REJECT path gates its failure-log flush before exit, so a `close()` rejection plus a
  stalled stdout pipe is an uncovered hang; `waitron.sh` pulls with `--ignore-pull-failures`, so a
  box with no manifest entry for its architecture fails silently at pull and breaks later at `up`.

### B8. Module framework follow-ons

- **The graph-honesty guard's SPI-edge detector** matches `EXECUTE FUNCTION sync_capture`, which no
  longer exists — generalise to every cross-module `EXECUTE FUNCTION` edge or delete the branch.
- **Country-pack follow-ons:** the authenticated address relay and its first provider adapter; phone
  normalisation in bookings; a supplier country/identifier scheme before validating purchasing tax
  IDs; the pack's module preset; the refused foral, Canary, Ceuta and Melilla jurisdictions; a
  territory picker in the setup wizard (it offers `ES-common` only).
- **`fiscal-none` left-behinds:** de-dup the `tls.ts` mTLS fixture; remove the inert
  `resolveClient`/`skipRetryMs`; regime-agnostic provisioning tests.
- **Test-helper debt:** `provisionTestVenue(db, overrides)` for `apps/server`'s sixty-odd suites; the
  duplicated `boot.*.test.ts` helpers into `apps/server/src/testing/`; a shared
  `useFiscalMirrorPair()` for the two-clone fiscal suites.
- **The tax-model system** — the `tax` slot is an inert label today; the intended shape puts the tax
  MODEL in core with the fiscal module supplying rates and labels. A prerequisite for any non-ES
  venue, so parked.

### B9. CI and test infra

- **Fast local pre-push checks** — implemented on `chore/fast-pre-push`: retain sign-offs, locked
  installation, formatting, lint, root guards and scoped typechecks; mandatory package tests and
  coverage run in CI. Branch finishing uses focused local tests rather than a duplicate full gate.

- **Three unexplained incidents, each seen once or twice; on recurrence retain the log before
  retrying** (standing rule: a flaky test is fixed at the root): eleven UI suites failing to load with
  "Vitest failed to find the current suite/runner" after a rebase (2026-09-11); a test PostgreSQL
  container with no published port (2026-09-12 — capture `docker inspect` and check the Docker
  Desktop VM's ephemeral ports); bookings' browser freeze, never reproduced locally after #291. A
  fourth, from #334's validation run (2026-09-12): the service-status browser suite failed with
  Playwright's "Frame was detached" during a whole-workspace run, and then passed both on its own
  (15 tests) and in a full dashboard coverage run (1,682 tests) with no code change. The original log
  and screenshot were kept; the cause is unexplained, so retain them again on the next sighting
  rather than re-running to green.
- **`replication-arc`'s isolation was reverted** (vitest `projects` are incompatible with `--shard`);
  if it flakes on `test-server` it needs a `--shard`-compatible isolation.
- **Job-sharding levers:** `--shard` splits by FILE COUNT; bump `shard: [1..N]` and the denominator
  together with N at or below the file count; `mutation-verifactu` is the next critical-path
  candidate; rebalance `LIGHT_A/B_PACKAGES` when one light shard dominates.
- **A hung real-PG suite leaks its cluster containers** and `pnpm reap` only removes labelled ones
  older than two hours — inspect creation times and ownership, remove only your own.
- *Small:* `test-light` reports success without naming what it ran; `packages/ui` can hang the `test-ui` shard, cause unconfirmed; the classifier's `root=`
  output line is read by no consumer.

---

## Track C — smaller items

Each fits one sitting, and none needs a spec. Correctness first, then by area. A *Small* item that
turns out to need a design moves to its track.

**Correctness:**

1. **The two remaining by-id read classes** — request-supplied TABLE-id reads (`moveTab`/`joinTable`'s
   `toTableId`, `assertTableAvailable`) and `ticket_items` reads and updates in
   `bumpCourseReady`/`advanceTicketItem`/`advanceTicket`. Each needs its own `eq(tenantId)`.
2. **till-api's bare `c.req.json()` sites still 500 on a malformed body** (~19 on the sale and pay
   path, each needing per-route validation tracing before moving to the shared `readJsonBody`); the till PIN login gives an opaque 500
   instead of a clean 401.
3. **`report-api.ts` runs three concurrent queries on ONE `withTenant` transaction** — serial and
   deprecated in pg@8, broken in pg@9. Sequential awaits or one combined query.
3. **A concurrent-corrective race in `settleSale` is untranslated** — a raw `P0001` from the coverage
   trigger with no `sale.*` code. Give the trigger a SQLSTATE and translate it when reachable.
4. **Location-scope the by-id verb family together** (`getHeldOrder`/`updateHeldOrder`/
   `abandonHeldOrder`, `updateTable`/`deactivateTable`/`openTab`) when multi-location lands.

**Dashboard, till and setup:**

- **Timestamps across the printers and devices screens show UTC** — `formatIsoMinute`
  (`apps/dashboard/src/date-utils.ts:27`) slices the ISO string. One shared formatter, not a per-call-site patch.
- Profile follow-ups (owner, 2026-09-12): keep Display name in step with the person's name as it is
  typed, in all three forms (`person-form.ts`, `person-edit.ts`, `profile-screen.ts` under
  `apps/dashboard/src`); Your profile calls the display name just "Name" (`profile.name`) — one
  field, one label.
- The till renders `person.suspended` as "Account suspended" — align with the dashboard's Disabled
  terminology.
- The dev `?dev` chooser shows `label · kind` rather than `name · profile · register`; the Spanish
  form-factor label differs between two pickers ("TPV" vs "Caja registradora") — an owner copy call.
- An `int4InRange` helper collapsing four int4-bounds parsers; an options object for the positional
  `create/updateDeviceProfile` verbs; a shared `SeedDeviceProfileInput`; a `BRAND_PRIMARY_HEX`
  constant (the theme colour is literal in three places).
- Choose one reset-on-dismiss policy for armed destructive row actions across printers and agents;
  migrate `?disabled=${busy}` buttons to `loading`; the seen-status is as of the last read, not a live
  presence light.
- KDS-4 follow-ups: device-mode reprint behind `requireDevice`; the mirrored station-side read (a
  `DashboardApi.listStationPrinters` and a UI line); the reprint timestamp.
- Two QR libraries coexist (`qrcode` in `apps/server`, `qrcode-generator` in `apps/till`) — unify into
  `packages/shared`; hoist the receipt's hand-ported money/date/label formatters there too (the paper
  receipt already drifts from the screen by an NBSP normalisation).
- Recorded, not blocking: a handheld's Order tab is tappable with no active table; the
  boot-into-floor prefetch is unreached by any shipped canvas; the station screen's device-mode enrol
  sub-view is unreachable; the default counter canvas has no prep-queue rail.
- The dashboard's `es-ES` module default still needs the flip the till got in #170; check the
  dashboard money formatter for the same "doesn't follow the UI locale" bug.

**House rules and their guards:**

- **The pointers guard is deliberately narrower than "every pointer"** (#337).
  `scripts/claude-md-pointers.test.ts` checks every markdown link in `CLAUDE.md` and the topic files,
  and backticked paths under `apps/`, `packages/`, `docs/`, `scripts/`, `deploy/`, `bench/`,
  `.github/` and `.husky/`. It does NOT check a root-level filename such as `eslint.config.js` — a
  pointer `CLAUDE.md` really does give a reader — nor a bare directory. `CLAUDE.md` §7 says so; widen
  the guard if that gap ever costs something.
- **Eight historical plans and specs carry a dated pointer to the deleted
  `.github/instructions/waitron.instructions.md`** (#337 deleted it after moving its rules into the
  `docs/developers/` files; it read nowhere after Copilot's review was switched off on 2026-09-06).
  Nothing guards that class, so a future rename needs the sweep done by hand:
  `grep -rn --include="*.md" waitron.instructions .` is the whole list.

**Payments:**

- Bound the HTTP body read as well as the header wait in `sumup-client.ts` (move `clearTimeout` after
  `res.text()`); lift `reverseViaStripe` and `reverseViaSumUp` into one neutral reversal primitive.
- Pre-existing `forward` retry backoff.

**Fiscal (each behind its own review, owner sign-off at land):**

- **The three alta builders are triplicated** — `recordSale`/`recordCorrection`/`recordSubstitution`
  in `packages/fiscal-verifactu/src/backend.ts`. Safe
  seam: a helper taking the assembled `Omit<AltaInput,"Encadenamiento">` plus a `buildDesglose`; needs
  a huella-invariance re-run across all three.
- Left behind by the RLS drop: `sales_assert_tenders_cover`'s "even though the definer sees every
  row" clause is false — thin on first change; `scripts/schema-equivalence-fold.test.py` is run by no
  gate.
- `tenant.not_found` has no production thrower — keep or remove is an owner call; `mirror-bundle.ts`'s
  `r.series ?? []` branch is un-exercised; export `ID_SISTEMA_MAX_LENGTH` when either package is next
  touched; `insertNodeSeriesTx`'s held-code check is SELECT-then-INSERT; `readStandardSeriesIdTx`
  filters by tenant while `readNodeEndorsement` documents the opposite; the SP-3d restore overlapping
  a live SIF registration deadlocks (`40P01`) — revisit locking before the hook runs live.
- Two stale lock-order claims in `apps/server/src/working-order.ts` (`unjoinTable`'s "MATCHES"
  docstring; `mergeTabs`'s "seq-scans" claim, which `EXPLAIN` contradicts). Thin on next touch.

**Product decisions to take before production:**

- The orphan drift gate holds a customer's money pending a human, unbounded — nothing re-sweeps a
  closed period.
- The €0 comped sale settles at the settlement instant, not backdated to `issued_at` — is a comp
  ever finalised long after the invoice printed?
- A human account always keeps an email (no remove-email action; `setEmail` rejects clearing) — the
  rule now, rather than a missing UI path.
- The duplicate purchase-invoice key `(tenant_id, supplier_tax_id, supplier_invoice_number)` is
  unique forever — per-year versus forever is the asesor's.

---

## Afterwards — the on-prem mirror, then the cloud primary

Not in any track until the standalone primary is done. Kept here so the decisions and residuals do
not get lost.

### The on-prem mirror

The mechanism is native Postgres logical replication (#280); the membership, promotion and rejoin arc
is complete (#197–#272); the two-node WireGuard fixture exists (#275). What remains, largest first:

- **Status, alarms and the operator surface for native replication** — numbers and alarms off
  `pg_stat_subscription` / `pg_stat_subscription_stats` / `pg_replication_slots.wal_status`; the SKIP
  runbook for a stalled subscription; a management route for the post-drain disable of a narrowed
  subscription; the standby-first migration check; **orphaned-slot reclamation** (`dropReplicationSlot`
  is tested and has no caller).
- **Fiscal-certificate distribution — landed #279, reverted #281; rebuild on the asynchronous adopt.**
  Open design question: how the dormant certificate is protected when the seal must happen after the
  initial COPY ([design](superpowers/specs/2026-09-07-fiscal-cert-distribution-design.md),
  [plan](superpowers/plans/2026-09-07-fiscal-cert-distribution.md)). Beside it, **the vault-ring
  question**: `tenant_credentials` is `local` and a blob sealed under one node's ring cannot be opened
  under another's, so `fiscal.aeat` and `payments.stripe` do not travel to a standby at all.
- **Node-role collapse** — derive ONE `NodeRole` at boot from the membership document and pick one
  rule: every role change is a restart, or the worker-lifecycle manager — not both.
- **The mirror as a backup destination**, and the mirror's print agent (gated on B6's cross-box TLS).
- **The two-node end-to-end proof over LAN and over WireGuard**, including the same-site cookie
  browser receipt still owed from till-reroute Task 10 (needs interactive Chrome + mkcert +
  `/etc/hosts`).
- **Richer daily close** — one close run by the primary across all tills.
- The residuals under *Detail → Replication*: re-admission, the unbounded membership chart, chart
  hygiene, the resume-at-restore marker, power-loss durability and the selling gate, restore-onto-cloud
  re-encrypt, mirror fidelity, split-brain on the promoted side, the till UX for a timed-out card.

**A stale worktree:** `feat/h2-fiscal-record-sync` (spec and plan dated 2026-09-04, uncommitted
changes in `packages/sync`) was designed on the application outbox that #280 deleted; the fiscal
ledger now replicates as `ledger`-classified tables. Superseded — remove it once the owner confirms
nothing in its uncommitted diff is wanted.

### The cloud primary — back burner, docs only

Waitron Cloud itself; the control plane; cloud-only redundancy (a managed/HA Postgres host versus a
second cloud node); the cloud trial on-ramp; WireGuard on the box image and `@waitron/tunnel`'s
retirement; the cloud-standby end-to-end proof; first-contact trust bootstrap for an untrusted-network
primary. **Per-tenant cloud provisioning is not this repository:** Waitron Cloud — a separate
closed-source service, not started — spawns the instance, sets up WireGuard and hands back a URL and
credentials; this repo only ever *talks to* a provisioned instance. **Do not restart the cloud-standby
work until the Waitron↔Waitron-Cloud boundary contract is settled.** The proof to run then: on-prem
primary → adopt → mirror → human promotion → tills reroute to the promoted cloud → the venue sells
and files. [Box maintenance and remote support](superpowers/specs/2026-09-11-box-maintenance-and-remote-support.md)
is a discussion, not an approved spec; the
[cloud-services inventory](superpowers/specs/2026-08-29-cloud-services-inventory.md) catalogues the
paid offering. Remote-access bot protection (Cloudflare Turnstile on internet-facing login and
recovery, never in the local-only product) belongs to that offering.

---

## Coordination between tracks

Each track is its own worktree so sessions do not edit the same files. Rules, each already paid for:

- **Concurrency follows measured headroom, never a count** (CLAUDE.md §2). Before a heavy run check
  free memory and the heaviest processes, then scale to what is free. Real-PG suites racing on Docker
  ports show as `EADDRINUSE` and pass on retry — a flake, not a reason to serialise.
- **Whoever lands second rebases — only on a code-file overlap or a GitHub conflict.** A PR that is
  merely `BEHIND` lands as is with `gh pr merge --squash --admin` (CLAUDE.md §6). Module-owned
  migrations are regenerated on rebase per CLAUDE.md §3's recipe.
- **Shared files:** `apps/server/src/boot.ts`, `CLAUDE.md`, `packages/db`'s core schema and
  migrations, the dashboard printers screen, and this file (each track edits its own items).
- **Comment thinning on touch only** (CLAUDE.md §1); no sweep in any track.
- **Update this file as items land**, in the same PR.

**Run path (local; no hardware, cloud, or AEAT cert):** `wa-wt demo <worktree-name>` → till
<http://localhost:5190>, dashboard <http://localhost:5191>, setup <http://localhost:5192>, server
:8080. The till enrols itself on first load in dev mode. Till PIN **5555**; dashboard
**owner@demo.waitron.local / dashPass123**. `dev:setup` seeds three menus (~44 products with images),
a floor plan (5 zones / ~16 tables), staff on PIN 5555, and ~28 days of back-dated preproduction sales
— English by default, Spanish via `WAITRON_SEED_LOCALE=es-ES`. `wa-wt onboarding <worktree-name>` for
a fresh shipping-style wizard; `wa-wt reset demo|onboarding [worktree-name]` wipes and rebuilds.
**A demo database created before #329 (or #307) must be reset with `wa-wt reset demo`** — the card-reader migration was
edited in place and #307 changed `0014`'s drizzle hash, so an older schema fails the ahead-of-image
check.

---

## Standing decisions

From the 2026-09-05 whole-project design review and since. They supersede older spec text where they
conflict.

- **One tenant per database everywhere, the cloud included.** A tenant is one taxpayer
  (`country` + `tax_id`; `packages/provisioning/src/tenant-id.ts` derives its id) holding all of its
  locations. The cloud is a dedicated instance per tenant, hosted in Spain. Density comes from many
  isolated instances per host. The only multi-tenant pieces are a small control plane and the
  preproduction trial demo.
- **Warm standby plus human promotion; active-active is shelved.** Nothing was deleted for it: branch
  **`shelved/active-active`** (= `main` at `c65d3cbe`, 2026-09-05) is the snapshot to return to.
- **Modules are core to the product** (opt-in domains, third-party modules later); fiscal is swappable
  by jurisdiction (Veri\*Factu / TicketBAI / none). New domains land as modules, and no new core table
  without a stated reason (CLAUDE.md §3).
- **Register and device are both kept.** A register (`tills`; UI "register"/"caja") is the drawer
  counted at close; a device is the screen. Several devices ring into one register.
- **Rerouting lives in the till web app** for every device kind; the device credential stays an
  httpOnly cookie. A native agent is built for hardware only, printing first.
- **No relay.** Replication rides the box↔own-cloud-instance WireGuard link; remote access is the
  instance forwarding the box's name down the link without terminating TLS.
- **Handheld kiosk mode is optional, never required** (owner, 2026-09-08) — most waiters use their own
  phones, so the baseline is an installed home-screen web app plus the till's staff PIN.
- **Comments carry invariants, not history** (CLAUDE.md §1). The coverage bar is negotiable with a
  reason.

---

## What's built (state per sub-project)

Architecture §2's twenty sub-projects, plus the cross-cutting infra. "Remaining" is the unstarted or
partial scope; the detail for a live thread is in its track.

| # | Sub-project | State | Remaining |
| --- | --- | --- | --- |
| 1 | Design system | `@waitron/ui` token layer + primitives (`--wt-*`); brand assets (#284); the till web-app manifest and its icons; the dashboard shell restyle — collapsible nav, account menu, profile modal (#333) | `wt-select` (A7) |
| 2 | Sales spine | Immutable hash-chained sales, per-tenant series, catalogue, tenant model | — |
| 3 | Fiscal layer | Verifactu lib + `FiscalBackend`; settlement, R5 rectificativas, F3 canje, invoice-first; fiscal is a module (`fiscal-verifactu`, `fiscal-none`) | F3 asesor/XSD confirmations; cert distribution to a promoted node; a foreign business customer's identifier type (A1a) |
| 4 | Payment layer | `PaymentProvider` + Stripe Terminal, manual card, integrated Stripe, Mode-3 webhook, SumUp Cloud API (#309); dashboard provider/reader configuration and adoption (#323, #329) | webhook `recordSale` hand-off; reconcile remediation UI; the handheld NFC/QR link (A6) |
| 5 | Identity | persons/sessions, PIN (+ per-device throttle), `authorize()`, roles/permissions, passkeys, email-first dashboard login, emailed invitations and password resets, encrypted TOTP and recovery codes, user admin (#298, #328); identity state replicates to a standby | admin-editable roles; security-change emails; mid-shift-suspension enforce; discount gate; till-refund enforce |
| 6 | Locations | provision-a-sellable-venue (`waitron-provision venue`); departments, zones and menus (#297) | multiple locations, edit/deactivate; then location-scope the by-id verb family |
| 7 | Counter POS | walk-up cash, park/retrieve, manual + integrated card, prepare & collect, canvas/receipt editors, receipt/drawer printing, cash-drawer authorization — operable end to end | — |
| 8 | Reporting | daily close, frozen *cierre Z*, VAT summary, modelo 303 output+input VAT + DR303 file/download, purchase-invoice UI; dashboard sales screen + business-overview home | fiscal filing remainder parked (*Detail → Reporting*) |
| 9 | Deployment | the box as two containers with `waitron.sh` install/reset (#285, #314); guided node onboarding (#296); boot diagnosability (#310); CA-trust onboarding + per-OS certificate walkthrough (#330); till reroute S1–S6; promotion endpoint (#272) | USB installer (B3); cloud standby live link + the Waitron Cloud boundary |
| 10 | Tabs / table service | TS-1 tables+tabs, TS-2 statuses, TS-3 move/join/merge, TS-4 transfer, till action-flow wiring, TS-5 split-bill (#324) | core COMPLETE; owner-added extensions parked |
| 11 | Floor plan | FP-1 live floor + FP-2 spatial canvas/editor | — |
| 12 | KDS / devices | KDS-1 stations/routing/tickets, KDS-2 courses/fire, KDS-3 expo, KDS-4 kitchen printing, order-timing alerts; device identity + profiles (#199, #231, #269) | routing audit view; expo device kind; device-scoped fire/collect routes |
| 13 | Tips | attribution stored (`tenders.tip_amount`) — UI collection ONLY on the integrated-card idle screen | tip-collection UI for cash / manual card / handheld (A8); payroll export (integrate-not-build) |
| 14 | Bookings | Bookings-1, now the `@waitron/bookings` module (#270, #273) | public/online/QR, availability, reminders, CRM, recurring, calendar grid, deposits |
| 15 | Online ordering | — | not started (later phase) |
| 16 | Workforce | *registro de jornada* (chain per node since #268), D2 scheduling, roster authoring + approvals, staff request path + portal | **wage-computation engine** (convenio-gated); D3 payroll export (integrate-not-build) |
| 17 | Accounting export | — | not started (core subset; extends Reporting) |
| 18 | Menu/recipes/allergens | EU-14 allergens, recipe/BOM allergen inheritance, recipe-authoring UI, product images, location↔menu membership, modifiers and option groups, per-option and dish-line quantity, dietary classification, order-line customisation; departments and menus (#297) | counter/walk-up kitchen fire; menu draft/publish + schedule; customer-facing menu surface parked; nested sub-recipes / plate costing / stock depletion parked |
| 19 | Opening hours & channel sync | — | not started (Google Business Profile / Maps) |
| 20 | Procurement & inventory | received purchase invoices (`@waitron/purchasing`, feeds modelo 303) | suppliers/POs/goods-in/stock/3-way reconcile/reorder (parked); AI forecast deferred |

**Cross-cutting infra:** replication (native Postgres logical replication since #280) · membership,
promotion and rejoin (the arc is complete) · backup and restore (BR-1..BR-4 plus the wizard) · SIF
topology (`#33`, `node_id` re-key) · the module system (#212–#262; country packs #292) · the printing
subsystem (`@waitron/printing` plus the db-free `@waitron/print-agent`, #282–#335) · the layout
designer and device profiles (#194–#234, #246, #269) · CI and test infra (scoped CI, pre-push hook,
shared-container tests, job-sharding, root scope) · localisation (per-user `persons.locale`, live
language switch, venue-default derivation) · logging and diagnostics (Slice 1, #192).

**Later and parked** (no owner decision pending; reopen when a track reaches them): Square and
generic CSV menu import · accounting export (SP17) · opening hours and channel sync (SP19) · tip
payroll (SP13) · online ordering (SP15) · per-seat ordering and multiple tabs per table (each reopens a
settled decision — specced with the owner, never landed unattended) · KDS ops polish (routing
read-back and audit view, station kind, definable kitchen statuses) · recipes depth (nested
sub-recipes, plate costing, stock depletion, variants, customer-facing browse) · inventory and
procurement (SP20; the AI forecast waits for the deterministic system) · the expo device kind ·
**Bizum** (research 2026-08-30: account-to-account through Redsys or a PSP, roughly 0.4–0.6% direct
versus Stripe's 4.99% + €0.40; SumUp has none; in person a dynamic QR works today and the NFC tap is
rolling out through late 2026; the architecture-picking question, unverified, is whether a SumUp or
Stripe Tap-to-Pay phone can accept a Bizum tap — resolve before designing any in-person Bizum UX).

---

## Detail

The long form for tracked items, so the tracks above stay readable.

### Setup wizard — what the walkthrough found (A2)

Owner walkthrough 2026-09-12. **All five findings below closed with #334**; they are kept only
because the reasoning behind each choice is worth having when the wizard next changes. What is still
open is under *A2* in Track A, not here.

1. *The certificate page tells a Spanish operator nothing about getting the file.* It says only
   "Upload the certificate file and enter its passphrase" and accepts `.pfx` / `.p12`
   (`apps/setup/src/screens/cert-screen.ts`). Getting to that file means exporting it from the Windows
   certificate store, the macOS Keychain, or Firefox's own store — each a different sequence of
   dialogs. Detect which system the browser is running on and show the steps for that one, the others
   behind a link. Screenshots only if somebody owns keeping them current.

2. *A mistyped address during setup gives a blank page.* The setup box serves the wizard at the
   origin root with no history fallback, so `/manage` (the dashboard's address once trading) answers a
   bare 404 (`mountSpa` in `apps/server/src/spa-api.ts`, mounted with no `navigationPath`). Redirect to
   `/` — not a catch-all serving `index.html`, which would hide a missing asset. Leave the API routes
   and `/assets/` as they are.

3. *The first operator's Password and PIN boxes have no way to see what was typed*
   (`apps/setup/src/screens/admin-screen.ts`), while the certificate passphrase already carries a
   reveal control and the dashboard carries the icon version with an action-specific accessible label.
   Use the dashboard's on all three so the wizard does not show two different reveal buttons.

4. *Every form mistake on the shop page produces the same sentence.* The banner lists every possible
   problem at once (`apps/setup/src/screens/venue-screen.ts`) and bad fields carry an `invalid` flag
   and nothing else. Say per field what failed — a tax ID not valid for the country, a postal code
   outside the chosen province, too few or too many invoice languages, two identical series codes —
   and leave the summary as a summary (the shared form contract, CLAUDE.md §3).

5. *The demo path demands real business details nobody will use.* The tax ID has to pass the
   country's validity check and the postal code has to match the province (`REQUIRED_TEXT_FIELDS` and
   `#next` in `venue-screen.ts`). For demo only: ask for the operator's own details plus the location's
   name and address, fill everything else with sensible made-up values they can change later. **The
   tax ID is generated, and it is a company one** (owner, 2026-09-12): both shapes are a checksum over
   the digits (`packages/country-es/src/spain.ts`), and the owner's example `B-4943574-6` comes back
   valid, `entity`, normalised to `B49435746` — the shape a restaurant holds. A generated number is
   safe only because a demo box files nothing, so the generator must never be reachable from Prepare or
   Live.

**Till name and the two series codes** (owner asked what they are and what may be typed, 2026-09-12):

- *"Till name" really is the till, not the filing identity.* It inserts a row in `tills`
  (`create-till`, `packages/provisioning/src/venue-plan.ts`). The node — the SIF that files to AEAT —
  is created alongside and named after the location; nobody is asked to name it. A `till`-form-factor
  device ALWAYS creates its own register named after the device (`createRegister`,
  `apps/server/src/device.ts`), so the wizard's register is left over unless a handheld claims it, and
  no dashboard screen creates a register. Prefill it ("Caja 1", which every seed uses) or drop the
  question and let the dashboard create registers. `applyVenue`'s completeness guard and the handheld
  binding (`requireLiveRegister`) both move with it.
- *The two series codes should be defaulted, not optional* — the plan always emits both
  `create-series` actions. Do not ask on the demo path.
- *What a code may contain.* The database takes any non-empty text, unique per node. On the wire it
  is joined as `<code>/<number>` (`formatInvoiceNumber`, `packages/core/src/record-sale.ts`) and the
  whole string must be 1–60 characters from `A-Z a-z 0-9 / _ . -` — our own deliberately narrow charset
  (`packages/verifactu/src/validate.ts`). The practical ceiling on the code alone is 38
  (`MAX_BASE_CODE_LENGTH`, `packages/fiscal-verifactu/src/reserved-series.ts`), because a cold restore
  appends `-<installation number>`.
- *What to default them to.* Avoid a trailing `-<digits>`: `stripOwnSuffixes` removes a trailing
  `-<number>` when that number is a registered installation number, so `Fa-1` comes back from a
  restore as `Fa-2`. Zero-padding misleads because the counter follows a slash. **`FS`** (factura
  simplificada — every till sale is `TipoFactura` F2) and **`FR`** (rectificativa) survive both.
- *Who changes a code.* In practice the system does (`deriveReservedSeriesCodes` on restore or
  standby activation). Nothing in the dashboard can change or add a series today.

**"What this location does" is the wrong question for a required tax-agency field** (owner, 2026-09-12).
Stored as `locations.operation_description` (`NOT NULL`, `packages/db/src/schema/tenants.ts`) and
copied onto every filed record as AEAT's `DescripcionOperacion` (at most 500 characters, no control
characters). The wording invites a description of the business ("Deli and coffee shop") where AEAT
wants the transaction — our fixture has the right shape, "Venta en establecimiento"
(`apps/server/src/testing/venue-fixtures.ts`). It is a constant filed on every sale, so it should be
Spanish regardless of invoice languages — a setting with a default. Both halves of that were settled
by #334: the default comes from the fiscal contribution rather than from the country, because
`DescripcionOperacion` is a Veri\*Factu field and not a country fact; and a manager can now change it
after setup on the dashboard's **Location invoices** screen, which applies to records filed from then
on and leaves records already filed alone. So the wizard's "You can change these later" is no longer
false for this field.

### Roles the admin can edit (A7)

A person's role is a PostgreSQL enum with four values (`packages/identity/src/schema/persons.ts:21`).
The seam is already right: no call site gates on a role string — every one asks for a PERMISSION and
one map turns a role into its set (`packages/identity/src/permissions.ts`) — and a session reads the
role from the database on each request, so an edited role takes effect at once. Roles and their
permissions become rows the admin owns, per tenant, with the four seeded as defaults; no compatibility
code.

The design turns on the **ladder**: a module contributes a permission by naming only the lowest role
that should hold it (`grantedFrom`, `packages/module/src/module.ts:64`) and identity spreads it
upward. A custom role has no position, so either every custom role declares where it sits, or the
module contract names a permission group instead. Pick one before writing schema;
`packages/composition/src/role-parity.ts` proves at compile time that the contract's roles and
identity's are one list, and whatever replaces the union keeps an equivalent tie. Then: who may edit
a role (`person.admin` plus nobody mints or widens beyond what they hold, and a venue is never left
with nobody who can administer roles); a role in use (deleting or narrowing one changes live
sessions on their next request); storage (a table in identity's own migration set with `tenant_id`
and a classification entry — never an enum, CLAUDE.md §2); names (built-ins are translated from
`roleName`, `apps/dashboard/src/i18n/domain.ts:180`, custom ones will not be).

### Incidents are written by several things and displayed by nothing (A5)

`openIncidents` (`packages/core/src/incidents.ts`) is the only function that reads the `incidents`
table, and nothing calls it — a whole-repo search outside tests finds only its definition and the
barrel that exports it. The diagnostics screen is a live log tail, a different thing. The producers
that write: the fiscal drain when AEAT rejects a record, the payments reconciler on drift, the Stripe
device provider, the card provider pool, and — since A1 — the chain-append seam when a record's
totals disagree with its own VAT lines. `apps/server/src/pass.ts` names its intended audience as
"an operator grepping `drain.complete` (or the `incidents` table directly)" — and a real venue's
operator has no terminal. One surface serving every producer, which is why it is not folded into A1: a
screen shaped around that branch's two arithmetic warnings would be the wrong shape for the ones
already waiting.

### Logging, diagnostics & one-touch bug report (A9; Slice 1 landed #192)

[Design](superpowers/specs/2026-08-31-logging-diagnostics-foundation-design.md),
[plan](superpowers/plans/2026-08-31-logging-diagnostics-foundation.md). Eventual vendor destination
is GitHub issues; for now a bundle only needs to be copy-pastable.

- **Slice 2 — one-touch bug report.** A `bug_reports` table (tenant-scoped, `local`, grants in its
  module's set), a capture endpoint that FREEZES a self-contained bundle (client trail `snapshot()` +
  `LogReader.byRequestIds()` + environment), a `wt-report-dialog` and "Report a problem" trigger in
  the till and dashboard chrome, and a GitHub-ready markdown serialiser.
- **Slice 3 — triage and forwarding.** A dashboard *Problem reports* screen and automated GitHub-issue
  creation (a stored token in `@waitron/credentials`).
- **Hardening carried out of Slice 1, for Slice 2:** a key-name allowlist on the client trail's
  redaction (it filters by value TYPE only, so a secret string under any key passes) and scrub
  `message`/`stack` from rejected Errors; `maskPath` masks UUID and all-numeric segments only — mask
  slugs and emails too; route the dashboard's boot-probe-fail, post-login and logout transitions
  through the nav trail; roll the trail and report button out to `apps/setup`.

### KDS operations — low priority (A9)

Order routing is built (item→station, station→printer, receipt→printer). Gaps: a routing read-back /
audit view (the station selects are set-only — the most useful to close); no station `type`/`kind`;
single-target only (no fan-out, no per-modifier or per-time rules). Table and service statuses have
full CRUD; kitchen statuses are partial — `bump_mode` and `fire_control` are configurable fixed
enums, but a user-definable kitchen-status list does not exist.

### Backup & restore — carry-forwards (B2)

[Design](superpowers/specs/2026-09-04-backup-restore-regime-design.md); the restore hook is
[SP-3d](superpowers/specs/2026-09-06-module-sp3d-fiscal-restore-hook-design.md); the wizard is
[#295](superpowers/specs/2026-09-09-backup-recovery-key-wizard-design.md). Landed: the storage
abstraction, fan-out and AES-256-GCM artifact encryption; the single encrypted archive and the module
`backup` contribution; the restore consumer; a filing node's restore minting a fresh chain and disjoint
series; the dashboard wizard. The image ships with backups OFF, deliberately.

Whole-state-volume capture today: the fatal `RECOVERY_FILES` plus the optional `backup.env` and
`modules.json`; the exclusion set for the deeper change is `backup-staging/`, `restore-staging/`,
`logs/`, the per-hardware `instance.env` and `recovery.json`. Touches BR-2, BR-3 and the recovery
bundle. Named carry-forwards: a stale-`.tmp` sweep; confirm the `StorageBackend` key path-traversal
guard landed with BR-3's manifest-driven `get(key)`; a working-backup boot success-path integration
test; scope the flat `resolvers` map by module when a second `nonDbState` module lands; a
`packArchive` pack-time entries bound; a manifest-shape coded refusal (it fails safe under GCM auth
today); generalise archive entry routing off declared source ids when a second non-DB source lands.

### Box image constraints (B3)

- **A setup box's `/health` returns 503 by design** (no duty loop); a liveness probe must gate on
  `/setup-api/status` (200), or it restart-loops an unprovisioned box.
- **The name-constrained-CA model does NOT protect a personal Android phone** (spike 2026-09-08): a
  user-installed root is trusted for every name on Android, while desktop Chrome and iOS/Safari honour
  the constraint. The service-worker/PWA/WebAuthn-blocked-until-trusted behaviour and an iOS device
  are still to measure.
- **The box image carries the replication cluster settings and the WireGuard link:** `wal_level=logical`,
  `track_commit_timestamp=on`, `max_slot_wal_keep_size`, the `waitron_repl` bootstrap, and `pg_hba`
  admitting it only from the peer's WireGuard address.
- **Identity on a standby:** `persons` and `webauthn_credentials` are `state`, so a standby can
  authenticate the venue's people on failover; re-establishment is PIN-re-prompt v1.
- Later kiosk options, none built: Chromium `--kiosk` in the box image, Fully Kiosk resale for
  dedicated tablets, Android Management API enrolment as a Waitron Cloud feature.

### Replication, membership & failover — residuals (Afterwards)

**Mechanism (since #280):** every module classifies its tables `ledger` / `state` / `local`; the
table owner creates the `_ledger`/`_state` publications; a standby subscribes over the box↔cloud link;
promotion and return run on `pg_replication_slots` with the fence-LSN drain watermark; settings are
primary-wins by construction. A standby holds its full dormant identity from JOIN and promotion never
mints a chain.

- **Re-admission `sell-only → serving-secondary`** — the primary-minted un-fence that makes a rejoined
  box sell again. Must retire the node's previous chart entry and delete its live `fiscal.aeat` row.
- **The membership chart grows without bound.** It APPENDS while `MAX_NODES = 8` (`packages/membership/src/verify.ts`) makes every verifier
  refuse a longer document, and every wipe-and-re-adopt mints a fresh nodeId — roughly eight
  disaster-recovery re-adopts leave a document no node accepts. Re-admission must retire, not add.
- **Chart hygiene:** a post-setup change to `WAITRON_ADVERTISED_ORIGIN` is never re-published, and a
  node that promotes while absent from the chart appends itself address-less, which `routableServers`
  drops.
- **Resume-at-restore marker** — a persisted wiped-state marker to tell a wiped-mid-restore box from
  a never-provisioned one.
- **Worker-lifecycle manager** (promote Slice 3) — in-process promotion without the restart; the
  node-role collapse decides.
- **Power-loss durability and the selling gate.** `writeFileAtomic` does NOT fsync while the
  point-of-no-return is a durable pg commit, so a power cut between the env write and the commit could
  reboot a box `mode=primary` still carrying the primary's series. Fsync the env write or resolve the
  series at boot — and selling must gate on REBOOT COMPLETION.
- **Still owed after the cert-distribution rebuild:** the restore-onto-cloud re-encrypt; a dashboard
  promote UI; an a11y test for the break-glass panel.
- **Mirror fidelity** — `adoptVenue` nulled `locations.catalogue_id` and `tills.receipt_printer_id`
  under the outbox adopt; re-check what the native initial COPY leaves.
- **Carry-ins, accepted or to be stated in a threat model:** the primary burns an installation number
  per bundle fetch; provision and adopt are assumed mutually exclusive per box; `establishNodeIdentity`
  must run once per node before any document is signed; the membership private key is decryptable by
  the `app_user` pool, as `fiscal.aeat` is; on the first boot after returning, a node runs as its
  stale-held-doc primary until the reconciliation restarts it; restart-based fencing leaves a one-tick
  window for one more fiscal pass on the superseded chain.
- **Split-brain** — the promoted node's side while partitioned spans selling, the fiscal chain,
  payments (`resolvePending`) and printing — **examine in detail, not scoped to printing** (owner,
  2026-08-26).
- **Till UX for the timed-out card case** — retry, alternative tender, or wait.

### Reporting — the fiscal remainder (parked)

[Spec](superpowers/specs/2026-08-08-reporting-desglose-and-modelo303-spec.md). Two pre-filing caveats
a human must clear before the first LIVE 303 filing: validate the DR303 file once against the real
AEAT "por fichero" uploader (we omit página 2, régimen simplificado); and an asesor must confirm the
**prorrata** treatment (`computeInputVat` scales only the cuota by `deductible_proportion`). Deferred
build slices: rectificativas de facturas recibidas (casilla 40/41, needs a
`corrects_purchase_invoice_id` self-FK); bienes-de-inversión regularización (43); the prorrata rule
(44, asesor-driven); intra-community and import boxes (32–39); a libro-registro / Pre303 export.

---

## The advisor gap — not a build track

**No fiscal advisor is engaged**, and [compliance/who-to-ask.md](compliance/who-to-ask.md) says every
candidate turned out to be a marketing page — so engaging is itself a task with a lead time, in
parallel, blocking nothing. Before paying for answers, re-read every question in
[asesor-questions.md](compliance/asesor-questions.md) against the cloud-as-sync-root and server-as-SIF
designs (several assumed Waitron hosts the client's fiscal system) and add the three ROF hosting
questions from [cloud-storage-model §8a](superpowers/specs/2026-07-31-cloud-storage-model-design.md).
Q16 (operating from abroad) is closed by the Spain-residency decision; do not send it.

| Q | Assumption in the tree | Status |
| --- | --- | --- |
| Q13 (tips outside VAT base) | tip lives on `tenders.tip_amount`, never handed to the fiscal backend | **Closed** on primary source |
| Q15 (short payment = descuento) | a *descuento* agreed at/before issuance is outside the base (LIVA 78.Tres.2º) | **Closed** on primary source |
| Q5(a) (one series per till) | a series belongs to the server-SIF; two concurrent SIFs need **disjoint** series | needs advisor |
| **Q14 (precuenta → amendment log)** | a printed pre-bill may oblige an amendment log | **Open** — the interpretive hinge |
| F3 canje (`IDOtro`, a separate F3 series, `Destinatarios` XSD) | foreign recipient refused; F3 reuses `standard` | needs advisor / XSD before the first real filing |

**The laboral advisor** (a *graduado social / gestoría*) has its own list in
[asesor-laboral-questions.md](compliance/asesor-laboral-questions.md). Nothing there blocks the build;
two items want confirming before go-live (the digital-registro RD's status; the provincial convenio
and figures), plus whether a location's exported working-time record may show per-node chains. The
gestoría's payroll import layout is the one build dependency (it fixes the D3 export format). A tip
collected through the card terminal is business income — an accounting/payroll matter, not the
factura.

**Data protection (RGPD) is a third track, never scoped end-to-end.** Scope it before engaging a
DPO: a data map (what personal data, where, how long); the controller-versus-processor split and
whether a DPA is needed; the venue-facing duties (privacy notice, lawful basis, access/erasure/
portability, breach notification, retention) and which Waitron must *build* versus the venue must
*operate*. Blocks nothing today; the retention/erasure/export mechanics become build work once
scoped.

---

## Reference

**Adding a new real-PG test package** (the shared-container rollout pattern, so it isn't reinvented):
`ProbeRole.inRole` takes `string | readonly string[]` (a multi-membership role is a plain `roles` entry,
no `setup` hook); `cloneTemplate` is exported from `lifecycle.ts` and validates its own identifiers, so a
package needing a fresh DB per test (a `describeEachTarget`-style seam) reuses it — `packages/db`'s
`harness.ts` `postgresTarget` is the reference (clone per test, track, drop all in `teardown()`);
`nextCloneName()` mints the shared clone-name; `useTemplateDb` covers one-clone-per-file. Template-key
naming is **`core_<schema>`** (self-describing about what it migrates, not the package name). Fork mode is
a **per-package call**: (a) the `@vitest/coverage-v8` cross-fork branch-merge bug needs `singleFork` where
a package runs under `pnpm -r` oversubscription; (b) a shared container is one cluster on a 100-connection
budget, so a package whose suites open many backends caps at `maxForks: 4`. `packages/db` is the
reason-(b) reference, `packages/payments` the reason-(a) one — but both carry the HIGH coverage bar, so
a new package that copies either config must set the `90/90/85/85` floor (CLAUDE.md §2), or
`scripts/coverage-thresholds.test.ts` fails it in the ungated `lint` job. Plan:
`docs/superpowers/plans/2026-08-19-shared-test-container.md`. A two-node replication suite uses
`packages/db/src/testing/two-node.ts`, or `two-node-wireguard.ts` when the link itself is under test.

**Dev stack from a worktree.** `wa-wt demo|onboarding <worktree-name>` and
`wa-wt reset demo|onboarding [worktree-name]` — the rule is in CLAUDE.md §6; detail in
[ui-review.md](ui-review.md) → *Running the stack from a worktree*.

## How to keep this file honest

Update it in the change that makes it stale (CLAUDE.md §7). In particular:

- When a piece lands, move it out of *What to work on next*, its track, and the *What's built*
  "Remaining" column — do not add a receipt paragraph. **This is state, not history; the git log is
  the history.**
- The moment it goes stale most reliably is a **merge**: `/land-branch` carries a step to update this
  file. A merge deletes the branch the in-flight rows named, so refresh them then.
- When a question is closed on primary source, say so and stop calling it blocked.
- Delete finished items. If an entry is growing proof-of-work (test counts, grep receipts, "proven by
  deletion", what a review seat caught), that belongs in the PR thread, not here.
